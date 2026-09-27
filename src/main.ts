const canvas = document.querySelector<HTMLCanvasElement>('#game')!;
const ctx = canvas.getContext('2d')!;

function resize() {
  canvas.width = innerWidth;
  canvas.height = innerHeight;
  ctx.fillStyle = '#111';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
}

addEventListener('resize', resize);
resize();
document.body.dataset.ready = '1';
