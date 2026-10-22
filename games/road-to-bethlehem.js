/*
 * Game 3 — Road to Bethlehem: rotate tiles to connect a road from Moab to Bethlehem.
 * Level generation and scoring live in road-core.js; this file draws the board,
 * handles taps, clicks and keys, and runs the clock.
 */
(function (root) {
  'use strict';

  const U = root.HubUtil;
  const Core = root.RoadCore;
  const ID = 'road-to-bethlehem';

  const COLORS = {
    tileA: '#eadfb4',
    tileB: '#e2d4a2',
    locked: '#c9b98c',
    lockedEdge: '#8b7a55',
    road: '#b2864a',
    roadCore: '#d8b67a',
    lit: '#d99a0b',
    litCore: '#ffe08a',
    ink: '#3b2a1e',
    grass: '#9aa457',
  };

  let mounted = null;

  function createGame(rootEl, ctx) {
    const reduced = U.reducedMotion();
    const el = (tag, cls, text) => U.el(tag, cls, text);
    let destroyed = false;
    let busy = false;

    // ---- DOM ----
    const shell = el('div', 'game-shell road');
    const intro = el('section', 'game-panel');
    const over = el('section', 'game-panel');
    over.hidden = true;
    const stage = el('div', 'stage road-stage');
    stage.hidden = true;
    const hud = el('div', 'road-hud');
    const hudLevel = el('div', 'road-hud-item');
    const hudTime = el('div', 'road-hud-item road-time');
    const hudScore = el('div', 'road-hud-item');
    hud.append(hudLevel, hudTime, hudScore);
    const boardWrap = el('div', 'road-board');
    const canvas = el('canvas', 'road-canvas');
    canvas.tabIndex = 0;
    canvas.setAttribute('role', 'application');
    canvas.setAttribute('aria-label', 'Puzzle board. Tap a tile to turn it. With a keyboard, use the arrow keys to move and Space or Enter to turn.');
    boardWrap.appendChild(canvas);
    const banner = el('div', 'road-banner');
    banner.hidden = true;
    banner.setAttribute('aria-live', 'polite');
    boardWrap.appendChild(banner);
    const controls = el('div', 'road-controls');
    const hintBtn = U.button('Hint', 'btn btn-ghost');
    const pauseBtn = U.button('Pause', 'btn btn-ghost');
    const movesEl = el('span', 'road-moves');
    controls.append(pauseBtn, movesEl, hintBtn);
    const countEl = el('div', 'stage-count');
    countEl.hidden = true;
    const overlay = el('div', 'stage-overlay');
    overlay.hidden = true;
    const live = el('p', 'sr-only');
    live.setAttribute('aria-live', 'polite');
    stage.append(hud, boardWrap, controls, countEl, overlay, live);
    shell.append(intro, over);
    rootEl.appendChild(shell);
    document.body.appendChild(stage);

    // ---- State ----
    let run = null; // { seed, settings, levelNo, stats[], score, tiebreak, roundId, runId, clockMs, levelMs }
    let lvl = null;
    let lit = null;
    let anims = {}; // tile index -> { from, start }
    let traveller = null; // { points, start, duration }
    let cursor = [0, 0];
    let showCursor = false;
    let geo = { tile: 40, pad: 0, top: 0, w: 0, h: 0, dpr: 1 };
    let raf = null;
    let clock = null; // setInterval handle
    let lastTick = 0;
    let localPaused = false;
    let remotePaused = false;
    let solving = false;
    let lastSecond = null;
    let roundTimer = null;
    let lastBest = null;
    let attemptsUsed = 0;
    let boardTab = 'players';

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
    function renderIntro() {
      const g = game();
      const s = settings();
      intro.textContent = '';
      const head = el('div', 'game-head');
      const clockText = s.timerMode === 'total' ? U.formatClock(s.totalSec * 1000) + ' on the clock' : s.perLevelSec + ' seconds per level';
      head.append(el('p', 'eyebrow', 'Puzzle · ' + clockText), el('h2', 'display-sm', g ? g.title : 'Road to Bethlehem'));
      if (g && g.description) head.appendChild(el('p', 'lead', g.description));
      intro.appendChild(head);

      const demo = el('div', 'road-demo');
      demo.appendChild(demoCanvas());
      const rules = el('ul', 'rules-list');
      [
        'Tap a tile to turn it a quarter turn. Grey tiles with a lock can’t turn.',
        'Connect one road from Moab (top) to Bethlehem (bottom). Later levels add a well and a field the road must pass.',
        'Levels grow from 4×4 upwards and bring decoy junctions. Clear as many as you can!',
      ].forEach((t) => rules.appendChild(el('li', null, t)));
      demo.appendChild(rules);
      intro.appendChild(demo);

      const scoring = el('details', 'scoring');
      scoring.appendChild(el('summary', null, 'How scoring works'));
      const sl = el('ul', 'rules-list');
      [
        'Each level: ' + s.pointsPerLevel + ' points for a 4×4 grid, more for bigger grids (points × size² ÷ 16).',
        'Time bonus: up to ' + s.timeBonusMax + ' points if you solve faster than ' + s.targetSecPerTile + ' seconds per tile.',
        'Efficiency bonus: up to ' + s.efficiencyMax + ' points, minus 3 for every turn beyond the fewest needed.',
        s.hintsAllowed ? 'Hints fix one tile for you and cost ' + s.hintCost + ' points.' : 'Hints are switched off.',
        'Leaderboard: most levels cleared first, then highest score.',
      ].forEach((t) => sl.appendChild(el('li', null, t)));
      scoring.appendChild(sl);
      intro.appendChild(scoring);

      const form = el('form', 'join-form');
      form.noValidate = true;
      const nickLabel = el('label', 'field-label', 'Your nickname');
      nickLabel.htmlFor = 'roadNick';
      const nick = el('input', 'input');
      nick.id = 'roadNick';
      nick.maxLength = 20;
      nick.autocomplete = 'off';
      nick.value = identity().nickname;
      form.append(nickLabel, nick);
      let team = null;
      if (s.teamMode) {
        const tl = el('label', 'field-label', 'Your team');
        tl.htmlFor = 'roadTeam';
        team = el('input', 'input');
        team.id = 'roadTeam';
        team.maxLength = 20;
        team.autocomplete = 'off';
        team.value = identity().team;
        form.append(tl, team);
      }
      const err = el('p', 'field-error');
      err.setAttribute('role', 'alert');
      const status = el('p', 'game-status');
      status.setAttribute('role', 'status');
      const start = el('button', 'btn btn-primary btn-xl', 'Start');
      start.type = 'submit';
      form.append(err, status, start);
      intro.appendChild(form);

      const boardCard = el('div', 'card leaderboard-card');
      intro.appendChild(boardCard);

      form.addEventListener('submit', (e) => {
        e.preventDefault();
        const n = root.RedeemerEngine.validateNickname(nick.value);
        let t = { ok: true, value: '' };
        if (team) t = root.RedeemerEngine.validateNickname(team.value);
        err.textContent = !n.ok ? n.error : !t.ok ? 'Please enter a team name.' : '';
        if (!n.ok) return nick.focus();
        if (!t.ok) return team.focus();
        ctx.identity.set(team ? { nickname: n.value, team: t.value } : { nickname: n.value });
        begin();
      });

      intro.hidden = false;
      over.hidden = true;
      loadBoard(boardCard).then(() => updateStartState(status, start));
    }

    function demoCanvas() {
      const c = document.createElement('canvas');
      const size = 120;
      const dpr = Math.min(root.devicePixelRatio || 1, 2);
      c.width = c.height = size * dpr;
      c.style.width = c.style.height = size + 'px';
      c.className = 'road-demo-canvas';
      c.setAttribute('aria-hidden', 'true');
      const g = c.getContext('2d');
      g.scale(dpr, dpr);
      const t = size / 3;
      const demo = [Core.SHAPES.corner, Core.SHAPES.straight, Core.SHAPES.tee];
      const masks = [Core.rotate(demo[0], 1), Core.rotate(demo[1], 1), Core.rotate(demo[2], 2), Core.rotate(demo[1], 0), Core.rotate(demo[0], 3), Core.rotate(demo[0], 0), Core.rotate(demo[2], 1), Core.rotate(demo[1], 0), Core.rotate(demo[0], 2)];
      masks.forEach((m, i) => drawTile(g, (i % 3) * t, Math.floor(i / 3) * t, t, m, 0, { lit: i === 1 || i === 4 || i === 7, alt: (i + Math.floor(i / 3)) % 2 }));
      return c;
    }

    async function loadBoard(card) {
      const b = await ctx.store.board(ID);
      if (destroyed) return b;
      const me = identity().nickname.toLowerCase();
      const mine = (b.players || []).find((p) => p.you && p.nickname.toLowerCase() === me);
      attemptsUsed = mine ? mine.attempts : 0;
      lastBest = mine || null;
      renderBoardCard(card, b);
      return b;
    }

    function renderBoardCard(card, b) {
      const s = settings();
      card.textContent = '';
      const head = el('div', 'leaderboard-head');
      head.appendChild(el('h3', null, 'Leaderboard'));
      if (s.teamMode) {
        const tabs = el('div', 'seg');
        ['players', 'teams'].forEach((t) => {
          const btn = U.button(t === 'players' ? 'Players' : 'Teams', 'seg-btn' + (boardTab === t ? ' on' : ''), () => {
            boardTab = t;
            renderBoardCard(card, b);
          });
          btn.setAttribute('aria-pressed', String(boardTab === t));
          tabs.appendChild(btn);
        });
        head.appendChild(tabs);
      } else head.appendChild(el('span', 'muted', b.saved === 'shared' ? 'Everyone in the session' : 'This device'));
      const list = el('ol', 'leaderboard');
      card.append(head, list);
      if (boardTab === 'teams' && s.teamMode) {
        root.HubBoard.render(list, (b.teams || []).map((t) => ({ key: t.key, rank: t.rank, name: t.name, detail: U.plural(t.members, 'player') + ' · ' + U.plural(t.levels, 'level'), score: t.score })), { empty: 'No team scores yet.' });
      } else {
        root.HubBoard.render(
          list,
          (b.players || []).slice(0, 10).map((p) => ({
            key: p.key || p.nickname,
            rank: p.rank,
            name: p.nickname,
            detail: U.plural(p.levels, 'level') + (p.team ? ' · ' + p.team : ''),
            score: p.score,
            you: p.you,
          })),
          { empty: 'No scores yet. Be the first!' }
        );
      }
    }

    function updateStartState(status, start) {
      const g = game();
      const s = settings();
      clearInterval(roundTimer);
      start.disabled = false;
      start.textContent = 'Start';
      if (ctx.store.preview) {
        status.textContent = 'Preview: your score won’t be saved.';
        return;
      }
      if (!g) {
        start.disabled = true;
        status.textContent = 'This game isn’t available right now.';
        return;
      }
      if (myTiebreak(g)) {
        status.textContent = 'Tie-breaker! One sudden-death level. The fastest solve wins.';
        start.textContent = 'Play the sudden-death level';
        return;
      }
      if (!g.playable) {
        start.disabled = true;
        status.textContent = { waiting: 'Waiting for the facilitator to start the game…', paused: 'Paused by the facilitator.', ended: 'This game has finished. Thanks for playing!' }[g.reason] || 'Not available right now.';
        return;
      }
      if (attemptsUsed >= s.attempts) {
        start.disabled = true;
        status.textContent = 'You’ve used all ' + s.attempts + ' attempts. Your best run counts!';
        return;
      }
      if (s.syncStart && ctx.store.mode === 'shared') {
        pollEvery(2000);
        const r = g.round;
        if (!r) {
          start.disabled = true;
          status.textContent = 'Waiting for the facilitator to launch the round…';
          return;
        }
        const tick = () => {
          const left = r.startAt - ctx.store.now();
          if (left > 3500) {
            start.disabled = true;
            status.textContent = 'The round starts in ' + Math.ceil(left / 1000) + ' s. Stay on this screen!';
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
      status.textContent = U.plural(s.attempts - attemptsUsed, 'attempt') + ' left. Your best run counts.';
    }

    // ---- Drawing ----
    function roundRect(g, x, y, w, h, r) {
      g.beginPath();
      g.moveTo(x + r, y);
      g.arcTo(x + w, y, x + w, y + h, r);
      g.arcTo(x + w, y + h, x, y + h, r);
      g.arcTo(x, y + h, x, y, r);
      g.arcTo(x, y, x + w, y, r);
      g.closePath();
    }

    function drawRoadArms(g, cx, cy, t, mask, isLit) {
      const arms = [];
      if (mask & Core.N) arms.push([0, -1]);
      if (mask & Core.E) arms.push([1, 0]);
      if (mask & Core.S) arms.push([0, 1]);
      if (mask & Core.W) arms.push([-1, 0]);
      [[t * 0.34, isLit ? COLORS.lit : COLORS.road], [t * 0.18, isLit ? COLORS.litCore : COLORS.roadCore]].forEach(([width, color]) => {
        g.strokeStyle = color;
        g.lineWidth = width;
        g.lineCap = 'butt';
        arms.forEach(([dx, dy]) => {
          g.beginPath();
          g.moveTo(cx, cy);
          g.lineTo(cx + dx * t * 0.5, cy + dy * t * 0.5);
          g.stroke();
        });
        g.fillStyle = color;
        g.beginPath();
        g.arc(cx, cy, width / 2, 0, Math.PI * 2);
        g.fill();
      });
    }

    function drawTile(g, x, y, t, mask, angle, opt) {
      const gap = Math.max(1, t * 0.04);
      roundRect(g, x + gap, y + gap, t - gap * 2, t - gap * 2, t * 0.12);
      g.fillStyle = opt.locked ? COLORS.locked : opt.alt ? COLORS.tileB : COLORS.tileA;
      g.fill();
      if (opt.locked) {
        g.strokeStyle = COLORS.lockedEdge;
        g.lineWidth = Math.max(1.5, t * 0.04);
        g.stroke();
      }
      const cx = x + t / 2;
      const cy = y + t / 2;
      g.save();
      roundRect(g, x + gap, y + gap, t - gap * 2, t - gap * 2, t * 0.12);
      g.clip();
      g.translate(cx, cy);
      g.rotate(angle);
      drawRoadArms(g, 0, 0, t, mask, opt.lit);
      g.restore();
      if (opt.checkpoint) drawCheckpoint(g, cx, cy, t, opt.checkpoint, opt.lit);
      if (opt.locked) {
        const s = t * 0.18;
        const lx = x + t - s * 1.3;
        const ly = y + s * 0.5;
        g.fillStyle = opt.hinted ? '#b07d16' : '#5c4d33';
        g.fillRect(lx, ly + s * 0.45, s, s * 0.75);
        g.strokeStyle = g.fillStyle;
        g.lineWidth = Math.max(1, s * 0.18);
        g.beginPath();
        g.arc(lx + s / 2, ly + s * 0.45, s * 0.32, Math.PI, 0);
        g.stroke();
      }
    }

    function drawCheckpoint(g, cx, cy, t, kind, isLit) {
      const r = t * 0.2;
      g.fillStyle = isLit ? '#fff3c4' : '#f6eed6';
      g.strokeStyle = isLit ? COLORS.lit : '#8b7a55';
      g.lineWidth = Math.max(1.5, t * 0.04);
      g.beginPath();
      g.arc(cx, cy, r, 0, Math.PI * 2);
      g.fill();
      g.stroke();
      if (kind === 'well') {
        g.fillStyle = '#3f86a8';
        g.beginPath();
        g.arc(cx, cy, r * 0.55, 0, Math.PI * 2);
        g.fill();
      } else {
        g.strokeStyle = '#b8892b';
        g.lineWidth = Math.max(1, t * 0.03);
        for (let i = -1; i <= 1; i++) {
          g.beginPath();
          g.moveTo(cx + i * r * 0.35, cy + r * 0.6);
          g.lineTo(cx + i * r * 0.45, cy - r * 0.55);
          g.stroke();
        }
      }
    }

    /** Two little houses with a label, kept inside the canvas even at the grid's edge. */
    function drawTown(g, cx, bodyTop, size, label, labelY) {
      const w = size * 0.9;
      const hx = cx - w / 2;
      g.fillStyle = '#c99a5b';
      g.fillRect(hx, bodyTop + size * 0.06, w * 0.42, size * 0.24);
      g.fillRect(hx + w * 0.52, bodyTop, w * 0.48, size * 0.3);
      g.fillStyle = '#8b5e34';
      g.beginPath();
      g.moveTo(hx - 2, bodyTop + size * 0.06);
      g.lineTo(hx + w * 0.21, bodyTop - size * 0.1);
      g.lineTo(hx + w * 0.44, bodyTop + size * 0.06);
      g.moveTo(hx + w * 0.5, bodyTop);
      g.lineTo(hx + w * 0.76, bodyTop - size * 0.18);
      g.lineTo(hx + w + 2, bodyTop);
      g.fill();
      g.fillStyle = COLORS.ink;
      g.font = '700 ' + Math.max(12, Math.round(size * 0.3)) + 'px Inter, system-ui, sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      const half = g.measureText(label).width / 2 + 2;
      g.fillText(label, U.clamp(cx, half, geo.w - half), labelY);
    }

    function layout() {
      const n = lvl.size;
      const vw = Math.min(root.innerWidth, 720);
      const availW = vw - 24;
      const hudH = hud.offsetHeight || 64;
      const ctrlH = controls.offsetHeight || 64;
      const availH = root.innerHeight - hudH - ctrlH - 24;
      const t = Math.max(28, Math.floor(Math.min(availW / n, availH / (n + 2.45))));
      const dpr = Math.min(root.devicePixelRatio || 1, 2);
      const w = t * n;
      const h = t * (n + 2.45);
      geo = { tile: t, top: t * 1.25, w, h, dpr };
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      canvas.style.width = w + 'px';
      canvas.style.height = h + 'px';
      draw();
    }

    function tileAngle(i, now) {
      const a = anims[i];
      if (!a) return 0;
      const p = Math.min(1, (now - a.start) / 140);
      if (p >= 1) {
        delete anims[i];
        return 0;
      }
      const ease = 1 - Math.pow(1 - p, 3);
      return -(Math.PI / 2) * (1 - ease) * a.turns;
    }

    function draw() {
      if (!lvl) return;
      const g = canvas.getContext('2d');
      const { tile: t, top, w, h, dpr } = geo;
      const now = root.performance.now();
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, w, h);
      const n = lvl.size;
      const sx = lvl.start[1] * t + t / 2;
      const ex = lvl.end[1] * t + t / 2;
      const solvedNow = lit && Core.isSolved(lvl);
      // road stubs to the towns
      g.strokeStyle = COLORS.lit;
      g.lineWidth = t * 0.34;
      const bottom = top + n * t;
      g.beginPath();
      g.moveTo(sx, t * 0.8);
      g.lineTo(sx, top);
      g.stroke();
      g.strokeStyle = solvedNow ? COLORS.lit : COLORS.road;
      g.beginPath();
      g.moveTo(ex, bottom);
      g.lineTo(ex, bottom + t * 0.42);
      g.stroke();
      drawTown(g, sx, t * 0.52, t, 'Moab', t * 0.2);
      drawTown(g, ex, bottom + t * 0.42, t, 'Bethlehem', bottom + t * 1.0);
      for (let r = 0; r < n; r++) {
        for (let c = 0; c < n; c++) {
          const i = r * n + c;
          const tl = lvl.tiles[i];
          drawTile(g, c * t, top + r * t, t, Core.rotate(tl.base, tl.rot), tileAngle(i, now), {
            lit: lit && lit[i],
            alt: (r + c) % 2,
            locked: tl.locked,
            hinted: tl.hinted,
            checkpoint: tl.checkpoint,
          });
        }
      }
      if (showCursor && !solving) {
        g.strokeStyle = '#3f86a8';
        g.lineWidth = 3;
        g.setLineDash([6, 4]);
        g.strokeRect(cursor[1] * t + 3, top + cursor[0] * t + 3, t - 6, t - 6);
        g.setLineDash([]);
      }
      if (traveller) drawTraveller(g, now);
      const animating = Object.keys(anims).length > 0 || traveller;
      if (animating && !raf) raf = root.requestAnimationFrame(() => { raf = null; draw(); });
    }

    function drawTraveller(g, now) {
      const p = Math.min(1, (now - traveller.start) / traveller.duration);
      const pts = traveller.points;
      const pos = p * (pts.length - 1);
      const i = Math.min(pts.length - 2, Math.floor(pos));
      const f = pos - i;
      const x = pts[i][0] + (pts[i + 1][0] - pts[i][0]) * f;
      const y = pts[i][1] + (pts[i + 1][1] - pts[i][1]) * f;
      const t = geo.tile;
      const bob = Math.sin(now / 70) * t * 0.03;
      g.fillStyle = '#6b3f1f';
      g.beginPath();
      g.moveTo(x - t * 0.13, y + t * 0.16 + bob);
      g.lineTo(x + t * 0.13, y + t * 0.16 + bob);
      g.lineTo(x, y - t * 0.08 + bob);
      g.fill();
      g.fillStyle = '#f2d2a9';
      g.beginPath();
      g.arc(x, y - t * 0.13 + bob, t * 0.08, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#a5452c';
      g.beginPath();
      g.arc(x, y - t * 0.16 + bob, t * 0.085, Math.PI, 0);
      g.fill();
      if (p >= 1) {
        const done = traveller.done;
        traveller = null;
        if (done) done();
      }
    }

    // ---- Clock ----
    function startClock() {
      stopClock();
      lastTick = root.performance.now();
      clock = setInterval(tickClock, 100);
    }
    function stopClock() {
      if (clock) clearInterval(clock);
      clock = null;
    }
    function tickClock() {
      const nowT = root.performance.now();
      const dt = nowT - lastTick;
      lastTick = nowT;
      if (localPaused || remotePaused || solving) return;
      run.levelMs += dt;
      run.clockMs += dt;
      renderHud();
      if (remaining() <= 0) endRun('time');
    }
    function remaining() {
      const s = run.settings;
      if (run.tiebreak) return Infinity;
      return s.timerMode === 'total' ? s.totalSec * 1000 - run.clockMs : s.perLevelSec * 1000 - run.levelMs;
    }

    function renderHud() {
      const s = run.settings;
      hudLevel.innerHTML = '';
      hudLevel.append(el('span', 'hud-label', run.tiebreak ? 'Sudden death' : 'Level'), el('strong', null, run.tiebreak ? lvl.size + '×' + lvl.size : run.levelNo + ' · ' + lvl.size + '×' + lvl.size));
      hudScore.innerHTML = '';
      hudScore.append(el('span', 'hud-label', run.tiebreak ? 'Turns' : 'Score'), el('strong', null, String(run.tiebreak ? run.rotations : run.score)));
      hudTime.innerHTML = '';
      const left = remaining();
      const label = run.tiebreak ? 'Time' : s.timerMode === 'total' ? 'Time left' : 'Level clock';
      const value = run.tiebreak ? U.formatSeconds(run.levelMs) : U.formatClock(left);
      hudTime.append(el('span', 'hud-label', label), el('strong', null, value));
      const low = !run.tiebreak && left <= 10000;
      hudTime.classList.toggle('low', low);
      const sec = Math.ceil(left / 1000);
      if (low && sec !== lastSecond && sec > 0) {
        root.HubSfx.play('tick');
        if (sec === 10) live.textContent = '10 seconds left';
      }
      lastSecond = sec;
      movesEl.textContent = U.plural(run.rotations, 'turn');
      hintBtn.hidden = !s.hintsAllowed || !!run.tiebreak;
      hintBtn.textContent = 'Hint (−' + s.hintCost + ')';
    }

    // ---- Input ----
    function cellAt(e) {
      const rect = canvas.getBoundingClientRect();
      const x = ((e.clientX - rect.left) / rect.width) * geo.w;
      const y = ((e.clientY - rect.top) / rect.height) * geo.h - geo.top;
      const c = Math.floor(x / geo.tile);
      const r = Math.floor(y / geo.tile);
      if (r < 0 || c < 0 || r >= lvl.size || c >= lvl.size) return null;
      return [r, c];
    }

    function rotateAt(r, c) {
      if (!lvl || solving || localPaused || remotePaused) return;
      const i = r * lvl.size + c;
      if (!Core.tap(lvl, r, c)) {
        root.HubSfx.play('locked');
        if (!reduced) canvas.animate([{ transform: 'translateX(-3px)' }, { transform: 'translateX(3px)' }, { transform: 'none' }], { duration: 160 });
        return;
      }
      root.HubSfx.play('rotate');
      run.rotations += 1;
      run.levelRotations += 1;
      if (!reduced) anims[i] = { start: root.performance.now(), turns: anims[i] ? anims[i].turns + 1 : 1 };
      afterChange();
    }

    function afterChange() {
      lit = Core.connected(lvl).seen;
      renderHud();
      draw();
      if (Core.isSolved(lvl)) solved();
    }

    function onPointer(e) {
      if (!lvl) return;
      const cell = cellAt(e);
      if (!cell) return;
      e.preventDefault();
      showCursor = false;
      cursor = cell;
      rotateAt(cell[0], cell[1]);
    }

    function onKey(e) {
      if (!lvl || stage.hidden) return;
      const k = e.key;
      if (k === 'Escape' || k === 'p' || k === 'P') {
        e.preventDefault();
        if (localPaused) resume();
        else pause(true);
        return;
      }
      if (localPaused || remotePaused) return;
      const moves = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
      if (moves[k]) {
        e.preventDefault();
        showCursor = true;
        cursor = [U.clamp(cursor[0] + moves[k][0], 0, lvl.size - 1), U.clamp(cursor[1] + moves[k][1], 0, lvl.size - 1)];
        draw();
      } else if (k === ' ' || k === 'Enter') {
        if (document.activeElement && document.activeElement !== canvas && document.activeElement.tagName === 'BUTTON') return;
        e.preventDefault();
        showCursor = true;
        rotateAt(cursor[0], cursor[1]);
      } else if (k === 'h' || k === 'H') {
        e.preventDefault();
        useHint();
      }
    }

    let resizeTimer = null;
    function onResize() {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => lvl && layout(), 80);
    }
    function onVisibility() {
      if (document.hidden && lvl && !localPaused) pause(true);
    }
    function onBlur() {
      if (lvl && !localPaused && !solving) pause(true);
    }
    const preventGesture = (e) => e.preventDefault();

    function attachInput() {
      canvas.addEventListener('pointerdown', onPointer);
      root.addEventListener('keydown', onKey);
      root.addEventListener('resize', onResize);
      root.addEventListener('orientationchange', onResize);
      root.addEventListener('blur', onBlur);
      document.addEventListener('visibilitychange', onVisibility);
      document.addEventListener('gesturestart', preventGesture);
      document.body.classList.add('playing');
    }
    function detachInput() {
      canvas.removeEventListener('pointerdown', onPointer);
      root.removeEventListener('keydown', onKey);
      root.removeEventListener('resize', onResize);
      root.removeEventListener('orientationchange', onResize);
      root.removeEventListener('blur', onBlur);
      document.removeEventListener('visibilitychange', onVisibility);
      document.removeEventListener('gesturestart', preventGesture);
      document.body.classList.remove('playing');
    }

    function useHint() {
      if (!lvl || solving || run.tiebreak || !run.settings.hintsAllowed || localPaused || remotePaused) return;
      const cell = Core.hint(lvl);
      if (!cell) return;
      run.hints += 1;
      run.levelHints += 1;
      root.HubSfx.play('power');
      U.toast('Hint: one tile fixed (−' + run.settings.hintCost + ' points on this level)', 1800);
      afterChange();
    }

    hintBtn.addEventListener('click', useHint);
    pauseBtn.addEventListener('click', () => (localPaused ? resume() : pause(true)));

    // ---- Run ----
    async function begin(round) {
      if (busy) return;
      const g = game();
      const tb = myTiebreak(g);
      const base = settings();
      busy = true;
      pollEvery(3000);
      root.HubSfx.unlock();
      run = {
        seed: tb ? tb.seed : round ? round.seed : (g && g.seed) || 'PRACTICE',
        settings: tb ? Core.tiebreakSettings(base) : base,
        tiebreak: tb ? tb.id : '',
        roundId: round ? round.id : '',
        levelNo: 0,
        stats: [],
        score: 0,
        rotations: 0,
        hints: 0,
        clockMs: 0,
        levelMs: 0,
        levelRotations: 0,
        levelHints: 0,
        runId: null,
      };
      intro.hidden = true;
      over.hidden = true;
      stage.hidden = false;
      overlay.hidden = true;
      localPaused = remotePaused = false;
      attachInput();
      const started = ctx.store.startRun(ID, { nickname: identity().nickname, seed: run.seed, roundId: run.roundId, tiebreak: run.tiebreak });
      nextLevel(true);
      boardWrap.classList.add('veiled');
      await U.countdown(countEl, root.HubSfx);
      if (destroyed || !run) return;
      // A pause pressed during the countdown keeps the board hidden until resumed.
      if (!localPaused && !remotePaused) boardWrap.classList.remove('veiled');
      started.then((r) => { if (run) run.runId = r.runId; });
      startClock();
      canvas.focus({ preventScroll: true });
    }

    function nextLevel(first) {
      run.levelNo += 1;
      run.levelMs = 0;
      run.levelRotations = 0;
      run.levelHints = 0;
      lastSecond = null;
      lvl = run.tiebreak
        ? Core.generateLevel(run.seed, Core.TIEBREAK_LEVEL, run.settings)
        : Core.generateLevel(run.seed, run.levelNo, run.settings);
      anims = {};
      cursor = [0, lvl.start[1]];
      lit = Core.connected(lvl).seen;
      solving = false;
      banner.hidden = true;
      renderHud();
      layout();
      if (!first) live.textContent = 'Level ' + run.levelNo + ', ' + lvl.size + ' by ' + lvl.size;
    }

    function solved() {
      solving = true;
      const stat = { level: run.levelNo, ms: Math.round(run.levelMs), rotations: run.levelRotations, hints: run.levelHints };
      root.HubSfx.play('solve');
      const n = lvl.size;
      const t = geo.tile;
      const pts = [[lvl.start[1] * t + t / 2, t * 0.8]];
      Core.route(lvl).forEach(([r, c]) => pts.push([c * t + t / 2, geo.top + r * t + t / 2]));
      pts.push([lvl.end[1] * t + t / 2, geo.top + n * t + t * 0.42]);
      const after = () => {
        if (!run) return;
        if (run.tiebreak) {
          run.stats.push(stat);
          endRun('solved');
          return;
        }
        const sc = Core.levelScore(stat, n, lvl.minRotations, run.settings);
        run.stats.push(stat);
        run.score += sc.total;
        banner.textContent = '';
        banner.append(el('strong', null, 'Level ' + stat.level + ' cleared! +' + sc.total));
        const parts = ['base ' + sc.base];
        if (sc.timeBonus) parts.push('time +' + sc.timeBonus);
        if (sc.efficiency) parts.push('efficiency +' + sc.efficiency);
        if (sc.hintPenalty) parts.push('hints −' + sc.hintPenalty);
        banner.appendChild(el('span', null, parts.join(' · ')));
        banner.hidden = false;
        live.textContent = 'Level cleared, plus ' + sc.total + ' points.';
        renderHud();
        if (run.stats.length >= run.settings.levelsPerRound) {
          setTimeout(() => endRun('complete'), 900);
          return;
        }
        setTimeout(() => {
          if (run && !destroyed) nextLevel(false);
        }, 1100);
      };
      if (reduced) {
        draw();
        after();
      } else {
        traveller = { points: pts, start: root.performance.now(), duration: Math.min(2200, Math.max(900, pts.length * 110)), done: after };
        draw();
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
      if (!run || stage.hidden || (byPlayer ? localPaused : remotePaused)) return;
      boardWrap.classList.add('veiled');
      if (byPlayer) {
        localPaused = true;
        showOverlay('Paused', 'The board is hidden while paused, and the clock has stopped.', [U.button('Resume', 'btn btn-primary', resume), U.button('Quit run', 'btn btn-ghost', () => endRun('quit'))]);
      } else {
        remotePaused = true;
        showOverlay('Paused by the facilitator', 'The clock has stopped. The game will continue in a moment.', []);
      }
    }

    function resume() {
      if (remotePaused) return;
      localPaused = false;
      overlay.hidden = true;
      boardWrap.classList.remove('veiled');
      lastTick = root.performance.now();
      canvas.focus({ preventScroll: true });
    }

    // ---- Finish ----
    function endRun(reason) {
      if (!run) return;
      const thisRun = run;
      stopClock();
      detachInput();
      stage.hidden = true;
      overlay.hidden = true;
      boardWrap.classList.remove('veiled');
      lvl = null;
      traveller = null;
      run = null;
      busy = false;
      pollEvery(6000);
      root.HubSfx.play(reason === 'time' ? 'end' : 'win');
      renderOver(thisRun, reason);
      if (thisRun.stats.length) root.HubConfetti.burst({ count: 120 });
    }

    async function renderOver(r, reason) {
      const g = game();
      over.textContent = '';
      const titles = { time: 'Time’s up!', complete: 'Every level cleared!', quit: 'Run ended', ended: 'The facilitator ended the game', solved: 'Solved!' };
      over.append(el('p', 'eyebrow', r.tiebreak ? 'Sudden-death tie-breaker' : 'Run complete'), el('h2', 'display', titles[reason] || 'Run complete'));
      const stats = el('div', 'score-summary');
      function stat(v, label) {
        const b = el('div', 'stat');
        b.append(el('span', 'stat-value', String(v)), el('span', 'stat-label', label));
        return b;
      }
      const totalMs = r.stats.reduce((a, s) => a + s.ms, 0);
      if (r.tiebreak) stats.append(stat(r.stats.length ? U.formatSeconds(r.stats[0].ms) : '—', 'solve time'), stat(r.rotations, 'turns'));
      else stats.append(stat(r.stats.length, U.plural(r.stats.length, 'level').replace(/^\d+ /, '') + ' cleared'), stat(r.score, 'points'), stat(U.formatClock(totalMs), 'time solving'));
      over.appendChild(stats);
      if (!r.tiebreak && r.stats.length) {
        const table = el('table', 'level-table');
        const head = el('tr');
        ['Level', 'Grid', 'Time', 'Turns', 'Hints'].forEach((h) => head.appendChild(el('th', null, h)));
        const thead = el('thead');
        thead.appendChild(head);
        const tbody = el('tbody');
        r.stats.forEach((s) => {
          const size = Core.sizeForLevel(s.level, r.settings);
          const tr = el('tr');
          [s.level, size + '×' + size, U.formatSeconds(s.ms), s.rotations, s.hints].forEach((v) => tr.appendChild(el('td', null, String(v))));
          tbody.appendChild(tr);
        });
        table.append(thead, tbody);
        const wrap = el('div', 'table-wrap');
        wrap.appendChild(table);
        over.appendChild(wrap);
      }
      const note = el('p', 'game-status', 'Saving your result…');
      note.setAttribute('role', 'status');
      over.appendChild(note);
      const card = el('div', 'card leaderboard-card');
      over.appendChild(card);
      if (g && g.closing) over.appendChild(el('p', 'closing-line', g.closing));
      const actions = el('div', 'actions');
      const again = U.button('Play again', 'btn btn-primary', renderIntro);
      actions.append(U.button('Back to games', 'btn btn-ghost', ctx.exit), again);
      over.appendChild(actions);
      intro.hidden = true;
      over.hidden = false;
      root.scrollTo(0, 0);
      const h2 = over.querySelector('h2');
      h2.setAttribute('tabindex', '-1');
      h2.focus({ preventScroll: true });

      if (!r.runId && ctx.store.mode === 'shared') await new Promise((res) => setTimeout(res, 1200));
      const result = r.tiebreak
        ? { ms: r.stats.length ? r.stats[0].ms : 0, rotations: r.rotations, solved: r.stats.length > 0 }
        : { levels: r.stats, levelsCleared: r.stats.length, totalMs };
      if (r.tiebreak && !r.stats.length) {
        note.textContent = 'The tie-breaker level wasn’t solved, so no time was recorded.';
        card.hidden = true;
        return;
      }
      const res = await ctx.store.submitRun(ID, {
        runId: r.runId,
        nickname: identity().nickname,
        team: r.settings.teamMode ? identity().team : '',
        result,
        localScore: r.tiebreak ? 0 : r.score,
        tiebreak: r.tiebreak,
        roundId: r.roundId,
      });
      if (destroyed) return;
      if (res.saved === 'preview') note.textContent = 'Preview run: not saved.';
      else if (res.saved === 'shared' && res.ok !== false) note.textContent = res.rank ? 'Saved! You’re #' + res.rank + ' in this session.' : 'Saved to the shared leaderboard.';
      else if (res.saved === 'local' && ctx.store.mode === 'shared') note.textContent = 'Not saved to the shared leaderboard: ' + (res.message || 'connection problem') + ' It is kept on this device.';
      else note.textContent = 'Saved on this device.';
      if (r.tiebreak) {
        card.textContent = '';
        card.appendChild(el('p', 'leaderboard-empty', 'Your solve time: ' + U.formatSeconds(result.ms) + '. The facilitator will announce the winner.'));
        return;
      }
      const b = res.board || (await ctx.store.board(ID));
      renderBoardCard(card, b);
      const me = (b.players || []).find((p) => p.you && p.nickname.toLowerCase() === identity().nickname.toLowerCase());
      attemptsUsed = me ? me.attempts : attemptsUsed + 1;
      if (attemptsUsed >= settings().attempts) {
        again.disabled = true;
        again.textContent = 'No attempts left';
      }
    }

    function update() {
      const g = game();
      if (run && !stage.hidden) {
        if (!g || g.status === 'ended') {
          endRun('ended');
          return;
        }
        if (g.status === 'paused' && !remotePaused) pause(false);
        else if (g.status === 'running' && remotePaused) {
          remotePaused = false;
          if (!localPaused) {
            overlay.hidden = true;
            boardWrap.classList.remove('veiled');
            lastTick = root.performance.now();
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
      stopClock();
      if (run) detachInput();
      run = null;
      stage.remove();
      shell.remove();
    }

    renderIntro();
    return { update, destroy, isBusy: () => busy };
  }

  root.HubGames = root.HubGames || {};
  root.HubGames[ID] = {
    mount(rootEl, ctx) {
      mounted = createGame(rootEl, ctx);
    },
    update: () => mounted && mounted.update(),
    unmount() {
      if (mounted) mounted.destroy();
      mounted = null;
    },
    isBusy: () => !!(mounted && mounted.isBusy()),
  };
})(window);
