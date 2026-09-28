import { expect, test } from 'vitest';
import { PEDAL, PEDALS, SPELL } from '../src/sim/pedals';
import { DEFS, newGame } from '../src/sim/setup';
import { newCreep, type WaveEntry } from '../src/sim/waves';

const base: WaveEntry = {
  wave: 1,
  name: 't',
  hp: 1e6,
  speed: 300,
  armor: 0,
  magicResist: 0,
  flying: false,
  boss: false,
  abilities: [],
};

test('24 pedals: 2-gem recipe, then 3× same for Sparkling and Blingbling', () => {
  expect(Object.keys(PEDALS)).toHaveLength(24);
  expect(DEFS['Gale Pedal'].pedal).toBe(true);
  const game = newGame(1);
  const { combat } = game;
  const ens = [0, 1, 2].map((k) => {
    const t = combat.place('Y3', 10 + 2 * k, 10)!;
    combat.place('D2', 10 + 2 * k, 12);
    expect(game.combine(t, 'Ensnare Pedal')).toBe(true);
    return t;
  });
  expect(game.combine(ens[0], 'Sparkling Ensnare Pedal')).toBe(true);
  expect(combat.towers).toEqual([ens[0]]);
});

test('pedal casts on a nearby creep, then cools down; howl buffs nearby towers', () => {
  const { combat, sim } = newGame(1);
  const p = combat.place('B1', 10, 10)!;
  p.def = DEFS['Torrent Pedal'];
  const cr = newCreep(base, 11.5, 10.5);
  sim.creeps.push(cr);
  combat.tick();
  expect(cr.stunT).toBe(SPELL.torrent.stun[0]);
  expect(p.cooldown).toBe(PEDAL.cooldown);
  cr.stunT = 0;
  combat.tick();
  expect(cr.stunT).toBe(0);

  const h = combat.place('B1', 12, 12)!;
  h.def = DEFS['Blingbling Howl Pedal'];
  const gem = combat.place('B1', 13, 12)!;
  const before = combat.damageMult(gem);
  cr.x = 13.5;
  cr.y = 12.5;
  combat.tick();
  expect(combat.damageMult(gem)).toBeCloseTo(before + SPELL.howl.dmg[2]);
});
