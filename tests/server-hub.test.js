'use strict';

// The hub's server side (apps-script/Hub.gs), run in Node with stand-in Google services.

const test = require('node:test');
const assert = require('node:assert/strict');
const { createGas } = require('../dev/fake-gas');
const Rush = require('../games/rush-core.js');
const Road = require('../games/road-core.js');

const OWNER = 'owner@example.com';
const DEV = { a: 'device-aaaaaaaaaaaaaaaa', b: 'device-bbbbbbbbbbbbbbbb', c: 'device-cccccccccccccccc' };

function setup() {
  const clock = { t: Date.now(), now() { return this.t; } };
  const gas = createGas({ quiet: true, clock, ownerEmail: OWNER });
  gas.setup();
  const admin = (body) => {
    gas.setActiveUser(OWNER);
    const out = gas.call(body);
    gas.setActiveUser('');
    return out;
  };
  return { gas, clock, admin, call: gas.call, wait: (ms) => { clock.t += ms; } };
}

function bot(s, seed) {
  const sim = Rush.createSim(s, seed);
  while (!sim.state.over) {
    const goods = sim.active.filter((a) => Rush.GOOD[a.kind] && a.y < Rush.CATCH_Y);
    goods.sort((a, b) => (Rush.CATCH_Y - a.y) / a.speed - (Rush.CATCH_Y - b.y) / b.speed);
    if (goods.length) sim.setBasket(goods[0].x);
    sim.step(1 / 120);
  }
  return sim.result();
}

function solveLevels(seed, s, n) {
  const levels = [];
  for (let level = 1; level <= n; level++) {
    const lvl = Road.generateLevel(seed, level, s);
    let taps = 0;
    lvl.tiles.forEach((t, i) => {
      if (!t.path || t.locked) return;
      while (!Road.covers(Road.rotate(t.base, t.rot), t.need)) {
        Road.tap(lvl, Math.floor(i / lvl.size), i % lvl.size);
        taps++;
      }
    });
    levels.push({ level, ms: 3000 + taps * 500, rotations: taps, hints: 0 });
  }
  return levels;
}

function seedOf(h, game) {
  return h.call({ action: 'state' }).state.games.find((g) => g.id === game).seed;
}

// ───────────── Admin access ─────────────

test('admin actions need a verified admin; anonymous and unlisted users are refused', () => {
  const h = setup();
  assert.equal(h.call({ action: 'adminState' }).error, 'FORBIDDEN');
  assert.equal(h.call({ action: 'control', game: 'road-to-bethlehem', op: 'hide' }).error, 'FORBIDDEN');
  assert.equal(h.call({ action: 'whoami' }).isAdmin, false);
  h.gas.setActiveUser('stranger@example.com');
  const who = h.call({ action: 'whoami' });
  assert.equal(who.isAdmin, false);
  assert.match(who.message, /stranger@example.com.*not on the admin list/);
  assert.equal(h.call({ action: 'saveConfig', config: {} }).error, 'FORBIDDEN');
  h.gas.setActiveUser(OWNER);
  assert.deepEqual([h.call({ action: 'whoami' }).isAdmin, h.call({ action: 'whoami' }).method], [true, 'google']);
  h.gas.props.set('ADMIN_EMAILS', 'Helper@Example.com, other@example.com');
  h.gas.setActiveUser('helper@example.com');
  assert.equal(h.call({ action: 'adminState' }).ok, true, 'listed admins are accepted (case-insensitive)');
});

test('admin key: only its fingerprint is stored; wrong keys are throttled', () => {
  const h = setup();
  assert.equal(h.call({ action: 'whoami', adminKey: 'anything' }).message.indexOf('No admin key'), 0);
  const key = h.gas.createAdminKey();
  assert.equal(key.length, 40);
  assert.ok(![...h.gas.props.values()].some((v) => v.indexOf(key) >= 0), 'the key itself is not stored');
  assert.deepEqual([h.call({ action: 'whoami', adminKey: key }).isAdmin, h.call({ action: 'whoami', adminKey: key }).method], [true, 'key']);
  assert.equal(h.call({ action: 'adminState', adminKey: key }).ok, true);
  // One wrong attempt already happened above (before any key existed); 19 more reach the limit of 20.
  for (let i = 0; i < 19; i++) assert.equal(h.call({ action: 'adminState', adminKey: 'wrong' + i }).error, 'BAD_KEY');
  assert.equal(h.call({ action: 'adminState', adminKey: key }).error, 'LOCKED', 'locked even with the right key');
  h.wait(11 * 60 * 1000);
  assert.equal(h.call({ action: 'adminState', adminKey: key }).ok, true, 'unlocks after 10 minutes');
  h.gas.removeAdminKey();
  assert.equal(h.call({ action: 'adminState', adminKey: key }).ok, false);
});

// ───────────── Hidden games ─────────────

test('a hidden game disappears for participants and refuses runs, boards and content', () => {
  const h = setup();
  assert.equal(h.admin({ action: 'control', game: 'road-to-bethlehem', op: 'hide' }).ok, true);
  assert.equal(h.admin({ action: 'control', game: 'redeemers-challenge', op: 'hide' }).ok, true);
  assert.equal(h.admin({ action: 'control', game: 'team-showdown', op: 'disable' }).ok, true);
  const st = h.call({ action: 'state' }).state;
  assert.deepEqual(st.games.map((g) => g.id), ['gleaners-rush']);
  assert.equal(st.showdown, undefined);
  const text = JSON.stringify(st);
  ['Road to Bethlehem', 'Redeemer', 'Showdown', 'joinCodes', 'tokens'].forEach((w) => assert.equal(text.indexOf(w), -1, w));
  assert.equal(h.call({ action: 'startRun', game: 'road-to-bethlehem', deviceId: DEV.a, nickname: 'Ruth', seed: 'X' }).error, 'CLOSED');
  assert.equal(h.call({ action: 'board', game: 'road-to-bethlehem' }).error, 'NOT_AVAILABLE');
  assert.equal(h.admin({ action: 'board', game: 'road-to-bethlehem' }).ok, true, 'admins can still look');
  assert.equal(h.call({ action: 'content', game: 'redeemers-challenge' }).error, 'NOT_AVAILABLE');
  assert.equal(h.call({ action: 'content', game: 'redeemers-challenge', preview: true }).error, 'NOT_AVAILABLE', 'preview needs an admin');
  assert.equal(h.admin({ action: 'content', game: 'redeemers-challenge', preview: true }).content.questions.length, 8);
  assert.equal(h.call({ action: 'showdownJoin', code: '1234', team: 0, deviceId: DEV.a }).error, 'NOT_AVAILABLE');
  // Hiding keeps settings; showing brings the game straight back.
  const cfg = h.admin({ action: 'adminState' }).config;
  assert.equal(cfg.games['road-to-bethlehem'].settings.totalSec, 180);
  h.admin({ action: 'control', game: 'road-to-bethlehem', op: 'show' });
  assert.ok(h.call({ action: 'state' }).state.games.some((g) => g.id === 'road-to-bethlehem'));
});

test('saving settings validates them and cannot undo a show/hide', () => {
  const h = setup();
  const cfg = h.admin({ action: 'adminState' }).config;
  h.admin({ action: 'control', game: 'gleaners-rush', op: 'hide' });
  cfg.games['gleaners-rush'].settings.lives = 999;
  cfg.games['gleaners-rush'].visible = true; // stale draft
  cfg.session.title = 'Youth Night';
  const big = cfg.games['team-showdown'].content.rounds[0];
  for (let i = 0; i < 35; i++) big.questions.push({ prompt: 'Extra question number ' + i + ' with a fairly long prompt — and curly “quotes”', display: 'A B C', answer: 'Answer ' + i, accept: ['alt ' + i] });
  const saved = h.admin({ action: 'saveConfig', config: cfg });
  assert.equal(saved.ok, true);
  assert.equal(saved.config.games['gleaners-rush'].settings.lives, 9);
  assert.equal(saved.config.games['gleaners-rush'].visible, false);
  assert.ok(Number(h.gas.props.get('HUB_CONFIG_PARTS')) > 1, 'large configurations are split across properties');
  h.gas.cache.clear();
  const again = h.admin({ action: 'adminState' }).config;
  assert.equal(again.session.title, 'Youth Night');
  assert.equal(again.games['team-showdown'].content.rounds[0].questions.length, 40);
  assert.equal(again.games['team-showdown'].content.rounds[0].questions[10].prompt.indexOf('“quotes”') > 0, true, 'non-ASCII text survives');
  const restored = h.admin({ action: 'saveConfig', defaults: true });
  assert.equal(restored.config.session.title, 'Ruth 4 Game Night');
  assert.equal(restored.config.games['gleaners-rush'].visible, false, 'restore defaults keeps visibility');
});

// ───────────── Arcade and puzzle scores ─────────────

test('rush: a run must be registered, take real time, and fit within the maximum', () => {
  const h = setup();
  const seed = seedOf(h, 'gleaners-rush');
  const s = h.admin({ action: 'adminState' }).config.games['gleaners-rush'].settings;
  assert.equal(h.call({ action: 'submitRun', game: 'gleaners-rush', runId: '00000000-0000-0000-0000-000000000000', deviceId: DEV.a, nickname: 'Ruth', result: {} }).error, 'NO_RUN');
  assert.equal(h.call({ action: 'startRun', game: 'gleaners-rush', deviceId: DEV.a, nickname: 'Ruth', seed: 'MADEUP' }).error, 'OLD_SEED');
  const run = h.call({ action: 'startRun', game: 'gleaners-rush', deviceId: DEV.a, nickname: 'Ruth', seed });
  assert.equal(run.ok, true);
  const result = bot(s, seed);
  const early = h.call({ action: 'submitRun', game: 'gleaners-rush', runId: run.runId, deviceId: DEV.a, nickname: 'Ruth', result });
  assert.equal(early.error, 'IMPLAUSIBLE', 'cannot submit a minute of play after a second');
  h.wait(result.durationMs);
  assert.equal(h.call({ action: 'submitRun', game: 'gleaners-rush', runId: run.runId, deviceId: DEV.b, nickname: 'Ruth', result }).error, 'BAD_RUN', 'another device cannot use the run');
  assert.equal(h.call({ action: 'submitRun', game: 'gleaners-rush', runId: run.runId, deviceId: DEV.a, nickname: 'Boaz', result }).error, 'BAD_RUN', 'nickname must match');
  const ok = h.call({ action: 'submitRun', game: 'gleaners-rush', runId: run.runId, deviceId: DEV.a, nickname: 'Ruth', result });
  assert.equal(ok.ok, true, ok.message);
  assert.equal(ok.score, result.score);
  assert.equal(ok.rank, 1);
  const dup = h.call({ action: 'submitRun', game: 'gleaners-rush', runId: run.runId, deviceId: DEV.a, nickname: 'Ruth', result });
  assert.equal(dup.duplicate, true);
  assert.equal(h.gas.sheets.Results.rows.length, 2, 'header + one row');
  // An inflated score fails, even with a fresh run and enough time.
  const run2 = h.call({ action: 'startRun', game: 'gleaners-rush', deviceId: DEV.b, nickname: 'Boaz', seed });
  h.wait(61000);
  const cheat = Object.assign({}, result, { score: Rush.maxScore(s, seed, result.durationMs).score + 10 });
  assert.equal(h.call({ action: 'submitRun', game: 'gleaners-rush', runId: run2.runId, deviceId: DEV.b, nickname: 'Boaz', result: cheat }).error, 'IMPLAUSIBLE');
  const board = h.call({ action: 'board', game: 'gleaners-rush', deviceId: DEV.a });
  assert.deepEqual(board.players.map((p) => [p.rank, p.nickname, p.you]), [[1, 'Ruth', true]]);
  assert.equal(JSON.stringify(board).indexOf(DEV.a), -1, 'device ids never leave the server');
});

test('rush: attempts and submission rate are limited per player', () => {
  const h = setup();
  const cfg = h.admin({ action: 'adminState' }).config;
  cfg.games['gleaners-rush'].settings.attempts = 2;
  h.admin({ action: 'saveConfig', config: cfg });
  const seed = seedOf(h, 'gleaners-rush');
  const tiny = { score: 0, caught: 0, golden: 0, missed: 0, hazards: 0, bestCombo: 0, durationMs: 1000, accuracy: 0 };
  const r1 = h.call({ action: 'startRun', game: 'gleaners-rush', deviceId: DEV.a, nickname: 'Ruth', seed });
  const r2 = h.call({ action: 'startRun', game: 'gleaners-rush', deviceId: DEV.a, nickname: 'Ruth', seed });
  h.wait(1500);
  assert.equal(h.call({ action: 'submitRun', game: 'gleaners-rush', runId: r1.runId, deviceId: DEV.a, nickname: 'Ruth', result: tiny }).ok, true);
  assert.equal(h.call({ action: 'submitRun', game: 'gleaners-rush', runId: r2.runId, deviceId: DEV.a, nickname: 'Ruth', result: tiny }).error, 'RATE_LIMIT');
  h.wait(5000);
  assert.equal(h.call({ action: 'submitRun', game: 'gleaners-rush', runId: r2.runId, deviceId: DEV.a, nickname: 'Ruth', result: tiny }).ok, true);
  assert.equal(h.call({ action: 'startRun', game: 'gleaners-rush', deviceId: DEV.a, nickname: 'Ruth', seed }).error, 'TOO_MANY_ATTEMPTS');
  assert.equal(h.call({ action: 'startRun', game: 'gleaners-rush', deviceId: DEV.b, nickname: 'Boaz', seed }).ok, true, 'other players are unaffected');
});

test('rush: a reset during a run voids it, and the board starts again', () => {
  const h = setup();
  const seed = seedOf(h, 'gleaners-rush');
  const tiny = { score: 0, caught: 0, golden: 0, missed: 0, hazards: 0, bestCombo: 0, durationMs: 1000, accuracy: 0 };
  const done = h.call({ action: 'startRun', game: 'gleaners-rush', deviceId: DEV.a, nickname: 'Ruth', seed });
  const pending = h.call({ action: 'startRun', game: 'gleaners-rush', deviceId: DEV.b, nickname: 'Boaz', seed });
  h.wait(1500);
  h.call({ action: 'submitRun', game: 'gleaners-rush', runId: done.runId, deviceId: DEV.a, nickname: 'Ruth', result: tiny });
  assert.equal(h.call({ action: 'board', game: 'gleaners-rush' }).total, 1);
  h.admin({ action: 'control', game: 'gleaners-rush', op: 'reset' });
  assert.equal(h.call({ action: 'submitRun', game: 'gleaners-rush', runId: pending.runId, deviceId: DEV.b, nickname: 'Boaz', result: tiny }).error, 'RESET');
  assert.equal(h.call({ action: 'board', game: 'gleaners-rush' }).total, 0);
  const results = h.admin({ action: 'results', game: 'gleaners-rush' });
  assert.equal(results.rows.length, 1, 'earlier results are kept for the record');
  assert.equal(results.rows[0].current, false);
});

test('road: the server re-scores the run from the seed; team totals add up', () => {
  const h = setup();
  const cfg = h.admin({ action: 'adminState' }).config;
  cfg.games['road-to-bethlehem'].settings.teamMode = true;
  h.admin({ action: 'saveConfig', config: cfg });
  const s = cfg.games['road-to-bethlehem'].settings;
  const seed = seedOf(h, 'road-to-bethlehem');
  const levels = solveLevels(seed, s, 3);
  const total = levels.reduce((a, l) => a + l.ms, 0);
  const players = [['Ruth', DEV.a, 'Olive'], ['Boaz', DEV.b, 'Olive'], ['Naomi', DEV.c, 'Fig']];
  const runs = players.map(([n, d]) => h.call({ action: 'startRun', game: 'road-to-bethlehem', deviceId: d, nickname: n, seed }));
  h.wait(total + 1000);
  let expected = 0;
  levels.forEach((l) => {
    const lvl = Road.generateLevel(seed, l.level, s);
    expected += Road.levelScore(l, lvl.size, lvl.minRotations, s).total;
  });
  players.forEach(([n, d, team], i) => {
    const res = h.call({ action: 'submitRun', game: 'road-to-bethlehem', runId: runs[i].runId, deviceId: d, nickname: n, team, result: { levels: i === 2 ? levels.slice(0, 2) : levels, totalMs: total }, localScore: 999999 });
    assert.equal(res.ok, true, res.message);
    if (i < 2) assert.equal(res.score, expected, 'score computed by the server, not the client');
  });
  const board = h.call({ action: 'board', game: 'road-to-bethlehem' });
  assert.deepEqual(board.players.map((p) => [p.rank, p.nickname, p.levels]), [[1, 'Ruth', 3], [1, 'Boaz', 3], [3, 'Naomi', 2]]);
  assert.deepEqual(board.teams.map((t) => [t.name, t.score, t.members]), [['Olive', expected * 2, 2], ['Fig', board.players[2].score, 1]]);
  const r = h.call({ action: 'startRun', game: 'road-to-bethlehem', deviceId: DEV.a, nickname: 'Ruth', seed });
  h.wait(total + 1000);
  const fast = levels.map((l) => Object.assign({}, l, { ms: 50 }));
  assert.equal(h.call({ action: 'submitRun', game: 'road-to-bethlehem', runId: r.runId, deviceId: DEV.a, nickname: 'Ruth', result: { levels: fast } }).error, 'IMPLAUSIBLE');
});

test('facilitator start mode and synchronised rounds are enforced on the server', () => {
  const h = setup();
  const cfg = h.admin({ action: 'adminState' }).config;
  cfg.session.startMode = 'facilitator';
  cfg.games['gleaners-rush'].settings.syncStart = true;
  h.admin({ action: 'saveConfig', config: cfg });
  const seed = seedOf(h, 'gleaners-rush');
  assert.equal(h.call({ action: 'state' }).state.games[0].reason, 'waiting');
  assert.equal(h.call({ action: 'startRun', game: 'gleaners-rush', deviceId: DEV.a, nickname: 'Ruth', seed }).error, 'CLOSED');
  const started = h.admin({ action: 'control', game: 'gleaners-rush', op: 'start' });
  const round = started.live.games['gleaners-rush'].round;
  assert.ok(round && round.startAt > h.clock.t);
  assert.equal(h.call({ action: 'startRun', game: 'gleaners-rush', deviceId: DEV.a, nickname: 'Ruth', seed }).error, 'WAIT_ROUND');
  assert.equal(h.call({ action: 'startRun', game: 'gleaners-rush', deviceId: DEV.a, nickname: 'Ruth', roundId: round.id }).ok, true);
  assert.equal(h.call({ action: 'startRun', game: 'gleaners-rush', deviceId: DEV.a, nickname: 'Ruth', roundId: 'OLDROUND' }).error, 'NO_ROUND');
  h.admin({ action: 'control', game: 'gleaners-rush', op: 'pause' });
  assert.equal(h.call({ action: 'state' }).state.games[0].reason, 'paused');
});

test('tie-breakers: only the tied players can play, and results stay off the board', () => {
  const h = setup();
  h.admin({ action: 'control', game: 'gleaners-rush', op: 'tiebreak', args: { players: ['Ruth', 'Boaz'] } });
  const tb = h.call({ action: 'state' }).state.games[0].tiebreak;
  assert.deepEqual(tb.players, ['Ruth', 'Boaz']);
  assert.equal(h.call({ action: 'startRun', game: 'gleaners-rush', deviceId: DEV.c, nickname: 'Naomi', tiebreak: tb.id }).error, 'NOT_IN_TIEBREAK');
  const run = h.call({ action: 'startRun', game: 'gleaners-rush', deviceId: DEV.a, nickname: 'ruth', tiebreak: tb.id });
  assert.equal(run.seed, tb.seed);
  const s = Rush.tiebreakSettings(h.admin({ action: 'adminState' }).config.games['gleaners-rush'].settings);
  const result = bot(s, tb.seed);
  h.wait(result.durationMs + 100);
  const res = h.call({ action: 'submitRun', game: 'gleaners-rush', runId: run.runId, deviceId: DEV.a, nickname: 'ruth', result });
  assert.equal(res.ok, true, res.message);
  assert.equal(h.call({ action: 'board', game: 'gleaners-rush' }).total, 0);
  const rows = h.admin({ action: 'results', game: 'gleaners-rush' }).rows;
  assert.equal(rows[0].tiebreak, tb.id);
});

test('scores can be corrected by an admin, and the change is recorded', () => {
  const h = setup();
  const seed = seedOf(h, 'gleaners-rush');
  const r = h.call({ action: 'startRun', game: 'gleaners-rush', deviceId: DEV.a, nickname: 'Ruth', seed });
  h.wait(1500);
  h.call({ action: 'submitRun', game: 'gleaners-rush', runId: r.runId, deviceId: DEV.a, nickname: 'Ruth', result: { score: 0, caught: 0, golden: 0, missed: 0, hazards: 0, bestCombo: 0, durationMs: 1000, accuracy: 0 } });
  const row = h.admin({ action: 'results', game: 'gleaners-rush' }).rows[0];
  assert.equal(h.call({ action: 'adjustScore', game: 'gleaners-rush', id: row.id, score: 50 }).error, 'FORBIDDEN');
  assert.equal(h.admin({ action: 'adjustScore', game: 'gleaners-rush', id: row.id, score: -5 }).ok, false);
  assert.equal(h.admin({ action: 'adjustScore', game: 'gleaners-rush', id: row.id, score: 50 }).ok, true);
  const after = h.admin({ action: 'results', game: 'gleaners-rush' }).rows[0];
  assert.deepEqual([after.score, after.status], [50, 'adjusted']);
  assert.equal(h.gas.sheets.Results.rows[1][14], OWNER);
  assert.equal(h.call({ action: 'board', game: 'gleaners-rush' }).players[0].score, 50);
});

// ───────────── Team Showdown ─────────────

test('showdown: teams join with a code, buzz through the server, and never see answers early', () => {
  const h = setup();
  const sd0 = h.admin({ action: 'adminState' }).showdown;
  const codes = sd0.joinCodes;
  assert.equal(h.call({ action: 'showdownJoin', code: codes[1], team: 0, deviceId: DEV.a }).error, 'BAD_CODE');
  const joinA = h.call({ action: 'showdownJoin', code: codes[0], team: 0, deviceId: DEV.a });
  const joinB = h.call({ action: 'showdownJoin', code: codes[1], team: 1, deviceId: DEV.b });
  assert.deepEqual([joinA.team, joinA.name, joinB.team], [0, 'Barley', 1]);
  assert.equal(h.call({ action: 'buzz', token: 'not-a-token' }).error, 'NO_TEAM');
  assert.equal(h.call({ action: 'buzz', token: joinA.token }).error, 'NOT_NOW', 'buzzers closed in the lobby');
  assert.equal(h.call({ action: 'showdownOp', op: 'start' }).error, 'FORBIDDEN', 'hosting needs an admin');
  ['start', 'next', 'next'].forEach((op) => assert.equal(h.admin({ action: 'showdownOp', op }).ok, true, op));
  let pub = h.call({ action: 'state' }).state.showdown;
  assert.equal(pub.phase, 'question');
  assert.equal(pub.question.display, 'F _ _ T H F _ L N _ S S');
  assert.equal(pub.answer, null);
  assert.equal(JSON.stringify(h.call({ action: 'state' })).indexOf('FAITHFULNESS'), -1, 'answer not sent to phones');
  const buzz = h.call({ action: 'buzz', token: joinB.token });
  assert.equal(buzz.state.answering, 1);
  h.wait(400);
  h.call({ action: 'buzz', token: joinA.token });
  pub = h.call({ action: 'state' }).state.showdown;
  assert.deepEqual(pub.buzzes.map((b) => [b.team, b.after]), [[1, 0], [0, 400]], 'buzz order with the gap, for close calls');
  h.admin({ action: 'showdownOp', op: 'judge', args: { correct: true } });
  pub = h.call({ action: 'state' }).state.showdown;
  assert.deepEqual([pub.phase, pub.answer.text, pub.teams[1].score], ['revealed', 'FAITHFULNESS', 100]);
  const text = JSON.stringify(h.call({ action: 'state' }));
  assert.equal(text.indexOf(codes[0]), -1, 'join codes are only on the host screen');
  assert.equal(text.indexOf(joinA.token), -1, 'tokens are never echoed');
});

test('showdown: wagers from phones stay secret; wrong join codes are throttled', () => {
  const h = setup();
  const cfg = h.admin({ action: 'adminState' }).config;
  cfg.games['team-showdown'].content.rounds = [cfg.games['team-showdown'].content.rounds[3]];
  cfg.games['team-showdown'].content.rounds[0].questions = cfg.games['team-showdown'].content.rounds[0].questions.slice(0, 1);
  h.admin({ action: 'saveConfig', config: cfg });
  const codes = h.admin({ action: 'adminState' }).showdown.joinCodes;
  const a = h.call({ action: 'showdownJoin', code: codes[0], team: 0, deviceId: DEV.a });
  const b = h.call({ action: 'showdownJoin', code: codes[1], team: 1, deviceId: DEV.b });
  ['start', 'next', 'next'].forEach((op) => h.admin({ action: 'showdownOp', op }));
  h.call({ action: 'buzz', token: a.token });
  h.admin({ action: 'showdownOp', op: 'judge', args: { correct: true } });
  h.admin({ action: 'showdownOp', op: 'next' });
  assert.equal(h.call({ action: 'state' }).state.showdown.phase, 'wager');
  assert.equal(h.call({ action: 'wager', token: a.token, amount: 150 }).ok, true);
  assert.equal(h.call({ action: 'wager', token: b.token, amount: 50 }).ok, true);
  const pub = h.call({ action: 'state' }).state.showdown;
  assert.deepEqual(pub.wager.submitted, [true, true]);
  assert.equal(pub.wager.amounts, undefined);
  assert.equal(h.admin({ action: 'adminState' }).showdown.wager.amounts[0], 150);
  assert.equal(h.admin({ action: 'adminState' }).showdown.wager.amounts[1], 0, 'a team with no points can only wager 0');
  h.admin({ action: 'showdownOp', op: 'next' });
  h.call({ action: 'wager', token: a.token, answer: '86400' });
  assert.equal(h.admin({ action: 'adminState' }).showdown.wager.marks[0], true);
  for (let i = 0; i < 10; i++) h.call({ action: 'showdownJoin', code: '0000', team: 0, deviceId: DEV.c });
  assert.equal(h.call({ action: 'showdownJoin', code: codes[0], team: 0, deviceId: DEV.c }).error, 'LOCKED');
});

test('reset entire session: every leaderboard restarts and Team Showdown returns to the lobby', () => {
  const h = setup();
  ['start', 'next'].forEach((op) => h.admin({ action: 'showdownOp', op }));
  const res = h.admin({ action: 'resetSession' });
  assert.equal(res.ok, true);
  assert.equal(res.showdown.phase, 'lobby');
  Object.values(res.live.games).forEach((g) => assert.equal(g.epoch, 1));
  assert.equal(h.call({ action: 'resetSession' }).error, 'FORBIDDEN');
});
