import { expect, test } from 'vitest';
import map from '../data/map.json';
import waves from '../data/waves.json';
import { Maze, type MapData } from '../src/sim/maze';
import {
  CASTLE_HP,
  CREEPS_PER_WAVE,
  ENDLESS,
  GIANT,
  WaveSim,
  type WaveEntry,
} from '../src/sim/waves';

const sim = () => new WaveSim(new Maze(map as unknown as MapData), waves as WaveEntry[]);

function runWave(s: WaveSim) {
  s.startWave();
  let ticks = 0;
  const seen = new Set<string>();
  while (s.phase === 'wave' && ticks++ < 30 * 600) {
    s.tick();
    for (const c of s.creeps) seen.add(`${Math.floor(c.x)},${Math.floor(c.y)}`);
  }
  return { ticks, seen };
}

test('ground wave walks the maze and every creep leaks', () => {
  const s = sim();
  const { ticks, seen } = runWave(s);
  expect(s.phase).toBe('build');
  expect(s.castleHp).toBe(CASTLE_HP - CREEPS_PER_WAVE);
  // Never on a wall, and passes every checkpoint.
  for (const k of seen) {
    const [c, r] = k.split(',').map(Number);
    expect(s.maze.walkable(c, r)).toBe(true);
  }
  for (const [c, r] of s.maze.waypoints) expect(seen.has(`${c},${r}`)).toBe(true);
  // Path 114 cells at 446.25/128 cells/s ≈ 33 s, plus 9 s of spawning.
  expect(ticks / 30).toBeGreaterThan(38);
  expect(ticks / 30).toBeLessThan(46);
});

test('rocks lengthen the ground route', () => {
  const a = sim();
  const b = sim();
  for (let c = 0; c <= 7; c++) expect(b.maze.placeRock(c, 10)).toBe(true);
  expect(runWave(b).ticks).toBeGreaterThan(runWave(a).ticks);
});

test('flying wave takes straight lines and ignores the maze', () => {
  const s = sim();
  for (let w = 0; w < 4; w++) runWave(s);
  const { ticks, seen } = runWave(s); // wave 5 is flying
  expect(s.wave).toBe(5);
  // Straight-line checkpoint legs total 14+28+14+14+28+14 = 112 cells at 425/128 cells/s ≈ 34 s.
  expect(ticks / 30).toBeLessThan(34 + 9 + 1);
  expect(
    [...seen].some((k) => !s.maze.walkable(...(k.split(',').map(Number) as [number, number]))),
  ).toBe(true);
});

test('castle falls → lost; killed creeps do not leak', () => {
  const s = sim();
  s.startWave();
  for (let i = 0; i < 30 * 60 && s.phase === 'wave'; i++) {
    s.tick();
    for (const c of s.creeps) s.damage(c, c.hp);
  }
  expect(s.castleHp).toBe(CASTLE_HP);
  while (s.phase === 'build' || s.phase === 'wave') runWave(s);
  expect(s.phase).toBe('lost');
});

test('endless: past the last wave, earlier waves return with scaled hp and armor', () => {
  const s = sim();
  s.wave = s.lastWave;
  s.startWave();
  expect(s.phase).toBe('wave');
  const cr = s.spawn(s['queue'][0]);
  const orig = (waves as WaveEntry[]).find((w) => w.wave === s.lastWave - 9)!;
  expect(cr.def.hp).toBeCloseTo(orig.hp * ENDLESS.hp);
  expect(cr.def.armor).toBe(orig.armor + ENDLESS.armor);
});

test('giant: 10x-HP creep only after a no-damage streak', () => {
  const s = sim();
  s.rand = () => 0;
  s.startWave();
  expect(s['queue'].some((d: { name: string }) => d.name.startsWith('Giant'))).toBe(false);
  s.phase = 'build';
  s.streak = GIANT.streak;
  s.startWave();
  const giants = s['queue'].filter((d: { name: string }) => d.name.startsWith('Giant'));
  expect(giants).toHaveLength(1);
  expect(giants[0].hp).toBe(s['queue'][1].hp * GIANT.hp);
});
