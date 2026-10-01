# GemTD

A single-player, fully offline browser remake of the Dota 2 custom game **Gem TD**: place random
gems, keep one, maze the rest as stones, combine into special towers, survive 50 waves.
No server, no network calls, no runtime dependencies. Design notes: [docs/BUILD.md](docs/BUILD.md).

## Play

1. Download `gemtd-<version>.html` from the
   [latest release](https://github.com/jvsperds/GemTD/releases/latest).
2. Double-click it to open it in Chrome, Edge or Firefox. That one file is the whole game: it
   runs from disk with the network off, and you don't need npm, Node or a server.
3. Keep the file in one place. Scores, settings and your saved game are stored by the browser
   for that file location, so moving or renaming it starts fresh. To carry scores over, use
   **Scores & settings → Export scores** first and **Import scores** after.

To install it as an app with offline caching, self-host it (below) and use the browser's
"Install" button.

## Self-host with Docker

[compose.yaml](compose.yaml) pulls the prebuilt image from GitHub Container Registry and serves
it with nginx on port **5180**:

```bash
docker compose up -d
```

Then open `http://<your-server>:5180`. It works as a stack in Dockge/Portainer too: paste
`compose.yaml` and deploy.

- **Version:** `:latest` tracks `main` (rebuilt on every push); update with
  `docker compose pull && docker compose up -d`, or Dockge's **Update** button. Pin a release
  instead with its version, e.g. `ghcr.io/jvsperds/gemtd:0.2.0`.
- **Local checkout:** replace `image:` with `build: .` to build what's on disk.
- **Players:** set `GEMTD_USERS` in `compose.yaml` to `name:password` pairs. Each player logs
  in on the login page (stays logged in for a year; `/logout` signs out) and gets their own profile — shells, heroes, scores, saved game —
  stored as `./profiles/<name>.json`. Add a friend by adding a pair and redeploying.
- **Port:** change the left side of `"5180:80"` if 5180 is taken.
- **Install button:** browsers only offer it over HTTPS, so put it behind a reverse proxy.

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

Keys: `K` keep · `M` / `N` merge · `D` downgrade · `R` remove stone · `U` undo placement · `L` buy level ·
`Space` pause · `1` `2` `3` speed ×1/×2/×4 · `B` scores & settings · `F3` debug overlay ·
mouse wheel zoom · right-drag pan.

The menu (`B`) has leaderboards (top score, highest wave, fastest full clear; filter by
difficulty or today's daily), new game with Easy/Normal/Hard, the local **Daily challenge**
(same seed for the whole day), **Watch** replays of finished games, name, speed and volume.
Closing the tab mid-game is fine: the game resumes on the next load.

Score = waves cleared × (1000 + difficulty bonus) + castle HP × 50 − seconds played.

## Develop

Building needs Node 22. `npm run build` writes the single-file game to `dist/index.html` (plus
the icon, manifest and service worker used when it's served over http).

```bash
npm install
npm run build      # type-check + single-file build into dist/
npm run dev        # Vite dev server
npm test           # unit tests (Vitest)
npm run e2e        # build + Playwright: smoke on Chromium/Firefox/Edge, then perf budgets
npm run lint
npm run balance    # headless balance bot report (SEEDS=8 by default)
npm run data       # rebuild data/*.json from data/raw (Python)
```

`npm run e2e` needs Playwright's Chromium and Firefox (`npx playwright install chromium firefox`)
and an installed Microsoft Edge.

## Fan project

This is an unofficial, non-commercial **fan-made** tribute to Gem TD. It is not affiliated with, endorsed by, or
sponsored by Valve Corporation or the original Gem TD authors.

## Credits and IP

Game mechanics follow the Dota 2 custom game Gem TD, credit for the design goes to its creators.
All art is drawn in code and all sound is synthesised; no Dota 2 or gem-td.com assets, text or
code are included.
