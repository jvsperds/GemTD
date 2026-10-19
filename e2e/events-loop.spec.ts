import { expect, test, type Page } from '@playwright/test';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const gameUrl = pathToFileURL(resolve('dist/index.html')).href;

test('Events can be enabled through normal run setup', async ({ page }) => {
  await page.goto(gameUrl);
  await page.locator('#opennew').click();
  await page.getByText('Optional mutators', { exact: true }).click();
  await page.locator('#mutators input[value="events"]').check();
  await page.locator('#newgame').click();
  await expect(page.locator('#newdlg')).toBeHidden();
  await expect(page.locator('body[data-ready="1"]')).toBeAttached();
  expect(
    await page.evaluate(() => (window as unknown as { gemtd: { events: boolean } }).gemtd.events),
  ).toBe(true);
});

async function freshGame(page: Page) {
  // Start through the normal new-game dialog. This is test setup, not player behavior.
  await page.goto(gameUrl);
  await page.locator('#opennew').click();
  await expect(page.locator('#newdlg')).toBeVisible();
  await page.locator('#newgame').click();
  await expect(page.locator('#newdlg')).toBeHidden();
  await expect(page.locator('body[data-ready="1"]')).toBeAttached();
}

async function injectOffer(page: Page, id: 'shrine' | 'goldRush' | 'hurry' = 'shrine') {
  // Inject only the deterministic scenario boundary. The visible offer and choice still use UI.
  await page.evaluate((eventId) => {
    const g = (window as unknown as { gemtd: { events: boolean; pendingEvent: unknown } }).gemtd;
    g.events = true;
    g.pendingEvent = { wave: 5, id: eventId };
  }, id);
  await expect(page.locator('.event-card')).toBeVisible();
}

test('announces an event, keeps Skip blocked, and accepts with keyboard', async ({ page }) => {
  await freshGame(page);
  await injectOffer(page, 'goldRush');
  await expect(page.locator('.event-card')).toContainText('Gold Rush');
  await expect(page.locator('[data-a="skip"]')).toBeDisabled();
  await page.keyboard.press('Enter');
  // Enter is intentionally not a choice: focus starts on the page, so the offer remains pending.
  await expect(page.locator('.event-card')).toBeVisible();
  await page.locator('[data-a="event:accept"]').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('.event-card')).toBeHidden();
  await expect(page.locator('[data-a="skip"]')).toBeEnabled();
  await expect(
    page.evaluate(() => {
      const g = (window as unknown as { gemtd: { pendingEvent: unknown; activeEvent: unknown } })
        .gemtd;
      return [g.pendingEvent, g.activeEvent];
    }),
  ).resolves.toEqual([null, { wave: 5, id: 'goldRush' }]);
});

test('touch pointer can decline a Shrine offer', async ({ page }) => {
  await freshGame(page);
  await injectOffer(page);
  const decline = page.locator('[data-a="event:decline"]');
  await decline.dispatchEvent('pointerdown', { pointerType: 'touch', pointerId: 1, button: 0 });
  await expect(page.locator('.event-card')).toBeHidden();
  await expect(page.locator('[data-a="skip"]')).toBeEnabled();
});

test('resolved event decision survives reload and does not return as pending', async ({ page }) => {
  await freshGame(page);
  await injectOffer(page);
  await page.locator('[data-a="event:decline"]').click();
  await expect(page.locator('.event-card')).toBeHidden();
  await page.waitForTimeout(300); // allow the existing IndexedDB save callback to complete
  await page.reload();
  await expect(page.locator('body[data-ready="1"]')).toBeAttached();
  await expect(page.locator('.event-card')).toBeHidden();
  expect(
    await page.evaluate(
      () => (window as unknown as { gemtd: { pendingEvent: unknown } }).gemtd.pendingEvent,
    ),
  ).toBeNull();
});

test('Skyhunter is present in the Book after an injected deterministic setup', async ({ page }) => {
  await freshGame(page);
  await page.locator('[data-a="book"]').click();
  await expect(page.locator('#book')).toBeVisible();
  await expect(page.locator('#book')).toContainText('Skyhunter');
});

test.describe('phone event flow', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

  test('naturally scheduled event is touchable and its accepted choice survives reload', async ({
    page,
  }) => {
    await page.goto(gameUrl);
    await expect(page.locator('body[data-ready="1"]')).toBeAttached();
    await page.evaluate(() =>
      sessionStorage.setItem(
        'gemtd.start',
        JSON.stringify({ seed: 8, difficulty: 'normal', mutators: ['events'] }),
      ),
    );
    await page.reload();
    await expect(page.locator('body[data-ready="1"]')).toBeAttached();
    await expect
      .poll(() =>
        page.evaluate(() => {
          const g = (window as unknown as { gemtd: { seed: number; events: boolean } }).gemtd;
          return [g.seed, g.events];
        }),
      )
      .toEqual([8, true]);
    if (await page.locator('#close').isVisible()) await page.locator('#close').tap();
    // Fast-forward only through logged player commands and simulation ticks, without injecting an offer.
    await page.evaluate(() => {
      const g = (
        window as unknown as {
          gemtd: { run(c: string[]): boolean; tick(): void; sim: { phase: string } };
        }
      ).gemtd;
      for (let wave = 1; wave <= 4; wave++) {
        if (!g.run(['skip'])) throw new Error('Could not skip setup wave');
        while (g.sim.phase === 'wave') g.tick();
      }
    });
    const offer = page.locator('.event-card');
    await expect(offer).toContainText('Gold Rush');
    const accept = page.locator('[data-a="event:accept"]');
    const box = (await accept.boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(44);
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(390);
    await accept.tap();
    await expect(offer).toBeHidden();
    await page.waitForTimeout(300);
    await page.reload();
    await expect(page.locator('body[data-ready="1"]')).toBeAttached();
    expect(
      await page.evaluate(() => {
        const g = (
          window as unknown as {
            gemtd: {
              activeEvent: unknown;
              pendingEvent: unknown;
              eventGold: number;
              sim: { eventHpMult: number };
            };
          }
        ).gemtd;
        return [g.pendingEvent, g.activeEvent, g.eventGold, g.sim.eventHpMult];
      }),
    ).toEqual([null, { wave: 5, id: 'goldRush' }, 1.5, 1.35]);
  });
});
