# VELUNE

A complete cosmetics storefront and operations platform: 200 curated products, customer accounts with email/mobile verification and identity review, independent reseller storefronts, live support chat, order and inventory management, profit reporting, and real sales-channel connectors for Shopify, WooCommerce and a generic supplier API.

Built as a **zero-runtime-dependency Node.js application** — no framework and no build step. Data lives in **SQLite** through Node's built-in `node:sqlite`. `npm install` is only needed for the photo tooling and the test fixture generator (`sharp`, a dev dependency).

Brand direction: warm ivory, ink, forest and brass; Fraunces display type with Inter for interface text; compact product cards rather than oversized marketplace tiles.

---

## Quick start

Requirements: **Node.js 22.13 or newer**; this build is tested on **Node 24.18** on Windows. `node:sqlite` is required.

```bash
npm start
# or, to load a local .env file
npm run start:env
```

Open:

- Storefront — <http://localhost:3000>
- Shop — <http://localhost:3000/shop>
- Checkout — <http://localhost:3000/checkout>
- Account — <http://localhost:3000/account>
- Contact & support — <http://localhost:3000/contact>
- Order tracking — <http://localhost:3000/order>
- Admin — <http://localhost:3000/admin>

On a brand-new database with no admin password in the environment, the server generates a **one-time admin password**, stores only its scrypt hash, and prints the password once at startup. Set `ADMIN_PASSWORD_HASH` (preferred) or `ADMIN_PASSWORD` for a fixed password. The default username is `admin`.

```bash
ADMIN_USERNAME="admin" \
ADMIN_PASSWORD="your-strong-password" \
ADMIN_SECRET="a-long-random-secret" \
SESSION_SECRET="another-long-random-secret" \
SITE_URL="https://your-domain.example" \
node server.js
```

On Windows PowerShell:

```powershell
$env:ADMIN_USERNAME="admin"; $env:ADMIN_PASSWORD="your-strong-password"; $env:ADMIN_SECRET="a-long-random-secret"; $env:SESSION_SECRET="another-long-random-secret"; $env:SITE_URL="https://your-domain.example"; node server.js
```

If `node` is not on PATH in the Qoder desktop shell, the workspace can run with the bundled runtime:

```bash
ELECTRON_RUN_AS_NODE=1 "C:/Users/margalla/AppData/Local/Programs/Qoder/Qoder.exe" server.js
```

The server binds to `0.0.0.0:3000` by default and prints the admin username and password source on startup.

---

## Configuration

Copy `.env.example` to `.env` and run `npm run start:env`. **Never commit the filled-in file.** Core variables:

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3000` | HTTP port |
| `HOST` | `0.0.0.0` | Bind address |
| `NODE_ENV` | development | `production` enables request logging, suppresses development warnings, and turns on HSTS |
| `TRUST_PROXY` | `false` | Set to `true` only behind a trusted reverse proxy so rate limits and secure cookies use `X-Forwarded-For` / `X-Forwarded-Proto` |
| `SITE_URL` | request origin | Absolute public origin for canonical tags, emails, sitemap and same-origin checks |
| `DATA_DIR` | `<app>/data` | Persistent root for the database, private files and the integrations key. Point this at a mounted volume in production |
| `UPLOADS_DIR` | `public/images/uploads` | Admin-uploaded product images. Point this at a mounted volume in production |
| `STORE_DB_PATH` | `$DATA_DIR/velune.db` | SQLite database location; overrides `DATA_DIR` for the database file only |
| `ADMIN_USERNAME` | `admin` | Administrator username |
| `ADMIN_PASSWORD` | — | Plain-text admin password checked at login, never stored |
| `ADMIN_PASSWORD_HASH` | stored hash | `scrypt$salt$hash`; preferred over the plain-text variable |
| `ADMIN_SECRET` | random per process | HMAC key for admin tokens (12-hour sessions). Set it in production or restarts invalidate sessions |
| `SESSION_SECRET` | generated once into SQLite | HMAC key for customer cookies. Set it in production and keep it private |
| `DEFAULT_BASE_COST` | `46` | Fallback supplier cost for new/imported products |
| `DEFAULT_PROFIT` | `6` | Fallback margin for new/imported products |
| `INTEGRATIONS_SECRET` | key file | AES-256-GCM key material for sales-channel credentials. Without it a 32-byte key is created at `data/private/integrations.key` |
| `RATE_LIMIT_DISABLED` | unset | Test-only; **never enable in production** |

Verification and OTP delivery:

| Variable | Purpose |
| --- | --- |
| `OTP_EMAIL_ENABLED`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USERNAME`, `SMTP_PASSWORD`, `SMTP_FROM`, `SMTP_EHLO_HOST` | Real SMTP delivery for email verification codes |
| `OTP_SMS_ENABLED`, `SMS_PROVIDER`, `SMS_FROM` | SMS delivery. `SMS_PROVIDER=twilio` uses `TWILIO_ACCOUNT_SID` + `TWILIO_AUTH_TOKEN`; `msg91` uses `MSG91_AUTH_KEY` + `MSG91_ROUTE`; a custom gateway can use `SMS_WEBHOOK_URL` |
| `OTP_ENFORCE` | `true` makes verification mandatory even while no live provider exists; codes land in **Admin → Delivery** for manual relay |
| `OTP_DEV_ECHO` | `true` returns outbox-mode codes in the API response. Development only |

When no live provider is configured and `OTP_ENFORCE` is false, accounts are not gated: retail checkout and reseller tools stay open. Every attempted message is still recorded in the delivery outbox.

> The server itself is HTTP. Terminate TLS at a reverse proxy (Railway, Caddy, nginx, Cloudflare or your host) and set `NODE_ENV=production` and `TRUST_PROXY=true`. The app then emits HSTS, marks session cookies `Secure`, and rate-limits per real client IP.

Support channels start with `support@velune.store`; WhatsApp and Telegram stay hidden until configured under **Admin → Settings**. The same screen controls support hours, response wording and the announcement bar.

---

## What is included

### Storefront and catalogue

- 200 distinct cosmetics across five categories, each with description, photograph (or an explicit photo-pending state), stock, details/specs and variants where relevant.
- Admin catalogue management: create, edit, delete, image upload (JPEG/PNG/WebP, magic-byte checked, 5 MB cap), variants and stock.
- Home page with editorial hero, category tiles, new arrivals and material story; category rails update from admin data.
- Shop page with category chips, price filter, sorting, live result counts and empty states.
- Search overlay across names, categories and descriptions.
- Product pages with variants, sale prices, stock states, accordions, related products and a sticky add-to-bag bar.
- Cart drawer in `localStorage` (`velune.cart.v1`) with quantity controls, free-shipping progress and quick-add.
- Cash-on-delivery checkout with US and India address validation, standard/express delivery, promo codes and server-calculated totals.
- Signed-in checkout prefills contact details and links the order to the account. Order history shows only orders explicitly linked while signed in — never guest orders matched by an unverified email.
- Private order access token, plus lookup by order number + email.
- Policies, 404, favicon, self-hosted fonts and responsive imagery.
- WhatsApp confirmation link when a WhatsApp number is configured.

### Accounts, verification and privacy

- Register, sign in, sign out, restore session, update profile and avatar, change password and revoke other sessions.
- Passwords hashed with scrypt and per-user salts; signed, expiring, HttpOnly, SameSite=Lax cookies. Password changes bump a session version and invalidate other devices.
- **Email and mobile verification** with 6-digit OTPs, 10-minute expiry, attempt caps, resend throttling and outbox logging.
- **Identity review (KYC)**: upload Aadhaar, passport, driving licence or voter ID. Only a document type and a private stored filename are kept in the database; previews stream through guarded endpoints to the owner or an authorized administrator.
- Documents live outside the public web root (`data/private/documents`), are never returned in profile JSON, and are accepted only in PDF/JPEG/PNG/WebP with size and magic-byte checks.
- When verification is enforced, retail checkout requires verified email + mobile, and reseller features require an accepted identity document. Changing a verified mobile/email re-locks the account until the new value is proven.
- Admin review can accept, reject with a reason, or approve an account; the customer sees the current status and next steps on the account page.
- **Aadhaar is handled as a manually reviewed identity document, not through the UIDAI API.** Confirm your legal basis, consent wording and retention obligations before collecting it. The default retention setting is 180 days and is configurable in admin settings.

### Reseller storefronts (dropshipping)

- Verified customers can register one store with a public slug, tagline and support contact; slugs are validated, reserved words are blocked, and the owner is never exposed publicly.
- Import catalogue items with a reseller price, quantity and publication state. A price floor and available stock are enforced server-side; reserved units are deducted from the catalogue.
- Workflow: **draft → pending → approved / rejected → suspended**. Editing a submitted store returns it to draft; publishing is blocked until an administrator approves it.
- Each approved store has a public page at `/store/:slug` and a public API at `/api/stores/:slug`, hidden immediately when the store is rejected, suspended, or its owner fails verification.
- Public store orders are cash on delivery, priced entirely on the server, idempotent, and decrement **reseller** inventory rather than the main catalogue. Cancellation restocks the reseller quantity.
- Owners see their store orders in the account area; administrators can review, approve, reject and suspend stores with notes.

### Live support chat

- Guest or signed-in chat, with conversation history stored in SQLite.
- Real-time delivery over Server-Sent Events to both the customer widget and the admin desk, using short-lived single-use stream tickets.
- Typing indicators, unread counters, read receipts, attachments, order references, admin notes and conversation assignment.
- Admin can reply, resolve/reopen, moderate messages and review history. Messages survive restarts.
- Contact form and chat create support tickets that appear in the admin queue.

### Admin dashboard (`/admin`)

- Username + password login (scrypt, timing-safe); HMAC-signed bearer token valid for 12 hours.
- **Overview**: revenue/orders/AOV, counts, low stock, open conversations/tickets, subscribers and recent orders.
- **Orders**: search, filters, detail modal, status timeline, tracking, cancellation with restock, profit per order.
- **Products** and **inventory**: catalogue CRUD, image upload, categories, stock adjustments.
- **Customers** and **Verification**: account list, order counts, lifetime value, identity document review and account status decisions.
- **Live Chat** and **Support**: real-time desk, ticket management, assignment and notes.
- **Stores**: approve, reject and suspend reseller storefronts.
- **Integrations**: connect Shopify, WooCommerce or a supplier API; test, import, export, sync stock, push orders and inspect the job log.
- **Reports**: revenue, discounts, costs, gross margin by product and period, using the cost snapshot stored with each order.
- **Delivery**: OTP/outbox log, message status and manual relay while no provider is connected.
- **Support team**: create employee accounts with server-enforced permission scopes (chat, tickets, upload, products, inventory, customers/verification, reports).
- **Settings**: support channels, KYC policy, storefront messaging and categories.
- **Subscribers**: searchable newsletter list.
- Responsive off-canvas navigation and mobile-friendly modals.

### Sales-channel integrations

The admin **Integrations** screen manages real HTTP connectors. Credentials are encrypted with AES-256-GCM before being stored in SQLite; the API never returns secrets, and error messages and job logs scrub them. Requests are limited to `http(s)`, do not follow redirects, time out after 15 seconds and cap response bodies at 2 MB.

- **Shopify** — test the shop, import products and variants, create/update products, push price and stock to a chosen location, create orders. Uses the Admin REST API (`/admin/api/:version`) and the `*.myshopify.com` domain.
- **WooCommerce** — test the REST route, import products, create/update products with SKU matching, push price and stock, create cash-on-delivery orders.
- **Supplier API** — configurable base URL, auth header/prefix, products path, orders path and stock path; flexible import mapping and a normalized order payload.

Every action is recorded in a job log with status, message and detail. Imported products are linked by external ID/SKU; exports reuse those links, and pushed orders are deduplicated per channel so a retry does not create a second remote order. Deleting a channel removes its links and job history but keeps local products and orders.

These adapters are implemented and exercised against a local mock provider in the automated tests. They are **not** certified by Shopify, WooCommerce or any supplier, and have not been tested against a live merchant account or with real credentials.

### SEO, security and operations

- Server-rendered titles, descriptions, canonicals, Open Graph, robots and JSON-LD (`Product`, `Offer`, `AggregateRating`, `BreadcrumbList`), plus dynamic `sitemap.xml` and `robots.txt`.
- CSP, `X-Frame-Options: DENY`, `nosniff`, strict referrer policy, Permissions Policy and COOP headers.
- Origin checks on state-changing API requests; per-IP rate limits on login, registration, OTP, password changes, orders, lookup, promo checks, tickets, newsletter and chat.
- JSON content-type enforcement, request-size caps, input clamping, HTML escaping and path-traversal protection.
- Server-side price, stock and promo recalculation; idempotency keys prevent duplicate orders and duplicate remote pushes.
- Client data isolation: order history, store data, inventory, documents and verification state are scoped to the authenticated customer; employee permissions are enforced on the server, not in the UI.
- No card data is collected, transmitted or stored. Checkout is cash on delivery.

---

## Pricing, promos and shipping

- Default supplier cost **$46**, profit **$6**, selling price **$52**. Costs and margins are editable per product in admin; `resolvePricing` supports fixed price or formula mode.
- Costs are stripped from public product and order payloads and are admin-only.
- Each order stores a `unitCost` snapshot, so later repricing never rewrites historical profit.

| Code | Effect |
| --- | --- |
| `WELCOME10` | 10% off merchandise |
| `FREESHIP` | Free standard shipping (express stays $18) |

Shipping: standard **$8** (free on merchandise of **$150+** after discounts), express **$18**. Tax is currently a $0 line — no tax engine is connected. India orders validate state and 6-digit PIN; US orders validate state and ZIP.

---

## Project structure

```
server.js                 HTTP server, APIs, SSR, security, persistence
store.js                  SQLite schema, migrations, row mappers, write helpers
notify.js                 SMTP, Twilio, MSG91 and webhook delivery + outbox
integrations.js           Shopify / WooCommerce / supplier adapters and secret sealing
package.json              zero-dependency scripts (start, dev, test, check)
data/cosmetics.json       200-product catalogue source
data/seed.json            legacy seed used only when no legacy db.json exists
data/velune.db            live SQLite database (created on first run; ignored by git)
data/private/documents/   uploaded identity documents (never served publicly)
data/private/profiles/    customer avatars
data/private/integrations.key  fallback channel-credential key
views/                    HTML templates with token replacement and partials
public/css/               storefront + admin design systems
public/js/                app shell, shop, product, checkout, account, chat, admin
public/images/            product and editorial imagery
public/images/uploads/    admin-uploaded product images (default; override with UPLOADS_DIR)
public/fonts/             self-hosted Fraunces + Inter woff2 files
tests/                    Node test-runner suites (64 tests, 11 files)
scripts/                  catalogue and artwork builders
```

Pages are rendered from `views/` using `<!--@header-->` / `<!--@footer-->` partial includes and `{{TOKEN}}` replacements. Product pages are server-rendered so pricing and stock exist before JavaScript runs.

---

## Data, migration and backup

SQLite is the source of truth. By default it lives at `data/velune.db`; set `DATA_DIR` (and optionally `STORE_DB_PATH`) to move the database, `data/private/` and the fallback integration key onto a persistent volume. `UPLOADS_DIR` moves customer- and admin-uploaded images separately. The SQLite connection runs in WAL mode with foreign keys and a 5-second busy timeout. On first start:

1. If a legacy `data/db.json` exists, it is imported once and marked in the `meta` table; later starts ignore it.
2. Otherwise `data/seed.json` seeds the base store.
3. `data/cosmetics.json` upserts the 200-product cosmetics catalogue by slug.
4. Legacy non-cosmetics products are pruned once.

Orders, customers, staff, stores, inventory, chat, tickets, subscribers, verification documents, outbox messages, integrations, links and job logs are all persisted and survive restarts. Uploaded images are served from `UPLOADS_DIR`, so setting it to a mounted disk keeps them after a redeploy. `GET /api/health` reports `database`, `uploads` and `privateFiles` checks and returns 503 if the database query fails or either directory is not writable.

Back up by stopping the server (or pausing the Railway service) and copying:

- the database **and** its `-wal` / `-shm` sidecars (`$STORE_DB_PATH`, `$STORE_DB_PATH-wal`, `$STORE_DB_PATH-shm`) — or run `sqlite3 "$STORE_DB_PATH" ".backup 'backup.db'"` for a consistent snapshot,
- `$DATA_DIR/private/` (documents, avatars, integration key),
- `$UPLOADS_DIR/`.

Restore by putting those files back at the same paths and starting the server. Keep the same `INTEGRATIONS_SECRET` (or the same `integrations.key`) or saved channel credentials will no longer decrypt.

Treat the database, private directory and `.env` as secrets. They contain password hashes, session material, identity documents and encrypted credentials. They are already listed in `.gitignore`.

To reset the store: stop the server, remove the database files, and optionally the private directory and uploads, then start again. Seeding is automatic; a new one-time admin password is printed if no env password is set.

This is a single-instance SQLite deployment. Run exactly one replica. Before multi-instance or high-traffic production use, move to a managed database and object storage, and add scheduled off-site backups.

### Deploying to Railway

1. Push this repository to GitHub and create a Railway service from it. Railway detects Node via `package.json`; the start command is `npm start` (`node server.js`).
2. **Add a volume and mount it at `/data`.**
   Railway → your service → **Variables** or **Volumes** → **New Volume** → mount path `/data`. Use one volume; do not mount it under `/app` or `public/`, which are replaced on each deploy.
3. Set these variables:

   ```text
   NODE_ENV=production
   TRUST_PROXY=true
   SITE_URL=https://your-domain.example
   DATA_DIR=/data
   UPLOADS_DIR=/data/uploads
   STORE_DB_PATH=/data/velune.db
   ADMIN_USERNAME=admin
   ADMIN_PASSWORD_HASH=scrypt$...        # or ADMIN_PASSWORD for the first boot
   ADMIN_SECRET=<64 hex chars>
   SESSION_SECRET=<64 hex chars>
   INTEGRATIONS_SECRET=<64 hex chars>
   ```

   Generate secrets with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.
   Railway injects `PORT`; the server reads it, so do not override it.
4. Attach the custom domain and let Railway terminate TLS. Keep `TRUST_PROXY=true` so cookies get `Secure`, HSTS is sent and rate limits use the client IP rather than Railway's proxy.
5. Deploy, then open `GET /api/health` on the public domain and confirm `ok: true` and all three checks. The directory creation for `/data`, `/data/private` and `/data/uploads` happens at boot.
6. Redeploy once and confirm the database, admin password and uploaded images are still present — that proves the volume is mounted correctly.

The optional Redis/database add-ons are not required. Do not run more than one instance against the same SQLite file.

#### Moving an existing store onto the volume

The database, `data/private/` and `public/images/uploads/` are gitignored, so a fresh deployment will not include them. If this is not a brand-new store:

1. Stop the local server. Make a consistent copy of the database with `sqlite3 data/velune.db ".backup 'velune-backup.db'"`, then copy `data/private/` and `public/images/uploads/` into a staging folder.
2. Install and link the Railway CLI (`npm i -g @railway/cli`, then `railway link`).
3. Upload into the mounted volume with `railway volume browse` (interactive, keeps folders) or `railway volume files --volume <volume-name> upload <local-file> <remote-path>` for individual files. Files placed at the volume root appear under `/data`, so the database goes to `/data/velune.db`, private files to `/data/private/`, and uploads to `/data/uploads/`.
4. Restart the service, open `/api/health`, and sign in with the existing admin account plus one existing customer account.
5. Keep the local copy until you have verified the restore; treat it as the rollback.

If the volume picker in your CLI version has different path semantics, run `railway volume files --help` rather than guessing.

---

## Product imagery

The storefront shows **photographs only**. A product either points at a raster photo (`.jpg`, `.jpeg`, `.png`, `.webp`, `.avif`) or at nothing; there is no illustrated substitute in the customer-facing catalogue.

- `<slug>-800.jpg` + `<slug>-400.jpg` — real 4:5 photography under `public/images/catalog/`, produced by `scripts/catalog-photos.mjs`. `cardImageFor()` serves the 400px pair to cards, search results and reseller storefronts and the 800px pair to the product page.
- Admin uploads under `UPLOADS_DIR` (by default `public/images/uploads/`) are the only other accepted source.
- The legacy deterministic vector packshots (`<slug>.svg`, from `scripts/generate-catalog-artwork.mjs`) remain on disk but are **hidden from customers**. `photoPathFor()` in `server.js` treats any `.svg` path as missing, so a product whose database row still references one renders as photo-pending. The database rows and IDs are untouched.

When a product has no photograph:

- `GET /api/products` returns `image: ''`, `cardImage: ''`, and `photoRequired: true`.
- Cards and the product page render a neutral cream panel reading **Photo coming soon** with a "Studio photography" eyebrow — no bottle outline, no fake packshot.
- The admin product list badges each row **Photo required**, and the edit form hides any legacy vector preview with a note to upload a real photograph.
- `public/js/img-fallback.js` swaps a broken image for the same neutral placeholder, never a drawing.

`scripts/catalog-photos.mjs` (also `npm run photos:plan|ingest|apply|audit`):

1. `plan` reads each product's name and Size spec to infer the physical form (pump bottle, dropper, jar, flacon, compact, wand tube, brush, tool) and writes `data/photo-plan.json` — one sourcing brief per SKU.
2. `ingest --dir <folder>` processes supplier or manufacturer photographs dropped in as `<slug>.jpg`, or `ingest --map <links.json>` downloads from an allowlist of licensed hosts (`images.unsplash.com`, `images.pexels.com`, `cdn.pixabay.com`, `upload.wikimedia.org`, `live.staticflickr.com`). Each entry must state its licence; `by-nc` and `by-nd` terms are refused, because this is a commercial storefront and the crops are derivatives. Output is 800×1000 and 400×500, sRGB, mozjpeg progressive, stripped of metadata.
3. `apply` points the product at `<slug>-800.jpg` in **both** `data/cosmetics.json` and `data/velune.db`, so the catalogue seed and the live database agree. The one-time bootstrap upsert refreshes copy, price and stock but preserves an existing image that differs from the catalogue file, so a restart cannot revert an owner upload.
4. `audit` reports applied-vs-vector coverage, missing 400/800 pairs, missing licence records and total served bytes. It exits non-zero on any problem.

Licensing is recorded per asset in `data/image-licenses.json` (slug, file pair, licence, creator, source URL, download time) — that file is the audit trail for what may be shown in the store. Keep the source page for any `CC-BY` asset so the credit can be published.

Broken images degrade rather than disappearing: `public/js/img-fallback.js` listens for image errors in the capture phase (CSP is `script-src 'self'`, so no inline `onerror` handler is available), swaps to the element's `data-fallback-src`, and only then to a neutral "PHOTO COMING SOON" placeholder. It runs on storefront cards, the product page, search, cart, checkout, reseller storefronts and the admin product list.

### Replacing a product image (admin)

Open **Admin → Products → Edit**, choose a JPEG, PNG or WebP up to 5 MB in **Image**, wait for the preview, then **Save**. The storefront reads the image path from SQLite on every request, so the new image appears on the next load — including after a restart or redeploy, provided `UPLOADS_DIR` is on the persistent volume.

- **MIME is decided from the file bytes, not the browser's label.** Android browsers often send an empty type or `image/jpg`, and rename HEIC files to `.jpg`. The upload endpoint sniffs the magic bytes, assigns the correct extension, and rejects HEIC/HEIF with a clear message (export as JPEG first).
- **Files are written to `UPLOADS_DIR`**, never to the code directory, via a `.part` file that is atomically renamed. Each upload gets a random filename, so replacing an image never leaves a stale file at the old path.
- **URLs are cache-busted.** The database stores the clean path (`/images/uploads/<id>.png`); the storefront appends `?v=<mtime+size>` when rendering. A changed file therefore gets a new URL even though image responses are cached for seven days (`public, max-age=604800`), which defeats browser and CDN stale-image caches.
- **Catalogue re-imports preserve owner uploads.** If the one-time bootstrap import runs again (for example after the import marker is cleared), an existing product image that differs from `data/cosmetics.json` is kept rather than overwritten.
- **Each product renders its own path.** Uploading is a per-product action; there is no shared photograph substituted at render time. A product with no upload shows the pending panel until its own photo is supplied.
- **Saving clears the pending state.** After a successful upload and save, the product API returns the versioned photo path with `photoRequired: false`, and the same image appears on the shop card and product page on the next load.

If an image still does not change, check in order: (1) the admin save succeeded and the product API returns the new path, (2) the file exists under `$UPLOADS_DIR`, (3) `UPLOADS_DIR`/`DATA_DIR` point at the mounted volume in production — the server prints a startup warning if they are unset while `NODE_ENV=production`.

**Current imagery status (3 November 2026):** all 200 SKUs are marked **Photo required** in the admin and show the pending panel on the storefront. No genuine cosmetics photography has been supplied. The workspace contains no cosmetics originals: `vibe_images` holds unrelated home/lifestyle photographs, and one customer-supplied reference ("PEIRAMA VENUSTAS", 324×475 px) is below the pipeline's 800 px minimum, has no matching SKU, and carries a different brand. It was not installed. No stock or generated image was substituted, because a mismatched photo would mislabel a product.

To finish the visual build, supply one photograph per SKU — named `<slug>.jpg` in a folder, or uploaded through **Admin → Products → Edit** — then run `photos:plan` → `photos:ingest` → `photos:apply` and `photos:audit`. SKUs without a photograph stay honestly marked rather than showing an invented packshot.

---

## API summary

Public:

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/health` | Health check (database query + writable data/uploads directories; 503 on failure, `no-store`) |
| GET | `/api/products` | Catalogue + categories |
| GET | `/api/products/:slug` | Product + related items |
| GET | `/api/shipping`, `/api/currency`, `/api/payments` | Checkout configuration |
| POST | `/api/promo` | Validate a promo code |
| POST | `/api/orders` | Create a cash-on-delivery order with server totals |
| POST | `/api/orders/lookup` | Find an order with number + email |
| GET | `/api/orders/:number?token=…` | Read an order with its private token |
| POST | `/api/newsletter`, `/api/support/ticket` | Newsletter and contact form |
| GET | `/api/stores/:slug` | Public approved storefront |
| POST | `/api/stores/:slug/orders` | Cash-on-delivery order from a reseller store |
| POST | `/api/chat/start`, `/api/chat/message`, `/api/chat/state`, `/api/chat/read`, `/api/chat/typing` | Live chat |
| GET | `/api/chat/stream` | SSE stream (single-use ticket) |
| POST | `/api/auth/register`, `/api/auth/login`, `/api/auth/logout` | Customer sessions |
| GET | `/api/auth/session` | Current customer or `null` |
| POST | `/api/auth/otp/request`, `/api/auth/otp/verify` | Email/mobile verification |
| GET/PATCH | `/api/account` | Profile |
| POST | `/api/account/password`, `/api/account/avatar` | Password and avatar |
| GET | `/api/account/orders` | Orders linked to the account |
| GET/POST | `/api/account/verification`, `/api/account/verification/documents` | KYC status and private uploads |
| GET/POST/PATCH | `/api/account/store`, `/api/account/store/submit`, `/api/account/store/add`, `/api/account/store/items/:slug`, `/api/account/store/sell`, `/api/account/store/orders` | Reseller storefront |

Admin (require `Authorization: Bearer <token>`; individual endpoints are further scoped by staff permissions):

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/api/admin/login` | 12-hour admin token |
| GET | `/api/admin/overview`, `/api/admin/session` | Dashboard and session check |
| GET/PATCH | `/api/admin/orders`, `/api/admin/orders/:number` | Orders; cancel restocks |
| GET/POST/PATCH/DELETE | `/api/admin/products`, `/api/admin/products/:slug` | Catalogue |
| POST | `/api/admin/uploads` | Validated image upload |
| GET | `/api/admin/customers`, `/api/admin/verification` | Customers and KYC |
| GET/PATCH | `/api/admin/stores`, `/api/admin/stores/:id` | Approve / reject / suspend |
| GET/POST/PATCH/DELETE | `/api/admin/integrations` (+ `/test`, `/import-products`, `/export-products`, `/sync-inventory`, `/push-orders`, `/jobs`) | Sales channels |
| GET/PATCH | `/api/admin/settings` | Support, KYC and storefront settings |
| GET/POST/PATCH/DELETE | `/api/admin/categories` | Categories |
| GET | `/api/admin/chat`, `/api/admin/chat/stream`, `/api/admin/tickets` | Live desk and tickets |
| GET | `/api/admin/reports/profit`, `/api/admin/expenses`, `/api/admin/delivery` | Margin report, expenses, OTP outbox |
| GET/POST/PATCH | `/api/admin/staff` | Employee accounts and permissions |
| GET | `/api/admin/subscribers` | Newsletter list |

---

## Tests and verification

```bash
npm install     # dev dependency `sharp`, used by the photo tooling and test fixtures
npm test        # node --test --test-concurrency=1
npm run check   # syntax-check server, store, notify, integrations and admin JS
```

The suite uses the Node test runner with a real HTTP server and fresh SQLite databases; it does not mock the database. **64 tests across 11 files pass** (verified 3 November 2026 on Node 24.18, Windows):

- Catalogue shape, 200 cosmetics, pricing defaults, admin-only costs, categories.
- Registration and login, session isolation, password and profile handling, OTP/verification state, document privacy.
- Identity document previews default to a light stage and include a persisted Light/Dark background control.
- Order pricing, promos, US/India validation, idempotency, stock decrement/restock, profit snapshots, rate limiting, origin checks.
- Admin authorization, product CRUD, image validation, categories, staff permission scopes, settings.
- Chat persistence, ownership, admin moderation and SSE delivery.
- Reseller store workflow, approval gating, public COD orders, reseller stock restock, cancellation, rejection/suspension.
- Sales channels: admin-only access, config validation, secret sealing, connection tests, import/update, export, stock sync, order push and replay dedupe, employee denial, link cleanup.
- Production behaviour: health check validates the database and writable directories; an uploaded image is written to the configured `UPLOADS_DIR` and still served after a restart sharing that directory; HTTPS forwarding sends HSTS and a `Secure; HttpOnly; SameSite=Lax` session cookie; `TRUST_PROXY` makes the limiter use the forwarded client address.
- Channel adapters against a mocked `fetch`: exact Shopify Admin API paths, `X-Shopify-Access-Token`, product/variant and order payload shapes, unlinked-order rejection; WooCommerce REST paths, Basic auth from the consumer key/secret, product and COD order payloads; provider error bodies cannot echo stored tokens or secrets.

The storefront was also exercised on an isolated production-mode server on 3 November 2026: home, product, shop, checkout, account, contact, policies, admin, order lookup and 404 at 1440 px, 768 px and 390 px, with no horizontal overflow, no console errors and no broken visible images. The admin image lifecycle was completed end-to-end — login, edit a product, upload a file (magic-byte validated), save, and confirm the uploaded image renders on the product page — then reverted.

Earlier, the admin Integrations screen was exercised against a local mock supplier: create, edit, failed and successful connection tests, import, stock sync, export, order push, job history and removal. That smoke test caught and fixed a real bug where the supplier auth prefix was trimmed (`Bearer ` → `Bearer`); the integration test now asserts the exact `Authorization` header. It also caught a credentials-scrubbing bug: provider error bodies could echo a stored token because the config lacked its provider name. Errors are now redacted in tests for both Shopify and WooCommerce.

See `tests/` for the exact assertions. These are delivery-time checks; they are not a substitute for production monitoring, a security audit or live-provider certification.

---

## External accounts required before launch

Everything in this repository runs without third-party credentials except the services below. These cannot be finished from code alone:

1. **Domain, TLS and hosting** — deploy behind HTTPS, set `SITE_URL`, `ADMIN_SECRET`, `SESSION_SECRET` and `INTEGRATIONS_SECRET`.
2. **Transactional email** — an SMTP account and SPF/DKIM/DMARC for the sending domain. Then set `OTP_EMAIL_ENABLED=true` and the `SMTP_*` variables.
3. **SMS** — Twilio, MSG91 or a custom gateway, plus sender registration where required. Then set `OTP_SMS_ENABLED=true` and the provider variables.
4. **Identity verification policy** — legal review of consent, retention and access for Aadhaar/passport/other documents. No UIDAI e-KYC API is integrated.
5. **Shopify** — a store and an Admin API access token with product, inventory (and location) and order read/write scopes.
6. **WooCommerce** — a WordPress site with the REST API enabled and a read/write consumer key/secret.
7. **Supplier** — a supplier JSON API matching the documented product/order/stock contract, or an adapter for their format.
8. **Payments** — not included; checkout is cash on delivery. Online card payments require a verified provider, compliance review, webhooks and refund handling.
9. **Tax** — no tax engine; the tax line is $0. US sales-tax registration and a calculation service are separate.
10. **Carrier tracking** — tracking numbers are stored and displayed, but no carrier status API is polled.
11. **Analytics and consent** — no GA4/Meta Pixel or consent banner. Add them with a consent strategy before launch.
12. **Backups and monitoring** — off-site SQLite/media backups, uptime checks, error reporting and log retention.

Until email/SMS are configured, verification codes are written to the admin **Delivery** outbox. That is deliberate: no fake delivery is reported, and no OTP is silently discarded.

---

## Production checklist

- [ ] Serve only over HTTPS; terminate TLS at the proxy. Set `NODE_ENV=production` and `TRUST_PROXY=true` so the app sends HSTS and secure cookies.
- [ ] Mount a persistent volume at `/data` and set `DATA_DIR=/data`, `UPLOADS_DIR=/data/uploads`, `STORE_DB_PATH=/data/velune.db`; verify they survive a redeploy.
- [ ] Set strong `ADMIN_PASSWORD_HASH`, `ADMIN_SECRET`, `SESSION_SECRET` and `INTEGRATIONS_SECRET`.
- [ ] Check `GET /api/health` returns 200 with all three checks, and point your uptime monitor at it.
- [ ] Restrict admin access (VPN, IP allowlist or SSO proxy) and use named staff accounts with least-privilege roles.
- [ ] Configure SMTP/SMS and test verification end-to-end; keep `OTP_DEV_ECHO=false`.
- [ ] Review KYC document retention and access; schedule deletion of expired documents.
- [ ] Back up the database, WAL files, private directory and uploads; test a restore.
- [ ] Configure a sales channel and run a test/import/sync against a staging store before production.
- [ ] Add a privacy-respecting analytics/consent stack.
- [ ] Review policies and supplier/product claims with a qualified attorney.
- [ ] Put the app behind a CDN, compress responses, monitor errors and measure Core Web Vitals on the real origin.

---

## Performance measures

- Server-rendered content with no client framework hydration.
- Self-hosted fonts with preload; no third-party font requests.
- 400px/800px responsive product images with `srcset`, explicit dimensions and lazy loading below the fold.
- Small static CSS/JS files with ETags; long-lived caching for images and fonts.
- No render-blocking third-party scripts, analytics or chat SDKs.
- Reduced-motion support and focus-visible styles.

For production, put the app behind a CDN/TLS proxy, compress responses, set HSTS, monitor availability and error rates, and measure Core Web Vitals from real users.
