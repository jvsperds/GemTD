// Heroes: picked before a game, unlocked with shells. Named after minerals that aren't tower gems.
// Each passive is a plain multiplier or bonus the sim reads; unset = no effect.
// ponytail: passive sizes are first guesses until playtests.
export interface Perk {
  killGold?: number; // +fraction of kill gold
  xp?: number; // +fraction of XP
  levelCost?: number; // -fraction of level-up gold
  skillGold?: number; // -fraction of hero skill gold
  duration?: number; // +fraction of hero skill durations
  bossBite?: number; // boss leaks deal this much less
  attackSpeed?: number; // +% attack speed, all towers
  qualityUp?: number; // chance a placed gem rolls one quality higher
  startGold?: number; // gold at the start of the game
  bossGold?: number; // +fraction of boss kill gold
  execute?: number; // chance a tower hit kills a non-boss creep outright
  luckyCrit?: number; // chance a tower hit deals triple damage
  bash?: number; // chance a tower hit stuns
  midas?: number; // chance a kill pays triple gold
  extraSkill?: boolean; // bring one more skill
}
export type Rarity = 'Common' | 'Rare' | 'Epic' | 'Legendary';
export interface HeroDef {
  name: string;
  title: string;
  icon: string;
  rarity: Rarity;
  shells: number; // unlock price; 0 = owned from the start
  tip: string;
  perk: Perk;
}
export const RARITY_COLOR: Record<Rarity, string> = {
  Common: '#9aa4ae',
  Rare: '#3a8bff',
  Epic: '#a24de0',
  Legendary: '#f2c52e',
};
export const HEROES: Record<string, HeroDef> = {
  quartz: {
    name: 'Quartz',
    title: 'the Prospector',
    icon: '🪨',
    rarity: 'Common',
    shells: 0,
    tip: '+15% gold from kills',
    perk: { killGold: 0.15 },
  },
  garnet: {
    name: 'Garnet',
    title: 'the Warden',
    icon: '🛡',
    rarity: 'Common',
    shells: 25,
    tip: 'Boss bites on the castle deal 3 less damage',
    perk: { bossBite: 3 },
  },
  onyx: {
    name: 'Onyx',
    title: 'the Scholar',
    icon: '📜',
    rarity: 'Rare',
    shells: 60,
    tip: '+25% XP · level-ups cost 10% less gold',
    perk: { xp: 0.25, levelCost: 0.1 },
  },
  citrine: {
    name: 'Citrine',
    title: 'the Merchant',
    icon: '💰',
    rarity: 'Rare',
    shells: 60,
    tip: 'Hero skills cost 25% less gold · +10% gold from kills',
    perk: { skillGold: 0.25, killGold: 0.1 },
  },
  obsidian: {
    name: 'Obsidian',
    title: 'the Warlord',
    icon: '⚔',
    rarity: 'Epic',
    shells: 150,
    tip: '+15% attack speed for every tower',
    perk: { attackSpeed: 15 },
  },
  moonstone: {
    name: 'Moonstone',
    title: 'the Chronomancer',
    icon: '🌙',
    rarity: 'Epic',
    shells: 150,
    tip: 'Hero skill effects last 50% longer · bring 6 skills',
    perk: { duration: 0.5, extraSkill: true },
  },
  prism: {
    name: 'Prism',
    title: 'the Gemheart',
    icon: '🔆',
    rarity: 'Legendary',
    shells: 400,
    tip: '12% chance each gem placed rolls one quality higher · +10% gold from kills',
    perk: { qualityUp: 0.12, killGold: 0.1 },
  },
};
export const DEFAULT_HERO = 'quartz';
