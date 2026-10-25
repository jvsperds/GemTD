import { expect, test } from 'vitest';
import { pinGlow, placementGlow } from '../src/book';
import type { Tower } from '../src/sim/towers';
import { DEFS } from '../src/sim/setup';

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

test('tower placement helper matches ingredients only in their assigned cell', () => {
  const tower = (code: string, c = 10, r = 10) => ({ def: DEFS[code], c, r }) as Tower;
  const plan = [{ c: 10, r: 10, code: 'Ehome' }];
  const ingredient = tower('E3');
  expect(placementGlow(plan, [ingredient])).toEqual({ working: [ingredient], complete: [] });
  expect(placementGlow(plan, [tower('E3', 11), tower('B3')])).toEqual({
    working: [],
    complete: [],
  });
  const completed = tower('Ehome');
  expect(placementGlow(plan, [completed])).toEqual({ working: [], complete: [completed] });
  expect(placementGlow([], [ingredient])).toEqual({ working: [], complete: [] });
  expect(placementGlow([{ c: 10, r: 10, code: 'unknown' }], [ingredient]).working).toEqual([]);
});

test('tower placement helper follows nested recipes, Ancient gems and merges', () => {
  const match = (target: string, part: string) => {
    const tower = { def: DEFS[part], c: 1, r: 1 } as Tower;
    return placementGlow([{ c: 1, r: 1, code: target }], [tower]).working.length === 1;
  };
  expect(match('Kyparium Core', 'Depleted-Kyparium')).toBe(true);
  expect(match('Kyparium Core', 'Q7')).toBe(true);
  expect(match('Kyparium Core', 'Q6')).toBe(true);
  expect(match('Q7', 'Q1')).toBe(true);
  expect(match('Q7', 'R6')).toBe(false);
  expect(match('Ehome', 'E6')).toBe(false);
  expect(match('Carmen-Lucia', 'Deepsea Pearl')).toBe(true);
  expect(match('The Singularity', 'Obsidian')).toBe(true);
});

test('tower placement helper searches alternative recipes and stops cyclic branches', () => {
  DEFS['Test recipe'] = {
    ...DEFS.Ehome,
    recipes: [['Test recipe'], ['B2']],
  } as (typeof DEFS)[string];
  try {
    const tower = { def: DEFS.B1, c: 1, r: 1 } as Tower;
    expect(placementGlow([{ c: 1, r: 1, code: 'Test recipe' }], [tower]).working).toEqual([tower]);
    tower.def = DEFS.R1;
    expect(placementGlow([{ c: 1, r: 1, code: 'Test recipe' }], [tower]).working).toEqual([]);
  } finally {
    delete DEFS['Test recipe'];
  }
});
