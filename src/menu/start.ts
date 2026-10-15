import type { LogEntry } from '../sim/game';
import type { Loadout } from '../sim/skills';

/** Reload handoff shared by live runs and recorded replays. */
export interface Start {
  seed: number;
  difficulty: string;
  daily?: string;
  mutators?: string[];
  map?: string;
  replay?: LogEntry[];
  builder?: boolean;
  skills?: Loadout;
  hero?: string;
  rules?: number;
}

export function startNext(options: Start) {
  try {
    sessionStorage.setItem('gemtd.start', JSON.stringify(options));
  } catch {
    // Storage blocked: reload still starts a fresh random game.
  }
  document.getElementById('loading')!.hidden = false;
  location.reload();
}
