/*
 * The Redeemer's Challenge — connection to the optional shared leaderboard.
 *
 * Three cases:
 *   - Served by Apps Script: calls the server with google.script.run (same origin, no CORS).
 *   - GitHub Pages with config.apiUrl set: POSTs JSON as text/plain to the /exec URL.
 *     A text/plain body is a "simple" request, so the browser sends no CORS preflight
 *     (Apps Script cannot answer one). Apps Script replies with a redirect to
 *     script.googleusercontent.com, which allows any origin, so the reply is readable.
 *   - Neither: the game runs entirely on this device.
 * Nothing is reported as connected until a "ping" round trip has succeeded.
 */
(function (root) {
  'use strict';

  const config = root.REDEEMER_CONFIG || {};
  const apiUrl = typeof config.apiUrl === 'string' ? config.apiUrl.trim() : '';
  const hasGas = !!(root.google && root.google.script && root.google.script.run);
  // '/exec' (same origin) is used by the local development server in dev/server.js.
  const kind = hasGas ? 'gas' : /^https:\/\/script\.google\.com\/.+\/exec$/.test(apiUrl) || apiUrl === '/exec' ? 'http' : 'none';

  class BackendError extends Error {
    constructor(code, message) {
      super(message);
      this.code = code;
    }
  }

  const status = { kind, checked: kind === 'none', connected: false, leaderboard: false, hub: false };
  let checking = null;

  function viaGas(body, timeoutMs) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new BackendError('TIMEOUT', 'The server took too long to reply.')), timeoutMs);
      root.google.script.run
        .withSuccessHandler((data) => { clearTimeout(timer); resolve(data); })
        .withFailureHandler(() => { clearTimeout(timer); reject(new BackendError('NETWORK', 'Could not reach the server.')); })
        .api(body);
    });
  }

  async function viaHttp(body, timeoutMs) {
    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : null;
    let res;
    try {
      res = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(body),
        redirect: 'follow',
        signal: ctrl ? ctrl.signal : undefined,
      });
    } catch (e) {
      throw new BackendError('NETWORK', 'Could not reach the shared leaderboard.');
    } finally {
      if (timer) clearTimeout(timer);
    }
    try {
      return await res.json();
    } catch (e) {
      throw new BackendError('NETWORK', 'The shared leaderboard sent an unexpected reply.');
    }
  }

  async function call(action, payload, opts) {
    if (kind === 'none') throw new BackendError('NOT_CONFIGURED', 'No shared leaderboard is configured.');
    const body = Object.assign({ action }, payload || {});
    const timeoutMs = (opts && opts.timeoutMs) || 15000;
    const data = kind === 'gas' ? await viaGas(body, timeoutMs) : await viaHttp(body, timeoutMs);
    if (!data || !data.ok) {
      throw new BackendError((data && data.error) || 'SERVER_ERROR', (data && data.message) || 'Something went wrong. Please try again.');
    }
    return data;
  }

  /** Pings the server once; later calls share the same answer. */
  function check() {
    if (kind === 'none') return Promise.resolve(status);
    if (!checking) {
      checking = call('ping', {}, { timeoutMs: 10000 })
        .then((data) => {
          status.connected = true;
          status.leaderboard = !!data.leaderboard;
          status.hub = !!data.hub;
        })
        .catch(() => {
          status.connected = false;
          status.leaderboard = false;
        })
        .then(() => {
          status.checked = true;
          return status;
        });
    }
    return checking;
  }

  root.RedeemerBackend = { kind, status, call, check, BackendError };
})(window);
