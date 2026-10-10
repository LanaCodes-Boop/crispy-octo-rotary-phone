// "Manage my booking": clients look up, save, reschedule or cancel their own appointment.
import { applyTranslations, getLang, locale, onLangChange, setLang, t } from './i18n.js';
import { minutesUntil, nowInZone, servicesFor, toHHMM, toMin } from './slots.js';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const escapeHtml = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const config = await fetch('/config.json').then((r) => r.json());
const root = $('#manage');
const hours = config.booking.cancelNoticeHours ?? 24;

/** Accepts "yl-ab3cd", "YLAB3CD" or just "AB3CD" and returns "YL-AB3CD". */
function normalizeRef(value) {
  const ref = String(value || '').toUpperCase().replace(/\s+/g, '').slice(0, 20);
  if (/^[A-Z0-9]{5}$/.test(ref)) return `YL-${ref}`;
  return ref.replace(/^YL(?=[A-Z0-9]{5}$)/, 'YL-');
}

const state = {
  view: 'form', // form | result | static
  ref: normalizeRef(new URLSearchParams(location.search).get('ref')),
  phone: '',
  booking: null,
  error: '',
  busy: false,
  confirming: false,
  late: false,
  justCancelled: false,
};

// ---- Formatting ---------------------------------------------------------------
const formatPrice = (amount) => `${config.currency} ${Number(amount).toLocaleString(locale())}`;

function formatDuration(minutes) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  const hour = getLang() === 'nl' ? 'u' : 'h';
  if (!h) return `${m} min`;
  return m ? `${h} ${hour} ${m} min` : `${h} ${hour}`;
}

const fmtDate = (date, opts = { weekday: 'long', day: 'numeric', month: 'long' }) => {
  const text = new Intl.DateTimeFormat(locale(), { ...opts, timeZone: 'UTC' }).format(new Date(`${date}T00:00:00Z`));
  return text.charAt(0).toUpperCase() + text.slice(1);
};

const waLink = (text) =>
  `https://wa.me/${config.contact.whatsapp.replace(/\D/g, '')}${text ? `?text=${encodeURIComponent(text)}` : ''}`;

const serviceNames = (b) => servicesFor(config, b.services).map((s) => s.name[getLang()]).join(', ');

function waText(key) {
  const b = state.booking;
  return t(key, { ref: b.ref, name: b.name, date: fmtDate(b.date), time: b.time });
}

/** Converts a salon-local date + time to a UTC Date (same approach as the booking widget). */
function zonedToUtc(date, time, timeZone) {
  const [y, mo, d] = date.split('-').map(Number);
  const [h, mi] = time.split(':').map(Number);
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  const seen = nowInZone(timeZone, new Date(guess));
  const seenUtc = Date.UTC(...seen.date.split('-').map((n, i) => Number(n) - (i === 1 ? 1 : 0)), 0, seen.minutes);
  return new Date(guess - (seenUtc - guess));
}

function downloadIcs() {
  const b = state.booking;
  const start = zonedToUtc(b.date, b.time, config.timezone);
  const end = new Date(start.getTime() + b.minutes * 60000);
  const stamp = (d) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const esc = (s) => s.replace(/[\\;,]/g, (c) => `\\${c}`).replace(/\n/g, '\\n');
  const ics = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//You-nique by Lis//Booking//EN',
    'BEGIN:VEVENT',
    `UID:${b.ref}@younique-by-lis`,
    `DTSTAMP:${stamp(new Date())}`,
    `DTSTART:${stamp(start)}`,
    `DTEND:${stamp(end)}`,
    `SUMMARY:${esc(`💅 ${config.name} — ${serviceNames(b)}`)}`,
    `LOCATION:${esc(config.contact.address)}`,
    `DESCRIPTION:${esc(`Ref ${b.ref} · WhatsApp ${config.contact.phoneDisplay}`)}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([ics], { type: 'text/calendar' }));
  a.download = `younique-${b.ref}.ics`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// ---- Views ----------------------------------------------------------------------
const errorBox = () => (state.error ? `<p class="form-error" role="alert">${escapeHtml(state.error)}</p>` : '');
const icon = (id) => `<svg aria-hidden="true"><use href="#${id}"/></svg>`;

function viewForm() {
  return `
    <form class="card manage-card manage-form" novalidate>
      <div class="manage-card-head">
        <span class="manage-icon">${icon('i-search')}</span>
        <div>
          <h2 tabindex="-1">${t('manage.formTitle')}</h2>
          <p class="muted">${t('manage.formHint')}</p>
        </div>
      </div>
      <div class="field-row">
        <label class="field"><span>${t('manage.ref')}</span><input name="ref" class="ref-input" required maxlength="20" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="YL-XXXXX" value="${escapeHtml(state.ref)}" /></label>
        <label class="field"><span>${t('manage.phone')}</span><input name="phone" type="tel" autocomplete="tel" required maxlength="30" placeholder="+597 …" value="${escapeHtml(state.phone)}" /></label>
      </div>
      <p class="field-help">${t('manage.refHelp')}</p>
      ${errorBox()}
      <button type="submit" class="btn btn-gold manage-submit" ${state.busy ? 'disabled' : ''}>${icon('i-search')}${t(state.busy ? 'manage.finding' : 'manage.find')}</button>
      <p class="manage-private">${icon('i-lock')}${t('manage.private')}</p>
    </form>
    <ul class="manage-tips">
      <li><span>${icon('i-calendar')}</span>${t('manage.tip1')}</li>
      <li><span class="is-wa">${icon('i-whatsapp')}</span>${t('manage.tip2')}</li>
      <li><span>${icon('i-clock')}</span>${t('manage.tip3', { hours })}</li>
    </ul>`;
}

function viewResult() {
  const b = state.booking;
  const lang = getLang();
  const until = minutesUntil(b.date, b.time, nowInZone(config.timezone));
  const active = b.status === 'pending' || b.status === 'confirmed';
  const upcoming = active && until > 0;
  const canCancel = upcoming && !state.late && until >= hours * 60;
  const firstName = b.name.split(' ')[0];
  const day = Number(b.date.slice(8));
  const statusText = state.justCancelled ? '' : t(active && !upcoming ? 'manage.text.past' : `manage.text.${b.status}`);
  const services = servicesFor(config, b.services);

  let actions;
  if (upcoming) {
    actions = `
      <div class="mr-actions">
        <a class="btn btn-wa" href="${waLink(waText('manage.waReschedule'))}" target="_blank" rel="noopener">${icon('i-whatsapp')}${t('manage.reschedule')}</a>
        <button type="button" class="btn btn-outline" data-action="ics">${icon('i-calendar')}${t('b.icsBtn')}</button>
      </div>
      ${state.confirming ? viewConfirm() : canCancel ? viewCancelZone() : viewTooLate()}`;
  } else {
    actions = `
      <div class="mr-actions">
        <a class="btn btn-gold" href="/#book">${icon('i-calendar')}${t('manage.bookAgain')}</a>
        <a class="btn btn-wa" href="${waLink(t('wa.hello'))}" target="_blank" rel="noopener">${icon('i-whatsapp')}${t('manage.waCancel')}</a>
      </div>`;
  }

  return `
    <article class="card manage-card manage-result is-${b.status}">
      ${
        state.justCancelled
          ? `<div class="mr-banner" role="status">
              <span class="mr-banner-icon">${icon('i-check')}</span>
              <div><h3 tabindex="-1">${t('manage.cancelledTitle')}</h3><p>${t('manage.cancelledText')}</p></div>
            </div>`
          : ''
      }
      <header class="mr-head">
        <div>
          <h2 class="mr-hello" tabindex="-1">${t('manage.hello', { name: escapeHtml(firstName) })}</h2>
          ${statusText ? `<p class="mr-status-text">${statusText}</p>` : ''}
        </div>
        <span class="status-badge is-${b.status}">${t(`manage.status.${b.status}`)}</span>
      </header>
      <div class="mr-when">
        <div class="date-tile" aria-hidden="true">
          <span>${fmtDate(b.date, { month: 'short' }).replace('.', '')}</span>
          <strong>${day}</strong>
          <em>${fmtDate(b.date, { weekday: 'short' }).replace('.', '')}</em>
        </div>
        <div>
          <p class="mr-date">${fmtDate(b.date, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</p>
          <p class="mr-time">${icon('i-clock')}<span>${b.time} – ${toHHMM(toMin(b.time) + b.minutes)}</span><span class="mr-dur">${formatDuration(b.minutes)}</span></p>
          <p class="mr-place">${icon('i-pin')}<span>${escapeHtml(config.contact.address)}</span></p>
        </div>
      </div>
      <ul class="mr-services">
        ${services
          .map(
            (s) => `
          <li>
            <span class="mr-svc-icon">${icon(`i-${s.icon}`)}</span>
            <span class="mr-svc-name">${escapeHtml(s.name[lang])}</span>
            <span class="mr-svc-price">${formatPrice(s.price)}</span>
          </li>`,
          )
          .join('')}
      </ul>
      <div class="mr-foot">
        <p class="mr-ref"><span>${t('b.ref')}</span><strong>${escapeHtml(b.ref)}</strong></p>
        <p class="mr-total"><span>${t('manage.total')}</span><strong>${formatPrice(b.total)}</strong></p>
      </div>
      ${actions}
    </article>
    <p class="center"><button type="button" class="btn btn-text" data-action="another">← ${t('manage.another')}</button></p>`;
}

function viewCancelZone() {
  return `
    <div class="mr-cancel">
      <p>${icon('i-info')}<span>${t('manage.policy', { hours })}</span></p>
      <button type="button" class="btn btn-sm btn-cancel" data-action="ask-cancel">${t('manage.cancel')}</button>
    </div>`;
}

function viewConfirm() {
  const b = state.booking;
  return `
    <div class="mr-confirm" role="group" aria-labelledby="mr-confirm-title">
      <h3 id="mr-confirm-title" tabindex="-1">${t('manage.confirmTitle')}</h3>
      <p>${t('manage.confirmText', { date: fmtDate(b.date, { weekday: 'long', day: 'numeric', month: 'long' }), time: b.time })}</p>
      ${errorBox()}
      <div class="btn-row">
        <button type="button" class="btn btn-wine" data-action="do-cancel" ${state.busy ? 'disabled' : ''}>${t(state.busy ? 'manage.cancelling' : 'manage.confirmYes')}</button>
        <button type="button" class="btn btn-outline" data-action="keep" ${state.busy ? 'disabled' : ''}>${t('manage.confirmNo')}</button>
      </div>
    </div>`;
}

function viewTooLate() {
  return `
    <div class="mr-late" role="note">
      <h3 tabindex="-1"><span class="mr-late-icon">${icon('i-clock')}</span>${t('manage.tooLateTitle', { hours })}</h3>
      <p>${t('manage.tooLate', { hours })}</p>
      <a class="btn btn-wa btn-sm" href="${waLink(waText('manage.waCancelMsg'))}" target="_blank" rel="noopener">${icon('i-whatsapp')}${t('manage.waCancel')}</a>
    </div>`;
}

function viewStatic() {
  const text = [t('manage.waHelp'), state.ref && `Ref: ${state.ref}`].filter(Boolean).join('\n');
  return `
    <div class="card manage-card manage-static">
      <div class="done-badge">${icon('i-whatsapp')}</div>
      <h2 tabindex="-1">${t('manage.staticTitle')}</h2>
      <p>${t('manage.staticText')}</p>
      <a class="btn btn-wa" href="${waLink(text)}" target="_blank" rel="noopener">${icon('i-whatsapp')}${t('b.waBtn')}</a>
    </div>`;
}

/** Re-renders the current view, then focuses the first of `focus` (selectors) that exists. */
let shownView = '';
function render(...focus) {
  const views = { form: viewForm, result: viewResult, static: viewStatic };
  root.classList.toggle('is-entering', state.view !== shownView); // animate only when the view changes
  shownView = state.view;
  root.innerHTML = views[state.view]();
  focus.map((sel) => root.querySelector(sel)).find(Boolean)?.focus({ preventScroll: true });
}

// ---- API ------------------------------------------------------------------------
async function post(path) {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ref: state.ref, phone: state.phone }),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

const apiError = (status) => t({ 404: 'manage.notFound', 429: 'manage.tooMany' }[status] || 'manage.errNetwork');

async function lookup(form) {
  const data = Object.fromEntries(new FormData(form));
  state.ref = normalizeRef(data.ref);
  state.phone = data.phone.trim();
  state.error = '';
  if (state.ref.length < 5) return fail(t('manage.errRef'), 'input[name="ref"]');
  if (state.phone.replace(/\D/g, '').length < 7) return fail(t('manage.errPhone'), 'input[name="phone"]');

  state.busy = true;
  setBusy(form.querySelector('[type="submit"]'), icon('i-search') + t('manage.finding'));
  try {
    const { status, body } = await post('/api/bookings/lookup');
    state.busy = false;
    if (status !== 200) return fail(apiError(status));
    Object.assign(state, { view: 'result', booking: body.booking, late: false, justCancelled: false });
    history.replaceState(null, '', `?ref=${encodeURIComponent(body.booking.ref)}`);
    render('.mr-hello');
    revealTop();
  } catch {
    state.busy = false;
    fail(t('manage.errNetwork'));
  }
}

async function cancel(button) {
  state.busy = true;
  setBusy(button, t('manage.cancelling'));
  try {
    const { status, body } = await post('/api/bookings/cancel');
    state.busy = false;
    if (status === 200) {
      Object.assign(state, { booking: body.booking, confirming: false, justCancelled: true });
      render('.mr-banner h3');
      return revealTop();
    }
    if (status === 409) {
      // Too close to the appointment, or its status changed meanwhile: refresh and explain.
      const fresh = await post('/api/bookings/lookup');
      if (fresh.status === 200) state.booking = fresh.body.booking;
      Object.assign(state, { confirming: false, late: true });
      return render('.mr-late h3', '.mr-hello');
    }
    fail(apiError(status), '.mr-confirm h3');
  } catch {
    state.busy = false;
    fail(t('manage.errNetwork'), '.mr-confirm h3');
  }
}

/** Scrolls the card into view only when its top is hidden, e.g. after filling the form on a phone. */
function revealTop() {
  const top = root.getBoundingClientRect().top;
  if (top < 70 || top > window.innerHeight * 0.6) root.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function setBusy(button, html) {
  button.closest('div, form').querySelectorAll('button').forEach((b) => (b.disabled = true));
  button.innerHTML = html;
}

function fail(message, ...focus) {
  state.error = message;
  render(...focus);
  root.querySelector('.form-error')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

// ---- Events -----------------------------------------------------------------------
root.addEventListener('submit', (e) => {
  e.preventDefault();
  if (!state.busy) lookup(e.target);
});

root.addEventListener('input', (e) => {
  if (e.target.name === 'ref' || e.target.name === 'phone') state[e.target.name] = e.target.value;
});

root.addEventListener('click', (e) => {
  const el = e.target.closest('button[data-action]');
  if (!el) return;
  switch (el.dataset.action) {
    case 'ics':
      return downloadIcs();
    case 'ask-cancel':
      Object.assign(state, { confirming: true, error: '' });
      return render('.mr-confirm h3');
    case 'keep':
      Object.assign(state, { confirming: false, error: '' });
      return render('[data-action="ask-cancel"]');
    case 'do-cancel':
      return state.busy ? undefined : cancel(el);
    case 'another':
      Object.assign(state, { view: 'form', booking: null, ref: '', phone: '', error: '', confirming: false });
      history.replaceState(null, '', location.pathname);
      return render('input[name="ref"]');
  }
});

// ---- Page chrome ------------------------------------------------------------------
function wireChrome() {
  document.title = t('manage.docTitle');
  $$('[data-wa]').forEach((a) => (a.href = waLink(t('wa.hello'))));
  $('#fb-footer').href = config.contact.facebook;
  $('#year').textContent = new Date().getFullYear();
  $$('[data-lang]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.lang === getLang())));
}

$$('[data-lang]').forEach((b) => b.addEventListener('click', () => setLang(b.dataset.lang)));
onLangChange(() => {
  wireChrome();
  render();
});

const header = $('.site-header');
const onScroll = () => header.classList.toggle('scrolled', window.scrollY > 40);
window.addEventListener('scroll', onScroll, { passive: true });
onScroll();

// ---- Go ---------------------------------------------------------------------------
document.documentElement.lang = getLang();
applyTranslations();
wireChrome();
render();

try {
  const res = await fetch('/api/health', { signal: AbortSignal.timeout?.(4000) });
  if (!res.ok) throw new Error(res.status);
} catch {
  state.view = 'static';
  render();
}
