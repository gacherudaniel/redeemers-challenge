/*
 * Small browser helpers shared by the hub, the games and the admin dashboard.
 */
(function (root) {
  'use strict';

  const U = {};

  U.$ = (id) => document.getElementById(id);

  U.el = function (tag, cls, text) {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text != null) node.textContent = text;
    return node;
  };

  /** A button with optional class, text and click handler. */
  U.button = function (text, cls, onClick) {
    const btn = U.el('button', cls || 'btn btn-ghost', text);
    btn.type = 'button';
    if (onClick) btn.addEventListener('click', onClick);
    return btn;
  };

  U.svg = function (id, cls) {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('aria-hidden', 'true');
    if (cls) svg.setAttribute('class', cls);
    const use = document.createElementNS(ns, 'use');
    use.setAttribute('href', '#' + id);
    svg.appendChild(use);
    return svg;
  };

  // Browser storage is optional: private windows and sandboxed frames may block it.
  U.store = {
    get(area, key, fallback) {
      try {
        const raw = root[area].getItem(key);
        return raw ? JSON.parse(raw) : fallback;
      } catch (e) {
        return fallback;
      }
    },
    set(area, key, value) {
      try {
        root[area].setItem(key, JSON.stringify(value));
        return true;
      } catch (e) {
        return false;
      }
    },
    remove(area, key) {
      try { root[area].removeItem(key); } catch (e) { /* not available */ }
    },
  };

  U.uuid = function () {
    if (root.crypto && root.crypto.randomUUID) return root.crypto.randomUUID();
    const bytes = new Uint8Array(16);
    if (root.crypto && root.crypto.getRandomValues) root.crypto.getRandomValues(bytes);
    else for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
    return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('').replace(/^(.{8})(.{4})(.{4})(.{4})/, '$1-$2-$3-$4-');
  };

  /** Shares the device id with The Redeemer's Challenge so one phone is one player. */
  U.deviceId = (function () {
    let cached = null;
    return function () {
      if (cached) return cached;
      let id = U.store.get('localStorage', 'redeemer.device.v1', null);
      if (typeof id !== 'string' || !/^[A-Za-z0-9-]{16,64}$/.test(id)) {
        id = U.uuid();
        U.store.set('localStorage', 'redeemer.device.v1', id);
      }
      cached = id;
      return id;
    };
  })();

  U.clamp = (v, min, max) => Math.min(max, Math.max(min, v));

  U.plural = (n, word, many) => n + ' ' + (n === 1 ? word : many || word + 's');

  U.formatClock = function (ms) {
    const total = Math.max(0, Math.ceil(ms / 1000));
    const m = Math.floor(total / 60);
    const s = total % 60;
    return m + ':' + String(s).padStart(2, '0');
  };

  U.formatSeconds = function (ms) {
    return (Math.max(0, ms) / 1000).toFixed(1) + 's';
  };

  /** A short buzz on phones that support it, only after the player has interacted. */
  U.vibrate = function (ms) {
    const nav = root.navigator;
    if (!nav || !nav.vibrate || !(nav.userActivation && nav.userActivation.hasBeenActive)) return;
    try { nav.vibrate(ms); } catch (e) { /* not allowed */ }
  };

  U.reducedMotion = function () {
    return !!(root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches);
  };

  let toastTimer = null;
  U.toast = function (message, ms) {
    const el = U.$('toast');
    if (!el) return;
    el.textContent = message;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, ms || 3200);
  };

  /** Plain-text CSV. Cells starting with = + - @ are prefixed so spreadsheets don't run them. */
  U.toCsv = function (rows) {
    return rows
      .map((row) =>
        row
          .map((cell) => {
            let text = cell == null ? '' : String(cell);
            if (/^[=+\-@]/.test(text)) text = "'" + text;
            return /[",\n\r]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
          })
          .join(',')
      )
      .join('\r\n');
  };

  /** Animated "3, 2, 1, Go!" in the given element. Resolves when finished. */
  U.countdown = function (el, sfx) {
    return new Promise((resolve) => {
      const steps = ['3', '2', '1', 'Go!'];
      let i = 0;
      el.hidden = false;
      function tick() {
        if (i >= steps.length) {
          el.hidden = true;
          el.textContent = '';
          resolve();
          return;
        }
        el.textContent = steps[i];
        el.classList.remove('pop');
        void el.offsetWidth; // restart the animation
        el.classList.add('pop');
        if (sfx) sfx.play(i < 3 ? 'count' : 'go');
        i += 1;
        setTimeout(tick, i === steps.length ? 450 : 750);
      }
      tick();
    });
  };

  root.HubUtil = U;
})(window);
