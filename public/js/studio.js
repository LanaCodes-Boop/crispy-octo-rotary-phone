// Nail Studio: lets visitors design a set on an illustrated hand, then book or share it.
import { t } from './i18n.js';
import {
  ARTS,
  DEFAULT_DESIGN,
  FINISHES,
  LENGTHS,
  SHAPES,
  SKINS,
  decodeDesign,
  encodeDesign,
  handSVG,
  luminance,
  nailSVG,
} from './designer-art.js';

export const PALETTE = [
  ['Bordeaux', '741634'],
  ['Merlot', '5e0f2a'],
  ['Cherry', 'b3122e'],
  ['Rosé', 'e8a0ad'],
  ['Blush', 'f3c9c9'],
  ['Nude', 'd9a98c'],
  ['Latte', 'b98b6e'],
  ['Milky', 'f4e7e1'],
  ['Ink', '1d1418'],
  ['Gold', 'c99a3c'],
  ['Champagne', 'ead2a6'],
  ['Lilac', 'b9a2d8'],
  ['Sky', '9cc3e6'],
  ['Sage', '9db59a'],
  ['Emerald', '11634b'],
  ['Coral', 'f0735a'],
  ['Mocha', '5a3a2c'],
];

export const ART_PALETTE = [
  ['White', 'ffffff'],
  ['Gold', 'd6aa4f'],
  ['Black', '1d1418'],
  ['Pink', 'f29bb0'],
  ['Red', 'c8102e'],
  ['Silver', 'c9ced6'],
];

const colourName = (hex, palette) => palette.find(([, h]) => h === hex)?.[0] || `#${hex.toUpperCase()}`;

/** Human description, e.g. "Almond · Long · Merlot glossy · French tips (Gold)". */
export function describeDesign(d) {
  const parts = [t(`studio.shape.${d.shape}`), t(`studio.length.${d.length}`), `${colourName(d.color, PALETTE)} ${t(`studio.finish.${d.finish}`).toLowerCase()}`];
  if (d.art !== 'none') parts.push(`${t(`studio.art.${d.art}`)} (${colourName(d.artColor, ART_PALETTE)})`);
  if (d.accent) parts.push(t('studio.accentShort'));
  return parts.join(' · ');
}

/** Which menu services a design needs, so the booking and estimate match what Lis will do. */
export function servicesForDesign(config, d) {
  const extensions = d.length === 'l' || d.length === 'xl' || d.shape === 'coffin' || d.shape === 'stiletto';
  const ids = [extensions ? 'acrylic-full' : 'gel-polish'];
  if (d.art !== 'none' || d.accent || d.finish === 'chrome' || d.finish === 'cateye') ids.push('nail-art');
  return ids.filter((id) => config.services.some((s) => s.id === id));
}

const pick = (list) => list[Math.floor(Math.random() * list.length)];

export function createStudio({ config, root, formatPrice, formatDuration, onBook }) {
  const stage = root.querySelector('#stage-hand');
  const caption = root.querySelector('#stage-caption');
  const estimate = root.querySelector('#stage-estimate');
  const panel = root.querySelector('#studio-panel');
  let design = { ...DEFAULT_DESIGN };

  // ---- Panel ---------------------------------------------------------------------
  const option = (key, value, inner, cls = '', attrs = '') =>
    `<button type="button" class="opt ${cls}" data-set="${key}" data-value="${value}" aria-pressed="false" ${attrs}>${inner}</button>`;

  function renderPanel() {
    panel.innerHTML = `
      <div class="studio-group">
        <h3 class="studio-label">${t('studio.shapeLabel')}</h3>
        <div class="opt-row opt-nails" role="group" aria-label="${t('studio.shapeLabel')}">
          ${SHAPES.map((s) => option('shape', s, `<span class="opt-nail" data-preview="shape"></span><span>${t(`studio.shape.${s}`)}</span>`)).join('')}
        </div>
      </div>

      <div class="studio-group">
        <h3 class="studio-label">${t('studio.lengthLabel')}</h3>
        <div class="seg" role="group" aria-label="${t('studio.lengthLabel')}">
          ${LENGTHS.map((l) => option('length', l, t(`studio.length.${l}`))).join('')}
        </div>
      </div>

      <div class="studio-group">
        <h3 class="studio-label">${t('studio.colourLabel')} <em id="colour-name"></em></h3>
        <div class="swatches" role="group" aria-label="${t('studio.colourLabel')}">
          ${PALETTE.map(([name, hex]) => option('color', hex, `<span class="sr-only">${name}</span>`, 'swatch', `style="--c:#${hex}" title="${name}"`)).join('')}
          <label class="swatch swatch-custom" title="${t('studio.custom')}"><input type="color" data-custom="color" aria-label="${t('studio.custom')}" /><span aria-hidden="true">+</span></label>
        </div>
      </div>

      <div class="studio-group">
        <h3 class="studio-label">${t('studio.finishLabel')}</h3>
        <div class="opt-row opt-nails" role="group" aria-label="${t('studio.finishLabel')}">
          ${FINISHES.map((f) => option('finish', f, `<span class="opt-nail" data-preview="finish"></span><span>${t(`studio.finish.${f}`)}</span>`)).join('')}
        </div>
      </div>

      <div class="studio-group">
        <h3 class="studio-label">${t('studio.artLabel')}</h3>
        <div class="opt-row opt-nails opt-7" role="group" aria-label="${t('studio.artLabel')}">
          ${ARTS.map((a) => option('art', a, `<span class="opt-nail" data-preview="art"></span><span>${t(`studio.art.${a}`)}</span>`)).join('')}
        </div>
        <div class="art-colours" id="art-colours">
          <span class="mini-label">${t('studio.artColourLabel')}</span>
          <div class="swatches swatches-sm" role="group" aria-label="${t('studio.artColourLabel')}">
            ${ART_PALETTE.map(([name, hex]) => option('artColor', hex, `<span class="sr-only">${name}</span>`, 'swatch', `style="--c:#${hex}" title="${name}"`)).join('')}
            <label class="swatch swatch-custom" title="${t('studio.custom')}"><input type="color" data-custom="artColor" aria-label="${t('studio.custom')}" /><span aria-hidden="true">+</span></label>
          </div>
        </div>
      </div>

      <div class="studio-group studio-split">
        <div>
          <h3 class="studio-label">${t('studio.skinLabel')}</h3>
          <div class="swatches" role="group" aria-label="${t('studio.skinLabel')}">
            ${SKINS.map((hex, i) => option('skin', i, `<span class="sr-only">${t('studio.skinLabel')} ${i + 1}</span>`, 'swatch skin', `style="--c:#${hex}"`)).join('')}
          </div>
        </div>
        <label class="toggle">
          <input type="checkbox" data-toggle="accent" />
          <span class="toggle-track" aria-hidden="true"><span></span></span>
          <span><strong>${t('studio.accent')}</strong><small>${t('studio.accentHint')}</small></span>
        </label>
      </div>

      <div class="studio-actions">
        <button type="button" class="btn btn-outline" data-studio="surprise"><span aria-hidden="true">✨</span>${t('studio.surprise')}</button>
        <button type="button" class="btn btn-outline" data-studio="save"><svg aria-hidden="true"><use href="#i-download"/></svg>${t('studio.save')}</button>
        <button type="button" class="btn btn-gold" data-studio="book"><svg aria-hidden="true"><use href="#i-calendar"/></svg>${t('studio.book')}</button>
      </div>`;
    sync();
  }

  // ---- State → view ----------------------------------------------------------------
  function sync() {
    panel.querySelectorAll('[data-set]').forEach((b) => {
      b.setAttribute('aria-pressed', String(String(design[b.dataset.set]) === b.dataset.value));
    });
    panel.querySelectorAll('[data-preview]').forEach((el) => {
      const btn = el.closest('[data-set]');
      const preview = { ...design, [btn.dataset.set]: btn.dataset.value };
      if (btn.dataset.set === 'shape') preview.length = design.length === 's' ? 'm' : design.length;
      if (btn.dataset.set === 'art' && btn.dataset.value === 'french' && design.length === 's') preview.length = 'm';
      el.innerHTML = nailSVG(preview);
    });
    const custom = panel.querySelector('[data-custom="color"]');
    const customArt = panel.querySelector('[data-custom="artColor"]');
    custom.value = `#${design.color}`;
    customArt.value = `#${design.artColor}`;
    custom.parentElement.classList.toggle('is-active', !PALETTE.some(([, h]) => h === design.color));
    customArt.parentElement.classList.toggle('is-active', !ART_PALETTE.some(([, h]) => h === design.artColor));
    panel.querySelector('#art-colours').hidden = design.art === 'none';
    panel.querySelector('[data-toggle="accent"]').checked = design.accent;
    panel.querySelector('#colour-name').textContent = colourName(design.color, PALETTE);

    stage.innerHTML = handSVG(design, { label: describeDesign(design) });
    stage.classList.remove('bump');
    void stage.offsetWidth; // restart the animation
    stage.classList.add('bump');
    root.style.setProperty('--studio-accent', `#${design.color}`);
    root.classList.toggle('is-light', luminance(design.color) > 0.72);

    caption.textContent = describeDesign(design);
    const services = config.services.filter((s) => servicesForDesign(config, design).includes(s.id));
    const total = services.reduce((sum, s) => sum + s.price, 0);
    const minutes = services.reduce((sum, s) => sum + s.minutes, 0);
    estimate.textContent = t('studio.estimate', { price: formatPrice(config, total), time: formatDuration(minutes) });
  }

  function set(key, value) {
    design = { ...design, [key]: value };
    sync();
  }

  function surprise() {
    const art = pick(['none', 'none', 'french', 'french', 'ombre', 'hearts', 'flowers', 'gems', 'marble']);
    const color = pick(PALETTE)[1];
    let artColor = pick(ART_PALETTE)[1];
    if (artColor === color) artColor = 'ffffff';
    design = {
      ...design,
      shape: pick(SHAPES),
      length: pick(['m', 'l', 'l', 'xl']),
      color,
      finish: pick(['gloss', 'gloss', 'matte', 'chrome', 'glitter', 'cateye']),
      art,
      artColor,
      accent: Math.random() < 0.25,
    };
    sync();
    root.querySelector('.stage-card').classList.remove('burst');
    void root.offsetWidth;
    root.querySelector('.stage-card').classList.add('burst');
  }

  // ---- Save / share as image -------------------------------------------------------
  async function saveImage(button) {
    button.disabled = true;
    try {
      await document.fonts?.load?.('96px "Great Vibes"');
      await document.fonts?.load?.('500 34px "Jost"');
      const W = 1080;
      const H = 1350;
      const canvas = Object.assign(document.createElement('canvas'), { width: W, height: H });
      const ctx = canvas.getContext('2d');

      const bg = ctx.createRadialGradient(W / 2, H * 0.38, 60, W / 2, H * 0.45, H * 0.8);
      bg.addColorStop(0, '#8e2342');
      bg.addColorStop(0.55, '#4a0c1f');
      bg.addColorStop(1, '#1a030b');
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, W, H);

      const gold = ctx.createLinearGradient(0, 0, W, H);
      gold.addColorStop(0, '#a77a26');
      gold.addColorStop(0.35, '#f3dc9b');
      gold.addColorStop(0.6, '#c99a3c');
      gold.addColorStop(1, '#f7e6b0');
      ctx.strokeStyle = gold;
      ctx.lineWidth = 3;
      ctx.strokeRect(36, 36, W - 72, H - 72);
      ctx.beginPath();
      ctx.arc(W / 2, 560, 400, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255, 240, 230, 0.07)';
      ctx.fill();
      ctx.setLineDash([3, 14]);
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.setLineDash([]);

      const svg = handSVG(design);
      const img = new Image();
      const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = reject;
        img.src = url;
      });
      ctx.drawImage(img, (W - 700) / 2, 70, 700, 980);
      URL.revokeObjectURL(url);

      ctx.textAlign = 'center';
      ctx.fillStyle = gold;
      ctx.font = '104px "Great Vibes", cursive';
      ctx.fillText('You-nique by Lis', W / 2, 1138);
      ctx.fillStyle = '#fdf8f3';
      ctx.font = '500 32px "Jost", sans-serif';
      ctx.fillText(describeDesign(design), W / 2, 1204, W - 140);
      ctx.fillStyle = 'rgba(247, 230, 176, 0.8)';
      ctx.font = '400 26px "Jost", sans-serif';
      ctx.fillText(`${t('studio.imageFooter')} · ${location.host || 'Lelydorp'}`, W / 2, 1262, W - 140);

      const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
      const file = new File([blob], `younique-design-${encodeDesign(design).replace(/\./g, '-')}.png`, { type: 'image/png' });
      if (navigator.canShare?.({ files: [file] }) && matchMedia('(pointer: coarse)').matches) {
        await navigator.share({ files: [file], title: 'You-nique by Lis', text: t('studio.shareText') }).catch(() => {});
      } else {
        const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: file.name });
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      }
    } finally {
      button.disabled = false;
    }
  }

  // ---- Events ------------------------------------------------------------------------
  panel.addEventListener('click', (e) => {
    const opt = e.target.closest('[data-set]');
    if (opt) {
      const { set: key, value } = opt.dataset;
      return set(key, key === 'skin' ? Number(value) : value);
    }
    const action = e.target.closest('[data-studio]');
    if (!action) return;
    if (action.dataset.studio === 'surprise') surprise();
    if (action.dataset.studio === 'save') saveImage(action);
    if (action.dataset.studio === 'book') {
      onBook({
        code: encodeDesign(design),
        label: describeDesign(design),
        services: servicesForDesign(config, design),
      });
    }
  });

  panel.addEventListener('input', (e) => {
    const key = e.target.dataset.custom;
    if (key) set(key, e.target.value.slice(1).toLowerCase());
  });

  panel.addEventListener('change', (e) => {
    if (e.target.dataset.toggle === 'accent') set('accent', e.target.checked);
  });

  return {
    render: renderPanel,
    /** Loads a design code (keeping the visitor's chosen skin tone unless the code is from a share link). */
    load(code, { keepSkin = true } = {}) {
      const next = decodeDesign(code);
      if (!next) return false;
      design = keepSkin ? { ...next, skin: design.skin } : next;
      sync();
      return true;
    },
    get code() {
      return encodeDesign(design);
    },
  };
}
