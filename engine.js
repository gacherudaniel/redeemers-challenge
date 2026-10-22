/*
 * The Redeemer's Challenge — game rules (no DOM code here, so it can be tested in Node).
 *
 * Scoring: 100 points per correct answer, plus a speed bonus of up to 50 points
 * when the timer is on. The Apps Script back end (Code.gs) uses the same rules,
 * so keep the two in step if you change them.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.RedeemerEngine = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const POINTS_PER_CORRECT = 100;
  const MAX_SPEED_BONUS = 50;
  const MIN_HUMAN_MS = 250; // faster than this earns no speed bonus
  const NAME_MAX = 20;
  const MAX_TEAMS = 8;
  const TIMER_OPTIONS = [0, 10, 15, 20, 30];

  // ───────────── Input cleaning ─────────────

  function cleanName(raw) {
    if (typeof raw !== 'string') return '';
    const tidy = raw
      .normalize('NFC')
      .replace(/[\u0000-\u001F\u007F-\u009F<>]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    return Array.from(tidy).slice(0, NAME_MAX).join('').trim();
  }

  function validateNickname(raw) {
    const value = cleanName(raw);
    if (!value) return { ok: false, error: 'Please enter a nickname (up to ' + NAME_MAX + ' characters).' };
    return { ok: true, value };
  }

  function validateTeams(list) {
    const names = (Array.isArray(list) ? list : []).map(cleanName).filter(Boolean);
    if (!names.length) return { ok: false, error: 'Add at least one team name.' };
    if (names.length > MAX_TEAMS) return { ok: false, error: 'Please use no more than ' + MAX_TEAMS + ' teams.' };
    const seen = new Set();
    for (const name of names) {
      const key = name.toLowerCase();
      if (seen.has(key)) return { ok: false, error: 'Two teams are called “' + name + '”. Please give each team a different name.' };
      seen.add(key);
    }
    return { ok: true, value: names };
  }

  /** Session codes are 3–16 characters: letters, numbers and dashes. Returns '' if invalid. */
  function normalizeSession(raw) {
    const code = String(raw == null ? '' : raw).toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 16);
    return code.length >= 3 ? code : '';
  }

  function normalizeTimer(raw) {
    const n = Number(raw);
    return TIMER_OPTIONS.indexOf(n) >= 0 ? n : 15;
  }

  // ───────────── Scoring ─────────────

  function speedBonus(elapsedMs, durationSec) {
    if (!durationSec) return 0;
    const ms = Number(elapsedMs);
    if (!Number.isFinite(ms) || ms < MIN_HUMAN_MS) return 0;
    const total = durationSec * 1000;
    if (ms >= total) return 0;
    return Math.round((MAX_SPEED_BONUS * (total - ms)) / total);
  }

  function maxScore(questionCount, durationSec) {
    return questionCount * (POINTS_PER_CORRECT + (durationSec ? MAX_SPEED_BONUS : 0));
  }

  const ACHIEVEMENTS = [
    { min: 1, title: 'Kinsman-Redeemer', blurb: 'A perfect score. Like Boaz, you saw the matter through to the end.' },
    { min: 0.75, title: 'Elder at the Gate', blurb: 'You know this story well enough to witness the transaction.' },
    { min: 0.5, title: 'Faithful Gleaner', blurb: 'Like Ruth in the fields, you gathered plenty. Keep gleaning!' },
    { min: 0.25, title: 'Traveller to Bethlehem', blurb: 'You are on the road. The teaching will fill in the rest.' },
    { min: 0, title: 'New Arrival in Bethlehem', blurb: 'Ruth arrived as a newcomer too, and look how her story ended. Welcome!' },
  ];

  function achievementFor(correct, total) {
    const ratio = total > 0 ? correct / total : 0;
    return ACHIEVEMENTS.find((a) => ratio >= a.min);
  }

  // ───────────── Game state ─────────────

  /**
   * Individual mode: one player answers each question once; the answer is revealed immediately.
   * Group mode: the facilitator may highlight the room's answer, then reveals it and marks
   * which teams were right. With a single team, the highlighted answer is scored automatically.
   */
  function createGame(opts) {
    const questions = opts && opts.questions;
    if (!Array.isArray(questions) || !questions.length) throw new Error('createGame needs questions.');
    const mode = opts.mode === 'group' ? 'group' : 'individual';
    const durationSec = Number(opts.durationSec) || 0;
    const names = (opts.players || []).slice();
    if (!names.length) throw new Error('createGame needs at least one player or team.');

    let state;

    function reset() {
      state = {
        index: 0,
        phase: 'question', // question → revealed → (next question | finished)
        selected: null, // group mode: answer highlighted before reveal
        players: names.map((name) => ({ name, score: 0, correct: 0 })),
        responses: [],
      };
    }

    function current() {
      return questions[state.index];
    }

    function isValidChoice(choice) {
      return Number.isInteger(choice) && choice >= 0 && choice < current().choices.length;
    }

    function answer(choice, elapsedMs) {
      if (state.phase !== 'question' || !isValidChoice(choice)) return null;
      if (mode === 'group') {
        state.selected = choice;
        return { selected: choice };
      }
      const q = current();
      const correct = choice === q.answer;
      const points = correct ? POINTS_PER_CORRECT + speedBonus(elapsedMs, durationSec) : 0;
      const response = { id: q.id, choice, elapsedMs: Math.round(Number(elapsedMs) || 0), correct, points, timedOut: false };
      state.responses[state.index] = response;
      state.players[0].score += points;
      if (correct) state.players[0].correct += 1;
      state.phase = 'revealed';
      return response;
    }

    function timeout() {
      if (state.phase !== 'question') return null;
      if (mode === 'group') return reveal();
      const q = current();
      const response = { id: q.id, choice: -1, elapsedMs: durationSec * 1000, correct: false, points: 0, timedOut: true };
      state.responses[state.index] = response;
      state.phase = 'revealed';
      return response;
    }

    function reveal() {
      if (mode !== 'group' || state.phase !== 'question') return null;
      const q = current();
      const choice = state.selected === null ? -1 : state.selected;
      const response = { id: q.id, choice, correct: choice === q.answer, awarded: [] };
      state.responses[state.index] = response;
      state.phase = 'revealed';
      if (state.players.length === 1 && response.correct) setAward(0, true);
      return response;
    }

    /** Group mode only: mark whether a team answered the revealed question correctly. */
    function setAward(teamIndex, isCorrect) {
      if (mode !== 'group' || state.phase !== 'revealed') return false;
      const team = state.players[teamIndex];
      if (!team) return false;
      const awarded = state.responses[state.index].awarded;
      const has = awarded.indexOf(teamIndex) >= 0;
      if (isCorrect && !has) {
        awarded.push(teamIndex);
        team.score += POINTS_PER_CORRECT;
        team.correct += 1;
      } else if (!isCorrect && has) {
        awarded.splice(awarded.indexOf(teamIndex), 1);
        team.score -= POINTS_PER_CORRECT;
        team.correct -= 1;
      }
      return true;
    }

    /** Returns true if another question is ready, false when the game has finished. */
    function next() {
      if (state.phase !== 'revealed') return false;
      if (state.index + 1 >= questions.length) {
        state.phase = 'finished';
        return false;
      }
      state.index += 1;
      state.phase = 'question';
      state.selected = null;
      return true;
    }

    function standings() {
      return state.players
        .map((p, i) => ({ name: p.name, score: p.score, correct: p.correct, order: i }))
        .sort((a, b) => b.score - a.score || a.order - b.order);
    }

    /** The answers in the shape the Apps Script back end grades. */
    function answersForServer() {
      return questions.map((q, i) => {
        const r = state.responses[i];
        return { id: q.id, choice: r ? r.choice : -1, ms: r ? r.elapsedMs : durationSec * 1000 };
      });
    }

    reset();

    return {
      mode,
      durationSec,
      total: questions.length,
      get index() { return state.index; },
      get phase() { return state.phase; },
      get selected() { return state.selected; },
      current,
      response: () => state.responses[state.index] || null,
      players: () => state.players.map((p) => Object.assign({}, p)),
      answer,
      timeout,
      reveal,
      setAward,
      next,
      standings,
      answersForServer,
      restart: reset,
    };
  }

  // ───────────── Countdown timer ─────────────

  /**
   * A pausable countdown. `env` lets tests supply a fake clock:
   *   { now(): ms, schedule(fn, ms): handle, cancel(handle) }
   */
  function createTimer(env) {
    const now = env.now;
    let durationMs = 0;
    let deadline = 0;
    let remaining = 0;
    let handle = null;
    let paused = false;
    let onTick = null;
    let onEnd = null;

    function halt() {
      if (handle !== null) env.cancel(handle);
      handle = null;
    }

    function loop() {
      remaining = Math.max(0, deadline - now());
      if (onTick) onTick(remaining, durationMs);
      if (remaining <= 0) {
        halt();
        const done = onEnd;
        onTick = onEnd = null;
        if (done) done();
      }
    }

    return {
      start(seconds, tick, end) {
        halt();
        paused = false;
        durationMs = seconds * 1000;
        remaining = durationMs;
        deadline = now() + durationMs;
        onTick = tick || null;
        onEnd = end || null;
        if (onTick) onTick(remaining, durationMs);
        handle = env.schedule(loop, 100);
      },
      pause() {
        if (handle === null) return false;
        remaining = Math.max(0, deadline - now());
        halt();
        paused = true;
        return true;
      },
      resume() {
        if (!paused) return false;
        paused = false;
        deadline = now() + remaining;
        handle = env.schedule(loop, 100);
        return true;
      },
      stop() {
        halt();
        paused = false;
        onTick = onEnd = null;
      },
      elapsedMs() {
        const left = handle !== null ? Math.max(0, deadline - now()) : remaining;
        return durationMs - left;
      },
      get running() { return handle !== null; },
      get paused() { return paused; },
    };
  }

  return {
    POINTS_PER_CORRECT,
    MAX_SPEED_BONUS,
    NAME_MAX,
    MAX_TEAMS,
    TIMER_OPTIONS,
    cleanName,
    validateNickname,
    validateTeams,
    normalizeSession,
    normalizeTimer,
    speedBonus,
    maxScore,
    achievementFor,
    createGame,
    createTimer,
  };
});
