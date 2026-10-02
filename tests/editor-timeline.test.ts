import { describe, expect, it } from 'vitest';
import { clampView, fitView, MIN_SPAN, revealTime, zoomView } from '../site/lib/timeline-view';

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
