/// <reference types="vite/client" />
// Headless balance bots (BUILD.md §5). Skipped in `npm test`; run with `npm run balance`.
import { expect, test } from 'vitest';
import { DOWNGRADE_COST, GEM_TYPES, GEMS_PER_ROUND, type Game } from '../src/sim/game';
import { DEFS, newGame, type Difficulty } from '../src/sim/setup';
import {
  armorMult,
  codeOf,
  parseFx,
  type GemDef,
  type SpecialDef,
  type Tower,
} from '../src/sim/towers';

/** Buildable cells ordered by distance to the current route (closest first). */
function candidates(g: Game) {
  const m = g.sim.maze;
  const route = m.route()!;
  const on = new Set<number>();
  route.forEach((f, i) => m.walk(f, m.waypoints[i]).forEach(([c, r]) => on.add(m.idx(c, r))));
  const out: [number, number, number][] = [];
  for (let r = 0; r < m.h; r++)
    for (let c = 0; c < m.w; c++) {
      if (!m.buildable(c, r) || on.has(m.idx(c, r))) continue;
      let d = Infinity;
      for (const i of on) d = Math.min(d, Math.hypot((i % m.w) - c, ((i / m.w) | 0) - r));
      out.push([d, c, r]);
    }
  return out.sort((a, b) => a[0] - b[0]);
}

/** A "reasonable" player: gems hug the route, combine > merge > keep best, buys levels. */
export function bot(seed: number, difficulty: 'easy' | 'normal' | 'hard' = 'normal', buy = true) {
  const g = newGame(seed, difficulty);
  const levelAt: Record<number, number> = {};
  while (!g.over) {
    const cells = candidates(g);
    for (let k = 0; g.placed.length < GEMS_PER_ROUND && k < cells.length; k++)
      g.run(['place', cells[k][1], cells[k][2]]);
    if (g.placed.length < GEMS_PER_ROUND) break; // board full
    const all = [...g.combat.towers];
    const combo = all.flatMap((t) => g.recipesFor(t).map((r) => [t, r.name] as const))[0];
    const best = g.placed.reduce((a, b) => (b.def.quality > a.def.quality ? b : a));
    if (!(combo && g.run(['combine', combo[0].c, combo[0].r, combo[1]])))
      if (!g.run(['merge4', best.c, best.r]) && !g.run(['merge2', best.c, best.r]))
        g.run(['keep', best.c, best.r]);
    if (g.sim.phase === 'build') {
      // Combined older towers only: this round's gems still need a keep.
      const b = g.placed.reduce((a, x) => (x.def.quality > a.def.quality ? x : a));
      g.run(['keep', b.c, b.r]);
    }
    while (buy && g.gold >= (g.levelCost ?? Infinity)) g.run(['level']);
    while (g.sim.phase === 'wave') g.tick();
    levelAt[g.sim.wave] = g.level;
  }
  return {
    wave: g.wavesCleared,
    won: g.sim.phase === 'won',
    levelAt,
    gold: g.gold,
    towers: g.combat.towers.length,
  };
}

// ---------------------------------------------------------------------------------------------
// skilled(): a bot that plays like a strong human, for win-rate sweeps (see the report below).
// It only uses player commands (g.run) and what a player sees on screen. Each round it lays the
// next stones of a guide maze (then re-uses the best-covered stone cells), keeps / merges /
// combines whatever makes the board worth most (strength now + recipes it is close to), spends
// spare gold on levels first and downgrades second, and never uses pedals or hero skills.

/** Stone build order of the "Solo lvl 40" guide (src/guide.ts): round 0 lays the '0' cells, etc.
 *  Greedy offline search: each stone is the guide cell that lengthens the route most.
 *  ponytail: fixed order for the classic map; regenerate if map.json or the guide changes. */
const ORDER = [
  '.....................................',
  '.....................................',
  '.....................................',
  '................................a....',
  '...............................3.a...',
  '..............................a..9...',
  '.............................a..3....',
  '............................a..9.....',
  '...........................b..9......',
  '..........................b..9.......',
  '.........................b..9........',
  '........................b..8.........',
  '.......................b..8..........',
  '...............ffggg..c..8...........',
  '..............f......c..8............',
  '.............f..ddccc..8.............',
  '.............g.d.....d..7............',
  '....0........g...dhf..e.7............',
  '.........1112i455hhhe.e.7............',
  '.............2...0he..6.7............',
  '.............2.4..e..5..7............',
  '.............2..4...5..6.............',
  '..............2..344..6..............',
  '...............3.....5...............',
  '................3.166................',
  '..................1..................',
  '..................0..................',
  '..................0..................',
  '.....................................',
  '.....................................',
  '.....................................',
  '.....................................',
  '...................0.................',
  '.....................................',
  '.....................................',
  '.....................................',
  '.....................................',
];
const BUILD = ORDER.flatMap((row, r) =>
  [...row].flatMap((ch, c) => (ch === '.' ? [] : [[parseInt(ch, 36), c, r]])),
)
  .sort((a, b) => a[0] - b[0])
  .map(([, c, r]) => [c, r]);

type Def = GemDef & Partial<SpecialDef>;
const ALL = DEFS as Record<string, Def>;
/** Non-pedal recipes by result code. ponytail: the bot never builds pedals. */
const RECIPE: Record<string, string[]> = {};
for (const [code, d] of Object.entries(ALL))
  if (!d.pedal && d.recipes?.length) RECIPE[code] = d.recipes[0];

/** What a tower adds: its own damage and what it does for the rest of the board. */
interface Stat {
  phys: number; // damage per second over all its targets, scaled by reach
  magic: number;
  slow: number; // flat slow it lands on creeps
  armor: number; // armor it takes off, weighted by how many creeps it reaches
  mult: number; // other team effects, as a fraction of the board's damage
  sight: boolean; // shows invisible creeps
}
function stat(d: Def): Stat {
  const f = parseFx(d);
  const out = { phys: 0, magic: 0, slow: 0, armor: 0, mult: 0, sight: false };
  if (f.pedal) return out;
  const dmg = d.damage + d.bonusDamage;
  const crit = f.crit.reduce((m, [c, x]) => m * (1 + c * (x - 1)), 1);
  const aps = (1 + f.as / 100) / d.attackRate;
  const p = dmg * crit * aps * Math.min(f.targets, 8) * (f.cleave ? 1 + f.cleave[0] : 1);
  let m = f.poison * 4 + (f.magicPct ? p : 0);
  if (f.lightning) m += 225 * aps;
  if (f.fork) m += 0.75 * dmg * aps;
  out.armor = 0.4 * f.armor;
  for (const a of f.enemy) {
    m += (a.dps ?? 0) * 8; // burns hit every creep in range
    if (a.flyingOnly) out.mult += 0.05;
    else {
      out.armor += 0.9 * (a.armor ?? 0);
      if (a.slowPct) out.mult += a.range < 400 ? 0.3 : 0.9;
    }
  }
  const reach = (Math.min(d.range, 2000) / 600) * (f.maxHp || f.souls ? 2 : 1);
  [out.phys, out.magic] = [p * reach, m * reach];
  out.slow = f.slow;
  if (f.asAura) out.mult += (f.asAura[0] < 400 ? 0.1 : 0.6) * (f.asAura[1] / 100);
  out.mult += (f.dmgAura ? 0.2 : 0) + (f.rangeAura ? 0.15 : 0) + (f.aimAura ? 0.03 : 0);
  out.mult += f.stun * 1.5 + (f.frost ? 0.3 : 0);
  out.sight = f.trueSight;
  return out;
}
const STAT: Record<string, Stat> = {};
for (const [code, d] of Object.entries(ALL)) STAT[code] = stat(d);

/** Strength of a set of towers. Copies of one tower only stack their team effects on easy. */
function strength(codes: string[], stack: boolean) {
  let phys = 0,
    magic = 0,
    slow = 0,
    armor = 0,
    mult = 1;
  const seen = new Set<string>();
  let sight = false;
  for (const c of codes) {
    const s = STAT[c];
    phys += s.phys;
    magic += s.magic;
    sight ||= s.sight;
    if (!stack && seen.has(c)) continue;
    seen.add(c);
    slow += s.slow;
    armor += s.armor;
    mult += s.mult;
  }
  // A debuff gem reaches about a third of a wave; creeps walk ~600 and never slower than 100.
  mult += 0.3 * (600 / Math.max(120, 600 - slow) - 1);
  phys *= armorMult(10 - armor) / armorMult(10);
  // Some waves are immune to physical damage and others to magic: a board needs both.
  // Two waves before the first boss are invisible: one True Sight tower is worth a lot.
  return (0.6 * (phys + magic) + 0.8 * Math.min(phys, magic)) * (sight ? mult : 0.8 * mult);
}

interface Plan {
  stack: boolean; // easy: copies stack
  odd: number[]; // per quality 1..6: chance to roll a given gem of it in the rounds looked ahead
  luck: number; // easy: chance the last missing gem of a recipe shows up by recipe luck
}

/** Basic gems still missing to build `code` from `have` (which is consumed), as their odds. */
function missing(code: string, have: Map<string, number>, plan: Plan, out: number[]) {
  const n = have.get(code) ?? 0;
  if (n > 0) have.set(code, n - 1);
  else if (RECIPE[code]) for (const x of RECIPE[code]) missing(x, have, plan, out);
  else out.push(plan.odd[+code[1] - 1]);
}

const tally = (codes: string[]) => {
  const m = new Map<string, number>();
  for (const c of codes) m.set(c, (m.get(c) ?? 0) + 1);
  return m;
};
const spread = (m: Map<string, number>, first: string) => {
  const out = [first];
  for (const [k, n] of m) for (let i = 0; i < n; i++) out.push(k);
  return out;
};

/** The board after every ready recipe that makes it stronger is combined (best first). */
function settle(codes: string[], stack: boolean) {
  for (;;) {
    const have = tally(codes);
    let best = codes,
      bestV = strength(codes, stack);
    for (const [code, parts] of Object.entries(RECIPE)) {
      const left = new Map(have);
      if (!parts.every((x) => left.get(x) && left.set(x, left.get(x)! - 1))) continue;
      const after = spread(left, code);
      const v = strength(after, stack);
      if (v > bestV) [best, bestV] = [after, v];
    }
    if (best === codes) return codes;
    codes = best;
  }
}

/** Board worth: its strength once settled, plus the recipes it is part-way to (by their odds). */
function worth(codes: string[], plan: Plan) {
  codes = settle(codes, plan.stack);
  const base = strength(codes, plan.stack);
  const have = tally(codes);
  let v = base;
  for (const [code, parts] of Object.entries(RECIPE)) {
    const left = new Map(have);
    const miss: number[] = [];
    for (const x of parts) missing(x, left, plan, miss);
    const after = spread(left, code);
    if (!miss.length || after.length > codes.length) continue; // ready, or nothing of it here
    const gain = strength(after, plan.stack) - base;
    if (gain <= 0) continue;
    miss.sort((a, b) => a - b);
    miss[0] = Math.max(miss[0], plan.luck); // luck brings the rarest one
    v += gain * miss.reduce((a, b) => a * b, 1);
  }
  return v;
}

/** Route cells (counted once per pass) within `radius` cells of each cell: where towers hit most. */
function coverage(g: Game, radius = 4) {
  const m = g.sim.maze;
  const visits = new Float64Array(m.w * m.h);
  m.route()!.forEach((f, s) =>
    m.walk(f, m.waypoints[s]).forEach(([c, r]) => visits[m.idx(c, r)]++),
  );
  const out = new Float64Array(m.w * m.h);
  for (let r = 0; r < m.h; r++)
    for (let c = 0; c < m.w; c++)
      for (let dr = -radius; dr <= radius; dr++)
        for (let dc = -radius; dc <= radius; dc++)
          if (Math.hypot(dc, dr) <= radius && m.walkable(c + dc, r + dr))
            out[m.idx(c, r)] += visits[m.idx(c + dc, r + dr)];
  return out;
}

export interface SkilledOpts {
  maxWave?: number; // stop once this many waves are cleared (default: the last wave)
  hp?: number; // harness knob: overrides sim.hpMult
  ramp?: number; // harness knob: wave w's creep HP is also multiplied by ramp^w
  debug?: boolean;
}

export function skilled(seed: number, difficulty: Difficulty = 'normal', opts: SkilledOpts = {}) {
  const g = newGame(seed, difficulty);
  const { sim, combat } = g;
  // The two harness knobs: the only sim fields written. Everything else goes through g.run.
  if (opts.hp) sim.hpMult = opts.hp;
  const baseHp = sim.hpMult;
  const ramp = () => {
    if (opts.ramp) sim.hpMult = baseHp * opts.ramp ** (sim.wave + 1);
  };
  g.setHero('quartz');
  const maxWave = opts.maxWave ?? sim.lastWave;
  const plan: Plan = { stack: combat.stackCopies, odd: [], luck: 0 };
  /** Refresh the odds for the rounds still worth planning for. */
  const look = () => {
    const gems = GEMS_PER_ROUND * Math.max(1, Math.min(3, maxWave - sim.wave));
    // ponytail: looks 3 rounds ahead (longer made it hoard parts and lose); the 3% floor stands
    // for merges and downgrades reaching qualities that cannot be rolled.
    plan.odd = [0, 1, 2, 3, 4, 5].map((q) =>
      Math.max(0.03, 1 - (1 - (g.odds[q] ?? 0) / 100 / GEM_TYPES.length) ** gems),
    );
    plan.luck = 1 - (1 - (g.recipeLuck * g.level) / 8) ** gems; // ~8 codes compete for the luck
  };
  const board = () => combat.towers.filter((t) => !t.def.pedal);
  const codes = (ts: Tower[]) => ts.map((t) => codeOf(t.def));
  const todo = [...BUILD];
  let cover = coverage(g);
  const cov = (t: Tower) => cover[sim.maze.idx(t.c, t.r)];
  const leaks: number[] = [];
  const levelAt: number[] = [];

  const best = (parts: Tower[]) => parts.reduce((a, b) => (cov(b) > cov(a) ? b : a));
  /** Combine `name` from `parts` on the part with the best spot. */
  const combine = (name: string, parts: Tower[]) => {
    const t = best(parts);
    return g.run(['combine', t.c, t.r, name]);
  };
  /** All recipes that can be combined right now. */
  const combos = () => {
    const seen = new Set<string>();
    const out: { name: string; parts: Tower[] }[] = [];
    for (const t of board())
      for (const r of g.recipesFor(t))
        if (RECIPE[r.name] && !seen.has(r.name)) {
          seen.add(r.name);
          out.push(r);
        }
    return out;
  };
  /** Combine older towers while that makes the board stronger. */
  const combineBoard = () => {
    for (;;) {
      const now = board();
      let best: { name: string; parts: Tower[] } | null = null,
        bestV = strength(codes(now), plan.stack);
      for (const r of combos()) {
        if (r.parts.some((p) => g.placed.includes(p))) continue;
        const after = [...codes(now.filter((t) => !r.parts.includes(t))), r.name];
        const v = strength(after, plan.stack);
        if (v > bestV) [best, bestV] = [r, v];
      }
      if (!best || !combine(best.name, best.parts)) return;
    }
  };

  const place = () => {
    cover = coverage(g);
    const m = sim.maze;
    while (g.placed.length < GEMS_PER_ROUND && todo.length) {
      const [c, r] = todo.shift()!;
      g.run(['place', c, r]);
    }
    if (g.placed.length === GEMS_PER_ROUND) return;
    // Maze done: lift the stones on the best spots and put this round's gems there.
    const spots: [number, number, number][] = [];
    for (let r = 0; r < m.h; r++)
      for (let c = 0; c < m.w; c++)
        if (!m.walkable(c, r) && !m.noBuild[m.idx(c, r)] && !combat.towerAt(c, r))
          spots.push([cover[m.idx(c, r)], c, r]);
    spots.sort((a, b) => b[0] - a[0]);
    for (const [, c, r] of spots) {
      if (g.placed.length >= GEMS_PER_ROUND) break;
      if (g.run(['stone', c, r])) g.run(['place', c, r]);
    }
  };

  const choose = () => {
    for (let guard = 0; g.step === 'choose' && guard < 40; guard++) {
      const old = board().filter((t) => !g.placed.includes(t));
      const oldCodes = codes(old);
      const base = worth(oldCodes, plan);
      const top = cover.reduce((a, b) => Math.max(a, b));
      /** What a choice adds to the board, less when the tower ends up on a poor spot. */
      const add = (after: string[], spot: Tower) =>
        (worth(after, plan) - base) * (0.5 + (0.5 * cov(spot)) / top);
      const options: { v: number; go: () => boolean }[] = [];
      for (const t of g.placed) {
        options.push({
          v: add([...oldCodes, codeOf(t.def)], t),
          go: () => g.run(['keep', t.c, t.r]),
        });
        for (const n of [4, 2] as const)
          if (g.canMerge(t, n)) {
            const up = t.def.type + Math.min(t.def.quality + n / 2, 6);
            options.push({
              v: add([...oldCodes, up], t),
              go: () => g.run([n === 4 ? 'merge4' : 'merge2', t.c, t.r]),
            });
          }
      }
      for (const r of combos()) {
        if (!r.parts.some((p) => g.placed.includes(p))) continue;
        const rest = old.filter((t) => !r.parts.includes(t));
        options.push({
          v: add([...codes(rest), r.name], best(r.parts)),
          go: () => combine(r.name, r.parts),
        });
      }
      options.sort((a, b) => b.v - a.v);
      // Spare gold: reroll a gem to a lower quality when the lower ones are worth more on average.
      const down = g.placed
        .filter((t) => g.canDowngrade(t) && g.gold >= DOWNGRADE_COST + (g.levelCost ?? 0))
        .map((t) => {
          let v = 0;
          for (let q = 1; q < t.def.quality; q++) v += add([...oldCodes, t.def.type + q], t);
          return { t, v: v / (t.def.quality - 1) };
        })
        .sort((a, b) => b.v - a.v)[0];
      if (down && down.v > options[0].v * 1.1 && g.run(['down', down.t.c, down.t.r])) continue;
      if (!options.some((o) => o.go())) break;
    }
    if (g.step === 'choose') g.run(['skip']);
  };

  /** Debuff gems re-aim at the closest creep, so slows and armor breaks spread over the wave. */
  const aimDebuffers = () => {
    for (const t of board()) {
      const f = combat.tfx(t);
      if (t.def.quality && (f.slow || f.armor || f.poison) && t.mode !== 0)
        g.run(['aim', t.c, t.r, 0]);
    }
  };

  ramp();
  while (!g.over && g.wavesCleared < maxWave) {
    if (sim.phase === 'build') {
      while (g.gold >= (g.levelCost ?? Infinity)) g.run(['level']);
      look();
      combineBoard();
      place();
      if (g.placed.length < GEMS_PER_ROUND) g.run(['skip']);
      else choose();
      combineBoard();
      aimDebuffers();
      levelAt[sim.wave] = g.level;
    }
    const [wave, hp] = [sim.wave, sim.castleHp];
    ramp(); // for the next wave; this one's creeps are already queued
    while (sim.phase === 'wave' && sim.wave === wave) g.tick();
    leaks[wave] = hp - sim.castleHp;
  }
  if (opts.debug) {
    const tw = [...board()].sort((a, b) => b.damageDealt - a.damageDealt);
    const total = tw.reduce((s, t) => s + t.damageDealt, 0) || 1;
    const list = (a: number[], every = 1) =>
      a.flatMap((x, w) => (x && w % every === 0 ? [`w${w}:${x}`] : [])).join(' ');
    const share = (t: Tower) => Math.round((100 * t.damageDealt) / total);
    console.log(
      `seed ${seed} ${difficulty}: cleared ${g.wavesCleared} hp ${sim.castleHp} level ${g.level} gold ${g.gold}\n` +
        ` leaks ${list(leaks)}\n level ${list(levelAt, 5)}\n` +
        ` towers ${tw.map((t) => `${codeOf(t.def)}(${share(t)}%,k${t.kills},m${t.mvp})`).join(' ')}`,
    );
  }
  return {
    wave: g.wavesCleared,
    won: g.wavesCleared >= sim.lastWave,
    hp: sim.castleHp,
    level: g.level,
    seconds: g.seconds,
  };
}

test('skilled bot is deterministic and stops at maxWave', () => {
  const run = () => skilled(7, 'easy', { maxWave: 6 });
  const a = run();
  expect(a).toEqual(run());
  expect(a.wave).toBe(6);
});

// Sweep knobs (env): DIFF=easy|normal|hard, SEEDS=n (seeds 1000..), HP=creep HP multiplier,
// RAMP=r (wave w's HP × r^w), MAXWAVE=stop wave, DEBUG=1 for a per-game breakdown.
test.skipIf(import.meta.env.MODE !== 'balance')('skilled report', { timeout: 7_200_000 }, () => {
  const env = process.env;
  const N = Number(env.SEEDS ?? 8);
  const diff = (env.DIFF ?? 'normal') as Difficulty;
  const opts: SkilledOpts = {
    hp: env.HP ? Number(env.HP) : undefined,
    ramp: env.RAMP ? Number(env.RAMP) : undefined,
    maxWave: env.MAXWAVE ? Number(env.MAXWAVE) : undefined,
    debug: !!env.DEBUG,
  };
  const t0 = performance.now();
  const runs = Array.from({ length: N }, (_, i) => skilled(1000 + i, diff, opts));
  const secs = (performance.now() - t0) / 1000 / N;
  const share = (n: number) => (n / N).toFixed(2);
  const reach = (w: number) => share(runs.filter((r) => r.wave >= w).length);
  const hps = runs
    .filter((r) => r.won)
    .map((r) => r.hp)
    .sort((a, b) => a - b);
  console.log(
    `skilled: diff=${diff} hp=${opts.hp ?? 'default'} ramp=${opts.ramp ?? 1} maxwave=${opts.maxWave ?? 50} seeds=${N}` +
      ` | win ${share(runs.filter((r) => r.won).length)} | cleared ${runs.map((r) => r.wave).join(' ')}` +
      ` | reach w10 ${reach(10)} w20 ${reach(20)} w30 ${reach(30)} w40 ${reach(40)} w50 ${reach(50)}` +
      ` | winner castle hp median ${hps.length ? hps[hps.length >> 1] : '-'}` +
      ` | ${secs.toFixed(1)} s/game`,
  );
});

// The first, naive bot. Run with OLD=1.
test.skipIf(import.meta.env.MODE !== 'balance' || !process.env.OLD)(
  'old bot report',
  { timeout: 3_600_000 },
  () => {
    const N = Number(process.env.SEEDS ?? 8);
    const diff = (process.env.DIFF ?? 'normal') as Difficulty;
    for (const buy of [true, false]) {
      const runs = Array.from({ length: N }, (_, i) => bot(1000 + i, diff, buy));
      const reach = (w: number) => runs.filter((r) => r.wave >= w).length / N;
      const lvl9 = runs.map((r) => Object.entries(r.levelAt).find(([, l]) => l >= 9)?.[0] ?? '-');
      console.log(
        `${buy ? 'buys levels' : 'never buys'}: waves cleared ${runs.map((r) => r.wave).join(' ')}` +
          ` | reach w10 ${reach(10)} w20 ${reach(20)} w30 ${reach(30)} w40 ${reach(40)} win ${reach(50)}` +
          ` | level 9 at wave ${lvl9.join(' ')} | final level ${runs.map((r) => r.levelAt[r.wave + 1] ?? r.levelAt[r.wave]).join(' ')}`,
      );
    }
  },
);
