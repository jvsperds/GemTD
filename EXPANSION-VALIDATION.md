# Release A validation

## Baseline (before implementation, 2026-10-15)

- `npm ci`: completed using the lockfile.
- `npm test`: 19 files passed; 106 tests passed, 3 skipped.
- Foreground bounded sweep: `SEEDS=4 MAXWAVE=50 npm run balance`, Normal, seeds 1000–1003.
- Waves cleared: 47, 27, 48, 48; full clears 0/4. Mean 42.5 waves. This is a small comparison sample, not a win-rate estimate.
- Damage shares (magic/poison/chain): waves 1–10 62/0/0%, 11–20 70/1/0%, 21–30 70/4/0%, 31–40 59/4/0%, 41–50 53/5/0%.

## Workstreams

- Implementation: Terra low owns Release A gameplay, tower data, UI and focused regression coverage.
- Playtesting: lead prepares independent desktop/touch browser checks while implementation proceeds; focused support follows when the helper slot is free.
- General balance: compare the same seeds for standard, declined events and accepted events; review tower niches and reward values. Record limitations rather than extrapolating from small samples.

Later roadmap releases remain sequenced behind validation of this first expansion.

## Integration and initial balance comparison

- Fixed merge/combine mutating the board before a pending event rejected the wave start. Added a rejection-without-mutation regression.
- Added full replay versus snapshot resume checks for accepted and declined events, including a pending offer.
- Added explicit +35% HP/speed risk copy, one-wave expiry labels, and a separate wrapping event-control row with 44px buttons.
- Extended the skilled bot with `EVENTS=accept|decline` and optional `RULES`, plus an approximate flyer-weighted valuation for Skyhunter.
- Same Normal seeds 1000–1003, max wave 50: Events off cleared 45/27/50/43; decline cleared exactly 45/27/50/43 with identical gold and damage shares; accept cleared 45/46/47/48. Skyhunter remained on one accepted-event run's final board, none of the other final boards. This small sample does not establish tower balance; added recipes can change the bot's planning even when the finished board has no Skyhunter.
- `npm test -- --maxWorkers=2`: 20 files passed, 113 tests passed, 3 skipped. Earlier simultaneous unit/balance runs timed out two expensive tests; the isolated rerun passed.
- Independent Luna browser pass: four Chromium scenario checks passed (keyboard acceptance, synthetic touch-pointer decline, reload and Book visibility). Offers were injected for scenario setup.
- Lead added a 390×844 touch-viewport check using seed 8 and logged skips to generate the first offer naturally. Acceptance and HP/gold modifiers survived reload. Passed in Chromium after correcting the test's menu-open assumption.
- General balancer found Gold Rush's HP boost also awarded hidden XP; XP now divides out the event HP multiplier, with a focused kill-reward regression. The corrected four-seed accepted-event sweep still cleared 45/46/47/48.
- Updated the snapshot fallback test to mutate the actual current version and added a rules-6, legacy-v1-shaped snapshot replay check. This is a constructed compatibility scenario, not a captured production save.
- Final unit/lint checks after review fixes: 117 tests passed, 3 skipped; lint and production build passed.
- Initial broad browser run: 112 passed, 5 failed, 2 skipped, 4 not run. Two failures were the subsequently corrected phone-test menu assumption; the others were Firefox timeouts/launch errors. A single-worker rerun is in progress to resolve those results without CPU contention.
- Independent Terra follow-up approved the corrections with no remaining blockers; focused event/snapshot tests passed 14/14.
- `npm run data` reproduces `data/towers.json` byte-for-byte (49 special definitions). It still emits the pre-existing warning for The Great Stone's missing recipe.
- Broad single-worker rerun: 119 passed, 2 expected native-pinch skips, 1 failed Edge event scenario, performance dependency not run. The remaining test wrote its seed handoff before initial boot readiness; added explicit boot and seed/Events assertions. The corrected Edge phone scenario passed three consecutive isolated repeats.
- Normal setup Events checkbox passed in Chromium, Firefox and Edge after opening the existing collapsed Optional mutators section.

## Final outcome

- Corrected expansion suite: **18/18 passed** across Chromium, Firefox and Edge, including normal opt-in setup and a 390×844 touch viewport. The isolated Edge natural-event scenario also passed three consecutive repeats. These are automated browser checks, not human/device playtests.
- Existing browser checks passed in the broad rerun (119 total passes before the last event-test correction, two expected native-pinch skips). The sole remaining failure was resolved and retested in the full expansion suite; the entire broad suite was not rerun again.
- Performance initially failed because the fixture measured 740 particles rather than its advertised 800. Added a stress-only particle refill that maintains the fixed workload across render frames; normal gameplay does not call it. The unchanged performance assertions then passed: 60 FPS, 1.70 ms simulation, 3.41 ms drawing, 400 creeps, 80 towers, 1,500 tracers, 800 particles.
- Release A is implemented and reviewed. Tower recipe values and event difficulty remain provisional pending broader seed samples and human playtesting; the four-seed comparison does not establish a target win rate. Releases B/C remain future work.
