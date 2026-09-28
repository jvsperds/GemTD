import { expect, test } from '@playwright/test';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

type G = {
  over: boolean;
  sim: { phase: string; castleHp: number };
  run(c: unknown[]): boolean;
  tick(): void;
};

// BUILD.md Phase 6 exit: finish a game → the score is on the board after a reload, offline.
test('finished game is on the leaderboard after reload with network blocked', async ({
  page,
  context,
}) => {
  await context.route(/^https?:/, (r) => r.abort());
  const url = pathToFileURL(resolve('dist/index.html')).href;
  await page.goto(url);
  await expect(page.locator('body[data-ready="1"]')).toBeAttached();
  // Lose fast: stones far from the route, keep a gem, let every wave leak (headless ticks).
  await page.evaluate(() => {
    const g = (window as unknown as { gemtd: G }).gemtd;
    let n = 0;
    while (!g.over) {
      const placed: [number, number][] = [];
      for (let k = 0; k < 5; k++) {
        for (; ; n++) {
          const c = 20 + (n % 12),
            r = 22 + Math.floor(n / 12);
          if (g.run(['place', c, r])) {
            placed.push([c, r]);
            n++;
            break;
          }
        }
      }
      g.run(['keep', ...placed[0]]);
      while (g.sim.phase === 'wave') g.tick();
    }
  });
  await expect(page.locator('#menu')).toBeVisible();
  await expect(page.locator('#rows')).toContainText('Player');
  await page.reload();
  await expect(page.locator('body[data-ready="1"]')).toBeAttached();
  await page.keyboard.press('b');
  await expect(page.locator('#rows tr')).toHaveCount(1);
  await expect(page.locator('#rows')).toContainText('Player');
  await expect(page.locator('#hud')).toContainText('Wave 0/');

  // Phase 7: the stored command log replays the finished game.
  await page.locator('#rows button', { hasText: 'Watch' }).click();
  await expect(page.locator('body[data-ready="1"]')).toBeAttached();
  await expect(page.locator('#hud')).toContainText('Replay');
  await expect(page.locator('#hud')).toContainText('Wave 1/', { timeout: 10000 });
});
