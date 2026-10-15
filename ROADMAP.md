# GemTD expansion roadmap

Status: Release A implemented; validation evidence and limits are in [EXPANSION-VALIDATION.md](EXPANSION-VALIDATION.md). Releases B/C and later candidates remain proposed. Based on three Claude Haiku 5.5 repository research passes (2026-10-15). Release labels indicate sequence, not delivery dates.

## Direction

Add more decisions within a run: towers with distinct combat roles, optional events with visible tradeoffs, and maps that change maze planning. Ship small batches and measure them before adding more permanent power.

The existing game already has 47 special towers, Ancient gems, five endgame towers, pedals, seven heroes, skills/passives, quests, daily seeds, four mutators, two map layouts, and save/replay support. Random Giant creeps already exist. New content should build on these systems.

## Release A — first expansion

1. **Preparation and measurement.** Record baseline clear rates, wave reached, recipe acquisition and shell earnings. Extend the balance bot to value new abilities and exercise event choices; its current strategy does not use hero skills or pedals. Check generated recipe names against raw inputs. Do not treat bot results as a substitute for human playtests.
2. **Skyhunter tower.** A physical damage specialist with a bonus against flyers and weaker ground performance. Existing Zheyi towers already provide flying-only debuffs; Skyhunter adds a direct-damage role. Start with one accessible recipe and one upgrade, with numbers chosen after comparison against existing towers.
3. **Optional Events mode.** Show the next event during the build phase, before Keep/Skip. Start after the introductory waves, aim for an event every 4–6 waves, skip boss waves, and allow only one event modifier at once. Initial frequency and values are tuning hypotheses.
   - **Shrine:** choose a modest gold, XP or gem-related benefit; allow declining.
   - **Gold Rush:** optionally accept tougher enemies for increased kill gold.
   - **Hurry Wave:** optionally accept faster enemies for bonus XP.
4. **Presentation.** Add event descriptions, reward previews and a clear expiration indicator. Support keyboard and touch choices and define how auto-skip pauses for an unresolved choice. Add tower tooltips, icons, recipe-book entries and role descriptions.

Completion criteria: new mechanics have focused tests; old saves and replays retain their behavior; event runs resume and replay identically; temporary modifiers expire without changing base difficulty or mutators; standard mode stays unchanged; build/lint/unit checks pass; desktop and touch flows work. Compare event and standard runs across the same seed set, then playtest.

## Release B — maps and goals

- **One terrain-distinct map:** new walls or no-build regions, rather than another checkpoint permutation. Preserve valid routes and test ground/flying movement. Update the balance bot's map-specific maze strategy before using its results to judge difficulty.
- **Challenge contracts:** seeded optional run goals such as limited special-tower counts or no stone removal. Record required counters through commands/state so replay and resume agree. Reward completion once per contract period; keep them separate from one-off quests.
- **Progression pacing review:** measure time to the first useful unlock and several representative loadouts. Research estimates roughly 7,700 shells for all existing unlocks versus about 40 for a Normal clear; verify those totals before tuning. Prefer improving rewards or offering sidegrades before adding more purchase tiers.
- **Discovery goals:** quests for trying the new tower and completing event contracts. Avoid requiring ownership of expensive heroes.

Completion criteria: map routing and playtests pass, challenge rewards cannot be paid twice, old profiles load, and shell pacing has an explicit target based on measured run duration.

## Release C — combat depth

- **Echo tower:** repeat a portion of a hit after a delay. Define whether the echo follows the original target, what happens when it dies, and which on-hit effects can repeat. Prevent recursive echoes and duplicate proc chains. Resolve pending attacks consistently during replay and resume.
- **Quintessence sniper prototype:** slow, low-throughput damage that bypasses mitigation. Keep experimental until it has a clear weakness against ordinary waves and cannot replace both physical and magical counters. Avoid unrestricted max-HP damage.
- **Endless boss rotation:** seeded, announced combinations of existing boss tricks. Disallow combinations that remove all practical responses. Compare late-run duration and difficulty against the baseline.

Completion criteria: queued damage, immunities, shields, purges and dead targets have defined behavior; mixed builds remain useful; boss changes preserve old-rule runs; high-speed/endless performance stays within existing budgets.

## Later candidates

Gem Shower (an extra placement), temporary tower blessings, a second event pack, additional terrain maps, and specialist tower upgrade branches. Repulse effects, surprise flyer replacement and random stone movement need separate prototypes because they can invalidate maze planning or extend waves indefinitely. New heroes and permanent stat tiers wait until progression pacing is understood.

## Implementation boundaries

- **Tower data:** source inputs in `data/raw/` and `tools/build_data.py`; generated definitions in `data/towers.json`. Combat parsing and behavior live in `src/sim/towers.ts`; endgame and pedals have their own modules. Update the bot ability valuation as part of each tower.
- **Events:** introduce a small typed event table/module, integrated with `src/sim/game.ts`, `waves.ts` and `setup.ts`. Derive schedules from seed, wave and the run's rules using an isolated deterministic calculation so event rolls do not perturb gem/combat streams. Spacing constraints need a reproducible schedule, not independent unconstrained rolls.
- **Choices and state:** log event decisions as commands. Recomputable schedules do not eliminate the need to restore resolved choices, pending offers and temporary state. Prove full replay equals snapshot resume before deciding whether to bump `SNAPSHOT`.
- **Compatibility:** allocate the next available `RULES` version at implementation time (currently 6) and gate changes to existing outcomes. Adding tower recipes can change easy-mode recipe luck and bot decisions even if the tower IDs are new. Test historical runs explicitly.
- **Scores:** initially store Events as an opt-in mutator so runs enter the existing modified-run board. Current Daily mode fixes Normal/Classic/no mutators; an event daily needs an explicit mode/filter decision rather than silently changing today's daily. A shared modified board is not proof that all configurations are equally difficult.
- **UI:** integrate with `src/main.ts`, HUD, new-game dialog, recipe book, blurbs and icons. Keep simulation rules in the simulation modules.

## Validation plan

Use focused mechanic tests plus existing snapshot, persistence, tower, wave, map and mutator coverage. Run `npm test`, `npm run lint`, `npm run build`, and the relevant browser flows (`npm run e2e` for release validation). Run bounded, explicitly scoped balance sweeps during implementation; none were run for this research. Include old-rule replay fixtures, event declines and invalid choices, resume while an offer is pending, modifier cleanup, combined mutators, endless transitions, and touch/keyboard/auto-skip behavior.

## Recommended initial defaults

Events are opt-in, hazards are offered as contracts that can be declined, and Classic keeps its current rules. Ship Skyhunter plus the three-event pack before adding more heroes or complex towers. Treat event multipliers, recipes, rewards and pacing as proposals until tested. Decide endless event cadence separately because Normal/Hard stop regular build rounds after wave 50.
