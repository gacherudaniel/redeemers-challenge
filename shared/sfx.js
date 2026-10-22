/*
 * Sound effects made with Web Audio (no audio files). Silent unless the player has
 * turned sound on.
 */
(function (root) {
  'use strict';

  let ctx = null;

  function ready() {
    if (!root.HubPrefs || !root.HubPrefs.sound()) return null;
    try {
      if (!ctx) {
        const AC = root.AudioContext || root.webkitAudioContext;
        if (!AC) return null;
        ctx = new AC();
      }
      if (ctx.state === 'suspended') ctx.resume();
      return ctx;
    } catch (e) {
      return null;
    }
  }

  function tone(freq, at, dur, type, peak, slideTo) {
    const c = ready();
    if (!c) return;
    const t0 = c.currentTime + at;
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = type || 'sine';
    osc.frequency.setValueAtTime(freq, t0);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(peak || 0.07, t0 + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(gain).connect(c.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
  }

  const SOUNDS = {
    catch: () => tone(660, 0, 0.09, 'triangle', 0.05, 880),
    golden: () => { tone(784, 0, 0.1, 'triangle', 0.06); tone(1175, 0.07, 0.18, 'triangle', 0.06); },
    hazard: () => tone(180, 0, 0.3, 'sawtooth', 0.05, 90),
    power: () => { tone(520, 0, 0.12, 'sine', 0.06, 1040); tone(1040, 0.1, 0.15, 'sine', 0.04); },
    miss: () => tone(300, 0, 0.12, 'sine', 0.03, 220),
    count: () => tone(523, 0, 0.12, 'square', 0.03),
    go: () => tone(784, 0, 0.25, 'square', 0.04),
    tick: () => tone(880, 0, 0.05, 'square', 0.02),
    rotate: () => tone(420, 0, 0.05, 'triangle', 0.035, 520),
    locked: () => tone(160, 0, 0.12, 'square', 0.03),
    solve: () => [523, 659, 784, 1047].forEach((f, i) => tone(f, i * 0.08, 0.25, 'triangle', 0.05)),
    buzz: () => tone(220, 0, 0.35, 'sawtooth', 0.06, 200),
    correct: () => { tone(523, 0, 0.16, 'triangle', 0.06); tone(784, 0.1, 0.3, 'triangle', 0.06); },
    wrong: () => { tone(233, 0, 0.24, 'sine', 0.06); tone(185, 0.12, 0.32, 'sine', 0.05); },
    win: () => [523, 659, 784, 1047, 1319].forEach((f, i) => tone(f, i * 0.1, 0.4, 'triangle', 0.05)),
    end: () => { tone(392, 0, 0.2, 'sine', 0.06); tone(294, 0.16, 0.4, 'sine', 0.06); },
  };

  root.HubSfx = {
    unlock: ready,
    play(name) {
      const fn = SOUNDS[name];
      if (fn) fn();
    },
  };
})(window);
