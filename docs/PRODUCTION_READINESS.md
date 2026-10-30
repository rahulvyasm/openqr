# Production readiness

OpenQR was built quickly with AI assistance. That makes an honest engineering checklist more important, not less. This page walks the commonly missed backend and operations topics (the "who is going to tell vibe coders about…" list of 111 items) and says what OpenQR does about each one. **Done** means it exists and is tested or documented. **Not applicable** means the topic does not arise in a single-node, SQLite, self-hosted app. **Later** is a deliberate gap.

OpenQR is designed to run as **one process with one SQLite database**. Most distributed-systems topics are therefore not applicable until you need more than one machine, and the right answer then is a design change, not a flag.

## Traffic and scaling

| Topic | Status | Notes |
|---|---|---|
| Rate limiting | Done | Sign-in/setup (30 per 15 min), API (300 per minute), public pages and scans (600 per minute per address), form submissions (10 per 10 minutes), support requests (10 per hour), uploads (two at once). |
| Caching | Done | Build assets are content-hashed and cached for a year; the HTML shell revalidates; public pages and API responses are `no-store` because they carry tickets and live data. |
| Load balancing, API gateway, service discovery | Not applicable | One process. A second instance would need a shared database first (see Replication). |
| Reverse proxy | Done | `TRUST_PROXY=1` behind one trusted proxy; HTTPS is mandatory in production and documented in the README. |
| Autoscaling, horizontal and vertical scaling | Later | Scale vertically. Horizontal scaling needs a move off SQLite. |
| CDN and edge caching | Done / Later | Hashed assets can be served by any CDN. Uploaded media is private or ticketed, so it is not edge cached. |
| HTTP/2 and HTTP/3 | Done | Terminate at the proxy (Caddy, nginx, Cloudflare). |
| gRPC, TCP vs UDP, DNS | Not applicable | |

## Reliability

| Topic | Status | Notes |
|---|---|---|
| Timeouts | Done | Request (120 s), header (30 s) and keep-alive timeouts; 5 s timeout on outbound webhooks; SQLite `busy_timeout`. |
| Retries and exponential backoff | Done | Email and webhook alerts retry three times with backoff and jitter; client errors are not retried. |
| Circuit breakers | Not applicable | The only outbound calls are optional alerts that already fail quietly. |
| Idempotency | Done | A repeated identical form submission within a minute is stored once. Code creation is not idempotent; the dashboard disables the button while saving. |
| Message queues, pub/sub, event-driven, saga, dead-letter queues | Not applicable | No asynchronous pipeline exists. Alerts are best effort and never block a request. |
| Cron jobs | Done | In-process timers for backups and response expiry, both cleared on shutdown. |
| Backpressure | Done | Bounded request sizes, concurrent upload limit, per-workspace storage quota. |
| Graceful shutdown | Done | SIGTERM stops accepting work, waits for a running backup, closes the database, and forces exit after 25 s. Compose allows 30 s. |
| Health checks, liveness and readiness | Done | `/health/live` and `/health/ready`; the Docker image has a `HEALTHCHECK`. |
| Feature flags | Done | `HOSTED_MODE` and per-feature environment settings. |
| Rollbacks | Done | Take a backup, deploy; to roll back restore the backup with the previous image. Migrations only add tables or columns and never rewrite existing data. See the runbook. |
| Blue-green, canary, rolling deployments | Not applicable | Single node. Expect a few seconds of downtime on upgrade. |
| Clock skew | Done | Tickets and sessions use the server clock only. |

## Data

| Topic | Status | Notes |
|---|---|---|
| Indexing | Done | Indexes on scans, submissions, events, service entries, and an expression index for item pages. |
| Query optimization, N+1 | Done | Dashboards use aggregate queries; lists are bounded (500 responses, 1,000 items). |
| Connection pooling, read replicas, sharding, partitioning | Not applicable | SQLite is in process. |
| Replication | Done | Backups can be copied to S3-compatible storage. Live replication is not provided. |
| CAP theorem, eventual consistency, leader election | Not applicable | One writer. |
| Optimistic and pessimistic locking, distributed locks | Done | Writes use `BEGIN IMMEDIATE` transactions and an exclusive storage lock; no distributed locks are needed. |
| Race conditions and deadlocks | Done | Atomic transactions for caps, scans, imports and publishes; tests cover cap atomicity. |
| Memory leaks and garbage collection | Done | In-memory maps are bounded by the number of pages; Node's collector is untuned. |
| Thread safety | Not applicable | Single-threaded event loop. |
| Database migrations and schema versioning | Done | `PRAGMA user_version` plus idempotent `CREATE TABLE IF NOT EXISTS`; a database from a newer release is refused. |
| Disaster recovery, backups, failover | Done / Later | Scheduled and manual snapshots with checksums, restore drills in the test suite, optional off-server copy. Automatic failover is not provided. |
| Multi-region deployment | Not applicable | |

## Operations

| Topic | Status | Notes |
|---|---|---|
| CI/CD | Done | GitHub Actions run tests, build, dependency audit and a Docker build with a readiness check. CodeQL runs once the repository is public (code scanning is not available on private repositories without GitHub Advanced Security). Pushing a `v*` tag publishes an image and a release. |
| Docker | Done | Multi-stage image, non-root user, volume for data. |
| Kubernetes, Helm charts, Terraform / infrastructure as code | Later | The Compose file is the supported deployment. |
| Build caching | Done | npm cache in CI; layered Dockerfile. |
| Dependency hell | Done | Lockfile, `npm ci`, weekly Dependabot, high-severity `npm audit` gate. |
| Semantic and API versioning | Done | Semantic versions in the changelog. The HTTP API is internal to the web app and may change before 1.0; it is not a public contract. |
| Logging | Done | One JSON line per request: method, route template, status, duration. No query strings, identifiers, addresses or bodies. |
| Monitoring, metrics, alerts, SLOs, SLIs, error budgets, observability | Later | The runbook proposes targets. There is no metrics endpoint yet; use the health checks and request logs. |
| Distributed tracing | Not applicable | One process. |
| Production incidents, on-call, postmortems | Done | See the [runbook](RUNBOOK.md) and the postmortem template. |
| Cost optimization, cold starts, serverless limits | Not applicable | Runs on one small server. |
| Latency, throughput, P99 and tail latency | Later | Request logs record duration; no load test is published yet. |
| Network partitions | Not applicable | |
| Build and deploy secrets | Done | Secrets come from environment variables; none are in the repository. |

## Security

| Topic | Status | Notes |
|---|---|---|
| Secrets management | Done | Environment only; `.env` is ignored; a history scan found no keys. |
| IAM and OAuth | Done / Later | Workspace roles and separate company-staff roles are enforced server side. OAuth and single sign-on are not implemented. |
| JWT rotation | Not applicable | Server-side sessions are revoked on password change. |
| TLS, encryption in transit | Done | HTTPS is required in production. |
| Encryption at rest | Later | Use an encrypted disk. Backups are not encrypted by OpenQR. |
| WAF and DDoS protection | Later | Put the app behind a provider that offers them. Rate limits are only a first layer. |
| CORS | Done | The API is same-origin only; no cross-origin headers are sent. |
| CSRF | Done | Mutating API requests must carry the app's own origin; cookies are `SameSite`. |
| SQL injection | Done | Every query is parameterised. |
| XSS | Done | Output is escaped, a strict CSP is sent, and tests assert pages contain no scripts. |
| SSRF | Done | The server never fetches addresses supplied by users; the only outbound URLs are set by the administrator. |
| Webhook security | Done | Outbound webhooks can be signed with HMAC-SHA256 and a timestamp. |
| Privacy | Done | Staff see masked contact data, never page content or form responses; sensitive staff actions need a reason and are audited; form responses expire after 365 days. |

## Before you announce publicly

1. Read the [runbook](RUNBOOK.md) and rehearse a restore on a spare machine.
2. Set `PUBLIC_URL` to the permanent address before printing any dynamic QR code.
3. Turn on GitHub private vulnerability reporting and branch protection for `main`.
4. Decide your support channel and put it in the repository description.
5. Accept that there has been no independent security audit (see [SECURITY.md](../SECURITY.md)).
