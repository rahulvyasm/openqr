# Operations runbook

For whoever runs an OpenQR server. Keep this short and update it after every incident.

## What "healthy" means

- `GET /health/live` returns `ok` (the process is running).
- `GET /health/ready` returns `ready` (the database and media storage answer).
- Request logs are JSON lines. Useful fields: `route`, `status`, `ms`.

Suggested starting targets for a small installation (not guarantees): 99.5% of monthly requests succeed (status below 500), 95% of public page loads answer in under 500 ms, a backup completes every day, and a restore is rehearsed every quarter. If a month misses its target, spend the next month on reliability before new features.

## Daily and weekly

- Confirm the last backup is recent: the backup status shown with storage in **Workspace settings**, or look in `DATA_DIR/backups`.
- Copy backups off the server (`S3_BACKUP_BUCKET`, or any scheduled copy).
- Watch disk space: `DATA_DIR` holds the database, media and backups.
- Review Dependabot pull requests weekly. Security fixes go first.

## Upgrade

1. Take a manual backup (`npm run backup`, or `docker compose exec openqr npm run backup`).
2. Pull the new image or code and read the CHANGELOG.
3. Restart. The server runs its additive migrations on start and refuses to open a database from a newer release.
4. Check `/health/ready`, sign in, open a printed code from a phone.

Expect a few seconds of downtime. Never change `PUBLIC_URL` after printing dynamic codes: the address is encoded in them.

## Roll back

1. Stop the server.
2. Restore the backup taken before the upgrade: `npm run restore -- --archive /absolute/path/openqr-backup.tar.gz --confirm-stopped` (the README shows the Docker form). The previous data is kept in a restore-history folder.
3. Start the previous image or tag.

Migrations only add tables or columns, so a restore is the supported rollback. Data created after the backup is lost; say so to users.

## Incidents

**Site down.** Check `/health/live` from outside, then the container (`docker compose ps`, `docker compose logs --tail 200`). Common causes: full disk, expired certificate on the proxy, a bad `PUBLIC_URL` or cookie setting after a configuration change (the server prints the error and exits).

**Sign-in failing for everyone.** Check the proxy forwards the original host and that `COOKIE_SECURE`, `PUBLIC_URL` and `TRUST_PROXY` match how users reach the site. Rate limits answer 429 with a clear message.

**Printed codes open the wrong place or fail.** Confirm the code is not paused or past its end date or scan limit in the dashboard, and that `PUBLIC_URL` is unchanged.

**Suspected data exposure.** Take the instance out of public reach, keep a copy of the database and logs, rotate secrets (`SMTP_URL`, `SUPPORT_WEBHOOK_SECRET`, S3 keys), revoke sessions by having affected people change their passwords, and follow `SECURITY.md` for disclosure.

**Lost owner access.** `npm run recover` issues a recovery link; treat shell access and the link as sensitive.

## After every incident

Write a short postmortem within a week using [POSTMORTEM_TEMPLATE.md](POSTMORTEM_TEMPLATE.md). Blame processes, not people. Every action item gets an owner and a date, and the runbook and tests are updated so the same thing is caught earlier next time.

## On call

OpenQR does not page anyone. If you run it for others, decide who answers, how users reach them, and what they can promise, and write it where users can see it. A single named contact with a clear response window beats an unclear team.
