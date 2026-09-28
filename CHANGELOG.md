# Changelog

## Unreleased

- Drop an unreadable saved game at startup instead of showing a blank page.
- README: note that playing needs no npm, Node or server.

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
