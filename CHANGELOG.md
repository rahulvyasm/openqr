# Changelog

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
