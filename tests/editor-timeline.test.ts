import { describe, expect, it } from 'vitest';
import { clampView, fitView, MIN_SPAN, pointRows, POINT_TARGET, revealTime, zoomView } from '../site/lib/timeline-view';

describe('timeline view', () => {
  it('fits the whole video with a little room at each end', () => {
    const view = fitView(1000);
    expect(view.from).toBeLessThan(0);
    expect(view.from + view.span).toBeGreaterThan(1000);
  });
  it('zooms around an anchor and never below the minimum span', () => {
    const zoomed = zoomView({ from: 0, span: 1000 }, 0.5, 400, 1000);
    expect(zoomed.span).toBe(500);
    expect(400 - zoomed.from).toBeCloseTo((400 - 0) * 0.5);
    expect(zoomView({ from: 0, span: 20 }, 0.1, 10, 1000).span).toBe(MIN_SPAN);
  });
  it('keeps half a view of room past either end and no more', () => {
    expect(clampView({ from: -900, span: 100 }, 1000).from).toBe(-50);
    expect(clampView({ from: 5000, span: 100 }, 1000).from).toBe(950);
  });
  it('reveals an off-screen playhead only when zoomed in', () => {
    expect(revealTime(fitView(1000), 900, 1000)).toEqual(fitView(1000));
    expect(revealTime({ from: 0, span: 100 }, 50, 1000)).toEqual({ from: 0, span: 100 });
    expect(revealTime({ from: 0, span: 100 }, 500, 1000)).toEqual({ from: 450, span: 100 });
  });
});

describe('timeline point targets', () => {
  const points = [{ id: 'later', start: 182 }, { id: 'parent', start: 100 }, { id: 'child', start: 100 }, { id: 'nearby', start: 101 }];
  it('gives coincident and dense points non-overlapping targets at every viewport width', () => {
    for (const width of [300, 750, 1600]) {
      const view = { from: 0, span: 6000 }, layout = pointRows(points, view, width);
      expect(layout.rows.size).toBe(points.length);
      for (const a of points) for (const b of points) {
        if (a.id !== b.id && layout.rows.get(a.id) === layout.rows.get(b.id)) {
          expect(Math.abs(a.start - b.start) * width / view.span).toBeGreaterThanOrEqual(POINT_TARGET);
        }
      }
    }
  });
  it('reuses rows as zoom separates times but keeps exact coincidences separate', () => {
    const layout = pointRows(points, { from: 90, span: 100 }, 1000);
    expect(layout.rows.get('parent')).not.toBe(layout.rows.get('child'));
    expect(layout.rows.get('parent')).toBe(layout.rows.get('later'));
    expect(pointRows(points, { from: 500, span: 100 }, 1000).rows.size).toBe(0);
  });
});
