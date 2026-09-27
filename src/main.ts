import { data } from './data';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;

function resize() {
  canvas.width = innerWidth;
  canvas.height = innerHeight;
  ctx.fillStyle = '#ccc';
  ctx.font = '16px sans-serif';
  ctx.fillText(`Gem TD — ${data.gems.length} gems, ${data.waves.length} waves loaded`, 16, 32);
}
addEventListener('resize', resize);
resize();
