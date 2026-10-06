// Canvas 2D renderer, CPU-first 2.5D (BUILD.md §3.7). Reads sim state only, never mutates it.
// Static layer (ground, route, blocks) is an offscreen canvas redrawn only on maze/zoom change;
// the dynamic layer (creeps, tracers, particles) is redrawn every frame from baked sprites.
import { ROCK, WALL, type Maze } from './sim/maze';
import { PEDAL, PEDALS, SPELL, TIERS } from './sim/pedals';
import type { Combat, Tower } from './sim/towers';
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
const FLY_Z = 40 / UNITS_PER_CELL; // cells
const BLOCK_H = 0.5; // front-face height of stones/towers, in cells
const TALL = 0.55;
const TOWER_H = 0.2; // front-face height of a tower's own (lower) base, in cells // how far modelled towers rise above their block, in cells
export const MAX_PARTICLES = 800;
const HUD_H = 44;
const PANEL_H = 150; // bottom panel
const FRAME = 2; // stone border around the board, in cells
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
  let ey = -0.1; // eye centre y
  let er = 0.3; // eye radius
  switch (body) {
    case 'orb':
      disc(0, 0.05, 0.85, shade(c, 0.6));
      disc(-0.08, -0.02, 0.75, c);
      for (let i = 0; i < 8; i++) {
        const t = (i / 8) * 6.283;
        const p = (k: number, d: number) => [Math.cos(t + k) * d, Math.sin(t + k) * d];
        poly([...p(0, 0.7), ...p(0.3, 0.98), ...p(0.5, 0.7)], a);
      }
      er = 0.36;
      break;
    case 'pillar':
      poly([-0.55, 0.9, 0.55, 0.9, 0.45, -0.3, -0.45, -0.3], shade(c, 0.7));
      poly([-0.55, 0.9, 0, 0.9, 0, -0.3, -0.45, -0.3], c);
      for (const y of [0.1, 0.5]) poly([-0.6, y, 0.6, y, 0.6, y + 0.14, -0.6, y + 0.14], a);
      ey = -0.45;
      break;
    case 'house':
      poly([-0.6, 0.9, 0.6, 0.9, 0.6, 0, -0.6, 0], shade(c, 0.8));
      poly([-0.8, 0.05, 0, -0.85, 0.8, 0.05], a);
      poly([-0.8, 0.05, 0, -0.85, 0, 0.05], shade(a, 1.3));
      poly([-0.15, 0.9, 0.15, 0.9, 0.15, 0.5, -0.15, 0.5], '#1a1410');
      ey = -0.2;
      er = 0.26;
      break;
    case 'mech':
      poly([-0.35, -0.95, -0.2, -0.95, -0.2, -0.4, -0.35, -0.4], a);
      poly([0.2, -0.95, 0.35, -0.95, 0.35, -0.4, 0.2, -0.4], a);
      poly([-0.8, -0.5, 0.8, -0.5, 0.65, 0.75, -0.65, 0.75], shade(c, 0.7));
      poly([-0.8, -0.5, 0.8, -0.5, 0.75, -0.2, -0.75, -0.2], c);
      poly([-0.15, 0.75, 0.15, 0.75, 0.1, 0.98, -0.1, 0.98], a);
      ey = 0.15;
      break;
    case 'bird':
      poly([-0.2, -0.1, -0.98, -0.5, -0.8, 0.2, -0.95, 0.55, -0.2, 0.4], a);
      poly([0.2, -0.1, 0.98, -0.5, 0.8, 0.2, 0.95, 0.55, 0.2, 0.4], shade(a, 0.75));
      disc(0, 0.2, 0.5, c);
      poly([-0.3, -0.35, -0.2, -0.85, 0, -0.45, 0.2, -0.85, 0.3, -0.35], shade(c, 0.8));
      ey = 0.05;
      break;
    case 'plant':
      for (let i = 0; i < 5; i++) {
        const t = -2.8 + i * 0.7;
        const x = Math.cos(t);
        const y = Math.sin(t);
        const q = [x * 0.95 - y * 0.25, y * 0.95 + x * 0.25, x * 0.95, y * 0.95];
        poly(
          [x * 0.2, 0.2 + y * 0.2, ...q, x * 0.95 + y * 0.25, y * 0.95 - x * 0.25],
          i % 2 ? a : shade(a, 1.3),
        );
      }
      poly([-0.12, 0.95, 0.12, 0.95, 0.08, 0.1, -0.08, 0.1], shade(c, 0.6));
      disc(0, 0, 0.45, c);
      break;
    case 'crystal':
      poly([-0.7, 0.9, -0.85, -0.2, -0.45, 0.2], shade(c, 0.7));
      poly([0.7, 0.9, 0.9, -0.3, 0.45, 0.2], shade(c, 0.8));
      poly([-0.5, 0.9, -0.35, -0.95, 0, -0.6, 0.35, -0.95, 0.5, 0.9], c);
      poly([0, -0.6, 0.35, -0.95, 0.5, 0.9, 0, 0.9], shade(c, 0.75));
      poly([-0.25, 0.9, 0, 0.5, 0.25, 0.9], a);
      ey = 0.05;
      break;
    case 'beast':
      poly([-0.75, -0.2, -0.65, -0.95, -0.25, -0.55], a);
      poly([0.75, -0.2, 0.65, -0.95, 0.25, -0.55], a);
      disc(0, 0.1, 0.8, shade(c, 0.75));
      disc(-0.05, 0.05, 0.7, c);
      disc(-0.4, 0.45, 0.18, a);
      disc(0.4, 0.45, 0.18, a);
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
const headSize = (quality: number) => (quality ? 0.24 + 0.035 * quality : 0.46);

/** Standing tower into an s × s(1 + TOWER_H + TALL) canvas: gem-cut stone, plinth, shaft, head. */
function drawTower(
  g: CanvasRenderingContext2D,
  s: number,
  key: string,
  gem: string,
  quality: number,
) {
  const T = s * TALL;
  const [, c, a] = quality ? ['', shade(GEM_COLOR[gem], 0.5), GEM_COLOR[gem]] : MODELS[key];
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
  // Soft contact shadow, then a two-step drum plinth in the accent colour.
  g.fillStyle = 'rgba(0,0,0,0.35)';
  g.beginPath();
  g.ellipse(cx + s * 0.04, foot + s * 0.04, s * 0.4, s * 0.16, 0, 0, 7);
  g.fill();
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
  drum(s * 0.36, foot, s * 0.1, shade(a, 0.8));
  drum(s * 0.26, foot - s * 0.1, s * 0.08, a);
  // Shaft up to the head: a rounded column, lit from the left.
  const top = s * HEAD_Y;
  drum(s * 0.12, foot - s * 0.18, foot - s * 0.18 - top, shade(c, 0.85));
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

// Original creep models: a body archetype + body/accent colours, drawn facing right and lit
// from the top-left like the towers. Every wave creep needs an entry (tests check it).
type Shape = 'hog' | 'blob' | 'bird' | 'fish' | 'wyrm' | 'bot' | 'spook' | 'crab';
const CREEPS: Record<string, [Shape, string, string]> = {
  'frenzied-pig': ['hog', '#e89a9a', '#7a3a3a'],
  'swift-frog': ['blob', '#5ab04a', '#e8e060'],
  'sturdy-yak': ['hog', '#6a4a3a', '#e8e0d0'],
  'smart-robot': ['bot', '#9aa0a8', '#3fb0ff'],
  'baby-panda': ['hog', '#f0f0f0', '#2a2a2a'],
  'balloon-badger': ['hog', '#6a6a70', '#e84a4a'],
  'tardy-stump': ['blob', '#7a5a3a', '#5a9a3a'],
  'satisfied-lizard': ['hog', '#7ab04a', '#e0c040'],
  'invisible-spider': ['crab', '#3a3040', '#c04ae0'],
  dusky: ['bird', '#4a3a6a', '#e0a040'],
  'invincible-dog': ['hog', '#c89050', '#3a2a20'],
  sheep: ['blob', '#f0ece0', '#3a3030'],
  'funny-alpaca': ['hog', '#e8d8b0', '#c06a8a'],
  'pig-princess': ['hog', '#f0a8c0', '#f2c52e'],
  bulldog: ['hog', '#b08050', '#e8e0d0'],
  'cat-dog': ['hog', '#e0a040', '#6a6a70'],
  'bamboo-addict': ['hog', '#e8e8e8', '#2fbf5a'],
  'young-demon': ['spook', '#c03a3a', '#f2c52e'],
  'belted-chicken': ['bird', '#f0ece0', '#e03a3a'],
  bajie: ['hog', '#f0a8b0', '#3a6bff'],
  'exquisite-rabbit': ['hog', '#f4f0f4', '#ff7ad9'],
  'donkey-trio': ['hog', '#8a8a90', '#3a3030'],
  shakbag: ['blob', '#b09060', '#e05a20'],
  ripper: ['bot', '#8a5a3a', '#d8dde6'],
  crab: ['crab', '#e0603a', '#f0d0a0'],
  lockjaw: ['fish', '#4a8a9a', '#f0e0d0'],
  flopjaw: ['fish', '#5a9a4a', '#f0e0d0'],
  trapjaw: ['fish', '#8a5a8a', '#f0e0d0'],
  'mech-donkey': ['bot', '#b08a40', '#555555'],
  machjaw: ['fish', '#7a7a88', '#e0a020'],
  demolisher: ['bot', '#6a5a4a', '#e05a20'],
  corsair: ['spook', '#3a4a6a', '#e0b040'],
  'skateboard-flamingo': ['bird', '#ff8ab0', '#3a3030'],
  'lgd-goldfish': ['fish', '#f0a020', '#fff0c0'],
  jellyfish: ['spook', '#b08ae0', '#ff7ad9'],
  'ig-dragon': ['wyrm', '#e03a3a', '#f2c52e'],
  timbersaw: ['bot', '#8a6a3a', '#d8dde6'],
  'vg-fox': ['hog', '#e07030', '#f0ece0'],
  'parrot-boatman': ['bird', '#2fbf5a', '#e03a3a'],
  'carpet-rider': ['spook', '#8a3ab0', '#f2c52e'],
  bookwyrm: ['wyrm', '#8a5a3a', '#e0d0a0'],
  'otter-dragon': ['wyrm', '#8a6a4a', '#4fa0e0'],
  'rechargeable-shark': ['fish', '#6a8aa8', '#3fb0ff'],
  'ribboned-zombie': ['spook', '#7a9a6a', '#e84a8a'],
  'baby-dp': ['spook', '#3a3a50', '#4fe0d8'],
  'baby-bloody': ['spook', '#8a2020', '#e8e0d0'],
  'bounty-apprentice': ['hog', '#c09040', '#f2c52e'],
  'black-and-white-fox': ['hog', '#f0f0f0', '#2a2a2a'],
  jumo: ['blob', '#6a4ab0', '#f2c52e'],
  baekho: ['hog', '#f0f0f0', '#3a6bff'],
  lilnova: ['spook', '#f2c52e', '#ff7ad9'],
  'mermaid-rider': ['fish', '#3ab0a0', '#ff7ad9'],
  newt: ['hog', '#e08040', '#3a3030'],
  'thrilling-ghost': ['spook', '#d8e0f0', '#4fe0d8'],
  'jade-dragon': ['wyrm', '#2fbf5a', '#e0b040'],
  azuremir: ['wyrm', '#3a6bff', '#e8f4ff'],
  kupu: ['blob', '#e0a0c0', '#3a3030'],
  'furry-fish': ['fish', '#e0c080', '#3a6bff'],
  shroomy: ['blob', '#e03a3a', '#f0ece0'],
  chirpy: ['bird', '#f2c52e', '#e05a20'],
  boooofus: ['spook', '#9a6a4a', '#e8e0d0'],
  'swift-donkey': ['hog', '#9a9098', '#e8e0d0'],
  crummy: ['blob', '#c08a4a', '#6a3a20'],
  wabbit: ['hog', '#e8e0d8', '#ff7ad9'],
  'g1-courier': ['bot', '#3a4a6a', '#f0a030'],
  drodo: ['bird', '#8a8a70', '#e0a040'],
  'baby-roshan': ['hog', '#6a5a4a', '#e05a20'],
};
export const hasCreepModel = (key: string) => key in CREEPS;

/** Draw a creep centred at (m, m), body radius r, facing right. */
function drawCreep(
  g: CanvasRenderingContext2D,
  key: string,
  m: number,
  r: number,
  flying: boolean,
  boss: boolean,
) {
  const [shape, c, a] = CREEPS[key] ?? ['blob', '#e08040', '#3a3030'];
  const P = (x: number, y: number) => [m + x * r, m + y * r] as const;
  // Body part in the towers' flat two-tone: a shadow ellipse with the lit one set up-left.
  const part = (x: number, y: number, rx: number, ry: number, col: string) => {
    g.fillStyle = shade(col, 0.7);
    g.beginPath();
    g.ellipse(...P(x, y), rx * r, ry * r, 0, 0, 7);
    g.fill();
    g.fillStyle = col;
    g.beginPath();
    g.ellipse(...P(x - rx * 0.08, y - ry * 0.1), rx * r * 0.88, ry * r * 0.86, 0, 0, 7);
    g.fill();
  };
  const poly = (pts: number[], col: string) => {
    g.fillStyle = col;
    g.beginPath();
    for (let i = 0; i < pts.length; i += 2) g.lineTo(...P(pts[i], pts[i + 1]));
    g.fill();
  };
  // Same build as the tower eye (dark rim, iris, pupil, glint), in creature colours.
  const eye = (x: number, y: number, k = 1) => {
    const er = r * 0.12 * k;
    const disc = (dx: number, dy: number, rr: number, fill: string) => {
      g.fillStyle = fill;
      g.beginPath();
      g.arc(...(P(x, y).map((v, i) => v + (i ? dy : dx)) as [number, number]), rr, 0, 7);
      g.fill();
    };
    disc(0, 0, er * 1.2, '#1a1410');
    disc(0, 0, er, '#f4efe4');
    disc(er * 0.2, 0, er * 0.6, shade(a, 0.9));
    disc(er * 0.25, 0, er * 0.3, '#0a0808');
    disc(-er * 0.2, -er * 0.35, er * 0.2, '#fff');
  };
  // Inlaid faceted gem in the accent colour, like the gems set into the tower stones.
  const gem = (x: number, y: number, k = 0.16) => gemFacets(g, a, ...P(x, y), r * k);
  const legs = (xs: number[], y: number, len: number, col: string) => {
    g.strokeStyle = col;
    g.lineWidth = Math.max(1, r * 0.14);
    g.lineCap = 'round';
    g.beginPath();
    for (const x of xs) {
      g.moveTo(...P(x, y));
      g.lineTo(...P(x, y + len));
    }
    g.stroke();
  };
  // Flyers without their own wings get a pair of accent wings behind the body.
  if (flying && !['bird', 'wyrm', 'spook'].includes(shape)) {
    part(-0.35, -0.55, 0.45, 0.22, mix(a, '#ffffff', 0.4));
    part(0.05, -0.65, 0.4, 0.2, mix(a, '#ffffff', 0.2));
  }
  switch (shape) {
    case 'hog':
      legs([-0.45, -0.2, 0.2, 0.45], 0.3, 0.45, shade(c, 0.5));
      part(-0.1, 0.15, 0.7, 0.45, c);
      part(0.4, -0.5, 0.1, 0.18, a);
      part(0.55, -0.2, 0.38, 0.35, c);
      part(0.88, -0.08, 0.16, 0.12, mix(c, a, 0.5));
      eye(0.62, -0.28);
      gem(-0.15, 0.05);
      break;
    case 'blob':
      part(0, 0.15, 0.8, 0.65, c);
      part(-0.3, -0.25, 0.14, 0.1, a);
      part(0.05, -0.4, 0.1, 0.08, a);
      eye(0.2, -0.05);
      eye(0.52, -0.02);
      gem(0.35, 0.35, 0.14);
      break;
    case 'bird':
      poly([-0.5, 0, -0.95, -0.2, -0.85, 0.25], shade(a, 0.8));
      legs([-0.1, 0.15], 0.45, 0.35, a);
      part(-0.1, 0.1, 0.55, 0.45, c);
      part(-0.15, 0.1, 0.35, 0.22, shade(c, 0.8));
      part(0.4, -0.38, 0.3, 0.28, c);
      poly([0.62, -0.45, 0.95, -0.32, 0.62, -0.25], a);
      eye(0.48, -0.45);
      gem(0.1, 0.25, 0.13);
      break;
    case 'fish':
      poly([-0.6, 0, -1.05, -0.45, -1.05, 0.45], a);
      poly([-0.2, -0.35, 0.15, -0.75, 0.3, -0.35], shade(c, 0.75));
      part(0, 0, 0.8, 0.48, c);
      g.strokeStyle = shade(c, 0.45);
      g.lineWidth = Math.max(1, r * 0.06);
      g.beginPath();
      g.moveTo(...P(0.8, 0.1));
      g.lineTo(...P(0.45, 0.18));
      g.stroke();
      eye(0.45, -0.12);
      gem(-0.1, 0.05);
      break;
    case 'wyrm':
      poly([-0.2, -0.2, -0.75, -0.95, 0.05, -0.35], mix(a, c, 0.3));
      part(-0.75, 0.35, 0.22, 0.2, c);
      part(-0.4, 0.2, 0.32, 0.28, c);
      part(0.05, 0.05, 0.42, 0.36, c);
      poly([0.45, -0.45, 0.35, -0.9, 0.6, -0.5], a);
      part(0.55, -0.2, 0.36, 0.3, c);
      eye(0.68, -0.28);
      gem(0.05, 0.05, 0.14);
      break;
    case 'bot':
      g.fillStyle = '#222';
      for (const x of [-0.4, 0.4]) {
        g.beginPath();
        g.arc(...P(x, 0.62), r * 0.2, 0, 7);
        g.fill();
      }
      part(0, 0.2, 0.68, 0.45, c);
      part(0.15, -0.4, 0.42, 0.3, shade(c, 1.1));
      poly([0.2, -0.5, 0.55, -0.5, 0.55, -0.32, 0.2, -0.32], a);
      legs([0], -0.95, 0.25, shade(c, 0.6));
      gem(0, -0.95, 0.12);
      gem(-0.1, 0.25);
      break;
    case 'spook':
      g.fillStyle = c;
      g.beginPath();
      g.arc(...P(0, -0.1), r * 0.7, Math.PI, 0);
      for (let i = 0; i <= 6; i++) g.lineTo(...P(0.7 - (i * 1.4) / 6, 0.55 + (i % 2) * 0.25));
      g.fill();
      part(-0.15, -0.3, 0.3, 0.22, mix(c, '#ffffff', 0.25));
      part(0, 0.3, 0.55, 0.12, shade(a, 0.9));
      eye(0.15, -0.15, 1.2);
      eye(0.45, -0.12, 1.2);
      gem(0, 0.3, 0.14);
      break;
    case 'crab':
      g.strokeStyle = shade(c, 0.6);
      g.lineWidth = Math.max(1, r * 0.1);
      g.beginPath();
      for (const s of [-1, 1])
        for (const k of [0, 1, 2]) {
          g.moveTo(...P(s * 0.3, 0.15 + k * 0.1));
          g.lineTo(...P(s * (0.8 + k * 0.1), 0.35 + k * 0.2));
          g.lineTo(...P(s * (0.9 + k * 0.1), 0.7));
        }
      g.stroke();
      part(0, 0.15, 0.7, 0.42, c);
      part(-0.75, -0.25, 0.22, 0.2, a);
      part(0.75, -0.25, 0.22, 0.2, a);
      legs([-0.18, 0.18], -0.55, 0.35, shade(c, 0.7));
      eye(-0.18, -0.55);
      eye(0.18, -0.55);
      gem(0, 0.1);
      break;
  }
  if (boss)
    poly(
      [-0.3, -0.75, -0.3, -1.1, -0.15, -0.9, 0, -1.15, 0.15, -0.9, 0.3, -1.1, 0.3, -0.75],
      '#f2c52e',
    );
  // Rounding wash over the whole creep, as on the tower heads.
  const gl = g.createRadialGradient(...P(-0.4, -0.5), 0, ...P(0, 0), r * 1.2);
  gl.addColorStop(0, 'rgba(255,255,255,0.18)');
  gl.addColorStop(0.6, 'rgba(255,255,255,0)');
  gl.addColorStop(1, 'rgba(0,0,0,0.3)');
  g.globalCompositeOperation = 'source-atop';
  g.fillStyle = gl;
  g.fillRect(0, 0, m * 2, m * 2);
  g.globalCompositeOperation = 'source-over';
}

/** Creep portrait for the panel, as a cached data URL. */
export function creepIcon(name: string) {
  const key = 'creep' + name;
  let url = icons.get(key);
  if (!url) {
    url = bake(96, 96, (g) => drawCreep(g, slug(name), 48, 36, false, false)).toDataURL();
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
  pending: number[] = []; // this round's gems, one of which must be picked to finish it
  guide: string[] | null = null; // maze guide overlay rows
  showPath = true;
  showRanges = true; // every tower's attack range and aura rings; the selected one always shows
  private staticLayer = document.createElement('canvas');
  private blockLayer = document.createElement('canvas'); // stones/towers, drawn over the pedals
  private staticDirty = true;
  private dimKey = ''; // pending cells the block layer was last dimmed for
  // ponytail: one canvas per sprite, not a packed sheet; pack if drawImage switching shows in profiles.
  private sprites = new Map<string, HTMLCanvasElement>();
  private terrainPat: [number, CanvasPattern] | null = null;

  /** Out-of-bounds ground: a repeating tile of dark stone blocks at random heights. */
  private terrain() {
    const s = this.cell;
    if (this.terrainPat?.[0] === s) return this.terrainPat[1];
    const N = 24; // tile size in cells; ponytail: periodic, a bigger N if the repeat shows
    const hash = (c: number, r: number) => {
      const n = Math.sin((((c % N) + N) % N) * 127.1 + (((r % N) + N) % N) * 311.7) * 43758.5;
      return n - Math.floor(n);
    };
    const tile = bake(N * s, N * s, (g) => {
      g.fillStyle = '#141210';
      g.fillRect(0, 0, N * s, N * s);
      // Back to front so each row's tops cover the front faces of the row behind; one row past
      // each edge so faces that cross the seam wrap.
      for (let r = -1; r <= N + 1; r++)
        for (let c = 0; c < N; c++) {
          const v = hash(c, r),
            h = Math.floor(v * 4) * 0.18 * s,
            base = mix('#2a2622', '#4a443c', v);
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

  /** Per-frame shadowBlur is costly on mobile GPUs, so touch devices skip live glows. */
  glow = matchMedia('(pointer: coarse)').matches ? 0 : 1;

  /** Fit the map to the window and recentre. */
  resize() {
    this.dpr = Math.min(devicePixelRatio || 1, 1.5); // phones report 3: 4x the pixels for little visible gain
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
    if (cell !== this.cell) {
      this.cell = cell;
      this.sprites.clear();
      this.staticDirty = true;
    }
  }

  pan(dx: number, dy: number) {
    this.panX += dx * this.dpr;
    this.panY += dy * this.dpr;
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
        const k = this.guide?.[r]?.[c] ?? '.';
        if (k && k !== '.' && maze.cells[maze.idx(c, r)] !== WALL) {
          g.fillStyle = GUIDE_COLOR;
          g.fillRect(c * s, r * s, s - 1, s - 1);
        }
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
        } else
          g.drawImage(this.block(cell === WALL ? '#1c1c24' : '#8a8a8a'), c * s, (r - BLOCK_H) * s);
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

  /** Burn-aura towers with at least one enemy inside, refreshed each sim tick. */
  private burning = new Set<Tower>();

  /** Emit cosmetic hit sparks, splash rings and burn embers (call once per sim tick). */
  sparks() {
    const { combat } = this;
    for (const { from, to } of combat.shots) {
      const a = Math.random() * 7; // cosmetic only, so Math.random is fine
      const y = to.y - (to.def.flying ? FLY_Z : 0);
      const kind = shotKind(combat, from);
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

  /** alpha = fraction of the way from the previous tick to the current one; dt = frame seconds. */
  render(alpha: number, dt: number, now: number) {
    const dimKey = this.pending.join();
    if (dimKey !== this.dimKey) [this.dimKey, this.staticDirty] = [dimKey, true];
    if (this.staticDirty) this.drawStatic();
    const { ctx, cell: s, panX, panY } = this;
    const X = (x: number) => (panX + x * s) | 0;
    const Y = (y: number) => (panY + y * s) | 0;
    const tp = this.terrain();
    tp.setTransform(new DOMMatrix([1, 0, 0, 1, panX | 0, panY | 0]));
    ctx.fillStyle = tp;
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    const fm = Math.ceil(s * 1.5) + FRAME * s;
    ctx.drawImage(this.frame(), (panX - fm) | 0, (panY - fm) | 0);
    ctx.drawImage(this.staticLayer, panX | 0, (panY - Math.ceil(s * (BLOCK_H + TALL))) | 0);

    // Torches: a flickering flame on each pillar and warm light spilling onto the field.
    this.torches().forEach(([tx, ty], i) => {
      const f = 0.95 + 0.05 * Math.sin(now / 260 + i * 1.7) * Math.sin(now / 170 + i),
        cx = X(tx),
        cy = Y(ty) - s * 1.05,
        r = s * 3.2;
      const gl = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
      gl.addColorStop(0, 'rgba(255,170,70,0.32)');
      gl.addColorStop(1, 'rgba(255,140,40,0)');
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = gl;
      ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = '#ff8a2a';
      ctx.beginPath();
      ctx.ellipse(cx, cy - s * 0.18 * f, s * 0.17, s * 0.3 * f, 0, 0, 7);
      ctx.fill();
      ctx.fillStyle = '#ffe08a';
      ctx.beginPath();
      ctx.ellipse(cx, cy - s * 0.1 * f, s * 0.08, s * 0.16 * f, 0, 0, 7);
      ctx.fill();
    });

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

    // Combinable towers: a soft pulsing aura over the tower body.
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const aura = 0.35 + 0.2 * Math.sin(now / 300);
    for (const h of this.hints) {
      const cx = X((h % this.maze.w) + 0.5),
        cy = Y(((h / this.maze.w) | 0) + 0.5 - (TOWER_H + TALL) / 2),
        rad = s * 0.85;
      const gr = ctx.createRadialGradient(cx, cy, 0, cx, cy, rad);
      gr.addColorStop(0, `rgba(170,255,240,${aura})`);
      gr.addColorStop(1, 'rgba(170,255,240,0)');
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

    // Tracers by shot kind: thin white, icy blue (slow), thick silver beam, forked lightning.
    const head = (t: Tower) => [X(t.c + 0.5), Y(t.r + 0.48 - TOWER_H - TALL)] as const;
    const hit = (cr: Creep) => [X(cr.x), Y(cr.y - (cr.def.flying ? FLY_Z : 0.15))] as const;
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
      if (!t.aura.calm) continue;
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
