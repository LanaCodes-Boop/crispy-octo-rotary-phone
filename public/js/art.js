// Generates the illustrated nail sets shown in the "Style Menu".
// Each design is five almond nails drawn on top of the shared #almond shape.

const ALMOND = 'M-32,-6 C-36,-70 -26,-130 0,-176 C26,-130 36,-70 32,-6 C22,4 -22,4 -32,-6 Z';
const FRENCH_TIP = 'M-40-118Q0-92 40-118V-190H-40Z';
const HIGHLIGHT = '<path d="M-18-24C-21-70-15-116-3-150" stroke="#fff" stroke-width="6" stroke-linecap="round" fill="none" opacity=".4"/>';
const HEART = 'M0 10S-12 3-12-5a6.5 6.5 0 0 1 12-3.3A6.5 6.5 0 0 1 12-5c0 8-12 15-12 15z';

const FINGERS = [
  { x: 58, y: 226, s: 0.58, r: -16 },
  { x: 110, y: 208, s: 0.72, r: -7 },
  { x: 162, y: 200, s: 0.78, r: 0 },
  { x: 214, y: 208, s: 0.72, r: 7 },
  { x: 264, y: 230, s: 0.55, r: 15 },
];

// Small deterministic PRNG so glitter looks the same on every visit.
function rng(seed) {
  return () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };
}

function glitter(seed, count, yMin, yMax, colors) {
  const rand = rng(seed);
  let out = '';
  for (let i = 0; i < count; i++) {
    const y = yMin + rand() * (yMax - yMin);
    const x = (rand() - 0.5) * 60;
    const r = 0.8 + rand() * 2;
    out += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r.toFixed(1)}" fill="${colors[i % colors.length]}"/>`;
  }
  return out;
}

const flower = (cx, cy, petal = '#fff', center = '#e1bb68', size = 1) =>
  `<g transform="translate(${cx} ${cy}) scale(${size})">${[0, 72, 144, 216, 288]
    .map((a) => `<ellipse rx="6" ry="10" transform="rotate(${a}) translate(0 -9)" fill="${petal}"/>`)
    .join('')}<circle r="4.5" fill="${center}"/></g>`;

const gold = (id) => `url(#${id}-gold)`;

export const DESIGNS = [
  {
    name: 'Burgundy Glaze',
    tag: 'Gel polish',
    bg: ['#fbefec', '#f0d2d2'],
    base: ['#b0365a', '#741634', '#3d0a1b'],
    overlay: (id) => `<path d="M-34-116Q0-90 34-116" stroke="${gold(id)}" stroke-width="3.5" fill="none"/>`,
  },
  {
    name: 'Milky French',
    tag: 'Acrylic',
    bg: ['#fff8f3', '#f3dcd6'],
    base: ['#f9e6e4', '#efc9cc'],
    overlay: () => `<path d="${FRENCH_TIP}" fill="#fffaf7"/>`,
  },
  {
    name: 'Gold Chrome',
    tag: 'Chrome',
    bg: ['#4a0c1f', '#1f040d'],
    base: ['#fff4d1', '#c99a3c', '#7d5518'],
    diagonal: true,
    overlay: () => '<path d="M14-30C18-70 14-110 6-140" stroke="#fff" stroke-width="3" stroke-linecap="round" fill="none" opacity=".5"/>',
  },
  {
    name: 'Baby Boomer Glitter',
    tag: 'Ombré',
    bg: ['#fdf3ef', '#f2d7d6'],
    base: ['#fffaf6', '#f6d6dc', '#e48fa1'],
    overlay: (id, i) => glitter(11 + i, 14, -176, -95, [gold(id), '#fff', gold(id)]),
  },
  {
    name: 'Rosé Florals',
    tag: 'Nail art',
    bg: ['#f6e7e0', '#e9cfc6'],
    base: ['#f4dcd3', '#e6bcb0'],
    overlay: (id, i) =>
      i === 1 || i === 3
        ? flower(0, -84) + flower(-8, -132, '#fff', gold(id), 0.7)
        : `<circle cx="0" cy="-60" r="3" fill="${gold(id)}"/><circle cx="0" cy="-78" r="2" fill="#fff"/><circle cx="0" cy="-92" r="1.5" fill="${gold(id)}"/>`,
  },
  {
    name: 'Cherry Hearts',
    tag: 'Nail art',
    bg: ['#fcf0f1', '#f2cfd6'],
    base: ['#5a1027', '#12020a'],
    diagonal: true,
    overlay: (id, i) =>
      i % 2 === 0
        ? `<path d="${HEART}" transform="translate(0 -96) scale(1.2)" fill="#e7577a"/>`
        : `<path d="M-34-116Q0-90 34-116" stroke="#e7577a" stroke-width="5" fill="none"/>`,
  },
  {
    name: 'Marble Luxe',
    tag: 'Polygel',
    bg: ['#f8f3ee', '#e6dbd2'],
    base: ['#ffffff', '#f0ebe7'],
    overlay: (id, i) => {
      const flip = i % 2 ? -1 : 1;
      return `<g transform="scale(${flip} 1)"><path d="M-30-20C-8-56-24-86 6-118S22-160 4-182" stroke="#cbbfba" stroke-width="2.4" fill="none"/><path d="M-6-40C6-70-6-96 14-124" stroke="${gold(id)}" stroke-width="1.6" fill="none"/><path d="M20-30C10-50 24-70 16-90" stroke="#ddd3cf" stroke-width="1.4" fill="none"/></g>`;
    },
  },
  {
    name: 'Midnight Sparkle',
    tag: 'Glitter',
    bg: ['#3d0a1b', '#12020a'],
    base: ['#6b1430', '#1f040d'],
    overlay: (id, i) => glitter(97 + i * 7, 26, -176, -4, [gold(id), gold(id), '#f7e6b0', '#fff']),
  },
];

function gradient(id, stops, diagonal) {
  const [x2, y2] = diagonal ? [1, 1] : [0, 1];
  const n = stops.length - 1;
  return `<linearGradient id="${id}" x1="0" y1="0" x2="${x2}" y2="${y2}">${stops
    .map((c, i) => `<stop offset="${(i / n).toFixed(2)}" stop-color="${c}"/>`)
    .join('')}</linearGradient>`;
}

export function nailSetSVG(design, index) {
  const id = `look${index}`;
  const defs = [
    gradient(`${id}-bg`, design.bg, true),
    gradient(`${id}-base`, design.base, design.diagonal),
    gradient(`${id}-gold`, ['#a77a26', '#f0d48e', '#c99a3c', '#f7e6b0', '#a77a26'], true),
    `<clipPath id="${id}-clip"><path d="${ALMOND}"/></clipPath>`,
    `<filter id="${id}-shadow" x="-50%" y="-50%" width="200%" height="200%"><feDropShadow dx="0" dy="8" stdDeviation="7" flood-color="#3d0a1b" flood-opacity=".28"/></filter>`,
  ].join('');

  const nails = FINGERS.map(
    (f, i) =>
      `<g transform="translate(${f.x} ${f.y}) rotate(${f.r}) scale(${f.s})" filter="url(#${id}-shadow)"><path d="${ALMOND}" fill="url(#${id}-base)"/><g clip-path="url(#${id}-clip)">${design.overlay(id, i)}</g>${HIGHLIGHT}</g>`,
  ).join('');

  const sparkle = (x, y, s) =>
    `<path transform="translate(${x} ${y}) scale(${s})" d="M0-10C1-2 2-1 10 0 2 1 1 2 0 10-1 2-2 1-10 0-2-1-1-2 0-10Z" fill="url(#${id}-gold)"/>`;

  return `<svg viewBox="0 0 320 260" role="img" aria-label="${design.name} nail design illustration"><defs>${defs}</defs><rect width="320" height="260" fill="url(#${id}-bg)"/><circle cx="162" cy="128" r="104" fill="#fff" opacity=".12"/><circle cx="162" cy="128" r="104" fill="none" stroke="url(#${id}-gold)" stroke-dasharray="2 7" opacity=".55"/>${sparkle(276, 44, 1.1)}${sparkle(44, 70, 0.7)}${nails}</svg>`;
}
