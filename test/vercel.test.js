// Simulates the Vercel setup: two separate "serverless instances" (api/index.js) sharing one
// Upstash-compatible Redis, reached through the /api/index?__path=… rewrite from vercel.json.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { addDays, nowInZone, weekdayKey } from '../public/js/slots.js';

const config = JSON.parse(await readFile(new URL('../public/config.json', import.meta.url), 'utf8'));
const base = 4200 + Math.floor(Math.random() * 80);
const REDIS_PORT = base;
const PORTS = [base + 1, base + 2];
const children = [];
let redis;

// Minimal Upstash REST API: POST / with a JSON command array.
const data = new Map();
function startRedis() {
  redis = createServer(async (req, res) => {
    if (req.headers.authorization !== 'Bearer test-token') return res.writeHead(401).end('{"error":"unauthorized"}');
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const [cmd, key, value, ...opts] = JSON.parse(raw);
    let result = null;
    if (cmd === 'GET') result = data.get(key) ?? null;
    if (cmd === 'DEL') result = data.delete(key) ? 1 : 0;
    if (cmd === 'SET') {
      if (opts.includes('NX') && data.has(key)) result = null;
      else {
        data.set(key, value);
        result = 'OK';
      }
    }
    res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ result }));
  });
  return new Promise((r) => redis.listen(REDIS_PORT, r));
}

function startInstance(port, env) {
  const child = spawn(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `import h from './api/index.js'; import { createServer } from 'node:http'; createServer(h).listen(${port});`,
    ],
    { cwd: new URL('..', import.meta.url), env: { ...process.env, VERCEL: '1', ...env }, stdio: 'pipe' },
  );
  children.push(child);
}

const call = async (port, path, { method = 'GET', body, token } = {}) => {
  const [p, q = ''] = path.split('?');
  const url = `http://127.0.0.1:${port}/api/index?__path=${p.replace(/^\/api\//, '')}${q ? `&${q}` : ''}`;
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json().catch(() => null) };
};

async function waitFor(port) {
  for (let i = 0; i < 60; i++) {
    try {
      await fetch(`http://127.0.0.1:${port}/api/index?__path=health`);
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  throw new Error(`instance on ${port} did not start`);
}

let day = addDays(nowInZone(config.timezone).date, 2);
while (!config.hours[weekdayKey(day)]) day = addDays(day, 1);
const time = config.hours[weekdayKey(day)][0];
const guest = { services: ['gel-polish'], date: day, time, name: 'Vercel Client', phone: '+597 811-2233' };

before(async () => {
  await startRedis();
  const env = { KV_REST_API_URL: `http://127.0.0.1:${REDIS_PORT}`, KV_REST_API_TOKEN: 'test-token', ADMIN_PASSWORD: 'pw' };
  PORTS.forEach((port) => startInstance(port, env));
  startInstance(base + 3, { ADMIN_PASSWORD: 'pw' }); // no storage configured
  await Promise.all([...PORTS, base + 3].map(waitFor));
});

after(() => {
  children.forEach((c) => c.kill());
  redis.close();
});

test('health is OK with Redis and 503 without storage (site falls back to WhatsApp)', async () => {
  assert.equal((await call(PORTS[0], '/api/health')).status, 200);
  assert.equal((await call(base + 3, '/api/health')).status, 503);
  assert.equal((await call(base + 3, '/api/bookings', { method: 'POST', body: guest })).status, 503);
});

test('simultaneous bookings for one slot across two instances: exactly one wins', async () => {
  const attempts = await Promise.all(
    Array.from({ length: 6 }, (_, i) =>
      call(PORTS[i % 2], '/api/bookings', { method: 'POST', body: { ...guest, name: `Client ${i}` } }),
    ),
  );
  const statuses = attempts.map((a) => a.status).sort();
  assert.deepEqual(statuses, [201, 409, 409, 409, 409, 409]);
  const stored = JSON.parse(data.get('younique:db'));
  assert.equal(stored.bookings.length, 1);
  assert.ok(!data.has('younique:db:lock'), 'lock released');
});

test('an admin token from one instance works on the other', async () => {
  const { body } = await call(PORTS[0], '/api/admin/login', { method: 'POST', body: { password: 'pw' } });
  const list = await call(PORTS[1], '/api/admin/bookings', { token: body.token });
  assert.equal(list.status, 200);
  assert.equal(list.body.bookings.length, 1);
  assert.equal((await call(PORTS[1], '/api/admin/bookings', { token: `${body.token}x` })).status, 401);
  assert.equal((await call(base + 3, '/api/admin/login', { method: 'POST', body: { password: 'pw' } })).status, 503);
});
