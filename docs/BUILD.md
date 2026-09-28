# Gem TD (Offline Browser Edition) — Build Document

Status: v1.0 (decisions locked 2026-09-27) · 2026-09-27 · Owner: Jasper

## 1. Goal

Recreate the Dota 2 custom game **Gem TD** as a single-player browser game that:

- runs **fully offline** (open `index.html` from disk, or install as a PWA; no server, no CDN, no network calls),
- stores **scores and leaderboards locally** (per browser/device),
- reproduces the core Dota 2 Gem TD loop: random gem placement → keep one → maze of rocks → combine into higher-quality and special gems → survive waves.

Non-goals (v1): multiplayer/race mode, online leaderboards, the Dota hero/courier cosmetics shop, Valve assets.

**IP note:** game mechanics can be recreated; art, audio, logos and icons must be original (or CC0). Do not rip models/sprites/sounds from Dota 2 or gem-td.com. Name the project something of our own for any public release.

## 2. Research summary — how Dota 2 Gem TD plays

Legend: ✅ confirmed (wiki extract in `docs/wikipages`, parsed to `data/raw/*.json`) · ⚠️ community sources / memory, still to verify in play.

### 2.1 Core loop (per round)
1. **Build phase.** Place **5 gems** ✅. Type is random; quality is rolled from the quality-odds table (§2.7). Skills can bias type/quality.
2. **Finish the build phase** with one of these actions ✅ (Dota 2 wiki):
   - **Select** — keep the selected gem; the other 4 become **stones**.
   - **Merge ^** — two identical placed gems → keep one at +1 quality. **Merge ^^** — four identical → +2.
   - **Combine** — build a recipe tower (§2.4). If all 3 recipe gems land in one build phase, it can be built instantly.
   - **Downgrade** — reroll a gem to a random lower quality for **200 gold**.
   - **Remove stone** — delete an existing stone.
   - Tip from the wiki: once one recipe gem sits where you want it, the other 4 can go straight into the maze as stones, and you combine onto that gem in later rounds.
3. **Attack phase.** Creeps go through the **5 checkpoints in order**, taking the shortest path between each pair ✅. Leaks damage the **Gem Castle**.
4. **MVP** ✅: the tower that deals the most damage in a round gets an MVP stack: **+10% damage, and −10% magic resistance on nearby enemies**. At **10 MVPs** it gains an aura: **+75% damage to towers within range 600**. Players can also give towers manual targets or stop orders.
5. **50 waves** with a boss every 10 waves ✅. After wave 50 the waves repeat with extra skills. Use this as **endless mode**; the score counts waves reached.

### 2.2 Map and maze ✅ (`data/map.json`, from the Maze Builder screenshot)
- **37 × 37 grid**. Spawn at (4,4), top-left; castle at (32,32), bottom-right. Route: **S → 1(4,18) → 2(32,18) → 3(32,4) → 4(18,4) → 5(18,32) → E**.
- The 9×9 spawn and castle corners can't be built on. Fixed black **walls** run along the centre lines out to the map edges. A grey centre **cross** (row 18 and column 18, cells 9–27) is assumed walkable but not buildable; verify this.
- On the empty map the path lengths are **14 / 29 / 14 / 14 / 29 / 14 = 114**. ✅ Reproduced (Phase 1) by **8-direction movement, diagonal cost √2, diagonal refused only when both orthogonal neighbours are blocked**; lengths rounded per segment. 4-direction gives 30 on the long legs.
- Any placement that blocks the route is refused ✅. Flying creeps ignore the maze ✅.
- 1 cell = 128 Dota units, so range 500 ≈ 4 cells. The wiki's "range 600 = radius of 2 tiles" suggests MVP/aura ranges are measured differently; keep all ranges in units and convert in one place.

### 2.3 Base gems (✅ `data/raw/base_towers.json`, 8 types × 6 qualities = 48)
Quality names: Chipped(1) · Flawed(2) · Normal(3) · Flawless(4) · Perfect(5) · **Huge(6)** (6 only via combining).

| Code | Gem | Effect (by quality 1→6) | Dmg 1→6 | Rate | Range |
|---|---|---|---|---|---|
| B | Sapphire | slow −60/−90/−120/−150/−180/−480 move speed | 2,4,6,8,10,36 | 1 (0.6 @6) | 600 |
| D | Diamond | raw damage (+20/+40 bonus @4/5, +320 @6) | 5,10,20,40,80,460 total | 1 (0.7 @6) | 500 |
| E | Opal | True Sight + attack-speed aura +20…+70, range 664 | 1–6 | 1 | 500 |
| G | Emerald | poison 2/4/8/16/32/128 magic dps for 5 s | 2,4,6,8,10,12 | 1 | 500 |
| P | Amethyst | armor −2/−4/−8/−16/−32/−64 on hit | 2,4,6,8,10,70 | 0.6 | 500 |
| Q | Aquamarine | +200 attack speed (+500 @6) | 2,4,8,16,24,80 | 1→0.5 | 400 (500 @6) |
| R | Ruby | cleave 30–70% in 300–500 radius; 100% / 700 @6 | 4,8,12,24,48,150 | 1 | 500 |
| Y | Topaz | hits 3 targets | 3,6,9,18,36,200 | 1.3 (0.6 @6) | 500–600 (5000 @6) |

"Attack rate" = seconds between attacks (Dota BAT); attack speed bonuses follow Dota's formula `attacksPerSec = (100 + bonusAS) / 100 / BAT`.

### 2.4 Advanced towers (✅ `data/raw/recipes.json` 43 recipes, `advanced_towers.json` stats)
Notation: letter = gem, digit = quality (e.g. `B1` = Chipped Sapphire).
- **9 recipe chains**, each ending in a top tower with an **alternative 5-gem recipe** (e.g. Koh-i-noor Diamond = `Huge Pink Diamond + P6 + D6` **or** `P1+P2+P3+P4+P5`).
  - Silver `B1+Y1+D1` → Silver Knight → Pink Diamond `D5+Y3+D3` → Huge Pink Diamond → Koh-i-noor
  - Malachite `E1+Q1+G1` → Vivid Malachite → Uranium-238 `Y5+E2+B3` → Uranium-235 → Depleted Kyparium
  - Asteriated Ruby `R2+R1+P1` → Volcano; Bloodstone `R5+Q4+P3` → Antique Bloodstone → The Crown Prince
  - Jade `G3+E3+B2`, Quartz `G4+R3+P2` → Grey Jade → Monkey King Jade → Diamond Cullinan; Lucky Chinese Jade; Charming Lazurite → Golden Jubilee
  - Gold `P5+P4+D2` → Egypt Gold; Dark Emerald `G5+B4+Y2` → Emerald Golem; Paraiba Tourmaline → Elaborately Carved → Sapphire Star of Adam
  - Deep Sea Pearl, Chrysoberyl Cat's Eye → Red Coral / Natural Zumurud → Carmen-Lucia
  - Yellow Sapphire `B5+Y4+R4` → Northern Saber's Eye / Star Sapphire
- **5 secret towers** (e.g. Obsidian `B5+Y5+D5`, 4-gem Yaphets Stone / Burning Stone).
- Advanced towers stack abilities (crit, cleave, slow, pierce spell immunity…).
- Combined gems: **+10% damage per 10 kills**, inherited on upgrade ✅(community). Same aura doesn't stack ✅.

### 2.5 Pedals (✅ `data/raw/pedals.json`) — 2-gem utility blocks
8 pedals (e.g. Ensnare `Y3+D2`, Gale `G3+E2`), each upgradeable **3× → Sparkling → 3× → Blingbling** (24 total). They cast Dota-style spells (ensnare, venom gale, torrent, howl, acid, paralysis, terrorize, decrepify). ✅ `src/sim/pedals.ts`: built via Combine, cast on creeps within trigger range, then cool down.

### 2.6 Waves (✅ `data/raw/creeps.json`, 50 waves)
- Base HP curve: w1 5 → w10 boss 2,100 → w20 34,000 → w30 80,000 → w40 330,000 → w50 1,000,000. Armor 0 → 4 (w11) → 8 (w21) → 12 (w31) → 16 (w41), spikes to 24/32 on some.
- **Solo multiplier: HP × 0.6, speed × 0.85** (1-player column; 2–4 players scale up). We use the 1-player values.
- Bosses: 10, 20, 30, 40, 50. Flying: 5, 15, 25, 27, 28, 29, 30, 34, 35, 39, 40, 42, 45, 48, 50.
- Creep abilities to implement (IDs from data):

| ID | Meaning (to implement) |
|---|---|
| `riki_permanent_invisibility` | invisible — only hit within Opal/True Sight |
| `guai_shanbi` | evasion |
| `enemy_momian` | magic immune |
| `enemy_wumian` | physical immune |
| `enemy_zheguang` | Refraction — 20% per turn: blocks 7 attack instances ✅ (original source) |
| `enemy_bukeqinfan` | Untouchable — 50% per hit: attacker disarmed 1 s ✅ (original source) |
| `enemy_high_armor` | high armor |
| `shredder_reactive_armor` | armor stacks when hit |
| `guai_jiaoxieguanghuan` | Disarm — disables nearby towers briefly |
| `runrunrun` | Rush — speed burst |
| `enemy_recharge` | regenerates 0.3% max HP/s ✅ (original source) |
| `enemy_shanshuo` | Blink forward |
| `tidehunter_kraken_shell` | damage block, purges debuffs |
| `guai_xietong` | synergy with pack ⚠️ |

  Exact numbers for these need the Lua script values; start with sensible defaults in `data/creep_abilities.json`.
- 34 "other" entries (event/legacy creeps) are ignored.

### 2.7 Economy, quality odds, skills
- **Quality odds** (`data/quality_levels.json`) come from the **standalone Gem Tower Defense** wiki. They are **not confirmed for the Dota version** but are a good baseline. There are 9 levels: level 1 is 100% Chipped; level 9 is 30% Flawed / 30% Normal / 30% Flawless / 10% Perfect. Upgrade costs start at 20 gold and rise by 30 per level, **1,000 gold** in total.
- **Levelling (decided): hybrid.** Kills give **XP**, which raises the level (and the quality odds) automatically. Players can also spend **gold** to buy the next level early. The costs in `quality_levels.json` are the gold price. XP per level is tuned so that a player who never buys reaches level 9 around wave 35–40.
- Kills also give gold, which is spent on early levels, Downgrade (200 gold) and, later, skills.
- **Skills** — *out of scope for v1 (core game only).* ✅ (Dota: bought with shells, 4 levels each; we'd unlock them locally):
  - Castle skills: **Heal, Guard, Evade, Revenge**.
  - Placement skills: **Gem Pray / Quality Pray** (bias the next gem's type or quality), **Adjacent Swap, Swap, Timelapse** (reroll this turn's gems), **Hammer** (downgrade 1).
  - Combat buffs: **Attack Speed, Aim, Crit, Fatal Bonds, Candy Maker**.
  - Gold costs per use are in the wiki table and `data/raw/hero_abilities.json`. Deferred to Phase 7.
- Creep skill names ✅ (matched to data IDs): zheguang = **Refraction**, bukeqinfan = **Untouchable**, runrunrun = **Rush**, shanshuo = **Blink**, jiaoxieguanghuan = **Disarm** (creep disarms towers), enemy_recharge = **Recharge**, plus **Vitality** and **Thief**.
- **Quests** (optional extras): e.g. finish without Amethyst, within 40 minutes, or with the castle at full HP. These make good local **achievements**.

### 2.8 Scoring (our design)
`score = waves_cleared × 1000 + castle_HP × 50 − elapsed_seconds + difficulty_bonus`; boards: Top score · Highest wave · Fastest full clear.

### 2.9 Assets policy
`docs/wikipages` is **reference only**. Creep/tower PNGs and names there come from Dota 2 cosmetics — **do not ship them**. The game uses procedural gem art, original creep designs and our own creep names; gem names and stats (generic) are fine.

## 3. Architecture

### 3.1 Stack
- **TypeScript + Vite**, **Canvas 2D** renderer (CPU-first, 2.5D; see §3.7), zero runtime dependencies.
- Build output: **single self-contained `index.html`** (via `vite-plugin-singlefile`) so it works from `file://`. Optional PWA manifest + service worker for "install" when served locally.
- Tests: **Vitest** (logic), **Playwright** (smoke, headless Chromium).
- Assets: sprites generated in code and baked into a sprite sheet at startup, so no image files; WebAudio-synthesised SFX.

### 3.2 Layering (sim is pure, UI is dumb)

```
┌──────────────────────── UI layer (DOM) ────────────────────────┐
│ HUD · build panel · tower inspector · menus · leaderboard      │
└───────────────▲──────────────────────────────┬─────────────────┘
                │ reads state snapshots        │ dispatches Commands
┌───────────────┴──────────┐        ┌──────────▼─────────────────┐
│ Renderer (Canvas 2D)     │        │ Game Controller            │
│ interpolates snapshots   │◄───────│ phase machine, input→cmd   │
└──────────────────────────┘        └──────────┬─────────────────┘
                                               │
┌──────────────────────────────────────────────▼─────────────────┐
│ Simulation core (pure TS, no DOM) — fixed 30 Hz tick            │
│ Grid · Pathfinding · Spawner · Creeps · Towers · Projectiles ·  │
│ Buffs/Auras · Economy · Recipes · Seeded RNG · Event bus        │
└──────────────────────────────────────────────┬─────────────────┘
                                               │
┌──────────────────────────────────────────────▼─────────────────┐
│ Data (JSON): gems, qualities, recipes, waves, creeps, levels    │
│ Persistence: IndexedDB (scores, runs, settings) + export/import │
└─────────────────────────────────────────────────────────────────┘
```

Key decisions:
- **Deterministic sim**: seeded PRNG (mulberry32/xoshiro), fixed timestep, integer/fixed-point where it matters. A run = `seed + command log` → enables **replays** and score verification locally, and reproducible bug reports.
- **Command pattern**: every player action (`PlaceGem`, `KeepGem`, `Combine`, `BuildRecipe`, `LevelUp`, `StartWave`) is a serializable command validated by the sim.
- **ECS-lite**: plain arrays of structs per entity kind (creeps, towers, projectiles) for speed; no framework.
- **Data-driven content**: all numbers in `/data/*.json` with a schema validator at load; balancing never touches code.

### 3.3 Modules

```
src/
  main.ts                 boot, loop (rAF render + fixed-step sim accumulator)
  sim/
    world.ts              World state, tick(), snapshot()
    rng.ts                seeded PRNG
    grid.ts               cells: empty | rock | tower | checkpoint | blocked
    path.ts               A* / BFS per checkpoint segment; flow-field cache; block validation
    spawner.ts            wave schedule → creep spawns
    creeps.ts             movement, armor, evasion, invis, immunities, regen, flying
    towers.ts             targeting (first/strongest/nearest), attack cooldowns
    attacks/              splash, bounce, poison, slow, armor-reduce, crit, aura, true-sight
    projectiles.ts
    buffs.ts              stacking rules (same aura no-stack)
    economy.ts            gold, level-up, quality roll tables
    recipes.ts            combine-2/4 + special recipe matching
    phases.ts             Build → Choose → Wave → (Win|Lose)
    commands.ts           command types + validation
    events.ts             typed event bus (kill, leak, waveStart...) for UI/SFX/stats
  render/
    layers.ts (static/dynamic canvases), camera.ts, depthSort.ts, governor.ts,
    bake/ (gems, creeps, stones, shadows → sprite sheet), particles.ts (ring buffer), pathOverlay.ts, debugOverlay.ts
  ui/
    hud.ts, buildPanel.ts, inspector.ts, menus.ts, leaderboard.ts, tooltips.ts
  audio/sfx.ts            WebAudio synth
  persist/
    db.ts                 IndexedDB wrapper (fallback localStorage)
    scores.ts, runs.ts, settings.ts, exportImport.ts
data/
  gems.json, qualities.json, recipes.json, creeps.json, waves.json, levels.json, map.json
tests/  (vitest)   e2e/ (playwright)
docs/BUILD.md, docs/DATA.md
```

### 3.4 Pathfinding
- Route = concatenation of shortest paths `spawn→CP1→…→CPn→exit` on a 4-neighbour grid.
- Recompute only on grid change (build phase); cache per-segment **flow fields** so all ground creeps share one lookup.
- `canPlace(cell)` = tentatively set blocked → re-run BFS for every segment → reject if any fails. Must run < 5 ms on a ~37×37 grid.
- Flying creeps: straight-line waypoint lerp, ignore grid.

### 3.5 Persistence (local only)
IndexedDB database `gemtd` v1:
| Store | Key | Content |
|---|---|---|
| `scores` | auto id | `{name, score, wavesCleared, hpLeft, timeSec, difficulty, seed, date, version}` |
| `runs` | id | `{seed, commands[], version}` for replay |
| `settings` | key | volume, speed, keybinds, player name |
| `saves` | slot | mid-game snapshot (resume after closing tab) |

- Leaderboard views: Top score, Highest wave, Fastest clear; filter by difficulty.
- **Export/Import JSON** button so scores survive browser data wipes / move between devices.
- Version field on every record; migrations in `db.ts`.
- Note: `file://` IndexedDB works in Chrome/Edge/Firefox but storage is per-origin; document "always open from the same path".

### 3.6 Performance budget
- See §3.7 for budgets, the stress scene and the quality governor.

### 3.7 Engine architecture — CPU-first 2.5D (decided 2026-09-27)

**Principles**
- **CPU-first.** The game must run at 60 fps with no GPU acceleration. Rendering is **Canvas 2D only**: no WebGL, no renderer library. If the browser accelerates Canvas 2D, that's a bonus we don't depend on.
- **2.5D, 3/4 top-down (oblique) view.** The grid is square on screen; objects are drawn taller than their tile and overlap the row behind them. The simulation is a flat 2D grid and knows nothing about the view.
- **Simulation and rendering are fully separate.** The simulation (pure TypeScript, no browser code) produces a read-only snapshot each tick. The renderer only reads it.
- **Particles and effects are cosmetic.** They never affect gameplay, so quality can drop without changing results.

**Simulation (fixed 30 ticks/sec, deterministic)**
| Concern | Technique |
|---|---|
| Creep movement | **Flow fields**, one per checkpoint segment, recomputed only when the maze changes. Each creep reads its cell's direction: O(1) per creep. |
| Flying creeps | Straight line between checkpoints, z = 40 (drawn raised, with a ground shadow). |
| Tower targeting | **Uniform spatial grid**; towers scan only the buckets within range; **sticky targets** (re-target only on death or out of range). |
| Memory | **Structure-of-arrays typed arrays** (`Float32Array` x/y/z/hp…) with fixed-capacity pools. **Zero allocations during a wave**, so no GC stutter. |
| Abilities | **Modifier system** mirroring Dota's Lua modifiers (slow, armor −, poison, aura, crit, MVP stack…), defined in data and triggered by events (onAttackLanded, onTick, onDeath). |
| Fast attacks | Very fast towers (Aquamarine, split shots) resolve hits instantly and draw a short tracer instead of a flying projectile entity. |
| Speed x1/x2/x4 | More ticks per frame; rendering cost unchanged. |
| Endless mode | Scales **HP/armor, not creep count**; hard cap on creeps alive at once. |
| Threading | The simulation can later move to a Web Worker (inline Blob URL; `postMessage` with transferables, because `SharedArrayBuffer` isn't available on `file://`). Phase 7, only if profiling says so. |

**Renderer (Canvas 2D, 60 fps, interpolates between ticks)**
1. **Three layers:**
   - **static canvas** — ground, grid, walls, stones, towers and their shadows. Redrawn only when the maze or camera zoom changes.
   - **dynamic canvas** — creeps, projectiles, effects. Cleared every frame.
   - **HTML HUD** — updated only when a value changes.
2. **Sprite baking at startup.** Every gem × quality, special tower, stone, creep (4–8 facing directions × a few animation frames), shadow blob and particle is drawn once, with its shading baked in, into an offscreen sprite sheet. Per frame it's only `drawImage` copies: no live gradients, shadows, filters or paths.
3. **Depth.** Every entity has a z. The draw position is `(x, y − z)` plus a ground shadow at `(x, y)`. Projectiles arc along a parabola. Tall stones/towers show a top face and a front face.
4. **Depth sorting.** Dynamic sprites are sorted by ground y each frame using insertion sort, which is fast because order barely changes between frames. Static objects are drawn in row order into the static layer.
5. **Integer pixel snapping.** Avoids sub-pixel blending cost.
6. **Camera.** Pan and zoom are a single transform; screen shake and boss flashes are a transform or overlay, never per sprite.

**Quality governor.** Frame time is measured every second. Over budget, it steps down:
1. halve particles
2. drop death effects
3. fewer creep animation frames
4. switch arcs to straight tracers

Levels come back one at a time once frame time is under budget.

**Budgets and stress test**
| Metric | Target |
|---|---|
| Stress scene | 400 creeps · 80 towers · 1,500 projectiles/tracers · 800 particles |
| Frame rate | 60 fps with GPU disabled (test with Chrome `--disable-gpu`) on a mid laptop |
| Simulation | < 4 ms per tick |
| Draw | < 8 ms per frame |
| Allocations during a wave | 0 |
| Bundle | single `index.html`, < 1 MB, no runtime dependencies |

A debug overlay (F3) shows fps, tick ms, draw ms, entity counts and the governor level.

**Art policy.** All visuals are generated in code or original: faceted gems with baked shading, stylised original creeps, shaded stone blocks. Nothing from Dota 2. The sprite sheet can later be swapped for hand-made PNGs without changing engine code.

## 4. Build phases

Each phase ends with a playable build and its exit criteria.

### Phase 0 — Groundwork (0.5 day)
- Vite + TS + Vitest + Playwright + ESLint/Prettier, single-file build, `npm run build` → `dist/index.html` opens from disk.
- Reference data already extracted: `python tools/extract_wiki.py` → `data/raw/*.json`. Write `tools/build_data.py` to derive the game's `data/*.json` (unit conversion, solo multipliers, recipe parsing) + schema check.
- **Exit:** blank canvas loads offline from `file://`; data files validate.

### Phase 1 — Grid, map, pathing
- Load `data/map.json`; place/remove stones; path overlay; refuse any placement that blocks the route.
- **Exit:** the empty map reproduces the 114-length fixture; unit tests for path validation; click to place rocks and watch route update.

### Phase 2 — Creeps & waves
- Spawner from `waves.json`, ground movement along flow fields, HP/leaks, flying movement, win/lose.
- **Exit:** waves walk the maze and subtract HP; flying waves take straight lines.

### Phase 2.5 — Renderer core
- Static/dynamic layers, sprite baking, depth sort, shadows and z offset, camera, debug overlay, stress scene.
- **Exit:** the stress scene hits the §3.7 budgets with GPU disabled.

### Phase 3 — Base gems & combat
- 8 gem types × qualities, targeting, projectiles, damage/armor formula, slow/poison/splash/bounce/crit/armor-reduce/aura.
- **Exit:** a hand-placed tower set can clear early waves; combat tests pass.

### Phase 4 — Core Gem TD loop
- 5 random placements per round; Select / Merge ^ / Merge ^^ / Combine / Downgrade / Remove-stone; the other gems become stones; kill-XP levelling plus buying levels with gold; quality roll table; odds shown in the HUD; phase machine.
- **Exit:** full game playable start to finish with base gems. **← first "real" milestone.**

### Phase 5 — Special towers & creep attributes
- Recipe detection + highlight when available, special towers + upgrade chains, kill-based damage bonus.
- Invisible/True Sight, evasion, magic/physical immunity, regen, bosses.
- **Exit:** every wave attribute from §2.5 implemented and covered by a test.

### Phase 6 — Scores, persistence, UX
- IndexedDB layer, leaderboards (3 boards + difficulty filter), export/import, save/resume, settings, pause/speed controls, hotkeys, tooltips with recipe hints.
- **Exit:** finish a game → score appears on board after reload with network disabled.

### Phase 7 — Polish & extras
- Procedural gem art polish, effects, WebAudio SFX, replays from seed+commands, daily-seed challenge (local), difficulty modes, optional hero abilities.
- PWA manifest/service worker.

### Phase 8 — Balance & release
- Balance pass against Dota numbers, Playwright smoke across Chrome/Firefox/Edge, perf check at wave 30+ on a low-end laptop, `README` with "how to play offline".

## 5. Testing strategy
- **Sim unit tests:** pathing, recipe matching, combine rules, damage/armor math, aura stacking, RNG determinism.
- **Golden replays:** fixed seed + command log must produce identical final state hash — catches accidental nondeterminism.
- **Headless balance bot:** scripted "reasonable" player runs N seeds to chart win-rate per wave.
- **E2E:** load from `file://`, play a round, confirm score persists after reload with network blocked.

## 6. Decisions & open questions
Decided (2026-09-27):
- Quality odds: use the borrowed Gem Tower Defense table as-is.
- Levelling: hybrid. Kill XP levels you up automatically; gold buys levels early.
- Scope v1: **core game only**. Hero skills, pedals, quests and MVP-aura extras go to Phase 7 or later. The MVP damage stack stays in the core game.

Still open (sensible defaults until playtests):
1. ~~Refraction / Untouchable / Recharge~~ done from the original source. Thief (steals 1% gold on leak) is unused by our wave data.
2. XP curve per level (start: XP = creep base HP / 10; tune in Phase 8).
3. Project name for anything public.

## 7. Sources
- Original addon source (Lua + KV): https://github.com/customgamessourcecode/GemTD
- Dota 2 Wiki, Gem TD (saved: `docs/wikipages/dota2/`): build-phase actions, MVP, skills, waves, quests
- Gem Tower Defense Wiki, Upgrading chances (saved): quality odds table
- Maze Builder screenshot (map layout)
- cecrit GemTD remake: https://cecrit.itch.io/gemtd
- Saved wiki pages: `docs/wikipages/*.html` (extracted by `tools/extract_wiki.py`)
- Fan data site (auto-extracted Dota 2 Gem TD data): https://clementbera.github.io/Website/index.html
- gem-td.com (Dota 2 Gem TD community site: wiki, leaderboard): https://gem-td.com/
- Steam Workshop discussion — GemTD guide (levels, wave attributes, combine bonus): https://steamcommunity.com/workshop/filedetails/discussion/474619917/527273452872593755
- Steam Workshop discussion — solo strategy (routes, maze passes, air waves): https://steamcommunity.com/workshop/filedetails/discussion/474619917/487870763302372308
- Dota 2 Wiki — Gem TD: https://dota2.fandom.com/wiki/Gem_TD (unreachable during research)
