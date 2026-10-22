'use strict';

// The Redeemer's Challenge shared leaderboard: runs the real apps-script/*.gs in Node.

const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../engine.js');
const CONTENT = require('../questions.js');
const { createGas } = require('../dev/fake-gas');

const load = (opts) => createGas(Object.assign({ quiet: true }, opts));

const DEVICE = 'device-aaaaaaaaaaaaaaaa';
let attemptCounter = 0;
function attempt() {
  attemptCounter += 1;
  return 'attempt-' + String(attemptCounter).padStart(16, '0');
}

function answers(choiceFor, ms) {
  return CONTENT.questions.map((q) => ({ id: q.id, choice: choiceFor(q), ms: ms == null ? 5000 : ms }));
}

function submit(gas, overrides) {
  return gas.call(Object.assign({
    action: 'submitScore',
    session: 'RUTH4',
    nickname: 'Naomi',
    deviceId: DEVICE,
    attemptId: attempt(),
    timerSec: 15,
    answers: answers((q) => q.answer),
  }, overrides));
}

test('answer key in Content.gs matches questions.js', () => {
  const gas = load();
  assert.deepEqual(
    JSON.parse(JSON.stringify(gas.QUESTION_KEY)),
    CONTENT.questions.map((q) => ({ id: q.id, answer: q.answer, choices: q.choices.length }))
  );
  assert.deepEqual(JSON.parse(JSON.stringify(gas.REDEEMER_CONTENT)), JSON.parse(JSON.stringify(CONTENT)));
});

test('server and client speed bonus agree', () => {
  const gas = load();
  for (const sec of E.TIMER_OPTIONS) {
    for (const ms of [-5, 0, 100, 249, 250, 1234, 5000, 9999, 14999, 15000, 40000, NaN]) {
      assert.equal(gas.speedBonus_(ms, sec), E.speedBonus(ms, sec), sec + 's / ' + ms + 'ms');
    }
  }
});

test('ping reports the leaderboard and hub support', () => {
  const p = load().call({ action: 'ping' });
  assert.equal(p.leaderboard, true);
  assert.equal(p.hub, true);
  assert.equal(load({ unbound: true }).call({ action: 'ping' }).leaderboard, false);
  assert.equal(load().call({ action: 'nope' }).ok, false);
});

test('submit: server grades the answers itself and returns rank', () => {
  const gas = load();
  const res = submit(gas, { score: 999999 }); // a client-sent score is ignored
  assert.equal(res.ok, true);
  assert.equal(res.correct, 8);
  assert.equal(res.score, 8 * (100 + E.speedBonus(5000, 15)));
  assert.equal(res.rank, 1);
  assert.equal(res.leaderboard[0].you, true);
  assert.equal(res.leaderboard[0].nickname, 'Naomi');
  assert.equal(JSON.stringify(res).indexOf(DEVICE), -1, 'device ids never leave the server');
  assert.equal(gas.sheets.Scores.rows[1][7], 'BCBCCBBA');
});

test('submit: identical attempt is not recorded twice', () => {
  const gas = load();
  const id = attempt();
  const first = submit(gas, { attemptId: id });
  const again = submit(gas, { attemptId: id, answers: answers(() => 0) });
  assert.equal(again.ok, true);
  assert.equal(again.duplicate, true);
  assert.equal(again.score, first.score);
  assert.equal(gas.sheets.Scores.rows.length, 2, 'header + one row');
});

test('submit: rejects malformed input', () => {
  const gas = load();
  const bad = [
    { session: 'x' },
    { nickname: '   ' },
    { nickname: 42 },
    { deviceId: 'short' },
    { attemptId: '../../etc' },
    { timerSec: 12 },
    { answers: 'all correct' },
    { answers: answers((q) => q.answer).slice(1) },
    { answers: answers((q) => q.answer).map((a, i) => (i === 1 ? Object.assign({}, a, { id: 'gate' }) : a)) },
    { answers: answers((q) => q.answer).map((a, i) => (i === 0 ? Object.assign({}, a, { id: 'bogus' }) : a)) },
    { answers: answers(() => 4) },
    { answers: answers(() => 1.5) },
  ];
  for (const overrides of bad) {
    const res = submit(gas, overrides);
    assert.equal(res.ok, false, JSON.stringify(overrides).slice(0, 80));
  }
  assert.equal(gas.sheets.Scores, undefined, 'nothing was written');
});

test('submit: limits plays per device and neutralises formula nicknames', () => {
  const gas = load();
  for (let i = 0; i < gas.MAX_ATTEMPTS_PER_DEVICE; i++) assert.equal(submit(gas).ok, true);
  const blocked = submit(gas);
  assert.equal(blocked.ok, false);
  assert.equal(blocked.error, 'TOO_MANY_ATTEMPTS');
  const other = submit(gas, { deviceId: 'device-bbbbbbbbbbbbbbbb', nickname: '=HYPERLINK("x")' });
  assert.equal(other.ok, true);
  const last = gas.sheets.Scores.rows[gas.sheets.Scores.rows.length - 1];
  assert.equal(last[2], '\'=HYPERLINK("x")');
});

test('submit: fails cleanly when the lock is busy or no Sheet is bound', () => {
  assert.equal(submit(load({ busy: true })).error, 'BUSY');
  assert.equal(submit(load({ unbound: true })).error, 'NO_LEADERBOARD');
});

test('leaderboard: best score per player, competition ranking, sessions kept apart', () => {
  const gas = load();
  submit(gas, { nickname: 'Ruth', deviceId: 'device-rrrrrrrrrrrrrrrr', answers: answers(() => 0) }); // 1 correct
  submit(gas, { nickname: 'Ruth', deviceId: 'device-rrrrrrrrrrrrrrrr', answers: answers((q) => q.answer) }); // better retry
  submit(gas, { nickname: 'Boaz', deviceId: 'device-bbbbbbbbbbbbbbbb', answers: answers((q) => q.answer) });
  submit(gas, { nickname: 'Orpah', deviceId: 'device-oooooooooooooooo', session: 'OTHER', answers: answers((q) => q.answer) });

  const res = gas.call({ action: 'leaderboard', session: 'ruth4', deviceId: 'device-bbbbbbbbbbbbbbbb' });
  assert.equal(res.ok, true);
  assert.equal(res.players, 2);
  assert.deepEqual(res.leaderboard.map((r) => [r.rank, r.nickname, r.you]), [[1, 'Ruth', false], [1, 'Boaz', true]]);

  // Cached copy is invalidated by a new submission.
  submit(gas, { nickname: 'Obed', deviceId: 'device-cccccccccccccccc', answers: answers(() => -1) });
  const after = gas.call({ action: 'leaderboard', session: 'RUTH4' });
  assert.equal(after.players, 3);
  assert.equal(after.leaderboard[2].rank, 3);
  assert.equal(after.leaderboard[2].score, 0);
});

test('hub controls: hidden quiz refuses scores; a reset clears its leaderboard', () => {
  const gas = load();
  submit(gas, { nickname: 'Ruth', deviceId: 'device-rrrrrrrrrrrrrrrr' });
  gas.setActiveUser('owner@example.com');
  gas.clock.now = (() => { const t = Date.now() + 5000; return () => t; })();
  assert.equal(gas.call({ action: 'control', game: 'redeemers-challenge', op: 'reset' }).ok, true);
  assert.equal(gas.call({ action: 'leaderboard', session: 'RUTH4' }).players, 0, 'scores before the reset no longer count');
  gas.call({ action: 'control', game: 'redeemers-challenge', op: 'hide' });
  gas.setActiveUser('');
  const res = submit(gas, { nickname: 'Boaz', deviceId: 'device-bbbbbbbbbbbbbbbb' });
  assert.equal(res.error, 'CLOSED');
});

test('doPost parses text/plain JSON and returns JSON', () => {
  const gas = load();
  const out = gas.doPost({ postData: { contents: JSON.stringify({ action: 'ping' }) } });
  assert.equal(JSON.parse(out.text).ok, true);
  const bad = gas.doPost({ postData: { contents: '{nope' } });
  assert.equal(JSON.parse(bad.text).error, 'BAD_REQUEST');
});

test('doGet serves the hub or the admin page and passes only clean parameters', () => {
  const gas = load();
  const page = gas.doGet({ parameter: { session: 'ruth<script>', mode: 'evil', game: '../x', preview: 'yes' } });
  assert.equal(page.template.name, 'Index');
  assert.equal(page.template.session, 'RUTHSCRIPT');
  assert.equal(page.template.mode, '');
  assert.equal(page.template.game, '');
  assert.equal(page.template.preview, '');
  assert.equal(page.template.appUrl, 'https://script.google.com/macros/s/TEST/exec');
  const game = gas.doGet({ parameter: { game: 'road-to-bethlehem', preview: '1' } });
  assert.equal(game.template.game, 'road-to-bethlehem');
  assert.equal(game.template.preview, '1');
  assert.equal(gas.doGet({ parameter: { page: 'admin' } }).template.name, 'Admin');
  assert.throws(() => gas.include('Code'));
  assert.doesNotThrow(() => gas.include('Client'));
});
