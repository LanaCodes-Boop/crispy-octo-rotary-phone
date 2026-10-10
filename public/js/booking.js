import { getLang, locale, t } from './i18n.js';
import { addDays, getSlots, nowInZone, servicesFor, toMin, totalMinutes, totalPrice } from './slots.js';
import { decodeDesign, handSVG } from './designer-art.js';

const escapeHtml = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const monthStart = (date) => `${date.slice(0, 7)}-01`;
const daysInMonth = (first) => {
  const [y, m] = first.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
};
const nextMonth = (first) => addDays(first, daysInMonth(first));
const prevMonth = (first) => monthStart(addDays(first, -1));

/** Converts a salon-local date + time to a UTC Date (handles any timezone offset). */
function zonedToUtc(date, time, timeZone) {
  const [y, mo, d] = date.split('-').map(Number);
  const [h, mi] = time.split(':').map(Number);
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  const seen = nowInZone(timeZone, new Date(guess));
  const seenUtc = Date.UTC(...seen.date.split('-').map((n, i) => Number(n) - (i === 1 ? 1 : 0)), 0, seen.minutes);
  return new Date(guess - (seenUtc - guess));
}

export function createBooker({ config, root, formatPrice, formatDuration, waLink }) {
  const main = root.querySelector('#booker-main');
  const summary = root.querySelector('#booker-summary');
  const steps = [...root.querySelectorAll('#steps li')];

  const state = {
    step: 1,
    selected: new Set(),
    look: '',
    design: null,
    month: null,
    date: null,
    time: null,
    slots: {},
    slotsKey: '',
    loading: false,
    mode: 'live',
    form: { name: '', phone: '', email: '', notes: '' },
    error: '',
    result: null,
  };

  const services = () => servicesFor(config, [...state.selected]);
  const minutes = () => totalMinutes(services());
  const now = () => nowInZone(config.timezone);
  const lastBookable = () => addDays(now().date, config.booking.maxDaysAhead);
  const serviceNames = () => services().map((s) => s.name[getLang()]).join(', ');

  const fmtDate = (date, opts = { weekday: 'long', day: 'numeric', month: 'long' }) => {
    const text = new Intl.DateTimeFormat(locale(), { ...opts, timeZone: 'UTC' }).format(new Date(`${date}T00:00:00Z`));
    return text.charAt(0).toUpperCase() + text.slice(1);
  };

  // ---- Availability ---------------------------------------------------------
  async function loadMonth() {
    const today = now().date;
    const from = state.month < today ? today : state.month;
    const end = addDays(state.month, daysInMonth(state.month) - 1);
    const days = Math.max(0, Math.round((Date.parse(end) - Date.parse(from)) / 86400000) + 1);
    const key = `${state.mode}|${from}|${days}|${minutes()}`;
    if (state.slotsKey === key) return;

    if (!days) {
      Object.assign(state, { slots: {}, slotsKey: key });
      return;
    }

    if (state.mode === 'static') {
      const slots = {};
      for (let i = 0; i < days; i++) {
        const date = addDays(from, i);
        slots[date] = getSlots({ config, date, minutes: minutes(), now: now() });
      }
      Object.assign(state, { slots, slotsKey: key });
      return;
    }

    state.loading = true;
    render();
    try {
      const res = await fetch(`/api/availability?from=${from}&days=${days}&minutes=${minutes()}`);
      if (!res.ok) throw new Error(res.status);
      const { slots } = await res.json();
      Object.assign(state, { slots, slotsKey: key });
    } catch {
      state.mode = 'static';
      state.loading = false;
      return loadMonth();
    }
    state.loading = false;
  }

  function firstAvailableDate() {
    return Object.keys(state.slots)
      .sort()
      .find((d) => state.slots[d]?.length);
  }

  async function showMonth(first) {
    state.month = first;
    await loadMonth();
    if (!state.date || !state.slots[state.date]?.length) {
      state.date = firstAvailableDate() || null;
      state.time = null;
    }
    render();
  }

  // ---- Navigation -----------------------------------------------------------
  async function go(step, { focus = true } = {}) {
    state.error = '';
    state.step = step;
    if (step === 2) {
      if (!state.month) state.month = monthStart(state.date || now().date);
      render();
      await showMonth(state.month);
    } else {
      render();
    }
    if (focus) {
      const heading = main.querySelector('h3');
      heading?.focus({ preventScroll: true });
      const top = root.getBoundingClientRect().top;
      if (top < 0 || top > window.innerHeight * 0.6) root.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  function resetSchedule() {
    Object.assign(state, { date: null, time: null, slotsKey: '', slots: {} });
  }

  // ---- Views ---------------------------------------------------------------
  function viewServices() {
    const lang = getLang();
    return `
      <h3 tabindex="-1">${t('b.chooseTitle')}</h3>
      <p class="muted">${t('b.chooseHint')}</p>
      ${chip()}
      <div class="svc-options">
        ${config.services
          .map(
            (s) => `
          <label class="svc-option">
            <input type="checkbox" name="service" value="${s.id}" ${state.selected.has(s.id) ? 'checked' : ''} />
            <span class="svc-tick"><svg aria-hidden="true"><use href="#i-check"/></svg></span>
            <span class="svc-text"><strong>${escapeHtml(s.name[lang])}</strong><small>${formatDuration(s.minutes)}</small></span>
            <span class="svc-price">${formatPrice(config, s.price)}</span>
          </label>`,
          )
          .join('')}
      </div>
      ${errorBox()}
      <div class="booker-actions">
        <span></span>
        <button type="button" class="btn btn-gold" data-action="to-2" ${state.selected.size ? '' : 'disabled'}>${t('b.next')} →</button>
      </div>`;
  }

  function viewCalendar() {
    const today = now().date;
    const first = state.month;
    const offset = (new Date(`${first}T00:00:00Z`).getUTCDay() + 6) % 7; // Monday first
    const total = daysInMonth(first);
    const weekday = new Intl.DateTimeFormat(locale(), { weekday: 'short', timeZone: 'UTC' });
    const heads = Array.from({ length: 7 }, (_, i) => `<span>${weekday.format(Date.UTC(2024, 0, 1 + i)).slice(0, 2)}</span>`).join('');

    let cells = '<span></span>'.repeat(offset);
    for (let d = 1; d <= total; d++) {
      const date = addDays(first, d - 1);
      const open = (state.slots[date] || []).length > 0;
      const cls = [
        'day',
        open ? 'is-open' : '',
        date === state.date ? 'is-selected' : '',
        date === today ? 'is-today' : '',
      ].join(' ');
      cells += `<button type="button" class="${cls}" data-date="${date}" ${open ? '' : 'disabled'} aria-pressed="${date === state.date}" aria-label="${fmtDate(date)}">${d}</button>`;
    }

    const canPrev = first > monthStart(today);
    const canNext = nextMonth(first) <= lastBookable();
    return `
      <div class="calendar">
        <div class="cal-head">
          <button type="button" class="icon-btn" data-action="prev-month" ${canPrev ? '' : 'disabled'} aria-label="Previous month"><svg><use href="#i-left"/></svg></button>
          <strong>${fmtDate(first, { month: 'long', year: 'numeric' })}</strong>
          <button type="button" class="icon-btn" data-action="next-month" ${canNext ? '' : 'disabled'} aria-label="Next month"><svg><use href="#i-right"/></svg></button>
        </div>
        <div class="cal-grid cal-weekdays">${heads}</div>
        <div class="cal-grid ${state.loading ? 'is-loading' : ''}">${cells}</div>
      </div>`;
  }

  function viewTimes() {
    if (state.loading) return `<p class="muted">${t('b.loading')}</p>`;
    if (!state.date) return `<p class="muted">${t('b.pickDay')}</p>`;
    const slots = state.slots[state.date] || [];
    if (!slots.length) return `<p class="muted">${t('b.noSlots')}</p>`;
    const groups = [
      ['b.morning', slots.filter((s) => toMin(s) < 720)],
      ['b.afternoon', slots.filter((s) => toMin(s) >= 720 && toMin(s) < 1020)],
      ['b.evening', slots.filter((s) => toMin(s) >= 1020)],
    ].filter(([, list]) => list.length);
    return `
      <p class="times-date">${fmtDate(state.date)}</p>
      ${groups
        .map(
          ([label, list]) => `
        <div class="time-group">
          <span class="time-label">${t(label)}</span>
          <div class="time-grid">${list
            .map(
              (s) =>
                `<button type="button" class="time ${s === state.time ? 'is-selected' : ''}" data-time="${s}" aria-pressed="${s === state.time}">${s}</button>`,
            )
            .join('')}</div>
        </div>`,
        )
        .join('')}`;
  }

  function viewSchedule() {
    return `
      <h3 tabindex="-1">${t('b.dateTitle')}</h3>
      ${state.mode === 'static' ? `<p class="notice">${t('b.staticNote')}</p>` : ''}
      <div class="schedule">
        ${viewCalendar()}
        <div class="times"><h4>${t('b.timeTitle')}</h4>${viewTimes()}</div>
      </div>
      ${errorBox()}
      <div class="booker-actions">
        <button type="button" class="btn btn-text" data-action="to-1">← ${t('b.back')}</button>
        <button type="button" class="btn btn-gold" data-action="to-3" ${state.time ? '' : 'disabled'}>${t('b.next')} →</button>
      </div>`;
  }

  function viewDetails() {
    const f = state.form;
    return `
      <h3 tabindex="-1">${t('b.detailsTitle')}</h3>
      <form class="details-form" novalidate>
        <div class="field-row">
          <label class="field"><span>${t('b.name')}</span><input name="name" autocomplete="name" required maxlength="80" value="${escapeHtml(f.name)}" /></label>
          <label class="field"><span>${t('b.phone')}</span><input name="phone" type="tel" autocomplete="tel" required maxlength="30" placeholder="+597 …" value="${escapeHtml(f.phone)}" /></label>
        </div>
        <label class="field"><span>${t('b.email')}</span><input name="email" type="email" autocomplete="email" maxlength="120" value="${escapeHtml(f.email)}" /></label>
        <label class="field"><span>${t('b.notes')}</span><textarea name="notes" rows="3" maxlength="600" placeholder="${escapeHtml(t('b.notesPh'))}">${escapeHtml(f.notes)}</textarea></label>
        <label class="hp" aria-hidden="true">Website <input name="website" tabindex="-1" autocomplete="off" /></label>
        <p class="muted small">${t('b.policy')}</p>
        ${errorBox()}
        <div class="booker-actions">
          <button type="button" class="btn btn-text" data-action="to-2">← ${t('b.back')}</button>
          <button type="submit" class="btn btn-gold">${state.mode === 'static' ? t('b.submitWa') : t('b.submit')}</button>
        </div>
      </form>`;
  }

  function viewDone() {
    const r = state.result;
    if (r.static) {
      return `
        <div class="done">
          <div class="done-badge"><svg aria-hidden="true"><use href="#i-whatsapp"/></svg></div>
          <h3 tabindex="-1">${t('b.doneStaticTitle')}</h3>
          <p>${t('b.doneStaticText')}</p>
          <div class="btn-row center">
            <a class="btn btn-wa" href="${r.wa}" target="_blank" rel="noopener"><svg aria-hidden="true"><use href="#i-whatsapp"/></svg>${t('b.waBtn')}</a>
          </div>
          <button type="button" class="btn btn-text" data-action="restart">${t('b.again')}</button>
        </div>`;
    }
    const confirmed = r.status === 'confirmed';
    return `
      <div class="done">
        <div class="done-badge"><svg aria-hidden="true"><use href="#i-check"/></svg></div>
        <h3 tabindex="-1">${t(confirmed ? 'b.doneTitleConfirmed' : 'b.doneTitlePending')}</h3>
        <p>${t(confirmed ? 'b.doneTextConfirmed' : 'b.doneTextPending')}</p>
        <p class="ref"><span>${t('b.ref')}</span><strong>${escapeHtml(r.ref)}</strong></p>
        <div class="btn-row center">
          <a class="btn btn-wa" href="${r.wa}" target="_blank" rel="noopener"><svg aria-hidden="true"><use href="#i-whatsapp"/></svg>${t('b.waBtn')}</a>
          <button type="button" class="btn btn-outline" data-action="ics"><svg aria-hidden="true"><use href="#i-calendar"/></svg>${t('b.icsBtn')}</button>
        </div>
        <button type="button" class="btn btn-text" data-action="restart">${t('b.again')}</button>
      </div>`;
  }

  function chip() {
    if (state.design) {
      return `<p class="look-chip design-chip">${handSVG(decodeDesign(state.design.code), { className: 'chip-hand' })}<span><small>${t('b.yourDesign')}</small>${escapeHtml(state.design.label)}</span><button type="button" data-action="clear-design" aria-label="Remove">×</button></p>`;
    }
    if (state.look) {
      return `<p class="look-chip">✨ ${escapeHtml(t('b.lookNote', { look: state.look }))} <button type="button" data-action="clear-look" aria-label="Remove">×</button></p>`;
    }
    return '';
  }

  const addNote = (note) => {
    if (!state.form.notes.includes(note)) state.form.notes = [note, state.form.notes].filter(Boolean).join('\n');
  };
  const removeNote = (note) => {
    state.form.notes = state.form.notes
      .split('\n')
      .filter((line) => line !== note)
      .join('\n');
  };

  function viewSummary() {
    const list = services();
    const lang = getLang();
    return `
      <h4>${t('b.summary')}</h4>
      ${state.design ? `<div class="sum-design">${handSVG(decodeDesign(state.design.code), { className: 'sum-hand', label: state.design.label })}</div>` : ''}
      ${
        list.length
          ? `<ul class="sum-list">${list
              .map((s) => `<li><span>${escapeHtml(s.name[lang])}</span><span>${formatPrice(config, s.price)}</span></li>`)
              .join('')}</ul>`
          : `<p class="muted small">${t('b.nothing')}</p>`
      }
      <dl class="sum-meta">
        <div><dt>${t('b.duration')}</dt><dd>${list.length ? formatDuration(minutes()) : '—'}</dd></div>
        <div><dt>${t('b.when')}</dt><dd>${state.date && state.time ? `${fmtDate(state.date, { weekday: 'short', day: 'numeric', month: 'short' })} · ${state.time}` : '—'}</dd></div>
      </dl>
      <div class="sum-total"><span>${t('b.total')}</span><strong>${list.length ? formatPrice(config, totalPrice(list)) : '—'}</strong></div>`;
  }

  const errorBox = () => (state.error ? `<p class="form-error" role="alert">${escapeHtml(state.error)}</p>` : '');

  function render() {
    const views = { 1: viewServices, 2: viewSchedule, 3: viewDetails, 4: viewDone };
    main.innerHTML = views[state.step]();
    summary.innerHTML = viewSummary();
    summary.hidden = state.step === 4;
    root.classList.toggle('is-done', state.step === 4);
    steps.forEach((li, i) => {
      li.classList.toggle('active', i + 1 === state.step);
      li.classList.toggle('complete', i + 1 < state.step);
    });
  }

  // ---- Messages & calendar file ----------------------------------------------
  function whatsappText(ref) {
    const vars = {
      ref,
      name: state.form.name,
      services: serviceNames(),
      date: fmtDate(state.date),
      time: state.time,
    };
    let text = t(ref ? 'b.waBooked' : 'b.waRequest', vars);
    if (state.form.notes) text += `\n${t('b.waNotes', { notes: state.form.notes })}`;
    if (state.design) text += `\n${t('b.waDesign', { link: `${location.origin}${location.pathname}#design=${state.design.code}` })}`;
    return text;
  }

  function downloadIcs() {
    const r = state.result;
    const start = zonedToUtc(r.date, r.time, config.timezone);
    const end = new Date(start.getTime() + r.minutes * 60000);
    const stamp = (d) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
    const esc = (s) => s.replace(/[\\;,]/g, (c) => `\\${c}`).replace(/\n/g, '\\n');
    const ics = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//You-nique by Lis//Booking//EN',
      'BEGIN:VEVENT',
      `UID:${r.ref}@younique-by-lis`,
      `DTSTAMP:${stamp(new Date())}`,
      `DTSTART:${stamp(start)}`,
      `DTEND:${stamp(end)}`,
      `SUMMARY:${esc(`💅 ${config.name} — ${r.serviceNames}`)}`,
      `LOCATION:${esc(config.contact.address)}`,
      `DESCRIPTION:${esc(`Ref ${r.ref} · WhatsApp ${config.contact.phoneDisplay}`)}`,
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([ics], { type: 'text/calendar' }));
    a.download = `younique-${r.ref}.ics`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  // ---- Submit ----------------------------------------------------------------
  async function submit(form) {
    const data = Object.fromEntries(new FormData(form));
    state.form = { name: data.name.trim(), phone: data.phone.trim(), email: data.email.trim(), notes: data.notes.trim() };
    if (state.form.name.length < 2) return fail(t('b.errName'));
    if (state.form.phone.replace(/\D/g, '').length < 7) return fail(t('b.errPhone'));

    if (state.mode === 'static') {
      const wa = waLink(config, whatsappText());
      window.open(wa, '_blank', 'noopener');
      state.result = { static: true, wa };
      return go(4);
    }

    const button = form.querySelector('[type="submit"]');
    button.disabled = true;
    button.textContent = t('b.sending');
    try {
      const res = await fetch('/api/bookings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          services: [...state.selected],
          date: state.date,
          time: state.time,
          ...state.form,
          website: data.website,
          design: state.design?.code,
          lang: getLang(),
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.status === 409) {
        resetSchedule();
        await go(2, { focus: false });
        return fail(body.error);
      }
      if (!res.ok) return fail(body.error || t('b.errNetwork'));
      state.result = {
        ...body.booking,
        minutes: minutes(),
        serviceNames: serviceNames(),
        wa: waLink(config, whatsappText(body.booking.ref)),
      };
      go(4);
    } catch {
      fail(t('b.errNetwork'));
    }
  }

  function fail(message) {
    state.error = message;
    render();
    main.querySelector('.form-error')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  // ---- Events ----------------------------------------------------------------
  main.addEventListener('change', (e) => {
    if (e.target.name !== 'service') return;
    e.target.checked ? state.selected.add(e.target.value) : state.selected.delete(e.target.value);
    resetSchedule();
    state.error = '';
    summary.innerHTML = viewSummary();
    main.querySelector('[data-action="to-2"]').disabled = !state.selected.size;
  });

  main.addEventListener('input', (e) => {
    if (e.target.form && e.target.name in state.form) state.form[e.target.name] = e.target.value;
  });

  main.addEventListener('submit', (e) => {
    e.preventDefault();
    submit(e.target);
  });

  main.addEventListener('click', (e) => {
    const el = e.target.closest('button');
    if (!el) return;
    if (el.dataset.date) {
      Object.assign(state, { date: el.dataset.date, time: null, error: '' });
      return render();
    }
    if (el.dataset.time) {
      Object.assign(state, { time: el.dataset.time, error: '' });
      render();
      return main.querySelector('[data-action="to-3"]')?.focus();
    }
    switch (el.dataset.action) {
      case 'to-1':
        return go(1);
      case 'to-2':
        return state.selected.size ? go(2) : fail(t('b.errService'));
      case 'to-3':
        return state.time ? go(3) : fail(t('b.errSlot'));
      case 'prev-month':
        return showMonth(prevMonth(state.month));
      case 'next-month':
        return showMonth(nextMonth(state.month));
      case 'clear-look':
        removeNote(t('b.lookNote', { look: state.look }));
        state.look = '';
        return render();
      case 'clear-design':
        removeNote(t('b.designNote', { design: state.design.label }));
        state.design = null;
        return render();
      case 'ics':
        return downloadIcs();
      case 'restart':
        Object.assign(state, { selected: new Set(), look: '', design: null, result: null, month: null });
        state.form.notes = '';
        resetSchedule();
        return go(1);
    }
  });

  return {
    render,
    async start() {
      try {
        const res = await fetch('/api/health', { signal: AbortSignal.timeout?.(4000) });
        state.mode = res.ok ? 'live' : 'static';
      } catch {
        state.mode = 'static';
      }
      render();
    },
    /** Pre-fills the booking from a service button, a Style Menu look or a Nail Studio design. */
    preselect({ service, look, design }) {
      if (state.step === 4) Object.assign(state, { selected: new Set(), result: null });
      if (service) state.selected.add(service);
      if (look) {
        state.look = look;
        addNote(t('b.lookNote', { look }));
      }
      if (design) {
        if (state.design) removeNote(t('b.designNote', { design: state.design.label }));
        state.design = { code: design.code, label: design.label };
        state.selected = new Set(design.services);
        addNote(t('b.designNote', { design: design.label }));
      }
      resetSchedule();
      go(1, { focus: false });
    },
  };
}
