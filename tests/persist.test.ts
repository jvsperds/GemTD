import { expect, test } from 'vitest';
import { board, retain, TOP, type ScoreRow } from '../src/persist';
import { GEMS_PER_ROUND, score, type LogEntry } from '../src/sim/game';
import { newGame } from '../src/sim/setup';

/** Scripted player: line the long row-18 leg, keep the best gem each round. */
function play(seed: number, rounds: number) {
  const g = newGame(seed);
  const cells = Array.from({ length: 54 }, (_, k) => [5 + (k >> 1), k & 1 ? 20 : 16] as const);
  for (let n = 0; n < rounds && !g.over; n++) {
    for (let k = 0; k < GEMS_PER_ROUND; k++) g.run(['place', ...cells.shift()!]);
    const b = g.placed.reduce((a, x) => (x.def.quality > a.def.quality ? x : a));
    if (!g.run(['merge2', b.c, b.r])) g.run(['keep', b.c, b.r]);
    while (g.gold >= (g.levelCost ?? Infinity)) g.run(['level']);
    while (g.sim.phase === 'wave') g.tick();
  }
  return g;
}
const hash = (g: ReturnType<typeof newGame>) =>
  JSON.stringify([
    g.gold,
    g.xp,
    g.level,
    g.sim.wave,
    g.sim.castleHp,
    g.combat.towers.map((t) => [t.c, t.r, t.def.name, t.kills, t.damageDealt]),
    Array.from(g.sim.maze.cells).join(''),
  ]);

test('seed + command log replays to the identical state (save/resume, replays)', () => {
  const a = play(42, 6);
  const b = newGame(42);
  b.replay(JSON.parse(JSON.stringify(a.log)) as LogEntry[]);
  while (b.sim.phase === 'wave') b.tick();
  expect(hash(b)).toBe(hash(a));
  expect(a.log.length).toBeGreaterThan(30);
});

test('score formula', () => {
  const g = play(3, 4);
  expect(score(g)).toBe(
    Math.round(g.wavesCleared * (1000 + g.bonusPerWave) + g.sim.castleHp * 50 - g.seconds),
  );
  expect(g.wavesCleared).toBe(4);
});

const row = (o: Partial<ScoreRow>): ScoreRow => ({
  name: 'a',
  score: 0,
  wavesCleared: 0,
  hpLeft: 0,
  timeSec: 0,
  difficulty: 'normal',
  seed: 1,
  won: false,
  date: 0,
  version: 1,
  ...o,
});

test('boards sort and filter; fastest lists only full clears', () => {
  const rows = [
    row({ score: 5, wavesCleared: 9, date: 1 }),
    row({ score: 9, wavesCleared: 3, date: 2, difficulty: 'hard' }),
    row({ score: 7, wavesCleared: 50, won: true, timeSec: 900, date: 3 }),
    row({ score: 8, wavesCleared: 50, won: true, timeSec: 800, date: 4 }),
  ];
  expect(board(rows, 'score').map((r) => r.score)).toEqual([9, 8, 7, 5]);
  expect(board(rows, 'score', 'normal').map((r) => r.score)).toEqual([8, 7, 5]);
  expect(board(rows, 'wave').map((r) => r.score)).toEqual([8, 7, 5, 9]);
  expect(board(rows, 'fastest').map((r) => r.timeSec)).toEqual([800, 900]);
});

test('mutator and map runs rank only on their own board', () => {
  const rows = [
    row({ score: 5 }),
    row({ score: 9, mutators: ['tough'] }),
    row({ score: 8, map: 'crossroads' }),
    row({ score: 6, map: 'classic' }),
  ];
  expect(board(rows, 'score').map((r) => r.score)).toEqual([6, 5]);
  expect(board(rows, 'score', 'modded').map((r) => r.score)).toEqual([9, 8]);
  expect(retain(rows)).toHaveLength(4);
});

test('only rows that can reach a top-10 board are kept', () => {
  const rows = Array.from({ length: 30 }, (_, i) => row({ score: i, wavesCleared: i, date: i }));
  rows.push(row({ score: -1, wavesCleared: 0, difficulty: 'hard', date: 99 })); // tops the hard board
  const kept = retain(rows);
  expect(board(rows, 'score')).toHaveLength(TOP);
  expect(kept.map((r) => r.score).sort((a, b) => a - b)).toEqual([
    -1, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29,
  ]);
});

test('difficulty scales creep HP and the score bonus; daily seed is stable per day', async () => {
  const { newGame: ng, dailySeed } = await import('../src/sim/setup');
  const hard = ng(1, 'hard');
  const easy = ng(1, 'easy');
  for (const g of [hard, easy]) g.sim.startWave();
  hard.sim.tick();
  easy.sim.tick();
  expect(hard.sim.creeps[0].hp / easy.sim.creeps[0].hp).toBeCloseTo(1.5 / 0.7);
  expect(hard.bonusPerWave).toBeGreaterThan(easy.bonusPerWave);
  const d = new Date(2026, 8, 27, 9);
  expect(dailySeed(d)).toBe(dailySeed(new Date(2026, 8, 27, 23)));
  expect(dailySeed(d)).not.toBe(dailySeed(new Date(2026, 8, 28, 9)));
});
