import { expect, test } from 'vitest';
import { eventAt } from '../src/sim/events';
import { newGame } from '../src/sim/setup';
import { parseFx } from '../src/sim/towers';
import { newCreep, type WaveEntry } from '../src/sim/waves';

test('event schedule is deterministic, spaced, and omits bosses and wave 50', () => {
  const a = Array.from({ length: 50 }, (_, i) => eventAt(91, i + 1, (i + 1) % 10 === 0));
  const b = Array.from({ length: 50 }, (_, i) => eventAt(91, i + 1, (i + 1) % 10 === 0));
  expect(a).toEqual(b);
  const waves = a.flatMap((x) => (x ? [x.wave] : []));
  expect(waves.every((w) => w >= 5 && w < 50 && w % 10 !== 0)).toBe(true);
  expect(waves.slice(1).every((w, i) => w - waves[i] >= 4 && w - waves[i] <= 7)).toBe(true);
});

test('event choices are logged, decline is harmless, and invalid choices are rejected', () => {
  const g = newGame(7, 'normal', ['events']);
  g.pendingEvent = { wave: 5, id: 'shrine' };
  const gold = g.gold;
  expect(g.run(['event', 'accept'])).toBe(false);
  expect(g.run(['event', 'decline'])).toBe(true);
  expect([g.gold, g.pendingEvent, g.log.at(-1)?.[1]]).toEqual([gold, null, ['event', 'decline']]);
});

test('accepted contracts only modify their one wave and old rules ignore Events', () => {
  const g = newGame(8, 'normal', ['events']);
  g.pendingEvent = { wave: 1, id: 'goldRush' };
  expect(g.run(['event', 'accept'])).toBe(true);
  expect(g.run(['skip'])).toBe(true);
  expect(g.sim.eventHpMult).toBe(1.35);
  while (g.sim.phase === 'wave') g.tick();
  expect([g.sim.eventHpMult, g.eventGold, g.activeEvent]).toEqual([1, 1, null]);
  expect(newGame(8, 'normal', ['events'], 'classic', 6).events).toBe(false);
});

test('Skyhunter is a direct physical anti-air role with an explicit ground weakness', () => {
  const g = newGame(3);
  expect(parseFx(g.combat.gems.Skyhunter).flyerDamage).toEqual([1.5, 0.65]);
  expect(parseFx(g.combat.gems['Skyhunter Ascended']).flyerDamage).toEqual([2, 0.6]);
  const old = newGame(3, 'easy', [], 'classic', 6);
  const part = old.combat.place('B2', 6, 6)!;
  old.combat.place('R2', 8, 6);
  old.combat.place('Y2', 10, 6);
  expect(old.recipesFor(part).some((r) => r.name === 'Skyhunter')).toBe(false);
});

test.each(['accept', 'decline'] as const)(
  'event %s survives snapshot and full replay identically',
  (choice) => {
    const fresh = () => {
      const g = newGame(8, 'normal', ['events']);
      g.sim.castleHp = 1e6; // isolate persistence from losing an intentionally empty board
      return g;
    };
    const g = fresh();
    for (let wave = 1; wave <= 4; wave++) {
      expect(g.run(['skip'])).toBe(true);
      while (g.sim.phase === 'wave') g.tick();
    }
    expect(g.pendingEvent?.id).toBe('goldRush');
    expect(g.run(['skip'])).toBe(false);
    const pending = fresh();
    pending.resume(g.log, g.snap);
    expect(pending.pendingEvent).toEqual(g.pendingEvent);
    expect(g.run(['event', choice])).toBe(true);
    const resumed = fresh();
    resumed.resume(g.log, g.snap);
    const replayed = fresh();
    replayed.resume(g.log);
    for (const h of [g, resumed, replayed]) {
      expect(h.run(['skip'])).toBe(true);
      while (h.sim.phase === 'wave') h.tick();
    }
    expect(resumed.snap).toBe(g.snap);
    expect(replayed.snap).toBe(g.snap);
  },
);

test('pending event rejects merge and round recipes without mutating gems', () => {
  const g = newGame(8);
  for (let c = 6; c < 11; c++) g.run(['place', c, 6]);
  const t = g.placed[0];
  for (const part of g.placed) part.def = g.combat.gems.B2;
  g.pendingEvent = { wave: 1, id: 'shrine' };
  expect(g.run(['merge2', t.c, t.r])).toBe(false);
  expect(t.def).toBe(g.combat.gems.B2);
  g.placed[1].def = g.combat.gems.R2;
  g.placed[2].def = g.combat.gems.Y2;
  const before = g.combat.towers.map((x) => x.def);
  expect(g.run(['combine', t.c, t.r, 'Skyhunter'])).toBe(false);
  expect(g.combat.towers.map((x) => x.def)).toEqual(before);
});

test.each(['Skyhunter', 'Skyhunter Ascended'])(
  '%s deals the advertised physical damage',
  (name) => {
    for (const flying of [false, true]) {
      const g = newGame(3);
      const t = g.combat.place(name, 10, 10)!;
      const def: WaveEntry = {
        wave: 1,
        name: 'target',
        hp: 1e6,
        speed: 300,
        armor: 0,
        magicResist: 0,
        flying,
        boss: false,
        abilities: [],
      };
      const cr = newCreep(def, 12.5, 10.5);
      g.sim.creeps.push(cr);
      g.combat.tick();
      const fx = parseFx(t.def).flyerDamage!;
      expect(1e6 - cr.hp).toBeCloseTo((t.def.damage + t.def.bonusDamage) * fx[flying ? 0 : 1]);
      expect(t.magicDealt).toBe(0);
    }
  },
);

test('Gold Rush changes kill gold without awarding hidden HP-based XP', () => {
  const rewards = (rush: boolean) => {
    const g = newGame(8, 'normal', ['events']);
    if (rush) {
      g.pendingEvent = { wave: 1, id: 'goldRush' };
      g.run(['event', 'accept']);
    }
    g.run(['skip']);
    g.tick();
    const cr = g.sim.creeps[0];
    expect(cr).toBeDefined();
    g.sim.onKill?.(cr);
    return { xp: g.xp, gold: g.gold };
  };
  const base = rewards(false);
  const rush = rewards(true);
  expect(rush.xp).toBeCloseTo(base.xp);
  expect(rush.gold).toBe(Math.round(base.gold * 1.5));
});
