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

export function newGame(seed: number, difficulty: Difficulty = 'normal') {
  const sim = new WaveSim(new Maze(map as unknown as MapData), waves as WaveEntry[], seed);
  sim.hpMult = DIFFICULTY[difficulty].hp;
  const g = new Game(new Combat(sim, DEFS, seed), quality.levels as LevelDef[], seed);
  g.bonusPerWave = DIFFICULTY[difficulty].bonus;
  g.combat.stackCopies = difficulty === 'easy';
  return g;
}

/** Same seed for everyone on a given local date (daily challenge). */
export function dailySeed(date = new Date()) {
  const s = `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
  let h = 2166136261;
  for (const ch of s) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return h >>> 0;
}
