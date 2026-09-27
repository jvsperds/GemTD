import { expect, test } from 'vitest';
import { newGame } from '../src/sim/setup';

// BUILD.md Phase 8: late-game (wave 30+) sim cost with a full board. The 4 ms tick budget is for a
// mid laptop; requiring < 1 ms here leaves 4× headroom for a low-end one.
test('wave 31 with 60 towers ticks well inside the budget', () => {
  const g = newGame(5);
  const specials = ['Silver Knight', 'Volcano', 'Red Coral', 'Emerald Golem', 'Uranium-235'];
  let n = 0;
  for (let r = 5; r < 34 && n < 60; r += 2)
    for (const c of [3, 5, 17, 19, 31, 33]) {
      const t = n < 60 && g.combat.place('D5', c, r);
      if (t) t.def = g.combat.gems[n++ % 3 ? 'R5' : specials[n % specials.length]];
    }
  expect(n).toBe(60);
  g.sim.wave = 30;
  g.sim.castleHp = 1e9;
  g.sim.startWave();
  for (let i = 0; i < 300; i++) g.tick(); // warm up, creeps on the board
  const t0 = performance.now();
  let ticks = 0;
  for (; ticks < 1500 && g.sim.phase === 'wave'; ticks++) g.tick();
  const ms = (performance.now() - t0) / ticks;
  console.log(
    `wave 31: ${ms.toFixed(3)} ms/tick over ${ticks} ticks, ${g.sim.creeps.length} creeps`,
  );
  expect(ticks).toBeGreaterThan(300);
  expect(ms).toBeLessThan(1);
});
