import { expect, test } from 'vitest';
import { newGame } from '../src/sim/setup';
import { ENDLESS_BOSS, SPLIT } from '../src/sim/waves';

test('cunning boss at wave 40 splits into smaller creeps on death', () => {
  const { sim } = newGame(1, 'normal', ['bosses']);
  sim.wave = 39;
  sim.startWave();
  sim.tick(); // spawns the boss
  const boss = sim.creeps[0];
  expect(boss.def.boss).toBe(true);
  sim.damage(boss, boss.hp);
  const kids = sim.creeps.filter((c) => c.alive);
  expect(kids).toHaveLength(SPLIT.n);
  expect(kids.every((c) => !c.def.boss && c.hp === boss.def.hp * SPLIT.hp)).toBe(true);
});

test('swift, tough and no-merge change the rules; plain games are untouched', () => {
  const plain = newGame(1);
  const g = newGame(1, 'normal', ['swift', 'tough', 'nomerge']);
  expect(g.sim.speedMult).toBe(1.3);
  expect(g.sim.hpMult).toBe(plain.sim.hpMult * 2);
  expect([g.goldMult, g.noMerge, plain.noMerge]).toEqual([2, true, false]);
  expect(plain.sim.bossTricks).toBe(false);
});

test('deep-endless cunning bosses split into a bounded crowd', () => {
  const { sim } = newGame(1, 'normal', ['bosses']);
  sim.wave = sim.lastWave + 9 * ENDLESS_BOSS.every - 1; // endless boss wave with boss_split
  sim.streak = 99;
  sim.startWave();
  expect(sim.bosses).toBe(ENDLESS_BOSS.max);
  for (let i = 0; i < 2000 && sim.creeps.length < sim.bosses; i++) sim.tick();
  for (const b of sim.creeps.filter((c) => c.def.boss)) sim.damage(b, b.hp);
  expect(sim.creeps.filter((c) => c.alive)).toHaveLength(ENDLESS_BOSS.max * SPLIT.n);
});
