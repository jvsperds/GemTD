import { expect, test } from '@playwright/test';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

test('dist/index.html boots from file:// with network blocked', async ({ page, context }) => {
  await context.route(/^https?:/, (r) => r.abort());
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(pathToFileURL(resolve('dist/index.html')).href);
  await expect(page.locator('body[data-ready="1"]')).toBeAttached();
  await expect(page.locator('canvas#game')).toBeVisible();
  expect(errors).toEqual([]);
});

test('board has a keyboard cursor and live status', async ({ page }) => {
  await page.goto(pathToFileURL(resolve('dist/index.html')).href);
  await page.locator('#close').click();
  const board = page.locator('canvas#game');
  await board.focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('#boardstatus')).toContainText('Board cursor:');
  await expect(board).toHaveAttribute('tabindex', '0');
});

test('floating help stays below the header and within narrow viewports', async ({ page }) => {
  await page.goto(pathToFileURL(resolve('dist/index.html')).href);
  await page.locator('#close').click();
  const hint = page.locator('#hint');
  for (const width of [1280, 390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await expect(hint).toBeVisible();
    await expect
      .poll(() =>
        page.evaluate(() => {
          const header = document.querySelector('#hud')!.getBoundingClientRect();
          const toast = document.querySelector('#hint')!.getBoundingClientRect();
          const gap = toast.top - header.bottom;
          return gap >= 8 && gap <= 17;
        }),
      )
      .toBe(true);
    const box = (await hint.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(8);
    expect(box.x + box.width).toBeLessThanOrEqual(width - 8);
    expect(await hint.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  }
  await page.locator('#menubtn').click();
  await expect(hint).toBeHidden();
});

test('guides expire without repeating and stop after the opening three waves', async ({ page }) => {
  await page.clock.install();
  await page.goto(pathToFileURL(resolve('dist/index.html')).href);
  await page.locator('#close').click();
  const hint = page.locator('#hint');
  await expect(hint).toBeVisible();
  await page.clock.fastForward(8500);
  await expect(hint).toBeHidden();
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('#boardstatus')).toContainText('Board cursor:');
  await expect(hint).toBeHidden();
  type Game = { run(command: unknown[]): void; sim: { wave: number; phase: string } };
  await page.evaluate(() => (window as unknown as { gemtd: Game }).gemtd.run(['place', 10, 16]));
  await expect(hint).toBeVisible();
  await expect(hint).toContainText('Gems block creeps');
  await page.clock.fastForward(8500);
  await expect(hint).toBeHidden();
  await page.evaluate(() => (window as unknown as { gemtd: Game }).gemtd.run(['place', 11, 16]));
  await expect(hint).toBeHidden();
  await page.evaluate(() => {
    const game = (window as unknown as { gemtd: Game }).gemtd;
    game.sim.wave = 3;
    game.sim.phase = 'build';
  });
  await expect(page.locator('#hud')).toContainText('3/50');
  await page.keyboard.press('r');
  await expect(page.locator('#actionhint')).toContainText('stone to shatter');
  await expect(hint).toBeHidden();
  await page.reload();
  await expect(page.locator('body[data-ready="1"]')).toBeAttached();
  if (await page.locator('#menu').isVisible()) await page.locator('#close').click();
  await expect(hint).toBeHidden();
});
