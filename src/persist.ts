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
}
export interface Settings {
  name: string;
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
  settings: { name: 'Player', speed: 1, volume: 0.5, difficulty: 'normal' },
};

let db: Promise<IDBDatabase | null> | null = null;
function open() {
  return (db ??= new Promise((res) => {
    try {
      const q = indexedDB.open('gemtd', VERSION);
      q.onupgradeneeded = () => q.result.createObjectStore('kv');
      q.onsuccess = () => res(q.result);
      q.onerror = () => res(null);
    } catch {
      res(null);
    }
  }));
}

export async function get<K extends keyof Stores>(key: K): Promise<Stores[K]> {
  const d = await open();
  if (!d) {
    const v = localStorage.getItem('gemtd.' + key);
    return v ? JSON.parse(v) : DEFAULTS[key];
  }
  return new Promise((res) => {
    const q = d.transaction('kv').objectStore('kv').get(key);
    q.onsuccess = () => res(q.result ?? DEFAULTS[key]);
    q.onerror = () => res(DEFAULTS[key]);
  });
}

export async function set<K extends keyof Stores>(key: K, value: Stores[K]) {
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
/** Top rows for a board, optionally filtered by difficulty. Fastest = full clears only. */
export function board(rows: ScoreRow[], which: Board, difficulty = '') {
  // Filter is a difficulty name, or "daily:<date>" for that day's challenge runs.
  const r = rows.filter((x) =>
    difficulty.startsWith('daily:')
      ? x.daily === difficulty.slice(6)
      : !difficulty || x.difficulty === difficulty,
  );
  if (which === 'score') return r.sort((a, b) => b.score - a.score).slice(0, 20);
  if (which === 'wave')
    return r.sort((a, b) => b.wavesCleared - a.wavesCleared || b.score - a.score).slice(0, 20);
  return r
    .filter((x) => x.won)
    .sort((a, b) => a.timeSec - b.timeSec)
    .slice(0, 20);
}

/** Merge imported rows into existing ones, skipping exact duplicates (same seed + date). */
export function mergeScores(have: ScoreRow[], incoming: unknown): ScoreRow[] {
  if (!Array.isArray(incoming)) throw new Error('not a score list');
  const key = (x: ScoreRow) => `${x.seed}:${x.date}`;
  const seen = new Set(have.map(key));
  const ok = incoming.filter(
    (x): x is ScoreRow =>
      x && typeof x.score === 'number' && typeof x.seed === 'number' && typeof x.date === 'number',
  );
  return [...have, ...ok.filter((x) => !seen.has(key(x)))];
}
