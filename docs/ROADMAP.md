# Making OpenQR a serious QR platform

The product direction is a flexible, self-hostable QR platform: useful marketing workflows, consistent designs, permanent links, and data portability. Features should work end to end, preserve printed codes, and have visible operational limits.

## Research baseline

QRCG's [official feature overview](https://www.qr-code-generator.com/features/) describes hosted mobile pages, logo/color/frame customization, scan reports, organization tools, team logins, branded short links/domains, and campaign information. Its [bulk creation guide](https://support.qr-code-generator.com/hc/en-us/articles/7665629629453-How-do-I-create-multiple-QR-Codes-at-the-same-time) covers website, vCard, and text CSV workflows. These public pages were reviewed on October 27, 2026; this is a capability baseline, not a claim about every paid plan or the private account UI.

## Delivered in v0.2

| Area          | Implemented behavior                                                                     |
| ------------- | ---------------------------------------------------------------------------------------- |
| Content       | Eleven types, including editable hosted link pages                                       |
| Branding      | Logo upload, three module/finder styles, caption frames, color contrast checks           |
| Design reuse  | Five starting designs and owner-saved templates                                          |
| Bulk workflow | Validated CSV import, atomic writes, selection and folder operations                     |
| Exports       | SVG, three PNG widths, ZIP bundles, CSV information and daily scan reports               |
| Campaigns     | Custom permanent slugs, activation/expiry windows, optional lifetime scan caps, UTM tags |
| Analytics     | Daily scans/unique estimates, devices, browser/OS, referrer hosts, top codes             |
| Continuity    | Migration preserves existing short links and scans; static codes remain independent      |

## Delivered in v0.3

- Workspace isolation across QR codes, folders, designs, analytics, downloads, and bulk operations.
- Owner/Admin/Editor/Viewer roles, invited-account signup, expiring single-use links, renewal/revocation, and role-aware controls.
- Password-confirmed ownership transfer, profile/password updates, session management, and operator-managed password recovery.
- Account/team security activity logs without live tokens or passwords.
- Transactional migration preserving old folder references, designs, sessions, password hashes, and printed links.

## Delivered in v0.4

- PDF publishing with document replacement behind permanent links and a local PDF.js reader.
- Digital contact/vCard downloads, business pages with hours/directions, and social pages.
- Workspace media storage, bounded verified uploads, shared logo reuse, and code-bound public file access.
- Mobile page themes and QR/landing-page previews.
- Visual frame/module libraries, independent finder/corner shapes and colors, symbols, logo sizing, caption placement, and undo/redo/reset.
- Scheduled/manual SQLite + media snapshots, retention, integrity checks, offline restore, and preserved previous data.

## Next: production operations

Build this before presenting OpenQR as a public multi-tenant service.

- Off-server backup destinations, storage monitoring, recovery drills, and stronger operational rollback tooling. Local snapshots and tested restore are in place.
- Production configuration checks, health/readiness endpoints, and deployment tests. Choose PostgreSQL for a shared hosted service; keep a supported SQLite path for a single-instance self-hosted installation.

Acceptance: restoring a backup preserves printed links, workspace memberships, and scan counts. Keep the existing cross-workspace/role, invitation-reuse, and legacy-migration checks passing.

## Then: publishing and integrations

- Add restaurant menus and more page templates. Galleries, audio/video, events, app-store routing, S3-compatible storage, and quotas shipped in v0.5; retention controls and malware scanning remain.
- Custom domains with verified ownership, certificate status, domain-to-workspace mapping, and protection against domain takeover. Existing domains must remain routable when codes are edited.
- Scoped, revocable API keys, published API documentation, per-key rate limits, and idempotent creation for integrations.
- Background jobs for larger imports/exports with progress, cancellation, resumability, and worker concurrency limits.
- Webhooks for scan events with signed payloads, bounded retries, delivery logs, and SSRF protection for outbound delivery.

Acceptance: API creation and the UI use the same authorization/validation path; uploads cannot execute as active content; jobs recover after process restarts; domain changes do not silently break printed codes.

## Then: deeper campaign intelligence

- Rules for destination routing by platform, language, or schedule, with a clear fallback and a test tool.
- Campaign tags and per-folder/date comparisons, goal attribution hooks, and configurable report exports.
- Optional, documented bot classification and privacy-preserving country/region aggregation using an operator-installed database. Never fabricate location data from missing headers.
- Password-protected campaigns with a secure public unlock flow, throttling, and no passwords in QR content or scan records.
- Retention controls, deletion/export workflows, and accessible charts and keyboard workflows.

Acceptance: routing outcomes are reproducible in tests, exclusion rules are disclosed in reports, and privacy choices change the actual stored data.

## Later: enterprise requirements

SSO, two-factor authentication, organization policies, detailed audit logs, high availability, observability, abuse reporting, and security review. These are future requirements, not capabilities advertised by v0.2.

## Release discipline

Keep the repository's chosen visibility. Ship source changes only after tests and a production build pass. Test QR exports by decoding the generated files, check responsive UI in a disposable workspace, and test migrations against the previous schema. Keep live credentials and customer data out of commits and screenshots.

## Remaining screenshot parity

The supplied QRCG screens also show coupons, feedback/ratings, and GS1 2D barcodes (hosted events, galleries, audio/video, and app routing shipped in v0.5). These are still future work. GS1 needs standards-based identifier validation and Digital Link behavior; it is not a renamed URL code. Interactive pages need response storage, moderation, abuse controls, and deletion/export rules.
