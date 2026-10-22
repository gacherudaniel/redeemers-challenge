/*
 * Animated leaderboard lists. Rows slide to their new positions when ranks change
 * (FLIP technique), and rows that moved up flash briefly.
 *
 * rows: [{ key, rank, name, detail, score, you }]
 */
(function (root) {
  'use strict';

  const U = root.HubUtil;

  function render(list, rows, opts) {
    opts = opts || {};
    const before = new Map();
    const oldRanks = new Map();
    Array.from(list.children).forEach((li) => {
      if (li.dataset.key) {
        before.set(li.dataset.key, li.getBoundingClientRect().top);
        oldRanks.set(li.dataset.key, Number(li.dataset.rank));
      }
    });

    list.textContent = '';
    if (!rows.length) {
      list.appendChild(U.el('li', 'leaderboard-empty', opts.empty || 'No scores yet.'));
      return;
    }

    const limit = opts.limit || rows.length;
    rows.slice(0, limit).forEach((row) => {
      const li = U.el('li', row.you ? 'is-you' : '');
      li.dataset.key = row.key;
      li.dataset.rank = String(row.rank);
      const who = U.el('span', 'who', row.name);
      if (row.detail) who.appendChild(U.el('small', null, row.detail));
      li.append(U.el('span', 'rank', String(row.rank)), who, U.el('span', 'pts', String(row.score)));
      list.appendChild(li);
    });

    if (U.reducedMotion()) return;
    Array.from(list.children).forEach((li) => {
      const key = li.dataset.key;
      if (!key) return;
      const prevTop = before.get(key);
      const now = li.getBoundingClientRect().top;
      if (prevTop === undefined) {
        li.animate([{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'none' }], { duration: 300, easing: 'ease-out' });
        return;
      }
      const dy = prevTop - now;
      if (dy) li.animate([{ transform: 'translateY(' + dy + 'px)' }, { transform: 'none' }], { duration: 450, easing: 'cubic-bezier(.2,.8,.2,1)' });
      const was = oldRanks.get(key);
      if (was && Number(li.dataset.rank) < was) li.classList.add('rank-up');
    });
  }

  root.HubBoard = { render };
})(window);
