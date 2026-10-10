import { WEEKDAYS, addDays, nowInZone, servicesFor, toHHMM, toMin, weekdayKey } from './slots.js';
import { decodeDesign, handSVG } from './designer-art.js';

// A client's Nail Studio design, linking back to the studio so it can be viewed full size.
const designPreview = (b, className) =>
  b.design && decodeDesign(b.design)
    ? `<a class="${className}" href="/#design=${b.design}" target="_blank" rel="noopener" title="Open this design in the Nail Studio">${handSVG(decodeDesign(b.design), { label: 'Client nail design' })}<span>Nail Studio design <span aria-hidden="true">↗</span></span></a>`
    : '';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const escapeHtml = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const config = await fetch('/config.json').then((r) => r.json());
const price = (n) => `${config.currency} ${Number(n).toLocaleString('nl-NL')}`;

const store = {
  get: () => {
    try {
      return sessionStorage.getItem('younique-admin') || '';
    } catch {
      return '';
    }
  },
  set: (v) => {
    try {
      v ? sessionStorage.setItem('younique-admin', v) : sessionStorage.removeItem('younique-admin');
    } catch {
      /* storage unavailable: stay logged in for this page view only */
    }
  },
};

const salonNow = () => nowInZone(config.timezone);
const dayIndex = (date) => (WEEKDAYS.indexOf(weekdayKey(date)) + 6) % 7; // Monday = 0
const mondayOf = (date) => addDays(date, -dayIndex(date));

let token = store.get();
let data = { bookings: [], blocks: [], today: '' };
let filter = 'upcoming';
let query = '';
let moving = null;
let weekStart = mondayOf(salonNow().date);
let selDay = dayIndex(salonNow().date);
let showCancelled = false;
let remindersOpen = true;
let grid = { from: 0, span: 1 };
let detailId = null;
let detailReturn = null;

// ---- API --------------------------------------------------------------------
async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(`/api/admin/${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (res.status === 401) {
    logout();
    throw new Error(json.error || 'Please log in again.');
  }
  if (!res.ok) throw new Error(json.error || 'Something went wrong.');
  return json;
}

async function refresh() {
  data = await api('bookings');
  render();
}

// ---- Formatting ----------------------------------------------------------------
const fmtDate = (date, opts = { weekday: 'long', day: 'numeric', month: 'long' }) =>
  new Intl.DateTimeFormat('en-GB', { ...opts, timeZone: 'UTC' }).format(new Date(`${date}T00:00:00Z`));

const fmtDateFor = (lang, date) =>
  new Intl.DateTimeFormat(lang === 'nl' ? 'nl-NL' : 'en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }).format(
    new Date(`${date}T00:00:00Z`),
  );

const fmtStamp = (iso) =>
  new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: config.timezone }).format(
    new Date(iso),
  );

const fmtDuration = (min) => (min < 60 ? `${min} min` : `${Math.floor(min / 60)} h${min % 60 ? ` ${min % 60} min` : ''}`);

function fmtRange(a, b) {
  const end = fmtDate(b, { day: 'numeric', month: 'long', year: 'numeric' });
  if (a.slice(0, 4) !== b.slice(0, 4)) return `${fmtDate(a, { day: 'numeric', month: 'long', year: 'numeric' })} – ${end}`;
  if (a.slice(5, 7) !== b.slice(5, 7)) return `${fmtDate(a, { day: 'numeric', month: 'long' })} – ${end}`;
  return `${Number(a.slice(8))} – ${end}`;
}

function isoWeek(monday) {
  const thursday = new Date(`${addDays(monday, 3)}T00:00:00Z`);
  return Math.floor((thursday - Date.UTC(thursday.getUTCFullYear(), 0, 1)) / 864e5 / 7) + 1;
}

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const statusLabel = (status) => (status === 'pending' ? 'to confirm' : status);
const serviceNames = (b, lang = 'en') => servicesFor(config, b.services).map((s) => s.name[lang] || s.name.en).join(', ');
const shortNames = (b) =>
  servicesFor(config, b.services)
    .map((s) => s.name.en.replace(/\s*\(.*?\)/g, '').replace(/ Add-on$/, ''))
    .join(' · ');

function waNumber(phone) {
  let digits = phone.replace(/\D/g, '');
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (digits.length <= 7) digits = `597${digits}`; // local Surinamese number
  return digits;
}

/** WhatsApp text for the client; the "confirmed" template doubles as the day-before reminder. */
function clientMessage(b, status = b.status) {
  const nl = b.lang === 'nl';
  const vars = { name: b.name.split(' ')[0], date: fmtDateFor(b.lang, b.date), time: b.time, services: serviceNames(b, b.lang), ref: b.ref };
  const templates = {
    pending: nl
      ? 'Hoi {name}! 💅 Je afspraak bij You-nique by Lis is bevestigd op {date} om {time} ({services}). Ref {ref}. Tot dan!'
      : 'Hi {name}! 💅 Your appointment at You-nique by Lis is confirmed for {date} at {time} ({services}). Ref {ref}. See you then!',
    confirmed: nl
      ? 'Hoi {name}! 💅 Even een herinnering: je afspraak bij You-nique by Lis is op {date} om {time}. Tot dan!'
      : 'Hi {name}! 💅 Just a reminder: your appointment at You-nique by Lis is on {date} at {time}. See you then!',
    cancelled: nl
      ? 'Hoi {name}, je afspraak op {date} om {time} is helaas geannuleerd. Laat me weten wanneer het jou wel uitkomt 💕'
      : "Hi {name}, unfortunately your appointment on {date} at {time} has been cancelled. Let me know what time works for you instead 💕",
    completed: nl
      ? 'Hoi {name}! Bedankt voor je bezoek aan You-nique by Lis 💕 Ik hoop dat je geniet van je nagels!'
      : 'Hi {name}! Thank you for visiting You-nique by Lis 💕 Enjoy your nails!',
  };
  return templates[status].replace(/\{(\w+)\}/g, (_, k) => vars[k]);
}

const waLink = (b, status) => `https://wa.me/${waNumber(b.phone)}?text=${encodeURIComponent(clientMessage(b, status))}`;

// ---- Shared booking actions (list cards + detail panel) -------------------------
function bookingActions(b) {
  const actions = [];
  if (b.status === 'pending') actions.push(`<button type="button" class="mini ok" data-status="confirmed" data-id="${b.id}">✓ Confirm</button>`);
  if (b.status === 'confirmed' && b.date <= data.today) {
    actions.push(`<button type="button" class="mini" data-status="completed" data-id="${b.id}">Done</button>`);
  }
  actions.push(
    `<a class="mini wa" href="${waLink(b)}" target="_blank" rel="noopener"><svg aria-hidden="true"><use href="#i-whatsapp"/></svg>WhatsApp</a>`,
  );
  if (b.status !== 'cancelled' && b.status !== 'completed') {
    actions.push(`<button type="button" class="mini" data-move="${b.id}">Move</button>`);
    actions.push(`<button type="button" class="mini danger" data-status="cancelled" data-id="${b.id}">Cancel</button>`);
  }
  if (b.status === 'cancelled') actions.push(`<button type="button" class="mini" data-status="pending" data-id="${b.id}">Restore</button>`);
  return actions.join('');
}

const moveForm = (b) =>
  moving === b.id
    ? `<form class="move-form" data-move-form="${b.id}">
        <input type="date" name="date" value="${b.date}" required aria-label="New date" />
        <input type="time" name="time" value="${b.time}" step="900" required aria-label="New time" />
        <button class="mini ok" type="submit">Save</button>
        <button class="mini" type="button" data-move-cancel>Cancel</button>
      </form>`
    : '';

async function setStatus(id, status) {
  if (status === 'cancelled' && !confirm('Cancel this appointment? The time becomes available again.')) return;
  try {
    await api(`bookings/${id}`, { method: 'PATCH', body: { status } });
    await refresh();
    toast(status === 'confirmed' ? 'Confirmed — tap WhatsApp to let your client know 💅' : `Marked as ${status}`);
  } catch (error) {
    toast(error.message);
  }
}

async function onBookingClick(e) {
  if (e.target.closest('[data-move-cancel]')) {
    moving = null;
    return render();
  }
  const moveBtn = e.target.closest('[data-move]');
  if (moveBtn) {
    moving = moveBtn.dataset.move;
    render();
    return $(`[data-move-form="${moving}"] input`, e.currentTarget)?.focus();
  }
  const statusBtn = e.target.closest('[data-status]');
  if (statusBtn) await setStatus(statusBtn.dataset.id, statusBtn.dataset.status);
}

async function onMoveSubmit(e) {
  const form = e.target.closest('[data-move-form]');
  if (!form) return;
  e.preventDefault();
  const id = form.dataset.moveForm;
  const body = { date: form.date.value, time: form.time.value };
  try {
    await api(`bookings/${id}`, { method: 'PATCH', body });
  } catch (error) {
    if (!/overlap/i.test(error.message) || !confirm(`${error.message} Save anyway?`)) return toast(error.message);
    try {
      await api(`bookings/${id}`, { method: 'PATCH', body: { ...body, force: true } });
    } catch (retryError) {
      return toast(retryError.message);
    }
  }
  moving = null;
  await refresh().catch(() => {});
  toast('Appointment moved');
}

// ---- Rendering -----------------------------------------------------------------
function renderStats() {
  const active = data.bookings.filter((b) => b.status !== 'cancelled');
  const today = data.today;
  const weekEnd = addDays(today, 6);
  const week = active.filter((b) => b.date >= today && b.date <= weekEnd);
  const pending = data.bookings.filter((b) => b.status === 'pending' && b.date >= today).length;
  $('#stats').innerHTML = `
    <div class="stat"><strong>${active.filter((b) => b.date === today).length}</strong><span>Today</span></div>
    <div class="stat ${pending ? 'is-alert' : ''}"><strong>${pending}</strong><span>To confirm</span></div>
    <div class="stat"><strong>${week.length}</strong><span>Next 7 days</span></div>
    <div class="stat"><strong>${price(week.reduce((s, b) => s + (b.total || 0), 0))}</strong><span>Expected · 7 days</span></div>`;
}

function renderReminders() {
  const tomorrow = addDays(data.today, 1);
  const list = data.bookings.filter((b) => b.date === tomorrow && (b.status === 'pending' || b.status === 'confirmed'));
  const sent = list.filter((b) => b.remindedAt).length;
  const done = sent === list.length;
  if (done !== renderReminders.done) remindersOpen = !done; // collapse once everyone is reminded
  renderReminders.done = done;
  const html = `
    <details class="remind ${done ? 'is-done' : ''}" ${remindersOpen ? 'open' : ''}>
      <summary class="remind-head">
        <span class="remind-icon"><svg aria-hidden="true"><use href="#i-bell"/></svg></span>
        <span class="remind-title">
          <span class="remind-eyebrow">${fmtDate(tomorrow)}</span>
          <strong>Tomorrow: ${plural(list.length, 'appointment')} — <em>${done ? 'all reminders sent ✓' : 'send reminders'}</em></strong>
        </span>
        <span class="remind-count"><span>${sent} of ${list.length} sent</span><svg aria-hidden="true"><use href="#i-next"/></svg></span>
      </summary>
      <ul class="remind-list">
        ${list
          .map(
            (b) => `
          <li class="${b.remindedAt ? 'is-sent' : ''}">
            <span class="remind-time">${b.time}</span>
            <span class="remind-who">
              <strong>${escapeHtml(b.name)}</strong>
              <small>${escapeHtml(shortNames(b))}${b.status === 'pending' ? ' · <b>to confirm</b>' : ''}</small>
            </span>
            ${
              b.remindedAt
                ? `<span class="remind-sent" title="Sent ${fmtStamp(b.remindedAt)}">Reminder sent ✓</span>
                   <button type="button" class="remind-undo" data-unremind="${b.id}"
                     aria-label="Mark reminder to ${escapeHtml(b.name)} as not sent">Undo</button>`
                : `<a class="mini gold" data-remind="${b.id}" href="${waLink(b, 'confirmed')}" target="_blank" rel="noopener">
                     <svg aria-hidden="true"><use href="#i-whatsapp"/></svg>Remind</a>`
            }
          </li>`,
          )
          .join('')}
      </ul>
    </details>`;
  $$('[data-reminders]').forEach((el) => {
    el.innerHTML = list.length ? html : '';
    el.hidden = !list.length;
  });
}

function gridRange(bookings) {
  const hours = WEEKDAYS.map((d) => config.hours[d]).filter(Array.isArray);
  let from = hours.length ? Math.min(...hours.map((h) => toMin(h[0]))) : 8 * 60;
  let to = hours.length ? Math.max(...hours.map((h) => toMin(h[1]))) : 20 * 60;
  bookings.forEach((b) => {
    from = Math.min(from, toMin(b.time));
    to = Math.max(to, toMin(b.time) + b.minutes);
  });
  return [Math.floor(from / 60) * 60, Math.min(Math.ceil(to / 60) * 60, 24 * 60)];
}

/**
 * Lays out overlapping appointments. When their starts are at least 45 min apart the later one is cascaded
 * (indented over the earlier one, which keeps its name visible); otherwise they sit side by side in lanes.
 */
function layoutLanes(items) {
  const out = [];
  let cluster = [];
  let lanes = [];
  let clusterEnd = -1;
  const flush = () => {
    const cascade = cluster.every((c, i) => !i || c.s - cluster[i - 1].s >= 45);
    cluster.forEach((c, i) => {
      if (!cascade) return Object.assign(c, { lanes: lanes.length, indent: 0 });
      const under = cluster.slice(0, i).filter((p) => p.e > c.s);
      Object.assign(c, { lane: 0, lanes: 1, indent: under.length ? Math.max(...under.map((p) => p.indent)) + 1 : 0 });
    });
  };
  [...items]
    .sort((a, b) => toMin(a.time) - toMin(b.time) || b.minutes - a.minutes)
    .forEach((b) => {
      const s = toMin(b.time);
      const e = s + b.minutes;
      if (s >= clusterEnd) {
        flush();
        cluster = [];
        lanes = [];
      }
      clusterEnd = Math.max(clusterEnd, e);
      let lane = lanes.findIndex((end) => end <= s);
      if (lane === -1) lane = lanes.push(e) - 1;
      else lanes[lane] = e;
      const item = { b, s, e, lane };
      cluster.push(item);
      out.push(item);
    });
  flush();
  return out;
}

const pctOf = (min) => `${((min / grid.span) * 100).toFixed(3)}%`;

function eventBlock({ b, s, e, lane, lanes, indent }) {
  const size = b.minutes < 35 ? 'is-xs' : b.minutes < 60 ? 'is-sm' : '';
  const label = [`${b.time}–${toHHMM(e)}`, b.name, serviceNames(b), statusLabel(b.status), b.remindedAt && 'reminder sent']
    .filter(Boolean)
    .join(', ');
  return `
    <button type="button" class="ev s-${b.status} ${size} ${indent ? 'is-stacked' : ''}" data-open="${b.id}"
      title="${escapeHtml(label)}" aria-label="${escapeHtml(label)}"
      style="top:${pctOf(s - grid.from)};height:calc(${pctOf(b.minutes)} - 2px);--lane:${lane};--lanes:${lanes};--indent:${indent}">
      <span class="ev-time">${b.time}<span class="ev-end">–${toHHMM(e)}</span>${b.remindedAt ? '<i class="ev-bell">✓</i>' : ''}</span>
      <span class="ev-name">${escapeHtml(b.name)}</span>
      <span class="ev-svc">${escapeHtml(shortNames(b))}</span>
    </button>`;
}

function renderWeek() {
  const now = salonNow();
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const inWeek = data.bookings.filter((b) => b.date >= days[0] && b.date <= days[6]);
  const active = inWeek.filter((b) => b.status !== 'cancelled');
  const shown = showCancelled ? inWeek : active;
  const blocks = data.blocks.filter((b) => b.date >= days[0] && b.date <= days[6]);
  const [from, to] = gridRange(shown);
  grid = { from, span: to - from };

  const thisWeek = weekStart === mondayOf(now.date);
  const pending = active.filter((b) => b.status === 'pending').length;
  const cancelled = inWeek.length - active.length;
  $('#wk-eyebrow').textContent = `Week ${isoWeek(weekStart)}${thisWeek ? ' · This week' : ''}`;
  const range = fmtRange(days[0], days[6]);
  if ($('#wk-range').textContent !== range) $('#wk-range').textContent = range; // aria-live: announce real changes only
  $('#wk-summary').innerHTML = active.length
    ? [
        plural(active.length, 'appointment'),
        pending ? `<b class="is-alert">${pending} to confirm</b>` : '',
        `${price(active.reduce((s, b) => s + (b.total || 0), 0))} expected`,
      ]
        .filter(Boolean)
        .join('<span aria-hidden="true"> · </span>')
    : 'No appointments this week yet';
  $('[data-week="0"]').setAttribute('aria-current', String(thisWeek));
  $('#show-cancelled').checked = showCancelled;
  $('#show-cancelled-label').textContent = `Show cancelled${cancelled ? ` (${cancelled})` : ''}`;

  const meta = days.map((date, i) => {
    const hours = config.hours[weekdayKey(date)];
    const count = active.filter((b) => b.date === date).length;
    const off = blocks.some((bl) => bl.date === date && !bl.start);
    const open = Array.isArray(hours);
    const cls = [date === now.date && 'is-today', !open && 'is-closed', off && 'is-off', i === selDay && 'is-selected'];
    const note = !open ? 'Closed' : off ? 'Time off' : '';
    const status = note || `${hours[0]}–${hours[1]}`;
    return { date, i, hours: open ? hours : null, count, note, status, cls: cls.filter(Boolean).join(' ') };
  });

  const chips = meta
    .map(
      ({ date, i, count, note, status, cls }) => `
      <button type="button" class="wk-chip ${cls}" data-day="${i}" aria-pressed="${i === selDay}"
        aria-label="${fmtDate(date)}, ${count ? plural(count, 'appointment') : status}">
        <span>${fmtDate(date, { weekday: 'short' })}</span>
        <strong>${Number(date.slice(8))}</strong>
        <i>${count ? '<b></b>'.repeat(Math.min(count, 4)) : note.toLowerCase()}</i>
      </button>`,
    )
    .join('');

  const sel = meta[selDay];
  const dayline = [
    `<strong>${fmtDate(sel.date)}</strong>`,
    sel.date === now.date ? 'Today' : '',
    sel.status,
    sel.hours || sel.count ? plural(sel.count, 'appointment') : '',
  ]
    .filter(Boolean)
    .map((part) => `<span>${part}</span>`)
    .join('<i aria-hidden="true"> · </i>');

  const heads = meta
    .map(
      ({ date, count, status, cls }) => `
      <div class="wk-head ${cls}">
        <span class="wk-dow">${fmtDate(date, { weekday: 'short' })}</span>
        <span class="wk-num">${Number(date.slice(8))}</span>
        <span class="wk-sub">${count ? plural(count, 'appointment') : status}</span>
      </div>`,
    )
    .join('');

  const labels = [];
  for (let m = from; m < to; m += 60) labels.push(`<span class="wk-hour" style="top:${pctOf(m - from)}">${toHHMM(m)}</span>`);

  const cols = meta
    .map(({ date, hours, cls }) => {
      const parts = [];
      if (!hours) parts.push('<div class="wk-closed"><span>Closed</span></div>');
      else {
        const [open, close] = hours.map(toMin);
        if (open > from) parts.push(`<div class="wk-shade" style="top:0;height:${pctOf(open - from)}"></div>`);
        if (close < to) parts.push(`<div class="wk-shade" style="top:${pctOf(close - from)};bottom:0"></div>`);
      }
      blocks
        .filter((bl) => bl.date === date)
        .forEach((bl) => {
          const s = Math.max(bl.start ? toMin(bl.start) : from, from);
          const e = Math.min(bl.start ? toMin(bl.end) : to, to);
          if (e <= s) return;
          parts.push(`
            <div class="wk-off ${bl.start ? '' : 'is-day'}" style="top:${pctOf(s - from)};height:${pctOf(e - s)}">
              <strong>Time off</strong>
              <span>${bl.start ? `${bl.start}–${bl.end}` : 'Whole day'}${bl.note ? ` · ${escapeHtml(bl.note)}` : ''}</span>
            </div>`);
        });
      layoutLanes(shown.filter((b) => b.date === date)).forEach((item) => parts.push(eventBlock(item)));
      if (date === now.date) parts.push('<div class="wk-now" aria-hidden="true"></div>');
      return `<div class="wk-col ${cls}" data-date="${date}">${parts.join('')}</div>`;
    })
    .join('');

  $('#week').innerHTML = `
    <div class="wk-chips" role="group" aria-label="Choose a day">${chips}</div>
    <p class="wk-dayline">${dayline}</p>
    <div class="wk-scroll">
      <div class="wk-grid" style="--rows:${grid.span / 60}">
        <div class="wk-corner"></div>
        ${heads}
        <div class="wk-times" aria-hidden="true">${labels.join('')}<span class="wk-now-tag" hidden></span></div>
        ${cols}
      </div>
    </div>
    <div class="wk-legend" aria-hidden="true">
      <span><i class="lg-pending"></i>To confirm</span>
      <span><i class="lg-confirmed"></i>Confirmed</span>
      <span><i class="lg-completed"></i>Done</span>
      <span><i class="lg-off"></i>Time off</span>
      <span><i class="lg-closed"></i>Closed</span>
    </div>`;

  const chipRow = $('.wk-chips');
  const chip = $('.wk-chip.is-selected', chipRow);
  if (chip && chipRow.scrollWidth > chipRow.clientWidth) {
    chipRow.scrollLeft = chip.offsetLeft - (chipRow.clientWidth - chip.offsetWidth) / 2;
  }
  tickNow();
}

/** Moves the "now" line; re-renders when the salon's date rolls over. */
function tickNow() {
  const now = salonNow();
  if (tickNow.date && tickNow.date !== now.date) {
    tickNow.date = now.date;
    return renderWeek();
  }
  tickNow.date = now.date;
  const line = $('.wk-now');
  const tag = $('.wk-now-tag');
  if (!line) return;
  const visible = now.minutes >= grid.from && now.minutes <= grid.from + grid.span;
  line.hidden = tag.hidden = !visible;
  line.style.top = tag.style.top = pctOf(now.minutes - grid.from);
  tag.textContent = toHHMM(now.minutes);
}

function filtered() {
  const today = data.today;
  const q = query.trim().toLowerCase();
  let list = data.bookings.filter((b) => {
    if (q && ![b.name, b.phone, b.ref, b.email].some((v) => (v || '').toLowerCase().includes(q))) return false;
    switch (filter) {
      case 'upcoming':
        return b.date >= today && b.status !== 'cancelled';
      case 'today':
        return b.date === today;
      case 'pending':
        return b.status === 'pending';
      case 'past':
        return b.date < today;
      default:
        return true;
    }
  });
  if (filter === 'past') list = list.reverse();
  return list;
}

function bookingCard(b) {
  const end = toHHMM(toMin(b.time) + b.minutes);
  return `
    <article class="bk s-${b.status}">
      <div class="bk-time"><strong>${b.time}</strong><span>until ${end}</span></div>
      <div>
        <div><span class="bk-name">${escapeHtml(b.name)}</span><span class="bk-ref">${escapeHtml(b.ref)}</span><span class="badge ${b.status}">${statusLabel(b.status)}</span></div>
        <div class="bk-services">${escapeHtml(serviceNames(b))} · ${price(b.total)}</div>
        <div class="bk-meta">
          <a href="tel:${escapeHtml(b.phone)}">${escapeHtml(b.phone)}</a>
          ${b.email ? `<a href="mailto:${escapeHtml(b.email)}">${escapeHtml(b.email)}</a>` : ''}
          <span>${b.source === 'admin' ? 'Added by you' : 'Booked online'} · ${b.lang === 'nl' ? 'NL' : 'EN'}</span>
          ${b.remindedAt ? `<span class="bk-reminded">Reminder sent ✓</span>` : ''}
        </div>
        ${designPreview(b, 'bk-design')}
        ${b.notes ? `<p class="bk-notes">${escapeHtml(b.notes)}</p>` : ''}
        ${moveForm(b)}
      </div>
      <div class="bk-actions">${bookingActions(b)}</div>
    </article>`;
}

function renderList() {
  const list = filtered();
  if (!list.length) {
    $('#booking-list').innerHTML = `<div class="empty"><svg><use href="#crown"/></svg>No appointments here yet.</div>`;
    return;
  }
  const groups = new Map();
  list.forEach((b) => groups.set(b.date, [...(groups.get(b.date) || []), b]));
  $('#booking-list').innerHTML = [...groups]
    .map(
      ([date, items]) => `
      <section class="day-group">
        <h3>${fmtDate(date)} ${date === data.today ? '<small>Today</small>' : ''}</h3>
        ${items.map(bookingCard).join('')}
      </section>`,
    )
    .join('');
}

function renderBlocks() {
  const upcoming = data.blocks.filter((b) => b.date >= data.today);
  $('#block-list').innerHTML = upcoming.length
    ? upcoming
        .map(
          (b) => `
        <div class="block">
          <div><strong>${fmtDate(b.date)}</strong> · ${b.start ? `${b.start} – ${b.end}` : 'whole day'}${b.note ? ` · <span class="muted">${escapeHtml(b.note)}</span>` : ''}</div>
          <button class="mini danger" data-unblock="${b.id}">Remove</button>
        </div>`,
        )
        .join('')
    : `<div class="empty">No time off planned.</div>`;
}

// ---- Detail panel ----------------------------------------------------------------
function renderDetail() {
  if (!detailId) return;
  const b = data.bookings.find((x) => x.id === detailId);
  if (!b) return closeDetail();
  const panel = $('#detail .dr-panel');
  const hadFocus = panel.contains(document.activeElement);
  const end = toHHMM(toMin(b.time) + b.minutes);
  const facts = [
    ['Phone', `<a href="tel:${escapeHtml(b.phone)}">${escapeHtml(b.phone)}</a>`],
    b.email && ['Email', `<a href="mailto:${escapeHtml(b.email)}">${escapeHtml(b.email)}</a>`],
    ['Language', b.lang === 'nl' ? 'Nederlands' : 'English'],
    ['Booked', `${b.source === 'admin' ? 'Added by you' : 'Online'}${b.createdAt ? ` · ${fmtStamp(b.createdAt)}` : ''}`],
    b.remindedAt && ['Reminder', `<span class="dr-ok">Sent ${fmtStamp(b.remindedAt)} ✓</span>`],
  ].filter(Boolean);

  panel.innerHTML = `
    <header class="dr-head">
      <button type="button" class="dr-close" data-close aria-label="Close details">
        <svg aria-hidden="true"><use href="#i-close"/></svg>
      </button>
      <span class="badge ${b.status}">${statusLabel(b.status)}</span>
      <h2 id="detail-title">${escapeHtml(b.name)}</h2>
      <p class="dr-when">${fmtDate(b.date)}</p>
      <p class="dr-time"><strong>${b.time} – ${end}</strong><span>${fmtDuration(b.minutes)}</span></p>
      <p class="dr-ref">Ref ${escapeHtml(b.ref)}</p>
    </header>
    <div class="dr-body">
      <section>
        <h3 class="dr-label">Services</h3>
        <ul class="dr-services">
          ${servicesFor(config, b.services)
            .map((s) => `<li><span>${escapeHtml(s.name.en)}</span><small>${fmtDuration(s.minutes)}</small></li>`)
            .join('')}
          <li class="dr-total"><span>Total</span><strong>${price(b.total)}</strong></li>
        </ul>
      </section>
      <section>
        <h3 class="dr-label">Client</h3>
        <dl class="dr-facts">${facts.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('')}</dl>
      </section>
      ${b.design ? `<section><h3 class="dr-label">Their design</h3>${designPreview(b, 'dr-design')}</section>` : ''}
      ${b.notes ? `<section><h3 class="dr-label">Notes</h3><p class="bk-notes">${escapeHtml(b.notes)}</p></section>` : ''}
      ${moving === b.id ? `<section><h3 class="dr-label">Move to</h3>${moveForm(b)}</section>` : ''}
    </div>
    <footer class="dr-actions">${bookingActions(b)}</footer>`;
  if (hadFocus) panel.focus({ preventScroll: true });
}

function openDetail(id) {
  detailReturn = document.activeElement;
  detailId = id;
  moving = null;
  renderDetail();
  $('#detail').classList.add('is-open');
  document.documentElement.classList.add('has-drawer');
  $('main').inert = $('.admin-bar').inert = true;
  $('#detail .dr-close').focus({ preventScroll: true });
}

function closeDetail() {
  if (!detailId) return;
  const id = detailId;
  detailId = null;
  if (moving === id) moving = null;
  $('#detail').classList.remove('is-open');
  document.documentElement.classList.remove('has-drawer');
  $('main').inert = $('.admin-bar').inert = false;
  const back = $(`[data-open="${id}"]`) || detailReturn;
  back?.focus?.({ preventScroll: true });
}

function render() {
  renderStats();
  renderReminders();
  renderWeek();
  renderList();
  renderBlocks();
  renderDetail();
}

function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.remove('show'), 2600);
}

function showError(form, message) {
  const el = form.querySelector('.form-error');
  el.textContent = message;
  el.hidden = !message;
}

// ---- Views ---------------------------------------------------------------------
function showDashboard() {
  $('#login-view').hidden = true;
  $('#dash-view').hidden = false;
  $('#logout').hidden = false;
  refresh().catch((e) => toast(e.message));
}

function logout() {
  if (token) fetch('/api/admin/logout', { method: 'POST', headers: { Authorization: `Bearer ${token}` } }).catch(() => {});
  token = '';
  store.set('');
  closeDetail();
  $('#dash-view').hidden = true;
  $('#logout').hidden = true;
  $('#login-view').hidden = false;
}

// ---- Events --------------------------------------------------------------------
$('#login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const err = $('#login-error');
  err.hidden = true;
  try {
    const res = await fetch('/api/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: e.target.password.value }),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error);
    token = json.token;
    store.set(token);
    e.target.reset();
    showDashboard();
  } catch (error) {
    err.textContent = error.message || 'Could not log in.';
    err.hidden = false;
  }
});

$('#logout').addEventListener('click', logout);

$$('[data-tab]').forEach((tab) =>
  tab.addEventListener('click', () => {
    $$('[data-tab]').forEach((t) => t.setAttribute('aria-selected', String(t === tab)));
    $$('[data-panel]').forEach((p) => (p.hidden = p.dataset.panel !== tab.dataset.tab));
  }),
);

$('#wk-nav').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-week]');
  if (!btn) return;
  const step = Number(btn.dataset.week);
  if (step) weekStart = addDays(weekStart, step * 7);
  else {
    weekStart = mondayOf(salonNow().date);
    selDay = dayIndex(salonNow().date);
  }
  renderWeek();
});

$('#show-cancelled').addEventListener('change', (e) => {
  showCancelled = e.target.checked;
  renderWeek();
});

$('#week').addEventListener('click', (e) => {
  const ev = e.target.closest('[data-open]');
  if (ev) return openDetail(ev.dataset.open);
  const chip = e.target.closest('[data-day]');
  if (!chip) return;
  selDay = Number(chip.dataset.day);
  renderWeek();
  $(`.wk-chip[data-day="${selDay}"]`).focus();
});

$('#detail').addEventListener('click', (e) => {
  if (e.target.closest('[data-close]')) return closeDetail();
  onBookingClick(e);
});
$('#detail').addEventListener('submit', onMoveSubmit);

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && detailId) {
    e.preventDefault();
    closeDetail();
  }
});

$$('[data-reminders]').forEach((el) =>
  el.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-remind], [data-unremind]');
    if (!btn) return;
    const reminded = 'remind' in btn.dataset;
    try {
      await api(`bookings/${btn.dataset.remind || btn.dataset.unremind}`, { method: 'PATCH', body: { reminded } });
      await refresh();
      toast(reminded ? 'Reminder marked as sent ✓' : 'Reminder marked as not sent');
    } catch (error) {
      toast(error.message);
    }
  }),
);

// The strip appears on two tabs; keep both copies opened or collapsed together.
document.addEventListener(
  'toggle',
  (e) => {
    if (!e.target.matches?.('details.remind')) return;
    remindersOpen = e.target.open;
    $$('details.remind').forEach((d) => (d.open = remindersOpen));
  },
  true,
);

$('#filters').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-filter]');
  if (!btn) return;
  filter = btn.dataset.filter;
  $$('#filters button').forEach((b) => b.classList.toggle('is-active', b === btn));
  renderList();
});

$('#search').addEventListener('input', (e) => {
  query = e.target.value;
  renderList();
});

$('#booking-list').addEventListener('click', onBookingClick);
$('#booking-list').addEventListener('submit', onMoveSubmit);

$('#add-services').innerHTML = config.services
  .map(
    (s) =>
      `<label class="check"><input type="checkbox" name="services" value="${s.id}" /> ${escapeHtml(s.name.en)} <small>${s.minutes} min</small></label>`,
  )
  .join('');

$('#add-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;
  const fd = new FormData(form);
  showError(form, '');
  try {
    await api('bookings', {
      method: 'POST',
      body: {
        services: fd.getAll('services'),
        date: fd.get('date'),
        time: fd.get('time'),
        name: fd.get('name'),
        phone: fd.get('phone'),
        notes: fd.get('notes'),
        lang: fd.get('lang'),
        force: fd.get('force') === 'on',
      },
    });
    form.reset();
    await refresh();
    toast('Appointment saved');
  } catch (error) {
    showError(form, error.message);
  }
});

$('#off-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;
  const fd = Object.fromEntries(new FormData(form));
  showError(form, '');
  try {
    await api('blocks', { method: 'POST', body: fd });
    form.reset();
    await refresh();
    toast('Time off added');
  } catch (error) {
    showError(form, error.message);
  }
});

$('#block-list').addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-unblock]');
  if (!btn) return;
  try {
    await api(`blocks/${btn.dataset.unblock}`, { method: 'DELETE' });
    await refresh();
    toast('Time off removed');
  } catch (error) {
    toast(error.message);
  }
});

// Keep the book fresh while the page is open on the salon tablet/phone.
const idle = () => token && !document.hidden && !moving && !detailId;
setInterval(() => {
  if (idle()) refresh().catch(() => {});
}, 60_000);
document.addEventListener('visibilitychange', () => {
  if (idle()) refresh().catch(() => {});
});
setTimeout(() => {
  tickNow();
  setInterval(tickNow, 60_000);
}, 60_500 - (Date.now() % 60_000));

if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js', { scope: '/admin' }).catch(() => {});

token ? showDashboard() : logout();
