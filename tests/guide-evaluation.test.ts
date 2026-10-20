/// <reference types="vite/client" />
import { expect, test } from 'vitest';
import { writeFileSync } from 'node:fs';
import { GUIDES, type TowerPlacement } from '../src/guide';
import { newGame, DEFS } from '../src/sim/setup';
import { score } from '../src/sim/game';
import { OPEN, ROCK, type Cell } from '../src/sim/maze';

// shortcut: ideal wave-51 boards, add acquisition-aware runs before judging achievable scores.
const inventory = [
  'Kyparium Core',
  'Kyparium Core',
  'Cullinan Heart',
  'Cullinan Heart',
  'The Blood King',
  'The Blood King',
  'Regent Diamond',
  'Regent Diamond',
  'Star of Eden',
  ...Array(6).fill('Ehome'),
  ...Array(4).fill('Natural Zumurud'),
  'Carmen-Lucia',
  'Red Coral',
  'Star Sapphire',
  'Monkey King Jade',
  'Monkey King Jade',
  'Lucky Chinese Jade',
];
const mapRows = (rows: string[], seed = 1) => {
  const g = newGame(seed, 'easy');
  for (let r = 0; r < 37; r++)
    for (let c = 0; c < 37; c++)
      if (!g.sim.maze.noBuild[g.sim.maze.idx(c, r)])
        g.sim.maze.cells[g.sim.maze.idx(c, r)] = rows[r]?.[c] === '.' ? OPEN : ROCK;
  return g;
};
let rng = 0x9e3779b9;
const rand = () => (rng = (Math.imul(rng, 1664525) + 1013904223) >>> 0) / 4294967296;
const evaluate = () => {
  const plans: {
    name: string;
    towers: TowerPlacement[];
    evaluation: {
      valid: boolean;
      stones: number;
      path: number | null;
      middlePasses: number;
      objective: number;
      ehomeAdjacency: number[];
      results: { seed: number; wave: number; hp: number; score: number; capped: boolean }[];
      waves: number[];
      meanScore: number;
    };
  }[] = [];
  for (const guide of GUIDES) {
    const g = mapRows(guide.rows),
      m = g.sim.maze,
      fields = m.route();
    const rocks: Cell[] = [];
    for (let r = 0; r < 37; r++)
      for (let c = 0; c < 37; c++)
        if (m.cells[m.idx(c, r)] === ROCK && !m.noBuild[m.idx(c, r)]) rocks.push([c, r]);
    rocks.sort((a, b) => Math.hypot(a[0] - 18, a[1] - 18) - Math.hypot(b[0] - 18, b[1] - 18));
    const cells = rocks.slice(0, 25);
    if (cells.length < 25) throw Error(`${guide.name}: only ${cells.length} available stones`);
    const towers = cells.map(([c, r], i) => g.combat.placePedal(inventory[i], c, r));
    const paths = fields?.flatMap((f, i) => m.walk(f, m.waypoints[i])) ?? [];
    const flyer: Cell[] = [];
    for (let i = 1; i < m.waypoints.length; i++) {
      const [a, b] = [m.waypoints[i - 1], m.waypoints[i]],
        n = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]));
      for (let j = 0; j < n; j++)
        flyer.push([a[0] + ((b[0] - a[0]) * j) / n, a[1] + ((b[1] - a[1]) * j) / n]);
    }
    const metric = () => {
      g.combat.refreshAuras();
      let v = 0;
      for (const t of towers) {
        const f = g.combat.tfx(t),
          range = g.combat.range(t) / 128,
          ground = paths.filter(([c, r]) => Math.hypot(t.c - c, t.r - r) <= range).length,
          air = flyer.filter(([c, r]) => Math.hypot(t.c - c, t.r - r) <= range).length,
          rate = g.combat.attacksPerSec(t),
          mult = g.combat.damageMult(t),
          power =
            (((t.def.damage + t.def.bonusDamage) * mult) / 1000 + f.maxHp * 4000) *
              Math.min(f.targets, 8) +
            (f.souls ? 6 : 0);
        v += rate * power * (ground + 4 * air);
        if (f.heal) v += rate * air * 20;
      }
      return v;
    };
    let best = metric();
    for (let n = 0; n < 180; n++) {
      const a = (rand() * 25) | 0,
        b = (rand() * 25) | 0;
      if (a === b) continue;
      [towers[a].def, towers[b].def] = [towers[b].def, towers[a].def];
      const v = metric();
      if (v > best) best = v;
      else [towers[a].def, towers[b].def] = [towers[b].def, towers[a].def];
    }
    g.combat.refreshAuras();
    const placement = towers.map((t) => ({ c: t.c, r: t.r, code: t.def.name }));
    const ehomes = towers
      .filter((t) => t.def.name !== 'Ehome')
      .map((t) => t.aura.src.filter((a) => a.kind === 'as' && a.from.def.name === 'Ehome').length);
    const results = [];
    for (const seed of [11, 29]) {
      const run = mapRows(guide.rows, seed);
      expect(run.seed).toBe(seed);
      run.setHero('obsidian');
      for (let i = 0; i < 25; i++) run.combat.placePedal(placement[i].code, ...cells[i]);
      run.sim.wave = 50;
      let loops = 0;
      while (!run.over && run.wavesCleared < 130 && loops < 450000) {
        if (run.sim.phase === 'build') run.run(['skip']);
        else run.tick();
        loops++;
      }
      expect(loops).toBeLessThan(450000);
      results.push({
        seed,
        wave: run.wavesCleared,
        hp: run.sim.castleHp,
        score: score(run),
        capped: run.wavesCleared >= 130,
      });
    }
    plans.push({
      name: guide.name,
      towers: placement,
      evaluation: {
        valid: !!fields,
        stones: rocks.length,
        path: fields ? m.segmentLengths(fields).reduce((a, b) => a + b, 0) : null,
        middlePasses: fields ? m.middlePasses(fields) : 0,
        objective: best,
        ehomeAdjacency: ehomes,
        results,
        waves: results.map((r) => r.wave),
        meanScore: results.reduce((s, r) => s + r.score, 0) / results.length,
      },
    });
  }
  plans.sort((a, b) => b.evaluation.meanScore - a.evaluation.meanScore);
  return plans;
};
test.skipIf(import.meta.env.MODE !== 'balance' && !process.env.EVALUATE_GUIDES)(
  'evaluate all Easy guide tower plans',
  { timeout: 180000 },
  () => {
    expect(Object.keys(DEFS)).toContain('Ehome');
    const plans = evaluate();
    if (process.env.EVALUATE_GUIDES === '1')
      writeFileSync('data/guide-plans.json', JSON.stringify(plans, null, 2) + '\n');
    expect(plans).toHaveLength(GUIDES.length);
    expect(plans.every((p) => p.towers.length === 25 && p.towers.every((t) => DEFS[t.code]))).toBe(
      true,
    );
    expect(
      plans.every(
        (p) => new Set(p.towers.map((t) => `${t.c},${t.r}`)).size === 25 && p.evaluation.valid,
      ),
    ).toBe(true);
    for (const plan of plans) {
      const guide = GUIDES.find((g) => g.name === plan.name)!;
      for (const t of plan.towers) expect(guide.rows[t.r][t.c]).not.toBe('.');
    }
  },
);
