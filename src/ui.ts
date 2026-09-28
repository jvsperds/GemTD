// Menu overlay: leaderboards (3 boards + difficulty filter), settings, export/import, new game.
import * as db from './persist';
import type { Game, LogEntry } from './sim/game';
import { dailySeed } from './sim/setup';

/** Start a new game (or a replay) on the next load. */
function startNext(o: { seed: number; difficulty: string; daily?: string; replay?: LogEntry[] }) {
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
            });
          td.append(b);
        }
        tr.append(td);
        return tr;
      }),
    );
    if (!list.length) rows.innerHTML = '<tr><td colspan="9">No scores yet</td></tr>';
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
  $('newgame').onclick = () => newGame();
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

  const newGame = () =>
    confirmLeave() &&
    startNext({ seed: (Math.random() * 2 ** 31) | 0, difficulty: settings.difficulty });
  /** Open the menu; with a result it leads with the game-over banner. */
  const show = (result?: { score: number; won: boolean }) => {
    menu.hidden = false;
    over.hidden = !result;
    if (result) {
      over.innerHTML = `<div>${result.won ? '👑 Victory!' : '💀 The castle has fallen'}</div>
        <div class="big">${result.score}</div><button>⚔ Play again</button>`;
      over.querySelector('button')!.onclick = newGame;
      tab('scores');
    }
    draw();
  };
  return { show, toggle: () => (menu.hidden ? show() : (menu.hidden = true)) };
}
