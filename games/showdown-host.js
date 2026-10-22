/*
 * Team Showdown — the host screen for the projector, with the facilitator's control dock.
 * Used by the admin dashboard's presenter view. It works in both modes:
 *   local  — the laptop runs the game; teams shout or the facilitator taps the team that buzzed
 *   shared — team phones buzz through the Apps Script server; the facilitator adjudicates
 */
(function (root) {
  'use strict';

  const U = root.HubUtil;
  const Core = root.ShowdownCore;

  function mount(container, opts) {
    const store = opts.store;
    const el = (tag, cls, text) => U.el(tag, cls, text);
    let destroyed = false;
    let timer = null;
    let lastSeq = -1;
    let timeoutSent = -1;
    let busy = false;

    const wrap = el('div', 'sd-host');
    const top = el('div', 'sd-top');
    const stageEl = el('div', 'sd-stage');
    const board = el('ol', 'sd-board');
    const dock = el('div', 'sd-dock');
    dock.setAttribute('aria-label', 'Facilitator controls');
    wrap.append(top, stageEl, board, dock);
    container.appendChild(wrap);

    function cfg() {
      return store.admin.full().config.games['team-showdown'];
    }
    function state() {
      return store.admin.full().showdown;
    }
    function view() {
      return Core.publicView(state(), cfg(), store.now(), true);
    }

    async function act(op, args) {
      if (busy) return;
      busy = true;
      try {
        await store.admin.showdown(op, args);
        if (op === 'judge') root.HubSfx.play(args.correct ? 'correct' : 'wrong');
        if (op === 'buzz' || op === 'override') root.HubSfx.play('buzz');
      } catch (e) {
        U.toast(e.message || 'That didn’t work.');
      } finally {
        busy = false;
      }
      render();
    }

    function teamName(v, i) {
      return v.teams[i] ? v.teams[i].name : 'Team ' + (i + 1);
    }

    // ---- Rendering ----
    function render() {
      if (destroyed) return;
      const v = view();
      if (!v) return;
      const changed = v.seq !== lastSeq;
      renderTop(v);
      if (changed) {
        renderStage(v);
        renderBoard(v);
        renderDock(v);
        if (v.phase === 'finished' && lastSeq !== -1 && v.winners.length === 1) {
          root.HubSfx.play('win');
          root.HubConfetti.burst({ count: 200 });
        }
        lastSeq = v.seq;
      } else {
        updateTimers(v);
      }
      // The host enforces the question clock in both modes.
      if ((v.phase === 'question' || v.phase === 'steal') && v.timeLeft === 0 && !v.paused && timeoutSent !== v.seq) {
        timeoutSent = v.seq;
        act('timeout');
      }
    }

    function renderTop(v) {
      top.textContent = '';
      const left = el('div', 'sd-round');
      if (v.tiebreak) left.append(el('span', 'sd-pill hot', 'Tie-breaker'), el('strong', null, 'Sudden death'));
      else if (v.round) {
        left.append(el('span', 'sd-pill', 'Round ' + v.roundNumber + ' of ' + v.roundCount), el('strong', null, v.round.title));
        if (v.round.double) left.appendChild(el('span', 'sd-pill hot', 'Double points'));
      } else left.appendChild(el('strong', null, { lobby: 'Team Showdown', rules: 'How to play', wager: 'Final Wager', 'wager-question': 'Final Wager', 'wager-reveal': 'Final Wager', 'wager-answer': 'Final Wager', finished: 'Final scores' }[v.phase] || 'Team Showdown'));
      const right = el('div', 'sd-clock');
      right.dataset.role = 'clock';
      top.append(left, right);
      updateTimers(v);
    }

    function updateTimers(v) {
      const clock = top.querySelector('[data-role="clock"]');
      if (clock) {
        clock.textContent = v.timeLeft == null ? '' : v.paused ? 'Paused' : String(Math.ceil(v.timeLeft / 1000));
        clock.classList.toggle('low', v.timeLeft != null && v.timeLeft <= 5000 && !v.paused);
      }
      board.querySelectorAll('[data-lock]').forEach((n) => {
        const i = Number(n.dataset.lock);
        const ms = Math.max(0, (v.teams[i] && v.teams[i].lockMs) || 0);
        n.textContent = ms > 0 ? 'Locked ' + Math.ceil(ms / 1000) + 's' : '';
      });
    }

    function renderStage(v) {
      stageEl.textContent = '';
      stageEl.className = 'sd-stage phase-' + v.phase;
      const s = v.settings;
      if (v.phase === 'lobby') {
        stageEl.append(el('h2', 'sd-title', 'Team Showdown'), el('p', 'sd-sub', 'Buzzers, steals, streaks and a final wager.'));
        if (store.mode === 'shared') {
          const codes = el('div', 'sd-codes');
          v.teams.forEach((t, i) => {
            const c = el('div', 'sd-code');
            c.append(el('span', null, t.name), el('strong', null, v.host.joinCodes[i]));
            codes.appendChild(c);
          });
          stageEl.append(el('p', 'sd-sub', 'Team phones: open the game, choose Team Showdown, and enter your team’s code.'), codes);
        } else {
          stageEl.appendChild(el('p', 'sd-sub', 'Teams shout their name to buzz in; the facilitator taps the team that was first.'));
        }
        return;
      }
      if (v.phase === 'rules') {
        stageEl.appendChild(el('h2', 'sd-title', 'The rules in one minute'));
        const list = el('ol', 'sd-rules');
        [
          'Buzz in when you know the answer. The first team to buzz answers.',
          'Right answer: points. Wrong answer: −' + s.wrongPenalty + ', and the other teams can steal for ' + s.stealPct + '% of the points.',
          s.streakLength + ' correct answers in a row: +' + s.streakBonus + ' streak bonus on each one after that.',
          'A wrong answer or an early buzz locks your buzzer for ' + s.lockoutSec + ' seconds.',
          'Name Five: 30 seconds per team. Repeats of another team’s answers don’t count.',
          s.wagerEnabled ? 'Final Wager: secretly bet up to ' + s.maxWager + ' of your points on one last question.' : 'The highest score at the end wins.',
        ].forEach((t) => list.appendChild(el('li', null, t)));
        stageEl.appendChild(list);
        return;
      }
      if (v.phase === 'round-intro') {
        stageEl.append(el('p', 'sd-kicker', 'Round ' + v.roundNumber), el('h2', 'sd-title', v.round.title), el('p', 'sd-sub', v.round.intro));
        const meta = v.round.type === 'judged' ? v.round.points + ' points per valid answer' + (v.round.bonus ? ', +' + v.round.bonus + ' for all five' : '') : v.round.points + ' points · ' + v.round.timeSec + ' seconds';
        stageEl.appendChild(el('p', 'sd-meta', meta + (v.round.double ? ' · DOUBLE POINTS' : '')));
        return;
      }
      if (v.phase === 'wager') {
        stageEl.append(el('h2', 'sd-title', 'Final Wager'), el('p', 'sd-sub', 'Each team secretly bets part of its score on one last question (maximum ' + s.maxWager + ').'));
        const row = el('div', 'sd-wager-row');
        v.teams.forEach((t, i) => {
          const c = el('div', 'sd-wager' + (v.wager.submitted[i] ? ' done' : ''));
          c.append(el('span', null, t.name), el('strong', null, v.wager.submitted[i] ? 'Wager locked' : 'Deciding…'));
          row.appendChild(c);
        });
        stageEl.appendChild(row);
        return;
      }
      if (v.phase === 'finished') {
        if (v.winners.length === 1) stageEl.append(el('p', 'sd-kicker', v.tiebreak ? 'Tie broken!' : 'And the winner is…'), el('h2', 'sd-title sd-winner', teamName(v, v.winners[0])));
        else if (v.winners.length > 1) stageEl.append(el('p', 'sd-kicker', 'It’s a tie!'), el('h2', 'sd-title', v.winners.map((i) => teamName(v, i)).join(' & ')), el('p', 'sd-sub', 'Run a sudden-death tie-breaker, or share the glory.'));
        const closing = cfg().closing;
        if (closing) stageEl.appendChild(el('p', 'sd-sub', closing));
        return;
      }
      // Question-like phases
      if (v.question) {
        const qbox = el('div', 'sd-question');
        if (!v.tiebreak && v.round) qbox.appendChild(el('p', 'sd-kicker', 'Question ' + v.question.number + ' of ' + v.question.total));
        qbox.appendChild(el('h2', 'sd-prompt', v.question.prompt));
        if (v.question.display) qbox.appendChild(el('p', 'sd-display', v.question.display));
        stageEl.appendChild(qbox);
      }
      if (v.phase === 'answering') {
        const b = el('div', 'sd-banner answering');
        b.append(el('strong', null, teamName(v, v.answering) + (v.stealing ? ' is stealing!' : ' buzzed first!')));
        if (v.buzzes.length > 1) b.appendChild(el('span', null, v.buzzes.slice(1).map((x) => teamName(v, x.team) + ' +' + (x.after / 1000).toFixed(2) + 's').join(' · ')));
        stageEl.appendChild(b);
      }
      if (v.phase === 'steal') stageEl.appendChild(el('div', 'sd-banner steal', 'Steal! Other teams can buzz for ' + s.stealPct + '% of the points.'));
      if (v.phase === 'judged' && v.judged) {
        const j = v.judged;
        const b = el('div', 'sd-banner answering');
        const turnTeam = j.turnTeam;
        b.append(el('strong', null, (turnTeam != null ? teamName(v, turnTeam) : '') + ': name five!'));
        const dots = el('div', 'sd-dots');
        for (let k = 0; k < 5; k++) dots.appendChild(el('span', k < j.counts[turnTeam] ? 'on' : ''));
        b.appendChild(dots);
        stageEl.appendChild(b);
      }
      if (v.phase === 'revealed') {
        if (v.answer) {
          const a = el('div', 'sd-answer');
          a.appendChild(el('strong', null, v.answer.text));
          if (v.answer.note) a.appendChild(el('span', null, v.answer.note));
          stageEl.appendChild(a);
        }
        const lr = v.lastResult;
        if (lr && lr.judged) {
          const b = el('div', 'sd-banner ok');
          b.textContent = lr.deltas.map((d, i) => teamName(v, i) + ' +' + d).join(' · ');
          stageEl.appendChild(b);
        } else if (lr && lr.correct) stageEl.appendChild(el('div', 'sd-banner ok', teamName(v, lr.team) + ' +' + lr.delta + (lr.steal ? ' (steal)' : '') + (lr.bonus ? ' incl. streak bonus +' + lr.bonus : '')));
        else if (lr && !lr.correct && lr.team != null) stageEl.appendChild(el('div', 'sd-banner no', 'No one got it. ' + teamName(v, lr.team) + ' ' + lr.delta));
        else stageEl.appendChild(el('div', 'sd-banner', 'Time’s up! No points this time.'));
      }
      if (v.phase === 'wager-question') {
        const row = el('div', 'sd-wager-row');
        v.teams.forEach((t, i) => {
          const c = el('div', 'sd-wager' + (v.wager.answered[i] ? ' done' : ''));
          c.append(el('span', null, t.name), el('strong', null, v.wager.answered[i] ? 'Answer in' : 'Thinking…'));
          row.appendChild(c);
        });
        stageEl.appendChild(row);
      }
      if (v.phase === 'wager-reveal' || v.phase === 'wager-answer') {
        if (v.phase === 'wager-answer' && v.answer) {
          const a = el('div', 'sd-answer');
          a.appendChild(el('strong', null, v.answer.text));
          if (v.answer.note) a.appendChild(el('span', null, v.answer.note));
          stageEl.appendChild(a);
        }
        const row = el('div', 'sd-wager-row');
        v.teams.forEach((t, i) => {
          const c = el('div', 'sd-wager revealed');
          c.append(el('span', null, t.name), el('strong', null, 'Wager ' + (v.wager.amounts[i] || 0)));
          if (v.wager.answers && v.wager.answers[i]) c.appendChild(el('em', null, '“' + v.wager.answers[i] + '”'));
          if (v.phase === 'wager-answer') {
            const d = v.wager.deltas[i];
            c.appendChild(el('b', d >= 0 ? 'up' : 'down', (d >= 0 ? '+' : '') + d));
          }
          row.appendChild(c);
        });
        stageEl.appendChild(row);
      }
    }

    function renderBoard(v) {
      const rows = v.teams.map((t, i) => ({ i, t })).sort((a, b) => b.t.score - a.t.score || a.i - b.i);
      const before = new Map();
      Array.from(board.children).forEach((li) => before.set(li.dataset.key, li.getBoundingClientRect().left));
      board.textContent = '';
      let rank = 0;
      rows.forEach((r, k) => {
        if (k === 0 || r.t.score !== rows[k - 1].t.score) rank = k + 1;
        const li = el('li', 'sd-team');
        li.dataset.key = String(r.i);
        if (v.answering === r.i) li.classList.add('answering');
        if (v.attempted.indexOf(r.i) >= 0) li.classList.add('out');
        if (v.winners.indexOf(r.i) >= 0 && v.phase === 'finished') li.classList.add('winner');
        li.append(el('span', 'sd-rank', String(rank)), el('span', 'sd-name', r.t.name), el('span', 'sd-score', String(r.t.score)));
        const meta = el('span', 'sd-meta-line');
        if (r.t.streak >= 2) meta.appendChild(el('span', 'sd-streak', 'Streak ' + r.t.streak));
        const lock = el('span', 'sd-lock');
        lock.dataset.lock = String(r.i);
        meta.appendChild(lock);
        li.appendChild(meta);
        board.appendChild(li);
      });
      if (U.reducedMotion()) return;
      Array.from(board.children).forEach((li) => {
        const was = before.get(li.dataset.key);
        if (was === undefined) return;
        const dx = was - li.getBoundingClientRect().left;
        if (dx) li.animate([{ transform: 'translateX(' + dx + 'px)' }, { transform: 'none' }], { duration: 500, easing: 'cubic-bezier(.2,.8,.2,1)' });
      });
      updateTimers(v);
    }

    function btn(text, cls, fn, key) {
      const b = U.button(text, 'btn ' + (cls || 'btn-ghost'), fn);
      if (key) {
        b.appendChild(el('kbd', null, key));
        b.setAttribute('aria-keyshortcuts', key);
      }
      return b;
    }

    function renderDock(v) {
      dock.textContent = '';
      const main = el('div', 'sd-dock-main');
      const side = el('div', 'sd-dock-side');
      const p = v.phase;
      if (p === 'lobby') main.appendChild(btn('Start the game', 'btn-primary', () => act('start'), 'N'));
      if (p === 'rules') main.appendChild(btn('First round', 'btn-primary', () => act('next'), 'N'));
      if (p === 'round-intro') main.appendChild(btn('Show the first question', 'btn-primary', () => act('next'), 'N'));
      if (p === 'question' || p === 'steal') {
        const eligible = v.tiebreak ? v.tiebreak.teams : v.teams.map((_, i) => i);
        eligible.filter((i) => v.attempted.indexOf(i) < 0).forEach((i) => main.appendChild(btn(teamName(v, i) + ' buzzed', 'btn-team', () => act('buzz', { team: i }), String(i + 1))));
        main.appendChild(btn('Reveal answer', 'btn-ghost', () => act('reveal'), 'R'));
      }
      if (p === 'answering') {
        main.append(btn('Correct', 'btn-ok', () => act('judge', { correct: true }), 'C'), btn('Wrong', 'btn-no', () => act('judge', { correct: false }), 'X'));
        const others = (v.tiebreak ? v.tiebreak.teams : v.teams.map((_, i) => i)).filter((i) => i !== v.answering && v.attempted.indexOf(i) < 0);
        others.forEach((i) => main.appendChild(btn('Give to ' + teamName(v, i), 'btn-ghost', () => act('override', { team: i }), String(i + 1))));
      }
      if (p === 'revealed') main.appendChild(btn(v.host.step + 1 >= v.host.planLength && !v.tiebreak ? 'Continue to the finale' : 'Next question', 'btn-primary', () => act('next'), 'N'));
      if (p === 'judged') {
        main.append(btn('+1 valid', 'btn-ok', () => act('judgedMark', { delta: 1 }), '+'), btn('−1', 'btn-ghost', () => act('judgedMark', { delta: -1 }), '-'));
        const last = v.judged.turn + 1 >= v.judged.order.length;
        main.appendChild(btn(last ? 'Score this question' : 'Next team', 'btn-primary', () => act('judgedNext'), 'N'));
      }
      if (p === 'wager') {
        v.teams.forEach((t, i) => {
          const f = el('label', 'sd-wager-input');
          f.appendChild(el('span', null, t.name + ' (max ' + v.host.maxWager[i] + ')'));
          const input = el('input', 'input');
          input.type = 'number';
          input.min = '0';
          input.max = String(v.host.maxWager[i]);
          input.inputMode = 'numeric';
          if (v.host.wager.amounts[i] != null) input.value = String(v.host.wager.amounts[i]);
          input.addEventListener('change', () => act('setWager', { team: i, amount: Number(input.value) || 0 }));
          f.appendChild(input);
          main.appendChild(f);
        });
        main.appendChild(btn('Lock wagers & show the question', 'btn-primary', () => act('next'), 'N'));
      }
      if (p === 'wager-question' || p === 'wager-reveal') {
        v.teams.forEach((t, i) => {
          const box = el('div', 'sd-mark');
          const ans = v.host.wager.answers[i];
          box.appendChild(el('span', null, t.name + (ans ? ': “' + ans + '”' : '')));
          const mark = v.host.wager.marks[i];
          const yes = btn('✓', mark === true ? 'btn-ok' : 'btn-ghost', () => act('wagerMark', { team: i, correct: true }));
          const no = btn('✗', mark === false ? 'btn-no' : 'btn-ghost', () => act('wagerMark', { team: i, correct: false }));
          yes.setAttribute('aria-label', t.name + ' correct');
          no.setAttribute('aria-label', t.name + ' wrong');
          box.append(yes, no);
          main.appendChild(box);
        });
        main.appendChild(btn(p === 'wager-question' ? 'Reveal the wagers' : 'Reveal the answer', 'btn-primary', () => act('next'), 'N'));
      }
      if (p === 'wager-answer') main.appendChild(btn('Final results', 'btn-primary', () => act('next'), 'N'));
      if (p === 'finished') {
        if (v.winners.length > 1 && !v.tiebreak) main.appendChild(btn('Run a tie-breaker', 'btn-primary', () => act('tiebreak')));
        main.appendChild(btn('Reset for a new game', 'btn-ghost', () => {
          if (root.confirm('Reset Team Showdown? Scores go back to zero.')) act('reset');
        }));
      }

      if (v.host.answer && p !== 'lobby' && p !== 'rules' && p !== 'finished' && !v.answer) {
        // This bar is on the projector too, so the answer stays hidden until the host peeks.
        const a = el('div', 'sd-host-answer');
        const peek = U.button('Peek at the answer', 'btn btn-ghost btn-sm', () => {
          a.textContent = '';
          a.appendChild(el('strong', null, v.host.answer.text));
          if (v.host.answer.accept.length) a.appendChild(el('span', 'muted', ' · also: ' + v.host.answer.accept.join(', ')));
          setTimeout(() => {
            if (a.isConnected) {
              a.textContent = '';
              a.appendChild(peek);
            }
          }, 4000);
        });
        peek.setAttribute('aria-keyshortcuts', 'A');
        peek.appendChild(el('kbd', null, 'A'));
        a.appendChild(peek);
        side.appendChild(a);
      }
      if (p !== 'lobby') {
        if (v.timeLeft != null) side.appendChild(btn(v.paused ? 'Resume clock' : 'Pause clock', 'btn-ghost', () => act(v.paused ? 'resume' : 'pause'), 'P'));
        const adj = el('details', 'sd-adjust');
        adj.appendChild(el('summary', null, 'Adjust scores'));
        v.teams.forEach((t, i) => {
          const row = el('div', 'sd-adjust-row');
          row.append(el('span', null, t.name), btn('−10', 'btn-ghost', () => act('adjust', { team: i, delta: -10 })), btn('+10', 'btn-ghost', () => act('adjust', { team: i, delta: 10 })));
          adj.appendChild(row);
        });
        side.appendChild(adj);
        if (p !== 'finished') side.appendChild(btn('End game', 'btn-ghost', () => {
          if (root.confirm('End Team Showdown now and show the final scores?')) act('end');
        }));
      }
      if (store.mode === 'shared') side.appendChild(el('span', 'muted sd-devices', U.plural(v.host.devices, 'team phone') + ' joined'));
      dock.append(main, side);
    }

    function onKey(e) {
      if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || e.ctrlKey || e.metaKey || e.altKey) return;
      const buttons = Array.from(dock.querySelectorAll('button[aria-keyshortcuts]'));
      const k = e.key.toUpperCase();
      const hit = buttons.find((b) => b.getAttribute('aria-keyshortcuts').toUpperCase() === k || (k === 'ARROWRIGHT' && b.getAttribute('aria-keyshortcuts') === 'N'));
      if (hit) {
        e.preventDefault();
        hit.click();
      }
    }

    root.addEventListener('keydown', onKey);
    const unsub = store.subscribe(render);
    timer = setInterval(render, 250);
    if (store.mode === 'shared') store.setPollInterval(1000);
    render();

    return {
      destroy() {
        destroyed = true;
        clearInterval(timer);
        unsub();
        root.removeEventListener('keydown', onKey);
        if (store.mode === 'shared') store.setPollInterval(4000);
        wrap.remove();
      },
    };
  }

  root.ShowdownHost = { mount };
})(window);
