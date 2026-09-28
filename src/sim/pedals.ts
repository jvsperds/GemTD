// Pedals (BUILD.md §2.5): 2-gem utility blocks, built with Combine like special towers and
// upgraded 3× same → Sparkling → 3× → Blingbling. They never attack: combined pedals go into the
// hand and are laid on open path cells; a ground creep stepping on one sets off its spell, then it
// cools down. Values per tier from data/raw/pedals.json.
// ponytail: cooldown, Ensnare root and Paralysis bounces are guesses until the Lua values are known.
import type { SpecialDef } from './towers';

export const PEDAL = { cooldown: 8 };
export const TIERS = ['', 'Sparkling ', 'Blingbling '];

/** Spell tables per tier (0 base, 1 Sparkling, 2 Blingbling). */
export const SPELL = {
  ensnare: { root: [2, 3, 4] },
  gale: { radius: 300, slowPct: [0.5, 0.7, 0.9], time: [5, 7, 11] },
  torrent: { radius: 256, stun: [2, 4, 8], slowPct: [0.4, 0.6, 0.8], slowTime: [8, 10, 12] },
  howl: { radius: [256, 384, 512], dmg: [0.2, 0.4, 0.8], time: 10 },
  acid: { radius: 625, armor: [8, 16, 32], time: [10, 15, 20] },
  paralysis: { range: 1000, bounces: [6, 8, 10], stun: 1 },
  terrorize: { amp: [0.5, 1, 2], slowPct: 0.3, time: [6, 8, 10] },
  decrepify: { slowPct: [0.5, 0.7, 0.9], mr: [30, 60, 90], time: [5, 6, 7] },
} as const;
export type Spell = keyof typeof SPELL;

const BASE: [name: string, spell: Spell, recipe: string[], tip: string][] = [
  ['Ensnare', 'ensnare', ['Y3', 'D2'], 'Roots the creep in place'],
  ['Gale', 'gale', ['G3', 'E2'], 'Slows creeps around the target by %'],
  ['Torrent', 'torrent', ['B3', 'Q2'], 'Stuns creeps around the target, then slows them'],
  ['Howl', 'howl', ['P3', 'R2'], 'Towers near the pedal deal more damage for 10s'],
  ['Acid', 'acid', ['Q3', 'Y2'], 'Reduces armor of creeps in a wide area; pierces spell immunity'],
  ['Paralysis', 'paralysis', ['R3', 'G2'], 'A cask bounces between creeps, stunning each 1s'],
  [
    'Terrorize',
    'terrorize',
    ['D3', 'P2'],
    'The creep is slowed and takes more damage; pierces spell immunity',
  ],
  ['Decrepify', 'decrepify', ['E3', 'B2'], 'Slows the creep and lowers its magic resist'],
];

export const PEDALS: Record<string, SpecialDef> = {};
/** Ability id → [name, tooltip], for the tower panel. */
export const PEDAL_TIPS = new Map<string, { name: string; tip: string }>();
for (const [name, spell, recipe, tip] of BASE)
  TIERS.forEach((tier, i) => {
    const n = `${tier}${name} Pedal`,
      id = `pedal_${spell}${i + 1}`;
    PEDALS[n] = {
      name: n,
      damage: 0,
      bonusDamage: 0,
      attackRate: PEDAL.cooldown,
      range: 0,
      abilities: [id],
      recipes: [i ? Array(3).fill(`${TIERS[i - 1]}${name} Pedal`) : recipe],
      secret: false,
      pedal: true,
    };
    PEDAL_TIPS.set(id, { name: `${tier}${name}`, tip });
  });

/** Spell and tier (0..2) of a pedal ability id, e.g. `pedal_gale2` → ['gale', 1]. */
export function pedalOf(id: string): [Spell, number] | null {
  const m = id.match(/^pedal_(\w+?)(\d)$/);
  return m ? [m[1] as Spell, +m[2] - 1] : null;
}
