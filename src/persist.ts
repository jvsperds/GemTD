// Local persistence (BUILD.md §3.5): one IndexedDB key-value store, localStorage if IndexedDB fails.
// ponytail: single 'kv' store holding whole arrays; split into per-record stores if boards get big.
import type { LogEntry } from './sim/game';
import type { Loadout } from './sim/skills';

export const VERSION = 1;

export interface ScoreRow {
  name: string;
  score: number;
  wavesCleared: number;
  hpLeft: number;
  timeSec: number;
  difficulty: string;
  daily?: string; // local date of a daily-challenge run
  seed: number;
  won: boolean;
  date: number;
  version: number;
  commands?: LogEntry[];
  skills?: Loadout; // hero skills the run had, for replays
  hero?: string;
}
export interface Save {
  seed: number;
  difficulty: string;
  daily?: string;
  commands: LogEntry[];
  version: number;
  skills?: Loadout;
  hero?: string;
}
/** Meta progress across games: shells earned and hero skill levels bought with them. */
export interface Hero {
  shells: number;
  skills: Loadout;
  bring?: string[]; // owned skills taken into the next game, at most MAX_BRING (+1 for some heroes)
  heroes?: string[]; // unlocked heroes besides the free one
  hero?: string; // picked for the next game
  quests?: string[]; // completed quest ids
}
export interface Settings {
  speed: number;
  volume: number;
  difficulty: string; // for new games
}
export interface MazeRow {
  name: string;
  rows: string[]; // guide rows, '1' = stone
  date: number;
}
export interface Stores {
  scores: ScoreRow[];
  mazes: MazeRow[];
  save: Save | null;
  settings: Settings;
  hero: Hero;
}
const DEFAULTS: Stores = {
  hero: { shells: 0, skills: {} },
  scores: [],
  mazes: [],
  save: null,
  settings: { speed: 1, volume: 0.5, difficulty: 'normal' },
};

let db: Promise<IDBDatabase | null> | null = null;
function open() {
  return (db ??= new Promise((res) => {
    try {
      const q = indexedDB.open('gemtd', VERSION);
      q.onupgradeneeded = () => {
        if (!q.result.objectStoreNames.contains('kv')) q.result.createObjectStore('kv');
      };
      q.onsuccess = () => res(q.result);
      q.onerror = () => res(null);
    } catch {
      res(null);
    }
  }));
}

// Served by server.mjs: the profile lives on the server under the logged-in user.
// Anywhere else (file://, vite dev, nginx) /api is missing and we stay local.
// `me` is the logged-in user id there, or null when local.
let me: Promise<string | null> | null = null;
const api = (key: string) => 'api/kv/' + key;
function whoAmI() {
  return (me ??= location.protocol.startsWith('http')
    ? fetch('api/me').then(
        async (r) => (r.ok && !r.headers.get('content-type')?.includes('html') ? r.text() : null),
        () => null,
      )
    : Promise.resolve(null));
}
const isRemote = async () => (await whoAmI()) !== null;

/** Name saved on score rows: the login user id on the server, 'Player' when local. */
export async function user() {
  return (await whoAmI()) ?? 'Player';
}

/** Scores for the leaderboards: every profile's on the server (global), else this browser's. */
export async function allScores(): Promise<ScoreRow[]> {
  if (!(await isRemote())) return get('scores');
  const r = await fetch('api/scores');
  if (r.status === 401) relogin();
  if (!r.ok) throw new Error(`load scores: ${r.status}`);
  return r.json();
}

// Logged out (cookie gone or passwords changed): reload, and the server answers with its login page.
function relogin(): never {
  location.reload();
  throw new Error('logged out');
}

export async function get<K extends keyof Stores>(key: K): Promise<Stores[K]> {
  if (await isRemote()) {
    const r = await fetch(api(key));
    if (r.status === 401) relogin();
    if (!r.ok) throw new Error(`load ${key}: ${r.status}`);
    return (await r.json()) ?? DEFAULTS[key];
  }
  const d = await open();
  if (!d) {
    try {
      const v = localStorage.getItem('gemtd.' + key);
      return v ? JSON.parse(v) : DEFAULTS[key];
    } catch {
      return DEFAULTS[key]; // corrupt or blocked storage: start fresh rather than crash
    }
  }
  return new Promise((res) => {
    const q = d.transaction('kv').objectStore('kv').get(key);
    q.onsuccess = () => res(q.result ?? DEFAULTS[key]);
    q.onerror = () => res(DEFAULTS[key]);
  });
}

export async function set<K extends keyof Stores>(key: K, value: Stores[K]) {
  if (await isRemote()) {
    const r = await fetch(api(key), { method: 'PUT', body: JSON.stringify(value) });
    if (r.status === 401) relogin();
    if (!r.ok) throw new Error(`save ${key}: ${r.status}`);
    return;
  }
  const d = await open();
  if (!d) return localStorage.setItem('gemtd.' + key, JSON.stringify(value));
  return new Promise<void>((res, rej) => {
    const tx = d.transaction('kv', 'readwrite');
    tx.objectStore('kv').put(value, key);
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
  });
}

export type Board = 'score' | 'wave' | 'fastest';
export const TOP = 10; // rows shown per board, and all a profile keeps
/** Top rows for a board, optionally filtered by difficulty. Fastest = full clears only. */
export function board(rows: ScoreRow[], which: Board, difficulty = '') {
  // Filter is a difficulty name, or "daily:<date>" for that day's challenge runs.
  const r = rows.filter((x) =>
    difficulty.startsWith('daily:')
      ? x.daily === difficulty.slice(6)
      : !difficulty || x.difficulty === difficulty,
  );
  if (which === 'score') return r.sort((a, b) => b.score - a.score).slice(0, TOP);
  if (which === 'wave')
    return r.sort((a, b) => b.wavesCleared - a.wavesCleared || b.score - a.score).slice(0, TOP);
  return r
    .filter((x) => x.won)
    .sort((a, b) => a.timeSec - b.timeSec)
    .slice(0, TOP);
}

/** Keep only rows that make the top TOP of some board under some filter; the rest can never show. */
export function retain(rows: ScoreRow[]) {
  const filters = new Set(['', ...rows.map((x) => x.difficulty)]);
  for (const x of rows) if (x.daily) filters.add('daily:' + x.daily);
  const keep = new Set<ScoreRow>();
  for (const f of filters)
    for (const b of ['score', 'wave', 'fastest'] as const)
      for (const x of board(rows, b, f)) keep.add(x);
  return rows.filter((x) => keep.has(x));
}
