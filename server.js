// You-nique by Lis — website + booking server.
// Zero dependencies: run with `node server.js` (Node 18+). On Vercel, api/index.js reuses `handle`.

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { randomBytes, randomUUID, timingSafeEqual, createHash, createHmac } from 'node:crypto';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DESIGN_PATTERN } from './public/js/designer-art.js';
import { createStore } from './lib/store.js';
import {
  addDays,
  getSlots,
  isValidDate,
  isValidTime,
  minutesUntil,
  nowInZone,
  servicesFor,
  totalMinutes,
  totalPrice,
  toMin,
} from './public/js/slots.js';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const PUBLIC_DIR = join(ROOT, 'public');
const DATA_DIR = resolve(process.env.DATA_DIR || join(ROOT, 'data'));
const PORT = Number(process.env.PORT) || 3000;
const NOTIFY_WEBHOOK_URL = process.env.NOTIFY_WEBHOOK_URL || '';

let ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
// Serverless instances can't share a generated password, so on Vercel the dashboard stays off until it's set.
if (!ADMIN_PASSWORD && !process.env.VERCEL) {
  ADMIN_PASSWORD = randomBytes(6).toString('base64url');
  console.warn(`⚠  ADMIN_PASSWORD not set — using a temporary one for this run: ${ADMIN_PASSWORD}`);
}

const config = JSON.parse(await readFile(join(PUBLIC_DIR, 'config.json'), 'utf8'));
const serviceIds = new Set(config.services.map((s) => s.id));
const STATUSES = new Set(['pending', 'confirmed', 'completed', 'cancelled']);

// ---------------------------------------------------------------------------
// Storage: a JSON file locally, Upstash Redis on Vercel (see lib/store.js). `db` is (re)loaded at
// the start of every API request; writes happen while holding the store's lock.

const store = createStore({ dataDir: DATA_DIR });
let db = { bookings: [], blocks: [] };
const persist = () => store.save(db);

// ---------------------------------------------------------------------------
// Helpers

const json = (res, status, body) => {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
};

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function readBody(req, limit = 20_000) {
  // Vercel's Node runtime may already have parsed the body for us.
  let parsed;
  try {
    parsed = req.body;
  } catch {
    throw new HttpError(400, 'Invalid JSON');
  }
  if (parsed !== undefined) {
    if (parsed === null || parsed === '') return {};
    if (typeof parsed === 'object' && !Buffer.isBuffer(parsed)) return parsed;
    try {
      return JSON.parse(parsed.toString());
    } catch {
      throw new HttpError(400, 'Invalid JSON');
    }
  }
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new HttpError(413, 'Request too large');
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  } catch {
    throw new HttpError(400, 'Invalid JSON');
  }
}

const clean = (v, max) => (typeof v === 'string' ? v.trim().replace(/\s+/g, ' ').slice(0, max) : '');
const cleanMultiline = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

function makeRef() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let ref;
  do {
    ref = 'YL-' + Array.from(randomBytes(5), (b) => alphabet[b % alphabet.length]).join('');
  } while (db.bookings.some((b) => b.ref === ref));
  return ref;
}

function publicBooking(b) {
  const { ref, date, time, minutes, services, total, status, name } = b;
  return { ref, date, time, minutes, services, total, status, name };
}

/** Validates booking input shared by the public form and the admin "add booking" form. */
function parseBookingInput(body) {
  const ids = Array.isArray(body.services) ? [...new Set(body.services)] : [];
  if (!ids.length || ids.length > 6 || !ids.every((id) => serviceIds.has(id))) {
    throw new HttpError(400, 'Please choose at least one service.');
  }
  if (!isValidDate(body.date) || !isValidTime(body.time)) throw new HttpError(400, 'Please choose a date and time.');

  const name = clean(body.name, 80);
  if (name.length < 2) throw new HttpError(400, 'Please enter your name.');
  const phone = clean(body.phone, 30);
  if (phone.replace(/\D/g, '').length < 7) throw new HttpError(400, 'Please enter a valid phone / WhatsApp number.');
  const email = clean(body.email, 120);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, 'Please enter a valid email address.');

  const design = typeof body.design === 'string' && DESIGN_PATTERN.test(body.design) ? body.design : '';

  const services = servicesFor(config, ids);
  return {
    date: body.date,
    time: body.time,
    services: ids,
    minutes: totalMinutes(services),
    total: totalPrice(services),
    name,
    phone,
    email,
    notes: cleanMultiline(body.notes, 600),
    design,
    lang: body.lang === 'nl' ? 'nl' : 'en',
  };
}

function slotsFor(date, minutes, ignoreId) {
  const bookings = ignoreId ? db.bookings.filter((b) => b.id !== ignoreId) : db.bookings;
  return getSlots({ config, date, minutes, bookings, blocks: db.blocks, now: nowInZone(config.timezone) });
}

function overlapsExisting(date, time, minutes, ignoreId) {
  const start = toMin(time);
  const end = start + minutes;
  return db.bookings.some(
    (b) =>
      b.id !== ignoreId &&
      b.date === date &&
      b.status !== 'cancelled' &&
      start < toMin(b.time) + b.minutes &&
      toMin(b.time) < end,
  );
}

async function notify(booking, event = 'new') {
  if (!NOTIFY_WEBHOOK_URL) return;
  const names = servicesFor(config, booking.services).map((s) => s.name.en).join(', ');
  const what = event === 'cancelled' ? '🚫 Booking cancelled by client' : '💅 New booking';
  const text = `${what} ${booking.ref}: ${booking.name} (${booking.phone}) — ${names} on ${booking.date} at ${booking.time}`;
  try {
    await fetch(NOTIFY_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, content: text, event, booking }),
      signal: AbortSignal.timeout(5000),
    });
  } catch (err) {
    console.warn('Booking notification failed:', err.message);
  }
}

// Light per-IP throttle for the public endpoints; each bucket is counted separately.
const recentByIp = new Map();
function throttle(ip, max = 8, windowMs = 60 * 60 * 1000, bucket = 'booking') {
  const now = Date.now();
  const key = `${bucket}|${ip}`;
  const hits = (recentByIp.get(key) || []).filter((t) => now - t < windowMs);
  if (hits.length >= max) throw new HttpError(429, `Too many ${bucket} attempts. Please message us on WhatsApp.`);
  hits.push(now);
  recentByIp.set(key, hits);
}

/** Finds a booking for the "manage my booking" page: the reference plus the last 7 digits of the phone must match. */
const phoneTail = (phone) => String(phone || '').replace(/\D/g, '').slice(-7);
function findOwnBooking(body) {
  const ref = clean(body.ref, 20).toUpperCase();
  const tail = phoneTail(clean(body.phone, 30));
  const booking = tail.length === 7 && db.bookings.find((b) => b.ref === ref && phoneTail(b.phone) === tail);
  if (!booking) throw new HttpError(404, "We couldn't find a booking with those details.");
  return booking;
}

// Admin sessions are signed tokens ("<expiry>.<signature>"), so they work across serverless instances.
// Changing ADMIN_PASSWORD (or SESSION_SECRET) logs everyone out.
const SESSION_MS = 12 * 60 * 60 * 1000;
const digest = (s) => createHash('sha256').update(String(s)).digest();
const sign = (expiry) =>
  createHmac('sha256', digest(`younique-admin:${ADMIN_PASSWORD}:${process.env.SESSION_SECRET || ''}`))
    .update(String(expiry))
    .digest('base64url');

function requireAdmin(req) {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const [expiry, signature = ''] = token.split('.');
  const expected = sign(expiry);
  const valid =
    ADMIN_PASSWORD &&
    Number(expiry) > Date.now() &&
    signature.length === expected.length &&
    timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  if (!valid) throw new HttpError(401, 'Please log in again.');
}

// ---------------------------------------------------------------------------
// API routes

async function api(req, res, url) {
  const { pathname, searchParams } = url;
  const method = req.method;

  if (pathname === '/api/health') return json(res, 200, { ok: true });

  if (pathname === '/api/availability' && method === 'GET') {
    const from = searchParams.get('from');
    const days = Math.min(Math.max(Number(searchParams.get('days')) || 1, 1), 62);
    const minutes = Number(searchParams.get('minutes'));
    if (!isValidDate(from) || !Number.isInteger(minutes) || minutes <= 0 || minutes > 600) {
      throw new HttpError(400, 'Invalid availability request');
    }
    const slots = {};
    for (let i = 0; i < days; i++) {
      const date = addDays(from, i);
      slots[date] = slotsFor(date, minutes);
    }
    return json(res, 200, { slots });
  }

  if (pathname === '/api/bookings' && method === 'POST') {
    const body = await readBody(req);
    if (body.website) return json(res, 201, { booking: { ref: 'YL-THANKS', status: 'pending' } }); // honeypot
    throttle(req.socket.remoteAddress || 'unknown');
    const input = parseBookingInput(body);

    // Re-check right before saving so two people can't grab the same slot.
    if (!slotsFor(input.date, input.minutes).includes(input.time)) {
      throw new HttpError(409, 'Sorry, that time was just taken. Please pick another slot.');
    }
    const booking = {
      id: randomUUID(),
      ref: makeRef(),
      ...input,
      status: config.booking.autoConfirm ? 'confirmed' : 'pending',
      source: 'website',
      createdAt: new Date().toISOString(),
    };
    db.bookings.push(booking);
    await persist();
    await notify(booking); // awaited: serverless functions may freeze once the response is sent
    return json(res, 201, { booking: publicBooking(booking) });
  }

  // --- Client self-service ("Manage my booking") --------------------------
  if (pathname === '/api/bookings/lookup' && method === 'POST') {
    throttle(req.socket.remoteAddress || 'unknown', 20, 60 * 60 * 1000, 'lookup');
    const booking = findOwnBooking(await readBody(req));
    return json(res, 200, { booking: publicBooking(booking) });
  }

  if (pathname === '/api/bookings/cancel' && method === 'POST') {
    throttle(req.socket.remoteAddress || 'unknown', 20, 60 * 60 * 1000, 'lookup');
    const booking = findOwnBooking(await readBody(req));
    if (booking.status === 'cancelled') throw new HttpError(409, 'This appointment is already cancelled.');
    if (booking.status !== 'pending' && booking.status !== 'confirmed') {
      throw new HttpError(409, 'This appointment can no longer be cancelled online.');
    }
    const noticeHours = config.booking.cancelNoticeHours ?? 24;
    if (minutesUntil(booking.date, booking.time, nowInZone(config.timezone)) < noticeHours * 60) {
      throw new HttpError(
        409,
        `Online cancellation closes ${noticeHours} hours before your appointment. Please message Lis on WhatsApp instead.`,
      );
    }
    Object.assign(booking, { status: 'cancelled', cancelledBy: 'client', updatedAt: new Date().toISOString() });
    await persist();
    await notify(booking, 'cancelled');
    return json(res, 200, { booking: publicBooking(booking) });
  }

  // --- Admin -------------------------------------------------------------
  if (pathname === '/api/admin/login' && method === 'POST') {
    const { password } = await readBody(req);
    if (!ADMIN_PASSWORD) throw new HttpError(503, 'Set the ADMIN_PASSWORD environment variable to use the dashboard.');
    if (!timingSafeEqual(digest(password), digest(ADMIN_PASSWORD))) {
      await new Promise((r) => setTimeout(r, 600));
      throw new HttpError(401, 'Wrong password.');
    }
    const expiry = Date.now() + SESSION_MS;
    return json(res, 200, { token: `${expiry}.${sign(expiry)}` });
  }

  if (!pathname.startsWith('/api/admin/')) throw new HttpError(404, 'Not found');
  requireAdmin(req);

  if (pathname === '/api/admin/logout' && method === 'POST') {
    return json(res, 200, { ok: true }); // tokens are stateless; the dashboard simply forgets it
  }

  if (pathname === '/api/admin/bookings' && method === 'GET') {
    const bookings = [...db.bookings].sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
    return json(res, 200, { bookings, blocks: db.blocks, today: nowInZone(config.timezone).date });
  }

  if (pathname === '/api/admin/bookings' && method === 'POST') {
    const body = await readBody(req);
    const input = parseBookingInput(body);
    if (!body.force && overlapsExisting(input.date, input.time, input.minutes)) {
      throw new HttpError(409, 'This overlaps another appointment. Tick "allow overlap" to save anyway.');
    }
    const booking = {
      id: randomUUID(),
      ref: makeRef(),
      ...input,
      status: 'confirmed',
      source: 'admin',
      createdAt: new Date().toISOString(),
    };
    db.bookings.push(booking);
    await persist();
    return json(res, 201, { booking });
  }

  const bookingMatch = pathname.match(/^\/api\/admin\/bookings\/([\w-]+)$/);
  if (bookingMatch && method === 'PATCH') {
    const booking = db.bookings.find((b) => b.id === bookingMatch[1]);
    if (!booking) throw new HttpError(404, 'Booking not found');
    const body = await readBody(req);
    if (body.status !== undefined) {
      if (!STATUSES.has(body.status)) throw new HttpError(400, 'Unknown status');
      booking.status = body.status;
    }
    if (body.date !== undefined || body.time !== undefined) {
      const date = body.date ?? booking.date;
      const time = body.time ?? booking.time;
      if (!isValidDate(date) || !isValidTime(time)) throw new HttpError(400, 'Invalid date or time');
      if (!body.force && overlapsExisting(date, time, booking.minutes, booking.id)) {
        throw new HttpError(409, 'That time overlaps another appointment.');
      }
      if (date !== booking.date || time !== booking.time) delete booking.remindedAt; // old reminder is stale
      Object.assign(booking, { date, time });
    }
    if (body.reminded !== undefined) {
      if (typeof body.reminded !== 'boolean') throw new HttpError(400, 'Invalid reminder flag');
      if (body.reminded) booking.remindedAt = new Date().toISOString();
      else delete booking.remindedAt;
    }
    if (body.adminNote !== undefined) booking.adminNote = cleanMultiline(body.adminNote, 600);
    booking.updatedAt = new Date().toISOString();
    await persist();
    return json(res, 200, { booking });
  }

  if (pathname === '/api/admin/blocks' && method === 'POST') {
    const body = await readBody(req);
    if (!isValidDate(body.date)) throw new HttpError(400, 'Choose a date');
    const block = { id: randomUUID(), date: body.date, note: clean(body.note, 120) };
    if (body.start || body.end) {
      if (!isValidTime(body.start) || !isValidTime(body.end) || body.start >= body.end) {
        throw new HttpError(400, 'Choose a valid from/until time, or leave both empty for the whole day.');
      }
      Object.assign(block, { start: body.start, end: body.end });
    }
    db.blocks.push(block);
    db.blocks.sort((a, b) => (a.date + (a.start || '')).localeCompare(b.date + (b.start || '')));
    await persist();
    return json(res, 201, { block });
  }

  const blockMatch = pathname.match(/^\/api\/admin\/blocks\/([\w-]+)$/);
  if (blockMatch && method === 'DELETE') {
    const before = db.blocks.length;
    db.blocks = db.blocks.filter((b) => b.id !== blockMatch[1]);
    if (db.blocks.length === before) throw new HttpError(404, 'Not found');
    await persist();
    return json(res, 200, { ok: true });
  }

  throw new HttpError(404, 'Not found');
}

// ---------------------------------------------------------------------------
// Static files

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
};

async function serveStatic(req, res, url) {
  let pathname;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    throw new HttpError(400, 'Bad request');
  }
  if (pathname === '/') pathname = '/index.html';
  if (pathname === '/admin' || pathname === '/admin/') pathname = '/admin.html';

  const file = normalize(join(PUBLIC_DIR, pathname));
  if (!file.startsWith(PUBLIC_DIR + sep)) throw new HttpError(403, 'Forbidden');

  let info;
  try {
    info = await stat(file);
  } catch {
    info = null;
  }
  if (!info?.isFile()) {
    res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end('<h1>Page not found</h1><p><a href="/">Back to You-nique by Lis</a></p>');
  }

  const ext = extname(file).toLowerCase();
  const fresh = ['.html', '.json', '.js', '.css'].includes(ext);
  res.writeHead(200, {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Cache-Control': fresh ? 'no-cache' : 'public, max-age=604800',
  });
  if (req.method === 'HEAD') return res.end();
  res.end(await readFile(file));
}

// ---------------------------------------------------------------------------

async function handleApi(req, res, url) {
  if (url.pathname === '/api/health') {
    // Without storage the site switches to "request via WhatsApp" mode instead of losing bookings.
    return store ? json(res, 200, { ok: true }) : json(res, 503, { ok: false, error: 'No storage configured' });
  }
  if (!store) throw new HttpError(503, 'Online booking is not set up yet — please message us on WhatsApp.');
  const writes = req.method !== 'GET' && req.method !== 'HEAD';
  const release = writes ? await store.lock() : null;
  try {
    db = await store.load();
    return await api(req, res, url);
  } finally {
    await release?.();
  }
}

/** Handles one HTTP request. Used by the local server below and by api/index.js on Vercel. */
export async function handle(req, res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  const url = new URL(req.url, 'http://localhost');
  // vercel.json rewrites /api/<path> to /api/index?__path=<path>
  const rewritten = url.searchParams.get('__path');
  if (rewritten !== null) {
    url.pathname = `/api/${rewritten}`;
    url.searchParams.delete('__path');
  }
  try {
    if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);
    if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'Method not allowed');
    return await serveStatic(req, res, url);
  } catch (err) {
    const status = err.status || 500;
    if (status === 500) console.error(err);
    if (!res.headersSent) json(res, status, { error: status === 500 ? 'Something went wrong.' : err.message });
    else res.end();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  createServer(handle).listen(PORT, () => {
    console.log(`💅 You-nique by Lis is live at http://localhost:${PORT}  (admin: /admin)`);
  });
}
