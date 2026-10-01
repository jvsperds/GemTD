/* global URL, URLSearchParams, process, console */
// Self-hosted server: serves dist/ behind a login page (signed cookie) and keeps one profile file per user.
// Users come from GEMTD_USERS="alice:pw1,bob:pw2". Profiles live in $DATA_DIR/<user>.json.
// ponytail: stateless HMAC cookie, no expiry/revocation; changing GEMTD_USERS logs everyone out.
// Put it behind HTTPS (reverse proxy) or passwords travel in clear.
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { timingSafeEqual, createHash, createHmac } from 'node:crypto';
import { join, normalize, extname } from 'node:path';

const ROOT = new URL('./dist/', import.meta.url).pathname.replace(/^\/(\w:)/, '$1');
const DATA = process.env.DATA_DIR ?? './profiles';
const PORT = +(process.env.PORT ?? 80);
const KEYS = new Set(['scores', 'mazes', 'save', 'settings', 'hero']);
const TYPES = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json',
  '.json': 'application/json',
  '.css': 'text/css',
};

const users = new Map(
  (process.env.GEMTD_USERS ?? '')
    .split(',')
    .filter(Boolean)
    .map((u) => {
      const i = u.indexOf(':');
      return [u.slice(0, i).trim(), u.slice(i + 1)];
    }),
);
if (!users.size) throw new Error('set GEMTD_USERS="name:password,..."');
for (const n of users.keys()) if (!/^[\w-]{1,32}$/.test(n)) throw new Error(`bad user name: ${n}`);

const h = (s) => createHash('sha256').update(s).digest();
const eq = (a, b) => timingSafeEqual(h(a), h(b));
const check = (name, pw) => users.has(name) && eq(pw, users.get(name));
// Key derives from the user list, so sessions survive restarts and die when passwords change.
const KEY = h('gemtd:' + process.env.GEMTD_USERS);
const sign = (name) => name + '.' + createHmac('sha256', KEY).update(name).digest('base64url');
function who(cookie) {
  const v = /(?:^|;\s*)gemtd=([^;]+)/.exec(cookie ?? '')?.[1] ?? '';
  const name = v.slice(0, v.lastIndexOf('.'));
  return users.has(name) && eq(v, sign(name)) ? name : null;
}
const page = (error) => `<!doctype html><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>GemTD login</title>
<style>body{font:16px system-ui;background:#111;color:#eee;display:grid;place-items:center;
min-height:100vh;margin:0}form{display:grid;gap:10px;width:min(280px,90vw)}input,button{font:inherit;
padding:8px;border-radius:6px;border:1px solid #444;background:#222;color:inherit}
button{background:#3a6;border:0}p{color:#f77;margin:0}</style>
<form method="post" action="login"><h1>GemTD</h1>${error ? '<p>Wrong name or password</p>' : ''}
<input name="name" placeholder="Name" autocomplete="username" required autofocus>
<input name="password" type="password" placeholder="Password" autocomplete="current-password" required>
<button>Log in</button></form>`;

const profile = async (u) => {
  try {
    return JSON.parse(await readFile(join(DATA, u + '.json'), 'utf8'));
  } catch {
    return {};
  }
};
const locks = new Map(); // per-user write chain so concurrent sets don't clobber each other

createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const secure = req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : '';
  if (url.pathname === '/login' && req.method === 'POST') {
    let body = '';
    for await (const c of req) if ((body += c).length > 1e4) return res.writeHead(413).end();
    const f = new URLSearchParams(body);
    const name = (f.get('name') ?? '').trim();
    if (!check(name, f.get('password') ?? ''))
      return res.writeHead(401, { 'Content-Type': 'text/html' }).end(page(true));
    const cookie = `gemtd=${sign(name)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000${secure}`;
    return res.writeHead(303, { 'Set-Cookie': cookie, Location: './' }).end();
  }
  if (url.pathname === '/logout') {
    const cookie = `gemtd=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`;
    return res.writeHead(303, { 'Set-Cookie': cookie, Location: './' }).end();
  }
  const user = who(req.headers.cookie);
  // Logged out: the API answers a bare 401 (the game sends you to the login page); everything else
  // gets the login page itself, as 401 so the service worker never caches it. sw.js stays public
  // so service-worker updates are never blocked.
  if (!user && url.pathname !== '/sw.js') {
    if (url.pathname.startsWith('/api/')) return res.writeHead(401).end();
    return res.writeHead(401, { 'Content-Type': 'text/html' }).end(page(false));
  }
  const m = url.pathname.match(/^\/api\/kv\/(\w+)$/);
  if (m) {
    if (!KEYS.has(m[1])) return res.writeHead(404).end();
    if (req.method === 'GET') {
      const p = await profile(user);
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      return res.end(JSON.stringify(p[m[1]] ?? null));
    }
    if (req.method === 'PUT') {
      let body = '';
      for await (const c of req) if ((body += c).length > 5e6) return res.writeHead(413).end();
      let value;
      try {
        value = JSON.parse(body);
      } catch {
        return res.writeHead(400).end();
      }
      const run = (locks.get(user) ?? Promise.resolve()).then(async () => {
        const p = await profile(user);
        p[m[1]] = value;
        await mkdir(DATA, { recursive: true });
        await writeFile(join(DATA, user + '.json'), JSON.stringify(p));
      });
      locks.set(
        user,
        run.catch(() => {}),
      );
      await run;
      return res.writeHead(204).end();
    }
    return res.writeHead(405).end();
  }
  if (url.pathname === '/api/me') return res.end(user);
  const file = normalize(
    join(ROOT, url.pathname.endsWith('/') ? url.pathname + 'index.html' : url.pathname),
  );
  if (!file.startsWith(normalize(ROOT))) return res.writeHead(403).end();
  try {
    const buf = await readFile(file);
    res.writeHead(200, { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream' });
    res.end(buf);
  } catch {
    res.writeHead(404).end();
  }
}).listen(PORT, () => console.log(`GemTD on :${PORT} for ${[...users.keys()].join(', ')}`));
