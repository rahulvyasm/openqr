# Security

OpenQR v0.2 is early software. It is designed for one owner on a trusted, self-hosted instance. There is currently no third-party security audit, account recovery flow, or multi-user authorization system.

For a vulnerability, use GitHub's private vulnerability reporting feature on the repository where this project is published, if enabled. Do not disclose passwords, cookies, database files, or exploitable details in a public issue. Repository owners should enable private reporting before accepting public users.

Use HTTPS, set COOKIE_SECURE=true, claim the owner account before exposing the instance, keep dependencies updated, and back up the database. Configure TRUST_PROXY only behind a trusted reverse proxy with the origin inaccessible to untrusted clients.

The first owner should remain the only account until multi-user authorization is implemented. Dynamic links intentionally redirect to owner-configured HTTP(S) destinations; protect the owner credentials and moderate any future public link-creation feature.

Hosted link pages are public while their code is active. Anyone with the short link can see their content. These are publication tools, not access-controlled document storage. HTML is escaped, destination links are restricted to HTTP(S), and logo uploads accept only re-encoded PNG/JPEG images. No remote image fetching is performed.

Batch imports validate before a database transaction commits. Export bundles are bounded to 100 owned records. Campaign limits apply transactionally to successful GET visits; they are operational controls, not protection against deliberate traffic abuse or scraping.
