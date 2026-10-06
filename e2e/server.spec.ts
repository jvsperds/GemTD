import { expect, test, type Page } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Self-hosted server.mjs: login page + signed cookie, one profile per player.
let PORT = 0; // one per worker: the browser projects run in parallel
let BASE = '';
let DATA = '';
const PW = 'a1s2d3f4!';
const USERS = `jds:${PW},admin:%upp0rT!x`;
let server: ChildProcess;

async function start(users = USERS) {
  server = spawn(process.execPath, ['server.mjs'], {
    env: { ...process.env, PORT: String(PORT), DATA_DIR: DATA, GEMTD_USERS: users },
    stdio: 'inherit',
  });
  for (let i = 0; i < 50; i++) {
    if (
      await fetch(BASE).then(
        () => true,
        () => false,
      )
    )
      return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('server did not start');
}
async function stop() {
  const done = new Promise((r) => server.once('exit', r));
  server.kill();
  await done;
}
test.describe.configure({ mode: 'serial' });
test.beforeAll(() => {
  const info = test.info();
  PORT = 5199 + info.parallelIndex;
  BASE = `http://localhost:${PORT}/`;
  DATA = mkdtempSync(join(tmpdir(), 'gemtd-'));
  return start();
});
test.afterAll(stop);

/** Logs in over HTTP and returns the session cookie ('' if refused). */
async function login(name: string, password: string) {
  const r = await fetch(BASE + 'login', {
    method: 'POST',
    body: new URLSearchParams({ name, password }),
    redirect: 'manual',
  });
  return r.status === 303 ? r.headers.get('set-cookie')!.split(';')[0] : '';
}
const kv = (cookie: string, init: RequestInit = {}) =>
  fetch(BASE + 'api/kv/settings', { ...init, headers: { cookie } });

test('server: login, public sw.js, per-user kv, no Basic prompt', async () => {
  const gate = await fetch(BASE);
  expect(gate.status).toBe(401);
  expect(gate.headers.get('www-authenticate')).toBeNull(); // would pop the browser dialog
  expect(await gate.text()).toContain('<form');
  expect((await kv('')).status).toBe(401);
  expect((await fetch(BASE + 'sw.js')).status).toBe(200);

  expect(await login('jds', 'wrong')).toBe('');
  expect(await login('nobody', PW)).toBe('');
  expect((await kv('gemtd=jds.forged')).status).toBe(401);
  const jds = await login('jds', PW);
  const admin = await login('admin', '%upp0rT!x');
  expect(jds && admin).toBeTruthy();

  expect(await (await fetch(BASE + 'api/me', { headers: { cookie: jds } })).text()).toBe('jds');
  expect((await kv(admin, { method: 'PUT', body: '{"name":"A"}' })).status).toBe(204);
  expect(await (await kv(admin)).json()).toEqual({ name: 'A' });
  expect(await (await kv(jds)).json()).toBeNull(); // profiles are per player
  expect((await fetch(BASE, { headers: { cookie: jds } })).status).toBe(200);

  // Global leaderboard: both players' rows, named by the owning profile (a forged name is ignored).
  const put = (cookie: string, rows: object[]) =>
    fetch(BASE + 'api/kv/scores', {
      method: 'PUT',
      body: JSON.stringify(rows),
      headers: { cookie },
    });
  await put(jds, [{ name: 'admin', score: 5 }]);
  await put(admin, [{ name: 'Player', score: 9 }]);
  const all = await (await fetch(BASE + 'api/scores', { headers: { cookie: jds } })).json();
  expect(all.map((x: { name: string; score: number }) => `${x.name}:${x.score}`).sort()).toEqual([
    'admin:9',
    'jds:5',
  ]);
  expect((await fetch(BASE + 'api/scores')).status).toBe(401);
});

test('server: session survives a restart, dies when passwords change', async () => {
  const jds = await login('jds', PW);
  await stop();
  await start();
  expect((await kv(jds)).status).toBe(200);
  await stop();
  await start(`jds:new`);
  expect((await kv(jds)).status).toBe(401);
  await stop();
  await start();
});

const settingsOnDisk = () => {
  try {
    return JSON.parse(readFileSync(join(DATA, 'jds.json'), 'utf8')).settings?.volume;
  } catch {
    return undefined; // not written yet
  }
};

async function logIn(page: Page) {
  await page.goto(BASE);
  await page.fill('input[name=name]', 'jds');
  await page.fill('input[name=password]', PW);
  await page.click('button');
  await expect(page.locator('body[data-ready="1"]')).toBeAttached();
}

test('browser: log in, play under service worker, saves land with no 401', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(BASE);
  await page.fill('input[name=name]', 'jds');
  await page.fill('input[name=password]', 'wrong');
  await page.click('button');
  await expect(page.getByText('Wrong name or password')).toBeVisible();

  await logIn(page);
  await page.evaluate(() => navigator.serviceWorker.ready);
  const hits: string[] = [];
  page.context().on('response', (r) => r.status() === 401 && hits.push(r.url()));
  await page.reload(); // now controlled by the service worker
  await expect(page.locator('body[data-ready="1"]')).toBeAttached();
  expect(await page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  if (await page.locator('#newdlg[open]').count()) await page.locator('#cancelnew').click();
  await page.keyboard.press('Escape'); // menu → settings → volume change saves the profile
  await page.click('button[data-tab=settings]');
  await page.locator('#volume').fill('0.2');
  await expect.poll(settingsOnDisk).toBe(0.2);
  expect(hits).toEqual([]);
  expect(errors).toEqual([]);
});

test('browser: losing the session sends the player back to the login page', async ({ page }) => {
  await logIn(page);
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.context().clearCookies();
  await page.reload();
  await expect(page.locator('input[name=password]')).toBeVisible();
  await logIn(page); // and logging in again works with the service worker in place
  await page.goto(BASE + 'logout');
  await expect(page.locator('input[name=password]')).toBeVisible();
});

test('server: self-registration with a name only, capped by GEMTD_MAX_USERS', async () => {
  const register = (name: string, password: string) =>
    fetch(BASE + 'register', {
      method: 'POST',
      body: new URLSearchParams({ name, password }),
      redirect: 'manual',
    });
  expect((await register('JDS', 'whatever1')).status).toBe(409); // taken, ignoring case
  expect((await register('new.guy', 'whatever1')).status).toBe(409); // not a safe file name
  expect((await register('newbie', '123')).status).toBe(400); // password too short
  const ok = await register('newbie', 'whatever1');
  expect(ok.status).toBe(303);
  const cookie = ok.headers.get('set-cookie')!.split(';')[0];
  expect(await (await fetch(BASE + 'api/me', { headers: { cookie } })).text()).toBe('newbie');
  expect(await login('newbie', 'nope')).toBe('');
  await stop();
  await start(); // registered users survive a restart
  expect(await login('newbie', 'whatever1')).toBeTruthy();
  expect((await kv(cookie)).status).toBe(200);
  expect((await register('late', 'whatever1')).status).toBe(303); // 4 users, under the default 50
  await stop();
  server = spawn(process.execPath, ['server.mjs'], {
    env: {
      ...process.env,
      PORT: String(PORT),
      DATA_DIR: DATA,
      GEMTD_USERS: USERS,
      GEMTD_MAX_USERS: '4',
    },
    stdio: 'inherit',
  });
  await expect
    .poll(() =>
      fetch(BASE).then(
        () => true,
        () => false,
      ),
    )
    .toBe(true);
  expect((await register('extra', 'whatever1')).status).toBe(403); // full
  await stop();
  await start();
});
