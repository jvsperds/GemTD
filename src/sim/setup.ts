// One place that wires data → Maze/WaveSim/Combat/Game, so live games and replays match.
import gems from '../../data/gems.json';
import map from '../../data/map.json';
import quality from '../../data/quality_levels.json';
import towerData from '../../data/towers.json';
import waves from '../../data/waves.json';
import { ancientGems, ENDGAME, ENDGAME_TOWERS } from './endgame';
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
// hp is tuned with `npm run balance` (skilled bot, Quartz, no hero skills, 40 seeds) for win rates
// of 68% easy, 33% normal, 10% hard. Easy has more HP than normal because its perks (copies
// stack, recipe luck, levels past 9) are worth more than the difference. `shells` multiplies the shells a run pays.
export const DIFFICULTY = {
  easy: { hp: 3, bonus: 0, shells: 1 },
  normal: { hp: 2.3, bonus: 200, shells: 2 },
  hard: { hp: 3.4, bonus: 500, shells: 3 },
} as const;
export type Difficulty = keyof typeof DIFFICULTY;
/** Creep HP of runs started under rules 1 to 3. */
const OLD_HP = { easy: 0.7, normal: 1, hard: 1.5 };

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

/** Rule set of new games. A run records its own, so a save or Watch replay from before a change to
 *  the sim's numbers still plays out the same. 2: Sunder and Soul Harvest lag in endless.
 *  3: they lag twice as fast (4% per wave), as MVP and kill bonuses kept runs going past wave 300.
 *  4: harder creeps per difficulty, 10% lag, easy's extra levels must be bought.
 *  5: poison takes a share of max HP, chain lightning scales with attack damage, MVP caps at 10.
 *  6: the difficulty's creep HP multiplier ramps up from ×1 on wave 1. */
export const RULES = 6;

export function newGame(
  seed: number,
  difficulty: Difficulty = 'normal',
  mutators: string[] = [],
  mapId = 'classic',
  rules = RULES,
) {
  const on = (m: string) => mutators.includes(m);
  const data = (MAPS[mapId] ?? MAPS.classic).data;
  const sim = new WaveSim(new Maze(data), waves as WaveEntry[], seed);
  sim.hpMult = rules < 4 ? OLD_HP[difficulty] : DIFFICULTY[difficulty].hp;
  if (rules >= 6) sim.hpEase = 1 / sim.hpMult;
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
  if (rules < 4) g.combat.endgameLag = rules < 2 ? 1 : rules < 3 ? ENDGAME.lag2 : ENDGAME.lag3;
  // Levels past the XP curve (easy) all shared its last threshold, so buying one gave the rest free.
  else g.xpFor.forEach((x, i) => i && x === g.xpFor[i - 1] && (g.xpFor[i] = Infinity));
  if (rules < 5) [g.combat.poisonHp, g.combat.chainPct, g.mvpCap] = [0, 0, Infinity];
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
