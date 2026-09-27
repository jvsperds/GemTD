import { expect, test } from 'vitest';
import gems from '../data/gems.json';
import towers from '../data/towers.json';
import waves from '../data/waves.json';

test('game data is built and importable', () => {
  expect(Object.keys(gems)).toHaveLength(48);
  expect(Object.keys(towers).length).toBeGreaterThan(40);
  expect(new Set(waves.map((w) => w.wave)).size).toBe(50);
});
