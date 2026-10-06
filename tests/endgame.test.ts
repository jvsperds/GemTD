import { expect, test } from 'vitest';
import { short } from '../src/dmgchart';
import { ENDGAME } from '../src/sim/endgame';
import { newGame } from '../src/sim/setup';
import { newCreep, type WaveEntry } from '../src/sim/waves';

test('short() keeps huge damage readable', () => {
  expect([999, 1234, 739643383686.5e6, 999_960, 1.2e36].map(short)).toEqual([
    '999',
    '1.2k',
    '739.6Qa',
    '1.0M',
    '1.2e36',
  ]);
});

const base: WaveEntry = {
  wave: 1,
  name: 't',
  hp: 1,
  speed: 0,
  armor: 0,
  magicResist: 0,
  flying: false,
  boss: false,
  abilities: [],
};

test('Ancient gems come only from two Great gems; end-game towers sunder and harvest', () => {
  const game = newGame(1);
  const { combat, sim } = game;
  expect(game.missingOne()).not.toContain('D7');
  const d6 = combat.place('D6', 10, 10)!;
  combat.place('D6', 12, 10);
  expect(game.combine(d6, 'D7')).toBe(true);
  combat.place('Koh-i-noor Diamond', 14, 10);
  expect(game.combine(d6, 'Regent Diamond')).toBe(true);
  expect(combat.towers.map((t) => t.def.name)).toEqual(['Regent Diamond']);

  const hp = 1e12; // endless-scale HP: base damage barely scratches it, Sunder takes 2% a hit
  const cr = newCreep({ ...base, hp }, 10.5, 9.5);
  sim.creeps.push(cr);
  combat.tick();
  expect(hp - cr.hp).toBeGreaterThanOrEqual(hp * ENDGAME.maxHp);

  combat.towers = [];
  sim.creeps = [];
  const king = combat.place('The Blood King', 10, 14)!;
  const prey = newCreep({ ...base, hp: 1000 }, 10.5, 13.5);
  sim.creeps.push(prey);
  for (let i = 0; i < 100 && prey.alive; i++) combat.tick();
  expect(king.souls).toBe(1000 * ENDGAME.souls);
});
