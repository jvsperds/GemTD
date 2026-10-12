// Canvas 2D renderer, CPU-first 2.5D (BUILD.md §3.7). Reads sim state only, never mutates it.
// Static layer (ground, route, blocks) is an offscreen canvas redrawn only on maze/zoom change;
// the dynamic layer (creeps, tracers, particles) is redrawn every frame from baked sprites.
import { ROCK, WALL, type Maze } from './sim/maze';
import { PEDAL, PEDALS, SPELL, TIERS } from './sim/pedals';
import type { Combat, GemDef, SpecialDef, Tower } from './sim/towers';
import { UNITS_PER_CELL, type Creep, type WaveSim } from './sim/waves';

export const slug = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
export const towerKey = (d: { name: string; type: string; quality: number }) =>
  d.quality ? `gem-${d.type}` : slug(d.name);

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
const GUIDE_COLOR = '#f2c52e80'; // one colour for every guide mark, as in the game
// Route legs in order: gold, cyan, pink, lime, orange, violet.
const LEG_COLORS = ['#ffd24a', '#4ad2ff', '#ff6ec7', '#8cff5a', '#ff9440', '#b48cff'].map(
  (c) => c + '66',
);
const FLY_Z = 40 / UNITS_PER_CELL; // cells
const BLOCK_H = 0.5; // front-face height of stones/towers, in cells
const TALL = 0.55;
const TOWER_H = 0.2; // front-face height of a tower's own (lower) base, in cells // how far modelled towers rise above their block, in cells
export const MAX_PARTICLES = 800;
const HUD_H = 44;
const PANEL_H = 150; // bottom panel
const FRAME = 2; // stone border around the board, in cells
const PLATEAU = 4; // stone ground round the wall before the drop, in cells (ragged by ±0.75)
const CLIFF = 1.5; // height of the plateau's south face, in cells
const TREES = 0.07; // share of lowland cells that grow a tree
const WORLD = 20; // lowland past the board you can pan to, in cells; it darkens toward this edge
const DUSK = FRAME + PLATEAU + 3; // cells past the board where the darkening starts: clear of the cliff
/** Cheap deterministic 0..1 noise for cosmetic per-cell variation. */
const hash2 = (c: number, r: number) => {
  const n = Math.sin(c * 127.1 + r * 311.7) * 43758.5;
  return n - Math.floor(n);
};

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

/** Blend two #rrggbb colours: t = 0 gives a, 1 gives b. */
function mix(a: string, b: string, t: number) {
  const x = parseInt(a.slice(1), 16),
    y = parseInt(b.slice(1), 16);
  const ch = (sh: number) => Math.round(((x >> sh) & 255) * (1 - t) + ((y >> sh) & 255) * t);
  return '#' + ((ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).padStart(6, '0');
}

function bake(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.ceil(w));
  c.height = Math.max(1, Math.ceil(h));
  draw(c.getContext('2d')!);
  return c;
}

const BONE = '#f4efe4';
const INK = '#241c1c';
const dk = (col: string, t: number) => mix(col, '#000000', t);
const lt = (col: string, t: number) => mix(col, '#ffffff', t);

/** Dark outline: the drawing's silhouette stamped behind itself in a ring of width w, so models
 *  read on any tile. */
export function outline(g: CanvasRenderingContext2D, w: number) {
  const { width, height } = g.canvas;
  const sil = bake(width, height, (h) => {
    h.drawImage(g.canvas, 0, 0);
    h.globalCompositeOperation = 'source-in';
    h.fillStyle = INK;
    h.fillRect(0, 0, width, height);
  });
  g.save();
  g.resetTransform();
  g.globalCompositeOperation = 'destination-over';
  for (let i = 0; i < 8; i++) g.drawImage(sil, Math.cos(i * 0.785) * w, Math.sin(i * 0.785) * w);
  g.restore();
}

// Original special-tower models: every GemTD tower is a ward with a big eye, so each one is a
// body archetype + body/accent colours + eye colour. Silhouettes loosely follow the Dota renders;
// nothing is traced from them.
type Body = 'orb' | 'pillar' | 'house' | 'mech' | 'bird' | 'plant' | 'crystal' | 'beast' | 'rune';
const MODELS: Record<string, [Body, string, string, 'y' | 'b']> = {
  silver: ['orb', '#34404c', '#3fb0ff', 'y'],
  'silver-knight': ['mech', '#3a3f48', '#f0a030', 'y'],
  'pink-diamond': ['pillar', '#c8c8d0', '#f0a030', 'y'],
  'huge-pink-diamond': ['pillar', '#b0b0bc', '#ff7ad9', 'y'],
  'koh-i-noor-diamond': ['pillar', '#d8dce8', '#3a6bff', 'b'],
  malachite: ['plant', '#8fbf3a', '#2f8f3a', 'y'],
  'vivid-malachite': ['plant', '#a0c83a', '#2fbf5a', 'y'],
  'uranium-238': ['mech', '#9aa0a8', '#555555', 'y'],
  'uranium-235': ['mech', '#e0a020', '#555555', 'y'],
  'depleted-kyparium': ['mech', '#4fc0e0', '#333333', 'b'],
  'asteriated-ruby': ['bird', '#3a2a30', '#e05a20', 'y'],
  volcano: ['crystal', '#6a4a2a', '#e08020', 'y'],
  bloodstone: ['orb', '#a02020', '#e8e0d0', 'y'],
  'antique-bloodstone': ['house', '#8a5a3a', '#6a3020', 'y'],
  'the-crown-prince': ['house', '#9a9ab8', '#6a6a90', 'b'],
  jade: ['pillar', '#505860', '#e0b040', 'y'],
  quartz: ['bird', '#8a4a3a', '#f0e0d0', 'y'],
  'grey-jade': ['mech', '#5a8ac0', '#8a6a4a', 'y'],
  'monkey-king-jade': ['beast', '#e0a060', '#e03a3a', 'y'],
  'diamond-cullinan': ['orb', '#f0e0a0', '#ffffff', 'y'],
  'lucky-chinese-jade': ['house', '#a02a2a', '#e0b040', 'y'],
  'charming-lazurite': ['bird', '#e8c8a0', '#8a4ae0', 'y'],
  'golden-jubilee': ['bird', '#e04a20', '#f2c52e', 'y'],
  gold: ['plant', '#c07020', '#e04a20', 'y'],
  'egypt-gold': ['mech', '#b08a20', '#f2c52e', 'y'],
  'dark-emerald': ['pillar', '#3a3a44', '#e06a20', 'y'],
  'emerald-golem': ['bird', '#6a6a70', '#c8c8c8', 'y'],
  'paraiba-tourmaline': ['crystal', '#6a3a5a', '#c8c8d0', 'y'],
  'elaborately-carved-tourmaline': ['beast', '#6a4a2a', '#e0a040', 'y'],
  'sapphire-star-of-adam': ['beast', '#3a4a8a', '#4fa0e0', 'y'],
  'deepsea-pearl': ['plant', '#d8c830', '#e8e8e8', 'y'],
  'chrysoberyl-cat-s-eye': ['plant', '#5a3a2a', '#3a5a8a', 'y'],
  'red-coral': ['beast', '#e06040', '#c04040', 'y'],
  'natural-zumurud': ['pillar', '#4a3a8a', '#2fbf5a', 'y'],
  'carmen-lucia': ['orb', '#5a2a3a', '#c04a5a', 'b'],
  'yellow-sapphire': ['crystal', '#d8e4f0', '#a0c8f0', 'y'],
  'northern-saber-s-eye': ['beast', '#e0e0e8', '#40c0d0', 'y'],
  'star-sapphire': ['crystal', '#c8d8e8', '#8ab0d8', 'b'],
  obsidian: ['orb', '#3a3030', '#e05a20', 'y'],
  agate: ['beast', '#e0c080', '#a07040', 'y'],
  'fantastic-miss-shrimp': ['bird', '#e0a020', '#3a3030', 'y'],
  geluanshi: ['bird', '#f0f0e0', '#e0b040', 'y'],
  'the-burning-stone': ['crystal', '#3a4a6a', '#4fa0e0', 'b'],
  'the-great-stone': ['pillar', '#6a6a6a', '#8fbf3a', 'y'],
  'black-opal': ['orb', '#1a1a2a', '#8a4ae0', 'y'],
  ehome: ['plant', '#f0e6c8', '#e04a8a', 'b'],
  'wings-stone': ['bird', '#e0c060', '#f0f0f0', 'y'],
  'regent-diamond': ['pillar', '#f0f4ff', '#ff3a6a', 'b'],
  'kyparium-core': ['mech', '#2a2a3a', '#4fe0d8', 'b'],
  'the-blood-king': ['house', '#5a1010', '#e03a3a', 'b'],
  'cullinan-heart': ['orb', '#fff4c0', '#3a6bff', 'b'],
  'star-of-eden': ['beast', '#1a5a3a', '#2fbf5a', 'b'],
};
// Pedals: hexagonal rune stones in the spell's colour, rimmed by tier (base, Sparkling, Blingbling).
const SPELL_COLOR: Record<string, string> = {
  Ensnare: '#6a8a3a',
  Gale: '#5ac8a0',
  Torrent: '#2f6fd0',
  Howl: '#a0503a',
  Acid: '#8fd02f',
  Paralysis: '#d0a02f',
  Terrorize: '#6a2f8a',
  Decrepify: '#4a5a6a',
};
const RUNE_GLYPH = new Map<string, number>();
for (const d of Object.values(PEDALS)) {
  const tier = Math.max(
    0,
    TIERS.findIndex((x, i) => i && d.name.startsWith(x)),
  );
  const spell = d.name.slice(TIERS[tier].length).replace(' Pedal', '');
  MODELS[slug(d.name)] = ['rune', SPELL_COLOR[spell], ['#b8b8c4', '#3fb0ff', '#f2c52e'][tier], 'y'];
  RUNE_GLYPH.set(slug(d.name), Object.keys(SPELL_COLOR).indexOf(spell) * 10 + tier);
}
export const hasModel = (key: string) => key in MODELS;
const spellColor = (spell: string) => SPELL_COLOR[spell[0].toUpperCase() + spell.slice(1)];

/** Draw a special tower's head centred at (mx, my) within radius r. False if it has none. */
function towerModel(g: CanvasRenderingContext2D, key: string, mx: number, my: number, r: number) {
  const md = MODELS[key];
  if (!md) return false;
  const [body, c, a, eye] = md;
  const poly = (pts: number[], fill: string) => {
    g.fillStyle = fill;
    g.beginPath();
    for (let i = 0; i < pts.length; i += 2) g.lineTo(mx + pts[i] * r, my + pts[i + 1] * r);
    g.fill();
  };
  const disc = (x: number, y: number, rr: number, fill: string) => {
    g.fillStyle = fill;
    g.beginPath();
    g.arc(mx + x * r, my + y * r, rr * r, 0, 7);
    g.fill();
  };
  if (body === 'rune') {
    const hex = (k: number) =>
      Array.from({ length: 6 }, (_, i) => [
        Math.cos((i / 6) * 6.283 - 1.571) * k,
        Math.sin((i / 6) * 6.283 - 1.571) * k * 0.95,
      ]).flat();
    poly(hex(0.98), a); // tier rim
    poly(hex(0.84), shade(c, 0.55));
    poly(
      hex(0.84).map((v, i) => (i % 2 ? Math.min(v, 0.1) : v)),
      c,
    ); // lit upper half
    poly(hex(0.62), shade(c, 0.8));
    // Glyph: three strokes chosen by spell, glowing in the tier colour.
    const n = RUNE_GLYPH.get(key)!,
      spell = (n / 10) | 0,
      tier = n % 10;
    g.save();
    g.strokeStyle = a;
    g.shadowColor = a;
    g.shadowBlur = r * (0.2 + 0.2 * tier);
    g.lineWidth = Math.max(1, r * 0.12);
    g.lineCap = 'round';
    g.beginPath();
    g.moveTo(mx, my - r * 0.45);
    g.lineTo(mx, my + r * 0.45);
    for (let k = 0; k < 2; k++) {
      const t = (spell * 0.785 + k * 2.1) % 6.283;
      g.moveTo(mx, my + (k ? 0.15 : -0.2) * r);
      g.lineTo(mx + Math.cos(t) * r * 0.4, my + (k ? 0.15 : -0.2) * r + Math.sin(t) * r * 0.3);
    }
    g.stroke();
    g.restore();
    for (let k = 0; k < tier * 2; k++) {
      const t = (k / (tier * 2)) * 6.283;
      disc(Math.cos(t) * 0.98, Math.sin(t) * 0.93, 0.09, '#fff');
    }
    return true;
  }
  // Rounded part in flat two-tone: a shadow disc with the lit one set up-left, and a glint.
  const ball = (x: number, y: number, rr: number, col: string) => {
    disc(x, y, rr, dk(col, 0.35));
    disc(x - rr * 0.08, y - rr * 0.1, rr * 0.88, col);
    disc(x - rr * 0.42, y - rr * 0.48, rr * 0.16, lt(col, 0.4));
  };
  let ey = -0.1; // eye centre y
  let er = 0.3; // eye radius
  switch (body) {
    case 'orb':
      for (let i = 0; i < 8; i++) {
        const t = (i / 8) * 6.283;
        const p = (k: number, d: number) => [Math.cos(t + k) * d, Math.sin(t + k) * d];
        poly([...p(0, 0.66), ...p(0.25, 1), ...p(0.25, 0.66)], lt(a, 0.2));
        poly([...p(0.25, 0.66), ...p(0.25, 1), ...p(0.5, 0.66)], dk(a, 0.25));
      }
      ball(0, 0.03, 0.8, c);
      er = 0.36;
      disc(0, ey, er + 0.1, dk(c, 0.5));
      break;
    case 'pillar':
      poly([-0.7, 0.95, 0.7, 0.95, 0.55, 0.75, -0.55, 0.75], dk(a, 0.3));
      poly([-0.5, 0.8, 0.5, 0.8, 0.42, -0.2, -0.42, -0.2], dk(c, 0.3));
      poly([-0.5, 0.8, 0.05, 0.8, 0.05, -0.2, -0.42, -0.2], c);
      poly([-0.5, 0.8, -0.38, 0.8, -0.32, -0.2, -0.42, -0.2], lt(c, 0.3));
      for (const y of [0.12, 0.5]) {
        poly([-0.58, y, 0.58, y, 0.58, y + 0.14, -0.58, y + 0.14], dk(a, 0.3));
        poly([-0.58, y, 0.05, y, 0.05, y + 0.14, -0.58, y + 0.14], a);
      }
      ey = -0.45;
      poly([-0.14, -0.8, 0, -1, 0.14, -0.8], a);
      ball(0, ey, 0.46, c);
      break;
    case 'house':
      poly([0.36, -0.8, 0.6, -0.8, 0.6, -0.2, 0.36, -0.4], dk(c, 0.2));
      poly([-0.6, 0.92, 0.6, 0.92, 0.6, 0, -0.6, 0], dk(c, 0.3));
      poly([-0.6, 0.92, 0.1, 0.92, 0.1, 0, -0.6, 0], c);
      poly([-0.6, 0.05, 0.6, 0.05, 0.6, 0.2, -0.6, 0.2], dk(c, 0.5));
      poly([-0.16, 0.92, 0.16, 0.92, 0.16, 0.56, -0.16, 0.56], '#1a1410');
      disc(0, 0.56, 0.16, '#1a1410');
      poly([-0.5, 0.74, -0.32, 0.74, -0.32, 0.5, -0.5, 0.5], '#f7d23a');
      poly([-0.88, 0.1, 0, -0.92, 0.88, 0.1], dk(a, 0.3));
      poly([-0.88, 0.1, 0, -0.92, 0, 0.1], a);
      poly([-0.88, 0.1, 0, -0.92, 0.05, -0.82, -0.74, 0.1], lt(a, 0.3));
      ey = -0.2;
      er = 0.26;
      break;
    case 'mech':
      for (const x of [-0.28, 0.28]) {
        poly([x - 0.07, -0.9, x + 0.07, -0.9, x + 0.07, -0.4, x - 0.07, -0.4], dk(a, 0.2));
        disc(x, -0.9, 0.11, lt(a, 0.3));
      }
      poly([-0.8, -0.5, 0.8, -0.5, 0.65, 0.75, -0.65, 0.75], dk(c, 0.3));
      poly([-0.8, -0.5, 0.1, -0.5, 0.08, 0.75, -0.65, 0.75], c);
      poly([-0.84, -0.56, 0.84, -0.56, 0.78, -0.3, -0.78, -0.3], c);
      poly([-0.84, -0.56, 0.1, -0.56, 0.1, -0.3, -0.78, -0.3], lt(c, 0.25));
      for (const [x, y] of [
        [-0.64, -0.43],
        [0.64, -0.43],
        [-0.5, 0.6],
        [0.5, 0.6],
      ])
        disc(x, y, 0.06, dk(c, 0.55));
      poly([-0.15, 0.75, 0.15, 0.75, 0.1, 0.98, -0.1, 0.98], a);
      ey = 0.15;
      disc(0, ey, er + 0.1, dk(c, 0.55));
      break;
    case 'bird':
      for (const s of [-1, 1])
        [
          [-1, -0.55],
          [-0.98, -0.05],
          [-0.85, 0.45],
        ].forEach(([tx, ty], i) =>
          poly(
            [
              s * -0.15,
              -0.15 + i * 0.15,
              s * tx,
              ty,
              s * (tx + 0.12),
              ty + 0.22,
              s * -0.15,
              0.2 + i * 0.12,
            ],
            dk(lt(a, 0.2), i * 0.18 + (s > 0 ? 0.2 : 0)),
          ),
        );
      poly([-0.2, 0.6, 0, 0.98, 0.2, 0.6], dk(a, 0.3));
      poly([-0.3, -0.3, -0.22, -0.82, 0, -0.42, 0.22, -0.82, 0.3, -0.3], dk(c, 0.2));
      poly([-0.1, -0.4, 0, -0.98, 0.1, -0.4], a);
      ball(0, 0.2, 0.52, c);
      poly([-0.12, 0.42, 0.12, 0.42, 0, 0.68], '#f2b530');
      ey = 0.05;
      break;
    case 'plant':
      for (let i = 0; i < 5; i++) {
        const t = -2.8 + i * 0.7;
        const x = Math.cos(t);
        const y = Math.sin(t);
        const base = [x * 0.2, 0.2 + y * 0.2],
          tip = [x * 0.98, y * 0.98];
        poly([...base, x * 0.7 - y * 0.3, y * 0.7 + x * 0.3, ...tip], dk(a, 0.25));
        poly([...base, x * 0.7 + y * 0.3, y * 0.7 - x * 0.3, ...tip], lt(a, 0.15));
      }
      poly([-0.12, 0.95, 0.12, 0.95, 0.08, 0.1, -0.08, 0.1], dk(c, 0.4));
      ball(0, 0, 0.48, c);
      break;
    case 'crystal':
      poly([-0.7, 0.9, -0.85, -0.2, -0.45, 0.2], c);
      poly([-0.7, 0.9, -0.85, -0.2, -0.78, 0.9], lt(c, 0.3));
      poly([0.7, 0.9, 0.9, -0.3, 0.45, 0.2], dk(c, 0.35));
      poly([-0.5, 0.9, -0.35, -0.95, 0, -0.6, 0.35, -0.95, 0.5, 0.9], c);
      poly([-0.5, 0.9, -0.35, -0.95, -0.2, -0.8, -0.3, 0.9], lt(c, 0.35));
      poly([0, -0.6, 0.35, -0.95, 0.5, 0.9, 0, 0.9], dk(c, 0.3));
      poly([0.25, -0.85, 0.35, -0.95, 0.5, 0.9, 0.36, 0.9], dk(c, 0.5));
      poly([-0.3, 0.9, 0, 0.45, 0.3, 0.9], a);
      poly([0, 0.9, 0, 0.45, 0.3, 0.9], dk(a, 0.3));
      ey = 0.05;
      break;
    case 'beast':
      for (const s of [-1, 1]) {
        poly([s * 0.78, -0.2, s * 0.66, -0.98, s * 0.22, -0.55], s < 0 ? a : dk(a, 0.25));
        poly([s * 0.66, -0.3, s * 0.62, -0.75, s * 0.38, -0.5], lt(a, 0.45));
        poly([s * 0.75, 0, s * 1, 0.3, s * 0.68, 0.42], s < 0 ? c : dk(c, 0.3));
      }
      ball(0, 0.1, 0.8, c);
      g.fillStyle = lt(c, 0.55);
      g.beginPath();
      g.ellipse(mx, my + 0.58 * r, 0.36 * r, 0.24 * r, 0, 0, 7);
      g.fill();
      poly([-0.1, 0.42, 0.1, 0.42, 0, 0.54], INK);
      for (const x of [-0.2, 0.12]) poly([x, 0.66, x + 0.04, 0.84, x + 0.08, 0.66], BONE);
      disc(-0.52, 0.42, 0.13, a);
      disc(0.52, 0.42, 0.13, a);
      er = 0.34;
  }
  drawEye(g, mx, my + ey * r, er * r, eye === 'b');
  return true;
}

/** The ward eye every tower carries: rim, sclera, iris, pupil, catchlight. */
function drawEye(g: CanvasRenderingContext2D, x: number, y: number, er: number, blue: boolean) {
  const disc = (dx: number, dy: number, rr: number, fill: string) => {
    g.fillStyle = fill;
    g.beginPath();
    g.arc(x + dx, y + dy, rr, 0, 7);
    g.fill();
  };
  disc(0, 0, er * 1.12, '#1a1410');
  disc(0, 0, er, blue ? '#e8f0ff' : '#f7d23a');
  disc(0, 0, er * 0.62, blue ? '#3a8aff' : '#e0701e');
  disc(0, 0, er * 0.32, '#0a0808');
  disc(-er * 0.35, -er * 0.35, er * 0.18, '#fff');
}

/** Cut gem centred at (m, m): four facets with baked light from the top-left. */
function gemFacets(g: CanvasRenderingContext2D, c: string, m: number, my: number, rad: number) {
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
    g.moveTo(m, my);
    g.lineTo(m + dx * rad, my + dy * rad);
    g.lineTo(m + nx * rad, my + ny * rad);
    g.fill();
  });
}

const ring = (n: number, rx: number, ry: number, dy = 0, rot = 0) =>
  Array.from({ length: n }, (_, i) => {
    const t = rot + (i / n) * 6.283;
    return [Math.cos(t) * rx, Math.sin(t) * ry + dy];
  });
// Unit outlines per gem type (y down), each cut like the real stone.
const CUTS: Record<string, number[][]> = {
  B: ring(10, 0.72, 0.95), // sapphire: oval
  R: ring(8, 0.9, 0.9, 0, 0.39).map(([x, y]) => [x * 0.95, y * 0.95]), // ruby: cushion
  G: [
    [-0.45, -0.9],
    [0.45, -0.9],
    [0.7, -0.65],
    [0.7, 0.65],
    [0.45, 0.9],
    [-0.45, 0.9],
    [-0.7, 0.65],
    [-0.7, -0.65],
  ], // emerald: step cut
  Y: [
    ...ring(12, 0.72, 0.62, 0.3).slice(0, 7), // round bottom, right to left
    [-0.5, -0.35],
    [0, -0.98],
    [0.5, -0.35],
  ], // topaz: pear
  Q: [
    [-0.35, -0.95],
    [0.35, -0.95],
    [0.55, -0.7],
    [0.55, 0.7],
    [0.35, 0.95],
    [-0.35, 0.95],
    [-0.55, 0.7],
    [-0.55, -0.7],
  ], // aquamarine: hex prism
};

/** Real-gem head centred at (m, m): faceted outline + table, cabochon opal, crystal amethyst. */
// Where each gem's eye sits (unit coords) and whether it is blue; the rest are yellow.
const GEM_EYE: Record<string, [number, boolean]> = {
  D: [-0.3, true],
  P: [0.25, false],
  Y: [0.25, false],
};

/** Base gem head: its real cut, then the ward eye on the stone. */
function gemCut(g: CanvasRenderingContext2D, gem: string, c: string, m: number, rad: number) {
  gemBody(g, gem, c, m, rad);
  const [ey, blue] = GEM_EYE[gem] ?? [0, false];
  drawEye(g, m, m + ey * rad, rad * (gem === 'Q' ? 0.34 : 0.4), blue);
}

function gemBody(g: CanvasRenderingContext2D, gem: string, c: string, m: number, rad: number) {
  const P = (x: number, y: number) => [m + x * rad, m + y * rad] as const;
  const face = (pts: number[][], fill: string) => {
    g.fillStyle = fill;
    g.beginPath();
    for (const [x, y] of pts) g.lineTo(...P(x, y));
    g.fill();
  };
  // Facet brightness from its outward direction vs light from the top-left.
  const lit = (x: number, y: number) =>
    shade(c, 1 + 0.45 * ((-x - y) / (Math.hypot(x, y) || 1)) * 0.7);
  if (gem === 'E') {
    // Opal: smooth domed cabochon with play-of-colour flecks.
    const gr = g.createRadialGradient(...P(-0.3, -0.35), rad * 0.1, ...P(0, 0), rad);
    gr.addColorStop(0, '#fff');
    gr.addColorStop(0.5, c);
    gr.addColorStop(1, shade(c, 0.55));
    g.fillStyle = gr;
    g.beginPath();
    g.ellipse(m, m, rad * 0.8, rad * 0.95, 0, 0, 7);
    g.fill();
    ['#4fe0d8', '#ff7ad9', '#7ad05a', '#f2a03a'].forEach((f, i) => {
      g.fillStyle = f + 'b0';
      g.beginPath();
      g.arc(...P([-0.3, 0.3, 0.2, -0.25][i], [0.1, -0.2, 0.45, 0.5][i]), rad * 0.13, 0, 7);
      g.fill();
    });
    return;
  }
  if (gem === 'P') {
    // Amethyst: cluster of three pointed crystals, each with a lit and a shaded half.
    for (const [x, h, w] of [
      [-0.45, 0.6, 0.28],
      [0.45, 0.55, 0.28],
      [0, 0.95, 0.36],
    ]) {
      face(
        [
          [x - w, 0.9],
          [x - w, 0.9 - h],
          [x, 0.9 - h - 0.35],
          [x, 0.9],
        ],
        shade(c, 1.25),
      );
      face(
        [
          [x + w, 0.9],
          [x + w, 0.9 - h],
          [x, 0.9 - h - 0.35],
          [x, 0.9],
        ],
        shade(c, 0.7),
      );
    }
    return;
  }
  if (gem === 'D') {
    // Diamond, brilliant cut side-on: flat table, crown facets, pointed pavilion.
    const girdle = -0.2;
    const crown = [-0.95, -0.55, 0, 0.55, 0.95];
    for (let i = 0; i < 4; i++)
      face(
        [
          [crown[i], girdle],
          [crown[i + 1], girdle],
          [crown[i + 1] * 0.55, -0.7],
          [crown[i] * 0.55, -0.7],
        ],
        shade(c, 1.2 - i * 0.12),
      );
    for (let i = 0; i < 4; i++)
      face(
        [
          [crown[i], girdle],
          [crown[i + 1], girdle],
          [0, 0.98],
        ],
        shade(c, 1.05 - i * 0.15),
      );
    face(
      [
        [-0.52, -0.7],
        [0.52, -0.7],
        [0.4, -0.8],
        [-0.4, -0.8],
      ],
      '#fff',
    );
    return;
  }
  const out = CUTS[gem] ?? ring(8, 0.9, 0.9);
  const tab = out.map(([x, y]) => [x * 0.5, y * 0.5 - 0.05]);
  out.forEach(([x, y], i) => {
    const [nx, ny] = out[(i + 1) % out.length];
    face([[x, y], [nx, ny], tab[(i + 1) % out.length], tab[i]], lit(x + nx, y + ny));
  });
  face(tab, shade(c, 1.15));
  if (gem === 'G')
    face(
      out.map(([x, y]) => [x * 0.75, y * 0.75 - 0.03]),
      shade(c, 1.15),
    ); // step
  if (gem === 'G') face(tab, shade(c, 1.25));
  face([tab[0], tab[1], [tab[1][0] * 0.4, tab[1][1] * 0.4]], 'rgba(255,255,255,0.35)');
}

const HEAD_Y = 0.48; // head centre below the tower sprite's top, in cells
/** Head radius in cells: gems grow with quality, special towers are biggest. */
const headSize = (quality: number) => (quality ? 0.24 + 0.035 * quality : 0.44);

/** Standing tower into an s × s(1 + TOWER_H + TALL) canvas: gem-cut stone, plinth, shaft, head. */
function drawTower(
  g: CanvasRenderingContext2D,
  s: number,
  key: string,
  gem: string,
  quality: number,
) {
  const T = s * TALL;
  const [, c, a] = quality ? ['', dk(GEM_COLOR[gem], 0.5), GEM_COLOR[gem]] : MODELS[key];
  // Gem-cut stone: dark gem-tinted block, top face cut into four lit facets around a
  // table.
  const st = mix(a, '#6b6b6b', 0.55);
  g.fillStyle = shade(st, 0.7);
  g.fillRect(0, T + s, s, s * TOWER_H);
  const q = s * 0.22;
  const tri = (pts: number[], col: string) => {
    g.fillStyle = col;
    g.beginPath();
    for (let i = 0; i < pts.length; i += 2) g.lineTo(pts[i], T + pts[i + 1]);
    g.fill();
  };
  tri([0, 0, s, 0, s - q, q, q, q], shade(st, 1.35));
  tri([0, 0, q, q, q, s - q, 0, s], shade(st, 1.15));
  tri([s, 0, s, s, s - q, s - q, s - q, q], shade(st, 0.85));
  tri([0, s, q, s - q, s - q, s - q, s, s], shade(st, 0.7));
  tri([q, q, s - q, q, s - q, s - q, q, s - q], st);
  const cx = s / 2,
    foot = T + s * 0.62,
    head = s * headSize(quality);
  // Soft contact shadow.
  g.fillStyle = 'rgba(0,0,0,0.35)';
  g.beginPath();
  g.ellipse(cx + s * 0.04, foot + s * 0.04, s * 0.4, s * 0.16, 0, 0, 7);
  g.fill();
  // Plinth, shaft and head on their own layer, so the outline rings the model and not the stone.
  const fig = bake(s, g.canvas.height, (g) => {
    const drum = (w: number, y0: number, h: number, col: string) => {
      const gr = g.createLinearGradient(cx - w, 0, cx + w, 0);
      gr.addColorStop(0, shade(col, 1.25));
      gr.addColorStop(0.45, col);
      gr.addColorStop(1, shade(col, 0.45));
      g.fillStyle = gr;
      g.beginPath();
      g.ellipse(cx, y0, w, w * 0.38, 0, 0, Math.PI);
      g.lineTo(cx - w, y0 - h);
      g.ellipse(cx, y0 - h, w, w * 0.38, 0, Math.PI, 0, true);
      g.fill();
      g.fillStyle = shade(col, 1.1);
      g.beginPath();
      g.ellipse(cx, y0 - h, w, w * 0.38, 0, 0, 7);
      g.fill();
    };
    // A two-step drum plinth in the accent colour, then the shaft up to the head: a rounded
    // column, lit from the left.
    drum(s * 0.36, foot, s * 0.1, dk(a, 0.2));
    drum(s * 0.26, foot - s * 0.1, s * 0.08, a);
    const top = s * HEAD_Y;
    drum(s * 0.12, foot - s * 0.18, foot - s * 0.18 - top, dk(c, 0.15));
    // Head on its own canvas so the rounding wash only touches the head's pixels.
    const hd = bake(head * 2 + 2, head * 2 + 2, (h) => {
      const o = head + 1;
      if (quality) gemCut(h, gem, GEM_COLOR[gem], o, head);
      else towerModel(h, key, o, o, head);
      const gl = h.createRadialGradient(o - head * 0.4, o - head * 0.5, 0, o, o, head * 1.1);
      gl.addColorStop(0, 'rgba(255,255,255,0.18)');
      gl.addColorStop(0.6, 'rgba(255,255,255,0)');
      gl.addColorStop(1, 'rgba(0,0,0,0.3)');
      h.globalCompositeOperation = 'source-atop';
      h.fillStyle = gl;
      h.fillRect(0, 0, o * 2, o * 2);
    });
    g.drawImage(hd, cx - head - 1, top - head - 1);
    outline(g, Math.max(1, s * 0.028));
  });
  g.drawImage(fig, 0, 0);
}

const icons = new Map<string, string>();
/** Tower portrait for the panel and book: the model's upper half, as a cached data URL. */
export function towerIcon(d: { name: string; type: string; quality: number }) {
  const key = towerKey(d) + d.quality;
  let url = icons.get(key);
  if (!url) {
    const s = 96;
    const full = bake(s, s * (1 + TOWER_H + TALL), (g) =>
      drawTower(g, s, towerKey(d), d.type, d.quality),
    );
    url = bake(s, s, (g) => g.drawImage(full, 0, 0, s, s * 1.05, 0, 0, s, s)).toDataURL();
    icons.set(key, url);
  }
  return url;
}

// Original creep models, each drawn after the Dota 2 courier it is named for: a body archetype,
// body/accent colours and a list of features (ears, tail, props). Drawn facing right and lit from
// the top-left like the towers. Every wave creep needs an entry (tests check it).
type Shape =
  'beast' | 'blob' | 'bird' | 'fish' | 'wyrm' | 'bot' | 'spook' | 'crab' | 'chest' | 'imp';
const CREEPS: Record<string, [Shape, string, string, string?]> = {
  'frenzied-pig': ['beast', '#8f6048', '#5a3424', 'e-pig pig tusks spikes curl'],
  'swift-frog': ['blob', '#5ab04a', '#e8e060', 'frog'],
  'sturdy-yak': ['beast', '#6a4a3a', '#e8e0d0', 'horns shag muzzle pack thin'],
  'smart-robot': ['bot', '#9aa0a8', '#3fb0ff'],
  'baby-panda': ['beast', '#f0f0f0', '#2a2a2a', 'e-round socks patch muzzle stub big'],
  'balloon-badger': ['beast', '#6a6a70', '#e84a4a', 'e-round mask muzzle bushy balloon'],
  'tardy-stump': ['blob', '#7a5a3a', '#5a9a3a', 'stump'],
  'satisfied-lizard': ['beast', '#7ab04a', '#e0c040', 'thick spikes longface'],
  'invisible-spider': ['crab', '#3a3040', '#c04ae0', 'spider'],
  dusky: ['blob', '#5a4a80', '#e0a040', 'e-point batwing'],
  'invincible-dog': ['beast', '#c89050', '#8a8f9a', 'e-point muzzle armor collar thin'],
  sheep: ['beast', '#f0ece0', '#3a3030', 'wool darkface e-droop stub'],
  'funny-alpaca': ['beast', '#e8d8b0', '#c06a8a', 'neck wool e-point longface collar stub'],
  'pig-princess': ['beast', '#f0a8c0', '#f2c52e', 'e-pig pig curl tiara'],
  bulldog: ['beast', '#b08050', '#c03a3a', 'e-droop muzzle fangs collar stub big'],
  'cat-dog': ['beast', '#e0a040', '#8a5a20', 'e-point muzzle stripes thin'],
  'bamboo-addict': ['beast', '#e8e8e8', '#2a2a2a', 'e-round socks patch muzzle stub big bamboo'],
  'young-demon': ['imp', '#c03a3a', '#f2c52e', 'horns tailspade'],
  'belted-chicken': ['bird', '#f0ece0', '#e03a3a', 'comb belt'],
  bajie: ['beast', '#f0a8b0', '#3a6bff', 'e-pig pig curl armor big'],
  'exquisite-rabbit': ['beast', '#f4f0f4', '#ff7ad9', 'e-long muzzle puff collar'],
  'donkey-trio': ['beast', '#8a8a90', '#a05a30', 'e-long longface thin pack'],
  shakbag: ['blob', '#8a6a44', '#e05a20', 'stump arms'],
  ripper: ['beast', '#6a4a3a', '#d8dde6', 'e-point darkface ribs fangs spikes thin'],
  crab: ['crab', '#e0603a', '#f0a070'],
  lockjaw: ['chest', '#8a5a34', '#e8b83a'],
  flopjaw: ['chest', '#4a8a6a', '#e8b83a', 'tongue'],
  trapjaw: ['chest', '#5a5560', '#c03a3a', 'jaws'],
  'mech-donkey': ['beast', '#b08a40', '#555560', 'e-long longface bolts armor thin'],
  machjaw: ['chest', '#7a7a88', '#e0a020', 'bolts'],
  demolisher: ['bot', '#6a5a4a', '#e05a20', 'prop'],
  corsair: ['spook', '#3a4a6a', '#e0b040', 'hat'],
  'skateboard-flamingo': ['bird', '#ff8ab0', '#3a6bff', 'tall board'],
  'lgd-goldfish': ['fish', '#f0a020', '#fff0c0', 'fan'],
  jellyfish: ['spook', '#b08ae0', '#ff7ad9', 'jelly'],
  'ig-dragon': ['wyrm', '#e03a3a', '#f2c52e'],
  timbersaw: ['bot', '#8a6a3a', '#d8dde6', 'saw prop'],
  'vg-fox': ['beast', '#e07030', '#f0ece0', 'e-point muzzle bushy'],
  'parrot-boatman': ['bird', '#2fbf5a', '#e03a3a', 'crest boat'],
  'carpet-rider': ['imp', '#8a3ab0', '#f2c52e', 'horns carpet'],
  bookwyrm: ['wyrm', '#8a5a3a', '#e0d0a0', 'book'],
  'otter-dragon': ['wyrm', '#8a6a4a', '#4fa0e0', 'muzzle'],
  'rechargeable-shark': ['fish', '#6a8aa8', '#ffe040', 'shark legs bolt'],
  'ribboned-zombie': ['imp', '#7a9a6a', '#e84a8a', 'talisman robe'],
  'baby-dp': ['spook', '#3a3a50', '#4fe0d8', 'hair'],
  'baby-bloody': ['imp', '#8a2020', '#e8e0d0', 'blades'],
  'bounty-apprentice': ['imp', '#c09040', '#5a3a6a', 'hood'],
  'black-and-white-fox': ['beast', '#f0f0f0', '#2a2a2a', 'e-point socks muzzle bushy'],
  jumo: ['blob', '#6a4ab0', '#f2c52e', 'horns spots'],
  baekho: ['beast', '#f0f0f0', '#3a6bff', 'e-round muzzle stripes thin big'],
  lilnova: ['bird', '#f2c52e', '#ff6a3a', 'crest flame'],
  'mermaid-rider': ['fish', '#3ab0a0', '#ff7ad9', 'fan hair'],
  newt: ['beast', '#e08040', '#3a3030', 'thick spots longface'],
  'thrilling-ghost': ['spook', '#d8e0f0', '#4fe0d8'],
  'jade-dragon': ['wyrm', '#2fbf5a', '#e0b040'],
  azuremir: ['wyrm', '#3a6bff', '#e8f4ff'],
  kupu: ['blob', '#e0a0c0', '#8a5ad0', 'antenna'],
  'furry-fish': ['fish', '#e0c080', '#3a6bff', 'fur legs'],
  shroomy: ['blob', '#e03a3a', '#f0ece0', 'cap'],
  chirpy: ['bird', '#f2c52e', '#e05a20', 'crest'],
  boooofus: ['spook', '#9a6a4a', '#e8e0d0'],
  'swift-donkey': ['beast', '#9a9098', '#3a6bff', 'e-long longface thin collar'],
  crummy: ['blob', '#c08a4a', '#6a3a20', 'spots'],
  wabbit: ['beast', '#e8e0d8', '#ff7ad9', 'e-long muzzle puff'],
  'g1-courier': ['bot', '#3a4a6a', '#f0a030', 'prop'],
  drodo: ['bird', '#8a8a70', '#e0a040', 'bigbeak'],
  'baby-roshan': ['beast', '#6a5a4a', '#e05a20', 'horns spikes fangs muzzle thick big batwing'],
};
export const hasCreepModel = (key: string) => key in CREEPS;

/** Draw a creep centred at (m, m) on a 2m-square canvas, body radius r, facing right. */
function drawCreep(
  g: CanvasRenderingContext2D,
  key: string,
  m: number,
  r: number,
  flying: boolean,
  boss: boolean,
) {
  const [shape, c, a, feats = ''] = CREEPS[key] ?? ['blob', '#e08040', '#3a3030'];
  const has = (f: string) => ` ${feats} `.includes(` ${f} `);
  const P = (x: number, y: number) => [m + x * r, m + y * r] as const;
  const oval = (x: number, y: number, rx: number, ry: number, col: string, rot = 0) => {
    g.fillStyle = col;
    g.beginPath();
    g.ellipse(...P(x, y), rx * r, ry * r, rot, 0, 7);
    g.fill();
  };
  // Body part in the towers' flat two-tone: a shadow ellipse with the lit one set up-left.
  const part = (x: number, y: number, rx: number, ry: number, col: string, rot = 0) => {
    oval(x, y, rx, ry, dk(col, 0.3), rot);
    oval(x - rx * 0.08, y - ry * 0.1, rx * 0.88, ry * 0.86, col, rot);
  };
  const poly = (pts: number[], col: string) => {
    g.fillStyle = col;
    g.beginPath();
    for (let i = 0; i < pts.length; i += 2) g.lineTo(...P(pts[i], pts[i + 1]));
    g.fill();
  };
  const line = (pts: number[], col: string, w: number) => {
    g.strokeStyle = col;
    g.lineWidth = Math.max(1, r * w);
    g.lineCap = g.lineJoin = 'round';
    g.beginPath();
    for (let i = 0; i < pts.length; i += 2) g.lineTo(...P(pts[i], pts[i + 1]));
    g.stroke();
  };
  // Big courier eyes: white, a dark pupil looking ahead, one catchlight.
  const eye = (x: number, y: number, k = 1) => {
    oval(x, y, 0.16 * k, 0.17 * k, BONE);
    oval(x + 0.04 * k, y + 0.01 * k, 0.11 * k, 0.13 * k, INK);
    oval(x, y - 0.06 * k, 0.045 * k, 0.045 * k, '#ffffff');
  };
  const legs = (xs: number[], y: number, col: string, w = 0.15) => {
    for (const x of xs) line([x, y, x, 0.74], col, w);
  };
  let hd: [number, number] = [0, -0.7]; // top of the head, for hats and crowns

  // Lift, behind the body: a balloon, or wings for flyers that have nothing else to fly with.
  if (has('balloon')) {
    line([-0.15, -0.2, -0.5, -0.6], BONE, 0.04);
    part(-0.55, -0.85, 0.3, 0.33, a);
    poly([-0.55, -0.52, -0.62, -0.44, -0.46, -0.44], dk(a, 0.3));
  } else if (has('batwing')) {
    poly([-0.1, -0.2, -0.45, -1.05, -0.6, -0.6, -0.95, -0.7, -0.75, -0.3, -1.0, -0.1, -0.4, 0], a);
    line([-0.1, -0.2, -0.45, -1.05], dk(a, 0.35), 0.07);
  } else if (
    flying &&
    !['bird', 'wyrm', 'spook'].includes(shape) &&
    !has('prop') &&
    !has('carpet')
  ) {
    part(-0.4, -0.5, 0.46, 0.2, lt(a, 0.45), 0.5);
    part(-0.2, -0.62, 0.36, 0.16, lt(a, 0.7), 0.8);
  }

  switch (shape) {
    case 'beast': {
      const up = has('neck');
      const hr = has('big') ? 0.42 : 0.36;
      const hx = 0.5,
        hy = up ? -0.6 : -0.2;
      const face = has('darkface') ? a : c;
      const limb = has('socks') ? a : dk(c, 0.35);
      const ear = has('socks') ? a : face;
      // Top of the back at x, for stripes and spikes.
      const top = (x: number) => 0.12 - 0.44 * Math.sqrt(Math.max(0, 1 - ((x + 0.1) / 0.68) ** 2));
      if (has('curl')) line([-0.72, 0, -0.98, -0.08, -0.95, -0.3, -0.8, -0.2], dk(c, 0.2), 0.09);
      if (has('thin')) {
        line([-0.7, 0, -1, -0.2, -1.05, -0.5], dk(c, 0.3), 0.08);
        oval(-1.05, -0.56, 0.1, 0.13, dk(c, 0.5));
      }
      if (has('bushy')) {
        part(-0.88, -0.12, 0.36, 0.2, c, 0.6);
        oval(-1.08, -0.3, 0.14, 0.12, has('socks') ? a : BONE, 0.6);
      }
      if (has('thick')) poly([-0.5, -0.2, -1.2, 0.55, -0.45, 0.48], c);
      if (has('puff')) oval(-0.8, 0, 0.17, 0.17, BONE);
      if (has('stub')) oval(-0.78, -0.02, 0.12, 0.1, ear);
      legs([-0.36, 0.3], 0.3, dk(limb, 0.35));
      if (up) line([0.3, 0.05, 0.48, -0.45], c, 0.36);
      part(-0.1, 0.12, 0.68, 0.44, c);
      if (has('wool')) {
        for (let i = 0; i < 9; i++)
          part(-0.1 + 0.55 * Math.cos(i * 0.7), 0.1 + 0.32 * Math.sin(i * 0.7), 0.2, 0.19, c);
        oval(-0.12, 0.08, 0.5, 0.3, c);
      } else oval(-0.08, 0.36, 0.42, 0.14, lt(c, 0.25));
      if (has('stripes'))
        for (const x of [-0.5, -0.25, 0])
          line([x, top(x) + 0.04, x + 0.06, top(x) + 0.34], a, 0.07);
      if (has('spots'))
        for (const [x, y] of [-0.45, 0, -0.15, -0.12, -0.2, 0.25, 0.15, 0.1].reduce<number[][]>(
          (o, v, i, s) => (i % 2 ? o : [...o, [v, s[i + 1]]]),
          [],
        ))
          oval(x, y, 0.09, 0.08, a);
      if (has('shag'))
        poly(
          [
            -0.72, 0.2, -0.6, 0.62, -0.45, 0.4, -0.3, 0.66, -0.12, 0.42, 0.05, 0.66, 0.2, 0.4, 0.35,
            0.6, 0.45, 0.2,
          ],
          dk(c, 0.2),
        );
      if (has('ribs')) for (const x of [-0.42, -0.22, -0.02]) line([x, 0, x - 0.05, 0.36], a, 0.06);
      if (has('armor')) part(-0.12, -0.08, 0.5, 0.25, a);
      if (has('pack')) {
        line([-0.15, -0.3, -0.15, 0.45], dk(a, 0.45), 0.07);
        part(-0.15, 0.08, 0.24, 0.22, a);
      }
      if (has('bolts')) for (const x of [-0.45, -0.12, 0.2]) oval(x, 0.3, 0.06, 0.06, a);
      if (has('spikes'))
        for (const x of [-0.55, -0.3, -0.05])
          poly([x - 0.12, top(x) + 0.06, x - 0.04, top(x) - 0.26, x + 0.12, top(x) + 0.06], a);
      legs([-0.52, 0.14], 0.35, limb, 0.16);
      if (has('collar')) line(up ? [0.3, -0.38, 0.62, -0.32] : [0.2, -0.3, 0.32, 0.28], a, 0.1);
      // Ears and horns behind the head.
      const eh = up ? 0.42 : 0.64;
      if (has('e-point')) {
        poly([hx, hy - 0.2, hx + 0.16, hy - eh, hx + 0.28, hy - 0.15], dk(ear, 0.35));
        poly([hx - 0.32, hy - 0.12, hx - 0.2, hy - eh, hx + 0.02, hy - 0.24], ear);
      }
      if (has('e-long')) {
        part(hx + 0.1, hy - 0.52, 0.1, 0.32, dk(ear, 0.3), 0.25);
        part(hx - 0.2, hy - 0.54, 0.11, 0.34, ear, -0.2);
        oval(hx - 0.2, hy - 0.54, 0.045, 0.22, mix(ear, '#ff8fb0', 0.5), -0.2);
      }
      if (has('e-round')) {
        oval(hx + hr * 0.45, hy - hr * 0.9, 0.14, 0.14, dk(ear, 0.3));
        part(hx - hr * 0.65, hy - hr * 0.85, 0.16, 0.16, ear);
      }
      if (has('e-pig'))
        poly([hx - 0.26, hy - 0.16, hx - 0.1, hy - 0.6, hx + 0.1, hy - 0.26], dk(face, 0.25));
      if (has('horns'))
        poly(
          [
            hx - 0.1,
            hy - 0.25,
            hx - 0.42,
            hy - 0.5,
            hx - 0.3,
            hy - 0.85,
            hx - 0.26,
            hy - 0.55,
            hx + 0.05,
            hy - 0.32,
          ],
          a,
        );
      part(hx, hy, hr, hr * 0.92, face);
      if (has('mask')) oval(hx + 0.12, hy - 0.16, hr * 0.85, 0.08, BONE, 0.45);
      if (has('patch')) oval(hx + 0.08, hy - 0.05, 0.15, 0.19, a, 0.4);
      const sx = hx + hr * 0.75;
      if (has('pig')) {
        part(sx + 0.08, hy + 0.08, 0.16, 0.14, mix(face, '#ff9aa8', 0.55));
        oval(sx + 0.08, hy + 0.06, 0.03, 0.045, dk(face, 0.6));
        oval(sx + 0.17, hy + 0.06, 0.03, 0.045, dk(face, 0.6));
      }
      if (has('muzzle')) {
        oval(sx - 0.02, hy + 0.12, 0.22, 0.16, lt(face, 0.65));
        oval(sx + 0.16, hy + 0.04, 0.075, 0.06, INK);
      }
      if (has('longface')) {
        part(sx + 0.02, hy + 0.14, 0.27, 0.19, lt(face, 0.4), 0.3);
        oval(sx + 0.2, hy + 0.14, 0.035, 0.05, INK);
      }
      if (has('tusks'))
        poly([sx - 0.02, hy + 0.22, sx + 0.04, hy - 0.1, sx + 0.12, hy + 0.22], BONE);
      if (has('fangs'))
        poly(
          [
            sx - 0.1,
            hy + 0.2,
            sx - 0.04,
            hy + 0.42,
            sx + 0.02,
            hy + 0.2,
            sx + 0.08,
            hy + 0.4,
            sx + 0.14,
            hy + 0.2,
          ],
          BONE,
        );
      eye(hx + 0.06, hy - 0.08);
      if (has('e-droop')) part(hx - 0.26, hy + 0.04, 0.12, 0.24, dk(ear, 0.3), 0.3);
      hd = [hx - 0.02, hy - hr * 0.8];
      break;
    }
    case 'blob':
      if (has('stump')) {
        for (const x of [-0.6, 0, 0.6]) line([x * 0.8, 0.5, x * 1.3, 0.76], dk(c, 0.3), 0.16);
        if (has('arms'))
          for (const s of [-1, 1]) {
            line([s * 0.5, 0, s * 0.95, -0.3, s * 1.02, -0.6], dk(c, 0.15), 0.13);
            oval(s * 1.02, -0.72, 0.16, 0.12, a);
          }
        poly([-0.55, -0.4, -0.64, 0.6, 0.64, 0.6, 0.55, -0.4], c);
        poly([0.2, -0.4, 0.25, 0.6, 0.64, 0.6, 0.55, -0.4], dk(c, 0.2));
        for (const x of [-0.35, -0.1]) line([x, -0.1, x - 0.03, 0.45], dk(c, 0.35), 0.05);
        part(0, -0.4, 0.55, 0.2, lt(c, 0.4));
        oval(0, -0.4, 0.3, 0.1, lt(c, 0.2));
        line([0.1, -0.45, 0.2, -0.82], '#4a7a2a', 0.06);
        oval(0.38, -0.88, 0.2, 0.1, a, -0.4);
        oval(0.02, -0.9, 0.18, 0.09, lt(a, 0.2), 0.4);
        eye(0.1, 0.05, 1.1);
        eye(0.42, 0.07, 1.1);
        hd = [0, -0.55];
      } else if (has('cap')) {
        for (const x of [-0.25, 0.25]) oval(x, 0.72, 0.2, 0.09, dk('#f0e6d2', 0.35));
        part(0, 0.3, 0.42, 0.42, '#f0e6d2');
        g.fillStyle = c;
        g.beginPath();
        g.ellipse(...P(0, -0.05), r * 0.9, r * 0.75, 0, Math.PI, 0);
        g.fill();
        oval(0, -0.05, 0.9, 0.14, dk(c, 0.35));
        for (const [x, y, k] of [
          [-0.45, -0.38, 0.14],
          [0.05, -0.55, 0.17],
          [0.52, -0.3, 0.12],
        ])
          oval(x, y, k, k * 0.8, a);
        eye(0.05, 0.26);
        eye(0.34, 0.27);
        hd = [0, -0.72];
      } else {
        const frog = has('frog');
        if (has('e-point')) {
          poly([-0.5, -0.25, -0.55, -0.9, -0.1, -0.45], c);
          poly([0.2, -0.45, 0.5, -0.92, 0.6, -0.3], dk(c, 0.2));
        }
        if (has('antenna'))
          for (const x of [-0.1, 0.3]) {
            line([x, -0.4, x + 0.1, -0.9], dk(c, 0.4), 0.05);
            oval(x + 0.1, -0.95, 0.09, 0.09, a);
          }
        if (has('horns'))
          for (const x of [-0.35, 0.35]) poly([x - 0.14, -0.38, x, -0.9, x + 0.14, -0.38], a);
        for (const x of [-0.3, 0.35]) oval(x, 0.7, 0.24, 0.1, dk(c, 0.4));
        if (frog) part(-0.55, 0.42, 0.32, 0.22, dk(c, 0.12), -0.4);
        part(0, frog ? 0.2 : 0.1, 0.72, frog ? 0.48 : 0.6, c);
        oval(0.12, 0.34, 0.42, 0.24, lt(c, 0.3));
        if (has('spots'))
          for (const [x, y] of [
            [-0.4, -0.15],
            [-0.15, 0.3],
            [-0.5, 0.25],
            [0.3, 0.42],
          ])
            oval(x, y, 0.09, 0.08, a);
        if (frog) {
          part(-0.02, -0.3, 0.22, 0.22, c);
          part(0.44, -0.28, 0.22, 0.22, c);
          eye(0, -0.32, 1.1);
          eye(0.46, -0.3, 1.1);
          line([0.05, 0.2, 0.4, 0.28, 0.68, 0.16], dk(c, 0.5), 0.05);
          part(-0.2, 0.2, 0.2, 0.17, a);
        } else {
          eye(0.12, -0.08, 1.2);
          eye(0.5, -0.06, 1.2);
          line([0.22, 0.2, 0.36, 0.25, 0.5, 0.2], dk(c, 0.5), 0.05);
        }
        hd = [0.05, -0.48];
      }
      break;
    case 'bird': {
      const tall = has('tall');
      const hx = tall ? 0.42 : 0.4,
        hy = tall ? -0.78 : -0.38;
      const leg = tall ? dk(c, 0.25) : '#e8a83a';
      if (has('flame'))
        poly([-0.4, 0.1, -1.1, -0.5, -0.8, -0.05, -1.15, 0.1, -0.75, 0.2, -1, 0.5, -0.4, 0.3], a);
      else poly([-0.5, -0.05, -1, -0.3, -0.92, 0, -1, 0.28, -0.5, 0.25], dk(c, 0.25));
      if (flying && !has('boat')) part(-0.3, -0.38, 0.42, 0.2, dk(c, 0.12), 0.6);
      for (const x of [-0.08, 0.14])
        line([x, 0.4, x, 0.75, x + 0.14, 0.75], leg, tall ? 0.06 : 0.09);
      if (tall) {
        part(-0.1, 0.12, 0.48, 0.34, c);
        line([0.2, 0, 0.52, -0.25, 0.3, -0.52, 0.4, -0.72], c, 0.15);
      } else part(-0.1, 0.1, 0.56, 0.46, c);
      part(-0.2, 0.1, 0.36, 0.22, dk(c, 0.15), 0.2);
      if (has('belt')) {
        line([-0.5, 0.3, -0.05, 0.45, 0.38, 0.3], '#5a3a24', 0.1);
        oval(0.02, 0.44, 0.08, 0.08, '#f2c52e');
      }
      if (has('comb')) {
        for (const x of [-0.14, 0.02, 0.16]) oval(hx + x, hy - 0.28 - (x ? 0 : 0.06), 0.1, 0.11, a);
        oval(hx + 0.26, hy + 0.2, 0.07, 0.1, a);
      }
      if (has('crest'))
        poly(
          [
            hx - 0.1,
            hy - 0.2,
            hx - 0.45,
            hy - 0.55,
            hx - 0.15,
            hy - 0.42,
            hx - 0.2,
            hy - 0.72,
            hx + 0.08,
            hy - 0.26,
          ],
          a,
        );
      part(hx, hy, tall ? 0.24 : 0.3, tall ? 0.22 : 0.28, c);
      const b = has('bigbeak') ? 1.6 : 1;
      poly(
        [hx + 0.2, hy - 0.1 * b, hx + 0.2 + 0.35 * b, hy + 0.04 * b, hx + 0.2, hy + 0.14 * b],
        tall ? INK : '#f2b530',
      );
      eye(hx + 0.04, hy - 0.06, 0.9);
      hd = [hx - 0.02, hy - 0.26];
      break;
    }
    case 'fish': {
      const shark = has('shark');
      if (has('fan'))
        poly([-0.55, 0, -1.15, -0.6, -0.92, -0.12, -1.15, 0, -0.92, 0.12, -1.15, 0.6], lt(a, 0.2));
      else poly([-0.6, 0, -1.1, -0.5, -0.95, 0, -1.1, 0.5], shark ? dk(c, 0.2) : a);
      if (shark) poly([-0.3, -0.3, -0.1, -0.95, 0.3, -0.3], dk(c, 0.2));
      else poly([-0.3, -0.35, 0.05, -0.78, 0.3, -0.35], mix(c, a, 0.5));
      if (has('hair')) poly([0.35, -0.4, 0.1, -0.85, -0.2, -0.6, -0.55, -0.7, -0.5, -0.2], a);
      if (has('legs'))
        for (const x of [-0.25, 0.2]) line([x, 0.35, x, 0.74, x + 0.13, 0.74], dk(c, 0.4), 0.13);
      part(0, 0, 0.8, 0.48, c);
      oval(0.05, 0.22, 0.6, 0.2, shark ? '#eef2f4' : lt(c, 0.35));
      if (has('fur'))
        poly(
          [
            -0.6, -0.25, -0.5, -0.6, -0.35, -0.38, -0.2, -0.68, -0.05, -0.42, 0.1, -0.66, 0.25,
            -0.4,
          ],
          dk(c, 0.15),
        );
      poly([0.05, 0.12, -0.3, 0.5, 0.2, 0.32], shark ? dk(c, 0.25) : a);
      if (shark) {
        poly([0.78, 0.05, 0.3, 0.12, 0.72, 0.3], '#5a1a20');
        poly(
          [0.35, 0.12, 0.42, 0.24, 0.49, 0.11, 0.56, 0.22, 0.63, 0.09, 0.7, 0.18, 0.76, 0.06],
          BONE,
        );
      } else line([0.78, 0.1, 0.52, 0.18], dk(c, 0.5), 0.05);
      if (has('bolt'))
        poly(
          [-0.25, -0.28, 0, -0.28, -0.12, -0.05, 0.05, -0.05, -0.3, 0.32, -0.18, 0.05, -0.36, 0.05],
          a,
        );
      eye(0.45, -0.12);
      hd = [0.3, -0.5];
      break;
    }
    case 'wyrm':
      line([-0.4, 0.3, -0.8, 0.5, -1.05, 0.3, -1, 0.02], c, 0.2);
      poly([-1.12, 0.08, -1, -0.25, -0.86, 0.06], a);
      if (has('book')) {
        poly([-0.6, -0.3, -0.2, -0.62, 0.02, -0.3, -0.38, 0], dk(c, 0.45));
        poly([-0.55, -0.32, -0.2, -0.56, -0.03, -0.32, -0.38, -0.08], a);
      } else {
        poly([-0.05, -0.15, -0.35, -1.05, -0.55, -0.6, -0.9, -0.72, -0.65, -0.15], mix(a, c, 0.35));
        line([-0.05, -0.15, -0.35, -1.05], dk(c, 0.3), 0.07);
      }
      legs([-0.3, 0.15], 0.4, dk(c, 0.35));
      line([0.3, 0.1, 0.5, -0.2], c, 0.32);
      part(-0.1, 0.2, 0.58, 0.4, c);
      oval(0, 0.38, 0.42, 0.14, mix(c, '#fff0c0', 0.55));
      for (const x of [-0.4, -0.15, 0.1]) poly([x - 0.1, -0.12, x, -0.36, x + 0.1, -0.12], a);
      poly([0.4, -0.45, 0.22, -0.92, 0.58, -0.52], a);
      part(0.55, -0.25, 0.36, 0.3, c);
      part(0.86, -0.14, 0.2, 0.16, has('muzzle') ? mix(c, '#fff0c0', 0.6) : c);
      oval(0.98, -0.18, 0.03, 0.04, INK);
      eye(0.6, -0.32);
      hd = [0.5, -0.5];
      break;
    case 'bot':
      if (flying) line([-0.5, 0.72, 0.5, 0.72], dk(c, 0.5), 0.1);
      else
        for (const x of [-0.4, 0.4]) {
          oval(x, 0.6, 0.2, 0.2, INK);
          oval(x, 0.6, 0.08, 0.08, '#8a8a92');
        }
      line([0.3, 0.2, 0.75, 0.35], dk(c, 0.4), 0.12);
      part(0, 0.2, 0.68, 0.45, c);
      line([-0.55, 0.3, 0.5, 0.3], dk(c, 0.4), 0.05);
      gemFacets(g, a, ...P(-0.15, 0.08), r * 0.14);
      if (has('saw')) {
        g.fillStyle = a;
        g.beginPath();
        for (let i = 0; i < 16; i++) {
          const k = i % 2 ? 0.26 : 0.38;
          g.lineTo(...P(0.82 + Math.cos(i * 0.393) * k, 0.3 + Math.sin(i * 0.393) * k));
        }
        g.fill();
        oval(0.82, 0.3, 0.1, 0.1, dk(a, 0.5));
      }
      part(0.15, -0.4, 0.42, 0.3, lt(c, 0.15));
      poly([0.18, -0.54, 0.56, -0.5, 0.56, -0.3, 0.18, -0.28], INK);
      oval(0.4, -0.4, 0.11, 0.08, a);
      oval(0.37, -0.43, 0.04, 0.03, '#ffffff');
      if (!has('prop')) {
        line([0, -0.65, 0, -0.95], dk(c, 0.4), 0.06);
        oval(0, -0.98, 0.09, 0.09, a);
      }
      hd = [0.12, -0.68];
      break;
    case 'spook':
      if (has('jelly')) {
        for (const x of [-0.45, -0.15, 0.15, 0.45])
          line([x, 0.1, x - 0.1, 0.4, x + 0.08, 0.65, x - 0.05, 0.95], a, 0.09);
        g.fillStyle = c;
        g.beginPath();
        g.ellipse(...P(0, 0.1), r * 0.8, r * 0.85, 0, Math.PI, 0);
        g.fill();
        oval(0, 0.1, 0.8, 0.15, dk(c, 0.3));
        oval(-0.25, -0.4, 0.3, 0.2, lt(c, 0.4), -0.4);
        eye(0.1, -0.15, 1.1);
        eye(0.45, -0.13, 1.1);
        hd = [0, -0.72];
        break;
      }
      if (has('hair'))
        poly([0.2, -0.75, -0.6, -0.7, -1.05, -0.1, -0.7, -0.2, -0.9, 0.3, -0.45, 0], a);
      for (const s of [-1, 1]) part(s * 0.7, 0.05, 0.2, 0.13, c, s * 0.5);
      g.fillStyle = c;
      g.beginPath();
      g.arc(...P(0, -0.1), r * 0.7, Math.PI, 0);
      for (let i = 0; i <= 6; i++) g.lineTo(...P(0.7 - (i * 1.4) / 6, 0.6 + (i % 2) * 0.25));
      g.fill();
      poly([0.7, 0.3, 0.7, 0.6, 0.47, 0.85, 0.23, 0.6, 0.3, 0.3], dk(c, 0.2));
      oval(-0.2, -0.38, 0.3, 0.22, lt(c, 0.3), -0.4);
      line([-0.6, 0.22, 0, 0.32, 0.62, 0.22], a, 0.12);
      poly([-0.55, 0.2, -0.95, 0.35, -0.8, 0.5, -0.5, 0.32], a);
      eye(0.12, -0.15, 1.3);
      eye(0.48, -0.12, 1.3);
      oval(0.32, 0.1, 0.07, 0.05, INK);
      hd = [0.02, -0.76];
      break;
    case 'crab': {
      const spider = has('spider');
      g.strokeStyle = dk(c, 0.35);
      g.lineWidth = Math.max(1, r * 0.1);
      g.lineCap = g.lineJoin = 'round';
      g.beginPath();
      for (const s of [-1, 1])
        for (let k = 0; k < (spider ? 4 : 3); k++) {
          g.moveTo(...P(s * 0.3, 0.1 + k * 0.08));
          g.lineTo(...P(s * (0.75 + k * 0.1), (spider ? -0.25 : 0.3) + k * 0.22));
          g.lineTo(...P(s * (0.9 + k * 0.1), 0.72));
        }
      g.stroke();
      if (spider) {
        part(0, 0.1, 0.55, 0.52, c);
        poly([-0.12, -0.2, 0.12, -0.2, 0, 0, 0.12, 0.2, -0.12, 0.2, 0, 0], a);
        poly([-0.2, 0.42, -0.12, 0.66, -0.04, 0.44], BONE);
        poly([0.2, 0.42, 0.12, 0.66, 0.04, 0.44], BONE);
        for (const s of [-1, 1]) {
          eye(s * 0.2, 0.28, 1.1);
          oval(s * 0.38, 0.05, 0.06, 0.06, a);
        }
        hd = [0, -0.4];
      } else {
        for (const s of [-1, 1]) {
          line([s * 0.45, 0, s * 0.8, -0.25], dk(c, 0.2), 0.12);
          part(s * 0.82, -0.35, 0.26, 0.22, c);
          poly([s * 0.82, -0.35, s * 1.1, -0.62, s * 0.7, -0.62], INK);
          line([s * 0.18, -0.2, s * 0.18, -0.55], dk(c, 0.2), 0.08);
        }
        part(0, 0.15, 0.7, 0.42, c);
        oval(0, 0.3, 0.45, 0.16, a);
        eye(-0.18, -0.58);
        eye(0.18, -0.58);
        hd = [0, -0.72];
      }
      break;
    }
    case 'chest': {
      const tooth = has('jaws') ? '#d8dde6' : BONE;
      line([-0.6, 0.2, -0.92, 0, -0.88, -0.22], dk(c, 0.2), 0.1);
      legs([-0.32, 0.38], 0.45, dk(c, 0.55));
      poly([-0.62, 0, 0.62, 0, 0.58, 0.55, -0.58, 0.55], c);
      poly([-0.6, 0.36, 0.6, 0.36, 0.58, 0.55, -0.58, 0.55], dk(c, 0.25));
      poly([-0.62, 0, -0.6, -0.14, 0.68, -0.42, 0.62, 0], '#3a1218');
      if (has('tongue')) line([0.25, -0.08, 0.78, -0.02, 0.9, 0.36], '#e86a8a', 0.2);
      for (const x of [0.02, 0.22, 0.42]) poly([x, 0, x + 0.08, -0.2, x + 0.16, 0], tooth);
      for (const x of [-0.3, 0.3]) line([x, 0.03, x, 0.52], a, 0.08);
      line([-0.6, 0.02, 0.6, 0.02], a, 0.07);
      poly([-0.62, -0.14, -0.52, -0.6, 0.5, -0.9, 0.7, -0.42], lt(c, 0.12));
      poly([-0.52, -0.6, 0.5, -0.9, 0.56, -0.76, -0.55, -0.46], lt(c, 0.3));
      for (const t of [0.25, 0.7])
        line([-0.6 + 1.3 * t, -0.16 - 0.27 * t, -0.52 + 1.04 * t, -0.58 - 0.3 * t], a, 0.08);
      line([-0.62, -0.14, 0.7, -0.42], a, 0.07);
      for (const t of [0.58, 0.76, 0.93]) {
        const x = -0.62 + 1.32 * t,
          y = -0.14 - 0.28 * t;
        poly([x - 0.08, y + 0.02, x, y + 0.22, x + 0.08, y - 0.02], tooth);
      }
      eye(0.3, -0.58, 1.1);
      part(0, 0.26, 0.13, 0.15, a);
      oval(0, 0.26, 0.04, 0.07, INK);
      if (has('bolts')) {
        for (const x of [-0.48, 0.48]) oval(x, 0.42, 0.05, 0.05, a);
        line([-0.3, -0.6, -0.4, -0.95], dk(c, 0.4), 0.05);
        oval(-0.4, -0.98, 0.08, 0.08, a);
      }
      legs([-0.48, 0.22], 0.5, dk(c, 0.35), 0.16);
      hd = [0, -0.8];
      break;
    }
    case 'imp':
      if (has('tailspade')) {
        line([-0.3, 0.4, -0.8, 0.5, -0.95, 0.15], dk(c, 0.2), 0.08);
        poly([-0.95, -0.12, -1.12, 0.2, -0.8, 0.2], a);
      }
      if (has('hood')) oval(0.02, -0.28, 0.6, 0.54, dk(a, 0.3));
      for (const x of [-0.15, 0.15]) line([x, 0.5, x, 0.75, x + 0.13, 0.75], dk(c, 0.4), 0.14);
      line([-0.15, 0.2, -0.45, 0.42], dk(c, 0.3), 0.12);
      part(0, 0.32, 0.36, 0.34, has('robe') || has('hood') ? a : c);
      line([0.12, 0.22, 0.42, 0.42], dk(c, 0.15), 0.12);
      if (!has('hood')) {
        poly([-0.3, -0.35, -0.8, -0.5, -0.35, -0.1], dk(c, 0.15));
        poly([0.45, -0.35, 0.92, -0.55, 0.5, -0.1], dk(c, 0.3));
      }
      if (has('horns')) {
        poly([-0.25, -0.58, -0.32, -1, -0.02, -0.66], a);
        poly([0.28, -0.64, 0.5, -1, 0.52, -0.56], a);
      }
      if (has('blades')) {
        poly([-0.1, -0.6, -0.75, -1.05, -0.45, -0.5], a);
        poly([0.2, -0.65, -0.3, -1.15, 0.0, -0.62], dk(a, 0.15));
      }
      part(0.08, -0.25, 0.5, 0.44, c);
      if (has('hood')) poly([-0.4, -0.1, 0.58, -0.06, 0.5, 0.15, 0.1, 0.22, -0.3, 0.12], a);
      eye(0.12, -0.24, 1.2);
      eye(0.46, -0.22, 1.2);
      if (!has('hood')) {
        line([0.15, 0, 0.3, 0.05, 0.45, 0], dk(c, 0.55), 0.05);
        poly([0.36, 0.03, 0.4, 0.14, 0.44, 0.02], BONE);
      }
      if (has('talisman')) {
        poly([0.2, -0.62, 0.42, -0.62, 0.42, 0.02, 0.2, 0.02], '#f2e08a');
        line([0.31, -0.5, 0.27, -0.3, 0.35, -0.2, 0.31, -0.08], '#c03a3a', 0.04);
        poly([-0.35, -0.55, -0.2, -0.95, 0.4, -0.95, 0.55, -0.55], dk(a, 0.55));
        line([-0.35, -0.57, 0.55, -0.57], a, 0.08);
      }
      hd = [0.08, -0.66];
      break;
  }

  // Props, set on the head or under the feet.
  const [tx, ty] = hd;
  if (has('hat')) {
    poly(
      [tx - 0.55, ty + 0.1, tx - 0.25, ty - 0.32, tx + 0.3, ty - 0.32, tx + 0.6, ty + 0.1],
      '#2a2a3a',
    );
    line([tx - 0.5, ty + 0.08, tx + 0.55, ty + 0.08], a, 0.08);
  }
  if (has('tiara') || boss) {
    const k = boss ? 1 : 0.7;
    const pts = [-0.3, 0.05, -0.3, -0.3, -0.15, -0.1, 0, -0.35, 0.15, -0.1, 0.3, -0.3, 0.3, 0.05];
    poly(
      pts.map((v, i) => (i % 2 ? ty : tx) + v * k),
      '#f2c52e',
    );
    gemFacets(g, boss ? '#e03a3a' : '#ff7ad9', ...P(tx, ty - 0.07 * k), r * 0.08 * k);
  }
  if (has('prop')) {
    line([tx, ty + 0.05, tx, ty - 0.2], dk(c, 0.4), 0.07);
    oval(tx, ty - 0.22, 0.62, 0.07, '#d8dde6');
    oval(tx, ty - 0.22, 0.08, 0.08, a);
  }
  if (has('bamboo')) {
    line([0.72, 0.6, 0.95, -0.7], '#5aa83a', 0.1);
    for (const t of [0.3, 0.65])
      line([0.67 + 0.23 * t, 0.6 - 1.3 * t, 0.77 + 0.23 * t, 0.62 - 1.3 * t], '#3a7a2a', 0.04);
    oval(0.78, -0.75, 0.18, 0.07, '#5aa83a', 0.5);
  }
  if (has('board')) {
    line([-0.75, 0.84, 0.75, 0.84], a, 0.1);
    for (const x of [-0.45, 0.45]) oval(x, 0.98, 0.1, 0.1, INK);
  }
  if (has('boat')) {
    poly([-0.95, 0.25, 1, 0.25, 0.7, 0.85, -0.7, 0.85], '#8a5a34');
    poly([-0.82, 0.55, 0.85, 0.55, 0.7, 0.85, -0.7, 0.85], dk('#8a5a34', 0.25));
    line([-0.95, 0.25, 1, 0.25], a, 0.08);
  }
  if (has('carpet')) {
    poly(
      [
        -1.05, 0.62, -0.5, 0.52, 0, 0.64, 0.5, 0.52, 1.05, 0.62, 1.05, 0.84, 0.5, 0.74, 0, 0.86,
        -0.5, 0.74, -1.05, 0.84,
      ],
      dk(c, 0.3),
    );
    line([-1.02, 0.66, -0.5, 0.56, 0, 0.68, 0.5, 0.56, 1.02, 0.66], a, 0.06);
    line([-1.02, 0.8, -0.5, 0.7, 0, 0.82, 0.5, 0.7, 1.02, 0.8], a, 0.06);
  }

  // Rounding wash over the whole creep, as on the tower heads.
  const gl = g.createRadialGradient(...P(-0.4, -0.5), 0, ...P(0, 0), r * 1.2);
  gl.addColorStop(0, 'rgba(255,255,255,0.18)');
  gl.addColorStop(0.6, 'rgba(255,255,255,0)');
  gl.addColorStop(1, 'rgba(0,0,0,0.3)');
  g.globalCompositeOperation = 'source-atop';
  g.fillStyle = gl;
  g.fillRect(0, 0, m * 2, m * 2);
  g.globalCompositeOperation = 'source-over';
  outline(g, Math.max(1, r * 0.07));
}

/** Creep portrait for the panel, as a cached data URL. */
export function creepIcon(d: { name: string; flying: boolean; boss: boolean }) {
  const key = 'creep' + d.name;
  let url = icons.get(key);
  if (!url) {
    url = bake(96, 96, (g) => drawCreep(g, slug(d.name), 48, 36, d.flying, d.boss)).toDataURL();
    icons.set(key, url);
  }
  return url;
}

export class Renderer {
  cell = 0; // px per cell at current zoom
  zoom = 1;
  panX = 0;
  panY = 0;
  flash = -1; // refused cell index
  flashUntil = 0;
  cursor = -1; // keyboard board cursor
  selected = -1; // selected cell index
  multi: number[] = []; // cells of extra Ctrl-selected towers
  creep: Creep | null = null; // selected creep
  hints: number[] = []; // cells of towers that can combine now
  pinned: number[] = []; // cells of pinned-recipe ingredients still waiting on the rest
  pinReady: number[] = []; // cells of pinned-recipe ingredients that can combine now
  pending: number[] = []; // this round's gems, one of which must be picked to finish it
  guide: string[] | null = null; // maze guide overlay rows
  showPath = true;
  showRanges = true; // every tower's attack range and aura rings; the selected one always shows
  private staticLayer = document.createElement('canvas');
  private blockLayer = document.createElement('canvas'); // stones/towers, drawn over the pedals
  private staticDirty = true;
  /** Terrain, wall, board and torch glow composited at the current pan; rebuilt on pan/zoom/edits
   * so a frame blits it once instead of repainting them (software raster can't keep up). */
  private bg = document.createElement('canvas');
  private bgKey = '';
  private dimKey = ''; // pending cells the block layer was last dimmed for
  // ponytail: one canvas per sprite, not a packed sheet; pack if drawImage switching shows in profiles.
  private sprites = new Map<string, HTMLCanvasElement>();
  private terrainPat: [number, CanvasPattern] | null = null;

  /** Lowland around the plateau: a repeating tile of leafy green blocks at random heights. */
  private terrain() {
    const s = this.cell;
    if (this.terrainPat?.[0] === s) return this.terrainPat[1];
    const N = 24; // tile size in cells; ponytail: periodic, a bigger N if the repeat shows
    const hash = (c: number, r: number) => {
      const n = Math.sin((((c % N) + N) % N) * 127.1 + (((r % N) + N) % N) * 311.7) * 43758.5;
      return n - Math.floor(n);
    };
    const tile = bake(N * s, N * s, (g) => {
      g.fillStyle = '#0d170d';
      g.fillRect(0, 0, N * s, N * s);
      // Back to front so each row's tops cover the front faces of the row behind; one row past
      // each edge so faces that cross the seam wrap.
      for (let r = -1; r <= N + 1; r++)
        for (let c = 0; c < N; c++) {
          const v = hash(c, r),
            h = Math.floor(v * 4) * 0.18 * s,
            base = mix('#1b3a1d', '#41702c', v);
          const y = r * s - h;
          g.fillStyle = shade(base, 0.55);
          g.fillRect(c * s, y + s, s, h);
          g.fillStyle = base;
          g.fillRect(c * s, y, s, s);
          g.fillStyle = shade(base, 1.2);
          g.fillRect(c * s, y, s, Math.max(1, s / 12));
          g.fillStyle = 'rgba(0,0,0,0.25)';
          g.fillRect(c * s + s - 1, y, 1, s);
        }
    });
    const pat = this.ctx.createPattern(tile, 'repeat')!;
    this.terrainPat = [s, pat];
    return pat;
  }
  private order: Creep[] = [];
  private seen = new WeakSet<Creep>();
  private facingLeft = new WeakMap<Creep, boolean>();
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

  /** Device pixels per CSS pixel. The canvas and all view state are in device pixels, so
   * phones render at native resolution; public inputs (clicks, pans) stay in CSS pixels. */
  dpr = 1;

  /** Low graphics (default on touch devices, where per-frame shadowBlur is costly): no live glows,
   * no particles, combine hints as plain rings, and 1 device pixel per CSS pixel. */
  low = matchMedia('(pointer: coarse)').matches;
  get glow() {
    return this.low ? 0 : 1;
  }

  /** Fit the map to the window and recentre. */
  resize() {
    this.dpr = Math.min(devicePixelRatio || 1, this.low ? 1 : 1.5); // phones report 3: 4x the pixels for little visible gain
    this.canvas.width = Math.round(innerWidth * this.dpr);
    this.canvas.height = Math.round(innerHeight * this.dpr);
    this.setZoom(this.zoom, innerWidth / 2, innerHeight / 2, true);
  }

  /** Zoom keeping the CSS-pixel point (sx, sy) fixed. */
  setZoom(zoom: number, sx: number, sy: number, recentre = false) {
    const d = this.dpr;
    [sx, sy] = [sx * d, sy * d];
    const base =
      (Math.min(innerWidth, innerHeight - HUD_H - PANEL_H) * d) / (this.maze.w + 2 * FRAME);
    const cell = Math.max(4, Math.floor(base * Math.min(4, Math.max(1, zoom))));
    this.zoom = cell / base;
    if (recentre) {
      this.panX = Math.floor((this.canvas.width - cell * this.maze.w) / 2);
      this.panY = Math.round(HUD_H * d + FRAME * cell);
    } else {
      this.panX = sx - ((sx - this.panX) / (this.cell || cell)) * cell;
      this.panY = sy - ((sy - this.panY) / (this.cell || cell)) * cell;
    }
    this.clamp(cell);
    if (cell !== this.cell) {
      this.cell = cell;
      this.sprites.clear();
      this.staticDirty = true;
    }
  }

  pan(dx: number, dy: number) {
    this.panX += dx * this.dpr;
    this.panY += dy * this.dpr;
    this.clamp(this.cell);
  }

  /** Keep the view inside the world: the board plus WORLD cells of lowland on every side. */
  private clamp(cell: number) {
    const fit = (pan: number, size: number, n: number) => {
      const a = size - (n + WORLD) * cell,
        b = WORLD * cell;
      return Math.min(Math.max(pan, Math.min(a, b)), Math.max(a, b));
    };
    this.panX = fit(this.panX, this.canvas.width, this.maze.w);
    this.panY = fit(this.panY, this.canvas.height, this.maze.h);
  }

  /** Live creep drawn under a screen point, nearest first. */
  creepAt(x: number, y: number) {
    const wx = (x * this.dpr - this.panX) / this.cell,
      wy = (y * this.dpr - this.panY) / this.cell;
    let best: Creep | null = null,
      bd = 0.6; // cells
    for (const cr of this.sim.creeps) {
      if (!cr.alive) continue;
      const d = Math.hypot(cr.x - wx, cr.y - (cr.def.flying ? FLY_Z : 0.15) - wy);
      if (d < bd) [best, bd] = [cr, d];
    }
    return best;
  }

  screenToCell(x: number, y: number): [number, number] {
    const d = this.dpr;
    return [
      Math.floor((x * d - this.panX) / this.cell),
      Math.floor((y * d - this.panY) / this.cell),
    ];
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

  /** Standing tower sprite at the current zoom. */
  private tower(key: string, gem: string, quality: number) {
    const s = this.cell;
    return this.sprite(`t${key}${quality}`, s, s * (1 + TOWER_H + TALL), (g) =>
      drawTower(g, s, key, gem, quality),
    );
  }

  /** Stone block with a lit top face and darker front face. */
  private block(color: string) {
    const s = this.cell;
    return this.sprite(`b${color}`, s, s * (1 + BLOCK_H), (g) => {
      g.fillStyle = shade(color, 0.6);
      g.fillRect(0, s, s, s * BLOCK_H);
      g.fillStyle = color;
      g.fillRect(0, 0, s, s);
      g.fillStyle = shade(color, 1.25);
      g.fillRect(0, 0, s, Math.max(1, s / 10));
    });
  }

  /** Creep model at the current zoom; `flip` faces it left. */
  private creepSprite(cr: Creep, flip: boolean) {
    const rad = this.cell * (cr.def.boss ? 0.6 : cr.def.giant ? 0.7 : 0.4);
    const m = rad * 1.25;
    return this.sprite(`c${cr.def.name}${rad}${flip}`, m * 2, m * 2, (g) => {
      if (flip) g.setTransform(-1, 0, 0, 1, m * 2, 0);
      drawCreep(g, slug(cr.def.name), m, rad, cr.def.flying, cr.def.boss);
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

  /** Whether cell (c, r) is on the stone plateau the board stands on (the wall and board count). */
  private onPlateau(c: number, r: number) {
    const { w, h } = this.maze;
    const dx = Math.max(-FRAME - c, c - (w + FRAME - 1), 0),
      dy = Math.max(-FRAME - r, r - (h + FRAME - 1), 0);
    // Coarse noise (2x2 cells) so the rim is ragged in blocks, not single-cell holes.
    return Math.hypot(dx, dy) <= PLATEAU + 1.5 * hash2((c >> 1) + 7, (r >> 1) + 3) - 0.75;
  }

  /** Cube tree: a short trunk under two or three stacked leaf blocks, narrower toward the top. */
  private tree(k: number) {
    const s = this.cell,
      w = s * 1.5,
      h = s * 2.6;
    return this.sprite(`tree${k}`, w, h, (g) => {
      g.fillStyle = 'rgba(0,0,0,0.3)';
      g.beginPath();
      g.ellipse(w / 2, h - s * 0.15, s * 0.6, s * 0.15, 0, 0, 7);
      g.fill();
      g.fillStyle = '#4a3423';
      g.fillRect(w / 2 - s * 0.12, h - s * 0.8, s * 0.24, s * 0.7);
      const leaf = ['#2f6b2e', '#4a8a2c', '#255a33'][k];
      const d = s * 0.5, // top face depth
        f = s * 0.35; // front face height
      let y = h - s * 0.45;
      for (const cw of [1.3, 0.95, 0.6].slice(0, k === 1 ? 2 : 3)) {
        const x = (w - cw * s) / 2,
          ty = y - f - d;
        g.fillStyle = shade(leaf, 0.6);
        g.fillRect(x, y - f, cw * s, f);
        g.fillStyle = leaf;
        g.fillRect(x, ty, cw * s, d);
        g.fillStyle = shade(leaf, 1.25);
        g.fillRect(x, ty, cw * s, Math.max(1, s / 12));
        y = ty + d * 0.45;
      }
    });
  }

  /** Torch pillars on the frame, in board cells: two per side, clear of the middle gates. */
  private torches(): [number, number][] {
    const { w, h } = this.maze,
      e = -FRAME / 2,
      qx = Math.round(w / 4),
      qy = Math.round(h / 4);
    return [
      ...[qx + 0.5, w - qx - 0.5].flatMap((x): [number, number][] => [
        [x, e],
        [x, h - e],
      ]),
      ...[qy + 0.5, h - qy - 0.5].flatMap((y): [number, number][] => [
        [e, y],
        [w - e, y],
      ]),
    ];
  }

  /** Raised wall of the same grey cubes as the outer ground, a soft shadow fading into the
   * ground around it, a gold inner trim, and taller torch/corner pillars. Baked once per zoom;
   * `m` is the margin for the shadow and the cubes' lift. */
  private frame() {
    const { maze, cell: s } = this;
    const F = FRAME,
      o = F * s,
      m = Math.ceil(s * 1.5),
      W = maze.w * s + 2 * o,
      H = maze.h * s + 2 * o;
    return this.sprite('frame', W + 2 * m, H + 2 * m, (g) => {
      g.translate(m, m);
      // Soft shadow: the wall sits on the ground instead of being cut out of it.
      g.save();
      g.shadowColor = 'rgba(0,0,0,0.7)';
      g.shadowBlur = s * 1.2;
      g.shadowOffsetY = s * 0.3;
      g.fillStyle = '#1a1714';
      g.fillRect(0, 0, W, H);
      g.restore();
      // One cube: lit top, darker front face, thin highlight, like the terrain tile.
      const cube = (x: number, y: number, w: number, d: number, lift: number, base: string) => {
        g.fillStyle = shade(base, 0.55);
        g.fillRect(x, y - lift + d, w, lift);
        g.fillStyle = base;
        g.fillRect(x, y - lift, w, d);
        g.fillStyle = shade(base, 1.2);
        g.fillRect(x, y - lift, w, Math.max(1, s / 12));
        g.fillStyle = 'rgba(0,0,0,0.25)';
        g.fillRect(x + w - 1, y - lift, 1, d);
      };
      // Wall cubes back to front, outer ring a step lower than the inner one.
      const n = Math.round(F);
      for (let r = -n; r < maze.h + n; r++)
        for (let c = -n; c < maze.w + n; c++) {
          const ring = Math.min(c + n, r + n, maze.w + n - 1 - c, maze.h + n - 1 - r);
          if (ring >= n) continue; // the board
          const v = hash2(c + 99, r + 99);
          const lift = (0.5 + 0.2 * (ring / Math.max(1, n - 1)) + v * 0.08) * s;
          cube(o + c * s, o + r * s, s, s, lift, mix('#3a352f', '#575149', v));
        }
      // Gold trim where the wall meets the field.
      const t = Math.max(2, s * 0.14);
      g.strokeStyle = '#9c7c45';
      g.lineWidth = t;
      g.strokeRect(o - t / 2, o - t / 2, maze.w * s + t, maze.h * s + t);
      g.strokeStyle = 'rgba(240,200,96,0.7)';
      g.lineWidth = 1;
      g.strokeRect(o - t + 0.5, o - t + 0.5, maze.w * s + 2 * t - 1, maze.h * s + 2 * t - 1);
      // Pillars: taller cubes; torches get a bowl, corners a gold stud.
      const p = s * 1.4;
      const pillar = (cx: number, cy: number, torch: boolean) => {
        const x = o + cx * s - p / 2,
          y = o + cy * s - p / 2,
          lift = s * 1.05,
          px = x + p / 2,
          py = y - lift + p / 2;
        cube(x, y, p, p, lift, '#605a51');
        g.beginPath();
        if (torch) {
          g.fillStyle = '#1a1612';
          g.strokeStyle = '#8a7148';
          g.lineWidth = Math.max(1, s / 12);
          g.arc(px, py, p * 0.26, 0, 7);
          g.fill();
          g.stroke();
        } else {
          const d = p * 0.2;
          g.fillStyle = '#e2c47c';
          g.moveTo(px, py - d);
          g.lineTo(px + d, py);
          g.lineTo(px, py + d);
          g.lineTo(px - d, py);
          g.fill();
        }
      };
      const e = -F / 2;
      for (const [cx, cy] of [
        [e, e],
        [maze.w - e, e],
      ])
        pillar(cx, cy, false);
      // Top-to-bottom so lower pillars overlap the wall behind them.
      for (const [cx, cy] of this.torches().sort((a, b) => a[1] - b[1])) pillar(cx, cy, true);
      for (const [cx, cy] of [
        [e, maze.h - e],
        [maze.w - e, maze.h - e],
      ])
        pillar(cx, cy, false);
    });
  }

  private drawStatic() {
    const { maze, cell: s } = this;
    const top = Math.ceil(s * (BLOCK_H + TALL));
    const L = this.staticLayer;
    L.width = maze.w * s;
    L.height = maze.h * s + top;
    let g = L.getContext('2d')!;
    // Burn auras heat the ground: each cell sums the burn of every aura that reaches it.
    const heat = new Float32Array(maze.w * maze.h);
    for (const t of this.combat.towers)
      for (const e of this.combat.tfx(t).enemy) {
        if (!e.dps) continue;
        const R = e.range / UNITS_PER_CELL;
        for (let r = Math.max(0, Math.floor(t.r - R)); r <= Math.min(maze.h - 1, t.r + R); r++)
          for (let c = Math.max(0, Math.floor(t.c - R)); c <= Math.min(maze.w - 1, t.c + R); c++)
            if (Math.hypot(c - t.c, r - t.r) <= R) heat[maze.idx(c, r)] += e.dps;
      }
    g.translate(0, top);
    g.fillStyle = '#0a1510'; // grid lines: the 1px gaps between cells
    g.fillRect(0, 0, maze.w * s, maze.h * s);
    const mc = maze.w >> 1,
      mr = maze.h >> 1; // 37×37 map: column/row 18
    for (let r = 0; r < maze.h; r++)
      for (let c = 0; c < maze.w; c++) {
        const v = hash2(c, r);
        g.fillStyle = maze.noBuild[maze.idx(c, r)]
          ? mix('#26292a', '#2e3131', v)
          : mix('#1f4231', '#27503b', v);
        g.fillRect(c * s, r * s, s - 1, s - 1);
        g.fillStyle = 'rgba(255,255,255,0.05)'; // lit top edge, so cells read as tiles
        g.fillRect(c * s, r * s, s - 1, Math.max(1, s / 14));
        const onX = c === mc,
          onY = r === mr;
        if (onX || onY) {
          // Visual-only marks: grey on the main axes, a lighter grey on the exact middle.
          g.fillStyle = onX && onY ? 'rgba(200,200,200,0.35)' : 'rgba(150,150,150,0.18)';
          g.fillRect(c * s, r * s, s - 1, s - 1);
        }
        const hot = heat[maze.idx(c, r)];
        if (hot) {
          // Darker and redder the more burn lands here (log scale: 60 dps to several thousand).
          const k = Math.min(1, Math.log10(1 + hot / 60) / 2);
          g.globalAlpha = 0.2 + 0.35 * k;
          g.fillStyle = mix('#e0461c', '#5a0606', k);
          g.fillRect(c * s, r * s, s - 1, s - 1);
          g.globalAlpha = 1;
        }
        const k = this.guide?.[r]?.[c] ?? '.';
        if (k && k !== '.' && maze.cells[maze.idx(c, r)] !== WALL) {
          g.fillStyle = GUIDE_COLOR;
          g.fillRect(c * s, r * s, s - 1, s - 1);
        }
      }
    // Start and end of the route: a 3x3 mosaic under the waypoint, teal for the gate the creeps
    // come in by, crimson for the one they leave by.
    const ends = [
      [maze.waypoints[0], '80,220,200'],
      [maze.waypoints[maze.waypoints.length - 1], '235,80,70'],
    ] as const;
    for (const [[wc, wr], rgb] of ends) {
      for (let dr = -1; dr <= 1; dr++)
        for (let dc = -1; dc <= 1; dc++) {
          const x = (wc + dc) * s,
            y = (wr + dr) * s,
            i = Math.max(1, s / 8);
          g.fillStyle = `rgba(${rgb},${(dc + dr) & 1 ? 0.03 : 0.06})`;
          g.fillRect(x, y, s - 1, s - 1);
          g.strokeStyle = `rgba(${rgb},0.08)`;
          g.lineWidth = 1;
          g.strokeRect(x + i + 0.5, y + i + 0.5, s - 2 * i - 2, s - 2 * i - 2);
        }
      // A diamond through the four edge tiles ties the mosaic together.
      const cx = (wc + 0.5) * s,
        cy = (wr + 0.5) * s,
        d = s * 1.5;
      g.strokeStyle = `rgba(${rgb},0.12)`;
      g.lineWidth = Math.max(1, s / 10);
      g.beginPath();
      g.moveTo(cx, cy - d);
      g.lineTo(cx + d, cy);
      g.lineTo(cx, cy + d);
      g.lineTo(cx - d, cy);
      g.closePath();
      g.stroke();
    }
    // Vignette: the field darkens toward the wall, as if lit from the middle.
    const W = maze.w * s,
      H = maze.h * s;
    const vg = g.createRadialGradient(W / 2, H / 2, W * 0.3, W / 2, H / 2, W * 0.75);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(0,0,0,0.45)');
    g.fillStyle = vg;
    g.fillRect(0, 0, W, H);
    const route = maze.route();
    if (route && this.showPath) {
      g.lineWidth = Math.max(1, s / 6);
      // One colour per leg (S→1, 1→2, ...), so crossing legs can be told apart.
      route.forEach((field, i) => {
        g.strokeStyle = LEG_COLORS[i % LEG_COLORS.length];
        g.beginPath();
        maze
          .walk(field, maze.waypoints[i])
          .forEach(([c, r], k) => g[k ? 'lineTo' : 'moveTo']((c + 0.5) * s, (r + 0.5) * s));
        g.stroke();
      });
    }
    // Waypoint plaques: dark tile, gold rim, serif letter.
    g.font = `${Math.max(10, s * 0.62)}px 'Palatino Linotype', Palatino, Georgia, serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.lineWidth = Math.max(1, s / 16);
    maze.waypoints.forEach(([c, r], k) => {
      g.fillStyle = '#0d0f12';
      g.fillRect(c * s, r * s, s - 1, s - 1);
      g.strokeStyle = '#8a7148';
      g.strokeRect(c * s + 0.5, r * s + 0.5, s - 2, s - 2);
      g.fillStyle = '#f0e6cc';
      g.fillText(
        k === 0 ? 'S' : k === maze.waypoints.length - 1 ? 'E' : String(k),
        (c + 0.5) * s,
        (r + 0.55) * s,
      );
    });
    // Blocks go on their own layer so pedals (drawn per frame) sit under a tower's top.
    const B = this.blockLayer;
    B.width = L.width;
    B.height = L.height;
    g = B.getContext('2d')!;
    g.translate(0, top);
    // Blocks in row order so nearer rows overlap the ones behind.
    const towers = new Map(this.combat.towers.map((t) => [maze.idx(t.c, t.r), t]));
    // While a round's gems wait to be picked, older towers are greyed so the new ones stand out.
    const dim = this.pending.length ? new Set(this.pending) : null;
    for (let r = 0; r < maze.h; r++)
      for (let c = 0; c < maze.w; c++) {
        const i = maze.idx(c, r),
          cell = maze.cells[i];
        if (cell !== WALL && cell !== ROCK) continue;
        const t = towers.get(i);
        if (t) {
          // The tower's base sits on its cell; plain stones stand taller.
          g.filter = dim && !dim.has(i) ? 'grayscale(0.85) brightness(0.65)' : 'none';
          g.drawImage(
            this.tower(towerKey(t.def), t.def.type, t.def.quality),
            c * s,
            (r - TOWER_H - TALL) * s,
          );
          g.filter = 'none';
        } else {
          g.drawImage(this.block(cell === WALL ? '#1c1c24' : '#8a8a8a'), c * s, (r - BLOCK_H) * s);
          // A stone the shown guide wants open: a faint X on its top face.
          if (cell === ROCK && this.guide && (this.guide[r]?.[c] ?? '.') === '.') {
            const x = (c + 0.25) * s,
              y = (r - BLOCK_H + 0.25) * s,
              d = s / 2;
            g.strokeStyle = 'rgba(40,0,0,0.45)';
            g.lineWidth = Math.max(1, s / 10);
            g.beginPath();
            g.moveTo(x, y);
            g.lineTo(x + d, y + d);
            g.moveTo(x + d, y);
            g.lineTo(x, y + d);
            g.stroke();
          }
        }
      }
    // Quality numbers last, so a tower in front never hides the one behind's number.
    g.fillStyle = '#fff';
    g.strokeStyle = '#000';
    g.lineWidth = Math.max(2, s / 12);
    g.font = `bold ${Math.max(7, s * 0.3)}px sans-serif`;
    g.textAlign = 'right';
    g.textBaseline = 'bottom';
    for (const t of this.combat.towers)
      if (t.def.quality) {
        const x = (t.c + 1) * s - 2,
          y = (t.r + 1) * s - 1;
        g.strokeText(String(t.def.quality), x, y);
        g.fillText(String(t.def.quality), x, y);
      }
    this.staticDirty = false;
    this.staticVer++;
  }

  private emit(x: number, y: number, vx: number, vy: number, life: number, colour: number) {
    if (this.low || this.particles >= MAX_PARTICLES) return;
    const p = this.px,
      o = this.particles++ * 6;
    p[o] = x;
    p[o + 1] = y;
    p[o + 2] = vx;
    p[o + 3] = vy;
    p[o + 4] = life;
    p[o + 5] = colour;
  }

  /** Draw and age the lingering attack effects; `w` scales with what the tower cost. */
  private drawFx(dt: number, now: number) {
    const { ctx, cell: s, panX, panY } = this;
    ctx.lineJoin = 'round';
    for (let i = 0; i < this.fx.length;) {
      const f = this.fx[i];
      if ((f.age += dt) >= f.life) {
        this.fx[i] = this.fx[this.fx.length - 1];
        this.fx.pop();
        continue;
      }
      i++;
      if (f.to.alive) [f.x1, f.y1] = [f.to.x, f.to.y - (f.to.def.flying ? FLY_Z : 0.15)];
      const p = f.age / f.life,
        a = 1 - p,
        w = (0.04 + 0.16 * f.k) * s,
        x0 = panX + f.x0 * s,
        y0 = panY + f.y0 * s,
        x1 = panX + f.x1 * s,
        y1 = panY + f.y1 * s,
        dx = x1 - x0,
        dy = y1 - y0,
        len = Math.hypot(dx, dy) || 1,
        nx = -dy / len,
        ny = dx / len;
      // A path from tower to target, `n` segments, each knocked sideways by `off(t)`.
      const path = (n: number, off: (t: number) => number) => {
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        for (let q = 1; q < n; q++) {
          const t = q / n,
            j = off(t);
          ctx.lineTo(x0 + dx * t + nx * j, y0 + dy * t + ny * j);
        }
        ctx.lineTo(x1, y1);
      };
      // Stroke the current path as a coloured body and a bright core. No wider halo pass:
      // big translucent strokes are what the GPU pays for.
      const glow = (wide: number, core: number, coreCol = '#fff') => {
        ctx.strokeStyle = f.col;
        ctx.globalAlpha = a * 0.6;
        ctx.lineWidth = wide * 0.5;
        ctx.stroke();
        ctx.globalAlpha = a;
        ctx.strokeStyle = coreCol;
        ctx.lineWidth = Math.max(1, core);
        ctx.stroke();
      };
      const ring = (r: number, lw: number) => {
        ctx.strokeStyle = f.col;
        ctx.globalAlpha = a;
        ctx.lineWidth = Math.max(1, lw);
        ctx.beginPath();
        ctx.arc(x1, y1, r, 0, 7);
        ctx.stroke();
      };
      const dot = (x: number, y: number, r: number, col: string, alpha: number) => {
        ctx.globalAlpha = alpha;
        ctx.fillStyle = col;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, 7);
        ctx.fill();
      };
      const jitter = (amp: number) => () => (Math.random() - 0.5) * amp;
      switch (f.style) {
        case 'line':
          path(1, () => 0);
          glow(w * 2, w * 0.5);
          break;
        case 'beam':
          path(1, () => 0);
          glow(w * 4 * (0.5 + 0.5 * a), w);
          dot(x1, y1, w * 2 * a + 1, '#fff', a);
          break;
        case 'zap':
          // Jagged bolt, re-rolled every frame so it crackles.
          path(6, jitter(s * 0.5));
          glow(w * 2.5, w * 0.6);
          break;
        case 'laguna': {
          // Laguna Blade: a fat writhing bolt with a thin fork, a flare at the tower and a
          // shock ring at the target.
          const wave = (t: number) =>
            Math.sin(t * 11 + now / 50 + f.seed) * s * 0.22 * Math.sin(t * Math.PI) +
            (Math.random() - 0.5) * s * (0.3 + 0.5 * f.k);
          path(10, wave);
          glow(w * 5, w * 1.1);
          path(7, jitter(s * 1.1));
          glow(w * 1.6, w * 0.3);
          ring(s * (0.3 + 1.1 * p), w * a);
          dot(x0, y0, w * 2.5 * a + 1, '#fff', a);
          dot(x1, y1, w * 3 * a + 1, '#fff', a * 0.9);
          break;
        }
        case 'finger': {
          // Finger of Death: two strands coiling round a hard core, a dark bloom at the target.
          for (const sign of [1, -1]) {
            path(
              16,
              (t) => Math.sin(t * 16 - now / 35 + f.seed) * s * 0.26 * sign * Math.sin(t * Math.PI),
            );
            glow(w * 2.2, w * 0.4, '#ffd8c8');
          }
          path(1, () => 0);
          glow(w * 5, w);
          dot(x1, y1, s * (0.25 + 0.5 * p), '#000', a * 0.45);
          ring(s * (0.25 + 0.9 * p), w * a);
          dot(x1, y1, w * 2.5 * a + 1, '#fff', a);
          break;
        }
        case 'ray': {
          // Lance of light: broad at the tower, a point at the target.
          const h = w * 3 * a + 1;
          ctx.globalAlpha = a * 0.55;
          ctx.fillStyle = f.col;
          ctx.beginPath();
          ctx.moveTo(x0 + nx * h, y0 + ny * h);
          ctx.lineTo(x1, y1);
          ctx.lineTo(x0 - nx * h, y0 - ny * h);
          ctx.fill();
          path(1, () => 0);
          glow(w * 1.5, w * 0.5);
          dot(x1, y1, w * 2.5 * a + 1, '#fff', a);
          break;
        }
        default: {
          // Projectiles: fly for the first 70% of the effect, then pop.
          const t = Math.min(1, p / 0.7),
            lift = f.style === 'glob' ? Math.sin(t * Math.PI) * s * 0.8 : 0,
            px = x0 + dx * t,
            py = y0 + dy * t - lift;
          if (t >= 1) {
            ring(w * 2 + s * 0.5 * ((p - 0.7) / 0.3), w * 0.6);
            break;
          }
          const tt = Math.max(0, t - 0.25),
            tl = f.style === 'glob' ? Math.sin(tt * Math.PI) * s * 0.8 : 0;
          ctx.globalAlpha = 0.5;
          ctx.strokeStyle = f.col;
          ctx.lineWidth = Math.max(1, w);
          ctx.beginPath();
          ctx.moveTo(x0 + dx * tt, y0 + dy * tt - tl);
          ctx.lineTo(px, py);
          ctx.stroke();
          if (f.style === 'shard') {
            // A cut gem flying point first.
            const l = w * 3 + 3,
              h = w * 1.2 + 1.5,
              ux = dx / len,
              uy = dy / len;
            ctx.globalAlpha = 1;
            ctx.fillStyle = f.col;
            ctx.beginPath();
            ctx.moveTo(px + ux * l, py + uy * l);
            ctx.lineTo(px + nx * h, py + ny * h);
            ctx.lineTo(px - ux * l, py - uy * l);
            ctx.lineTo(px - nx * h, py - ny * h);
            ctx.fill();
            dot(px + ux * l * 0.3, py + uy * l * 0.3, Math.max(1, h * 0.4), '#fff', 0.9);
          } else {
            dot(px, py, w * 1.6 + 2, f.col, 1);
            dot(px, py, w * 0.7 + 1, '#fff', 0.9);
          }
        }
      }
    }
    ctx.globalAlpha = 1;
    ctx.lineJoin = 'miter';
  }

  /** Cosmetic ring burst (deaths, splash impacts). */
  private burst(x: number, y: number, n: number, speed = 3, colour = 0) {
    for (let k = 0; k < n; k++) {
      const a = (k / n) * 6.283;
      this.emit(x, y - 0.2, Math.cos(a) * speed, Math.sin(a) * speed, 0.5, colour);
    }
  }

  /** Burn-aura towers with at least one enemy inside, refreshed each sim tick. */
  private burning = new Set<Tower>();

  /** Attack effects still on screen: hits resolve at once, their look lingers for a moment. */
  private fx: Fx[] = [];
  private fxAt = new WeakMap<Tower, number>(); // when each tower last spawned an effect
  private tiers = new Map<GemDef, number>();
  /** What a tower cost to build: a gem's quality, or the sum over a special's ingredients. */
  private tier(d: GemDef): number {
    let n = this.tiers.get(d);
    if (n === undefined) {
      this.tiers.set(d, 1); // guards a recipe loop
      const rec = d.quality ? null : (d as Partial<SpecialDef>).recipes?.[0];
      const of = (code: string) => (this.combat.gems[code] ? this.tier(this.combat.gems[code]) : 1);
      n = rec ? rec.reduce((a, code) => a + of(code), 0) : d.quality || 1;
      this.tiers.set(d, n);
    }
    return n;
  }

  /** Emit cosmetic hit sparks, splash rings and burn embers (call once per sim tick). */
  sparks() {
    const { combat } = this,
      now = performance.now();
    for (const { from, to } of combat.shots) {
      const a = Math.random() * 7; // cosmetic only, so Math.random is fine
      const y = to.y - (to.def.flying ? FLY_Z : 0);
      const kind = shotKind(combat, from);
      // One effect per tower per FX_GAP (a volley in the same tick counts as one): fast towers
      // and high game speeds would otherwise stack wide translucent strokes and sink the frame rate.
      const last = this.fxAt.get(from);
      if (!this.low && this.fx.length < MAX_FX && (last === now || now - (last ?? 0) >= FX_GAP)) {
        this.fxAt.set(from, now);
        const [style, col] = attackOf(from.def);
        const k = Math.min(1, this.tier(from.def) / 40);
        this.fx.push({
          x0: from.c + 0.5,
          y0: from.r + 0.48 - TOWER_H - TALL,
          to,
          x1: to.x,
          y1: y - 0.15,
          age: 0,
          life: FX_LIFE[style][0] + FX_LIFE[style][1] * k,
          style,
          col,
          k,
          seed: a,
        });
      }
      if (kind === 'frost')
        // Snow: a few flakes that puff out and drift down.
        for (let k = 0; k < 4; k++)
          this.emit(to.x, y - 0.3, Math.cos(a + k) * 1.5, 0.6 + Math.random(), 0.7, 3);
      else
        this.emit(
          to.x,
          y - 0.3,
          Math.cos(a) * 2,
          Math.sin(a) * 2 - 1,
          0.4,
          kind === 'lightning' ? 4 : 0,
        );
      if (combat.tfx(from).cleave) this.burst(to.x, y, 8, 4, 1);
    }
    // Burn auras only show where they are actually hurting someone: embers on each enemy inside.
    this.burning.clear();
    for (const t of combat.towers)
      for (const e of combat.tfx(t).enemy) {
        if (!e.dps) continue;
        const reach = e.range / UNITS_PER_CELL;
        for (const cr of this.sim.creeps) {
          if (!cr.alive || Math.hypot(t.c + 0.5 - cr.x, t.r + 0.5 - cr.y) > reach) continue;
          this.burning.add(t);
          const y = cr.y - (cr.def.flying ? FLY_Z : 0.15);
          this.emit(
            cr.x + (Math.random() - 0.5) * 0.5,
            y,
            0,
            -1.2,
            0.6,
            Math.random() < 0.4 ? 2 : 1,
          );
        }
      }
    // Disarmed towers shed purple motes.
    for (const t of combat.towers)
      if (t.disarmT > 0 && !t.aura.calm && Math.random() < 0.5)
        this.emit(t.c + 0.2 + Math.random() * 0.6, t.r - TALL, 0, -0.8, 0.8, 5);
  }

  private staticVer = 0;
  private drawBg() {
    const { cell: s, panX, panY } = this,
      B = this.bg;
    if (B.width !== this.canvas.width || B.height !== this.canvas.height)
      [B.width, B.height] = [this.canvas.width, this.canvas.height];
    const g = B.getContext('2d', { alpha: false })!;
    const tp = this.terrain();
    tp.setTransform(new DOMMatrix([1, 0, 0, 1, panX | 0, panY | 0]));
    g.fillStyle = tp;
    g.fillRect(0, 0, B.width, B.height);
    // The board stands on a ragged plateau of grey cubes, mossy at the rim, with a cliff on its
    // south side; cube trees dot the lowland beyond. Rows back to front, visible cells only.
    const { w, h } = this.maze,
      R = FRAME + PLATEAU + 1, // furthest the plateau reaches past the board
      T = R + 2, // trees keep clear of the plateau and its cliff
      ox = panX | 0,
      oy = panY | 0;
    for (let r = Math.floor(-oy / s) - 3; r <= Math.ceil((B.height - oy) / s) + 3; r++)
      for (let c = Math.floor(-ox / s) - 1; c <= Math.ceil((B.width - ox) / s); c++) {
        if (c >= -FRAME && c < w + FRAME && r >= -FRAME && r < h + FRAME) continue; // wall, board
        const x = ox + c * s,
          v = hash2(c + 31, r + 57);
        if (c < -T || c >= w + T || r < -T || r >= h + T) {
          if (hash2(c * 3 + 11, r * 5 + 17) < TREES)
            g.drawImage(this.tree(Math.floor(v * 3)), x - s / 4, oy + r * s + s * 0.8 - s * 2.6);
          continue;
        }
        if (c < -R || c >= w + R || r < -R || r >= h + R || !this.onPlateau(c, r)) continue;
        const edge = !this.onPlateau(c, r + 1),
          rim =
            edge ||
            !this.onPlateau(c - 1, r) ||
            !this.onPlateau(c + 1, r) ||
            !this.onPlateau(c, r - 1);
        const base = mix(mix('#34302b', '#5a534a', v), '#3d6a2c', rim ? 0.3 : 0),
          lift = Math.floor(v * 4) * 0.18 * s,
          y = oy + r * s - lift,
          face = lift + (edge ? CLIFF * s : 0);
        g.fillStyle = shade(base, 0.55);
        g.fillRect(x, y + s, s, face);
        if (edge) {
          // The cliff darkens toward its foot and throws a shadow on the leaves below.
          g.fillStyle = 'rgba(0,0,0,0.3)';
          g.fillRect(x, y + s + face / 2, s, face / 2);
          g.fillStyle = 'rgba(0,0,0,0.35)';
          g.fillRect(x, y + s + face, s, s * 0.4);
        }
        g.fillStyle = base;
        g.fillRect(x, y, s, s);
        g.fillStyle = shade(base, 1.2);
        g.fillRect(x, y, s, Math.max(1, s / 12));
        g.fillStyle = 'rgba(0,0,0,0.25)';
        g.fillRect(x + s - 1, y, 1, s);
      }
    // Vignette: the lowland darkens away from the plateau, near black at the edge of the world.
    // Half-cell bands that follow the board's outline with rounded corners.
    g.fillStyle = 'rgba(2,8,4,0.09)';
    for (let k = DUSK; k < WORLD; k += 0.5) {
      const band = new Path2D();
      band.rect(0, 0, B.width, B.height);
      band.roundRect(ox - k * s, oy - k * s, (w + 2 * k) * s, (h + 2 * k) * s, k * s);
      g.fill(band, 'evenodd');
    }
    const fm = Math.ceil(s * 1.5) + FRAME * s;
    g.drawImage(this.frame(), (panX - fm) | 0, (panY - fm) | 0);
    g.drawImage(this.staticLayer, panX | 0, (panY - Math.ceil(s * (BLOCK_H + TALL))) | 0);
    // Torches: warm light spilling onto the field.
    g.globalCompositeOperation = 'lighter';
    for (const [tx, ty] of this.torches()) {
      const cx = (panX + tx * s) | 0,
        cy = ((panY + ty * s) | 0) - s * 1.05,
        r = s * 3.2;
      const gl = g.createRadialGradient(cx, cy, 0, cx, cy, r);
      gl.addColorStop(0, 'rgba(255,170,70,0.32)');
      gl.addColorStop(1, 'rgba(255,140,40,0)');
      g.fillStyle = gl;
      g.fillRect(cx - r, cy - r, r * 2, r * 2);
    }
    g.globalCompositeOperation = 'source-over';
  }

  /** alpha = fraction of the way from the previous tick to the current one; dt = frame seconds. */
  render(alpha: number, dt: number, now: number) {
    const dimKey = this.pending.join();
    if (dimKey !== this.dimKey) [this.dimKey, this.staticDirty] = [dimKey, true];
    if (this.staticDirty) this.drawStatic();
    const { ctx, cell: s, panX, panY } = this;
    const X = (x: number) => (panX + x * s) | 0;
    const Y = (y: number) => (panY + y * s) | 0;
    const bgKey = `${panX | 0},${panY | 0},${s},${this.canvas.width},${this.canvas.height},${this.staticVer}`;
    if (bgKey !== this.bgKey) {
      this.bgKey = bgKey;
      this.drawBg();
    }
    ctx.drawImage(this.bg, 0, 0);
    // Torch flames flicker per frame; their light is baked into the background.
    ctx.fillStyle = '#ff8a2a';
    const flames = this.torches().map(([tx, ty], i) => {
      const f = 0.95 + 0.05 * Math.sin(now / 260 + i * 1.7) * Math.sin(now / 170 + i);
      return [X(tx), Y(ty) - s * 1.05, f] as const;
    });
    ctx.beginPath();
    for (const [cx, cy, f] of flames) {
      ctx.moveTo(cx + s * 0.17, cy - s * 0.18 * f);
      ctx.ellipse(cx, cy - s * 0.18 * f, s * 0.17, s * 0.3 * f, 0, 0, 7);
    }
    ctx.fill();
    ctx.fillStyle = '#ffe08a';
    ctx.beginPath();
    for (const [cx, cy, f] of flames) {
      ctx.moveTo(cx + s * 0.08, cy - s * 0.1 * f);
      ctx.ellipse(cx, cy - s * 0.1 * f, s * 0.08, s * 0.16 * f, 0, 0, 7);
    }
    ctx.fill();

    // Pedals lie flat on the path: glowing while armed, dim with a refill arc while cooling down,
    // and a shock ring in the spell's colour when a creep sets one off.
    for (const t of this.combat.towers) {
      const pd = this.combat.tfx(t).pedal;
      if (!pd) continue;
      const [spell, k] = pd,
        col = spellColor(spell),
        cx = X(t.c + 0.5),
        cy = Y(t.r + 0.5),
        key = towerKey(t.def);
      const sp = this.sprite(`p${key}`, s, s, (g) => towerModel(g, key, s / 2, s / 2, s * 0.4));
      const since = PEDAL.cooldown - t.cooldown; // seconds since it last went off
      ctx.save();
      if (t.cooldown > 0) ctx.globalAlpha = 0.45;
      else {
        ctx.shadowColor = col;
        ctx.shadowBlur = this.glow * s * (0.3 + 0.2 * Math.sin(now / 250));
      }
      ctx.drawImage(sp, cx - s / 2, cy - s / 2);
      ctx.restore();
      if (t.cooldown > 0) {
        ctx.strokeStyle = col;
        ctx.lineWidth = Math.max(1, s / 12);
        ctx.beginPath();
        ctx.arc(cx, cy, s * 0.46, -1.571, -1.571 + (since / PEDAL.cooldown) * 6.283);
        ctx.stroke();
      }
      if (t.cooldown > 0 && since < 0.8) {
        const def = SPELL[spell] as { radius?: number | readonly number[] };
        const rad = typeof def.radius === 'number' ? def.radius : (def.radius?.[k] ?? 128);
        const f = since / 0.8;
        ctx.strokeStyle = col;
        ctx.globalAlpha = 1 - f;
        ctx.lineWidth = Math.max(2, s / 6) * (1 - f);
        ctx.beginPath();
        ctx.arc(cx, cy, (rad / UNITS_PER_CELL) * s * (0.2 + 0.8 * f), 0, 7);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
    }

    ctx.drawImage(this.blockLayer, panX | 0, (panY - Math.ceil(s * (BLOCK_H + TALL))) | 0);

    if (this.flash >= 0 && now < this.flashUntil) {
      ctx.fillStyle = 'rgba(220,50,50,0.6)';
      ctx.fillRect(X(this.flash % this.maze.w), Y((this.flash / this.maze.w) | 0), s, s);
    }

    if (this.cursor >= 0) {
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2 * this.dpr;
      ctx.strokeRect(
        X(this.cursor % this.maze.w) + this.dpr,
        Y((this.cursor / this.maze.w) | 0) + this.dpr,
        s - 2 * this.dpr,
        s - 2 * this.dpr,
      );
    }

    // Burn auras (Volcano, Asteriated Ruby...): a pulsing heat ring while an enemy is inside.
    const pulse = 0.3 + 0.12 * Math.sin(now / 250);
    if (this.showRanges)
      for (const t of this.burning)
        for (const e of this.combat.tfx(t).enemy) {
          if (!e.dps) continue;
          ctx.strokeStyle = `rgba(255,110,30,${pulse})`;
          ctx.fillStyle = `rgba(255,80,20,${pulse / 3})`;
          ctx.lineWidth = Math.max(1, s / 8);
          ctx.beginPath();
          ctx.arc(X(t.c + 0.5), Y(t.r + 0.5), (e.range / UNITS_PER_CELL) * s, 0, 7);
          ctx.fill();
          ctx.stroke();
        }

    // Combinable towers: a soft pulsing aura over the tower body. Pinned recipes glow pink
    // instead: a steady ring while ingredients are missing, the full aura once it can be built.
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const aura = 0.35 + 0.2 * Math.sin(now / 300);
    for (const [cells, rgb, ring] of [
      [this.hints, '170,255,240', this.low],
      [this.pinned, '255,130,225', true],
      [this.pinReady, '255,130,225', this.low],
    ] as const)
      for (const h of cells) {
        const cx = X((h % this.maze.w) + 0.5),
          cy = Y(((h / this.maze.w) | 0) + 0.5 - (TOWER_H + TALL) / 2),
          rad = s * 0.85;
        if (ring) {
          ctx.strokeStyle = `rgba(${rgb},${cells === this.pinned ? 0.6 : aura + 0.3})`;
          ctx.lineWidth = Math.max(2, s / 10);
          ctx.beginPath();
          ctx.arc(cx, cy, rad * 0.6, 0, 7);
          ctx.stroke();
          continue;
        }
        const gr = ctx.createRadialGradient(cx, cy, 0, cx, cy, rad);
        gr.addColorStop(0, `rgba(${rgb},${aura})`);
        gr.addColorStop(1, `rgba(${rgb},0)`);
        ctx.fillStyle = gr;
        ctx.fillRect(cx - rad, cy - rad, rad * 2, rad * 2);
      }
    ctx.restore();
    if (this.pending.length) {
      ctx.save();
      ctx.strokeStyle = `rgba(255,240,150,${0.55 + 0.35 * Math.sin(now / 200)})`;
      ctx.shadowColor = '#ffe066';
      ctx.shadowBlur = (this.glow * s) / 3;
      ctx.lineWidth = 2 * this.dpr;
      for (const p of this.pending) {
        const pc = p % this.maze.w,
          pr = (p / this.maze.w) | 0;
        // Trace the square base: its top face plus front face.
        ctx.strokeRect(
          X(pc) + this.dpr,
          Y(pr - TOWER_H) + this.dpr,
          s - 2 * this.dpr,
          s * (1 + TOWER_H) - 2 * this.dpr,
        );
        // The back edge crosses the gem standing on the base: redraw that strip so it passes behind.
        const t = this.combat.towerAt(pc, pr);
        if (!t) continue;
        const ey = Y(pr - TOWER_H);
        ctx.save();
        ctx.shadowBlur = 0;
        ctx.beginPath();
        ctx.rect(X(pc) + 3 * this.dpr, ey - s / 4, s - 6 * this.dpr, s / 2); // spare the side edges
        ctx.clip();
        ctx.drawImage(
          this.tower(towerKey(t.def), t.def.type, t.def.quality),
          X(pc),
          Y(pr - TOWER_H - TALL),
        );
        ctx.restore();
      }
      ctx.restore();
    }
    // Crown floating over the tower with the most MVP awards (ties: more damage dealt).
    let king: Tower | null = null;
    for (const t of this.combat.towers)
      if (
        t.mvp &&
        (!king || t.mvp > king.mvp || (t.mvp === king.mvp && t.damageDealt > king.damageDealt))
      )
        king = t;
    if (king) {
      const w = s * 0.5;
      const crown = this.sprite(`crown${w}`, w, w * 0.7, (g) => {
        const h = w * 0.7;
        g.fillStyle = '#ffd24a';
        g.strokeStyle = '#6b4a00';
        g.lineWidth = Math.max(1, w / 16);
        g.beginPath();
        g.moveTo(w * 0.08, h * 0.92);
        g.lineTo(w * 0.04, h * 0.25);
        g.lineTo(w * 0.3, h * 0.55);
        g.lineTo(w * 0.5, h * 0.08);
        g.lineTo(w * 0.7, h * 0.55);
        g.lineTo(w * 0.96, h * 0.25);
        g.lineTo(w * 0.92, h * 0.92);
        g.closePath();
        g.fill();
        g.stroke();
        g.fillStyle = '#e8364a';
        g.beginPath();
        g.arc(w * 0.5, h * 0.68, w * 0.07, 0, 7);
        g.fill();
      });
      // Sits just above the head, whose size depends on the tower.
      const head = king.r - TOWER_H - TALL + HEAD_Y - headSize(king.def.quality);
      const bob = 0.05 * Math.sin(now / 400);
      ctx.drawImage(crown, X(king.c + 0.5) - w / 2, Y(head + bob - 0.05) - crown.height);
    }
    // Attack ranges: all towers when Ranges is on, the selected one always.
    const selT =
      this.selected >= 0
        ? this.combat.towerAt(this.selected % this.maze.w, (this.selected / this.maze.w) | 0)
        : undefined;
    ctx.lineWidth = this.dpr;
    for (const t of this.combat.towers) {
      if (t.def.pedal || (t !== selT && !this.showRanges)) continue;
      const on = t === selT;
      ctx.strokeStyle = on ? 'rgba(255,210,74,0.9)' : 'rgba(255,255,255,0.14)';
      ctx.fillStyle = 'rgba(255,210,74,0.08)';
      ctx.beginPath();
      ctx.arc(X(t.c + 0.5), Y(t.r + 0.5), (this.combat.range(t) / UNITS_PER_CELL) * s, 0, 7);
      if (on) ctx.fill();
      ctx.stroke();
    }

    ctx.lineWidth = 2 * this.dpr;
    for (const cell of this.selected >= 0 ? [this.selected, ...this.multi] : []) {
      ctx.strokeStyle = cell === this.selected ? '#ffd24a' : '#ffd24a88';
      const sc = cell % this.maze.w,
        sr = (cell / this.maze.w) | 0;
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
      const sh = this.shadow(cr.def.boss || !!cr.def.giant);
      const x = cr.px + (cr.x - cr.px) * alpha,
        y = cr.py + (cr.y - cr.py) * alpha;
      ctx.drawImage(sh, X(x) - sh.width / 2, Y(y) - sh.height / 2);
    }
    for (const cr of order) {
      // Face the way it last moved sideways; purely vertical steps keep the old facing.
      const dx = cr.x - cr.px;
      if (Math.abs(dx) > 1e-4) this.facingLeft.set(cr, dx < 0);
      const sp = this.creepSprite(cr, this.facingLeft.get(cr) ?? false);
      // Hop while walking, drift while flying; phase by x so a wave doesn't bob in sync.
      const t = now / 110 + cr.x * 3;
      const bob = cr.def.flying
        ? Math.sin(t / 2) * 0.05
        : cr.stunT > 0
          ? 0
          : Math.abs(Math.sin(t)) * 0.08;
      const x = cr.px + (cr.x - cr.px) * alpha,
        y = cr.py + (cr.y - cr.py) * alpha - (cr.def.flying ? FLY_Z : 0.15) - bob;
      if (cr === this.creep) {
        ctx.strokeStyle = '#ffd24a';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.ellipse(X(x), Y(y + bob + 0.3), sp.width * 0.4, sp.width * 0.16, 0, 0, 7);
        ctx.stroke();
      }
      // Pedal debuffs: a coloured ring at the feet of the strongest one (stun/root first).
      const debuff =
        cr.stunT > 0
          ? 'ensnare'
          : cr.terror > 0
            ? 'terrorize'
            : cr.mrRed > 0
              ? 'decrepify'
              : cr.armorRed > 0
                ? 'acid'
                : cr.slowPctT > 0 || cr.stackPct > 0
                  ? 'gale'
                  : '';
      if (debuff) {
        ctx.strokeStyle = debuff === 'ensnare' ? '#ffe066' : spellColor(debuff);
        ctx.lineWidth = Math.max(2, s / 10);
        ctx.beginPath();
        ctx.ellipse(X(x), Y(y + bob + 0.3), sp.width * 0.35, sp.width * 0.13, 0, 0, 7);
        ctx.stroke();
      }
      ctx.drawImage(sp, X(x) - sp.width / 2, Y(y) - sp.height / 2);
      // Health bar once damaged (always for the selected creep).
      if (cr.hp < cr.def.hp || cr === this.creep) {
        const w = sp.width * 0.7,
          bx = X(x) - w / 2,
          by = Y(y) - sp.height / 2 - 4;
        ctx.fillStyle = '#000a';
        ctx.fillRect(bx - 1, by - 1, w + 2, 5);
        const f = Math.max(0, cr.hp / cr.def.hp);
        ctx.fillStyle = f > 0.5 ? '#4fd05a' : f > 0.25 ? '#f2c52e' : '#e03a3a';
        ctx.fillRect(bx, by, w * f, 3);
      }
    }

    // Attacks. Low graphics: plain tracers by shot kind (thin white, icy blue, silver beam, forked
    // lightning), batched per kind. Otherwise every tower has its own lingering effect.
    const head = (t: Tower) => [X(t.c + 0.5), Y(t.r + 0.48 - TOWER_H - TALL)] as const;
    const hit = (cr: Creep) => [X(cr.x), Y(cr.y - (cr.def.flying ? FLY_Z : 0.15))] as const;
    if (this.low) {
      for (const [kind, colour, width, glow] of TRACERS) {
        ctx.strokeStyle = colour;
        ctx.lineWidth = Math.max(1, width * s);
        ctx.shadowColor = glow;
        ctx.shadowBlur = glow === 'transparent' ? 0 : (this.glow * s) / 2;
        ctx.beginPath();
        for (const { from, to } of this.combat.shots) {
          if (shotKind(this.combat, from) !== kind) continue;
          const [x0, y0] = head(from),
            [x1, y1] = hit(to);
          ctx.moveTo(x0, y0);
          if (kind === 'lightning') {
            // Jagged bolt: re-rolled every frame so it crackles.
            const n = 6,
              nx = -(y1 - y0),
              ny = x1 - x0,
              len = Math.hypot(nx, ny) || 1;
            for (let k = 1; k < n; k++) {
              const j = (Math.random() - 0.5) * s * 0.5;
              ctx.lineTo(
                x0 + ((x1 - x0) * k) / n + (nx / len) * j,
                y0 + ((y1 - y0) * k) / n + (ny / len) * j,
              );
            }
          }
          ctx.lineTo(x1, y1);
        }
        ctx.stroke();
      }
    } else this.drawFx(dt, now);
    ctx.shadowBlur = 0;

    // Howl-buffed towers: a pulsing red-bronze glow round the head.
    ctx.save();
    ctx.strokeStyle = SPELL_COLOR.Howl;
    ctx.shadowColor = '#ff6a3a';
    ctx.shadowBlur = (this.glow * s) / 2;
    ctx.lineWidth = Math.max(2, s / 8);
    for (const t of this.combat.towers) {
      if (t.howl.t <= 0) continue;
      const [x, y] = head(t);
      ctx.globalAlpha = 0.6 + 0.4 * Math.sin(now / 150);
      ctx.beginPath();
      ctx.arc(x, y, s * 0.45, 0, 7);
      ctx.stroke();
    }
    ctx.restore();

    // Calm-aura towers (Deepsea Pearl): a faint pale-blue shield dome over the head.
    ctx.strokeStyle = 'rgba(150,220,255,0.7)';
    ctx.lineWidth = Math.max(1.5, s / 16);
    for (const t of this.combat.towers) {
      if (!t.aura.calm || t.def.pedal) continue; // pedals lie flat: no dome
      const [x, y] = head(t);
      ctx.beginPath();
      ctx.arc(x, y + s * 0.15, s * 0.45, Math.PI * 1.1, Math.PI * 1.9);
      ctx.stroke();
    }

    // Disarmed towers: a purple shackle ring spinning round the head.
    ctx.strokeStyle = '#c06aff';
    ctx.lineWidth = Math.max(2, s / 10);
    for (const t of this.combat.towers) {
      if (t.disarmT <= 0) continue;
      const [x, y] = head(t),
        a = now / 200;
      ctx.beginPath();
      ctx.ellipse(x, y, s * 0.5, s * 0.2, 0, a, a + 2.2);
      ctx.moveTo(x + Math.cos(a + 3.14) * s * 0.5, y + Math.sin(a + 3.14) * s * 0.2);
      ctx.ellipse(x, y, s * 0.5, s * 0.2, 0, a + 3.14, a + 5.3);
      ctx.stroke();
    }

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

type Style = 'line' | 'beam' | 'zap' | 'laguna' | 'finger' | 'orb' | 'glob' | 'shard' | 'ray';
interface Fx {
  x0: number; // tower head, in cells
  y0: number;
  to: Creep; // followed while it lives
  x1: number;
  y1: number;
  age: number;
  life: number;
  style: Style;
  col: string;
  k: number; // 0..1: how dear the tower is; scales width, length of stay and extras
  seed: number;
}
const MAX_FX = 120;
const FX_GAP = 90; // ms between effects from one tower
// Seconds on screen: [base, extra at the top tier].
const FX_LIFE: Record<Style, [number, number]> = {
  line: [0.12, 0.05],
  beam: [0.18, 0.15],
  zap: [0.15, 0.1],
  laguna: [0.3, 0.25],
  finger: [0.35, 0.25],
  orb: [0.2, 0],
  glob: [0.28, 0],
  shard: [0.18, 0],
  ray: [0.2, 0.2],
};
// Every special tower's attack: a style and its colour. Width, stay and extras come from its cost.
const ATTACK: Record<string, [Style, string]> = {
  silver: ['line', '#bfe4ff'],
  'silver-knight': ['beam', '#cfe6ff'],
  'pink-diamond': ['zap', '#ff9be6'],
  'huge-pink-diamond': ['laguna', '#ff5fd2'],
  'koh-i-noor-diamond': ['laguna', '#6fb4ff'],
  malachite: ['shard', '#2f8f3a'],
  'vivid-malachite': ['shard', '#7dff7a'],
  'uranium-238': ['glob', '#b6ff3a'],
  'uranium-235': ['glob', '#ffe23a'],
  'depleted-kyparium': ['ray', '#4fd8ff'],
  'asteriated-ruby': ['orb', '#ff7a2a'],
  volcano: ['glob', '#ff5a1a'],
  bloodstone: ['zap', '#ff5a4a'],
  'antique-bloodstone': ['zap', '#ff8a3a'],
  'the-crown-prince': ['finger', '#b05aff'],
  jade: ['glob', '#7fe05a'],
  quartz: ['shard', '#ffe8d8'],
  'grey-jade': ['glob', '#6fa8e0'],
  'monkey-king-jade': ['shard', '#ffb040'],
  'diamond-cullinan': ['ray', '#fff2b0'],
  'lucky-chinese-jade': ['glob', '#ffcf40'],
  'charming-lazurite': ['shard', '#b07aff'],
  'golden-jubilee': ['ray', '#ffb020'],
  gold: ['orb', '#ffd24a'],
  'egypt-gold': ['orb', '#ffe890'],
  'dark-emerald': ['orb', '#39d98a'],
  'emerald-golem': ['glob', '#9be0b0'],
  'paraiba-tourmaline': ['orb', '#4fe0d8'],
  'elaborately-carved-tourmaline': ['orb', '#ffb050'],
  'sapphire-star-of-adam': ['beam', '#5aa8ff'],
  'deepsea-pearl': ['orb', '#f4f0d0'],
  'chrysoberyl-cat-s-eye': ['line', '#d8e07a'],
  'red-coral': ['orb', '#ff7a5a'],
  'natural-zumurud': ['shard', '#7a6aff'],
  'carmen-lucia': ['finger', '#ff6a8a'],
  'yellow-sapphire': ['line', '#ffe27a'],
  'northern-saber-s-eye': ['zap', '#9fe8ff'],
  'star-sapphire': ['beam', '#cfe0ff'],
  obsidian: ['beam', '#ff7a3a'],
  agate: ['shard', '#e0a860'],
  'fantastic-miss-shrimp': ['zap', '#ffd040'],
  geluanshi: ['ray', '#fff0c0'],
  'the-burning-stone': ['orb', '#6fc0ff'],
  'the-great-stone': ['glob', '#a8c070'],
  'black-opal': ['finger', '#8a4ae0'],
  ehome: ['ray', '#ff7ab8'],
  'wings-stone': ['shard', '#fff2c0'],
  'regent-diamond': ['laguna', '#ff3a6a'],
  'kyparium-core': ['ray', '#4fe0d8'],
  'the-blood-king': ['finger', '#ff2020'],
  'cullinan-heart': ['laguna', '#ffe680'],
  'star-of-eden': ['laguna', '#4dff8a'],
};
export const hasAttack = (key: string) => key in ATTACK;
/** Gems throw a cut shard of their own colour; specials have their own entry. */
const attackOf = (d: GemDef): [Style, string] =>
  (!d.quality && ATTACK[slug(d.name)]) || ['shard', GEM_COLOR[d.type] ?? '#ffffff'];
type Shot = 'normal' | 'frost' | 'beam' | 'lightning';
const BEAM = new Set(['Silver', 'Silver Knight', 'Koh-i-noor Diamond']);
const LIGHTNING = new Set(['Pink Diamond', 'Huge Pink Diamond']);
/** How a tower's attack is drawn. */
export function shotKind(combat: Combat, t: Tower): Shot {
  if (BEAM.has(t.def.name)) return 'beam';
  if (LIGHTNING.has(t.def.name)) return 'lightning';
  const f = combat.tfx(t);
  return f.slow || f.frost ? 'frost' : 'normal';
}
// [kind, stroke, width in cells, glow colour]
const TRACERS: [Shot, string, number, string][] = [
  ['normal', 'rgba(255,255,255,0.8)', 0, 'transparent'],
  ['frost', 'rgba(170,220,255,0.9)', 0.06, '#7cc4ff'],
  ['beam', 'rgba(225,238,255,0.9)', 0.2, '#bcd8ff'],
  ['lightning', 'rgba(255,215,250,0.95)', 0.07, '#ff7ad9'],
];
// 0 spark, 1 fire, 2 ember, 3 snow, 4 lightning spark, 5 disarm mote
const PARTICLE_COLOR = ['#ffe9a0', '#ff7a1a', '#ffcf40', '#e8f6ff', '#ffc8f4', '#c06aff'];
