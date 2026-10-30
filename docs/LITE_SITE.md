# The free generator and interactive demo (lite site)

A static website with no server and no database:

- **`/` Free generator.** Make static QR codes (website, text, Wi-Fi, email, phone, SMS, WhatsApp, contact card, location, event), style them with the full designer, and download PNG or SVG. Everything happens in the browser and nothing is uploaded.
- **`/demo/` See full potential.** The real OpenQR app running against an in-browser mock of the server: dashboard, analytics, designer, media library, Experience Studio, item pages, team and plans. Everything works and nothing is saved or sent. Refreshing resets it.
- **Optional early-access list** stored in a Supabase table.

It costs nothing to run because it is only files.

## Develop and test

```sh
npm run dev:lite        # http://localhost:5280  (generator) and /demo/
npm run build:lite      # writes dist-lite/
npm run test:e2e        # builds, serves the build and runs the browser tests
```

The demo reuses the real screens, so it stays in step with the product. Its stand-in server is `src/demo/mockApi.ts`. When you add an API route the app calls, add the same route there, or the demo answers "That part is only available in the full app."

## Deploy

The same build works on any static host. **Check the host's terms first.** Vercel's free Hobby plan is for personal, non-commercial use only, so a business site belongs on Vercel Pro. Cloudflare Pages and Netlify allow commercial use on their free plans.

### Vercel

1. Import `rahulvyasm/openqr` in Vercel. `vercel.json` already sets the build command (`npm run build:lite`), output (`dist-lite`) and security headers.
2. Use Node 24 (Project Settings → General → Node.js Version).
3. Add the domain `openqr.riolet.si` under Project Settings → Domains.
4. At your DNS provider for `riolet.si`, add a `CNAME` record: name `openqr`, value `cname.vercel-dns.com` (use the exact value Vercel shows). HTTPS is issued automatically.

### Cloudflare Pages (recommended, free for commercial use)

1. Sign in at <https://dash.cloudflare.com> (a free account is enough). Open **Workers & Pages → Create → Pages → Connect to Git**, authorise GitHub, and choose `rahulvyasm/openqr`.
2. Production branch `main`. Framework preset **None**. Build command `npm run build:lite`. Build output directory `dist-lite`. Leave the root directory empty.
3. Under **Environment variables** add `NODE_VERSION` = `24`. If the build image does not offer Node 24, use `22`: the lite build works on it (npm only warns about the `engines` field).
4. If you use the early-access list, also add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` (see below). Then **Save and Deploy**. The first build takes a few minutes and ends on a `https://PROJECT.pages.dev` address.
5. Open that address and check `/` (generator) and `/demo/` (demo).
6. **Custom domain:** in the project, **Custom domains → Set up a domain**, enter `openqr.riolet.si`. If `riolet.si` is not on Cloudflare DNS, Cloudflare shows a `CNAME` to add at your DNS provider: name `openqr`, target `PROJECT.pages.dev`. Add it, then press **Check DNS**. HTTPS is issued automatically, usually within minutes.
7. Every push to `main` redeploys. Pull requests get preview addresses.

The `_headers` file in `lite/public` sets the security headers and long-lived caching for hashed files.

### Netlify

Build command `npm run build:lite`, publish directory `dist-lite`, Node 24 (`NODE_VERSION`). The same `_headers` file applies.

## Early-access list (Supabase)

1. Create a free Supabase project. In **SQL editor**, run:

```sql
create table public.waitlist (
  id bigint generated always as identity primary key,
  email text not null
    check (length(email) <= 200 and email ~* '^[^@\s]+@[^@\s]+\.[^@\s]{2,}$'),
  source text not null default 'lite-site',
  created_at timestamptz not null default now()
);
create unique index waitlist_email_key on public.waitlist (lower(email));
alter table public.waitlist enable row level security;
-- Visitors may add themselves. No policy lets them read, change or delete anything.
create policy "anyone can join" on public.waitlist for insert to anon with check (true);
```

2. In **Project Settings → API**, copy the project URL and the `anon` public key.
3. In your host, set these environment variables for the build:

```
VITE_SUPABASE_URL=https://YOUR-PROJECT.supabase.co
VITE_SUPABASE_ANON_KEY=YOUR-ANON-KEY
```

The anon key is meant to be public; the row-level-security policy is what protects the table. Without these variables the early-access form is simply not shown. Read the list in the Supabase dashboard (Table editor), export it when you need it, and delete a person's row when they ask. Tell visitors what you do with the address; the form says "one email when it opens".

## Limits of the demo

- It cannot show the control room, email, real payments, file uploads beyond small images, or anything that needs a server.
- Data resets on refresh. Up to 60 codes can be created.
- Printing label sheets, email alerts and public form submission are described instead of performed.

## Privacy

The generator makes no network requests with your content. The site sets no cookies and loads no third-party scripts or fonts. The only outgoing request is the optional early-access form, sent to your Supabase project.
