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
  for (let k = 0; k < 3; k++) {
    const t = combat.place('Y3', 10 + 2 * k, 10)!;
    combat.place('D2', 10 + 2 * k, 12);
    expect(game.combine(t, 'Ensnare Pedal')).toBe(true);
    expect(game.layPedal(10 + k, 5)).toBe(true);
  }
  const first = combat.towerAt(10, 5)!;
  expect(game.combine(first, 'Sparkling Ensnare Pedal')).toBe(true);
  expect(combat.towers).toEqual([first]);
  expect(first.def.name).toBe('Sparkling Ensnare Pedal');
});

test('combined gems become stones; the pedal is laid on open path, not on stones', () => {
  const game = newGame(1);
  const { combat, sim } = game;
  const t = combat.place('Y3', 10, 10)!;
  combat.place('D2', 12, 10);
  expect(game.combine(t, 'Ensnare Pedal')).toBe(true);
  expect(combat.towers).toEqual([]);
  expect(game.pedals).toEqual(['Ensnare Pedal']);
  expect(game.layPedal(10, 10)).toBe(false); // a stone now
  expect(game.layPedal(11, 10)).toBe(true);
  expect(sim.maze.walkable(11, 10)).toBe(true); // creeps still walk over it
  expect(combat.place('B1', 11, 10)).toBeNull(); // nor can a gem go on top
});

test('a creep stepping on the pedal sets it off, then it cools down; howl buffs towers', () => {
  const { combat, sim } = newGame(1);
  const p = combat.placePedal('Torrent Pedal', 10, 10);
  const cr = newCreep(base, 11.5, 10.5);
  sim.creeps.push(cr);
  combat.tick();
  expect(cr.stunT).toBe(0); // next cell over: not stepped on
  cr.x = 10.5;
  combat.tick();
  expect(cr.stunT).toBe(SPELL.torrent.stun[0]);
  expect(p.cooldown).toBe(PEDAL.cooldown);
  cr.stunT = 0;
  combat.tick();
  expect(cr.stunT).toBe(0);

  combat.placePedal('Blingbling Howl Pedal', 12, 12);
  const gem = combat.place('B1', 13, 12)!;
  const before = combat.damageMult(gem);
  cr.x = 12.5;
  cr.y = 12.5;
  combat.tick();
  expect(combat.damageMult(gem)).toBeCloseTo(before + SPELL.howl.dmg[2]);
});

test("Chain Frost: a pedal trigger next to Northern Saber's Eye bounces a frost ball", () => {
  const { combat } = newGame(1);
  combat.place("Northern Saber's Eye", 10, 10);
  combat.place('Ensnare Pedal', 11, 10);
  (combat as unknown as { rand: () => number }).rand = () => 0;
  const crs = [0, 1, 2].map((k) => {
    const cr = newCreep(base, 11.5 + k * 0.5, 10.5);
    combat.sim.creeps.push(cr);
    return cr;
  });
  combat.tick();
  for (const cr of crs) {
    expect(cr.hp).toBeLessThan(1e6);
    expect(cr.slowPct).toBeGreaterThan(0);
  }
});
