// Original skill icons drawn on a canvas: one simple glyph per ability family, lit from the
// top-left like the tower models. Cached as data URLs for the panel's ability cards.
type Kind =
  | 'fire'
  | 'frost'
  | 'poison'
  | 'cleave'
  | 'crit'
  | 'bolt'
  | 'aura'
  | 'pierce'
  | 'speed'
  | 'split'
  | 'stun'
  | 'sight'
  | 'range'
  | 'aim'
  | 'calm'
  | 'disarm'
  | 'star';

// Ability id → family (ids come from the Dota custom game's data; status_* are tower statuses).
const KINDS: [RegExp, Kind][] = [
  // Creep abilities and statuses first: their ids overlap the tower patterns below.
  [/invisibility|shanbi|shanshuo|runrunrun|status_rush/, 'speed'],
  [/jiaoxie|bukeqinfan/, 'disarm'],
  [/momian|wumian|armor|kraken|zheguang|status_shield/, 'calm'],
  [/recharge/, 'aura'],
  [/xietong|status_slow/, 'frost'],
  [/status_poison/, 'poison'],
  [/status_stun/, 'stun'],
  [/status_amp|status_armor/, 'pierce'],
  [/^status_range/, 'range'],
  [/^status_aim/, 'aim'],
  [/^status_calm/, 'calm'],
  [/^status_disarm/, 'disarm'],
  [/huiyao/, 'fire'],
  [/slow|lanbaoshi|jihan/, 'frost'],
  [/du/, 'poison'],
  [/jianshe/, 'cleave'],
  [/baoji|crit/, 'crit'],
  [/shandian/, 'bolt'],
  [/aura|guanghuan|maoyan|jingzhun|tanlan/, 'aura'],
  [/jianjia|jin|bixi|zheyi/, 'pierce'],
  [/speed/, 'speed'],
  [/fenlie/, 'split'],
  [/yun|shihua/, 'stun'],
  [/sight/, 'sight'],
];
export const skillKind = (id: string): Kind => KINDS.find(([re]) => re.test(id))?.[1] ?? 'star';

const S = 64;
const cache = new Map<string, string>();

/** Icon for an ability id as a data URL (transparent background). */
export function skillIcon(id: string) {
  const kind = skillKind(id);
  let url = cache.get(kind);
  if (url) return url;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d')!;
  const poly = (pts: number[], fill: string) => {
    g.fillStyle = fill;
    g.beginPath();
    for (let i = 0; i < pts.length; i += 2) g.lineTo(pts[i] * S, pts[i + 1] * S);
    g.fill();
  };
  const disc = (x: number, y: number, r: number, fill: string) => {
    g.fillStyle = fill;
    g.beginPath();
    g.arc(x * S, y * S, r * S, 0, 7);
    g.fill();
  };
  const stroke = (w: number, col: string, draw: () => void) => {
    g.strokeStyle = col;
    g.lineWidth = w * S;
    g.lineCap = g.lineJoin = 'round';
    g.beginPath();
    draw();
    g.stroke();
  };
  const L = (x: number, y: number) => g.lineTo(x * S, y * S);
  g.shadowColor = '#000a';
  g.shadowBlur = S / 16;
  switch (kind) {
    case 'fire':
      poly(
        [0.5, 0.08, 0.78, 0.45, 0.72, 0.8, 0.5, 0.92, 0.28, 0.8, 0.22, 0.5, 0.36, 0.3, 0.4, 0.5],
        '#f06a1e',
      );
      poly([0.5, 0.38, 0.64, 0.6, 0.6, 0.82, 0.5, 0.88, 0.4, 0.82, 0.38, 0.62], '#ffd24a');
      break;
    case 'frost':
      for (let i = 0; i < 3; i++) {
        const a = (i * Math.PI) / 3;
        const dx = Math.cos(a) * 0.38,
          dy = Math.sin(a) * 0.38;
        stroke(0.07, '#bfe6ff', () => {
          L(0.5 - dx, 0.5 - dy);
          L(0.5 + dx, 0.5 + dy);
        });
        for (const k of [-1, 1]) {
          const ex = 0.5 + dx * 0.6 * k,
            ey = 0.5 + dy * 0.6 * k,
            b = a + (k > 0 ? Math.PI : 0);
          stroke(0.05, '#bfe6ff', () => {
            L(ex + Math.cos(b + 0.6) * 0.12, ey + Math.sin(b + 0.6) * 0.12);
            L(ex, ey);
            L(ex + Math.cos(b - 0.6) * 0.12, ey + Math.sin(b - 0.6) * 0.12);
          });
        }
      }
      break;
    case 'poison':
      poly([0.5, 0.1, 0.74, 0.52, 0.74, 0.66, 0.26, 0.66, 0.26, 0.52], '#4fbf3a');
      disc(0.5, 0.64, 0.24, '#4fbf3a');
      disc(0.42, 0.6, 0.07, '#b8f59a');
      disc(0.78, 0.22, 0.06, '#4fbf3a');
      break;
    case 'cleave':
      // Axe head with an arc-shaped swing trail.
      stroke(0.07, '#8a5a3a', () => {
        L(0.3, 0.88);
        L(0.62, 0.3);
      });
      poly([0.52, 0.16, 0.86, 0.3, 0.8, 0.56, 0.62, 0.42], '#d8dde6');
      stroke(0.04, '#ffffffaa', () => g.arc(0.5 * S, 0.55 * S, 0.34 * S, 3.6, 5.2));
      break;
    case 'crit':
      poly(
        [0.5, 0.06, 0.6, 0.4, 0.94, 0.5, 0.6, 0.6, 0.5, 0.94, 0.4, 0.6, 0.06, 0.5, 0.4, 0.4],
        '#f2c52e',
      );
      disc(0.5, 0.5, 0.1, '#fff6c8');
      break;
    case 'bolt':
      poly([0.58, 0.06, 0.24, 0.54, 0.46, 0.54, 0.36, 0.94, 0.76, 0.42, 0.54, 0.42], '#9fd8ff');
      break;
    case 'aura':
      for (const [r, a] of [
        [0.4, '55'],
        [0.28, '99'],
      ] as const)
        stroke(0.05, '#f2c52e' + a, () => g.arc(0.5 * S, 0.5 * S, r * S, 0, 7));
      disc(0.5, 0.5, 0.14, '#f2c52e');
      break;
    case 'pierce':
      // Arrow punching through a broken shield.
      poly([0.2, 0.2, 0.62, 0.2, 0.62, 0.52, 0.41, 0.8, 0.2, 0.52], '#8a93a6');
      stroke(0.06, '#e8e0d0', () => {
        L(0.1, 0.9);
        L(0.82, 0.18);
      });
      poly([0.92, 0.08, 0.7, 0.14, 0.86, 0.3], '#e8e0d0');
      break;
    case 'speed':
      for (const x of [0.18, 0.46])
        poly([x, 0.22, x + 0.34, 0.5, x, 0.78, x + 0.1, 0.5], '#6fe0c8');
      break;
    case 'split':
      for (const a of [-0.45, 0, 0.45])
        stroke(0.05, '#e8e0d0', () => {
          L(0.2, 0.8);
          L(0.2 + Math.cos(a - 0.785) * 0.62, 0.8 + Math.sin(a - 0.785) * 0.62);
        });
      break;
    case 'stun':
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * 6.283 - 1.57;
        poly(
          [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].flatMap((k) => {
            const t = (k / 10) * 6.283 - 1.57,
              r = k % 2 ? 0.05 : 0.12;
            return [
              0.5 + Math.cos(a) * 0.26 + Math.cos(t) * r,
              0.5 + Math.sin(a) * 0.26 + Math.sin(t) * r,
            ];
          }),
          '#ffe066',
        );
      }
      break;
    case 'sight':
      poly([0.08, 0.5, 0.3, 0.3, 0.7, 0.3, 0.92, 0.5, 0.7, 0.7, 0.3, 0.7], '#f7f2e0');
      disc(0.5, 0.5, 0.16, '#3a8aff');
      disc(0.5, 0.5, 0.07, '#0a0808');
      break;
    case 'range':
      // Arrows pushing outward from a centre dot.
      disc(0.5, 0.5, 0.08, '#8fdc6a');
      for (let i = 0; i < 4; i++) {
        const a = (i * Math.PI) / 2,
          c = Math.cos(a),
          n = Math.sin(a);
        stroke(0.06, '#8fdc6a', () => {
          L(0.5 + c * 0.18, 0.5 + n * 0.18);
          L(0.5 + c * 0.4, 0.5 + n * 0.4);
        });
        poly(
          [
            0.5 + c * 0.46,
            0.5 + n * 0.46,
            0.5 + c * 0.34 - n * 0.1,
            0.5 + n * 0.34 + c * 0.1,
            0.5 + c * 0.34 + n * 0.1,
            0.5 + n * 0.34 - c * 0.1,
          ],
          '#8fdc6a',
        );
      }
      break;
    case 'aim':
      stroke(0.05, '#ff6a5a', () => g.arc(0.5 * S, 0.5 * S, 0.3 * S, 0, 7));
      stroke(0.05, '#ff6a5a', () => {
        L(0.5, 0.08);
        L(0.5, 0.32);
        g.moveTo(0.5 * S, 0.68 * S);
        L(0.5, 0.92);
        g.moveTo(0.08 * S, 0.5 * S);
        L(0.32, 0.5);
        g.moveTo(0.68 * S, 0.5 * S);
        L(0.92, 0.5);
      });
      disc(0.5, 0.5, 0.07, '#ff6a5a');
      break;
    case 'calm':
      // Shield with a lit left half.
      poly([0.5, 0.1, 0.84, 0.22, 0.8, 0.56, 0.5, 0.92, 0.2, 0.56, 0.16, 0.22], '#6fa8ff');
      poly([0.5, 0.1, 0.16, 0.22, 0.2, 0.56, 0.5, 0.92], '#a8ccff');
      break;
    case 'disarm':
      // Sword crossed out by a chain link bar.
      stroke(0.07, '#d8dde6', () => {
        L(0.25, 0.75);
        L(0.72, 0.28);
      });
      stroke(0.06, '#8a5a3a', () => {
        L(0.18, 0.62);
        L(0.38, 0.82);
      });
      stroke(0.08, '#c06aff', () => {
        L(0.2, 0.2);
        L(0.8, 0.8);
      });
      break;
    default:
      poly(
        [0.5, 0.1, 0.62, 0.4, 0.9, 0.5, 0.62, 0.6, 0.5, 0.9, 0.38, 0.6, 0.1, 0.5, 0.38, 0.4],
        '#ff7ad9',
      );
  }
  url = c.toDataURL();
  cache.set(kind, url);
  return url;
}
