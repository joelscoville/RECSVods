/** The timeline's visible window and its zoom/scroll arithmetic, kept apart from the component so
 * hot reload works and the maths is unit-testable. */
/** The visible stretch of the video: `span` seconds starting at `from` (which may be negative: there is
 * always room to scroll the start and end of the video towards the middle). */
export interface TimelineView { from: number; span: number }
export const MIN_SPAN = 10;
export const POINT_TARGET = 24, POINT_ROW = 28;
/** Stack overlapping hit targets vertically; their horizontal position remains the exact time. */
export function pointRows(points: { id: string; start: number }[], view: TimelineView, width: number) {
  const ends: number[] = [], rows = new Map<string, number>();
  for (const point of [...points].sort((a, b) => a.start - b.start)) {
    const left = (point.start - view.from) * width / view.span;
    if (left < -POINT_TARGET / 2 || left > width + POINT_TARGET / 2) continue;
    let row = ends.findIndex(end => left - end >= POINT_TARGET + 2);
    if (row === -1) row = ends.length;
    ends[row] = left;
    rows.set(point.id, row);
  }
  return { rows, height: Math.max(46, ends.length * POINT_ROW + 8), count: ends.length };
}
export function fitView(duration: number): TimelineView { return { from: -duration * 0.015, span: duration * 1.03 }; }
export function clampView(view: TimelineView, duration: number): TimelineView {
  const span = Math.min(Math.max(view.span, MIN_SPAN), duration * 1.5 + MIN_SPAN);
  return { span, from: Math.min(Math.max(view.from, -span / 2), duration - span / 2) };
}
/** Zooms by `factor` (<1 zooms in) keeping `anchor` at the same place on screen. */
export function zoomView(view: TimelineView, factor: number, anchor: number, duration: number): TimelineView {
  const span = view.span * factor;
  return clampView({ span, from: anchor - (anchor - view.from) * (span / view.span) }, duration);
}
/** Keeps a time on screen, centring it when it has left the view. */
export function revealTime(view: TimelineView, time: number, duration: number, margin = 0.03): TimelineView {
  if (view.span >= duration || (time >= view.from + view.span * margin && time <= view.from + view.span * (1 - margin))) return view;
  return clampView({ ...view, from: time - view.span / 2 }, duration);
}
