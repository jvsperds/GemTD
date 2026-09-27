// Canvas 2D renderer, CPU-first 2.5D (BUILD.md §3.7). Reads sim state only, never mutates it.
// Static layer (ground, route, blocks) is an offscreen canvas redrawn only on maze/zoom change;
// the dynamic layer (creeps, tracers, particles) is redrawn every frame from baked sprites.
import { ROCK, WALL, type Maze } from './sim/maze';
import type { Combat } from './sim/towers';
import { UNITS_PER_CELL, type Creep, type WaveSim } from './sim/waves';

export const GEM_COLOR: Record<string, string> = {
  B: '#3a6bff',
  D: '#e8f4ff',
  E: '#f0e6c8',
  G: '#2fbf5a',
  P: '#a24de0',
  Q: '#4fe0d8',
  R: '#e03a3a',
  Y: '#f2c52e',
};
const FLY_Z = 40 / UNITS_PER_CELL; // cells
const BLOCK_H = 0.5; // front-face height of stones/towers, in cells
export const MAX_PARTICLES = 800;
const HUD_H = 32;

/** In-place insertion sort by ground y: near O(n) because order barely changes between frames. */
export function sortByY<T extends { y: number }>(a: T[]) {
  for (let i = 1; i < a.length; i++) {
    const v = a[i];
    let j = i - 1;
    for (; j >= 0 && a[j].y > v.y; j--) a[j + 1] = a[j];
    a[j + 1] = v;
  }
}

/** Multiply a #rrggbb colour by k (k > 1 lightens). */
function shade(hex: string, k: number) {
  const n = parseInt(hex.slice(1), 16);
  const ch = (v: number) => Math.min(255, Math.round(v * k));
  return `rgb(${ch(n >> 16)},${ch((n >> 8) & 255)},${ch(n & 255)})`;
}

function bake(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.ceil(w));
  c.height = Math.max(1, Math.ceil(h));
  draw(c.getContext('2d')!);
  return c;
}

export class Renderer {
  cell = 0; // px per cell at current zoom
  zoom = 1;
  panX = 0;
  panY = 0;
  flash = -1; // refused cell index
  flashUntil = 0;
  private staticLayer = document.createElement('canvas');
  private staticDirty = true;
  // ponytail: one canvas per sprite, not a packed sheet; pack if drawImage switching shows in profiles.
  private sprites = new Map<string, HTMLCanvasElement>();
  private order: Creep[] = [];
  private seen = new WeakSet<Creep>();
  private px = new Float32Array(MAX_PARTICLES * 5); // x, y, vx, vy, life
  particles = 0;
  private ctx: CanvasRenderingContext2D;

  constructor(
    readonly canvas: HTMLCanvasElement,
    readonly maze: Maze,
    readonly sim: WaveSim,
    readonly combat: Combat,
  ) {
    this.ctx = canvas.getContext('2d')!;
    this.resize();
  }

  /** Fit the map to the window and recentre. */
  resize() {
    this.canvas.width = innerWidth;
    this.canvas.height = innerHeight;
    this.setZoom(this.zoom, innerWidth / 2, innerHeight / 2, true);
  }

  /** Zoom keeping the world point under (sx, sy) fixed. */
  setZoom(zoom: number, sx: number, sy: number, recentre = false) {
    const base = Math.min(innerWidth, innerHeight - HUD_H) / this.maze.w;
    const cell = Math.max(4, Math.floor(base * Math.min(4, Math.max(0.5, zoom))));
    this.zoom = cell / base;
    if (recentre) {
      this.panX = Math.floor((innerWidth - cell * this.maze.w) / 2);
      this.panY = HUD_H;
    } else {
      this.panX = sx - ((sx - this.panX) / (this.cell || cell)) * cell;
      this.panY = sy - ((sy - this.panY) / (this.cell || cell)) * cell;
    }
    if (cell !== this.cell) {
      this.cell = cell;
      this.sprites.clear();
      this.staticDirty = true;
    }
  }

  pan(dx: number, dy: number) {
    this.panX += dx;
    this.panY += dy;
  }

  screenToCell(x: number, y: number): [number, number] {
    return [Math.floor((x - this.panX) / this.cell), Math.floor((y - this.panY) / this.cell)];
  }

  /** Call when the maze or towers change. */
  invalidate() {
    this.staticDirty = true;
  }

  private sprite(key: string, w: number, h: number, draw: (g: CanvasRenderingContext2D) => void) {
    let s = this.sprites.get(key);
    if (!s) this.sprites.set(key, (s = bake(w, h, draw)));
    return s;
  }

  /** Stone block with a lit top face and darker front face; optional gem on top. */
  private block(color: string, gem = '', quality = 0) {
    const s = this.cell;
    return this.sprite(`b${color}${gem}${quality}`, s, s * (1 + BLOCK_H), (g) => {
      g.fillStyle = shade(color, 0.6);
      g.fillRect(0, s, s, s * BLOCK_H);
      g.fillStyle = color;
      g.fillRect(0, 0, s, s);
      g.fillStyle = shade(color, 1.25);
      g.fillRect(0, 0, s, Math.max(1, s / 10));
      if (!gem) return;
      const c = GEM_COLOR[gem],
        m = s / 2,
        rad = s * (0.2 + 0.045 * quality);
      // Four facets with baked light from the top-left.
      const facets: [number, number, number][] = [
        [-1, 0, 1.3],
        [0, -1, 1.1],
        [1, 0, 0.75],
        [0, 1, 0.55],
      ];
      facets.forEach(([dx, dy, k], i) => {
        const [nx, ny] = facets[(i + 1) % 4];
        g.fillStyle = shade(c, k);
        g.beginPath();
        g.moveTo(m, m);
        g.lineTo(m + dx * rad, m + dy * rad);
        g.lineTo(m + nx * rad, m + ny * rad);
        g.fill();
      });
      g.fillStyle = '#000';
      g.font = `bold ${Math.max(7, s * 0.3)}px sans-serif`;
      g.textAlign = 'right';
      g.textBaseline = 'bottom';
      g.fillText(String(quality), s - 1, s);
    });
  }

  private creepSprite(cr: Creep) {
    const color = cr.def.flying ? '#9cf' : cr.slow ? '#88f' : cr.poison ? '#6c6' : '#e84';
    const rad = this.cell * (cr.def.boss ? 0.6 : 0.35);
    return this.sprite(`c${color}${rad}`, rad * 2, rad * 2, (g) => {
      const grad = g.createRadialGradient(rad * 0.7, rad * 0.6, rad * 0.1, rad, rad, rad);
      grad.addColorStop(0, '#fff');
      grad.addColorStop(0.35, color);
      grad.addColorStop(1, shade(color.length === 4 ? expand(color) : color, 0.4));
      g.fillStyle = grad;
      g.beginPath();
      g.arc(rad, rad, rad, 0, 7);
      g.fill();
    });
  }

  private shadow(boss: boolean) {
    const w = this.cell * (boss ? 1.1 : 0.7);
    return this.sprite(`s${w}`, w, w * 0.4, (g) => {
      g.fillStyle = 'rgba(0,0,0,0.35)';
      g.beginPath();
      g.ellipse(w / 2, w * 0.2, w / 2, w * 0.2, 0, 0, 7);
      g.fill();
    });
  }

  private drawStatic() {
    const { maze, cell: s } = this;
    const top = Math.ceil(s * BLOCK_H);
    const L = this.staticLayer;
    L.width = maze.w * s;
    L.height = maze.h * s + top;
    const g = L.getContext('2d')!;
    g.translate(0, top);
    for (let r = 0; r < maze.h; r++)
      for (let c = 0; c < maze.w; c++) {
        g.fillStyle = maze.noBuild[maze.idx(c, r)] ? '#2a2a2a' : '#3b4a3b';
        g.fillRect(c * s, r * s, s - 1, s - 1);
      }
    const route = maze.route();
    if (route) {
      g.strokeStyle = '#ffd24a';
      g.lineWidth = Math.max(1, s / 6);
      g.beginPath();
      route.forEach((field, i) =>
        maze
          .walk(field, maze.waypoints[i])
          .forEach(([c, r], k) => g[k ? 'lineTo' : 'moveTo']((c + 0.5) * s, (r + 0.5) * s)),
      );
      g.stroke();
    }
    g.fillStyle = '#fff';
    g.font = `${Math.max(10, s * 0.6)}px sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    maze.waypoints.forEach(([c, r], k) =>
      g.fillText(
        k === 0 ? 'S' : k === maze.waypoints.length - 1 ? 'E' : String(k),
        (c + 0.5) * s,
        (r + 0.5) * s,
      ),
    );
    // Blocks in row order so nearer rows overlap the ones behind.
    const towers = new Map(this.combat.towers.map((t) => [maze.idx(t.c, t.r), t]));
    for (let r = 0; r < maze.h; r++)
      for (let c = 0; c < maze.w; c++) {
        const i = maze.idx(c, r),
          cell = maze.cells[i];
        if (cell !== WALL && cell !== ROCK) continue;
        const t = towers.get(i);
        const spr =
          cell === WALL
            ? this.block('#1c1c24')
            : t
              ? this.block('#6b6b6b', t.def.type, t.def.quality)
              : this.block('#8a8a8a');
        g.drawImage(spr, c * s, (r - BLOCK_H) * s);
      }
    this.staticDirty = false;
  }

  /** Emit cosmetic hit sparks (call once per sim tick). */
  sparks() {
    const p = this.px;
    for (const { to } of this.combat.shots) {
      if (this.particles >= MAX_PARTICLES) break;
      const o = this.particles++ * 5;
      const a = Math.random() * 7; // cosmetic only, so Math.random is fine
      p[o] = to.x;
      p[o + 1] = to.y - (to.def.flying ? FLY_Z : 0) - 0.3;
      p[o + 2] = Math.cos(a) * 2;
      p[o + 3] = Math.sin(a) * 2 - 1;
      p[o + 4] = 0.4;
    }
  }

  /** alpha = fraction of the way from the previous tick to the current one; dt = frame seconds. */
  render(alpha: number, dt: number, now: number) {
    if (this.staticDirty) this.drawStatic();
    const { ctx, cell: s, panX, panY } = this;
    const X = (x: number) => (panX + x * s) | 0;
    const Y = (y: number) => (panY + y * s) | 0;
    ctx.fillStyle = '#111';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.drawImage(this.staticLayer, panX | 0, (panY - Math.ceil(s * BLOCK_H)) | 0);

    if (this.flash >= 0 && now < this.flashUntil) {
      ctx.fillStyle = 'rgba(220,50,50,0.6)';
      ctx.fillRect(X(this.flash % this.maze.w), Y((this.flash / this.maze.w) | 0), s, s);
    }

    // Keep last frame's order (dead creeps dropped, new ones appended) so the sort stays cheap.
    const order = this.order;
    let n = 0;
    for (const cr of order) if (cr.alive) order[n++] = cr;
    order.length = n;
    for (const cr of this.sim.creeps)
      if (!this.seen.has(cr)) {
        this.seen.add(cr);
        order.push(cr);
      }
    sortByY(order);

    for (const cr of order) {
      const sh = this.shadow(cr.def.boss);
      const x = cr.px + (cr.x - cr.px) * alpha,
        y = cr.py + (cr.y - cr.py) * alpha;
      ctx.drawImage(sh, X(x) - sh.width / 2, Y(y) - sh.height / 2);
    }
    for (const cr of order) {
      const sp = this.creepSprite(cr);
      const x = cr.px + (cr.x - cr.px) * alpha,
        y = cr.py + (cr.y - cr.py) * alpha - (cr.def.flying ? FLY_Z : 0.15);
      ctx.drawImage(sp, X(x) - sp.width / 2, Y(y) - sp.height / 2);
    }

    ctx.strokeStyle = 'rgba(255,255,255,0.8)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (const { from, to } of this.combat.shots) {
      ctx.moveTo(X(from.c + 0.5), Y(from.r + 0.5 - BLOCK_H));
      ctx.lineTo(X(to.x), Y(to.y - (to.def.flying ? FLY_Z : 0.15)));
    }
    ctx.stroke();

    // Particles: swap-remove dead ones; one fillStyle, integer rects.
    const p = this.px,
      ps = Math.max(2, s / 8) | 0;
    ctx.fillStyle = '#ffe9a0';
    for (let i = 0; i < this.particles;) {
      const o = i * 5;
      if ((p[o + 4] -= dt) <= 0) {
        p.copyWithin(o, --this.particles * 5, this.particles * 5 + 5);
        continue;
      }
      p[o] += p[o + 2] * dt;
      p[o + 1] += p[o + 3] * dt;
      ctx.fillRect(X(p[o]), Y(p[o + 1]), ps, ps);
      i++;
    }
  }
}

const expand = (c: string) => '#' + [...c.slice(1)].map((h) => h + h).join('');
