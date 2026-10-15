import { expect, test } from 'vitest';
import { SNAPSHOT, type Game } from '../src/sim/game';
import { newGame } from '../src/sim/setup';

const cols = [10, 12, 14, 16, 20];
/** Place a round on row `r`, keep the first gem and run the wave out. */
function round(g: Game, r: number) {
  for (const c of cols) g.run(['place', c, r]);
  g.run(['keep', cols[0], r]);
  while (g.sim.phase === 'wave') g.tick();
}
const play = (g: Game, rows: number[]) => rows.forEach((r) => round(g, r));

// With `usable` false the snapshot's format is unknown, so the whole log replays instead.
test.each([true, false])(
  'resume from a wave-end snapshot continues the same game (%s)',
  (usable) => {
    const g = newGame(7, 'easy');
    play(g, [8, 10, 12, 14]);
    g.run(['place', 10, 16]); // commands after the snapshot replay on top of it
    g.run(['place', 12, 16]);
    expect(JSON.parse(g.snap).log).toBe(g.log.length - 2);

    const h = newGame(7, 'easy');
    const snapshot = JSON.parse(g.snap);
    if (!usable) snapshot.v = SNAPSHOT + 1;
    h.resume(g.log, JSON.stringify(snapshot));
    expect(h.log).toEqual(g.log);
    expect(h.placed.map((t) => t.def.name)).toEqual(g.placed.map((t) => t.def.name));
    // Same gems, damage, gold and random draws from here on.
    for (const x of [g, h]) {
      for (const c of cols.slice(2)) x.run(['place', c, 16]);
      x.run(['keep', cols[0], 16]);
      while (x.sim.phase === 'wave') x.tick();
      play(x, [18, 20]);
    }
    expect(h.snap).toBe(g.snap);
  },
);

test('resume restarts the next endless wave on difficulties without build rounds', () => {
  const g = newGame(3);
  g.gold = 1e6;
  g.sim.castleHp = 1e9;
  g.sim.wave = g.sim.lastWave;
  g.run(['skip']);
  while (g.sim.wave === g.sim.lastWave + 1) g.tick(); // wave 51 ends, 52 follows at once
  for (let i = 0; i < 40; i++) g.tick();
  g.run(['level']); // a mid-wave command after the snapshot

  const h = newGame(3);
  h.resume(g.log, g.snap);
  expect([h.sim.wave, h.sim.phase, h.ticks, h.level]).toEqual([
    g.sim.wave,
    'wave',
    g.ticks,
    g.level,
  ]);
  for (const x of [g, h]) while (x.sim.wave === g.sim.lastWave + 2) x.tick();
  expect(h.snap).toBe(g.snap);
});

test('rules-6 version-1 snapshot falls back to the historical command log', () => {
  const g = newGame(7, 'easy', [], 'classic', 6);
  play(g, [8, 10, 12, 14]);
  const legacy = JSON.parse(g.snap);
  legacy.v = 1;
  for (const key of ['pendingEvent', 'activeEvent', 'eventGold', 'eventXp'])
    delete legacy.game[key];
  g.run(['place', 10, 16]);
  const resumed = newGame(7, 'easy', [], 'classic', 6);
  resumed.resume(g.log, JSON.stringify(legacy));
  const replayed = newGame(7, 'easy', [], 'classic', 6);
  replayed.resume(g.log);
  expect(resumed.log).toEqual(replayed.log);
  expect(resumed.snap).toBe(replayed.snap);
  expect(resumed.placed.map((t) => t.def.name)).toEqual(replayed.placed.map((t) => t.def.name));
});
