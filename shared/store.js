/*
 * The hub's view of the session: configuration, live state, scores and Team Showdown.
 *
 * Local mode  (no back end): everything lives in this browser's storage. Tabs on the same
 *             device stay in step through "storage" events, so an admin tab can drive a
 *             projector tab, but other phones are not affected.
 * Shared mode (Apps Script back end reachable): the server is the source of truth.
 *             Participants poll a public view in which hidden games simply do not exist;
 *             admin actions are authorised on the server.
 */
(function (root) {
  'use strict';

  const U = root.HubUtil;
  const D = root.HubDefaults;
  const S = root.HubSession;
  const B = root.RedeemerBackend;

  const KEYS = {
    config: 'hub.config.v1',
    live: 'hub.live.v1',
    results: 'hub.results.v1',
    showdown: 'hub.showdown.v1',
    draft: 'hub.preview-draft.v1',
    adminKey: 'hub.admin-key.v1',
    tokens: 'hub.showdown-token.v1',
  };

  let mode = 'local';
  let role = 'participant';
  let preview = false;
  let pub = null; // public state
  let full = null; // admin: { config, live, showdown }
  let offset = 0;
  let pollMs = 6000;
  let pollTimer = null;
  let lastError = null;
  const listeners = [];

  function now() {
    return Date.now() + offset;
  }

  function emit() {
    listeners.forEach((fn) => {
      try { fn(); } catch (e) { console.error(e); }
    });
  }

  function adminKey() {
    return U.store.get('sessionStorage', KEYS.adminKey, null) || U.store.get('localStorage', KEYS.adminKey, null) || '';
  }

  async function call(action, payload, opts) {
    const sent = Date.now();
    const body = Object.assign({}, payload || {});
    if (role !== 'participant' || (opts && opts.admin)) {
      const key = adminKey();
      if (key) body.adminKey = key;
    }
    const data = await B.call(action, body, opts);
    if (typeof data.serverTime === 'number') {
      const recv = Date.now();
      offset = data.serverTime - (sent + recv) / 2;
    }
    return data;
  }

  // ───────────── Local storage model ─────────────

  function localConfig() {
    return D.normalizeConfig(U.store.get('localStorage', KEYS.config, null));
  }

  function localLive() {
    const raw = U.store.get('localStorage', KEYS.live, null);
    const live = S.normalizeLive(raw);
    if (!raw) U.store.set('localStorage', KEYS.live, live);
    return live;
  }

  function draftConfig() {
    const draft = U.store.get('localStorage', KEYS.draft, null);
    if (draft && draft.config && Date.now() - (draft.at || 0) < 6 * 3600 * 1000) return D.normalizeConfig(draft.config);
    return null;
  }

  function localResults() {
    const all = U.store.get('localStorage', KEYS.results, {});
    return all && typeof all === 'object' ? all : {};
  }

  function rebuildLocal() {
    const config = (preview && draftConfig()) || localConfig();
    const live = localLive();
    pub = S.publicState(config, live, Date.now(), preview);
    pub.showdown = root.ShowdownCore ? root.ShowdownCore.publicView(localShowdown(), config.games['team-showdown'], Date.now()) : null;
    if (role !== 'participant') full = { config, live, showdown: localShowdown() };
  }

  function localShowdown() {
    const saved = U.store.get('localStorage', KEYS.showdown, null);
    if (saved && root.ShowdownCore) return saved;
    if (!root.ShowdownCore) return null;
    const cfg = localConfig().games['team-showdown'];
    return root.ShowdownCore.init(cfg, Date.now(), Math.random);
  }

  // ───────────── Shared model ─────────────

  async function pull() {
    if (role === 'participant') {
      const data = await call('state', {});
      pub = data.state;
    } else {
      const data = await call('adminState', {}, { admin: true });
      full = { config: data.config, live: data.live, showdown: data.showdown, results: data.results || null };
      const config = (preview && draftConfig()) || full.config;
      pub = S.publicState(config, full.live, now(), preview);
      pub.showdown = data.showdownPublic || null;
    }
    lastError = null;
  }

  function schedulePoll() {
    clearTimeout(pollTimer);
    if (mode !== 'shared') return;
    pollTimer = setTimeout(async () => {
      if (!document.hidden) {
        try {
          await pull();
          emit();
        } catch (e) {
          lastError = e;
          emit();
        }
      }
      schedulePoll();
    }, pollMs);
  }

  // ───────────── Initialisation ─────────────

  async function init(opts) {
    role = (opts && opts.role) || 'participant';
    preview = !!(opts && opts.preview);
    if (B.kind !== 'none') {
      const status = await B.check();
      if (status.connected && status.hub) mode = 'shared';
    }
    if (mode === 'shared') {
      try {
        if (role !== 'participant' || preview) {
          const who = await whoami();
          if (!who.isAdmin) {
            if (preview) preview = false;
            if (role !== 'participant') return { mode, isAdmin: false, who };
            role = 'participant';
          }
        }
        await pull().catch(pull); // one retry: the first request can be slow while Apps Script wakes up
      } catch (e) {
        lastError = e;
        if (!pub) {
          // The server answered the ping but not the state request: fall back to local play.
          mode = 'local';
        }
      }
    }
    if (mode === 'local') {
      rebuildLocal();
      root.addEventListener('storage', (e) => {
        if (e.key && e.key.indexOf('hub.') === 0) {
          rebuildLocal();
          emit();
        }
      });
    } else {
      schedulePoll();
      document.addEventListener('visibilitychange', () => {
        if (!document.hidden) refresh();
      });
    }
    return { mode, isAdmin: role !== 'participant' };
  }

  async function refresh() {
    if (mode === 'local') rebuildLocal();
    else {
      try {
        await pull();
      } catch (e) {
        lastError = e;
      }
      schedulePoll();
    }
    emit();
  }

  async function whoami(key) {
    if (mode === 'local' && B.kind === 'none') return { isAdmin: true, method: 'local' };
    const payload = {};
    if (key) payload.adminKey = key;
    const data = await call('whoami', payload, { admin: !key });
    return data;
  }

  // ───────────── Scores ─────────────

  async function startRun(game, payload) {
    if (preview) return { runId: 'preview', preview: true };
    if (mode === 'local') return { runId: 'local-' + U.uuid() };
    try {
      return await call('startRun', Object.assign({ game, deviceId: U.deviceId() }, payload));
    } catch (e) {
      return { runId: null, error: e };
    }
  }

  /**
   * payload: { runId, nickname, team, result, tiebreak }
   * Returns { ok, saved: 'shared'|'local'|'preview', score, rank, board, message }
   */
  async function submitRun(game, payload) {
    if (preview) return { ok: true, saved: 'preview', score: payload.localScore };
    if (mode === 'shared') {
      if (!payload.runId) return Object.assign(saveLocalRun(game, payload), { message: 'Your run wasn’t registered with the server, so the score was saved on this device only.' });
      try {
        const data = await call('submitRun', Object.assign({ game, deviceId: U.deviceId() }, payload));
        return Object.assign({ saved: 'shared' }, data);
      } catch (e) {
        return Object.assign(saveLocalRun(game, payload), { ok: false, error: e, message: e.message });
      }
    }
    return saveLocalRun(game, payload);
  }

  function saveLocalRun(game, payload) {
    const all = localResults();
    const live = localLive();
    const list = Array.isArray(all[game]) ? all[game] : [];
    const r = payload.result || {};
    const row = {
      id: U.uuid(),
      nickname: payload.nickname,
      team: payload.team || '',
      device: U.deviceId(),
      score: Number(payload.localScore) || 0,
      levels: Number(r.levelsCleared) || 0,
      timeMs: Number(r.totalMs || r.durationMs || r.ms) || 0,
      at: Date.now(),
      epoch: live.games[game].epoch,
      tiebreak: payload.tiebreak || '',
      detail: r,
    };
    list.push(row);
    all[game] = list.slice(-300);
    U.store.set('localStorage', KEYS.results, all);
    const board = localBoard(game);
    const mine = board.players.find((p) => p.you && p.nickname.toLowerCase() === String(payload.nickname).toLowerCase());
    return { ok: true, saved: 'local', score: row.score, rank: mine ? mine.rank : null, board };
  }

  function localBoard(game) {
    const live = localLive();
    const epoch = live.games[game].epoch;
    const rows = (localResults()[game] || []).filter((r) => r.epoch === epoch && !r.tiebreak);
    const players = S.rankPlayers(game, rows, U.deviceId());
    return { players, teams: S.rankTeams(players), saved: 'local' };
  }

  async function board(game) {
    if (mode === 'local' || preview) return localBoard(game);
    try {
      const data = await call('board', { game, deviceId: U.deviceId() });
      return { players: data.players, teams: data.teams || [], total: data.total, saved: 'shared' };
    } catch (e) {
      return Object.assign(localBoard(game), { error: e });
    }
  }

  /** How many attempts this player has used in the current epoch. */
  async function attemptsUsed(game, nickname) {
    const b = await board(game);
    const me = (b.players || []).find((p) => p.you && p.nickname.toLowerCase() === String(nickname).toLowerCase());
    return me ? me.attempts : 0;
  }

  async function redeemerContent() {
    if (root.REDEEMER_CONTENT) return root.REDEEMER_CONTENT;
    const data = await call('content', { game: 'redeemers-challenge', preview }, { admin: preview });
    root.REDEEMER_CONTENT = data.content;
    return data.content;
  }

  // ───────────── Team Showdown (team devices) ─────────────

  const showdown = {
    token() {
      const t = U.store.get('localStorage', KEYS.tokens, null);
      return t && t.token ? t : null;
    },
    async join(code, team) {
      const data = await call('showdownJoin', { code, team, deviceId: U.deviceId() });
      U.store.set('localStorage', KEYS.tokens, { token: data.token, team: data.team, name: data.name });
      return data;
    },
    leave() {
      U.store.remove('localStorage', KEYS.tokens);
    },
    async buzz() {
      const t = showdown.token();
      if (!t) throw new B.BackendError('NO_TEAM', 'Join a team first.');
      const data = await call('buzz', { token: t.token });
      if (data.state) pub.showdown = data.state;
      emit();
      return data;
    },
    async wager(amount, answer) {
      const t = showdown.token();
      if (!t) throw new B.BackendError('NO_TEAM', 'Join a team first.');
      const payload = { token: t.token };
      if (amount != null) payload.amount = amount;
      if (answer != null) payload.answer = answer;
      const data = await call('wager', payload);
      if (data.state) pub.showdown = data.state;
      emit();
      return data;
    },
  };

  // ───────────── Admin ─────────────

  function saveDraft(config) {
    U.store.set('localStorage', KEYS.draft, { config, at: Date.now() });
  }

  const admin = {
    setKey(key, remember) {
      U.store.remove('localStorage', KEYS.adminKey);
      U.store.remove('sessionStorage', KEYS.adminKey);
      if (key) U.store.set(remember ? 'localStorage' : 'sessionStorage', KEYS.adminKey, key);
    },
    hasKey: () => !!adminKey(),
    full: () => full,
    async saveConfig(config) {
      const clean = D.normalizeConfig(config);
      // Visibility is changed only through controls, so a stale draft can't undo a show/hide.
      D.GAME_IDS.forEach((id) => {
        clean.games[id].visible = full.config.games[id].visible;
        clean.games[id].enabled = full.config.games[id].enabled;
      });
      if (mode === 'local') {
        U.store.set('localStorage', KEYS.config, clean);
        rebuildLocal();
      } else {
        const data = await call('saveConfig', { config: clean }, { admin: true });
        full.config = data.config;
        full.live = data.live;
      }
      emit();
      return full.config;
    },
    async restoreDefaults() {
      if (mode === 'local') return admin.saveConfig(D.defaults());
      // The server holds the default questions; the admin page never needs them.
      const data = await call('saveConfig', { defaults: true }, { admin: true });
      full.config = data.config;
      full.live = data.live;
      emit();
      return full.config;
    },
    async control(game, op, args) {
      if (mode === 'local') {
        const config = localConfig();
        const out = S.control(config, localLive(), game, op, args, Date.now());
        if (out.error) throw new B.BackendError('BAD_CONTROL', out.error);
        U.store.set('localStorage', KEYS.config, out.config);
        U.store.set('localStorage', KEYS.live, out.live);
        if (game === 'team-showdown' && op === 'reset') admin.showdownLocalReset();
        rebuildLocal();
      } else {
        const data = await call('control', { game, op, args }, { admin: true });
        full.config = data.config;
        full.live = data.live;
        if (data.showdown) full.showdown = data.showdown;
        pub = S.publicState(full.config, full.live, now(), false);
      }
      emit();
    },
    showdownLocalReset() {
      const cfg = localConfig().games['team-showdown'];
      U.store.set('localStorage', KEYS.showdown, root.ShowdownCore.init(cfg, Date.now(), Math.random));
    },
    async showdown(op, args) {
      if (mode === 'local') {
        const cfg = localConfig().games['team-showdown'];
        const out = root.ShowdownCore.reduce(localShowdown(), Object.assign({ type: op }, args || {}), cfg, Date.now(), Math.random);
        if (out.error) throw new B.BackendError('BAD_ACTION', out.error);
        U.store.set('localStorage', KEYS.showdown, out.state);
        rebuildLocal();
        emit();
        return out.state;
      }
      const data = await call('showdownOp', { op, args: args || {} }, { admin: true });
      full.showdown = data.showdown;
      emit();
      return data.showdown;
    },
    async results(game) {
      if (mode === 'local') {
        const live = localLive();
        const rows = (localResults()[game] || []).map((r) => Object.assign({ status: 'ok', current: r.epoch === live.games[game].epoch }, r));
        return { rows, epoch: live.games[game].epoch };
      }
      return call('results', { game }, { admin: true });
    },
    async adjust(game, id, score) {
      if (mode === 'local') {
        const all = localResults();
        const row = (all[game] || []).find((r) => r.id === id);
        if (!row) throw new B.BackendError('NOT_FOUND', 'That score no longer exists.');
        row.score = score;
        row.status = 'adjusted';
        U.store.set('localStorage', KEYS.results, all);
        emit();
        return;
      }
      await call('adjustScore', { game, id, score }, { admin: true });
    },
    async resetSession() {
      if (mode === 'local') {
        for (const id of D.GAME_IDS) await admin.control(id, 'reset', {});
        U.store.remove('localStorage', KEYS.results);
        admin.showdownLocalReset();
        rebuildLocal();
        emit();
        return;
      }
      const data = await call('resetSession', {}, { admin: true });
      full.live = data.live;
      full.showdown = data.showdown;
      emit();
    },
    saveDraft,
    clearDraft: () => U.store.remove('localStorage', KEYS.draft),
  };

  root.HubStore = {
    init,
    refresh,
    whoami,
    get mode() { return mode; },
    get preview() { return preview; },
    get lastError() { return lastError; },
    state: () => pub,
    game: (id) => (pub ? pub.games.find((g) => g.id === id) || null : null),
    now,
    subscribe(fn) {
      listeners.push(fn);
      return () => {
        const i = listeners.indexOf(fn);
        if (i >= 0) listeners.splice(i, 1);
      };
    },
    setPollInterval(ms) {
      if (ms === pollMs) return;
      pollMs = ms;
      schedulePoll();
    },
    startRun,
    submitRun,
    board,
    attemptsUsed,
    redeemerContent,
    showdown,
    admin,
    KEYS,
  };
})(window);
