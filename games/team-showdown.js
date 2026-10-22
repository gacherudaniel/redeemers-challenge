/*
 * Game 4 — Team Showdown, participant side: one phone per team becomes a buzzer.
 * The game itself is hosted on the big screen (admin presenter view). Buzzers need the
 * shared back end; without it, teams shout and the facilitator taps who was first.
 */
(function (root) {
  'use strict';

  const U = root.HubUtil;
  const ID = 'team-showdown';
  let mounted = null;

  function createView(rootEl, ctx) {
    const el = (tag, cls, text) => U.el(tag, cls, text);
    const shell = el('div', 'game-shell showdown');
    rootEl.appendChild(shell);
    let destroyed = false;
    let lastKey = '';
    let pending = false;
    let ticker = null;

    function game() {
      return ctx.store.game(ID);
    }
    function sd() {
      const st = ctx.store.state();
      return st && st.showdown;
    }

    function header(g) {
      const head = el('div', 'game-head');
      head.append(el('p', 'eyebrow', 'Team game show · Finale'), el('h2', 'display-sm', g ? g.title : 'Team Showdown'));
      if (g && g.description) head.appendChild(el('p', 'lead', g.description));
      return head;
    }

    function renderLocal(g) {
      shell.textContent = '';
      shell.appendChild(header(g));
      const card = el('div', 'card info-card');
      card.append(
        el('h3', null, 'Watch the big screen'),
        el('p', null, 'Team Showdown is hosted from the front. When you know an answer, shout your team name. The facilitator decides who was first.'),
        el('p', 'muted', 'Phone buzzers need the shared back end (see the README). Without it, the game still works with voices.')
      );
      shell.appendChild(card);
      shell.appendChild(U.button('Back to games', 'btn btn-ghost', ctx.exit));
    }

    function renderJoin(g, v) {
      shell.textContent = '';
      shell.appendChild(header(g));
      const form = el('form', 'join-form card');
      form.noValidate = true;
      form.appendChild(el('h3', null, 'Turn this phone into your team’s buzzer'));
      form.appendChild(el('p', 'muted', 'Choose your team, then type the 4-digit code shown on the big screen. One phone per team is plenty.'));
      const teams = el('div', 'team-pick');
      let chosen = null;
      (v ? v.teams : []).forEach((t, i) => {
        const b = U.button(t.name, 'team-pick-btn', () => {
          chosen = i;
          teams.querySelectorAll('button').forEach((x, k) => x.setAttribute('aria-pressed', String(k === i)));
          code.focus();
        });
        b.setAttribute('aria-pressed', 'false');
        teams.appendChild(b);
      });
      const label = el('label', 'field-label', 'Team code');
      label.htmlFor = 'sdCode';
      const code = el('input', 'input input-code');
      code.id = 'sdCode';
      code.inputMode = 'numeric';
      code.maxLength = 4;
      code.autocomplete = 'off';
      const err = el('p', 'field-error');
      err.setAttribute('role', 'alert');
      const go = el('button', 'btn btn-primary btn-xl', 'Join');
      go.type = 'submit';
      form.append(teams, label, code, err, go);
      shell.appendChild(form);
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (chosen === null) {
          err.textContent = 'Choose your team first.';
          return;
        }
        if (!/^\d{4}$/.test(code.value.trim())) {
          err.textContent = 'Enter the 4-digit code from the big screen.';
          return code.focus();
        }
        go.disabled = true;
        try {
          await ctx.store.showdown.join(code.value.trim(), chosen);
          lastKey = '';
          render();
        } catch (ex) {
          err.textContent = ex.message;
          go.disabled = false;
        }
      });
    }

    function renderBuzzer(g, v, token) {
      const me = token.team;
      const team = v.teams[me];
      const key = [v.seq, v.phase, me, v.answering, v.attempted.join(), v.paused, v.wager ? JSON.stringify(v.wager) : ''].join('|');
      if (key === lastKey) {
        updateLock(v, me);
        return;
      }
      lastKey = key;
      shell.textContent = '';
      const top = el('div', 'buzz-top');
      top.append(el('span', 'buzz-team', team ? team.name : token.name), el('span', 'buzz-score', team ? String(team.score) + ' pts' : ''));
      const leave = U.button('Switch team', 'btn btn-link', () => {
        ctx.store.showdown.leave();
        lastKey = '';
        render();
      });
      top.appendChild(leave);
      shell.appendChild(top);

      const q = el('div', 'buzz-question');
      if (v.round && !v.tiebreak) q.appendChild(el('p', 'eyebrow', v.round.title + (v.round.double ? ' · Double points' : '')));
      if (v.question) {
        q.appendChild(el('p', 'buzz-prompt', v.question.prompt));
        if (v.question.display) q.appendChild(el('p', 'buzz-display', v.question.display));
      }
      shell.appendChild(q);

      const p = v.phase;
      const inTie = !v.tiebreak || v.tiebreak.teams.indexOf(me) >= 0;
      if (p === 'wager') return renderWagerInput(v, me);
      if (p === 'wager-question') return renderWagerAnswer(v, me);

      const buzz = el('button', 'buzzer');
      buzz.type = 'button';
      const status = el('p', 'buzz-status');
      status.setAttribute('role', 'status');
      let label = 'Get ready…';
      let enabled = false;
      if (v.paused) label = 'Paused';
      else if ((p === 'question' || p === 'steal') && inTie) {
        if (v.attempted.indexOf(me) >= 0) label = 'Already answered';
        else {
          label = p === 'steal' ? 'STEAL!' : 'BUZZ!';
          enabled = true;
        }
      } else if (p === 'answering') label = v.answering === me ? 'You’re answering!' : (v.teams[v.answering] || {}).name + ' is answering';
      else if (p === 'revealed' && v.lastResult && v.lastResult.team === me) label = v.lastResult.correct ? 'Correct! +' + v.lastResult.delta : 'Not this time ' + v.lastResult.delta;
      else if (p === 'judged') label = v.judged && v.judged.turnTeam === me ? 'Your turn: name five!' : 'Name Five';
      else if (p === 'finished') label = v.winners.indexOf(me) >= 0 && v.winners.length === 1 ? 'You won! 🎉' : 'Game over';
      else if (p === 'round-intro') label = 'Next round coming…';
      else if (p === 'wager-reveal' || p === 'wager-answer') label = 'Watch the big screen';
      buzz.textContent = label;
      buzz.disabled = !enabled;
      if (p === 'answering' && v.answering === me) buzz.classList.add('mine');
      buzz.addEventListener('click', doBuzz);
      shell.append(buzz, status);
      if (p === 'answering' && v.answering === me) status.textContent = 'Say your answer out loud!';
      updateLock(v, me);
    }

    function updateLock(v, me) {
      const t = v.teams[me];
      const buzz = shell.querySelector('.buzzer');
      if (!buzz || !t) return;
      if (t.lockMs > 0 && !buzz.disabled) {
        buzz.dataset.locked = '1';
        buzz.textContent = 'Locked ' + Math.ceil(t.lockMs / 1000) + 's';
      } else if (buzz.dataset.locked && t.lockMs <= 0) {
        delete buzz.dataset.locked;
        lastKey = '';
        render();
      }
    }

    async function doBuzz() {
      if (pending) return;
      pending = true;
      root.HubSfx.play('buzz');
      U.vibrate(40);
      const buzz = shell.querySelector('.buzzer');
      const status = shell.querySelector('.buzz-status');
      if (buzz) {
        buzz.classList.add('pressed');
        buzz.textContent = 'Buzzed!';
      }
      try {
        await ctx.store.showdown.buzz();
        const v = sd();
        const me = ctx.store.showdown.token().team;
        if (status && v) status.textContent = v.answering === me ? 'You were first!' : v.answering != null ? (v.teams[v.answering] || {}).name + ' was first.' : '';
      } catch (e) {
        if (status) status.textContent = e.message;
      } finally {
        pending = false;
        lastKey = '';
        setTimeout(render, 600);
      }
    }

    function renderWagerInput(v, me) {
      const max = v.wager.max[me];
      const form = el('form', 'wager-form card');
      form.noValidate = true;
      form.append(el('h3', null, 'Final Wager'), el('p', 'muted', 'Secretly bet up to ' + max + ' points. Get it right to win them; get it wrong to lose them.'));
      const input = el('input', 'input');
      input.type = 'number';
      input.min = '0';
      input.max = String(max);
      input.inputMode = 'numeric';
      input.setAttribute('aria-label', 'Your wager');
      const err = el('p', 'field-error');
      const go = el('button', 'btn btn-primary btn-xl', v.wager.submitted[me] ? 'Change wager' : 'Lock in wager');
      go.type = 'submit';
      form.append(input, err, go);
      if (v.wager.submitted[me]) form.appendChild(el('p', 'game-status', 'Wager received. You can change it until the question appears.'));
      shell.appendChild(form);
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const n = Number(input.value);
        if (!Number.isFinite(n) || n < 0 || n > max) {
          err.textContent = 'Enter a number from 0 to ' + max + '.';
          return;
        }
        go.disabled = true;
        try {
          await ctx.store.showdown.wager(Math.round(n), null);
          lastKey = '';
          render();
        } catch (ex) {
          err.textContent = ex.message;
          go.disabled = false;
        }
      });
    }

    function renderWagerAnswer(v, me) {
      const form = el('form', 'wager-form card');
      form.noValidate = true;
      form.append(el('h3', null, 'Your final answer'));
      const input = el('input', 'input');
      input.maxLength = 80;
      input.autocomplete = 'off';
      input.setAttribute('aria-label', 'Your answer');
      const err = el('p', 'field-error');
      const go = el('button', 'btn btn-primary btn-xl', v.wager.answered[me] ? 'Change answer' : 'Submit answer');
      go.type = 'submit';
      form.append(input, err, go);
      if (v.wager.answered[me]) form.appendChild(el('p', 'game-status', 'Answer received. You can change it until time runs out.'));
      shell.appendChild(form);
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (!input.value.trim()) {
          err.textContent = 'Type an answer first.';
          return;
        }
        go.disabled = true;
        try {
          await ctx.store.showdown.wager(null, input.value.trim());
          lastKey = '';
          render();
        } catch (ex) {
          err.textContent = ex.message;
          go.disabled = false;
        }
      });
    }

    function render() {
      if (destroyed) return;
      const g = game();
      if (ctx.store.mode !== 'shared' || ctx.store.preview) {
        if (!shell.dataset.local) {
          shell.dataset.local = '1';
          renderLocal(g);
        }
        return;
      }
      const v = sd();
      const token = ctx.store.showdown.token();
      if (!token || !v || !v.teams[token.team]) {
        if (shell.dataset.view !== 'join') {
          shell.dataset.view = 'join';
          renderJoin(g, v);
        }
        return;
      }
      shell.dataset.view = 'buzzer';
      renderBuzzer(g, v, token);
    }

    function onKey(e) {
      if (e.key === ' ' && /^(BODY|BUTTON)$/.test(e.target.tagName)) {
        const buzz = shell.querySelector('.buzzer');
        if (buzz && !buzz.disabled) {
          e.preventDefault();
          doBuzz();
        }
      }
    }

    root.addEventListener('keydown', onKey);
    if (ctx.store.mode === 'shared') ctx.store.setPollInterval(1500);
    ticker = setInterval(() => {
      const v = sd();
      const t = ctx.store.showdown.token();
      if (v && t) updateLock(v, t.team);
    }, 500);
    render();

    return {
      update: render,
      destroy() {
        destroyed = true;
        clearInterval(ticker);
        root.removeEventListener('keydown', onKey);
        if (ctx.store.mode === 'shared') ctx.store.setPollInterval(6000);
        shell.remove();
      },
      isBusy: () => false,
    };
  }

  root.HubGames = root.HubGames || {};
  root.HubGames[ID] = {
    mount(rootEl, ctx) {
      mounted = createView(rootEl, ctx);
    },
    update: () => mounted && mounted.update(),
    unmount() {
      if (mounted) mounted.destroy();
      mounted = null;
    },
    isBusy: () => false,
  };
})(window);
