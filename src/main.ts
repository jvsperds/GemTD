import gems from '../data/gems.json';
import map from '../data/map.json';
import waves from '../data/waves.json';
import { GEM_COLOR, Renderer } from './render';
import { Maze, type MapData } from './sim/maze';
import { Combat, type GemDef } from './sim/towers';
import { TICK, WaveSim, type WaveEntry } from './sim/waves';

const canvas = document.querySelector<HTMLCanvasElement>('#game')!;
const hud = document.querySelector<HTMLElement>('#hud')!;
const debug = document.querySelector<HTMLElement>('#debug')!;
const maze = new Maze(map as unknown as MapData);
const sim = new WaveSim(maze, waves as WaveEntry[]);
const combat = new Combat(sim, gems as Record<string, GemDef>);
const view = new Renderer(canvas, maze, sim, combat);
const stress = location.hash === '#stress';
let gemType = ''; // '' = rock mode
let gemQuality = 1;

canvas.addEventListener('click', (e) => {
  const [c, r] = view.screenToCell(e.clientX, e.clientY);
  if (sim.phase !== 'build') return;
  if (c < 0 || r < 0 || c >= maze.w || r >= maze.h) return;
  const ok =
    combat.remove(c, r) ||
    (gemType ? combat.place(gemType + gemQuality, c, r) : maze.placeRock(c, r));
  if (!ok) [view.flash, view.flashUntil] = [maze.idx(c, r), performance.now() + 300];
  view.invalidate();
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
  if (e.code === 'Space') sim.startWave();
  else if (e.key === 'F3') {
    e.preventDefault();
    debug.hidden = !debug.hidden;
  } else if (e.key === 'x') gemType = '';
  else if (/^[1-6]$/.test(e.key)) gemQuality = +e.key;
  else if (GEM_COLOR[e.key.toUpperCase()]) gemType = e.key.toUpperCase();
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
  const mode = gemType ? `${gemType}${gemQuality}` : 'rock';
  const s =
    `Wave ${sim.wave} · ${sim.phase} · HP ${sim.castleHp} · path ${total.toFixed(1)} · ` +
    `placing ${mode} — click place/remove, Space wave, wheel zoom, right-drag pan, F3 debug`;
  if (s !== lastHud) hud.textContent = lastHud = s;
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
    sim.tick();
    combat.tick();
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
