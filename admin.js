/*
 * Admin dashboard: session settings, game visibility, facilitator controls, scores and the
 * projector view.
 *
 * Security: in shared mode every action here is a request that the Apps Script server
 * authorises (Google account allowlist or admin key). Nothing on this page is trusted by
 * the server. In local mode the dashboard only changes this browser's own storage.
 */
(function (root) {
  'use strict';

  const U = root.HubUtil;
  const D = root.HubDefaults;
  const S = root.HubSession;
  const Store = root.HubStore;
  const $ = U.$;
  const el = U.el;

  const isGas = !!(root.google && root.google.script && root.google.script.run);
  const appUrl = document.body.dataset.appUrl || '';
  const INFO = {
    'gleaners-rush': { kind: 'Arcade game', icon: 'i-stalk', arcade: true },
    'redeemers-challenge': { kind: 'Ruth 4 quiz', icon: 'i-book' },
    'road-to-bethlehem': { kind: 'Puzzle game', icon: 'i-road', arcade: true },
    'team-showdown': { kind: 'Team game show', icon: 'i-buzz' },
  };
  const STATUS_LABEL = { ready: 'Ready', running: 'Running', paused: 'Paused', ended: 'Ended' };

  let draft = null;
  let dirty = false;
  let tab = 'session';
  let configuring = null;
  let controlGame = 'gleaners-rush';
  let scoresGame = 'gleaners-rush';
  let presenter = null; // { kind, destroy }
  let who = null;
  let ticker = null;

  const clone = (v) => JSON.parse(JSON.stringify(v));
  const full = () => Store.admin.full();
  const title = (id) => (draft ? draft.games[id].title : D.defaults().games[id].title);

  // ───────────── URLs ─────────────

  function participantUrl(params) {
    if (isGas && appUrl) return appUrl + (params ? '?' + params : '');
    const u = new URL('index.html', root.location.href);
    if (params) u.search = params;
    return u.href;
  }

  function previewUrl(game) {
    if (isGas && appUrl) return participantUrl('preview=1' + (game ? '&game=' + game : ''));
    return participantUrl('preview=1') + (game ? '#/play/' + game : '');
  }

  function openWindow(url) {
    const w = root.open(url, '_blank', 'noopener');
    if (!w) U.toast('Your browser blocked the new tab. Allow pop-ups for this page, or use the Participant view link.');
  }

  // ───────────── Confirmation dialog ─────────────

  function confirmAction(opts) {
    return new Promise((resolve) => {
      const dialog = $('confirmDialog');
      $('confirmTitle').textContent = opts.title || 'Are you sure?';
      $('confirmText').textContent = opts.text || '';
      $('confirmOk').textContent = opts.ok || 'Confirm';
      const typed = !!opts.word;
      $('confirmTyped').hidden = !typed;
      $('confirmWord').textContent = opts.word || '';
      $('confirmInput').value = '';
      function onClose() {
        dialog.removeEventListener('close', onClose);
        const ok = dialog.returnValue === 'ok' && (!typed || $('confirmInput').value.trim().toUpperCase() === opts.word);
        if (dialog.returnValue === 'ok' && !ok) U.toast('Not confirmed: the word didn’t match.');
        resolve(ok);
      }
      dialog.addEventListener('close', onClose);
      dialog.returnValue = '';
      if (typeof dialog.showModal === 'function') dialog.showModal();
      else resolve(root.confirm((opts.title || '') + '\n' + (opts.text || '')));
      if (typed) $('confirmInput').focus();
    });
  }

  async function run(fn, success) {
    try {
      await fn();
      if (success) U.toast(success, 2200);
      return true;
    } catch (e) {
      U.toast(e.message || 'That didn’t work.', 4000);
      return false;
    }
  }

  // ───────────── Tabs & saving ─────────────

  function setTab(name) {
    tab = name;
    document.querySelectorAll('.admin-tab').forEach((b) => {
      if (b.dataset.tab === name) b.setAttribute('aria-current', 'page');
      else b.removeAttribute('aria-current');
    });
    document.querySelectorAll('.admin-section').forEach((s) => { s.hidden = s.id !== 'tab-' + name; });
    renderTab(true);
    root.scrollTo(0, 0);
  }

  document.querySelectorAll('.admin-tab').forEach((b) => b.addEventListener('click', () => setTab(b.dataset.tab)));

  function renderTab(force) {
    if (tab === 'session' && (force || !dirty)) renderSession();
    if (tab === 'games' && (force || !configuring)) renderGames();
    if (tab === 'control') renderControl();
    if (tab === 'scores' && force) renderScores();
    if (tab === 'present' && force) renderPresent();
    if (tab === 'access' && force) renderAccess();
  }

  function markDirty() {
    dirty = true;
    $('saveBar').hidden = false;
  }

  $('saveBtn').addEventListener('click', async () => {
    const ok = await run(() => Store.admin.saveConfig(draft), 'Saved. Participants will see the changes within a few seconds.');
    if (ok) {
      dirty = false;
      draft = clone(full().config);
      $('saveBar').hidden = true;
      renderTab(true);
    }
  });
  $('discardBtn').addEventListener('click', () => {
    draft = clone(full().config);
    dirty = false;
    $('saveBar').hidden = true;
    renderTab(true);
  });
  $('previewDraftBtn').addEventListener('click', () => {
    Store.admin.saveDraft(draft);
    openWindow(previewUrl(configuring));
  });
  root.addEventListener('beforeunload', (e) => {
    if (dirty) {
      e.preventDefault();
      e.returnValue = '';
    }
  });

  // ───────────── Form helpers ─────────────

  function section(container, heading, sub) {
    const card = el('div', 'card admin-card');
    if (heading) card.appendChild(el('h2', 'admin-h2', heading));
    if (sub) card.appendChild(el('p', 'muted admin-sub', sub));
    container.appendChild(card);
    return card;
  }

  function textField(label, value, max, onInput, opts) {
    const wrap = el('label', 'admin-field');
    wrap.appendChild(el('span', 'field-label', label));
    const input = el(opts && opts.multiline ? 'textarea' : 'input', 'input');
    input.value = value || '';
    if (max) input.maxLength = max;
    if (opts && opts.rows) input.rows = opts.rows;
    if (opts && opts.placeholder) input.placeholder = opts.placeholder;
    input.addEventListener('input', () => onInput(input.value));
    wrap.appendChild(input);
    if (opts && opts.help) wrap.appendChild(el('span', 'field-help', opts.help));
    return wrap;
  }

  function switchField(label, checked, onChange, help) {
    const wrap = el('label', 'admin-switch');
    const input = el('input');
    input.type = 'checkbox';
    input.checked = !!checked;
    input.setAttribute('role', 'switch');
    input.addEventListener('change', () => onChange(input.checked, input));
    wrap.append(input, el('span', 'switch-ui'), el('span', 'switch-label', label));
    if (help) wrap.appendChild(el('span', 'field-help', help));
    return wrap;
  }

  function schemaField(f, value, onChange) {
    if (f.type === 'bool') return switchField(f.label, value, onChange, f.help);
    const wrap = el('label', 'admin-field');
    wrap.appendChild(el('span', 'field-label', f.label));
    if (f.type === 'number') {
      const input = el('input', 'input');
      input.type = 'number';
      input.min = String(f.min);
      input.max = String(f.max);
      input.step = String(f.step || 1);
      input.value = String(value);
      input.inputMode = 'decimal';
      input.addEventListener('change', () => {
        const n = Number(input.value);
        const clean = isFinite(n) ? U.clamp(n, f.min, f.max) : f.def;
        input.value = String(clean);
        onChange(clean);
      });
      wrap.appendChild(input);
    } else if (f.type === 'select') {
      const sel = el('select', 'input');
      f.options.forEach(([v, l]) => {
        const o = el('option', null, l);
        o.value = v;
        sel.appendChild(o);
      });
      sel.value = value;
      sel.addEventListener('change', () => onChange(sel.value));
      wrap.appendChild(sel);
    } else if (f.type === 'list') {
      const box = el('div', 'admin-list-inputs');
      const vals = value.slice();
      vals.forEach((v, i) => {
        const input = el('input', 'input');
        input.value = v;
        input.maxLength = f.max;
        input.setAttribute('aria-label', f.label + ' ' + (i + 1));
        input.addEventListener('input', () => {
          vals[i] = input.value;
          onChange(vals.slice());
        });
        box.appendChild(input);
      });
      wrap.appendChild(box);
    }
    if (f.help) wrap.appendChild(el('span', 'field-help', f.help));
    return wrap;
  }

  // ───────────── Status ─────────────

  function statusOf(id) {
    const cfg = full().config.games[id];
    const live = full().live.games[id];
    const isLive = full().live.liveGame === id;
    let access;
    let cls;
    if (!cfg.enabled) {
      access = 'Disabled for this session';
      cls = 'off';
    } else if (!cfg.visible) {
      access = 'Hidden from participants';
      cls = 'off';
    } else {
      const a = S.availability(full().config, full().live, id, false);
      access = a.playable ? 'Available to participants' : 'Visible · ' + ({ waiting: 'waiting for Start', paused: 'paused', ended: 'ended' }[a.reason] || a.reason);
      cls = a.playable ? 'on' : 'wait';
    }
    return { access, cls, run: STATUS_LABEL[live.status], live: isLive, seed: live.seed, round: live.round, tiebreak: live.tiebreak, epoch: live.epoch };
  }

  function statusPill(st) {
    const box = el('div', 'status-pills');
    box.appendChild(el('span', 'pill pill-' + st.cls, st.access));
    box.appendChild(el('span', 'pill', st.run));
    if (st.live) box.appendChild(el('span', 'pill pill-live', 'Live now'));
    return box;
  }

  // ───────────── Session tab ─────────────

  function renderSession() {
    const box = $('tab-session');
    box.textContent = '';
    box.appendChild(el('h1', 'admin-h1', 'Session'));
    box.lastChild.id = 'h-session';

    const details = section(box, 'Details', 'What participants see on the game menu.');
    details.append(
      textField('Session title', draft.session.title, D.LIMITS.sessionTitle, (v) => { draft.session.title = v; markDirty(); }),
      textField('Welcome message', draft.session.welcome, D.LIMITS.welcome, (v) => { draft.session.welcome = v; markDirty(); }, { multiline: true, rows: 3 }),
      textField('Session code', draft.session.code, 16, (v) => { draft.session.code = v.toUpperCase(); markDirty(); }, { help: 'Used by The Redeemer’s Challenge shared leaderboard. 3–16 letters or numbers.' })
    );
    const modes = el('fieldset', 'admin-radios');
    modes.appendChild(el('legend', 'field-label', 'How games start'));
    [['auto', 'Automatically: a visible game can be played straight away'], ['facilitator', 'Only when I press Start in the Control tab']].forEach(([v, l]) => {
      const lab = el('label', 'check');
      const r = el('input');
      r.type = 'radio';
      r.name = 'startMode';
      r.value = v;
      r.checked = draft.session.startMode === v;
      r.addEventListener('change', () => { draft.session.startMode = v; markDirty(); });
      lab.append(r, el('span', null, l));
      modes.appendChild(lab);
    });
    details.appendChild(modes);

    const order = section(box, 'Game order', 'The order games appear in the participant menu. Drag, or use the arrows.');
    const list = el('ol', 'order-list');
    draft.order.forEach((id, i) => {
      const li = el('li', 'order-row');
      li.draggable = true;
      li.dataset.id = id;
      const grip = el('span', 'grip');
      grip.appendChild(U.svg('i-grip'));
      const name = el('span', 'order-name');
      name.append(el('strong', null, (i + 1) + '. ' + draft.games[id].title), el('small', 'muted', INFO[id].kind + (draft.games[id].enabled ? '' : ' · disabled')));
      const up = U.button('', 'icon-btn', () => move(i, -1));
      up.appendChild(U.svg('i-up'));
      up.setAttribute('aria-label', 'Move ' + draft.games[id].title + ' up');
      up.disabled = i === 0;
      const down = U.button('', 'icon-btn', () => move(i, 1));
      down.appendChild(U.svg('i-down'));
      down.setAttribute('aria-label', 'Move ' + draft.games[id].title + ' down');
      down.disabled = i === draft.order.length - 1;
      li.append(grip, name, up, down);
      li.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('text/plain', id);
        li.classList.add('dragging');
      });
      li.addEventListener('dragend', () => li.classList.remove('dragging'));
      li.addEventListener('dragover', (e) => e.preventDefault());
      li.addEventListener('drop', (e) => {
        e.preventDefault();
        const from = draft.order.indexOf(e.dataTransfer.getData('text/plain'));
        const to = draft.order.indexOf(id);
        if (from < 0 || to < 0 || from === to) return;
        const [moved] = draft.order.splice(from, 1);
        draft.order.splice(to, 0, moved);
        markDirty();
        renderSession();
      });
      list.appendChild(li);
    });
    order.appendChild(list);
    order.appendChild(el('p', 'field-help', 'Suggested flow: Gleaner’s Rush before the teaching, then The Redeemer’s Challenge, Road to Bethlehem and Team Showdown after it. Show or hide each game in the Games tab.'));

    function move(i, d) {
      const j = i + d;
      if (j < 0 || j >= draft.order.length) return;
      const tmp = draft.order[i];
      draft.order[i] = draft.order[j];
      draft.order[j] = tmp;
      markDirty();
      renderSession();
      const rows = box.querySelectorAll('.order-row');
      const btn = rows[j] && rows[j].querySelectorAll('button')[d < 0 ? 0 : 1];
      if (btn && !btn.disabled) btn.focus();
    }

    const tools = section(box, 'Preview & defaults');
    const row = el('div', 'admin-actions');
    row.append(
      U.button('Preview the participant view', 'btn btn-ghost', () => {
        Store.admin.saveDraft(draft);
        openWindow(previewUrl());
      }),
      U.button('Restore defaults', 'btn btn-ghost', async () => {
        const ok = await confirmAction({ title: 'Restore default settings?', text: 'Titles, messages, game order, settings and Team Showdown questions go back to the originals. Visibility, scores and seeds are not affected.', ok: 'Restore defaults' });
        if (!ok) return;
        if (await run(() => Store.admin.restoreDefaults(), 'Defaults restored.')) {
          draft = clone(full().config);
          dirty = false;
          $('saveBar').hidden = true;
          renderSession();
        }
      })
    );
    tools.appendChild(row);
    tools.appendChild(el('p', 'field-help', 'Preview opens the participant page with your unsaved changes and shows hidden games. Nothing is saved from preview runs.'));
  }

  // ───────────── Games tab ─────────────

  function renderGames() {
    const box = $('tab-games');
    box.textContent = '';
    if (configuring) return renderConfigure(box, configuring);
    box.appendChild(el('h1', 'admin-h1', 'Games'));
    box.lastChild.id = 'h-games';
    box.appendChild(el('p', 'muted admin-sub', 'Show or hide each game instantly. Hidden games disappear from the participant menu, can’t be opened by link, and stop accepting scores, but keep their settings and results.'));
    const grid = el('div', 'admin-game-grid');
    full().config.order.forEach((id) => {
      const cfg = full().config.games[id];
      const st = statusOf(id);
      const card = el('article', 'card admin-game');
      const head = el('div', 'admin-game-head');
      const icon = el('span', 'admin-game-icon');
      icon.appendChild(U.svg(INFO[id].icon));
      const name = el('div');
      name.append(el('h3', null, cfg.title), el('span', 'muted', INFO[id].kind));
      head.append(icon, name);
      card.append(head, statusPill(st));
      card.appendChild(switchField('Visible to participants', cfg.visible, (on, input) => {
        input.disabled = true;
        run(() => Store.admin.control(id, on ? 'show' : 'hide'), on ? cfg.title + ' is now visible.' : cfg.title + ' is hidden.').then(() => {
          if (draft) draft.games[id].visible = full().config.games[id].visible;
          renderGames();
        });
      }));
      card.appendChild(switchField('Part of this session', cfg.enabled, (on, input) => {
        input.disabled = true;
        run(() => Store.admin.control(id, on ? 'enable' : 'disable'), on ? 'Enabled.' : 'Disabled for this session.').then(() => {
          if (draft) draft.games[id].enabled = full().config.games[id].enabled;
          renderGames();
        });
      }));
      const actions = el('div', 'admin-actions');
      actions.append(
        U.button('Preview', 'btn btn-ghost btn-sm', () => {
          Store.admin.saveDraft(draft);
          openWindow(previewUrl(id));
        }),
        U.button('Configure', 'btn btn-primary btn-sm', () => {
          configuring = id;
          renderGames();
          root.scrollTo(0, 0);
        }),
        U.button('Reset data', 'btn btn-ghost btn-sm', () => resetGame(id))
      );
      card.appendChild(actions);
      grid.appendChild(card);
    });
    box.appendChild(grid);
  }

  async function resetGame(id) {
    const ok = await confirmAction({
      title: 'Reset ' + full().config.games[id].title + '?',
      text: id === 'team-showdown'
        ? 'Team scores go back to zero and the game returns to the lobby.'
        : 'The leaderboard starts again from zero and attempts are restored. Earlier results stay in the records (and in CSV exports) but no longer count.',
      ok: 'Reset',
    });
    if (ok) await run(() => Store.admin.control(id, 'reset'), 'Reset.');
    renderTab(true);
  }

  function renderConfigure(box, id) {
    const g = draft.games[id];
    const back = U.button('← All games', 'btn btn-link', () => {
      configuring = null;
      renderGames();
    });
    box.appendChild(back);
    box.appendChild(el('h1', 'admin-h1', 'Configure: ' + g.title));
    box.lastChild.id = 'h-games';
    const text = section(box, 'Text', 'Shown on the game card and at the end of the game.');
    text.append(
      textField('Title', g.title, D.LIMITS.title, (v) => { g.title = v; markDirty(); }),
      textField('Description', g.description, D.LIMITS.description, (v) => { g.description = v; markDirty(); }, { multiline: true, rows: 2 }),
      textField('Closing message', g.closing, D.LIMITS.closing, (v) => { g.closing = v; markDirty(); }, { multiline: true, rows: 2 })
    );
    const schema = D.SCHEMA[id];
    if (schema.length) {
      const set = section(box, 'Settings', id === 'gleaners-rush' || id === 'road-to-bethlehem' ? 'Seeds are managed in the Control tab. Changing settings during a round may make in-progress scores fail the server’s checks.' : '');
      const grid = el('div', 'admin-form-grid');
      schema.forEach((f) => grid.appendChild(schemaField(f, g.settings[f.key], (v) => { g.settings[f.key] = v; markDirty(); })));
      set.appendChild(grid);
    } else {
      section(box, 'Questions', 'The Redeemer’s Challenge keeps its original eight questions, answers, references, scoring and reflection. They live in questions.js and are not editable here, so the quiz stays exactly as written.');
    }
    if (id === 'team-showdown') renderShowdownEditor(box, g.content);
    box.appendChild(el('p', 'field-help', 'Changes are saved with the Save button at the bottom of the screen.'));
  }

  // ---- Team Showdown question editor ----
  function renderShowdownEditor(box, content) {
    const wrap = el('div', 'sd-editor');
    box.appendChild(wrap);

    function redraw() {
      wrap.textContent = '';
      const warn = el('p', 'admin-warning');
      wrap.appendChild(warn);
      const rounds = section(wrap, 'Rounds & questions', 'Rounds are played in this order. Name Five rounds are judged by the facilitator; all others use buzzers.');
      content.rounds.forEach((r, ri) => rounds.appendChild(roundEditor(r, ri)));
      rounds.appendChild(U.button('+ Add a round', 'btn btn-ghost', () => {
        content.rounds.push({ id: 'round' + (content.rounds.length + 1), title: 'New round', type: 'buzzer', intro: '', timeSec: 20, points: 100, bonus: 0, double: false, enabled: true, questions: [] });
        markDirty();
        redraw();
      }));

      const wager = section(wrap, 'Final Wager question', 'One hard question with a single clear answer. Typed answers from team phones are checked against the answer and the alternatives.');
      wager.appendChild(questionEditor(content.wager, 'buzzer', null));

      const tb = section(wrap, 'Tie-breaker questions', 'Used in order if the game ends in a tie. The first tied team to answer correctly wins.');
      content.tiebreakers.forEach((q, qi) => tb.appendChild(questionEditor(q, 'buzzer', () => { content.tiebreakers.splice(qi, 1); markDirty(); redraw(); })));
      tb.appendChild(U.button('+ Add a tie-breaker', 'btn btn-ghost btn-sm', () => {
        content.tiebreakers.push({ prompt: '', answer: '' });
        markDirty();
        redraw();
      }));
      updateWarning(warn);
    }

    function updateWarning(warn) {
      let missing = 0;
      content.rounds.forEach((r) => r.questions.forEach((q) => { if (!q.prompt || (r.type !== 'judged' && !q.answer)) missing++; }));
      content.tiebreakers.forEach((q) => { if (!q.prompt || !q.answer) missing++; });
      warn.textContent = missing ? U.plural(missing, 'question is', 'questions are') + ' missing a prompt or an answer and will be skipped when you save.' : '';
      warn.hidden = !missing;
    }

    function roundEditor(r, ri) {
      const card = el('details', 'round-card');
      card.open = false;
      const sum = el('summary');
      sum.append(el('strong', null, (ri + 1) + '. ' + r.title), el('span', 'muted', ' · ' + (r.type === 'judged' ? 'Name Five' : 'buzzer') + ' · ' + U.plural(r.questions.length, 'question') + (r.enabled ? '' : ' · off') + (r.double ? ' · double' : '')));
      card.appendChild(sum);
      const grid = el('div', 'admin-form-grid');
      grid.append(
        textField('Round title', r.title, 40, (v) => { r.title = v; markDirty(); }),
        schemaField({ type: 'select', label: 'Type', options: [['buzzer', 'Buzzer round'], ['judged', 'Name Five (judged)']], def: 'buzzer' }, r.type, (v) => { r.type = v; markDirty(); redraw(); }),
        schemaField({ type: 'number', label: 'Seconds per question', min: 5, max: 180, step: 1, def: 20 }, r.timeSec, (v) => { r.timeSec = v; markDirty(); }),
        schemaField({ type: 'number', label: r.type === 'judged' ? 'Points per valid answer' : 'Points', min: 0, max: 1000, step: 5, def: 100 }, r.points, (v) => { r.points = v; markDirty(); })
      );
      if (r.type === 'judged') grid.appendChild(schemaField({ type: 'number', label: 'Bonus for all five', min: 0, max: 500, step: 5, def: 0 }, r.bonus || 0, (v) => { r.bonus = v; markDirty(); }));
      grid.append(
        switchField('Round enabled', r.enabled, (v) => { r.enabled = v; markDirty(); }),
        switchField('Double points', r.double, (v) => { r.double = v; markDirty(); })
      );
      card.appendChild(grid);
      card.appendChild(textField('Intro (shown before the round)', r.intro, 240, (v) => { r.intro = v; markDirty(); }, { multiline: true, rows: 2 }));
      const qs = el('div', 'question-list');
      r.questions.forEach((q, qi) => qs.appendChild(questionEditor(q, r.type, () => { r.questions.splice(qi, 1); markDirty(); redraw(); })));
      card.appendChild(qs);
      const row = el('div', 'admin-actions');
      row.append(
        U.button('+ Add a question', 'btn btn-ghost btn-sm', () => {
          r.questions.push(r.type === 'judged' ? { prompt: '' } : { prompt: '', answer: '' });
          markDirty();
          redraw();
          wrap.querySelectorAll('.round-card')[ri].open = true;
        }),
        U.button('Move up', 'btn btn-ghost btn-sm', () => moveRound(ri, -1)),
        U.button('Move down', 'btn btn-ghost btn-sm', () => moveRound(ri, 1)),
        U.button('Delete round', 'btn btn-ghost btn-sm danger-text', async () => {
          if (await confirmAction({ title: 'Delete “' + r.title + '”?', text: 'Its questions are removed from the draft. Nothing changes until you save.', ok: 'Delete' })) {
            content.rounds.splice(ri, 1);
            markDirty();
            redraw();
          }
        })
      );
      card.appendChild(row);
      return card;
    }

    function moveRound(i, d) {
      const j = i + d;
      if (j < 0 || j >= content.rounds.length) return;
      const tmp = content.rounds[i];
      content.rounds[i] = content.rounds[j];
      content.rounds[j] = tmp;
      markDirty();
      redraw();
    }

    function questionEditor(q, type, onRemove) {
      const row = el('div', 'question-row');
      const grid = el('div', 'question-grid');
      grid.appendChild(textField('Question', q.prompt, 240, (v) => { q.prompt = v; markDirty(); }));
      if (type !== 'judged') {
        grid.append(
          textField('Big letters (optional)', q.display || '', 80, (v) => { q.display = v; markDirty(); }, { placeholder: 'e.g. F _ _ T H F _ L' }),
          textField('Answer', q.answer || '', 80, (v) => { q.answer = v; markDirty(); }),
          textField('Also accept (comma-separated)', (q.accept || []).join(', '), 400, (v) => { q.accept = v.split(',').map((x) => x.trim()).filter(Boolean); markDirty(); }),
          textField('Note for the reveal (optional)', q.note || '', 240, (v) => { q.note = v; markDirty(); })
        );
      }
      row.appendChild(grid);
      if (onRemove) {
        const rm = U.button('', 'icon-btn', onRemove);
        rm.appendChild(U.svg('i-x'));
        rm.setAttribute('aria-label', 'Remove this question');
        row.appendChild(rm);
      }
      return row;
    }

    redraw();
  }

  // ───────────── Control tab ─────────────

  function gamePicker(current, onPick) {
    const bar = el('div', 'game-picker');
    full().config.order.forEach((id) => {
      const st = statusOf(id);
      const b = U.button('', 'picker-btn' + (id === current ? ' on' : ''), () => onPick(id));
      b.setAttribute('aria-pressed', String(id === current));
      const icon = U.svg(INFO[id].icon);
      b.append(icon, el('span', null, full().config.games[id].title), el('small', 'pill pill-' + st.cls, st.live ? 'Live' : st.run));
      bar.appendChild(b);
    });
    return bar;
  }

  async function control(id, op, args, done) {
    const ok = await run(() => Store.admin.control(id, op, args), done);
    if (ok && id === 'team-showdown' && (op === 'start' || op === 'reset')) {
      if (op === 'start' && full().showdown && full().showdown.phase === 'lobby') U.toast('Team Showdown is open. Use Present → Team Showdown host screen to run it.', 4500);
    }
    renderTab(true);
  }

  function renderControl() {
    const box = $('tab-control');
    const focusId = document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.ctl : null;
    box.textContent = '';
    box.appendChild(el('h1', 'admin-h1', 'Facilitator controls'));
    box.lastChild.id = 'h-control';
    box.appendChild(gamePicker(controlGame, (id) => {
      controlGame = id;
      renderControl();
    }));
    const id = controlGame;
    const cfg = full().config.games[id];
    const st = statusOf(id);
    const card = section(box, cfg.title);
    card.appendChild(statusPill(st));
    const facts = el('dl', 'facts');
    function fact(k, v) {
      facts.append(el('dt', null, k), el('dd', null, v));
    }
    fact('Start mode', full().config.session.startMode === 'facilitator' ? 'Participants wait until you press Start' : 'Playable as soon as it is visible');
    if (INFO[id].arcade) {
      fact('Seed', st.seed + ' (everyone gets the same pattern)');
      if (cfg.settings.syncStart) fact('Rounds', 'Facilitator Showdown is on: Start launches one synchronised round.');
      if (st.round) {
        const left = st.round.startAt - Store.now();
        fact('Current round', left > 0 ? 'Starts in ' + Math.ceil(left / 1000) + ' s' : 'Under way (started ' + Math.round(-left / 1000) + ' s ago)');
      }
      if (st.tiebreak) fact('Tie-breaker', 'In progress for ' + st.tiebreak.players.join(', '));
    }
    if (id === 'team-showdown' && full().showdown) fact('Show phase', full().showdown.phase);
    fact('Leaderboard resets', String(st.epoch));
    card.appendChild(facts);

    const live = full().live.games[id];
    const main = el('div', 'control-grid');
    function ctl(label, cls, op, args, opts) {
      const b = U.button(label, 'btn ' + cls, async () => {
        if (opts && opts.confirm) {
          const ok = await confirmAction(opts.confirm);
          if (!ok) return;
        }
        control(id, op, args, opts && opts.done);
      });
      b.dataset.ctl = op;
      if (opts && opts.disabled) b.disabled = true;
      main.appendChild(b);
      return b;
    }
    const hidden = !cfg.visible || !cfg.enabled;
    ctl('Start', 'btn-primary', 'start', null, { disabled: hidden || live.status === 'running', done: 'Started.' });
    ctl('Pause', 'btn-ghost', 'pause', null, { disabled: live.status !== 'running', done: 'Paused.' });
    ctl('Resume', 'btn-ghost', 'resume', null, { disabled: live.status !== 'paused', done: 'Resumed.' });
    ctl('End game', 'btn-ghost', 'end', null, { disabled: live.status === 'ended' || live.status === 'ready', confirm: { title: 'End ' + cfg.title + '?', text: 'Players still mid-run are stopped and their scores submitted. New runs can’t start until you press Start again.', ok: 'End game' }, done: 'Ended.' });
    if (INFO[id].arcade) {
      ctl('Next round', 'btn-ghost', 'nextRound', null, { disabled: hidden, done: 'A new synchronised round starts in a few seconds.' });
      ctl('Generate new seed', 'btn-ghost', 'newSeed', null, { done: 'New seed. Consider resetting the leaderboard so everyone competes on the same pattern.' });
    }
    if (id === 'team-showdown' && full().showdown) {
      const sdPhase = full().showdown.phase;
      const nextBtn = U.button('Next question', 'btn btn-ghost', () => run(() => Store.admin.showdown('next')).then(renderControl));
      nextBtn.disabled = ['rules', 'round-intro', 'revealed', 'wager', 'wager-question', 'wager-reveal', 'wager-answer'].indexOf(sdPhase) < 0;
      const revealBtn = U.button('Reveal answer', 'btn btn-ghost', () => run(() => Store.admin.showdown('reveal')).then(renderControl));
      revealBtn.disabled = ['question', 'answering', 'steal'].indexOf(sdPhase) < 0;
      main.append(nextBtn, revealBtn, U.button('Open host screen', 'btn btn-primary', () => openPresenter('showdown')));
    }
    ctl(st.live ? 'Stop marking as live' : 'Mark as live now', 'btn-ghost', st.live ? 'clearLive' : 'setLive', null, { disabled: hidden && !st.live });
    ctl(cfg.visible ? 'Hide game' : 'Show game', 'btn-ghost', cfg.visible ? 'hide' : 'show', null, { done: cfg.visible ? 'Hidden.' : 'Visible.' });
    const reset = U.button('Reset current game', 'btn btn-ghost danger-text', () => resetGame(id));
    main.appendChild(reset);
    card.appendChild(main);

    if (INFO[id].arcade) {
      const seedForm = el('form', 'inline-field seed-form');
      seedForm.noValidate = true;
      const input = el('input', 'input input-code');
      input.placeholder = 'Type a seed, e.g. RUTH4';
      input.maxLength = 16;
      input.setAttribute('aria-label', 'Seed');
      const set = el('button', 'btn btn-ghost', 'Set seed');
      set.type = 'submit';
      seedForm.append(input, set);
      seedForm.addEventListener('submit', (e) => {
        e.preventDefault();
        control(id, 'newSeed', { seed: input.value }, 'Seed set.');
      });
      card.appendChild(seedForm);
    }
    if (id === 'redeemers-challenge') card.appendChild(el('p', 'field-help', 'For group play, open The Redeemer’s Challenge on the projector and choose Group: Next Question and Reveal Answer are on that screen. Individual players move at their own pace.'));
    if (id === 'team-showdown') card.appendChild(el('p', 'field-help', 'Run the game itself from Present → Team Showdown host screen: it has buzz, correct/wrong, reveal, next, wager and tie-breaker controls with keyboard shortcuts.'));

    if (focusId) {
      const again = box.querySelector('[data-ctl="' + focusId + '"]');
      if (again && !again.disabled) again.focus();
    }
  }

  // ───────────── Scores tab ─────────────

  let scoresToken = 0;
  async function renderScores() {
    const box = $('tab-scores');
    const token = ++scoresToken;
    box.textContent = '';
    box.appendChild(el('h1', 'admin-h1', 'Scores'));
    box.lastChild.id = 'h-scores';
    box.appendChild(gamePicker(scoresGame, (id) => {
      scoresGame = id;
      renderScores();
    }));
    const id = scoresGame;
    const card = section(box, full().config.games[id].title);
    if (id === 'team-showdown') {
      renderShowdownScores(card);
      renderDanger(box);
      return;
    }
    if (id === 'redeemers-challenge' && Store.mode === 'local') {
      card.appendChild(el('p', null, 'In local mode, The Redeemer’s Challenge keeps scores on each player’s own device, so there is nothing to show here. With the shared back end, scores from the session code appear in this table.'));
      renderDanger(box);
      return;
    }
    card.appendChild(el('p', 'muted', 'Loading…'));
    let data;
    try {
      data = await Store.admin.results(id);
    } catch (e) {
      card.lastChild.textContent = 'Couldn’t load scores: ' + e.message;
      return;
    }
    if (token !== scoresToken) return;
    card.lastChild.remove();
    const live = full().live.games[id];
    const rows = (data.rows || []).map((r) => Object.assign({}, r, r.correct != null && !r.detail ? { detail: { correct: r.correct, total: r.total } } : {}));
    const current = rows.filter((r) => r.current && !r.tiebreak);
    const ranked = S.rankPlayers(id, current, null);

    const tools = el('div', 'admin-actions');
    tools.append(
      U.button('Export CSV', 'btn btn-ghost btn-sm', () => exportCsv(id, rows)),
      U.button('Reset leaderboard', 'btn btn-ghost btn-sm', () => resetGame(id)),
      U.button('Refresh', 'btn btn-ghost btn-sm', renderScores)
    );
    card.appendChild(tools);

    // Leaderboard
    card.appendChild(el('h3', 'admin-h3', 'Leaderboard (best per player)'));
    if (!ranked.length) card.appendChild(el('p', 'muted', 'No scores since the last reset.'));
    else {
      const t = table(['#', 'Player', id === 'road-to-bethlehem' ? 'Team' : '', id === 'road-to-bethlehem' ? 'Levels' : 'Details', 'Score', 'Attempts'].filter((x, i) => x || i !== 2));
      ranked.forEach((p) => {
        const cells = [p.rank, p.nickname];
        if (id === 'road-to-bethlehem') cells.push(p.team || '—', p.levels);
        else cells.push(detailText(id, p.detail));
        cells.push(p.score, p.attempts);
        addRow(t, cells);
      });
      card.appendChild(wrapTable(t.table));
    }
    if (id === 'road-to-bethlehem' && full().config.games[id].settings.teamMode) {
      const teams = S.rankTeams(ranked);
      card.appendChild(el('h3', 'admin-h3', 'Teams (sum of members’ best scores)'));
      const t = table(['#', 'Team', 'Players', 'Levels', 'Score']);
      teams.forEach((tm) => addRow(t, [tm.rank, tm.name, tm.members, tm.levels, tm.score]));
      card.appendChild(teams.length ? wrapTable(t.table) : el('p', 'muted', 'No team scores yet.'));
    }

    // Tie-breaker
    if (INFO[id].arcade) {
      const tie = S.topTie(ranked);
      if (live.tiebreak) {
        const tb = section(box, 'Tie-breaker in progress', 'Players: ' + live.tiebreak.players.join(', ') + '. They see a tie-breaker button when they open the game. ' + (id === 'road-to-bethlehem' ? 'Fastest solve wins.' : 'Highest score wins.'));
        const tbRows = S.rankTiebreak(id, rows.filter((r) => r.tiebreak === live.tiebreak.id));
        if (tbRows.length) {
          const t = table(['#', 'Player', id === 'road-to-bethlehem' ? 'Time' : 'Score']);
          tbRows.forEach((r) => addRow(t, [r.rank, r.nickname, id === 'road-to-bethlehem' ? U.formatSeconds(r.timeMs) : r.score]));
          tb.appendChild(wrapTable(t.table));
        } else tb.appendChild(el('p', 'muted', 'No tie-breaker results yet.'));
        tb.appendChild(U.button('End tie-breaker', 'btn btn-ghost btn-sm', () => control(id, 'endTiebreak', null, 'Tie-breaker closed.')));
      } else if (tie.length) {
        const tb = section(box, 'Tie for first place', tie.map((p) => p.nickname).join(', ') + ' share first place.');
        tb.appendChild(U.button('Run a tie-breaker', 'btn btn-primary btn-sm', async () => {
          const ok = await confirmAction({ title: 'Run a tie-breaker?', text: (id === 'road-to-bethlehem' ? 'One sudden-death level; the fastest solve wins.' : 'One 30-second run on a fresh pattern; the highest score wins.') + ' Only ' + tie.map((p) => p.nickname).join(', ') + ' can play it.', ok: 'Start tie-breaker' });
          if (ok) control(id, 'tiebreak', { players: tie.map((p) => p.nickname) }, 'Tie-breaker started. The tied players should open the game.');
        }));
      }
    }

    // Every entry, with corrections
    const all = section(box, 'All entries', 'Every submitted result, newest first. Correct a score if something went wrong; the change is recorded.');
    const t = table(['Time', 'Player', 'Score', 'Details', 'Status', '']);
    rows.slice().sort((a, b) => b.at - a.at).slice(0, 300).forEach((r) => {
      const status = (r.current ? '' : 'before reset · ') + (r.tiebreak ? 'tie-breaker · ' : '') + (r.status || 'ok');
      const tr = addRow(t, [new Date(r.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), r.nickname + (r.team ? ' (' + r.team + ')' : ''), r.score, detailText(id, r.detail, r), status, '']);
      const edit = U.button('Edit', 'btn btn-link btn-inline', () => editScore(id, r, tr));
      tr.lastChild.appendChild(edit);
    });
    all.appendChild(rows.length ? wrapTable(t.table) : el('p', 'muted', 'No entries yet.'));
    renderDanger(box);
  }

  function detailText(id, d, row) {
    if (id === 'gleaners-rush' && d) return 'combo ' + (d.bestCombo || 0) + ' · ' + (d.accuracy || 0) + '%';
    if (id === 'road-to-bethlehem') return row && row.tiebreak ? U.formatSeconds(row.timeMs) : U.plural((d && d.levelsCleared) || (row && row.levels) || 0, 'level');
    if (id === 'redeemers-challenge' && d) return d.correct + ' / ' + d.total + ' correct';
    return '';
  }

  function table(headers) {
    const tableEl = el('table', 'admin-table');
    const thead = el('thead');
    const tr = el('tr');
    headers.forEach((h) => tr.appendChild(el('th', null, h)));
    thead.appendChild(tr);
    const tbody = el('tbody');
    tableEl.append(thead, tbody);
    return { table: tableEl, body: tbody };
  }

  function addRow(t, cells) {
    const tr = el('tr');
    cells.forEach((c) => tr.appendChild(el('td', null, c == null ? '' : String(c))));
    t.body.appendChild(tr);
    return tr;
  }

  function wrapTable(tableEl) {
    const w = el('div', 'table-wrap');
    w.appendChild(tableEl);
    return w;
  }

  function editScore(id, r, tr) {
    const cell = tr.children[2];
    cell.textContent = '';
    const input = el('input', 'input input-score');
    input.type = 'number';
    input.min = '0';
    input.value = String(r.score);
    input.setAttribute('aria-label', 'New score for ' + r.nickname);
    const save = U.button('Save', 'btn btn-primary btn-sm', async () => {
      const n = Math.round(Number(input.value));
      if (!isFinite(n) || n < 0) return U.toast('Enter a score of 0 or more.');
      const ok = await confirmAction({ title: 'Change ' + r.nickname + '’s score?', text: 'From ' + r.score + ' to ' + n + '. The entry is marked as adjusted.', ok: 'Change score' });
      if (!ok) return;
      if (await run(() => Store.admin.adjust(id, r.id, n), 'Score updated.')) renderScores();
    });
    cell.append(input, save);
    input.focus();
  }

  function renderShowdownScores(card) {
    const sd = full().showdown;
    if (!sd) {
      card.appendChild(el('p', 'muted', 'Team Showdown hasn’t been set up yet.'));
      return;
    }
    card.appendChild(el('p', 'muted', 'Phase: ' + sd.phase + '. Change a team’s score here or with “Adjust scores” on the host screen.'));
    const t = table(['Team', 'Score', 'Streak', 'Set score']);
    sd.teams.forEach((team, i) => {
      const tr = addRow(t, [team.name, team.score, team.streak, '']);
      const input = el('input', 'input input-score');
      input.type = 'number';
      input.value = String(team.score);
      input.setAttribute('aria-label', 'New score for ' + team.name);
      const save = U.button('Set', 'btn btn-ghost btn-sm', async () => {
        const ok = await confirmAction({ title: 'Set ' + team.name + '’s score to ' + input.value + '?', ok: 'Set score' });
        if (ok && (await run(() => Store.admin.showdown('setScore', { team: i, score: Number(input.value) }), 'Score set.'))) renderScores();
      });
      tr.lastChild.append(input, save);
    });
    card.appendChild(wrapTable(t.table));
    const row = el('div', 'admin-actions');
    row.append(
      U.button('Export CSV', 'btn btn-ghost btn-sm', () => {
        downloadCsv('team-showdown', U.toCsv([['Team', 'Score', 'Streak']].concat(sd.teams.map((tm) => [tm.name, tm.score, tm.streak]))));
      }),
      U.button('Open host screen', 'btn btn-primary btn-sm', () => openPresenter('showdown'))
    );
    card.appendChild(row);
  }

  function renderDanger(box) {
    const danger = section(box, 'Reset the entire session', 'Resets every leaderboard, Team Showdown and every game’s status. Settings and questions are kept. Results stay in the records but stop counting.');
    danger.classList.add('danger-card');
    danger.appendChild(U.button('Reset entire session…', 'btn btn-danger', async () => {
      const ok = await confirmAction({ title: 'Reset the entire session?', text: 'All four leaderboards start from zero and Team Showdown returns to the lobby.', word: 'RESET', ok: 'Reset everything' });
      if (ok && (await run(() => Store.admin.resetSession(), 'The session has been reset.'))) renderTab(true);
    }));
  }

  function exportCsv(id, rows) {
    const header = ['Game', 'Submitted', 'Nickname', 'Team', 'Score', 'Levels', 'Time (s)', 'Status', 'Counts now', 'Tie-breaker', 'Details'];
    const lines = [header].concat(
      rows.map((r) => [
        full().config.games[id].title,
        new Date(r.at).toISOString(),
        r.nickname,
        r.team || '',
        r.score,
        r.levels || '',
        r.timeMs ? (r.timeMs / 1000).toFixed(1) : '',
        r.status || 'ok',
        r.current ? 'yes' : 'no',
        r.tiebreak ? 'yes' : '',
        r.detail ? JSON.stringify(r.detail) : r.correct != null ? r.correct + '/' + r.total : '',
      ])
    );
    downloadCsv(id, U.toCsv(lines));
  }

  function downloadCsv(id, csv) {
    const name = id + '-' + new Date().toISOString().slice(0, 10) + '.csv';
    try {
      const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = name;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
        URL.revokeObjectURL(a.href);
        a.remove();
      }, 1000);
      U.toast('Downloading ' + name);
    } catch (e) {
      showCsvText(csv);
    }
    if (isGas) showCsvText(csv);
  }

  function showCsvText(csv) {
    const box = $('tab-scores');
    const card = section(box, 'CSV', 'If the download didn’t start, copy this text into a spreadsheet. (The Scores and Results tabs of the Google Sheet also hold everything.)');
    const ta = el('textarea', 'input csv-box');
    ta.value = csv;
    ta.rows = 8;
    ta.readOnly = true;
    card.appendChild(ta);
    ta.focus();
    ta.select();
  }

  // ───────────── Present tab & projector view ─────────────

  function renderPresent() {
    const box = $('tab-present');
    box.textContent = '';
    box.appendChild(el('h1', 'admin-h1', 'Present on the big screen'));
    box.lastChild.id = 'h-present';
    box.appendChild(el('p', 'muted admin-sub', 'Opens a full-screen view with large text for the projector. Press Esc or the × to come back.'));
    const grid = el('div', 'present-grid');
    function tile(titleText, text, fn, primary) {
      const c = el('button', 'card present-tile' + (primary ? ' primary' : ''));
      c.type = 'button';
      c.append(el('strong', null, titleText), el('span', null, text));
      c.addEventListener('click', fn);
      grid.appendChild(c);
    }
    tile('Welcome & join screen', 'Session title, the link for phones and what’s live.', () => openPresenter('lobby'), true);
    tile('Team Showdown host screen', 'Run the game show: buzzers, scoring, wager and tie-breaker.', () => openPresenter('showdown'), true);
    tile('Live leaderboard: ' + title('gleaners-rush'), 'Updates every few seconds.', () => openPresenter('board:gleaners-rush'));
    tile('Live leaderboard: ' + title('road-to-bethlehem'), 'Levels cleared, then score.', () => openPresenter('board:road-to-bethlehem'));
    box.appendChild(grid);
    box.appendChild(el('p', 'field-help', 'The Redeemer’s Challenge has its own projector mode: open it in the participant view and choose Group, or use its “Host a live leaderboard” screen.'));
  }

  function openPresenter(kind) {
    closePresenter();
    const pres = $('presenter');
    const body = $('presenterBody');
    body.textContent = '';
    pres.hidden = false;
    document.body.classList.add('presenting');
    if (pres.requestFullscreen && !document.fullscreenElement) pres.requestFullscreen().catch(() => {});
    if (kind === 'showdown') {
      presenter = Object.assign({ kind }, root.ShowdownHost.mount(body, { store: Store }));
    } else if (kind === 'lobby') {
      presenter = { kind, destroy: () => {} };
      renderLobby(body);
      presenter.unsub = Store.subscribe(() => renderLobby(body));
    } else {
      const game = kind.split(':')[1];
      presenter = { kind, destroy: () => clearInterval(presenter && presenter.timer) };
      const wrap = el('div', 'pres-board');
      wrap.append(el('p', 'pres-kicker', 'Live leaderboard'), el('h2', 'pres-title', title(game)));
      const list = el('ol', 'leaderboard pres-list');
      const meta = el('p', 'pres-meta');
      wrap.append(list, meta);
      body.appendChild(wrap);
      const load = async () => {
        const b = await Store.board(game);
        root.HubBoard.render(list, (b.players || []).slice(0, 10).map((p) => ({
          key: p.key || p.nickname,
          rank: p.rank,
          name: p.nickname,
          detail: game === 'road-to-bethlehem' ? U.plural(p.levels, 'level') + (p.team ? ' · ' + p.team : '') : p.detail ? 'Best combo ' + p.detail.bestCombo : '',
          score: p.score,
        })), { empty: 'Waiting for the first scores…' });
        meta.textContent = U.plural((b.players || []).length, 'player') + ' · updated ' + new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      };
      load();
      presenter.timer = setInterval(load, 3000);
    }
    $('presenterClose').focus();
  }

  function renderLobby(body) {
    const st = Store.state();
    body.textContent = '';
    const wrap = el('div', 'pres-lobby');
    wrap.append(el('p', 'pres-kicker', 'Welcome'), el('h2', 'pres-title', full().config.session.title));
    if (full().config.session.welcome) wrap.appendChild(el('p', 'pres-sub', full().config.session.welcome));
    const join = el('div', 'pres-join');
    join.append(el('span', null, 'Join on your phone'), el('strong', null, participantUrl('').replace(/^https?:\/\//, '')));
    if (Store.mode === 'local') join.appendChild(el('em', null, 'Local mode: phones play on their own; leaderboards stay on each device.'));
    wrap.appendChild(join);
    const games = el('ol', 'pres-games');
    (st ? st.games : []).forEach((g) => {
      const li = el('li', g.live ? 'live' : '');
      li.append(el('span', null, g.title), el('small', null, g.live ? 'Live now' : { open: 'Open', waiting: 'Coming up', paused: 'Paused', ended: 'Finished' }[g.reason] || ''));
      games.appendChild(li);
    });
    wrap.appendChild(games);
    body.appendChild(wrap);
  }

  function closePresenter() {
    if (presenter) {
      if (presenter.unsub) presenter.unsub();
      presenter.destroy();
      presenter = null;
    }
    $('presenter').hidden = true;
    document.body.classList.remove('presenting');
    if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(() => {});
  }

  $('presenterClose').addEventListener('click', closePresenter);
  root.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && presenter && !document.querySelector('dialog[open]')) closePresenter();
  });

  // ───────────── Access tab ─────────────

  function renderAccess() {
    const box = $('tab-access');
    box.textContent = '';
    box.appendChild(el('h1', 'admin-h1', 'Access & security'));
    box.lastChild.id = 'h-access';
    const card = section(box, Store.mode === 'local' ? 'Local mode' : 'Shared mode');
    if (Store.mode === 'local') {
      card.append(
        el('p', null, 'No back end is connected, so this dashboard changes this browser only. Open the participant view in another tab or window on this same device (for example, the projector laptop) and it follows your changes straight away.'),
        el('p', null, 'Other people’s phones are not affected and cannot be controlled from here. There is no password because nothing shared can be changed. A password typed into a static page would not protect anything anyway.'),
        el('p', 'muted', 'For phones that follow the session, shared leaderboards and Team Showdown buzzers, set up the Apps Script back end (README → “Shared mode”).')
      );
      return;
    }
    const how = who && who.method === 'google' ? 'Signed in as ' + who.email + '. The server checked this Google account against the admin list.' : 'Signed in with the admin key. The server checks the key on every request.';
    card.append(el('p', null, how), el('p', null, 'Every change you make here is checked by the server. Participants can’t reach these actions even if they find this page.'));
    const list = el('ul', 'rules-list');
    [
      'Admins by Google account: the script owner is always an admin. Add others under Project Settings → Script properties → ADMIN_EMAILS (comma-separated). Google only tells the script who is visiting when it’s the owner or someone in the same Google Workspace domain; for anyone else, use the admin key.',
      'Admin key: run createAdminKey from the Apps Script editor. It prints a new key once and stores only a fingerprint of it. Running it again replaces the old key.',
    ].forEach((t) => list.appendChild(el('li', null, t)));
    card.appendChild(list);
    if (Store.admin.hasKey()) card.appendChild(U.button('Forget the admin key on this device', 'btn btn-ghost', () => {
      Store.admin.setKey('');
      U.toast('Admin key removed from this device.');
      root.location.reload();
    }));
  }

  // ───────────── Gate ─────────────

  function showGate() {
    $('adminGate').hidden = false;
    const ways = $('gateWays');
    ways.textContent = '';
    if (isGas) ways.appendChild(el('li', null, 'If you own this Apps Script project (or are listed in ADMIN_EMAILS), open this page while signed in to that Google account. If you have several accounts signed in, use a browser profile or private window with just that one.'));
    ways.appendChild(el('li', null, 'Or sign in with the admin key created by running createAdminKey in the Apps Script editor.'));
    $('keyForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const key = $('adminKeyInput').value.trim();
      if (!key) return;
      $('keyError').textContent = '';
      try {
        const res = await Store.whoami(key);
        if (!res.isAdmin) {
          $('keyError').textContent = res.message || 'That key wasn’t accepted.';
          return;
        }
        Store.admin.setKey(key, $('rememberKey').checked);
        root.location.reload();
      } catch (ex) {
        $('keyError').textContent = ex.message;
      }
    });
  }

  // ───────────── Start ─────────────

  function renderHeader() {
    $('adminTitle').textContent = full().config.session.title;
    const mode = $('adminMode');
    mode.textContent = '';
    mode.append(el('span', 'dot' + (Store.mode === 'shared' ? ' ok' : '')), document.createTextNode(Store.mode === 'shared' ? 'Shared session' : 'Local mode · this browser only'));
    $('participantLink').href = participantUrl('');
  }

  async function start() {
    let res;
    try {
      res = await Store.init({ role: 'admin' });
    } catch (e) {
      $('adminLoading').textContent = 'Couldn’t load: ' + e.message;
      return;
    }
    $('adminLoading').hidden = true;
    if (!res.isAdmin) {
      showGate();
      return;
    }
    who = Store.mode === 'shared' ? await Store.whoami().catch(() => null) : { method: 'local' };
    draft = clone(full().config);
    $('adminShell').hidden = false;
    renderHeader();
    setTab('session');
    Store.subscribe(() => {
      renderHeader();
      if (!dirty) draft = clone(full().config);
      renderTab(false);
    });
    if (Store.mode === 'shared') Store.setPollInterval(4000);
    ticker = setInterval(() => {
      if (tab === 'control' && !document.querySelector('dialog[open]') && !(document.activeElement && document.activeElement.tagName === 'INPUT')) renderControl();
    }, 1000);
  }

  start();
})(window);
