import waves from '../data/waves.json';
import * as db from './persist';
import rawAdvanced from '../data/raw/advanced_towers.json';
import rawBase from '../data/raw/base_towers.json';
import { skillIcon } from './icons';
import { GEM_COLOR, Renderer, creepIcon, towerIcon } from './render';
import * as sfx from './sfx';
import { DOWNGRADE_COST, score, type Cmd, type LogEntry } from './sim/game';
import { newGame, type Difficulty } from './sim/setup';
import { MAX_BRING, SKILLS, goldOf, shellsFor, skillTip, type Loadout } from './sim/skills';
import { AURA, type Tower } from './sim/towers';
import {
  BLINK_CELLS,
  BLINK_CHANCE,
  CASTLE_HP,
  DISARM_RANGE,
  EVASION,
  HIGH_ARMOR,
  KRAKEN_CLEANSE,
  KRAKEN_INTERVAL,
  RECHARGE,
  REFRACTION,
  RUSH,
  RUSH_CHANCE,
  RUSH_TIME,
  TICK,
  UNTOUCHABLE,
  armorOf,
  type Creep,
  type WaveEntry,
} from './sim/waves';
import { initBook, mazeRows, measure, type Guide } from './book';
import { initDmgChart } from './dmgchart';
import { initMenu } from './ui';

const canvas = document.querySelector<HTMLCanvasElement>('#game')!;
const hud = document.querySelector<HTMLElement>('#hud')!;
const hintEl = document.querySelector<HTMLElement>('#hint')!;
const debug = document.querySelector<HTMLElement>('#debug')!;
const stress = location.hash === '#stress';
const settings = await db.get('settings');
// A fresh start (new game / daily / replay) is handed over the reload in sessionStorage.
type Start = {
  seed: number;
  difficulty: string;
  daily?: string;
  replay?: LogEntry[];
  builder?: boolean;
  skills?: Loadout; // a replay's hero skills
};
let start: Start | null = null;
try {
  start = JSON.parse(sessionStorage.getItem('gemtd.start') ?? 'null');
  sessionStorage.removeItem('gemtd.start');
} catch {
  /* storage blocked: start a normal game */
}
const save = stress || start ? null : await db.get('save');
const cfg = start ??
  save ?? { seed: (Math.random() * 2 ** 31) | 0, difficulty: settings.difficulty };
const game = newGame(cfg.seed, cfg.difficulty as Difficulty);
const hero = await db.get('hero');
// A new game takes the hero's current skills; a resume or replay keeps the ones it started with.
game.skills = start?.replay
  ? (start.skills ?? {})
  : save
    ? (save.skills ?? {})
    : Object.fromEntries(
        (hero.bring ?? [])
          .filter((id) => hero.skills[id])
          .slice(0, MAX_BRING)
          .map((id) => [id, hero.skills[id]]),
      );
if (save) game.replay(save.commands); // resume: waves before the last command replay headless
const replaying = start?.replay ?? null; // watch mode: commands are fed live, input is off
const builder = !!start?.builder; // maze builder: free stone editing, no gems or waves
let ri = 0,
  nextCmdAt = 0;
const { combat, sim } = game;
const { maze } = sim;
(window as unknown as { gemtd: typeof game }).gemtd = game; // for e2e / debugging
const view = new Renderer(canvas, maze, sim, combat);
let removing = false; // Remove-stone mode
let sel: Tower | null = null;
let selCreep: Creep | null = null;
let speed = settings.speed; // 0 = paused
const menu = initMenu(
  settings,
  game,
  (s) => (speed = s),
  sfx.setVolume,
  () => book.save(mazeRows(maze)),
);
let guide: Guide | null = null;
const showGuide = (g: Guide | null) => {
  guide = g;
  view.guide = g?.rows ?? null;
  view.invalidate();
};
const book = initBook({
  towers: () => combat.towers,
  selected: () => sel,
  guide: () => guide,
  showGuide,
  build: builder
    ? (g) => {
        // Stones in a valid guide never block part-way, so placing them one by one is safe.
        for (let i = 0; i < maze.cells.length; i++) maze.removeRock(i % maze.w, (i / maze.w) | 0);
        g.rows.forEach((row, r) => [...row].forEach((ch, c) => ch !== '.' && maze.placeRock(c, r)));
        mazeVer++;
        view.invalidate();
      }
    : undefined,
});
let mazeVer = 0; // bumped on every builder edit
initDmgChart(() => combat.towers, canvas);

const saveNow = () =>
  db.set('save', {
    seed: game.seed,
    difficulty: cfg.difficulty,
    daily: cfg.daily,
    commands: game.log,
    version: db.VERSION,
    skills: game.skills,
  });
if (!replaying && !stress && !builder) {
  game.onCommand = saveNow;
  if (start) saveNow(); // so a reload before the first move resumes this game, not the old one
}
function run(cmd: Cmd) {
  const ok = game.run(cmd);
  if (ok) sfx.play(cmd[0] === 'place' ? 'place' : 'keep');
  view.invalidate();
  return ok;
}
sfx.setVolume(settings.volume);
addEventListener('pointerdown', sfx.unlock);
addEventListener('keydown', sfx.unlock);

canvas.addEventListener('click', (e) => {
  if (replaying) return;
  const [c, r] = view.screenToCell(e.clientX, e.clientY);
  if (c < 0 || r < 0 || c >= maze.w || r >= maze.h) return;
  if (builder) {
    const ok = maze.removeRock(c, r) || maze.placeRock(c, r);
    if (ok) mazeVer++;
    else [view.flash, view.flashUntil] = [maze.idx(c, r), performance.now() + 300];
    sfx.play(ok ? 'place' : 'refuse');
    return view.invalidate();
  }
  const cr = removing ? null : view.creepAt(e.clientX, e.clientY);
  selCreep = cr;
  if (cr) return void (sel = null);
  const hit = combat.towerAt(c, r);
  const ok = removing
    ? run(['stone', c, r])
    : hit
      ? (sel = hit)
      : game.step === 'place'
        ? run(['place', c, r])
        : ((sel = null), true); // clicking empty ground returns to the hero view
  removing = false;
  if (!ok) {
    [view.flash, view.flashUntil] = [maze.idx(c, r), performance.now() + 300];
    sfx.play('refuse');
  }
  view.invalidate();
});
function act(a: string) {
  if (a === 'menu') return menu.toggle();
  if (a === 'guide') {
    // cycle: off -> each guide (built-in, then library) -> off
    const all = book.guides();
    return showGuide(all[all.findIndex((g) => g.rows === guide?.rows) + 1] ?? null);
  }
  if (a === 'ranges') return (view.showRanges = !view.showRanges);
  if (a === 'book') return book.toggle();
  if (a === 'save') return book.save(mazeRows(maze));
  if (a === 'clear') {
    if (!confirm('Clear every stone?')) return;
    for (let i = 0; i < maze.cells.length; i++) maze.removeRock(i % maze.w, (i / maze.w) | 0);
    mazeVer++;
    return view.invalidate();
  }
  if (a === 'path') return ((view.showPath = !view.showPath), view.invalidate());
  if (a === 'deselect') return ((sel = selCreep = null), (removing = false));
  if (a === 'pause') return (speed = speed ? 0 : settings.speed || 1);
  if (a === 'speed') {
    speed = settings.speed = { 1: 2, 2: 4, 4: 10 }[settings.speed] ?? 1;
    return db.set('settings', settings);
  }
  if (replaying) return;
  if (a.startsWith('skill:')) run(['skill', sel?.c ?? -1, sel?.r ?? -1, a.slice(6)]);
  else if (a === 'stone') removing = !removing;
  else if (a === 'level') run(['level']);
  else if (sel) {
    const { c, r } = sel;
    const ok = a.startsWith('combine:')
      ? run(['combine', c, r, a.slice(8)])
      : run([a as 'keep' | 'merge2' | 'merge4' | 'down', c, r]);
    if (ok && sim.phase === 'wave') sel = null;
  }
}
const keys: Record<string, string> = {
  k: 'keep',
  m: 'merge2',
  n: 'merge4',
  d: 'down',
  r: 'stone',
  l: 'level',
  g: 'guide',
  p: 'path',
  v: 'ranges',
  h: 'book',
  Escape: 'deselect',
  b: 'menu',
  ' ': 'pause',
};
const buttons = [...document.querySelectorAll<HTMLButtonElement>('#actions button')];
for (const b of buttons) b.addEventListener('click', () => act(b.dataset.a!));
const combos = document.querySelector<HTMLElement>('#combos')!;
combos.addEventListener('click', (e) => {
  const a = (e.target as HTMLElement).dataset.a;
  if (a) act(a);
});
canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  view.setZoom(view.zoom * (e.deltaY < 0 ? 1.25 : 0.8), e.clientX, e.clientY);
});
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
canvas.addEventListener('pointermove', (e) => {
  if (e.buttons & 6) view.pan(e.movementX, e.movementY); // right or middle drag
});
// Touch: one-finger drag pans, two-finger pinch zooms. A drag swallows the click it ends with.
const touches = new Map<number, [number, number]>();
let dragged = false;
let pinch = [0, 1]; // [finger distance, zoom] when the second finger landed
const spread = () => {
  const [a, b] = [...touches.values()];
  return Math.hypot(a[0] - b[0], a[1] - b[1]) || 1;
};
canvas.addEventListener('pointerdown', (e) => {
  if (e.pointerType !== 'touch') return;
  touches.set(e.pointerId, [e.clientX, e.clientY]);
  if (touches.size === 1) dragged = false;
  if (touches.size === 2) pinch = [spread(), view.zoom];
});
canvas.addEventListener('pointermove', (e) => {
  const prev = touches.get(e.pointerId);
  if (!prev) return;
  touches.set(e.pointerId, [e.clientX, e.clientY]);
  if (touches.size === 1) {
    if (!dragged && Math.hypot(e.clientX - prev[0], e.clientY - prev[1]) < 8) {
      return touches.set(e.pointerId, prev); // under the slop: keep origin so a tap stays a tap
    }
    dragged = true;
    view.pan(e.clientX - prev[0], e.clientY - prev[1]);
  } else if (touches.size === 2) {
    dragged = true;
    const [c, d] = [...touches.values()];
    view.setZoom((pinch[1] * spread()) / pinch[0], (c[0] + d[0]) / 2, (c[1] + d[1]) / 2);
  }
  view.invalidate();
});
for (const t of ['pointerup', 'pointercancel'] as const)
  canvas.addEventListener(t, (e) => touches.delete(e.pointerId));
canvas.addEventListener('click', (e) => dragged && e.stopImmediatePropagation(), { capture: true });
addEventListener('resize', () => view.resize());
addEventListener('keydown', (e) => {
  if (e.key === 'F3') {
    e.preventDefault();
    debug.hidden = !debug.hidden;
  } else if (e.target instanceof HTMLInputElement) return;
  else if (/^[1-4]$/.test(e.key)) speed = settings.speed = [1, 2, 4, 10][+e.key - 1];
  else if (keys[e.key]) {
    e.preventDefault();
    act(keys[e.key]);
  }
});

if (stress) {
  // Stress scene (BUILD.md §3.7): 80 towers, 400 unkillable creeps, 1,500 tracers, 800 particles.
  const types = Object.keys(GEM_COLOR);
  for (let i = 0, n = 0; n < 80 && i < maze.w * maze.h; i += 7)
    if (combat.place(types[n % 8] + ((n % 6) + 1), i % maze.w, (i / maze.w) | 0)) n++;
  sim.startWave();
  sim.castleHp = Infinity;
  speed = 1;
  debug.hidden = false;
}
const flyer = (waves as WaveEntry[]).find((w) => w.flying)!;
let recorded = game.over || !!replaying || stress || builder;
async function recordScore() {
  recorded = true;
  const scores = await db.get('scores');
  scores.push({
    name: settings.name,
    score: score(game),
    wavesCleared: game.wavesCleared,
    hpLeft: Math.max(0, sim.castleHp),
    timeSec: Math.round(game.seconds),
    difficulty: cfg.difficulty,
    daily: cfg.daily,
    seed: game.seed,
    won: sim.phase === 'won',
    date: Date.now(),
    version: db.VERSION,
    commands: game.log,
    skills: game.skills,
  });
  await db.set('scores', scores);
  await db.set('save', null);
  const shells = shellsFor(game.wavesCleared, sim.phase === 'won');
  const h = await db.get('hero');
  await db.set('hero', { ...h, shells: h.shells + shells });
  menu.show({ score: score(game), won: sim.phase === 'won', shells });
}
function topUpStress() {
  for (let k = sim.creeps.length; k < 400; k++) {
    sim.spawn({ ...(k % 5 ? sim.waves[0] : flyer), hp: 1e12 });
  }
  const { towers, shots } = combat,
    { creeps } = sim;
  for (let k = shots.length; k < 1500; k++)
    shots.push({ from: towers[k % towers.length], to: creeps[k % creeps.length] });
}

let prev = { kills: 0, hp: sim.castleHp, phase: sim.phase as string };
function sounds() {
  if (stress) return;
  if (game.kills > prev.kills) sfx.play('kill');
  if (sim.castleHp < prev.hp) sfx.play('leak');
  if (sim.phase !== prev.phase)
    sfx.play(
      sim.phase === 'wave'
        ? 'wave'
        : sim.phase === 'won'
          ? 'win'
          : sim.phase === 'lost'
            ? 'lose'
            : 'keep',
    );
  prev = { kills: game.kills, hp: sim.castleHp, phase: sim.phase };
}

const QUALITY_COLOR = ['#8a8070', '#2fbf5a', '#3a6bff', '#a24de0', '#f2c52e'];
let prevGold = game.gold,
  prevHp = sim.castleHp;
function flashEl(id: string, cls: string) {
  const e = document.getElementById(id);
  e?.classList.add(cls); // fresh element each HUD rebuild, so the animation replays
}
const label = (a: string, t: string) =>
  (buttons.find((b) => b.dataset.a === a)!.querySelector('span')!.textContent = t);
// Ability names/tooltips from the wiki extract, keyed by ability id.
const ABILITY = new Map(
  [...rawBase, ...rawAdvanced].flatMap((t) =>
    t.abilities.map((a) => [a.id, { name: a.Name, tip: a.Tooltip }] as const),
  ),
);
const panel = document.querySelector<HTMLElement>('#panel')!;
const portraitEl = document.querySelector<HTMLElement>('#portrait')!;
const nameEl = document.querySelector<HTMLElement>('#name')!;
const attrs = document.querySelector<HTMLElement>('#attrs')!;
const cards = document.querySelector<HTMLElement>('#cards')!;
const statusEl = document.querySelector<HTMLElement>('#status')!;
/** Auras and debuffs currently on a tower: [icon id, level badge, tooltip, is a debuff]. */
function statuses(t: Tower): [string, string, string, boolean][] {
  const a = t.aura,
    out: [string, string, string, boolean][] = [];
  if (a.as) {
    const n = AURA.indexOf(a.as) + 1;
    const lvl = n ? String(n) : 'MAX+';
    out.push([
      'tower_speed_aura',
      n ? lvl : '+',
      `Attack speed aura ${lvl}\n+${a.as}% attack speed`,
      false,
    ]);
  }
  if (a.dmg) out.push(['tower_baoji', '', `Damage aura\n+${a.dmg * 100}% damage`, false]);
  if (a.range) out.push(['status_range', '', `Range aura\n+${a.range} attack range`, false]);
  if (a.aim) out.push(['status_aim', '', 'Aim aura\nAttacks cannot miss (ignores evasion)', false]);
  if (a.calm) out.push(['status_calm', '', 'Calm aura\nImmune to Disarm', false]);
  if (t.haste.t > 0)
    out.push([
      'tower_speed_aura',
      '',
      `Haste\n+${t.haste.v}% attack speed, ${Math.ceil(t.haste.t)}s left`,
      false,
    ]);
  if (t.aim.t > 0)
    out.push([
      'status_range',
      '',
      `Aim\nRange at least ${t.aim.v}, ${Math.ceil(t.aim.t)}s left`,
      false,
    ]);
  if (t.disarmT > 0)
    out.push(['status_disarm', '', `Disarmed\nCannot attack for ${t.disarmT.toFixed(1)}s`, true]);
  return out;
}
// Creep abilities as the sim implements them (the wiki extract has few tooltips).
const pct = (x: number) => `${Math.round(x * 100)}%`;
const CREEP_ABILITY: Record<string, [string, string]> = {
  riki_permanent_invisibility: ['Invisible', 'Only towers with true sight can target it.'],
  guai_shanbi: ['Evasion', `${pct(EVASION)} of attacks miss, unless the tower has Aim.`],
  guai_jiaoxieguanghuan: ['Disarm aura', `Towers within ${DISARM_RANGE} range cannot attack.`],
  enemy_zheguang: [
    'Refraction',
    `${pct(REFRACTION.chance)} chance on turning to gain a shield that blocks ${REFRACTION.instances} hits.`,
  ],
  enemy_momian: ['Magic immunity', 'Immune to magic damage and magic debuffs.'],
  enemy_bukeqinfan: [
    'Untouchable',
    `Attackers have a ${pct(UNTOUCHABLE.chance)} chance to be disarmed for ${UNTOUCHABLE.time}s.`,
  ],
  runrunrun: [
    'Rush',
    `${pct(RUSH_CHANCE)} chance on turning to run +${pct(RUSH)} faster for ${RUSH_TIME}s.`,
  ],
  enemy_high_armor: ['High armor', `+${HIGH_ARMOR} armor.`],
  enemy_wumian: ['Physical immunity', 'Takes no physical damage.'],
  shredder_reactive_armor: ['Reactive armor', 'Each hit taken grants +1 armor (stacks, decays).'],
  enemy_recharge: ['Recharge', `Regenerates ${pct(RECHARGE)} of max HP per second.`],
  enemy_shanshuo: [
    'Blink',
    `${pct(BLINK_CHANCE)} chance on turning to blink ${BLINK_CELLS} cells ahead.`,
  ],
  tidehunter_kraken_shell: [
    'Kraken shell',
    `Purges its debuffs after taking ${KRAKEN_CLEANSE} damage within ${KRAKEN_INTERVAL}s.`,
  ],
  guai_xietong: ['Synergy', 'Aura (range 9999): -150 move speed.'],
};
/** Debuffs and buffs currently on a creep, in the same shape as tower statuses. */
function creepStatuses(cr: Creep): [string, string, string, boolean][] {
  const out: [string, string, string, boolean][] = [];
  const slow = Math.max(cr.slowPct, cr.auraSlowPct);
  const flat = cr.slow + cr.auraSlow;
  if (slow || flat)
    out.push([
      'status_slow',
      '',
      `Slowed\n${[slow && `-${pct(slow)}`, flat && `-${flat}`].filter(Boolean).join(' ')} move speed`,
      true,
    ]);
  if (cr.poison)
    out.push(['status_poison', '', `Poisoned\n${cr.poison} magic damage per second`, true]);
  if (cr.armorRed || cr.auraArmor)
    out.push(['status_armor', '', `Armor reduced\n-${cr.armorRed + cr.auraArmor} armor`, true]);
  if (cr.stunT > 0) out.push(['status_stun', '', `Stunned\n${cr.stunT.toFixed(1)}s`, true]);
  if (cr.ampT > 0) out.push(['status_amp', '', 'Gazed\nTakes +100% physical damage', true]);
  if (cr.noHealT > 0) out.push(['status_poison', '', 'Wounded\nCannot regenerate', true]);
  if (cr.shield > 0)
    out.push([
      'status_shield',
      String(cr.shield),
      `Refraction shield\nBlocks ${cr.shield} more hits`,
      false,
    ]);
  if (cr.rushT > 0) out.push(['status_rush', '', `Rushing\n+${pct(RUSH)} move speed`, false]);
  if (cr.reactive)
    out.push([
      'shredder_reactive_armor',
      String(cr.reactive),
      `Reactive armor\n+${cr.reactive} armor`,
      false,
    ]);
  return out;
}
/** Selected creep: portrait, health, defences, ability cards. */
function drawCreep(cr: Creep) {
  const d = cr.def;
  setPortrait(creepIcon(d.name), '●');
  nameEl.textContent = d.name + (d.boss ? ' (boss)' : '');
  const armor = armorOf(cr);
  setAttrs([
    ['❤ HP', `${Math.ceil(cr.hp)} / ${Math.ceil(d.hp)}`],
    ['🛡 Armor', armor === d.armor ? String(d.armor) : `${+armor.toFixed(1)} (${d.armor})`],
    ['✧ Magic res', `${d.magicResist - cr.auraMr}%`],
    ['➤ Speed', `${Math.round(sim.speed(cr))}`],
    ['⚑ Wave', String(sim.wave)],
  ]);
  const bg = 'radial-gradient(circle, #4a566488, #0e1115)';
  cards.replaceChildren(
    card(
      d.flying ? '🪽' : '🐾',
      d.flying ? 'Flying' : 'Ground',
      d.flying ? 'Flies straight over the maze' : 'Walks the maze',
      bg,
    ),
    ...d.abilities.map((id) => {
      const [name, tip] = CREEP_ABILITY[id] ?? [id, ''];
      return card(skillIcon(id), name, `${name}: ${tip}`, bg);
    }),
  );
  const f = Math.max(0, cr.hp / d.hp) * 100;
  barFill.style.width = `${f}%`;
  barText.textContent = `${Math.ceil(cr.hp)} / ${Math.ceil(d.hp)} HP`;
  combos.replaceChildren();
}
const barFill = document.querySelector<HTMLElement>('#bar i')!;
const barText = document.querySelector<HTMLElement>('#bar span')!;
const el = (tag: string, cls = '', text = '') => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  e.textContent = text;
  return e;
};
function setPortrait(url: string | undefined, fallback: string, colour = '') {
  if (url) {
    const im = document.createElement('img');
    im.src = url;
    im.alt = '';
    portraitEl.replaceChildren(im);
  } else portraitEl.replaceChildren(fallback);
  portraitEl.style.color = colour;
}
function setAttrs(rows: [string, string | Node][]) {
  attrs.replaceChildren(
    ...rows.flatMap(([k, v]) => {
      const val = el('span');
      val.append(v);
      return [el('span', '', k), val];
    }),
  );
}
/** Ability/odds card; glyph is text, or a data: URL drawn as the icon. */
function card(glyph: string, label: string, tip: string, bg: string) {
  const url = glyph.startsWith('data:');
  const c = el('div', 'card', url ? '' : glyph);
  if (url) {
    const im = document.createElement('img');
    im.src = glyph;
    im.alt = '';
    c.append(im);
  }
  c.title = tip;
  c.style.background = bg;
  c.append(el('small', '', label));
  return c;
}
/** Cast buttons for the unlocked hero skills that target a tower (or the castle). */
function skillButtons(t?: Tower) {
  return Object.entries(game.skills)
    .filter(([id]) => SKILLS[id] && !!SKILLS[id].tower === !!t)
    .map(([id, lvl]) => {
      const s = SKILLS[id];
      const b = el(
        'button',
        'skill',
        `${s.icon} ${s.name} ${goldOf(id, lvl)}g`,
      ) as HTMLButtonElement;
      b.dataset.a = 'skill:' + id;
      b.title = `${s.name} (level ${lvl}): ${skillTip(id, lvl)}`;
      b.disabled = !!replaying || !game.canCast(id, t);
      return b;
    });
}
/** Default view: the builder "hero" — level, XP, gem odds. */
function drawHero(xpPct: number, lvlTo: number | undefined) {
  setPortrait(undefined, '👑');
  nameEl.textContent = 'Gem Builder';
  setAttrs([
    ['Level', String(game.level)],
    ['Gold', String(game.gold)],
    ['Next lvl', game.levelCost === null ? 'max' : `${game.levelCost}g`],
    ['Towers', String(combat.towers.length)],
    ['Kills', String(game.kills)],
  ]);
  cards.replaceChildren(
    ...game.odds.map((p, q) =>
      card(
        '◆',
        `${p}%`,
        `Chance of a quality ${q + 1} gem`,
        `radial-gradient(circle, ${QUALITY_COLOR[q]}${p ? 'aa' : '22'}, #0e1115)`,
      ),
    ),
  );
  barFill.style.width = `${xpPct}%`;
  barText.textContent = lvlTo
    ? `Level ${game.level} · ${Math.floor(game.xp)} / ${Math.ceil(lvlTo)} XP`
    : `Level ${game.level} · max`;
  combos.replaceChildren(...skillButtons());
}
/** Maze builder: live evaluation of the current stones. */
let measured = -1,
  stats = measure(maze);
function drawBuilder() {
  if (measured !== mazeVer) [measured, stats] = [mazeVer, measure(maze)];
  setPortrait(undefined, '🧱');
  nameEl.textContent = 'Maze builder';
  setAttrs([
    ['Stones', String(stats.stones)],
    ['Path', String(stats.length)],
    ['Middle', `${stats.passes}/6 legs`],
    ['Guide', guide?.name ?? '—'],
  ]);
  const names = ['S→1', '1→2', '2→3', '3→4', '4→5', '5→E'];
  cards.replaceChildren(
    ...stats.legs.map((n, i) =>
      card(
        String(n),
        names[i],
        `Leg ${names[i]}: ${n} cells`,
        'radial-gradient(circle, #2c343e, #0e1115)',
      ),
    ),
  );
  barFill.style.width = `${(stats.passes / 6) * 100}%`;
  barText.textContent = `${stats.passes} of 6 legs pass through the middle`;
  combos.replaceChildren();
}
/** Selected tower: portrait, stats, ability cards, combines and recipe uses. */
function drawTower(t: Tower, recipes: ReturnType<typeof game.recipesFor>, share: number) {
  const d = t.def;
  const colour = GEM_COLOR[d.quality ? d.type : 'S'];
  setPortrait(towerIcon(d), '◆', colour);
  nameEl.textContent = d.name;
  const dmg = el('span', '', String(d.damage));
  if (d.bonusDamage) dmg.append(el('span', 'up', ` +${d.bonusDamage}`));
  setAttrs([
    ['⚔ Dmg', dmg],
    ['⏱ Rate', `${d.attackRate}s`],
    ['◎ Range', String(d.range)],
    ['☠ Kills', String(t.kills)],
    ['★ MVP', String(t.mvp)],
  ]);
  cards.replaceChildren(
    ...d.abilities
      .filter((id) => ABILITY.has(id) && !/^tower_attack/.test(id))
      .map((id) => {
        const a = ABILITY.get(id)!;
        const name = a.name ?? id;
        return card(
          skillIcon(id),
          name,
          `${name}: ${a.tip ?? ''}`,
          `radial-gradient(circle, ${colour}88, #0e1115)`,
        );
      }),
  );
  barFill.style.width = `${share}%`;
  barText.textContent = `${share}% of all damage`;
  combos.replaceChildren(
    ...recipes.map((x) => {
      const b = el('button', '', `✦ ${x.name}`);
      b.dataset.a = 'combine:' + x.name;
      b.title = x.parts.map((p) => p.def.name).join(' + ');
      return b;
    }),
    ...skillButtons(t),
  );
}

let lastHud = '',
  lastLog = -1;
function updateHud() {
  if (game.log.length !== lastLog) {
    lastLog = game.log.length; // any command (click, replay, console) may change the board
    view.invalidate();
  }
  const step = game.step;
  const hint = builder
    ? 'Maze builder: click to add or remove stones · 📖 Book → Maze helpers to load or compare'
    : removing
      ? 'Click a stone to shatter it'
      : step === 'place'
        ? `Place gem ${game.placed.length + 1} of 5`
        : step === 'choose'
          ? sel
            ? `Selected ${sel.def.name}: keep, merge or combine it`
            : 'Click one of this round’s gems to select it'
          : step === 'won'
            ? `You win! Score ${score(game)}`
            : step === 'lost'
              ? `Game over. Score ${score(game)}`
              : speed
                ? `Wave in progress ×${speed}`
                : 'Paused (Space)';
  const lvlFrom = game.xpFor[game.level - 1] ?? 0,
    lvlTo = game.xpFor[game.level];
  const xpPct = lvlTo ? ((game.xp - lvlFrom) / (lvlTo - lvlFrom)) * 100 : 100;
  const hp = Math.max(0, sim.castleHp);
  const tags = [
    replaying && 'Replay',
    builder && 'Maze builder',
    cfg.daily && `Daily ${cfg.daily}`,
    !builder && cfg.difficulty,
  ].filter(Boolean);
  const s =
    tags.map((t) => `<span class="tag">${t}</span>`).join('') +
    (builder
      ? ''
      : `<span class="chip"><b>Wave</b> ${sim.wave}/${sim.lastWave}</span>` +
        `<span class="chip" id="hp"><b>HP</b> <span class="bar hp"><i style="width:${hp}%"></i></span>${hp}/${CASTLE_HP}</span>` +
        (game.pray
          ? `<span class="chip" title="Pray: ${game.pray.chance}% chance for the next gem">🙏 ${game.pray.chance}%</span>`
          : '') +
        (sim.guard.t > 0
          ? `<span class="chip" title="Guard: bites deal ${sim.guard.v} less">🛡 ${Math.ceil(sim.guard.t)}s</span>`
          : '') +
        (sim.evade.t > 0
          ? `<span class="chip" title="Evade: ${sim.evade.v}% dodge">💨 ${Math.ceil(sim.evade.t)}s</span>`
          : '') +
        `<span class="chip" id="gold"><b>Gold</b> ${game.gold}</span>` +
        `<span class="chip"><b>Time</b> ${Math.floor(game.seconds)}s</span>`);
  const live = sel && combat.towers.includes(sel) ? sel : null;
  if (!live) sel = null;
  const creep = selCreep?.alive ? selCreep : null;
  selCreep = view.creep = creep;
  const recipes = live ? game.recipesFor(live) : [];
  const total = combat.towers.reduce((n, t) => n + t.damageDealt, 0) || 1;
  const share = live ? Math.round((live.damageDealt / total) * 100) : 0;
  const key =
    s +
    hint +
    speed +
    removing +
    view.guide +
    view.showPath +
    view.showRanges +
    book.open +
    guide?.name +
    mazeVer +
    game.xp +
    game.kills +
    recipes.map((x) => x.name) +
    combat.towers.length +
    sim.phase +
    live?.def.name +
    live?.kills +
    share +
    (live ? statuses(live).map((x) => x[0] + x[1]) : '') +
    (creep
      ? `${Math.ceil(creep.hp)}` + creepStatuses(creep).map((x) => x[0] + x[1]) + sim.speed(creep)
      : '');
  if (key !== lastHud) {
    lastHud = key;
    hud.innerHTML = s;
    hintEl.textContent = hint;
    if (game.gold > prevGold) flashEl('gold', 'pop');
    if (hp < prevHp) flashEl('hp', 'hit');
    [prevGold, prevHp] = [game.gold, hp];
    panel.dataset.view = builder ? 'builder' : live ? 'tower' : creep ? 'creep' : 'hero';
    if (builder) drawBuilder();
    else if (live) drawTower(live, recipes, share);
    else if (creep) drawCreep(creep);
    else drawHero(xpPct, lvlTo);
    statusEl.replaceChildren(
      ...(builder ? [] : live ? statuses(live) : creep ? creepStatuses(creep) : []).map(
        ([id, badge, tip, bad]) => {
          const b = el('span', bad ? 'bad' : '');
          const im = document.createElement('img');
          im.src = skillIcon(id);
          im.alt = tip.split('\n')[0];
          b.append(im);
          if (badge) b.append(el('b', '', badge));
          b.title = tip;
          return b;
        },
      ),
    );
    book.draw();
    // Highlight every tower that can combine into something right now.
    view.hints =
      sim.phase === 'build'
        ? combat.towers.filter((t) => game.recipesFor(t).length).map((t) => maze.idx(t.c, t.r))
        : [];
    view.selected = sel ? maze.idx(sel.c, sel.r) : -1;
    const en: Record<string, boolean> = {
      keep: !!sel && step === 'choose',
      merge2: !!sel && game.canMerge(sel, 2),
      merge4: !!sel && game.canMerge(sel, 4),
      down: !!sel && game.canDowngrade(sel),
      stone: step === 'place',
      level: game.levelCost !== null && game.gold >= game.levelCost,
      guide: true,
      path: true,
      ranges: true,
      book: true,
      clear: builder,
      save: builder,
      deselect: true,
      pause: true,
      speed: true,
      menu: true,
    };
    for (const b of buttons) b.disabled = !en[b.dataset.a!];
    label('down', `Down ${DOWNGRADE_COST}g`);
    label('level', `Level ${game.levelCost ?? '—'}g`);
    label('speed', `×${settings.speed}`);
    label('pause', speed ? 'Pause' : 'Resume');
    label('guide', guide?.name ?? 'Guide');
    for (const b of buttons)
      b.classList.toggle(
        'on',
        (b.dataset.a === 'stone' && removing) ||
          (b.dataset.a === 'guide' && !!guide) ||
          (b.dataset.a === 'path' && view.showPath) ||
          (b.dataset.a === 'ranges' && view.showRanges) ||
          (b.dataset.a === 'book' && book.open),
      );
  }
}

// Perf stats, averaged per second; also exposed for the e2e budget check.
const perf = { fps: 0, tickMs: 0, drawMs: 0, creeps: 0, towers: 0, shots: 0, particles: 0 };
(window as unknown as { perf: typeof perf }).perf = perf;
let frames = 0,
  ticks = 0,
  tickT = 0,
  drawT = 0,
  second = performance.now();

let last = performance.now(),
  acc = 0;
requestAnimationFrame(function frame(now) {
  const dt = Math.min((now - last) / 1000, 0.25);
  acc = Math.min(acc + dt * speed, 0.25 * Math.max(1, speed));
  last = now;
  let ticked = false;
  if (replaying && sim.phase === 'build' && replaying[ri] && now >= nextCmdAt) {
    run(replaying[ri++][1]);
    nextCmdAt = now + 250 / Math.max(1, speed);
  }
  if (builder) acc = 0; // nothing runs in the builder
  for (; acc >= TICK; acc -= TICK) {
    const t0 = performance.now();
    // Replay: mid-wave commands (level buys) land on the tick they were issued.
    while (replaying?.[ri] && sim.phase === 'wave' && game.ticks >= replaying[ri][0])
      run(replaying[ri++][1]);
    game.tick();
    if (stress) topUpStress();
    tickT += performance.now() - t0;
    ticks++;
    ticked = true;
  }
  const t0 = performance.now();
  if (ticked) view.sparks();
  view.render(acc / TICK, dt, now);
  drawT += performance.now() - t0;
  frames++;
  if (!stress) updateHud();
  if (game.over && !recorded) recordScore();
  sounds();

  if (now - second >= 1000) {
    Object.assign(perf, {
      fps: Math.round((frames * 1000) / (now - second)),
      tickMs: +(tickT / Math.max(1, ticks)).toFixed(2),
      drawMs: +(drawT / frames).toFixed(2),
      creeps: sim.creeps.length,
      towers: combat.towers.length,
      shots: combat.shots.length,
      particles: view.particles,
    });
    if (!debug.hidden)
      debug.textContent = Object.entries(perf)
        .map(([k, v]) => `${k} ${v}`)
        .join('\n');
    frames = ticks = tickT = drawT = 0;
    second = now;
  }
  requestAnimationFrame(frame);
});
// PWA install/offline cache; service workers don't exist on file:// (the single file works as-is).
if (import.meta.env.PROD && location.protocol.startsWith('http') && 'serviceWorker' in navigator)
  navigator.serviceWorker.register('sw.js').catch(() => {});
document.body.dataset.ready = '1';
