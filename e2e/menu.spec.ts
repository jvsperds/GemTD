import { expect, test, type Page } from '@playwright/test';
import type { Hero } from '../src/persist';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

test.beforeEach(async ({ page, context }) => {
  await context.route(/^https?:/, (route) => route.abort());
  await page.goto(pathToFileURL(resolve('dist/index.html')).href);
  await expect(page.locator('body[data-ready="1"]')).toBeAttached();
  await expect(page.locator('#menu')).toBeVisible();
});

async function seedHero(page: Page, profile: Hero) {
  await page.evaluate(
    (value) =>
      new Promise<void>((resolve, reject) => {
        const request = indexedDB.open('gemtd', 1);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const database = request.result;
          const transaction = database.transaction('kv', 'readwrite');
          transaction.objectStore('kv').put(value, 'hero');
          transaction.oncomplete = () => {
            database.close();
            resolve();
          };
          transaction.onerror = () => reject(transaction.error);
        };
      }),
    profile,
  );
  await page.reload();
  await page.getByRole('tab', { name: 'Hero & skills', exact: true }).click();
}

test('hero icons preview locked heroes without spending shells', async ({ page }) => {
  await page.getByRole('tab', { name: 'Hero & skills', exact: true }).click();
  await page.getByRole('button', { name: 'Inspect Prism', exact: true }).click();
  await expect(page.locator('#herodetailname')).toHaveText('Prism');
  await expect(page.locator('#herodetailtip')).toContainText('12% chance');
  await expect(page.locator('#selecthero')).toBeDisabled();
  await expect(page.locator('#heroafford')).toContainText('400 more shells');
  await expect(page.locator('#shells')).toHaveText('0');
  await expect(page.locator('#hero-quartz')).toContainText('Selected');
  await page.evaluate(() => {
    document.querySelector<HTMLButtonElement>('#hero-onyx')!.click();
    document.querySelector<HTMLButtonElement>('#hero-garnet')!.click();
  });
  await expect(page.locator('#herodetailname')).toHaveText('Garnet');
  await expect(page.locator('#hero-garnet')).toBeFocused();
  await page.setViewportSize({ width: 390, height: 640 });
  expect(
    await page
      .locator('#pane-hero')
      .evaluate((element) => element.scrollWidth <= element.clientWidth),
  ).toBe(true);
});

test('hero selection, skill purchases, and equipped icons persist without double spending', async ({
  page,
}) => {
  await seedHero(page, { shells: 100, skills: {}, bring: [], hero: 'quartz' });
  await page.locator('#hero-garnet').click();
  await expect(page.locator('#shells')).toHaveText('100');
  await page.locator('#selecthero').click();
  await expect(page.locator('#hero-garnet')).toContainText('Selected');
  await expect(page.locator('#shells')).toHaveText('75');
  await page.locator('#buy-heal').click();
  await expect(page.locator('#slot-heal')).toBeVisible();
  await expect(page.locator('#shells')).toHaveText('70');
  await expect(page.locator('#buy-heal')).toBeFocused();
  await page.locator('#buy-heal').evaluate((button: HTMLButtonElement) => {
    button.click();
    button.click();
  });
  await expect(page.locator('#shells')).toHaveText('60');
  await expect(page.locator('[data-skill="heal"] .skill-rank')).toHaveText('Level 2 / 4');
  await page.locator('#slot-heal').click();
  await expect(page.locator('#bringing')).toHaveText('0 / 5 slots');
  await expect(page.locator('#equip-heal')).toBeFocused();
  await page.locator('#equip-heal').click();
  await expect(page.locator('#bringing')).toHaveText('1 / 5 slots');
  await page.reload();
  await page.getByRole('tab', { name: 'Hero & skills', exact: true }).click();
  await expect(page.locator('#hero-garnet')).toContainText('Selected');
  await expect(page.locator('#slot-heal')).toBeVisible();
  await expect(page.locator('#shells')).toHaveText('60');
});

test('switching from Moonstone trims to five slots and maxed skills cannot be purchased', async ({
  page,
}) => {
  await seedHero(page, {
    shells: 100,
    hero: 'moonstone',
    heroes: ['moonstone'],
    skills: { heal: 4, guard: 1, evade: 1, haste: 1, aim: 1, greed: 1 },
    bring: ['heal', 'guard', 'evade', 'haste', 'aim', 'greed'],
  });
  await expect(page.locator('#bringing')).toHaveText('6 / 6 slots');
  await expect(page.locator('#buy-heal')).toBeDisabled();
  await page.locator('#hero-quartz').click();
  await page.locator('#selecthero').click();
  await expect(page.locator('#bringing')).toHaveText('5 / 5 slots');
  await expect(page.locator('#slot-greed')).toHaveCount(0);
  await expect(page.locator('#equip-greed')).toBeDisabled();
  await page.locator('#slot-heal').click();
  await expect(page.locator('#equip-greed')).toBeEnabled();
  await page.locator('#equip-greed').click();
  await expect(page.locator('#bringing')).toHaveText('5 / 5 slots');
  await expect(page.locator('#slot-greed')).toBeVisible();
  await expect(page.locator('#shells')).toHaveText('100');
});

test('menu navigation supports keyboard tabs, focus containment, and Escape', async ({ page }) => {
  const play = page.getByRole('tab', { name: 'Play', exact: true });
  await expect(play).toHaveAttribute('aria-selected', 'true');
  await play.focus();
  await page.keyboard.press('End');
  await expect(page.getByRole('tab', { name: 'Settings', exact: true })).toBeFocused();
  await expect(page.locator('#pane-settings')).toBeVisible();
  await page.keyboard.press('ArrowRight');
  await expect(play).toBeFocused();
  await page.locator('#close').focus();
  await page.keyboard.press('Shift+Tab');
  expect(await page.evaluate(() => !!document.activeElement?.closest('#menu'))).toBe(true);
  await page.keyboard.press('Escape');
  await expect(page.locator('#menu')).toBeHidden();
  await expect(page.locator('#game')).toBeFocused();
  await page.locator('#menubtn').click();
  await page.keyboard.press('Escape');
  await expect(page.locator('#menubtn')).toBeFocused();
});

test('run setup keeps draft choices through loadout editing and Back', async ({ page }) => {
  await page.locator('#opennew').click();
  await page.locator('[data-diff="hard"]').click();
  await page.locator('#mapsel').selectOption('cross');
  await page.getByText('Optional mutators', { exact: true }).click();
  await page.locator('#mutators input[value="swift"]').check();
  await page.locator('#changeloadout').click();
  await expect(page.locator('#pane-hero')).toBeVisible();
  await expect(page.locator('#returnsetup')).toBeFocused();
  await page.locator('#returnsetup').click();
  await expect(page.locator('[data-diff="hard"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#mapsel')).toHaveValue('cross');
  await expect(page.locator('#mutators input[value="swift"]')).toBeChecked();
  await page.locator('#cancelnew').click();
  await expect(page.locator('#pane-play')).toBeVisible();
  await expect(page.locator('#opennew')).toBeFocused();
  await page.locator('#opennew').click();
  await page.locator('#newgame').click();
  await expect(page.locator('#newdlg')).toBeHidden();
  await expect(page.locator('#hud')).toContainText('hard');
  expect(
    await page.evaluate(
      () => (window as unknown as { gemtd: { sim: { speedMult: number } } }).gemtd.sim.speedMult,
    ),
  ).toBe(1.3);
  await expect(page.locator('#hud')).toContainText('Crossroads');
});

test('daily and builder are explicit modes with one launch action', async ({ page }) => {
  await page.locator('#opendaily').click();
  await expect(page.locator('#daily')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#customsetup')).toBeHidden();
  await expect(page.locator('#modedescription')).toContainText('Normal difficulty, Classic map');
  await page.locator('#builder').click();
  await expect(page.locator('#setuploadout')).toBeHidden();
  await expect(page.locator('#newgame')).toHaveText('Open maze builder');
  await page.locator('#daily').click();
  await page.locator('#newgame').click();
  await expect(page.locator('#newdlg')).toBeHidden();
  await expect(page.locator('#hud')).toContainText('normal');
  await expect(page.locator('#hud')).toContainText('Daily');
  await page.locator('#menubtn').click();
  await page.locator('#openbuilder').click();
  await page.locator('#newgame').click();
  await expect(page.locator('#hud')).toContainText('Maze builder');
});

test('menus pause waves and confirm abandonment only when launching', async ({ page }) => {
  await page.locator('#close').click();
  await page.evaluate(() => {
    const game = (window as unknown as { gemtd: { run(cmd: unknown[]): void } }).gemtd;
    for (let c = 10; c < 15; c++) game.run(['place', c, 16]);
    game.run(['keep', 10, 16]);
  });
  await page.locator('#menubtn').click();
  const ticks = () =>
    page.evaluate(() => (window as unknown as { gemtd: { ticks: number } }).gemtd.ticks);
  const before = await ticks();
  await page.keyboard.press('s');
  await page.keyboard.press('Space');
  await page.waitForTimeout(250);
  expect(await ticks()).toBe(before);
  await page.getByRole('tab', { name: 'Play', exact: true }).click();
  await page.locator('#opennew').click();
  await expect(page.locator('#newdlg')).toBeVisible();
  page.once('dialog', (dialog) => dialog.dismiss());
  await page.locator('#newgame').click();
  await expect(page.locator('#newdlg')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#menu')).toBeVisible();
  await page.locator('#resume').click();
  await expect.poll(ticks).toBeGreaterThan(before);
});

test('narrow screens keep setup actions reachable and scores scroll within their pane', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 640 });
  await page.locator('#opennew').click();
  await page.getByText('Optional mutators', { exact: true }).click();
  await page.locator('#newgame').scrollIntoViewIfNeeded();
  const begin = (await page.locator('#newgame').boundingBox())!;
  expect(begin.y).toBeGreaterThanOrEqual(0);
  expect(begin.y + begin.height).toBeLessThanOrEqual(640);
  await page.locator('#cancelnew').click();
  await page.getByRole('tab', { name: 'Scores', exact: true }).click();
  const sizes = await page.locator('#menu').evaluate((menu) => ({
    client: menu.clientWidth,
    scroll: menu.scrollWidth,
    left: menu.getBoundingClientRect().left,
    right: menu.getBoundingClientRect().right,
  }));
  expect(sizes.scroll).toBe(sizes.client);
  expect(sizes.left).toBeGreaterThanOrEqual(0);
  expect(sizes.right).toBeLessThanOrEqual(390);
  await expect(page.locator('#rows')).toContainText('No runs match');
});
