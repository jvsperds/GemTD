import { expect, test } from 'vitest';
import { Maze } from '../src/sim/maze';
import { MAPS, newGame } from '../src/sim/setup';

test('every map has an open route and runs a wave', () => {
  for (const [id, m] of Object.entries(MAPS)) {
    expect(new Maze(m.data).route(), id).toBeTruthy();
    const g = newGame(3, 'normal', [], id);
    expect(g.sim.maze.waypoints.length).toBe(7);
    g.sim.startWave();
    for (let i = 0; i < 30 * 200 && g.sim.phase === 'wave'; i++) g.tick();
    expect(g.sim.phase, id).not.toBe('wave'); // creeps reached the castle (no towers)
  }
});
