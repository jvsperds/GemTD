// Core Gem TD loop (BUILD.md Â§2.1, Â§2.7). Pure TS, no DOM.
// Build phase: place 5 random gems, then finish with Keep / Merge ^ / Merge ^^ (Downgrade and
// Remove stone are extra actions). Unkept gems become stones and the wave starts.
// Combine builds a special tower from recipe ingredients anywhere on the board (BUILD.md §2.4).
import { codeOf, rng, type Combat, type GemDef, type SpecialDef, type Tower } from './towers';
import { DURATION, SKILLS, goldOf, type Loadout } from './skills';
import { CASTLE_HP, CREEPS_PER_WAVE, TICK, UNITS_PER_CELL } from './waves';

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
/** A player action, serialisable for save/resume and replays. Towers are addressed by cell. */
export type Cmd =
  | ['place' | 'keep' | 'merge2' | 'merge4' | 'down' | 'stone', number, number]
  | ['combine', number, number, string]
  | ['skill', number, number, string] // cell of the target tower (ignored for castle skills)
  | ['level'];
/** Logged command with the wave tick it was issued at (commands may land mid-wave). */
export type LogEntry = [at: number, cmd: Cmd];

/** BUILD.md §2.8: waves cleared × (1000 + difficulty bonus) + castle HP × 50 − elapsed seconds. */
export function score(g: Game) {
  return Math.round(
    g.wavesCleared * (1000 + g.bonusPerWave) + Math.max(0, g.sim.castleHp) * 50 - g.seconds,
  );
}

export const GREED = { chance: 0.05, mult: 10 };
// Tuned with `npm run balance` (8 seeds): a level-buying bot is at level 6–8 by wave ~22.
export const killGold = (wave: number, boss: boolean) =>
  (1 + Math.floor(wave / 2)) * (boss ? 10 : 1);

export class Game {
  gold = 0;
  xp = 0;
  level = 1;
  placed: Tower[] = []; // this round's gems
  bonusPerWave = 0; // difficulty bonus
  kills = 0;
  ticks = 0; // wave ticks simulated, for the clock
  log: LogEntry[] = [];
  skills: Loadout = {}; // hero skills brought to this game; saved with it so replays match
  pray: { gem?: string; quality?: number; chance: number } | null = null; // for the next gem
  onCommand: (() => void) | null = null;
  /** XP needed to reach level L is xpFor[L - 1]. */
  readonly xpFor: number[];
  private rand: () => number;
  private dmg0 = new Map<Tower, number>(); // damage dealt before this wave, for MVP

  constructor(
    readonly combat: Combat,
    readonly levels: LevelDef[],
    readonly seed = 1,
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
      this.kills++;
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

  get seconds() {
    return this.ticks * TICK;
  }

  get wavesCleared() {
    return this.sim.phase === 'build' || this.sim.phase === 'won'
      ? this.sim.wave
      : this.sim.wave - 1;
  }

  get over() {
    return this.sim.phase === 'won' || this.sim.phase === 'lost';
  }

  /** Apply a command; successful ones are logged. */
  run(cmd: Cmd) {
    const [op, c = 0, r = 0, name = ''] = cmd;
    const t = this.combat.towerAt(c, r);
    const ok =
      op === 'place'
        ? !!this.place(c, r)
        : op === 'stone'
          ? this.removeStone(c, r)
          : op === 'level'
            ? this.buyLevel()
            : op === 'skill'
              ? this.cast(name, t)
              : !!t &&
                (op === 'keep'
                  ? this.keep(t)
                  : op === 'merge2'
                    ? this.merge(t, 2)
                    : op === 'merge4'
                      ? this.merge(t, 4)
                      : op === 'down'
                        ? this.downgrade(t)
                        : this.combine(t, name));
    if (ok) {
      this.log.push([this.ticks, cmd]);
      this.onCommand?.();
    }
    return ok;
  }

  /** Re-run a command log on a fresh game with the same seed. Waves between commands run headless. */
  replay(log: LogEntry[]) {
    for (const [at, cmd] of log) {
      while (this.sim.phase === 'wave' && this.ticks < at) this.tick();
      this.run(cmd);
    }
  }

  /** Advance one sim tick; awards the MVP stack when a wave ends. */
  tick() {
    if (this.sim.phase !== 'wave') return;
    this.ticks++;
    const { guard, evade } = this.sim;
    for (const b of [guard, evade, ...this.combat.towers.flatMap((t) => [t.haste, t.aim])])
      if (b.t > 0) b.t -= TICK;
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
    // Roll only once the cell is accepted, so refused clicks don't advance the RNG (replays).
    const t = this.combat.place('B1', c, r);
    if (!t) return null;
    let type = GEM_TYPES[Math.floor(this.rand() * GEM_TYPES.length)];
    let q = this.rollQuality();
    const p = this.pray; // a Pray skill cast this round biases this one gem
    if (p) {
      this.pray = null;
      if (this.rand() * 100 < p.chance) [type, q] = [p.gem ?? type, p.quality ?? q];
    }
    t.def = this.combat.gems[type + q];
    this.placed.push(t);
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
    // Only while gems can still be placed this round.
    if (this.step !== 'place' || this.combat.towerAt(c, r)) return false;
    return this.sim.maze.removeRock(c, r);
  }

  canCast(id: string, t?: Tower) {
    const s = SKILLS[id];
    return (
      !!s &&
      !!this.skills[id] &&
      !this.over &&
      this.gold >= goldOf(id, this.skills[id]) &&
      (!s.tower || !!t) &&
      (id !== 'heal' || this.sim.castleHp < CASTLE_HP) &&
      (id !== 'hammer' ||
        (this.step === 'choose' && this.placed.includes(t!) && t!.def.quality > 1)) &&
      (!s.pray || this.sim.phase === 'build')
    );
  }

  /** Cast hero skill `id` (on tower `t` for tower skills) for its gold cost. */
  cast(id: string, t?: Tower) {
    if (!this.canCast(id, t)) return false;
    const s = SKILLS[id],
      v = s.value[this.skills[id] - 1];
    this.gold -= goldOf(id, this.skills[id]);
    if (s.pray) this.pray = { ...s.pray, chance: v };
    else if (id === 'hammer') t!.def = this.combat.gems[t!.def.type + (t!.def.quality - 1)];
    else if (id === 'heal')
      this.sim.castleHp = Math.min(CASTLE_HP, this.sim.castleHp + 1 + Math.floor(this.rand() * v));
    else {
      const b =
        id === 'guard'
          ? this.sim.guard
          : id === 'evade'
            ? this.sim.evade
            : t![id as 'haste' | 'aim'];
      [b.v, b.t] = [v, DURATION];
    }
    return true;
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
