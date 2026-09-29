// Menu overlay: leaderboards (3 boards + difficulty filter), settings, export/import, new game.
import * as db from './persist';
import type { Game, LogEntry } from './sim/game';
import { dailySeed } from './sim/setup';
import { DEFAULT_HERO, HEROES, RARITY_COLOR } from './sim/heroes';
import {
  PASSIVES,
  SKILLS,
  bringLimit,
  goldOf,
  passiveTip,
  skillTip,
  type Loadout,
} from './sim/skills';

/** Start a new game (or a replay) on the next load. */
function startNext(o: {
  seed: number;
  difficulty: string;
  daily?: string;
  replay?: LogEntry[];
  builder?: boolean;
  skills?: Loadout;
  hero?: string;
}) {
  try {
    sessionStorage.setItem('gemtd.start', JSON.stringify(o));
  } catch {
    /* storage blocked: reload still starts a fresh random game */
  }
  location.reload();
}

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
};

export function initMenu(
  settings: db.Settings,
  game: Game,
  setSpeed: (s: number) => void,
  setVolume: (v: number) => void,
  saveMaze: () => Promise<boolean>,
) {
  const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
  const menu = $<HTMLElement>('menu');
  const which = $<HTMLSelectElement>('board');
  const diff = $<HTMLSelectElement>('difficulty');
  const rows = $<HTMLTableSectionElement>('rows');
  const name = $<HTMLInputElement>('player');
  const speed = $<HTMLSelectElement>('speed');
  const volume = $<HTMLInputElement>('volume');
  const cards = [...document.querySelectorAll<HTMLButtonElement>('#diffcards button')];
  const tabs = [...document.querySelectorAll<HTMLButtonElement>('.tabs [data-tab]')];
  const over = $<HTMLElement>('gameover');
  const dlg = $<HTMLDialogElement>('newdlg');
  name.value = settings.name;
  speed.value = String(settings.speed);
  volume.value = String(settings.volume);
  const markDiff = () =>
    cards.forEach((c) => c.classList.toggle('on', c.dataset.diff === settings.difficulty));
  markDiff();
  const tab = (t: string) => {
    for (const b of tabs) b.classList.toggle('on', b.dataset.tab === t);
    for (const s of document.querySelectorAll<HTMLElement>('#menu [data-pane]'))
      s.hidden = s.dataset.pane !== t;
  };
  for (const b of tabs) b.onclick = () => tab(b.dataset.tab!);
  $<HTMLOptionElement>('dailyopt').value = 'daily:' + today();

  async function draw() {
    const all = await db.get('scores');
    const list = db.board(all, which.value as db.Board, diff.value);
    rows.replaceChildren(
      ...list.map((x, i) => {
        const tr = document.createElement('tr');
        for (const v of [
          i + 1,
          x.name,
          x.score,
          x.wavesCleared,
          x.hpLeft,
          `${x.timeSec}s`,
          x.difficulty,
          new Date(x.date).toLocaleDateString(),
        ]) {
          const td = document.createElement('td');
          td.textContent = String(v);
          tr.append(td);
        }
        const td = document.createElement('td');
        if (x.commands) {
          const b = document.createElement('button');
          b.textContent = 'Watch';
          b.onclick = () =>
            confirmLeave() &&
            startNext({
              seed: x.seed,
              difficulty: x.difficulty,
              daily: x.daily,
              replay: x.commands,
              skills: x.skills,
              hero: x.hero,
            });
          td.append(b);
        }
        tr.append(td);
        return tr;
      }),
    );
    if (!list.length) rows.innerHTML = '<tr><td colspan="9">No scores yet</td></tr>';
  }
  /** Hero tab: pick or unlock a hero, buy or upgrade skills, and choose which to bring. */
  async function drawShop() {
    const hero = await db.get('hero');
    const owned = new Set([DEFAULT_HERO, ...(hero.heroes ?? [])]);
    const picked = owned.has(hero.hero ?? '') ? hero.hero! : DEFAULT_HERO;
    const limit = bringLimit(picked);
    const bring = (hero.bring ?? []).filter((id) => hero.skills[id]).slice(0, limit);
    const save = async () => {
      await db.set('hero', { ...hero, bring });
      drawShop();
    };
    $('shells').textContent = String(hero.shells);
    const h = HEROES[picked];
    $('loadout').textContent =
      `${h.icon} ${h.name} · ` +
      (bring
        .map((id) => `${(SKILLS[id] ?? PASSIVES[id]).icon} ${(SKILLS[id] ?? PASSIVES[id]).name}`)
        .join(', ') || 'no skills');
    $('bringing').textContent = `${bring.length}/${limit}`;
    $('herolist').replaceChildren(
      ...Object.entries(HEROES).map(([id, h]) => {
        const b = document.createElement('button');
        const have = owned.has(id);
        b.className = 'herocard' + (id === picked ? ' on' : '');
        b.style.setProperty('--rarity', RARITY_COLOR[h.rarity]);
        b.innerHTML = `<i></i><b></b><small class="rarity"></small><small></small><small class="cost"></small>`;
        const [icon, name, rarity, tip, cost] = b.children;
        icon.textContent = h.icon;
        name.textContent = `${h.name} ${h.title}`;
        rarity.textContent = h.rarity;
        tip.textContent = h.tip;
        cost.textContent =
          id === picked ? '✓ Selected' : have ? 'Select' : `Unlock: 🐚 ${h.shells}`;
        b.disabled = !have && hero.shells < h.shells;
        b.onclick = () => {
          if (!have) {
            hero.shells -= h.shells;
            hero.heroes = [...(hero.heroes ?? []), id];
          }
          hero.hero = id;
          save();
        };
        return b;
      }),
    );
    /** One shop row: buy/upgrade button, then a bring toggle once owned. */
    const shopItem = (
      id: string,
      s: { icon: string; name: string; shells: number[] },
      info: (lvl: number) => string,
    ) => {
      const lvl = hero.skills[id] ?? 0;
      const price = s.shells[lvl]; // undefined at max level
      const item = document.createElement('div');
      item.className = 'shopitem';
      const b = document.createElement('button');
      b.textContent = `${s.icon} ${s.name} ${lvl ? `Lv ${lvl}` : ''}`;
      const small = document.createElement('small');
      small.textContent = `${info(lvl + (price ? 1 : 0))} · ${
        price ? `${lvl ? 'Upgrade' : 'Unlock'}: 🐚 ${price}` : 'Max level'
      }`;
      b.append(small);
      b.disabled = !price || hero.shells < price;
      b.onclick = () => {
        hero.shells -= price;
        hero.skills = { ...hero.skills, [id]: lvl + 1 };
        if (!lvl && bring.length < limit) bring.push(id);
        save();
      };
      item.append(b);
      if (lvl) {
        const on = bring.includes(id);
        const t = document.createElement('button');
        t.className = on ? 'bring on' : 'bring';
        t.textContent = on ? '✓ Bringing' : '+ Bring';
        t.disabled = !on && bring.length >= limit;
        t.onclick = () => {
          if (on) bring.splice(bring.indexOf(id), 1);
          else bring.push(id);
          save();
        };
        item.append(t);
      }
      return item;
    };
    $('shop').replaceChildren(
      ...Object.entries(SKILLS).map(([id, s]) =>
        shopItem(id, s, (l) => `${skillTip(id, l)} · ${goldOf(id, l)}g per cast`),
      ),
    );
    $('passives').replaceChildren(
      ...Object.entries(PASSIVES).map(([id, s]) => shopItem(id, s, (l) => passiveTip(id, l))),
    );
  }
  const saveSettings = () => db.set('settings', settings);

  which.onchange = diff.onchange = draw;
  name.onchange = () => {
    settings.name = name.value.trim().slice(0, 24) || 'Player';
    saveSettings();
  };
  speed.onchange = () => {
    settings.speed = +speed.value;
    setSpeed(settings.speed);
    saveSettings();
  };
  volume.oninput = () => {
    settings.volume = +volume.value;
    setVolume(settings.volume);
    saveSettings();
  };
  for (const c of cards)
    c.onclick = () => {
      settings.difficulty = c.dataset.diff!;
      markDiff();
      saveSettings();
    };
  const confirmLeave = () => game.over || !game.log.length || confirm('Abandon the current game?');
  $('close').onclick = () => (menu.hidden = true);
  $('changeloadout').onclick = () => {
    dlg.close();
    show();
    tab('hero');
  };
  $('newgame').onclick = () =>
    startNext({ seed: (Math.random() * 2 ** 31) | 0, difficulty: settings.difficulty });
  $('cancelnew').onclick = () => dlg.close();
  $('opennew').onclick = () => newGame();
  $('builder').onclick = () =>
    confirmLeave() && startNext({ seed: 0, difficulty: 'normal', builder: true });
  $('daily').onclick = () =>
    confirmLeave() && startNext({ seed: dailySeed(), difficulty: 'normal', daily: today() });
  $('export').onclick = async () => {
    const blob = new Blob([JSON.stringify(await db.get('scores'), null, 1)], {
      type: 'application/json',
    });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'gemtd-scores.json';
    a.click();
    URL.revokeObjectURL(a.href);
  };
  $('clearScores').onclick = async () => {
    if (!confirm('Delete all saved scores? Export them first to keep a copy.')) return;
    await db.set('scores', []);
    draw();
  };
  const file = $<HTMLInputElement>('importfile');
  $('import').onclick = () => file.click();
  file.onchange = async () => {
    const f = file.files?.[0];
    if (!f) return;
    try {
      await db.set('scores', db.mergeScores(await db.get('scores'), JSON.parse(await f.text())));
      draw();
    } catch (e) {
      alert(`Import failed: ${(e as Error).message}`);
    }
    file.value = '';
  };

  /** The new-game dialog: difficulty, loadout, then Begin. */
  const newGame = () => {
    if (!confirmLeave()) return;
    menu.hidden = true;
    markDiff();
    drawShop();
    dlg.showModal();
  };
  // Tower names come from the bundled data, so plain interpolation is safe here.
  const recap = (r?: {
    lines: string[];
    towers: { name: string; share: number; kills: number; mvp: number }[];
  }) =>
    r
      ? `<div class="recap">${r.lines.join(' · ')}</div><table class="recap">` +
        r.towers
          .map(
            (t) =>
              `<tr><td>${t.name}</td><td>${t.share}%</td><td>${t.kills} kills</td><td>${t.mvp ? '★' + t.mvp : ''}</td></tr>`,
          )
          .join('') +
        '</table>'
      : '';
  /** Open the menu; with a result it leads with the game-over banner. */
  const show = (result?: {
    score: number;
    won: boolean;
    shells: number;
    summary?: {
      lines: string[];
      towers: { name: string; share: number; kills: number; mvp: number }[];
    };
  }) => {
    menu.hidden = false;
    over.hidden = !result;
    drawShop();
    if (result) {
      over.innerHTML = `<div>${result.won ? '👑 Victory!' : '💀 The castle has fallen'}</div>
        <div class="big">${result.score}</div><div>+${result.shells} 🐚 shells</div>${recap(result.summary)}<button>⚔ Play again</button>
        <button>💾 Save maze to library</button>`;
      const [again, keep] = over.querySelectorAll('button');
      again.onclick = newGame;
      keep.onclick = async () => {
        if (!(await saveMaze())) return;
        keep.disabled = true;
        keep.textContent = '✓ Saved';
      };
      tab('scores');
    }
    draw();
  };
  return { show, newGame, toggle: () => (menu.hidden ? show() : (menu.hidden = true)) };
}
