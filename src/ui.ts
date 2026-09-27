// Menu overlay: leaderboards (3 boards + difficulty filter), settings, export/import, new game.
import * as db from './persist';
import type { Game } from './sim/game';

export function initMenu(settings: db.Settings, game: Game, setSpeed: (s: number) => void) {
  const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
  const menu = $<HTMLElement>('menu');
  const which = $<HTMLSelectElement>('board');
  const diff = $<HTMLSelectElement>('difficulty');
  const rows = $<HTMLTableSectionElement>('rows');
  const name = $<HTMLInputElement>('player');
  const speed = $<HTMLSelectElement>('speed');
  name.value = settings.name;
  speed.value = String(settings.speed);

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
        return tr;
      }),
    );
    if (!list.length) rows.innerHTML = '<tr><td colspan="8">No scores yet</td></tr>';
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
  $('close').onclick = () => (menu.hidden = true);
  $('newgame').onclick = async () => {
    if (!game.over && game.log.length && !confirm('Abandon the current game?')) return;
    await db.set('save', null);
    location.reload();
  };
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

  const show = () => {
    menu.hidden = false;
    draw();
  };
  return { show, toggle: () => (menu.hidden ? show() : (menu.hidden = true)) };
}
