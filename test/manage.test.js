import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { addDays, minutesUntil, nowInZone, toHHMM, weekdayKey } from '../public/js/slots.js';

const PORT = 4100 + Math.floor(Math.random() * 90);
const BASE = `http://localhost:${PORT}`;
const config = JSON.parse(await readFile(new URL('../public/config.json', import.meta.url), 'utf8'));
let server;
let dataDir;
let booking;

// First open day at least two days out, so it is always outside the cancellation window.
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

const lookup = (ref, phone) => call('/api/bookings/lookup', { method: 'POST', body: { ref, phone } });
const cancel = (ref, phone) => call('/api/bookings/cancel', { method: 'POST', body: { ref, phone } });
const slotsOn = async (date) => (await call(`/api/availability?from=${date}&days=1&minutes=45`)).body.slots[date];

const guest = { name: 'Test Client', phone: '+597 812-3456', services: ['gel-polish'], date: day, time: opening };

before(async () => {
  dataDir = await mkdtemp(join(tmpdir(), 'younique-manage-'));
  server = spawn(process.execPath, ['server.js'], {
    cwd: new URL('..', import.meta.url),
    env: { ...process.env, PORT: String(PORT), DATA_DIR: dataDir, ADMIN_PASSWORD: 'secret-test', NOTIFY_WEBHOOK_URL: '' },
    stdio: 'pipe',
  });
  for (let i = 0; i < 50; i++) {
    try {
      if ((await fetch(`${BASE}/api/health`)).ok) break;
    } catch {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  const created = await call('/api/bookings', { method: 'POST', body: guest });
  assert.equal(created.status, 201, 'test booking created');
  booking = created.body.booking;
});

after(async () => {
  server.kill();
  await rm(dataDir, { recursive: true, force: true });
});

test('minutesUntil counts across days in the salon timezone', () => {
  assert.equal(minutesUntil('2026-10-13', '09:00', { date: '2026-10-12', minutes: 8 * 60 }), 25 * 60);
  assert.equal(minutesUntil('2026-10-12', '07:30', { date: '2026-10-12', minutes: 8 * 60 }), -30);
});

test('finds a booking by reference and phone', async () => {
  const found = await lookup(`  ${booking.ref.toLowerCase()} `, '812 3456');
  assert.equal(found.status, 200);
  assert.equal(found.body.booking.ref, booking.ref);
  assert.equal(found.body.booking.date, day);
  assert.equal(found.body.booking.status, 'pending');
  assert.ok(!('phone' in found.body.booking) && !('email' in found.body.booking), 'no contact details leak');
});

test('refuses a lookup when the details do not match', async () => {
  const wrongPhone = await lookup(booking.ref, '+597 812-0000');
  assert.equal(wrongPhone.status, 404);
  assert.match(wrongPhone.body.error, /couldn't find/);
  assert.equal((await lookup('YL-ZZZZZ', guest.phone)).status, 404);
  assert.equal((await lookup(booking.ref)).status, 404);
  assert.equal((await lookup(booking.ref, '3456')).status, 404, 'needs at least 7 digits');
});

test('a client can cancel and the slot opens up again', async () => {
  assert.ok(!(await slotsOn(day)).includes(opening), 'slot is taken before cancelling');
  assert.equal((await cancel(booking.ref, '000 0000')).status, 404);

  const cancelled = await cancel(booking.ref, guest.phone);
  assert.equal(cancelled.status, 200);
  assert.equal(cancelled.body.booking.status, 'cancelled');

  const { bookings } = JSON.parse(await readFile(join(dataDir, 'db.json'), 'utf8'));
  const saved = bookings.find((b) => b.ref === booking.ref);
  assert.equal(saved.status, 'cancelled');
  assert.equal(saved.cancelledBy, 'client');
  assert.ok(saved.updatedAt);

  assert.ok((await slotsOn(day)).includes(opening), 'cancelling frees the slot');
  assert.equal((await cancel(booking.ref, guest.phone)).status, 409, 'cannot cancel twice');
});

test('refuses to cancel inside the notice window', async () => {
  const { body } = await call('/api/admin/login', { method: 'POST', body: { password: 'secret-test' } });
  const now = nowInZone(config.timezone);
  const soon = now.minutes + 120; // two hours from now, well inside the window
  const date = soon >= 1440 ? addDays(now.date, 1) : now.date;
  const late = await call('/api/admin/bookings', {
    method: 'POST',
    token: body.token,
    body: { ...guest, name: 'Last Minute', phone: '+597 765-4321', date, time: toHHMM(soon % 1440), force: true },
  });
  assert.equal(late.status, 201);

  const refused = await cancel(late.body.booking.ref, '7654321');
  assert.equal(refused.status, 409);
  assert.match(refused.body.error, new RegExp(`${config.booking.cancelNoticeHours} hours`));
  assert.match(refused.body.error, /WhatsApp/);
  assert.equal((await lookup(late.body.booking.ref, '7654321')).body.booking.status, 'confirmed');
});

test('lookups are throttled in their own bucket', async () => {
  let status = 0;
  for (let i = 0; i < 25 && status !== 429; i++) status = (await lookup('YL-NOPE0', '1234567')).status;
  assert.equal(status, 429);

  const other = addDays(day, 7);
  const booked = await call('/api/bookings', {
    method: 'POST',
    body: { ...guest, date: other, time: config.hours[weekdayKey(other)][0] },
  });
  assert.equal(booked.status, 201, 'public booking is unaffected');
});
