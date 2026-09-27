// Core Gem TD loop (BUILD.md Â§2.1, Â§2.7). Pure TS, no DOM.
// Build phase: place 5 random gems, then finish with Keep / Merge ^ / Merge ^^ (Downgrade and
// Remove stone are extra actions). Unkept gems become stones and the wave starts.
// Combine builds a special tower from recipe ingredients anywhere on the board (BUILD.md §2.4).
import { codeOf, rng, type Combat, type GemDef, type SpecialDef, type Tower } from './towers';
import { CREEPS_PER_WAVE, UNITS_PER_CELL } from './waves';

export interface LevelDef {
  level: number;
  odds: number[]; // % per quality 1..5
  upgradeCost: number | null;
}

export const GEMS_PER_ROUND = 5;
export const GEM_TYPES = ['B', 'D', 'E', 'G', 'P', 'Q', 'R', 'Y'];
export const DOWNGRADE_COST = 200;
export const MAX_QUALITY = 6;
// ponytail: kill gold and XP curve are defaults until playtests (BUILD.md Â§6.2).
export const XP_PER_HP = 0.1;
export const LEVEL_EVERY_WAVES = 4.5; // never-buying player reaches level 9 at wave 36
export const GREED = { chance: 0.05, mult: 10 };
export const killGold = (wave: number, boss: boolean) => (wave + 1) * (boss ? 10 : 1);

export class Game {
  gold = 0;
  xp = 0;
  level = 1;
  placed: Tower[] = []; // this round's gems
  /** XP needed to reach level L is xpFor[L - 1]. */
  readonly xpFor: number[];
  private rand: () => number;
  private dmg0 = new Map<Tower, number>(); // damage dealt before this wave, for MVP

  constructor(
    readonly combat: Combat,
    readonly levels: LevelDef[],
    seed = 1,
  ) {
    this.rand = rng(seed ^ 0x5eed);
    const { sim } = combat;
    // Level L is reached by killing everything through wave (L-1) Ã— LEVEL_EVERY_WAVES.
    const cum = [0];
    for (let w = 1; w <= sim.lastWave; w++) {
      const defs = sim.waves.filter((d) => d.wave === w);
      const n = defs.some((d) => d.boss) ? 1 : CREEPS_PER_WAVE;
      let hp = 0;
      for (let k = 0; k < n; k++) hp += defs[k % defs.length].hp;
      cum.push(cum[w - 1] + hp * XP_PER_HP);
    }
    this.xpFor = levels.map(
      (_, i) => cum[Math.min(Math.round(i * LEVEL_EVERY_WAVES), sim.lastWave)],
    );
    sim.onKill = (cr) => {
      const k = cr.lastHit;
      const greedy =
        k &&
        combat.towers.some((o) => {
          const r = combat.fx(o.def).greedAura;
          return r && Math.hypot(o.c - k.c, o.r - k.r) * UNITS_PER_CELL <= r;
        }) &&
        this.rand() < GREED.chance;
      this.gold += killGold(sim.wave, cr.def.boss) * (greedy ? GREED.mult : 1);
      this.xp += cr.def.hp * XP_PER_HP;
      while (this.level < this.levels.length && this.xp >= this.xpFor[this.level]) this.level++;
    };
  }

  get sim() {
    return this.combat.sim;
  }

  get step() {
    return this.sim.phase !== 'build'
      ? this.sim.phase
      : this.placed.length < GEMS_PER_ROUND
        ? 'place'
        : 'choose';
  }

  get odds() {
    return this.levels[this.level - 1].odds;
  }

  get levelCost() {
    return this.levels[this.level - 1].upgradeCost;
  }

  /** Advance one sim tick; awards the MVP stack when a wave ends. */
  tick() {
    if (this.sim.phase !== 'wave') return;
    this.sim.tick();
    this.combat.tick();
    if (this.sim.phase === 'wave') return;
    let mvp: Tower | null = null,
      best = 0;
    for (const t of this.combat.towers) {
      const d = t.damageDealt - (this.dmg0.get(t) ?? 0);
      if (d > best) [mvp, best] = [t, d];
    }
    if (mvp) mvp.mvp++;
  }

  /** Special towers whose recipe includes `t` and whose other ingredients are on the board. */
  recipesFor(t: Tower) {
    const out: { name: string; parts: Tower[] }[] = [];
    if (this.sim.phase !== 'build') return out;
    for (const def of Object.values(this.combat.gems)) {
      const recipes = (def as GemDef & Partial<SpecialDef>).recipes ?? [];
      for (const rec of recipes) {
        const parts = this.match(rec, t);
        if (!parts) continue;
        // This round's gems can only be combined once all 5 are down.
        if (this.step === 'place' && parts.some((p) => this.placed.includes(p))) continue;
        out.push({ name: def.name, parts });
        break;
      }
    }
    return out;
  }

  private match(rec: string[], t: Tower) {
    const code = codeOf(t.def);
    if (!rec.includes(code)) return null;
    const used = new Set([t]);
    const pool = this.combat.towers;
    const rest = [...rec];
    rest.splice(rest.indexOf(code), 1);
    for (const want of rest) {
      const o = pool.find((p) => !used.has(p) && codeOf(p.def) === want);
      if (!o) return null;
      used.add(o);
    }
    return [...used];
  }

  /** Build special tower `name` on `t`; the other ingredients become stones. */
  combine(t: Tower, name: string) {
    const r = this.recipesFor(t).find((x) => x.name === name);
    if (!r) return false;
    const usesRound = r.parts.some((p) => this.placed.includes(p));
    const stones = new Set(r.parts.filter((p) => p !== t));
    this.combat.towers = this.combat.towers.filter((o) => !stones.has(o));
    t.def = this.combat.gems[name];
    t.target = null;
    return usesRound ? this.finish(t) : true;
  }

  private rollQuality() {
    let x = this.rand() * 100;
    const odds = this.odds;
    for (let q = 0; q < odds.length; q++) if ((x -= odds[q]) < 0) return q + 1;
    return 1;
  }

  place(c: number, r: number) {
    if (this.step !== 'place') return null;
    const type = GEM_TYPES[Math.floor(this.rand() * GEM_TYPES.length)];
    const t = this.combat.place(type + this.rollQuality(), c, r);
    if (t) this.placed.push(t);
    return t;
  }

  private same(t: Tower) {
    return this.placed.filter((o) => o.def === t.def).length;
  }

  canMerge(t: Tower, n: 2 | 4) {
    return (
      this.step === 'choose' &&
      this.placed.includes(t) &&
      this.same(t) >= n &&
      t.def.quality < MAX_QUALITY
    );
  }

  canDowngrade(t: Tower) {
    return (
      this.step === 'choose' &&
      this.placed.includes(t) &&
      t.def.quality > 1 &&
      this.gold >= DOWNGRADE_COST
    );
  }

  keep(t: Tower) {
    if (this.step !== 'choose' || !this.placed.includes(t)) return false;
    return this.finish(t);
  }

  merge(t: Tower, n: 2 | 4) {
    if (!this.canMerge(t, n)) return false;
    t.def = this.combat.gems[t.def.type + Math.min(t.def.quality + n / 2, MAX_QUALITY)];
    return this.finish(t);
  }

  /** Reroll a gem to a random lower quality. The round continues. */
  downgrade(t: Tower) {
    if (!this.canDowngrade(t)) return false;
    this.gold -= DOWNGRADE_COST;
    t.def = this.combat.gems[t.def.type + (1 + Math.floor(this.rand() * (t.def.quality - 1)))];
    return true;
  }

  removeStone(c: number, r: number) {
    if (this.sim.phase !== 'build' || this.combat.towerAt(c, r)) return false;
    return this.sim.maze.removeRock(c, r);
  }

  buyLevel() {
    const cost = this.levelCost;
    if (cost === null || this.gold < cost) return false;
    this.gold -= cost;
    this.level++;
    this.xp = Math.max(this.xp, this.xpFor[this.level - 1]);
    return true;
  }

  /** Keep `t`; the round's other gems become stones; start the wave. */
  private finish(t: Tower) {
    const stones = new Set(this.placed.filter((o) => o !== t));
    this.combat.towers = this.combat.towers.filter((o) => !stones.has(o));
    this.placed = [];
    this.dmg0 = new Map(this.combat.towers.map((o) => [o, o.damageDealt]));
    return this.sim.startWave();
  }
}
