// Quests: one-off goals checked when a run ends; each pays shells the first time it's met.
import specials from '../data/towers.json';

export interface Run {
  won: boolean;
  waves: number; // cleared
  difficulty: string;
  daily: boolean;
  fullHp: boolean;
  maxLevel: boolean;
  towers: string[]; // names on the board at the end
}
export interface Quest {
  id: string;
  name: string;
  tip: string;
  shells: number;
  done: (r: Run) => boolean;
}

const SPECIAL = new Set(Object.values(specials).map((t) => t.name));

export const QUESTS: Quest[] = [
  { id: 'w10', name: 'Hold the line', tip: 'Clear wave 10', shells: 2, done: (r) => r.waves >= 10 },
  { id: 'win', name: 'Crowned', tip: 'Clear all 50 waves', shells: 10, done: (r) => r.won },
  {
    id: 'hard',
    name: 'Iron castle',
    tip: 'Win on Hard',
    shells: 20,
    done: (r) => r.won && r.difficulty === 'hard',
  },
  {
    id: 'flawless',
    name: 'Untouched',
    tip: 'Win without losing castle HP',
    shells: 25,
    done: (r) => r.won && r.fullHp,
  },
  {
    id: 'e60',
    name: 'Beyond the map',
    tip: 'Clear endless wave 60',
    shells: 10,
    done: (r) => r.waves >= 60,
  },
  {
    id: 'e80',
    name: 'Deep endless',
    tip: 'Clear endless wave 80',
    shells: 20,
    done: (r) => r.waves >= 80,
  },
  {
    id: 'daily',
    name: 'Daily grind',
    tip: 'Clear wave 20 in a daily run',
    shells: 5,
    done: (r) => r.daily && r.waves >= 20,
  },
  {
    id: 'u238',
    name: 'Half-life',
    tip: 'End a run with Uranium-238 on the board',
    shells: 5,
    done: (r) => r.towers.includes('Uranium-238'),
  },
  {
    id: 'prince',
    name: 'Royal line',
    tip: 'End a run with The Crown Prince on the board',
    shells: 5,
    done: (r) => r.towers.includes('The Crown Prince'),
  },
  {
    id: 'jeweller',
    name: 'Jeweller',
    tip: 'End a run with 5 different special towers',
    shells: 8,
    done: (r) => new Set(r.towers.filter((n) => SPECIAL.has(n))).size >= 5,
  },
  {
    id: 'maxlvl',
    name: 'Master builder',
    tip: 'Reach the top builder level',
    shells: 5,
    done: (r) => r.maxLevel,
  },
];

/** Quests this run completes that weren't already done. */
export const newlyDone = (r: Run, have: string[] = []) =>
  QUESTS.filter((q) => !have.includes(q.id) && q.done(r));
