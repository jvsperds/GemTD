import { expect, test } from '@playwright/test';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

test('place 5 gems, keep one, wave starts', async ({ page }) => {
  await page.goto(pathToFileURL(resolve('dist/index.html')).href);
  await expect(page.locator('#newdlg')).toBeVisible(); // fresh visit: new-game dialog
  await page.locator('#newgame').click();
  await expect(page.locator('#newdlg')).toBeHidden();
  await expect(page.locator('body[data-ready="1"]')).toBeAttached();
  const box = (await page.locator('canvas').boundingBox())!;
  const cell = Math.min(box.width, box.height) / 37;
  // Fit-to-window centres the map; click cells 10..14 on row 16.
  const ox = (box.width - cell * 37) / 2;
  const oy = (box.height - cell * 37) / 2;
  for (let c = 10; c < 15; c++) await page.mouse.dblclick(ox + (c + 0.5) * cell, oy + 16.5 * cell);
  // A fresh visit is the first game, so the tutorial hints replace the short ones.
  await expect(page.locator('#hint')).toContainText('gem you want to keep');
  await page.mouse.click(ox + 10.5 * cell, oy + 16.5 * cell);
  await page.keyboard.press('k');
  await expect(page.locator('#hint')).toContainText('Kills give gold');
});

test('mid-game reload resumes from the saved command log', async ({ page }) => {
  await page.goto(pathToFileURL(resolve('dist/index.html')).href);
  await expect(page.locator('body[data-ready="1"]')).toBeAttached();
  type G = { run(c: unknown[]): boolean; combat: { towers: unknown[] }; gold: number };
  const before = await page.evaluate(() => {
    const g = (window as unknown as { gemtd: G }).gemtd;
    for (let c = 10; c < 15; c++) g.run(['place', c, 16]);
    g.run(['keep', 10, 16]);
    return g.combat.towers.length;
  });
  await page.waitForTimeout(300); // IndexedDB write
  await page.reload();
  await expect(page.locator('body[data-ready="1"]')).toBeAttached();
  await expect(page.locator('#hud')).toContainText('Wave 1/');
  expect(
    await page.evaluate(() => (window as unknown as { gemtd: G }).gemtd.combat.towers.length),
  ).toBe(before);
});
