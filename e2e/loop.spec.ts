import { expect, test } from '@playwright/test';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

test('place 5 gems, keep one, wave starts', async ({ page }) => {
  await page.goto(pathToFileURL(resolve('dist/index.html')).href);
  await expect(page.locator('body[data-ready="1"]')).toBeAttached();
  const box = (await page.locator('canvas').boundingBox())!;
  const cell = Math.min(box.width, box.height) / 37;
  // Fit-to-window centres the map; click cells 10..14 on row 16.
  const ox = (box.width - cell * 37) / 2;
  const oy = (box.height - cell * 37) / 2;
  for (let c = 10; c < 15; c++) await page.mouse.click(ox + (c + 0.5) * cell, oy + 16.5 * cell);
  await expect(page.locator('#hud')).toContainText('select it');
  await page.mouse.click(ox + 10.5 * cell, oy + 16.5 * cell);
  await page.keyboard.press('k');
  await expect(page.locator('#hud')).toContainText('wave in progress');
});
