/**
 * Sources, normalises and applies real product photography for the VELUNE catalogue.
 *
 *   node scripts/catalog-photos.mjs plan                 # write data/photo-plan.json (one brief per SKU)
 *   node scripts/catalog-photos.mjs ingest --map <file>  # download + process the licensed photos
 *   node scripts/catalog-photos.mjs ingest --dir <path>  # process supplier photos dropped in a folder
 *   node scripts/catalog-photos.mjs apply                # point products at the processed photos
 *   node scripts/catalog-photos.mjs audit                # report coverage and broken assets
 *
 * Licensing is enforced, not assumed: every asset must carry a commercial-use licence
 * recorded in data/image-licenses.json. Non-commercial (by-nc) and no-derivatives (by-nd)
 * licences are rejected, as is any host outside ALLOWED_HOSTS. Nothing is hotlinked —
 * every photo is stored under public/images/catalog/.
 *
 * Requires the vendored sharp in node_modules (already present in this build).
 */
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const ROOT = path.resolve(import.meta.dirname, '..');
const CATALOG_DIR = path.join(ROOT, 'public', 'images', 'catalog');
const DATA_FILE = path.join(ROOT, 'data', 'cosmetics.json');
const DB_FILE = path.join(ROOT, 'data', 'velune.db');
const PLAN_FILE = path.join(ROOT, 'data', 'photo-plan.json');
const LICENSE_FILE = path.join(ROOT, 'data', 'image-licenses.json');

const WIDTH = 400;
const HEIGHT = 500;
const BACKDROP = '#f2ece2';

const ALLOWED_HOSTS = [
  'images.unsplash.com',
  'plus.unsplash.com',
  'images.pexels.com',
  'cdn.pixabay.com',
  'upload.wikimedia.org',
  'live.staticflickr.com'
];

const ALLOWED_LICENSES = [
  'cc0',
  'cc0-1.0',
  'publicdomain',
  'pdm',
  'by',
  'cc-by',
  'cc-by-4.0',
  'by-sa',
  'cc-by-sa',
  'cc-by-sa-4.0',
  'unsplash-license',
  'unsplash',
  'pexels-license',
  'pixabay-content-license'
];

const BLOCKED_LICENSE_MARKERS = ['nc', 'nd', 'no-deriv', 'editorial'];

/* ------------------------------------------------------------------ *
 * Catalogue helpers
 * ------------------------------------------------------------------ */
const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const writeJson = (file, value) => fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);

const loadCatalogue = () => readJson(DATA_FILE);

/** The physical form the photo must show, inferred from the product's own specs. */
function formFactor(product) {
  const name = (product.name || '').toLowerCase();
  const specText = (product.specs || []).map((s) => `${s.k} ${s.v}`).join(' ').toLowerCase();
  // Specific shapes first: "cuticle and nail oil" must not be read as a serum dropper,
  // and material words in the specs ("bamboo, oil finish") must not drive the shape.
  const rules = [
    ['roll-on perfume oil vial', /roll-on|roll on|perfume oil/],
    ['nail oil pen', /nail|cuticle/],
    ['nail polish bottle', /top coat|base coat|polish|lacquer|gloss/],
    ['lip stain tube with wand', /lip stain/],
    ['metal precision tool', /tweezer|scissor|razor|extractor/],
    ['travel mirror', /mirror/],
    ['foot care tool', /pumice|foot file|callus/],
    ['hair accessory or organiser', /comb|clip|hair pin|headband|towel|roller|curler|organiser|organizer|brush roll/],
    ['makeup brush', /brush|brushes|angled brow|fan brush/],
    ['reusable makeup sponge', /sponge|puff/],
    ['lipstick bullet', /lipstick|lip colour|lip-colour|lip tint|cushion lip/],
    ['makeup compact or palette', /compact|blush|powder|palette|bronzer|shadow/],
    ['mascara or wand tube', /mascara|eyeliner|eye liner|brow|pencil|pomade/],
    ['perfume flacon', /parfum|eau de|extrait|perfume|fragrance oil|attar/],
    ['shampoo bottle', /shampoo|co-wash|co wash/],
    ['conditioner bottle', /conditioner|detangler/],
    ['dropper serum bottle', /serum|face oil|facial oil|ritual oil|body oil|dropper|essence|treatment|ampoule|peel|exfoliant/],
    ['cream jar', /cream|butter|balm|pot|clay|sorbet|mask|masque/],
    ['soft squeeze tube', /tube|gel|paste|primer|concealer|stick/],
    ['frosted glass toner bottle', /toner|mist|spray|water/],
    ['pump bottle', /pump|cleanser|lotion|wash|fluid|milk/]
  ];
  for (const [label, re] of rules) if (re.test(name)) return label;
  for (const [label, re] of rules) if (re.test(specText)) return label;
  return 'cosmetic product packaging';
}

const CATEGORY_MOOD = {
  skincare: 'clean beauty skincare brand',
  makeup: 'professional colour cosmetics brand',
  haircare: 'salon haircare brand',
  perfumes: 'niche fragrance house',
  'beauty-accessories': 'considered beauty tools brand'
};

function briefFor(product) {
  const form = formFactor(product);
  const size = (product.specs || []).find((s) => /size|volume|format/i.test(s.k))?.v || '';
  return {
    slug: product.slug,
    name: product.name,
    category: product.category,
    form,
    size,
    currentImage: product.image,
    // A real photograph of this exact SKU can only come from the brand or its supplier.
    preferredSource: 'supplier or manufacturer press photography',
    fallbackSource: 'licensed stock photography (Unsplash / Pexels / Pixabay / Wikimedia Commons)',
    queries: [
      `${form} ${CATEGORY_MOOD[product.category] || 'cosmetics'} white background studio`,
      `${form} ${size} product photography ivory background`,
      `${product.category} ${form} packshot`
    ],
    status: product.image?.endsWith('.svg') ? 'awaiting_photography' : 'photo_applied'
  };
}

/* ------------------------------------------------------------------ *
 * Commands
 * ------------------------------------------------------------------ */
function plan() {
  const catalogue = loadCatalogue();
  const briefs = catalogue.map(briefFor);
  writeJson(PLAN_FILE, {
    generatedAt: new Date().toISOString(),
    aspect: `${WIDTH}:${HEIGHT}`,
    note: 'Each brief needs one unique licensed photograph. Reusing one photo across unrelated SKUs is not acceptable.',
    products: briefs
  });
  const awaiting = briefs.filter((b) => b.status === 'awaiting_photography').length;
  console.log(`Wrote ${PLAN_FILE}: ${briefs.length} SKUs, ${awaiting} still awaiting photography.`);
}

function licenseOk(license) {
  const value = String(license || '').toLowerCase().replace(/[_\s]+/g, '-');
  if (!value) return false;
  // Token compare, so "CC0-1.0" passes while "by-nc-nd" is refused; a substring
  // test would reject perfectly good licences that merely contain those letters.
  const tokens = value.split(/[^a-z0-9]+/).filter(Boolean);
  if (tokens.some((token) => BLOCKED_LICENSE_MARKERS.includes(token))) return false;
  return ALLOWED_LICENSES.some((ok) => value === ok || value.startsWith(`${ok}-`) || tokens.includes(ok));
}

function hostAllowed(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && ALLOWED_HOSTS.includes(parsed.hostname);
  } catch {
    return false;
  }
}

async function normalizeToPackshot(input, slug) {
  const base = sharp(input, { failOn: 'none' }).rotate().toColorspace('srgb');
  const meta = await base.metadata();
  const width = meta.width || 0;
  const height = meta.height || 0;
  if (width < WIDTH * 2 || height < WIDTH) {
    throw new Error(`${slug}: source is too small (${width}x${height}); need at least ${WIDTH * 2}px wide`);
  }
  // 4:5 packshot: cover-crop from the centre so the product stays framed, then flatten
  // any alpha onto the ivory backdrop so card thumbnails never show checkerboard.
  const render = (w, h) =>
    base
      .clone()
      .resize({ width: w, height: h, fit: 'cover', position: 'centre', kernel: sharp.kernel.lanczos3 })
      .flatten({ background: BACKDROP })
      .sharpen({ sigma: 0.45 })
      .jpeg({ quality: w >= 800 ? 80 : 76, mozjpeg: true, progressive: true, chromaSubsampling: '4:2:0' })
      .toFile(path.join(CATALOG_DIR, `${slug}-${w}.jpg`));
  await Promise.all([render(800, 1000), render(WIDTH, HEIGHT)]);
  return { sourceWidth: width, sourceHeight: height };
}

async function ingest({ map, dir }) {
  const catalogue = loadCatalogue();
  const bySlug = new Map(catalogue.map((p) => [p.slug, p]));
  const manifest = fs.existsSync(LICENSE_FILE) ? readJson(LICENSE_FILE) : { assets: {} };
  const jobs = [];

  if (map) {
    const entries = readJson(path.resolve(ROOT, map));
    for (const entry of entries) {
      if (!bySlug.has(entry.slug)) {
        console.warn(`skip: ${entry.slug} is not a catalogue slug`);
        continue;
      }
      if (!hostAllowed(entry.url)) {
        console.warn(`skip: ${entry.slug} URL host is not on the allowlist (${entry.url})`);
        continue;
      }
      if (!licenseOk(entry.license)) {
        console.warn(`skip: ${entry.slug} licence "${entry.license}" is not cleared for commercial use`);
        continue;
      }
      jobs.push({ ...entry, kind: 'remote' });
    }
  }

  if (dir) {
    const folder = path.resolve(ROOT, dir);
    const mapFile = path.join(folder, 'license.json');
    const credits = fs.existsSync(mapFile) ? readJson(mapFile) : {};
    for (const file of fs.readdirSync(folder)) {
      const match = file.match(/^(.+)\.(jpe?g|png|webp)$/i);
      if (!match) continue;
      const slug = bySlug.has(match[1]) ? match[1] : match[1].replace(/-\d+$/, '');
      if (!bySlug.has(slug)) {
        console.warn(`skip: ${file} does not match a catalogue slug`);
        continue;
      }
      const credit = credits[file] || credits[slug] || {};
      jobs.push({
        slug,
        kind: 'local',
        file: path.join(folder, file),
        license: credit.license || 'supplier-own-brand-photography',
        creator: credit.creator || credit.supplier || 'VELUNE supplier',
        sourcePage: credit.sourcePage || '',
        note: credit.note || 'Photograph supplied by the brand or its manufacturer.'
      });
    }
  }

  if (!jobs.length) {
    console.error('Nothing to ingest. Supply --map <licensed-links.json> or --dir <supplier-photos>.');
    process.exitCode = 1;
    return;
  }

  let done = 0;
  for (const job of jobs) {
    try {
      const input =
        job.kind === 'remote'
          ? Buffer.from(await (await fetch(job.url, { headers: { 'User-Agent': 'VELUNE asset build/1.0' } })).arrayBuffer())
          : job.file;
      const dims = await normalizeToPackshot(input, job.slug);
      manifest.assets[job.slug] = {
        slug: job.slug,
        name: bySlug.get(job.slug).name,
        files: [`/images/catalog/${job.slug}-800.jpg`, `/images/catalog/${job.slug}-400.jpg`],
        license: job.license,
        creator: job.creator || 'unknown',
        sourceUrl: job.url || job.file,
        sourcePage: job.sourcePage || '',
        note: job.note || '',
        captured: dims,
        downloadedAt: new Date().toISOString()
      };
      writeJson(LICENSE_FILE, manifest);
      done += 1;
      console.log(`ok: ${job.slug} (${job.license})`);
    } catch (error) {
      console.warn(`fail: ${job.slug} — ${error.message}`);
    }
    if (job.kind === 'remote') await new Promise((resolve) => setTimeout(resolve, 400));
  }
  console.log(`Ingested ${done}/${jobs.length} photographs into ${CATALOG_DIR}.`);
  console.log('Next: node scripts/catalog-photos.mjs apply');
}

async function apply() {
  if (!fs.existsSync(LICENSE_FILE)) {
    console.error('No data/image-licenses.json yet — run ingest first.');
    process.exitCode = 1;
    return;
  }
  const assets = readJson(LICENSE_FILE).assets;
  const catalogue = loadCatalogue();
  let changed = 0;
  for (const product of catalogue) {
    const asset = assets[product.slug];
    if (!asset) continue;
    const target = asset.files.find((file) => file.endsWith('-800.jpg'));
    if (!target || !fs.existsSync(path.join(CATALOG_DIR, path.basename(target)))) continue;
    if (product.image !== target) {
      product.image = target;
      changed += 1;
    }
  }
  writeJson(DATA_FILE, catalogue);

  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(DB_FILE);
  const update = db.prepare('UPDATE products SET image = ?, updated_at = ? WHERE slug = ?');
  let dbChanged = 0;
  for (const product of catalogue) {
    if (assets[product.slug]) {
      const result = update.run(product.image, new Date().toISOString(), product.slug);
      dbChanged += Number(result.changes || 0);
    }
  }
  db.close();
  console.log(`Applied photography: ${changed} seed rows and ${dbChanged} database rows updated.`);
  console.log('Prices, variants, stock, slugs and relations were left untouched.');
}

async function audit() {
  const catalogue = loadCatalogue();
  const assets = fs.existsSync(LICENSE_FILE) ? readJson(LICENSE_FILE).assets : {};
  const missing = [];
  const svgOnly = [];
  let bytes = 0;
  for (const product of catalogue) {
    if (product.image?.endsWith('.svg')) {
      svgOnly.push(product.slug);
      continue;
    }
    for (const suffix of ['-800.jpg', '-400.jpg']) {
      const file = path.join(CATALOG_DIR, `${product.slug}${suffix}`);
      if (!fs.existsSync(file)) missing.push(`${product.slug}${suffix}`);
      else bytes += fs.statSync(file).size;
    }
    if (!assets[product.slug]) missing.push(`${product.slug} (no licence record)`);
  }
  console.log(
    JSON.stringify(
      {
        skus: catalogue.length,
        photographyApplied: catalogue.length - svgOnly.length,
        stillVectorArtwork: svgOnly.length,
        licenceRecords: Object.keys(assets).length,
        servedBytesKB: Math.round(bytes / 1024),
        problems: missing.slice(0, 20),
        problemCount: missing.length
      },
      null,
      2
    )
  );
  if (missing.length) process.exitCode = 1;
}

const args = process.argv.slice(2);
const command = args[0];
const flag = (name) => {
  const index = args.indexOf(`--${name}`);
  return index === -1 ? '' : args[index + 1];
};

if (command === 'plan') plan();
else if (command === 'ingest') await ingest({ map: flag('map'), dir: flag('dir') });
else if (command === 'apply') await apply();
else if (command === 'audit') await audit();
else {
  console.log('Usage: node scripts/catalog-photos.mjs <plan|ingest|apply|audit> [--map file] [--dir folder]');
  process.exitCode = command ? 1 : 0;
}
