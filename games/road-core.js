/*
 * Road to Bethlehem — level generation, tile logic and scoring (no drawing code).
 *
 * The road enters the grid from Moab at the top and must leave at the bottom towards
 * Bethlehem. Each level is built the same way on every device from the session seed:
 *   1. carve a random winding path from the entry cell to the exit cell;
 *   2. give each path cell a tile that can connect its two neighbours;
 *   3. fill every other cell with a decoy tile;
 *   4. rotate every unlocked tile randomly, and re-scramble if it happens to be solved.
 * Because step 2 always uses a tile that fits, every level is solvable.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('../shared/rng.js'));
  else root.RoadCore = factory(root.HubRng);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (Rng) {
  'use strict';

  const N = 1;
  const E = 2;
  const S = 4;
  const W = 8;
  const DIRS = [N, E, S, W];
  const DELTA = { 1: [-1, 0], 2: [0, 1], 4: [1, 0], 8: [0, -1] };
  const OPP = { 1: S, 2: W, 4: N, 8: E };
  const SHAPES = { straight: N | S, corner: N | E, tee: N | E | S, cross: N | E | S | W };
  const TIEBREAK_LEVEL = 6;
  const MIN_MS_PER_LEVEL = 600;
  const MIN_MS_PER_ROTATION = 90;

  /** Rotate a connection mask clockwise k quarter turns. */
  function rotate(mask, k) {
    let m = mask;
    for (let i = 0; i < ((k % 4) + 4) % 4; i++) m = ((m << 1) | (m >> 3)) & 15;
    return m;
  }

  function covers(mask, need) {
    return (mask & need) === need;
  }

  /** Fewest clockwise taps that make this tile connect `need`. */
  function tapsNeeded(base, rot, need) {
    for (let k = 0; k < 4; k++) if (covers(rotate(base, rot + k), need)) return k;
    return -1;
  }

  function sizeForLevel(level, s) {
    const step = level <= 2 ? 0 : level <= 5 ? 1 : level <= 8 ? 2 : 3;
    return Math.min(s.maxSize, s.startSize + step);
  }

  function features(level, s) {
    return {
      branches: level >= 3,
      locked: !!s.locked && level >= 4,
      checkpoints: s.checkpoints ? (level >= 7 ? 2 : level >= 5 ? 1 : 0) : 0,
    };
  }

  /** A random self-avoiding path from (0, startCol) to (size-1, endCol). */
  function carvePath(rng, size, start, end, minLen, maxLen) {
    let best = null;
    for (let attempt = 0; attempt < 80; attempt++) {
      const seen = {};
      const path = [];
      let found = false;
      let budget = 4000;
      (function dfs(r, c) {
        if (found || budget-- <= 0) return;
        seen[r * size + c] = true;
        path.push([r, c]);
        if (r === end[0] && c === end[1]) {
          if (path.length >= minLen || attempt > 60) {
            found = true;
            return;
          }
        } else {
          const order = rng.shuffle(DIRS);
          // Lean towards sideways and downward moves so routes wind across the grid.
          order.sort((a, b) => (a === N ? 1 : 0) - (b === N ? 1 : 0));
          for (const d of order) {
            const nr = r + DELTA[d][0];
            const nc = c + DELTA[d][1];
            if (nr < 0 || nc < 0 || nr >= size || nc >= size || seen[nr * size + nc]) continue;
            dfs(nr, nc);
            if (found) return;
          }
        }
        path.pop();
        seen[r * size + c] = false;
      })(start[0], start[1]);
      if (found && path.length <= maxLen) return path;
      if (found && (!best || path.length < best.length)) best = path.slice();
    }
    return best || simplePath(start, end);
  }

  /** Fallback: straight down, then across, then down to the exit. */
  function simplePath(start, end) {
    const path = [start.slice()];
    let r = start[0];
    let c = start[1];
    while (c !== end[1]) {
      c += c < end[1] ? 1 : -1;
      path.push([r, c]);
    }
    while (r !== end[0]) {
      r += 1;
      path.push([r, c]);
    }
    return path;
  }

  function dirBetween(a, b) {
    const dr = b[0] - a[0];
    const dc = b[1] - a[1];
    if (dr === -1) return N;
    if (dr === 1) return S;
    if (dc === 1) return E;
    return W;
  }

  function baseFor(need) {
    if (need === (N | S) || need === (E | W)) return SHAPES.straight;
    return SHAPES.corner;
  }

  /** Builds level `level` (1-based) for a seed. */
  function generateLevel(seed, level, s, opts) {
    const rng = Rng.create('road:' + seed + ':' + level);
    const size = (opts && opts.size) || sizeForLevel(level, s);
    const f = features(level, s);
    const start = [0, rng.int(0, size - 1)];
    const end = [size - 1, rng.int(0, size - 1)];
    const minLen = Math.min(size * size - 1, size + Math.floor(size * (0.4 + Math.min(1, level / 8))));
    const maxLen = Math.floor(size * size * 0.75);
    const path = carvePath(rng, size, start, end, minLen, maxLen);

    const tiles = [];
    for (let i = 0; i < size * size; i++) tiles.push({ base: 0, rot: 0, need: 0, path: false, locked: false, checkpoint: null, hinted: false });
    path.forEach((cell, i) => {
      const prev = i === 0 ? null : path[i - 1];
      const next = i === path.length - 1 ? null : path[i + 1];
      let need = 0;
      need |= prev ? dirBetween(cell, prev) : N;
      need |= next ? dirBetween(cell, next) : S;
      const t = tiles[cell[0] * size + cell[1]];
      t.need = need;
      t.path = true;
      t.base = baseFor(need);
    });

    // Decoy branches on the route: some path tiles become T-junctions.
    if (f.branches) {
      path.forEach((cell, i) => {
        if (i === 0 || i === path.length - 1) return;
        if (rng.next() < 0.15 + s.decoyDensity * 0.25) tiles[cell[0] * size + cell[1]].base = SHAPES.tee;
      });
    }

    // Decoys everywhere else.
    tiles.forEach((t) => {
      if (t.path) return;
      const roll = rng.next();
      const d = s.decoyDensity;
      if (roll < 0.04 * d) t.base = SHAPES.cross;
      else if (roll < 0.04 * d + 0.35 * d) t.base = SHAPES.tee;
      else if (roll < 0.04 * d + 0.35 * d + 0.35) t.base = SHAPES.corner;
      else t.base = SHAPES.straight;
    });

    // Checkpoints sit on the route, roughly a third and two thirds of the way along.
    if (f.checkpoints && path.length > 4) {
      const kinds = ['well', 'field'];
      for (let k = 0; k < f.checkpoints; k++) {
        const idx = Math.max(1, Math.min(path.length - 2, Math.round((path.length * (k + 1)) / (f.checkpoints + 1))));
        tiles[path[idx][0] * size + path[idx][1]].checkpoint = kinds[k];
      }
    }

    // Scramble.
    tiles.forEach((t) => { t.rot = rng.int(0, 3); });

    // Locked tiles: a few route tiles fixed in a correct position, plus a few decoys.
    if (f.locked) {
      const candidates = rng.shuffle(path.slice(1, -1)).slice(0, Math.max(1, Math.floor(path.length * 0.18)));
      candidates.forEach((cell) => {
        const t = tiles[cell[0] * size + cell[1]];
        t.rot = (t.rot + tapsNeeded(t.base, t.rot, t.need)) % 4;
        t.locked = true;
      });
      tiles.forEach((t) => {
        if (!t.path && rng.next() < 0.06) t.locked = true;
      });
    }

    const lvl = { level, size, start, end, tiles, pathLength: path.length };
    // Never hand out a level that is already solved.
    let guard = 0;
    while (isSolved(lvl) && guard++ < 50) {
      const movable = path.map((c) => tiles[c[0] * size + c[1]]).filter((t) => !t.locked && t.base !== SHAPES.cross);
      if (!movable.length) break;
      const t = movable[rng.int(0, movable.length - 1)];
      t.rot = (t.rot + 1) % 4;
    }
    lvl.minRotations = minRotations(lvl);
    return lvl;
  }

  function maskAt(lvl, r, c) {
    const t = lvl.tiles[r * lvl.size + c];
    return rotate(t.base, t.rot);
  }

  /** Cells reachable from the Moab entry through matching road ends. */
  function connected(lvl) {
    const size = lvl.size;
    const seen = new Array(size * size).fill(false);
    const parent = new Array(size * size).fill(-1);
    const [sr, sc] = lvl.start;
    if (!(maskAt(lvl, sr, sc) & N)) return { seen, parent };
    const queue = [sr * size + sc];
    seen[queue[0]] = true;
    while (queue.length) {
      const idx = queue.shift();
      const r = Math.floor(idx / size);
      const c = idx % size;
      const m = maskAt(lvl, r, c);
      for (const d of DIRS) {
        if (!(m & d)) continue;
        const nr = r + DELTA[d][0];
        const nc = c + DELTA[d][1];
        if (nr < 0 || nc < 0 || nr >= size || nc >= size) continue;
        const nidx = nr * size + nc;
        if (seen[nidx] || !(maskAt(lvl, nr, nc) & OPP[d])) continue;
        seen[nidx] = true;
        parent[nidx] = idx;
        queue.push(nidx);
      }
    }
    return { seen, parent };
  }

  /** Solved when the road network from Moab reaches Bethlehem and every checkpoint. */
  function isSolved(lvl) {
    const { seen } = connected(lvl);
    const size = lvl.size;
    const [er, ec] = lvl.end;
    if (!seen[er * size + ec] || !(maskAt(lvl, er, ec) & S)) return false;
    return lvl.tiles.every((t, i) => !t.checkpoint || seen[i]);
  }

  /** The route a traveller walks: cells from Moab to Bethlehem. */
  function route(lvl) {
    const { seen, parent } = connected(lvl);
    const size = lvl.size;
    let idx = lvl.end[0] * size + lvl.end[1];
    if (!seen[idx]) return [];
    const out = [];
    while (idx >= 0) {
      out.unshift([Math.floor(idx / size), idx % size]);
      idx = parent[idx];
    }
    return out;
  }

  function minRotations(lvl) {
    return lvl.tiles.reduce((sum, t) => (t.path && !t.locked ? sum + tapsNeeded(t.base, t.rot, t.need) : sum), 0);
  }

  /** Turns a tile clockwise. Returns false for locked tiles. */
  function tap(lvl, r, c) {
    const t = lvl.tiles[r * lvl.size + c];
    if (!t || t.locked) return false;
    t.rot = (t.rot + 1) % 4;
    return true;
  }

  /** Fixes one wrong route tile in place and locks it. Returns the cell, or null. */
  function hint(lvl) {
    for (let i = 0; i < lvl.tiles.length; i++) {
      const t = lvl.tiles[i];
      if (t.path && !t.locked && !covers(rotate(t.base, t.rot), t.need)) {
        t.rot = (t.rot + tapsNeeded(t.base, t.rot, t.need)) % 4;
        t.locked = true;
        t.hinted = true;
        return [Math.floor(i / lvl.size), i % lvl.size];
      }
    }
    return null;
  }

  /** Points for one cleared level. */
  function levelScore(stat, size, minRot, s) {
    const cells = size * size;
    const base = Math.round((s.pointsPerLevel * cells) / 16);
    const target = s.targetSecPerTile * cells * 1000;
    const timeBonus = stat.ms < target ? Math.round((s.timeBonusMax * (target - stat.ms)) / target) : 0;
    const extra = Math.max(0, stat.rotations - minRot);
    const efficiency = Math.max(0, s.efficiencyMax - extra * 3);
    const hintPenalty = (stat.hints || 0) * s.hintCost;
    return { base, timeBonus, efficiency, hintPenalty, total: Math.max(0, base + timeBonus + efficiency - hintPenalty) };
  }

  function tiebreakSettings(s) {
    return Object.assign({}, s, { locked: false, checkpoints: false });
  }

  /**
   * Server-side check and re-scoring of a submitted run.
   * result: { levels: [{ level, ms, rotations, hints }], totalMs }
   * Returns { ok, score, levelsCleared, totalMs } or { ok: false, reason }.
   */
  function scoreRun(result, s, seed) {
    if (!result || !Array.isArray(result.levels)) return { ok: false, reason: 'Missing levels.' };
    const levels = result.levels;
    if (levels.length > s.levelsPerRound) return { ok: false, reason: 'Too many levels.' };
    let score = 0;
    let total = 0;
    for (let i = 0; i < levels.length; i++) {
      const L = levels[i];
      if (!L || L.level !== i + 1) return { ok: false, reason: 'Levels out of order.' };
      if (![L.ms, L.rotations, L.hints].every((v) => Number.isInteger(v) && v >= 0)) return { ok: false, reason: 'Invalid level data.' };
      const lvl = generateLevel(seed, L.level, s);
      if (L.hints > lvl.pathLength) return { ok: false, reason: 'Too many hints.' };
      if (L.hints && !s.hintsAllowed) return { ok: false, reason: 'Hints are switched off.' };
      if (L.rotations + L.hints < 1) return { ok: false, reason: 'A level was cleared without a move.' };
      if (L.ms < MIN_MS_PER_LEVEL + L.rotations * MIN_MS_PER_ROTATION) return { ok: false, reason: 'A level was cleared impossibly fast.' };
      if (s.timerMode === 'perLevel' && L.ms > s.perLevelSec * 1000 + 1500) return { ok: false, reason: 'A level took longer than its clock.' };
      score += levelScore(L, lvl.size, lvl.minRotations, s).total;
      total += L.ms;
    }
    if (s.timerMode === 'total' && total > s.totalSec * 1000 + 1500) return { ok: false, reason: 'The run took longer than the round.' };
    return { ok: true, score, levelsCleared: levels.length, totalMs: total };
  }

  /** Server-side check of a sudden-death tie-breaker solve. */
  function checkTiebreak(result, s) {
    if (!result || !Number.isInteger(result.ms) || !Number.isInteger(result.rotations)) return { ok: false, reason: 'Invalid tie-breaker result.' };
    if (result.ms < MIN_MS_PER_LEVEL + result.rotations * MIN_MS_PER_ROTATION || result.rotations < 1) return { ok: false, reason: 'Impossibly fast.' };
    if (result.ms > 15 * 60 * 1000) return { ok: false, reason: 'Too slow to count.' };
    return { ok: true, ms: result.ms };
  }

  return {
    N,
    E,
    S,
    W,
    DIRS,
    DELTA,
    SHAPES,
    TIEBREAK_LEVEL,
    rotate,
    covers,
    sizeForLevel,
    features,
    generateLevel,
    maskAt,
    connected,
    isSolved,
    route,
    minRotations,
    tap,
    hint,
    levelScore,
    scoreRun,
    tiebreakSettings,
    checkTiebreak,
  };
});
