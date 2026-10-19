import * as db from '../persist';
import { dailySeed, MAPS, MUTATORS } from '../sim/setup';
import { $, today } from './dom';
import { startNext } from './start';

export type RunMode = 'standard' | 'daily' | 'builder';

/** A run is launched only by Begin. Cancelling keeps the current run and setup intact. */
export function initNewGame(
  settings: db.Settings,
  confirmLeave: () => boolean,
  beforeOpen: () => void,
  onClose: (editLoadout: boolean) => void,
) {
  const dialog = $<HTMLDialogElement>('newdlg');
  const map = $<HTMLSelectElement>('mapsel');
  const modes = [...dialog.querySelectorAll<HTMLButtonElement>('[data-mode]')];
  const difficulties = [...dialog.querySelectorAll<HTMLButtonElement>('[data-diff]')];
  let mode: RunMode = 'standard';
  let editLoadout = false;
  map.replaceChildren(...Object.entries(MAPS).map(([id, m]) => new Option(m.name, id)));
  map.value = settings.map ?? 'classic';
  map.onchange = () => {
    settings.map = map.value;
    void db.set('settings', settings);
  };
  $('mutators').replaceChildren(
    ...Object.entries(MUTATORS).map(([id, m]) => {
      const label = document.createElement('label');
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.value = id;
      const text = document.createElement('span');
      const name = document.createElement('b');
      name.textContent = m.name;
      const tip = document.createElement('small');
      tip.textContent = m.tip;
      text.append(name, tip);
      label.append(input, text);
      return label;
    }),
  );
  const render = () => {
    for (const button of modes) {
      const selected = button.dataset.mode === mode;
      button.classList.toggle('on', selected);
      button.setAttribute('aria-pressed', String(selected));
    }
    for (const button of difficulties) {
      const selected = button.dataset.diff === settings.difficulty;
      button.classList.toggle('on', selected);
      button.setAttribute('aria-pressed', String(selected));
    }
    $('customsetup').hidden = mode !== 'standard';
    $('setuploadout').hidden = mode === 'builder';
    $('modedescription').textContent = {
      standard:
        'Choose your difficulty and map. Optional mutators change the rules. Challenge contracts give a seeded goal and pay once per day.',
      daily: `Today's challenge (${new Date().toLocaleDateString()}): Normal difficulty, Classic map, no mutators. Your hero and skills apply.`,
      builder:
        'Build and save mazes freely on the Classic map. No waves, scores, or shell rewards.',
    }[mode];
    $('newgame').textContent = {
      standard: 'Begin run',
      daily: 'Begin daily challenge',
      builder: 'Open maze builder',
    }[mode];
  };
  for (const button of modes)
    button.onclick = () => {
      mode = button.dataset.mode as RunMode;
      render();
    };
  for (const button of difficulties)
    button.onclick = () => {
      settings.difficulty = button.dataset.diff!;
      void db.set('settings', settings);
      render();
    };
  $('cancelnew').onclick = () => dialog.close();
  $('changeloadout').onclick = () => {
    editLoadout = true;
    dialog.close();
  };
  dialog.addEventListener('close', () => onClose(editLoadout));
  $('newgame').onclick = () => {
    if (!confirmLeave()) return;
    if (mode === 'daily') startNext({ seed: dailySeed(), difficulty: 'normal', daily: today() });
    else if (mode === 'builder') startNext({ seed: 0, difficulty: 'normal', builder: true });
    else
      startNext({
        seed: (Math.random() * 2 ** 31) | 0,
        difficulty: settings.difficulty,
        map: map.value,
        contractPeriod: today(),
        mutators: [...dialog.querySelectorAll<HTMLInputElement>('#mutators input:checked')].map(
          (input) => input.value,
        ),
      });
  };
  return (nextMode?: RunMode) => {
    mode = nextMode ?? mode;
    editLoadout = false;
    beforeOpen();
    render();
    dialog.showModal();
    modes.find((button) => button.dataset.mode === mode)?.focus();
  };
}
