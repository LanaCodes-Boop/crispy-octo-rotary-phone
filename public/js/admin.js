import { addDays, servicesFor, toHHMM, toMin } from './slots.js';

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

let token = store.get();
let data = { bookings: [], blocks: [], today: '' };
let filter = 'upcoming';
let query = '';
let moving = null;

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

const serviceNames = (b, lang = 'en') => servicesFor(config, b.services).map((s) => s.name[lang] || s.name.en).join(', ');

function waNumber(phone) {
  let digits = phone.replace(/\D/g, '');
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (digits.length <= 7) digits = `597${digits}`; // local Surinamese number
  return digits;
}

function clientMessage(b) {
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
  return templates[b.status].replace(/\{(\w+)\}/g, (_, k) => vars[k]);
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
  const actions = [];
  if (b.status === 'pending') actions.push(`<button class="mini ok" data-status="confirmed" data-id="${b.id}">✓ Confirm</button>`);
  if (b.status === 'confirmed' && b.date <= data.today) actions.push(`<button class="mini" data-status="completed" data-id="${b.id}">Done</button>`);
  actions.push(
    `<a class="mini wa" href="https://wa.me/${waNumber(b.phone)}?text=${encodeURIComponent(clientMessage(b))}" target="_blank" rel="noopener"><svg><use href="#i-whatsapp"/></svg>WhatsApp</a>`,
  );
  if (b.status !== 'cancelled' && b.status !== 'completed') {
    actions.push(`<button class="mini" data-move="${b.id}">Move</button>`);
    actions.push(`<button class="mini danger" data-status="cancelled" data-id="${b.id}">Cancel</button>`);
  }
  if (b.status === 'cancelled') actions.push(`<button class="mini" data-status="pending" data-id="${b.id}">Restore</button>`);

  return `
    <article class="bk s-${b.status}">
      <div class="bk-time"><strong>${b.time}</strong><span>until ${end}</span></div>
      <div>
        <div><span class="bk-name">${escapeHtml(b.name)}</span><span class="bk-ref">${escapeHtml(b.ref)}</span><span class="badge ${b.status}">${b.status === 'pending' ? 'to confirm' : b.status}</span></div>
        <div class="bk-services">${escapeHtml(serviceNames(b))} · ${price(b.total)}</div>
        <div class="bk-meta">
          <a href="tel:${escapeHtml(b.phone)}">${escapeHtml(b.phone)}</a>
          ${b.email ? `<a href="mailto:${escapeHtml(b.email)}">${escapeHtml(b.email)}</a>` : ''}
          <span>${b.source === 'admin' ? 'Added by you' : 'Booked online'} · ${b.lang === 'nl' ? 'NL' : 'EN'}</span>
        </div>
        ${b.notes ? `<p class="bk-notes">${escapeHtml(b.notes)}</p>` : ''}
        ${
          moving === b.id
            ? `<form class="move-form" data-move-form="${b.id}">
                <input type="date" name="date" value="${b.date}" required />
                <input type="time" name="time" value="${b.time}" step="900" required />
                <button class="mini ok" type="submit">Save</button>
                <button class="mini" type="button" data-move-cancel>Cancel</button>
              </form>`
            : ''
        }
      </div>
      <div class="bk-actions">${actions.join('')}</div>
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

function render() {
  renderStats();
  renderList();
  renderBlocks();
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

$('#booking-list').addEventListener('click', async (e) => {
  const statusBtn = e.target.closest('[data-status]');
  const moveBtn = e.target.closest('[data-move]');
  if (e.target.closest('[data-move-cancel]')) {
    moving = null;
    return renderList();
  }
  if (moveBtn) {
    moving = moveBtn.dataset.move;
    return renderList();
  }
  if (!statusBtn) return;
  const { id, status } = statusBtn.dataset;
  if (status === 'cancelled' && !confirm('Cancel this appointment? The time becomes available again.')) return;
  try {
    await api(`bookings/${id}`, { method: 'PATCH', body: { status } });
    await refresh();
    toast(status === 'confirmed' ? 'Confirmed — tap WhatsApp to let your client know 💅' : `Marked as ${status}`);
  } catch (error) {
    toast(error.message);
  }
});

$('#booking-list').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;
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
});

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

// Keep the list fresh while the page is open on the salon tablet/phone.
setInterval(() => {
  if (token && !document.hidden && !moving) refresh().catch(() => {});
}, 60_000);

token ? showDashboard() : logout();
