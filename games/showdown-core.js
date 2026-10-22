/*
 * Team Showdown — the game-show rules as a pure state machine.
 *
 * reduce(state, action, cfg, now) returns { state } or { error }. The facilitator's laptop
 * runs it in local mode; the Apps Script server runs the same code in shared mode, so
 * buzzers on team phones and the host screen always agree.
 *
 * Phases:
 *   lobby → rules → round-intro → question ⇄ answering → steal → revealed → … → judged (Name Five)
 *   → wager → wager-question → wager-reveal → wager-answer → finished
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ShowdownCore = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const MAX_TEAMS = 4;
  const OPEN = { question: true, steal: true };
  const SHOWS_QUESTION = { question: true, answering: true, steal: true, revealed: true, judged: true, 'wager-question': true, 'wager-reveal': true, 'wager-answer': true };
  const SHOWS_ANSWER = { revealed: true, 'wager-answer': true };

  function clone(v) {
    return JSON.parse(JSON.stringify(v));
  }

  function joinCode(rand, used) {
    let n = 1000 + Math.floor(rand() * 9000);
    while (used.indexOf(String(n)) >= 0) n = n >= 9999 ? 1000 : n + 1;
    used.push(String(n));
    return String(n);
  }

  function teamsFrom(cfg) {
    const s = cfg.settings;
    return s.teamNames.slice(0, s.teamCount).map((name) => ({ name, score: 0, streak: 0 }));
  }

  function buildPlan(cfg) {
    const plan = [];
    cfg.content.rounds.forEach((r, ri) => {
      if (!r.enabled) return;
      r.questions.forEach((q, qi) => plan.push({ r: ri, q: qi }));
    });
    return plan;
  }

  function init(cfg, now, rand) {
    const used = [];
    const codes = [];
    for (let i = 0; i < MAX_TEAMS; i++) codes.push(joinCode(rand || Math.random, used));
    return {
      v: 1,
      seq: 1,
      phase: 'lobby',
      teams: teamsFrom(cfg),
      plan: [],
      step: -1,
      round: -1,
      answering: null,
      attempted: [],
      buzzes: [],
      lockUntil: [0, 0, 0, 0],
      deadline: 0,
      remaining: 0,
      paused: false,
      stealing: false,
      lastResult: null,
      judged: null,
      wager: null,
      tiebreak: null,
      winners: [],
      joinCodes: codes,
      tokens: {},
      updatedAt: now,
    };
  }

  // ───────────── Answer checking ─────────────

  function normalizeAnswer(text) {
    return String(text == null ? '' : text)
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/°|\bdegrees?\b/g, ' ')
      .replace(/(\d),(?=\d{3}\b)/g, '$1')
      .replace(/[^a-z0-9.½ ]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/^(the|a|an) /, '')
      .replace(/\.$/, '');
  }

  function numberOf(text) {
    const t = normalizeAnswer(text).replace(/\s/g, '');
    return /^-?\d+(\.\d+)?$/.test(t) ? Number(t) : null;
  }

  /** Whether a typed answer matches the answer or one of its accepted alternatives. */
  function checkAnswer(q, text) {
    if (!q || !q.answer) return false;
    const given = normalizeAnswer(text);
    if (!given) return false;
    const options = [q.answer].concat(q.accept || []);
    return options.some((opt) => {
      const want = normalizeAnswer(opt);
      if (want === given) return true;
      const a = numberOf(opt);
      const b = numberOf(text);
      return a !== null && b !== null && a === b;
    });
  }

  // ───────────── Helpers ─────────────

  function currentRound(state, cfg) {
    return state.round >= 0 ? cfg.content.rounds[state.round] || null : null;
  }

  function currentQuestion(state, cfg) {
    if (state.tiebreak) return cfg.content.tiebreakers[state.tiebreak.index] || null;
    if (state.phase.indexOf('wager') === 0) return cfg.content.wager;
    const item = state.plan[state.step];
    if (!item) return null;
    const r = cfg.content.rounds[item.r];
    return r ? r.questions[item.q] || null : null;
  }

  function eligibleTeams(state) {
    const pool = state.tiebreak ? state.tiebreak.teams : state.teams.map((_, i) => i);
    return pool.filter((i) => state.attempted.indexOf(i) < 0);
  }

  function maxWager(state, cfg, team) {
    const t = state.teams[team];
    return Math.max(0, Math.min(cfg.settings.maxWager, t ? t.score : 0));
  }

  function computeWinners(state) {
    const top = Math.max.apply(null, state.teams.map((t) => t.score));
    return state.teams.map((t, i) => (t.score === top ? i : -1)).filter((i) => i >= 0);
  }

  function setDeadline(state, now, sec) {
    state.deadline = now + sec * 1000;
    state.remaining = 0;
    state.paused = false;
  }

  function openQuestion(state, cfg, now) {
    state.answering = null;
    state.attempted = [];
    state.buzzes = [];
    state.stealing = false;
    state.lastResult = null;
    const r = currentRound(state, cfg);
    if (r && r.type === 'judged' && !state.tiebreak) {
      const n = state.teams.length;
      const first = state.step % n;
      state.judged = { order: state.teams.map((_, i) => (first + i) % n), turn: 0, counts: state.teams.map(() => 0) };
      state.phase = 'judged';
    } else {
      state.judged = null;
      state.phase = 'question';
    }
    setDeadline(state, now, state.tiebreak ? 20 : r ? r.timeSec : 20);
  }

  function enterStep(state, cfg, now, index) {
    if (index >= state.plan.length) return enterWager(state, cfg, now);
    state.step = index;
    const item = state.plan[index];
    if (item.r !== state.round) {
      state.round = item.r;
      state.phase = 'round-intro';
      state.deadline = 0;
      state.lastResult = null;
      return;
    }
    openQuestion(state, cfg, now);
  }

  function enterWager(state, cfg, now) {
    const w = cfg.content.wager;
    if (!cfg.settings.wagerEnabled || !w || !w.prompt || !w.answer) return finish(state);
    state.phase = 'wager';
    state.round = -1;
    state.deadline = 0;
    state.lastResult = null;
    state.answering = null;
    state.wager = { amounts: state.teams.map(() => null), answers: state.teams.map(() => null), marks: state.teams.map(() => null), deltas: null };
  }

  function finish(state) {
    state.phase = 'finished';
    state.deadline = 0;
    state.answering = null;
    const decided = state.tiebreak && state.tiebreak.winner != null;
    if (!decided) state.winners = computeWinners(state);
  }

  function multiplier(state, cfg) {
    const r = currentRound(state, cfg);
    return r && r.double && !state.tiebreak ? 2 : 1;
  }

  // ───────────── Reducer ─────────────

  function reduce(stateIn, action, cfg, now, rand) {
    const state = clone(stateIn);
    const s = cfg.settings;
    const type = action && action.type;
    const team = action && Number.isInteger(action.team) ? action.team : null;
    const validTeam = team !== null && team >= 0 && team < state.teams.length;
    function fail(msg) {
      return { error: msg };
    }

    switch (type) {
      case 'start': {
        const plan = buildPlan(cfg);
        if (!plan.length) return fail('Add at least one enabled round with questions.');
        const keep = { joinCodes: state.joinCodes, tokens: state.tokens };
        Object.assign(state, init(cfg, now, rand), keep);
        state.plan = plan;
        state.phase = 'rules';
        break;
      }
      case 'syncTeams':
        if (state.phase !== 'lobby') return fail('Teams can only change before the game starts.');
        state.teams = teamsFrom(cfg);
        break;
      case 'next':
        if (state.paused) return fail('Resume the game first.');
        if (state.phase === 'rules') enterStep(state, cfg, now, 0);
        else if (state.phase === 'round-intro') openQuestion(state, cfg, now);
        else if (state.phase === 'revealed') {
          if (state.tiebreak) {
            if (state.tiebreak.index + 1 >= cfg.content.tiebreakers.length) return fail('No tie-breaker questions left. Add more in the admin settings, or declare a joint win.');
            state.tiebreak.index += 1;
            openQuestion(state, cfg, now);
          } else enterStep(state, cfg, now, state.step + 1);
        } else if (state.phase === 'wager') {
          state.wager.amounts = state.wager.amounts.map((a) => (a == null ? 0 : a));
          state.phase = 'wager-question';
          setDeadline(state, now, s.wagerSec);
        } else if (state.phase === 'wager-question') {
          state.phase = 'wager-reveal';
          state.deadline = 0;
        } else if (state.phase === 'wager-reveal') {
          if (state.wager.marks.some((m) => m === null)) return fail('Mark every team’s answer as right or wrong first.');
          state.wager.deltas = state.teams.map((t, i) => (state.wager.marks[i] ? 1 : -1) * (state.wager.amounts[i] || 0));
          state.teams.forEach((t, i) => { t.score += state.wager.deltas[i]; });
          state.phase = 'wager-answer';
        } else if (state.phase === 'wager-answer') finish(state);
        else if (state.phase === 'judged') return fail('Finish each team’s turn first.');
        else return fail('Nothing to move on to yet.');
        break;
      case 'buzz': {
        if (!validTeam) return fail('Unknown team.');
        if (state.paused) return fail('The game is paused.');
        if (state.tiebreak && state.tiebreak.teams.indexOf(team) < 0) return fail('Only the tied teams can buzz.');
        if (state.phase === 'round-intro' || state.phase === 'revealed' || state.phase === 'rules') {
          // An early buzz is a false start: short lockout, no points lost.
          state.lockUntil[team] = now + s.lockoutSec * 1000;
          break;
        }
        if (state.phase === 'answering') {
          // Later buzzes are shown to the facilitator (for close calls) but don't take over.
          const counts = now >= state.lockUntil[team] && state.attempted.indexOf(team) < 0;
          if (counts && !state.buzzes.some((b) => b.team === team)) state.buzzes.push({ team, at: now });
          break;
        }
        if (!OPEN[state.phase]) return fail('Buzzers are closed.');
        if (state.attempted.indexOf(team) >= 0) return fail('Your team has already answered this one.');
        if (now < state.lockUntil[team]) return fail('Locked out for a moment.');
        state.buzzes.push({ team, at: now });
        state.answering = team;
        state.phase = 'answering';
        setDeadline(state, now, s.answerSec);
        break;
      }
      case 'override':
        if (!validTeam) return fail('Unknown team.');
        if (state.phase !== 'answering' && !OPEN[state.phase]) return fail('No question is open.');
        if (state.attempted.indexOf(team) >= 0) return fail('That team has already answered.');
        state.answering = team;
        if (!state.buzzes.some((b) => b.team === team)) state.buzzes.push({ team, at: now });
        state.phase = 'answering';
        setDeadline(state, now, s.answerSec);
        break;
      case 'judge': {
        if (state.phase !== 'answering' || state.answering === null) return fail('No team is answering.');
        const t = state.answering;
        const mult = multiplier(state, cfg);
        const r = currentRound(state, cfg);
        const base = (state.tiebreak ? 0 : (r ? r.points : 100)) * mult;
        if (action.correct) {
          if (state.tiebreak) {
            state.tiebreak.winner = t;
            state.winners = [t];
            state.lastResult = { team: t, correct: true, delta: 0 };
            state.phase = 'finished';
            state.deadline = 0;
            state.answering = null;
            break;
          }
          const pts = state.stealing ? Math.round((base * s.stealPct) / 100) : base;
          state.teams.forEach((x, i) => { if (i !== t) x.streak = 0; });
          state.teams[t].streak += 1;
          const bonus = state.teams[t].streak >= s.streakLength ? s.streakBonus : 0;
          state.teams[t].score += pts + bonus;
          state.lastResult = { team: t, correct: true, delta: pts + bonus, bonus, steal: state.stealing };
          state.phase = 'revealed';
          state.deadline = 0;
          state.answering = null;
        } else {
          const penalty = state.tiebreak ? 0 : s.wrongPenalty * mult;
          state.teams[t].score -= penalty;
          state.teams[t].streak = 0;
          state.attempted.push(t);
          state.lockUntil[t] = now + s.lockoutSec * 1000;
          state.lastResult = { team: t, correct: false, delta: -penalty, steal: state.stealing };
          state.answering = null;
          if (eligibleTeams(state).length) {
            state.phase = 'steal';
            state.stealing = true;
            setDeadline(state, now, s.stealSec);
          } else {
            state.phase = 'revealed';
            state.deadline = 0;
          }
        }
        break;
      }
      case 'timeout':
      case 'reveal':
        if (!(OPEN[state.phase] || state.phase === 'answering')) return fail('No question is open.');
        if (type === 'timeout' && state.phase !== 'answering' && now < state.deadline - 500 && !state.paused) return fail('Time isn’t up yet.');
        state.phase = 'revealed';
        state.deadline = 0;
        state.answering = null;
        break;
      case 'judgedMark': {
        if (state.phase !== 'judged') return fail('Not a Name Five question.');
        const j = state.judged;
        const who = j.order[j.turn];
        const delta = action.delta === -1 ? -1 : 1;
        j.counts[who] = Math.max(0, Math.min(5, j.counts[who] + delta));
        break;
      }
      case 'judgedNext': {
        if (state.phase !== 'judged') return fail('Not a Name Five question.');
        const j = state.judged;
        j.turn += 1;
        if (j.turn < j.order.length) {
          setDeadline(state, now, currentRound(state, cfg).timeSec);
          break;
        }
        const r = currentRound(state, cfg);
        const mult = multiplier(state, cfg);
        const deltas = j.counts.map((c) => (c * r.points + (c >= 5 ? r.bonus : 0)) * mult);
        state.teams.forEach((t, i) => { t.score += deltas[i]; });
        state.lastResult = { judged: true, deltas };
        state.phase = 'revealed';
        state.deadline = 0;
        break;
      }
      case 'setWager': {
        if (!validTeam) return fail('Unknown team.');
        if (state.phase !== 'wager') return fail('Wagers are closed.');
        const amount = Math.round(Number(action.amount));
        if (!isFinite(amount) || amount < 0) return fail('Enter a wager of 0 or more.');
        state.wager.amounts[team] = Math.min(amount, maxWager(state, cfg, team));
        break;
      }
      case 'wagerAnswer': {
        if (!validTeam) return fail('Unknown team.');
        if (state.phase !== 'wager-question') return fail('Answers are closed.');
        const text = String(action.text == null ? '' : action.text).replace(/[\u0000-\u001F<>]/g, '').slice(0, 80);
        state.wager.answers[team] = text;
        state.wager.marks[team] = checkAnswer(cfg.content.wager, text);
        break;
      }
      case 'wagerMark':
        if (!validTeam) return fail('Unknown team.');
        if (state.phase !== 'wager-question' && state.phase !== 'wager-reveal') return fail('Marking is closed.');
        state.wager.marks[team] = !!action.correct;
        break;
      case 'pause':
        if (state.paused) return fail('Already paused.');
        state.paused = true;
        state.remaining = state.deadline ? Math.max(0, state.deadline - now) : 0;
        break;
      case 'resume':
        if (!state.paused) return fail('Not paused.');
        state.paused = false;
        if (state.deadline) state.deadline = now + state.remaining;
        state.remaining = 0;
        break;
      case 'adjust': {
        if (!validTeam) return fail('Unknown team.');
        const delta = Math.round(Number(action.delta));
        if (!isFinite(delta) || Math.abs(delta) > 10000) return fail('Invalid adjustment.');
        state.teams[team].score += delta;
        if (state.phase === 'finished' && !state.tiebreak) state.winners = computeWinners(state);
        break;
      }
      case 'setScore': {
        if (!validTeam) return fail('Unknown team.');
        const score = Math.round(Number(action.score));
        if (!isFinite(score) || Math.abs(score) > 1000000) return fail('Invalid score.');
        state.teams[team].score = score;
        if (state.phase === 'finished' && !state.tiebreak) state.winners = computeWinners(state);
        break;
      }
      case 'end':
        finish(state);
        break;
      case 'tiebreak': {
        if (state.phase !== 'finished') return fail('Finish the game first.');
        const tied = computeWinners(state);
        if (tied.length < 2) return fail('There is no tie to break.');
        if (!cfg.content.tiebreakers.length) return fail('Add a tie-breaker question in the admin settings.');
        state.tiebreak = { teams: tied, index: 0, winner: null };
        state.winners = [];
        state.round = -1;
        state.plan = state.plan || [];
        openQuestion(state, cfg, now);
        break;
      }
      case 'reset': {
        const keep = { joinCodes: state.joinCodes, tokens: state.tokens };
        Object.assign(state, init(cfg, now, rand), keep);
        break;
      }
      default:
        return fail('Unknown action.');
    }
    state.seq = (stateIn.seq || 0) + 1;
    state.updatedAt = now;
    return { state };
  }

  // ───────────── Views ─────────────

  /**
   * What team phones and the participant hub may see. Answers stay hidden until revealed;
   * wagers stay secret until the reveal. `host: true` adds everything the facilitator needs.
   */
  function publicView(state, cfg, now, host) {
    if (!state || !cfg) return null;
    const r = currentRound(state, cfg);
    const q = currentQuestion(state, cfg);
    const rounds = cfg.content.rounds;
    const item = state.plan[state.step];
    const view = {
      seq: state.seq,
      phase: state.phase,
      paused: state.paused,
      teams: (state.phase === 'lobby' ? teamsFrom(cfg) : state.teams).map((t, i) => ({
        name: t.name,
        score: t.score,
        streak: t.streak,
        lockMs: Math.max(0, (state.lockUntil[i] || 0) - now),
      })),
      round: r ? { title: r.title, intro: r.intro, type: r.type, double: !!r.double, points: r.points, bonus: r.bonus || 0, timeSec: r.timeSec } : null,
      roundNumber: r ? rounds.filter((x, i) => x.enabled && x.questions.length && i <= state.round).length : 0,
      roundCount: rounds.filter((x) => x.enabled && x.questions.length).length,
      question: null,
      answer: null,
      timeLeft: state.deadline ? (state.paused ? state.remaining : Math.max(0, state.deadline - now)) : null,
      answering: state.answering,
      attempted: state.attempted.slice(),
      stealing: state.stealing,
      buzzes: state.buzzes.map((b) => ({ team: b.team, after: b.at - (state.buzzes[0] ? state.buzzes[0].at : b.at) })),
      lastResult: state.lastResult,
      judged: state.judged ? { turnTeam: state.judged.order[state.judged.turn] == null ? null : state.judged.order[state.judged.turn], turn: state.judged.turn, order: state.judged.order, counts: state.judged.counts } : null,
      wager: null,
      winners: state.winners.slice(),
      tiebreak: state.tiebreak ? { teams: state.tiebreak.teams.slice() } : null,
      settings: {
        stealPct: cfg.settings.stealPct,
        wrongPenalty: cfg.settings.wrongPenalty,
        streakLength: cfg.settings.streakLength,
        streakBonus: cfg.settings.streakBonus,
        lockoutSec: cfg.settings.lockoutSec,
        maxWager: cfg.settings.maxWager,
        wagerEnabled: cfg.settings.wagerEnabled,
      },
    };
    if (q && (SHOWS_QUESTION[state.phase] || (state.phase === 'finished' && state.tiebreak && state.lastResult))) {
      view.question = {
        prompt: q.prompt,
        display: q.display || '',
        number: state.tiebreak ? state.tiebreak.index + 1 : item && r ? item.q + 1 : 1,
        total: state.tiebreak ? cfg.content.tiebreakers.length : r ? r.questions.length : 1,
      };
    }
    if (q && q.answer && (SHOWS_ANSWER[state.phase] || (state.phase === 'finished' && state.tiebreak))) view.answer = { text: q.answer, note: q.note || '' };
    if (state.wager) {
      const w = state.wager;
      if (state.phase === 'wager') view.wager = { submitted: w.amounts.map((a) => a !== null), max: state.teams.map((_, i) => maxWager(state, cfg, i)) };
      else if (state.phase === 'wager-question') view.wager = { answered: w.answers.map((a) => a !== null) };
      else view.wager = { amounts: w.amounts, answers: w.answers, marks: state.phase === 'wager-reveal' && !host ? null : w.marks, deltas: w.deltas };
    }
    if (host) {
      view.host = {
        answer: q && q.answer ? { text: q.answer, accept: q.accept || [], note: q.note || '' } : null,
        joinCodes: state.joinCodes.slice(0, view.teams.length),
        wager: state.wager ? clone(state.wager) : null,
        maxWager: state.teams.map((_, i) => maxWager(state, cfg, i)),
        step: state.step,
        planLength: state.plan.length,
        tiebreakersLeft: state.tiebreak ? cfg.content.tiebreakers.length - state.tiebreak.index - 1 : cfg.content.tiebreakers.length,
        devices: Object.keys(state.tokens || {}).length,
      };
    }
    return view;
  }

  return { MAX_TEAMS, init, reduce, publicView, checkAnswer, normalizeAnswer, currentQuestion };
});
