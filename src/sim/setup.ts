// One place that wires data → Maze/WaveSim/Combat/Game, so live games and replays match.
import gems from '../../data/gems.json';
import map from '../../data/map.json';
import quality from '../../data/quality_levels.json';
import towerData from '../../data/towers.json';
import waves from '../../data/waves.json';
import { Game, type LevelDef } from './game';
import { Maze, type MapData } from './maze';
import { allDefs, Combat, type GemDef, type SpecialDef } from './towers';
import { WaveSim, type WaveEntry } from './waves';

export const DEFS = allDefs(
  gems as Record<string, GemDef>,
  towerData as unknown as Record<string, SpecialDef>,
);

export function newGame(seed: number) {
  const sim = new WaveSim(new Maze(map as unknown as MapData), waves as WaveEntry[], seed);
  return new Game(new Combat(sim, DEFS, seed), quality.levels as LevelDef[], seed);
}
