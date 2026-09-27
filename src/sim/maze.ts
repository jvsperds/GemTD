// Grid + pathing. Pure TS, no DOM.
// Movement rule (picked to reproduce map.json's emptyMapPathFixture): 8 directions,
// diagonal cost √2, a diagonal is refused only when BOTH orthogonal neighbours are blocked.

export type Cell = [col: number, row: number];

export interface MapData {
  width: number;
  height: number;
  spawn: Cell;
  checkpoints: Cell[];
  castle: Cell;
  noBuildZones: { cols: number[]; rows: number[] }[];
  walls: { segments: { col?: number; row?: number; cols?: number[]; rows?: number[] }[] };
  centerCross: { segments: { col?: number; row?: number; cols?: number[]; rows?: number[] }[] };
}

export const OPEN = 0;
export const WALL = 1;
export const ROCK = 2;

const DIRS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
] as const;

export class Maze {
  readonly w: number;
  readonly h: number;
  readonly cells: Uint8Array; // OPEN | WALL | ROCK
  readonly noBuild: Uint8Array;
  readonly waypoints: Cell[]; // spawn, CP1..CPn, castle

  constructor(map: MapData) {
    this.w = map.width;
    this.h = map.height;
    this.cells = new Uint8Array(this.w * this.h);
    this.noBuild = new Uint8Array(this.w * this.h);
    this.waypoints = [map.spawn, ...map.checkpoints, map.castle];

    const each = (segs: MapData['walls']['segments'], fn: (i: number) => void) => {
      for (const s of segs) {
        const [c0, c1] = s.cols ?? [s.col!, s.col!];
        const [r0, r1] = s.rows ?? [s.row!, s.row!];
        for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) fn(this.idx(c, r));
      }
    };
    each(map.walls.segments, (i) => (this.cells[i] = WALL));
    // centerCross stays buildable: placeRock's route check stops stones from closing the loop.
    each(map.noBuildZones, (i) => (this.noBuild[i] = 1));
    for (const [c, r] of this.waypoints) {
      this.cells[this.idx(c, r)] = OPEN; // checkpoints stay walkable even inside a wall line
      this.noBuild[this.idx(c, r)] = 1;
    }
  }

  idx(c: number, r: number) {
    return r * this.w + c;
  }

  walkable(c: number, r: number) {
    return c >= 0 && r >= 0 && c < this.w && r < this.h && this.cells[this.idx(c, r)] === OPEN;
  }

  buildable(c: number, r: number) {
    return this.walkable(c, r) && !this.noBuild[this.idx(c, r)];
  }

  /** Distance-to-goal field (Dijkstra from goal). Infinity = unreachable. Doubles as a flow field. */
  distanceField(goal: Cell): Float64Array {
    const dist = new Float64Array(this.w * this.h).fill(Infinity);
    const g = this.idx(goal[0], goal[1]);
    dist[g] = 0;
    // Binary min-heap of cell indices keyed by dist (lazy deletion: stale entries are skipped).
    const heap: number[] = [g];
    const keys: number[] = [0];
    const push = (v: number, k: number) => {
      let i = heap.length;
      heap.push(v);
      keys.push(k);
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (keys[p] <= k) break;
        heap[i] = heap[p];
        keys[i] = keys[p];
        i = p;
      }
      heap[i] = v;
      keys[i] = k;
    };
    const pop = () => {
      const top = heap[0],
        topKey = keys[0];
      const v = heap.pop()!,
        k = keys.pop()!;
      if (heap.length) {
        let i = 0;
        for (;;) {
          let m = 2 * i + 1;
          if (m >= heap.length) break;
          if (m + 1 < heap.length && keys[m + 1] < keys[m]) m++;
          if (keys[m] >= k) break;
          heap[i] = heap[m];
          keys[i] = keys[m];
          i = m;
        }
        heap[i] = v;
        keys[i] = k;
      }
      return [top, topKey];
    };
    while (heap.length) {
      const [u, du] = pop();
      if (du > dist[u]) continue;
      const uc = u % this.w,
        ur = (u / this.w) | 0;
      for (const [dc, dr] of DIRS) {
        const c = uc + dc,
          r = ur + dr;
        if (!this.walkable(c, r)) continue;
        if (dc && dr && !this.walkable(uc + dc, ur) && !this.walkable(uc, ur + dr)) continue;
        const nd = dist[u] + (dc && dr ? Math.SQRT2 : 1);
        const v = this.idx(c, r);
        if (nd < dist[v]) {
          dist[v] = nd;
          push(v, nd);
        }
      }
    }
    return dist;
  }

  /** Full route as one field per segment; null if any segment is blocked. */
  route(): Float64Array[] | null {
    const fields: Float64Array[] = [];
    for (let s = 1; s < this.waypoints.length; s++) {
      const f = this.distanceField(this.waypoints[s]);
      const [c, r] = this.waypoints[s - 1];
      if (f[this.idx(c, r)] === Infinity) return null;
      fields.push(f);
    }
    return fields;
  }

  segmentLengths(fields: Float64Array[]) {
    return fields.map((f, s) => f[this.idx(...this.waypoints[s])]);
  }

  /** Cells walked from segment start to its goal, by steepest descent on the field. */
  walk(field: Float64Array, from: Cell): Cell[] {
    const out: Cell[] = [from];
    let [c, r] = from;
    while (field[this.idx(c, r)] > 0) {
      let best: Cell = [c, r];
      for (const [dc, dr] of DIRS) {
        const nc = c + dc,
          nr = r + dr;
        if (!this.walkable(nc, nr)) continue;
        if (dc && dr && !this.walkable(c + dc, r) && !this.walkable(c, r + dr)) continue;
        if (field[this.idx(nc, nr)] < field[this.idx(...best)]) best = [nc, nr];
      }
      [c, r] = best;
      out.push(best);
    }
    return out;
  }

  /** Place a rock if buildable and the route stays open. Returns whether it was placed. */
  placeRock(c: number, r: number): boolean {
    if (!this.buildable(c, r)) return false;
    const i = this.idx(c, r);
    this.cells[i] = ROCK;
    if (this.route()) return true;
    this.cells[i] = OPEN;
    return false;
  }

  removeRock(c: number, r: number): boolean {
    const i = this.idx(c, r);
    if (this.cells[i] !== ROCK) return false;
    this.cells[i] = OPEN;
    return true;
  }
}
