const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const net = require('node:net');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const path = require('node:path');

let port;
let server;
let stderr = '';

function freePort() {
  return new Promise((resolve, reject) => {
    const listener = net.createServer();
    listener.once('error', reject);
    listener.listen(0, '127.0.0.1', () => {
      const selected = listener.address().port;
      listener.close(() => resolve(selected));
    });
  });
}

function request(urlPath, { method = 'GET', headers = {}, body = '' } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port, path: urlPath, method, headers, timeout: 3000 }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { text += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: text }));
    });
    req.on('timeout', () => req.destroy(Error('local test server timed out')));
    req.on('error', reject);
    req.end(body);
  });
}

before(async () => {
  port = await freePort();
  server = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, AGENT_OBSERVATORY_PORT: String(port) },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  server.stderr.on('data', (chunk) => { stderr += chunk; });
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (server.exitCode !== null) throw Error(`Server exited early: ${stderr}`);
    try { if ((await request('/')).status === 200) return; }
    catch { /* wait for startup */ }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw Error(`Server did not start: ${stderr}`);
});

after(async () => {
  if (server && server.exitCode === null) {
    server.kill('SIGTERM');
    await once(server, 'exit');
  }
});

test('dashboard uses local assets and does not grant cross-origin reads', async () => {
  const response = await request('/');
  assert.equal(response.status, 200);
  assert.match(response.body, /Agent Observatory/);
  assert.doesNotMatch(response.body, /fonts\.googleapis\.com|fonts\.gstatic\.com/);
  assert.equal(response.headers['access-control-allow-origin'], undefined);
  assert.match(response.headers['content-security-policy'], /connect-src 'self'/);
  assert.equal(response.headers['cache-control'], 'no-store');
});

test('serves only public dashboard files', async () => {
  assert.equal((await request('/app.js')).status, 200);
  assert.equal((await request('/.git/config')).status, 404);
  assert.equal((await request('/src/server.js')).status, 404);
  assert.equal((await request('/PRIVACY.md')).status, 404);
});

test('rejects DNS rebinding and cross-origin requests', async () => {
  assert.equal((await request('/', { headers: { Host: 'evil.example' } })).status, 403);
  const crossOrigin = await request('/api/health', { headers: { Origin: 'https://evil.example' } });
  assert.equal(crossOrigin.status, 403);
  assert.equal(crossOrigin.headers['access-control-allow-origin'], undefined);
  const preflight = await request('/api/action', { method: 'OPTIONS', headers: { Origin: 'https://evil.example' } });
  assert.equal(preflight.status, 403);
});

test('accepts local JSON actions and rejects other content types', async () => {
  const data = JSON.stringify({ action: 'bulk-trash', ids: [] });
  const local = await request('/api/action', { method: 'POST', headers: { 'content-type': 'application/json', Origin: `http://127.0.0.1:${port}` }, body: data });
  assert.equal(local.status, 200);
  assert.equal(JSON.parse(local.body).count, 0);
  const plain = await request('/api/action', { method: 'POST', headers: { 'content-type': 'text/plain' }, body: data });
  assert.equal(plain.status, 415);
  const oversized = await request('/api/action', { method: 'POST', headers: { 'content-type': 'application/json' }, body: ' '.repeat(65537) });
  assert.equal(oversized.status, 413);
});
