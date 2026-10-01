/* global URL, process, Buffer, console */
// Self-hosted server: serves dist/ behind HTTP Basic login and keeps one profile file per user.
// Users come from GEMTD_USERS="alice:pw1,bob:pw2". Profiles live in $DATA_DIR/<user>.json.
// ponytail: plain Basic auth — put it behind HTTPS (reverse proxy) or passwords travel in clear.
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { timingSafeEqual, createHash } from 'node:crypto';
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
function who(header) {
  const [scheme, b64] = (header ?? '').split(' ');
  if (scheme !== 'Basic' || !b64) return null;
  const s = Buffer.from(b64, 'base64').toString();
  const i = s.indexOf(':');
  const name = s.slice(0, i),
    pw = s.slice(i + 1);
  const want = users.get(name);
  return want !== undefined && timingSafeEqual(h(pw), h(want)) ? name : null;
}

const profile = async (u) => {
  try {
    return JSON.parse(await readFile(join(DATA, u + '.json'), 'utf8'));
  } catch {
    return {};
  }
};
const locks = new Map(); // per-user write chain so concurrent sets don't clobber each other

createServer(async (req, res) => {
  const user = who(req.headers.authorization);
  // sw.js is public: the browser's background update check sends no credentials, and a 401 there
  // pins an outdated service worker forever.
  if (!user && req.url !== '/sw.js') {
    res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="GemTD"' });
    return res.end('Login required');
  }
  const url = new URL(req.url, 'http://x');
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
