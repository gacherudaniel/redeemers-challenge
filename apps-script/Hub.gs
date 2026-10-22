/**
 * Ruth 4 Game Night — the hub's server side.
 *
 * Storage
 *   Script properties: configuration (in chunks), live state, Team Showdown state,
 *   the admin list and the admin-key fingerprint. Nothing here is ever sent to
 *   participants except through the public views in Shared.gs.
 *   Sheet "Results": one row per arcade/puzzle run (The Redeemer's Challenge keeps its
 *   own "Scores" tab, handled in Code.gs).
 *
 * Security
 *   - Admin actions require adminCheck_(): the signed-in Google account must be the owner
 *     or listed in ADMIN_EMAILS, or the request must carry the admin key (only its SHA-256
 *     fingerprint is stored). Repeated wrong keys lock key sign-in for 10 minutes.
 *   - Participants receive public views only: hidden and disabled games are absent, quiz
 *     answers are withheld until revealed, and Team Showdown wagers stay secret.
 *   - Arcade and puzzle scores are re-checked here: runs must be registered first
 *     (startRun), the elapsed server time must cover the claimed play time, scores are
 *     recomputed or capped against the seed, and attempts and submission rates are limited.
 */

const RESULTS_SHEET = 'Results';
const RESULT_HEADERS = ['Timestamp', 'Session', 'Game', 'Reset round', 'Nickname', 'Team', 'Score', 'Levels', 'Time (ms)', 'Details', 'Device', 'Run', 'Status', 'Tie-breaker', 'Changed by', 'Id'];
const HUB_CACHE_SEC = 30;
const BOARD_CACHE_SEC = 5;
const CONFIG_CHUNK = 8000; // characters per script property (JSON is stored as ASCII)
const RUN_TTL_SEC = 6 * 60 * 60;
const MIN_SUBMIT_GAP_MS = 4000;
const MAX_RESULTS_PER_GAME = 2000;
const MAX_TEAM_DEVICES = 6;
const ADMIN_FAIL_LIMIT = 20;
const SLACK_MS = 2500; // network delay allowed between the server's clock and the player's
const ADMIN_ACTIONS = { adminState: 1, saveConfig: 1, control: 1, showdownOp: 1, results: 1, adjustScore: 1, resetSession: 1 };
const SHOWDOWN_HOST_OPS = ['start', 'syncTeams', 'next', 'buzz', 'override', 'judge', 'timeout', 'reveal', 'judgedMark', 'judgedNext', 'setWager', 'wagerAnswer', 'wagerMark', 'pause', 'resume', 'adjust', 'setScore', 'end', 'tiebreak', 'reset'];

// ───────────── Routing ─────────────

function hubHandle_(body) {
  const action = body && body.action;
  if (ADMIN_ACTIONS[action]) {
    const auth = adminCheck_(body);
    if (!auth.ok) return fail_(auth.error || 'FORBIDDEN', auth.message || 'Administrator access is required.');
    switch (action) {
      case 'adminState': return adminState_();
      case 'saveConfig': return saveConfig_(body);
      case 'control': return control_(body);
      case 'showdownOp': return showdownOp_(body);
      case 'results': return results_(body);
      case 'adjustScore': return adjustScore_(body, auth);
      case 'resetSession': return resetSession_();
    }
  }
  switch (action) {
    case 'state': return hubState_();
    case 'content': return hubContent_(body);
    case 'whoami': return whoami_(body);
    case 'startRun': return startRun_(body);
    case 'submitRun': return submitRun_(body);
    case 'board': return hubBoard_(body);
    case 'showdownJoin': return showdownJoin_(body);
    case 'buzz': return buzz_(body);
    case 'wager': return wager_(body);
    default: return fail_('BAD_ACTION', 'Unknown request.');
  }
}

// ───────────── Editor helpers (run these from the Apps Script editor) ─────────────

/** Creates a new admin key, prints it once, and stores only its fingerprint. */
function createAdminKey() {
  const key = (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '').slice(0, 40);
  props_().setProperty('ADMIN_KEY_HASH', sha256_(key));
  console.log('New admin key (copy it now; it is not stored anywhere): ' + key);
  return key;
}

/** Switches admin-key sign-in off. */
function removeAdminKey() {
  props_().deleteProperty('ADMIN_KEY_HASH');
  console.log('Admin key removed. Only Google-account admins can sign in now.');
}

/** Prints who can administer the session. */
function showAdminSetup() {
  const msg = 'Google-account admins: ' + adminEmails_().join(', ') + '. Admin key: ' + (props_().getProperty('ADMIN_KEY_HASH') ? 'set' : 'not set') + '.';
  console.log(msg);
  return msg;
}

// ───────────── Storage ─────────────

function props_() {
  return PropertiesService.getScriptProperties();
}

/** JSON with every non-ASCII character escaped, so property sizes are predictable. */
function asciiJson_(value) {
  return JSON.stringify(value).replace(/[\u007f-￿]/g, function (c) {
    return '\\u' + ('0000' + c.charCodeAt(0).toString(16)).slice(-4);
  });
}

function cacheGet_(key) {
  try {
    const v = CacheService.getScriptCache().get(key);
    return v ? JSON.parse(v) : null;
  } catch (err) {
    return null;
  }
}

function cachePut_(key, value, sec) {
  try {
    CacheService.getScriptCache().put(key, JSON.stringify(value), sec || HUB_CACHE_SEC);
  } catch (err) {
    /* too large to cache: fine, it is read from properties instead */
  }
}

function hubConfig_(fresh) {
  if (!fresh) {
    const cached = cacheGet_('hub:config');
    if (cached) return cached;
  }
  const p = props_();
  const parts = Number(p.getProperty('HUB_CONFIG_PARTS')) || 0;
  let raw = null;
  if (parts) {
    let json = '';
    for (let i = 0; i < parts; i++) json += p.getProperty('HUB_CONFIG_' + i) || '';
    try { raw = JSON.parse(json); } catch (err) { raw = null; }
  }
  const cfg = HubDefaults.normalizeConfig(raw);
  cachePut_('hub:config', cfg);
  return cfg;
}

function saveHubConfig_(cfg) {
  const json = asciiJson_(cfg);
  const p = props_();
  const old = Number(p.getProperty('HUB_CONFIG_PARTS')) || 0;
  const out = {};
  let n = 0;
  for (let i = 0; i < json.length; i += CONFIG_CHUNK) out['HUB_CONFIG_' + n++] = json.slice(i, i + CONFIG_CHUNK);
  out.HUB_CONFIG_PARTS = String(n);
  p.setProperties(out);
  for (let i = n; i < old; i++) p.deleteProperty('HUB_CONFIG_' + i);
  cachePut_('hub:config', cfg);
}

function hubLive_(fresh) {
  if (!fresh) {
    const cached = cacheGet_('hub:live');
    if (cached) return cached;
  }
  const raw = props_().getProperty('HUB_LIVE');
  let live;
  if (raw) {
    try { live = HubSession.normalizeLive(JSON.parse(raw)); } catch (err) { live = null; }
  }
  if (!live) {
    live = HubSession.defaultLive(Math.random);
    props_().setProperty('HUB_LIVE', asciiJson_(live));
  }
  cachePut_('hub:live', live);
  return live;
}

function saveHubLive_(live) {
  props_().setProperty('HUB_LIVE', asciiJson_(live));
  cachePut_('hub:live', live);
}

function hubShowdown_(cfg, fresh) {
  if (!fresh) {
    const cached = cacheGet_('hub:showdown');
    if (cached) return cached;
  }
  const raw = props_().getProperty('HUB_SHOWDOWN');
  let st = null;
  if (raw) {
    try { st = JSON.parse(raw); } catch (err) { st = null; }
  }
  if (!st) {
    st = ShowdownCore.init(cfg.games['team-showdown'], Date.now(), Math.random);
    props_().setProperty('HUB_SHOWDOWN', asciiJson_(st));
  }
  cachePut_('hub:showdown', st);
  return st;
}

function saveHubShowdown_(st) {
  props_().setProperty('HUB_SHOWDOWN', asciiJson_(st));
  cachePut_('hub:showdown', st);
}

function withLock_(fn) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return fail_('BUSY', 'The server is busy. Please try again.');
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

/** Used by Code.gs: whether The Redeemer's Challenge may record scores now. */
function hubAccepting_(game) {
  try {
    return HubSession.acceptingScores(hubConfig_(), hubLive_(), game, Date.now());
  } catch (err) {
    return true;
  }
}

/** Used by Code.gs: scores older than the last reset no longer count. */
function hubResetAt_(game) {
  try {
    return hubLive_().games[game].resetAt || 0;
  } catch (err) {
    return 0;
  }
}

// ───────────── Admin identity ─────────────

function activeEmail_() {
  try {
    return String(Session.getActiveUser().getEmail() || '').toLowerCase();
  } catch (err) {
    return '';
  }
}

/** ADMIN_EMAILS (comma-separated script property) plus the script owner. */
function adminEmails_() {
  const raw = props_().getProperty('ADMIN_EMAILS') || '';
  const list = raw.split(/[\s,;]+/).map(function (s) { return s.trim().toLowerCase(); }).filter(Boolean);
  try {
    const owner = String(Session.getEffectiveUser().getEmail() || '').toLowerCase();
    if (owner && list.indexOf(owner) < 0) list.push(owner);
  } catch (err) {
    /* no identity available */
  }
  return list;
}

function adminCheck_(body) {
  const email = activeEmail_();
  if (email && adminEmails_().indexOf(email) >= 0) return { ok: true, method: 'google', email: email };
  const key = body && typeof body.adminKey === 'string' ? body.adminKey : '';
  if (key) {
    const cache = CacheService.getScriptCache();
    const fails = Number(cache.get('admin:fails')) || 0;
    if (fails >= ADMIN_FAIL_LIMIT) return { ok: false, error: 'LOCKED', message: 'Too many wrong admin keys. Try again in 10 minutes.' };
    const stored = props_().getProperty('ADMIN_KEY_HASH');
    if (stored && safeEqual_(sha256_(key), stored)) return { ok: true, method: 'key', email: '' };
    cache.put('admin:fails', String(fails + 1), 600);
    return { ok: false, error: 'BAD_KEY', message: stored ? 'That admin key isn’t right.' : 'No admin key has been created yet. Run createAdminKey in the Apps Script editor.' };
  }
  return { ok: false, error: 'FORBIDDEN', message: email ? 'Signed in as ' + email + ', which is not on the admin list.' : 'Administrator access is required.' };
}

function whoami_(body) {
  const auth = adminCheck_(body);
  return ok_({ isAdmin: auth.ok, method: auth.method || '', email: auth.ok ? auth.email : '', message: auth.ok ? '' : auth.message });
}

function sha256_(text) {
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, text, Utilities.Charset.UTF_8);
  return bytes.map(function (b) { return ('0' + ((b + 256) % 256).toString(16)).slice(-2); }).join('');
}

function safeEqual_(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// ───────────── Public: state and content ─────────────

function hubState_() {
  const cfg = hubConfig_();
  const live = hubLive_();
  const now = Date.now();
  const st = HubSession.publicState(cfg, live, now, false);
  if (st.games.some(function (g) { return g.id === 'team-showdown'; })) {
    st.showdown = ShowdownCore.publicView(hubShowdown_(cfg), cfg.games['team-showdown'], now, false);
  }
  return ok_({ state: st });
}

/** The quiz content is only sent while the quiz is visible (or to an admin previewing). */
function hubContent_(body) {
  if (body.game !== 'redeemers-challenge') return fail_('BAD_REQUEST', 'Unknown content.');
  const a = HubSession.availability(hubConfig_(), hubLive_(), 'redeemers-challenge', false);
  if (!a.listed && !(body.preview && adminCheck_(body).ok)) return fail_('NOT_AVAILABLE', 'This game isn’t available right now.');
  return ok_({ content: REDEEMER_CONTENT });
}

// ───────────── Arcade and puzzle runs ─────────────

function resultsSheet_() {
  if (!sheetAvailable_()) return null;
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(RESULTS_SHEET);
  if (!sheet) {
    sheet = ss.insertSheet(RESULTS_SHEET);
    sheet.appendRow(RESULT_HEADERS);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function readResults_(sheet) {
  if (!sheet) return [];
  const values = sheet.getDataRange().getValues();
  const rows = [];
  for (let i = 1; i < values.length; i++) {
    const v = values[i];
    if (!v[2]) continue;
    let detail = null;
    try { detail = v[9] ? JSON.parse(v[9]) : null; } catch (err) { detail = null; }
    const at = v[0] instanceof Date ? v[0].getTime() : new Date(v[0]).getTime() || 0;
    rows.push({
      row: i + 1,
      at: at,
      session: String(v[1]),
      game: String(v[2]),
      epoch: Number(v[3]) || 0,
      nickname: String(v[4]),
      team: String(v[5] || ''),
      score: Number(v[6]) || 0,
      levels: Number(v[7]) || 0,
      timeMs: Number(v[8]) || 0,
      detail: detail,
      device: String(v[10]),
      run: String(v[11]),
      status: String(v[12] || 'ok'),
      tiebreak: String(v[13] || ''),
      id: String(v[15] || ''),
    });
  }
  return rows;
}

function startRun_(body) {
  const game = body.game;
  if (HubSession.ARCADE.indexOf(game) < 0) return fail_('BAD_REQUEST', 'Unknown game.');
  const device = token_(body.deviceId);
  const nickname = cleanName_(body.nickname);
  if (!device || !nickname) return fail_('BAD_REQUEST', 'Choose a nickname first.');
  if (!sheetAvailable_()) return fail_('NO_LEADERBOARD', 'The shared leaderboard is not set up.');
  const cfg = hubConfig_();
  const live = hubLive_();
  const g = live.games[game];
  const s = cfg.games[game].settings;
  const a = HubSession.availability(cfg, live, game, false);
  let seed;
  let tiebreak = '';
  let roundId = '';
  if (body.tiebreak) {
    if (!a.listed || !g.tiebreak || g.tiebreak.id !== body.tiebreak) return fail_('NO_TIEBREAK', 'That tie-breaker has finished.');
    const me = nickname.toLowerCase();
    if (!g.tiebreak.players.some(function (p) { return p.toLowerCase() === me; })) return fail_('NOT_IN_TIEBREAK', 'Only the tied players can play the tie-breaker.');
    seed = g.tiebreak.seed;
    tiebreak = g.tiebreak.id;
  } else {
    if (!a.playable) return fail_('CLOSED', 'This game isn’t open right now.');
    if (body.roundId) {
      if (!g.round || g.round.id !== body.roundId) return fail_('NO_ROUND', 'That round has finished.');
      seed = g.round.seed;
      roundId = g.round.id;
    } else {
      if (s.syncStart) return fail_('WAIT_ROUND', 'Wait for the facilitator to start the round.');
      seed = HubRng.normalizeSeed(body.seed);
      if (g.seeds.indexOf(seed) < 0) return fail_('OLD_SEED', 'The facilitator changed the pattern. Go back and start again.');
    }
    const used = readResults_(resultsSheet_()).filter(function (r) {
      return r.game === game && r.session === cfg.session.code && r.epoch === g.epoch && !r.tiebreak && r.device === device && r.nickname.toLowerCase() === nickname.toLowerCase();
    }).length;
    if (used >= s.attempts) return fail_('TOO_MANY_ATTEMPTS', 'You’ve used all ' + s.attempts + ' attempts.');
  }
  const runId = Utilities.getUuid();
  const run = { game: game, device: device, nickname: nickname.toLowerCase(), seed: seed, epoch: g.epoch, startedAt: Date.now(), tiebreak: tiebreak, roundId: roundId };
  CacheService.getScriptCache().put('run:' + runId, JSON.stringify(run), RUN_TTL_SEC);
  return ok_({ runId: runId, seed: seed });
}

/** Re-checks a finished run. Returns { ok, score, levels, timeMs, detail } or { ok: false, reason }. */
function checkRun_(run, result, s, elapsedMs) {
  if (run.game === 'gleaners-rush') {
    const rs = run.tiebreak ? RushCore.tiebreakSettings(s) : s;
    const v = RushCore.validateResult(result, rs, run.seed);
    if (!v.ok) return v;
    if (result.durationMs > elapsedMs) return { ok: false, reason: 'The run took less real time than it claims.' };
    const acc = Math.max(0, Math.min(100, Math.round(Number(result.accuracy) || 0)));
    return { ok: true, score: result.score, levels: 0, timeMs: result.durationMs, detail: { bestCombo: result.bestCombo, accuracy: acc, caught: result.caught, golden: result.golden } };
  }
  if (run.tiebreak) {
    const v = RoadCore.checkTiebreak(result, RoadCore.tiebreakSettings(s));
    if (!v.ok) return v;
    if (v.ms > elapsedMs) return { ok: false, reason: 'The solve took less real time than it claims.' };
    return { ok: true, score: 0, levels: 1, timeMs: v.ms, detail: { tiebreak: true, rotations: result.rotations } };
  }
  const v = RoadCore.scoreRun(result, s, run.seed);
  if (!v.ok) return v;
  if (v.totalMs > elapsedMs) return { ok: false, reason: 'The run took less real time than it claims.' };
  return { ok: true, score: v.score, levels: v.levelsCleared, timeMs: v.totalMs, detail: { levelsCleared: v.levelsCleared } };
}

function submitRun_(body) {
  const runId = typeof body.runId === 'string' && /^[0-9a-f-]{36}$/i.test(body.runId) ? body.runId : '';
  if (!runId) return fail_('NO_RUN', 'This run wasn’t registered with the server.');
  const cache = CacheService.getScriptCache();
  const done = cache.get('done:' + runId);
  if (done) return ok_(Object.assign(JSON.parse(done), { duplicate: true }));
  let run = null;
  try { run = JSON.parse(cache.get('run:' + runId) || 'null'); } catch (err) { run = null; }
  if (!run) return fail_('NO_RUN', 'This run wasn’t registered with the server, or it is too old.');
  const device = token_(body.deviceId);
  const nickname = cleanName_(body.nickname);
  if (device !== run.device || body.game !== run.game) return fail_('BAD_RUN', 'This run belongs to another device.');
  if (!nickname || nickname.toLowerCase() !== run.nickname) return fail_('BAD_RUN', 'The nickname changed during the run.');
  const cfg = hubConfig_();
  const live = hubLive_();
  const now = Date.now();
  const g = live.games[run.game];
  if (g.epoch !== run.epoch) return fail_('RESET', 'The facilitator reset the leaderboard during your run.');
  const gameCfg = cfg.games[run.game];
  if (run.tiebreak ? !(gameCfg.enabled && gameCfg.visible) : !HubSession.acceptingScores(cfg, live, run.game, now)) return fail_('CLOSED', 'This game isn’t accepting scores right now.');
  const s = gameCfg.settings;
  const v = checkRun_(run, body.result, s, now - run.startedAt + SLACK_MS);
  if (!v.ok) return fail_('IMPLAUSIBLE', 'Score not accepted: ' + v.reason);
  const team = s.teamMode ? cleanName_(body.team) : '';

  return withLock_(function () {
    const sheet = resultsSheet_();
    if (!sheet) return fail_('NO_LEADERBOARD', 'The shared leaderboard is not set up.');
    const rows = readResults_(sheet).filter(function (r) { return r.game === run.game && r.session === cfg.session.code && r.epoch === g.epoch; });
    const mine = rows.filter(function (r) { return r.device === device; });
    if (mine.length && now - mine[mine.length - 1].at < MIN_SUBMIT_GAP_MS) return fail_('RATE_LIMIT', 'That was quick! Wait a few seconds and try again.');
    if (!run.tiebreak) {
      const attempts = mine.filter(function (r) { return !r.tiebreak && r.nickname.toLowerCase() === run.nickname; }).length;
      if (attempts >= s.attempts) return fail_('TOO_MANY_ATTEMPTS', 'You’ve used all ' + s.attempts + ' attempts.');
    }
    if (rows.length >= MAX_RESULTS_PER_GAME) return fail_('FULL', 'This leaderboard is full.');
    const id = Utilities.getUuid();
    sheet.appendRow([new Date(now), cfg.session.code, run.game, g.epoch, safeCell_(nickname), safeCell_(team), v.score, v.levels, v.timeMs, JSON.stringify(v.detail), device, runId, 'ok', run.tiebreak, '', id]);
    rows.push({ at: now, session: cfg.session.code, game: run.game, epoch: g.epoch, nickname: nickname, team: team, score: v.score, levels: v.levels, timeMs: v.timeMs, detail: v.detail, device: device, run: runId, status: 'ok', tiebreak: run.tiebreak, id: id });
    const board = boardFrom_(run.game, rows, device);
    const me = board.all.filter(function (p) { return p.you && p.nickname.toLowerCase() === run.nickname; })[0];
    const out = { score: v.score, rank: me ? me.rank : null, board: { players: board.players, teams: board.teams }, total: board.all.length };
    cache.put('done:' + runId, JSON.stringify(out), RUN_TTL_SEC);
    cache.remove('run:' + runId);
    cache.remove(boardCacheKey_(run.game, cfg.session.code, g.epoch));
    return ok_(out);
  });
}

function publicPlayer_(game, p) {
  let detail = null;
  if (p.detail && game === 'gleaners-rush') detail = { bestCombo: p.detail.bestCombo || 0, accuracy: p.detail.accuracy || 0 };
  if (p.detail && game === 'road-to-bethlehem') detail = { levelsCleared: p.detail.levelsCleared || 0 };
  return { key: 'p' + HubRng.hashString(p.key), rank: p.rank, nickname: p.nickname, team: p.team, score: p.score, levels: p.levels, timeMs: p.timeMs, attempts: p.attempts, you: p.you, detail: detail };
}

function boardFrom_(game, rows, device) {
  const ranked = HubSession.rankPlayers(game, rows.filter(function (r) { return !r.tiebreak; }), device);
  const players = ranked.slice(0, LEADERBOARD_SIZE);
  ranked.forEach(function (p) { if (p.you && players.indexOf(p) < 0) players.push(p); });
  return {
    all: ranked,
    players: players.map(function (p) { return publicPlayer_(game, p); }),
    teams: game === 'road-to-bethlehem' ? HubSession.rankTeams(ranked).slice(0, LEADERBOARD_SIZE) : [],
  };
}

function boardCacheKey_(game, session, epoch) {
  return 'hub:board:' + game + ':' + session + ':' + epoch;
}

function hubBoard_(body) {
  const game = body.game;
  if (HubSession.ARCADE.indexOf(game) < 0) return fail_('BAD_REQUEST', 'Unknown game.');
  const cfg = hubConfig_();
  const live = hubLive_();
  if (!HubSession.availability(cfg, live, game, false).listed && !adminCheck_(body).ok) return fail_('NOT_AVAILABLE', 'This game isn’t available right now.');
  const epoch = live.games[game].epoch;
  const key = boardCacheKey_(game, cfg.session.code, epoch);
  let rows = cacheGet_(key);
  if (!rows) {
    rows = readResults_(resultsSheet_())
      .filter(function (r) { return r.game === game && r.session === cfg.session.code && r.epoch === epoch && !r.tiebreak; })
      .map(function (r) { return { nickname: r.nickname, team: r.team, device: r.device, score: r.score, levels: r.levels, timeMs: r.timeMs, at: r.at, detail: r.detail }; });
    cachePut_(key, rows, BOARD_CACHE_SEC);
  }
  const board = boardFrom_(game, rows, token_(body.deviceId));
  return ok_({ players: board.players, teams: board.teams, total: board.all.length });
}

// ───────────── Team Showdown: team phones ─────────────

function showdownListed_(cfg) {
  return HubSession.availability(cfg, hubLive_(), 'team-showdown', false).listed;
}

function showdownJoin_(body) {
  const cfg = hubConfig_();
  if (!showdownListed_(cfg)) return fail_('NOT_AVAILABLE', 'Team Showdown isn’t open right now.');
  const device = token_(body.deviceId);
  const code = String(body.code == null ? '' : body.code);
  const team = Number(body.team);
  if (!device || !/^\d{4}$/.test(code) || !Number.isInteger(team)) return fail_('BAD_REQUEST', 'Choose your team and enter its 4-digit code.');
  const cache = CacheService.getScriptCache();
  const dKey = 'join:' + device;
  const tKey = 'joinfail:' + team;
  const dFails = Number(cache.get(dKey)) || 0;
  const tFails = Number(cache.get(tKey)) || 0;
  if (dFails >= 10 || tFails >= 30) return fail_('LOCKED', 'Too many wrong codes. Wait a few minutes and try again.');
  return withLock_(function () {
    const sdCfg = cfg.games['team-showdown'];
    const st = hubShowdown_(cfg, true);
    if (team < 0 || team >= sdCfg.settings.teamCount || st.joinCodes[team] !== code) {
      cache.put(dKey, String(dFails + 1), 600);
      cache.put(tKey, String(tFails + 1), 600);
      return fail_('BAD_CODE', 'That code doesn’t match. Check the big screen.');
    }
    const token = Utilities.getUuid();
    st.tokens = st.tokens || {};
    st.tokens[token] = { team: team, device: device, at: Date.now() };
    Object.keys(st.tokens)
      .filter(function (k) { return st.tokens[k].team === team; })
      .sort(function (a, b) { return st.tokens[b].at - st.tokens[a].at; })
      .slice(MAX_TEAM_DEVICES)
      .forEach(function (k) { delete st.tokens[k]; });
    saveHubShowdown_(st);
    return ok_({ token: token, team: team, name: sdCfg.settings.teamNames[team] });
  });
}

function teamAction_(body, buildAction) {
  const cfg = hubConfig_();
  if (!showdownListed_(cfg)) return fail_('NOT_AVAILABLE', 'Team Showdown isn’t open right now.');
  return withLock_(function () {
    const sdCfg = cfg.games['team-showdown'];
    let st = hubShowdown_(cfg, true);
    const t = typeof body.token === 'string' && st.tokens ? st.tokens[body.token] : null;
    if (!t) return fail_('NO_TEAM', 'Please join your team again.');
    const actions = buildAction(t.team);
    for (let i = 0; i < actions.length; i++) {
      const out = ShowdownCore.reduce(st, actions[i], sdCfg, Date.now(), Math.random);
      if (out.error) return fail_('NOT_NOW', out.error);
      st = out.state;
    }
    saveHubShowdown_(st);
    return ok_({ state: ShowdownCore.publicView(st, sdCfg, Date.now(), false) });
  });
}

function buzz_(body) {
  return teamAction_(body, function (team) { return [{ type: 'buzz', team: team }]; });
}

function wager_(body) {
  return teamAction_(body, function (team) {
    const actions = [];
    if (body.amount != null) actions.push({ type: 'setWager', team: team, amount: body.amount });
    if (body.answer != null) actions.push({ type: 'wagerAnswer', team: team, text: body.answer });
    return actions;
  });
}

// ───────────── Admin ─────────────

function adminState_() {
  const cfg = hubConfig_();
  const live = hubLive_();
  const sd = hubShowdown_(cfg);
  return ok_({ config: cfg, live: live, showdown: sd, showdownPublic: ShowdownCore.publicView(sd, cfg.games['team-showdown'], Date.now(), false) });
}

function saveConfig_(body) {
  return withLock_(function () {
    const current = hubConfig_(true);
    const clean = HubDefaults.normalizeConfig(body.defaults === true ? HubDefaults.defaults() : body.config);
    HubDefaults.GAME_IDS.forEach(function (id) {
      clean.games[id].visible = current.games[id].visible;
      clean.games[id].enabled = current.games[id].enabled;
    });
    saveHubConfig_(clean);
    const live = hubLive_(true);
    live.rev += 1;
    saveHubLive_(live);
    const sd = hubShowdown_(clean, true);
    if (sd.phase === 'lobby') {
      const out = ShowdownCore.reduce(sd, { type: 'syncTeams' }, clean.games['team-showdown'], Date.now(), Math.random);
      if (out.state) saveHubShowdown_(out.state);
    }
    return ok_({ config: clean, live: live });
  });
}

function control_(body) {
  return withLock_(function () {
    const cfg = hubConfig_(true);
    const live = hubLive_(true);
    const out = HubSession.control(cfg, live, body.game, body.op, body.args || {}, Date.now(), Math.random);
    if (out.error) return fail_('BAD_CONTROL', out.error);
    if (JSON.stringify(out.config) !== JSON.stringify(cfg)) saveHubConfig_(out.config);
    saveHubLive_(out.live);
    let sd = hubShowdown_(out.config, true);
    if (body.game === 'team-showdown' && body.op === 'reset') {
      sd = ShowdownCore.reduce(sd, { type: 'reset' }, out.config.games['team-showdown'], Date.now(), Math.random).state;
      saveHubShowdown_(sd);
    }
    return ok_({ config: out.config, live: out.live, showdown: sd });
  });
}

function showdownOp_(body) {
  if (SHOWDOWN_HOST_OPS.indexOf(body.op) < 0) return fail_('BAD_REQUEST', 'Unknown action.');
  return withLock_(function () {
    const cfg = hubConfig_(true);
    const st = hubShowdown_(cfg, true);
    const action = Object.assign({}, body.args || {}, { type: body.op });
    const out = ShowdownCore.reduce(st, action, cfg.games['team-showdown'], Date.now(), Math.random);
    if (out.error) return fail_('NOT_NOW', out.error);
    saveHubShowdown_(out.state);
    return ok_({ showdown: out.state });
  });
}

function results_(body) {
  const game = body.game;
  if (HubDefaults.GAME_IDS.indexOf(game) < 0) return fail_('BAD_REQUEST', 'Unknown game.');
  const cfg = hubConfig_();
  const live = hubLive_();
  if (game === 'redeemers-challenge') {
    const since = live.games[game].resetAt || 0;
    const rows = sheetAvailable_() ? readRows_(sheet_()) : [];
    return ok_({
      rows: rows.filter(function (r) { return r.session === cfg.session.code; }).map(function (r) {
        return { id: r.attempt, at: r.time, nickname: r.nickname, score: r.score, correct: r.correct, total: QUESTION_KEY.length, device: r.device, status: 'ok', current: r.time > since };
      }),
    });
  }
  if (game === 'team-showdown') return ok_({ rows: [] });
  const epoch = live.games[game].epoch;
  const rows = readResults_(resultsSheet_())
    .filter(function (r) { return r.game === game && r.session === cfg.session.code; })
    .map(function (r) {
      return { id: r.id, at: r.at, nickname: r.nickname, team: r.team, device: r.device, score: r.score, levels: r.levels, timeMs: r.timeMs, detail: r.detail, status: r.status, tiebreak: r.tiebreak, current: r.epoch === epoch };
    });
  return ok_({ rows: rows, epoch: epoch });
}

function adjustScore_(body, auth) {
  const score = Math.round(Number(body.score));
  if (!isFinite(score) || score < 0 || score > 10000000) return fail_('BAD_REQUEST', 'Enter a score of 0 or more.');
  const id = String(body.id || '');
  if (!id) return fail_('BAD_REQUEST', 'Missing entry.');
  return withLock_(function () {
    if (body.game === 'redeemers-challenge') {
      const sheet = sheet_();
      if (!sheet) return fail_('NO_LEADERBOARD', 'No scores sheet.');
      const values = sheet.getDataRange().getValues();
      for (let i = 1; i < values.length; i++) {
        if (String(values[i][9]) === id) {
          sheet.getRange(i + 1, 4).setValue(score);
          return ok_({});
        }
      }
      return fail_('NOT_FOUND', 'That score no longer exists.');
    }
    const sheet = resultsSheet_();
    const rows = readResults_(sheet);
    const row = rows.filter(function (r) { return r.id === id && r.game === body.game; })[0];
    if (!row) return fail_('NOT_FOUND', 'That score no longer exists.');
    sheet.getRange(row.row, 7).setValue(score);
    sheet.getRange(row.row, 13).setValue('adjusted');
    sheet.getRange(row.row, 15).setValue(auth.email || 'admin key');
    CacheService.getScriptCache().remove(boardCacheKey_(row.game, row.session, row.epoch));
    return ok_({});
  });
}

function resetSession_() {
  return withLock_(function () {
    let cfg = hubConfig_(true);
    let live = hubLive_(true);
    const now = Date.now();
    HubDefaults.GAME_IDS.forEach(function (id) {
      const out = HubSession.control(cfg, live, id, 'reset', {}, now, Math.random);
      cfg = out.config;
      live = out.live;
    });
    live.liveGame = null;
    saveHubLive_(live);
    const sd = ShowdownCore.reduce(hubShowdown_(cfg, true), { type: 'reset' }, cfg.games['team-showdown'], now, Math.random).state;
    saveHubShowdown_(sd);
    return ok_({ live: live, showdown: sd });
  });
}
