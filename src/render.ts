// Canvas 2D renderer, CPU-first 2.5D (BUILD.md §3.7). Reads sim state only, never mutates it.
// Static layer (ground, route, blocks) is an offscreen canvas redrawn only on maze/zoom change;
// the dynamic layer (creeps, tracers, particles) is redrawn every frame from baked sprites.
import { GUIDES } from './guide';
import { ROCK, WALL, type Maze } from './sim/maze';
import type { Combat } from './sim/towers';
import { UNITS_PER_CELL, type Creep, type WaveSim } from './sim/waves';

// Portrait sprites baked by tools/build_sprites.py (gitignored; empty glob = drawn fallbacks).
const SPRITE_URLS = import.meta.glob<string>('./sprites/*.webp', {
  eager: true,
  query: '?url',
  import: 'default',
});
export const slug = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
/** Portrait URL: `gem-B`, a special tower's slug, or `creep-<slug>`. */
export const portrait = (key: string): string | undefined => SPRITE_URLS[`./sprites/${key}.webp`];
export const towerKey = (d: { name: string; type: string; quality: number }) =>
  d.quality ? `gem-${d.type}` : slug(d.name);
const images = new Map<string, HTMLImageElement>();

export const GEM_COLOR: Record<string, string> = {
  B: '#3a6bff',
  D: '#e8f4ff',
  E: '#f0e6c8',
  G: '#2fbf5a',
  P: '#a24de0',
  Q: '#4fe0d8',
  R: '#e03a3a',
  Y: '#f2c52e',
  S: '#ff7ad9', // special towers
};
// Guide colours by build order (1 first), opal spots, specials.
const GUIDE_COLOR: Record<string, string> = {
  '1': '#f2e94e80',
  '2': '#f2c52e80',
  '3': '#f0a03080',
  '4': '#d0702080',
  '5': '#e03a3a80',
  O: '#4fe0d880',
  S: '#3a6bff99',
};
const FLY_Z = 40 / UNITS_PER_CELL; // cells
const BLOCK_H = 0.5; // front-face height of stones/towers, in cells
export const MAX_PARTICLES = 800;
const HUD_H = 44;
const PANEL_H = 150; // bottom panel

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
  selected = -1; // selected cell index
  hints: number[] = []; // cells of towers that can combine now
  guide = -1; // index into GUIDES, -1 = off
  showPath = true;
  private staticLayer = document.createElement('canvas');
  private staticDirty = true;
  // ponytail: one canvas per sprite, not a packed sheet; pack if drawImage switching shows in profiles.
  private sprites = new Map<string, HTMLCanvasElement>();
  private order: Creep[] = [];
  private seen = new WeakSet<Creep>();
  private px = new Float32Array(MAX_PARTICLES * 6); // x, y, vx, vy, life, colour index
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
    const base = Math.min(innerWidth, innerHeight - HUD_H - PANEL_H) / this.maze.w;
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

  /** Loaded portrait image, or null while loading / missing (a load re-bakes every sprite). */
  private img(key: string) {
    const url = portrait(key);
    if (!url) return null;
    let im = images.get(key);
    if (!im) {
      images.set(key, (im = new Image()));
      im.onload = () => {
        this.sprites.clear();
        this.staticDirty = true;
      };
      im.src = url;
    }
    return im.complete && im.naturalWidth ? im : null;
  }

  /** Round portrait token with a coloured ring. */
  private token(
    g: CanvasRenderingContext2D,
    im: HTMLImageElement,
    cx: number,
    cy: number,
    rad: number,
    ring: string,
  ) {
    g.save();
    g.beginPath();
    g.arc(cx, cy, rad, 0, 7);
    g.clip();
    g.drawImage(im, cx - rad, cy - rad, rad * 2, rad * 2);
    g.restore();
    g.strokeStyle = ring;
    g.lineWidth = Math.max(1, rad / 6);
    g.beginPath();
    g.arc(cx, cy, rad, 0, 7);
    g.stroke();
  }

  private sprite(key: string, w: number, h: number, draw: (g: CanvasRenderingContext2D) => void) {
    let s = this.sprites.get(key);
    if (!s) this.sprites.set(key, (s = bake(w, h, draw)));
    return s;
  }

  /** Stone block with a lit top face and darker front face; optional gem on top. */
  private block(color: string, gem = '', quality = 0, key = '') {
    const s = this.cell;
    const im = key ? this.img(key) : null;
    return this.sprite(`b${color}${gem}${quality}${im ? key : ''}`, s, s * (1 + BLOCK_H), (g) => {
      g.fillStyle = shade(color, 0.6);
      g.fillRect(0, s, s, s * BLOCK_H);
      g.fillStyle = color;
      g.fillRect(0, 0, s, s);
      g.fillStyle = shade(color, 1.25);
      g.fillRect(0, 0, s, Math.max(1, s / 10));
      if (!gem) return;
      if (im) {
        this.token(g, im, s / 2, s / 2, s * 0.44, GEM_COLOR[gem]);
        if (quality) {
          g.fillStyle = '#000a';
          g.fillRect(s * 0.62, s * 0.66, s * 0.38, s * 0.34);
          g.fillStyle = '#fff';
          g.font = `bold ${Math.max(7, s * 0.3)}px sans-serif`;
          g.textAlign = 'right';
          g.textBaseline = 'bottom';
          g.fillText(String(quality), s - 1, s);
        }
        return;
      }
      const c = GEM_COLOR[gem],
        m = s / 2,
        rad = s * (quality ? 0.2 + 0.045 * quality : 0.42);
      if (!quality) {
        // Special tower: 8-point star with alternating lit/shaded facets and a white core.
        for (let i = 0; i < 8; i++) {
          const a0 = (i / 8) * 6.283,
            a1 = ((i + 1) / 8) * 6.283,
            am = (a0 + a1) / 2;
          g.fillStyle = shade(c, i % 2 ? 0.6 : 1.2 - 0.05 * i);
          g.beginPath();
          g.moveTo(m, m);
          g.lineTo(m + Math.cos(a0) * rad * 0.5, m + Math.sin(a0) * rad * 0.5);
          g.lineTo(m + Math.cos(am) * rad, m + Math.sin(am) * rad);
          g.lineTo(m + Math.cos(a1) * rad * 0.5, m + Math.sin(a1) * rad * 0.5);
          g.fill();
        }
        g.fillStyle = '#fff';
        g.fillRect(m - 1, m - 1, 2, 2);
        return;
      }
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
    const rad = this.cell * (cr.def.boss ? 0.6 : 0.4);
    const key = 'creep-' + slug(cr.def.name);
    const im = this.img(key);
    if (im)
      return this.sprite(`c${key}${color}${rad}`, rad * 2 + 2, rad * 2 + 2, (g) =>
        this.token(g, im, rad + 1, rad + 1, rad, cr.def.boss ? '#ff4040' : color),
      );
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
        const k = GUIDES[this.guide]?.rows[r]?.[c] ?? '.';
        if (k && k !== '.' && maze.cells[maze.idx(c, r)] !== WALL) {
          g.fillStyle = GUIDE_COLOR[k];
          g.fillRect(c * s, r * s, s - 1, s - 1);
        }
      }
    const route = maze.route();
    if (route && this.showPath) {
      g.strokeStyle = 'rgba(255,210,74,0.3)';
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
              ? this.block('#6b6b6b', t.def.type, t.def.quality, towerKey(t.def))
              : this.block('#8a8a8a');
        g.drawImage(spr, c * s, (r - BLOCK_H) * s);
      }
    this.staticDirty = false;
  }

  private emit(x: number, y: number, vx: number, vy: number, life: number, colour: number) {
    if (this.particles >= MAX_PARTICLES) return;
    const p = this.px,
      o = this.particles++ * 6;
    p[o] = x;
    p[o + 1] = y;
    p[o + 2] = vx;
    p[o + 3] = vy;
    p[o + 4] = life;
    p[o + 5] = colour;
  }

  /** Cosmetic ring burst (deaths, splash impacts). */
  private burst(x: number, y: number, n: number, speed = 3, colour = 0) {
    for (let k = 0; k < n; k++) {
      const a = (k / n) * 6.283;
      this.emit(x, y - 0.2, Math.cos(a) * speed, Math.sin(a) * speed, 0.5, colour);
    }
  }

  /** Emit cosmetic hit sparks, splash rings and burn-aura embers (call once per sim tick). */
  sparks() {
    const { combat } = this;
    for (const { from, to } of combat.shots) {
      const a = Math.random() * 7; // cosmetic only, so Math.random is fine
      const y = to.y - (to.def.flying ? FLY_Z : 0);
      this.emit(to.x, y - 0.3, Math.cos(a) * 2, Math.sin(a) * 2 - 1, 0.4, 0);
      const fx = combat.fx(from.def);
      if (fx.cleave || fx.frost) this.burst(to.x, y, 8, fx.cleave ? 4 : 3, fx.frost ? 3 : 1);
    }
    for (const t of combat.towers)
      for (const e of combat.fx(t.def).enemy) {
        if (!e.dps) continue;
        const reach = e.range / UNITS_PER_CELL,
          a = Math.random() * 6.283,
          d = Math.sqrt(Math.random()) * reach;
        const x = t.c + 0.5 + Math.cos(a) * d,
          y = t.r + 0.5 + Math.sin(a) * d;
        this.emit(x, y, 0, -1.2, 0.9, Math.random() < 0.4 ? 2 : 1);
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

    // Burn auras (Volcano, Asteriated Ruby...): a slow pulsing heat ring.
    const pulse = 0.3 + 0.12 * Math.sin(now / 250);
    for (const t of this.combat.towers)
      for (const e of this.combat.fx(t.def).enemy) {
        if (!e.dps) continue;
        ctx.strokeStyle = `rgba(255,110,30,${pulse})`;
        ctx.fillStyle = `rgba(255,80,20,${pulse / 3})`;
        ctx.lineWidth = Math.max(1, s / 8);
        ctx.beginPath();
        ctx.arc(X(t.c + 0.5), Y(t.r + 0.5), (e.range / UNITS_PER_CELL) * s, 0, 7);
        ctx.fill();
        ctx.stroke();
      }

    ctx.strokeStyle = '#6ff';
    ctx.lineWidth = 1;
    for (const h of this.hints)
      ctx.strokeRect(
        X(h % this.maze.w) + 2,
        Y(((h / this.maze.w) | 0) - BLOCK_H) + 2,
        s - 4,
        s - 4,
      );
    if (this.selected >= 0) {
      ctx.strokeStyle = '#ffd24a';
      ctx.lineWidth = 2;
      const sc = this.selected % this.maze.w,
        sr = (this.selected / this.maze.w) | 0;
      ctx.strokeRect(X(sc), Y(sr - BLOCK_H), s, s * (1 + BLOCK_H));
    }

    // Keep last frame's order (dead creeps dropped, new ones appended) so the sort stays cheap.
    const order = this.order;
    let n = 0;
    for (const cr of order)
      if (cr.alive) order[n++] = cr;
      else if (cr.hp <= 0)
        this.burst(cr.x, cr.y - (cr.def.flying ? FLY_Z : 0), cr.def.boss ? 40 : 10);
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

    // Particles: swap-remove dead ones; integer rects, fillStyle switched only on colour change.
    const p = this.px,
      ps = Math.max(2, s / 8) | 0;
    let colour = -1;
    for (let i = 0; i < this.particles;) {
      const o = i * 6;
      if ((p[o + 4] -= dt) <= 0) {
        p.copyWithin(o, --this.particles * 6, this.particles * 6 + 6);
        continue;
      }
      p[o] += p[o + 2] * dt;
      p[o + 1] += p[o + 3] * dt;
      if (p[o + 5] !== colour) ctx.fillStyle = PARTICLE_COLOR[(colour = p[o + 5])];
      ctx.fillRect(X(p[o]), Y(p[o + 1]), ps, ps);
      i++;
    }
  }
}

// 0 spark, 1 fire, 2 ember, 3 frost
const PARTICLE_COLOR = ['#ffe9a0', '#ff7a1a', '#ffcf40', '#bfe8ff'];
const expand = (c: string) => '#' + [...c.slice(1)].map((h) => h + h).join('');
