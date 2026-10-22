/*
 * A small stand-in for the Google services the Apps Script code uses, so the real
 * apps-script/*.gs files can run in Node — for the automated tests and for the local
 * development server (dev/server.js). Not used in production.
 */
'use strict';

const vm = require('vm');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DIR = path.join(__dirname, '..', 'apps-script');
const FILES = ['Shared.gs', 'Content.gs', 'Code.gs', 'Hub.gs'];
const PROPERTY_LIMIT = 9 * 1024; // Apps Script's per-value limit

function createGas(opts) {
  opts = opts || {};
  const props = new Map();
  const cache = new Map();
  const clock = opts.clock || { now: () => Date.now() };
  let activeEmail = opts.activeEmail || '';
  const ownerEmail = opts.ownerEmail === undefined ? 'owner@example.com' : opts.ownerEmail;
  let busy = !!opts.busy;
  let unbound = !!opts.unbound;

  const sheets = {};
  function fakeSheet() {
    const rows = [];
    return {
      rows,
      appendRow(r) { rows.push(r.slice()); },
      setFrozenRows() {},
      getDataRange() {
        // Like Sheets, a leading apostrophe marks text and is not part of the value.
        return { getValues: () => rows.map((r) => r.map((v) => (typeof v === 'string' && v.charAt(0) === "'" ? v.slice(1) : v))) };
      },
      getRange(row, col) {
        return { setValue(v) { rows[row - 1][col - 1] = v; } };
      },
    };
  }
  const spreadsheet = {
    getSheetByName: (n) => sheets[n] || null,
    insertSheet: (n) => (sheets[n] = fakeSheet()),
  };

  const scriptProps = {
    getProperty: (k) => (props.has(k) ? props.get(k) : null),
    setProperty(k, v) {
      const s = String(v);
      if (Buffer.byteLength(s, 'utf8') > PROPERTY_LIMIT) throw new Error('Property ' + k + ' is too large (' + Buffer.byteLength(s, 'utf8') + ' bytes).');
      props.set(k, s);
      return scriptProps;
    },
    setProperties(obj) {
      Object.keys(obj).forEach((k) => scriptProps.setProperty(k, obj[k]));
      return scriptProps;
    },
    deleteProperty(k) {
      props.delete(k);
      return scriptProps;
    },
    getProperties: () => Object.fromEntries(props),
  };

  const silent = { log() {}, error() {}, warn() {}, info() {} };
  const ctx = {
    console: opts.quiet ? silent : console,
    PropertiesService: { getScriptProperties: () => scriptProps },
    CacheService: {
      getScriptCache: () => ({
        get(k) {
          const e = cache.get(k);
          if (!e || e.exp < clock.now()) return null;
          return e.v;
        },
        put(k, v, sec) {
          cache.set(k, { v: String(v), exp: clock.now() + (sec || 600) * 1000 });
        },
        remove(k) {
          cache.delete(k);
        },
      }),
    },
    LockService: { getScriptLock: () => ({ tryLock: () => !busy, releaseLock() {} }) },
    SpreadsheetApp: { getActiveSpreadsheet: () => (unbound ? null : spreadsheet) },
    Session: {
      getActiveUser: () => ({ getEmail: () => activeEmail }),
      getEffectiveUser: () => ({ getEmail: () => ownerEmail }),
    },
    Utilities: {
      getUuid: () => crypto.randomUUID(),
      DigestAlgorithm: { SHA_256: 'sha256' },
      Charset: { UTF_8: 'utf8' },
      computeDigest: (alg, text) => Array.from(crypto.createHash('sha256').update(String(text), 'utf8').digest()).map((b) => (b > 127 ? b - 256 : b)),
    },
    ContentService: {
      MimeType: { JSON: 'application/json' },
      createTextOutput: (text) => ({ text, setMimeType() { return this; } }),
    },
    ScriptApp: { getService: () => ({ getUrl: () => opts.serviceUrl || 'https://script.google.com/macros/s/TEST/exec' }) },
    HtmlService: {
      createTemplateFromFile: (name) => ({
        name,
        evaluate() {
          const out = { template: this, title: '', setTitle(t) { out.title = t; return out; }, addMetaTag() { return out; } };
          return out;
        },
      }),
      createHtmlOutputFromFile: (name) => ({ getContent: () => '<!-- ' + name + ' -->' }),
    },
    __now: () => clock.now(),
  };
  vm.createContext(ctx);
  vm.runInContext('Date.now = function () { return __now(); };', ctx);
  const source = FILES.map((f) => fs.readFileSync(path.join(DIR, f), 'utf8')).join('\n');
  const exported = vm.runInContext(
    source + '\n;({ api, doGet, doPost, include, setup, createAdminKey, removeAdminKey, speedBonus_, QUESTION_KEY, MAX_ATTEMPTS_PER_DEVICE, REDEEMER_CONTENT, HubDefaults, HubSession, ShowdownCore, RushCore, RoadCore })',
    ctx,
    { filename: 'apps-script' }
  );

  return Object.assign({}, exported, {
    /** Calls the API and returns a plain (Node-realm) object. */
    call: (body) => JSON.parse(JSON.stringify(exported.api(body))),
    props,
    cache,
    sheets,
    clock,
    setActiveUser: (email) => { activeEmail = email || ''; },
    setBusy: (v) => { busy = !!v; },
    setUnbound: (v) => { unbound = !!v; },
  });
}

module.exports = { createGas };
