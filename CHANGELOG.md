# Changelog

## 0.6.0 — 2026-10-30

- Add **Experiences**: hosted pages built from blocks (heading, text, image, video, button, links, file, form, item details). Draft, publish and restore with up to 50 kept versions; a live phone preview; four starters (product companion, event welcome, business enquiry, guest feedback).
- Forms collect responses without scripts: ticketed posts, a honeypot, per-address rate limits, duplicate suppression, CSV export that neutralises spreadsheet formulas, deletion, automatic expiry after 365 days, and optional email alerts that never include answers.
- Track what visitors do: buttons and links use a tracked redirect, and Results shows scans next to taps, submissions and actions per scan.
- Add time rules: show a block only on chosen days or between times in the page's time zone (overnight ranges work), with a "Preview as" control.
- Add **item pages**: one experience as a template for many physical items, each with its own code, serial, warranty and service history; CSV import (up to 1,000), a printable label sheet, a Report-a-problem shortcut and an automatic serial form field. Responses and results roll up into the template.
- Add the company **control room**: role-limited staff access (Super Admin, Operations, Support, Billing, Analyst) separate from customer workspace roles, masked customer views, password re-confirmation and recorded reasons for sensitive actions, account suspension, a staff audit log, and optional hosted-mode plans with INR display prices.
- Add customer **support cases** with in-app alerts for customers and staff, optional email and webhook alerts, and a notes visibility model. Webhooks can be signed (`SUPPORT_WEBHOOK_SECRET`) and alert delivery retries with backoff.
- Redesign the interface as a dark editorial studio with a new landing page and GSAP motion that respects reduced-motion preferences.
- Harden operations: one JSON line per request with route templates only (`LOG_REQUESTS`), public-page rate limiting, request and header timeouts, forced exit after a stalled shutdown, long-lived caching for hashed build assets, a Docker `HEALTHCHECK`, and an expression index for item pages.
- Add GitHub automation: CI with dependency audit and a Docker readiness check, CodeQL, Dependabot, and tag-driven releases that publish a container image.
- Add Playwright visual regression tests (`npm run test:visual`) and a screenshot generator (`npm run docs:screenshots`).
- Add the [runbook](docs/RUNBOOK.md), a postmortem template and a [production readiness checklist](docs/PRODUCTION_READINESS.md).
- Fix a bug that made about 3% of codes impossible to edit: automatically generated short links could start with `-` or `_`, which the edit validation rejected. New links always start with a letter or digit, and existing links are accepted unchanged. This was also the cause of the intermittently failing tests.
- Fix a motion-engine bug that stopped the landing page's tilt, magnetic buttons and spotlight from attaching when a page mounted in several steps.

## 0.5.0 — 2026-10-27

- Add image gallery pages (1–24 images) with drag/arrow reordering, captions, alternative text, optional downloads, and a mobile photo grid or full-width layout.
- Add audio and video pages with in-page players, cover artwork, descriptions, optional downloads, and byte-range seeking. Uploads are content-verified and their duration/dimensions are read from the file.
- Add hosted event pages with venue, time zone, registration link, and a stable downloadable calendar entry; and app-store routing that opens the right store for iOS/Android with a website fallback (or a landing page).
- Add reusable page templates and page styling (layout, fonts, corners, buttons, accent color) shared by the collection editors.
- Add per-workspace storage quotas, bounded uploads (`MAX_UPLOAD_MB`, `WORKSPACE_STORAGE_MB`), optional private S3-compatible media storage, remote backup copies, and `npm run storage:sync` for moving existing media off local disk.
- Add `/health/live` and `/health/ready` endpoints.
- Test real MP3/MP4/WebM files, gallery ordering, range requests, event calendars, app routing fallbacks, storage limits, and S3 read/write/delete/backup against a local S3-compatible service.

## 0.4.0 — 2026-10-27

- Add PDF publishing and a self-hosted PDF.js reader with page navigation, zoom, extracted text, and downloads. Replacing documents preserves printed QR links.
- Add themed digital contacts, downloadable vCards, business pages with weekly hours/directions, and social pages with platform links.
- Add a workspace media library with content-verified, bounded PDF/image uploads and reusable sanitized logos. Protect private files and enforce code-bound public access, pause/expiry, and reference-aware deletion.
- Expand the visual designer with seven module styles, seven frame choices, separate inner/outer finders, individual corner styling/colors, logo sizing, symbols, caption positioning, and undo/redo/reset.
- Add automatic and manual database/media snapshots, archive retention, checksum validation, and offline restore that preserves the previous installation data.
- Migrate existing databases without changing sessions, code IDs, printed links, or scan history.
- Test styled QR decoding, media privacy/roles, page validation, ticket expiry, document replacement, vCard escaping, migration, and backup restoration/tampering.

## 0.3.0 — 2026-10-27

- Add workspaces and Owner/Admin/Editor/Viewer roles with resource isolation and read-only Viewer exports.
- Add invitation signup, account-matching acceptance, seven-day expiry, renewal, revocation, and single-use tokens.
- Add team management and password-confirmed ownership transfer.
- Add operator recovery, profile/password settings, session inspection/revocation, and versioned stronger password hashing with legacy compatibility.
- Add a workspace log for account/team security events, excluding live tokens and passwords.
- Migrate v0.1/v0.2 folder references, existing sessions, password hashes, and printed tracking links into workspace ownership.
- Add tests for workspace isolation, role boundaries, invitation reuse/expiry, recovery, sessions, legacy migration, and the operator command.

## 0.2.0 — 2026-10-27

- Add a three-step editor, design studio, saved brand designs, logo sanitization, module/finder styles, caption frames, and shared preview/export rendering.
- Add SMS, WhatsApp, location, calendar-event, and hosted link-page QR types.
- Add atomic CSV imports, ZIP downloads, metadata CSV exports, and batch pause/resume/move/delete.
- Add permanent custom short links, campaign activation/expiry, optional scan caps, and UTM tags.
- Add browser, operating-system, referrer-host, and top-code analytics; aggregate scan reports in SQLite.
- Preserve existing code IDs, printed tracking links, and scan history with an idempotent database migration.
- Expand tests to cover styled QR decoding, logo safety, batch atomicity, ownership, safe hosted pages, campaign behavior, and legacy migrations.

## 0.1.0 — 2026-10-27

- Initial single-owner workspace with six QR types, dynamic destinations, scan statistics, folders, PNG/SVG exports, and Docker self-hosting.
