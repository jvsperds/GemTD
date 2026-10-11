import { expect, test } from 'vitest';
import { pinGlow } from '../src/book';
import type { Tower } from '../src/sim/towers';

test('pinned recipe: owned ingredients glow as working, then as ready once it can be built', () => {
  const gem = (type: string) => ({ def: { type, quality: 1, name: type + 1 } }) as unknown as Tower;
  const [b, y, d, r] = ['B', 'Y', 'D', 'R'].map(gem);
  const none = () => [];
  // Silver = B1 + Y1 + D1
  expect(pinGlow(['Silver'], [b, y, r], none)).toEqual({ ready: [], working: [b, y] });
  expect(pinGlow([], [b, y, r], none)).toEqual({ ready: [], working: [] });
  const all = [b, y, d, r];
  const built = (t: Tower) => (t === r ? [] : [{ name: 'Silver', parts: [b, y, d] }]);
  expect(pinGlow(['Silver'], all, built)).toEqual({ ready: [b, y, d], working: [] });
  expect(pinGlow(['Malachite'], all, built).ready).toEqual([]); // ready, but not the pinned one
});
