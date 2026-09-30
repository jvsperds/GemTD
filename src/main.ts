import waves from '../data/waves.json';
import * as db from './persist';
import rawAdvanced from '../data/raw/advanced_towers.json';
import rawBase from '../data/raw/base_towers.json';
import { PEDAL_TIPS } from './sim/pedals';
import { skillIcon } from './icons';
import { GEM_COLOR, Renderer, creepIcon, towerIcon } from './render';
import * as sfx from './sfx';
import { DOWNGRADE_COST, score, type Cmd, type LogEntry } from './sim/game';
import { newGame, type Difficulty } from './sim/setup';
import { DEFAULT_HERO, HEROES, RARITY_COLOR } from './sim/heroes';
import { SKILLS, bringLimit, shellsFor, skillTip, type Loadout } from './sim/skills';
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
const hud = document.querySelector<HTMLElement>('#hudinfo')!;
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
  hero?: string;
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
// A new game takes the picked hero and skills; a resume or replay keeps the ones it started with.
const past = start?.replay ? start : save;
const pick = HEROES[hero.hero ?? ''] ? hero.hero! : DEFAULT_HERO;
game.skills = past
  ? (past.skills ?? {})
  : Object.fromEntries(
      (hero.bring ?? [])
        .filter((id) => hero.skills[id])
        .slice(0, bringLimit(pick))
        .map((id) => [id, hero.skills[id]]),
    );
game.setHero(past ? (past.hero ?? '') : pick);
// Resume: waves before the last command replay headless. A save the current rules can't replay
// (corrupt, or left by an older build) is dropped rather than leaving a blank page.
if (save)
  try {
    game.replay(save.commands);
  } catch (e) {
    console.warn('dropping unreadable save', e);
    await db.set('save', null);
    location.reload();
  }
const replaying = start?.replay ?? null; // watch mode: commands are fed live, input is off
const builder = !!start?.builder; // maze builder: free stone editing, no gems or waves
let ri = 0,
  nextCmdAt = 0;
const { combat, sim } = game;
const { maze } = sim;
(window as unknown as { gemtd: typeof game }).gemtd = game; // for e2e / debugging
const view = new Renderer(canvas, maze, sim, combat);
let removing = false; // Remove-stone mode
// A skill waiting for map clicks (Swap, StoneHenge, Whirl, Candy); cells as flat [c, r, ...].
let picking: { id: string; tower: Tower | null; cells: number[] } | null = null;
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
  // Recipe tooltip: stats, then each ability's wiki description.
  tip: (d) =>
    [
      d.pedal ? '' : `Damage ${d.damage} · Range ${d.range} · Attack ${d.attackRate}s`,
      ...d.abilities.flatMap((id) => {
        const a = ABILITY.get(id);
        return a ? [`${a.name}: ${a.tip}`] : [];
      }),
    ]
      .filter(Boolean)
      .join('\n\n'),
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
if (!save && !start && !stress) menu.newGame(); // fresh visit: pick a trial first
initDmgChart(() => combat.towers, canvas);

const saveNow = (commands = game.log) =>
  db.set('save', {
    seed: game.seed,
    difficulty: cfg.difficulty,
    daily: cfg.daily,
    commands,
    version: db.VERSION,
    skills: game.skills,
    hero: game.hero,
  });
if (!replaying && !stress && !builder) {
  game.onCommand = () => saveNow();
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
  if (picking) {
    // A skill waiting for map cells: collect them, then cast.
    picking.cells.push(c, r);
    const s = SKILLS[picking.id];
    if (picking.cells.length / 2 < s.picks!.length) return;
    const [c1, r1, c2, r2] = picking.cells;
    const cmd: Cmd = s.tower
      ? ['skill', picking.tower!.c, picking.tower!.r, picking.id, c1, r1]
      : ['skill', c1, r1, picking.id, c2, r2];
    picking = null;
    if (!run(cmd)) {
      [view.flash, view.flashUntil] = [maze.idx(c, r), performance.now() + 300];
      sfx.play('refuse');
    }
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
      : game.pedals.length
        ? run(['pedal', c, r])
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
  if (a === 'deselect') return ((sel = selCreep = picking = null), (removing = false));
  if (a === 'pause') return (speed = speed ? 0 : settings.speed || 1);
  if (a === 'speed') {
    speed = settings.speed = { 1: 2, 2: 4, 4: 10, 10: 20 }[settings.speed] ?? 1;
    return db.set('settings', settings);
  }
  if (replaying) return;
  if (a.startsWith('skill:')) {
    const id = a.slice(6);
    if (SKILLS[id].picks) picking = picking?.id === id ? null : { id, tower: sel, cells: [] };
    else run(['skill', sel?.c ?? -1, sel?.r ?? -1, id]);
  } else if (a === 'stone') removing = !removing;
  // Undo: save the log minus the last placement and resume from it. Gem rolls come from the seeded
  // rng, so the re-placed gem is the same gem: this moves it, it can't reroll it.
  // ponytail: resumes via reload (replays the whole log); do it in place if late-game undo lags.
  else if (a === 'undo' && canUndo())
    void saveNow(game.log.slice(0, -1)).then(() => location.reload());
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
  u: 'undo',
  g: 'guide',
  p: 'path',
  v: 'ranges',
  h: 'book',
  Escape: 'deselect',
  b: 'menu',
  ' ': 'pause',
};
const buttons = [
  ...document.querySelectorAll<HTMLButtonElement>('#actions button, #dock button, #menubtn'),
];
for (const b of buttons) b.addEventListener('click', () => act(b.dataset.a!));
const combos = document.querySelector<HTMLElement>('#combos')!;
// The HUD rebuilds these buttons every tick during a wave, so a mouse click (down and up on the
// same element) rarely lands: act on pointerdown, and on click only for keyboard activation.
for (const box of [combos, document.querySelector<HTMLElement>('#cards')!]) {
  const fire = (e: Event) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-a]');
    if (b && !b.disabled) act(b.dataset.a!);
  };
  box.addEventListener('pointerdown', (e) => e.button === 0 && fire(e));
  box.addEventListener('click', (e) => e.detail === 0 && fire(e));
}
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
  else if (/^[1-5]$/.test(e.key)) speed = settings.speed = [1, 2, 4, 10, 20][+e.key - 1];
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
    won: game.wavesCleared >= sim.lastWave,
    date: Date.now(),
    version: db.VERSION,
    commands: game.log,
    skills: game.skills,
    hero: game.hero,
  });
  await db.set('scores', scores);
  await db.set('save', null);
  const shells = shellsFor(game.wavesCleared, game.wavesCleared >= sim.lastWave);
  const h = await db.get('hero');
  await db.set('hero', { ...h, shells: h.shells + shells });
  menu.show({
    score: score(game),
    won: game.wavesCleared >= sim.lastWave,
    shells,
    summary: summary(),
  });
}
/** Game-over recap: run totals, then the five towers that did the most damage. */
function summary() {
  const total = combat.towers.reduce((n, t) => n + t.damageDealt, 0) || 1;
  const top = [...combat.towers].sort((a, b) => b.damageDealt - a.damageDealt).slice(0, 5);
  const m = Math.round(game.seconds);
  return {
    lines: [
      `Waves ${game.wavesCleared}`,
      `Kills ${game.kills}`,
      `Level ${game.level}`,
      `Castle ${Math.max(0, Math.round(sim.castleHp))} HP`,
      `Time ${(m / 60) | 0}:${String(m % 60).padStart(2, '0')}`,
    ],
    towers: top.map((t) => ({
      name: t.def.name,
      share: Math.round((t.damageDealt / total) * 100),
      kills: t.kills,
      mvp: t.mvp,
    })),
  };
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

// Wave banner: number and creep, shown as each wave starts.
const banner = document.querySelector<HTMLElement>('#banner')!;
let bannerWave = sim.wave; // a resumed wave in progress gets no banner
function showBanner() {
  bannerWave = sim.wave;
  const d = sim.current;
  if (!d) return;
  const tags = [d.boss && 'Boss', d.flying && 'Flying', sim.wave > sim.lastWave && 'Endless']
    .filter(Boolean)
    .join(' · ');
  banner.innerHTML = `<img alt="" src="${creepIcon(d.name)}"><div><b>WAVE ${sim.wave}</b><span></span></div>`;
  banner.querySelector('span')!.textContent = d.name + (tags ? ` · ${tags}` : '');
  banner.hidden = true;
  void banner.offsetWidth; // restart the animation
  banner.hidden = false;
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
        : sim.phase === 'lost'
          ? 'lose'
          : sim.wave === sim.lastWave
            ? 'win'
            : 'keep',
    );
  prev = { kills: game.kills, hp: sim.castleHp, phase: sim.phase };
}

const QUALITY_COLOR = ['#8a8070', '#2fbf5a', '#3a6bff', '#a24de0', '#f2c52e', '#ff5a3c'];
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
    // eNNNN entries are cosmetic effects with no name or tooltip.
    t.abilities.filter((a) => a.Name).map((a) => [a.id, { name: a.Name, tip: a.Tooltip }] as const),
  ),
);
for (const [id, a] of PEDAL_TIPS) ABILITY.set(id, a);
const panel = document.querySelector<HTMLElement>('#panel')!;
const portraitEl = document.querySelector<HTMLElement>('#portrait')!;
const nameEl = document.querySelector<HTMLElement>('#name')!;
const attrs = document.querySelector<HTMLElement>('#attrs')!;
const cards = document.querySelector<HTMLElement>('#cards')!;
const statusEl = document.querySelector<HTMLElement>('#status')!;
/** Auras and debuffs currently on a tower: [icon id, level badge, tooltip, is a debuff]. */
function statuses(t: Tower): [string, string, string, boolean][] {
  const out: [string, string, string, boolean][] = [];
  // One card per aura source, so stacked auras read as [1] [2] [4] rather than a merged total.
  for (const { kind, value, from } of t.aura.src) {
    const by = `
from ${from.def.name}`;
    if (kind === 'as') {
      const n = AURA.indexOf(value) + 1;
      out.push([
        'tower_speed_aura',
        n ? String(n) : '+',
        `Attack speed aura ${n || ''}
+${value}% attack speed${by}`,
        false,
      ]);
    } else if (kind === 'dmg')
      out.push([
        'tower_baoji',
        '',
        `Damage aura
+${value * 100}% damage${by}`,
        false,
      ]);
    else if (kind === 'range')
      out.push([
        'status_range',
        '',
        `Range aura
+${value} attack range${by}`,
        false,
      ]);
    else if (kind === 'aim')
      out.push([
        'status_aim',
        '',
        `Aim aura
Attacks cannot miss (ignores evasion)${by}`,
        false,
      ]);
    else
      out.push([
        'status_calm',
        '',
        `Calm aura
Immune to Disarm${by}`,
        false,
      ]);
  }
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
  if (t.crit.t > 0)
    out.push([
      'tower_baoji',
      '',
      `Crit\n20% chance for ${t.crit.v}× damage, ${Math.ceil(t.crit.t)}s left`,
      false,
    ]);
  if (t.bonds.t > 0)
    out.push([
      'status_aim',
      '',
      `Fatal Bonds\n${t.bonds.v}% pure damage to the farthest enemy, ${Math.ceil(t.bonds.t)}s left`,
      false,
    ]);
  if (t.melancholyT > 0)
    out.push([
      'tower_aojiao',
      '',
      `Melancholy
Attacks deal no damage for ${t.melancholyT.toFixed(1)}s`,
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
  nameEl.textContent = (d.giant ? 'Giant ' : '') + d.name + (d.boss ? ' (boss)' : '');
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
  combos.className = '';
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
        `${s.icon} ${s.name} ${game.skillGold(id)}g`,
      ) as HTMLButtonElement;
      b.dataset.a = 'skill:' + id;
      b.title = `${s.name} (level ${lvl}): ${skillTip(id, lvl)}`;
      b.disabled = !!replaying || !game.canCast(id, t);
      return b;
    });
}
/** Ability slot button in the main row: icon, caption, hotkey badge, skill level pips. */
function slot(
  icon: string,
  caption: string,
  tip: string,
  a: string,
  key: string,
  o: { off?: boolean; on?: boolean; lvl?: number },
) {
  const b = document.createElement('button');
  b.className = 'slot' + (o.on ? ' on' : '');
  b.dataset.a = a;
  b.title = tip;
  b.disabled = !!o.off;
  b.append(el('i', '', icon), el('small', '', caption));
  if (key) b.append(el('kbd', '', key));
  if (o.lvl) b.append(el('u', '', '•'.repeat(o.lvl)));
  return b;
}
/** Only this round's last gem placement can be undone. */
const canUndo = () =>
  !replaying && !builder && sim.phase === 'build' && game.log.at(-1)?.[1][0] === 'place';
/** Default view: the builder "hero" — level, XP, gem odds. */
function drawHero(xpPct: number, lvlTo: number | undefined) {
  const h = HEROES[game.hero];
  setPortrait(undefined, h?.icon ?? '👑', h ? RARITY_COLOR[h.rarity] : '');
  nameEl.textContent = h ? `${h.name} ${h.title}` : 'Gem Builder';
  nameEl.title = h ? `${h.rarity} hero: ${h.tip}` : '';
  setAttrs([
    ['Level', String(game.level)],
    ['Gold', String(game.gold)],
    ['Next lvl', game.levelCost === null ? 'max' : `${game.levelCost}g`],
    ['Towers', String(combat.towers.length)],
    ['Kills', String(game.kills)],
  ]);
  // Ability row: Level and Stone, then the brought skills (tower skills need a selected tower).
  const ids = Object.keys(game.skills).filter((id) => SKILLS[id]);
  const cost = game.levelCost;
  cards.replaceChildren(
    slot('✨', `Level ${cost ?? '—'}g`, 'Buy the next builder level', 'level', 'L', {
      off: !!replaying || cost === null || game.gold < cost,
    }),
    slot('⛏', 'Stone', 'Shatter a stone (while placing gems)', 'stone', 'R', {
      off: !!replaying || game.step !== 'place',
      on: removing,
    }),
    slot('↶', 'Undo', 'Take back the last gem you placed', 'undo', 'U', { off: !canUndo() }),
    ...ids.map((id) => {
      const s = SKILLS[id],
        lvl = game.skills[id];
      return slot(
        s.icon,
        `${s.name} ${game.skillGold(id)}g`,
        `${s.name} (level ${lvl}): ${skillTip(id, lvl)}${s.tower ? '\nSelect a tower to cast' : ''}`,
        'skill:' + id,
        '',
        { off: !!replaying || !!s.tower || !game.canCast(id), on: picking?.id === id, lvl },
      );
    }),
  );
  barFill.style.width = `${xpPct}%`;
  barText.textContent = lvlTo
    ? `Level ${game.level} · ${Math.floor(game.xp)} / ${Math.ceil(lvlTo)} XP`
    : `Level ${game.level} · max`;
  // Gem quality odds, one row below the XP bar.
  combos.className = 'oddsrow';
  combos.replaceChildren(
    ...game.odds.map((p, q) => {
      const o = el('span', 'odds', `◆ ${p}%`);
      o.style.color = p ? QUALITY_COLOR[q] : '#555';
      o.title = `Chance of a quality ${q + 1} gem`;
      return o;
    }),
  );
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
  combos.className = '';
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
  const skillCards = (src: typeof d, from = '') =>
    src.abilities
      .filter((id) => ABILITY.has(id) && !/^tower_attack/.test(id))
      .map((id) => {
        const a = ABILITY.get(id)!;
        const name = a.name ?? id;
        const c = GEM_COLOR[src.quality ? src.type : 'S'];
        return card(
          skillIcon(id),
          name,
          `${name}${from}: ${a.tip ?? ''}`,
          `radial-gradient(circle, ${c}88, #0e1115)`,
        );
      });
  cards.replaceChildren(
    ...skillCards(d),
    ...(t.copiedFrom ?? []).flatMap((o) => skillCards(o, ` (copied from ${o.name})`)),
  );
  barFill.style.width = `${share}%`;
  barText.textContent = `${share}% of all damage`;
  combos.className = '';
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
    : picking
      ? `${SKILLS[picking.id].name}: ${SKILLS[picking.id].picks![picking.cells.length / 2]} (Esc cancels)`
      : removing
        ? 'Click a stone to shatter it'
        : game.pedals.length
          ? `Lay your ${game.pedals[0]} on the path: creeps set it off by stepping on it`
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
      : `<span class="chip"><b>Wave</b> ${sim.wave > sim.lastWave ? `${sim.wave} ∞` : `${sim.wave}/${sim.lastWave}`}</span>` +
        `<span class="chip" id="hp"><b>HP</b> <span class="bar hp"><i style="width:${hp}%"></i></span>${hp}/${CASTLE_HP}</span>` +
        (game.pray
          ? `<span class="chip" title="Pray: ${game.pray.chance}% chance for the next gem">🙏 ${game.pray.chance}%</span>`
          : '') +
        (sim.revenge.t > 0
          ? `<span class="chip" title="Revenge: towers +1% damage per HP below ${sim.revenge.v}">🔥 ${Math.ceil(sim.revenge.t)}s</span>`
          : '') +
        (sim.candy ? `<span class="chip" title="Candy Marker at ${sim.candy}">🍬</span>` : '') +
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
    game.pedals.length +
    sim.phase +
    live?.def.name +
    (live ? maze.idx(live.c, live.r) : '') + // same-type towers differ only by cell
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
    // Glow the round's gems until one is kept, merged or combined.
    view.pending = step === 'choose' ? game.placed.map((t) => maze.idx(t.c, t.r)) : [];
    const en: Record<string, boolean> = {
      keep: !!sel && step === 'choose' && game.placed.includes(sel),
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
  if (sim.wave !== bannerWave && sim.phase === 'wave' && !stress) showBanner();

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
