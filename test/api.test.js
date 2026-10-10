import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { addDays, nowInZone, weekdayKey } from '../public/js/slots.js';

const PORT = 3900 + Math.floor(Math.random() * 90);
const BASE = `http://localhost:${PORT}`;
const config = JSON.parse(await readFile(new URL('../public/config.json', import.meta.url), 'utf8'));
let server;
let dataDir;

// First open day at least two days out, so minimum-notice rules never interfere.
let day = addDays(nowInZone(config.timezone).date, 2);
while (!config.hours[weekdayKey(day)]) day = addDays(day, 1);
const opening = config.hours[weekdayKey(day)][0];

const call = async (path, { method = 'GET', body, token } = {}) => {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json().catch(() => null) };
};

const guest = { name: 'Test Client', phone: '+597 812-3456', services: ['gel-polish'], date: day, time: opening };

before(async () => {
  dataDir = await mkdtemp(join(tmpdir(), 'younique-'));
  server = spawn(process.execPath, ['server.js'], {
    cwd: new URL('..', import.meta.url),
    env: { ...process.env, PORT: String(PORT), DATA_DIR: dataDir, ADMIN_PASSWORD: 'secret-test' },
    stdio: 'pipe',
  });
  for (let i = 0; i < 50; i++) {
    try {
      if ((await fetch(`${BASE}/api/health`)).ok) return;
    } catch {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  throw new Error('server did not start');
});

after(async () => {
  server.kill();
  await rm(dataDir, { recursive: true, force: true });
});

test('serves the site and config', async () => {
  const res = await fetch(`${BASE}/`);
  assert.equal(res.status, 200);
  assert.match(await res.text(), /You-nique/);
  assert.equal((await fetch(`${BASE}/admin`)).status, 200);
  assert.equal((await fetch(`${BASE}/..%2fserver.js`)).status, 403);
});

test('books a slot once and rejects a double booking', async () => {
  const avail = await call(`/api/availability?from=${day}&days=1&minutes=45`);
  assert.equal(avail.status, 200);
  assert.ok(avail.body.slots[day].includes(opening));

  const first = await call('/api/bookings', { method: 'POST', body: guest });
  assert.equal(first.status, 201);
  assert.match(first.body.booking.ref, /^YL-[A-Z0-9]{5}$/);
  assert.equal(first.body.booking.status, 'pending');

  const second = await call('/api/bookings', { method: 'POST', body: { ...guest, name: 'Someone Else' } });
  assert.equal(second.status, 409);

  const after = await call(`/api/availability?from=${day}&days=1&minutes=45`);
  assert.ok(!after.body.slots[day].includes(opening));

  const saved = JSON.parse(await readFile(join(dataDir, 'db.json'), 'utf8'));
  assert.equal(saved.bookings.length, 1);
});

test('validates booking input', async () => {
  assert.equal((await call('/api/bookings', { method: 'POST', body: { ...guest, services: ['nope'] } })).status, 400);
  assert.equal((await call('/api/bookings', { method: 'POST', body: { ...guest, phone: '12' } })).status, 400);
  assert.equal((await call('/api/bookings', { method: 'POST', body: { ...guest, date: '2026-02-30' } })).status, 400);
});

test('admin can log in, confirm, cancel and block time', async () => {
  assert.equal((await call('/api/admin/bookings')).status, 401);
  assert.equal((await call('/api/admin/login', { method: 'POST', body: { password: 'wrong' } })).status, 401);

  const { body } = await call('/api/admin/login', { method: 'POST', body: { password: 'secret-test' } });
  const token = body.token;
  const list = await call('/api/admin/bookings', { token });
  assert.equal(list.status, 200);
  const booking = list.body.bookings[0];

  const confirmed = await call(`/api/admin/bookings/${booking.id}`, { method: 'PATCH', token, body: { status: 'confirmed' } });
  assert.equal(confirmed.body.booking.status, 'confirmed');

  await call(`/api/admin/bookings/${booking.id}`, { method: 'PATCH', token, body: { status: 'cancelled' } });
  const freed = await call(`/api/availability?from=${day}&days=1&minutes=45`);
  assert.ok(freed.body.slots[day].includes(opening), 'cancelling frees the slot');

  const block = await call('/api/admin/blocks', { method: 'POST', token, body: { date: day } });
  assert.equal(block.status, 201);
  const closed = await call(`/api/availability?from=${day}&days=1&minutes=45`);
  assert.deepEqual(closed.body.slots[day], []);

  assert.equal((await call(`/api/admin/blocks/${block.body.block.id}`, { method: 'DELETE', token })).status, 200);
  const manual = await call('/api/admin/bookings', { method: 'POST', token, body: { ...guest, name: 'Walk In' } });
  assert.equal(manual.status, 201);
  assert.equal(manual.body.booking.status, 'confirmed');
});
