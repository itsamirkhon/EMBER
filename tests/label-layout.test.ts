import { expect, it } from 'vitest';
import { placeLabel, overlaps } from '../src/ui/v3/labelLayout';
it('moves a label off the headline while keeping it inside the viewport', () => {
  const protectedRect = { x: 24, y: 56, width: 520, height: 460 };
  const rect = placeLabel({ x: 469, y: 175, width: 250, height: 42 }, 1138, 780, [protectedRect]);
  expect(rect).not.toBeNull();
  expect(overlaps(rect!, protectedRect)).toBe(false);
  expect(rect!.x).toBeGreaterThanOrEqual(8);
  expect(rect!.x + rect!.width).toBeLessThanOrEqual(1130);
});
it('declines a label when every available region is occupied', () => {
  expect(placeLabel({ x: 20, y: 20, width: 80, height: 40 }, 100, 100, [{ x: 0, y: 0, width: 100, height: 100 }])).toBeNull();
});
it('accounts for different label heights and avoids previous labels', () => {
  const prior = { x: 560, y: 180, width: 200, height: 70 };
  const rect = placeLabel({ x: 560, y: 200, width: 150, height: 34 }, 1138, 780, [prior]);
  expect(rect).not.toBeNull();
  expect(overlaps(rect!, prior)).toBe(false);
});
