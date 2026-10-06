// End-game towers for long endless runs (issue #83). Quality 7 "Ancient" gems are combined from
// two Great (Q6) gems of one type anywhere on the board; nothing rolls or merges into Q7. Each
// end-game tower is a top special tower + an Ancient gem, and adds damage that keeps up with
// endless HP scaling (×1.15 per wave): a % of the target's max HP, or damage grown from kills.
// ponytail: stats and percentages are first guesses; tune with long `npm run balance` runs.
import type { GemDef, SpecialDef } from './towers';

/** Ability values: `endgame_maxhp` % of max HP per hit (half on bosses), `endgame_souls` % of a
 *  killed creep's max HP added to the tower's attack damage for good. */
export const ENDGAME = { maxHp: 0.02, bossMaxHp: 0.5, souls: 0.01 };

export function ancientGems(gems: Record<string, GemDef>) {
  const out: Record<string, GemDef & Pick<SpecialDef, 'recipes'>> = {};
  for (const g of Object.values(gems))
    if (g.quality === 6) {
      const code = g.type + 7;
      out[code] = {
        ...g,
        name: g.name.replace(/^\S+/, 'Ancient'),
        quality: 7,
        damage: g.damage * 3,
        bonusDamage: g.bonusDamage * 3,
        range: g.range + 100,
        recipes: [[g.type + 6, g.type + 6]],
      };
    }
  return out;
}

const tower = (
  name: string,
  base: string,
  gem: string,
  damage: number,
  bonusDamage: number,
  attackRate: number,
  range: number,
  abilities: string[],
): SpecialDef => ({
  name,
  damage,
  bonusDamage,
  attackRate,
  range,
  abilities,
  recipes: [[base, gem]],
  secret: false,
});

export const ENDGAME_TOWERS: Record<string, SpecialDef> = Object.fromEntries(
  [
    tower('Regent Diamond', 'Koh-i-noor Diamond', 'D7', 2000, 1920, 0.6, 800, [
      'tower_jianshe3',
      'tower_baoji1',
      'tower_jianjia6',
      'endgame_maxhp',
    ]),
    tower('Kyparium Core', 'Depleted-Kyparium', 'Q7', 300, 960, 0.4, 9000, [
      'tower_fenliejian_you',
      'endgame_maxhp',
    ]),
    tower('The Blood King', 'The Crown Prince', 'R7', 700, 0, 0.8, 900, [
      'tower_chazhuangshandian',
      'tower_huiyao3',
      'tower_du6',
      'endgame_souls',
    ]),
    tower('Cullinan Heart', 'Diamond Cullinan', 'B7', 7500, 1920, 0.5, 1300, [
      'tower_jingzhun',
      'tower_shechengguanghuan',
      'tower_baoji1',
      'tower_slow6',
      'endgame_souls',
    ]),
    tower('Star of Eden', 'Sapphire Star Of Adam', 'G7', 720, 0, 0.8, 900, [
      'tower_du6',
      'tower_jianjia6',
      'tower_bixi2',
      'tower_jihan',
      'endgame_maxhp',
      'endgame_souls',
    ]),
  ].map((t) => [t.name, t]),
);

/** Ability id → name and tooltip, for the tower panel. */
export const ENDGAME_TIPS = new Map([
  [
    'endgame_maxhp',
    {
      name: 'Sunder',
      tip: `Each hit also deals ${ENDGAME.maxHp * 100}% of the target's max HP as pure damage (half on bosses)`,
    },
  ],
  [
    'endgame_souls',
    {
      name: 'Soul Harvest',
      tip: `Each kill adds ${ENDGAME.souls * 100}% of the creep's max HP to this tower's attack damage, for good`,
    },
  ],
]);
