# Changelog

## Unreleased

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
