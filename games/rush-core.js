/*
 * Gleaner's Rush — rules and simulation, with no drawing code.
 *
 * The playfield has a fixed shape (2 wide : 3 tall) on every device, measured in
 * fractions of its width (x) and height (y), so a phone and a projector play the same game.
 * What falls, when and where depends only on the seed and the settings — never on the
 * player — so every player in a session faces the same pattern, and the server can
 * work out the highest score that was possible.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('../shared/rng.js'));
  else root.RushCore = factory(root.HubRng);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (Rng) {
  'use strict';

  const FIELD_ASPECT = 2 / 3; // width / height
  const START_Y = -0.06;
  const CATCH_Y = 0.86;
  const GONE_Y = 1.08;
  const ITEM_R = 0.05; // item half-width, as a fraction of field width
  const BASKET_W = 0.2;
  const WIDE_W = 0.34;
  const NEAR_MISS = 0.06;
  const POINTS = { sheaf: 10, golden: 50 };
  const COMBO_STEP = 5; // every 5 catches in a row raises the multiplier
  const MAX_MULT = 5;
  const WIDE_SEC = 8;
  const SLOW_SEC = 5;
  const SLOW_FACTOR = 0.5;
  const BASE_SPEED = 0.3; // field heights per second at the start, at speed setting 1
  const GOOD = { sheaf: true, golden: true };
  const HAZARD = { stone: true, thorn: true };
  const POWER = { wide: true, slow: true, shield: true };

  function difficulty(t, s) {
    return 1 + (s.ramp * t) / 60;
  }

  function multiplier(combo) {
    return Math.min(MAX_MULT, 1 + Math.floor(Math.max(0, combo - 1) / COMBO_STEP));
  }

  /** Every item that will fall during a round, in spawn order. */
  function schedule(s, seed) {
    const rng = Rng.create('rush:' + seed);
    const powers = [];
    if (s.powerWide) powers.push('wide');
    if (s.powerSlow) powers.push('slow');
    if (s.powerShield) powers.push('shield');
    const items = [];
    let t = 0.6;
    while (t < s.roundSec) {
      const d = difficulty(t, s);
      const hazardP = Math.min(0.6, s.hazardRatio * (0.7 + 0.3 * d));
      const goldenP = s.goldenFreq;
      const powerP = powers.length ? 0.035 : 0;
      const roll = rng.next();
      const sub = rng.next();
      let kind = 'sheaf';
      if (roll < hazardP) kind = sub < 0.5 ? 'stone' : 'thorn';
      else if (roll < hazardP + goldenP) kind = 'golden';
      else if (roll < hazardP + goldenP + powerP) kind = powers[Math.floor(sub * powers.length)];
      const speed = BASE_SPEED * s.startSpeed * Math.pow(d, 0.75) * (0.85 + rng.next() * 0.3) * (kind === 'golden' ? 1.45 : 1);
      const x = 0.08 + rng.next() * 0.84;
      items.push({ t: round(t, 3), x: round(x, 4), kind, speed: round(speed, 4) });
      const interval = 1 / (s.spawnRate * Math.pow(d, 0.9));
      t += interval * (0.65 + rng.next() * 0.7);
    }
    return items;
  }

  function round(v, places) {
    const f = Math.pow(10, places);
    return Math.round(v * f) / f;
  }

  /** The earliest moment an item could reach the basket (slowing only makes it later). */
  function earliestCatch(item) {
    return item.t + (CATCH_Y - START_Y) / item.speed;
  }

  /**
   * The highest score anyone could have reached within durationMs: every sheaf caught,
   * with the biggest multipliers paired with the most valuable items.
   */
  function maxScore(s, seed, durationMs) {
    const limit = (durationMs == null ? s.roundSec * 1000 : durationMs) / 1000 + 0.05;
    const values = schedule(s, seed)
      .filter((it) => GOOD[it.kind] && earliestCatch(it) <= limit)
      .map((it) => POINTS[it.kind])
      .sort((a, b) => b - a);
    const mults = values.map((_, i) => multiplier(i + 1)).sort((a, b) => b - a);
    let total = 0;
    values.forEach((v, i) => { total += v * mults[i]; });
    return { score: total, catchable: values.length };
  }

  /** A playable round. Call step(dt) with fixed steps and setBasket(x) from input. */
  function createSim(s, seed) {
    const items = schedule(s, seed);
    let next = 0;
    const active = [];
    const events = [];
    const st = {
      t: 0,
      basketX: 0.5,
      score: 0,
      combo: 0,
      bestCombo: 0,
      lives: s.lives,
      caught: 0,
      golden: 0,
      missed: 0,
      hazards: 0,
      blocked: 0,
      powerUps: 0,
      wideUntil: 0,
      slowUntil: 0,
      shield: false,
      over: false,
      reason: null,
    };

    function basketHalf() {
      return (st.t < st.wideUntil ? WIDE_W : BASKET_W) / 2;
    }

    function setBasket(x) {
      const half = basketHalf();
      st.basketX = Math.min(1 - half, Math.max(half, x));
    }

    function catchItem(it) {
      if (GOOD[it.kind]) {
        st.caught += 1;
        st.combo += 1;
        if (st.combo > st.bestCombo) st.bestCombo = st.combo;
        const mult = multiplier(st.combo);
        const pts = POINTS[it.kind] * mult;
        st.score += pts;
        if (it.kind === 'golden') st.golden += 1;
        events.push({ type: 'catch', kind: it.kind, pts, mult, x: it.x });
      } else if (HAZARD[it.kind]) {
        if (st.shield) {
          st.shield = false;
          st.blocked += 1;
          events.push({ type: 'blocked', kind: it.kind, x: it.x });
        } else {
          st.lives -= 1;
          st.hazards += 1;
          st.combo = 0;
          events.push({ type: 'hit', kind: it.kind, x: it.x });
          if (st.lives <= 0) {
            st.over = true;
            st.reason = 'lives';
          }
        }
      } else if (POWER[it.kind]) {
        st.powerUps += 1;
        if (it.kind === 'wide') st.wideUntil = st.t + WIDE_SEC;
        if (it.kind === 'slow') st.slowUntil = st.t + SLOW_SEC;
        if (it.kind === 'shield') st.shield = true;
        events.push({ type: 'power', kind: it.kind, x: it.x });
      }
    }

    function step(dt) {
      if (st.over) return;
      st.t += dt;
      while (next < items.length && items[next].t <= st.t) {
        const it = items[next];
        active.push({ id: next, kind: it.kind, x: it.x, y: START_Y, speed: it.speed, spin: (next % 7) / 7 });
        next += 1;
      }
      const factor = st.t < st.slowUntil ? SLOW_FACTOR : 1;
      for (let i = active.length - 1; i >= 0; i--) {
        const a = active[i];
        const prevY = a.y;
        a.y += a.speed * factor * dt;
        if (prevY < CATCH_Y && a.y >= CATCH_Y) {
          const dx = Math.abs(a.x - st.basketX);
          const reach = basketHalf() + ITEM_R;
          if (dx <= reach) {
            catchItem(a);
            active.splice(i, 1);
            if (st.over) return;
            continue;
          }
          if (HAZARD[a.kind] && dx <= reach + NEAR_MISS) events.push({ type: 'near', x: a.x });
        }
        if (a.y > GONE_Y) {
          active.splice(i, 1);
          if (GOOD[a.kind]) {
            st.missed += 1;
            if (st.combo > 0) events.push({ type: 'miss', x: a.x });
            st.combo = 0;
          }
        }
      }
      if (st.t >= s.roundSec) {
        st.t = s.roundSec;
        st.over = true;
        st.reason = 'time';
      }
    }

    function result() {
      const attempts = st.caught + st.missed;
      return {
        score: st.score,
        caught: st.caught,
        golden: st.golden,
        missed: st.missed,
        hazards: st.hazards,
        blocked: st.blocked,
        powerUps: st.powerUps,
        bestCombo: st.bestCombo,
        durationMs: Math.round(st.t * 1000),
        accuracy: attempts ? Math.round((st.caught / attempts) * 100) : 0,
      };
    }

    return {
      state: st,
      active,
      events,
      step,
      setBasket,
      basketHalf,
      result,
      multiplier: () => multiplier(st.combo),
      upcoming: () => items.slice(next),
    };
  }

  const TIEBREAK_SEC = 30;

  /** Tie-breakers are one short run on a fresh pattern. */
  function tiebreakSettings(s) {
    return Object.assign({}, s, { roundSec: Math.min(TIEBREAK_SEC, s.roundSec) });
  }

  function isCount(v, max) {
    return Number.isInteger(v) && v >= 0 && v <= max;
  }

  /** Server-side plausibility check of a submitted result. Returns { ok, reason }. */
  function validateResult(r, s, seed) {
    if (!r || typeof r !== 'object') return { ok: false, reason: 'Missing result.' };
    const big = 100000;
    const fields = ['score', 'caught', 'golden', 'missed', 'hazards', 'bestCombo', 'durationMs'];
    for (const f of fields) if (!isCount(r[f], f === 'score' || f === 'durationMs' ? 10000000 : big)) return { ok: false, reason: 'Invalid ' + f + '.' };
    if (r.durationMs > s.roundSec * 1000 + 1000) return { ok: false, reason: 'Run longer than the round.' };
    const max = maxScore(s, seed, r.durationMs);
    if (r.caught > max.catchable) return { ok: false, reason: 'More catches than items that fell.' };
    if (r.golden > r.caught || r.bestCombo > r.caught) return { ok: false, reason: 'Inconsistent catches.' };
    if (r.score > max.score) return { ok: false, reason: 'Score higher than the maximum possible.' };
    if (r.score < r.caught * POINTS.sheaf) return { ok: false, reason: 'Score lower than the catches allow.' };
    if (r.hazards > s.lives) return { ok: false, reason: 'More hazards than lives.' };
    return { ok: true };
  }

  return {
    FIELD_ASPECT,
    START_Y,
    CATCH_Y,
    ITEM_R,
    BASKET_W,
    WIDE_W,
    POINTS,
    COMBO_STEP,
    MAX_MULT,
    WIDE_SEC,
    SLOW_SEC,
    GOOD,
    HAZARD,
    POWER,
    TIEBREAK_SEC,
    tiebreakSettings,
    multiplier,
    schedule,
    maxScore,
    createSim,
    validateResult,
  };
});
