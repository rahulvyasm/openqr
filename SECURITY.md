# Security

OpenQR v0.4 is early software for invited teams on a trusted, self-hosted server. It implements workspace membership/role authorization, server-side sessions, and operator-managed recovery. It has not received an independent security audit. SSO, two-factor authentication, email-address verification/change flows, and public self-service signup are not implemented.

For a vulnerability, use GitHub's private vulnerability reporting feature on the repository where this project is published, if enabled. Do not disclose passwords, cookies, database files, or exploitable details in a public issue. Repository owners should enable private reporting before accepting public users.

Use HTTPS, set COOKIE_SECURE=true, claim the owner account before exposing the instance, keep dependencies updated, and back up the database plus media. Configure TRUST_PROXY only behind a trusted reverse proxy with the origin inaccessible to untrusted clients.

Invite people deliberately and choose the least role they need. Viewer access includes reading shared QR content (including Wi-Fi credentials) and downloading codes. Workspaces are the sharing boundary. Dynamic links redirect to team-configured HTTP(S) destinations; moderate the people allowed to create them. Destinations and active hosted pages are publicly accessible by their tracking links.

Hosted link pages are public while their code is active. Anyone with the short link can see their content. These are publication tools, not access-controlled document storage. HTML is escaped, destination links are restricted to HTTP(S), and logo uploads accept only re-encoded PNG/JPEG images. No remote image fetching is performed.

Batch imports validate before a database transaction commits. Export bundles are bounded to 100 owned records. Campaign limits apply transactionally to successful GET visits; they are operational controls, not protection against deliberate traffic abuse or scraping.

Invitation and recovery tokens contain 256 random bits and are stored as SHA-256 hashes. Links are single-use, expire, and carry their secret in a fragment rather than a query string. Invitations are manually shared; the app does not deliver email. Existing users must authenticate with the invited email. Removing/demoting a manager revokes their pending grants when management access is lost. Ownership transfer requires the current password.

Operators can issue recovery links with `npm run recover`; treat shell/database access and the resulting links as security-sensitive. Recovery is not available through an unauthenticated email lookup API. A reset revokes every session. A password change revokes earlier sessions and rotates the current cookie. New hashes use scrypt N=32768, r=8, p=3; legacy hashes remain compatible until a password change.

Workspace access is checked server-side for every protected request. Async QR writes/downloads recheck access after processing. The audit log excludes live tokens and passwords; it is an operational log, not tamper-proof evidence against a database administrator. Backups contain sensitive account and QR information and must be access controlled.

Media uploads are limited to 20 MB and verified by file content. Images are re-encoded; SVG and remote image URLs are not accepted. PDFs must be valid and unencrypted. The application does not provide malware scanning: only publish documents you trust. PDF.js resources and workers are self-hosted; document scripting, interactive annotations, and forms are not enabled in the reader. Original downloads use attachment disposition, nosniff, and a restrictive sandbox CSP.

The private media API enforces live workspace roles. Public file access requires a 15-minute HMAC ticket tied to the publishing code and checks that the code still references the file and remains active/in its date window. Scan caps block new page visits, while a ticket from the last allowed visit may still retrieve its files. A token is a public publication capability, not an authentication session. Already loaded/downloaded content cannot be recalled.

Backups include session credentials, password hashes, private QR content, and media. Store them outside publicly served directories, restrict filesystem permissions, and maintain an off-server copy. Restore is an operator-only, offline operation requiring --confirm-stopped. It rejects unsupported archive paths/types and validates database/media checksums and integrity before replacing data. Only restore trusted archives, keep the original PUBLIC_URL, and protect the preserved restore-history directories as carefully as the live database.
