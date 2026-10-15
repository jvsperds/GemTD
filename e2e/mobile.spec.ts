import { expect, test, type Page } from '@playwright/test';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, deviceScaleFactor: 3 });

test.beforeEach(async ({ page }) => {
  await page.goto(pathToFileURL(resolve('dist/index.html')).href);
  await expect(page.locator('body[data-ready="1"]')).toBeAttached();
  await page.locator('#close').click();
  await expect(page.locator('#game')).toHaveAttribute('data-contained', '1');
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
});

const placed = (page: Page) =>
  page.evaluate(() =>
    (window as unknown as { gemtd: { placed: { c: number; r: number }[] } }).gemtd.placed.map(
      (t) => [t.c, t.r],
    ),
  );

// Use the measured field rather than assuming that HUD heights stay fixed.
async function tile(page: Page, c: number, r: number) {
  return page.locator('#game').evaluate(
    (canvas, [c, r]) => {
      const box = canvas.getBoundingClientRect();
      const surface = canvas as HTMLCanvasElement;
      const dpr = Math.min(
        devicePixelRatio || 1,
        document.querySelector<HTMLInputElement>('#lowgfx')!.checked ? 1 : 1.5,
      );
      const cell = Math.floor((Math.min(box.width, box.height) * dpr) / 41);
      return {
        x: box.left + (Math.floor((surface.width - 37 * cell) / 2) + (c + 0.5) * cell) / dpr,
        y: box.top + (Math.floor((surface.height - 37 * cell) / 2) + (r + 0.5) * cell) / dpr,
      };
    },
    [c, r],
  );
}

test('keyboard movement clears a touch preview and announces the new cell', async ({ page }) => {
  const point = await tile(page, 10, 16);
  await page.touchscreen.tap(point.x, point.y);
  await expect(page.locator('#place-touch')).toBeEnabled();
  await page.locator('#game').focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('#boardstatus')).toContainText('column 12, row 17');
  await expect(page.locator('#place-touch')).toBeDisabled();
  expect(await placed(page)).toEqual([]);
});

test('touch previews a tile and confirms placement once, including after zoom', async ({
  page,
}) => {
  const point = await tile(page, 10, 16);
  await page.touchscreen.tap(point.x, point.y);
  await expect(page.locator('#place-touch')).toHaveText('Place gem · 11, 17');
  expect(await placed(page)).toEqual([]);
  await page.locator('#place-touch').tap();
  await expect.poll(() => placed(page)).toEqual([[10, 16]]);
  await expect(page.locator('#place-touch')).toBeDisabled();
  await page.getByRole('button', { name: 'Zoom board in', exact: true }).tap();
  // A tapped tile remains the confirmation target when the camera moves.
  await page.touchscreen.tap(200, 250);
  await expect(page.locator('#place-touch')).toBeEnabled();
  const label = await page.locator('#place-touch').textContent();
  const [c, r] = label!.match(/\d+/g)!.map(Number);
  await page.getByRole('button', { name: 'Zoom board out', exact: true }).tap();
  await page.locator('#place-touch').tap();
  await expect
    .poll(() => placed(page))
    .toEqual([
      [10, 16],
      [c - 1, r - 1],
    ]);
});

test('double tap zooms the board while the page and HUD stay fixed', async ({ page }) => {
  const p = await tile(page, 12, 16);
  await page.touchscreen.tap(p.x, p.y);
  await page.touchscreen.tap(p.x, p.y);
  expect(await placed(page)).toEqual([]);
  await expect(page.locator('#place-touch')).toBeDisabled();
  // After zoom the same nearby point is a different cell than in the fit view.
  await page.touchscreen.tap(p.x + 54, p.y);
  await expect(page.locator('#place-touch')).toBeEnabled();
  const zoomed = await page.locator('#place-touch').textContent();
  await page.getByRole('button', { name: 'Fit board', exact: true }).tap();
  await page.touchscreen.tap(p.x + 54, p.y);
  await expect(page.locator('#place-touch')).not.toHaveText(zoomed!);
  expect(await page.evaluate(() => window.visualViewport!.scale)).toBe(1);
  await expect(page.locator('#menubtn')).toBeInViewport();
});

test('pinch, drag, cancellation and compatibility clicks never place gems', async ({ page }) => {
  await page.touchscreen.tap(150, 250);
  await page.evaluate(() => {
    const canvas = document.querySelector('canvas')!;
    // Synthetic cancellation cases cannot own a real pointer capture.
    const capture = canvas.setPointerCapture;
    canvas.setPointerCapture = () => {};
    const send = (type: string, id: number, x: number, y = 250) =>
      canvas.dispatchEvent(
        new PointerEvent(type, {
          pointerId: id,
          pointerType: 'touch',
          clientX: x,
          clientY: y,
          bubbles: true,
        }),
      );
    send('pointerdown', 1, 150);
    send('pointerdown', 2, 230);
    send('pointermove', 2, 290);
    send('pointerup', 2, 290);
    send('pointerup', 1, 150);
    canvas.dispatchEvent(
      new MouseEvent('click', { clientX: 150, clientY: 250, detail: 1, bubbles: true }),
    );
    send('pointerdown', 3, 150);
    send('pointermove', 3, 190);
    send('pointerup', 3, 190);
    send('pointerdown', 4, 150);
    send('pointercancel', 4, 150);
    send('pointerdown', 5, 150);
    send('lostpointercapture', 5, 150);
    send('pointerup', 5, 150);
    canvas.setPointerCapture = capture;
  });
  expect(await placed(page)).toEqual([]);
  await expect(page.locator('#place-touch')).toBeDisabled();
  expect(await page.evaluate(() => window.visualViewport!.scale)).toBe(1);
  // A fresh tap must recover after cancellation.
  await page.touchscreen.tap(180, 280);
  await expect(page.locator('#place-touch')).toBeEnabled();
  await page.locator('#place-touch').tap();
  await expect.poll(async () => (await placed(page)).length).toBe(1);
});

test('Safari gesture and native board touch defaults are cancelled', async ({ page }) => {
  expect(
    await page.evaluate(() => {
      const canvas = document.querySelector('canvas')!;
      return [
        'gesturestart',
        'gesturechange',
        'gestureend',
        'touchstart',
        'touchmove',
        'touchend',
      ].map((type) => !canvas.dispatchEvent(new Event(type, { bubbles: true, cancelable: true })));
    }),
  ).toEqual([true, true, true, true, true, true]);
});

test('native two-finger pinch enlarges board tiles without zooming the page', async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== 'chromium', 'Native multi-touch injection uses Chromium CDP');
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [
      { x: 150, y: 330, id: 1 },
      { x: 230, y: 330, id: 2 },
    ],
  });
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchMove',
    touchPoints: [
      { x: 110, y: 330, id: 1 },
      { x: 270, y: 330, id: 2 },
    ],
  });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect(page.locator('#place-touch')).toBeDisabled();
  await page.touchscreen.tap(245, 330);
  await expect(page.locator('#place-touch')).toBeEnabled();
  const zoomed = await page.locator('#place-touch').textContent();
  await page.getByRole('button', { name: 'Fit board', exact: true }).tap();
  await page.touchscreen.tap(245, 330);
  await expect(page.locator('#place-touch')).not.toHaveText(zoomed!);
  expect(await placed(page)).toEqual([]);
  expect(await page.evaluate(() => window.visualViewport!.scale)).toBe(1);
});

for (const viewport of [
  { width: 320, height: 568 },
  { width: 390, height: 844 },
  { width: 844, height: 390 },
]) {
  test(`HUD leaves a clear playing field at ${viewport.width}×${viewport.height}`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
    );
    const checkLayout = async () => {
      const layout = await page.evaluate(() => {
        const board = document.querySelector('#game')!.getBoundingClientRect();
        const overlaps = [
          ...document.querySelectorAll<HTMLElement>(
            '#hud, #hint, #dock, #panel, #boardtools, #dmgtab',
          ),
        ]
          .filter((el) => {
            const r = el.getBoundingClientRect();
            return (
              r.width &&
              r.height &&
              !el.hidden &&
              board.left < r.right &&
              board.right > r.left &&
              board.top < r.bottom &&
              board.bottom > r.top
            );
          })
          .map((el) => el.id);
        const smallButtons = [
          ...document.querySelectorAll<HTMLElement>('#menubtn, #dock button, #panel button'),
        ]
          .filter((el) => {
            const r = el.getBoundingClientRect();
            return r.width && r.height && (r.width < 44 || r.height < 44);
          })
          .map((el) => el.textContent);
        return {
          overlaps,
          smallButtons,
          width: board.width,
          height: board.height,
          panelHeight: document.querySelector('#panel')!.getBoundingClientRect().height,
        };
      });
      expect(layout.overlaps).toEqual([]);
      expect(layout.smallButtons).toEqual([]);
      expect(layout.width).toBeGreaterThan(200);
      expect(layout.height).toBeGreaterThan(100);
      return layout;
    };
    await expect.poll(async () => (await checkLayout()).overlaps).toEqual([]);
    const initial = await checkLayout();
    if (viewport.height > viewport.width)
      expect(initial.panelHeight).toBeLessThan(viewport.height * 0.3);
    const point = await tile(page, 10, 16);
    await page.touchscreen.tap(point.x, point.y);
    await page.locator('#place-touch').tap();
    await expect.poll(async () => (await placed(page)).length).toBe(1);
    const selected = await tile(page, 10, 16);
    await page.touchscreen.tap(selected.x, selected.y);
    await expect(page.locator('#panel')).toHaveAttribute('data-view', 'tower');
    await page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
    );
    await checkLayout();
    // Targeting has a different panel height and must also leave the field clear.
    await page.locator('[data-a="tab:aim"]').tap();
    await page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
    );
    await checkLayout();
  });
}

test('a zoomed and panned tile stays under the finger when the HUD changes height', async ({
  page,
}) => {
  await page.getByRole('button', { name: 'Zoom board in', exact: true }).tap();
  await page.getByRole('button', { name: 'Zoom board in', exact: true }).tap();
  const box = (await page.locator('#game').boundingBox())!;
  const point = { x: box.x + box.width * 0.4, y: box.y + box.height * 0.4 };
  await page.mouse.move(point.x, point.y);
  await page.mouse.down();
  await page.mouse.move(point.x + 40, point.y + 20, { steps: 4 });
  await page.mouse.up();
  await page.touchscreen.tap(point.x, point.y);
  await expect(page.locator('#place-touch')).toBeEnabled();
  await page.locator('#place-touch').tap();
  await expect.poll(async () => (await placed(page)).length).toBe(1);
  await page.touchscreen.tap(point.x, point.y);
  await expect(page.locator('#panel')).toHaveAttribute('data-view', 'tower');
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
  await page.locator('[data-a="path"]').tap(); // clear double-tap detection without moving the camera
  await page.touchscreen.tap(point.x, point.y);
  await expect(page.locator('#panel')).toHaveAttribute('data-view', 'tower');
});
