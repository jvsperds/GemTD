// Core Gem TD loop (BUILD.md §2.1, §2.7). Pure TS, no DOM.
// Build phase: place 5 random gems, then finish with Keep / Merge ^ / Merge ^^ (Downgrade and
// Remove stone are extra actions). Unkept gems become stones and the wave starts.
import { rng, type Combat, type Tower } from './towers';
import { CREEPS_PER_WAVE } from './waves';

export interface LevelDef {
  level: number;
  odds: number[]; // % per quality 1..5
  upgradeCost: number | null;
}

export const GEMS_PER_ROUND = 5;
export const GEM_TYPES = ['B', 'D', 'E', 'G', 'P', 'Q', 'R', 'Y'];
export const DOWNGRADE_COST = 200;
export const MAX_QUALITY = 6;
// ponytail: kill gold and XP curve are defaults until playtests (BUILD.md §6.2).
export const XP_PER_HP = 0.1;
export const LEVEL_EVERY_WAVES = 4.5; // never-buying player reaches level 9 at wave 36
export const killGold = (wave: number, boss: boolean) => (wave + 1) * (boss ? 10 : 1);

export class Game {
  gold = 0;
  xp = 0;
  level = 1;
  placed: Tower[] = []; // this round's gems
  /** XP needed to reach level L is xpFor[L - 1]. */
  readonly xpFor: number[];
  private rand: () => number;

  constructor(
    readonly combat: Combat,
    readonly levels: LevelDef[],
    seed = 1,
  ) {
    this.rand = rng(seed ^ 0x5eed);
    const { sim } = combat;
    // Level L is reached by killing everything through wave (L-1) × LEVEL_EVERY_WAVES.
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
      this.gold += killGold(sim.wave, cr.def.boss);
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
    return this.sim.startWave();
  }
}
