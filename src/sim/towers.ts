// Gem and special towers, combat. Pure TS, no DOM. Towers sit on ROCK cells of the maze.
// Hits resolve instantly; `shots` records this tick's hits for the renderer to draw as tracers.
// Abilities are parsed once per tower def from their data ids (numbers from the wiki tooltips).
import {
  armorOf,
  CASTLE_HP,
  DISARM_RANGE,
  EVASION,
  hasAbility,
  REACTIVE_ARMOR,
  REACTIVE_MAX,
  REACTIVE_TIME,
  rng,
  TICK,
  UNITS_PER_CELL,
  UNTOUCHABLE,
  type Creep,
  type WaveSim,
} from './waves';
import { PEDAL, pedalOf, SPELL, type Spell } from './pedals';

export { rng };

export interface GemDef {
  name: string;
  type: string; // gem letter, or 'S' for special towers
  quality: number; // 1..6; 0 for special towers
  damage: number;
  bonusDamage: number;
  attackRate: number; // seconds between attacks (Dota BAT)
  range: number; // Dota units
  abilities: string[];
  pedal?: boolean; // casts a spell on creeps that come near instead of attacking
}

export interface SpecialDef extends Omit<GemDef, 'type' | 'quality'> {
  recipes: string[][];
  secret: boolean;
}

export interface Tower {
  def: GemDef;
  c: number;
  r: number;
  cooldown: number;
  target: Creep | null;
  damageDealt: number; // total; physical = damageDealt - magicDealt
  magicDealt: number;
  kills: number;
  mvp: number;
  disarmT: number;
  // Hero skill buffs: value and seconds left.
  haste: { v: number; t: number };
  aim: { v: number; t: number };
  crit: { v: number; t: number };
  bonds: { v: number; t: number };
  howl: { v: number; t: number }; // Howl pedal: +damage fraction
  // Ally auras covering this tower (distinct gem types stack; copies too on easy), refreshed when towers change.
  aura: { range: number; as: number; dmg: number; aim: number; calm: number };
  // Natural Zumurud: effects including skills copied from neighbours, refreshed with auras.
  copied?: Fx;
}

/** Recipe code of a tower def: `B3` for gems, the name for special towers. */
export const codeOf = (d: GemDef) => (d.quality ? d.type + d.quality : d.name);

/** Gem defs plus special towers (type 'S') keyed by recipe code. */
export function allDefs(gems: Record<string, GemDef>, towers: Record<string, SpecialDef>) {
  const out: Record<string, GemDef> = { ...gems };
  for (const t of Object.values(towers))
    out[t.name] = { ...t, type: 'S', quality: 0 } as GemDef & SpecialDef;
  return out;
}

// ponytail: durations/chances marked "default" are guesses until the Lua values are known.
// ponytail: Crit skill chance is a guess; the wiki only lists the multiplier.
export const SKILL_CRIT_CHANCE = 0.2;
const SLOW = [60, 90, 120, 150, 180, 480];
const POISON = [2, 4, 8, 16, 32, 128];
const ARMOR = [2, 4, 8, 16, 32, 64];
export const AURA = [20, 30, 40, 50, 60, 70];
const CLEAVE = [
  [0.3, 300],
  [0.4, 350],
  [0.5, 400],
  [0.6, 450],
  [0.7, 500],
  [1, 700],
];
const GEM_CRIT: Record<string, [chance: number, mult: number]> = {
  tower_attack1: [0.2, 2],
  tower_attack2: [0.2, 3],
  tower_attack5: [0.2, 5],
};
export const DEBUFF_TIME = 5; // seconds, slow / poison / armor reduction
export const AURA_RANGE = 664;
export const STUN_TIME = 2;
export const GAZE = { chance: 0.01, range: 1000, time: 3 };
export const FROST = { pct: 0.5, splash: 300, time: 3 };
export const LIGHTNING = { chance: 0.3, damage: 150, jumps: 5, radius: 1000 };
export const FORK = { chance: 0.25, targets: 3 }; // default: 3 bolts of attack damage, magic
export const MELANCHOLY = { chance: 0.03, time: 5 };
export const KILL_BONUS = 0.1; // special towers: +10% damage per 10 kills
export const ZUMURUD = 'Natural Zumurud';
export const MVP_BONUS = 0.1;

interface EnemyAura {
  range: number;
  dps?: number;
  armor?: number;
  slowPct?: number;
  slow?: number;
  mr?: number;
  flyingOnly?: boolean;
  pierceImmune?: boolean;
}
export interface Fx {
  slow: number;
  armor: number;
  poison: number;
  cleave: number[] | null;
  crit: [number, number][];
  targets: number;
  magicPct: number;
  stun: number; // chance
  frost: boolean;
  lightning: boolean;
  fork: boolean;
  heal: number; // chance
  gaze: boolean;
  melancholy: boolean;
  trueSight: boolean;
  as: number; // own attack speed bonus
  asAura: [range: number, bonus: number] | null;
  dmgAura: number; // range, +50%
  rangeAura: number; // range, +300
  aimAura: number; // range, cannot miss
  calmAura: number; // range, immune to Disarm
  greedAura: number; // range, 5% ×10 gold
  enemy: EnemyAura[];
  pedal: [Spell, number] | null; // spell and tier
}

const lvl = (id: string) => +(id.match(/(\d)$/)?.[1] ?? 1);

export function parseFx(d: GemDef): Fx {
  const f: Fx = {
    slow: 0,
    armor: 0,
    poison: 0,
    cleave: null,
    crit: [],
    targets: 1,
    magicPct: 0,
    stun: 0,
    frost: false,
    lightning: false,
    fork: false,
    heal: 0,
    gaze: false,
    melancholy: false,
    trueSight: false,
    as: 0,
    asAura: null,
    dmgAura: 0,
    rangeAura: 0,
    aimAura: 0,
    calmAura: 0,
    greedAura: 0,
    enemy: [],
    pedal: null,
  };
  for (const id of d.abilities) {
    const n = lvl(id);
    const p = pedalOf(id);
    if (p) f.pedal = p;
    else if (id.startsWith('tower_slow')) f.slow = SLOW[n - 1];
    else if (id.startsWith('tower_jianjia')) f.armor = ARMOR[n - 1];
    else if (id === 'tower_jin') f.armor = 32;
    else if (id === 'tower_jin2') f.armor = 48;
    else if (id.startsWith('tower_du')) f.poison = POISON[n - 1];
    else if (id.startsWith('tower_jianshe')) f.cleave = CLEAVE[n - 1];
    else if (d.quality && GEM_CRIT[id]) f.crit.push(GEM_CRIT[id]);
    else if (id === 'tower_baoji1') f.crit.push([0.1, 5]);
    else if (id === 'tower_fenliejian') f.targets = 3;
    else if (id === 'tower_fenliejian_xianyan') f.targets = 5;
    else if (id === 'tower_fenliejian_you') f.targets = 10;
    else if (id === 'tower_ranjin') f.magicPct = 1;
    else if (id === 'tower_10jiyun') f.stun = 0.1;
    else if (id === 'tower_jihan') f.frost = true;
    else if (id === 'tower_shandianlian') f.lightning = true;
    else if (id === 'tower_chazhuangshandian') f.fork = true;
    else if (id === 'tower_zhongguoyu') f.heal = 0.01;
    else if (id === 'tower_5shihua') f.gaze = true;
    else if (id === 'tower_aojiao') f.melancholy = true;
    else if (id === 'tower_true_sight') f.trueSight = true;
    else if (id === 'tower_speed2') f.as = 500;
    else if (id === 'tower_speed1') f.as = 200;
    else if (id === 'tower_speed_aura_guichu') f.asAura = [200, 200];
    else if (id.startsWith('tower_speed_aura')) f.asAura = [AURA_RANGE, AURA[n - 1]];
    else if (id === 'tower_maoyan') f.dmgAura = 500;
    else if (id === 'tower_shechengguanghuan') f.rangeAura = 290;
    else if (id === 'tower_jingzhun') f.aimAura = 300;
    else if (id === 'tower_chenmoguanghuan') f.calmAura = 600;
    else if (id === 'tower_tanlan') f.greedAura = 800;
    else if (id === 'tower_huiyao') f.enemy.push({ range: 400, dps: 60 });
    else if (id === 'tower_huiyao2') f.enemy.push({ range: 500, dps: 320 });
    else if (id === 'tower_huiyao3') f.enemy.push({ range: 800, dps: 2500 });
    else if (id === 'tower_bixi') f.enemy.push({ range: 800, armor: 15 });
    else if (id === 'tower_bixi2') f.enemy.push({ range: 1200, armor: 30, pierceImmune: true });
    else if (id === 'tower_lanbaoshi') f.enemy.push({ range: 300, slowPct: 0.7 });
    else if (id === 'tower_lanbaoshi2') f.enemy.push({ range: 556, slowPct: 0.75 });
    else if (id === 'tower_zheyi')
      f.enemy.push({ range: 600, armor: 10, slow: 150, flyingOnly: true });
    else if (id === 'tower_zheyi2')
      f.enemy.push({ range: 600, armor: 10, slow: 250, mr: 50, flyingOnly: true });
    else if (id === 'tower_zheyi3')
      f.enemy.push({ range: 600, armor: 64, slow: 480, mr: 100, flyingOnly: true });
    // tower_attackN on special towers is already in bonusDamage; tower_chain_frost needs
    // pedals (Phase 7); eNNNN ids are cosmetic.
  }
  return f;
}

/** Dota physical damage multiplier. */
export const armorMult = (a: number) => 1 - (0.06 * a) / (1 + 0.06 * Math.abs(a));

const magicImmune = (cr: Creep) => hasAbility(cr, 'enemy_momian');

export class Combat {
  towers: Tower[] = [];
  heroAs = 0; // hero passive: +% attack speed for every tower
  stackCopies = false; // easy mode: identical gems' buffs/debuffs stack too (else Dota rule: distinct types only)
  shots: { from: Tower; to: Creep }[] = [];
  onHeal: (() => void) | null = null;
  private rand: () => number;
  private fxCache = new Map<GemDef, Fx>();

  /** A tower's effects, including Natural Zumurud's copied skills. */
  tfx(t: Tower) {
    return t.copied ?? this.fx(t.def);
  }

  /** Natural Zumurud copies every skill of the two strongest towers in its 3x3 (not pedals or other Zumuruds). */
  private copySkills(z: Tower) {
    const dps = (o: Tower) => (o.def.damage + o.def.bonusDamage) / o.def.attackRate;
    const src = this.towers
      .filter(
        (o) =>
          o !== z &&
          o.def.name !== ZUMURUD &&
          !o.def.pedal &&
          Math.abs(o.c - z.c) <= 1 &&
          Math.abs(o.r - z.r) <= 1,
      )
      .sort((a, b) => dps(b) - dps(a))
      .slice(0, 2);
    z.copied = parseFx({ ...z.def, abilities: [...z.def.abilities, ...src.flatMap((o) => o.def.abilities)] });
  }

  /** Stacking key for a tower's effects: its gem type, or the tower itself when copies stack. */
  private stackKey(t: Tower): Tower | string {
    return this.stackCopies ? t : t.def.name;
  }

  constructor(
    readonly sim: WaveSim,
    readonly gems: Record<string, GemDef>,
    seed = 1,
  ) {
    this.rand = rng(seed);
  }

  fx(d: GemDef) {
    let f = this.fxCache.get(d);
    if (!f) this.fxCache.set(d, (f = parseFx(d)));
    return f;
  }

  place(code: string, c: number, r: number): Tower | null {
    const def = this.gems[code];
    if (!def || this.towerAt(c, r) || !this.sim.maze.placeRock(c, r)) return null;
    return this.placePedal(code, c, r);
  }

  /** Add a tower without touching the maze: pedals lie on open path cells. */
  placePedal(code: string, c: number, r: number): Tower {
    const t: Tower = {
      def: this.gems[code],
      c,
      r,
      cooldown: 0,
      target: null,
      damageDealt: 0,
      magicDealt: 0,
      kills: 0,
      mvp: 0,
      disarmT: 0,
      haste: { v: 0, t: 0 },
      aim: { v: 0, t: 0 },
      crit: { v: 0, t: 0 },
      bonds: { v: 0, t: 0 },
      howl: { v: 0, t: 0 },
      aura: { range: 0, as: 0, dmg: 0, aim: 0, calm: 0 },
    };
    this.towers.push(t);
    this.refreshAuras();
    return t;
  }

  remove(c: number, r: number) {
    const i = this.towers.findIndex((t) => t.c === c && t.r === r);
    if (i >= 0) this.towers.splice(i, 1);
    return this.sim.maze.removeRock(c, r);
  }

  towerAt(c: number, r: number) {
    return this.towers.find((t) => t.c === c && t.r === r);
  }

  private dist(t: Tower, cr: Creep) {
    return Math.hypot(t.c + 0.5 - cr.x, t.r + 0.5 - cr.y) * UNITS_PER_CELL;
  }

  private tdist(a: Tower, b: Tower) {
    return Math.hypot(a.c - b.c, a.r - b.r) * UNITS_PER_CELL;
  }

  /** Ally auras covering `t`: different gem types stack, copies of one type don't. */
  private allyAura(t: Tower, pick: (f: Fx) => [range: number, value: number] | null) {
    const seen = new Set<Tower | string>();
    let sum = 0;
    for (const o of this.towers) {
      const a = pick(this.tfx(o));
      if (a && a[0] && !seen.has(this.stackKey(o)) && this.tdist(o, t) <= a[0]) {
        seen.add(this.stackKey(o));
        sum += a[1];
      }
    }
    return sum;
  }

  private auraDefs: GemDef[] = [];

  /** Recompute ally auras only when a tower was added, removed or changed type. */
  private aurasStale() {
    const t = this.towers,
      d = this.auraDefs;
    let stale = t.length !== d.length;
    for (let i = 0; i < t.length && !stale; i++) stale = t[i].def !== d[i];
    return stale;
  }

  /** O(towers²); on placement and whenever the tower set changes. */
  refreshAuras() {
    this.auraDefs = this.towers.map((t) => t.def);
    for (const t of this.towers)
      if (t.def.name === ZUMURUD) this.copySkills(t);
      else t.copied = undefined;
    for (const t of this.towers) {
      const a = t.aura;
      a.range = this.allyAura(t, (f) => [f.rangeAura, 300]);
      a.as = this.allyAura(t, (f) => f.asAura);
      a.dmg = this.allyAura(t, (f) => [f.dmgAura, 0.5]);
      a.aim = this.allyAura(t, (f) => [f.aimAura, 1]);
      a.calm = this.allyAura(t, (f) => [f.calmAura, 1]);
    }
  }

  range(t: Tower) {
    const r = t.def.range + t.aura.range;
    return t.aim.t > 0 ? Math.max(r, t.aim.v) : r;
  }

  /** Attack speed: own +AS plus the strongest AS aura in range. */
  attacksPerSec(t: Tower) {
    const bonus = this.tfx(t).as + t.aura.as + this.heroAs + (t.haste.t > 0 ? t.haste.v : 0);
    return Math.max(20, 100 + bonus) / 100 / t.def.attackRate;
  }

  /** Damage multiplier from MVP stacks, kill bonus (special towers) and damage auras. */
  damageMult(t: Tower) {
    const kills = t.def.quality ? 0 : Math.floor(t.kills / 10) * KILL_BONUS;
    // Revenge hero skill: +1% damage per castle HP below its threshold.
    const { revenge, castleHp } = this.sim;
    const rev = revenge.t > 0 ? Math.max(0, revenge.v - castleHp) / 100 : 0;
    return 1 + t.mvp * MVP_BONUS + kills + t.aura.dmg + rev + (t.howl.t > 0 ? t.howl.v : 0);
  }

  /** Physical hit on a creep; returns damage dealt. */
  hit(t: Tower, cr: Creep, amount: number) {
    if (hasAbility(cr, 'enemy_wumian')) return 0;
    const dmg = amount * armorMult(armorOf(cr)) * (cr.ampT > 0 ? 2 : 1);
    this.deal(t, cr, dmg);
    if (hasAbility(cr, 'shredder_reactive_armor')) {
      cr.reactive = Math.min(cr.reactive + REACTIVE_ARMOR, REACTIVE_MAX);
      cr.reactiveT = REACTIVE_TIME;
    }
    return dmg;
  }

  /** Magic damage, reduced by magic resist (+aura reduction); none to magic immune. */
  magic(t: Tower | null, cr: Creep, amount: number) {
    if (magicImmune(cr)) return;
    this.deal(
      t,
      cr,
      amount * (1 - Math.max(-1, cr.def.magicResist - Math.max(cr.auraMr, cr.mrRed)) / 100),
      true,
    );
  }

  private deal(t: Tower | null, cr: Creep, dmg: number, magic = false) {
    if (!cr.alive) return;
    if (t) cr.lastHit = t;
    if (cr.terrorT > 0) dmg *= 1 + cr.terror;
    this.sim.damage(cr, dmg);
    if (t) {
      t.damageDealt += dmg;
      if (magic) t.magicDealt += dmg;
      if (!cr.alive) t.kills++;
    }
  }

  private attack(t: Tower, cr: Creep) {
    const d = t.def,
      f = this.tfx(t);
    this.shots.push({ from: t, to: cr });
    // Evasion (unless an aim aura covers the tower); Refraction blocks whole instances.
    if (hasAbility(cr, 'guai_shanbi') && !t.aura.aim && this.rand() < EVASION) return;
    if (hasAbility(cr, 'enemy_bukeqinfan') && this.rand() < UNTOUCHABLE.chance)
      t.disarmT = Math.max(t.disarmT, UNTOUCHABLE.time);
    if (cr.shield > 0) {
      cr.shield--;
      return;
    }
    let dmg = (d.damage + d.bonusDamage) * this.damageMult(t);
    for (const [chance, mult] of f.crit) if (this.rand() < chance) dmg *= mult;
    if (t.crit.t > 0 && this.rand() < SKILL_CRIT_CHANCE) dmg *= t.crit.v;
    // Debuffs land before damage so armor reduction counts on this hit. One stack per gem type, timer refreshes.
    const poison = magicImmune(cr) ? 0 : f.poison;
    if (f.armor || f.slow || poison) {
      cr.stacks.set(this.stackKey(t), { slow: f.slow, armor: f.armor, poison, t: DEBUFF_TIME, by: t });
      cr.slow = sumStacks(cr, 'slow');
      cr.armorRed = sumStacks(cr, 'armor');
      cr.poison = sumStacks(cr, 'poison');
    }
    if (f.stun && this.rand() < f.stun) cr.stunT = Math.max(cr.stunT, STUN_TIME);
    if (f.frost)
      for (const o of this.near(cr, FROST.splash)) {
        o.slowPct = Math.max(o.slowPct, FROST.pct);
        o.slowPctT = o.noHealT = FROST.time;
      }
    if (f.gaze && this.rand() < GAZE.chance)
      for (const o of this.near(cr, GAZE.range)) o.stunT = o.ampT = GAZE.time;
    this.hit(t, cr, dmg);
    if (t.bonds.t > 0) {
      // Fatal Bonds hero skill: pure damage to the enemy farthest from the tower.
      let far: Creep | null = null;
      for (const o of this.sim.creeps)
        if (o.alive && (!far || this.dist(t, o) > this.dist(t, far))) far = o;
      if (far) this.deal(t, far, (dmg * t.bonds.v) / 100);
    }
    if (f.magicPct) this.magic(t, cr, dmg * f.magicPct);
    if (f.cleave) {
      const [pct, radius] = f.cleave;
      for (const o of this.near(cr, radius)) if (o !== cr) this.hit(t, o, dmg * pct);
    }
    if (f.lightning && this.rand() < LIGHTNING.chance) {
      let at = cr;
      const hitSet = new Set<Creep>();
      for (let j = 0; j < LIGHTNING.jumps; j++) {
        const next = this.near(at, LIGHTNING.radius).find((o) => !hitSet.has(o));
        if (!next) break;
        hitSet.add(next);
        this.magic(t, next, LIGHTNING.damage);
        at = next;
      }
    }
    if (f.fork && this.rand() < FORK.chance)
      for (const o of this.near(cr, this.range(t)).slice(0, FORK.targets)) this.magic(t, o, dmg);
    if (f.heal && this.rand() < f.heal)
      this.sim.castleHp = Math.min(CASTLE_HP, this.sim.castleHp + 1);
    if (f.melancholy && this.rand() < MELANCHOLY.chance) t.disarmT = MELANCHOLY.time;
  }

  /** Cast pedal `t`'s spell at tier k on creep `cr`. Spell-immune creeps resist unless it pierces. */
  private pedal(t: Tower, cr: Creep, spell: Spell, k: number) {
    const ok = (o: Creep, pierce = false) => pierce || !magicImmune(o);
    const stun = (o: Creep, s: number) => (o.stunT = Math.max(o.stunT, s));
    const slow = (o: Creep, pct: number, time: number) => {
      o.slowPct = Math.max(o.slowPct, pct);
      o.slowPctT = Math.max(o.slowPctT, time);
    };
    switch (spell) {
      case 'ensnare':
        if (ok(cr, k > 0)) stun(cr, SPELL.ensnare.root[k]);
        break;
      case 'gale': {
        const s = SPELL.gale;
        for (const o of this.near(cr, s.radius)) if (ok(o)) slow(o, s.slowPct[k], s.time[k]);
        break;
      }
      case 'torrent': {
        const s = SPELL.torrent;
        for (const o of this.near(cr, s.radius))
          if (ok(o)) {
            stun(o, s.stun[k]);
            slow(o, s.slowPct[k], s.stun[k] + s.slowTime[k]);
          }
        break;
      }
      case 'howl':
        for (const o of this.towers)
          if (this.tdist(o, t) <= SPELL.howl.radius[k] && o.howl.v <= SPELL.howl.dmg[k])
            [o.howl.v, o.howl.t] = [SPELL.howl.dmg[k], SPELL.howl.time];
        break;
      case 'acid': {
        const s = SPELL.acid;
        for (const o of this.near(cr, s.radius)) {
          const old = o.stacks.get('acid');
          o.stacks.set('acid', {
            slow: 0,
            armor: Math.max(old?.armor ?? 0, s.armor[k]),
            poison: 0,
            t: Math.max(old?.t ?? 0, s.time[k]),
            by: t,
          });
          o.armorRed = sumStacks(o, 'armor');
        }
        break;
      }
      case 'paralysis': {
        const s = SPELL.paralysis;
        const hit = [cr, ...this.near(cr, s.range).filter((o) => o !== cr)];
        for (const o of hit.slice(0, s.bounces[k])) if (ok(o, k > 0)) stun(o, s.stun);
        break;
      }
      case 'terrorize':
        cr.terror = Math.max(cr.terrorT > 0 ? cr.terror : 0, SPELL.terrorize.amp[k]);
        cr.terrorT = SPELL.terrorize.time[k];
        slow(cr, SPELL.terrorize.slowPct, SPELL.terrorize.time[k]);
        break;
      case 'decrepify': {
        const s = SPELL.decrepify;
        if (!ok(cr)) break;
        slow(cr, s.slowPct[k], s.time[k]);
        cr.mrRed = Math.max(cr.mrT > 0 ? cr.mrRed : 0, s.mr[k]);
        cr.mrT = s.time[k];
        break;
      }
    }
  }

  private near(cr: Creep, radius: number) {
    return this.sim.creeps.filter(
      (o) => o.alive && Math.hypot(o.x - cr.x, o.y - cr.y) * UNITS_PER_CELL <= radius,
    );
  }

  /** Invisible creeps can only be targeted inside some tower's True Sight (its attack range). */
  private visible(cr: Creep) {
    if (!hasAbility(cr, 'riki_permanent_invisibility')) return true;
    return this.towers.some((o) => this.tfx(o).trueSight && this.dist(o, cr) <= this.range(o));
  }

  private canHit(t: Tower, cr: Creep) {
    return cr.alive && this.dist(t, cr) <= this.range(t) && this.visible(cr);
  }

  /** Enemy auras (armor/slow/magic resist/burn) and creep Disarm auras. */
  private auras() {
    for (const cr of this.sim.creeps) {
      cr.auraArmor = cr.auraSlowPct = cr.auraSlow = cr.auraMr = 0;
    }
    const seen = new Set<Tower | string>();
    for (const t of this.towers) {
      // Different gem types stack; copies of one type add nothing (their burn still ticks).
      const key = this.stackKey(t);
      const dup = seen.has(key);
      seen.add(key);
      for (const a of this.tfx(t).enemy)
        for (const cr of this.sim.creeps) {
          if (!cr.alive || this.dist(t, cr) > a.range) continue;
          if (a.flyingOnly && !cr.def.flying) continue;
          const immune = magicImmune(cr) && !a.pierceImmune;
          if (a.dps) this.magic(t, cr, a.dps * TICK);
          if (dup) continue;
          if (a.armor && !immune) cr.auraArmor += a.armor;
          if (a.slowPct && !immune) cr.auraSlowPct = 1 - (1 - cr.auraSlowPct) * (1 - a.slowPct);
          if (a.slow) cr.auraSlow += a.slow;
          if (a.mr) cr.auraMr += a.mr;
        }
      if (t.disarmT > 0) t.disarmT -= TICK;
    }
    for (const cr of this.sim.creeps)
      if (cr.alive && hasAbility(cr, 'guai_jiaoxieguanghuan'))
        for (const t of this.towers)
          if (this.dist(t, cr) <= DISARM_RANGE && !t.aura.calm)
            t.disarmT = Math.max(t.disarmT, TICK);
  }

  tick() {
    this.shots.length = 0;
    const creeps = this.sim.creeps;
    if (this.aurasStale()) this.refreshAuras();
    this.auras();
    // Debuff timers and poison (magic damage).
    for (const cr of creeps) {
      if (!cr.alive) continue;
      for (const [id, d] of cr.stacks) {
        if (d.poison) this.magic(d.by, cr, d.poison * TICK);
        if ((d.t -= TICK) <= 0) cr.stacks.delete(id);
      }
      cr.slow = sumStacks(cr, 'slow');
      cr.armorRed = sumStacks(cr, 'armor');
      cr.poison = sumStacks(cr, 'poison');
    }
    for (const t of this.towers) {
      t.cooldown = Math.max(0, t.cooldown - TICK);
      const spell = this.tfx(t).pedal;
      if (spell) {
        // Triggered by a ground creep stepping onto the pedal's cell.
        const cr =
          t.cooldown > 0
            ? null
            : creeps.find(
                (o) =>
                  o.alive && !o.def.flying && Math.floor(o.x) === t.c && Math.floor(o.y) === t.r,
              );
        if (cr) {
          t.cooldown = PEDAL.cooldown;
          this.pedal(t, cr, ...spell);
        }
        continue;
      }
      if (t.disarmT > 0) continue;
      if (t.target && !this.canHit(t, t.target)) t.target = null;
      if (!t.target) {
        // ponytail: O(towers×creeps) scan; spatial buckets when the stress scene needs it.
        // First creep in spawn order = furthest along the route.
        for (const cr of creeps)
          if (this.canHit(t, cr)) {
            t.target = cr;
            break;
          }
      }
      if (!t.target || t.cooldown > 0) continue;
      t.cooldown += 1 / this.attacksPerSec(t);
      this.attack(t, t.target);
      let extra = this.tfx(t).targets - 1;
      for (const cr of creeps)
        if (extra > 0 && cr !== t.target && this.canHit(t, cr)) {
          this.attack(t, cr);
          extra--;
        }
      if (!t.target.alive) t.target = null;
    }
  }
}

function sumStacks(cr: Creep, k: 'slow' | 'armor' | 'poison') {
  let v = 0;
  for (const d of cr.stacks.values()) v += d[k];
  return v;
}
