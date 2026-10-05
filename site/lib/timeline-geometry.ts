/** Numeric timeline geometry. No DOM, React state, or playback side effects. */
import {
  edgeLimits,
  snapTime,
  type Edge,
  type EditorItem,
  type EditorMarker,
  type EditorState,
  type Lane,
} from './recording-editor';
import { clampView, type TimelineView } from './timeline-view';

export type TimelineLane = 'ruler' | 'marks' | Lane;
export interface TimelineGeometry {
  view: TimelineView;
  width: number;
}
export interface BoundaryDrag {
  kind: 'boundary';
  boundary: Edge;
  origin: number;
  pointerStart: number;
  grab: number;
  moved: boolean;
  playhead: number;
  time: number;
  snapped?: number;
  label: string;
}
export interface BoundaryMove {
  boundary: Edge;
  time: number;
  unlinked: boolean;
}
export interface TimelineContext {
  x: number;
  y: number;
  time: number;
  lane: TimelineLane;
  item?: EditorItem;
  boundary?: Edge;
  marker?: EditorMarker;
}

export function timeToPixel(
  seconds: number,
  { view, width }: TimelineGeometry,
): number {
  return (seconds - view.from) * (width / view.span);
}
export function pixelToTime(
  pixel: number,
  { view, width }: TimelineGeometry,
): number {
  return view.from + pixel / (width / view.span);
}

export function hitMarker(
  markers: readonly EditorMarker[],
  pixel: number,
  geometry: TimelineGeometry,
): EditorMarker | undefined {
  return markers
    .map((marker) => ({
      marker,
      distance: Math.abs(pixel - timeToPixel(marker.at, geometry)),
    }))
    .filter((hit) => hit.distance <= 10)
    .sort((a, b) => a.distance - b.distance)[0]?.marker;
}

export function hitBoundary(
  edges: readonly Edge[],
  pixel: number,
  lane: TimelineLane,
  geometry: TimelineGeometry,
  pointId?: string,
): Edge | undefined {
  if (lane === 'ruler' || lane === 'marks') return;
  // Stacked diamonds can share a time: the DOM target identifies their row.
  if (lane === 'point')
    return edges.find((edge) => edge.lane === 'point' && edge.id === pointId);
  return edges
    .filter(
      (edge) =>
        edge.lane === lane &&
        Math.abs(timeToPixel(edge.time, geometry) - pixel) <= 7,
    )
    .sort(
      (a, b) =>
        Math.abs(timeToPixel(a.time, geometry) - pixel) -
        Math.abs(timeToPixel(b.time, geometry) - pixel),
    )[0];
}

export function hitItem(
  items: readonly EditorItem[],
  seconds: number,
  lane: TimelineLane,
  pointId?: string,
): EditorItem | undefined {
  if (lane === 'ruler' || lane === 'marks') return;
  const candidates = items.filter((item) => item.lane === lane);
  if (lane === 'point') {
    return candidates.find((item) => item.id === pointId);
  }
  return candidates
    .filter((item) => item.start <= seconds && seconds < item.end)
    .at(-1);
}

/** Dead zone → preserve grab offset → constrain the whole linked movement → snap. */
export function boundaryDragPosition(input: {
  state: EditorState;
  duration: number;
  edges: readonly Edge[];
  drag: BoundaryDrag;
  pixel: number;
  geometry: TimelineGeometry;
  linked: boolean;
  snapping: boolean;
  unlinked: boolean;
  suppressSnap: boolean;
}): { time: number; snapped?: number } | undefined {
  const { state, duration, edges, drag, pixel, geometry } = input;
  if (!drag.moved && Math.abs(pixel - drag.pointerStart) < 4) return;
  const secondsPerPixel = geometry.view.span / geometry.width;
  const seconds = geometry.view.from + pixel * secondsPerPixel;
  const [low, high] = edgeLimits(
    state,
    duration,
    drag.boundary,
    input.linked && !input.unlinked,
  );
  const time = Math.min(Math.max(seconds - drag.grab, low), high);
  if (!input.snapping || input.suppressSnap) return { time };

  const candidates = [
    drag.playhead,
    0,
    duration,
    ...edges
      .filter((edge) => Math.abs(edge.time - drag.origin) > 0.005)
      .map((edge) => edge.time),
  ].filter((value) => Number.isFinite(value) && value >= low && value <= high);
  return snapTime(time, candidates, 9 * secondsPerPixel);
}

export function edgeScrollView(
  pixel: number,
  { view, width }: TimelineGeometry,
  duration: number,
): TimelineView {
  const margin = 28;
  const speed =
    pixel < margin
      ? -(margin - pixel)
      : pixel > width - margin
        ? pixel - (width - margin)
        : 0;
  if (!speed) return view;
  return clampView(
    { ...view, from: view.from + (speed * 0.02 * view.span) / width },
    duration,
  );
}
