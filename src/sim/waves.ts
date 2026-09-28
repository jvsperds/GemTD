// Creeps, waves, leaks, win/lose. Pure TS, no DOM. Fixed tick of TICK seconds.
// Positions are in cell units (cell centre = c + 0.5). Speeds in data are Dota units/s (128 per cell).
import type { Cell, Maze } from './maze';
import type { Tower } from './towers';

export interface WaveEntry {
  wave: number;
  name: string;
  hp: number;
  speed: number;
  armor: number;
  magicResist: number;
  flying: boolean;
  boss: boolean;
  giant?: boolean; // 10x-HP streak event copy
  abilities: string[];
}

export const TICK = 1 / 30;
export const UNITS_PER_CELL = 128;
// ponytail: counts/leak damage/castle HP are defaults until the Lua values are known (BUILD.md §6).
export const CREEPS_PER_WAVE = 10;
export const SPAWN_INTERVAL = 1; // seconds
export const CASTLE_HP = 100;
export const LEAK_DAMAGE = 1;
export const BOSS_LEAK_DAMAGE = 10;
export const MIN_SPEED = 100; // Dota move-speed floor under slows
// Creep attributes (BUILD.md �2.6). Numbers from creeps.json "Raw" (1-player column);
// Refraction / Untouchable / Recharge / trigger chances from the original addon (customgamessourcecode/GemTD);
// ponytail: rush/blink sizes are still defaults.
export const EVASION = 0.5;
export const DISARM_RANGE = 130;
export const HIGH_ARMOR = 20;
export const REACTIVE_ARMOR = 1; // per hit
export const REACTIVE_MAX = 5; // stacks � bonus_armor 5 used as the stack cap
export const REACTIVE_TIME = 5;
export const RECHARGE = 0.003; // share of max hp per second (0.3%/s)
export const KRAKEN_CLEANSE = 40000; // damage taken within the interval purges debuffs
export const KRAKEN_INTERVAL = 10;
export const UNTOUCHABLE = { chance: 0.5, time: 1 }; // attacker disarmed
export const REFRACTION = { chance: 0.2, instances: 7 };
export const BLINK_CHANCE = 0.1;
export const RUSH_CHANCE = 0.2;
export const RUSH = 0.5;
export const RUSH_TIME = 2;
export const BLINK_CELLS = 3;
// Endless: after the last wave, the last 10 waves repeat with hp and armor scaled per extra wave.
// ponytail: growth rates are guesses until playtests.
export const ENDLESS = { hp: 1.15, armor: 1 };
// Giant: after `streak` waves in a row with no castle damage, a wave may swap one creep for a
// 10x-HP copy. ponytail: streak/chance are guesses until playtests.
export const GIANT = { streak: 3, chance: 0.3, hp: 10 };

/** Seeded PRNG (mulberry32) so the sim is deterministic. */
export function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface Creep {
  def: WaveEntry;
  x: number;
  y: number;
  px: number; // position at the start of the last tick, for render interpolation
  py: number;
  hp: number;
  seg: number; // index of the waypoint it is heading to (1..n)
  tc: number; // ground: target cell centre
  tr: number;
  alive: boolean;
  // Debuffs from towers (strongest applies, timers in seconds).
  slow: number;
  slowT: number;
  armorRed: number;
  armorT: number;
  poison: number; // magic dps
  poisonT: number;
  poisonBy: Tower | null;
  slowPct: number; // fraction, from Frost-type hits
  slowPctT: number;
  stunT: number;
  noHealT: number;
  ampT: number; // takes +100% physical damage (Gaze)
  terror: number; // Terrorize pedal: +fraction damage taken
  terrorT: number;
  mrRed: number; // Decrepify pedal: magic resist reduction
  mrT: number;
  // Recomputed every tick from tower auras.
  auraArmor: number;
  auraSlowPct: number;
  auraSlow: number;
  auraMr: number;
  // Attributes.
  shield: number; // Refraction: damage instances to block
  rushT: number;
  reactive: number;
  reactiveT: number;
  kraken: number;
  krakenT: number;
  dir: number; // last step direction (dc*3+dr), for turn triggers
  lastHit: Tower | null;
}

export function newCreep(def: WaveEntry, x: number, y: number): Creep {
  return {
    def,
    x,
    y,
    px: x,
    py: y,
    hp: def.hp,
    seg: 1,
    tc: Math.floor(x),
    tr: Math.floor(y),
    alive: true,
    slow: 0,
    slowT: 0,
    armorRed: 0,
    armorT: 0,
    poison: 0,
    poisonT: 0,
    poisonBy: null,
    slowPct: 0,
    slowPctT: 0,
    stunT: 0,
    noHealT: 0,
    ampT: 0,
    terror: 0,
    terrorT: 0,
    mrRed: 0,
    mrT: 0,
    auraArmor: 0,
    auraSlowPct: 0,
    auraSlow: 0,
    auraMr: 0,
    shield: 0,
    rushT: 0,
    reactive: 0,
    reactiveT: 0,
    kraken: 0,
    krakenT: 0,
    dir: -99,
    lastHit: null,
  };
}

export const hasAbility = (cr: Creep, id: string) => cr.def.abilities.includes(id);

/** Current armor: base (+High armor, +Reactive) minus debuffs and auras. */
export const armorOf = (cr: Creep) =>
  cr.def.armor +
  (hasAbility(cr, 'enemy_high_armor') ? HIGH_ARMOR : 0) +
  cr.reactive -
  cr.armorRed -
  cr.auraArmor;

export type Phase = 'build' | 'wave' | 'won' | 'lost';

export class WaveSim {
  phase: Phase = 'build';
  wave = 0; // last wave started
  castleHp = CASTLE_HP;
  // Hero skills on the castle: damage blocked per bite / dodge chance, and seconds left.
  guard = { v: 0, t: 0 };
  evade = { v: 0, t: 0 };
  bossBite = 0; // hero passive: less damage from boss leaks
  revenge = { v: 0, t: 0 }; // HP threshold below which towers deal more damage
  candy: Cell | null = null; // Candy Marker: creeps visit it first, next wave only
  creeps: Creep[] = [];
  onKill: ((cr: Creep) => void) | null = null;
  rand: () => number;
  hpMult = 1; // difficulty
  streak = 0; // waves in a row that ended with no castle damage
  private hurt = false; // castle took damage this wave
  private queue: WaveEntry[] = [];
  private spawnTimer = 0;
  private next: Int32Array[] = []; // per segment: cell index → next cell index on the flow field

  constructor(
    readonly maze: Maze,
    readonly waves: WaveEntry[],
    seed = 1,
  ) {
    this.rand = rng(seed ^ 0xc4ee);
  }

  get lastWave() {
    return this.waves.at(-1)!.wave;
  }

  /** Build flow fields from the current maze. Call whenever the maze changes (build phase). */
  refreshRoute() {
    const fields = this.maze.route();
    if (!fields) throw new Error('route blocked');
    this.next = fields.map((f) => {
      const next = new Int32Array(f.length).fill(-1);
      for (let r = 0; r < this.maze.h; r++)
        for (let c = 0; c < this.maze.w; c++) {
          const i = this.maze.idx(c, r);
          if (f[i] > 0 && f[i] < Infinity) {
            const [nc, nr] = this.maze.walk(f, [c, r])[1];
            next[i] = this.maze.idx(nc, nr);
          }
        }
      return next;
    });
  }

  startWave() {
    if (this.phase !== 'build') return false;
    if (this.candy) {
      const wp = this.maze.waypoints;
      wp.splice(1, 0, this.candy);
      if (!this.maze.route()) {
        wp.splice(1, 1); // built over since the cast
        this.candy = null;
      }
    }
    this.refreshRoute();
    this.wave++;
    const last = this.lastWave,
      extra = Math.max(0, this.wave - last);
    const base = extra ? last - 9 + ((extra - 1) % 10) : this.wave;
    const mult = this.hpMult * ENDLESS.hp ** extra;
    const defs = this.waves
      .filter((w) => w.wave === base)
      .map((w) =>
        mult === 1 ? w : { ...w, hp: w.hp * mult, armor: w.armor + ENDLESS.armor * extra },
      );
    const n = defs.some((d) => d.boss) ? 1 : CREEPS_PER_WAVE;
    this.queue = Array.from({ length: n }, (_, k) => defs[k % defs.length]);
    if (n > 1 && this.streak >= GIANT.streak && this.rand() < GIANT.chance) {
      const k = Math.floor(this.rand() * n);
      const d = this.queue[k];
      this.queue[k] = { ...d, giant: true, hp: d.hp * GIANT.hp };
    }
    this.hurt = false;
    this.spawnTimer = 0;
    this.phase = 'wave';
    return true;
  }

  spawn(def: WaveEntry) {
    const [c, r] = this.maze.waypoints[0];
    const cr = newCreep(def, c + 0.5, r + 0.5);
    this.creeps.push(cr);
    return cr;
  }

  damage(creep: Creep, amount: number) {
    creep.hp -= amount;
    if (
      hasAbility(creep, 'tidehunter_kraken_shell') &&
      (creep.kraken += amount) >= KRAKEN_CLEANSE
    ) {
      // Kraken Shell: purge tower debuffs.
      creep.kraken = 0;
      creep.slow = creep.slowPct = creep.armorRed = creep.poison = creep.stunT = creep.ampT = 0;
      creep.terror = creep.mrRed = 0;
    }
    if (creep.hp <= 0 && creep.alive) {
      creep.alive = false;
      this.onKill?.(creep);
    }
  }

  tick() {
    if (this.phase !== 'wave') return;
    this.spawnTimer -= TICK;
    if (this.queue.length && this.spawnTimer <= 0) {
      this.spawn(this.queue.shift()!);
      this.spawnTimer += SPAWN_INTERVAL;
    }
    const wp = this.maze.waypoints;
    for (const cr of this.creeps) {
      if (!cr.alive) continue;
      cr.px = cr.x;
      cr.py = cr.y;
      this.timers(cr);
      if (cr.stunT > 0) continue;
      let step = (this.speed(cr) / UNITS_PER_CELL) * TICK;
      while (step > 0 && cr.alive) {
        let tx: number, ty: number;
        if (cr.def.flying) {
          [tx, ty] = [wp[cr.seg][0] + 0.5, wp[cr.seg][1] + 0.5];
        } else {
          [tx, ty] = [cr.tc + 0.5, cr.tr + 0.5];
        }
        const dx = tx - cr.x,
          dy = ty - cr.y,
          d = Math.hypot(dx, dy);
        if (d > step) {
          cr.x += (dx / d) * step;
          cr.y += (dy / d) * step;
          break;
        }
        cr.x = tx;
        cr.y = ty;
        step -= d;
        this.advance(cr, wp);
      }
    }
    this.creeps = this.creeps.filter((c) => c.alive);
    if (this.castleHp <= 0) this.phase = 'lost';
    else if (!this.queue.length && !this.creeps.length) {
      this.phase = 'build'; // endless: waves never run out
      this.streak = this.hurt ? 0 : this.streak + 1;
      if (this.candy) {
        this.maze.waypoints.splice(this.maze.waypoints.indexOf(this.candy), 1);
        this.candy = null;
      }
    }
  }

  /** Move speed after rush, % slows (strongest) and flat slows, floored at MIN_SPEED. */
  speed(cr: Creep) {
    const pct = Math.max(cr.slowPct, cr.auraSlowPct);
    const v = cr.def.speed * (cr.rushT > 0 ? 1 + RUSH : 1) * (1 - pct) - cr.slow - cr.auraSlow;
    return Math.max(v, MIN_SPEED);
  }

  private timers(cr: Creep) {
    for (const k of [
      'slowPctT',
      'stunT',
      'noHealT',
      'ampT',
      'rushT',
      'reactiveT',
      'terrorT',
      'mrT',
    ] as const)
      if (cr[k] > 0) cr[k] -= TICK;
    if (cr.slowPctT <= 0) cr.slowPct = 0;
    if (cr.reactiveT <= 0) cr.reactive = 0;
    if ((cr.krakenT -= TICK) <= 0) [cr.kraken, cr.krakenT] = [0, KRAKEN_INTERVAL];
    if (hasAbility(cr, 'enemy_recharge') && cr.noHealT <= 0)
      cr.hp = Math.min(cr.def.hp, cr.hp + cr.def.hp * RECHARGE * TICK);
  }

  /** Direction change: Rush, Refraction and Blink may trigger. */
  private turn(cr: Creep) {
    // Original rolls these as an else-if chain: at most one per turn.
    if (hasAbility(cr, 'enemy_zheguang') && cr.shield <= 0 && this.rand() < REFRACTION.chance)
      cr.shield = REFRACTION.instances;
    else if (hasAbility(cr, 'enemy_shanshuo') && !cr.def.flying && this.rand() < BLINK_CHANCE)
      for (let k = 0; k < BLINK_CELLS && cr.alive; k++) {
        [cr.x, cr.y] = [cr.tc + 0.5, cr.tr + 0.5];
        this.advance(cr, this.maze.waypoints, false);
      }
    else if (hasAbility(cr, 'runrunrun') && cr.rushT <= 0 && this.rand() < RUSH_CHANCE)
      cr.rushT = RUSH_TIME;
  }

  /** Creep reached its current target point: pick the next one, or leak at the castle. */
  private advance(cr: Creep, wp: Cell[], turns = true) {
    const [gc, gr] = wp[cr.seg];
    const atGoal = cr.def.flying || (cr.tc === gc && cr.tr === gr);
    if (atGoal) {
      if (cr.seg === wp.length - 1) {
        cr.alive = false;
        let dmg = cr.def.boss ? BOSS_LEAK_DAMAGE - this.bossBite : LEAK_DAMAGE;
        if (this.guard.t > 0) dmg = Math.max(0, dmg - this.guard.v);
        if (this.evade.t > 0 && this.rand() * 100 < this.evade.v) dmg = 0;
        this.castleHp -= dmg;
        if (dmg > 0) this.hurt = true;
        return;
      }
      cr.seg++;
      if (cr.def.flying) return turns && this.turn(cr);
    }
    const n = this.next[cr.seg - 1][this.maze.idx(cr.tc, cr.tr)];
    const nc = n % this.maze.w,
      nr = (n / this.maze.w) | 0;
    const dir = (nc - cr.tc) * 3 + (nr - cr.tr);
    [cr.tc, cr.tr] = [nc, nr];
    if (dir !== cr.dir) {
      const first = cr.dir === -99;
      cr.dir = dir;
      if (turns && !first) this.turn(cr);
    }
  }
}
