# GemTD

A single-player, fully offline browser remake of the Dota 2 custom game **Gem TD**: place random
gems, keep one, maze the rest as stones, combine into special towers, survive 50 waves.
No server, no network calls, no runtime dependencies. Design notes: [docs/BUILD.md](docs/BUILD.md).

## Play offline

1. Get `index.html`: download a release, or build it yourself (`npm install && npm run build` →
   `dist/index.html`).
2. Open `index.html` in Chrome, Edge or Firefox straight from disk (double-click / `file://`).
   That single file is the whole game and works with the network off.
3. Always open it **from the same path**: scores, settings and your saved game live in the
   browser's storage for that file location. Moving the file starts a fresh leaderboard, so use
   **Scores & settings → Export scores** first and **Import scores** afterwards.

Optional install as an app: serve the `dist/` folder over http (any static server) and use the
browser's "Install" button; the service worker then caches the game for offline use.

## Self-host with Docker

[compose.yaml](compose.yaml) builds the game from this repo's `main` branch on GitHub (no clone
needed) and serves it with nginx on port **5180**:

```bash
docker compose up -d --build
```

Then open `http://<your-server>:5180`. To update to the latest `main`, run the same command again.
It works as a stack in Dockge/Portainer too: paste `compose.yaml` and deploy. To build from a
local checkout instead, change `build:` to `.`. Change the port on the left of `"5180:80"` if
5180 is taken. Put it behind a reverse proxy with HTTPS if you want the "Install" app button.

## How to play

Each round:

1. **Place 5 gems** by clicking empty tiles. Type is random; quality follows your level's odds
   (shown in the top bar). Placements that would block the creeps' route are refused.
2. **Pick one gem to keep** (click it), then finish the round with one of:
   - **Keep (K)**: the other four become stones.
   - **Merge ^ (M)** / **Merge ^^ (N)**: 2 or 4 identical gems → keep one at +1 / +2 quality.
   - **Combine**: when a recipe is complete the gems get a cyan outline; select one and press
     **Combine → …** to build a special tower (ingredients become stones). Combining towers from
     earlier rounds doesn't use up your turn.
   - Extras: **Downgrade (D)** rerolls a gem to lower quality for 200 gold; **Remove stone (R)**.
3. The wave starts. Creeps walk S → 1 → 2 → 3 → 4 → 5 → E; leaks damage the castle.

Kills give gold and XP. XP raises your level (better gem odds); **Buy level (L)** spends gold to
level up early. The top-damage tower each wave earns an MVP stack (+10% damage). Special towers
gain +10% damage per 10 kills.

Keys: `K` keep · `M` / `N` merge · `D` downgrade · `R` remove stone · `L` buy level ·
`Space` pause · `1` `2` `3` speed ×1/×2/×4 · `B` scores & settings · `F3` debug overlay ·
mouse wheel zoom · right-drag pan.

The menu (`B`) has leaderboards (top score, highest wave, fastest full clear; filter by
difficulty or today's daily), new game with Easy/Normal/Hard, the local **Daily challenge**
(same seed for the whole day), **Watch** replays of finished games, name, speed and volume.
Closing the tab mid-game is fine: the game resumes on the next load.

Score = waves cleared × (1000 + difficulty bonus) + castle HP × 50 − seconds played.

## Develop

```bash
npm install
npm run dev        # Vite dev server
npm test           # unit tests (Vitest)
npm run e2e        # build + Playwright: smoke on Chromium/Firefox/Edge, then perf budgets
npm run lint
npm run balance    # headless balance bot report (SEEDS=8 by default)
npm run data       # rebuild data/*.json from data/raw (Python)
```

`npm run e2e` needs Playwright's Chromium and Firefox (`npx playwright install chromium firefox`)
and an installed Microsoft Edge.

## Fan project, AI-assisted

This is an unofficial, non-commercial **fan-made** tribute to Gem TD. It was built with heavy
assistance from Claude (Anthropic's AI). It is not affiliated with, endorsed by, or
sponsored by Valve Corporation or the original Gem TD authors.

## Credits and IP

Game mechanics follow the Dota 2 custom game Gem TD, credit for the design goes to its creators.
All art is drawn in code and all sound is synthesised; no Dota 2 or gem-td.com assets, text or
code are included.

Why a clone is OK here (not legal advice):

- **Rules and mechanics aren't copyrightable.** Copyright covers expression, not ideas, systems or
  methods of play (US 17 U.S.C. § 102(b); EU *SAS Institute v. World Programming*, C-406/10). Tower
  defense mazing, random gem draws and combine recipes are game rules.
- **Expression is.** Copying art, sound, UI layout or "look and feel" too closely can infringe
  (*Tetris Holding v. Xio Interactive*, 2012; *Spry Fox v. 6waves*, 2012). So this project uses
  only original, code-drawn visuals and synthesised audio.
- **Names are trademarks.** "Dota 2" and "Valve" are Valve trademarks, used here only to describe
  what this game is inspired by. "Gem TD" is used the same way. If a rights holder objects, the
  project will be renamed or taken down.
- **Keep it non-commercial.** Selling it would weaken the fan-work position; don't.

The code in this repository is MIT licensed (see [LICENSE](LICENSE)); that license covers this
code only, not the Gem TD name or concept.
