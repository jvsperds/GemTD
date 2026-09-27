/// <reference types="vite/client" />
// Headless balance bot (BUILD.md §5). Skipped in `npm test`; run with `npm run balance`.
import { test } from 'vitest';
import { GEMS_PER_ROUND, type Game } from '../src/sim/game';
import { newGame } from '../src/sim/setup';

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

test.skipIf(import.meta.env.MODE !== 'balance')('balance report', { timeout: 3_600_000 }, () => {
  const N = Number(process.env.SEEDS ?? 8);
  for (const buy of [true, false]) {
    const runs = Array.from({ length: N }, (_, i) => bot(1000 + i, 'normal', buy));
    const reach = (w: number) => runs.filter((r) => r.wave >= w).length / N;
    const lvl9 = runs.map((r) => Object.entries(r.levelAt).find(([, l]) => l >= 9)?.[0] ?? '-');
    console.log(
      `${buy ? 'buys levels' : 'never buys'}: waves cleared ${runs.map((r) => r.wave).join(' ')}` +
        ` | reach w10 ${reach(10)} w20 ${reach(20)} w30 ${reach(30)} w40 ${reach(40)} win ${reach(50)}` +
        ` | level 9 at wave ${lvl9.join(' ')} | final level ${runs.map((r) => r.levelAt[r.wave + 1] ?? r.levelAt[r.wave]).join(' ')}`,
    );
  }
});
