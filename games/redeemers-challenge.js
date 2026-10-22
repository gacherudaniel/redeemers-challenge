/*
 * Game 2 — The Redeemer's Challenge: screens, timer, sound, confetti and leaderboards.
 * Game rules live in engine.js; content lives in questions.js.
 *
 * Hub integration (the quiz itself is unchanged): the hub calls RedeemerGame.enter() and
 * .leave(); theme, sound and the title button are handled by the hub (game.js); and the
 * content is read when the game is first opened, because the Apps Script version only
 * sends it to participants while the game is visible.
 */
(function () {
  'use strict';

  let C = null; // set on first enter()
  const E = window.RedeemerEngine;
  const B = window.RedeemerBackend;
  const CONFIG = window.REDEEMER_CONFIG || {};
  const LETTERS = ['A', 'B', 'C', 'D'];
  const RING_LENGTH = 119.38; // 2πr for the timer ring (r = 19)
  const reducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const $ = (id) => document.getElementById(id);

  // ───────────── Storage (always optional: private windows may block it) ─────────────

  const store = {
    get(area, key, fallback) {
      try {
        const raw = window[area].getItem(key);
        return raw ? JSON.parse(raw) : fallback;
      } catch (e) {
        return fallback;
      }
    },
    set(area, key, value) {
      try { window[area].setItem(key, JSON.stringify(value)); } catch (e) { /* not available */ }
    },
    remove(area, key) {
      try { window[area].removeItem(key); } catch (e) { /* not available */ }
    },
  };
  const KEYS = {
    prefs: 'redeemer.prefs.v1',
    device: 'redeemer.device.v1',
    board: 'redeemer.board.v1', // sessionStorage: this tab's plays
  };

  function uuid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    const bytes = new Uint8Array(16);
    if (window.crypto && crypto.getRandomValues) crypto.getRandomValues(bytes);
    else for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
    return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('').replace(/^(.{8})(.{4})(.{4})(.{4})/, '$1-$2-$3-$4-');
  }

  const deviceId = (function () {
    let id = store.get('localStorage', KEYS.device, null);
    if (typeof id !== 'string' || !/^[A-Za-z0-9-]{16,64}$/.test(id)) {
      id = uuid();
      store.set('localStorage', KEYS.device, id);
    }
    return id;
  })();

  // ───────────── Preferences & page parameters ─────────────

  const prefs = Object.assign(
    { timerSec: E.normalizeTimer(CONFIG.timerSeconds), sound: true, theme: 'auto', mode: 'individual', nickname: '', teams: null },
    store.get('localStorage', KEYS.prefs, {})
  );
  prefs.timerSec = E.normalizeTimer(prefs.timerSec);

  function savePrefs() {
    store.set('localStorage', KEYS.prefs, prefs);
  }

  // Apps Script passes these on <body data-…>; GitHub Pages reads the query string.
  const query = new URLSearchParams(window.location.search);
  const ds = document.body.dataset;
  const page = {
    session: E.normalizeSession(ds.session || query.get('session')),
    mode: ds.mode || query.get('mode') || '',
    appUrl: ds.appUrl || window.location.origin + window.location.pathname,
  };

  // ───────────── Sound (Web Audio tones, no files) ─────────────

  const Sound = (function () {
    let ctx = null;
    function ready() {
      if (!window.HubPrefs.sound()) return null;
      try {
        if (!ctx) {
          const AC = window.AudioContext || window.webkitAudioContext;
          if (!AC) return null;
          ctx = new AC();
        }
        if (ctx.state === 'suspended') ctx.resume();
        return ctx;
      } catch (e) {
        return null;
      }
    }
    function tone(freq, at, dur, type, peak) {
      const c = ready();
      if (!c) return;
      const t0 = c.currentTime + at;
      const osc = c.createOscillator();
      const gain = c.createGain();
      osc.type = type || 'sine';
      osc.frequency.setValueAtTime(freq, t0);
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.exponentialRampToValueAtTime(peak || 0.08, t0 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      osc.connect(gain).connect(c.destination);
      osc.start(t0);
      osc.stop(t0 + dur + 0.05);
    }
    return {
      unlock: ready,
      correct() { tone(523.25, 0, 0.18, 'triangle'); tone(783.99, 0.1, 0.32, 'triangle'); },
      wrong() { tone(233, 0, 0.26, 'sine', 0.07); tone(196, 0.12, 0.34, 'sine', 0.06); },
      tick() { tone(880, 0, 0.05, 'square', 0.02); },
      timeUp() { tone(392, 0, 0.2, 'sine', 0.07); tone(294, 0.16, 0.36, 'sine', 0.07); },
      finish() { [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => tone(f, i * 0.11, 0.4, 'triangle', 0.06)); },
    };
  })();

  // ───────────── Confetti ─────────────

  let confettiRun = 0;
  function confetti() {
    if (reducedMotion) return;
    const canvas = $('confetti');
    const ctx = canvas.getContext && canvas.getContext('2d');
    if (!ctx) return;
    const run = ++confettiRun;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = window.innerWidth;
    const h = window.innerHeight;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const css = getComputedStyle(document.documentElement);
    const colors = ['--gold', '--olive', '--clay', '--gold-soft'].map((v) => css.getPropertyValue(v).trim() || '#b88a2c');
    const pieces = Array.from({ length: Math.min(160, Math.round(w / 6)) }, (_, i) => ({
      x: Math.random() * w,
      y: -20 - Math.random() * h * 0.6,
      vx: (Math.random() - 0.5) * 2.4,
      vy: 2 + Math.random() * 3,
      rot: Math.random() * Math.PI,
      vr: (Math.random() - 0.5) * 0.2,
      size: 6 + Math.random() * 6,
      color: colors[i % colors.length],
    }));
    const started = performance.now();
    function frame(now) {
      if (run !== confettiRun) return;
      ctx.clearRect(0, 0, w, h);
      let alive = false;
      for (const p of pieces) {
        p.x += p.vx;
        p.y += p.vy;
        p.vy += 0.035;
        p.rot += p.vr;
        if (p.y < h + 20) alive = true;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 1.4 * Math.abs(Math.cos(p.rot)) + 1);
        ctx.restore();
      }
      if (alive && now - started < 5000) requestAnimationFrame(frame);
      else ctx.clearRect(0, 0, w, h);
    }
    requestAnimationFrame(frame);
  }

  // ───────────── Small UI helpers ─────────────

  let toastTimer = null;
  function toast(message, ms) {
    const el = $('toast');
    el.textContent = message;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, ms || 3200);
  }

  function announce(text) {
    const el = $('liveRegion');
    el.textContent = '';
    setTimeout(() => { el.textContent = text; }, 30);
  }

  function svgIcon(id, cls) {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('aria-hidden', 'true');
    if (cls) svg.setAttribute('class', cls);
    const use = document.createElementNS(ns, 'use');
    use.setAttribute('href', '#' + id);
    svg.appendChild(use);
    return svg;
  }

  function el(tag, cls, text) {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text != null) node.textContent = text;
    return node;
  }

  function plural(n, word) {
    return n + ' ' + word + (n === 1 ? '' : 's');
  }

  // ───────────── Screens ─────────────

  const SCREENS = ['welcome', 'setup-individual', 'setup-group', 'question', 'results', 'host'];
  let screen = 'welcome';

  function show(name, focusTarget) {
    if (name !== 'question') timer.stop();
    if (name !== 'host') stopHostPolling();
    SCREENS.forEach((s) => { $('screen-' + s).hidden = s !== name; });
    screen = name;
    $('scoreChip').hidden = !(name === 'question' && game && game.mode === 'individual');
    window.scrollTo(0, 0);
    const target = focusTarget || $('screen-' + name).querySelector('h1, h2');
    if (target) {
      if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
      target.focus({ preventScroll: true });
    }
  }

  document.addEventListener('click', (e) => {
    const go = e.target.closest('[data-go]');
    if (go) show(go.getAttribute('data-go'));
  });

  // ───────────── Welcome ─────────────

  function initWelcome() {
    document.title = C.title;
    $('welcomeTitle').textContent = C.title;
    $('tagline').textContent = C.tagline;
    $('introText').textContent = C.intro;
    // A join link with a session code is for phones, so it defaults to individual play.
    const mode = page.mode === 'group' || page.mode === 'individual' ? page.mode : page.session ? 'individual' : prefs.mode;
    const radio = document.querySelector('input[name="mode"][value="' + mode + '"]');
    if (radio) radio.checked = true;
    renderBackendStatus();
  }

  function selectedMode() {
    const checked = document.querySelector('input[name="mode"]:checked');
    return checked && checked.value === 'group' ? 'group' : 'individual';
  }

  $('startBtn').addEventListener('click', () => {
    Sound.unlock();
    const mode = selectedMode();
    prefs.mode = mode;
    savePrefs();
    if (mode === 'group') openGroupSetup();
    else openIndividualSetup();
  });

  function sharedBoardPossible() {
    return B.kind !== 'none' && !(B.status.checked && !B.status.leaderboard);
  }

  function renderBackendStatus() {
    const out = $('backendStatus');
    out.textContent = '';
    const dot = el('span', 'dot');
    let text;
    if (B.kind === 'none') {
      text = 'Playing locally on this device. No sign-in needed.';
    } else if (!B.status.checked) {
      text = 'Checking the shared leaderboard…';
    } else if (B.status.leaderboard) {
      dot.classList.add('ok');
      text = 'Shared leaderboard connected.';
    } else if (B.status.connected) {
      text = 'Playing locally (the shared leaderboard is not set up).';
    } else {
      text = 'Shared leaderboard unavailable, so scores stay on this device.';
    }
    out.append(dot, document.createTextNode(text));
    $('hostBtn').hidden = !B.status.leaderboard;
    $('sessionField').hidden = !sharedBoardPossible();
  }

  // ───────────── Setup: individual ─────────────

  function openIndividualSetup() {
    $('nickname').value = prefs.nickname || window.HubPrefs.get().nickname || '';
    const hubCode = window.HubStore && window.HubStore.mode === 'shared' && window.HubStore.state() ? window.HubStore.state().session.code : '';
    if ((page.session || hubCode) && !$('sessionCode').value) $('sessionCode').value = page.session || hubCode;
    setFieldError('nickname', 'nicknameError', '');
    setFieldError('sessionCode', 'sessionError', '');
    $('sessionField').hidden = !sharedBoardPossible();
    show('setup-individual', $('nickname'));
  }

  function setFieldError(inputId, errorId, message) {
    $(errorId).textContent = message;
    if (message) $(inputId).setAttribute('aria-invalid', 'true');
    else $(inputId).removeAttribute('aria-invalid');
  }

  $('individualForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const nick = E.validateNickname($('nickname').value);
    setFieldError('nickname', 'nicknameError', nick.ok ? '' : nick.error);
    let session = '';
    const rawSession = $('sessionField').hidden ? '' : $('sessionCode').value.trim();
    if (rawSession) {
      session = E.normalizeSession(rawSession);
      setFieldError('sessionCode', 'sessionError', session ? '' : 'Session codes are 3–16 letters or numbers.');
    } else {
      setFieldError('sessionCode', 'sessionError', '');
    }
    if (!nick.ok) return $('nickname').focus();
    if (rawSession && !session) return $('sessionCode').focus();
    prefs.nickname = nick.value;
    savePrefs();
    startGame({ mode: 'individual', players: [nick.value], session });
  });

  // ───────────── Setup: group ─────────────

  function openGroupSetup() {
    const teams = Array.isArray(prefs.teams) && prefs.teams.length ? prefs.teams : ['Team 1', 'Team 2'];
    $('teamInputs').textContent = '';
    teams.slice(0, E.MAX_TEAMS).forEach((name) => addTeamInput(name));
    $('teamError').textContent = '';
    show('setup-group');
  }

  function addTeamInput(value) {
    const list = $('teamInputs');
    if (list.children.length >= E.MAX_TEAMS) return null;
    const li = el('li');
    const num = el('span', 'team-num');
    const input = el('input', 'input');
    input.maxLength = E.NAME_MAX;
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.value = value || '';
    input.addEventListener('focus', () => input.select());
    const remove = el('button', 'remove');
    remove.type = 'button';
    remove.appendChild(svgIcon('i-x'));
    remove.addEventListener('click', () => {
      if (list.children.length > 1) {
        li.remove();
        renumberTeams();
        const last = list.querySelector('li:last-child input');
        if (last) last.focus();
      }
    });
    li.append(num, input, remove);
    list.appendChild(li);
    renumberTeams();
    return input;
  }

  function renumberTeams() {
    const items = Array.from($('teamInputs').children);
    items.forEach((li, i) => {
      li.querySelector('.team-num').textContent = i + 1;
      li.querySelector('input').setAttribute('aria-label', 'Team ' + (i + 1) + ' name');
      const remove = li.querySelector('.remove');
      remove.setAttribute('aria-label', 'Remove team ' + (i + 1));
      remove.hidden = items.length === 1;
    });
    $('addTeamBtn').hidden = items.length >= E.MAX_TEAMS;
  }

  $('addTeamBtn').addEventListener('click', () => {
    const input = addTeamInput('Team ' + ($('teamInputs').children.length + 1));
    if (input) input.focus();
  });

  $('groupForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const names = Array.from($('teamInputs').querySelectorAll('input')).map((i) => i.value);
    const result = E.validateTeams(names);
    $('teamError').textContent = result.ok ? '' : result.error;
    if (!result.ok) return;
    prefs.teams = result.value;
    savePrefs();
    startGame({ mode: 'group', players: result.value, session: '' });
  });

  // ───────────── Game loop ─────────────

  let game = null;
  let run = null; // per-play details: { setup, attemptId, submitted, entryId }
  let questionStartedAt = 0;

  const timer = E.createTimer({
    now: () => performance.now(),
    schedule: (fn, ms) => setInterval(fn, ms),
    cancel: (handle) => clearInterval(handle),
  });

  function startGame(setup) {
    game = E.createGame({ questions: C.questions, mode: setup.mode, durationSec: prefs.timerSec, players: setup.players });
    run = { setup, attemptId: uuid(), submitted: false, entryId: null };
    show('question');
    renderQuestion();
  }

  function renderQuestion() {
    const q = game.current();
    const group = game.mode === 'group';
    $('progressLabel').textContent = 'Question ' + (game.index + 1) + ' of ' + game.total;
    $('progressFill').style.width = (game.index / game.total) * 100 + '%';
    $('questionPrompt').textContent = q.prompt;
    $('questionHint').textContent = group
      ? 'Call out your answer! The facilitator can highlight it, then reveal.'
      : game.durationSec
        ? 'Tap an answer. Faster answers earn bonus points.'
        : 'Tap an answer.';

    const box = $('choices');
    box.textContent = '';
    q.choices.forEach((text, i) => {
      const btn = el('button', 'choice');
      btn.type = 'button';
      btn.dataset.index = String(i);
      if (group) btn.setAttribute('aria-pressed', 'false');
      btn.append(el('span', 'choice-letter', LETTERS[i]), el('span', 'choice-text', text), svgIcon('i-check', 'choice-mark mark-check'), svgIcon('i-x', 'choice-mark mark-x'));
      box.appendChild(btn);
    });

    $('feedback').hidden = true;
    $('facilitatorBar').hidden = !group;
    $('revealBtn').disabled = false;
    setPauseButton(false);
    $('pauseBtn').hidden = !game.durationSec;
    renderTeamStrip();
    updateScoreChip();

    questionStartedAt = performance.now();
    if (game.durationSec) startTimer();
    else {
      timer.stop();
      $('timer').classList.add('is-off');
    }
    $('questionPrompt').focus({ preventScroll: true });
  }

  function startTimer() {
    const wrap = $('timer');
    wrap.classList.remove('is-low', 'is-paused', 'is-off');
    let lastSecond = null;
    timer.start(
      game.durationSec,
      (remaining, total) => {
        const secs = Math.ceil(remaining / 1000);
        $('timerValue').textContent = String(secs);
        $('timerRing').style.strokeDashoffset = String(RING_LENGTH * (1 - remaining / total));
        wrap.classList.toggle('is-low', secs <= 5);
        if (secs !== lastSecond) {
          if (lastSecond !== null && secs > 0 && secs <= 3) Sound.tick();
          lastSecond = secs;
          wrap.setAttribute('aria-label', plural(secs, 'second') + ' remaining');
        }
      },
      onTimeUp
    );
  }

  function onTimeUp() {
    if (!game || game.phase !== 'question') return;
    Sound.timeUp();
    if (game.mode === 'individual') {
      showFeedback(game.timeout());
      return;
    }
    $('questionHint').textContent = 'Time’s up! Reveal the answer when the room is ready.';
    $('pauseBtn').hidden = true;
    announce('Time’s up.');
  }

  function choose(index) {
    if (!game || game.phase !== 'question') return;
    if (game.mode === 'group') {
      if (!game.answer(index)) return;
      Array.from($('choices').children).forEach((btn, i) => {
        btn.classList.toggle('is-selected', i === index);
        btn.setAttribute('aria-pressed', String(i === index));
      });
      return;
    }
    const elapsed = game.durationSec ? timer.elapsedMs() : performance.now() - questionStartedAt;
    timer.stop();
    const response = game.answer(index, elapsed);
    if (response) showFeedback(response);
  }

  $('choices').addEventListener('click', (e) => {
    const btn = e.target.closest('.choice');
    if (btn && !btn.disabled) choose(Number(btn.dataset.index));
  });

  function setPauseButton(paused) {
    const btn = $('pauseBtn');
    btn.querySelector('use').setAttribute('href', paused ? '#i-play' : '#i-pause');
    btn.querySelector('span').textContent = paused ? 'Resume' : 'Pause';
    $('timer').classList.toggle('is-paused', paused);
    if (paused) $('timerValue').textContent = 'Paused';
  }

  function togglePause() {
    if (!game || game.phase !== 'question' || !game.durationSec) return;
    if (timer.paused) {
      timer.resume();
      setPauseButton(false);
    } else if (timer.pause()) {
      setPauseButton(true);
    }
  }

  $('pauseBtn').addEventListener('click', togglePause);
  $('revealBtn').addEventListener('click', reveal);

  function reveal() {
    if (!game || game.mode !== 'group' || game.phase !== 'question') return;
    timer.stop();
    showFeedback(game.reveal());
  }

  function showFeedback(r) {
    timer.stop();
    const q = game.current();
    const group = game.mode === 'group';
    Array.from($('choices').children).forEach((btn, i) => {
      btn.disabled = true;
      btn.classList.remove('is-selected');
      btn.removeAttribute('aria-pressed');
      if (i === q.answer) btn.classList.add('is-correct');
      else if (i === r.choice) btn.classList.add('is-wrong');
      else btn.classList.add('is-dim');
    });
    $('progressFill').style.width = ((game.index + 1) / game.total) * 100 + '%';
    $('facilitatorBar').hidden = true;

    const verdict = $('verdict');
    verdict.textContent = '';
    let label;
    let kind;
    if (r.timedOut) { label = 'Time’s up'; kind = 'neutral'; }
    else if (group && r.choice === -1) { label = 'The answer'; kind = 'neutral'; }
    else if (r.correct) { label = 'Correct!'; kind = 'ok'; }
    else { label = 'Not quite'; kind = 'no'; }
    verdict.className = 'verdict ' + kind;
    if (kind !== 'neutral') verdict.appendChild(svgIcon(kind === 'ok' ? 'i-check' : 'i-x'));
    verdict.appendChild(document.createTextNode(label));

    const answerLine = LETTERS[q.answer] + ': ' + q.choices[q.answer];
    const text = $('feedbackText');
    text.textContent = '';
    if (!r.correct) {
      text.appendChild(el('strong', null, 'The answer is ' + answerLine + ' '));
      text.appendChild(document.createElement('br'));
    }
    text.appendChild(document.createTextNode(q.explanation));
    $('feedbackRef').textContent = q.reference;

    const pts = $('pointsEarned');
    if (group) pts.textContent = '';
    else {
      const bonus = r.points - E.POINTS_PER_CORRECT;
      pts.textContent = '+' + r.points + (r.correct && bonus > 0 ? ' (' + bonus + ' speed bonus)' : '');
    }

    $('teamAward').hidden = !group;
    if (group) renderTeamChips();

    const last = game.index + 1 >= game.total;
    $('nextBtn').textContent = last ? 'See results' : 'Next question';
    $('feedback').hidden = false;

    if (!r.timedOut && !(group && r.choice === -1)) (r.correct ? Sound.correct : Sound.wrong)();
    announce(label + '. The answer is ' + answerLine + '. ' + q.reference + '.');
    updateScoreChip();
    renderTeamStrip();
    $('nextBtn').focus({ preventScroll: true });
    $('feedback').scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth', block: 'nearest' });
  }

  function renderTeamChips() {
    const box = $('teamChips');
    box.textContent = '';
    const players = game.players();
    const awarded = game.response().awarded;
    $('teamAwardLabel').textContent = players.length === 1 ? 'Did the room get it right?' : 'Tap each team that answered correctly:';
    players.forEach((p, i) => {
      const chip = el('button', 'team-chip');
      chip.type = 'button';
      chip.setAttribute('aria-pressed', String(awarded.indexOf(i) >= 0));
      chip.append(svgIcon('i-check'), document.createTextNode(players.length === 1 ? 'Yes, ' + p.name + ' got it' : p.name));
      chip.addEventListener('click', () => {
        const on = chip.getAttribute('aria-pressed') !== 'true';
        if (!game.setAward(i, on)) return;
        chip.setAttribute('aria-pressed', String(on));
        if (on) Sound.correct();
        renderTeamStrip(i);
      });
      box.appendChild(chip);
    });
  }

  function renderTeamStrip(bumpIndex) {
    const strip = $('teamStrip');
    if (!game || game.mode !== 'group') {
      strip.hidden = true;
      return;
    }
    strip.hidden = false;
    strip.textContent = '';
    game.players().forEach((p, i) => {
      const chip = el('span', 'team-score' + (i === bumpIndex ? ' bump' : ''));
      chip.append(document.createTextNode(p.name), el('strong', null, String(p.score)));
      strip.appendChild(chip);
    });
  }

  function updateScoreChip() {
    if (game && game.mode === 'individual') $('scoreValue').textContent = String(game.players()[0].score);
  }

  $('nextBtn').addEventListener('click', advance);

  function advance() {
    if (!game || game.phase !== 'revealed') return;
    if (game.next()) renderQuestion();
    else finishGame();
  }

  document.addEventListener('keydown', (e) => {
    if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
    if (screen !== 'question' || !game || $('settingsDialog').open) return;
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
    const key = e.key.toLowerCase();
    if (game.phase === 'question') {
      let index = ['1', '2', '3', '4'].indexOf(key);
      if (index < 0) index = ['a', 'b', 'c', 'd'].indexOf(key);
      if (index >= 0 && index < game.current().choices.length) {
        e.preventDefault();
        choose(index);
      } else if (game.mode === 'group' && key === 'r') {
        e.preventDefault();
        reveal();
      } else if (game.mode === 'group' && key === 'p') {
        e.preventDefault();
        togglePause();
      }
    } else if (game.phase === 'revealed' && (key === 'n' || key === 'arrowright')) {
      e.preventDefault();
      advance();
    }
  });

  // ───────────── Results ─────────────

  function finishGame() {
    timer.stop();
    const standings = game.standings();
    const summary = $('scoreSummary');
    summary.textContent = '';

    if (game.mode === 'individual') {
      const me = standings[0];
      const award = E.achievementFor(me.correct, game.total);
      $('resultsEyebrow').textContent = me.name + ', your achievement';
      $('achievementTitle').textContent = award.title;
      $('achievementBlurb').textContent = award.blurb;
      summary.append(stat(me.score, 'points', 'finalScore'), stat(me.correct + ' / ' + game.total, 'correct'));
      run.entryId = run.attemptId;
      saveLocalEntry({ id: run.entryId, name: me.name, score: me.score, correct: me.correct, total: game.total, at: Date.now() });
      renderLocalBoard();
      if (run.setup.session && B.kind !== 'none') submitShared();
    } else {
      const top = standings[0];
      const tied = standings.filter((t) => t.score === top.score);
      const award = E.achievementFor(top.correct, game.total);
      if (standings.length === 1) $('resultsEyebrow').textContent = 'The room’s achievement';
      else if (tied.length > 1) $('resultsEyebrow').textContent = 'A tie between ' + tied.map((t) => t.name).join(' and ');
      else $('resultsEyebrow').textContent = 'Winning team: ' + top.name;
      $('achievementTitle').textContent = award.title;
      $('achievementBlurb').textContent = award.blurb;
      summary.append(stat(top.score, 'points'), stat(top.correct + ' / ' + game.total, 'correct'));
      renderBoard({
        title: standings.length === 1 ? 'Final score' : 'Team standings',
        meta: plural(game.total, 'question'),
        rows: rankRows(standings).map((t) => ({ rank: t.rank, name: t.name, detail: t.correct + ' / ' + game.total + ' correct', score: t.score })),
        note: '',
      });
    }

    show('results');
    Sound.finish();
    confetti();
  }

  function stat(value, label, id) {
    const box = el('div', 'stat');
    const v = el('span', 'stat-value', String(value));
    if (id) v.id = id;
    box.append(v, el('span', 'stat-label', label));
    return box;
  }

  /** Standard competition ranking (1, 2, 2, 4) over rows already sorted by score. */
  function rankRows(rows) {
    let rank = 0;
    return rows.map((row, i) => {
      if (i === 0 || row.score !== rows[i - 1].score) rank = i + 1;
      return Object.assign({ rank }, row);
    });
  }

  function renderBoard(opts) {
    $('leaderboardTitle').textContent = opts.title;
    $('leaderboardMeta').textContent = opts.meta || '';
    fillBoard($('leaderboard'), opts.rows);
    setBoardNote(opts.note || '');
  }

  function fillBoard(list, rows) {
    list.textContent = '';
    if (!rows.length) {
      list.appendChild(el('li', 'leaderboard-empty', 'No scores yet.'));
      return;
    }
    rows.forEach((row) => {
      const li = el('li', row.you ? 'is-you' : '');
      const who = el('span', 'who', row.name);
      if (row.detail) who.appendChild(el('small', null, row.detail));
      li.append(el('span', 'rank', String(row.rank)), who, el('span', 'pts', String(row.score)));
      list.appendChild(li);
    });
  }

  function setBoardNote(content) {
    const note = $('leaderboardNote');
    note.textContent = '';
    if (typeof content === 'string') note.textContent = content;
    else note.append(...content);
  }

  function loadLocalBoard() {
    const list = store.get('sessionStorage', KEYS.board, []);
    return Array.isArray(list) ? list : [];
  }

  function saveLocalEntry(entry) {
    const list = loadLocalBoard().filter((e) => e.id !== entry.id);
    list.push(entry);
    store.set('sessionStorage', KEYS.board, list.slice(-50));
  }

  function renderLocalBoard() {
    const sorted = loadLocalBoard().sort((a, b) => b.score - a.score || a.at - b.at);
    const rows = rankRows(sorted)
      .slice(0, 10)
      .map((e) => ({ rank: e.rank, name: e.name, detail: e.correct + ' / ' + e.total + ' correct', score: e.score, you: e.id === run.entryId }));
    renderBoard({
      title: 'Leaderboard',
      meta: 'This device',
      rows,
      note: sorted.length > 1 ? '' : 'Pass the device on, or tap Play again, to add more players.',
    });
  }

  async function submitShared() {
    if (run.submitted) return;
    run.submitted = true;
    const thisRun = run;
    setBoardNote('Sending your score to the shared leaderboard…');
    try {
      const data = await B.call('submitScore', {
        session: run.setup.session,
        nickname: run.setup.players[0],
        deviceId,
        attemptId: run.attemptId,
        timerSec: game.durationSec,
        answers: game.answersForServer(),
      });
      if (thisRun !== run) return;
      const finalScore = $('finalScore');
      if (finalScore) finalScore.textContent = String(data.score);
      renderBoard({
        title: 'Shared leaderboard',
        meta: 'Session ' + data.session,
        rows: data.leaderboard.map((r) => ({ rank: r.rank, name: r.nickname, detail: r.correct + ' / ' + data.total + ' correct', score: r.score, you: r.you })),
        note: data.duplicate
          ? 'Your score was already recorded.'
          : 'You are #' + data.rank + ' of ' + plural(data.players, 'player') + ' in this session.',
      });
    } catch (err) {
      if (thisRun !== run) return;
      run.submitted = false;
      const retry = el('button', 'btn btn-link', 'Try again');
      retry.type = 'button';
      retry.addEventListener('click', submitShared);
      setBoardNote([document.createTextNode('Couldn’t reach the shared leaderboard: ' + err.message + ' Your score is saved on this device. '), retry]);
    }
  }

  function playAgain() {
    if (!run) return show('welcome');
    startGame(run.setup);
  }

  $('playAgainBtn').addEventListener('click', playAgain);

  // ───────────── Host: live shared leaderboard ─────────────

  let hostSession = '';
  let hostTimer = null;

  $('hostBtn').addEventListener('click', () => {
    const suggestion = page.session || prefs.hostSession || 'RUTH-' + Math.random().toString(36).slice(2, 5).toUpperCase();
    $('hostSession').value = suggestion;
    $('hostError').textContent = '';
    $('hostLive').hidden = true;
    show('host');
  });

  $('hostForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const code = E.normalizeSession($('hostSession').value);
    $('hostError').textContent = code ? '' : 'Session codes are 3–16 letters or numbers.';
    if (!code) return;
    prefs.hostSession = code;
    savePrefs();
    $('hostSession').value = code;
    hostSession = code;
    $('joinUrl').textContent = page.appUrl + '?mode=individual&session=' + encodeURIComponent(code);
    $('joinCode').textContent = code;
    $('hostLive').hidden = false;
    stopHostPolling();
    pollHost();
  });

  async function pollHost() {
    if (screen !== 'host' || !hostSession) return;
    const code = hostSession;
    if (!document.hidden) {
      try {
        const data = await B.call('leaderboard', { session: code, deviceId });
        if (screen !== 'host' || code !== hostSession) return;
        fillBoard($('hostBoard'), data.leaderboard.map((r) => ({ rank: r.rank, name: r.nickname, detail: r.correct + ' / ' + data.total + ' correct', score: r.score })));
        $('hostMeta').textContent = plural(data.players, 'player') + ' · updated ' + new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      } catch (err) {
        $('hostMeta').textContent = 'Reconnecting…';
      }
    }
    if (screen === 'host' && code === hostSession) hostTimer = setTimeout(pollHost, 5000);
  }

  function stopHostPolling() {
    clearTimeout(hostTimer);
    hostTimer = null;
  }

  // ───────────── Settings (the hub opens the dialog and owns theme and sound) ─────────────

  $('settingsBtn').addEventListener('click', () => {
    $('timerSelect').value = String(prefs.timerSec);
  });

  $('timerSelect').addEventListener('change', (e) => {
    prefs.timerSec = E.normalizeTimer(e.target.value);
    savePrefs();
  });

  $('clearBoardBtn').addEventListener('click', () => {
    store.remove('sessionStorage', KEYS.board);
    if (screen === 'results' && game && game.mode === 'individual') {
      run.entryId = null;
      renderLocalBoard();
    }
    toast('This device’s leaderboard was cleared.');
  });

  // ───────────── Hub entry points ─────────────

  window.RedeemerGame = {
    /** Shows the quiz's welcome screen. Content must be in window.REDEEMER_CONTENT. */
    enter() {
      if (!C) {
        C = window.REDEEMER_CONTENT;
        initWelcome();
        if (B.kind !== 'none') B.check().then(renderBackendStatus);
      }
      show('welcome');
    },
    leave() {
      timer.stop();
      stopHostPolling();
      SCREENS.forEach((s) => { $('screen-' + s).hidden = true; });
      $('scoreChip').hidden = true;
    },
    /** True while a question is on screen, so the hub asks before leaving. */
    isBusy: () => screen === 'question' && !!game && game.phase !== 'finished',
  };

  // Exposed for automated browser checks only.
  window.__redeemer = { get game() { return game; }, get screen() { return screen; } };
})();
