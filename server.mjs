/* global URL, URLSearchParams, process, console */
// Self-hosted server: serves dist/ behind a login page (signed cookie) and keeps one profile file per user.
// Users come from GEMTD_USERS="alice:pw1,bob:pw2", plus players who register themselves on the login
// page (name + password, no email) until GEMTD_MAX_USERS (default 50, 0 = no sign-ups) is reached.
// Registered users live in $DATA_DIR/.users.json (scrypt hashes). Profiles live in $DATA_DIR/<user>.json.
// ponytail: stateless HMAC cookie, no expiry/revocation; changing GEMTD_USERS logs everyone out.
// Put it behind HTTPS (reverse proxy) or passwords travel in clear.
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { timingSafeEqual, createHash, createHmac, randomBytes, scryptSync } from 'node:crypto';
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
const MAX = +(process.env.GEMTD_MAX_USERS ?? 50);
if (!users.size && !MAX) throw new Error('set GEMTD_USERS="name:password,..." or GEMTD_MAX_USERS');
const NAME = /^[\w-]{1,32}$/; // also keeps names safe as file names; dot files can't clash
for (const n of users.keys()) if (!NAME.test(n)) throw new Error(`bad user name: ${n}`);

// Self-registered users: name -> "salt:scrypt hash" (hex).
mkdirSync(DATA, { recursive: true });
const REG = join(DATA, '.users.json');
let registered = {};
try {
  registered = JSON.parse(readFileSync(REG, 'utf8'));
} catch {
  // nobody registered yet
}
const hash = (pw, salt) => scryptSync(pw, salt, 32).toString('hex');
const names = () => [...users.keys(), ...Object.keys(registered)];
// Unique ignoring case, so profile files can't clash on case-insensitive disks.
const taken = (name) => names().some((n) => n.toLowerCase() === name.toLowerCase());
const known = (name) => users.has(name) || Object.hasOwn(registered, name);

const h = (s) => createHash('sha256').update(s).digest();
const eq = (a, b) => timingSafeEqual(h(a), h(b));
function check(name, pw) {
  if (users.has(name)) return eq(pw, users.get(name));
  if (!Object.hasOwn(registered, name)) return false;
  const [salt, want] = registered[name].split(':');
  return eq(hash(pw, salt), want);
}
// A random secret kept with the data, so cookies can't be forged even with GEMTD_USERS empty.
let secret;
try {
  secret = readFileSync(join(DATA, '.secret'), 'utf8');
} catch {
  secret = randomBytes(32).toString('hex');
  writeFileSync(join(DATA, '.secret'), secret, { mode: 0o600 });
}
// Key also derives from the user list, so sessions survive restarts and die when passwords change.
const KEY = h('gemtd:' + secret + (process.env.GEMTD_USERS ?? ''));
const sign = (name) => name + '.' + createHmac('sha256', KEY).update(name).digest('base64url');
function who(cookie) {
  const v = /(?:^|;\s*)gemtd=([^;]+)/.exec(cookie ?? '')?.[1] ?? '';
  const name = v.slice(0, v.lastIndexOf('.'));
  return known(name) && eq(v, sign(name)) ? name : null;
}
const ERRORS = {
  login: 'Wrong name or password',
  name: 'Name taken, or not 1-32 letters, digits, _ or -',
  password: 'Password needs at least 6 characters',
  full: 'Sign-ups are closed',
};
const page = (error) => `<!doctype html><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>GemTD login</title>
<style>body{font:16px system-ui;background:#111;color:#eee;display:grid;place-items:center;
min-height:100vh;margin:0}form{display:grid;gap:10px;width:min(280px,90vw)}input,button{font:inherit;
padding:8px;border-radius:6px;border:1px solid #444;background:#222;color:inherit}
button{background:#3a6;border:0}button+button{background:#345}p{color:#f77;margin:0}</style>
<form method="post" action="login"><h1>GemTD</h1>${error ? `<p>${ERRORS[error]}</p>` : ''}
<input name="name" placeholder="Name" autocomplete="username" required autofocus>
<input name="password" type="password" placeholder="Password" autocomplete="current-password" required>
<button>Log in</button>${MAX ? '<button formaction="register">Register</button>' : ''}</form>`;

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
  if ((url.pathname === '/login' || url.pathname === '/register') && req.method === 'POST') {
    let body = '';
    for await (const c of req) if ((body += c).length > 1e4) return res.writeHead(413).end();
    const f = new URLSearchParams(body);
    const name = (f.get('name') ?? '').trim();
    const pw = f.get('password') ?? '';
    const fail = (status, error) =>
      res.writeHead(status, { 'Content-Type': 'text/html' }).end(page(error));
    if (url.pathname === '/register') {
      if (!MAX || names().length >= MAX) return fail(403, 'full');
      if (!NAME.test(name) || taken(name)) return fail(409, 'name');
      if (pw.length < 6) return fail(400, 'password');
      const salt = randomBytes(16).toString('hex');
      // Claimed before any await, so two sign-ups for one name can't both pass the check.
      registered = { ...registered, [name]: `${salt}:${hash(pw, salt)}` };
      await writeFile(REG, JSON.stringify(registered), { mode: 0o600 });
    } else if (!check(name, pw)) return fail(401, 'login');
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
    return res.writeHead(401, { 'Content-Type': 'text/html' }).end(page(''));
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
}).listen(PORT, () =>
  console.log(
    `GemTD on :${PORT} for ${names().join(', ')}` + (MAX ? `; sign-ups open to ${MAX} users` : ''),
  ),
);
