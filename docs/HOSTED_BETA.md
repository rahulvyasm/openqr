# Hosted beta

The hosted app uses Cloudflare Pages for the frontend and gateway, and Supabase for Auth, Postgres, private media and the `openqr-api` Edge Function. This is separate from the full Docker/SQLite installation and from the static lite demo. No payment provider or paid plan checkout is enabled.

## Access

Free accounts can create 25 codes, including 3 dynamic codes and 1 Experience, with 10 MiB of media and up to 3 owned workspaces. Plus and Pro are displayed as coming soon, without prices. A Super Admin can grant Free, Plus, Pro or Unlimited to an account through Control room → Billing → Account access. Password confirmation and an audit reason are required. Grants apply to owned workspaces, never to another owner's workspace through membership.

The bootstrap email is stored in the private `oq_launch_config` table. Only a confirmed Supabase Auth email can claim it, once. After the first successful sign-in, the configured owner receives Super Admin and Unlimited. Removing that grant later does not trigger an automatic regrant. Unlimited removes product quotas; infrastructure, request, file-size and document-size limits still apply.

## Deployment

1. Apply every migration in `supabase/migrations`, in order, to a dedicated Supabase project.
2. Set `bootstrap_admin_email` in `oq_launch_config` to the intended owner's exact email (it is blank by default). Set a random 64-character hexadecimal `gateway_token` in the same table and the same value as the Cloudflare production secret `GATEWAY_TOKEN`. Never commit it.
3. Run `npm ci` and `npm run build:hosted`. Deploy `dist-hosted` to Pages, including `_worker.js`, `_routes.json` and `_headers`. The worker must be uploaded as a file part, not a plain text form field.
4. Deploy the files in the generated `.hosted-build/edge-payload.json` as the `openqr-api` function, with its included import map. Platform JWT verification is off because public QR and signup routes have no user token; the function validates the private gateway token, allowed site origin, HttpOnly session cookies, live Auth session and authorization itself. Supabase's builtin server keys stay inside the function.
5. Set the Auth Site URL to the permanent HTTPS app origin and allow only the exact callback origins. Current deployment: `https://openqr.riolet.si/`, with `https://openqr-riolet.pages.dev/` as a temporary alternate.
6. Configure custom SMTP before inviting the public. Supabase's default sender only sends to project-team addresses. Keep email confirmation enabled. After custom SMTP is enabled, use this reset-password template link: `{{ .SiteURL }}/?token_hash={{ .TokenHash }}&type=recovery`. Default fragment recovery links are deliberately refused for password resets. Branded HTML for both emails is in `supabase/templates/` (`confirm-signup.html`, subject "Confirm your OpenQR account"; `reset-password.html`, subject "Reset your OpenQR password"). Paste each into Authentication → Emails → Templates. They load the logo from `/email/logo.png` on the live site, so deploy the site first.
7. Attach the custom Pages domain and its CNAME, then wait for nameserver delegation and HTTPS validation. Print codes only after the permanent domain works.

Auth callback tokens are exchanged for Secure, HttpOnly, SameSite=Lax cookies and removed from the address bar. Workspace data is not exposed through direct anonymous or authenticated database grants. Privileged database functions are service-only; RLS is enabled on application tables. Media deletion checks current codes, drafts and retained versions.

## Two-step sign-in

Users can turn on authenticator-app (TOTP) two-step sign-in from My account. It uses Supabase Auth MFA, so keep TOTP enrollment and verification enabled under Authentication → Sign In / Providers → Multi-Factor. Once a verified factor exists, the API treats any session that has not passed the code step (below `aal2`) as signed out: it exposes only `/auth/status`, `/auth/mfa/verify` and `/auth/logout`. Turning it off requires the account password. Recovery codes are not issued, so losing the authenticator app needs an administrator to remove the factor in Supabase Auth.

## Checks

`npm run test:hosted` requires Docker and Playwright Chromium (Edge on Windows). It creates and removes its own disposable database/API containers, applies migrations, runs SQL isolation checks, tests the API against Postgres, and checks signup, login, QR creation and admin grants in a browser. Auth is mocked in these tests; real email delivery and recovery must also be checked in the hosted environment. CI runs these checks alongside the existing server, lite and Docker jobs.

The retention migration schedules a daily Supabase Cron job: scan/action events expire after 30 days; form responses expire after 365 days. Lifetime campaign counters survive event expiry. Monitor provider usage and export important data: free hosting is subject to provider limits and is not a backup guarantee.

## Current differences from Docker

The hosted beta does not yet provide team invitations, additional staff provisioning, backup exports, outgoing support/form alert emails, or online payments. Unsupported writes return explicit errors. Support conversations work inside the app; internal staff notes stay private. The hosted PDF link opens a ticketed document directly. Some control-room activity breakdowns are not yet populated. Workspace documents have an 8 MiB safety ceiling, and image processing has a 4-megapixel ceiling. These limits apply even to Unlimited.

Public signup must not be announced as ready until custom SMTP, confirmation delivery, secure recovery, domain HTTPS, and the real owner's first verified sign-in have been checked.
