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

/** Board glow for pinned recipes: their ingredients on the board, split by whether the recipe
 * can be built right now. */
export function pinGlow(
  pins: Iterable<string>,
  towers: Tower[],
  recipesFor: (t: Tower) => { name: string; parts: Tower[] }[],
) {
  const pinned = new Set(pins);
  const ready = new Set<Tower>();
  for (const t of towers)
    for (const x of recipesFor(t)) if (pinned.has(x.name)) x.parts.forEach((p) => ready.add(p));
  const want = new Set(
    [...pinned].flatMap((p) => (DEFS[p] as Partial<SpecialDef> | undefined)?.recipes?.[0] ?? []),
  );
  return {
    ready: [...ready],
    working: towers.filter((t) => !ready.has(t) && want.has(codeOf(t.def))),
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
  let recipeSearch = '';
  let recipeFocus: string | null = null;
  let library: Guide[] = [];
  const stats = new Map<string[], ReturnType<typeof evaluate>>();
  const guides = (): Guide[] => [...GUIDES, ...library];
  // Pinned recipe codes, per browser: their ingredients glow on the board.
  const pins = new Set<string>();
  try {
    for (const p of JSON.parse(localStorage.getItem('gemtd.pins') ?? '[]')) pins.add(p);
  } catch {
    /* storage blocked or garbled: start with no pins */
  }
  const togglePin = (code: string) => {
    if (!pins.delete(code)) pins.add(code);
    try {
      localStorage.setItem('gemtd.pins', JSON.stringify([...pins]));
    } catch {
      /* storage blocked: pins last until reload */
    }
    draw();
  };

  const loadLibrary = async () => {
    library = (await db.get('mazes')).map((m) => ({ name: m.name, rows: m.rows, lib: true }));
  };

  function recipes(pedals = false) {
    const sel = opts.selected();
    const mine = sel && codeOf(sel.def);
    const have = new Map<string, number>();
    for (const t of opts.towers()) have.set(codeOf(t.def), (have.get(codeOf(t.def)) ?? 0) + 1);
    const n = (p: string) => have.get(p) ?? 0;
    const all = (Object.values(DEFS) as (GemDef & Partial<SpecialDef>)[]).filter(
      (d) =>
        d.recipes?.length &&
        !d.pedal === !pedals &&
        (!recipeFocus || codeOf(d) === recipeFocus) &&
        // Searching is global: it should still find a recipe when a tower is selected on the board.
        (recipeSearch || !mine || d.recipes.some((r) => r.includes(mine))) &&
        (!recipeSearch ||
          [d.name, ...d.recipes.flat()].some((value) =>
            value.toLocaleLowerCase().includes(recipeSearch.toLocaleLowerCase()),
          )),
    );
    const what = pedals ? 'pedal' : 'tower';
    if (!pedals) {
      const search = document.createElement('input');
      search.className = 'recipe-search';
      search.type = 'search';
      search.placeholder = 'Search recipes or components';
      search.value = recipeSearch;
      search.setAttribute('aria-label', 'Search recipes or components');
      search.oninput = () => {
        const cursor = search.selectionStart ?? search.value.length;
        recipeSearch = search.value.trim();
        recipeFocus = null;
        draw();
        const next = body.querySelector<HTMLInputElement>('.recipe-search');
        next?.focus();
        next?.setSelectionRange(cursor, cursor);
      };
      body.append(search);
    }
    const focus = recipeFocus && DEFS[recipeFocus];
    const note = focus
      ? `Recipe for ${focus.name}`
      : recipeSearch
        ? `Recipes matching “${recipeSearch}”`
        : sel
          ? `${what} recipes using ${sel.def.name}`
          : `All ${what} recipes`;
    body.append(el('p', 'note', note));
    if (focus) {
      const clear = el('button', 'recipe-clear', 'Show all recipes');
      clear.onclick = () => {
        recipeFocus = null;
        draw();
      };
      body.append(clear);
    }
    if (pedals)
      body.append(
        el(
          'p',
          'note',
          'Pedals cast a spell on creeps that come near. 3× same → Sparkling → 3× → Blingbling.',
        ),
      );
    const pinned = (d: GemDef) => pins.has(codeOf(d));
    all.sort((a, b) => +pinned(b) - +pinned(a)); // pinned first, otherwise data order
    for (const d of all) {
      const r = (mine && d.recipes!.find((x) => x.includes(mine))) || d.recipes![0];
      const row = el('div', 'recipe' + (pinned(d) ? ' on' : ''));
      row.title = opts.tip?.(d as SpecialDef) ?? '';
      const im = document.createElement('img');
      im.src = towerIcon(d);
      im.alt = '';
      row.append(im);
      const text = el('div');
      const need = (p: string) => r.filter((x) => x === p).length;
      const name = el(
        'button',
        'recipe-name',
        d.name + (r.every((p) => n(p) >= need(p)) ? ' ✓' : ''),
      );
      name.title = `Show recipe for ${d.name}`;
      name.onclick = () => {
        recipeFocus = codeOf(d);
        recipeSearch = '';
        draw();
      };
      text.append(name);
      const parts = el('div', 'parts');
      if (r.length > 1 && r.every((p) => p === r[0]))
        parts.append(
          el('span', n(r[0]) >= r.length ? 'own' : '', `${r.length}× ${r[0]} (${n(r[0])})`),
        );
      else
        r.forEach((p, i) => {
          const part = el('span', n(p) >= need(p) ? 'own' : '', `${i ? ' + ' : ''}`);
          const ingredient = DEFS[p];
          if (ingredient && !ingredient.quality) {
            const link = el('button', 'recipe-part', `${p} (${n(p)})`);
            link.title = `Show recipe for ${ingredient.name}`;
            link.onclick = () => {
              recipeFocus = p;
              recipeSearch = '';
              draw();
            };
            part.append(link);
          } else part.append(`${p} (${n(p)})`);
          parts.append(part);
        });
      text.append(parts);
      const tip = d.pedal && PEDAL_TIPS.get(d.abilities[0])?.tip;
      if (tip) text.append(el('div', 'parts', tip));
      row.append(text);
      const pin = el('button', 'pin', '📌');
      pin.title = pinned(d) ? 'Unpin' : 'Pin: its ingredients glow on the board';
      pin.setAttribute('aria-label', `${pinned(d) ? 'Unpin' : 'Pin'} ${d.name}`);
      pin.setAttribute('aria-pressed', String(pinned(d)));
      pin.onclick = () => togglePin(codeOf(d));
      row.append(pin);
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
  for (const b of tabs)
    b.onclick = () => {
      tab = b.dataset.book!;
      if (tab !== 'recipes') {
        recipeSearch = '';
        recipeFocus = null;
      }
      draw();
    };
  loadLibrary().then(draw);

  return {
    guides,
    pins,
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
