import { expect, test } from 'vitest';
import gems from '../data/gems.json';
import map from '../data/map.json';
import quality from '../data/quality_levels.json';
import towerData from '../data/towers.json';
import waves from '../data/waves.json';
import { Game, type LevelDef } from '../src/sim/game';
import { Maze, type MapData } from '../src/sim/maze';
import { allDefs, Combat, parseFx, type GemDef, type SpecialDef } from '../src/sim/towers';
import {
  armorOf,
  EVASION,
  HIGH_ARMOR,
  newCreep,
  RECHARGE,
  REFRACTION,
  TICK,
  WaveSim,
  type WaveEntry,
} from '../src/sim/waves';

const DEFS = allDefs(
  gems as Record<string, GemDef>,
  towerData as unknown as Record<string, SpecialDef>,
);
const setup = () => {
  const sim = new WaveSim(new Maze(map as unknown as MapData), waves as WaveEntry[]);
  const combat = new Combat(sim, DEFS);
  return { sim, combat, game: new Game(combat, quality.levels as LevelDef[]) };
};
const base: WaveEntry = {
  wave: 1,
  name: 't',
  hp: 1e6,
  speed: 300,
  armor: 0,
  magicResist: 0,
  flying: false,
  boss: false,
  abilities: [],
};
function creep(sim: WaveSim, x: number, y: number, over: Partial<WaveEntry> = {}) {
  const cr = newCreep({ ...base, ...over }, x, y);
  sim.creeps.push(cr);
  return cr;
}
const ticks = (c: Combat, n: number) => {
  for (let i = 0; i < n; i++) c.tick();
};

test('every tower ability id in the data is understood or explicitly ignored', () => {
  const ignored = /^(e\d+|tower_attack\d|tower_chain_frost)$/;
  for (const d of Object.values(DEFS))
    for (const id of d.abilities) {
      if (ignored.test(id)) continue;
      const f = parseFx({ ...d, abilities: [id] });
      const empty = parseFx({ ...d, abilities: [] });
      expect(f, `${d.name}: ${id}`).not.toEqual(empty);
    }
});

test('recipe is detected across rounds and combining ends the round when it uses new gems', () => {
  const { combat, game } = setup();
  const b1 = combat.place('B1', 10, 10)!;
  const y1 = combat.place('Y1', 12, 10)!;
  const round = [10, 12, 14, 16, 20].map((c) => game.place(c, 14)!);
  round[0].def = DEFS.D1;
  expect(game.recipesFor(b1).map((r) => r.name)).toContain('Silver');
  expect(game.combine(round[0], 'Silver')).toBe(true);
  expect(round[0].def.name).toBe('Silver');
  expect(combat.towers).toEqual(expect.arrayContaining([round[0]]));
  expect(combat.towers).not.toContain(b1);
  expect(combat.towers).not.toContain(y1);
  expect(game.step).toBe('wave');
});

test('upgrade chain and the 5-gem alternative recipe; old towers combine without ending the round', () => {
  const { combat, game } = setup();
  const s = combat.place('B1', 10, 10)!;
  s.def = DEFS.Silver;
  s.kills = 25;
  combat.place('Q2', 12, 10);
  combat.place('R3', 14, 10);
  expect(game.combine(s, 'Silver Knight')).toBe(true);
  expect(s.def.name).toBe('Silver Knight');
  expect(s.kills).toBe(25); // kill bonus carries over
  expect(game.step).toBe('place');
  expect(combat.damageMult(s)).toBeCloseTo(1.2);

  const p = [1, 2, 3, 4, 5].map((q, k) => combat.place('P' + q, 20 + 2 * k, 24)!);
  expect(game.recipesFor(p[2]).map((r) => r.name)).toContain('Koh-i-noor Diamond');
});

test('invisible creeps need a True Sight tower in range', () => {
  const { sim, combat } = setup();
  combat.place('D1', 10, 10);
  const cr = creep(sim, 11.5, 10.5, { abilities: ['riki_permanent_invisibility'] });
  ticks(combat, 30);
  expect(cr.hp).toBe(1e6);
  combat.place('E1', 10, 12);
  ticks(combat, 30);
  expect(cr.hp).toBeLessThan(1e6);
});

test('evasion dodges about half', () => {
  const { sim, combat } = setup();
  const t = combat.place('D1', 10, 10)!;
  t.def = { ...t.def, attackRate: TICK };
  const cr = creep(sim, 11.5, 10.5, { abilities: ['guai_shanbi'] });
  ticks(combat, 400);
  const hits = (1e6 - cr.hp) / 5;
  expect(hits / 400).toBeCloseTo(EVASION, 1);
});

test('magic immune ignores poison; physical immune ignores attacks', () => {
  const { sim, combat } = setup();
  const g = combat.place('G6', 10, 10)!;
  const mi = creep(sim, 11.5, 10.5, { abilities: ['enemy_momian'], magicResist: 100 });
  ticks(combat, 30 * 3);
  const physOnly = 1e6 - mi.hp;
  expect(mi.poison).toBe(0);
  expect(physOnly).toBeGreaterThan(0);
  sim.creeps.length = 0;
  g.target = null;
  const pi = creep(sim, 11.5, 10.5, { abilities: ['enemy_wumian'] });
  ticks(combat, 30 * 3);
  expect(1e6 - pi.hp).toBeGreaterThan(0); // poison only
  expect(1e6 - pi.hp).toBeLessThan(128 * 3 + 1);
});

test('refraction shield blocks one hit; reactive armor stacks; high armor adds armor', () => {
  const { sim, combat } = setup();
  combat.place('D1', 10, 10);
  const cr = creep(sim, 11.5, 10.5, { abilities: ['shredder_reactive_armor'] });
  cr.shield = 1;
  ticks(combat, 1);
  expect(cr.hp).toBe(1e6);
  ticks(combat, 30 * 3 + 5);
  expect(armorOf(cr)).toBe(3);
  const ha = newCreep({ ...base, armor: 8, abilities: ['enemy_high_armor'] }, 0, 0);
  expect(armorOf(ha)).toBe(8 + HIGH_ARMOR);
});

test('untouchable disarms attackers; disarm aura stops adjacent towers unless a calm aura covers them', () => {
  const { sim, combat } = setup();
  const t = combat.place('D1', 10, 10)!;
  const cr = creep(sim, 13.5, 10.5, { abilities: ['enemy_bukeqinfan'] });
  combat.rand = () => 0; // untouchable procs
  ticks(combat, 30 * 2);
  expect(t.target).toBe(cr);
  expect(t.disarmT).toBeGreaterThan(0);

  sim.creeps.length = 0;
  const d = creep(sim, 11.5, 10.5, { abilities: ['guai_jiaoxieguanghuan'] });
  ticks(combat, 30 * 2);
  expect(d.hp).toBe(1e6);
  const calm = combat.place('B1', 10, 12)!;
  calm.def = DEFS['Deep Sea Pearl'];
  expect(parseFx(calm.def).calmAura).toBeGreaterThan(0);
  ticks(combat, 30 * 2);
  expect(d.hp).toBeLessThan(1e6);
});

test('rush, blink and refraction trigger on turns; recharge regenerates; kraken shell purges', () => {
  const { sim } = setup();
  sim.startWave();
  sim.creeps.length = 0;
  sim.rand = () => 0; // every turn trigger fires
  const rf = sim.spawn({ ...base, abilities: ['enemy_zheguang', 'runrunrun'] }); // chain: refraction wins
  const cr = sim.spawn({ ...base, abilities: ['runrunrun'] });
  (sim as unknown as { queue: unknown[] }).queue = [];
  let turned = false;
  for (let i = 0; i < 30 * 15 && !turned; i++) {
    sim.tick();
    turned = cr.rushT > 0;
  }
  expect(turned).toBe(true);
  expect(rf.shield).toBe(REFRACTION.instances);
  expect(rf.rushT).toBe(0);
  expect(sim.speed(cr)).toBeCloseTo(base.speed * 1.5);

  const rc = sim.spawn({ ...base, abilities: ['enemy_recharge'] });
  rc.hp = 1000;
  sim.tick();
  expect(rc.hp).toBeCloseTo(1000 + rc.def.hp * RECHARGE * TICK);

  const k = sim.spawn({ ...base, hp: 1e6, abilities: ['tidehunter_kraken_shell'] });
  k.slow = 100;
  sim.damage(k, 40000);
  expect(k.slow).toBe(0);
});

test('blink jumps forward along the path', () => {
  const { sim } = setup();
  const a = setup().sim;
  for (const s of [sim, a]) {
    s.startWave();
    (s as unknown as { queue: unknown[] }).queue = [];
    s.rand = () => 0;
  }
  const b = sim.spawn({ ...base, abilities: ['enemy_shanshuo'] });
  const n = a.spawn({ ...base });
  for (let i = 0; i < 30 * 12; i++) {
    sim.tick();
    a.tick();
  }
  expect(b.seg * 1000 + b.x + b.y).toBeGreaterThan(n.seg * 1000 + n.x + n.y + 2);
});

test('synergy (guai_xietong) aura only slows enemy movement, which towers do not have: no-op', () => {
  const { sim, combat } = setup();
  combat.place('D1', 10, 10);
  const cr = creep(sim, 11.5, 10.5, { abilities: ['guai_xietong'] });
  ticks(combat, 30);
  expect(cr.hp).toBeLessThan(1e6);
});

test('burn aura and stun from special towers', () => {
  const { sim, combat } = setup();
  const t = combat.place('D1', 10, 10)!;
  t.def = { ...DEFS['Asteriated Ruby'] };
  const cr = creep(sim, 11.5, 10.5);
  ticks(combat, 30);
  expect(1e6 - cr.hp).toBeGreaterThanOrEqual(60 - 1);
  expect(parseFx(DEFS['Dark Emerald']).stun).toBe(0.1);
});
