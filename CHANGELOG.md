# Changelog

## 0.5.0 — 2026-10-10

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
