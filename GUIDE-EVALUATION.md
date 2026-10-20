# Built-in maze guide evaluation

All 14 preinstalled Maze helpers were evaluated on Easy / Classic under rules 10. Their stone
footprints were preserved. Each guide received the same inventory of 25 ideal endgame towers:
2 Kyparium Cores, 2 Cullinan Hearts, 2 Blood Kings, 2 Regent Diamonds, 1 Star of Eden, 6 Ehomes,
4 Natural Zumuruds, Carmen-Lucia, Red Coral, Star Sapphire, 2 Monkey King Jades and Lucky Chinese Jade.

For each layout, the 25 existing buildable stones closest to the center were selected. A
reproducible 180-swap search assigned towers using their actual aura, range and Zumurud-copy
mechanics, with ground and direct-flying route coverage as a heuristic. This is a local search;
it does not establish the best possible positions or inventory for each guide.

Each finished board then ran from wave 51 using actual seeds 11 and 29, Obsidian, no active
skills or pedals, and no further building. Starting MVP, kills and souls were zero; towers earned
those during the simulation. Runs stopped at death or 130 cleared waves. Every route was valid,
and all plans contain 25 unique known towers on the guide's existing buildable stones.

**Comparison score is not an achievable full-run score.** It includes credit for the first 50
waves but omits their elapsed time. Recipe acquisition, early survival, building order, unlocks,
and real player performance were not modeled. Treat this as a bounded late-board comparison.

| Guide | Waves cleared, seeds 11 / 29 | Mean comparison score | Route length, cells | Middle passes / 6 |
|---|---:|---:|---:|---:|
| 5X5 Crossover Remix | 129 / 129 | 126769 | 883 | 6 |
| Top #1 Maze | 109 / 109 | 107982 | 803 | 6 |
| Solo lvl 40 | 109 / 109 | 107955.5 | 521 | 6 |
| Flower Maze | 109 / 109 | 107937 | 1061 | 6 |
| Copy of 5X5 Crossover | 109 / 109 | 107926.5 | 1341 | 6 |
| Experimental | 109 / 109 | 107924.5 | 1200 | 5 |
| 5x5 Maze | 109 / 109 | 107900.5 | 1308 | 6 |
| Almond-6 pass | 109 / 109 | 107887.5 | 1443 | 6 |
| 5X5 Crossover | 109 / 109 | 107875 | 864 | 6 |
| Rosemary Maze | 109 / 109 | 107853 | 1068 | 6 |
| Almond-6 mirrored | 109 / 109 | 107736.5 | 1443 | 6 |
| Simple Maze | 99 / 105 | 101089 | 323 | 3 |
| Turtle Maze | 99 / 99 | 98283 | 816 | 6 |
| Standard Maze | 99 / 99 | 98133.5 | 1218 | 6 |

The generated positions and raw results are in [data/guide-plans.json](data/guide-plans.json). The helper uses these plans on Classic; it does not apply them to Crossroads or Rift Garden.

To regenerate in PowerShell:

```powershell
$env:EVALUATE_GUIDES = '1'
npx vitest run tests/guide-evaluation.test.ts --maxWorkers=1
Remove-Item Env:EVALUATE_GUIDES
```
