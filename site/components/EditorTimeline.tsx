import { useMemo } from 'react';
import {
  formatClock,
  isFileMarker,
  type Edge,
  type EditorItem,
  type EditorMarker,
  type EditorState,
  type Lane,
} from '../lib/recording-editor';
import type { TimelineView } from '../lib/timeline-view';
import {
  useTimelineInteraction,
  type TimelineEvents,
} from './use-timeline-interaction';
export type { BoundaryMove, TimelineContext } from '../lib/timeline-geometry';

const STEPS = [
  0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600,
];
const LANES: Lane[] = ['chapter', 'subchapter', 'point'];

interface EditorTimelineProps extends TimelineEvents {
  state: EditorState;
  duration: number;
  time: number;
  view: TimelineView;
  onView: (view: TimelineView) => void;
  snapping: boolean;
  linked: boolean;
  selectedId?: string;
  activeBoundary?: Edge;
  changed: Set<string>;
  failing: Set<string>;
  selectedMarkerId?: string;
}

/** Draws the timeline; pointer/DOM ownership is isolated in useTimelineInteraction. */
export default function EditorTimeline({
  state,
  duration,
  time,
  view,
  onView,
  snapping,
  linked,
  selectedId,
  activeBoundary,
  changed,
  failing,
  selectedMarkerId,
  ...events
}: EditorTimelineProps) {
  const interaction = useTimelineInteraction({
    state,
    duration,
    time,
    view,
    onView,
    snapping,
    linked,
    events,
  });
  const {
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
  } = interaction;
  const lanes = useMemo(
    () =>
      Object.fromEntries(
        LANES.map((lane) => [lane, all.filter((item) => item.lane === lane)]),
      ) as Record<Lane, EditorItem[]>,
    [all],
  );
  const markers = state.markers;
  const markerClass = (marker: EditorMarker) =>
    [
      !isFileMarker(marker) && 'is-mine',
      !isFileMarker(marker) && !marker.include && 'is-private',
      marker.id === selectedMarkerId && 'is-selected',
    ]
      .filter(Boolean)
      .join(' ');

  // Ruler: labels at least 90 px apart, minor ticks between.
  const pixelsPerSecond = width / view.span;
  const step = STEPS.find((value) => value * pixelsPerSecond >= 90) ?? 3600;
  const minor = step / (step * pixelsPerSecond >= 180 ? 10 : 5);
  const ticks: { t: number; major: boolean }[] = [];
  for (
    let t = Math.ceil(Math.max(0, view.from) / minor) * minor;
    t <= Math.min(duration, view.from + view.span) + 1e-9;
    t += minor
  ) {
    ticks.push({ t, major: Math.abs(t / step - Math.round(t / step)) < 1e-6 });
  }
  const block = (item: EditorItem) => {
    const left = x(item.start),
      right = x(item.end);
    if (right < -2 || left > width + 2) return null;
    const blockWidth = Math.max(2, right - left);
    const labelOffset = Math.max(0, -left);
    const classes = [
      'tl-block',
      `tl-${item.group}`,
      item.id === selectedId && 'is-selected',
      changed.has(item.id) && 'is-changed',
      failing.has(item.id) && 'is-failing',
      state.checked.includes(item.id) && 'is-checked',
    ]
      .filter(Boolean)
      .join(' ');
    return (
      <div
        key={item.id}
        className={classes}
        style={{ left, width: blockWidth }}
        title={`${item.title}\n${formatClock(item.start)}–${formatClock(item.end)}`}
      >
        {blockWidth - labelOffset > 26 && (
          <span className="tl-label" style={{ marginLeft: labelOffset }}>
            <span className="tl-title">{item.title}</span>
            {item.lane === 'chapter' && (
              <span className="tl-range">
                {formatClock(Math.round(item.start))}–
                {formatClock(Math.round(item.end))}
              </span>
            )}
          </span>
        )}
      </div>
    );
  };
  const diamond = (item: EditorItem) => {
    const left = x(item.start);
    if (left < -12 || left > width + 12) return null;
    return (
      <button
        key={item.id}
        data-point={item.id}
        type="button"
        className={`tl-point${item.id === selectedId ? ' is-selected' : ''}${failing.has(item.id) ? ' is-failing' : ''}`}
        style={{ left }}
        aria-label={`Description at ${formatClock(item.start)}`}
        title={`Go to ${formatClock(item.start)}. Drag to move the description's time.`}
        onClick={(event) => {
          if (event.detail === 0) events.onSelect(item);
        }}
        onKeyDown={(event) => {
          if (event.key === 'F2') {
            event.preventDefault();
            events.onRename(item);
          }
        }}
      >
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <path d="M8 1 15 8 8 15 1 8Z" />
        </svg>
      </button>
    );
  };

  const hoverTime =
    hover && !drag ? Math.min(Math.max(0, at(hover.x)), duration) : undefined;
  const hoverItem =
    hoverTime !== undefined && hover
      ? underPointer(hoverTime, hover.lane)
      : undefined;
  const dragBoundary = drag?.kind === 'boundary' ? drag : undefined;
  const hoverMarker =
    hover && !drag && hover.lane === 'marks' ? markerAt(hover.x) : undefined;
  const cursor =
    dragBoundary?.moved || (hover?.boundary && hover.lane !== 'point')
      ? 'ew-resize'
      : hoverItem || hoverMarker
        ? 'pointer'
        : 'default';
  const whole = (seconds: number) => (seconds / duration) * width;

  return (
    <div className="tl" aria-label="Timeline">
      <div className="tl-head">
        <span />
        <div
          className="tl-overview"
          ref={overview}
          onPointerDown={interaction.onOverviewDown}
          onPointerMove={interaction.onOverviewMove}
          onPointerUp={interaction.onOverviewUp}
          title="Whole recording. Drag the box to scroll, or its ends to zoom."
        >
          {lanes.chapter.map((item) => (
            <span
              key={item.id}
              className={`tl-mini tl-${item.group}`}
              style={{
                left: whole(item.start),
                width: Math.max(1, whole(item.end) - whole(item.start)),
              }}
            />
          ))}
          <span
            className="tl-mini-view"
            style={{
              left: whole(Math.max(0, view.from)),
              width: Math.max(
                8,
                whole(Math.min(duration, view.from + view.span)) -
                  whole(Math.max(0, view.from)),
              ),
            }}
          />
          <span className="tl-mini-playhead" style={{ left: whole(time) }} />
        </div>
      </div>
      <div className="tl-body">
        <div className="tl-headers" aria-hidden="true">
          <span className="tl-header-ruler" />
          <span className="tl-header" data-lane-label="marks">
            Markers
          </span>
          <span className="tl-header" data-lane-label="chapter">
            Chapters
          </span>
          <span className="tl-header" data-lane-label="subchapter">
            Subchapters
          </span>
          <span className="tl-header" data-lane-label="point">
            Descriptions
          </span>
          <span />
        </div>
        <div
          className="tl-surface"
          ref={surface}
          style={{ cursor }}
          onPointerDown={interaction.onPointerDown}
          onPointerMove={interaction.onPointerMove}
          onPointerUp={interaction.onPointerUp}
          onPointerLeave={interaction.onPointerLeave}
          onDoubleClick={interaction.onDoubleClick}
          onContextMenu={interaction.onContextMenu}
        >
          <div className="tl-ruler" data-lane="ruler">
            {ticks.map(({ t, major }) => (
              <span
                key={t.toFixed(3)}
                className={major ? 'tl-tick is-major' : 'tl-tick'}
                style={{ left: x(t) }}
              >
                {major && <span>{formatClock(t)}</span>}
              </span>
            ))}
          </div>
          <div className="tl-lane tl-lane-marks" data-lane="marks">
            {markers.map((marker) => {
              const left = x(marker.at);
              if (left < -12 || left > width + 12) return null;
              return (
                <div
                  key={marker.id}
                  className={`tl-marker ${markerClass(marker)}${marker.id === hoverMarker?.id ? ' is-hover' : ''}`}
                  style={{ left }}
                >
                  {marker.end !== undefined && (
                    <span
                      className="tl-marker-range"
                      style={{ width: Math.max(2, x(marker.end) - left) }}
                    />
                  )}
                  <svg
                    className="tl-marker-tab"
                    viewBox="0 0 16 22"
                    width="16"
                    height="22"
                    aria-hidden="true"
                  >
                    <path d="M1.5 1.5h13v12.2L8 20.5l-6.5-6.8z" />
                  </svg>
                </div>
              );
            })}
          </div>
          <div className="tl-lane" data-lane="chapter">
            {x(0) > 0 && (
              <div className="tl-outside" style={{ left: 0, width: x(0) }} />
            )}
            {x(duration) < width && (
              <div
                className="tl-outside"
                style={{ left: x(duration), width: width - x(duration) }}
              />
            )}
            {lanes.chapter.map(block)}
          </div>
          <div className="tl-lane tl-lane-sub" data-lane="subchapter">
            {lanes.subchapter.map(block)}
          </div>
          <div className="tl-lane tl-lane-sub" data-lane="point">
            {lanes.point.map(diamond)}
          </div>
          <div className="tl-filler" aria-hidden="true" />
          {markers.map(
            (marker) =>
              x(marker.at) >= -2 &&
              x(marker.at) <= width + 2 && (
                <div
                  key={marker.id}
                  className={`tl-marker-guide ${markerClass(marker)}`}
                  style={{ left: x(marker.at) }}
                />
              ),
          )}
          {activeBoundary && !dragBoundary && (
            <div
              className={`tl-boundary is-active tl-at-${activeBoundary.lane}`}
              style={{ left: x(activeBoundary.time) }}
            />
          )}
          {hover?.boundary && !drag && (
            <div
              className={`tl-boundary tl-at-${hover.boundary.lane}`}
              style={{ left: x(hover.boundary.time) }}
            />
          )}
          {dragBoundary && (
            <div
              className="tl-ghost"
              style={{ left: x(dragBoundary.playhead) }}
              title="Where the playhead was"
            />
          )}
          {dragBoundary && (
            <div
              className={`tl-boundary is-dragging tl-at-${dragBoundary.boundary.lane}${dragBoundary.snapped !== undefined ? ' is-snapped' : ''}`}
              style={{ left: x(dragBoundary.time) }}
            />
          )}
          {hoverTime !== undefined && (
            <div
              className="tl-hover"
              style={{ left: hoverMarker ? x(hoverMarker.at) : hover!.x }}
            >
              <span>
                {hoverMarker
                  ? `${formatClock(hoverMarker.at)}${hoverMarker.end !== undefined ? ` · ${formatClock(hoverMarker.end - hoverMarker.at)} long` : ''} · ${hoverMarker.note || 'No note yet'}`
                  : `${formatClock(hoverTime)}${hoverItem ? ` · ${hoverItem.title}` : ''}`}
              </span>
            </div>
          )}
          {dragBoundary?.label && (
            <div className="tl-readout" style={{ left: x(dragBoundary.time) }}>
              {dragBoundary.label}
              {dragBoundary.snapped !== undefined && <em> · snapped</em>}
            </div>
          )}
          {time >= view.from && time <= view.from + view.span && (
            <div className="tl-playhead" style={{ left: x(time) }}>
              <span className="tl-playhead-head" />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
