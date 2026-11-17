/**
 * Generates a deterministic editorial packshot SVG for every product in
 * data/cosmetics.json and writes it to public/images/catalog/<slug>.svg.
 *
 * Run: node scripts/generate-catalog-artwork.mjs
 *
 * Zero dependencies. Re-runnable and idempotent: the same catalogue always produces
 * byte-identical artwork, because every colour, proportion and variant is hashed from
 * the product slug.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const ROOT = path.resolve(import.meta.dirname, '..');
const DATA_FILE = path.join(ROOT, 'data', 'cosmetics.json');
const OUT_DIR = path.join(ROOT, 'public', 'images', 'catalog');

/* ------------------------------------------------------------------ *
 * Determinism
 * ------------------------------------------------------------------ */
const digest = (seed) => crypto.createHash('sha1').update(seed).digest('hex');
const sliceInt = (seed, offset, length) => parseInt(digest(seed).slice(offset, offset + length), 16);

/** Pick from an array using a slice of the slug hash. */
const pick = (list, seed, offset) => list[sliceInt(seed, offset, 6) % list.length];

/* ------------------------------------------------------------------ *
 * Brand palette — deliberately muted, nothing candy-bright
 * ------------------------------------------------------------------ */
const IVORY = '#f4efe7';
const IVORY_DEEP = '#e9e1d3';
const INK = '#22262b';
const INK_SOFT = '#3c4148';

const BODY = ['#2f3a35', '#3b4a52', '#5d6b57', '#6b5d4f', '#7d6a58', '#8a5f52', '#93856f', '#7a6b74', '#31383f'];
const ACCENT = ['#c9b27a', '#b98a72', '#8fa08c', '#c2a58a', '#a98b8b', '#6f8079', '#cbbfae', '#9c7f63'];
const CAP = ['#1f2422', '#3a3630', '#6b5d4f', '#a99257', '#d8cfc0', '#495460', '#7c6a52'];

const CATEGORY_LABEL = {
  skincare: 'Skincare',
  makeup: 'Makeup',
  haircare: 'Haircare',
  perfumes: 'Perfume',
  'beauty-accessories': 'Accessories'
};

/* ------------------------------------------------------------------ *
 * Small SVG helpers
 * ------------------------------------------------------------------ */
const esc = (value) =>
  String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');

const round = (value) => Math.round(value * 100) / 100;

const rect = (x, y, w, h, r, fill, extra = '') =>
  `<rect x="${round(x)}" y="${round(y)}" width="${round(w)}" height="${round(h)}" rx="${round(r)}" fill="${fill}"${extra ? ' ' + extra : ''}/>`;

const ellipse = (cx, cy, rx, ry, fill, extra = '') =>
  `<ellipse cx="${round(cx)}" cy="${round(cy)}" rx="${round(rx)}" ry="${round(ry)}" fill="${fill}"${extra ? ' ' + extra : ''}/>`;

const polygon = (points, fill, extra = '') =>
  `<polygon points="${points.map(([x, y]) => `${round(x)},${round(y)}`).join(' ')}" fill="${fill}"${extra ? ' ' + extra : ''}/>`;

const line = (x1, y1, x2, y2, stroke, width, opacity = 1) =>
  `<line x1="${round(x1)}" y1="${round(y1)}" x2="${round(x2)}" y2="${round(y2)}" stroke="${stroke}" stroke-width="${round(width)}" stroke-opacity="${opacity}"/>`;

const text = (x, y, content, { size = 20, spacing = 0, fill = INK, opacity = 1, anchor = 'middle', weight = 400 } = {}) =>
  `<text x="${round(x)}" y="${round(y)}" font-family="Helvetica Neue, Helvetica, Arial, sans-serif" font-size="${round(size)}" font-weight="${weight}" letter-spacing="${round(spacing)}" text-anchor="${anchor}" fill="${fill}" fill-opacity="${opacity}">${esc(content)}</text>`;

/* ------------------------------------------------------------------ *
 * Silhouettes. Each returns { shapes, clip, label } where
 *   shapes  = SVG markup for the pack itself
 *   clip    = a shape id used to mask the single sheen highlight
 *   label   = { x, y, w, h } printable area, or null for a hang-tag
 * ------------------------------------------------------------------ */

function dropperBottle(colors, scale) {
  const w = 210 * scale;
  const h = 340 * scale;
  const x = 400 - w / 2;
  const y = 800 - h;
  const neck = 18 * scale;
  const collarH = 22 * scale;
  const bulbH = 70 * scale;
  const shapes = [
    // dropper tube visible through the glass
    `<rect x="${round(400 - 5)}" y="${round(y + 26)}" width="10" height="${round(h * 0.62)}" fill="${colors.accent}" fill-opacity="0.32"/>`,
    rect(x, y, w, h, 16 * scale, colors.body),
    `<path d="M${round(x + w * 0.28)} ${round(y)} L${round(x + w * 0.36)} ${round(y - neck)} L${round(x + w * 0.64)} ${round(y - neck)} L${round(x + w * 0.72)} ${round(y)} Z" fill="${colors.body}" fill-opacity="0.9"/>`,
    rect(x + w * 0.34, y - neck - collarH, w * 0.32, collarH, 4 * scale, colors.cap),
    rect(x + w * 0.37, y - neck - collarH - bulbH, w * 0.26, bulbH, 12 * scale, colors.capDark),
    ellipse(400, y + h, w * 0.52, 12 * scale, colors.body, 'fill-opacity="0.55"')
  ].join('');
  const clip = `<rect id="clipShape" x="${round(x)}" y="${round(y)}" width="${round(w)}" height="${round(h)}" rx="${round(16 * scale)}"/>`;
  return { shapes, clip, label: { x, y: y + h * 0.16, w, h: h * 0.62 } };
}

function airlessPump(colors, scale) {
  const w = 176 * scale;
  const h = 390 * scale;
  const x = 400 - w / 2;
  const y = 800 - h;
  const shapes = [
    rect(x, y, w, h, 10 * scale, colors.body),
    rect(x + w * 0.18, y - 56 * scale, w * 0.64, 58 * scale, 7 * scale, colors.cap),
    rect(x + w * 0.78, y - 48 * scale, w * 0.34, 16 * scale, 5 * scale, colors.capDark),
    line(x + w * 0.1, y + h * 0.06, x + w * 0.9, y + h * 0.06, IVORY, 1.5, 0.28),
    ellipse(400, y + h, w * 0.56, 12 * scale, colors.body, 'fill-opacity="0.55"')
  ].join('');
  const clip = `<rect id="clipShape" x="${round(x)}" y="${round(y)}" width="${round(w)}" height="${round(h)}" rx="${round(10 * scale)}"/>`;
  return { shapes, clip, label: { x, y: y + h * 0.2, w, h: h * 0.58 } };
}

function tallBottle(colors, scale) {
  const w = 226 * scale;
  const h = 430 * scale;
  const x = 400 - w / 2;
  const y = 800 - h;
  const shapes = [
    rect(x, y, w, h, 24 * scale, colors.body),
    rect(x + w * 0.06, y - 48 * scale, w * 0.88, 50 * scale, 10 * scale, colors.cap),
    rect(x + w * 0.38, y - 62 * scale, w * 0.24, 16 * scale, 4 * scale, colors.capDark),
    line(x + w * 0.08, y + h * 0.74, x + w * 0.92, y + h * 0.74, IVORY, 1.5, 0.2),
    ellipse(400, y + h, w * 0.55, 13 * scale, colors.body, 'fill-opacity="0.55"')
  ].join('');
  const clip = `<rect id="clipShape" x="${round(x)}" y="${round(y)}" width="${round(w)}" height="${round(h)}" rx="${round(24 * scale)}"/>`;
  return { shapes, clip, label: { x, y: y + h * 0.14, w, h: h * 0.56 } };
}

function wideJar(colors, scale) {
  const w = 262 * scale;
  const h = 232 * scale;
  const x = 400 - w / 2;
  const y = 800 - h;
  const shapes = [
    rect(x, y, w, h, 18 * scale, colors.body),
    rect(x - 8 * scale, y - 62 * scale, w + 16 * scale, 66 * scale, 12 * scale, colors.cap),
    line(x - 8 * scale + 12, y - 62 * scale + 12, x + w + 8 * scale - 12, y - 62 * scale + 12, colors.capDark, 2, 0.6),
    ellipse(400, y + h, w * 0.52, 12 * scale, colors.body, 'fill-opacity="0.55"')
  ].join('');
  const clip = `<rect id="clipShape" x="${round(x)}" y="${round(y)}" width="${round(w)}" height="${round(h)}" rx="${round(18 * scale)}"/>`;
  return { shapes, clip, label: { x: x + 14, y: y + h * 0.2, w: w - 28, h: h * 0.56 } };
}

function lipstickBullet(colors, scale) {
  const w = 132 * scale;
  const baseH = 250 * scale;
  const x = 400 - w / 2;
  const baseY = 800 - baseH;
  const tubeH = 78 * scale;
  const bulletTop = baseY - tubeH - 92 * scale;
  const shapes = [
    // bullet
    polygon(
      [
        [x + w * 0.14, baseY - tubeH],
        [x + w * 0.86, baseY - tubeH],
        [x + w * 0.86, bulletTop + 34 * scale],
        [x + w * 0.4, bulletTop]
      ],
      colors.accent
    ),
    rect(x + w * 0.1, baseY - tubeH, w * 0.8, tubeH, 4 * scale, colors.capDark),
    rect(x, baseY, w, baseH, 8 * scale, colors.body),
    line(x + w * 0.5, baseY + 8, x + w * 0.5, baseY + baseH - 8, IVORY, 1, 0.16),
    ellipse(400, 800, w * 0.72, 12 * scale, colors.body, 'fill-opacity="0.5"')
  ].join('');
  const clip = `<rect id="clipShape" x="${round(x)}" y="${round(baseY)}" width="${round(w)}" height="${round(baseH)}" rx="${round(8 * scale)}"/>`;
  return { shapes, clip, label: { x, y: baseY + baseH * 0.18, w, h: baseH * 0.6 } };
}

function compactCase(colors, scale) {
  const w = 268 * scale;
  const h = 300 * scale;
  const x = 400 - w / 2;
  const y = 800 - h;
  const shapes = [
    rect(x, y, w, h, 22 * scale, colors.body),
    rect(x + w * 0.05, y + h * 0.06, w * 0.9, h * 0.88, 16 * scale, colors.bodyDark),
    ellipse(400, y + h * 0.5, w * 0.33, h * 0.33, colors.accent),
    ellipse(400, y + h * 0.5, w * 0.33, h * 0.33, 'none', `stroke="${colors.capDark}" stroke-width="2" stroke-opacity="0.4"`),
    line(x + 4, y + h * 0.5, x + w - 4, y + h * 0.5, IVORY, 1.5, 0.22),
    ellipse(400, y + h, w * 0.5, 12 * scale, colors.body, 'fill-opacity="0.5"')
  ].join('');
  const clip = `<rect id="clipShape" x="${round(x)}" y="${round(y)}" width="${round(w)}" height="${round(h)}" rx="${round(22 * scale)}"/>`;
  return { shapes, clip, label: { x: x + w * 0.08, y: y + h * 0.06, w: w * 0.84, h: h * 0.24 } };
}

function squeezeTube(colors, scale) {
  const w = 150 * scale;
  const h = 400 * scale;
  const x = 400 - w / 2;
  const y = 800 - h;
  const shapes = [
    rect(x, y + 44 * scale, w, h - 44 * scale, 16 * scale, colors.body),
    polygon(
      [
        [x + w * 0.12, y + 46 * scale],
        [x + w * 0.88, y + 46 * scale],
        [x + w * 0.7, y + 10 * scale],
        [x + w * 0.3, y + 10 * scale]
      ],
      colors.bodyDark
    ),
    rect(x + w * 0.26, y - 26 * scale, w * 0.48, 40 * scale, 8 * scale, colors.cap),
    ellipse(400, y + h, w * 0.62, 12 * scale, colors.body, 'fill-opacity="0.5"')
  ].join('');
  const clip = `<rect id="clipShape" x="${round(x)}" y="${round(y + 44 * scale)}" width="${round(w)}" height="${round(h - 44 * scale)}" rx="${round(16 * scale)}"/>`;
  return { shapes, clip, label: { x, y: y + h * 0.34, w, h: h * 0.52 } };
}

function facetedFlacon(colors, scale) {
  const w = 236 * scale;
  const h = 330 * scale;
  const x = 400 - w / 2;
  const y = 800 - h;
  const facetX = x + w * 0.3;
  const facetX2 = x + w * 0.7;
  const capH = 74 * scale;
  const shapes = [
    polygon(
      [
        [x, y + h],
        [x, y + h * 0.26],
        [x + w * 0.22, y + h * 0.06],
        [x + w * 0.78, y + h * 0.06],
        [x + w, y + h * 0.26],
        [x + w, y + h]
      ],
      colors.body
    ),
    polygon(
      [
        [facetX, y + h * 0.06],
        [facetX2, y + h * 0.06],
        [facetX2, y + h],
        [facetX, y + h]
      ],
      colors.accent,
      'fill-opacity="0.5"'
    ),
    line(facetX, y + h * 0.08, facetX, y + h - 6, IVORY, 1.5, 0.3),
    line(facetX2, y + h * 0.08, facetX2, y + h - 6, IVORY, 1.5, 0.3),
    line(x + w * 0.04, y + h * 0.28, x + w * 0.96, y + h * 0.28, IVORY, 1.2, 0.18),
    rect(400 - w * 0.12, y - 18 * scale, w * 0.24, 22 * scale, 4 * scale, colors.capDark),
    rect(400 - w * 0.19, y - 18 * scale - capH, w * 0.38, capH, 6 * scale, colors.cap),
    ellipse(400, y + h, w * 0.54, 13 * scale, colors.body, 'fill-opacity="0.5"')
  ].join('');
  const clip = `<polygon id="clipShape" points="${[
    [x, y + h],
    [x, y + h * 0.26],
    [x + w * 0.22, y + h * 0.06],
    [x + w * 0.78, y + h * 0.06],
    [x + w, y + h * 0.26],
    [x + w, y + h]
  ]
    .map(([px, py]) => `${round(px)},${round(py)}`)
    .join(' ')}"/>`;
  return { shapes, clip, label: { x: x + w * 0.14, y: y + h * 0.36, w: w * 0.72, h: h * 0.5 } };
}

function brushTool(colors, scale) {
  const w = 74 * scale;
  const handleH = 300 * scale;
  const ferruleH = 90 * scale;
  const bristleH = 120 * scale;
  const x = 400 - w / 2;
  const handleY = 800 - handleH;
  const shapes = [
    rect(x, handleY, w, handleH, w * 0.42, colors.body),
    rect(x - 4 * scale, handleY - ferruleH, w + 8 * scale, ferruleH, 8 * scale, colors.cap),
    `<path d="M${round(x - 2 * scale)} ${round(handleY - ferruleH)} L${round(x + w + 2 * scale)} ${round(handleY - ferruleH)} L${round(x + w + 2 * scale)} ${round(handleY - ferruleH - bristleH * 0.45)} Q400 ${round(handleY - ferruleH - bristleH)} ${round(x - 2 * scale)} ${round(handleY - ferruleH - bristleH * 0.45)} Z" fill="${colors.accent}"/>`,
    line(400, handleY + 16, 400, handleY + handleH - 16, IVORY, 1.2, 0.18),
    ellipse(400, 800, w * 1.7, 12 * scale, colors.body, 'fill-opacity="0.45"')
  ].join('');
  const clip = `<rect id="clipShape" x="${round(x)}" y="${round(handleY)}" width="${round(w)}" height="${round(handleH)}" rx="${round(w * 0.42)}"/>`;
  return { shapes, clip, label: null };
}

function rollerTool(colors, scale) {
  const stoneW = 132 * scale;
  const stoneH = 210 * scale;
  const handleW = 44 * scale;
  const handleH = 250 * scale;
  const stoneY = 800 - handleH - stoneH;
  const shapes = [
    `<rect x="${round(400 - handleW / 2)}" y="${round(800 - handleH)}" width="${round(handleW)}" height="${round(handleH)}" rx="${round(handleW / 2)}" fill="${colors.body}"/>`,
    rect(400 - stoneW / 2, stoneY, stoneW, stoneH, stoneW * 0.34, colors.accent),
    ellipse(400, stoneY, stoneW * 0.5, stoneW * 0.16, colors.cap),
    ellipse(400, stoneY + stoneH, stoneW * 0.5, stoneW * 0.16, colors.bodyDark),
    line(400 - stoneW * 0.24, stoneY + 18, 400 - stoneW * 0.24, stoneY + stoneH - 18, IVORY, 1.5, 0.35),
    ellipse(400, 800, stoneW * 0.9, 12 * scale, colors.body, 'fill-opacity="0.45"')
  ].join('');
  const clip = `<rect id="clipShape" x="${round(400 - stoneW / 2)}" y="${round(stoneY)}" width="${round(stoneW)}" height="${round(stoneH)}" rx="${round(stoneW * 0.34)}"/>`;
  return { shapes, clip, label: null };
}

function pouchTool(colors, scale) {
  const w = 300 * scale;
  const h = 260 * scale;
  const x = 400 - w / 2;
  const y = 800 - h;
  const shapes = [
    `<path d="M${round(x + w * 0.1)} ${round(y)} L${round(x + w * 0.9)} ${round(y)} Q${round(x + w)} ${round(y + h * 0.24)} ${round(x + w)} ${round(y + h * 0.72)} Q${round(x + w * 0.86)} ${round(y + h)} ${round(400)} ${round(y + h)} Q${round(x + w * 0.14)} ${round(y + h)} ${round(x)} ${round(y + h * 0.72)} Q${round(x)} ${round(y + h * 0.24)} ${round(x + w * 0.1)} ${round(y)} Z" fill="${colors.body}"/>`,
    line(x + w * 0.14, y + h * 0.16, x + w * 0.86, y + h * 0.16, colors.cap, 6, 0.85),
    rect(400 + w * 0.2, y + h * 0.1, 20 * scale, 26 * scale, 4 * scale, colors.cap),
    ellipse(400, y + h, w * 0.5, 12 * scale, colors.body, 'fill-opacity="0.5"')
  ].join('');
  const clip = `<rect id="clipShape" x="${round(x)}" y="${round(y)}" width="${round(w)}" height="${round(h)}" rx="${round(w * 0.24)}"/>`;
  return { shapes, clip, label: { x: x + w * 0.18, y: y + h * 0.34, w: w * 0.64, h: h * 0.5 } };
}

const BY_CATEGORY = {
  skincare: [dropperBottle, airlessPump],
  haircare: [tallBottle, wideJar],
  makeup: [lipstickBullet, compactCase, squeezeTube],
  perfumes: [facetedFlacon],
  'beauty-accessories': [brushTool, rollerTool, pouchTool]
};

/**
 * Silhouette selection is product-aware first, hash-derived second: a lipstick must never
 * be drawn as a compact, and a masque belongs in a jar rather than a bottle.
 */
const FORM_HINTS = {
  skincare: [
    [/powder|pot|tin|lip mask|lip butter/i, wideJar],
    [/serum|oil|drops|fluid|water|concentrate|peel/i, dropperBottle],
    [/cream|balm|lotion|cleanser|wash|gel|mask|scrub|sun|spf|stick|toner|mist|essence|butter|duo/i, airlessPump]
  ],
  haircare: [
    [/masque|mask|paste|butter|cream/i, wideJar],
    [/shampoo|conditioner|oil|mist|spray|serum|lotion|tonic|treatment/i, tallBottle]
  ],
  makeup: [
    [/lipstick|lip|liner|pencil/i, lipstickBullet],
    [/stick/i, squeezeTube],
    [/powder|blush|bronzer|highlighter|shadow|palette|compact|duo/i, compactCase],
    [/nail lacquer/i, dropperBottle],
    [/spray|mist/i, airlessPump],
    [/mascara|primer|foundation|concealer|tint|gloss|corrector|balm|cream|gel|serum/i, squeezeTube]
  ],
  perfumes: [[/[\s\S]/, facetedFlacon]],
  'beauty-accessories': [
    [/organiser|travel bottle|pouch|case/i, pouchTool],
    [/brush/i, brushTool],
    [/roller|gua sha|stone/i, rollerTool],
    [/tweezer|curler|file|comb/i, rollerTool],
    [/sponge|cloth|bonnet|towel|pillowcase|clip|mirror|pad/i, pouchTool]
  ]
};

const chooseForm = (product, seed) => {
  const hints = FORM_HINTS[product.category] || [];
  const name = product.name.toLowerCase();
  for (const [pattern, form] of hints) {
    if (pattern.test(name)) return form;
  }
  const forms = BY_CATEGORY[product.category] || BY_CATEGORY.skincare;
  return forms[sliceInt(seed, 8, 4) % forms.length];
};

/* ------------------------------------------------------------------ *
 * Colour maths
 * ------------------------------------------------------------------ */
const toRgb = (hexValue) => [1, 3, 5].map((i) => parseInt(hexValue.slice(i, i + 2), 16));
const luminance = (hexValue) => {
  const [r, g, b] = toRgb(hexValue);
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
};
const shade = (hexValue, amount) =>
  '#' +
  toRgb(hexValue)
    .map((channel) => Math.max(0, Math.min(255, Math.round(channel + channel * amount))))
    .map((channel) => channel.toString(16).padStart(2, '0'))
    .join('');

/* ------------------------------------------------------------------ *
 * Copy for the printed label
 * ------------------------------------------------------------------ */
const words = (name) =>
  name
    .replace(/[^a-zA-Z0-9 ]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean);

const CONCENTRATION = /\b(eau de parfum|eau de toilette|edt|edp|extrait de parfum|perfume oil|body mist)\b/gi;

/** Trailing noun phrase of the product name, e.g. "Ceramide Barrier Cream" -> "barrier cream". */
const typePhrase = (name) => {
  const list = words(name.replace(CONCENTRATION, ' '));
  const take = Math.min(2, list.length);
  return list.slice(-take).join(' ').toLowerCase();
};

/** Clamp a line of text to a printable width, using an average glyph advance. */
const fit = (value, width, size, advance = 0.66) => {
  const max = Math.max(4, Math.floor(width / (size * advance)));
  return value.length > max ? value.slice(0, Math.max(2, max - 1)).trim() + '.' : value;
};

/** The most specific size-ish spec we can find, in a fixed order of preference. */
const FORMAT_KEYS = [/^volume/i, /^size/i, /^format/i, /^capacity/i, /^weight/i, /^dimensions/i, /^concentration/i, /^spf/i];

const formatPhrase = (product) => {
  const specs = product.specs || [];
  let value = '';
  for (const pattern of FORMAT_KEYS) {
    const hit = specs.find((spec) => pattern.test(spec.k));
    if (hit) {
      value = hit.v;
      break;
    }
  }
  if (!value && specs[0]) value = specs[0].v;
  const cleaned = String(value || '')
    .replace(CONCENTRATION, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/\|/g, ',')
    .replace(/\s*\d+\s*shades?/i, '')
    .trim();
  return cleaned.length > 34 ? cleaned.slice(0, 33).trim() + '...' : cleaned;
};

/* ------------------------------------------------------------------ *
 * Composition
 * ------------------------------------------------------------------ */
function buildSvg(product, index) {
  const seed = product.slug;
  const scale = 0.88 + (sliceInt(seed, 20, 4) % 26) / 100; // 0.88 - 1.13
  const body = pick(BODY, seed, 0);
  const accent = pick(ACCENT, seed, 6);
  const cap = pick(CAP, seed, 12);

  const colors = {
    body,
    bodyDark: shade(body, -0.28),
    accent,
    cap,
    capDark: shade(cap, -0.3)
  };

  const pack = chooseForm(product, seed)(colors, scale);

  const labelCenter = { x: 400, y: pack.label ? pack.label.y + pack.label.h / 2 : 560 };
  const onDark = luminance(colors.body) < 0.5;
  const inkOnLabel = INK;
  const labelW = pack.label ? Math.min(pack.label.w * 0.86, 250) : 208;
  const labelH = pack.label ? Math.min(pack.label.h * 0.86, 190) : 150;
  const labelX = 400 - labelW / 2;
  const labelY = pack.label ? pack.label.y + (pack.label.h - labelH) / 2 : 486;

  // Type sizes scale with the printable width so nothing overflows a narrow pack.
  const brandSize = Math.max(12, Math.min(21, labelW / 6.2));
  const typeSize = Math.max(9, Math.min(14, labelW / 13.5));
  const formatSize = Math.max(8, Math.min(11.5, labelW / 17));

  const typeLine = fit(typePhrase(product.name), labelW, typeSize);
  const formatLine = fit(formatPhrase(product), labelW, formatSize);
  const categoryLine = CATEGORY_LABEL[product.category] || '';

  const hangTag = pack.label
    ? ''
    : [
        line(400, labelCenter.y - 120, 400, labelY + 6, colors.capDark, 2, 0.7),
        rect(labelX, labelY, labelW, labelH, 6, IVORY, `stroke="${colors.capDark}" stroke-width="1.5" stroke-opacity="0.5"`),
        ellipse(400, labelY + 14, 5, 5, 'none', `stroke="${colors.capDark}" stroke-width="1.5" stroke-opacity="0.7"`)
      ].join('');

  const printedLabel = pack.label
    ? rect(labelX, labelY, labelW, labelH, 4, IVORY, `fill-opacity="${onDark ? 0.94 : 0.9}"`)
    : '';

  const labelBlock = pack.label
    ? [
        printedLabel,
        text(400, labelY + labelH * 0.3, 'VELUNE', { size: brandSize, spacing: brandSize * 0.31, fill: inkOnLabel, weight: 600 }),
        line(labelX + labelW * 0.24, labelY + labelH * 0.38, labelX + labelW * 0.76, labelY + labelH * 0.38, INK, 1, 0.35),
        text(400, labelY + labelH * 0.58, typeLine, { size: typeSize, spacing: typeSize * 0.19, fill: INK_SOFT, weight: 400 }),
        formatLine ? text(400, labelY + labelH * 0.76, formatLine, { size: formatSize, spacing: formatSize * 0.14, fill: INK_SOFT, opacity: 0.8 }) : ''
      ].join('')
    : [
        printedLabel,
        text(400, labelY + labelH * 0.34, 'VELUNE', { size: brandSize, spacing: brandSize * 0.31, fill: inkOnLabel, weight: 600 }),
        line(labelX + labelW * 0.24, labelY + labelH * 0.44, labelX + labelW * 0.76, labelY + labelH * 0.44, INK, 1, 0.35),
        text(400, labelY + labelH * 0.64, typeLine, { size: typeSize, spacing: typeSize * 0.19, fill: INK_SOFT, weight: 400 }),
        formatLine ? text(400, labelY + labelH * 0.82, formatLine, { size: formatSize, spacing: formatSize * 0.14, fill: INK_SOFT, opacity: 0.8 }) : ''
      ].join('');

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 1000" width="800" height="1000" role="img" aria-label="${esc(`${product.name} — VELUNE ${categoryLine}`)}">
  <title>${esc(product.name)}</title>
  <defs>
    <radialGradient id="vignette" cx="50%" cy="42%" r="72%">
      <stop offset="55%" stop-color="#f4efe7" stop-opacity="0"/>
      <stop offset="100%" stop-color="#b7ab97" stop-opacity="0.55"/>
    </radialGradient>
    <linearGradient id="sheen" x1="0" y1="0" x2="1" y2="0.2">
      <stop offset="0%" stop-color="#ffffff" stop-opacity="0.34"/>
      <stop offset="38%" stop-color="#ffffff" stop-opacity="0.07"/>
      <stop offset="62%" stop-color="#ffffff" stop-opacity="0"/>
      <stop offset="100%" stop-color="#ffffff" stop-opacity="0.1"/>
    </linearGradient>
    <linearGradient id="groundFade" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="${colors.body}" stop-opacity="0"/>
      <stop offset="50%" stop-color="${colors.body}" stop-opacity="0.3"/>
      <stop offset="100%" stop-color="${colors.body}" stop-opacity="0"/>
    </linearGradient>
    <filter id="soften" x="-40%" y="-40%" width="180%" height="180%">
      <feGaussianBlur stdDeviation="16"/>
    </filter>
    <clipPath id="packClip">${pack.clip}</clipPath>
  </defs>

  <rect width="800" height="1000" fill="${IVORY}"/>
  <rect width="800" height="1000" fill="url(#vignette)"/>
  <rect x="0" y="806" width="800" height="4" fill="url(#groundFade)"/>
  ${ellipse(400, 806, 210 * scale, 26 * scale, colors.body, 'fill-opacity="0.2" filter="url(#soften)"')}

  <g>
    ${pack.shapes}
    <rect x="0" y="0" width="800" height="1000" fill="url(#sheen)" clip-path="url(#packClip)"/>
  </g>

  ${hangTag}
  ${labelBlock}

  ${text(400, 936, categoryLine.toUpperCase(), { size: 12, spacing: 5.5, fill: INK_SOFT, opacity: 0.6 })}
  ${text(400, 962, `${String(index + 1).padStart(3, '0')} of 200`, { size: 10, spacing: 3, fill: INK_SOFT, opacity: 0.4 })}
</svg>
`;
}

/* ------------------------------------------------------------------ *
 * Write
 * ------------------------------------------------------------------ */
const products = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
fs.mkdirSync(OUT_DIR, { recursive: true });

for (const [index, product] of products.entries()) {
  fs.writeFileSync(path.join(OUT_DIR, `${product.slug}.svg`), buildSvg(product, index), 'utf8');
}

console.log(`Wrote ${products.length} packshots to ${path.relative(ROOT, OUT_DIR)}`);
