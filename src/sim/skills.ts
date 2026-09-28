import { HEROES } from './heroes';
// Hero skills (BUILD.md §2.7, data/raw/hero_abilities.json). Unlocked between games with shells,
// cast in game for gold. Values per skill level 1..4.
export interface SkillDef {
  name: string;
  icon: string;
  tip: string;
  gold: number | number[]; // per cast, or per skill level
  shells: number[]; // price of level 1..4
  value: number[];
  tower?: boolean; // cast on the selected tower
  picks?: string[]; // map cells to click after the button, one prompt each
  build?: boolean; // only in the build phase
  pray?: { gem?: string; quality?: number }; // biases the next gem placed (value = % chance)
}
export const DURATION = 60; // seconds of wave time (last_time)
const CASTLE = [5, 10, 20, 40],
  PRAY = [10, 20, 40, 80],
  TOWER = [15, 30, 60, 120];
const GEM_NAMES: [string, string, string][] = [
  ['B', 'Sapphire', '🔷'],
  ['D', 'Diamond', '💎'],
  ['E', 'Opal', '⚪'],
  ['G', 'Emerald', '🟢'],
  ['P', 'Amethyst', '🟣'],
  ['Q', 'Aquamarine', '🩵'],
  ['R', 'Ruby', '🔴'],
  ['Y', 'Topaz', '🟡'],
];
export const SKILLS: Record<string, SkillDef> = {
  heal: {
    name: 'Heal',
    icon: '✚',
    tip: 'Heal the castle for 1 to {v} HP',
    gold: 400,
    shells: CASTLE,
    value: [10, 13, 15, 16],
  },
  guard: {
    name: 'Guard',
    icon: '🛡',
    tip: `Each bite on the castle deals {v} less damage for ${DURATION}s of wave time`,
    gold: 300,
    shells: CASTLE,
    value: [1, 2, 3, 4],
  },
  evade: {
    name: 'Evade',
    icon: '💨',
    tip: `{v}% chance the castle dodges a bite for ${DURATION}s of wave time`,
    gold: 200,
    shells: CASTLE,
    value: [10, 15, 20, 25],
  },
  haste: {
    name: 'Haste',
    icon: '⚡',
    tip: `+{v}% attack speed for this tower for ${DURATION}s of wave time`,
    gold: 200,
    shells: TOWER,
    value: [60, 80, 100, 120],
    tower: true,
  },
  aim: {
    name: 'Aim',
    icon: '🎯',
    tip: `Raise this tower's attack range to at least {v} for ${DURATION}s of wave time`,
    gold: 100,
    shells: TOWER,
    value: [1000, 1200, 1400, 1600],
    tower: true,
  },
  hammer: {
    name: 'Fixed Hammer',
    icon: '🔨',
    tip: "Downgrade one of this round's gems by exactly one quality level",
    gold: [250, 150, 100, 75],
    shells: TOWER,
    value: [1, 1, 1, 1],
    tower: true,
  },
  flawless: {
    name: 'Flawless Pray',
    icon: '🙏',
    tip: '{v}% chance the next gem placed is Flawless',
    gold: 300,
    shells: TOWER,
    value: [29, 41, 47, 50],
    pray: { quality: 4 },
  },
  perfect: {
    name: 'Perfect Pray',
    icon: '🌟',
    tip: '{v}% chance the next gem placed is Perfect',
    gold: 400,
    shells: [20, 40, 80, 160],
    value: [6, 14, 18, 20],
    pray: { quality: 5 },
  },
  revenge: {
    name: 'Revenge',
    icon: '🔥',
    tip: `While the castle is below {v} HP, towers deal +1% damage per missing HP, for ${DURATION}s of wave time`,
    gold: 200,
    shells: CASTLE,
    value: [50, 60, 70, 80],
  },
  crit: {
    name: 'Crit',
    icon: '💥',
    tip: `20% chance for this tower to crit for {v}× damage, for ${DURATION}s of wave time`,
    gold: 200,
    shells: TOWER,
    value: [5, 6, 7, 8],
    tower: true,
  },
  bonds: {
    name: 'Fatal Bonds',
    icon: '⛓',
    tip: `This tower's attacks also deal {v}% as pure damage to the farthest enemy, for ${DURATION}s of wave time`,
    gold: 200,
    shells: TOWER,
    value: [70, 80, 90, 100],
    tower: true,
  },
  adjswap: {
    name: 'Adja-Swap',
    icon: '🔀',
    tip: 'Swap this tower with a random stone in the 8 cells around it',
    gold: [250, 150, 100, 75],
    shells: TOWER,
    value: [1, 1, 1, 1],
    tower: true,
    build: true,
  },
  swap: {
    name: 'Swap',
    icon: '⇄',
    tip: 'Swap the positions of this tower and another tower',
    gold: [400, 300, 250, 225],
    shells: [20, 40, 80, 160],
    value: [1, 1, 1, 1],
    tower: true,
    picks: ['Click the tower to swap with'],
    build: true,
  },
  stonehenge: {
    name: 'StoneHenge',
    icon: '🗿',
    tip: 'Build up to {v} stones in a line, until blocked',
    gold: 50,
    shells: TOWER,
    value: [4, 8, 12, 16],
    picks: ['Click where the line starts', 'Click a cell in the direction to build'],
    build: true,
  },
  whirl: {
    name: 'Ursol Whirl',
    icon: '🌀',
    tip: 'Turn the stones and towers around a cell counter-clockwise by one cell',
    gold: [200, 125, 75, 50],
    shells: TOWER,
    value: [1, 1, 1, 1],
    picks: ['Click the centre of the whirl'],
    build: true,
  },
  candy: {
    name: 'Candy Marker',
    icon: '🍬',
    tip: 'Creeps of the next wave walk to the candy before their normal path',
    gold: [350, 275, 225, 200],
    shells: [20, 40, 80, 160],
    value: [1, 1, 1, 1],
    picks: ['Click an open cell for the candy'],
    build: true,
  },
  timelapse: {
    name: 'TimeLapse',
    icon: '⏪',
    tip: "Take back this round's gems and place 5 new ones",
    gold: [600, 500, 400, 300],
    shells: TOWER,
    value: [1, 1, 1, 1],
    build: true,
  },
  ...Object.fromEntries(
    GEM_NAMES.map(([gem, name, icon]) => [
      'pray' + gem,
      {
        name: `${name} Pray`,
        icon,
        tip: `{v}% chance the next gem placed is a ${name}`,
        gold: 200,
        shells: PRAY,
        value: [40, 55, 65, 70],
        pray: { gem },
      },
    ]),
  ),
};
/** Most skills a game can bring. */
export const MAX_BRING = 5;
/** Skills a hero may bring (some heroes carry one more). */
export const bringLimit = (hero: string) => MAX_BRING + (HEROES[hero]?.perk.extraSkill ? 1 : 0);
export const goldOf = (id: string, lvl: number) => {
  const g = SKILLS[id].gold;
  return typeof g === 'number' ? g : g[Math.max(1, lvl) - 1];
};
export type Loadout = Record<string, number>; // skill id -> level 1..4
/** Shells for a finished game. ponytail: flat rate until playtests. */
export const MAX_SHELLS = 20;
export const shellsFor = (wavesCleared: number, won: boolean) =>
  Math.min(MAX_SHELLS, Math.floor(wavesCleared / 3) + (won ? 4 : 0)); // full clear: 16 + 4
export const skillTip = (id: string, lvl: number) =>
  SKILLS[id].tip.replace('{v}', String(SKILLS[id].value[Math.max(1, lvl) - 1]));
