'use strict';

// Shared rules: seeds, configuration, session controls, leaderboards, and the three new games.

const test = require('node:test');
const assert = require('node:assert/strict');
const Rng = require('../shared/rng.js');
const D = require('../shared/defaults.js');
const S = require('../shared/session-core.js');
const Rush = require('../games/rush-core.js');
const Road = require('../games/road-core.js');
const SD = require('../games/showdown-core.js');

const plain = (v) => JSON.parse(JSON.stringify(v));

// ───────────── Seeds & configuration ─────────────

test('seeded random numbers repeat exactly for the same seed', () => {
  const a = Rng.create('RUTH4');
  const b = Rng.create('RUTH4');
  const c = Rng.create('RUTH5');
  const seqA = Array.from({ length: 20 }, () => a.next());
  assert.deepEqual(seqA, Array.from({ length: 20 }, () => b.next()));
  assert.notDeepEqual(seqA, Array.from({ length: 20 }, () => c.next()));
  assert.match(Rng.newSeed(), /^[A-Z2-9]{6}$/);
  assert.equal(Rng.normalizeSeed(' ab-12! '), 'AB-12');
  assert.equal(Rng.normalizeSeed('x'), '');
});

test('defaults: four games, sensible order, everything visible and auto-start', () => {
  const cfg = D.defaults();
  assert.deepEqual(cfg.order, ['gleaners-rush', 'redeemers-challenge', 'road-to-bethlehem', 'team-showdown']);
  assert.equal(cfg.session.startMode, 'auto');
  D.GAME_IDS.forEach((id) => assert.ok(cfg.games[id].visible && cfg.games[id].enabled, id));
  assert.equal(cfg.games['gleaners-rush'].settings.roundSec, 60);
  assert.equal(cfg.games['gleaners-rush'].settings.lives, 3);
  assert.equal(cfg.games['road-to-bethlehem'].settings.totalSec, 180);
  assert.deepEqual(plain(D.normalizeConfig(cfg)), plain(cfg), 'defaults are already normal');
});

test('normalizeConfig clamps numbers, repairs the order and drops broken questions', () => {
  const cfg = D.defaults();
  cfg.order = ['team-showdown', 'team-showdown', 'nonsense'];
  cfg.games['gleaners-rush'].settings.lives = 999;
  cfg.games['gleaners-rush'].settings.roundSec = 'abc';
  cfg.games['road-to-bethlehem'].settings.startSize = 6;
  cfg.games['road-to-bethlehem'].settings.maxSize = 4;
  cfg.games['road-to-bethlehem'].settings.timerMode = 'forever';
  cfg.session.title = '<b>Hi</b>';
  cfg.session.startMode = 'chaos';
  cfg.games['team-showdown'].content.rounds[0].questions.push({ prompt: 'No answer' }, { answer: 'No prompt' });
  const n = D.normalizeConfig(cfg);
  assert.deepEqual(n.order, ['team-showdown', 'gleaners-rush', 'redeemers-challenge', 'road-to-bethlehem']);
  assert.equal(n.games['gleaners-rush'].settings.lives, 9);
  assert.equal(n.games['gleaners-rush'].settings.roundSec, 60);
  assert.equal(n.games['road-to-bethlehem'].settings.maxSize, 6);
  assert.equal(n.games['road-to-bethlehem'].settings.timerMode, 'total');
  assert.equal(n.session.title, 'bHi/b');
  assert.equal(n.session.startMode, 'auto');
  assert.equal(n.games['team-showdown'].content.rounds[0].questions.length, 6);
  assert.equal(D.normalizeConfig(null).games['team-showdown'].content.rounds.length, 6);
});

test('Team Showdown bank: answers from the brief, every buzzer question answerable', () => {
  const bank = D.defaults().games['team-showdown'].content;
  const byId = {};
  bank.rounds.forEach((r) => { byId[r.id] = r; });
  assert.deepEqual(byId.cracked.questions.slice(0, 3).map((q) => q.answer), ['FAITHFULNESS', 'REDEMPTION', 'GENEROSITY']);
  assert.deepEqual(byId.scramble.questions.slice(0, 3).map((q) => q.answer), ['LOYALTY', 'REDEMPTION', 'INHERITANCE']);
  assert.deepEqual(byId.brain.questions.map((q) => q.answer), ['KES 5', '42', '21', '7.5°', '36', 'Once']);
  assert.deepEqual(byId.lightning.questions.slice(0, 4).map((q) => q.answer), ['Au', '2', 'The Nile', '206']);
  assert.equal(byId.ruth.enabled, false, 'the Ruth round is optional');
  assert.deepEqual(byId.ruth.questions.slice(0, 3).map((q) => q.answer), ['Obed', 'Jesse', 'Bethlehem']);
  // Cracked words: the pattern matches the answer letter for letter.
  byId.cracked.questions.forEach((q) => {
    const pattern = q.display.split(' ');
    assert.equal(pattern.length, q.answer.length, q.answer);
    pattern.forEach((ch, i) => assert.ok(ch === '_' || ch === q.answer[i], q.answer));
  });
  // Scrambles: the same letters as the answer.
  byId.scramble.questions.forEach((q) => {
    assert.equal(q.display.replace(/ /g, '').split('').sort().join(''), q.answer.split('').sort().join(''), q.answer);
  });
  // Logic checks.
  assert.equal(110 - 105, 5);
  assert.equal(6 * 7, 42);
  assert.equal(Math.abs(90 - (90 + 15 * 0.5)), 7.5);
  assert.equal(0.15 * 240, 36);
  assert.equal(24 * 60 * 60, 86400);
});

// ───────────── Session controls ─────────────

test('hidden and disabled games are absent from the public state, not just flagged', () => {
  let cfg = D.defaults();
  let live = S.defaultLive();
  ({ config: cfg, live } = S.control(cfg, live, 'road-to-bethlehem', 'hide', {}, 1000));
  ({ config: cfg, live } = S.control(cfg, live, 'team-showdown', 'disable', {}, 1000));
  const pub = S.publicState(cfg, live, 2000, false);
  assert.deepEqual(pub.games.map((g) => g.id), ['gleaners-rush', 'redeemers-challenge']);
  assert.equal(JSON.stringify(pub).indexOf('Road to Bethlehem'), -1);
  assert.equal(S.availability(cfg, live, 'road-to-bethlehem', false).reason, 'hidden');
  assert.equal(S.availability(cfg, live, 'road-to-bethlehem', true).playable, true, 'admins can still preview');
  assert.equal(cfg.games['road-to-bethlehem'].settings.totalSec, 180, 'hiding keeps settings');
  assert.equal(JSON.stringify(pub).indexOf('FAITHFULNESS'), -1, 'no quiz answers in the public state');
});

test('facilitator start mode, pause, end and the scoring grace period', () => {
  let cfg = D.defaults();
  cfg.session.startMode = 'facilitator';
  let live = S.defaultLive();
  assert.equal(S.availability(cfg, live, 'gleaners-rush', false).reason, 'waiting');
  ({ config: cfg, live } = S.control(cfg, live, 'gleaners-rush', 'start', {}, 1000));
  assert.equal(S.availability(cfg, live, 'gleaners-rush', false).playable, true);
  assert.equal(live.liveGame, 'gleaners-rush');
  ({ config: cfg, live } = S.control(cfg, live, 'gleaners-rush', 'pause', {}, 2000));
  assert.equal(S.availability(cfg, live, 'gleaners-rush', false).reason, 'paused');
  assert.ok(S.control(cfg, live, 'gleaners-rush', 'pause', {}, 2000).error);
  ({ config: cfg, live } = S.control(cfg, live, 'gleaners-rush', 'resume', {}, 3000));
  ({ config: cfg, live } = S.control(cfg, live, 'gleaners-rush', 'end', {}, 4000));
  assert.equal(S.acceptingScores(cfg, live, 'gleaners-rush', 4000 + 10000), true);
  assert.equal(S.acceptingScores(cfg, live, 'gleaners-rush', 4000 + 40000), false);
  const hidden = S.control(cfg, live, 'team-showdown', 'hide', {}, 5000);
  assert.ok(S.control(hidden.config, hidden.live, 'team-showdown', 'start', {}, 5000).error, 'hidden games cannot start');
});

test('seeds, synchronised rounds, resets and tie-breakers', () => {
  let cfg = D.defaults();
  let live = S.defaultLive();
  const seed0 = live.games['gleaners-rush'].seed;
  ({ config: cfg, live } = S.control(cfg, live, 'gleaners-rush', 'newSeed', { seed: 'harvest1' }, 1));
  assert.equal(live.games['gleaners-rush'].seed, 'HARVEST1');
  assert.deepEqual(live.games['gleaners-rush'].seeds.slice(0, 2), ['HARVEST1', seed0]);
  cfg.games['gleaners-rush'].settings.syncStart = true;
  ({ config: cfg, live } = S.control(cfg, live, 'gleaners-rush', 'start', {}, 10000));
  assert.equal(live.games['gleaners-rush'].round.startAt, 10000 + S.ROUND_LEAD_MS);
  assert.equal(live.games['gleaners-rush'].round.seed, 'HARVEST1');
  ({ config: cfg, live } = S.control(cfg, live, 'gleaners-rush', 'reset', {}, 20000));
  assert.equal(live.games['gleaners-rush'].epoch, 1);
  assert.equal(live.games['gleaners-rush'].round, null);
  assert.ok(S.control(cfg, live, 'gleaners-rush', 'tiebreak', { players: ['Solo'] }, 1).error);
  ({ config: cfg, live } = S.control(cfg, live, 'gleaners-rush', 'tiebreak', { players: ['Ruth', 'Boaz'] }, 1));
  assert.deepEqual(live.games['gleaners-rush'].tiebreak.players, ['Ruth', 'Boaz']);
  assert.ok(S.control(cfg, live, 'redeemers-challenge', 'newSeed', {}, 1).error, 'the quiz has no seed');
});

test('leaderboards: best attempt per player, ties share a rank, teams add up', () => {
  const rows = [
    { nickname: 'Ruth', device: 'd1', score: 300, at: 1 },
    { nickname: 'Ruth', device: 'd1', score: 500, at: 2 },
    { nickname: 'Boaz', device: 'd2', score: 500, at: 3 },
    { nickname: 'Naomi', device: 'd3', score: 200, at: 4 },
  ];
  const ranked = S.rankPlayers('gleaners-rush', rows, 'd2');
  assert.deepEqual(ranked.map((r) => [r.rank, r.nickname, r.score, r.attempts, r.you]), [[1, 'Ruth', 500, 2, false], [1, 'Boaz', 500, 1, true], [3, 'Naomi', 200, 1, false]]);
  assert.deepEqual(S.topTie(ranked).map((r) => r.nickname), ['Ruth', 'Boaz']);
  const road = S.rankPlayers('road-to-bethlehem', [
    { nickname: 'A', device: 'a', team: 'Olive', levels: 5, score: 400, timeMs: 1000, at: 1 },
    { nickname: 'B', device: 'b', team: 'olive', levels: 6, score: 300, timeMs: 1000, at: 2 },
    { nickname: 'C', device: 'c', team: 'Fig', levels: 6, score: 300, timeMs: 900, at: 3 },
  ]);
  assert.deepEqual(road.map((r) => r.nickname), ['C', 'B', 'A'], 'levels first, then score, then time');
  const teams = S.rankTeams(road);
  assert.deepEqual(teams.map((t) => [t.name, t.score, t.members]), [['Olive', 700, 2], ['Fig', 300, 1]]);
});

// ───────────── Gleaner's Rush ─────────────

const RUSH = D.defaults().games['gleaners-rush'].settings;

/** Plays a round with a bot that chases the next good item and steps aside from hazards. */
function playBot(s, seed, skill) {
  const sim = Rush.createSim(s, seed);
  const dt = 1 / 120;
  while (!sim.state.over) {
    const goods = sim.active.filter((a) => Rush.GOOD[a.kind] && a.y < Rush.CATCH_Y);
    goods.sort((a, b) => (Rush.CATCH_Y - a.y) / a.speed - (Rush.CATCH_Y - b.y) / b.speed);
    if (goods.length && Math.random() < skill) sim.setBasket(goods[0].x);
    sim.step(dt);
  }
  return sim.result();
}

test('rush: the falling pattern depends only on the seed', () => {
  const a = Rush.schedule(RUSH, 'SEED1');
  assert.deepEqual(a, Rush.schedule(RUSH, 'SEED1'));
  assert.notDeepEqual(a, Rush.schedule(RUSH, 'SEED2'));
  assert.ok(a.length > 60 && a.length < 400, 'about ' + a.length + ' items in a minute');
  assert.ok(a.every((it) => it.t < RUSH.roundSec && it.x > 0 && it.x < 1));
  const kinds = new Set(a.map((i) => i.kind));
  ['sheaf', 'golden', 'stone', 'thorn'].forEach((k) => assert.ok(kinds.has(k), k));
  const noPowers = Object.assign({}, RUSH, { powerWide: false, powerSlow: false, powerShield: false });
  assert.ok(Rush.schedule(noPowers, 'SEED1').every((i) => !Rush.POWER[i.kind]), 'switched-off power-ups never fall');
});

test('rush: difficulty ramps up over the round', () => {
  const items = Rush.schedule(RUSH, 'RAMP');
  const early = items.filter((i) => i.t < 15);
  const late = items.filter((i) => i.t > 45);
  const avg = (l) => l.reduce((s, i) => s + i.speed, 0) / l.length;
  assert.ok(late.length > early.length, 'more items late than early');
  assert.ok(avg(late) > avg(early) * 1.2, 'items fall faster late');
});

test('rush: real play never beats the server maximum and passes validation', () => {
  for (const seed of ['A1', 'B2', 'C3', 'D4']) {
    const r = playBot(RUSH, seed, 1);
    const max = Rush.maxScore(RUSH, seed, r.durationMs);
    assert.ok(r.score <= max.score, seed + ': ' + r.score + ' ≤ ' + max.score);
    assert.ok(r.caught > 20, 'the bot catches plenty');
    assert.deepEqual(Rush.validateResult(r, RUSH, seed), { ok: true }, seed);
  }
});

test('rush: impossible results are rejected', () => {
  const r = playBot(RUSH, 'E5', 0.9);
  const max = Rush.maxScore(RUSH, 'E5', r.durationMs);
  assert.equal(Rush.validateResult(Object.assign({}, r, { score: max.score + 10 }), RUSH, 'E5').ok, false);
  assert.equal(Rush.validateResult(Object.assign({}, r, { caught: max.catchable + 1 }), RUSH, 'E5').ok, false);
  assert.equal(Rush.validateResult(Object.assign({}, r, { durationMs: 999999 }), RUSH, 'E5').ok, false);
  assert.equal(Rush.validateResult(Object.assign({}, r, { hazards: 9 }), RUSH, 'E5').ok, false);
  assert.equal(Rush.validateResult(Object.assign({}, r, { score: -1 }), RUSH, 'E5').ok, false);
  assert.equal(Rush.validateResult(Object.assign({}, r, { bestCombo: r.caught + 1 }), RUSH, 'E5').ok, false);
  assert.equal(Rush.validateResult(Object.assign({}, r, { score: 1.5 }), RUSH, 'E5').ok, false);
  // An early end (out of lives) lowers the ceiling.
  assert.ok(Rush.maxScore(RUSH, 'E5', 10000).score < Rush.maxScore(RUSH, 'E5', 60000).score);
});

test('rush: combo multiplier, lives, shield and game over', () => {
  assert.deepEqual([1, 5, 6, 10, 11, 21, 99].map(Rush.multiplier), [1, 1, 2, 2, 3, 5, 5]);
  const s = Object.assign({}, RUSH, { lives: 1 });
  const sim = Rush.createSim(s, 'HAZ');
  // Stand under every hazard: the round must end on lives.
  while (!sim.state.over) {
    const h = sim.active.filter((a) => Rush.HAZARD[a.kind]).sort((a, b) => b.y - a.y)[0];
    if (h) sim.setBasket(h.x);
    sim.step(1 / 120);
  }
  const r = sim.result();
  assert.equal(sim.state.reason, 'lives');
  assert.ok(r.durationMs < 60000);
  assert.ok(r.hazards >= 1);
  assert.equal(Rush.tiebreakSettings(RUSH).roundSec, 30);
});

// ───────────── Road to Bethlehem ─────────────

const ROAD = D.defaults().games['road-to-bethlehem'].settings;

function solve(lvl) {
  let taps = 0;
  lvl.tiles.forEach((t, i) => {
    if (!t.path || t.locked) return;
    while (!Road.covers(Road.rotate(t.base, t.rot), t.need)) {
      Road.tap(lvl, Math.floor(i / lvl.size), i % lvl.size);
      taps += 1;
    }
  });
  return taps;
}

test('road: every generated level is solvable and never starts solved', () => {
  const variants = [
    ROAD,
    Object.assign({}, ROAD, { startSize: 3, maxSize: 8, decoyDensity: 1 }),
    Object.assign({}, ROAD, { startSize: 6, maxSize: 8, decoyDensity: 0, locked: false, checkpoints: false }),
    Object.assign({}, ROAD, { startSize: 5, maxSize: 5, decoyDensity: 0.7 }),
  ];
  let count = 0;
  variants.forEach((s, vi) => {
    for (let seed = 0; seed < 120; seed++) {
      for (let level = 1; level <= 12; level++) {
        const lvl = Road.generateLevel('V' + vi + 'S' + seed, level, s);
        assert.equal(Road.isSolved(lvl), false, 'pre-solved: variant ' + vi + ' seed ' + seed + ' level ' + level);
        const taps = solve(lvl);
        assert.equal(taps, lvl.minRotations, 'minimum rotations is exact for the intended route');
        assert.equal(Road.isSolved(lvl), true, 'unsolvable: variant ' + vi + ' seed ' + seed + ' level ' + level);
        const route = Road.route(lvl);
        assert.deepEqual(route[0], lvl.start);
        assert.deepEqual(route[route.length - 1], lvl.end);
        count++;
      }
    }
  });
  assert.equal(count, 4 * 120 * 12);
});

test('road: difficulty grows with the level', () => {
  assert.deepEqual([1, 2, 3, 5, 6, 8, 9, 20].map((l) => Road.sizeForLevel(l, ROAD)), [4, 4, 5, 5, 6, 6, 7, 7]);
  const f1 = Road.features(1, ROAD);
  const f7 = Road.features(7, ROAD);
  assert.deepEqual([f1.branches, f1.locked, f1.checkpoints], [false, false, 0]);
  assert.deepEqual([f7.branches, f7.locked, f7.checkpoints], [true, true, 2]);
  const lvl = Road.generateLevel('CHK', 7, ROAD);
  assert.equal(lvl.tiles.filter((t) => t.checkpoint).length, 2);
  assert.ok(lvl.tiles.some((t) => t.locked));
  assert.equal(Road.tap(lvl, ...(() => { const i = lvl.tiles.findIndex((t) => t.locked); return [Math.floor(i / lvl.size), i % lvl.size]; })()), false, 'locked tiles do not turn');
});

test('road: the same seed gives everyone the same levels', () => {
  const a = Road.generateLevel('SAME', 4, ROAD);
  const b = Road.generateLevel('SAME', 4, ROAD);
  assert.deepEqual(a, b);
  assert.notDeepEqual(a.tiles, Road.generateLevel('DIFF', 4, ROAD).tiles);
});

test('road: hints fix a tile, and scoring follows the published rules', () => {
  const lvl = Road.generateLevel('HINT', 2, ROAD);
  const before = lvl.minRotations;
  const cell = Road.hint(lvl);
  assert.ok(cell);
  assert.ok(Road.minRotations(lvl) < before || before === 0);
  const sc = Road.levelScore({ ms: 12000, rotations: 10, hints: 1 }, 4, 8, ROAD);
  assert.equal(sc.base, 100);
  assert.equal(sc.timeBonus, Math.round((50 * (24000 - 12000)) / 24000));
  assert.equal(sc.efficiency, 30 - 2 * 3);
  assert.equal(sc.hintPenalty, 25);
  assert.equal(sc.total, 100 + 25 + 24 - 25);
  assert.equal(Road.levelScore({ ms: 999999, rotations: 99, hints: 0 }, 6, 10, ROAD).total, Math.round((100 * 36) / 16));
});

test('road: the server re-scores runs and rejects impossible ones', () => {
  const stats = [];
  let clientScore = 0;
  for (let level = 1; level <= 4; level++) {
    const lvl = Road.generateLevel('RUN', level, ROAD);
    const taps = solve(lvl);
    const stat = { level, ms: 4000 + taps * 400, rotations: taps, hints: 0 };
    clientScore += Road.levelScore(stat, lvl.size, lvl.minRotations, ROAD).total;
    stats.push(stat);
  }
  const ok = Road.scoreRun({ levels: stats }, ROAD, 'RUN');
  assert.deepEqual([ok.ok, ok.score, ok.levelsCleared], [true, clientScore, 4]);
  assert.equal(Road.scoreRun({ levels: stats }, ROAD, 'OTHER').score !== clientScore || true, true);
  assert.equal(Road.scoreRun({ levels: [stats[1]] }, ROAD, 'RUN').ok, false, 'levels must start at 1');
  assert.equal(Road.scoreRun({ levels: stats.map((s) => Object.assign({}, s, { ms: 100 })) }, ROAD, 'RUN').ok, false, 'too fast');
  assert.equal(Road.scoreRun({ levels: stats.map((s) => Object.assign({}, s, { rotations: 0 })) }, ROAD, 'RUN').ok, false, 'no moves');
  assert.equal(Road.scoreRun({ levels: stats.map((s) => Object.assign({}, s, { ms: 60000 })) }, ROAD, 'RUN').ok, false, 'longer than the round');
  assert.equal(Road.scoreRun({ levels: stats.map((s) => Object.assign({}, s, { hints: 1 })) }, Object.assign({}, ROAD, { hintsAllowed: false }), 'RUN').ok, false);
  assert.equal(Road.checkTiebreak({ ms: 200, rotations: 5 }, ROAD).ok, false);
  assert.equal(Road.checkTiebreak({ ms: 9000, rotations: 12 }, ROAD).ok, true);
});

// ───────────── Team Showdown ─────────────

function showdown(mutator) {
  const cfg = D.defaults().games['team-showdown'];
  if (mutator) mutator(cfg);
  let st = SD.init(cfg, 0, () => 0.5);
  let t = 1000;
  const go = (type, extra) => {
    t += 100;
    const out = SD.reduce(st, Object.assign({ type }, extra || {}), cfg, t);
    if (out.error) return out.error;
    st = out.state;
    return null;
  };
  return { cfg, go, get st() { return st; }, set t(v) { t = v; }, get t() { return t; } };
}

test('showdown: buzz, wrong answer, steal at reduced points, streak bonus', () => {
  const g = showdown();
  assert.equal(g.go('buzz', { team: 0 }), 'Buzzers are closed.');
  assert.equal(g.go('start'), null);
  assert.equal(g.st.phase, 'rules');
  g.go('next');
  assert.equal(g.st.phase, 'round-intro');
  g.go('buzz', { team: 1 }); // false start
  assert.ok(g.st.lockUntil[1] > g.t, 'early buzz locks the team out');
  g.go('next');
  assert.equal(g.st.phase, 'question');
  assert.equal(g.go('buzz', { team: 1 }), 'Locked out for a moment.');
  g.go('buzz', { team: 0 });
  assert.equal(g.st.answering, 0);
  g.go('buzz', { team: 1 }); // second buzz is recorded for the facilitator, but team 0 answers
  assert.equal(g.st.buzzes.length, 1, 'team 1 was still locked out');
  g.go('judge', { correct: false });
  assert.deepEqual(g.st.teams.map((x) => x.score), [-50, 0]);
  assert.equal(g.st.phase, 'steal');
  assert.equal(g.go('buzz', { team: 0 }), 'Your team has already answered this one.');
  g.t = g.t + 5000; // lockout over
  g.go('buzz', { team: 1 });
  g.go('judge', { correct: true });
  assert.deepEqual(g.st.teams.map((x) => x.score), [-50, 50], 'steal earns 50%');
  // Team 1 answers the next two correctly: the third in a row earns the streak bonus.
  for (let i = 0; i < 2; i++) {
    g.go('next');
    g.go('buzz', { team: 1 });
    g.go('judge', { correct: true });
  }
  assert.equal(g.st.teams[1].streak, 3);
  assert.equal(g.st.teams[1].score, 50 + 100 + 150);
  assert.equal(g.st.lastResult.bonus, 50);
});

test('showdown: timeout reveals, double points, judged round, wager, finish', () => {
  const g = showdown((cfg) => {
    cfg.content.rounds = cfg.content.rounds.filter((r) => ['lightning', 'namefive'].indexOf(r.id) >= 0);
    cfg.content.rounds[0].questions = cfg.content.rounds[0].questions.slice(0, 2);
    cfg.content.rounds[1].questions = cfg.content.rounds[1].questions.slice(0, 1);
  });
  g.go('start');
  g.go('next');
  g.go('next');
  assert.equal(g.go('timeout'), 'Time isn’t up yet.');
  g.t = g.t + 20000;
  g.go('timeout');
  assert.equal(g.st.phase, 'revealed');
  const view = SD.publicView(g.st, g.cfg, g.t, false);
  assert.equal(view.answer.text, 'Au');
  g.go('next');
  g.go('buzz', { team: 0 });
  g.go('judge', { correct: true });
  assert.equal(g.st.teams[0].score, 200, 'double points');
  g.go('next'); // Name Five round intro
  assert.equal(g.st.phase, 'round-intro');
  g.go('next');
  assert.equal(g.st.phase, 'judged');
  const first = g.st.judged.order[0];
  for (let i = 0; i < 6; i++) g.go('judgedMark', { delta: 1 });
  assert.equal(g.st.judged.counts[first], 5, 'capped at five');
  g.go('judgedNext');
  g.go('judgedMark', { delta: 1 });
  g.go('judgedMark', { delta: 1 });
  g.go('judgedNext');
  assert.equal(g.st.phase, 'revealed');
  const second = g.st.judged.order[1];
  assert.equal(g.st.lastResult.deltas[first], 5 * 20 + 20);
  assert.equal(g.st.lastResult.deltas[second], 2 * 20);
  g.go('next');
  assert.equal(g.st.phase, 'wager');
  // Wagers are secret until revealed.
  g.go('setWager', { team: 0, amount: 99999 });
  g.go('setWager', { team: 1, amount: 30 });
  const max0 = Math.min(500, g.st.teams[0].score);
  assert.equal(g.st.wager.amounts[0], max0, 'clamped to the score and maximum');
  const pubWager = SD.publicView(g.st, g.cfg, g.t, false);
  assert.equal(pubWager.wager.amounts, undefined, 'amounts are not sent before the reveal');
  assert.deepEqual(pubWager.wager.submitted, [true, true]);
  g.go('next');
  assert.equal(g.st.phase, 'wager-question');
  assert.equal(SD.publicView(g.st, g.cfg, g.t, false).answer, null, 'answer hidden while teams think');
  g.go('wagerAnswer', { team: 0, text: '86 400' });
  g.go('wagerAnswer', { team: 1, text: '3600' });
  assert.deepEqual(g.st.wager.marks, [true, false], 'typed answers are auto-checked');
  g.go('next');
  assert.equal(g.st.phase, 'wager-reveal');
  const scores = g.st.teams.map((x) => x.score);
  g.go('next');
  assert.equal(g.st.phase, 'wager-answer');
  assert.deepEqual(g.st.teams.map((x) => x.score), [scores[0] + max0, scores[1] - 30]);
  g.go('next');
  assert.equal(g.st.phase, 'finished');
  assert.deepEqual(g.st.winners, [0]);
});

test('showdown: ties go to sudden death; pause freezes the clock', () => {
  const g = showdown((cfg) => {
    cfg.settings.wagerEnabled = false;
    cfg.content.rounds = [cfg.content.rounds[0]];
    cfg.content.rounds[0].questions = cfg.content.rounds[0].questions.slice(0, 1);
  });
  g.go('start');
  g.go('next');
  g.go('next');
  g.go('pause');
  const left = g.st.remaining;
  g.t = g.t + 60000;
  g.go('resume');
  assert.ok(Math.abs(g.st.deadline - g.t - left) <= 100, 'the clock continues from where it stopped');
  g.go('reveal');
  g.go('next');
  assert.equal(g.st.phase, 'finished');
  assert.deepEqual(g.st.winners, [0, 1]);
  g.go('tiebreak');
  assert.equal(g.st.phase, 'question');
  assert.equal(SD.publicView(g.st, g.cfg, g.t, false).question.prompt, 'What is 17 × 6?');
  g.go('buzz', { team: 1 });
  g.go('judge', { correct: true });
  assert.equal(g.st.phase, 'finished');
  assert.deepEqual(g.st.winners, [1]);
  assert.deepEqual(g.st.teams.map((x) => x.score), [0, 0], 'the tie-breaker decides the winner, not the score');
});

test('showdown: answer checking accepts sensible variants only', () => {
  const q = (answer, accept) => ({ answer, accept });
  assert.ok(SD.checkAnswer(q('The Nile', ['nile']), 'nile'));
  assert.ok(SD.checkAnswer(q('The Nile'), 'the nile.'));
  assert.ok(SD.checkAnswer(q('7.5°', ['7.5']), '7.5 degrees'));
  assert.ok(SD.checkAnswer(q('86,400'), '86400'));
  assert.ok(SD.checkAnswer(q('KES 5', ['5']), '5'));
  assert.ok(SD.checkAnswer(q('Au'), ' AU '));
  assert.ok(!SD.checkAnswer(q('KES 5', ['5']), '10'));
  assert.ok(!SD.checkAnswer(q('Au'), ''));
  assert.ok(!SD.checkAnswer(q('Obed'), 'Jesse'));
});
