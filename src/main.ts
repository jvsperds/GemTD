import waves from '../data/waves.json';
import * as db from './persist';
import { GEM_COLOR, Renderer } from './render';
import { DOWNGRADE_COST, score, type Cmd } from './sim/game';
import { DEFS, newGame } from './sim/setup';
import type { GemDef, SpecialDef, Tower } from './sim/towers';
import { TICK, type WaveEntry } from './sim/waves';
import { initMenu } from './ui';

const canvas = document.querySelector<HTMLCanvasElement>('#game')!;
const hud = document.querySelector<HTMLElement>('#hud')!;
const debug = document.querySelector<HTMLElement>('#debug')!;
const stress = location.hash === '#stress';
const settings = await db.get('settings');
const save = stress ? null : await db.get('save');
const game = newGame(save?.seed ?? (Math.random() * 2 ** 31) | 0);
if (save) game.replay(save.commands); // resume: waves before the last command replay headless
const { combat, sim } = game;
const { maze } = sim;
(window as unknown as { gemtd: typeof game }).gemtd = game; // for e2e / debugging
const view = new Renderer(canvas, maze, sim, combat);
let removing = false; // Remove-stone mode
let sel: Tower | null = null;
let speed = settings.speed; // 0 = paused
const menu = initMenu(settings, game, (s) => (speed = s));

game.onCommand = () => db.set('save', { seed: game.seed, commands: game.log, version: db.VERSION });
function run(cmd: Cmd) {
  const ok = game.run(cmd);
  view.invalidate();
  return ok;
}

canvas.addEventListener('click', (e) => {
  const [c, r] = view.screenToCell(e.clientX, e.clientY);
  if (c < 0 || r < 0 || c >= maze.w || r >= maze.h) return;
  const hit = combat.towerAt(c, r);
  const ok = removing
    ? run(['stone', c, r])
    : hit
      ? (sel = hit)
      : game.step === 'place' && run(['place', c, r]);
  removing = false;
  if (!ok) [view.flash, view.flashUntil] = [maze.idx(c, r), performance.now() + 300];
  view.invalidate();
});
function act(a: string) {
  if (a === 'stone') removing = !removing;
  else if (a === 'level') run(['level']);
  else if (a === 'menu') menu.toggle();
  else if (a === 'pause') speed = speed ? 0 : settings.speed || 1;
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
  b: 'menu',
  ' ': 'pause',
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
  } else if (e.target instanceof HTMLInputElement) return;
  else if (/^[123]$/.test(e.key)) speed = settings.speed = [1, 2, 4][+e.key - 1];
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
let recorded = game.over;
async function recordScore() {
  recorded = true;
  const scores = await db.get('scores');
  scores.push({
    name: settings.name,
    score: score(game),
    wavesCleared: game.wavesCleared,
    hpLeft: Math.max(0, sim.castleHp),
    timeSec: Math.round(game.seconds),
    difficulty: 'normal',
    seed: game.seed,
    won: sim.phase === 'won',
    date: Date.now(),
    version: db.VERSION,
    commands: game.log,
  });
  await db.set('scores', scores);
  await db.set('save', null);
  menu.show();
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

let lastHud = '';
function updateHud() {
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
          ? `You win! Score ${score(game)}`
          : step === 'lost'
            ? `Game over. Score ${score(game)}`
            : speed
              ? `wave in progress ×${speed}`
              : 'paused (Space)';
  const s =
    `Wave ${sim.wave}/${sim.lastWave} · HP ${sim.castleHp} · Gold ${game.gold} · ` +
    `Level ${game.level} (${Math.floor(game.xp)}/${Math.ceil(game.xpFor[game.level] ?? game.xp)} XP) · ` +
    `odds ${odds} · ${Math.floor(game.seconds)}s — ${hint}`;
  const recipes = sel && combat.towers.includes(sel) ? game.recipesFor(sel) : [];
  const key = s + recipes.map((x) => x.name) + combat.towers.length + sim.phase + sel?.def.name;
  if (key !== lastHud) {
    lastHud = key;
    hud.textContent = s;
    combos.replaceChildren(
      ...recipes.map((x) => {
        const b = document.createElement('button');
        b.dataset.a = 'combine:' + x.name;
        b.textContent = `Combine → ${x.name}`;
        b.title = x.parts.map((p) => p.def.name).join(' + ');
        return b;
      }),
    );
    // Recipe hints: every special tower the selected gem is an ingredient of.
    if (sel) {
      const code = sel.def.quality ? sel.def.type + sel.def.quality : sel.def.name;
      const uses = Object.values(DEFS)
        .filter((d) => (d as GemDef & Partial<SpecialDef>).recipes?.some((r) => r.includes(code)))
        .map(
          (d) =>
            `${d.name} = ${(d as GemDef & SpecialDef).recipes.find((r) => r.includes(code))!.join('+')}`,
        );
      if (uses.length) {
        const tip = document.createElement('span');
        tip.className = 'tip';
        tip.textContent = `${sel.def.name} (dmg ${sel.def.damage + sel.def.bonusDamage}, range ${sel.def.range}) · used in: ${uses.join(' · ')}`;
        combos.append(tip);
      }
    }
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
  acc = Math.min(acc + dt * speed, 0.25 * Math.max(1, speed));
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
  if (game.over && !recorded && !stress) recordScore();

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
