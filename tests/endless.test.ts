/// <reference types="vite/client" />
// Endless-depth harness: how deep does a strong wave-50 board go, and what carries it?
// Skipped in `npm test`; run with
//   npx vitest run tests/endless.test.ts --mode balance --silent=false
// Lines start with `endless:` (sweeps) or `endless-diag:` (per-wave damage shares).
import { expect, test } from 'vitest';
import { ENDGAME } from '../src/sim/endgame';
import type { Game } from '../src/sim/game';
import { DIFFICULTY, newGame, type Difficulty } from '../src/sim/setup';
import type { Tower } from '../src/sim/towers';
import { CREEPS_PER_WAVE, ENDLESS, ENDLESS_BOSS } from '../src/sim/waves';

type Cell = [number, number];

/** A boxed serpentine in the middle of the classic map: legs 2, 5 and 6 all wind through it.
 *  Cells are sorted closest to the centre first, so towers take the best-covered ones. */
function wallCells(): Cell[] {
  const key = (c: number, r: number) => c * 100 + r;
  const cells = new Map<number, Cell>();
  const add = (c: number, r: number) => cells.set(key(c, r), [c, r]);
  for (let k = 10; k <= 26; k++)
    for (const [c, r] of [
      [k, 10],
      [k, 26],
      [10, k],
      [26, k],
    ])
      add(c, r);
  for (const [c, r] of [
    [10, 18], // west door (leg 2 in)
    [26, 18], // east door (legs 2 and 6 out)
    [25, 10], // north door (leg 5 in)
    [17, 26], // south door, to the sealed pocket around checkpoint 5
  ])
    cells.delete(key(c, r));
  // Baffles on even columns, gap alternating top / bottom.
  for (let c = 12; c <= 24; c += 2)
    for (let r = 11; r <= 25; r++) if (r !== ((c / 2) % 2 ? 25 : 11)) add(c, r);
  // Nothing walks around the box: spurs to the map edge, and the pocket around checkpoint 5.
  for (let r = 0; r <= 9; r++) for (const y of [r, 36 - r]) add(14, y);
  add(18, 27);
  add(19, 32);
  return [...cells.values()].sort(
    (a, b) => Math.hypot(a[0] - 18, a[1] - 18) - Math.hypot(b[0] - 18, b[1] - 18),
  );
}

const ENDGAME_BASE: Record<string, string> = {
  'The Blood King': 'The Crown Prince',
  'Cullinan Heart': 'Diamond Cullinan',
  'Regent Diamond': 'Koh-i-noor Diamond',
  'Star of Eden': 'Sapphire Star Of Adam',
  'Kyparium Core': 'Depleted-Kyparium',
};
// Closest to the centre first: end-game towers and auras together, then damage, then Great gems.
// [code, MVP stars, kills] as of wave 40; waves 41-50 are then played to earn the rest.
const BOARD: [string, number?, number?][] = [
  ['The Blood King'],
  ['Carmen-Lucia'],
  ['Cullinan Heart'],
  ['Regent Diamond'],
  ['Star of Eden'],
  ['Kyparium Core'],
  ['Ehome'],
  ['Red Coral'],
  ['Star Sapphire'],
  ['The Great Stone', 12, 120],
  ['Fantastic Miss Shrimp', 8, 80],
  ['Geluanshi', 1, 10],
  ['Golden Jubilee', 5, 50],
  ['Obsidian', 5, 50],
  ['Agate', 4, 40],
  ['The Burning Stone', 2, 20],
  ['Wings Stone', 1, 10],
  ['Egypt Gold'],
  ['Emerald Golem'],
  ['Elaborately Carved Tourmaline'],
  ["Northern Saber's Eye"],
  ['Monkey King Jade'],
  ['Deepsea Pearl'],
  ['Huge Pink Diamond', 1, 10],
  ['Uranium-235', 1, 10],
  ['Volcano'],
  ['Antique Bloodstone'],
  ['Silver Knight'],
  ['Black Opal'],
  ['Lucky Chinese Jade'],
  ['D6'],
  ['R6'],
  ['Y6'],
  ['P6'],
  ['E6'],
  ['B6'],
  ['G6'],
];
const HEALER = 'Lucky Chinese Jade';
const GREAT = ['D6', 'R6', 'Y6', 'P6', 'Q6', 'G6', 'B6', 'E6'];
const TOP = ['The Great Stone', 'Fantastic Miss Shrimp', 'Golden Jubilee', 'Obsidian', 'Agate'];

interface Opt {
  diff: Difficulty;
  board: 'strong' | 'king'; // all five end-game towers, or The Blood King only
  lag?: number; // combat.endgameLag; default = today's rules
  cap?: number; // stop after this wave
  seed?: number;
  mvpCap?: number; // MVP stars per tower stop counting here (MVP_BONUS is a const)
  killCap?: number; // kills per tower stop counting here (KILL_BONUS is a const)
  add?: string[]; // easy only: one of these per build round, on the next wall cell
  diag?: number[]; // print damage shares after these waves
  noHeal?: boolean; // Lucky Chinese Jade (heals the castle) is a plain Great gem instead
  leakRamp?: number; // as if ordinary leaks grew like boss leaks: x(1 + endless waves / leakRamp)
}

const CAP = Number(process.env.CAP ?? 400);

function run(o: Opt) {
  const t0 = performance.now();
  const g: Game = newGame(o.seed ?? 1, o.diff);
  const { sim, combat } = g;
  const cells = wallCells();
  BOARD.forEach(([name, mvp = 0, kills = 0], i) => {
    const base = o.noHeal && name === HEALER ? 'G6' : name;
    const code = o.board === 'king' && i ? (ENDGAME_BASE[base] ?? base) : base;
    const t = combat.place(code, ...cells[i]);
    if (!t) throw new Error(`cannot place ${code}`);
    [t.mvp, t.kills] = [mvp, kills];
  });
  for (const [c, r] of cells.slice(BOARD.length))
    if (!sim.maze.placeRock(c, r)) throw new Error(`cannot wall ${c},${r}`);
  let free = BOARD.length;
  if (o.lag) combat.endgameLag = o.lag;
  sim.wave = 40;

  const cap = o.cap ?? CAP;
  let firstLeak = 0,
    wave = 0,
    hp0 = sim.castleHp,
    creepHp = 0,
    kills0 = 0,
    died = 0,
    boss = false,
    ticks0 = 0,
    before = new Map<Tower, number>();
  const hpAt: Record<number, number> = {};
  while (!g.over && !died && g.wavesCleared < cap) {
    if (sim.phase === 'build') {
      if (o.add && sim.wave >= sim.lastWave && free < cells.length)
        combat.placePedal(o.add[sim.wave % o.add.length], ...cells[free++]);
      g.run(['skip']);
    } else g.tick();
    if (wave && sim.wave === wave && sim.phase === 'wave') continue;
    // Wave `wave` just ended (off easy the next one has started, with no tick yet).
    if (wave) {
      const endless = wave - sim.lastWave;
      if (o.leakRamp && endless > 0 && creepHp && !boss) {
        const leaks = CREEPS_PER_WAVE - (g.kills - kills0);
        sim.castleHp -= Math.ceil((leaks * endless) / o.leakRamp);
        if (sim.castleHp <= 0) died = wave;
      }
      if (sim.castleHp < hp0 && endless > 0) firstLeak ||= wave;
      if (wave % 10 === 0) hpAt[wave] = sim.castleHp;
      if (o.diag?.includes(wave)) {
        const lag = combat.endgameLag ** -(wave - sim.lastWave);
        const dealt = combat.towers.map((t) => [t, t.damageDealt - (before.get(t) ?? 0)] as const);
        const total = dealt.reduce((s, [, d]) => s + d, 0);
        console.log(
          `endless-diag: ${o.board}/${o.diff} wave ${wave}: creep hp ${creepHp.toExponential(2)}` +
            ` | ${((g.ticks - ticks0) / 30).toFixed(0)}s | killed ${g.kills - kills0}` +
            ` | castle ${sim.castleHp}` +
            ` | Sunder per hit ${(ENDGAME.maxHp * lag * 100).toFixed(2)}% of max HP`,
        );
        for (const [t, d] of dealt.sort((a, b) => b[1] - a[1]).slice(0, 5)) {
          const hit = (t.def.damage + t.def.bonusDamage + t.souls) * combat.damageMult(t);
          console.log(
            `endless-diag:   ${t.def.name.padEnd(22)} ${((100 * d) / total).toFixed(1).padStart(5)}%` +
              ` | stars ${t.mvp} kills ${t.kills} mult x${combat.damageMult(t).toFixed(1)}` +
              ` | souls ${t.souls.toExponential(2)}` +
              ` | hit before armor = ${((100 * hit) / creepHp).toFixed(1)}% of creep HP`,
          );
        }
      }
      for (const t of combat.towers) {
        t.mvp = Math.min(t.mvp, o.mvpCap ?? Infinity);
        t.kills = Math.min(t.kills, o.killCap ?? Infinity);
      }
    }
    wave = 0;
    if (sim.phase !== 'wave') continue;
    [wave, hp0, creepHp, ticks0] = [sim.wave, sim.castleHp, sim.current?.hp ?? 0, g.ticks];
    [kills0, boss] = [g.kills, !!sim.current?.boss];
    before = new Map(combat.towers.map((t) => [t, t.damageDealt]));
  }
  const top = combat.towers.reduce((a, b) => (b.damageDealt > a.damageDealt ? b : a));
  const all = combat.towers.reduce((s, t) => s + t.damageDealt, 0);
  return {
    wave: died ? died - 1 : g.wavesCleared,
    capped: !g.over && !died,
    firstLeak,
    hpAt,
    minutes: g.seconds / 60,
    top: `${top.def.name} ${((100 * top.damageDealt) / all).toFixed(0)}%`,
    ms: performance.now() - t0,
  };
}

const show = (label: string, o: Opt) => {
  const r = run(o);
  const hp = Object.entries(r.hpAt)
    .filter(([w]) => +w > 50 && +w % 20 === 0)
    .map(([w, h]) => `${w}:${h}`)
    .join(' ');
  console.log(
    `endless: ${label.padEnd(34)} ${o.board.padEnd(6)} ${o.diff.padEnd(6)}` +
      ` | reached ${String(r.wave).padStart(3)}${r.capped ? '+' : ' '}` +
      ` | first leak ${String(r.firstLeak || '-').padStart(3)}` +
      ` | ${r.minutes.toFixed(0).padStart(3)} min | top ${r.top}` +
      ` | castle hp ${hp} | ${(r.ms / 1000).toFixed(1)}s`,
  );
  return r;
};

/** Run `fn` with fields of an exported constants object changed, then put them back. */
function withConst<T extends object>(obj: T, patch: Partial<T>, fn: () => void) {
  const old = { ...obj };
  Object.assign(obj, patch);
  try {
    fn();
  } finally {
    Object.assign(obj, old);
  }
}

const DIFFS: Difficulty[] = ['easy', 'normal', 'hard'];
const BOARDS = ['strong', 'king'] as const;

test('the harness maze is a long open route and the board clears wave 41', () => {
  const g = newGame(1);
  for (const [c, r] of wallCells()) expect(g.sim.maze.placeRock(c, r)).toBe(true);
  const len = g.sim.maze.segmentLengths(g.sim.maze.route()!).reduce((a, b) => a + b);
  expect(len).toBeGreaterThan(250);
  expect(run({ diff: 'normal', board: 'strong', cap: 41 }).wave).toBe(41);
});

test.skipIf(import.meta.env.MODE !== 'balance')('endless report', { timeout: 7_200_000 }, () => {
  const t0 = performance.now();
  const only = process.env.ONLY; // lag | levers | diag: run one section
  const on = (s: string) => !only || only === s;

  if (on('lag'))
    for (const board of BOARDS)
      for (const diff of DIFFS)
        for (const lag of [1, 1.02, 1.03, 1.05, 1.08, 1.12])
          show(`lag ${lag}${lag === ENDGAME.lag ? ' (today)' : ''}`, { diff, board, lag });

  if (on('levers')) {
    // Other seeds: crits, giants and aim are the only randomness on a fixed board.
    for (const diff of DIFFS)
      for (const seed of [2, 3]) show(`today, seed ${seed}`, { diff, board: 'strong', seed });
    for (const diff of DIFFS) {
      const o: Opt = { diff, board: 'strong' };
      // What carries the run: switch one mechanism off at a time.
      withConst(ENDGAME, { souls: 0 }, () => show('no Soul Harvest', o));
      withConst(ENDGAME, { maxHp: 0 }, () => show('no Sunder', o));
      show('no MVP stars', { ...o, mvpCap: 0 });
      show('no kill bonus', { ...o, killCap: 0 });
      show('no MVP stars, no kill bonus', { ...o, mvpCap: 0, killCap: 0 });
      show('MVP stars cap 20', { ...o, mvpCap: 20 });
      show('kills cap 200 (+200%)', { ...o, killCap: 200 });
      show('stars cap 20, kills cap 200', { ...o, mvpCap: 20, killCap: 200 });
      // Creep-side levers.
      for (const hp of [1.18, 1.2, 1.25])
        withConst(ENDLESS, { hp }, () => show(`ENDLESS.hp ${hp}`, o));
      withConst(ENDLESS, { armor: 2 }, () => show('ENDLESS.armor 2', o));
      withConst(ENDLESS_BOSS, { ramp: 5 }, () => show('ENDLESS_BOSS.ramp 5', o));
      withConst(ENDLESS_BOSS, { every: 10 }, () => show('ENDLESS_BOSS.every 10', o));
      withConst(ENDLESS_BOSS, { every: 10, ramp: 5 }, () => show('boss every 10, ramp 5', o));
    }
    // Easy keeps its build rounds in endless: one more tower every wave.
    const easy: Opt = { diff: 'easy', board: 'strong' };
    show('+1 Great gem per wave', { ...easy, add: GREAT });
    show('+1 top special per wave', { ...easy, add: TOP });
    show('+1 Blood King per wave', { ...easy, add: ['The Blood King'] });
  }

  if (on('tune')) {
    for (const diff of DIFFS)
      for (const lag of [1.15, 1.2, 1.3, 1.5]) show(`lag ${lag}`, { diff, board: 'strong', lag });
    for (const souls of [0.005, 0.002, 0.001, 0.0005])
      for (const lag of [1.02, 1.05, 1.08])
        for (const diff of DIFFS) {
          const o: Opt = { diff, board: 'strong', lag };
          withConst(ENDGAME, { souls }, () => show(`souls ${souls} lag ${lag}`, o));
          // As if `lagged` used the creep's HP before the difficulty multiplier.
          const k = 1 / DIFFICULTY[diff].hp;
          withConst(ENDGAME, { souls: souls * k, maxHp: ENDGAME.maxHp * k }, () =>
            show(`souls ${souls} lag ${lag} base HP`, o),
          );
        }
  }

  if (on('grid'))
    // Soul Harvest follows creep HP, so ENDLESS.hp only bites once the lag has switched it off;
    // and with a castle healer on the board only boss leaks can end the run.
    for (const extra of [{}, { noHeal: true }, { leakRamp: 10 }] as Partial<Opt>[])
      for (const lag of [1.08, 1.12, 1.2])
        for (const hp of [1.15, 1.2, 1.3, 1.5])
          for (const diff of DIFFS)
            withConst(ENDLESS, { hp }, () =>
              show(`lag ${lag} hp ${hp} ${Object.keys(extra).join()}`, {
                diff,
                board: 'strong',
                lag,
                ...extra,
              }),
            );

  if (on('pace'))
    // One dial: endless creep HP growth, with Sunder and Soul Harvest lagging by the same rate
    // (so they count a creep's HP as if endless had not scaled it).
    for (const board of BOARDS)
      for (const hp of [1.15, 1.2, 1.25, 1.3, 1.35, 1.4, 1.5])
        for (const diff of DIFFS)
          for (const seed of [1, 2, 3])
            withConst(ENDLESS, { hp }, () =>
              show(`lag = ENDLESS.hp = ${hp} seed ${seed}`, { diff, board, lag: hp, seed }),
            );

  if (on('pick')) {
    // Candidate settings per difficulty: [lag, ENDLESS.hp, ENDLESS_BOSS.ramp].
    const picks: [Difficulty, number, number, number][] = [
      ['easy', 1.15, 1.15, 10],
      ['easy', 1.2, 1.15, 10],
      ['normal', 1.25, 1.25, 10],
      ['normal', 1.25, 1.25, 5],
      ['hard', 1.3, 1.3, 5],
      ['hard', 1.4, 1.4, 5],
      ['hard', 1.5, 1.5, 5],
      ['hard', 1.4, 1.4, 3],
    ];
    for (const [diff, lag, hp, ramp] of picks)
      for (const board of BOARDS)
        for (const seed of [1, 2, 3])
          withConst(ENDLESS, { hp }, () =>
            withConst(ENDLESS_BOSS, { ramp }, () =>
              show(`lag ${lag} hp ${hp} ramp ${ramp} seed ${seed}`, { diff, board, lag, seed }),
            ),
          );
    // Hard: ordinary leaks that grow like boss leaks (emulated), with and without the healer.
    for (const leakRamp of [10, 5])
      for (const noHeal of [false, true])
        for (const board of BOARDS)
          withConst(ENDLESS, { hp: 1.4 }, () =>
            show(`lag 1.4 hp 1.4 leakRamp ${leakRamp}${noHeal ? ' noHeal' : ''}`, {
              diff: 'hard',
              board,
              lag: 1.4,
              leakRamp,
              noHeal,
            }),
          );
    // Easy keeps building in endless: does a tower a wave break the easy pick?
    for (const add of [GREAT, TOP])
      show(`lag 1.15, +1 ${add[0]}... per wave`, { diff: 'easy', board: 'strong', lag: 1.15, add });
  }

  if (on('diag'))
    // LAG, HP (ENDLESS.hp), NOHEAL and DIAG (waves, comma-separated) pick another run to look into.
    withConst(ENDLESS, { hp: Number(process.env.HP ?? ENDLESS.hp) }, () => {
      for (const board of BOARDS)
        show('with diagnostics', {
          diff: 'easy',
          board,
          lag: Number(process.env.LAG ?? ENDGAME.lag),
          noHeal: !!process.env.NOHEAL,
          diag: process.env.DIAG?.split(',').map(Number) ?? [50, 60, 70, 80, 90, 100, 150, 200],
        });
    });

  console.log(`endless: harness took ${((performance.now() - t0) / 60000).toFixed(1)} min`);
});
