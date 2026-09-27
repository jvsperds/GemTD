import { expect, test } from 'vitest';
import { data } from '../src/data';

test('game data loads with expected shape', () => {
  expect(data.gems).toHaveLength(48);
  expect(data.waves.map((w) => w.wave)).toEqual(Array.from({ length: 50 }, (_, i) => i + 1));
  expect(data.map.width).toBe(37);
  expect(data.levels.levels).toHaveLength(9);
});
