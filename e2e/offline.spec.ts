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
