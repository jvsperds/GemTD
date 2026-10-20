import { expect, test } from 'vitest';
import map from '../data/map.json';
import { GUIDES } from '../src/guide';
import { Maze, OPEN, ROCK, type MapData } from '../src/sim/maze';
import { DEFS } from '../src/sim/setup';

/** Lay out a guide at once; '.' clears preset stones, as the builder does. */
function build(rows: string[]) {
  const m = new Maze(map as unknown as MapData);
  rows.forEach((row, r) =>
    [...row].forEach((ch, c) => {
      if (!m.noBuild[m.idx(c, r)]) m.cells[m.idx(c, r)] = ch === '.' ? OPEN : ROCK;
    }),
  );
  return m;
}

test('Almond-6 pass: valid maze and all 6 legs pass the middle', () => {
  const m = build(GUIDES.find((g) => g.name === 'Almond-6 pass')!.rows);
  const route = m.route();
  expect(route).not.toBeNull();
  expect(m.middlePasses(route!)).toBe(6);
});

test.each(GUIDES)('$name: valid maze', ({ name, rows }) => {
  const m = build(rows);
  const route = m.route();
  expect(route).not.toBeNull();
  if (name.startsWith('Almond')) expect(m.middlePasses(route!)).toBe(6);
});

test('empty map: only the two axis legs cross the middle', () => {
  const m = build([]);
  expect(m.middlePasses(m.route()!)).toBe(2);
});

test.each(GUIDES)(
  '$name: tower plan uses distinct buildable guide stones and known towers',
  (guide) => {
    const m = build(guide.rows);
    const plan = guide.towers!;
    expect(plan).toHaveLength(25);
    expect(new Set(plan.map((p) => m.idx(p.c, p.r))).size).toBe(plan.length);
    for (const p of plan) {
      expect(DEFS[p.code]).toBeDefined();
      expect(p.c).toBeGreaterThanOrEqual(0);
      expect(p.r).toBeGreaterThanOrEqual(0);
      expect(p.c).toBeLessThan(m.w);
      expect(p.r).toBeLessThan(m.h);
      expect(m.cells[m.idx(p.c, p.r)]).toBe(ROCK);
      expect(m.noBuild[m.idx(p.c, p.r)]).toBe(0);
    }
  },
);
