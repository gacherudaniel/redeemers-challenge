#!/usr/bin/env node
/*
 * Local development server: serves the site AND runs the real Apps Script back end
 * (apps-script/*.gs) in Node with stand-in Google services, so you can try shared mode —
 * admin controls, shared leaderboards, Team Showdown buzzers on several phones — without
 * a Google account. Data lives in memory and is lost when the server stops.
 *
 *   npm run dev            then open http://localhost:8790 (and /admin.html)
 *   PORT=9000 LATENCY=800 npm run dev   to simulate a slower Apps Script
 *
 * Phones on the same Wi-Fi can join at http://<this computer's IP>:8790.
 */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { createGas } = require('./fake-gas');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.PORT) || 8790;
const LATENCY = Number(process.env.LATENCY) || 250;
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.md': 'text/plain; charset=utf-8' };

const gas = createGas({ quiet: true, ownerEmail: 'owner@example.com' });
gas.setup();
const adminKey = gas.createAdminKey();

function send(res, status, type, body) {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' });
  res.end(body);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/exec' && req.method === 'POST') {
    let raw = '';
    req.on('data', (c) => {
      raw += c;
      if (raw.length > 200000) req.destroy();
    });
    req.on('end', () => {
      let body = {};
      try { body = JSON.parse(raw || '{}'); } catch (e) { /* handled by the API */ }
      setTimeout(() => {
        let out;
        try {
          out = gas.call(body);
        } catch (e) {
          console.error(e);
          out = { ok: false, error: 'SERVER_ERROR', message: e.message };
        }
        send(res, 200, 'application/json', JSON.stringify(out));
      }, LATENCY);
    });
    return;
  }
  if (url.pathname === '/config.js') {
    // Point the site at this server's /exec endpoint.
    const js = fs.readFileSync(path.join(ROOT, 'config.js'), 'utf8').replace(/apiUrl:\s*'[^']*'/, "apiUrl: '/exec'");
    return send(res, 200, TYPES['.js'], js);
  }
  let rel = decodeURIComponent(url.pathname);
  if (rel.endsWith('/')) rel += 'index.html';
  const file = path.normalize(path.join(ROOT, rel));
  if (!file.startsWith(ROOT + path.sep) || /[\\/](node_modules|\.git)[\\/]/.test(file)) return send(res, 403, 'text/plain', 'Forbidden');
  fs.readFile(file, (err, data) => {
    if (err) return send(res, 404, 'text/plain', 'Not found');
    send(res, 200, TYPES[path.extname(file)] || 'application/octet-stream', data);
  });
});

server.listen(PORT, () => {
  const lan = Object.values(os.networkInterfaces()).flat().find((i) => i && i.family === 'IPv4' && !i.internal);
  console.log('Ruth 4 Game Night: local shared-mode server');
  console.log('  Participants: http://localhost:' + PORT + (lan ? '   (phones: http://' + lan.address + ':' + PORT + ')' : ''));
  console.log('  Admin:        http://localhost:' + PORT + '/admin.html');
  console.log('  Admin key:    ' + adminKey);
  console.log('  Simulated Apps Script latency: ' + LATENCY + ' ms. Data is in memory only.');
});
