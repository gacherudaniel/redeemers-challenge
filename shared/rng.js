/*
 * Seeded random numbers. The same seed always produces the same sequence on every
 * device (and on the Apps Script server), which is what makes the arcade and puzzle
 * games fair: everyone in a session faces the same falling objects and the same levels.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.HubRng = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const SEED_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O, 1/I

  /** A 32-bit hash of a string (MurmurHash3-style finaliser). */
  function hashString(text) {
    const str = String(text);
    let h = 1779033703 ^ str.length;
    for (let i = 0; i < str.length; i++) {
      h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
      h = (h << 13) | (h >>> 19);
    }
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return (h ^ (h >>> 16)) >>> 0;
  }

  /** mulberry32: small, fast and good enough for games. */
  function create(seed) {
    let state = typeof seed === 'number' ? seed >>> 0 : hashString(seed);
    function next() {
      state = (state + 0x6d2b79f5) >>> 0;
      let t = state;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }
    return {
      next,
      /** Integer in [min, max], inclusive. */
      int(min, max) {
        return min + Math.floor(next() * (max - min + 1));
      },
      range(min, max) {
        return min + next() * (max - min);
      },
      chance(p) {
        return next() < p;
      },
      pick(list) {
        return list[Math.floor(next() * list.length)];
      },
      shuffle(list) {
        const out = list.slice();
        for (let i = out.length - 1; i > 0; i--) {
          const j = Math.floor(next() * (i + 1));
          const tmp = out[i];
          out[i] = out[j];
          out[j] = tmp;
        }
        return out;
      },
    };
  }

  /** A fresh, human-friendly seed such as "K7QM2A". */
  function newSeed(random) {
    const rand = random || Math.random;
    let out = '';
    for (let i = 0; i < 6; i++) out += SEED_ALPHABET.charAt(Math.floor(rand() * SEED_ALPHABET.length));
    return out;
  }

  /** Seeds are 3–16 letters, numbers or dashes. Returns '' if invalid. */
  function normalizeSeed(raw) {
    const s = String(raw == null ? '' : raw).toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 16);
    return s.length >= 3 ? s : '';
  }

  return { hashString, create, newSeed, normalizeSeed, SEED_ALPHABET };
});
