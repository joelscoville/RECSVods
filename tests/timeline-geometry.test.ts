import { describe, expect, it } from 'vitest';
import {
  boundaryDragPosition,
  hitBoundary,
  hitItem,
  hitMarker,
  pixelToTime,
  timeToPixel,
  type BoundaryDrag,
} from '../site/lib/timeline-geometry';
import { edges, items } from '../site/lib/recording-editor';
import { boundaryState } from './editor-boundary-fixtures';

describe('timeline geometry', () => {
  const geometry = { view: { from: 0, span: 120 }, width: 1200 };
  const drag: BoundaryDrag = {
    kind: 'boundary',
    boundary: { lane: 'chapter', id: 'opening', edge: 'end', time: 50 },
    origin: 50,
    pointerStart: 510,
    grab: 1,
    moved: false,
    playhead: 54,
    time: 50,
    label: '',
  };
  function input() {
    const state = boundaryState();
    return {
      state,
      duration: 120,
      edges: edges(state),
      drag,
      pixel: 545,
      geometry,
      linked: true,
      snapping: true,
      unlinked: false,
      suppressSnap: false,
    };
  }

  it('maps pixels to time with pan and zoom, independently of the browser', () => {
    const zoomed = { view: { from: 100, span: 50 }, width: 500 };
    expect(pixelToTime(250, zoomed)).toBe(125);
    expect(timeToPixel(125, zoomed)).toBe(250);
  });

  it('respects the drag dead zone and preserves the initial grab offset', () => {
    expect(boundaryDragPosition({ ...input(), pixel: 513 })).toBeUndefined();
    expect(boundaryDragPosition({ ...input(), snapping: false })).toEqual({
      time: 53.5,
    });
    expect(boundaryDragPosition({ ...input(), suppressSnap: true })).toEqual({
      time: 53.5,
    });
  });

  it('snaps to a permitted playhead while carrying linked neighbours', () => {
    expect(boundaryDragPosition(input())).toEqual({ time: 54, snapped: 54 });
    expect(boundaryDragPosition({ ...input(), unlinked: true })).toEqual({
      time: 50,
    });
    expect(boundaryDragPosition({ ...input(), linked: false })).toEqual({
      time: 50,
    });
  });

  it('rejects a snap outside the limits imposed by a child or its point', () => {
    const candidate = input();
    candidate.state.subchapters[0].end = 40;
    candidate.state.points.push({
      id: 'near-edge',
      parentId: 'opening',
      time: 47,
      text: 'A fixed note',
    });
    // This point imposes a lower limit of 47.01. The nearby playhead and the
    // point itself are tempting snap targets, but both fall below that limit.
    const result = boundaryDragPosition({
      ...candidate,
      edges: edges(candidate.state),
      pixel: 482,
      drag: { ...drag, playhead: 47.005 },
    });
    expect(result?.time).toBeCloseTo(47.2);
    expect(result?.snapped).toBeUndefined();
  });

  it('keeps hit testing lane-specific and resolves shared times deterministically', () => {
    const state = boundaryState();
    expect(hitBoundary(edges(state), 507, 'chapter', geometry)?.id).toBe(
      'opening',
    );
    expect(
      hitBoundary(edges(state), 507.01, 'chapter', geometry),
    ).toBeUndefined();
    expect(hitBoundary(edges(state), 500, 'ruler', geometry)).toBeUndefined();
    expect(hitItem(items(state, 120), 50, 'chapter', geometry)?.id).toBe(
      'sermon',
    );
    expect(
      hitItem(items(state, 120), 120, 'chapter', geometry),
    ).toBeUndefined();
    expect(hitItem(items(state, 120), 20.5, 'point', geometry)?.id).toBe(
      'song-note',
    );
    const marker = { id: 'marker', at: 30, note: 'Check', include: false };
    expect(hitMarker([marker], 310, geometry)).toBe(marker);
    expect(hitMarker([marker], 310.1, geometry)).toBeUndefined();
  });
});
