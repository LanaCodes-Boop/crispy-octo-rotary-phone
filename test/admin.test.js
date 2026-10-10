import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { addDays, nowInZone } from '../public/js/slots.js';

const PORT = 4000 + Math.floor(Math.random() * 90);
const BASE = `http://localhost:${PORT}`;
const config = JSON.parse(await readFile(new URL('../public/config.json', import.meta.url), 'utf8'));
const tomorrow = addDays(nowInZone(config.timezone).date, 1);
let server;
let dataDir;
let token;

const call = async (path, { method = 'GET', body } = {}) => {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json().catch(() => null) };
};

const addBooking = async (extra = {}) => {
  const body = { services: ['gel-polish'], date: tomorrow, time: '10:00', name: 'Reminder Client', phone: '+597 812-3456' };
  const res = await call('/api/admin/bookings', { method: 'POST', body: { ...body, force: true, ...extra } });
  assert.equal(res.status, 201);
  return res.body.booking;
};

const patch = (id, body) => call(`/api/admin/bookings/${id}`, { method: 'PATCH', body });

before(async () => {
  dataDir = await mkdtemp(join(tmpdir(), 'younique-admin-'));
  server = spawn(process.execPath, ['server.js'], {
    cwd: new URL('..', import.meta.url),
    env: { ...process.env, PORT: String(PORT), DATA_DIR: dataDir, ADMIN_PASSWORD: 'secret-test' },
    stdio: 'pipe',
  });
  for (let i = 0; i < 50; i++) {
    try {
      if ((await fetch(`${BASE}/api/health`)).ok) break;
    } catch {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  const login = await call('/api/admin/login', { method: 'POST', body: { password: 'secret-test' } });
  assert.equal(login.status, 200, 'server did not start');
  token = login.body.token;
});

after(async () => {
  server.kill();
  await rm(dataDir, { recursive: true, force: true });
});

test('reminded: true stamps remindedAt and false clears it', async () => {
  const booking = await addBooking();
  assert.equal(booking.remindedAt, undefined);

  const t0 = Date.now();
  const sent = await patch(booking.id, { reminded: true });
  assert.equal(sent.status, 200);
  const stamp = Date.parse(sent.body.booking.remindedAt);
  assert.ok(stamp >= t0 - 1000 && stamp <= Date.now() + 1000, 'remindedAt is a current ISO timestamp');
  assert.equal(sent.body.booking.remindedAt, new Date(stamp).toISOString());
  assert.equal(sent.body.booking.status, 'confirmed', 'status is untouched');

  const list = await call('/api/admin/bookings');
  assert.equal(list.body.bookings.find((b) => b.id === booking.id).remindedAt, sent.body.booking.remindedAt);
  const saved = JSON.parse(await readFile(join(dataDir, 'db.json'), 'utf8'));
  assert.equal(saved.bookings.find((b) => b.id === booking.id).remindedAt, sent.body.booking.remindedAt);

  const cleared = await patch(booking.id, { reminded: false });
  assert.equal(cleared.status, 200);
  assert.equal(cleared.body.booking.remindedAt, undefined);
  const again = await call('/api/admin/bookings');
  assert.equal(again.body.bookings.find((b) => b.id === booking.id).remindedAt, undefined);
});

test('reminded flag is validated and needs a login', async () => {
  const booking = await addBooking({ time: '12:00' });
  assert.equal((await patch(booking.id, { reminded: 'yes' })).status, 400);
  assert.equal((await patch('no-such-booking', { reminded: true })).status, 404);

  const saved = token;
  token = '';
  assert.equal((await patch(booking.id, { reminded: true })).status, 401);
  token = saved;
});

test('moving a reminded booking clears the old reminder', async () => {
  const booking = await addBooking({ time: '14:00' });
  await patch(booking.id, { reminded: true });

  const same = await patch(booking.id, { date: booking.date, time: booking.time });
  assert.ok(same.body.booking.remindedAt, 'saving the same slot keeps the reminder');

  const moved = await patch(booking.id, { time: '15:00', force: true });
  assert.equal(moved.status, 200);
  assert.equal(moved.body.booking.remindedAt, undefined);
});

test('serves the installable dashboard files', async () => {
  const manifest = await fetch(`${BASE}/admin.webmanifest`);
  assert.equal(manifest.status, 200);
  assert.match(manifest.headers.get('content-type'), /application\/manifest\+json/);
  const json = await manifest.json();
  assert.equal(json.start_url, '/admin');
  assert.equal(json.scope, '/admin');
  assert.ok(json.icons.some((i) => i.purpose === 'maskable'));
  for (const icon of json.icons) {
    const res = await fetch(BASE + icon.src);
    assert.equal(res.status, 200, icon.src);
    assert.equal(res.headers.get('content-type'), 'image/png');
  }

  const sw = await fetch(`${BASE}/sw.js`);
  assert.equal(sw.status, 200);
  assert.match(sw.headers.get('content-type'), /javascript/);
  assert.match(await (await fetch(`${BASE}/admin`)).text(), /rel="manifest" href="\/admin\.webmanifest"/);
});
