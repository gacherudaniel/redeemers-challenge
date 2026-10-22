/*
 * Game 1 — Gleaner's Rush: catch falling barley in a basket, dodge stones and thorns.
 * Rules and simulation live in rush-core.js; this file draws it and handles input.
 */
(function (root) {
  'use strict';

  const U = root.HubUtil;
  const Core = root.RushCore;
  const ID = 'gleaners-rush';
  const KEY_SPEED = 1.5; // basket speed with the keyboard, field widths per second

  // ───────────── Sprites (drawn once per size, then reused every frame) ─────────────

  function sprite(size, draw, halo) {
    const c = document.createElement('canvas');
    c.width = c.height = Math.max(8, Math.round(size));
    const g = c.getContext('2d');
    if (halo) {
      // A soft dark outline keeps items readable against the golden field.
      g.shadowColor = 'rgba(45, 25, 8, 0.75)';
      g.shadowBlur = c.width * 0.07;
    }
    draw(g, c.width);
    return c;
  }

  function drawSheaf(g, s, golden) {
    if (golden) {
      g.save();
      g.shadowColor = 'transparent';
      const glow = g.createRadialGradient(s / 2, s / 2, s * 0.1, s / 2, s / 2, s * 0.5);
      glow.addColorStop(0, 'rgba(255, 226, 120, 0.85)');
      glow.addColorStop(1, 'rgba(255, 226, 120, 0)');
      g.fillStyle = glow;
      g.fillRect(0, 0, s, s);
      g.restore();
    }
    const stalk = golden ? '#e0a400' : '#b8892b';
    const head = golden ? '#ffd54a' : '#e2bb5c';
    const base = { x: s * 0.5, y: s * 0.94 };
    const tops = [-0.3, -0.15, 0, 0.15, 0.3];
    g.lineCap = 'round';
    tops.forEach((dx, i) => {
      const tx = s * (0.5 + dx);
      const ty = s * (0.2 + Math.abs(dx) * 0.35);
      g.strokeStyle = stalk;
      g.lineWidth = s * 0.05;
      g.beginPath();
      g.moveTo(base.x, base.y);
      g.quadraticCurveTo(s * (0.5 + dx * 0.3), s * 0.55, tx, ty);
      g.stroke();
      g.fillStyle = head;
      for (let k = 0; k < 3; k++) {
        const hy = ty + k * s * 0.07;
        g.beginPath();
        g.ellipse(tx - s * 0.035, hy, s * 0.03, s * 0.055, -0.5, 0, Math.PI * 2);
        g.ellipse(tx + s * 0.035, hy, s * 0.03, s * 0.055, 0.5, 0, Math.PI * 2);
        g.fill();
      }
      g.beginPath();
      g.ellipse(tx, ty - s * 0.05, s * 0.028, s * 0.06, 0, 0, Math.PI * 2);
      g.fill();
      if (i === 2 && golden) {
        g.fillStyle = '#fff6c8';
        g.beginPath();
        g.arc(tx + s * 0.12, ty - s * 0.06, s * 0.035, 0, Math.PI * 2);
        g.fill();
      }
    });
    g.fillStyle = golden ? '#9c5b12' : '#7a5230';
    g.fillRect(s * 0.4, s * 0.62, s * 0.2, s * 0.07);
  }

  function drawStone(g, s) {
    const pts = [1, 0.86, 0.95, 0.8, 0.92, 1, 0.85, 0.93];
    const grad = g.createRadialGradient(s * 0.4, s * 0.38, s * 0.05, s * 0.5, s * 0.5, s * 0.5);
    grad.addColorStop(0, '#b9b2a8');
    grad.addColorStop(1, '#615a52');
    g.fillStyle = grad;
    g.strokeStyle = '#3e3832';
    g.lineWidth = s * 0.04;
    g.beginPath();
    pts.forEach((r, i) => {
      const a = (i / pts.length) * Math.PI * 2;
      const x = s / 2 + Math.cos(a) * r * s * 0.42;
      const y = s / 2 + Math.sin(a) * r * s * 0.38;
      if (i === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    });
    g.closePath();
    g.fill();
    g.stroke();
    g.fillStyle = 'rgba(255,255,255,0.35)';
    g.beginPath();
    g.ellipse(s * 0.38, s * 0.36, s * 0.1, s * 0.05, -0.5, 0, Math.PI * 2);
    g.fill();
  }

  function drawThorn(g, s) {
    const c = s / 2;
    g.strokeStyle = '#4a2a1c';
    g.fillStyle = '#7d2f1d';
    g.lineWidth = s * 0.06;
    g.lineCap = 'round';
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2;
      const r1 = s * 0.18;
      const r2 = s * 0.46;
      g.beginPath();
      g.moveTo(c + Math.cos(a - 0.18) * r1, c + Math.sin(a - 0.18) * r1);
      g.lineTo(c + Math.cos(a) * r2, c + Math.sin(a) * r2);
      g.lineTo(c + Math.cos(a + 0.18) * r1, c + Math.sin(a + 0.18) * r1);
      g.closePath();
      g.fill();
    }
    g.beginPath();
    g.arc(c, c, s * 0.2, 0, Math.PI * 2);
    g.fillStyle = '#3d2417';
    g.fill();
    g.strokeStyle = '#6b3b22';
    g.lineWidth = s * 0.035;
    g.beginPath();
    g.arc(c, c, s * 0.12, 0.4, 4.5);
    g.stroke();
  }

  function drawPower(g, s, kind) {
    const c = s / 2;
    const colors = { wide: '#5f7a2a', slow: '#3f86a8', shield: '#b07d16' };
    g.fillStyle = 'rgba(255,255,255,0.55)';
    g.beginPath();
    g.arc(c, c, s * 0.48, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = colors[kind];
    g.beginPath();
    g.arc(c, c, s * 0.42, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = '#fff';
    g.fillStyle = '#fff';
    g.lineWidth = s * 0.07;
    g.lineCap = 'round';
    g.lineJoin = 'round';
    g.beginPath();
    if (kind === 'wide') {
      g.moveTo(s * 0.24, c);
      g.lineTo(s * 0.76, c);
      g.moveTo(s * 0.34, c - s * 0.1);
      g.lineTo(s * 0.24, c);
      g.lineTo(s * 0.34, c + s * 0.1);
      g.moveTo(s * 0.66, c - s * 0.1);
      g.lineTo(s * 0.76, c);
      g.lineTo(s * 0.66, c + s * 0.1);
    } else if (kind === 'slow') {
      g.moveTo(s * 0.24, s * 0.4);
      g.lineTo(s * 0.62, s * 0.4);
      g.arc(s * 0.62, s * 0.33, s * 0.07, Math.PI / 2, -Math.PI, true);
      g.moveTo(s * 0.24, s * 0.56);
      g.lineTo(s * 0.7, s * 0.56);
      g.arc(s * 0.7, s * 0.64, s * 0.08, -Math.PI / 2, Math.PI, false);
    } else {
      g.moveTo(c, s * 0.24);
      g.lineTo(s * 0.72, s * 0.32);
      g.quadraticCurveTo(s * 0.7, s * 0.66, c, s * 0.78);
      g.quadraticCurveTo(s * 0.3, s * 0.66, s * 0.28, s * 0.32);
      g.closePath();
    }
    g.stroke();
  }

  function drawBasket(g, cx, top, w, h, glow) {
    const bw = w * 0.82;
    if (glow) {
      g.save();
      g.shadowColor = glow;
      g.shadowBlur = 18;
    }
    const grad = g.createLinearGradient(0, top, 0, top + h);
    grad.addColorStop(0, '#a5733d');
    grad.addColorStop(1, '#6b4421');
    g.fillStyle = grad;
    g.beginPath();
    g.moveTo(cx - w / 2, top);
    g.lineTo(cx + w / 2, top);
    g.lineTo(cx + bw / 2, top + h);
    g.lineTo(cx - bw / 2, top + h);
    g.closePath();
    g.fill();
    if (glow) g.restore();
    g.strokeStyle = 'rgba(60, 35, 15, 0.55)';
    g.lineWidth = Math.max(1, h * 0.06);
    for (let i = 1; i < 4; i++) {
      const y = top + (h * i) / 4;
      const inset = ((w - bw) / 2) * (i / 4);
      g.beginPath();
      g.moveTo(cx - w / 2 + inset, y);
      g.lineTo(cx + w / 2 - inset, y);
      g.stroke();
    }
    for (let i = 1; i < 7; i++) {
      const fx = -0.5 + i / 7;
      g.beginPath();
      g.moveTo(cx + fx * w, top);
      g.lineTo(cx + fx * bw, top + h);
      g.stroke();
    }
    g.fillStyle = '#c99a5b';
    g.beginPath();
    g.ellipse(cx, top, w / 2 + 2, h * 0.16, 0, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = 'rgba(70, 40, 15, 0.6)';
    g.beginPath();
    g.ellipse(cx, top, w / 2 - h * 0.12, h * 0.09, 0, 0, Math.PI * 2);
    g.fill();
  }

  function drawField(g, w, h) {
    const sky = g.createLinearGradient(0, 0, 0, h * 0.65);
    sky.addColorStop(0, '#f7e8c3');
    sky.addColorStop(1, '#f1cf86');
    g.fillStyle = sky;
    g.fillRect(0, 0, w, h);
    const sun = g.createRadialGradient(w * 0.78, h * 0.15, 4, w * 0.78, h * 0.15, w * 0.42);
    sun.addColorStop(0, 'rgba(255, 244, 205, 0.95)');
    sun.addColorStop(1, 'rgba(255, 244, 205, 0)');
    g.fillStyle = sun;
    g.fillRect(0, 0, w, h);
    function hills(baseY, amp, color, phase) {
      g.fillStyle = color;
      g.beginPath();
      g.moveTo(0, h);
      for (let i = 0; i <= 40; i++) {
        const x = (w * i) / 40;
        g.lineTo(x, baseY + Math.sin((x / w) * 5 + phase) * amp + Math.sin((x / w) * 11 + phase * 2) * amp * 0.3);
      }
      g.lineTo(w, h);
      g.closePath();
      g.fill();
    }
    hills(h * 0.5, h * 0.025, 'rgba(176, 160, 105, 0.7)', 1.3);
    hills(h * 0.57, h * 0.02, '#a3a35a', 0.2);
    const field = g.createLinearGradient(0, h * 0.62, 0, h);
    field.addColorStop(0, '#dcb45a');
    field.addColorStop(1, '#b8892f');
    g.fillStyle = field;
    g.fillRect(0, h * 0.62, w, h * 0.38);
    const rng = root.HubRng.create('field-art');
    g.lineCap = 'round';
    for (let i = 0; i < 140; i++) {
      const depth = rng.next();
      const y = h * (0.64 + depth * 0.36);
      const x = rng.next() * w;
      const len = h * (0.02 + depth * 0.05);
      g.strokeStyle = 'rgba(122, 86, 30,' + (0.25 + depth * 0.35) + ')';
      g.lineWidth = 1 + depth * 1.5;
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x + len * 0.15, y - len);
      g.stroke();
      g.fillStyle = 'rgba(240, 205, 120,' + (0.4 + depth * 0.4) + ')';
      g.beginPath();
      g.ellipse(x + len * 0.15, y - len, 1.2 + depth * 2, 2.5 + depth * 3.5, 0.2, 0, Math.PI * 2);
      g.fill();
    }
    const ground = g.createLinearGradient(0, h * (Core.CATCH_Y + 0.06), 0, h);
    ground.addColorStop(0, 'rgba(110, 76, 34, 0)');
    ground.addColorStop(1, 'rgba(90, 60, 25, 0.55)');
    g.fillStyle = ground;
    g.fillRect(0, h * (Core.CATCH_Y + 0.06), w, h);
  }

  // ───────────── The game ─────────────

  let mounted = null;

  function mount(rootEl, ctx) {
    mounted = createGame(rootEl, ctx);
  }

  function createGame(rootEl, ctx) {
    const reduced = U.reducedMotion();
    const el = (tag, cls, text) => U.el(tag, cls, text);
    let busy = false;
    let destroyed = false;

    // ---- DOM ----
    const shell = el('div', 'game-shell rush');
    const intro = el('section', 'game-panel');
    const over = el('section', 'game-panel');
    over.hidden = true;
    const stage = el('div', 'stage rush-stage');
    stage.hidden = true;
    stage.setAttribute('role', 'application');
    stage.setAttribute('aria-label', 'Gleaner’s Rush playfield. Move the basket with your finger, the mouse, or the left and right arrow keys.');
    stage.tabIndex = 0;
    const canvas = el('canvas', 'rush-canvas');
    const hud = el('div', 'hud');
    const hudScore = el('div', 'hud-score', '0');
    const hudMult = el('div', 'hud-mult');
    const hudLives = el('div', 'hud-lives');
    const hudPowers = el('div', 'hud-powers');
    const hudBar = el('div', 'hud-timebar');
    const hudBarFill = el('div', 'hud-timebar-fill');
    hudBar.appendChild(hudBarFill);
    const hudLeft = el('div', 'hud-left');
    hudLeft.append(hudScore, hudMult);
    const hudRight = el('div', 'hud-right');
    const pauseBtn = U.button('', 'icon-btn stage-btn');
    pauseBtn.setAttribute('aria-label', 'Pause');
    pauseBtn.appendChild(U.svg('i-pause'));
    hudRight.append(hudPowers, hudLives, pauseBtn);
    hud.append(hudBar, hudLeft, hudRight);
    const countEl = el('div', 'stage-count');
    countEl.hidden = true;
    countEl.setAttribute('aria-live', 'assertive');
    const overlay = el('div', 'stage-overlay');
    overlay.hidden = true;
    stage.append(canvas, hud, countEl, overlay);
    shell.append(intro, over);
    rootEl.appendChild(shell);
    document.body.appendChild(stage);

    // ---- State ----
    let sim = null;
    let loop = null;
    let run = null; // { runId, seed, settings, tiebreak, roundId }
    let field = { w: 0, h: 0, dpr: 1, left: 0, top: 0 };
    let bg = null;
    let sprites = {};
    let particles = [];
    let popups = [];
    let shake = 0;
    let flash = 0;
    const keys = { left: false, right: false };
    let hudCache = {};
    let localPaused = false;
    let remotePaused = false;
    let roundTimer = null;
    let lastBest = 0;

    function game() {
      return ctx.store.game(ID);
    }

    /** In shared mode, check the server more often while it matters (pauses, round starts). */
    function pollEvery(ms) {
      if (ctx.store.mode === 'shared') ctx.store.setPollInterval(ms);
    }

    function settings() {
      const g = game();
      return (g && g.settings) || root.HubDefaults.defaults().games[ID].settings;
    }

    function identity() {
      return ctx.identity.get();
    }

    function myTiebreak(g) {
      if (!g || !g.tiebreak) return null;
      const me = identity().nickname.toLowerCase();
      return g.tiebreak.players.some((p) => p.toLowerCase() === me) ? g.tiebreak : null;
    }

    // ---- Intro ----
    function iconCanvas(kind) {
      const size = 48;
      const dpr = Math.min(root.devicePixelRatio || 1, 2);
      const c = document.createElement('canvas');
      c.width = c.height = size * dpr;
      c.style.width = c.style.height = size + 'px';
      c.className = 'howto-icon';
      const g = c.getContext('2d');
      const s = size * dpr;
      if (kind === 'sheaf' || kind === 'golden') drawSheaf(g, s, kind === 'golden');
      else if (kind === 'stone') drawStone(g, s);
      else if (kind === 'thorn') drawThorn(g, s);
      else drawPower(g, s, kind);
      return c;
    }

    async function renderIntro() {
      const g = game();
      const s = settings();
      intro.textContent = '';
      const head = el('div', 'game-head');
      head.append(el('p', 'eyebrow', 'Arcade · ' + s.roundSec + ' seconds'), el('h2', 'display-sm', g ? g.title : 'Gleaner’s Rush'));
      if (g && g.description) head.appendChild(el('p', 'lead', g.description));
      intro.appendChild(head);

      const howto = el('div', 'howto');
      function tip(icons, title, text) {
        const t = el('div', 'howto-item');
        const ic = el('div', 'howto-icons');
        icons.forEach((k) => ic.appendChild(iconCanvas(k)));
        const body = el('div');
        body.append(el('strong', null, title), el('span', null, text));
        t.append(ic, body);
        howto.appendChild(t);
      }
      tip(['sheaf', 'golden'], 'Catch the barley', '+10 a sheaf, +50 for a golden one.');
      tip(['stone', 'thorn'], 'Dodge stones and thorns', 'Each one you catch costs a life (you have ' + s.lives + ').');
      const powers = [];
      if (s.powerWide) powers.push('wide');
      if (s.powerSlow) powers.push('slow');
      if (s.powerShield) powers.push('shield');
      if (powers.length) tip(powers, 'Grab power-ups', powers.map((p) => ({ wide: 'Wide Basket', slow: 'Slow Wind', shield: 'Shield' })[p]).join(', ') + '.');
      intro.appendChild(howto);
      intro.appendChild(el('p', 'howto-note', 'Combo: catch 5 in a row for ×2, 10 for ×3, up to ×5. Missing a sheaf or hitting a hazard resets it. Drag your finger, move the mouse, or use ← → (A / D).'));

      const form = el('form', 'join-form');
      form.noValidate = true;
      const label = el('label', 'field-label', 'Your nickname');
      label.htmlFor = 'rushNick';
      const input = el('input', 'input');
      input.id = 'rushNick';
      input.maxLength = 20;
      input.autocomplete = 'off';
      input.value = identity().nickname;
      const err = el('p', 'field-error');
      err.setAttribute('role', 'alert');
      const status = el('p', 'game-status');
      status.setAttribute('role', 'status');
      const start = el('button', 'btn btn-primary btn-xl', 'Start');
      start.type = 'submit';
      form.append(label, input, err, status, start);
      intro.appendChild(form);

      const boardCard = el('div', 'card leaderboard-card');
      const bh = el('div', 'leaderboard-head');
      bh.append(el('h3', null, 'Leaderboard'), el('span', 'muted', ''));
      const list = el('ol', 'leaderboard');
      boardCard.append(bh, list);
      intro.appendChild(boardCard);

      form.addEventListener('submit', (e) => {
        e.preventDefault();
        const nick = root.RedeemerEngine.validateNickname(input.value);
        err.textContent = nick.ok ? '' : nick.error;
        if (!nick.ok) return input.focus();
        ctx.identity.set({ nickname: nick.value });
        begin();
      });

      intro.hidden = false;
      over.hidden = true;
      await refreshStatus(status, start, bh.lastChild, list);
    }

    let attemptsUsed = 0;
    async function refreshStatus(status, start, meta, list) {
      const g = game();
      const s = settings();
      const b = await ctx.store.board(ID);
      if (destroyed) return;
      const me = identity().nickname.toLowerCase();
      const mine = (b.players || []).find((p) => p.you && p.nickname.toLowerCase() === me);
      attemptsUsed = mine ? mine.attempts : 0;
      lastBest = mine ? mine.score : 0;
      renderBoard(list, b);
      meta.textContent = b.saved === 'shared' ? 'Everyone in the session' : 'This device';
      updateStartState(status, start);
    }

    function updateStartState(status, start) {
      const g = game();
      const s = settings();
      clearInterval(roundTimer);
      const tb = myTiebreak(g);
      start.disabled = false;
      start.textContent = 'Start';
      if (ctx.store.preview) {
        status.textContent = 'Preview: your score won’t be saved.';
        return;
      }
      if (!g) {
        status.textContent = 'This game isn’t available right now.';
        start.disabled = true;
        return;
      }
      if (tb) {
        status.textContent = 'Tie-breaker! One ' + Core.tiebreakSettings(s).roundSec + '-second run on a fresh pattern. Highest score wins.';
        start.textContent = 'Play the tie-breaker';
        return;
      }
      if (!g.playable) {
        start.disabled = true;
        status.textContent = { waiting: 'Waiting for the facilitator to start the game…', paused: 'Paused by the facilitator.', ended: 'This game has finished. Thanks for playing!' }[g.reason] || 'Not available right now.';
        return;
      }
      if (attemptsUsed >= s.attempts) {
        start.disabled = true;
        status.textContent = 'You’ve used all ' + s.attempts + ' attempts. Your best score counts!';
        return;
      }
      if (s.syncStart && ctx.store.mode === 'shared') {
        pollEvery(2000);
        const r = g.round;
        if (!r) {
          start.disabled = true;
          status.textContent = 'Waiting for the facilitator to launch the next round…';
          return;
        }
        const tick = () => {
          const left = r.startAt - ctx.store.now();
          if (left > 3500) {
            start.disabled = true;
            status.textContent = 'Synchronised round starts in ' + Math.ceil(left / 1000) + ' s. Stay on this screen!';
          } else if (left > -1000) {
            clearInterval(roundTimer);
            begin(r);
          } else {
            clearInterval(roundTimer);
            start.disabled = true;
            status.textContent = 'A round is under way. Wait here for the next one.';
          }
        };
        tick();
        roundTimer = setInterval(tick, 250);
        return;
      }
      const left = s.attempts - attemptsUsed;
      status.textContent = U.plural(left, 'attempt') + ' left. Your best score counts.';
    }

    function renderBoard(list, b) {
      const rows = (b.players || []).slice(0, 10).map((p) => ({
        key: p.key || p.nickname,
        rank: p.rank,
        name: p.nickname,
        detail: p.detail && p.detail.bestCombo != null ? 'Best combo ' + p.detail.bestCombo + ' · ' + p.detail.accuracy + '% accuracy' : U.plural(p.attempts || 1, 'attempt'),
        score: p.score,
        you: p.you,
      }));
      root.HubBoard.render(list, rows, { empty: 'No scores yet. Be the first!' });
    }

    // ---- Stage layout ----
    function layout() {
      const vw = root.innerWidth;
      const vh = root.innerHeight;
      const hudH = 64;
      const availH = vh - hudH - 12;
      let h = Math.min(availH, vw / Core.FIELD_ASPECT);
      let w = h * Core.FIELD_ASPECT;
      if (w > vw) {
        w = vw;
        h = w / Core.FIELD_ASPECT;
      }
      w = Math.floor(w);
      h = Math.floor(h);
      const dpr = Math.min(root.devicePixelRatio || 1, 2);
      field = { w, h, dpr, left: Math.floor((vw - w) / 2), top: Math.floor(hudH + (availH - h) / 2) };
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      canvas.style.width = w + 'px';
      canvas.style.height = h + 'px';
      canvas.style.left = field.left + 'px';
      canvas.style.top = field.top + 'px';
      hud.style.width = Math.max(w, Math.min(vw, 560)) + 'px';
      bg = sprite(1, () => {});
      bg.width = canvas.width;
      bg.height = canvas.height;
      const bgc = bg.getContext('2d');
      bgc.scale(dpr, dpr);
      drawField(bgc, w, h);
      const size = Core.ITEM_R * 2 * w * dpr * 1.45;
      sprites = {
        sheaf: sprite(size, (g, s) => drawSheaf(g, s, false), true),
        golden: sprite(size * 1.15, (g, s) => drawSheaf(g, s, true), true),
        stone: sprite(size, drawStone, true),
        thorn: sprite(size, drawThorn, true),
        wide: sprite(size, (g, s) => drawPower(g, s, 'wide'), true),
        slow: sprite(size, (g, s) => drawPower(g, s, 'slow'), true),
        shield: sprite(size, (g, s) => drawPower(g, s, 'shield'), true),
      };
      if (sim) render();
    }

    let resizeTimer = null;
    function onResize() {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(layout, 80);
    }

    // ---- Input ----
    function pointerX(e) {
      return (e.clientX - field.left) / field.w;
    }
    function onPointer(e) {
      if (!sim || localPaused || remotePaused) return;
      if (e.pointerType === 'mouse' || e.buttons || e.type === 'pointerdown') {
        sim.setBasket(pointerX(e));
        e.preventDefault();
      }
    }
    function onKey(e) {
      if (!sim) return;
      const down = e.type === 'keydown';
      const k = e.key;
      if (k === 'ArrowLeft' || k === 'a' || k === 'A') { keys.left = down; e.preventDefault(); }
      else if (k === 'ArrowRight' || k === 'd' || k === 'D') { keys.right = down; e.preventDefault(); }
      else if (down && (k === 'Escape' || k === 'p' || k === 'P')) { e.preventDefault(); if (localPaused) resume(); else pause(true); }
    }
    const preventGesture = (e) => e.preventDefault();
    function onVisibility() {
      if (document.hidden && sim && !sim.state.over) pause(true);
    }
    function onBlur() {
      if (sim && !sim.state.over && loop && loop.running) pause(true);
    }

    function attachInput() {
      stage.addEventListener('pointerdown', onPointer);
      stage.addEventListener('pointermove', onPointer);
      root.addEventListener('keydown', onKey);
      root.addEventListener('keyup', onKey);
      root.addEventListener('resize', onResize);
      root.addEventListener('orientationchange', onResize);
      root.addEventListener('blur', onBlur);
      document.addEventListener('visibilitychange', onVisibility);
      document.addEventListener('gesturestart', preventGesture);
      document.body.classList.add('playing');
    }
    function detachInput() {
      stage.removeEventListener('pointerdown', onPointer);
      stage.removeEventListener('pointermove', onPointer);
      root.removeEventListener('keydown', onKey);
      root.removeEventListener('keyup', onKey);
      root.removeEventListener('resize', onResize);
      root.removeEventListener('orientationchange', onResize);
      root.removeEventListener('blur', onBlur);
      document.removeEventListener('visibilitychange', onVisibility);
      document.removeEventListener('gesturestart', preventGesture);
      document.body.classList.remove('playing');
      keys.left = keys.right = false;
    }

    // ---- Run ----
    async function begin(round) {
      if (busy) return;
      const g = game();
      const tb = myTiebreak(g);
      const base = settings();
      const s = tb ? Core.tiebreakSettings(base) : base;
      const seed = tb ? tb.seed : round ? round.seed : (g && g.seed) || 'PRACTICE';
      busy = true;
      pollEvery(3000);
      root.HubSfx.unlock();
      run = { runId: null, seed, settings: s, tiebreak: tb ? tb.id : '', roundId: round ? round.id : '' };
      sim = Core.createSim(s, seed);
      particles = [];
      popups = [];
      hudCache = {};
      shake = 0;
      flash = 0;
      localPaused = false;
      remotePaused = false;
      intro.hidden = true;
      over.hidden = true;
      stage.hidden = false;
      overlay.hidden = true;
      layout();
      attachInput();
      render();
      updateHud();
      stage.focus({ preventScroll: true });
      const started = ctx.store.startRun(ID, { nickname: identity().nickname, seed, roundId: run.roundId, tiebreak: run.tiebreak });
      await U.countdown(countEl, root.HubSfx);
      if (destroyed || !sim) return;
      started.then((r) => { if (run) run.runId = r.runId; });
      loop = root.HubLoop.create({ step, render });
      // A pause pressed during the countdown holds until the player resumes.
      if (!localPaused && !remotePaused) loop.start();
    }

    function step(dt) {
      if (keys.left || keys.right) sim.setBasket(sim.state.basketX + (keys.right ? 1 : -1) * KEY_SPEED * dt);
      sim.step(dt);
      handleEvents();
      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.vy += 0.9 * dt;
        p.life -= dt;
        if (p.life <= 0) particles.splice(i, 1);
      }
      for (let i = popups.length - 1; i >= 0; i--) {
        popups[i].y -= 0.12 * dt;
        popups[i].life -= dt;
        if (popups[i].life <= 0) popups.splice(i, 1);
      }
      shake = Math.max(0, shake - dt * 3);
      flash = Math.max(0, flash - dt * 2.5);
      if (sim.state.over) {
        loop.stop();
        finish(sim.state.reason);
      }
    }

    function burst(x, y, color, n) {
      if (reduced) return;
      for (let i = 0; i < n && particles.length < 140; i++) {
        const a = Math.random() * Math.PI * 2;
        const sp = 0.15 + Math.random() * 0.35;
        particles.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 0.25, life: 0.5 + Math.random() * 0.4, color, size: 2 + Math.random() * 3 });
      }
    }

    function popup(x, text, color) {
      popups.push({ x, y: Core.CATCH_Y - 0.05, text, color, life: 0.9 });
    }

    function handleEvents() {
      const evs = sim.events.splice(0);
      evs.forEach((ev) => {
        const y = Core.CATCH_Y;
        if (ev.type === 'catch') {
          root.HubSfx.play(ev.kind === 'golden' ? 'golden' : 'catch');
          burst(ev.x, y, ev.kind === 'golden' ? '#ffd54a' : '#e2bb5c', ev.kind === 'golden' ? 22 : 10);
          popup(ev.x, '+' + ev.pts + (ev.mult > 1 ? ' ×' + ev.mult : ''), ev.kind === 'golden' ? '#b07d16' : '#5a3d1e');
        } else if (ev.type === 'hit') {
          root.HubSfx.play('hazard');
          shake = reduced ? 0 : 1;
          flash = 1;
          burst(ev.x, y, '#7d2f1d', 14);
          popup(ev.x, '−1 life', '#a5452c');
          U.vibrate(60);
        } else if (ev.type === 'blocked') {
          root.HubSfx.play('power');
          burst(ev.x, y, '#f0d18a', 16);
          popup(ev.x, 'Blocked!', '#b07d16');
        } else if (ev.type === 'power') {
          root.HubSfx.play('power');
          burst(ev.x, y, '#ffffff', 16);
          popup(ev.x, { wide: 'Wide Basket!', slow: 'Slow Wind!', shield: 'Shield!' }[ev.kind], '#3f5f22');
        } else if (ev.type === 'near') {
          shake = reduced ? 0 : Math.max(shake, 0.35);
          popup(ev.x, 'Close!', '#6a5443');
        } else if (ev.type === 'miss') {
          root.HubSfx.play('miss');
        }
      });
      updateHud();
    }

    function updateHud() {
      const st = sim.state;
      const s = run.settings;
      const mult = sim.multiplier();
      const left = Math.max(0, s.roundSec - st.t);
      const values = {
        score: st.score,
        mult,
        lives: st.lives,
        wide: st.t < st.wideUntil,
        slow: st.t < st.slowUntil,
        shield: st.shield,
        bar: Math.round((left / s.roundSec) * 200),
      };
      if (values.score !== hudCache.score) hudScore.textContent = String(values.score);
      if (values.mult !== hudCache.mult) {
        hudMult.textContent = mult > 1 ? '×' + mult : '';
        hudMult.classList.toggle('on', mult > 1);
        if (mult > 1 && !reduced) hudMult.animate([{ transform: 'scale(1.35)' }, { transform: 'scale(1)' }], { duration: 260, easing: 'ease-out' });
      }
      if (values.lives !== hudCache.lives) {
        hudLives.textContent = '';
        for (let i = 0; i < s.lives; i++) hudLives.appendChild(U.svg('i-heart', i < st.lives ? 'life on' : 'life'));
        hudLives.setAttribute('aria-label', st.lives + ' lives left');
      }
      if (values.wide !== hudCache.wide || values.slow !== hudCache.slow || values.shield !== hudCache.shield) {
        hudPowers.textContent = '';
        if (values.wide) hudPowers.appendChild(el('span', 'power-chip wide', 'Wide'));
        if (values.slow) hudPowers.appendChild(el('span', 'power-chip slow', 'Slow'));
        if (values.shield) hudPowers.appendChild(el('span', 'power-chip shield', 'Shield'));
      }
      if (values.bar !== hudCache.bar) {
        hudBarFill.style.transform = 'scaleX(' + values.bar / 200 + ')';
        hudBar.classList.toggle('low', left <= 10);
      }
      hudCache = values;
    }

    function render() {
      const g = canvas.getContext('2d');
      const { w, h, dpr } = field;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, w, h);
      g.save();
      if (shake > 0) g.translate((Math.random() - 0.5) * 10 * shake, (Math.random() - 0.5) * 8 * shake);
      g.drawImage(bg, 0, 0, w, h);
      const st = sim.state;
      if (st.t < st.slowUntil && !reduced) {
        g.strokeStyle = 'rgba(63, 134, 168, 0.25)';
        g.lineWidth = 2;
        for (let i = 0; i < 6; i++) {
          const y = ((i * 0.17 + st.t * 0.05) % 1) * h;
          const x = ((i * 0.37 + st.t * 0.35) % 1.4 - 0.2) * w;
          g.beginPath();
          g.moveTo(x, y);
          g.lineTo(x + w * 0.25, y + 4);
          g.stroke();
        }
      }
      sim.active.forEach((a) => {
        const img = sprites[a.kind];
        const size = img.width / dpr;
        const wob = Math.sin(st.t * 3 + a.spin * 6) * 0.25;
        g.save();
        g.translate(a.x * w, a.y * h);
        g.rotate(Core.HAZARD[a.kind] ? st.t * 2 + a.spin * 6 : wob);
        g.drawImage(img, -size / 2, -size / 2, size, size);
        g.restore();
      });
      const bw = sim.basketHalf() * 2 * w;
      const bh = Math.min(bw * 0.42, h * 0.08);
      const top = Core.CATCH_Y * h;
      drawBasket(g, st.basketX * w, top, bw, bh, st.t < st.wideUntil ? 'rgba(120, 160, 60, 0.9)' : null);
      if (st.shield) {
        g.strokeStyle = 'rgba(240, 200, 90, 0.85)';
        g.lineWidth = 3;
        g.beginPath();
        g.ellipse(st.basketX * w, top + bh * 0.3, bw * 0.62, bh * 1.3, 0, Math.PI, 0);
        g.stroke();
      }
      particles.forEach((p) => {
        g.globalAlpha = Math.max(0, Math.min(1, p.life * 2));
        g.fillStyle = p.color;
        g.fillRect(p.x * w, p.y * h, p.size, p.size);
      });
      g.globalAlpha = 1;
      const fontSize = Math.max(14, w * 0.05);
      g.font = '700 ' + fontSize + 'px Inter, system-ui, sans-serif';
      g.textAlign = 'center';
      popups.forEach((p) => {
        g.globalAlpha = Math.min(1, p.life * 1.6);
        g.lineWidth = 4;
        g.strokeStyle = 'rgba(255, 248, 230, 0.9)';
        g.strokeText(p.text, p.x * w, p.y * h);
        g.fillStyle = p.color;
        g.fillText(p.text, p.x * w, p.y * h);
      });
      g.globalAlpha = 1;
      g.restore();
      if (flash > 0) {
        g.fillStyle = 'rgba(165, 69, 44,' + flash * 0.25 + ')';
        g.fillRect(0, 0, w, h);
      }
      if (sim && hudCache.bar !== undefined) {
        const left = Math.max(0, run.settings.roundSec - st.t);
        const bar = Math.round((left / run.settings.roundSec) * 200);
        if (bar !== hudCache.bar) updateHud();
      }
    }

    // ---- Pause ----
    function showOverlay(title, text, buttons) {
      overlay.textContent = '';
      const card = el('div', 'overlay-card');
      card.append(el('h2', 'display-sm', title));
      if (text) card.appendChild(el('p', 'lead', text));
      const row = el('div', 'actions');
      buttons.forEach((b) => row.appendChild(b));
      card.appendChild(row);
      overlay.appendChild(card);
      overlay.hidden = false;
      const first = row.querySelector('button');
      if (first) first.focus();
    }

    function pause(byPlayer) {
      if (!sim || sim.state.over || (byPlayer ? localPaused : remotePaused)) return;
      if (loop) loop.stop();
      keys.left = keys.right = false;
      if (byPlayer) {
        localPaused = true;
        showOverlay('Paused', 'Take a breath. Your run is waiting.', [U.button('Resume', 'btn btn-primary', resume), U.button('Quit run', 'btn btn-ghost', quit)]);
      } else {
        remotePaused = true;
        showOverlay('Paused by the facilitator', 'The game will continue in a moment.', []);
      }
    }

    function resume() {
      if (remotePaused) return;
      localPaused = false;
      overlay.hidden = true;
      stage.focus({ preventScroll: true });
      if (loop) loop.start();
    }

    function quit() {
      overlay.hidden = true;
      if (loop) loop.stop();
      finish('quit');
    }

    pauseBtn.addEventListener('click', () => (localPaused ? resume() : pause(true)));

    // ---- Finish ----
    async function finish(reason) {
      if (!sim) return;
      const result = sim.result();
      const thisRun = run;
      sim = null;
      detachInput();
      stage.hidden = true;
      overlay.hidden = true;
      busy = false;
      pollEvery(6000);
      root.HubSfx.play(reason === 'lives' ? 'end' : 'win');
      renderOver(result, reason, thisRun);
      if (reason !== 'quit' && result.score > 0) root.HubConfetti.burst({ count: result.score > lastBest ? 160 : 70 });
    }

    async function renderOver(result, reason, thisRun) {
      const g = game();
      over.textContent = '';
      const titles = { time: 'Time’s up!', lives: 'Out of lives!', quit: 'Run ended', ended: 'The facilitator ended the game' };
      over.append(el('p', 'eyebrow', thisRun.tiebreak ? 'Tie-breaker' : 'Run complete'), el('h2', 'display', titles[reason] || 'Run complete'));
      const best = result.score > lastBest && lastBest > 0;
      const stats = el('div', 'score-summary');
      function stat(v, label) {
        const b = el('div', 'stat');
        b.append(el('span', 'stat-value', String(v)), el('span', 'stat-label', label));
        return b;
      }
      stats.append(stat(result.score, 'points'), stat('×' + Core.multiplier(result.bestCombo) + ' · ' + result.bestCombo, 'best combo'), stat(result.accuracy + '%', 'accuracy'));
      over.appendChild(stats);
      if (best) over.appendChild(el('p', 'badge-best', 'New personal best!'));
      const note = el('p', 'game-status', 'Saving your score…');
      note.setAttribute('role', 'status');
      over.appendChild(note);
      const boardCard = el('div', 'card leaderboard-card');
      const bh = el('div', 'leaderboard-head');
      bh.append(el('h3', null, thisRun.tiebreak ? 'Your tie-breaker run' : 'Leaderboard'));
      const list = el('ol', 'leaderboard');
      boardCard.append(bh, list);
      over.appendChild(boardCard);
      if (g && g.closing) over.appendChild(el('p', 'closing-line', g.closing));
      const actions = el('div', 'actions');
      const again = U.button('Play again', 'btn btn-primary', () => renderIntro());
      actions.append(U.button('Back to games', 'btn btn-ghost', ctx.exit), again);
      over.appendChild(actions);
      intro.hidden = true;
      over.hidden = false;
      root.scrollTo(0, 0);
      over.querySelector('h2').setAttribute('tabindex', '-1');
      over.querySelector('h2').focus({ preventScroll: true });

      // Wait briefly for the run token if the countdown finished before the server answered.
      if (!thisRun.runId && ctx.store.mode === 'shared') await new Promise((r) => setTimeout(r, 1200));
      const res = await ctx.store.submitRun(ID, {
        runId: thisRun.runId,
        nickname: identity().nickname,
        result,
        localScore: result.score,
        tiebreak: thisRun.tiebreak,
        roundId: thisRun.roundId,
      });
      if (destroyed) return;
      if (res.saved === 'preview') note.textContent = 'Preview run: not saved.';
      else if (res.saved === 'shared' && res.ok !== false) note.textContent = res.rank ? 'Saved! You’re #' + res.rank + ' in this session.' : 'Saved to the shared leaderboard.';
      else if (res.saved === 'local' && ctx.store.mode === 'shared') note.textContent = 'Not saved to the shared leaderboard: ' + (res.message || 'connection problem') + ' It is kept on this device.';
      else note.textContent = 'Saved on this device.';
      if (thisRun.tiebreak) {
        list.appendChild(el('li', 'leaderboard-empty', 'Your score: ' + result.score + '. The facilitator will announce the winner.'));
      } else {
        const b = res.board || (await ctx.store.board(ID));
        renderBoard(list, b);
        const me = (b.players || []).find((p) => p.you && p.nickname.toLowerCase() === identity().nickname.toLowerCase());
        attemptsUsed = me ? me.attempts : attemptsUsed + 1;
        const s = settings();
        if (attemptsUsed >= s.attempts) {
          again.disabled = true;
          again.textContent = 'No attempts left';
        }
      }
    }

    // ---- Live updates from the facilitator ----
    function update() {
      const g = game();
      if (sim && !sim.state.over) {
        if (!g || g.status === 'ended' || g.reason === 'hidden') {
          if (loop) loop.stop();
          finish('ended');
          return;
        }
        if (g.status === 'paused' && !remotePaused) pause(false);
        else if (g.status === 'running' && remotePaused) {
          remotePaused = false;
          if (!localPaused) {
            overlay.hidden = true;
            if (loop) loop.start();
          }
        }
        return;
      }
      if (!intro.hidden) {
        const status = intro.querySelector('.game-status');
        const start = intro.querySelector('.join-form .btn-primary');
        if (status && start) updateStartState(status, start);
      }
    }

    function destroy() {
      destroyed = true;
      clearInterval(roundTimer);
      pollEvery(6000);
      if (loop) loop.stop();
      if (sim) detachInput();
      sim = null;
      stage.remove();
      shell.remove();
    }

    renderIntro();
    return { update, destroy, isBusy: () => busy };
  }

  root.HubGames = root.HubGames || {};
  root.HubGames[ID] = {
    mount,
    update: () => mounted && mounted.update(),
    unmount() {
      if (mounted) mounted.destroy();
      mounted = null;
    },
    isBusy: () => !!(mounted && mounted.isBusy()),
  };
})(window);
