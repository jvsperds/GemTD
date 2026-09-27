import { expect, test } from 'vitest';
import { sortByY } from '../src/render';

test('sortByY orders by ground y in place', () => {
  const a = [5, 1, 4, 1, 3].map((y) => ({ y }));
  sortByY(a);
  expect(a.map((o) => o.y)).toEqual([1, 1, 3, 4, 5]);
});
