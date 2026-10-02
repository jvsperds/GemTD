// One place that wires data → Maze/WaveSim/Combat/Game, so live games and replays match.
import gems from '../../data/gems.json';
import map from '../../data/map.json';
import quality from '../../data/quality_levels.json';
import towerData from '../../data/towers.json';
import waves from '../../data/waves.json';
import { Game, type LevelDef } from './game';
import { PEDALS } from './pedals';
import { Maze, type MapData } from './maze';
import { allDefs, Combat, type GemDef, type SpecialDef } from './towers';
import { WaveSim, type WaveEntry } from './waves';

export const DEFS = allDefs(gems as Record<string, GemDef>, {
  ...(towerData as unknown as Record<string, SpecialDef>),
  ...PEDALS,
});

// ponytail: difficulty only scales creep HP (BUILD.md §3.7: endless scaling is HP/armor too).
export const DIFFICULTY = {
  easy: { hp: 0.7, bonus: 0 },
  normal: { hp: 1, bonus: 200 },
  hard: { hp: 1.5, bonus: 500 },
} as const;
export type Difficulty = keyof typeof DIFFICULTY;

export const EASY_PERFECT_CAP = 10;

/** Easy: levels go past 9, each moving 10% from the lowest quality to Perfect/Great (5% each,
 *  Perfect capped at EASY_PERFECT_CAP% with the rest going to Great). */
export function easyLevels(base: LevelDef[]) {
  const out = base.map((l) => ({ ...l, odds: [...l.odds, 0] }));
  for (;;) {
    const last = out[out.length - 1];
    const odds = [...last.odds];
    const low = odds.findIndex((p) => p > 0);
    if (low >= 4) break; // all Perfect/Great already
    odds[low] -= 10;
    const perfect = Math.min(5, EASY_PERFECT_CAP - odds[5]);
    odds[5] += perfect;
    odds[4] += 10 - perfect;
    const prev = out[out.length - 2].upgradeCost!;
    last.upgradeCost ??= prev + 30;
    out.push({ level: last.level + 1, odds, upgradeCost: null });
  }
  return out;
}

export function newGame(seed: number, difficulty: Difficulty = 'normal') {
  const sim = new WaveSim(new Maze(map as unknown as MapData), waves as WaveEntry[], seed);
  sim.hpMult = DIFFICULTY[difficulty].hp;
  const levels = quality.levels as LevelDef[];
  const g = new Game(
    new Combat(sim, DEFS, seed),
    difficulty === 'easy' ? easyLevels(levels) : levels,
    seed,
  );
  g.bonusPerWave = DIFFICULTY[difficulty].bonus;
  g.combat.stackCopies = difficulty === 'easy';
  if (difficulty === 'easy') [g.recipeLuck, g.endlessBuild] = [0.03, true];
  return g;
}

/** Same seed for everyone on a given local date (daily challenge). */
export function dailySeed(date = new Date()) {
  const s = `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
  let h = 2166136261;
  for (const ch of s) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return h >>> 0;
}
