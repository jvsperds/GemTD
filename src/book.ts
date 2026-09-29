// Side book: recipe list and maze helpers (built-in guides + the player's saved maze library).
import map from '../data/map.json';
import { GUIDES } from './guide';
import * as db from './persist';
import { towerIcon } from './render';
import { Maze, OPEN, ROCK, type MapData } from './sim/maze';
import { PEDAL_TIPS } from './sim/pedals';
import { DEFS } from './sim/setup';
import { codeOf, type GemDef, type SpecialDef, type Tower } from './sim/towers';

export interface Guide {
  name: string;
  rows: string[];
  lib?: boolean; // from the player's library (deletable)
}

/** Current rocks as guide rows ('1' = stone). */
export const mazeRows = (m: Maze) =>
  Array.from({ length: m.h }, (_, r) =>
    Array.from({ length: m.w }, (_, c) => (m.cells[m.idx(c, r)] === ROCK ? '1' : '.')).join(''),
  );

/** Lay out a guide (full layout: '.' clears preset stones) on a fresh map and measure it. */
export function evaluate(rows: string[], m = new Maze(map as unknown as MapData)) {
  rows.forEach((row, r) =>
    [...row].forEach((ch, c) => {
      if (!m.noBuild[m.idx(c, r)]) m.cells[m.idx(c, r)] = ch === '.' ? OPEN : ROCK;
    }),
  );
  return measure(m);
}

export function measure(m: Maze) {
  const route = m.route();
  let stones = 0;
  for (const v of m.cells) if (v === ROCK) stones++;
  if (!route) return { valid: false, stones, legs: [] as number[], length: 0, passes: 0 };
  const legs = m.segmentLengths(route).map(Math.round);
  return {
    valid: true,
    stones,
    legs,
    length: legs.reduce((a, b) => a + b),
    passes: m.middlePasses(route),
  };
}

const el = (tag: string, cls = '', text = '') => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  e.textContent = text;
  return e;
};

function thumb(rows: string[]) {
  const c = document.createElement('canvas');
  c.width = c.height = 74;
  const g = c.getContext('2d')!;
  g.fillStyle = '#1a2a1a';
  g.fillRect(0, 0, 74, 74);
  g.fillStyle = '#d8d0bc';
  rows.forEach((row, r) =>
    [...row].forEach((ch, x) => ch !== '.' && g.fillRect(x * 2, r * 2, 2, 2)),
  );
  return c;
}

export function initBook(opts: {
  towers: () => Tower[];
  selected: () => Tower | null;
  tip?: (d: SpecialDef) => string;
  guide: () => Guide | null;
  showGuide: (g: Guide | null) => void;
  build?: (g: Guide) => void; // maze builder only: load a guide as stones
  map?: MapData; // the game's layout, for measuring guides
}) {
  const book = document.querySelector<HTMLElement>('#book')!;
  const body = document.querySelector<HTMLElement>('#bookbody')!;
  const tabs = [...book.querySelectorAll<HTMLButtonElement>('[data-book]')];
  let tab = 'recipes';
  let library: Guide[] = [];
  const stats = new Map<string[], ReturnType<typeof evaluate>>();
  const guides = (): Guide[] => [...GUIDES, ...library];

  const loadLibrary = async () => {
    library = (await db.get('mazes')).map((m) => ({ name: m.name, rows: m.rows, lib: true }));
  };

  function recipes(pedals = false) {
    const sel = opts.selected();
    const mine = sel && codeOf(sel.def);
    const owned = new Set(opts.towers().map((t) => codeOf(t.def)));
    const all = (Object.values(DEFS) as (GemDef & Partial<SpecialDef>)[]).filter(
      (d) =>
        d.recipes?.length &&
        !d.pedal === !pedals &&
        (!mine || d.recipes.some((r) => r.includes(mine))),
    );
    const what = pedals ? 'pedal' : 'tower';
    body.append(
      el('p', 'note', sel ? `${what} recipes using ${sel.def.name}` : `All ${what} recipes`),
    );
    if (pedals)
      body.append(
        el(
          'p',
          'note',
          'Pedals cast a spell on creeps that come near. 3× same → Sparkling → 3× → Blingbling.',
        ),
      );
    for (const d of all) {
      const r = (mine && d.recipes!.find((x) => x.includes(mine))) || d.recipes![0];
      const row = el('div', 'recipe');
      row.title = opts.tip?.(d as SpecialDef) ?? '';
      const im = document.createElement('img');
      im.src = towerIcon({ ...d, type: 'S', quality: 0 });
      im.alt = '';
      row.append(im);
      const text = el('div');
      text.append(el('b', '', d.name + (r.every((p) => owned.has(p)) ? ' ✓' : '')));
      const parts = el('div', 'parts');
      if (r.length > 1 && r.every((p) => p === r[0]))
        parts.append(el('span', owned.has(r[0]) ? 'own' : '', `${r.length}× ${r[0]}`));
      else
        r.forEach((p, i) =>
          parts.append(el('span', owned.has(p) ? 'own' : '', (i ? ' + ' : '') + p)),
        );
      text.append(parts);
      const tip = d.pedal && PEDAL_TIPS.get(d.abilities[0])?.tip;
      if (tip) text.append(el('div', 'parts', tip));
      row.append(text);
      body.append(row);
    }
  }

  function mazes() {
    const shown = opts.guide();
    body.append(el('p', 'note', 'Legs = route legs (of 6) that cross the middle.'));
    for (const g of guides()) {
      let st = stats.get(g.rows);
      if (!st) stats.set(g.rows, (st = evaluate(g.rows, opts.map && new Maze(opts.map))));
      const row = el('div', 'maze' + (shown?.rows === g.rows ? ' on' : ''));
      row.append(thumb(g.rows));
      const text = el('div');
      text.append(el('b', '', g.name));
      text.append(
        el(
          'div',
          'parts',
          st.valid
            ? `${st.stones} stones · path ${st.length} · ${st.passes}/6 legs`
            : `${st.stones} stones · blocks the route`,
        ),
      );
      const btns = el('div', 'btns');
      const show = el('button', '', shown?.rows === g.rows ? 'Hide' : 'Show');
      show.onclick = () => (opts.showGuide(shown?.rows === g.rows ? null : g), draw());
      btns.append(show);
      if (opts.build) {
        const b = el('button', '', 'Build');
        b.onclick = () => opts.build!(g);
        btns.append(b);
      }
      if (g.lib) {
        const del = el('button', '', 'Delete');
        del.onclick = async () => {
          if (!confirm(`Delete "${g.name}" from your library?`)) return;
          await db.set(
            'mazes',
            (await db.get('mazes')).filter(
              (m) => !(m.name === g.name && m.rows.join() === g.rows.join()),
            ),
          );
          await loadLibrary();
          draw();
        };
        btns.append(del);
      }
      text.append(btns);
      row.append(text);
      body.append(row);
    }
  }

  function draw() {
    if (book.hidden) return;
    for (const b of tabs) b.classList.toggle('on', b.dataset.book === tab);
    body.replaceChildren();
    if (tab === 'recipes') recipes();
    else if (tab === 'pedals') recipes(true);
    else mazes();
  }
  for (const b of tabs) b.onclick = () => ((tab = b.dataset.book!), draw());
  loadLibrary().then(draw);

  return {
    guides,
    draw,
    toggle() {
      book.hidden = !book.hidden;
      draw();
    },
    get open() {
      return !book.hidden;
    },
    /** Save rows to the library under a prompted name. */
    async save(rows: string[]) {
      const name = prompt('Name this maze', `Maze ${new Date().toLocaleDateString()}`)?.trim();
      if (!name) return false;
      const all = await db.get('mazes');
      all.push({ name: name.slice(0, 40), rows, date: Date.now() });
      await db.set('mazes', all);
      await loadLibrary();
      tab = 'mazes';
      draw();
      return true;
    },
  };
}
