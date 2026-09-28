import { expect, test } from 'vitest';
import towers from '../data/towers.json';
import waves from '../data/waves.json';
import { hasCreepModel, hasModel, shotKind, slug, sortByY } from '../src/render';

test('sortByY orders by ground y in place', () => {
  const a = [5, 1, 4, 1, 3].map((y) => ({ y }));
  sortByY(a);
  expect(a.map((o) => o.y)).toEqual([1, 1, 3, 4, 5]);
});

test('every special tower has a model', () => {
  const missing = Object.keys(towers).filter((n) => !hasModel(slug(n)));
  expect(missing).toEqual([]);
});

test('shot kinds: named beams and lightning, slow towers shoot frost', () => {
  const combat = {
    tfx: (t: { def: { name: string } }) => ({ slow: t.def.name === 'B1' ? 20 : 0, frost: false }),
  };
  const kind = (name: string) => shotKind(combat as never, { def: { name } } as never);
  expect(['Silver Knight', 'Pink Diamond', 'B1', 'R1'].map(kind)).toEqual([
    'beam',
    'lightning',
    'frost',
    'normal',
  ]);
});

test('every wave creep has a model', () => {
  const missing = waves.map((w) => w.name).filter((n) => !hasCreepModel(slug(n)));
  expect(missing).toEqual([]);
});
