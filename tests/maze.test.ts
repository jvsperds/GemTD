import { expect, test } from 'vitest';
import map from '../data/map.json';
import { Maze, type MapData } from '../src/sim/maze';

const fresh = () => new Maze(map as unknown as MapData);

test('empty map reproduces the Maze Builder path fixture', () => {
  const m = fresh();
  const lengths = m.segmentLengths(m.route()!).map(Math.round);
  expect(lengths).toEqual(map.emptyMapPathFixture.segments);
  expect(lengths.reduce((a, b) => a + b)).toBe(map.emptyMapPathFixture.total);
});

test('walls, no-build zones and waypoints refuse rocks', () => {
  const m = fresh();
  expect(m.placeRock(18, 2)).toBe(false); // wall
  expect(m.placeRock(2, 2)).toBe(false); // spawn area
  expect(m.placeRock(18, 12)).toBe(true); // centre cross is buildable
  expect(m.placeRock(10, 10)).toBe(true);
  expect(m.placeRock(10, 10)).toBe(false); // occupied
  expect(m.removeRock(10, 10)).toBe(true);
});

test('a rock that would block the route is refused', () => {
  const m = fresh();
  // CP2 (32,18) sits in a wall line; its only exits are rows 17 and 19.
  for (const [c, r] of [
    [31, 17],
    [32, 17],
    [33, 17],
    [31, 19],
    [33, 19],
  ])
    expect(m.placeRock(c, r)).toBe(true);
  expect(m.segmentLengths(m.route()!)[1]).toBeGreaterThan(29); // detour
  expect(m.placeRock(32, 19)).toBe(false); // last exit
  expect(m.route()).not.toBeNull();
});

test('walk follows the field from start to goal', () => {
  const m = fresh();
  const f = m.route()!;
  const cells = m.walk(f[0], m.waypoints[0]);
  expect(cells.at(-1)).toEqual(m.waypoints[1]);
  expect(cells).toHaveLength(15);
});
