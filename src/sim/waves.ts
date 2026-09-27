// Creeps, waves, leaks, win/lose. Pure TS, no DOM. Fixed tick of TICK seconds.
// Positions are in cell units (cell centre = c + 0.5). Speeds in data are Dota units/s (128 per cell).
import type { Cell, Maze } from './maze';

export interface WaveEntry {
  wave: number;
  name: string;
  hp: number;
  speed: number;
  armor: number;
  magicResist: number;
  flying: boolean;
  boss: boolean;
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

export interface Creep {
  def: WaveEntry;
  x: number;
  y: number;
  hp: number;
  seg: number; // index of the waypoint it is heading to (1..n)
  tc: number; // ground: target cell centre
  tr: number;
  alive: boolean;
}

export type Phase = 'build' | 'wave' | 'won' | 'lost';

export class WaveSim {
  phase: Phase = 'build';
  wave = 0; // last wave started
  castleHp = CASTLE_HP;
  creeps: Creep[] = [];
  private queue: WaveEntry[] = [];
  private spawnTimer = 0;
  private next: Int32Array[] = []; // per segment: cell index → next cell index on the flow field

  constructor(
    readonly maze: Maze,
    readonly waves: WaveEntry[],
  ) {}

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
    this.refreshRoute();
    this.wave++;
    const defs = this.waves.filter((w) => w.wave === this.wave);
    const n = defs.some((d) => d.boss) ? 1 : CREEPS_PER_WAVE;
    this.queue = Array.from({ length: n }, (_, k) => defs[k % defs.length]);
    this.spawnTimer = 0;
    this.phase = 'wave';
    return true;
  }

  private spawn(def: WaveEntry) {
    const [c, r] = this.maze.waypoints[0];
    this.creeps.push({
      def,
      x: c + 0.5,
      y: r + 0.5,
      hp: def.hp,
      seg: 1,
      tc: c,
      tr: r,
      alive: true,
    });
  }

  damage(creep: Creep, amount: number) {
    creep.hp -= amount;
    if (creep.hp <= 0) creep.alive = false;
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
      let step = (cr.def.speed / UNITS_PER_CELL) * TICK;
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
    else if (!this.queue.length && !this.creeps.length)
      this.phase = this.wave >= this.lastWave ? 'won' : 'build';
  }

  /** Creep reached its current target point: pick the next one, or leak at the castle. */
  private advance(cr: Creep, wp: Cell[]) {
    const [gc, gr] = wp[cr.seg];
    const atGoal = cr.def.flying || (cr.tc === gc && cr.tr === gr);
    if (atGoal) {
      if (cr.seg === wp.length - 1) {
        cr.alive = false;
        this.castleHp -= cr.def.boss ? BOSS_LEAK_DAMAGE : LEAK_DAMAGE;
        return;
      }
      cr.seg++;
      if (cr.def.flying) return;
    }
    const n = this.next[cr.seg - 1][this.maze.idx(cr.tc, cr.tr)];
    cr.tc = n % this.maze.w;
    cr.tr = (n / this.maze.w) | 0;
  }
}
