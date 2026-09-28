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
  // Strongest ally auras covering this tower, refreshed each tick (same aura doesn't stack).
  aura: { range: number; as: number; dmg: number; aim: number; calm: number };
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
  };
  for (const id of d.abilities) {
    const n = lvl(id);
    if (id.startsWith('tower_slow')) f.slow = SLOW[n - 1];
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
  shots: { from: Tower; to: Creep }[] = [];
  onHeal: (() => void) | null = null;
  private rand: () => number;
  private fxCache = new Map<GemDef, Fx>();

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
    if (!def || !this.sim.maze.placeRock(c, r)) return null;
    const t: Tower = {
      def,
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

  /** Strongest value of an ally aura covering `t` (same aura doesn't stack). */
  private allyAura(t: Tower, pick: (f: Fx) => [range: number, value: number] | null) {
    let best = 0;
    for (const o of this.towers) {
      const a = pick(this.fx(o.def));
      if (a && a[0] && this.tdist(o, t) <= a[0]) best = Math.max(best, a[1]);
    }
    return best;
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
    const bonus = this.fx(t.def).as + t.aura.as + (t.haste.t > 0 ? t.haste.v : 0);
    return Math.max(20, 100 + bonus) / 100 / t.def.attackRate;
  }

  /** Damage multiplier from MVP stacks, kill bonus (special towers) and damage auras. */
  damageMult(t: Tower) {
    const kills = t.def.quality ? 0 : Math.floor(t.kills / 10) * KILL_BONUS;
    return 1 + t.mvp * MVP_BONUS + kills + t.aura.dmg;
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
    this.deal(t, cr, amount * (1 - Math.max(-1, cr.def.magicResist - cr.auraMr) / 100), true);
  }

  private deal(t: Tower | null, cr: Creep, dmg: number, magic = false) {
    if (!cr.alive) return;
    if (t) cr.lastHit = t;
    this.sim.damage(cr, dmg);
    if (t) {
      t.damageDealt += dmg;
      if (magic) t.magicDealt += dmg;
      if (!cr.alive) t.kills++;
    }
  }

  private attack(t: Tower, cr: Creep) {
    const d = t.def,
      f = this.fx(d);
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
    // Debuffs land before damage so armor reduction counts on this hit. Strongest wins, timer refreshes.
    if (f.armor) {
      cr.armorRed = Math.max(cr.armorRed, f.armor);
      cr.armorT = DEBUFF_TIME;
    }
    if (f.slow) {
      cr.slow = Math.max(cr.slow, f.slow);
      cr.slowT = DEBUFF_TIME;
    }
    if (f.poison && !magicImmune(cr)) {
      cr.poison = Math.max(cr.poison, f.poison);
      cr.poisonT = DEBUFF_TIME;
      cr.poisonBy = t;
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

  private near(cr: Creep, radius: number) {
    return this.sim.creeps.filter(
      (o) => o.alive && Math.hypot(o.x - cr.x, o.y - cr.y) * UNITS_PER_CELL <= radius,
    );
  }

  /** Invisible creeps can only be targeted inside some tower's True Sight (its attack range). */
  private visible(cr: Creep) {
    if (!hasAbility(cr, 'riki_permanent_invisibility')) return true;
    return this.towers.some((o) => this.fx(o.def).trueSight && this.dist(o, cr) <= this.range(o));
  }

  private canHit(t: Tower, cr: Creep) {
    return cr.alive && this.dist(t, cr) <= this.range(t) && this.visible(cr);
  }

  /** Enemy auras (armor/slow/magic resist/burn) and creep Disarm auras. */
  private auras() {
    for (const cr of this.sim.creeps) {
      cr.auraArmor = cr.auraSlowPct = cr.auraSlow = cr.auraMr = 0;
    }
    for (const t of this.towers) {
      for (const a of this.fx(t.def).enemy)
        for (const cr of this.sim.creeps) {
          if (!cr.alive || this.dist(t, cr) > a.range) continue;
          if (a.flyingOnly && !cr.def.flying) continue;
          const immune = magicImmune(cr) && !a.pierceImmune;
          if (a.armor && !immune) cr.auraArmor = Math.max(cr.auraArmor, a.armor);
          if (a.slowPct && !immune) cr.auraSlowPct = Math.max(cr.auraSlowPct, a.slowPct);
          if (a.slow) cr.auraSlow = Math.max(cr.auraSlow, a.slow);
          if (a.mr) cr.auraMr = Math.max(cr.auraMr, a.mr);
          if (a.dps) this.magic(t, cr, a.dps * TICK);
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
      if (cr.poisonT > 0) {
        this.magic(cr.poisonBy, cr, cr.poison * TICK);
        if ((cr.poisonT -= TICK) <= 0) cr.poison = 0;
      }
      if (cr.slowT > 0 && (cr.slowT -= TICK) <= 0) cr.slow = 0;
      if (cr.armorT > 0 && (cr.armorT -= TICK) <= 0) cr.armorRed = 0;
    }
    for (const t of this.towers) {
      t.cooldown = Math.max(0, t.cooldown - TICK);
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
      let extra = this.fx(t.def).targets - 1;
      for (const cr of creeps)
        if (extra > 0 && cr !== t.target && this.canHit(t, cr)) {
          this.attack(t, cr);
          extra--;
        }
      if (!t.target.alive) t.target = null;
    }
  }
}
