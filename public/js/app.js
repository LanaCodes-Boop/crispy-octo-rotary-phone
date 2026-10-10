import { applyTranslations, getLang, locale, onLangChange, setLang, t } from './i18n.js';
import { DESIGNS, nailSetSVG } from './art.js';
import { nowInZone, weekdayKey } from './slots.js';
import { createBooker } from './booking.js';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const escapeHtml = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export const formatPrice = (config, amount) => `${config.currency} ${Number(amount).toLocaleString(locale())}`;

export function formatDuration(minutes) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  const hour = getLang() === 'nl' ? 'u' : 'h';
  if (!h) return `${m} min`;
  return m ? `${h} ${hour} ${m} min` : `${h} ${hour}`;
}

export const waLink = (config, text) =>
  `https://wa.me/${config.contact.whatsapp.replace(/\D/g, '')}${text ? `?text=${encodeURIComponent(text)}` : ''}`;

const config = await fetch('config.json').then((r) => r.json());
const booker = createBooker({ config, root: $('#booker'), formatPrice, formatDuration, waLink });

// --- Services ---------------------------------------------------------------
function renderServices() {
  const lang = getLang();
  $('#service-grid').innerHTML = config.services
    .map(
      (s) => `
      <article class="service-card reveal${s.popular ? ' is-popular' : ''}">
        ${s.popular ? `<span class="ribbon">${t('services.popular')}</span>` : ''}
        <div class="service-icon"><svg aria-hidden="true"><use href="#i-${s.icon}"/></svg></div>
        <h3>${escapeHtml(s.name[lang])}</h3>
        <p>${escapeHtml(s.desc[lang])}</p>
        <footer>
          <span class="chip"><svg aria-hidden="true"><use href="#i-clock"/></svg>${formatDuration(s.minutes)}</span>
          <span class="price">${formatPrice(config, s.price)}</span>
          <a class="btn-link" href="#book" data-book-service="${s.id}">${t('services.book')} <span aria-hidden="true">→</span></a>
        </footer>
      </article>`,
    )
    .join('');
}

// --- Style menu -----------------------------------------------------------
function renderStyles() {
  $('#style-grid').innerHTML = DESIGNS.map(
    (d, i) => `
      <figure class="style-card reveal">
        <div class="style-art">${nailSetSVG(d, i)}</div>
        <figcaption>
          <div><h3>${d.name}</h3><p>${d.tag}</p></div>
          <a class="btn-link" href="#book" data-look="${d.name}">${t('styles.book')} <span aria-hidden="true">→</span></a>
        </figcaption>
      </figure>`,
  ).join('');
}

// --- Hours, contact -----------------------------------------------------------
function renderHours() {
  const today = weekdayKey(nowInZone(config.timezone).date);
  const order = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
  const dayName = new Intl.DateTimeFormat(locale(), { weekday: 'long', timeZone: 'UTC' });
  $('#hours-table').innerHTML = order
    .map((key, i) => {
      const h = config.hours[key];
      const name = dayName.format(Date.UTC(2024, 0, 1 + i)); // 2024-01-01 was a Monday
      return `<tr class="${key === today ? 'is-today' : ''}${h ? '' : ' is-closed'}"><th scope="row">${name}</th><td>${h ? `${h[0]} – ${h[1]}` : t('visit.closed')}</td></tr>`;
    })
    .join('');
}

function renderPrices() {
  $$('[data-price]').forEach((el) => {
    const svc = config.services.find((s) => s.id === el.dataset.price);
    if (svc) el.textContent = formatPrice(config, svc.price);
  });
}

function wireContact() {
  $$('[data-wa]').forEach((a) => (a.href = waLink(config, t('wa.hello'))));
  $('#phone-display').textContent = config.contact.phoneDisplay;
  $('#address').textContent = config.contact.address;
  $('#directions').href = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(config.contact.mapsQuery)}`;
  $('#fb-link').href = config.contact.facebook;
  $('#fb-footer').href = config.contact.facebook;
  $('#year').textContent = new Date().getFullYear();
}

function renderAll() {
  renderServices();
  renderStyles();
  renderHours();
  renderPrices();
  wireContact();
  observeReveals();
}

// --- Language -----------------------------------------------------------------
function syncLangButtons() {
  $$('[data-lang]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.lang === getLang())));
}
$$('[data-lang]').forEach((b) => b.addEventListener('click', () => setLang(b.dataset.lang)));
onLangChange(() => {
  syncLangButtons();
  renderAll();
  $$('.reveal').forEach((el) => el.classList.add('in')); // no fade-in replay when switching language
  booker.render();
});

// --- Booking entry points -------------------------------------------------
document.addEventListener('click', (e) => {
  const svcLink = e.target.closest('[data-book-service]');
  const lookLink = e.target.closest('[data-look]');
  if (svcLink) booker.preselect({ service: svcLink.dataset.bookService });
  if (lookLink) booker.preselect({ look: lookLink.dataset.look });
});

// --- Header & mobile menu -------------------------------------------------
const header = $('.site-header');
const onScroll = () => header.classList.toggle('scrolled', window.scrollY > 40);
window.addEventListener('scroll', onScroll, { passive: true });
onScroll();

const toggle = $('.menu-toggle');
toggle.addEventListener('click', () => {
  const open = toggle.getAttribute('aria-expanded') !== 'true';
  toggle.setAttribute('aria-expanded', String(open));
  document.body.classList.toggle('menu-open', open);
});
$$('#nav a').forEach((a) =>
  a.addEventListener('click', () => {
    toggle.setAttribute('aria-expanded', 'false');
    document.body.classList.remove('menu-open');
  }),
);

// --- Reveal on scroll -----------------------------------------------------
const io =
  'IntersectionObserver' in window
    ? new IntersectionObserver(
        (entries) =>
          entries.forEach((en) => {
            if (en.isIntersecting) {
              en.target.classList.add('in');
              io.unobserve(en.target);
            }
          }),
        { rootMargin: '0px 0px -8% 0px' },
      )
    : null;

function observeReveals() {
  $$('.reveal:not(.in)').forEach((el) => (io ? io.observe(el) : el.classList.add('in')));
}

// --- Go -----------------------------------------------------------------------
document.documentElement.lang = getLang();
applyTranslations();
syncLangButtons();
renderAll();
booker.start();
