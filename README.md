# OpenQR

**Your codes. Your connections. Your platform.**

A self-hosted, MIT-licensed QR workspace built with React, TypeScript, Express, and SQLite. Create real QR codes, keep printed website codes editable, and understand scan activity without a subscription.

This is an independent implementation. It does not reuse QR Code Generator's code, branding, or assets, and is not affiliated with Bitly.

![OpenQR dashboard](docs/dashboard.jpg)

*Dashboard from a disposable test workspace. Your instance starts empty.*

## What's included in v0.1

- Owner account setup and sign-in, password hashing, expiring server-side sessions, and sign-out.
- Website, plain text, Wi-Fi, email, phone, and vCard QR codes.
- Dynamic website codes: change destinations without changing the printed QR; pause and resume links.
- Static codes: content lives directly in the QR and does not depend on the server.
- Live QR preview, color customization, and high-resolution PNG / vector SVG downloads.
- Folders, search, filters, and list/grid views.
- Real redirect analytics: daily scans, approximate daily unique visitors, device categories, and CSV exports for 7/30/90-day ranges.
- SQLite persistence, self-hosted fonts, responsive layouts, Docker configuration, and GitHub Actions checks.

There is no third-party analytics SDK or external font service. No sample scans or prefilled campaigns are added to your workspace.

## Run locally

Requires **Node.js 24+** and npm. Node's built-in SQLite API may print an experimental warning on Node 24.

```sh
git clone https://github.com/rahulvyasm/openqr.git
cd openqr
npm ci
cp .env.example .env
npm run dev
```

On Windows PowerShell, use `Copy-Item .env.example .env` instead of `cp` if preferred. Open **http://localhost:5173** and create the owner account. The API runs on port 3001; Vite proxies API and redirect requests to it. Use `localhost`, matching `PUBLIC_URL`, rather than `127.0.0.1` when opening the app.

The first account claims the instance. Public registration is disabled. Claim your instance on a trusted local connection before exposing it publicly.

## Production

```sh
npm ci
npm run build
```

Set `.env` for your deployment, then run `npm start`:

```dotenv
PORT=3001
PUBLIC_URL=https://qr.your-domain.com
COOKIE_SECURE=true
DATA_DIR=./data
# Only if exactly one trusted reverse proxy fronts this process:
TRUST_PROXY=1
```

Terminate HTTPS at a reverse proxy pointing to port 3001. Do not expose the origin port publicly when trusting a proxy. Requests changing data must include an Origin matching PUBLIC_URL. For local production testing, use PUBLIC_URL=http://localhost:3001 and COOKIE_SECURE=false.

**Choose a permanent, publicly reachable PUBLIC_URL before printing dynamic QR codes.** A phone cannot reach your computer through its own `localhost`. If the public origin changes, previously printed codes still point at the old origin. Keep the old domain resolving and forwarding traffic. Dynamic redirects require your server to stay online.

### Docker

```sh
docker compose up --build -d
```

By default, Docker serves http://localhost:3001 and stores data in the `openqr-data` volume. Set PUBLIC_URL, COOKIE_SECURE, and TRUST_PROXY in your shell or `.env` for HTTPS hosting. The runtime uses a non-root user. The Docker image build and a running-container smoke test are verified for this release.

## Development and checks

```sh
npm test
npm run build
```

Tests exercise authentication, CSRF protection, redirect tracking, destination edits, pause/delete behavior, static content immutability, folders, validation, and database persistence. Download tests decode generated PNGs to check the actual encoded QR content.

```
src/                React interface and browser helpers
server/app.js       Express app, auth, SQLite schema, API and redirects
server/payload.js   QR content validation and encoding
server/index.js     Environment and process lifecycle
test/               API and QR decoding tests
```

## Analytics and privacy

Only visits to dynamic `/r/:slug` tracking links are measured. Static codes are not tracked. HTTP GET visits count as scans, including clicks and bots; this is not a camera-scan detector. HEAD requests do not count. UTC dates define daily buckets.

Approximate unique visitors are salted hashes of IP address, user agent, and UTC date; raw IPs and user agents are not saved in the scan table. The same visitor on different days counts again. Counts are estimates and may be affected by shared IPs, bots, or changing devices. The SQLite database retains scan records until the code is deleted. There is no geolocation or tracking cookie on redirect requests.

Auth cookies are HttpOnly and SameSite=Strict, and Secure when COOKIE_SECURE=true. API writes require same-origin requests; auth and API endpoints are rate-limited. Stored QR content, including Wi-Fi passwords, is readable by the workspace owner and anyone with database access. Protect the database and backups accordingly.

## Backups

Back up your complete DATA_DIR and preserve your public domain. Stop the server before making a filesystem copy of the SQLite directory, or use a SQLite-aware online backup tool. Copying only the main database while it is being written can omit data in the WAL. Never commit the database or `.env` to Git.

## Scope and roadmap

v0.1 is a working single-owner workspace, not feature parity with a commercial SaaS. Planned areas include multiple users and teams, password recovery, bulk creation, branded landing pages/file uploads, custom domains per workspace, an API-key API, logo embedding, and more advanced analytics. Billing and subscription limits are intentionally outside this self-hosted edition.

## Open source

Licensed under [MIT](LICENSE). Source: [rahulvyasm/openqr](https://github.com/rahulvyasm/openqr). See [CONTRIBUTING.md](CONTRIBUTING.md) and [SECURITY.md](SECURITY.md).
