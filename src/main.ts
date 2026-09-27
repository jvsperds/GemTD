import gems from '../data/gems.json';
import map from '../data/map.json';
import waves from '../data/waves.json';
import { Maze, ROCK, WALL, type MapData } from './sim/maze';
import { Combat, type GemDef } from './sim/towers';
import { TICK, WaveSim, type WaveEntry } from './sim/waves';

const GEM_COLOR: Record<string, string> = {
  B: '#3a6bff',
  D: '#e8f4ff',
  E: '#f0e6c8',
  G: '#2fbf5a',
  P: '#a24de0',
  Q: '#4fe0d8',
  R: '#e03a3a',
  Y: '#f2c52e',
};

const canvas = document.querySelector<HTMLCanvasElement>('#game')!;
const ctx = canvas.getContext('2d')!;
const maze = new Maze(map as unknown as MapData);
let route = maze.route()!;
const sim = new WaveSim(maze, waves as WaveEntry[]);
const combat = new Combat(sim, gems as Record<string, GemDef>);
let gemType = ''; // '' = rock mode
let gemQuality = 1;
let flash = -1; // cell index of a refused placement, drawn red once

function layout() {
  const size = Math.floor(Math.min(innerWidth, innerHeight - 32) / maze.w);
  return { size, ox: Math.floor((innerWidth - size * maze.w) / 2), oy: 32 };
}

function draw() {
  canvas.width = innerWidth;
  canvas.height = innerHeight;
  const { size, ox, oy } = layout();
  ctx.fillStyle = '#111';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  for (let r = 0; r < maze.h; r++)
    for (let c = 0; c < maze.w; c++) {
      const i = maze.idx(c, r);
      const cell = maze.cells[i];
      ctx.fillStyle =
        i === flash
          ? '#a33'
          : cell === WALL
            ? '#000'
            : cell === ROCK
              ? '#8a8a8a'
              : maze.noBuild[i]
                ? '#2a2a2a'
                : '#3b4a3b';
      ctx.fillRect(ox + c * size, oy + r * size, size - 1, size - 1);
    }

  ctx.strokeStyle = '#ffd24a';
  ctx.lineWidth = Math.max(1, size / 6);
  ctx.beginPath();
  route.forEach((field, s) =>
    maze
      .walk(field, maze.waypoints[s])
      .forEach(([c, r], k) =>
        ctx[k ? 'lineTo' : 'moveTo'](ox + (c + 0.5) * size, oy + (r + 0.5) * size),
      ),
  );
  ctx.stroke();

  for (const t of combat.towers) {
    ctx.fillStyle = GEM_COLOR[t.def.type];
    ctx.fillRect(ox + t.c * size + 1, oy + t.r * size + 1, size - 3, size - 3);
    ctx.fillStyle = '#000';
    ctx.font = `${Math.max(8, size * 0.5)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(t.def.quality), ox + (t.c + 0.5) * size, oy + (t.r + 0.5) * size);
  }
  for (const cr of sim.creeps) {
    ctx.fillStyle = cr.def.flying ? '#9cf' : cr.slow ? '#88f' : cr.poison ? '#6c6' : '#e84';
    ctx.beginPath();
    ctx.arc(ox + cr.x * size, oy + cr.y * size, size * (cr.def.boss ? 0.6 : 0.35), 0, 7);
    ctx.fill();
  }
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (const { from, to } of combat.shots) {
    ctx.moveTo(ox + (from.c + 0.5) * size, oy + (from.r + 0.5) * size);
    ctx.lineTo(ox + to.x * size, oy + to.y * size);
  }
  ctx.stroke();

  ctx.fillStyle = '#fff';
  ctx.font = `${Math.max(10, size * 0.6)}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  maze.waypoints.forEach(([c, r], k) =>
    ctx.fillText(
      k === 0 ? 'S' : k === maze.waypoints.length - 1 ? 'E' : String(k),
      ox + (c + 0.5) * size,
      oy + (r + 0.5) * size,
    ),
  );

  const total = maze.segmentLengths(route).reduce((a, b) => a + b);
  ctx.textAlign = 'left';
  ctx.font = '14px sans-serif';
  ctx.fillText(`Path length ${total.toFixed(1)} — click to place/remove rocks`, 8, 16);
  flash = -1;
}

canvas.addEventListener('click', (e) => {
  const { size, ox, oy } = layout();
  const c = Math.floor((e.clientX - ox) / size);
  const r = Math.floor((e.clientY - oy) / size);
  if (sim.phase !== 'build') return;
  if (c < 0 || r < 0 || c >= maze.w || r >= maze.h) return;
  const ok =
    combat.remove(c, r) ||
    (gemType ? combat.place(gemType + gemQuality, c, r) : maze.placeRock(c, r));
  if (!ok) flash = maze.idx(c, r);
  route = maze.route()!;
  draw();
});

addEventListener('keydown', (e) => {
  if (e.code === 'Space') sim.startWave();
  else if (e.key === 'x') gemType = '';
  else if (/^[1-6]$/.test(e.key)) gemQuality = +e.key;
  else if (GEM_COLOR[e.key.toUpperCase()]) gemType = e.key.toUpperCase();
});

// ponytail: redraws the whole grid each frame; layered renderer is Phase 2.5.
let last = performance.now(),
  acc = 0;
requestAnimationFrame(function frame(now) {
  acc = Math.min(acc + (now - last) / 1000, 0.25);
  last = now;
  for (; acc >= TICK; acc -= TICK) {
    sim.tick();
    combat.tick();
  }
  draw();
  requestAnimationFrame(frame);
});
document.body.dataset.ready = '1';
