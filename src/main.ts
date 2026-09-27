import gems from '../data/gems.json';
import map from '../data/map.json';
import quality from '../data/quality_levels.json';
import towerData from '../data/towers.json';
import waves from '../data/waves.json';
import { GEM_COLOR, Renderer } from './render';
import { DOWNGRADE_COST, Game, type LevelDef } from './sim/game';
import { Maze, type MapData } from './sim/maze';
import { allDefs, Combat, type GemDef, type SpecialDef } from './sim/towers';
import { TICK, WaveSim, type WaveEntry } from './sim/waves';

const canvas = document.querySelector<HTMLCanvasElement>('#game')!;
const hud = document.querySelector<HTMLElement>('#hud')!;
const debug = document.querySelector<HTMLElement>('#debug')!;
const maze = new Maze(map as unknown as MapData);
const sim = new WaveSim(maze, waves as WaveEntry[]);
const combat = new Combat(
  sim,
  allDefs(gems as Record<string, GemDef>, towerData as unknown as Record<string, SpecialDef>),
);
const game = new Game(combat, quality.levels as LevelDef[], (Math.random() * 2 ** 31) | 0);
const view = new Renderer(canvas, maze, sim, combat);
const stress = location.hash === '#stress';
let removing = false; // Remove-stone mode
let sel: (typeof game.placed)[number] | null = null;

canvas.addEventListener('click', (e) => {
  const [c, r] = view.screenToCell(e.clientX, e.clientY);
  if (c < 0 || r < 0 || c >= maze.w || r >= maze.h) return;
  const hit = combat.towerAt(c, r);
  const ok = removing
    ? game.removeStone(c, r)
    : hit
      ? (sel = hit)
      : game.step === 'place' && game.place(c, r);
  removing = false;
  if (!ok) [view.flash, view.flashUntil] = [maze.idx(c, r), performance.now() + 300];
  view.invalidate();
});
function act(a: string) {
  if (a === 'stone') removing = !removing;
  else if (a === 'level') game.buyLevel();
  else if (sel) {
    if (a.startsWith('combine:')) {
      if (game.combine(sel, a.slice(8)) && game.step !== 'choose' && game.step !== 'place')
        sel = null;
    } else if (a === 'down') game.downgrade(sel);
    else if (a === 'keep' ? game.keep(sel) : game.merge(sel, a === 'merge2' ? 2 : 4)) sel = null;
    view.invalidate();
  }
}
const keys: Record<string, string> = {
  k: 'keep',
  m: 'merge2',
  n: 'merge4',
  d: 'down',
  r: 'stone',
  l: 'level',
};
const buttons = [...document.querySelectorAll<HTMLButtonElement>('#panel button')];
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
addEventListener('resize', () => view.resize());
addEventListener('keydown', (e) => {
  if (e.key === 'F3') {
    e.preventDefault();
    debug.hidden = !debug.hidden;
  } else if (keys[e.key]) act(keys[e.key]);
});

if (stress) {
  // Stress scene (BUILD.md §3.7): 80 towers, 400 unkillable creeps, 1,500 tracers, 800 particles.
  const types = Object.keys(GEM_COLOR);
  for (let i = 0, n = 0; n < 80 && i < maze.w * maze.h; i += 7)
    if (combat.place(types[n % 8] + ((n % 6) + 1), i % maze.w, (i / maze.w) | 0)) n++;
  sim.startWave();
  sim.castleHp = Infinity;
  debug.hidden = false;
}
const flyer = (waves as WaveEntry[]).find((w) => w.flying)!;
function topUpStress() {
  for (let k = sim.creeps.length; k < 400; k++) {
    sim.spawn({ ...(k % 5 ? sim.waves[0] : flyer), hp: 1e12 });
  }
  const { towers, shots } = combat,
    { creeps } = sim;
  for (let k = shots.length; k < 1500; k++)
    shots.push({ from: towers[k % towers.length], to: creeps[k % creeps.length] });
}

let lastHud = '';
function updateHud() {
  const total = maze.segmentLengths(maze.route()!).reduce((a, b) => a + b);
  const step = game.step;
  const odds = game.odds
    .map((p, q) => (p ? `Q${q + 1} ${p}%` : ''))
    .filter(Boolean)
    .join(' ');
  const hint = removing
    ? 'click a stone to remove it'
    : step === 'place'
      ? `click to place gem ${game.placed.length + 1}/5`
      : step === 'choose'
        ? sel
          ? `selected ${sel.def.name}${sel.kills ? ` · ${sel.kills} kills` : ''}${sel.mvp ? ` · MVP ×${sel.mvp}` : ''}`
          : 'click one of this round’s gems to select it'
        : step === 'won'
          ? 'You win!'
          : step === 'lost'
            ? 'Game over'
            : 'wave in progress';
  const s =
    `Wave ${sim.wave}/${sim.lastWave} · HP ${sim.castleHp} · Gold ${game.gold} · ` +
    `Level ${game.level} (${Math.floor(game.xp)}/${Math.ceil(game.xpFor[game.level] ?? game.xp)} XP) · ` +
    `odds ${odds} · path ${total.toFixed(1)} — ${hint}`;
  const recipes = sel && combat.towers.includes(sel) ? game.recipesFor(sel) : [];
  const key = s + recipes.map((x) => x.name) + combat.towers.length + sim.phase;
  if (key !== lastHud) {
    lastHud = key;
    hud.textContent = s;
    combos.replaceChildren(
      ...recipes.map((x) => {
        const b = document.createElement('button');
        b.dataset.a = 'combine:' + x.name;
        b.textContent = `Combine → ${x.name}`;
        return b;
      }),
    );
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
      stone: sim.phase === 'build',
      level: game.levelCost !== null && game.gold >= game.levelCost,
    };
    for (const b of buttons) b.disabled = !en[b.dataset.a!];
    buttons[3].textContent = `Downgrade ${DOWNGRADE_COST}g (D)`;
    buttons[5].textContent = `Buy level ${game.levelCost ?? '—'}g (L)`;
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
  acc = Math.min(acc + dt, 0.25);
  last = now;
  let ticked = false;
  for (; acc >= TICK; acc -= TICK) {
    const t0 = performance.now();
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
document.body.dataset.ready = '1';
