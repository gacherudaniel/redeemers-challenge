/*
 * The session configuration model: defaults, the settings schema (which also builds the
 * admin forms), and normalizeConfig(), which cleans any configuration before it is used.
 * The Apps Script server runs the same normalizeConfig(), so bad values are rejected or
 * clamped on the server too.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('../games/showdown-questions.js'));
  else root.HubDefaults = factory(root.HubShowdownBank);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (Bank) {
  'use strict';

  const GAME_IDS = ['gleaners-rush', 'redeemers-challenge', 'road-to-bethlehem', 'team-showdown'];

  // ───────────── Settings schema (drives validation and the admin forms) ─────────────
  // type: number | bool | select | text | textarea | list

  const SCHEMA = {
    'gleaners-rush': [
      { key: 'roundSec', label: 'Round length (seconds)', type: 'number', min: 15, max: 180, step: 5, def: 60 },
      { key: 'lives', label: 'Lives', type: 'number', min: 1, max: 9, step: 1, def: 3 },
      { key: 'startSpeed', label: 'Starting fall speed', type: 'number', min: 0.5, max: 2, step: 0.1, def: 1, help: '1 = normal. Higher is faster from the start.' },
      { key: 'ramp', label: 'Difficulty ramp', type: 'number', min: 0, max: 3, step: 0.1, def: 1, help: 'How quickly speed, spawn rate and hazards increase. 0 = no ramp.' },
      { key: 'spawnRate', label: 'Items per second (at the start)', type: 'number', min: 0.5, max: 4, step: 0.1, def: 1.3 },
      { key: 'hazardRatio', label: 'Hazard ratio', type: 'number', min: 0, max: 0.6, step: 0.05, def: 0.2, help: 'Share of falling items that are stones or thorns at the start.' },
      { key: 'goldenFreq', label: 'Golden sheaf frequency', type: 'number', min: 0, max: 0.3, step: 0.01, def: 0.06 },
      { key: 'powerWide', label: 'Power-up: Wide Basket', type: 'bool', def: true },
      { key: 'powerSlow', label: 'Power-up: Slow Wind', type: 'bool', def: true },
      { key: 'powerShield', label: 'Power-up: Shield', type: 'bool', def: true },
      { key: 'attempts', label: 'Attempts allowed per player', type: 'number', min: 1, max: 50, step: 1, def: 5 },
      { key: 'syncStart', label: 'Facilitator Showdown', type: 'bool', def: false, help: 'When on, pressing Start launches one synchronised round that everyone plays at the same moment.' },
    ],
    'redeemers-challenge': [],
    'road-to-bethlehem': [
      { key: 'timerMode', label: 'Timer', type: 'select', options: [['total', 'One clock for the whole round'], ['perLevel', 'A clock for each level']], def: 'total' },
      { key: 'totalSec', label: 'Round length (seconds)', type: 'number', min: 30, max: 900, step: 10, def: 180 },
      { key: 'perLevelSec', label: 'Time per level (seconds)', type: 'number', min: 10, max: 300, step: 5, def: 45 },
      { key: 'startSize', label: 'Starting grid size', type: 'number', min: 3, max: 6, step: 1, def: 4 },
      { key: 'maxSize', label: 'Largest grid size', type: 'number', min: 4, max: 8, step: 1, def: 7 },
      { key: 'levelsPerRound', label: 'Levels per round', type: 'number', min: 1, max: 40, step: 1, def: 15 },
      { key: 'decoyDensity', label: 'Decoy density', type: 'number', min: 0, max: 1, step: 0.1, def: 0.5, help: 'How branchy the decoy tiles are. 0 = simple, 1 = lots of junctions.' },
      { key: 'locked', label: 'Locked tiles (from level 4)', type: 'bool', def: true },
      { key: 'checkpoints', label: 'Checkpoint tiles (from level 5)', type: 'bool', def: true },
      { key: 'pointsPerLevel', label: 'Points per level (4×4)', type: 'number', min: 10, max: 1000, step: 10, def: 100, help: 'Bigger grids are worth more: points × size² ÷ 16.' },
      { key: 'timeBonusMax', label: 'Maximum time bonus per level', type: 'number', min: 0, max: 500, step: 5, def: 50 },
      { key: 'targetSecPerTile', label: 'Time-bonus target (seconds per tile)', type: 'number', min: 0.5, max: 5, step: 0.1, def: 1.5, help: 'Solve faster than size² × this to earn a time bonus.' },
      { key: 'efficiencyMax', label: 'Maximum efficiency bonus per level', type: 'number', min: 0, max: 300, step: 5, def: 30, help: 'Minus 3 points for each rotation beyond the minimum.' },
      { key: 'hintsAllowed', label: 'Hint button', type: 'bool', def: true },
      { key: 'hintCost', label: 'Hint cost (points)', type: 'number', min: 0, max: 500, step: 5, def: 25 },
      { key: 'attempts', label: 'Attempts allowed per player', type: 'number', min: 1, max: 50, step: 1, def: 3 },
      { key: 'teamMode', label: 'Team mode', type: 'bool', def: false, help: 'Players also enter a team name; a team leaderboard adds up members’ best scores.' },
      { key: 'syncStart', label: 'Facilitator-started round', type: 'bool', def: false, help: 'When on, pressing Start launches one round that everyone starts at the same moment.' },
    ],
    'team-showdown': [
      { key: 'teamCount', label: 'Number of teams', type: 'number', min: 2, max: 4, step: 1, def: 2 },
      { key: 'teamNames', label: 'Team names', type: 'list', count: 4, max: 24, def: ['Barley', 'Wheat', 'Olive', 'Fig'] },
      { key: 'answerSec', label: 'Seconds to answer after buzzing', type: 'number', min: 3, max: 60, step: 1, def: 10 },
      { key: 'wrongPenalty', label: 'Wrong-answer penalty', type: 'number', min: 0, max: 500, step: 10, def: 50 },
      { key: 'stealPct', label: 'Steal value (% of points)', type: 'number', min: 0, max: 100, step: 5, def: 50 },
      { key: 'stealSec', label: 'Seconds to steal', type: 'number', min: 3, max: 60, step: 1, def: 10 },
      { key: 'streakLength', label: 'Correct answers in a row for a streak', type: 'number', min: 2, max: 10, step: 1, def: 3 },
      { key: 'streakBonus', label: 'Streak bonus', type: 'number', min: 0, max: 500, step: 10, def: 50 },
      { key: 'lockoutSec', label: 'Buzzer lockout after a wrong answer or early buzz (seconds)', type: 'number', min: 0, max: 30, step: 1, def: 3 },
      { key: 'wagerEnabled', label: 'Final Wager round', type: 'bool', def: true },
      { key: 'maxWager', label: 'Maximum wager', type: 'number', min: 0, max: 5000, step: 50, def: 500 },
      { key: 'wagerSec', label: 'Seconds to answer the final question', type: 'number', min: 10, max: 180, step: 5, def: 45 },
    ],
  };

  const GAME_TEXT = {
    'gleaners-rush': {
      title: 'Gleaner’s Rush',
      description: 'Catch the falling barley, dodge the stones and thorns, and chase a combo. Quick fingers only.',
      closing: 'Great gleaning! Now let’s open Ruth 4 together.',
    },
    'redeemers-challenge': {
      title: 'The Redeemer’s Challenge',
      description: 'Eight questions on Ruth 4: the city gate, a sandal and a baby named Obed. How much did you catch from the teaching?',
      closing: 'Thank you for exploring Ruth 4 together.',
    },
    'road-to-bethlehem': {
      title: 'Road to Bethlehem',
      description: 'Rotate the tiles to build a road from Moab to Bethlehem. Clear as many levels as you can before the clock runs out.',
      closing: 'Every road led home. Well played!',
    },
    'team-showdown': {
      title: 'Team Showdown',
      description: 'The grand finale: buzzers, steals, streaks and a final wager. Teams battle it out on the big screen.',
      closing: 'What a showdown! Thank you for playing.',
    },
  };

  const LIMITS = { title: 40, description: 200, closing: 240, sessionTitle: 60, welcome: 300 };

  function clone(v) {
    return JSON.parse(JSON.stringify(v));
  }

  function settingsDefaults(id) {
    const out = {};
    SCHEMA[id].forEach((f) => { out[f.key] = clone(f.def); });
    return out;
  }

  function defaults() {
    const games = {};
    GAME_IDS.forEach((id) => {
      games[id] = Object.assign({ enabled: true, visible: true }, clone(GAME_TEXT[id]), { settings: settingsDefaults(id) });
    });
    const bank = Bank ? clone(Bank) : { rounds: [], wager: { prompt: '', answer: '' }, tiebreakers: [] };
    games['team-showdown'].content = normalizeContent(bank);
    return {
      version: 1,
      session: {
        title: 'Ruth 4 Game Night',
        welcome: 'Four games, one story. Play along on your phone and watch the big screen for what’s live.',
        startMode: 'auto',
        code: 'RUTH4',
      },
      order: GAME_IDS.slice(),
      games,
    };
  }

  // ───────────── Cleaning ─────────────

  function text(value, max, fallback) {
    if (typeof value !== 'string') return fallback;
    const tidy = value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F<>]/g, '').replace(/[ \t]+/g, ' ').trim();
    return Array.from(tidy).slice(0, max).join('').trim();
  }

  function num(value, field) {
    const n = Number(value);
    if (!isFinite(n)) return field.def;
    const clamped = Math.min(field.max, Math.max(field.min, n));
    const step = field.step || 1;
    const rounded = Math.round(clamped / step) * step;
    return Number(rounded.toFixed(4));
  }

  function normalizeSettings(id, raw) {
    const src = raw && typeof raw === 'object' ? raw : {};
    const out = {};
    SCHEMA[id].forEach((f) => {
      const v = src[f.key];
      if (f.type === 'number') out[f.key] = num(v, f);
      else if (f.type === 'bool') out[f.key] = typeof v === 'boolean' ? v : f.def;
      else if (f.type === 'select') out[f.key] = f.options.some((o) => o[0] === v) ? v : f.def;
      else if (f.type === 'list') {
        const list = Array.isArray(v) ? v : [];
        out[f.key] = f.def.map((d, i) => text(list[i], f.max, '') || d);
      } else out[f.key] = text(v, f.max || 200, f.def);
    });
    if (id === 'road-to-bethlehem' && out.maxSize < out.startSize) out.maxSize = out.startSize;
    return out;
  }

  function normalizeQuestion(q, type) {
    const src = q && typeof q === 'object' ? q : {};
    const prompt = text(src.prompt, 240, '');
    if (!prompt) return null;
    const out = { prompt };
    if (type === 'judged') return out;
    const answer = text(src.answer, 80, '');
    if (!answer) return null;
    out.answer = answer;
    const display = text(src.display, 80, '');
    if (display) out.display = display;
    const accept = (Array.isArray(src.accept) ? src.accept : []).map((a) => text(a, 80, '')).filter(Boolean).slice(0, 10);
    if (accept.length) out.accept = accept;
    const note = text(src.note, 240, '');
    if (note) out.note = note;
    return out;
  }

  function normalizeContent(raw) {
    const src = raw && typeof raw === 'object' ? raw : {};
    const usedIds = {};
    const rounds = (Array.isArray(src.rounds) ? src.rounds : []).slice(0, 12).map((r, i) => {
      const type = r && r.type === 'judged' ? 'judged' : 'buzzer';
      let id = text(r && r.id, 24, '').replace(/[^a-z0-9-]/gi, '').toLowerCase() || 'round' + (i + 1);
      while (usedIds[id]) id += 'x';
      usedIds[id] = true;
      return {
        id,
        title: text(r && r.title, 40, 'Round ' + (i + 1)) || 'Round ' + (i + 1),
        type,
        intro: text(r && r.intro, 240, ''),
        timeSec: num(r && r.timeSec, { min: 5, max: 180, step: 1, def: 20 }),
        points: num(r && r.points, { min: 0, max: 1000, step: 5, def: 100 }),
        bonus: num(r && r.bonus, { min: 0, max: 500, step: 5, def: 0 }),
        double: !!(r && r.double),
        enabled: !(r && r.enabled === false),
        questions: (Array.isArray(r && r.questions) ? r.questions : []).slice(0, 40).map((q) => normalizeQuestion(q, type)).filter(Boolean),
      };
    });
    const wager = normalizeQuestion(src.wager, 'buzzer') || { prompt: '', answer: '' };
    const tiebreakers = (Array.isArray(src.tiebreakers) ? src.tiebreakers : []).slice(0, 10).map((q) => normalizeQuestion(q, 'buzzer')).filter(Boolean);
    return { rounds, wager, tiebreakers };
  }

  function normalizeSession(raw, def) {
    const src = raw && typeof raw === 'object' ? raw : {};
    const code = String(src.code == null ? '' : src.code).toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 16);
    return {
      title: text(src.title, LIMITS.sessionTitle, def.title) || def.title,
      welcome: text(src.welcome, LIMITS.welcome, def.welcome),
      startMode: src.startMode === 'facilitator' ? 'facilitator' : 'auto',
      code: code.length >= 3 ? code : def.code,
    };
  }

  /** Returns a complete, valid configuration built from whatever was passed in. */
  function normalizeConfig(raw) {
    const def = defaults();
    const src = raw && typeof raw === 'object' ? raw : {};
    const order = [];
    (Array.isArray(src.order) ? src.order : []).forEach((id) => {
      if (GAME_IDS.indexOf(id) >= 0 && order.indexOf(id) < 0) order.push(id);
    });
    GAME_IDS.forEach((id) => { if (order.indexOf(id) < 0) order.push(id); });

    const games = {};
    GAME_IDS.forEach((id) => {
      const g = (src.games && src.games[id]) || {};
      const d = def.games[id];
      games[id] = {
        enabled: typeof g.enabled === 'boolean' ? g.enabled : d.enabled,
        visible: typeof g.visible === 'boolean' ? g.visible : d.visible,
        title: text(g.title, LIMITS.title, d.title) || d.title,
        description: text(g.description, LIMITS.description, d.description),
        closing: text(g.closing, LIMITS.closing, d.closing),
        settings: normalizeSettings(id, g.settings),
      };
    });
    const sd = src.games && src.games['team-showdown'];
    games['team-showdown'].content = sd && sd.content ? normalizeContent(sd.content) : def.games['team-showdown'].content;

    return { version: 1, session: normalizeSession(src.session, def.session), order, games };
  }

  /** Settings that are safe to send to participants (no quiz answers). */
  function publicSettings(id, settings) {
    if (id === 'redeemers-challenge') return {};
    return clone(settings);
  }

  return { GAME_IDS, SCHEMA, LIMITS, defaults, normalizeConfig, normalizeSettings, normalizeContent, publicSettings, cleanText: text };
});
