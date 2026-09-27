// Base gem towers and combat. Pure TS, no DOM. Towers sit on ROCK cells of the maze.
// Hits resolve instantly; `shots` records this tick's hits for the renderer to draw as tracers.
import { TICK, UNITS_PER_CELL, type Creep, type WaveSim } from './waves';

export interface GemDef {
  name: string;
  type: string;
  quality: number;
  damage: number;
  bonusDamage: number;
  attackRate: number; // seconds between attacks (Dota BAT)
  range: number; // Dota units
  abilities: string[];
}

export interface Tower {
  def: GemDef;
  c: number;
  r: number;
  cooldown: number;
  target: Creep | null;
  damageDealt: number;
  kills: number;
}

// ponytail: effect numbers from BUILD.md §2.3; durations/crit odds are defaults until Lua values are known.
const SLOW = [60, 90, 120, 150, 180, 480];
const POISON = [2, 4, 8, 16, 32, 128];
const ARMOR = [2, 4, 8, 16, 32, 64];
const AURA = [20, 30, 40, 50, 60, 70];
const CLEAVE = [
  [0.3, 300],
  [0.4, 350],
  [0.5, 400],
  [0.6, 450],
  [0.7, 500],
  [1, 700],
];
const CRIT: Record<string, [chance: number, mult: number]> = {
  tower_attack1: [0.2, 2],
  tower_attack2: [0.2, 3],
  tower_attack5: [0.2, 5],
};
export const DEBUFF_TIME = 5; // seconds, slow / poison / armor reduction
export const AURA_RANGE = 664;
const SPLIT_TARGETS = 3;

const has = (d: GemDef, prefix: string) => d.abilities.some((a) => a.startsWith(prefix));

/** Dota physical damage multiplier. */
export const armorMult = (a: number) => 1 - (0.06 * a) / (1 + 0.06 * Math.abs(a));

/** Seeded PRNG (mulberry32) so combat is deterministic. */
export function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Combat {
  towers: Tower[] = [];
  shots: { from: Tower; to: Creep }[] = [];
  private rand: () => number;

  constructor(
    readonly sim: WaveSim,
    readonly gems: Record<string, GemDef>,
    seed = 1,
  ) {
    this.rand = rng(seed);
  }

  place(code: string, c: number, r: number): Tower | null {
    const def = this.gems[code];
    if (!def || !this.sim.maze.placeRock(c, r)) return null;
    const t: Tower = { def, c, r, cooldown: 0, target: null, damageDealt: 0, kills: 0 };
    this.towers.push(t);
    return t;
  }

  remove(c: number, r: number) {
    const i = this.towers.findIndex((t) => t.c === c && t.r === r);
    if (i >= 0) this.towers.splice(i, 1);
    return this.sim.maze.removeRock(c, r);
  }

  towerAt(c: number, r: number) {
    return this.towers.find((t) => t.c === c && t.r === r);
  }

  private dist(t: Tower, cr: Creep) {
    return Math.hypot(t.c + 0.5 - cr.x, t.r + 0.5 - cr.y) * UNITS_PER_CELL;
  }

  /** Attack speed bonus: own +AS plus the strongest Opal aura in range (same aura doesn't stack). */
  attacksPerSec(t: Tower) {
    let bonus = t.def.abilities.includes('tower_speed2')
      ? 500
      : has(t.def, 'tower_speed1')
        ? 200
        : 0;
    let aura = 0;
    for (const o of this.towers)
      if (has(o.def, 'tower_speed_aura'))
        if (Math.hypot(o.c - t.c, o.r - t.r) * UNITS_PER_CELL <= AURA_RANGE)
          aura = Math.max(aura, AURA[o.def.quality - 1]);
    bonus += aura;
    return (100 + bonus) / 100 / t.def.attackRate;
  }

  /** Physical hit on a creep; returns damage dealt. */
  hit(t: Tower, cr: Creep, amount: number) {
    const dmg = amount * armorMult(cr.def.armor - cr.armorRed);
    this.deal(t, cr, dmg);
    return dmg;
  }

  private deal(t: Tower | null, cr: Creep, dmg: number) {
    if (!cr.alive) return;
    this.sim.damage(cr, dmg);
    if (t) {
      t.damageDealt += dmg;
      if (!cr.alive) t.kills++;
    }
  }

  private attack(t: Tower, cr: Creep) {
    const d = t.def,
      q = d.quality - 1;
    let dmg = d.damage + d.bonusDamage;
    for (const a of d.abilities) if (CRIT[a] && this.rand() < CRIT[a][0]) dmg *= CRIT[a][1];
    // Debuffs land before damage so armor reduction counts on this hit. Strongest wins, timer refreshes.
    if (has(d, 'tower_jianjia')) {
      cr.armorRed = Math.max(cr.armorRed, ARMOR[q]);
      cr.armorT = DEBUFF_TIME;
    }
    if (has(d, 'tower_slow')) {
      cr.slow = Math.max(cr.slow, SLOW[q]);
      cr.slowT = DEBUFF_TIME;
    }
    if (has(d, 'tower_du')) {
      cr.poison = Math.max(cr.poison, POISON[q]);
      cr.poisonT = DEBUFF_TIME;
      cr.poisonBy = t;
    }
    this.hit(t, cr, dmg);
    this.shots.push({ from: t, to: cr });
    if (has(d, 'tower_jianshe')) {
      const [pct, radius] = CLEAVE[q];
      for (const o of this.sim.creeps)
        if (o !== cr && o.alive && Math.hypot(o.x - cr.x, o.y - cr.y) * UNITS_PER_CELL <= radius)
          this.hit(t, o, dmg * pct);
    }
  }

  private inRange = (t: Tower, cr: Creep) => cr.alive && this.dist(t, cr) <= t.def.range;

  tick() {
    this.shots.length = 0;
    const creeps = this.sim.creeps;
    // Debuff timers and poison (magic damage, reduced by magic resist).
    for (const cr of creeps) {
      if (!cr.alive) continue;
      if (cr.poisonT > 0) {
        this.deal(cr.poisonBy, cr, cr.poison * TICK * (1 - cr.def.magicResist / 100));
        if ((cr.poisonT -= TICK) <= 0) cr.poison = 0;
      }
      if (cr.slowT > 0 && (cr.slowT -= TICK) <= 0) cr.slow = 0;
      if (cr.armorT > 0 && (cr.armorT -= TICK) <= 0) cr.armorRed = 0;
    }
    for (const t of this.towers) {
      t.cooldown = Math.max(0, t.cooldown - TICK);
      if (t.target && !this.inRange(t, t.target)) t.target = null;
      if (!t.target) {
        // ponytail: O(towers×creeps) scan; spatial buckets when the stress scene needs it.
        // First creep in spawn order = furthest along the route.
        for (const cr of creeps)
          if (this.inRange(t, cr)) {
            t.target = cr;
            break;
          }
      }
      if (!t.target || t.cooldown > 0) continue;
      t.cooldown += 1 / this.attacksPerSec(t);
      this.attack(t, t.target);
      if (t.def.abilities.includes('tower_fenliejian')) {
        let extra = SPLIT_TARGETS - 1;
        for (const cr of creeps)
          if (extra > 0 && cr !== t.target && this.inRange(t, cr)) {
            this.attack(t, cr);
            extra--;
          }
      }
      if (!t.target.alive) t.target = null;
    }
  }
}
