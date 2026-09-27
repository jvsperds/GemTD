import { expect, test } from 'vitest';
import gems from '../data/gems.json';
import map from '../data/map.json';
import waves from '../data/waves.json';
import { Maze, type MapData } from '../src/sim/maze';
import { armorMult, Combat, DEBUFF_TIME, type GemDef } from '../src/sim/towers';
import {
  CASTLE_HP,
  MIN_SPEED,
  newCreep,
  WaveSim,
  type Creep,
  type WaveEntry,
} from '../src/sim/waves';

const G = gems as Record<string, GemDef>;
const setup = () => {
  const sim = new WaveSim(new Maze(map as unknown as MapData), waves as WaveEntry[]);
  return { sim, combat: new Combat(sim, G) };
};
const def: WaveEntry = {
  wave: 0,
  name: 't',
  hp: 1e6,
  speed: 300,
  armor: 0,
  magicResist: 0,
  flying: false,
  boss: false,
  abilities: [],
};
function creep(sim: WaveSim, x: number, y: number, over: Partial<WaveEntry> = {}): Creep {
  const cr = newCreep({ ...def, ...over }, x, y);
  sim.creeps.push(cr);
  return cr;
}

test('armor formula matches Dota', () => {
  expect(armorMult(0)).toBe(1);
  expect(armorMult(10)).toBeCloseTo(0.625);
  expect(armorMult(-10)).toBeCloseTo(1.375); // negative armor amplifies
  expect(armorMult(-10)).toBeGreaterThan(1);
});

test('tower attacks at its rate and respects range', () => {
  const { sim, combat } = setup();
  const t = combat.place('D1', 10, 10)!;
  const near = creep(sim, 12.5, 10.5); // 2 cells = 256 units
  const far = creep(sim, 20.5, 10.5); // out of 500 range
  for (let i = 0; i < 30 * 3; i++) combat.tick();
  expect(1e6 - near.hp).toBe(3 * 5); // 3 attacks in 3 s at 5 dmg
  expect(far.hp).toBe(1e6);
  expect(t.damageDealt).toBe(15);
});

test('sapphire slows, amethyst reduces armor, both expire', () => {
  const { sim, combat } = setup();
  combat.place('B3', 10, 10);
  combat.place('P2', 10, 12);
  const cr = creep(sim, 11.5, 11.5, { armor: 4 });
  combat.tick();
  expect(cr.slow).toBe(120);
  expect(cr.armorRed).toBe(4);
  combat.towers.length = 0;
  for (let i = 0; i < 30 * DEBUFF_TIME + 1; i++) combat.tick();
  expect(cr.slow).toBe(0);
  expect(cr.armorRed).toBe(0);
  cr.slow = 1000;
  expect(Math.max(cr.def.speed - cr.slow, MIN_SPEED)).toBe(MIN_SPEED);
});

test('emerald poison deals magic dps reduced by magic resist', () => {
  const { sim, combat } = setup();
  const t = combat.place('G2', 10, 10)!; // 4 dmg hit, 4 dps poison
  const cr = creep(sim, 11.5, 10.5, { magicResist: 50 });
  combat.tick();
  combat.towers.length = 0;
  for (let i = 0; i < 30 * DEBUFF_TIME + 5; i++) combat.tick();
  expect(1e6 - cr.hp).toBeCloseTo(4 + 4 * DEBUFF_TIME * 0.5, 0);
  expect(t.damageDealt).toBeCloseTo(1e6 - cr.hp);
});

test('ruby cleaves nearby creeps, topaz hits three targets', () => {
  const { sim, combat } = setup();
  combat.place('R1', 10, 10); // 4 dmg, 30% cleave in 300
  const a = creep(sim, 11.5, 10.5);
  const b = creep(sim, 12.5, 10.5); // 128 from a
  const c = creep(sim, 15.5, 10.5); // 512 from a
  combat.tick();
  expect(1e6 - a.hp).toBe(4);
  expect(1e6 - b.hp).toBeCloseTo(1.2);
  expect(c.hp).toBe(1e6);

  const s2 = setup();
  s2.combat.place('Y1', 10, 10);
  const hits = [0, 1, 2, 3].map((k) => creep(s2.sim, 11.5, 9.5 + k * 0.5));
  s2.combat.tick();
  expect(hits.filter((h) => h.hp < 1e6)).toHaveLength(3);
});

test('opal aura speeds towers in range without stacking; aquamarine has +AS', () => {
  const { combat } = setup();
  const d = combat.place('D1', 10, 10)!;
  expect(combat.attacksPerSec(d)).toBe(1);
  combat.place('E1', 11, 10);
  combat.place('E3', 12, 10);
  expect(combat.attacksPerSec(d)).toBeCloseTo(1.4); // max aura (+40), not 20+40
  const q = combat.place('Q1', 10, 12)!;
  expect(combat.attacksPerSec(q)).toBeGreaterThanOrEqual(3);
});

test('a hand-placed tower set clears the first five waves without leaks', () => {
  const { sim, combat } = setup();
  // Along the S→1 leg (column 4) and the 1→2 leg (row 18), plus air cover.
  const set: [string, number, number][] = [
    ['D2', 5, 11],
    ['R2', 3, 11],
    ['Y2', 5, 14],
    ['G2', 3, 14],
    ['B2', 5, 10],
    ['D2', 6, 17],
    ['Q2', 6, 19],
    ['P2', 8, 17],
    ['Y2', 8, 19],
  ];
  for (const [g, c, r] of set) expect(combat.place(g, c, r), `${g}@${c},${r}`).not.toBeNull();
  for (let w = 0; w < 5; w++) {
    sim.startWave();
    for (let i = 0; i < 30 * 300 && sim.phase === 'wave'; i++) {
      sim.tick();
      combat.tick();
    }
  }
  expect(sim.wave).toBe(5);
  expect(sim.castleHp).toBe(CASTLE_HP);
});
