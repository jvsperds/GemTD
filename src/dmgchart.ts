// Right-edge damage chart: towers ranked by magic, physical or total damage dealt this game.
// Pinned, it stays open (remembered); unpinned, it closes on the next map click.
import { GEM_COLOR, towerIcon } from './render';
import type { Tower } from './sim/towers';

type Kind = 'magic' | 'physical' | 'total';
const amount = (t: Tower, k: Kind) =>
  k === 'magic' ? t.magicDealt : k === 'physical' ? t.damageDealt - t.magicDealt : t.damageDealt;
const SUFFIX = ['', 'k', 'M', 'B', 'T', 'Qa', 'Qi', 'Sx', 'Sp', 'Oc', 'No', 'Dc'];
/** Compact number for long endless runs: 1234 → 1.2k, 7.4e11 → 739.6B, past Dc → 1.2e36. */
export function short(n: number) {
  const k = n < 1e3 ? 0 : Math.floor(Math.log10(n) / 3);
  if (k >= SUFFIX.length) return n.toExponential(1).replace('+', '');
  if (!k) return String(Math.round(n));
  // Rounding can carry into the next unit (999.96k → 1000.0k): step up instead.
  const v = n / 1e3 ** k;
  return v >= 999.95 && k + 1 < SUFFIX.length
    ? `1.0${SUFFIX[k + 1]}`
    : `${v.toFixed(1)}${SUFFIX[k]}`;
}

export function initDmgChart(towers: () => Tower[], canvas: HTMLCanvasElement) {
  const $ = (id: string) => document.getElementById(id)!;
  const panel = $('dmg'),
    list = $('dmglist'),
    pin = $('dmgpin'),
    tabs = [...panel.querySelectorAll<HTMLButtonElement>('[data-kind]')];
  let kind: Kind = 'total',
    pinned = false;
  try {
    pinned = localStorage.getItem('gemtd.dmgpin') === '1';
  } catch {
    /* storage blocked: start unpinned */
  }
  const setOpen = (open: boolean) => {
    panel.hidden = !open;
    $('dmgtab').classList.toggle('on', open);
    if (open) draw();
    try {
      localStorage.setItem('gemtd.dmgopen', open ? '1' : '0');
    } catch {
      /* per-viewer convenience only */
    }
  };
  const setPin = (p: boolean) => {
    pinned = p;
    pin.classList.toggle('on', p);
    pin.title = p ? 'Unpin (closes on map click)' : 'Pin open';
    try {
      localStorage.setItem('gemtd.dmgpin', p ? '1' : '0');
    } catch {
      /* per-viewer convenience only */
    }
  };
  function draw() {
    if (panel.hidden) return;
    const rows = towers()
      .map((t) => [t, amount(t, kind)] as const)
      .filter(([, n]) => n > 0)
      .sort((a, b) => b[1] - a[1]);
    const top = rows[0]?.[1] || 1,
      sum = rows.reduce((s, [, n]) => s + n, 0) || 1;
    list.replaceChildren(
      ...rows.map(([t, n]) => {
        const row = document.createElement('div');
        row.className = 'dmgrow';
        const colour = GEM_COLOR[t.def.quality ? t.def.type : 'S'];
        const url = towerIcon(t.def);
        const icon = document.createElement(url ? 'img' : 'span');
        if (url) (icon as HTMLImageElement).src = url;
        else icon.textContent = '◆';
        icon.style.color = colour;
        const name = document.createElement('span');
        name.textContent = t.def.name;
        const val = document.createElement('b');
        val.textContent = `${short(n)} · ${Math.round((n / sum) * 100)}%`;
        const bar = document.createElement('i');
        bar.style.width = `${(n / top) * 100}%`;
        bar.style.background = colour;
        row.append(bar, icon, name, val);
        row.title = `${t.def.name}: ${n.toLocaleString(undefined, { maximumFractionDigits: 0 })} ${kind} damage`;
        return row;
      }),
    );
    if (!rows.length) list.textContent = 'No damage yet';
  }
  for (const b of tabs)
    b.onclick = () => {
      kind = b.dataset.kind as Kind;
      for (const o of tabs) o.classList.toggle('on', o === b);
      draw();
    };
  $('dmgtab').onclick = () => setOpen(panel.hidden === true);
  pin.onclick = () => setPin(!pinned);
  canvas.addEventListener('click', () => !pinned && setOpen(false));
  setPin(pinned);
  let wasOpen = pinned;
  try {
    wasOpen ||= localStorage.getItem('gemtd.dmgopen') === '1';
  } catch {
    /* storage blocked */
  }
  setOpen(wasOpen);
  setInterval(draw, 500);
}
