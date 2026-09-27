import { describe, expect, it } from 'vitest';
import { thumbnailChoice, thumbnailHash, thumbnailPattern } from '../site/lib/thumbnail';

describe('procedural thumbnails', () => {
  it('is stable for an ID and differs across IDs', () => {
    expect(thumbnailPattern('ZTDYIJUDb0M')).toBe(thumbnailPattern('ZTDYIJUDb0M'));
    expect(thumbnailHash('ZTDYIJUDb0M')).toBe(thumbnailHash('ZTDYIJUDb0M'));
    const patterns = new Set(Array.from({ length: 50 }, (_, i) => thumbnailPattern(`video-${i}`)));
    expect(patterns.size).toBeGreaterThan(10);
  });
  it('reaches every design and curated colourway, and uses only the designed colours', () => {
    const seen = new Set<string>(), colours = new Set<string>();
    for (let i = 0; i < 5000; i++) {
      const id = `id-${i}`, choice = thumbnailChoice(id);
      seen.add(`${choice.design}.${choice.colourway}`);
      for (const [, colour] of thumbnailPattern(id).matchAll(/fill="(#[0-9A-F]{6})"/g)) colours.add(colour);
    }
    expect(seen.size).toBe(18);
    expect([...colours].sort()).toEqual(['#000000', '#23A7DA', '#273469', '#4A00FF', '#6C0000', '#E4D9FF', '#FFFFFF']);
  });
  it('builds a thousand thumbnails well within a second', () => {
    const start = performance.now();
    for (let i = 0; i < 1000; i++) thumbnailPattern(`bench-${i}`);
    expect(performance.now() - start).toBeLessThan(250);
  });
});
