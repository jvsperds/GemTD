// Core Gem TD loop (BUILD.md Â§2.1, Â§2.7). Pure TS, no DOM.
// Build phase: place 5 random gems, then finish with Keep / Merge ^ / Merge ^^ (Downgrade and
// Remove stone are extra actions). Unkept gems become stones and the wave starts.
// Combine builds a special tower from recipe ingredients anywhere on the board (BUILD.md §2.4).
import { codeOf, rng, type Combat, type GemDef, type SpecialDef, type Tower } from './towers';
import { HEROES, type Perk } from './heroes';
import { ROCK } from './maze';
import { DURATION, SKILLS, goldOf, withPassives, type Loadout } from './skills';
import { CASTLE_HP, CREEPS_PER_WAVE, TICK, UNITS_PER_CELL } from './waves';

export interface LevelDef {
  level: number;
  odds: number[]; // % per quality 1..5
  upgradeCost: number | null;
}

export const GEMS_PER_ROUND = 5;
/** The 8 cells around a centre, clockwise on screen from the top-left. */
const RING = [
  [-1, -1],
  [0, -1],
  [1, -1],
  [1, 0],
  [1, 1],
  [0, 1],
  [-1, 1],
  [-1, 0],
] as const;
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
  | ['pedal', number, number] // lay the oldest pedal in hand on a path cell
  // Target cell (the tower for tower skills; ignored by castle skills), then an optional picked cell.
  | ['skill', number, number, string, number?, number?]
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
  recipeLuck = 0; // easy: per-level chance a gem completes a recipe (see place)
  pedals: string[] = []; // combined pedals waiting to be laid on the path
  hero = ''; // hero id; '' = no hero (tests, old saves)
  get perk(): Perk {
    return withPassives(HEROES[this.hero]?.perk ?? {}, this.skills);
  }
  /** Pick the hero; set `skills` first, and call before replaying commands. */
  setHero(id: string) {
    this.hero = id;
    this.gold += this.perk.startGold ?? 0;
    this.sim.bossBite = this.perk.bossBite ?? 0;
    this.combat.heroAs = this.perk.attackSpeed ?? 0;
    const { execute = 0, luckyCrit = 0, bash = 0 } = this.perk;
    this.combat.heroProc = { execute, luckyCrit, bash };
  }
  /** Gold per cast of skill `id` after the hero's discount. */
  skillGold(id: string) {
    return Math.round(goldOf(id, this.skills[id]) * (1 - (this.perk.skillGold ?? 0)));
  }
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
          const r = combat.tfx(o).greedAura;
          return r && Math.hypot(o.c - k.c, o.r - k.r) * UNITS_PER_CELL <= r;
        }) &&
        this.rand() < GREED.chance;
      const gold =
        killGold(sim.wave, cr.def.boss) *
        (greedy ? GREED.mult : 1) *
        (cr.def.boss ? 1 + (this.perk.bossGold ?? 0) : 1) *
        (this.perk.midas && this.rand() < this.perk.midas ? 3 : 1);
      this.gold += Math.round(gold * (1 + (this.perk.killGold ?? 0)));
      this.xp += cr.def.hp * XP_PER_HP * (1 + (this.perk.xp ?? 0));
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
    const cost = this.levels[this.level - 1].upgradeCost;
    return cost === null ? null : Math.round(cost * (1 - (this.perk.levelCost ?? 0)));
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
            : op === 'pedal'
              ? this.layPedal(c, r)
              : cmd[0] === 'skill'
                ? this.cast(name, c, r, cmd[4], cmd[5])
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
    const buffs = this.combat.towers.flatMap((t) => [t.haste, t.aim, t.crit, t.bonds, t.howl]);
    for (const b of [guard, evade, this.sim.revenge, ...buffs]) if (b.t > 0) b.t -= TICK;
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
    // Endless: past the last wave there are no build rounds; the next wave follows at once.
    if (this.sim.phase === 'build' && this.sim.wave >= this.sim.lastWave) {
      this.dmg0 = new Map(this.combat.towers.map((o) => [o, o.damageDealt]));
      this.sim.startWave();
    }
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
    const def = this.combat.gems[name];
    // Gems combined into a pedal all become stones and the pedal goes into the hand, to be laid
    // on the path. Upgrading pedals (3× same) keeps the selected one where it lies.
    const fromGems = def.pedal && !t.def.pedal;
    const stones = new Set(r.parts.filter((p) => fromGems || p !== t));
    this.combat.towers = this.combat.towers.filter((o) => !stones.has(o));
    if (fromGems) this.pedals.push(name);
    t.def = def;
    t.target = null;
    return usesRound ? this.finish(t) : true;
  }

  /** Lay the oldest pedal in hand on free path ground; creeps trigger it by stepping on it. */
  layPedal(c: number, r: number) {
    const { maze } = this.sim;
    if (this.over || !this.pedals.length || !maze.buildable(c, r) || this.combat.towerAt(c, r))
      return false;
    this.combat.placePedal(this.pedals.shift()!, c, r);
    return true;
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
    const up = this.perk.qualityUp; // Prism: sometimes one quality higher
    if (up && this.rand() < up) q = Math.min(q + 1, MAX_QUALITY);
    // Easy: chance (per hero level) the gem is the last missing ingredient of a recipe on the board.
    if (this.recipeLuck && this.rand() < this.recipeLuck * this.level) {
      const want = this.missingOne(t);
      if (want.length) {
        const code = want[Math.floor(this.rand() * want.length)];
        [type, q] = [code[0], +code.slice(1)];
      }
    }
    const p = this.pray; // a Pray skill cast this round biases this one gem
    if (p) {
      this.pray = null;
      if (this.rand() * 100 < p.chance) [type, q] = [p.gem ?? type, p.quality ?? q];
    }
    t.def = this.combat.gems[type + q];
    this.placed.push(t);
    return t;
  }

  /** Basic gem codes that alone would complete some recipe with what's on the board (besides `skip`). */
  missingOne(skip?: Tower) {
    const have = new Map<string, number>();
    for (const o of this.combat.towers)
      if (o !== skip) have.set(codeOf(o.def), (have.get(codeOf(o.def)) ?? 0) + 1);
    const out = new Set<string>();
    for (const def of Object.values(this.combat.gems))
      for (const rec of (def as GemDef & Partial<SpecialDef>).recipes ?? []) {
        const left = new Map(have);
        const miss = rec.filter((c) => {
          const n = left.get(c) ?? 0;
          left.set(c, n - 1);
          return n <= 0;
        });
        if (miss.length === 1 && /^[A-Z]\d$/.test(miss[0])) out.add(miss[0]);
      }
    return [...out].sort();
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

  /** Whether skill `id` can be cast now (before any map cells are picked). */
  canCast(id: string, t?: Tower) {
    const s = SKILLS[id];
    return (
      !!s &&
      !!this.skills[id] &&
      !this.over &&
      this.gold >= this.skillGold(id) &&
      (!s.tower || (!!t && !t.def.pedal)) &&
      (!(s.build || s.pray) || this.sim.phase === 'build') &&
      (id !== 'heal' || this.sim.castleHp < CASTLE_HP) &&
      (id !== 'hammer' ||
        (this.step === 'choose' && this.placed.includes(t!) && t!.def.quality > 1)) &&
      (id !== 'timelapse' || this.placed.length > 0) &&
      (id !== 'candy' || !this.sim.candy)
    );
  }

  /** Cast hero skill `id` at cell (c, r) (the tower, for tower skills), with an optional second
   * picked cell. Gold is only spent when the skill takes effect. */
  cast(id: string, c: number, r: number, c2 = -1, r2 = -1) {
    const t = this.combat.towerAt(c, r);
    if (!this.canCast(id, t)) return false;
    const ok = this.effect(id, SKILLS[id].value[this.skills[id] - 1], t, c, r, c2, r2);
    if (ok) this.gold -= this.skillGold(id);
    return ok;
  }

  private effect(
    id: string,
    v: number,
    t: Tower | undefined,
    c: number,
    r: number,
    c2: number,
    r2: number,
  ) {
    const { sim, combat } = this,
      { maze } = sim;
    const pray = SKILLS[id].pray;
    if (pray) {
      this.pray = { ...pray, chance: v };
      return true;
    }
    const inside = ([x, y]: number[]) => x >= 0 && y >= 0 && x < maze.w && y < maze.h;
    const moved = () => (combat.refreshAuras(), true);
    switch (id) {
      case 'heal':
        sim.castleHp = Math.min(CASTLE_HP, sim.castleHp + 1 + Math.floor(this.rand() * v));
        return true;
      case 'guard':
      case 'evade':
      case 'revenge':
        [sim[id].v, sim[id].t] = [v, DURATION * (1 + (this.perk.duration ?? 0))];
        return true;
      case 'haste':
      case 'aim':
      case 'crit':
      case 'bonds':
        [t![id].v, t![id].t] = [v, DURATION * (1 + (this.perk.duration ?? 0))];
        return true;
      case 'hammer':
        t!.def = combat.gems[t!.def.type + (t!.def.quality - 1)];
        return moved();
      case 'adjswap': {
        // Tower and stone cells are both rocks, so moving between them never changes the route.
        const stones = RING.map(([dc, dr]) => [t!.c + dc, t!.r + dr]).filter(
          ([x, y]) =>
            inside([x, y]) && maze.cells[maze.idx(x, y)] === ROCK && !combat.towerAt(x, y),
        );
        if (!stones.length) return false;
        [t!.c, t!.r] = stones[Math.floor(this.rand() * stones.length)];
        return moved();
      }
      case 'swap': {
        const o = combat.towerAt(c2, r2);
        if (!o || o === t || o.def.pedal) return false;
        [t!.c, t!.r, o.c, o.r] = [o.c, o.r, t!.c, t!.r];
        return moved();
      }
      case 'stonehenge': {
        const [dc, dr] = [Math.sign(c2 - c), Math.sign(r2 - r)];
        if (!dc && !dr) return false;
        let n = 0;
        for (
          let x = c, y = r;
          n < v && !combat.towerAt(x, y) && maze.placeRock(x, y);
          x += dc, y += dr
        )
          n++;
        return n > 0;
      }
      case 'whirl': {
        const ring = RING.map(([dc, dr]) => [c + dc, r + dr]);
        if (!ring.every(inside) || ring.some(([x, y]) => maze.noBuild[maze.idx(x, y)]))
          return false;
        const cells = ring.map(([x, y]) => maze.idx(x, y));
        const before = cells.map((i) => maze.cells[i]);
        const towers = ring.map(([x, y]) => combat.towerAt(x, y));
        // RING runs clockwise on screen; each cell takes its clockwise neighbour's content.
        cells.forEach((i, k) => (maze.cells[i] = before[(k + 1) % 8]));
        if (!maze.route()) {
          cells.forEach((i, k) => (maze.cells[i] = before[k]));
          return false;
        }
        towers.forEach((o, k) => o && ([o.c, o.r] = ring[(k + 7) % 8]));
        return moved();
      }
      case 'candy': {
        if (!maze.walkable(c, r) || maze.noBuild[maze.idx(c, r)]) return false;
        const wp = maze.waypoints;
        wp.splice(1, 0, [c, r]);
        const ok = !!maze.route();
        wp.splice(1, 1);
        if (ok) sim.candy = [c, r];
        return ok;
      }
      case 'timelapse':
        for (const p of this.placed) combat.remove(p.c, p.r);
        this.placed = [];
        return moved();
    }
    return false;
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
