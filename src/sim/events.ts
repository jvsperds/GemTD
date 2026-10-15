/** Opt-in, deterministic build-phase contracts.  This module deliberately has no game RNG. */
export type EventId = 'shrine' | 'goldRush' | 'hurry';
export type EventChoice = 'gold' | 'xp' | 'accept' | 'decline';
export interface EventOffer {
  wave: number;
  id: EventId;
}

export const EVENT_COPY: Record<EventId, { name: string; detail: string }> = {
  shrine: { name: 'Shrine', detail: 'Choose 75 gold or 120 XP. You may decline.' },
  goldRush: {
    name: 'Gold Rush',
    detail: 'Creeps have +35% HP for +50% kill gold. Ends after this wave.',
  },
  hurry: {
    name: 'Hurry Wave',
    detail: 'Creeps move +35% faster for +50% XP. Ends after this wave.',
  },
};

// A local integer mixer makes this independent of gem, combat and wave RNG streams.
const mix = (n: number) => {
  n = Math.imul(n ^ (n >>> 16), 0x45d9f3b);
  n = Math.imul(n ^ (n >>> 16), 0x45d9f3b);
  return (n ^ (n >>> 16)) >>> 0;
};

/** One deterministic offer every 4–6 eligible waves, after wave 4 and before wave 50. */
export function eventAt(seed: number, wave: number, boss: boolean) {
  if (wave < 5 || wave >= 50 || boss) return null;
  let at = 5;
  for (let i = 0; at < 50; i++) {
    while (at % 10 === 0) at++;
    if (at === wave) {
      const ids: EventId[] = ['shrine', 'goldRush', 'hurry'];
      return { wave, id: ids[mix(seed ^ (wave * 0x9e3779b9)) % ids.length] } satisfies EventOffer;
    }
    at += 4 + (mix(seed ^ (i * 0x85ebca6b)) % 3);
  }
  return null;
}
