/*
 * Session rules shared by the browser (local mode) and the Apps Script server (shared mode):
 *   - the "live" state of each game (status, seed, epoch, synchronised round, tie-breaker)
 *   - facilitator controls (start, pause, resume, end, reset, new seed, show/hide…)
 *   - what participants may see (hidden and disabled games are left out entirely)
 *   - leaderboard ranking (best attempt per player, competition ranking 1, 2, 2, 4)
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./defaults.js'), require('./rng.js'));
  else root.HubSession = factory(root.HubDefaults, root.HubRng);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (D, Rng) {
  'use strict';

  const ARCADE = ['gleaners-rush', 'road-to-bethlehem']; // games with seeds and timed rounds
  const STATUSES = ['ready', 'running', 'paused', 'ended'];
  const ROUND_LEAD_MS = 8000; // synchronised rounds start this long after the facilitator presses Start
  const SUBMIT_GRACE_MS = 30000; // scores are accepted this long after a game ends

  function clone(v) {
    return JSON.parse(JSON.stringify(v));
  }

  function gameDefault(seed) {
    return { status: 'ready', seed, seeds: [seed], epoch: 0, round: null, tiebreak: null, resetAt: 0, startedAt: 0, endedAt: 0 };
  }

  function defaultLive(rand) {
    const live = { rev: 1, liveGame: null, games: {} };
    D.GAME_IDS.forEach((id) => { live.games[id] = gameDefault(Rng.newSeed(rand)); });
    return live;
  }

  function normalizeLive(raw, rand) {
    const src = raw && typeof raw === 'object' ? raw : {};
    const live = { rev: Number(src.rev) || 1, liveGame: D.GAME_IDS.indexOf(src.liveGame) >= 0 ? src.liveGame : null, games: {} };
    D.GAME_IDS.forEach((id) => {
      const g = (src.games && src.games[id]) || {};
      const seed = Rng.normalizeSeed(g.seed) || Rng.newSeed(rand);
      const out = gameDefault(seed);
      if (STATUSES.indexOf(g.status) >= 0) out.status = g.status;
      out.seeds = (Array.isArray(g.seeds) ? g.seeds.map(Rng.normalizeSeed).filter(Boolean) : []).slice(0, 8);
      if (out.seeds.indexOf(seed) < 0) out.seeds.unshift(seed);
      ['epoch', 'resetAt', 'startedAt', 'endedAt'].forEach((k) => { out[k] = Math.max(0, Number(g[k]) || 0); });
      out.round = g.round && typeof g.round === 'object' ? g.round : null;
      out.tiebreak = g.tiebreak && typeof g.tiebreak === 'object' ? g.tiebreak : null;
      live.games[id] = out;
    });
    return live;
  }

  /**
   * Applies a facilitator control. Returns { config, live } (copies) or { error }.
   * Visibility changes (show/hide/enable/disable) update the configuration; the rest update live state.
   */
  function control(configIn, liveIn, gameId, op, args, now, rand) {
    if (D.GAME_IDS.indexOf(gameId) < 0) return { error: 'Unknown game.' };
    const config = clone(configIn);
    const live = clone(liveIn);
    const cfg = config.games[gameId];
    const g = live.games[gameId];
    const arcade = ARCADE.indexOf(gameId) >= 0;
    args = args || {};

    function newRound() {
      g.round = { id: Rng.newSeed(rand) + Rng.newSeed(rand), seed: g.seed, startAt: now + ROUND_LEAD_MS };
    }

    switch (op) {
      case 'show':
        cfg.visible = true;
        break;
      case 'hide':
        cfg.visible = false;
        if (live.liveGame === gameId) live.liveGame = null;
        break;
      case 'enable':
        cfg.enabled = true;
        break;
      case 'disable':
        cfg.enabled = false;
        if (live.liveGame === gameId) live.liveGame = null;
        break;
      case 'start':
        if (!cfg.enabled || !cfg.visible) return { error: 'Show this game to participants before starting it.' };
        g.status = 'running';
        g.startedAt = now;
        g.endedAt = 0;
        g.round = null;
        if (arcade && cfg.settings.syncStart) newRound();
        live.liveGame = gameId;
        break;
      case 'nextRound':
        if (!arcade) return { error: 'Only the arcade and puzzle games have rounds.' };
        if (!cfg.enabled || !cfg.visible) return { error: 'Show this game to participants first.' };
        g.status = 'running';
        g.endedAt = 0;
        newRound();
        live.liveGame = gameId;
        break;
      case 'pause':
        if (g.status !== 'running') return { error: 'The game is not running.' };
        g.status = 'paused';
        break;
      case 'resume':
        if (g.status !== 'paused') return { error: 'The game is not paused.' };
        g.status = 'running';
        break;
      case 'end':
        g.status = 'ended';
        g.endedAt = now;
        g.round = null;
        break;
      case 'reset':
        g.epoch += 1;
        g.status = 'ready';
        g.round = null;
        g.tiebreak = null;
        g.resetAt = now;
        g.startedAt = 0;
        g.endedAt = 0;
        break;
      case 'newSeed': {
        if (!arcade) return { error: 'Only the arcade and puzzle games use seeds.' };
        const seed = args.seed ? Rng.normalizeSeed(args.seed) : Rng.newSeed(rand);
        if (!seed) return { error: 'Seeds are 3–16 letters or numbers.' };
        g.seed = seed;
        g.seeds = [seed].concat(g.seeds.filter((s) => s !== seed)).slice(0, 8);
        break;
      }
      case 'setLive':
        if (!cfg.enabled || !cfg.visible) return { error: 'Show this game to participants first.' };
        live.liveGame = gameId;
        break;
      case 'clearLive':
        if (live.liveGame === gameId) live.liveGame = null;
        break;
      case 'tiebreak': {
        if (!arcade) return { error: 'Use the Team Showdown host screen for its tie-breaker.' };
        const players = (Array.isArray(args.players) ? args.players : []).map((p) => D.cleanText(p, 20, '')).filter(Boolean).slice(0, 12);
        if (players.length < 2) return { error: 'Choose at least two tied players.' };
        g.tiebreak = { id: Rng.newSeed(rand), seed: Rng.newSeed(rand), players, startedAt: now };
        break;
      }
      case 'endTiebreak':
        g.tiebreak = null;
        break;
      default:
        return { error: 'Unknown control.' };
    }
    live.rev += 1;
    return { config, live };
  }

  /**
   * Whether participants can see (listed) and start (playable) a game.
   * Hidden and disabled games are never listed unless the viewer is an admin previewing.
   */
  function availability(config, live, id, preview) {
    const cfg = config.games[id];
    const g = live.games[id];
    if (!cfg || !g) return { listed: false, playable: false, reason: 'unknown' };
    if (!preview && !cfg.enabled) return { listed: false, playable: false, reason: 'disabled' };
    if (!preview && !cfg.visible) return { listed: false, playable: false, reason: 'hidden' };
    if (preview) return { listed: true, playable: true, reason: 'preview' };
    if (g.status === 'ended') return { listed: true, playable: false, reason: 'ended' };
    if (g.status === 'paused') return { listed: true, playable: false, reason: 'paused' };
    if (config.session.startMode === 'facilitator' && g.status !== 'running') return { listed: true, playable: false, reason: 'waiting' };
    return { listed: true, playable: true, reason: 'open' };
  }

  /** Whether a finished run for this game may still be recorded. */
  function acceptingScores(config, live, id, now) {
    const a = availability(config, live, id, false);
    if (!a.listed) return false;
    const g = live.games[id];
    if (g.status === 'ended') return now - g.endedAt <= SUBMIT_GRACE_MS;
    return true;
  }

  /** What participants receive. Hidden and disabled games are absent, not merely flagged. */
  function publicState(config, live, now, preview) {
    const games = [];
    config.order.forEach((id) => {
      const a = availability(config, live, id, preview);
      if (!a.listed) return;
      const cfg = config.games[id];
      const g = live.games[id];
      games.push({
        id,
        title: cfg.title,
        description: cfg.description,
        closing: cfg.closing,
        status: g.status,
        playable: a.playable,
        reason: a.reason,
        live: live.liveGame === id,
        settings: D.publicSettings(id, cfg.settings),
        seed: ARCADE.indexOf(id) >= 0 ? g.seed : null,
        epoch: g.epoch,
        round: g.round,
        tiebreak: g.tiebreak ? { id: g.tiebreak.id, seed: g.tiebreak.seed, players: g.tiebreak.players } : null,
      });
    });
    const liveGame = games.some((x) => x.id === live.liveGame) ? live.liveGame : null;
    return { rev: live.rev, serverTime: now, session: clone(config.session), liveGame, games };
  }

  // ───────────── Leaderboards ─────────────

  function compare(game, a, b) {
    if (game === 'road-to-bethlehem') return b.levels - a.levels || b.score - a.score || a.timeMs - b.timeMs || a.at - b.at;
    return b.score - a.score || a.at - b.at;
  }

  function sameRank(game, a, b) {
    if (game === 'road-to-bethlehem') return a.levels === b.levels && a.score === b.score && a.timeMs === b.timeMs;
    return a.score === b.score;
  }

  /**
   * rows: [{ nickname, team, device, score, levels, timeMs, at, attempt }]
   * Returns the best attempt per player (device + nickname), ranked.
   */
  function rankPlayers(game, rows, device) {
    const best = {};
    rows.forEach((r) => {
      const key = r.device + '|' + String(r.nickname).toLowerCase();
      const row = {
        key,
        nickname: r.nickname,
        team: r.team || '',
        score: Number(r.score) || 0,
        levels: Number(r.levels) || 0,
        timeMs: Number(r.timeMs) || 0,
        at: Number(r.at) || 0,
        attempts: 1,
        you: !!device && r.device === device,
        detail: r.detail || null,
      };
      const prev = best[key];
      if (!prev) best[key] = row;
      else {
        const attempts = prev.attempts + 1;
        if (compare(game, row, prev) < 0) best[key] = row;
        best[key].attempts = attempts;
      }
    });
    const list = Object.keys(best).map((k) => best[k]).sort((a, b) => compare(game, a, b));
    let rank = 0;
    list.forEach((r, i) => {
      if (i === 0 || !sameRank(game, r, list[i - 1])) rank = i + 1;
      r.rank = rank;
    });
    return list;
  }

  /** Team totals: the sum of each member's best score. */
  function rankTeams(rankedPlayers) {
    const teams = {};
    rankedPlayers.forEach((p) => {
      if (!p.team) return;
      const key = p.team.toLowerCase();
      if (!teams[key]) teams[key] = { key: 'team|' + key, name: p.team, firstAt: p.at, score: 0, levels: 0, members: 0 };
      // Show the spelling the team used first.
      if (p.at < teams[key].firstAt) {
        teams[key].name = p.team;
        teams[key].firstAt = p.at;
      }
      teams[key].score += p.score;
      teams[key].levels += p.levels;
      teams[key].members += 1;
    });
    const list = Object.keys(teams).map((k) => teams[k]).sort((a, b) => b.score - a.score || b.levels - a.levels);
    let rank = 0;
    list.forEach((t, i) => {
      if (i === 0 || t.score !== list[i - 1].score) rank = i + 1;
      t.rank = rank;
    });
    return list;
  }

  /** Players sharing first place (empty if there is no tie). */
  function topTie(ranked) {
    const first = ranked.filter((r) => r.rank === 1);
    return first.length > 1 ? first : [];
  }

  /** Tie-breaker results: fastest solve (puzzle) or highest score (arcade). */
  function rankTiebreak(game, rows) {
    const list = rows.slice().sort((a, b) => (game === 'road-to-bethlehem' ? (a.timeMs || 1e12) - (b.timeMs || 1e12) : b.score - a.score) || a.at - b.at);
    return list.map((r, i) => Object.assign({}, r, { rank: i + 1 }));
  }

  return {
    ARCADE,
    ROUND_LEAD_MS,
    SUBMIT_GRACE_MS,
    defaultLive,
    normalizeLive,
    control,
    availability,
    acceptingScores,
    publicState,
    rankPlayers,
    rankTeams,
    rankTiebreak,
    topTie,
  };
});
