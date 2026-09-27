import { expect, test } from 'vitest';
import gems from '../data/gems.json';
import map from '../data/map.json';
import quality from '../data/quality_levels.json';
import waves from '../data/waves.json';
import { DOWNGRADE_COST, Game, GEMS_PER_ROUND, type LevelDef } from '../src/sim/game';
import { Maze, ROCK, type MapData } from '../src/sim/maze';
import { Combat, type GemDef } from '../src/sim/towers';
import { WaveSim, type WaveEntry } from '../src/sim/waves';

const setup = (seed = 1) => {
  const sim = new WaveSim(new Maze(map as unknown as MapData), waves as WaveEntry[]);
  return new Game(
    new Combat(sim, gems as Record<string, GemDef>),
    quality.levels as LevelDef[],
    seed,
  );
};
const spots = [10, 12, 14, 16, 20].map((c) => [c, 10] as const);
const placeRound = (g: Game) => spots.map(([c, r]) => g.place(c, r)!);

test('five placements, then keep one: the rest become stones and the wave starts', () => {
  const g = setup();
  const ts = placeRound(g);
  expect(ts.every(Boolean)).toBe(true);
  expect(g.step).toBe('choose');
  expect(g.place(22, 10)).toBeNull(); // only 5 per round
  expect(ts.every((t) => t.def.quality === 1)).toBe(true); // level 1 = 100% chipped
  expect(g.keep(ts[2])).toBe(true);
  expect(g.combat.towers).toEqual([ts[2]]);
  for (const [c, r] of spots) expect(g.sim.maze.cells[g.sim.maze.idx(c, r)]).toBe(ROCK);
  expect(g.step).toBe('wave');
});

test('merge ^ and ^^ need 2 / 4 identical gems and add 1 / 2 quality', () => {
  const g = setup();
  const ts = placeRound(g);
  const d1 = g.combat.gems.D1;
  for (const t of ts.slice(0, 4)) t.def = d1;
  expect(g.canMerge(ts[4], 2)).toBe(ts[4].def === d1);
  expect(g.merge(ts[0], 4)).toBe(true);
  expect(ts[0].def.name).toBe('Normal Diamond');
  expect(g.combat.towers).toHaveLength(1);

  const h = setup();
  const us = placeRound(h);
  us[0].def = h.combat.gems.R1;
  us[1].def = h.combat.gems.R1;
  for (const t of us.slice(2)) t.def = h.combat.gems.G1;
  expect(h.merge(us[0], 4)).toBe(false);
  expect(h.merge(us[0], 2)).toBe(true);
  expect(us[0].def.name).toBe('Flawed Ruby');
});

test('downgrade costs gold and lowers quality; remove stone frees a rock', () => {
  const g = setup();
  const ts = placeRound(g);
  ts[0].def = g.combat.gems.Y5;
  expect(g.downgrade(ts[0])).toBe(false); // no gold
  g.gold = DOWNGRADE_COST;
  expect(g.downgrade(ts[0])).toBe(true);
  expect(ts[0].def.type).toBe('Y');
  expect(ts[0].def.quality).toBeLessThan(5);
  expect(g.gold).toBe(0);
  g.keep(ts[0]);
  expect(g.removeStone(...spots[1])).toBe(false); // not during a wave
  g.sim.phase = 'build';
  expect(g.removeStone(...spots[0])).toBe(false); // that's a tower
  expect(g.removeStone(...spots[1])).toBe(true);
});

test('kills give gold and XP; levels can be bought', () => {
  const g = setup();
  g.gold = 20;
  expect(g.buyLevel()).toBe(true);
  expect(g.level).toBe(2);
  expect(g.xp).toBe(g.xpFor[1]);
  expect(g.xpFor).toHaveLength(9);
  expect(g.xpFor.every((x, i) => !i || x > g.xpFor[i - 1])).toBe(true);
  g.xp = g.xpFor[4] - 1;
  g.sim.wave = 3;
  g.sim.onKill!({ def: { hp: 100, boss: false } } as never);
  expect(g.level).toBe(5);
  expect(g.gold).toBe(4);
});

test('a scripted player can play full rounds start to finish', () => {
  const g = setup(7);
  // Line both sides of the long row-18 leg.
  const cells = Array.from({ length: 54 }, (_, k) => [5 + (k >> 1), k & 1 ? 20 : 16] as const);
  while (g.step !== 'won' && g.step !== 'lost' && cells.length >= GEMS_PER_ROUND) {
    for (let k = 0; k < GEMS_PER_ROUND; k++) g.place(...cells.shift()!);
    const best = g.placed.reduce((a, b) => (b.def.quality > a.def.quality ? b : a));
    if (!g.merge(best, 2)) g.keep(best);
    while (g.gold >= (g.levelCost ?? Infinity)) g.buyLevel();
    for (let i = 0; g.sim.phase === 'wave' && i < 30 * 600; i++) {
      g.sim.tick();
      g.combat.tick();
    }
  }
  expect(g.sim.wave).toBeGreaterThan(3);
  expect(g.level).toBeGreaterThan(1);
});
