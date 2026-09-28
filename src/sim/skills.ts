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
export const goldOf = (id: string, lvl: number) => {
  const g = SKILLS[id].gold;
  return typeof g === 'number' ? g : g[Math.max(1, lvl) - 1];
};
export type Loadout = Record<string, number>; // skill id -> level 1..4
/** Shells for a finished game. ponytail: flat rate until playtests. */
export const shellsFor = (wavesCleared: number, won: boolean) => wavesCleared + (won ? 10 : 0);
export const skillTip = (id: string, lvl: number) =>
  SKILLS[id].tip.replace('{v}', String(SKILLS[id].value[Math.max(1, lvl) - 1]));
