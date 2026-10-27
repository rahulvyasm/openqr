# Changelog

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
