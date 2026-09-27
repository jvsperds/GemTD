import { chromium, expect, test } from '@playwright/test';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

// BUILD.md §3.7 budgets, with the GPU disabled.
test('stress scene meets the CPU-only budgets', async () => {
  const browser = await chromium.launch({ args: ['--disable-gpu'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.goto(pathToFileURL(resolve('dist/index.html')).href + '#stress');
  await page.waitForTimeout(5000);
  const perf = await page.evaluate(
    () => (window as unknown as { perf: Record<string, number> }).perf,
  );
  console.log(perf);
  await browser.close();
  expect(perf.creeps).toBeGreaterThanOrEqual(400);
  expect(perf.towers).toBe(80);
  expect(perf.shots).toBeGreaterThanOrEqual(1500);
  expect(perf.particles).toBe(800);
  expect(perf.tickMs).toBeLessThan(4);
  expect(perf.drawMs).toBeLessThan(8);
  expect(perf.fps).toBeGreaterThanOrEqual(55);
});
