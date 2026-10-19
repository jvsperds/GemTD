/** Seeded, optional run goals. This module has no game RNG so contracts cannot change game rolls. */
export interface ChallengeContract {
  id: 'no-stones' | 'special-limit';
  name: string;
  tip: string;
  reward: number;
  limit?: number;
}

const CONTRACTS: ChallengeContract[] = [
  {
    id: 'no-stones',
    name: 'Untouched Maze',
    tip: 'Clear wave 50 without removing a stone.',
    reward: 10,
  },
  {
    id: 'special-limit',
    name: 'Focused Build',
    tip: 'Clear wave 50 after building no more than 3 special towers.',
    reward: 10,
    limit: 3,
  },
];

export function contractAt(seed: number): ChallengeContract {
  let h = (seed ^ 0x6d2b79f5) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 1 | h);
  h = (h + Math.imul(h ^ (h >>> 7), 61 | h)) ^ h;
  h = (h ^ (h >>> 14)) >>> 0;
  return { ...CONTRACTS[h % CONTRACTS.length] };
}
