import map from '../data/map.json';
import { Maze, ROCK, WALL, type MapData } from './sim/maze';

const canvas = document.querySelector<HTMLCanvasElement>('#game')!;
const ctx = canvas.getContext('2d')!;
const maze = new Maze(map as unknown as MapData);
let route = maze.route()!;
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
  if (c < 0 || r < 0 || c >= maze.w || r >= maze.h) return;
  if (!maze.removeRock(c, r) && !maze.placeRock(c, r)) flash = maze.idx(c, r);
  route = maze.route()!;
  draw();
});

addEventListener('resize', draw);
draw();
document.body.dataset.ready = '1';
