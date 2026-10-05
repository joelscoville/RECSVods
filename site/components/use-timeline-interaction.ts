import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
  type PointerEvent,
} from 'react';
import {
  edges as edgesOf,
  formatClock,
  items as itemsOf,
  type Edge,
  type EditorItem,
  type EditorMarker,
  type EditorState,
  type Lane,
} from '../lib/recording-editor';
import { isMac } from '../lib/editor-keys';
import {
  boundaryDragPosition,
  edgeScrollView,
  hitBoundary,
  hitItem,
  hitMarker,
  pixelToTime,
  timeToPixel,
  type BoundaryDrag,
  type BoundaryMove,
  type TimelineContext,
  type TimelineLane,
} from '../lib/timeline-geometry';
import { clampView, zoomView, type TimelineView } from '../lib/timeline-view';

type Drag =
  | { kind: 'scrub' }
  | BoundaryDrag
  | { kind: 'overview-move'; grab: number }
  | { kind: 'overview-edge'; edge: 'start' | 'end' };
export interface TimelineEvents {
  onScrub: (seconds: number, phase: 'start' | 'move' | 'end') => void;
  onSelect: (item: EditorItem) => void;
  onBoundaryMove: (move: BoundaryMove) => void;
  onBoundaryCommit: () => void;
  onBoundaryCancel: () => void;
  onAdd: (lane: Lane, seconds: number) => void;
  onRename: (item: EditorItem) => void;
  onContextMenu: (context: TimelineContext) => void;
  onSelectMarker: (marker: EditorMarker) => void;
  onAddMarker: (seconds: number) => void;
}

/** Owns measurements, pointer capture and animation frames. Numeric calculations
 * live in timeline-geometry; edits are emitted to the editor's drag transaction. */
export function useTimelineInteraction({
  state,
  duration,
  time,
  view,
  onView,
  snapping,
  linked,
  events,
}: {
  state: EditorState;
  duration: number;
  time: number;
  view: TimelineView;
  onView: (view: TimelineView) => void;
  snapping: boolean;
  linked: boolean;
  events: TimelineEvents;
}) {
  const surface = useRef<HTMLDivElement>(null);
  const overview = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(800);
  const [hover, setHover] = useState<{
    x: number;
    lane: TimelineLane;
    boundary?: Edge;
    pointId?: string;
  }>();
  const [drag, setDrag] = useState<Drag>();
  const dragRef = useRef<Drag>(undefined);
  const pointer = useRef({ x: 0, alt: false, mod: false });
  const viewRef = useRef(view);
  viewRef.current = view;
  function setDragState(next: Drag | undefined) {
    dragRef.current = next;
    setDrag(next);
  }
  const all = useMemo(() => itemsOf(state, duration), [state, duration]);
  const edges = useMemo(() => edgesOf(state), [state]);
  const geometry = { view, width };
  const x = (seconds: number) => timeToPixel(seconds, geometry);
  const at = (pixel: number) => pixelToTime(pixel, geometry);
  const markerAt = (pixel: number) => hitMarker(state.markers, pixel, geometry);
  const nearBoundary = (pixel: number, lane: TimelineLane, pointId?: string) =>
    hitBoundary(edges, pixel, lane, geometry, pointId);
  const underPointer = (seconds: number, lane: TimelineLane, pointId?: string) =>
    hitItem(all, seconds, lane, pointId);

  useEffect(() => {
    const element = surface.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) =>
      setWidth(Math.max(1, entry.contentRect.width)),
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const element = surface.current;
    if (!element) return;
    function wheel(event: WheelEvent) {
      const current = viewRef.current;
      const bounds = element!.getBoundingClientRect();
      const secondsPerPixel = current.span / bounds.width;
      event.preventDefault();
      if (event.ctrlKey || event.metaKey) {
        onView(
          zoomView(
            current,
            Math.exp(event.deltaY * 0.003),
            current.from + (event.clientX - bounds.left) * secondsPerPixel,
            duration,
          ),
        );
      } else {
        const delta =
          Math.abs(event.deltaX) > Math.abs(event.deltaY)
            ? event.deltaX
            : event.deltaY;
        onView(
          clampView(
            { ...current, from: current.from + delta * secondsPerPixel },
            duration,
          ),
        );
      }
    }
    element.addEventListener('wheel', wheel, { passive: false });
    return () => element.removeEventListener('wheel', wheel);
  }, [duration, onView]);

  function move(pixel: number, current = viewRef.current) {
    const active = dragRef.current;
    const seconds = current.from + pixel * (current.span / width);
    if (active?.kind === 'scrub')
      events.onScrub(Math.min(Math.max(0, seconds), duration), 'move');
    if (active?.kind !== 'boundary') return;
    const position = boundaryDragPosition({
      state,
      duration,
      edges,
      drag: active,
      pixel,
      geometry: { view: current, width },
      linked,
      snapping,
      unlinked: pointer.current.alt,
      suppressSnap: pointer.current.mod,
    });
    if (!position) return;

    const boundary = active.boundary;
    const name =
      all.find((item) => item.id === boundary.id)?.title ?? boundary.id;
    const edgeName = `${boundary.edge === 'end' ? 'End' : boundary.lane === 'point' ? 'Time' : 'Start'} of “${name}”`;
    const delta = position.time - active.origin;
    setDragState({
      ...active,
      moved: true,
      time: position.time,
      snapped: position.snapped,
      label: `${edgeName} · ${formatClock(position.time)} (${delta >= 0 ? '+' : '−'}${Math.abs(delta).toFixed(1)} s)`,
    });
    events.onBoundaryMove({
      boundary,
      time: position.time,
      unlinked: pointer.current.alt,
    });
  }

  useEffect(() => {
    if (
      !drag ||
      drag.kind === 'overview-move' ||
      drag.kind === 'overview-edge' ||
      (drag.kind === 'boundary' && !drag.moved)
    )
      return;
    let frame = 0;
    function tick() {
      const current = viewRef.current;
      const next = edgeScrollView(
        pointer.current.x,
        { view: current, width },
        duration,
      );
      if (next.from !== current.from) {
        onView(next);
        move(pointer.current.x, next);
      }
      frame = requestAnimationFrame(tick);
    }
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  });

  useEffect(() => {
    if (drag?.kind !== 'boundary') return;
    function key(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.stopPropagation();
        setDragState(undefined);
        events.onBoundaryCancel();
      }
    }
    window.addEventListener('keydown', key, true);
    return () => window.removeEventListener('keydown', key, true);
  }, [drag?.kind, events.onBoundaryCancel]);

  function laneOf(clientY: number): TimelineLane {
    const left = surface.current!.getBoundingClientRect().left + 1;
    const target = document
      .elementsFromPoint(left, clientY)
      .find((element) => (element as HTMLElement).dataset?.lane);
    return (
      ((target as HTMLElement | undefined)?.dataset.lane as TimelineLane) ??
      'ruler'
    );
  }

  function pointOf(target: EventTarget | null): string | undefined {
    return target instanceof Element
      ? target.closest<HTMLElement>('[data-point]')?.dataset.point
      : undefined;
  }

  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    const pixel =
      event.clientX - event.currentTarget.getBoundingClientRect().left;
    const lane = laneOf(event.clientY);
    pointer.current = {
      x: pixel,
      alt: event.altKey,
      mod: isMac() ? event.metaKey : event.ctrlKey,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    const marker = lane === 'marks' ? markerAt(pixel) : undefined;
    if (marker) {
      setHover(undefined);
      events.onSelectMarker(marker);
      return;
    }
    const pointId = pointOf(event.target);
    const boundary = nearBoundary(pixel, lane, pointId);
    if (boundary) {
      const item = all.find((item) => item.id === boundary.id);
      if (item) events.onSelect(item);
      setDragState({
        kind: 'boundary',
        boundary,
        origin: boundary.time,
        pointerStart: pixel,
        grab: at(pixel) - boundary.time,
        moved: false,
        playhead: time,
        time: boundary.time,
        label: '',
      });
      return;
    }
    const seconds = Math.min(Math.max(0, at(pixel)), duration);
    const item = underPointer(seconds, lane, pointId);
    if (item) {
      events.onSelect(item);
      return;
    }
    setDragState({ kind: 'scrub' });
    events.onScrub(seconds, 'start');
  }
  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    const pixel =
      event.clientX - event.currentTarget.getBoundingClientRect().left;
    pointer.current = {
      x: pixel,
      alt: event.altKey,
      mod: isMac() ? event.metaKey : event.ctrlKey,
    };
    if (dragRef.current) {
      move(pixel);
      return;
    }
    const lane = laneOf(event.clientY);
    const pointId = pointOf(event.target);
    setHover({
      x: pixel,
      lane,
      pointId,
      boundary: nearBoundary(pixel, lane, pointId),
    });
  }
  function onPointerUp(event: PointerEvent<HTMLDivElement>) {
    const active = dragRef.current;
    setDragState(undefined);
    if (active?.kind === 'scrub')
      events.onScrub(
        Math.min(
          Math.max(
            0,
            at(
              event.clientX - event.currentTarget.getBoundingClientRect().left,
            ),
          ),
          duration,
        ),
        'end',
      );
    if (active?.kind === 'boundary') {
      if (active.moved && active.time !== active.origin)
        events.onBoundaryCommit();
      else events.onBoundaryCancel();
    }
  }
  function onDoubleClick(event: MouseEvent<HTMLDivElement>) {
    const pixel =
      event.clientX - event.currentTarget.getBoundingClientRect().left;
    const lane = laneOf(event.clientY);
    if (lane === 'marks') {
      if (!markerAt(pixel))
        events.onAddMarker(Math.min(Math.max(0, at(pixel)), duration));
      return;
    }
    if (lane === 'point') {
      // Pointer capture retargets clicks to the surface; recover the diamond at the click.
      const pointId = pointOf(
        document.elementFromPoint(event.clientX, event.clientY),
      );
      const point = underPointer(at(pixel), lane, pointId);
      if (point) events.onRename(point);
      return;
    }
    if (lane === 'ruler' || nearBoundary(pixel, lane)) return;
    const seconds = at(pixel);
    const item = underPointer(seconds, lane);
    if (item) events.onRename(item);
    else events.onAdd(lane, seconds);
  }
  function onContextMenu(event: MouseEvent<HTMLDivElement>) {
    event.preventDefault();
    if (dragRef.current) return;
    const pixel =
      event.clientX - event.currentTarget.getBoundingClientRect().left;
    const lane = laneOf(event.clientY);
    const seconds = Math.min(Math.max(0, at(pixel)), duration);
    const pointId = pointOf(event.target);
    const boundary = nearBoundary(pixel, lane, pointId);
    const item = underPointer(seconds, lane, pointId);
    setHover(undefined);
    events.onContextMenu({
      x: event.clientX,
      y: event.clientY,
      time: seconds,
      lane,
      item,
      boundary,
      marker: lane === 'marks' ? markerAt(pixel) : undefined,
    });
  }
  function onOverviewDown(event: PointerEvent<HTMLDivElement>) {
    const pixel =
      event.clientX - event.currentTarget.getBoundingClientRect().left;
    event.currentTarget.setPointerCapture(event.pointerId);
    const start = (Math.max(0, view.from) / duration) * width;
    const end = (Math.min(duration, view.from + view.span) / duration) * width;
    if (Math.abs(pixel - start) <= 6)
      setDragState({ kind: 'overview-edge', edge: 'start' });
    else if (Math.abs(pixel - end) <= 6)
      setDragState({ kind: 'overview-edge', edge: 'end' });
    else if (pixel > start && pixel < end)
      setDragState({
        kind: 'overview-move',
        grab: (pixel / width) * duration - view.from,
      });
    else {
      onView(
        clampView(
          { ...view, from: (pixel / width) * duration - view.span / 2 },
          duration,
        ),
      );
      setDragState({ kind: 'overview-move', grab: view.span / 2 });
    }
  }
  function onOverviewMove(event: PointerEvent<HTMLDivElement>) {
    const active = dragRef.current;
    const seconds =
      ((event.clientX - event.currentTarget.getBoundingClientRect().left) /
        width) *
      duration;
    if (active?.kind === 'overview-move')
      onView(clampView({ ...view, from: seconds - active.grab }, duration));
    if (active?.kind === 'overview-edge') {
      const end = view.from + view.span;
      onView(
        clampView(
          active.edge === 'start'
            ? { from: seconds, span: end - seconds }
            : { from: view.from, span: seconds - view.from },
          duration,
        ),
      );
    }
  }

  return {
    surface,
    overview,
    width,
    hover,
    drag,
    all,
    x,
    at,
    markerAt,
    underPointer,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onDoubleClick,
    onContextMenu,
    onOverviewDown,
    onOverviewMove,
    onOverviewUp: () => setDragState(undefined),
    onPointerLeave: () => {
      if (!dragRef.current) setHover(undefined);
    },
  };
}
