// Menu composition and run lifecycle. Each pane owns its data and controls.
import type * as db from './persist';
import { initBranding } from './branding';
import type { Game } from './sim/game';
import type { Quest } from './quests';
import { $ } from './menu/dom';
import { initNewGame } from './menu/new-game';
import { drawShop, drawQuests } from './menu/progression';
import { initScores } from './menu/scores';
import { initSettings } from './menu/settings';
import './menu/menu.css';

type Pane = 'play' | 'scores' | 'hero' | 'quests' | 'settings';
interface Result {
  score: number;
  won: boolean;
  ended?: boolean;
  shells: number;
  summary?: {
    lines: string[];
    towers: { name: string; share: number; kills: number; mvp: number }[];
  };
  quests?: Quest[];
}

export function initMenu(
  settings: db.Settings,
  game: Game,
  setSpeed: (s: number) => void,
  setVolume: (v: number) => void,
  saveMaze: () => Promise<boolean>,
  live: boolean,
) {
  const menu = $<HTMLDialogElement>('menu');
  const over = $('gameover');
  const endRun = $('endrun');
  const tabs = [...menu.querySelectorAll<HTMLButtonElement>('[data-tab]')];
  let lastFocus: HTMLElement | null = null;
  let pane: Pane = 'play';
  let result: Result | undefined;
  $('build').textContent = initBranding();
  const confirmLeave = () =>
    !live ||
    game.over ||
    !game.log.length ||
    confirm('Abandon the current game? Its score is not recorded (End run records it).');
  const drawScores = initScores(confirmLeave);
  const refreshSettings = initSettings(settings, setSpeed, setVolume);
  const tab = (next: Pane) => {
    pane = next;
    for (const button of tabs) {
      const selected = button.dataset.tab === pane;
      button.classList.toggle('on', selected);
      button.setAttribute('aria-selected', String(selected));
      button.tabIndex = selected ? 0 : -1;
    }
    for (const section of menu.querySelectorAll<HTMLElement>('[data-pane]'))
      section.hidden = section.dataset.pane !== pane;
    if (pane === 'scores') void drawScores();
    if (pane === 'hero') void drawShop();
    if (pane === 'quests') void drawQuests();
    if (pane === 'settings') refreshSettings();
  };
  for (const button of tabs) {
    button.onclick = () => tab(button.dataset.tab as Pane);
    button.onkeydown = (event) => {
      const index = tabs.indexOf(button);
      const next = {
        ArrowRight: (index + 1) % tabs.length,
        ArrowLeft: (index + tabs.length - 1) % tabs.length,
        Home: 0,
        End: tabs.length - 1,
      }[event.key];
      if (next === undefined) return;
      event.preventDefault();
      tabs[next].click();
      tabs[next].focus();
    };
  }
  const hide = () => {
    menu.close();
    menu.hidden = true;
    if (lastFocus?.isConnected && lastFocus !== document.body && lastFocus.getClientRects().length)
      lastFocus.focus();
    if (!lastFocus || document.activeElement !== lastFocus || lastFocus === document.body)
      $('game').focus();
  };
  menu.addEventListener('cancel', (event) => {
    event.preventDefault();
    hide();
  });
  menu.addEventListener('keydown', (event) => {
    if (event.key !== 'Tab') return;
    const controls = [
      ...menu.querySelectorAll<HTMLElement>('button, select, input, summary, [tabindex="0"]'),
    ].filter((element) => !element.hasAttribute('disabled') && element.getClientRects().length);
    const first = controls[0];
    const last = controls.at(-1);
    if (event.shiftKey && document.activeElement === first && last) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last && first) {
      event.preventDefault();
      first.focus();
    }
  });
  $('close').onclick = hide;
  $('resume').onclick = hide;
  const newGame = initNewGame(
    settings,
    confirmLeave,
    () => {
      hide();
      void drawShop();
    },
    (editLoadout) => {
      $('returnsetup').hidden = !editLoadout;
      show();
      tab(editLoadout ? 'hero' : 'play');
      if (editLoadout) $('returnsetup').focus();
      else $('opennew').focus();
    },
  );
  $('opennew').onclick = () => newGame('standard');
  $('opendaily').onclick = () => newGame('daily');
  $('openbuilder').onclick = () => newGame('builder');
  $('returnsetup').onclick = () => newGame();
  $('edithero').onclick = () => tab('hero');
  endRun.onclick = () => confirm('End this run and record its score?') && game.run(['end']);
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

  function show(nextResult?: Result) {
    if (nextResult) result = nextResult;
    if (!menu.open) {
      lastFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      menu.hidden = false;
      menu.showModal();
    }
    over.hidden = !result;
    const active = !game.over && game.log.length > 0;
    endRun.hidden = !live || !active;
    $('resume').hidden = game.over;
    $('resume').textContent = active ? 'Resume' : 'Back to board';
    $('runstatus').textContent = game.over
      ? 'Run complete. Ready for another?'
      : active
        ? `Paused · Wave ${game.sim.wave} · ${game.sim.castleHp} HP`
        : 'Build a maze. Protect the exit.';
    void drawShop();
    if (nextResult) {
      over.innerHTML = `<div>${nextResult.won ? '👑 Victory!' : nextResult.ended ? '🏳 Run ended' : '💀 The castle has fallen'}</div>
        <div class="big">${nextResult.score}</div><div>+${nextResult.shells} 🐚 shells</div>${recap(nextResult.summary)}${(nextResult.quests ?? []).map((q) => `<div class="quest">📜 ${q.name} +${q.shells} 🐚</div>`).join('')}
        <div class="dialog-actions"><button>Save maze to library</button><button class="primary">Play again</button></div>`;
      const [save, again] = over.querySelectorAll('button');
      save.onclick = async () => {
        if (!(await saveMaze())) return;
        save.disabled = true;
        save.textContent = '✓ Saved';
      };
      again.onclick = () => newGame('standard');
      pane = 'scores';
    }
    tab(pane);
    tabs.find((button) => button.dataset.tab === pane)?.focus();
  }
  return {
    show,
    newGame,
    toggle: () => (menu.hidden ? show() : hide()),
    get open() {
      return menu.open || $<HTMLDialogElement>('newdlg').open;
    },
  };
}
