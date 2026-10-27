# Security

OpenQR v0.1 is early software. It is designed for one owner on a trusted, self-hosted instance. There is currently no third-party security audit, account recovery flow, or multi-user authorization system.

For a vulnerability, use GitHub's private vulnerability reporting feature on the repository where this project is published, if enabled. Do not disclose passwords, cookies, database files, or exploitable details in a public issue. Repository owners should enable private reporting before accepting public users.

Use HTTPS, set COOKIE_SECURE=true, claim the owner account before exposing the instance, keep dependencies updated, and back up the database. Configure TRUST_PROXY only behind a trusted reverse proxy with the origin inaccessible to untrusted clients.

The first owner should remain the only account until multi-user authorization is implemented. Dynamic links intentionally redirect to owner-configured HTTP(S) destinations; protect the owner credentials and moderate any future public link-creation feature.
