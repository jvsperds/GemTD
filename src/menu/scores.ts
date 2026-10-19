import * as db from '../persist';
import { MAPS, MUTATORS } from '../sim/setup';
import { $, today } from './dom';
import { startNext } from './start';

export function initScores(confirmLeave: () => boolean) {
  const which = $<HTMLSelectElement>('board');
  const diff = $<HTMLSelectElement>('difficulty');
  const rows = $<HTMLTableSectionElement>('rows');
  let latest = 0;
  async function draw() {
    const request = ++latest;
    rows.innerHTML = '<tr><td colspan="9">Loading scores…</td></tr>';
    const all = await db.allScores();
    if (request !== latest) return;
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
          [
            x.difficulty,
            ...(x.map && x.map !== 'classic' ? [MAPS[x.map]?.name ?? x.map] : []),
            ...(x.mutators ?? []).map((m) => MUTATORS[m]?.name ?? m),
          ].join(' + '),
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
              contractPeriod: x.contractPeriod,
              mutators: x.mutators,
              map: x.map,
              replay: x.commands,
              rules: x.rules,
              skills: x.skills,
              hero: x.hero,
            });
          td.append(b);
        }
        tr.append(td);
        return tr;
      }),
    );
    if (!list.length)
      rows.innerHTML =
        '<tr><td colspan="9">No runs match this board. Finish a run or change the filters.</td></tr>';
  }

  which.onchange = diff.onchange = () => void draw();
  return () => {
    $<HTMLOptionElement>('dailyopt').value = 'daily:' + today();
    return draw();
  };
}
