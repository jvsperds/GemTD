import { shellsFor } from '../src/sim/skills';
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
  for (const c of [10, 12, 14, 16, 20]) g.place(c, 14);
  expect(g.step).toBe('choose');
  expect(g.removeStone(...spots[2])).toBe(false); // all 5 gems placed: no more breaking
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
  expect(g.gold).toBe(2); // killGold(3) = 1 + 1
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

test('hero skills: need unlocking and gold, buff a tower, expire, and replay identically', () => {
  const g = setup();
  for (const [c, r] of spots) g.run(['place', c, r]);
  const t = g.placed[0];
  g.gold = 1000;
  expect(g.run(['skill', t.c, t.r, 'haste'])).toBe(false); // not unlocked
  g.skills = { haste: 2, guard: 1 };
  expect(g.run(['skill', -1, -1, 'haste'])).toBe(false); // needs a tower
  const base = g.combat.attacksPerSec(t);
  expect(g.run(['skill', t.c, t.r, 'haste'])).toBe(true);
  expect(g.combat.attacksPerSec(t)).toBeCloseTo(base * 1.8);
  expect(g.run(['skill', -1, -1, 'guard'])).toBe(true);
  expect(g.gold).toBe(500);
  g.run(['keep', t.c, t.r]);
  for (let k = 0; k < 61 * 30 && g.sim.phase === 'wave'; k++) g.tick();
  const r = setup();
  r.skills = g.skills;
  r.gold = 1000;
  r.replay(g.log);
  while (r.ticks < g.ticks && r.sim.phase === 'wave') r.tick();
  expect(r.ticks).toBe(g.ticks);
  expect(t.haste.t).toBeCloseTo(60 - g.seconds); // counts down in wave time only
  expect(r.gold).toBe(g.gold);
  expect(r.sim.castleHp).toBe(g.sim.castleHp);
});

test('pray skills bias the next gem only; hammer downgrades exactly one level', () => {
  const g = setup();
  g.skills = { prayR: 4, perfect: 4, hammer: 1 };
  g.gold = 10000;
  let rubies = 0;
  for (let k = 0; k < 40; k++) {
    const m = setup(k + 1);
    m.skills = { prayR: 4 };
    m.gold = 200;
    expect(m.run(['skill', -1, -1, 'prayR'])).toBe(true);
    if (m.place(10, 10)!.def.type === 'R') rubies++;
    expect(m.pray).toBeNull(); // consumed by one placement
  }
  expect(rubies).toBeGreaterThan(20); // 70% + 1/8 of the rest, vs 5 by chance
  expect(g.run(['skill', -1, -1, 'perfect'])).toBe(true);
  for (const [c, r] of spots) g.run(['place', c, r]);
  const t = g.placed.find((x) => x.def.quality > 1);
  if (t) {
    const q = t.def.quality;
    expect(g.run(['skill', t.c, t.r, 'hammer'])).toBe(true);
    expect(t.def.quality).toBe(q - 1);
    expect(g.gold).toBe(10000 - 400 - 250);
  }
  const chipped = g.placed.find((x) => x.def.quality === 1)!;
  expect(g.run(['skill', chipped.c, chipped.r, 'hammer'])).toBe(false);
});

test('map skills: swap, stonehenge, whirl, candy, timelapse, adja-swap', () => {
  const g = setup();
  g.skills = { swap: 1, stonehenge: 1, whirl: 1, candy: 1, timelapse: 1, adjswap: 1 };
  g.gold = 5000;
  const { maze } = g.sim;
  // TimeLapse takes this round's gems back.
  for (const [c, r] of spots.slice(0, 2)) g.run(['place', c, r]);
  expect(g.run(['skill', -1, -1, 'timelapse'])).toBe(true);
  expect(g.placed.length).toBe(0);
  expect(maze.walkable(spots[0][0], spots[0][1])).toBe(true);
  // StoneHenge: a line of up to 4 stones to the right.
  expect(g.run(['skill', 10, 14, 'stonehenge', 11, 14])).toBe(true);
  expect([10, 11, 12, 13, 14].map((c) => maze.cells[maze.idx(c, 14)] === ROCK)).toEqual([
    true,
    true,
    true,
    true,
    false,
  ]);
  // Swap two towers.
  for (const [c, r] of spots) g.run(['place', c, r]);
  const [a, b] = g.placed;
  const [ad, bd] = [a.def, b.def];
  expect(g.run(['skill', a.c, a.r, 'swap', b.c, b.r])).toBe(true);
  expect([g.combat.towerAt(10, 10)!.def, g.combat.towerAt(12, 10)!.def]).toEqual([bd, ad]);
  // Adja-Swap moves a tower onto a neighbouring stone (the StoneHenge line).
  g.run(['keep', a.c, a.r]); // round ends, other gems become stones
  while (g.sim.phase === 'wave') g.tick();
  // Whirl around (12, 15): the StoneHenge stones above it turn counter-clockwise, so the
  // top-right one leaves (13, 14) and the top-left one moves down to (11, 15).
  expect(g.run(['skill', 12, 15, 'whirl'])).toBe(true);
  expect(maze.cells[maze.idx(13, 14)]).not.toBe(ROCK);
  expect(maze.cells[maze.idx(11, 15)]).toBe(ROCK);
  // Candy on an open cell adds a waypoint for the next wave only.
  const n = maze.waypoints.length;
  expect(g.run(['skill', 20, 20, 'candy'])).toBe(true);
  for (const [c, r] of [
    [24, 24],
    [26, 24],
    [28, 24],
    [30, 24],
    [24, 26],
  ])
    g.run(['place', c, r]);
  g.run(['keep', 24, 24]);
  expect(maze.waypoints.length).toBe(n + 1);
  while ((g.sim.phase as string) === 'wave') g.tick();
  expect(maze.waypoints.length).toBe(n);
  expect(g.run(['skill', 11, 14, 'adjswap'])).toBe(false); // (11, 14) is a plain stone, not a tower
});

test('hero passives change rules; no hero is neutral', () => {
  const plain = setup();
  const [t0] = placeRound(plain);
  const war = setup();
  war.setHero('obsidian');
  const [t1] = placeRound(war);
  t1.def = t0.def;
  expect(war.combat.attacksPerSec(t1)).toBeCloseTo(plain.combat.attacksPerSec(t0) * 1.15);
  const merchant = setup();
  merchant.setHero('citrine');
  merchant.skills = { heal: 1 };
  expect(merchant.skillGold('heal')).toBe(300); // 400 - 25%
  const warden = setup();
  warden.setHero('garnet');
  expect(warden.sim.bossBite).toBe(3);
  const scholar = setup();
  scholar.setHero('onyx');
  scholar.gold = 1000;
  const cost = scholar.levelCost!;
  expect(cost).toBe(Math.round(plain.levelCost! * 0.9));
});

test('shells: 1 per 3 waves, +4 for a win, never more than 20', () => {
  expect(shellsFor(0, false)).toBe(0);
  expect(shellsFor(10, false)).toBe(3);
  expect(shellsFor(50, true)).toBe(20);
  expect(shellsFor(200, true)).toBe(20); // endless runs stay capped
});

test('passive skills stack onto the hero perk', () => {
  const g = setup();
  g.skills = { purse: 2, focus: 4, walls: 1, heal: 1 };
  g.setHero('citrine');
  expect(g.gold).toBe(100);
  expect(g.skillGold('heal')).toBe(220); // 400 - 25% hero - 20% Focus
  expect(g.sim.bossBite).toBe(1);
});

test('rate passives: Reaper at 100% kills with every shot', () => {
  const run = (execute: number) => {
    const g = setup(7);
    g.combat.heroProc.execute = execute;
    g.sim.waves = g.sim.waves.map((d) => ({ ...d, hp: d.hp * 100 })); // needs many shots
    for (let k = 0; k < GEMS_PER_ROUND; k++) g.place(5 + k, 16); // beside the row-18 leg
    g.keep(g.placed[0]);
    let shots = 0;
    while (g.sim.phase === 'wave') {
      g.tick();
      shots += g.combat.shots.length;
    }
    return shots / g.kills;
  };
  expect(run(1)).toBe(1); // one shot per kill
  expect(run(0)).toBeGreaterThan(1);
});
