import { expect, test } from 'vitest';
import { newlyDone } from '../src/quests';

test('quests complete once and read the run', () => {
  const run = {
    won: true,
    waves: 50,
    difficulty: 'hard',
    daily: false,
    fullHp: false,
    maxLevel: false,
    towers: ['Uranium-238'],
  };
  const ids = newlyDone(run).map((q) => q.id);
  expect(ids).toEqual(['w10', 'win', 'hard', 'u238']);
  expect(newlyDone(run, ids)).toEqual([]);
});
