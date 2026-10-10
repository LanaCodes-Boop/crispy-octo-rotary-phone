// Draws an illustrated hand wearing a nail design. Shared by the Nail Studio, the booking flow,
// the admin dashboard and the server (which only uses the encode/decode helpers).

export const SHAPES = ['square', 'round', 'almond', 'coffin', 'stiletto'];
export const LENGTHS = ['s', 'm', 'l', 'xl'];
export const FINISHES = ['gloss', 'matte', 'chrome', 'glitter', 'cateye'];
export const ARTS = ['none', 'french', 'ombre', 'hearts', 'flowers', 'gems', 'marble'];
export const SKINS = ['f6d9c5', 'e9bd9b', 'cf9570', 'ae704a', '84502f', '5b3521'];

export const DEFAULT_DESIGN = {
  shape: 'almond',
  length: 'l',
  color: '741634',
  finish: 'gloss',
  art: 'french',
  artColor: 'd6aa4f',
  accent: false,
  skin: 2,
};

export const DESIGN_PATTERN =
  /^(square|round|almond|coffin|stiletto)\.(s|m|l|xl)\.[0-9a-f]{6}\.(gloss|matte|chrome|glitter|cateye)\.(none|french|ombre|hearts|flowers|gems|marble)\.[0-9a-f]{6}\.[01]\.[0-5]$/;

export const encodeDesign = (d) =>
  [d.shape, d.length, d.color, d.finish, d.art, d.artColor, d.accent ? 1 : 0, d.skin].join('.');

export function decodeDesign(code) {
  if (typeof code !== 'string' || !DESIGN_PATTERN.test(code)) return null;
  const [shape, length, color, finish, art, artColor, accent, skin] = code.split('.');
  return { shape, length, color, finish, art, artColor, accent: accent === '1', skin: Number(skin) };
}

// ---- Colour helpers -------------------------------------------------------------
const rgb = (hex) => [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
const hex = (c) => c.map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')).join('');
export const mix = (a, b, t) => {
  const A = rgb(a);
  const B = rgb(b);
  return hex(A.map((v, i) => v + (B[i] - v) * t));
};
export const luminance = (h) => {
  const [r, g, b] = rgb(h).map((v) => v / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

function rng(seed) {
  return () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };
}

// ---- Geometry --------------------------------------------------------------------
// Back of a right hand, fingers up. x/y = base of the finger, a = tilt in degrees,
// len = base to fingertip, w/wt = width at the base / at the tip.
const FINGERS = [
  { key: 'thumb', x: 112, y: 318, a: -42, len: 112, w: 56, wt: 43 },
  { key: 'index', x: 141, y: 240, a: -9, len: 142, w: 45, wt: 37 },
  { key: 'middle', x: 185, y: 230, a: -1, len: 160, w: 47, wt: 39 },
  { key: 'ring', x: 228, y: 240, a: 7, len: 146, w: 45, wt: 37 },
  { key: 'pinky', x: 265, y: 264, a: 16, len: 112, w: 39, wt: 31 },
];

const PALM =
  'M112 250C114 224 150 212 185 212C224 212 266 228 288 258C301 300 293 350 276 390C266 416 262 440 262 480' +
  'L146 480C148 446 142 420 128 398C108 366 97 330 100 296C101 276 105 260 112 250Z';

const EXTENSION = { s: 3, m: 20, l: 42, xl: 68 };

// Gently tapered finger with a soft bulge at the middle joint; the base reaches deep into the palm
// so the joins never show.
function fingerPath({ len, w, wt }) {
  const r = wt / 2;
  const h = w / 2;
  const tip = -(len - r);
  return (
    `M${-h * 1.08} 40L${-h} 0C${-h} ${-len * 0.32} ${-r - 2.4} ${-len * 0.52} ${-r} ${tip}` +
    `A${r} ${r} 0 0 1 ${r} ${tip}C${r + 2.4} ${-len * 0.52} ${h} ${-len * 0.32} ${h} 0L${h * 1.08} 40Q0 52 ${-h * 1.08} 40Z`
  );
}

/** Outline of a nail in local coordinates: cuticle at y=0, tip at y=-L, width W. */
export function nailPath(shape, W, L) {
  const h = W / 2;
  const c = W * 0.2;
  const f = (n) => +n.toFixed(2);
  let body;
  switch (shape) {
    case 'square': {
      const r = W * 0.16;
      body = `L${f(h)} ${f(-L + r)}Q${f(h)} ${f(-L)} ${f(h - r)} ${f(-L)}L${f(-h + r)} ${f(-L)}Q${f(-h)} ${f(-L)} ${f(-h)} ${f(-L + r)}`;
      break;
    }
    case 'round':
      body = `L${f(h)} ${f(-L + h)}A${f(h)} ${f(h)} 0 0 0 ${f(-h)} ${f(-L + h)}`;
      break;
    case 'coffin':
      body = `C${f(h)} ${f(-L * 0.42)} ${f(W * 0.34)} ${f(-L * 0.78)} ${f(W * 0.27)} ${f(-L)}L${f(-W * 0.27)} ${f(-L)}C${f(-W * 0.34)} ${f(-L * 0.78)} ${f(-h)} ${f(-L * 0.42)} ${f(-h)} ${f(-c)}`;
      break;
    case 'stiletto':
      body = `C${f(h)} ${f(-L * 0.42)} ${f(W * 0.14)} ${f(-L * 0.78)} 0 ${f(-L)}C${f(-W * 0.14)} ${f(-L * 0.78)} ${f(-h)} ${f(-L * 0.42)} ${f(-h)} ${f(-c)}`;
      break;
    default: // almond
      body = `C${f(h)} ${f(-L * 0.56)} ${f(W * 0.32)} ${f(-L * 0.86)} 0 ${f(-L)}C${f(-W * 0.32)} ${f(-L * 0.86)} ${f(-h)} ${f(-L * 0.56)} ${f(-h)} ${f(-c)}`;
  }
  return `M${f(-h)} ${f(-c)}Q0 ${f(c * 0.9)} ${f(h)} ${f(-c)}${body}L${f(-h)} ${f(-c)}Z`;
}

const HEART = 'M0 9C-5 5-11 1-11-4.5A5.6 5.6 0 0 1 0-7.4 5.6 5.6 0 0 1 11-4.5C11 1 5 5 0 9Z';
const flower = (x, y, s, petal, center) =>
  `<g transform="translate(${x} ${y}) scale(${s})">${[0, 72, 144, 216, 288]
    .map((a) => `<ellipse rx="4.6" ry="7.4" transform="rotate(${a}) translate(0 -6.4)" fill="#${petal}"/>`)
    .join('')}<circle r="3.4" fill="#${center}"/></g>`;

let uid = 0;

/** One nail (in its own coordinates, cuticle at 0,0) for finger `fg`. Pushes any gradients it needs into `defs`. */
function renderNail(d, fg, i, id, defs) {
  const isAccent = d.accent && fg.key === 'ring';
  const color = isAccent ? 'c99a3c' : d.color;
  const finish = isAccent ? 'chrome' : d.finish;
  const art = isAccent ? 'none' : d.art;
  const W = fg.wt * 0.8;
  const bed = fg.wt * 0.92;
  const L = bed + EXTENSION[d.length] * (fg.key === 'thumb' ? 0.9 : fg.key === 'pinky' ? 0.85 : 1);
  const path = nailPath(d.shape, W, L);
  const nid = `${id}-n${i}`;
  defs.push(`<clipPath id="${nid}-clip"><path d="${path}"/></clipPath>`);

  let fill;
  if (finish === 'chrome') {
    defs.push(
      `<linearGradient id="${nid}-fill" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#${mix(color, '000000', 0.38)}"/><stop offset=".3" stop-color="#${mix(color, 'ffffff', 0.62)}"/><stop offset=".5" stop-color="#${color}"/><stop offset=".72" stop-color="#${mix(color, 'ffffff', 0.82)}"/><stop offset="1" stop-color="#${mix(color, '000000', 0.3)}"/></linearGradient>`,
    );
    fill = `url(#${nid}-fill)`;
  } else if (finish === 'matte') {
    fill = `#${mix(color, 'ffffff', 0.05)}`;
  } else if (finish === 'cateye') {
    fill = `#${mix(color, '000000', 0.4)}`;
  } else {
    defs.push(
      `<linearGradient id="${nid}-fill" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="#${mix(color, '000000', 0.14)}"/><stop offset=".6" stop-color="#${color}"/><stop offset="1" stop-color="#${mix(color, 'ffffff', 0.12)}"/></linearGradient>`,
    );
    fill = `url(#${nid}-fill)`;
  }

  let overlay = '';
  if (finish === 'cateye') {
    defs.push(
      `<linearGradient id="${nid}-cat" x1="0" y1="1" x2="1" y2="0"><stop offset=".28" stop-color="#${mix(color, 'ffffff', 0.55)}" stop-opacity="0"/><stop offset=".5" stop-color="#${mix(color, 'ffffff', 0.6)}" stop-opacity=".95"/><stop offset=".72" stop-color="#${mix(color, 'ffffff', 0.55)}" stop-opacity="0"/></linearGradient>`,
    );
    overlay += `<rect x="${-W}" y="${-L - 4}" width="${W * 2}" height="${L + 8}" fill="url(#${nid}-cat)"/>`;
  }
  if (finish === 'glitter') {
    const rand = rng(31 + i * 17);
    const tones = [mix(color, 'ffffff', 0.75), 'f7e6b0', 'ffffff', mix(color, 'ffffff', 0.45)];
    for (let g = 0; g < 26; g++) {
      overlay += `<circle cx="${((rand() - 0.5) * W).toFixed(1)}" cy="${(-rand() * L).toFixed(1)}" r="${(0.5 + rand() * 1.3).toFixed(1)}" fill="#${tones[g % 4]}" opacity="${(0.6 + rand() * 0.4).toFixed(2)}"/>`;
    }
  }

  const ac = d.artColor;
  switch (art) {
    case 'french': {
      const fy = -Math.min(bed * 0.84, L - 7);
      overlay += `<path d="M${-W} ${fy + W * 0.32}Q0 ${fy - W * 0.36} ${W} ${fy + W * 0.32}L${W} ${-L - 20}L${-W} ${-L - 20}Z" fill="#${ac}"/>`;
      break;
    }
    case 'ombre':
      overlay += `<rect x="${-W}" y="${-L}" width="${W * 2}" height="${L}" fill="url(#${id}-ombre)"/>`;
      break;
    case 'hearts':
      if (i === 1 || i === 3) overlay += `<path transform="translate(0 ${-L * 0.52}) scale(${W / 34})" d="${HEART}" fill="#${ac}"/>`;
      else if (i !== 0) overlay += `<path transform="translate(${W * 0.12} ${-L * 0.7}) scale(${W / 80})" d="${HEART}" fill="#${ac}"/>`;
      break;
    case 'flowers':
      if (i === 2 || i === 3) overlay += flower(0, -L * 0.52, W / 30, ac, 'e1bb68') + flower(-W * 0.18, -L * 0.8, W / 60, ac, 'e1bb68');
      else overlay += [0.38, 0.55, 0.72].map((k) => `<circle cx="0" cy="${-L * k}" r="${W * (0.06 - k * 0.03)}" fill="#${ac}"/>`).join('');
      break;
    case 'gems': {
      const gem = (x, y, r) =>
        `<circle cx="${x}" cy="${y}" r="${r}" fill="#${ac}"/><circle cx="${x - r * 0.3}" cy="${y - r * 0.3}" r="${r * 0.42}" fill="#fff" opacity=".85"/>`;
      const gy = -W * 0.42;
      overlay += i === 2 || i === 3 ? gem(0, gy, W * 0.13) + gem(-W * 0.22, gy - W * 0.18, W * 0.08) + gem(W * 0.22, gy - W * 0.18, W * 0.08) : gem(0, gy, W * 0.1);
      break;
    }
    case 'marble': {
      const flip = i % 2 ? -1 : 1;
      overlay += `<g transform="scale(${flip} 1)"><path d="M${-W * 0.5} ${-L * 0.1}C${-W * 0.1} ${-L * 0.3} ${-W * 0.35} ${-L * 0.5} ${W * 0.1} ${-L * 0.68}S${W * 0.3} ${-L * 0.9} ${W * 0.05} ${-L * 1.05}" stroke="#${ac}" stroke-width="${W * 0.05}" fill="none"/><path d="M${W * 0.4} ${-L * 0.15}C${W * 0.15} ${-L * 0.3} ${W * 0.35} ${-L * 0.45} ${W * 0.2} ${-L * 0.6}" stroke="#${mix(d.color, '7a6a6a', 0.55)}" stroke-width="${W * 0.03}" fill="none" opacity=".55"/></g>`;
      break;
    }
  }

  const shine =
    finish === 'matte'
      ? ''
      : `<path d="M${-W * 0.24} ${-W * 0.3}C${-W * 0.27} ${-L * 0.42} ${-W * 0.2} ${-L * 0.68} ${-W * 0.06} ${-L * 0.84}" stroke="#fff" stroke-width="${W * 0.11}" stroke-linecap="round" fill="none" opacity="${finish === 'chrome' ? 0.6 : 0.36}"/>`;

  return `<g filter="url(#${id}-nail)"><path d="${path}" fill="${fill}"/></g><g clip-path="url(#${nid}-clip)">${overlay}</g>${shine}`;
}

const nailDefs = (id, d) => [
  `<filter id="${id}-nail" x="-40%" y="-40%" width="180%" height="180%"><feDropShadow dx="0" dy="1.6" stdDeviation="1.4" flood-color="#2a0712" flood-opacity=".3"/></filter>`,
  `<linearGradient id="${id}-ombre" x1="0" y1="1" x2="0" y2="0"><stop offset=".22" stop-color="#${d.artColor}" stop-opacity="0"/><stop offset=".95" stop-color="#${d.artColor}"/></linearGradient>`,
];

/** A single nail on its own — used for the option buttons in the Nail Studio. */
export function nailSVG(design, { finger = 2, className = '' } = {}) {
  const d = { ...DEFAULT_DESIGN, ...design, accent: false };
  const id = `nd${(uid++).toString(36)}`;
  const fg = FINGERS[finger];
  const defs = nailDefs(id, d);
  const nail = renderNail(d, fg, finger, id, defs);
  const W = fg.wt * 0.8;
  const L = fg.wt * 0.92 + EXTENSION[d.length];
  return `<svg class="${className}" viewBox="${-W / 2 - 5} ${-L - 4} ${W + 10} ${L + 10}" aria-hidden="true" xmlns="http://www.w3.org/2000/svg"><defs>${defs.join('')}</defs>${nail}</svg>`;
}


/**
 * Returns a self-contained SVG string of a hand wearing `design`.
 * Options: background (hex, without #) for exports, className, label (aria-label).
 */
export function handSVG(design, { background = '', className = '', label = 'Nail design preview' } = {}) {
  const d = { ...DEFAULT_DESIGN, ...design };
  const id = `nd${(uid++).toString(36)}`;
  const skin = SKINS[d.skin] || SKINS[2];
  const crease = mix(skin, '2a0712', 0.28);
  const defs = [];
  const parts = [];

  defs.push(
    `<linearGradient id="${id}-shade" gradientUnits="userSpaceOnUse" x1="60" y1="60" x2="300" y2="480"><stop offset="0" stop-color="#fff" stop-opacity=".16"/><stop offset=".5" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#2a0712" stop-opacity=".14"/></linearGradient>`,
    `<linearGradient id="${id}-gold" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#a77a26"/><stop offset=".35" stop-color="#f3dc9b"/><stop offset=".6" stop-color="#c99a3c"/><stop offset="1" stop-color="#f7e6b0"/></linearGradient>`,
    `<filter id="${id}-hand" x="-30%" y="-30%" width="160%" height="160%"><feDropShadow dx="0" dy="14" stdDeviation="14" flood-color="#2a0712" flood-opacity=".28"/></filter>`,
    ...nailDefs(id, d),
  );

  // --- Skin: one solid colour so palm and fingers merge seamlessly, then a shared shading layer ---
  let skinShapes = `<path d="${PALM}"/>`;
  let details = '';
  for (const fg of FINGERS) {
    const t = `translate(${fg.x} ${fg.y}) rotate(${fg.a})`;
    skinShapes += `<path transform="${t}" d="${fingerPath(fg)}"/>`;
    if (fg.key !== 'thumb') {
      // knuckle creases
      for (const k of [0.42, 0.68]) {
        const y = -fg.len * k;
        const half = (fg.w + (fg.wt - fg.w) * k) * 0.22;
        details += `<path transform="${t}" d="M${-half} ${y}Q0 ${y + 3.2} ${half} ${y}" stroke="#${crease}" stroke-width="1.3" stroke-linecap="round" fill="none" opacity=".45"/>`;
      }
      details += `<path transform="${t}" d="M${-fg.w * 0.2} -4Q0 -10 ${fg.w * 0.2} -4" stroke="#${mix(skin, 'ffffff', 0.35)}" stroke-width="2" stroke-linecap="round" fill="none" opacity=".5"/>`;
    }
  }
  // thumb crease where it meets the hand + tendon hint
  details += `<path d="M118 352C130 336 136 320 134 300" stroke="#${crease}" stroke-width="1.4" fill="none" opacity=".3" stroke-linecap="round"/>`;

  // --- Jewellery: ring on the ring finger and a fine bracelet ---
  const ringFinger = FINGERS[3];
  const ringY = -ringFinger.len * 0.3;
  const ringW = ringFinger.w + (ringFinger.wt - ringFinger.w) * 0.3 + 3;
  const jewellery =
    `<g transform="translate(${ringFinger.x} ${ringFinger.y}) rotate(${ringFinger.a})"><rect x="${-ringW / 2}" y="${ringY - 4.5}" width="${ringW}" height="9" rx="4.5" fill="url(#${id}-gold)"/><rect x="${-ringW / 2 + 4}" y="${ringY - 3}" width="${ringW - 8}" height="2" rx="1" fill="#fff" opacity=".55"/></g>` +
    `<path d="M144 448Q205 468 266 446" stroke="url(#${id}-gold)" stroke-width="3.4" stroke-dasharray=".1 6.5" stroke-linecap="round" fill="none"/>` +
    `<g transform="translate(205 463)"><path d="M0 0v5" stroke="#c99a3c" stroke-width="1.2"/><path transform="translate(0 11) scale(.5)" d="${HEART}" fill="url(#${id}-gold)"/></g>`;

  // --- Nails ---
  let nails = '';
  FINGERS.forEach((fg, i) => {
    const bed = fg.wt * 0.92;
    nails += `<g transform="translate(${fg.x} ${fg.y}) rotate(${fg.a}) translate(0 ${-(fg.len - bed - 3)})">${renderNail(d, fg, i, id, defs)}</g>`;
  });

  defs.push(`<clipPath id="${id}-skinclip">${skinShapes}</clipPath>`);
  parts.push(
    `<g filter="url(#${id}-hand)" fill="#${skin}">${skinShapes}</g>`,
    `<rect x="-60" y="-90" width="460" height="580" fill="url(#${id}-shade)" clip-path="url(#${id}-skinclip)"/>`,
    details,
    jewellery,
    nails,
  );
  const bg = background ? `<rect width="400" height="560" fill="#${background}"/>` : '';
  return `<svg class="${className}" viewBox="0 0 400 560" role="img" aria-label="${label}" xmlns="http://www.w3.org/2000/svg"><defs>${defs.join('')}</defs>${bg}<g transform="translate(46 84) rotate(-5 205 480)">${parts.join('')}</g></svg>`;
}
