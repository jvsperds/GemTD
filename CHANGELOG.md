# Changelog

## Unreleased

- Evaluated every built-in maze guide with Easy tower plans and added an optional Tower
  placement helper: ghost targets, gold ingredient hints and green completed-tower rings.

- Added Skyhunter and Skyhunter Ascended, physical anti-air specialists with reduced ground damage.
- Added optional seeded Events: Shrine, Gold Rush and Hurry Wave, with build-phase choices,
  explicit risks, decline controls, and one-wave modifiers. Auto-skip waits for event decisions.
- Preserved historical rules for saved runs and replays; added event resume and browser coverage.

## 0.5.0 — 2026-10-10

- **Creeps:** every creep is redrawn after the Dota 2 courier it is named for (boar, yak, panda,
  the four chest-hound Jaws, dragons, imps, and so on) instead of eight shared shapes, with props
  such as balloons, a skateboard, a boat and a flying carpet. Portraits show wings and boss crowns.
- **Towers:** tower heads are redrawn in the same style, with shaded, rounded forms. Towers and
  creeps get a dark outline so they read on any tile. Gem tower shafts take the gem's colour (they
  were black). Models are still baked once per zoom, so the frame cost is unchanged.
- **Interface:** the HUD, menu, dialogs and buttons follow the same style: ink borders, flat
  two-tone fills, hard shadows instead of glows, a rounded sans typeface, and outlined skill icons.
  The logo and app icon are a gem with the tower's ward eye.

- **Magic damage:** poison and chain lightning now keep up with late waves. Poison also takes a
  share of the creep's max HP each second (1% at the top tier, less below, half on bosses), and a
  chain lightning jump deals 50% of the tower's attack damage when that beats the flat 150. In bot
  runs the poison towers' share of wave 41-50 damage went from 4% to 9% with the win rate unchanged.
- **MVP:** a tower holds at most 10 MVP stacks, as in the original; once capped, the wave's award
  goes to the next best tower. The stack count is an ability card on the tower instead of a stat
  line. The crown sits on the tower with the most damage dealt and no longer bobs.
- **Zoom:** pinching or scrolling no longer stutters. Every step used to redraw all sprites and
  the map at the new size; a gesture now scales the last drawing and redraws once when it rests.
  Runs started before these rule changes replay under their old rules.

- **Early waves:** the difficulty's creep HP multiplier now ramps up instead of applying from wave
  1. Wave 1 has the original HP (a Chipped Ruby one-shots it again) and the full multiplier is
  reached at wave 15. Before, Easy tripled wave 1's HP and even the bot leaked whole early waves.
  Bot win rates over 20 seeds: Easy 65% to 80%, Normal 25% to 30%, Hard unchanged at 10%.

- **Difficulty:** creeps are much tougher, so a full clear is no longer a given. Creep HP is now ×3
  on Easy, ×2.3 on Normal and ×3.4 on Hard (was ×0.7 / ×1 / ×1.5); Easy keeps its perks (copies
  stack, recipe luck, levels past 9), which is why its creeps can carry more HP than Normal's. A
  headless bot that plays a guide maze with no hero skills clears wave 50 in about 68% of Easy
  runs, 33% of Normal and 10% of Hard (`npm run balance`, 40 seeds).
- **Shells:** a run's shells are multiplied by difficulty: ×1 Easy, ×2 Normal, ×3 Hard. Quest
  rewards are unchanged.
- **Fix:** on Easy, buying level 12 no longer gives levels 13–18 for free; each must be bought.
- **Enrage:** a wave that is still running after 3 minutes makes its creeps immune to stuns and
  slows, on every difficulty, so a boss that is locked in place but out-heals your towers walks on
  and the wave ends.
- **Endless scaling:** Sunder and Soul Harvest now lose 10% per endless wave against creep HP (was
  2%), halving about every 7 waves, because MVP and kill bonuses kept a maxed board winning past
  wave 300; a strong board now ends around wave 120–140. Runs and replays started earlier keep
  the rate and creep HP they were played with.
- **Performance:** late-game runs hold 60 fps (80 special towers on wave 100+, also at ×20). Wave
  starts no longer stall for ~50 ms rebuilding the creep route, the HUD repaints its counters at most
  ten times a second and only re-matches recipes when the board changes, and attack effects are
  limited to one per tower every 90 ms. `#bench` opens the benchmark scene; F3 now also shows the
  worst HUD update (`hudMs`).
- **Attack effects:** every tower now has its own attack: gems throw a cut shard of their colour,
  specials fire bolts, beams, lobbed globs, lances of light or chain lightning in their own colour.
  The dearer the tower, the bigger and longer-lived the effect: Huge Pink Diamond and Koh-i-noor
  strike with a writhing Laguna-style bolt, The Crown Prince and The Blood King with a coiling
  Finger-of-Death beam. Low graphics keeps the plain tracers.
- **Burn ground:** tiles inside a burn aura (Asteriated Ruby, Volcano, The Burning Stone...) are
  tinted red, darker the stronger the burn, and overlapping auras add up.
- Pedals no longer show the calm-aura shield dome.
- **Setting:** the board now stands on a ragged stone plateau, mossy at the rim with a cliff on its
  south side, in a lowland of leafy green cubes and cube trees that runs to the edges of the screen.
  Moss grows on the top bar and the bottom panel to match.
  A vignette darkens the lowland toward the edge of the world, which is now as far as you can pan.
- **Route ends:** a teal mosaic marks where creeps enter the field and a crimson one where they
  leave.
- **Settings:** the Speed list now includes ×20, and a Side bar checkbox hides or shows the left
  side bar (its hotkeys keep working).
- **Path and guides:** each leg of the route (S→1, 1→2, …) is drawn in its own colour, and while a
  maze guide is shown, stones standing where the guide wants open ground carry a faint X.
- **Pinned recipes:** 📌 a recipe in the book and the gems you already hold for it wear a pink ring
  on the board; once every ingredient is down the ring becomes a pink aura, so a pinned tower that
  is ready reads apart from the usual pale combine glow. Pins sort first and are remembered.
- **Saving:** the game keeps a snapshot of the board at the end of each wave. Resume and Undo load
  it and replay only the moves since, instead of re-simulating the run from wave 1, so long endless
  runs reopen at once. Saves from older builds still load (by full replay) and gain a snapshot at
  their next wave.
- **Loading toast:** a spinner with a message shows while the game starts, resumes a save or
  reloads (new game, Watch, Undo), instead of a frozen or blank page.
- **End run:** Menu → End run stops the game where it stands and records its score and shells.
  Abandoning with New game still records nothing.
- **Endless scaling:** Sunder and Soul Harvest lose 2% per endless wave against creep HP (about
  half every 35 waves) on all difficulties, so creeps outgrow the end-game towers and a run ends.
  Runs and Watch replays started before this keep the old rules.
- **Quests:** 11 one-off goals checked at game over, paid in shells; menu → Quests.
- **Mutators:** Swift, Tough, No merges and Cunning bosses (blink, shield, rush or split), chosen
  in the new-game dialog and shown with the score.
- **Maps & tutorial:** Crossroads map with a picker in the new-game dialog; hints for the first
  three waves of your first game.
- **Music:** procedural arpeggio and drone that follows building, waves and bosses; Music slider.
- **Leaderboards:** runs with mutators or a non-Classic map rank on their own **Mutators & maps**
  board instead of against standard runs.
- `docs/` is no longer tracked.

## 0.4.0 — 2026-10-07

- **Performance:** the ground, wall, board and torch light are composited once per pan/zoom/edit
  instead of every frame (stress scene without a GPU: 29 → ~55 fps). **Low graphics** (Menu,
  default on touch devices) also drops glows, particles and the 1.5× pixel density.
- **End-game towers:** Ancient (Q7) gems combine from two Great gems of one type; five new towers
  (top special + Ancient gem) add Sunder (2% max HP per hit, half on bosses) or Soul Harvest
  (kills add 1% of the creep's max HP to attack damage) for long endless runs.
- **Endless bosses:** boss waves past wave 50 add a boss per 20 endless waves and per 3 clean waves
  (up to 10); a leaking boss deals 10 × its HP left × (1 + endless waves / 10), capped at 100.
- **Auto-skip:** hold Skip to skip every turn; press it again to stop.
- Damage chart and creep HP use k/M/B/T/Qa… suffixes, so long-run numbers stay readable.
- **Board look:** the field sits in a raised wall of grey stone with a gold trim, corner studs and
  torch pillars; deeper emerald tiles, boxed waypoint markers and a GEM TD logo in the header.
- **Esc** clears the selection, or opens and closes the menu when nothing is selected (was `B`).
- **Choosing gems:** older towers grey out while the round's gems wait to be picked; combinable
  towers pulse with a soft aura; pending gems trace a square base. The MVP tower wears a crown.
- **Skip turn (S)** on all modes; easy endless keeps its build rounds.
- **Accessibility:** keyboard board cursor (arrows + Enter), live status hint, focus-trapped menu.
- Restyled new-game and loadout dialogs; the middle row, column and centre cell are shaded.
- Fixed a startup crash on new and resumed games.

## 0.3.0 — 2026-10-01

- **Self-hosting:** login page with signed cookie replaces Basic auth; self-registration capped by
  `GEMTD_MAX_USERS` (default 50, `0` disables); per-player profiles (shells, heroes, scores, save).
  Prebuilt image published to GHCR; `compose.yaml` pulls it.
- **Leaderboards:** global top 10 named by user id. Score export/import/clear and the name field
  are gone.
- **Towers:** per-tower aim modes with boss-first override and Ctrl multi-select; combine while a
  wave runs; Actions/Targeting panel tabs, recipe portrait cards, SVG HUD icons, remembered toggles.
- **Pedals:** trigger on flying creeps; debuffs stack per level (per pedal on easy), one card per
  creep debuff.
- **Controls:** double-click places gems (swaps stones), left-drag pans; mobile pinch/double-tap
  no longer zooms the page. Imported maze guides.
- **Performance:** phones cap DPR at 1.5 and skip live glows; touch pan no longer rebuilds the map.
- Menu shows version and commit. Service worker is network-first and served without login, so
  redeploys reach browsers; a lapsed login recovers instead of crashing.

## 0.2.0 — 2026-09-29

- **Endless:** waves run back to back with a wave banner; shells uncapped; new-game dialog.
- **Easy mode:** levels past 9 shift odds toward Perfect/Great (Perfect capped at 10%);
  level-scaled recipe-completing gems; owned counts in the recipe tab.
- **Heroes:** passive skills shop section (Reaper, Lucky Strike, Bash, Midas Touch); Level and
  Stone stay outside the bring limit.
- **Game over:** run recap. **U** undoes the last gem placement.
- Drop an unreadable saved game at startup instead of showing a blank page.
- README: Play points at releases, Docker pinned to a tag, no npm/Node/server needed to play.

## 0.1.0 — 2026-09-28

First public release: a single-file, fully offline remake of the Dota 2 custom game Gem TD.

- **Core game:** random gem placement with keep-one rule, stone mazing, combining into special
  towers, 50 waves with creep abilities and original addon values, endless mode, giant creep event.
- **Heroes:** hero skills bought with shells, several heroes, skills usable mid-wave.
- **Towers:** crafted towers aligned with the Gem Maze TD Codex; auras, buffs and debuffs that
  stack per source; magic damage scales with buffs.
- **Pedals:** runes on the path with their own models and book tab.
- **Scores & persistence:** local leaderboards (score, wave, fastest, daily challenge), resume,
  replays, maze guide overlay and saved mazes, score export/import.
- **Presentation:** original 2.5D tower and creep models, fantasy gem UI, Dota-style HUD, damage
  chart, speed up to x20, mobile touch controls and HiDPI rendering.
- **Deployment:** Docker image and compose stack; installable PWA when served over http.
