// Canvas 2D renderer, CPU-first 2.5D (BUILD.md §3.7). Reads sim state only, never mutates it.
// Static layer (ground, route, blocks) is an offscreen canvas redrawn only on maze/zoom change;
// the dynamic layer (creeps, tracers, particles) is redrawn every frame from baked sprites.
import { ROCK, WALL, type Maze } from './sim/maze';
import type { Combat, Tower } from './sim/towers';
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
const TALL = 0.55;
const TOWER_H = 0.2; // front-face height of a tower's own (lower) base, in cells // how far modelled towers rise above their block, in cells
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
type Body = 'orb' | 'pillar' | 'house' | 'mech' | 'bird' | 'plant' | 'crystal' | 'beast';
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
  'deep-sea-pearl': ['plant', '#d8c830', '#e8e8e8', 'y'],
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
  'yaphets-stone': ['bird', '#f0f0e0', '#e0b040', 'y'],
  'burning-stone': ['crystal', '#3a4a6a', '#4fa0e0', 'b'],
  'the-great-stone': ['pillar', '#6a6a6a', '#8fbf3a', 'y'],
};
export const hasModel = (key: string) => key in MODELS;

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
  // table, small inlaid gems at the corners and studs along the front face.
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
  for (const [x, y] of [
    [q / 2, q / 2],
    [s - q / 2, q / 2],
    [q / 2, s - q / 2],
    [s - q / 2, s - q / 2],
  ])
    gemFacets(g, a, x, T + y, s * 0.08);
  for (let i = 1; i <= 3; i++)
    gemFacets(g, a, (i * s) / 4, T + s * (1 + TOWER_H / 2), s * TOWER_H * 0.35);
  const cx = s / 2,
    foot = T + s * 0.62,
    head = s * (quality ? 0.24 + 0.035 * quality : 0.46);
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
  const top = s * 0.48;
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

export class Renderer {
  cell = 0; // px per cell at current zoom
  zoom = 1;
  panX = 0;
  panY = 0;
  flash = -1; // refused cell index
  flashUntil = 0;
  selected = -1; // selected cell index
  hints: number[] = []; // cells of towers that can combine now
  guide: string[] | null = null; // maze guide overlay rows
  showPath = true;
  showRanges = true; // aura range rings (Volcano, Asteriated Ruby...)
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
    const top = Math.ceil(s * (BLOCK_H + TALL));
    const L = this.staticLayer;
    L.width = maze.w * s;
    L.height = maze.h * s + top;
    const g = L.getContext('2d')!;
    g.translate(0, top);
    for (let r = 0; r < maze.h; r++)
      for (let c = 0; c < maze.w; c++) {
        g.fillStyle = maze.noBuild[maze.idx(c, r)] ? '#2a2a2a' : '#3b4a3b';
        g.fillRect(c * s, r * s, s - 1, s - 1);
        const k = this.guide?.[r]?.[c] ?? '.';
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
        if (t)
          // The tower's base sits on its cell; plain stones stand taller.
          g.drawImage(
            this.tower(towerKey(t.def), t.def.type, t.def.quality),
            c * s,
            (r - TOWER_H - TALL) * s,
          );
        else
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
      if (combat.fx(from.def).cleave) this.burst(to.x, y, 8, 4, 1);
    }
    // Burn auras only show where they are actually hurting someone: embers on each enemy inside.
    this.burning.clear();
    for (const t of combat.towers)
      for (const e of combat.fx(t.def).enemy) {
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
      if (t.disarmT > 0 && Math.random() < 0.5)
        this.emit(t.c + 0.2 + Math.random() * 0.6, t.r - TALL, 0, -0.8, 0.8, 5);
  }

  /** alpha = fraction of the way from the previous tick to the current one; dt = frame seconds. */
  render(alpha: number, dt: number, now: number) {
    if (this.staticDirty) this.drawStatic();
    const { ctx, cell: s, panX, panY } = this;
    const X = (x: number) => (panX + x * s) | 0;
    const Y = (y: number) => (panY + y * s) | 0;
    ctx.fillStyle = '#111';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.drawImage(this.staticLayer, panX | 0, (panY - Math.ceil(s * (BLOCK_H + TALL))) | 0);

    if (this.flash >= 0 && now < this.flashUntil) {
      ctx.fillStyle = 'rgba(220,50,50,0.6)';
      ctx.fillRect(X(this.flash % this.maze.w), Y((this.flash / this.maze.w) | 0), s, s);
    }

    // Burn auras (Volcano, Asteriated Ruby...): a pulsing heat ring while an enemy is inside.
    const pulse = 0.3 + 0.12 * Math.sin(now / 250);
    if (this.showRanges)
      for (const t of this.burning)
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
        Y(((h / this.maze.w) | 0) - TOWER_H) + 2,
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

    // Tracers by shot kind: thin white, icy blue (slow), thick silver beam, forked lightning.
    const head = (t: Tower) => [X(t.c + 0.5), Y(t.r + 0.48 - TOWER_H - TALL)] as const;
    const hit = (cr: Creep) => [X(cr.x), Y(cr.y - (cr.def.flying ? FLY_Z : 0.15))] as const;
    for (const [kind, colour, width, glow] of TRACERS) {
      ctx.strokeStyle = colour;
      ctx.lineWidth = Math.max(1, width * s);
      ctx.shadowColor = glow;
      ctx.shadowBlur = glow === 'transparent' ? 0 : s / 2;
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
  const f = combat.fx(t.def);
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
const expand = (c: string) => '#' + [...c.slice(1)].map((h) => h + h).join('');
