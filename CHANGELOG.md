# Changelog

## Unreleased

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
