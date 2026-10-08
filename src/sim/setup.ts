// One place that wires data → Maze/WaveSim/Combat/Game, so live games and replays match.
import gems from '../../data/gems.json';
import map from '../../data/map.json';
import quality from '../../data/quality_levels.json';
import towerData from '../../data/towers.json';
import waves from '../../data/waves.json';
import { ancientGems, ENDGAME_TOWERS } from './endgame';
import { Game, type LevelDef } from './game';
import { PEDALS } from './pedals';
import { Maze, type MapData } from './maze';
import { allDefs, Combat, type GemDef, type SpecialDef } from './towers';
import { WaveSim, type WaveEntry } from './waves';

const GEMS = gems as Record<string, GemDef>;
export const DEFS = allDefs(
  { ...GEMS, ...ancientGems(GEMS) },
  { ...(towerData as unknown as Record<string, SpecialDef>), ...ENDGAME_TOWERS, ...PEDALS },
);

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

/** Optional rule changes picked at new game; they're saved with the run and shown on its score. */
export const MUTATORS: Record<string, { name: string; tip: string }> = {
  swift: { name: 'Swift', tip: 'Creeps move 30% faster' },
  tough: { name: 'Tough', tip: 'Creeps have double HP; kills pay double gold' },
  nomerge: { name: 'No merges', tip: 'Merge ×2 and ×4 are disabled' },
  bosses: { name: 'Cunning bosses', tip: 'Bosses blink, shield, rush or split on death' },
};

/** Layouts: same grid and walls, different checkpoint order. */
const classic = map as unknown as MapData;
export const MAPS: Record<string, { name: string; data: MapData }> = {
  classic: { name: 'Classic', data: classic },
  // Top, left, bottom, right, then the centre: every leg crosses the middle.
  cross: {
    name: 'Crossroads',
    data: {
      ...classic,
      checkpoints: [
        [18, 4],
        [4, 18],
        [18, 32],
        [32, 18],
        [18, 18],
      ],
    },
  },
};

export function newGame(
  seed: number,
  difficulty: Difficulty = 'normal',
  mutators: string[] = [],
  mapId = 'classic',
) {
  const on = (m: string) => mutators.includes(m);
  const data = (MAPS[mapId] ?? MAPS.classic).data;
  const sim = new WaveSim(new Maze(data), waves as WaveEntry[], seed);
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
  if (on('swift')) sim.speedMult = 1.3;
  if (on('tough')) [sim.hpMult, g.goldMult] = [sim.hpMult * 2, 2];
  g.noMerge = on('nomerge');
  sim.bossTricks = on('bosses');
  return g;
}

/** Same seed for everyone on a given local date (daily challenge). */
export function dailySeed(date = new Date()) {
  const s = `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
  let h = 2166136261;
  for (const ch of s) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return h >>> 0;
}
