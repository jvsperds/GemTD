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
    const passes = route!.map((f, s) =>
      m.walk(f, m.waypoints[s]).some(([c, r]) => Math.max(Math.abs(c - 18), Math.abs(r - 18)) <= 2),
    );
    expect(passes).toEqual([true, true, true, true, true, true]);
    // Much longer than the empty map's 114.
    expect(m.segmentLengths(route!).reduce((a, b) => a + b)).toBeGreaterThan(300);
  });
}
