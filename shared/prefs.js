/*
 * Per-device preferences shared by every game: sound, theme, nickname and team.
 * Sound is off by default.
 */
(function (root) {
  'use strict';

  const KEY = 'hub.prefs.v1';
  const store = root.HubUtil.store;
  const listeners = [];

  const prefs = Object.assign({ sound: false, theme: 'auto', nickname: '', team: '' }, store.get('localStorage', KEY, {}));
  if (['auto', 'light', 'dark'].indexOf(prefs.theme) < 0) prefs.theme = 'auto';
  prefs.sound = prefs.sound === true;

  function applyTheme() {
    if (prefs.theme === 'light' || prefs.theme === 'dark') document.documentElement.setAttribute('data-theme', prefs.theme);
    else document.documentElement.removeAttribute('data-theme');
  }

  root.HubPrefs = {
    get: () => Object.assign({}, prefs),
    sound: () => prefs.sound,
    set(patch) {
      Object.assign(prefs, patch);
      store.set('localStorage', KEY, prefs);
      if ('theme' in patch) applyTheme();
      listeners.forEach((fn) => fn(Object.assign({}, prefs)));
    },
    onChange(fn) {
      listeners.push(fn);
    },
    applyTheme,
  };

  applyTheme();
})(window);
