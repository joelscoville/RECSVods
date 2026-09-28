import { expect, it } from 'vitest';
import { thumbnailPattern } from '../site/lib/thumbnail';

it('builds a thousand thumbnails within 250ms on an otherwise idle machine', () => {
  const start = performance.now();
  for (let i = 0; i < 1000; i++) thumbnailPattern(`bench-${i}`);
  expect(performance.now() - start).toBeLessThan(250);
});
