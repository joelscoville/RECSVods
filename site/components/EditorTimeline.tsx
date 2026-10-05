import { useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import { edgeLimits, edges as edgesOf, formatClock, isFileMarker, items as itemsOf, snapTime, type Edge, type EditorItem, type EditorMarker, type EditorState, type Lane as ItemLane } from '../lib/recording-editor';
import { isMac } from '../lib/editor-keys';

import { clampView, pointRows, POINT_ROW, zoomView, type TimelineView } from '../lib/timeline-view';

const STEPS = [0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600];
const GRAB_PX = 7, SNAP_PX = 9, EDGE_SCROLL_PX = 28, MARKER_HALF = 8;
type Lane = 'ruler' | 'marks' | ItemLane;
const LANES: ItemLane[] = ['chapter', 'subchapter', 'point'];
type Drag =
  | { kind: 'scrub' }
  | { kind: 'boundary'; boundary: Edge; origin: number; pointerStart: number; grab: number; moved: boolean; playhead: number; time: number; snapped?: number; label: string }
  | { kind: 'overview-move'; grab: number } | { kind: 'overview-edge'; edge: 'start' | 'end' };

export interface BoundaryMove { boundary: Edge; time: number; unlinked: boolean }
/** What was under the pointer on a right-click. */
export interface TimelineContext { x: number; y: number; time: number; lane: Lane; item?: EditorItem; boundary?: Edge; marker?: EditorMarker }

export default function EditorTimeline({ state, duration, time, view, onView, snapping, linked, selectedId, activeBoundary, changed, failing,
  selectedMarkerId, onSelectMarker, onAddMarker,
  onScrub, onSelect, onBoundaryMove, onBoundaryCommit, onBoundaryCancel, onAdd, onRename, onContextMenu }: {
  state: EditorState; duration: number; time: number; view: TimelineView; onView: (view: TimelineView) => void;
  snapping: boolean; linked: boolean; selectedId?: string; activeBoundary?: Edge; changed: Set<string>; failing: Set<string>;
  /** Live seeking: `end` is the final position when a drag ends. */
  onScrub: (seconds: number, phase: 'start' | 'move' | 'end') => void;
  onSelect: (item: EditorItem) => void;
  onBoundaryMove: (move: BoundaryMove) => void; onBoundaryCommit: () => void; onBoundaryCancel: () => void;
  onAdd: (lane: ItemLane, seconds: number) => void; onRename: (item: EditorItem) => void;
  onContextMenu: (context: TimelineContext) => void;
  selectedMarkerId?: string; onSelectMarker: (marker: EditorMarker) => void; onAddMarker: (seconds: number) => void;
}) {
  const surface = useRef<HTMLDivElement>(null), overview = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(800);
  const [hover, setHover] = useState<{ x: number; lane: Lane; boundary?: Edge; pointId?: string }>();
  const [drag, setDrag] = useState<Drag>();
  const dragRef = useRef<Drag>(undefined);
  const pointer = useRef({ x: 0, alt: false, mod: false });
  const viewRef = useRef(view);
  viewRef.current = view;
  const setDragState = (next: Drag | undefined) => { dragRef.current = next; setDrag(next); };

  useEffect(() => {
    const element = surface.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(1, entry.contentRect.width)));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const pps = width / view.span;
  const x = (seconds: number) => (seconds - view.from) * pps;
  const at = (px: number) => view.from + px / pps;

  const all = useMemo(() => itemsOf(state, duration), [state, duration]);
  const lanes = useMemo(() => Object.fromEntries(LANES.map(lane => [lane, all.filter(item => item.lane === lane)])) as Record<ItemLane, EditorItem[]>, [all]);
  const edges = useMemo(() => edgesOf(state), [state]);
  const pointLayout = useMemo(() => pointRows(lanes.point, view, width), [lanes.point, view, width]);
  const markers = state.markers;
  // A marker is a tab centred on its time; anywhere on the tab picks it.
  const markerAt = (px: number) => markers.map(marker => ({ marker, distance: Math.abs(px - x(marker.at)) }))
    .filter(({ distance }) => distance <= MARKER_HALF + 2).sort((a, b) => a.distance - b.distance)[0]?.marker;
  const markerClass = (marker: EditorMarker) => [!isFileMarker(marker) && 'is-mine', !isFileMarker(marker) && !marker.include && 'is-private',
    marker.id === selectedMarkerId && 'is-selected'].filter(Boolean).join(' ');

  // Wheel: scroll sideways; with Cmd/Ctrl (or a trackpad pinch) zoom at the pointer.
  useEffect(() => {
    const element = surface.current;
    if (!element) return;
    const wheel = (event: WheelEvent) => {
      const current = viewRef.current, box = element.getBoundingClientRect(), perPx = current.span / box.width;
      event.preventDefault();
      if (event.ctrlKey || event.metaKey) {
        onView(zoomView(current, Math.exp(event.deltaY * 0.003), current.from + (event.clientX - box.left) * perPx, duration));
      } else {
        const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
        onView(clampView({ ...current, from: current.from + delta * perPx }, duration));
      }
    };
    element.addEventListener('wheel', wheel, { passive: false });
    return () => element.removeEventListener('wheel', wheel);
  }, [duration, onView]);

  // Dragging near either end scrolls the view so there is always room to keep going.
  useEffect(() => {
    if (!drag || drag.kind === 'overview-move' || drag.kind === 'overview-edge' || drag.kind === 'boundary' && !drag.moved) return;
    let frame = 0;
    const tick = () => {
      const px = pointer.current.x, speed = px < EDGE_SCROLL_PX ? -(EDGE_SCROLL_PX - px) : px > width - EDGE_SCROLL_PX ? px - (width - EDGE_SCROLL_PX) : 0;
      if (speed) {
        const current = viewRef.current, next = clampView({ ...current, from: current.from + speed * 0.02 * current.span / width }, duration);
        if (next.from !== current.from) { onView(next); move(px, next); }
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  });

  useEffect(() => {
    if (drag?.kind !== 'boundary') return;
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.stopPropagation(); setDragState(undefined); onBoundaryCancel(); } };
    window.addEventListener('keydown', key, true);
    return () => window.removeEventListener('keydown', key, true);
  }, [drag?.kind, onBoundaryCancel]);

  const laneOf = (clientY: number): Lane => {
    const target = document.elementsFromPoint(surface.current!.getBoundingClientRect().left + 1, clientY).find(element => (element as HTMLElement).dataset?.lane);
    return ((target as HTMLElement | undefined)?.dataset.lane as Lane) ?? 'ruler';
  };
  const pointOf = (target: EventTarget | null) => target instanceof Element ? target.closest<HTMLElement>('[data-point]')?.dataset.point : undefined;
  const nearBoundary = (px: number, lane: Lane, pointId?: string) => lane === 'ruler' || lane === 'marks' ? undefined
    : lane === 'point' ? edges.find(edge => edge.id === pointId) : edges
    .filter(edge => edge.lane === lane && Math.abs(x(edge.time) - px) <= GRAB_PX)
    .sort((a, b) => Math.abs(x(a.time) - px) - Math.abs(x(b.time) - px))[0];
  const underPointer = (seconds: number, lane: Lane, pointId?: string) => lane === 'ruler' || lane === 'marks' ? undefined
    : lane === 'point' ? lanes.point.find(item => item.id === pointId)
      : lanes[lane].filter(item => item.start <= seconds && seconds < item.end).at(-1);
  const nameOf = (edge: Edge) => all.find(item => item.id === edge.id)?.title ?? edge.id;

  function move(px: number, current = viewRef.current) {
    const active = dragRef.current, perPx = current.span / width, seconds = current.from + px * perPx;
    if (active?.kind === 'scrub') onScrub(Math.min(Math.max(0, seconds), duration), 'move');
    if (active?.kind !== 'boundary') return;
    if (!active.moved && Math.abs(px - active.pointerStart) < 4) return;
    const { boundary } = active;
    const [low, high] = edgeLimits(state, duration, boundary, linked && !pointer.current.alt);
    let target = Math.min(Math.max(seconds - active.grab, low), high);
    let snapped: number | undefined;
    if (snapping && !pointer.current.mod) {
      // The playhead follows the drag, so it snaps to where the playhead was when the drag began.
      const candidates = [active.playhead, 0, duration, ...edges.filter(edge => Math.abs(edge.time - active.origin) > 0.005).map(edge => edge.time)].filter(value => Number.isFinite(value) && value >= low && value <= high);
      ({ time: target, snapped } = snapTime(target, candidates, SNAP_PX * perPx));
    }
    const edgeName = `${boundary.edge === 'end' ? 'End' : boundary.lane === 'point' ? 'Time' : 'Start'} of “${nameOf(boundary)}”`;
    const delta = target - active.origin;
    setDragState({ ...active, moved: true, time: target, snapped, label: `${edgeName} · ${formatClock(target)} (${delta >= 0 ? '+' : '−'}${Math.abs(delta).toFixed(1)} s)` });
    onBoundaryMove({ boundary, time: target, unlinked: pointer.current.alt });
  }

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    const box = event.currentTarget.getBoundingClientRect(), px = event.clientX - box.left, lane = laneOf(event.clientY);
    pointer.current = { x: px, alt: event.altKey, mod: isMac() ? event.metaKey : event.ctrlKey };
    event.currentTarget.setPointerCapture(event.pointerId);
    const marker = lane === 'marks' ? markerAt(px) : undefined;
    // Opening the Markers window can move the timeline under a still pointer; drop the stale hover.
    if (marker) { setHover(undefined); onSelectMarker(marker); return; }
    const pointId = pointOf(event.target), boundary = nearBoundary(px, lane, pointId);
    if (boundary) {
      const item = all.find(item => item.id === boundary.id);
      if (item) onSelect(item);
      setDragState({ kind: 'boundary', boundary, origin: boundary.time, pointerStart: px, grab: at(px) - boundary.time, moved: false, playhead: time, time: boundary.time, label: '' });
      return;
    }
    const seconds = Math.min(Math.max(0, at(px)), duration), item = underPointer(seconds, lane, pointId);
    // Clicking an item selects it; only empty space (and the ruler) moves the playhead.
    if (item) { onSelect(item); return; }
    setDragState({ kind: 'scrub' });
    onScrub(seconds, 'start');
  };
  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const box = event.currentTarget.getBoundingClientRect(), px = event.clientX - box.left;
    pointer.current = { x: px, alt: event.altKey, mod: isMac() ? event.metaKey : event.ctrlKey };
    if (dragRef.current) { move(px); return; }
    const lane = laneOf(event.clientY), pointId = pointOf(event.target);
    setHover({ x: px, lane, pointId, boundary: nearBoundary(px, lane, pointId) });
  };
  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    const active = dragRef.current;
    setDragState(undefined);
    if (active?.kind === 'scrub') onScrub(Math.min(Math.max(0, at(event.clientX - event.currentTarget.getBoundingClientRect().left)), duration), 'end');
    if (active?.kind === 'boundary') { if (active.moved && active.time !== active.origin) onBoundaryCommit(); else onBoundaryCancel(); }
  };
  const onDoubleClick = (event: React.MouseEvent<HTMLDivElement>) => {
    const box = event.currentTarget.getBoundingClientRect(), px = event.clientX - box.left, lane = laneOf(event.clientY);
    if (lane === 'marks') { if (!markerAt(px)) onAddMarker(Math.min(Math.max(0, at(px)), duration)); return; }
    // Pointer capture retargets clicks to the surface, so resolve the diamond at the click position.
    if (lane === 'point') { const point = underPointer(at(px), lane, pointOf(document.elementFromPoint(event.clientX, event.clientY))); if (point) onRename(point); return; }
    if (lane === 'ruler' || nearBoundary(px, lane)) return;
    const seconds = at(px), exact = underPointer(seconds, lane);
    if (exact) onRename(exact); else onAdd(lane, seconds);
  };

  // Ruler: labels at least 90 px apart, minor ticks between.
  const step = STEPS.find(value => value * pps >= 90) ?? 3600;
  const minor = step / (step * pps >= 180 ? 10 : 5);
  const ticks: { t: number; major: boolean }[] = [];
  for (let t = Math.ceil(Math.max(0, view.from) / minor) * minor; t <= Math.min(duration, view.from + view.span) + 1e-9; t += minor) {
    ticks.push({ t, major: Math.abs(t / step - Math.round(t / step)) < 1e-6 });
  }
  const block = (item: EditorItem) => {
    const left = x(item.start), right = x(item.end);
    if (right < -2 || left > width + 2) return null;
    const blockWidth = Math.max(2, right - left);
    // The name stays readable when the start of a long chapter is scrolled off to the left.
    const labelOffset = Math.max(0, -left);
    const classes = ['tl-block', `tl-${item.group}`, item.id === selectedId && 'is-selected', changed.has(item.id) && 'is-changed',
      failing.has(item.id) && 'is-failing', state.checked.includes(item.id) && 'is-checked'].filter(Boolean).join(' ');
    return <div key={item.id} className={classes} style={{ left, width: blockWidth }} title={`${item.title}\n${formatClock(item.start)}–${formatClock(item.end)}`}>
      {blockWidth - labelOffset > 26 && <span className="tl-label" style={{ marginLeft: labelOffset }}>
        <span className="tl-title">{item.title}</span>
        {item.lane === 'chapter' && <span className="tl-range">{formatClock(Math.round(item.start))}–{formatClock(Math.round(item.end))}</span>}
      </span>}
    </div>;
  };
  const diamond = (item: EditorItem) => {
    const left = x(item.start), row = pointLayout.rows.get(item.id);
    if (row === undefined) return null;
    const top = (pointLayout.height - pointLayout.count * POINT_ROW) / 2 + (row + 0.5) * POINT_ROW;
    const owner = all.find(parent => parent.id === item.parentId)?.title;
    return <button key={item.id} data-point={item.id} type="button" className={`tl-point${item.id === selectedId ? ' is-selected' : ''}${failing.has(item.id) ? ' is-failing' : ''}`}
      style={{ left, top }} aria-label={`Description at ${formatClock(item.start)} in ${owner}`} title={`${owner}: ${item.title}\nGo to ${formatClock(item.start)}. Drag to move the description's time.`}
      onClick={event => { if (event.detail === 0) onSelect(item); }} onKeyDown={event => { if (event.key === 'F2') { event.preventDefault(); onRename(item); } }}>
      <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1 15 8 8 15 1 8Z" /></svg>
    </button>;
  };

  const hoverTime = hover && !drag ? Math.min(Math.max(0, at(hover.x)), duration) : undefined;
  const hoverItem = hoverTime !== undefined && hover ? underPointer(hoverTime, hover.lane, hover.pointId) : undefined;
  const dragBoundary = drag?.kind === 'boundary' ? drag : undefined;
  const hoverMarker = hover && !drag && hover.lane === 'marks' ? markerAt(hover.x) : undefined;
  const cursor = dragBoundary?.moved || hover?.boundary && hover.lane !== 'point' ? 'ew-resize' : hoverItem || hoverMarker ? 'pointer' : 'default';

  // Overview: the whole video, with the visible stretch boxed. Drag the box to scroll, its ends to zoom.
  const overviewWidth = width, whole = (seconds: number) => (seconds / duration) * overviewWidth;
  const onOverviewDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    const box = event.currentTarget.getBoundingClientRect(), px = event.clientX - box.left;
    event.currentTarget.setPointerCapture(event.pointerId);
    const start = whole(Math.max(0, view.from)), end = whole(Math.min(duration, view.from + view.span));
    if (Math.abs(px - start) <= 6) setDragState({ kind: 'overview-edge', edge: 'start' });
    else if (Math.abs(px - end) <= 6) setDragState({ kind: 'overview-edge', edge: 'end' });
    else if (px > start && px < end) setDragState({ kind: 'overview-move', grab: px / overviewWidth * duration - view.from });
    else { onView(clampView({ ...view, from: px / overviewWidth * duration - view.span / 2 }, duration)); setDragState({ kind: 'overview-move', grab: view.span / 2 }); }
  };
  const onOverviewMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const active = dragRef.current, seconds = (event.clientX - event.currentTarget.getBoundingClientRect().left) / overviewWidth * duration;
    if (active?.kind === 'overview-move') onView(clampView({ ...view, from: seconds - active.grab }, duration));
    if (active?.kind === 'overview-edge') {
      const end = view.from + view.span;
      onView(clampView(active.edge === 'start' ? { from: seconds, span: end - seconds } : { from: view.from, span: seconds - view.from }, duration));
    }
  };

  return <div className="tl" aria-label="Timeline" style={{ '--tl-points': `${pointLayout.height}px` } as CSSProperties}>
    <div className="tl-head">
      <span />
      <div className="tl-overview" ref={overview} onPointerDown={onOverviewDown} onPointerMove={onOverviewMove} onPointerUp={() => setDragState(undefined)}
        title="Whole recording. Drag the box to scroll, or its ends to zoom.">
        {lanes.chapter.map(item => <span key={item.id} className={`tl-mini tl-${item.group}`} style={{ left: whole(item.start), width: Math.max(1, whole(item.end) - whole(item.start)) }} />)}
        <span className="tl-mini-view" style={{ left: whole(Math.max(0, view.from)), width: Math.max(8, whole(Math.min(duration, view.from + view.span)) - whole(Math.max(0, view.from))) }} />
        <span className="tl-mini-playhead" style={{ left: whole(time) }} />
      </div>
    </div>
    <div className="tl-body">
      <div className="tl-headers" aria-hidden="true">
        <span className="tl-header-ruler" />
        <span className="tl-header" data-lane-label="marks">Markers</span>
        <span className="tl-header" data-lane-label="chapter">Chapters</span>
        <span className="tl-header" data-lane-label="subchapter">Subchapters</span>
        <span className="tl-header" data-lane-label="point">Descriptions</span>
        <span />
      </div>
      <div className="tl-surface" ref={surface} style={{ cursor }} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp}
        onPointerLeave={() => { if (!dragRef.current) setHover(undefined); }} onDoubleClick={onDoubleClick}
        onContextMenu={event => {
          event.preventDefault();
          if (dragRef.current) return;
          const box = event.currentTarget.getBoundingClientRect(), px = event.clientX - box.left, lane = laneOf(event.clientY);
          const pointId = pointOf(event.target), seconds = Math.min(Math.max(0, at(px)), duration), boundary = nearBoundary(px, lane, pointId);
          const item = underPointer(seconds, lane, pointId);
          setHover(undefined);
          onContextMenu({ x: event.clientX, y: event.clientY, time: seconds, lane, item, boundary, marker: lane === 'marks' ? markerAt(px) : undefined });
        }}>
        <div className="tl-ruler" data-lane="ruler">
          {ticks.map(({ t, major }) => <span key={t.toFixed(3)} className={major ? 'tl-tick is-major' : 'tl-tick'} style={{ left: x(t) }}>{major && <span>{formatClock(t)}</span>}</span>)}
        </div>
        <div className="tl-lane tl-lane-marks" data-lane="marks">
          {markers.map(marker => {
            const left = x(marker.at);
            if (left < -12 || left > width + 12) return null;
            return <div key={marker.id} className={`tl-marker ${markerClass(marker)}${marker.id === hoverMarker?.id ? ' is-hover' : ''}`} style={{ left }}>
              {marker.end !== undefined && <span className="tl-marker-range" style={{ width: Math.max(2, x(marker.end) - left) }} />}
              <svg className="tl-marker-tab" viewBox="0 0 16 22" width="16" height="22" aria-hidden="true"><path d="M1.5 1.5h13v12.2L8 20.5l-6.5-6.8z" /></svg>
            </div>;
          })}
        </div>
        <div className="tl-lane" data-lane="chapter">
          {x(0) > 0 && <div className="tl-outside" style={{ left: 0, width: x(0) }} />}
          {x(duration) < width && <div className="tl-outside" style={{ left: x(duration), width: width - x(duration) }} />}
          {lanes.chapter.map(block)}
        </div>
        <div className="tl-lane tl-lane-sub" data-lane="subchapter">
          {lanes.subchapter.map(block)}
        </div>
        <div className="tl-lane tl-lane-sub" data-lane="point">
          {lanes.point.map(diamond)}
        </div>
        <div className="tl-filler" aria-hidden="true" />
        {markers.map(marker => x(marker.at) >= -2 && x(marker.at) <= width + 2 && <div key={marker.id} className={`tl-marker-guide ${markerClass(marker)}`} style={{ left: x(marker.at) }} />)}
        {activeBoundary && !dragBoundary && <div className={`tl-boundary is-active tl-at-${activeBoundary.lane}`} style={{ left: x(activeBoundary.time) }} />}
        {hover?.boundary && !drag && <div className={`tl-boundary tl-at-${hover.boundary.lane}`} style={{ left: x(hover.boundary.time) }} />}
        {dragBoundary && <div className="tl-ghost" style={{ left: x(dragBoundary.playhead) }} title="Where the playhead was" />}
        {dragBoundary && <div className={`tl-boundary is-dragging tl-at-${dragBoundary.boundary.lane}${dragBoundary.snapped !== undefined ? ' is-snapped' : ''}`} style={{ left: x(dragBoundary.time) }} />}
        {hoverTime !== undefined && <div className="tl-hover" style={{ left: hoverMarker ? x(hoverMarker.at) : hover!.x }}><span>{hoverMarker
          ? `${formatClock(hoverMarker.at)}${hoverMarker.end !== undefined ? ` · ${formatClock(hoverMarker.end - hoverMarker.at)} long` : ''} · ${hoverMarker.note || 'No note yet'}`
          : `${formatClock(hoverTime)}${hoverItem ? ` · ${hoverItem.title}` : ''}`}</span></div>}
        {dragBoundary?.label && <div className="tl-readout" style={{ left: x(dragBoundary.time) }}>{dragBoundary.label}{dragBoundary.snapped !== undefined && <em> · snapped</em>}
        </div>}
        {time >= view.from && time <= view.from + view.span && <div className="tl-playhead" style={{ left: x(time) }}><span className="tl-playhead-head" /></div>}
      </div>
    </div>
  </div>;
}
