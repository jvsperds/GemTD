# GemTD

A single-player, fully offline browser remake of the Dota 2 custom game **Gem TD**: place random
gems, keep one, maze the rest as stones, combine into special towers, survive 50 waves, then keep going in endless mode.
The standalone file needs no server and makes no network calls; the optional self-hosted server
adds logins, per-player profiles and global leaderboards.

## Play

1. Download `gemtd-<version>.html` from the
   [latest release](https://github.com/jvsperds/GemTD/releases/latest).
2. Double-click it to open it in Chrome, Edge or Firefox. That one file is the whole game: it
   runs from disk with the network off, and you don't need npm, Node or a server.
3. Keep the file in one place. Scores, settings and your saved game are stored by the browser
   for that file location, so moving or renaming it starts fresh.

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
  instead with its version, e.g. `ghcr.io/jvsperds/gemtd:0.4.0`.
- **Local checkout:** replace `image:` with `build: .` to build what's on disk.
- **Players:** friends sign themselves up with **Register** on the login page: just a name and a
  password, no email. `GEMTD_MAX_USERS` in `compose.yaml` caps the total number of users
  (default 50; `0` turns sign-ups off). You can also preset accounts in `GEMTD_USERS` as
  `name:password` pairs. Each player logs in on the login page (stays logged in for a year;
  `/logout` signs out) and gets their own profile — shells, heroes, scores, saved game — stored
  as `./profiles/<name>.json`. Registered accounts are kept in `./profiles/.users.json`.
- **No accounts offline:** the standalone `index.html` / local-first build has no logins or
  sign-ups; they exist only on the self-hosted server.
- **Port:** change the left side of `"5180:80"` if 5180 is taken.
- **Install button:** browsers only offer it over HTTPS, so put it behind a reverse proxy.

## How to play

Each round:

1. **Place 5 gems** by double-clicking (or double-tapping) empty tiles. Type is random; quality follows your level's odds
   (shown in the top bar). Placements that would block the creeps' route are refused.
2. **Pick one gem to keep** (click it; older towers grey out until you do), then finish the
   round with one of:
   - **Keep (K)**: the other four become stones.
   - **Merge ^ (M)** / **Merge ^^ (N)**: 2 or 4 identical gems → keep one at +1 / +2 quality.
   - **Combine**: when a recipe is complete the gems glow with a pale aura; select one and press
     **Combine → …** to build a special tower (ingredients become stones). Combining towers from
     earlier rounds doesn't use up your turn.
   - Extras: **Downgrade (D)** rerolls a gem to lower quality for 200 gold; **Remove stone (R)**;
     **Undo (U)** takes back this round's last placement; **Skip turn (S)** (hold Skip to
     auto-skip every turn, press it again to stop).
3. The wave starts. Creeps walk S → 1 → 2 → 3 → 4 → 5 → E; leaks damage the castle.

Kills give gold and XP. XP raises your level (better gem odds); **Buy level (L)** spends gold to
level up early. The top-damage tower each wave earns an MVP stack (+10% damage) and wears a crown.
Special towers gain +10% damage per 10 kills. Pedals are 2-gem utility blocks built with Combine
and laid on open path cells, where they cast a spell on creeps that cross them. Select towers (Ctrl+click or Ctrl+drag for several) to set
their aim mode on the **Targeting** tab.

After wave 50 the game goes endless: creeps get tougher and boss waves bring more bosses. Two Great
gems of one type combine into an Ancient gem, which upgrades a top special tower into an end-game
tower. Easy mode keeps its build rounds in endless.

Each game pays **shells**. Spend them in the menu's **Hero** tab on heroes, skills and passives,
and choose what to bring before a run. **Quests** (menu → Quests) pay bonus shells the first time
you meet them.

The new-game dialog sets difficulty (Easy/Normal/Hard), the **map** (Classic or Crossroads),
**mutators** (Swift, Tough, No merges and Cunning bosses that blink, shield, rush or split), the
local **Daily challenge** (same seed for the whole day) and the **Maze builder**. Your first game
shows teaching hints for three waves.

Keys: `K` keep · `M` / `N` merge · `D` downgrade · `R` remove stone · `U` undo placement · `S` skip
turn · `L` buy level · `Space` pause · `1`–`5` speed ×1/×2/×4/×10/×20 · `G` cycle maze guides ·
`P` path · `V` ranges · `H` recipe book · `Esc` deselect, or open the menu · `F3` debug overlay ·
arrows + `Enter` board cursor · mouse wheel or pinch zoom · drag to pan.

The menu (`Esc`) has leaderboards (top score, highest wave, fastest full clear; filter by
difficulty, today's daily, or **Mutators & maps**, where runs with mutators or a non-Classic map
rank separately), **Watch** replays of finished games, and settings for speed, volume, procedural
**music** and **Low graphics** (default on touch devices). Self-hosted, the boards are the global
top 10 across all players. Closing the tab mid-game is fine: the game resumes on the next load.

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

## Branches and releases

- **`dev`** is work in progress. Feature branches merge into `dev` through pull requests; CI runs
  on every `dev` push and pull request.
- **`main`** is the current `:latest` Docker image. Promote `dev` to `main` with a pull request
  when the batch is ready for `:latest` users; every `main` push rebuilds `:latest`.
- **Version tags** mark fixed releases. To release, bump `version` in `package.json` and add the
  `CHANGELOG.md` entry, tag the chosen `main` commit (`git tag v0.5.0 && git push origin v0.5.0`),
  then publish the GitHub release with `dist/index.html` attached as `gemtd-<version>.html`. The
  tag builds the versioned image (e.g. `ghcr.io/jvsperds/gemtd:0.5.0`).

## Fan project

This is an unofficial, non-commercial **fan-made** tribute to Gem TD. It is not affiliated with, endorsed by, or
sponsored by Valve Corporation or the original Gem TD authors.

## Credits and IP

Game mechanics follow the Dota 2 custom game Gem TD, credit for the design goes to its creators.
All art is drawn in code and all sound is synthesised; no Dota 2 or gem-td.com assets, text or
code are included.
