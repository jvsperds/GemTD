import { expect, test } from 'vitest';
import map from '../data/map.json';
import { GUIDES } from '../src/guide';
import { Maze, ROCK, type MapData } from '../src/sim/maze';

/** Build every marked stone of a guide at once. */
function build(rows: string[]) {
  const m = new Maze(map as unknown as MapData);
  rows.forEach((row, r) =>
    [...row].forEach((ch, c) => {
      if (ch !== '.' && !m.noBuild[m.idx(c, r)]) m.cells[m.idx(c, r)] = ROCK;
    }),
  );
  return m;
}

for (const name of ['Spiral L', 'Spiral S']) {
  test(`${name}: valid maze and all 6 legs pass the middle`, () => {
    const m = build(GUIDES.find((g) => g.name === name)!.rows);
    const route = m.route();
    expect(route).not.toBeNull();
    expect(m.middlePasses(route!, 2)).toBe(6); // every leg crosses the very centre
    // Much longer than the empty map's 114.
    expect(m.segmentLengths(route!).reduce((a, b) => a + b)).toBeGreaterThan(300);
  });
}

test('Shakalaka: valid maze', () => {
  const m = build(GUIDES.find((g) => g.name === 'Shakalaka')!.rows);
  const route = m.route();
  expect(route).not.toBeNull();
  // ponytail: 3 of 6 legs as transcribed; raise to 6 once the outer walls are confirmed.
  expect(m.middlePasses(route!)).toBe(3);
});

test('empty map: only the two axis legs cross the middle', () => {
  const m = build([]);
  expect(m.middlePasses(m.route()!)).toBe(2);
});
