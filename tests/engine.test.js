'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../engine.js');
const CONTENT = require('../questions.js');

const Q = CONTENT.questions;

function playAllCorrect(game, ms) {
  for (let i = 0; i < game.total; i++) {
    const r = game.answer(game.current().answer, ms);
    assert.ok(r && r.correct);
    game.next();
  }
}

test('content: 8 questions with valid, unique ids and answer keys from the brief', () => {
  assert.equal(Q.length, 8);
  assert.equal(new Set(Q.map((q) => q.id)).size, Q.length);
  // A=0, B=1, C=2, D=3 — matches the correct answers specified in the project brief.
  assert.deepEqual(Q.map((q) => q.answer), [1, 2, 1, 2, 2, 1, 1, 0]);
  Q.forEach((q) => {
    assert.equal(q.choices.length, 4, q.id);
    assert.ok(q.reference && q.explanation, q.id);
  });
  assert.match(Q[7].explanation, /theological reading/);
  assert.equal(CONTENT.reflection.passage.reference, 'Ruth 4:14–17');
  assert.deepEqual(CONTENT.reflection.passage.verses.map((v) => v.n), [14, 15, 16, 17]);
});

test('names: empty, whitespace and markup are rejected or cleaned', () => {
  assert.equal(E.validateNickname('').ok, false);
  assert.equal(E.validateNickname('    ').ok, false);
  assert.equal(E.validateNickname(null).ok, false);
  assert.equal(E.validateNickname('<>').ok, false);
  assert.deepEqual(E.validateNickname('  Ruth   the  Gleaner  '), { ok: true, value: 'Ruth the Gleaner' });
  assert.equal(E.validateNickname('<b>Boaz</b>').value, 'bBoaz/b');
  assert.equal(E.validateNickname('x'.repeat(50)).value.length, E.NAME_MAX);
  assert.equal(Array.from(E.cleanName('🌾'.repeat(30))).length, E.NAME_MAX);
});

test('teams: blanks ignored, duplicates and too many rejected', () => {
  assert.deepEqual(E.validateTeams(['Front', '', '  ', 'Back']), { ok: true, value: ['Front', 'Back'] });
  assert.equal(E.validateTeams(['', ' ']).ok, false);
  assert.equal(E.validateTeams(['Team A', 'team a']).ok, false);
  assert.equal(E.validateTeams(Array.from({ length: 9 }, (_, i) => 'T' + i)).ok, false);
});

test('session codes and timer options are normalised', () => {
  assert.equal(E.normalizeSession(' ruth 4! '), 'RUTH4');
  assert.equal(E.normalizeSession('ab'), '');
  assert.equal(E.normalizeSession('a'.repeat(30)).length, 16);
  assert.equal(E.normalizeTimer('20'), 20);
  assert.equal(E.normalizeTimer(0), 0);
  assert.equal(E.normalizeTimer(7), 15);
});

test('speed bonus: 50 at instant, 0 at the buzzer, none without a timer or for impossible times', () => {
  assert.equal(E.speedBonus(250, 15), 49);
  assert.equal(E.speedBonus(7500, 15), 25);
  assert.equal(E.speedBonus(15000, 15), 0);
  assert.equal(E.speedBonus(99999, 15), 0);
  assert.equal(E.speedBonus(100, 15), 0);
  assert.equal(E.speedBonus(NaN, 15), 0);
  assert.equal(E.speedBonus(2000, 0), 0);
});

test('individual: scoring, max score and a perfect achievement', () => {
  const game = E.createGame({ questions: Q, mode: 'individual', durationSec: 15, players: ['Naomi'] });
  playAllCorrect(game, 7500);
  assert.equal(game.phase, 'finished');
  const me = game.standings()[0];
  assert.equal(me.correct, 8);
  assert.equal(me.score, 8 * 125);
  assert.equal(E.maxScore(8, 15), 1200);
  assert.equal(E.achievementFor(me.correct, 8).title, 'Kinsman-Redeemer');
});

test('individual: a question cannot be answered twice', () => {
  const game = E.createGame({ questions: Q, mode: 'individual', durationSec: 0, players: ['Ruth'] });
  const first = game.answer(Q[0].answer, 1000);
  assert.equal(first.points, 100);
  assert.equal(game.answer(Q[0].answer, 1000), null);
  assert.equal(game.answer(0, 1000), null);
  assert.equal(game.timeout(), null);
  assert.equal(game.players()[0].score, 100);
});

test('individual: invalid choices are ignored and wrong answers score zero', () => {
  const game = E.createGame({ questions: Q, mode: 'individual', durationSec: 15, players: ['Ruth'] });
  assert.equal(game.answer(9, 1000), null);
  assert.equal(game.answer(-1, 1000), null);
  assert.equal(game.answer('1', 1000), null);
  const wrong = game.answer(0, 1000);
  assert.equal(wrong.correct, false);
  assert.equal(wrong.points, 0);
});

test('individual: timeout records no answer and next() is required to advance', () => {
  const game = E.createGame({ questions: Q, mode: 'individual', durationSec: 15, players: ['Ruth'] });
  assert.equal(game.next(), false, 'cannot skip an unanswered question');
  const r = game.timeout();
  assert.equal(r.timedOut, true);
  assert.equal(r.points, 0);
  assert.equal(game.next(), true);
  assert.equal(game.index, 1);
  assert.equal(game.answersForServer()[0].choice, -1);
});

test('restart resets score, progress and phase', () => {
  const game = E.createGame({ questions: Q, mode: 'individual', durationSec: 15, players: ['Ruth'] });
  playAllCorrect(game, 1000);
  game.restart();
  assert.equal(game.index, 0);
  assert.equal(game.phase, 'question');
  assert.equal(game.players()[0].score, 0);
  assert.ok(game.answer(Q[0].answer, 1000));
});

test('answersForServer lists every question id in order', () => {
  const game = E.createGame({ questions: Q, mode: 'individual', durationSec: 15, players: ['Ruth'] });
  game.answer(1, 3000);
  const out = game.answersForServer();
  assert.equal(out.length, Q.length);
  assert.deepEqual(out[0], { id: 'gate', choice: 1, ms: 3000 });
  assert.deepEqual(out.map((a) => a.id), Q.map((q) => q.id));
});

test('group: facilitator selects, reveals, and awards teams idempotently', () => {
  const game = E.createGame({ questions: Q, mode: 'group', durationSec: 15, players: ['Front', 'Back', 'Choir'] });
  assert.equal(game.setAward(0, true), false, 'no awards before reveal');
  assert.deepEqual(game.answer(1), { selected: 1 });
  assert.deepEqual(game.answer(2), { selected: 2 }, 'selection can change before reveal');
  const r = game.reveal();
  assert.equal(r.choice, 2);
  assert.equal(r.correct, false);
  assert.equal(game.reveal(), null, 'cannot reveal twice');
  assert.equal(game.answer(1), null, 'no answers after reveal');
  game.setAward(0, true);
  game.setAward(0, true);
  game.setAward(2, true);
  game.setAward(2, false);
  assert.deepEqual(game.players().map((p) => p.score), [100, 0, 0]);
  assert.equal(game.next(), true);
  assert.equal(game.setAward(1, true), false, 'awards close when the next question starts');
});

test('group: a single team is scored automatically from the highlighted answer', () => {
  const game = E.createGame({ questions: Q, mode: 'group', durationSec: 0, players: ['Everyone'] });
  game.answer(Q[0].answer);
  game.reveal();
  assert.equal(game.players()[0].score, 100);
  game.next();
  game.timeout(); // in group mode a timeout simply reveals
  assert.equal(game.phase, 'revealed');
  assert.equal(game.players()[0].score, 100);
});

test('group: standings sort by score and keep entry order on ties', () => {
  const game = E.createGame({ questions: Q, mode: 'group', durationSec: 0, players: ['A', 'B', 'C'] });
  game.reveal();
  game.setAward(1, true);
  game.setAward(2, true);
  assert.deepEqual(game.standings().map((t) => t.name), ['B', 'C', 'A']);
});

test('achievement thresholds', () => {
  assert.equal(E.achievementFor(8, 8).title, 'Kinsman-Redeemer');
  assert.equal(E.achievementFor(6, 8).title, 'Elder at the Gate');
  assert.equal(E.achievementFor(4, 8).title, 'Faithful Gleaner');
  assert.equal(E.achievementFor(2, 8).title, 'Traveller to Bethlehem');
  assert.equal(E.achievementFor(0, 8).title, 'New Arrival in Bethlehem');
});

// ───────────── Timer with a fake clock ─────────────

function fakeClock() {
  let t = 0;
  let nextId = 1;
  const intervals = new Map();
  return {
    now: () => t,
    schedule(fn, ms) { const id = nextId++; intervals.set(id, { fn, ms, due: t + ms }); return id; },
    cancel(id) { intervals.delete(id); },
    advance(ms) {
      const end = t + ms;
      while (true) {
        let soonest = null;
        for (const [id, iv] of intervals) if (iv.due <= end && (!soonest || iv.due < soonest[1].due)) soonest = [id, iv];
        if (!soonest) break;
        t = soonest[1].due;
        soonest[1].due += soonest[1].ms;
        soonest[1].fn();
      }
      t = end;
    },
    get active() { return intervals.size; },
  };
}

test('timer: counts down, fires once at zero and stops', () => {
  const clock = fakeClock();
  const timer = E.createTimer(clock);
  let ends = 0;
  const ticks = [];
  timer.start(15, (remaining) => ticks.push(remaining), () => ends++);
  clock.advance(5000);
  assert.equal(timer.elapsedMs(), 5000);
  clock.advance(20000);
  assert.equal(ends, 1);
  assert.equal(ticks[ticks.length - 1], 0);
  assert.equal(clock.active, 0);
  assert.equal(timer.running, false);
});

test('timer: restarting resets the countdown and drops the old callback', () => {
  const clock = fakeClock();
  const timer = E.createTimer(clock);
  let firstEnded = 0;
  let secondEnded = 0;
  timer.start(15, null, () => firstEnded++);
  clock.advance(10000);
  timer.start(15, null, () => secondEnded++);
  assert.equal(timer.elapsedMs(), 0);
  assert.equal(clock.active, 1, 'only one interval at a time');
  clock.advance(10000);
  assert.equal(firstEnded, 0);
  assert.equal(secondEnded, 0);
  clock.advance(5000);
  assert.equal(secondEnded, 1);
  assert.equal(firstEnded, 0);
});

test('timer: pause freezes time and resume continues', () => {
  const clock = fakeClock();
  const timer = E.createTimer(clock);
  let ended = 0;
  timer.start(10, null, () => ended++);
  clock.advance(4000);
  assert.equal(timer.pause(), true);
  assert.equal(timer.paused, true);
  clock.advance(60000);
  assert.equal(ended, 0);
  assert.equal(timer.elapsedMs(), 4000);
  timer.resume();
  clock.advance(5900);
  assert.equal(ended, 0);
  clock.advance(200);
  assert.equal(ended, 1);
});

test('timer: stop prevents the end callback', () => {
  const clock = fakeClock();
  const timer = E.createTimer(clock);
  let ended = 0;
  timer.start(5, null, () => ended++);
  timer.stop();
  clock.advance(10000);
  assert.equal(ended, 0);
  assert.equal(clock.active, 0);
});
