import { z } from "zod";
import { Buffer } from "node:buffer";
import { codeSchema, payload, destination } from "../server/payload.js";
import { hostedTypes } from "../server/publishing.js";
import {
  defaultDesign,
  contrastRatio,
  luminance,
  xml,
  renderSvg,
} from "../shared/qr.js";
import { default as QRCode } from "qrcode";
import { hostedPlans } from "../shared/plans.js";
import { staffRoles } from "../shared/operator-access.js";
import {
  templates,
  parseBlocks,
  renderExperience,
  isVisible,
  formAnswers,
  blockSchema,
  experienceSchema,
  validZone,
} from "../server/experience-blocks.js";
import { hostedPage, linksPage, unavailablePage } from "../server/pages.js";
import { contactCard } from "../shared/contact.js";
import { calendarEvent } from "../shared/calendar.js";
import { appDestination } from "../shared/app-routing.js";
import { PNG } from "pngjs";
import jpeg from "jpeg-js";
import { PDFDocument } from "pdf-lib";
import { inspectMedia } from "../server/media.js";
import { problem } from "../shared/errors.js";
import {
  makeBackend,
  json,
  cookie,
  putCookie,
  body,
  identity,
  mutate,
  getDocument,
  now,
  uid,
  auditDoc,
  reauthenticate,
  mask,
  MAX_STORAGE,
  boundedBody,
} from "./runtime.js";

export const SITE = "https://openqr.riolet.si";
const SITES = [SITE, "https://openqr-riolet.pages.dev"];
const safeName = (value) => z.string().trim().min(1).max(80).parse(value);
const password = (value) => z.string().min(12).max(128).parse(value);
const list = (value) => (Array.isArray(value) ? value : []);
const find = (items, id, label = "Record") => {
  const item = items.find((x) => x.id === id);
  if (!item) throw problem(`${label} not found.`, 404);
  return item;
};
export const assetRefs = (data) => {
  let items = [],
    blocks = [];
  try {
    items = JSON.parse(data.items || "[]");
  } catch {}
  try {
    blocks = JSON.parse(data.blocks || "[]");
  } catch {}
  return [
    ...new Set(
      [
        data.pdfId,
        data.coverId,
        data.portraitId,
        data.mediaId,
        ...list(items).map((i) => i.assetId),
        ...list(blocks).map((b) => b.assetId),
      ].filter(Boolean),
    ),
  ];
};
const csv = (rows) =>
  rows
    .map((row) =>
      row
        .map((v) => {
          let s = String(v ?? "");
          if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
          return '"' + s.replace(/"/g, '""') + '"';
        })
        .join(","),
    )
    .join("\r\n");
const csvResponse = (rows, name) =>
  new Response(csv(rows), {
    headers: {
      "content-type": "text/csv;charset=utf-8",
      "content-disposition": `attachment; filename="${name}.csv"`,
    },
  });
const svgFor = (code) => {
  const qr = QRCode.create(code.dynamic ? code.shortUrl : payload(code), {
    errorCorrectionLevel: "H",
  });
  return renderSvg(
    qr.modules.data,
    qr.modules.size,
    code.design,
    code.color,
    qr.modules.reservedBit,
  );
};

export async function billing(b, workspace, document) {
  const grant = (
    await b.db(
      "oq_grants",
      `user_id=eq.${workspace.ownerId || workspace.owner_id}`,
    )
  )[0];
  const tier = grant?.tier || "free";
  const plans = hostedPlans.map((p) => ({
    ...p,
    ...(p.id === "free"
      ? { storageBytes: 10 * 1024 ** 2, dynamicCodes: 3, experiences: 1 }
      : {}),
    monthlyINR: null,
    available: p.id === "free",
  }));
  const current =
    tier === "unlimited"
      ? {
          id: tier,
          name: "Unlimited",
          codes: null,
          members: null,
          storageBytes: MAX_STORAGE,
        }
      : plans.find((p) => p.id === tier) || plans[0];
  return {
    hosted: true,
    currency: "INR",
    current: {
      ...current,
      status: "active",
      source: grant ? "account_grant" : "free",
    },
    usage: {
      codes: document.codes.length,
      members: 1,
      pendingInvites: 0,
      storageBytes: document.assets.reduce((n, a) => n + a.size, 0),
    },
    plans,
    checkoutAvailable: false,
    checkoutMessage:
      "Free is available now. Plus and Pro are coming soon. Administrators can grant early access.",
    maxOwnedWorkspaces: tier === "unlimited" ? null : 3,
  };
}

async function validatedCode(input, document, base, existing) {
  const c = codeSchema.parse({
    ...input,
    slug: existing ? undefined : input.slug,
  });
  try {
    payload(c);
  } catch (e) {
    throw problem(e.message);
  }
  const inks = [
    c.color,
    c.design.outerColor,
    c.design.innerColor,
    ...Object.values(c.design.corners).flatMap((v) => [
      v.outerColor,
      v.innerColor,
    ]),
  ].filter(Boolean);
  if (
    inks.some(
      (ink) =>
        contrastRatio(ink, c.design.background) < 4.5 ||
        luminance(ink) >= luminance(c.design.background),
    )
  )
    throw problem(
      "Use dark QR colors on a light background with at least 4.5:1 contrast.",
    );
  if (
    c.design.logo &&
    !/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(c.design.logo)
  )
    throw problem("Choose a PNG or JPEG logo.");
  if (c.folderId && !document.folders.some((f) => f.id === c.folderId))
    throw problem("Folder not found.", 404);
  for (const id of assetRefs(c.data))
    if (!document.assets.some((a) => a.id === id))
      throw problem("Choose files from this workspace.");
  if (existing) {
    if (c.type !== existing.type || c.dynamic !== existing.dynamic)
      throw problem("Code type cannot change after creation.");
    if (input.slug && input.slug !== existing.slug)
      throw problem("The short link is permanent.");
    if (!existing.dynamic && payload(c) !== payload(existing))
      throw problem("Static content cannot change after printing.");
    if (c.type === "experience") c.data = { ...existing.data };
  }
  const slug = existing?.slug || c.slug || uid().replace(/-/g, "").slice(0, 12);
  return {
    ...c,
    id: existing?.id || uid(),
    slug,
    shortUrl: `${base}/r/${slug}`,
    createdAt: existing?.createdAt || now(),
    scans: existing?.scans || 0,
  };
}

async function authRoutes(path, req, b, headers, site) {
  if (path === "/auth/login" || path === "/auth/signup") {
    await b.rate("auth:" + req.headers.get("x-openqr-ip"), 20, 900);
    const input = await body(req);
    const email = z.email().max(254).parse(input.email);
    const pass = password(input.password);
    const session = path.endsWith("signup")
      ? await b.auth(`signup?redirect_to=${encodeURIComponent(site + "/")}`, {
          email,
          password: pass,
          data: { name: safeName(input.name) },
        })
      : await b.auth("token?grant_type=password", { email, password: pass });
    if (session.access_token) {
      putCookie(headers, "oq_access", session.access_token);
      putCookie(headers, "oq_refresh", session.refresh_token);
    }
    return json({ ok: true, verificationRequired: !session.access_token });
  }
  if (path === "/auth/recover") {
    await b.rate("recover:" + req.headers.get("x-openqr-ip"), 5, 3600);
    const input = await body(req);
    const email = z.email().max(254).parse(input.email);
    await b.auth(`recover?redirect_to=${encodeURIComponent(site + "/")}`, {
      email,
    });
    return json({
      ok: true,
      message: "If that account exists, a recovery email is on its way.",
    });
  }
  if (path === "/auth/complete") {
    const input = z
      .object({
        access_token: z.string().max(10000),
        refresh_token: z.string().max(10000),
      })
      .parse(await body(req));
    const user = await b.auth("user", undefined, input.access_token);
    if (!user.email_confirmed_at)
      throw problem("Verify your email first.", 403);
    // Refresh verifies the token pair and rotates it before issuing our cookies.
    const session = await b.auth("token?grant_type=refresh_token", {
      refresh_token: input.refresh_token,
    });
    if (session.user.id !== user.id)
      throw problem("Invalid authentication link.", 403);
    putCookie(headers, "oq_access", session.access_token);
    putCookie(headers, "oq_refresh", session.refresh_token);
    return json({ ok: true });
  }
  if (path === "/auth/verify-link") {
    const input = z
      .object({
        token_hash: z.string().min(20).max(500),
        type: z.enum(["recovery", "email", "signup"]),
      })
      .parse(await body(req));
    const session = await b.auth("verify", input);
    if (!session.access_token)
      throw problem("This link has expired. Request another email.");
    putCookie(headers, "oq_access", session.access_token);
    putCookie(headers, "oq_refresh", session.refresh_token);
    if (input.type === "recovery") {
      const claims = JSON.parse(
        atob(
          session.access_token
            .split(".")[1]
            .replace(/-/g, "+")
            .replace(/_/g, "/"),
        ),
      );
      putCookie(
        headers,
        "oq_recovery",
        await b.ticket("recovery:" + session.user.id + ":" + claims.session_id),
        1500,
      );
    }
    return json({ ok: true, recovery: input.type === "recovery" });
  }
  return null;
}

export function createHostedHandler(env, fetcher = fetch) {
  return async (request) => {
    const headers = new Headers({
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
    });
    try {
      const b = makeBackend(env, fetcher);
      const provided = request.headers.get("x-openqr-gateway") || "";
      if (!/^[a-f0-9]{64}$/.test(provided))
        throw problem("Open this service through the OpenQR website.", 403);
      const gateway = (
        await b.db("oq_launch_config", "key=eq.gateway_token")
      )[0]?.value;
      let difference = provided.length ^ (gateway?.length || 0);
      for (let i = 0; i < 64; i++)
        difference |= provided.charCodeAt(i) ^ (gateway?.charCodeAt(i) || 0);
      if (!gateway || difference)
        throw problem("Open this service through the OpenQR website.", 403);
      const url = new URL(request.url);
      const raw = url.pathname.replace(
        /^\/(?:functions\/v1\/)?openqr-api(?=\/|$)/,
        "",
      );
      const api = raw.startsWith("/api/");
      const path = api ? raw.slice(4) : raw;
      const method = request.method;
      const site = request.headers.get("x-openqr-site") || SITE;
      if (!SITES.includes(site))
        throw problem("Site origin is not allowed.", 403);
      if (
        !["GET", "HEAD", "OPTIONS"].includes(method) &&
        request.headers.get("origin") !== site
      )
        throw problem("Request origin not allowed.", 403);
      let response;
      if (path === "/health/ready") response = json({ status: "ready" });
      if (!response && api && method === "POST")
        response = await authRoutes(path, request, b, headers, site);
      if (!response && !api && path.startsWith("/r/"))
        response = await publicRoutes(path, url, request, b, site);
      if (!response && api) {
        const actor = await identity(b, request, headers);
        if (path === "/auth/status")
          response = json({
            setupRequired: false,
            publicSignup: true,
            user: actor?.user || null,
            operator: !!actor?.staff,
            operatorRole: actor?.staff || null,
            hosted: true,
            publicUrl: SITE,
            workspace: actor?.workspace || null,
            workspaces: actor?.workspaces || [],
          });
        else if (!actor) throw problem("Please sign in.", 401);
        else
          response = await privateRoutes(
            path,
            url,
            request,
            b,
            actor,
            headers,
            site,
          );
      }
      if (!response) throw problem("Endpoint not found.", 404);
      const out = new Headers(response.headers);
      headers.forEach((v, k) => {
        if (k !== "set-cookie") out.set(k, v);
      });
      for (const value of headers.getSetCookie())
        out.append("set-cookie", value);
      return new Response(response.body, {
        status: response.status,
        headers: out,
      });
    } catch (e) {
      const status = e.domain
        ? e.status || 400
        : e instanceof z.ZodError
          ? 400
          : 500;
      if (status === 500)
        console.error(
          JSON.stringify({ event: "hosted_request_failed", name: e.name }),
        );
      return new Response(
        JSON.stringify({
          error: e.domain
            ? e.message
            : e instanceof z.ZodError
              ? "Check the form fields and try again."
              : "Something went wrong. Please try again.",
        }),
        {
          status,
          headers: {
            ...Object.fromEntries(headers),
            "content-type": "application/json",
          },
        },
      );
    }
  };
}

async function privateRoutes(path, url, req, b, actor, headers, site) {
  const method = req.method;
  const parts = path.split("/").filter(Boolean);
  await b.rate("api:" + actor.user.id, 300, 60);
  if (path.startsWith("/operator/"))
    return adminRoutes(path, url, req, b, actor);
  if (path === "/auth/logout") {
    try {
      await b.auth("logout?scope=local", {}, actor.access);
    } finally {
      for (const key of ["oq_access", "oq_refresh", "oq_workspace"])
        putCookie(headers, key, "", 0);
    }
    return json({ ok: true });
  }
  if (path === "/auth/profile" && method === "PATCH") {
    const input = await body(req);
    const name = safeName(input.name);
    await b.db("oq_accounts", `id=eq.${actor.user.id}`, "PATCH", { name });
    return json({ ...actor.user, name });
  }
  if (path === "/auth/reset" || path === "/auth/password") {
    const input = await body(req);
    if (path.endsWith("/password"))
      await b.auth("token?grant_type=password", {
        email: actor.user.email,
        password: input.currentPassword,
      });
    // Recovery tokens are held only in HttpOnly cookies, never accepted as arbitrary reset tokens.
    if (path.endsWith("/reset") && input.token !== "hosted-recovery")
      throw problem("Open a valid password recovery link.", 403);
    if (
      path.endsWith("/reset") &&
      !(await b.validTicket(
        cookie(req, "oq_recovery"),
        "recovery:" + actor.user.id + ":" + actor.sessionId,
      ))
    )
      throw problem("Open a valid password recovery link.", 403);
    const changed = await b.auth(
      "user",
      { password: password(input.newPassword || input.password) },
      actor.access,
      "PUT",
    );
    await b.auth("logout?scope=others", {}, actor.access);
    return json({ ok: true, user: changed });
  }
  if (path === "/auth/sessions")
    return json([
      {
        id: "current",
        label: "This browser",
        createdAt: null,
        expires: Date.now() + 3600000,
        current: true,
      },
    ]);
  if (path === "/auth/sessions/revoke-others") {
    await b.auth("logout?scope=others", {}, actor.access);
    return json({ ok: true });
  }
  if (path === "/auth/sessions/current" && method === "DELETE") {
    await b.auth("logout?scope=local", {}, actor.access);
    putCookie(headers, "oq_access", "", 0);
    putCookie(headers, "oq_refresh", "", 0);
    return json({ ok: true });
  }
  if (parts[0] === "workspaces" && parts[2] === "select") {
    if (!actor.workspaces.some((w) => w.id === parts[1]))
      throw problem("Workspace not found.", 404);
    putCookie(headers, "oq_workspace", parts[1]);
    return json({ ok: true });
  }
  if (path === "/workspaces" && method === "GET") return json(actor.workspaces);
  if (path === "/workspaces" && method === "POST") {
    const input = await body(req);
    const name = safeName(input.name);
    const grant = (await b.db("oq_grants", `user_id=eq.${actor.user.id}`))[0];
    if (
      grant?.tier !== "unlimited" &&
      actor.workspaces.filter((w) => w.ownerId === actor.user.id).length >= 3
    )
      throw problem("This account has reached its workspace limit.", 402);
    const workspaceId = await b.rpc("oq_create_workspace", {
      p_actor: actor.user.id,
      p_name: name,
    });
    const w = (await b.db("oq_workspaces", `id=eq.${workspaceId}`))[0];
    putCookie(headers, "oq_workspace", w.id);
    return json({ id: w.id, name, ownerId: actor.user.id, role: "owner" }, 201);
  }
  if (parts[0] === "workspaces" && parts.length === 2 && method === "PATCH") {
    if (
      actor.workspace?.id !== parts[1] ||
      !["owner", "admin"].includes(actor.workspace.role)
    )
      throw problem("Workspace management permission required.", 403);
    await b.db("oq_workspaces", `id=eq.${parts[1]}`, "PATCH", {
      name: safeName((await body(req)).name),
    });
    return json({ ok: true });
  }
  const d = await getDocument(b, actor);
  if (path === "/billing") return json(await billing(b, actor.workspace, d));
  if (path === "/storage") {
    const plan = await billing(b, actor.workspace, d);
    return json({
      usedBytes: plan.usage.storageBytes,
      limitBytes: plan.current.storageBytes,
      maxUploadBytes: 20 * 1024 ** 2,
      backend: "Supabase Storage",
    });
  }
  if (path === "/backups/status")
    return json({
      state: "unavailable",
      intervalHours: null,
      retention: null,
      remoteEnabled: false,
    });
  if (path === "/audit") {
    if (!["owner", "admin"].includes(actor.workspace.role))
      throw problem("Management permission required.", 403);
    return json(d.audit);
  }
  if (path === "/team") {
    const members = await b.db(
      "oq_members",
      `workspace_id=eq.${actor.workspace.id}&select=*,oq_accounts(name)`,
    );
    return json(
      members.map((m) => ({
        id: m.user_id,
        name: m.oq_accounts.name,
        email:
          m.user_id === actor.user.id ? actor.user.email : "Workspace member",
        role: m.role,
        joinedAt: m.joined_at,
      })),
    );
  }
  if (path === "/invitations" && method === "GET") return json([]);
  if (path.startsWith("/invitations") || path.startsWith("/team/"))
    throw problem("Team invitations are not open in this beta yet.", 409);
  if (path === "/support/unread" || path === "/experience/unread")
    return json({ count: 0 });
  if (path.startsWith("/support/")) return supportRoutes(path, req, b, actor);
  if (path === "/experience/templates") return json(templates());
  if (path === "/experience/preview") {
    const input = await body(req);
    const blocks = list(input.blocks)
      .map((x) => blockSchema.safeParse(x))
      .filter((x) => x.success)
      .map((x) => x.data);
    return new Response(
      renderExperience(
        {
          title: typeof input.title === "string" ? input.title : "Preview",
          blocks,
          slug: "preview",
          pageOptions: codeSchema.shape.pageOptions.parse(input.pageOptions),
        },
        {
          preview: true,
          zone: input.timeZone || "UTC",
          now: input.at ? new Date(input.at) : new Date(),
          mediaUrl: (id) => `/api/assets/${id}/content`,
        },
      ),
      { headers: { "content-type": "text/html;charset=utf-8" } },
    );
  }
  if (path === "/analytics")
    return json(
      await analytics(
        b,
        actor.workspace.id,
        Number(url.searchParams.get("days") || 30),
        url.searchParams.get("codeId"),
      ),
    );
  if (parts[0] === "assets") return assetRoutes(parts, url, req, b, actor, d);
  if (parts[0] === "codes") return codeRoutes(parts, url, req, b, actor, d);
  const collections = {
    folders: "folders",
    templates: "templates",
    "page-templates": "pageTemplates",
  };
  const key = collections[parts[0]];
  if (key) {
    if (method === "GET") return json(d[key]);
    const input = method === "DELETE" ? {} : await body(req);
    return json(
      await mutate(b, actor, (doc) => {
        if (method === "DELETE") {
          find(doc[key], parts[1]);
          doc[key] = doc[key].filter((x) => x.id !== parts[1]);
          if (key === "folders")
            doc.codes.forEach((c) => {
              if (c.folderId === parts[1]) c.folderId = null;
            });
          return { ok: true };
        }
        const item = { id: uid(), name: safeName(input.name) };
        if (key === "templates") {
          item.color = z
            .string()
            .regex(/^#[a-f0-9]{6}$/i)
            .parse(input.color);
          item.design = codeSchema.shape.design.parse(input.design);
        }
        if (key === "pageTemplates") {
          item.type = z.enum(hostedTypes).parse(input.type);
          item.data = z
            .record(z.string(), z.string().max(20000))
            .parse(input.data);
          item.pageOptions = codeSchema.shape.pageOptions.parse(
            input.pageOptions,
          );
        }
        doc[key].push(item);
        return item;
      }),
      201,
    );
  }
  return null;
}

async function analytics(b, workspaceId, days, codeId) {
  days = [7, 30, 90].includes(days) ? days : 30;
  const since = new Date(Date.now() - days * 86400000).toISOString();
  const events = await b.db(
    "oq_events",
    `workspace_id=eq.${workspaceId}&kind=eq.scan&created_at=gte.${since}&order=created_at.asc&limit=10000${codeId ? "&code_id=eq." + z.uuid().parse(codeId) : ""}`,
  );
  const daily = Array.from({ length: days }, (_, i) => ({
    date: new Date(Date.now() - (days - 1 - i) * 86400000)
      .toISOString()
      .slice(0, 10),
    scans: 0,
  }));
  const device = {},
    browsers = {},
    operatingSystems = {},
    referrers = {};
  for (const e of events) {
    const day = daily.find((d) => d.date === e.created_at.slice(0, 10));
    if (day) day.scans++;
    for (const [target, k] of [
      [device, "device"],
      [browsers, "browser"],
      [operatingSystems, "os"],
      [referrers, "referrer"],
    ]) {
      const v = e.data[k] || "Unknown";
      target[v] = (target[v] || 0) + 1;
    }
  }
  return {
    days,
    total: events.length,
    uniqueDailyVisitors: new Set(
      events.map((e) => e.data.visitor).filter(Boolean),
    ).size,
    daily,
    devices: device,
    browsers,
    operatingSystems,
    referrers,
    topCodes: [],
  };
}

async function codeRoutes(parts, url, req, b, actor, d) {
  const method = req.method;
  const id = parts[1];
  if (parts[2] === "experience")
    return experienceRoutes(parts.slice(3), id, url, req, b, actor, d);
  if (parts.length === 1 && method === "GET") {
    const scans = await b.db(
      "oq_scan_totals",
      `workspace_id=eq.${actor.workspace.id}`,
    );
    return json(
      d.codes.map((c) => ({
        ...c,
        scans: scans.find((s) => s.code_id === c.id)?.scans || 0,
      })),
    );
  }
  if (parts[1] === "bulk") {
    const input = z
      .object({ codes: z.array(z.unknown()).min(1).max(100) })
      .parse(await body(req));
    return json(
      await mutate(b, actor, async (doc) => {
        const result = [];
        for (const item of input.codes) {
          const c = await validatedCode(item, doc, SITE);
          doc.codes.push(c);
          result.push(c);
        }
        auditDoc(doc, actor, "code.created", { name: "Bulk import" });
        return result;
      }),
      201,
    );
  }
  if (parts[1] === "batch") {
    const input = z
      .object({
        ids: z.array(z.uuid()).min(1).max(100),
        action: z.enum(["delete", "pause", "resume", "move"]),
        folderId: z.string().nullable().optional(),
      })
      .parse(await body(req));
    return json(
      await mutate(b, actor, (doc) => {
        const selected = input.ids.map((id) => find(doc.codes, id));
        if (input.action === "delete")
          doc.codes = doc.codes.filter(
            (c) =>
              !input.ids.includes(c.id) && !input.ids.includes(c.data.itemOf),
          );
        else if (input.action === "move") {
          if (input.folderId) find(doc.folders, input.folderId, "Folder");
          selected.forEach((c) => (c.folderId = input.folderId || null));
        } else selected.forEach((c) => (c.active = input.action === "resume"));
        return { affected: selected.length };
      }),
    );
  }
  if (parts[2] === "download") {
    const c = find(d.codes, id, "QR code");
    return new Response(svgFor(c), {
      headers: {
        "content-type": "image/svg+xml",
        "content-disposition": `attachment; filename="openqr-${c.slug}.svg"`,
      },
    });
  }
  if (method === "GET") return json(find(d.codes, id, "QR code"));
  const input = method === "DELETE" ? {} : await body(req);
  return json(
    await mutate(b, actor, async (doc) => {
      if (method === "DELETE") {
        const c = find(doc.codes, id, "QR code");
        doc.codes = doc.codes.filter(
          (x) => x.id !== id && x.data.itemOf !== id,
        );
        delete doc.drafts[id];
        delete doc.versions[id];
        auditDoc(doc, actor, "code.deleted", { name: c.name });
        return { ok: true };
      }
      const old = id ? find(doc.codes, id, "QR code") : null;
      if (parts[2] === "duplicate") {
        const copy = await validatedCode(
          { ...old, slug: undefined, name: old.name.slice(0, 90) + " (copy)" },
          doc,
          SITE,
        );
        doc.codes.push(copy);
        return copy;
      }
      const code = await validatedCode(input, doc, SITE, old);
      if (old) doc.codes[doc.codes.findIndex((c) => c.id === id)] = code;
      else doc.codes.push(code);
      auditDoc(doc, actor, old ? "code.updated" : "code.created", {
        name: code.name,
        type: code.type,
      });
      return code;
    }),
    method === "POST" ? 201 : 200,
  );
}

async function experienceRoutes(parts, id, url, req, b, actor, d) {
  const code = find(d.codes, id, "Experience");
  if (code.type !== "experience" || code.data.itemOf)
    throw problem("Open the parent experience to manage this item.", 400);
  const method = req.method;
  const section = parts[0];
  const events = await b.db(
    "oq_events",
    `workspace_id=eq.${actor.workspace.id}&created_at=gte.${new Date(Date.now() - 365 * 86400000).toISOString()}&order=created_at.desc&limit=10000`,
  );
  const ids = new Set([
    id,
    ...d.codes.filter((c) => c.data.itemOf === id).map((c) => c.id),
  ]);
  const ownEvents = events.filter((e) => ids.has(e.code_id));
  if (section === "draft" && method === "GET")
    return json({
      ...(d.drafts[id] || {
        title: code.data.title,
        blocks: parseBlocks(code.data),
      }),
      dirty: !!d.drafts[id],
    });
  if (section === "versions" && method === "GET")
    return json(d.versions[id] || []);
  if (section === "settings" && method === "GET")
    return json({ timeZone: code.data.timeZone || "UTC" });
  if (section === "alerts" && method === "GET")
    return json({ available: false, emails: [] });
  if (section === "alerts")
    throw problem(
      "Response email alerts are not configured for the hosted beta yet.",
      409,
    );
  if (section === "submissions" || section === "submissions.csv") {
    const rows = ownEvents
      .filter((e) => e.kind === "submission")
      .map((e) => ({
        id: e.id,
        form: e.data.form,
        answers: e.data.answers,
        createdAt: e.created_at,
        read: !!e.data.read,
        item: d.codes.find((c) => c.id === e.code_id)?.data.itemOf
          ? d.codes.find((c) => c.id === e.code_id).name
          : undefined,
      }));
    if (section.endsWith(".csv"))
      return csvResponse(
        [
          ["Date", "Form", "Item", "Answers"],
          ...rows.map((s) => [
            s.createdAt,
            s.form,
            s.item || "",
            JSON.stringify(s.answers),
          ]),
        ],
        "responses",
      );
    if (method === "GET") return json(rows);
    if (!["owner", "admin", "editor"].includes(actor.workspace.role))
      throw problem("Edit permission required.", 403);
    if (parts[1] === "read") {
      for (const e of ownEvents.filter(
        (e) => e.kind === "submission" && !e.data.read,
      ))
        await b.db("oq_events", `id=eq.${e.id}`, "PATCH", {
          data: { ...e.data, read: true },
        });
      return json({ ok: true });
    }
    const event = ownEvents.find(
      (e) => String(e.id) === parts[1] && e.kind === "submission",
    );
    if (!event) throw problem("Response not found.", 404);
    if (method === "DELETE") {
      await b.db("oq_events", `id=eq.${event.id}`, "DELETE");
      return json({ ok: true });
    }
  }
  if (section === "stats") {
    const scans = ownEvents.filter((e) => e.kind === "scan").length,
      submissions = ownEvents.filter((e) => e.kind === "submission").length,
      taps = ownEvents.filter((e) => e.kind === "tap").length;
    const counts = new Map();
    for (const e of ownEvents.filter((e) => e.kind !== "scan")) {
      const label =
        (e.kind === "tap" ? "Tapped " : "Submitted ") +
        (e.data.label || e.data.form || "Form");
      counts.set(label, (counts.get(label) || 0) + 1);
    }
    return json({
      scans,
      submissions,
      taps,
      actionsPerScan: scans ? (taps + submissions) / scans : null,
      actions: [...counts].map(([label, count]) => ({ label, count })),
    });
  }
  if (section === "items") {
    const items = d.codes.filter((c) => c.data.itemOf === id);
    const format = (c) => ({
      id: c.id,
      slug: c.slug,
      name: c.name,
      serial: c.data.serial || "",
      warrantyUntil: c.data.warrantyUntil || "",
      shortUrl: c.shortUrl,
      scans: events.filter((e) => e.code_id === c.id && e.kind === "scan")
        .length,
      responses: events.filter(
        (e) => e.code_id === c.id && e.kind === "submission",
      ).length,
      service: d.service[c.id] || [],
    });
    if (method === "GET" && parts[1] === "labels")
      return new Response(
        `<!doctype html><html><head><meta charset="utf-8"><title>Item labels</title><style>body{font:14px system-ui;padding:10mm}.sheet{display:grid;grid-template-columns:repeat(3,1fr)}article{text-align:center;border:1px dashed #aaa;padding:6mm;break-inside:avoid}svg{width:35mm;height:35mm}small{display:block}@media print{p{display:none}@page{size:A4;margin:8mm}}</style></head><body><p>Print with Ctrl+P. Print at actual size.</p><div class="sheet">${items.map((c) => `<article>${svgFor(c)}<strong>${xml(c.name)}</strong><small>${xml(c.data.serial)}</small></article>`).join("")}</div></body></html>`,
        { headers: { "content-type": "text/html;charset=utf-8" } },
      );
    if (method === "GET") return json(items.map(format));
    const input = method === "DELETE" ? {} : await body(req);
    const result = await mutate(b, actor, async (doc) => {
      if (parts.length === 1) {
        const entries = z
          .array(
            z.object({
              name: z.string().trim().min(1).max(100),
              serial: z.string().max(80).default(""),
              warrantyUntil: z.union([z.iso.date(), z.literal("")]).default(""),
            }),
          )
          .min(1)
          .max(100)
          .parse(input.items);
        const made = [];
        for (const item of entries) {
          const c = await validatedCode(
            {
              ...code,
              slug: undefined,
              name: item.name,
              data: {
                ...code.data,
                title: item.name,
                itemOf: id,
                serial: item.serial,
                warrantyUntil: item.warrantyUntil,
              },
            },
            doc,
            SITE,
          );
          doc.codes.push(c);
          made.push(c);
        }
        return made.map((c) => ({
          ...c,
          serial: c.data.serial,
          warrantyUntil: c.data.warrantyUntil,
          service: [],
          responses: 0,
        }));
      }
      const item = find(doc.codes, parts[1], "Item");
      if (item.data.itemOf !== id) throw problem("Item not found.", 404);
      if (parts[2] === "service") {
        const history = doc.service[item.id] || [];
        if (method === "DELETE")
          doc.service[item.id] = history.filter(
            (e) => String(e.id) !== parts[3],
          );
        else {
          if (history.length >= 50)
            throw problem("Keep at most 50 service entries.");
          history.unshift({
            id: uid(),
            date: z.iso.date().parse(input.date),
            note: z.string().trim().min(1).max(2000).parse(input.note),
          });
          doc.service[item.id] = history;
        }
        return { ...format(item), service: doc.service[item.id] };
      }
      if (method === "DELETE") {
        doc.codes = doc.codes.filter((c) => c.id !== item.id);
        delete doc.service[item.id];
        return { ok: true };
      }
      item.name = z.string().trim().min(1).max(100).parse(input.name);
      item.data.title = item.name;
      item.data.serial = z
        .string()
        .max(80)
        .parse(input.serial || "");
      item.data.warrantyUntil = z
        .union([z.iso.date(), z.literal("")])
        .parse(input.warrantyUntil || "");
      return format(item);
    });
    return json(result, method === "POST" ? 201 : 200);
  }
  const input = method === "DELETE" ? {} : await body(req);
  return json(
    await mutate(b, actor, (doc) => {
      const live = find(doc.codes, id, "Experience");
      if (section === "draft") {
        if (method === "DELETE") {
          delete doc.drafts[id];
          return { ok: true };
        }
        const draft = z
          .object({
            title: z.string().trim().max(100),
            blocks: z
              .array(
                z
                  .object({ id: z.string().max(20), type: z.string().max(20) })
                  .loose(),
              )
              .max(30),
          })
          .parse(input);
        if (JSON.stringify(draft).length > 18000)
          throw problem("This page is too large.");
        doc.drafts[id] = draft;
        return { ...draft, dirty: true };
      }
      if (section === "settings") {
        if (!validZone(input.timeZone))
          throw problem("Choose a valid time zone.");
        live.data.timeZone = input.timeZone;
        return { ok: true, timeZone: input.timeZone };
      }
      if (section === "publish") {
        const draft = experienceSchema.parse(
          doc.drafts[id] || {
            title: live.data.title,
            blocks: parseBlocks(live.data),
          },
        );
        for (const asset of assetRefs({ blocks: JSON.stringify(draft.blocks) }))
          find(doc.assets, asset, "File");
        const versions = doc.versions[id] || [];
        if (!versions.length)
          versions.unshift({
            version: 1,
            title: live.data.title,
            blocks: parseBlocks(live.data),
            note: "Original version",
            createdAt: live.createdAt,
            by: actor.user.name,
          });
        const version = (versions[0]?.version || 0) + 1;
        versions.unshift({
          version,
          ...draft,
          note: z
            .string()
            .max(200)
            .parse(input.note || ""),
          createdAt: now(),
          by: actor.user.name,
        });
        doc.versions[id] = versions.slice(0, 50);
        live.data.title = draft.title;
        live.data.blocks = JSON.stringify(draft.blocks);
        delete doc.drafts[id];
        return { ok: true, version };
      }
      if (section === "versions" && parts[2] === "restore") {
        const v = (doc.versions[id] || []).find(
          (v) => String(v.version) === parts[1],
        );
        if (!v) throw problem("Version not found.", 404);
        doc.drafts[id] = { title: v.title, blocks: v.blocks };
        return { ...doc.drafts[id], dirty: true };
      }
      throw problem("Experience action not found.", 404);
    }),
  );
}

async function assetRoutes(parts, url, req, b, actor, d) {
  if (req.method === "GET" && parts.length === 1) return json(d.assets);
  if (parts[1] && req.method === "GET") {
    const asset = find(d.assets, parts[1], "File");
    const response = await b.storage("object/openqr-media/" + asset.key, {
      headers: req.headers.has("range")
        ? { range: req.headers.get("range") }
        : {},
    });
    const headers = new Headers(response.headers);
    headers.set("content-type", asset.mime);
    headers.set("content-security-policy", "sandbox; default-src 'none'");
    headers.set("x-content-type-options", "nosniff");
    return new Response(response.body, { status: response.status, headers });
  }
  if (req.method === "DELETE") {
    const asset = find(d.assets, parts[1], "File");
    await mutate(b, actor, (doc) => {
      const used =
        doc.codes.some((c) => assetRefs(c.data).includes(asset.id)) ||
        Object.values(doc.drafts).some((v) =>
          assetRefs({ blocks: JSON.stringify(v.blocks) }).includes(asset.id),
        ) ||
        Object.values(doc.versions)
          .flat()
          .some((v) =>
            assetRefs({ blocks: JSON.stringify(v.blocks) }).includes(asset.id),
          ) ||
        doc.pageTemplates.some((p) => assetRefs(p.data).includes(asset.id));
      if (used)
        throw problem(
          "This file is used by a page, draft, template or earlier version.",
          409,
        );
      doc.assets = doc.assets.filter((a) => a.id !== asset.id);
      return null;
    });
    await b.storage("object/openqr-media/" + asset.key, { method: "DELETE" });
    return json({ ok: true });
  }
  if (req.method !== "POST") return null;
  if (!["owner", "admin", "editor"].includes(actor.workspace.role))
    throw problem("Edit permission required.", 403);
  await b.rate("upload:" + actor.user.id, 10, 60);
  let bytes = await boundedBody(req, 20 * 1024 ** 2);
  if (!bytes.length) throw problem("Choose a file.");
  const id = uid();
  let kind,
    mime,
    ext,
    pages = null,
    metadata = {};
  const media = await inspectMedia(Buffer.from(bytes));
  if (media) ({ kind, mime, extension: ext, metadata } = media);
  else if (new TextDecoder().decode(bytes.slice(0, 5)) === "%PDF-") {
    try {
      const pdf = await PDFDocument.load(bytes, { updateMetadata: false });
      pages = pdf.getPageCount();
      if (!pages) throw new Error();
    } catch {
      throw problem("Choose a valid unencrypted PDF.");
    }
    kind = "pdf";
    mime = "application/pdf";
    ext = "pdf";
  } else {
    try {
      let image;
      if (bytes[0] === 137 && bytes[1] === 80) {
        const view = new DataView(
          bytes.buffer,
          bytes.byteOffset,
          bytes.byteLength,
        );
        if (view.getUint32(16) * view.getUint32(20) > 4_000_000)
          throw new Error();
        image = PNG.sync.read(Buffer.from(bytes));
      } else if (bytes[0] === 255 && bytes[1] === 216)
        image = jpeg.decode(bytes, {
          maxResolutionInMP: 4,
          maxMemoryUsageInMB: 64,
          useTArray: true,
        });
      else throw new Error();
      if (image.width * image.height > 4_000_000) throw new Error();
      // Re-encode images to remove metadata and reject active formats.
      bytes = PNG.sync.write(image);
      kind = url.searchParams.get("kind") === "logo" ? "logo" : "image";
      mime = "image/png";
      ext = "png";
      metadata = { width: image.width, height: image.height };
      if (kind === "logo" && (image.width > 128 || image.height > 128))
        throw problem("Resize logos to 128 pixels or less before uploading.");
    } catch (e) {
      if (e.domain) throw e;
      throw problem("Choose a PNG or JPEG image up to 4 million pixels.");
    }
  }
  if (url.searchParams.get("kind") === "logo" && kind !== "logo")
    throw problem("Choose a PNG or JPEG logo.");
  const key = actor.workspace.id + "/" + id + "." + ext;
  let name;
  try {
    name = decodeURIComponent(
      req.headers.get("x-file-name") || "Uploaded file",
    );
  } catch {
    throw problem("Invalid file name.");
  }
  name = name.replace(/[\x00-\x1f\/\\]/g, "").slice(0, 180) || "Uploaded file";
  const asset = {
    id,
    name,
    kind,
    mime,
    size: bytes.length,
    pages,
    metadata,
    key,
    createdAt: now(),
    url: `/api/assets/${id}/content`,
  };
  await b.storage("object/openqr-media/" + key, {
    method: "POST",
    headers: { "content-type": mime },
    body: bytes,
  });
  try {
    await mutate(b, actor, (doc) => {
      doc.assets.push(asset);
      return null;
    });
  } catch (e) {
    await b.storage("object/openqr-media/" + key, { method: "DELETE" });
    throw e;
  }
  return json(asset, 201);
}

async function supportRoutes(path, req, b, actor) {
  // Support content is kept out of the staff overview; only the dedicated case API reads it.
  if (path === "/support/requests" && req.method === "GET") {
    const events = await b.db(
      "oq_events",
      `workspace_id=eq.${actor.workspace.id}&kind=eq.submission&data->>support=eq.true&order=created_at.desc&limit=50`,
    );
    return json(
      events.map((e) => ({
        number: e.id,
        subject: e.data.subject,
        category: e.data.category,
        status: e.data.status || "open",
        updatedAt: e.data.updatedAt || e.created_at,
        createdAt: e.created_at,
        unread: false,
      })),
    );
  }
  if (path === "/support/requests" && req.method === "POST") {
    await b.rate("support:" + actor.user.id, 10, 3600);
    const raw = await body(req);
    const input = z
      .object({
        subject: z.string().trim().min(1).max(150),
        category: z.enum([
          "billing",
          "subscription",
          "account",
          "technical",
          "other",
        ]),
        body: z.string().trim().min(1).max(5000),
      })
      .parse({ ...raw, body: raw.message ?? raw.body });
    const [event] = await b.db("oq_events", "", "POST", {
      workspace_id: actor.workspace.id,
      code_id: actor.workspace.id,
      kind: "submission",
      data: {
        support: true,
        ...input,
        author: actor.user.name,
        authorId: actor.user.id,
      },
    });
    return json({ number: event.id }, 201);
  }
  const number = Number(path.split("/")[3]);
  if (!Number.isSafeInteger(number)) throw problem("Request not found.", 404);
  const event = (
    await b.db(
      "oq_events",
      `id=eq.${number}&workspace_id=eq.${actor.workspace.id}`,
    )
  )[0];
  if (!event?.data.support) throw problem("Request not found.", 404);
  if (path.endsWith("/replies") && req.method === "POST") {
    await b.rate("support:" + actor.user.id, 10, 3600);
    const input = z
      .object({ message: z.string().trim().min(1).max(2000) })
      .parse(await body(req));
    await b.rpc("oq_case_note", {
      p_event: number,
      p_actor: actor.user.id,
      p_body: input.message,
      p_visibility: "public",
    });
    return json({ ok: true });
  }
  if (req.method !== "GET") throw problem("Request not found.", 404);
  return json({
    number: event.id,
    subject: event.data.subject,
    category: event.data.category,
    status: event.data.status || "open",
    createdAt: event.created_at,
    updatedAt: event.data.updatedAt || event.created_at,
    replies: [
      {
        id: event.id,
        body: event.data.body,
        at: event.created_at,
        you: event.data.authorId === actor.user.id,
      },
      ...list(event.data.notes)
        .filter((n) => n.visibility === "public")
        .map((n) => ({ ...n, you: n.authorId === actor.user.id })),
    ],
  });
}

function available(code) {
  const c = code.campaign || {};
  const n = Date.now();
  if (!code.active) throw problem("This QR code is paused.", 410);
  if (c.startsAt && n < +new Date(c.startsAt))
    throw problem("This campaign has not started yet.", 423);
  if (c.expiresAt && n >= +new Date(c.expiresAt))
    throw problem("This campaign has ended.", 410);
}
async function publicRoutes(path, url, req, b, site) {
  try {
    const parts = path.split("/").filter(Boolean);
    const slug = parts[1];
    if (!/^[a-zA-Z0-9_-]{3,60}$/.test(slug))
      throw problem("QR code not found.", 404);
    await b.rate("public:" + req.headers.get("x-openqr-ip"), 120, 60);
    const published = (await b.db("oq_published", `slug=eq.${slug}`))[0];
    if (!published) throw problem("QR code not found.", 404);
    let code = published.code;
    available(code);
    const state = (
      await b.db("oq_workspaces", `id=eq.${published.workspace_id}`)
    )[0];
    if (!state) throw problem("QR code not found.", 404);
    const owner = (await b.db("oq_accounts", `id=eq.${state.owner_id}`))[0];
    if (owner?.suspended) throw problem("This page is unavailable.", 410);
    let item = null;
    if (code.data.itemOf) {
      const parent = state.document.codes.find(
        (c) => c.id === code.data.itemOf,
      );
      if (!parent) throw problem("This item is unavailable.", 404);
      available(parent);
      item = {
        name: code.name,
        serial: code.data.serial || "",
        warrantyUntil: code.data.warrantyUntil || "",
        history: state.document.service[code.id] || [],
      };
      code = { ...code, data: { ...parent.data, title: code.name } };
    }
    let ticket = url.searchParams.get("ticket");
    const mediaUrl = (id) =>
      `/r/${slug}/media/${id}?ticket=${encodeURIComponent(ticket)}`;
    if (parts[2] === "media" || parts[2] === "document") {
      if (!(await b.validTicket(ticket, code.id)))
        throw problem("Reopen the QR page to load this file.", 403);
      if (!assetRefs(code.data).includes(parts[3]))
        throw problem("File not found.", 404);
      const asset = find(state.document.assets, parts[3], "File");
      const raw = await b.storage("object/openqr-media/" + asset.key, {
        headers: req.headers.has("range")
          ? { range: req.headers.get("range") }
          : {},
      });
      const headers = new Headers(raw.headers);
      headers.set("content-type", asset.mime);
      headers.set("content-security-policy", "sandbox; default-src 'none'");
      headers.set(
        "content-disposition",
        `inline; filename="file.${asset.mime.split("/")[1]}"`,
      );
      return new Response(raw.body, { status: raw.status, headers });
    }
    if (parts[2] === "contact.vcf" || parts[2] === "event.ics") {
      if (!(await b.validTicket(ticket, code.id)))
        throw problem("Reopen the QR page.", 403);
      return new Response(
        parts[2] === "contact.vcf"
          ? contactCard(code.data)
          : calendarEvent(code.data),
        {
          headers: {
            "content-type":
              parts[2] === "contact.vcf" ? "text/vcard" : "text/calendar",
            "content-disposition": `attachment; filename="${parts[2]}"`,
          },
        },
      );
    }
    if (code.type !== "experience" && parts.length > 2)
      throw problem("Page not found.", 404);
    const blocks = code.type === "experience" ? parseBlocks(code.data) : [];
    const render = (options = {}) =>
      new Response(
        renderExperience(
          {
            title: code.data.title,
            blocks,
            slug: code.slug,
            pageOptions: code.pageOptions,
            ticket,
          },
          { mediaUrl, zone: code.data.timeZone || "UTC", item, ...options },
        ),
        {
          headers: {
            "content-type": "text/html;charset=utf-8",
            "content-security-policy":
              "default-src 'none'; img-src 'self' data:; media-src 'self'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'self'",
          },
        },
      );
    if (parts[2] === "go") {
      if (!(await b.validTicket(ticket, code.id)))
        throw problem("Reopen the QR page before following this link.", 403);
      const block = blocks.find((x) => x.id === parts[3]);
      if (!block || !isVisible(block, new Date(), code.data.timeZone))
        throw problem("Link not found.", 404);
      const index = Number(url.searchParams.get("i") || 0);
      const link = block.type === "links" ? block.items[index] : block;
      if (!link?.url) throw problem("Link not found.", 404);
      await b.db("oq_events", "", "POST", {
        workspace_id: published.workspace_id,
        code_id: code.id,
        kind: "tap",
        data: { label: link.label },
      });
      return Response.redirect(link.url, 302);
    }
    if (parts[2] === "submit" && req.method === "POST") {
      await b.rate("form:" + req.headers.get("x-openqr-ip"), 10, 3600);
      const encoded = await boundedBody(req, 32768);
      const values = Object.fromEntries(
        new URLSearchParams(new TextDecoder().decode(encoded)),
      );
      if (!(await b.validTicket(values.ticket, code.id)))
        throw problem("This form has expired. Reopen the QR page.", 403);
      ticket = values.ticket;
      const block = blocks.find((x) => x.id === parts[3] && x.type === "form");
      if (!block || !isVisible(block, new Date(), code.data.timeZone))
        throw problem("Form not found.", 404);
      if (values.website) return render({ sent: block.id });
      const result = formAnswers(block, values, item);
      if (result.error)
        return render({
          error: { block: block.id, message: result.error },
          values,
        });
      if (!result.filled)
        return render({
          error: { block: block.id, message: "Please fill in the form." },
          values,
        });
      const recent = await b.db(
        "oq_events",
        `code_id=eq.${code.id}&kind=eq.submission&created_at=gte.${new Date(Date.now() - 60000).toISOString()}&limit=100`,
      );
      if (
        !recent.some(
          (e) =>
            e.data.blockId === block.id &&
            JSON.stringify(e.data.answers) === JSON.stringify(result.answers),
        )
      )
        await b.rpc("oq_submit", {
          p_workspace: published.workspace_id,
          p_code: code.id,
          p_data: {
            blockId: block.id,
            form: block.title,
            answers: result.answers,
          },
        });
      return render({ sent: block.id });
    }
    if (!["GET", "HEAD"].includes(req.method))
      throw problem("Method not allowed.", 405);
    if (parts.length > 2) throw problem("Page not found.", 404);
    if (req.method === "GET") {
      const ua = req.headers.get("user-agent") || "";
      let referrer = "Direct";
      try {
        referrer = new URL(req.headers.get("referer")).hostname;
      } catch {}
      const data = {
        device: /iPad|Tablet/i.test(ua)
          ? "Tablet"
          : /Mobile|Android|iPhone/i.test(ua)
            ? "Mobile"
            : "Desktop",
        browser: /Firefox/i.test(ua)
          ? "Firefox"
          : /Edg\//.test(ua)
            ? "Edge"
            : /Chrome/.test(ua)
              ? "Chrome"
              : /Safari/.test(ua)
                ? "Safari"
                : "Other",
        os: /Android/.test(ua)
          ? "Android"
          : /iPhone|iPad/.test(ua)
            ? "iOS"
            : /Windows/.test(ua)
              ? "Windows"
              : /Mac/.test(ua)
                ? "macOS"
                : "Other",
        referrer,
        visitor: await b.fingerprint(
          now().slice(0, 10) + "|" + req.headers.get("x-openqr-ip") + "|" + ua,
        ),
      };
      await b.rpc("oq_public_visit", { p_slug: slug, p_data: data });
    }
    ticket = await b.ticket(code.id);
    if (code.type === "url") return Response.redirect(destination(code), 302);
    if (code.type === "app" && code.data.routing === "smart")
      return Response.redirect(
        appDestination(code.data, req.headers.get("user-agent") || ""),
        302,
      );
    if (code.type === "links")
      return new Response(linksPage(code), {
        headers: { "content-type": "text/html;charset=utf-8" },
      });
    if (code.type === "experience") return render();
    // The existing PDF page's viewer link is served as a direct, ticketed document in the beta.
    let html = hostedPage(code, state.document.assets, ticket);
    html = html.replaceAll(`/view/${slug}/`, `/r/${slug}/document/`);
    return new Response(html, {
      headers: { "content-type": "text/html;charset=utf-8" },
    });
  } catch (e) {
    if (e.domain)
      return new Response(unavailablePage(e.message), {
        status: e.status || 400,
        headers: { "content-type": "text/html;charset=utf-8" },
      });
    throw e;
  }
}

async function adminRoutes(path, url, req, b, actor) {
  const role = staffRoles.find((r) => r.id === actor.staff);
  const allow = (permission) => {
    if (!role?.permissions.includes(permission))
      throw problem("Your staff role does not allow this action.", 403);
  };
  allow("overview:read");
  const permission =
    path.startsWith("/operator/plans") || path.includes("/plan")
      ? "billing:manage"
      : path.includes("/accounts/")
        ? "entitlements:override"
        : path.includes("/audit")
          ? "audit:read"
          : path.includes("/cases")
            ? "cases:manage"
            : path.includes("/staff")
              ? "staff:manage"
              : path.includes("/users")
                ? "users:read"
                : path.includes("/customers")
                  ? "workspaces:read"
                  : path.includes("/workspaces")
                    ? "workspaces:read"
                    : path.includes("/backups")
                      ? "backup:create"
                      : "overview:read";
  allow(permission);
  const parts = path.split("/").filter(Boolean),
    method = req.method;
  const [accounts, workspaces, grants, staff] = await Promise.all([
    b.db("oq_accounts"),
    b.db("oq_workspaces"),
    b.db("oq_grants"),
    b.db("oq_staff"),
  ]);
  const accountMap = new Map(accounts.map((a) => [a.id, a]));
  const page = Math.max(
    0,
    Math.min(10000, Number(url.searchParams.get("page") || 0)),
  );
  const query = (url.searchParams.get("q") || "").slice(0, 100).toLowerCase();
  const matches = (...values) =>
    values.some((v) =>
      String(v || "")
        .toLowerCase()
        .includes(query),
    );
  const listing = (rows) => ({
    rows: rows.slice(page * 25, (page + 1) * 25),
    total: rows.length,
    page,
    pageSize: 25,
  });
  const audit = async (action, type, id, reason) =>
    b.db("oq_staff_audit", "", "POST", {
      actor_id: actor.user.id,
      action,
      target_type: type,
      target_id: id,
      reason,
    });
  if (parts[1] === "accounts" && parts[3] === "access" && method === "POST") {
    const input = z
      .object({
        tier: z.enum(["free", "plus", "pro", "unlimited", "inherit"]),
        password: z.string().min(1).max(128),
        reason: z.string().trim().min(5).max(500),
      })
      .parse(await body(req));
    await b.rate("admin-password:" + actor.user.id, 10, 900);
    await reauthenticate(b, actor, input.password);
    find(accounts, parts[2], "Account");
    await b.rpc("oq_grant", {
      p_actor: actor.user.id,
      p_target: parts[2],
      p_tier: input.tier,
      p_reason: input.reason,
    });
    return json({ ok: true });
  }
  if (parts[1] === "plans") {
    const rows = [];
    for (const w of workspaces.filter((w) =>
      matches(w.name, accountMap.get(w.owner_id)?.name),
    )) {
      rows.push({
        id: w.id,
        name: w.name,
        ownerId: w.owner_id,
        ownerName: accountMap.get(w.owner_id)?.name || "Account",
        accountAccess: grants.find((g) => g.user_id === w.owner_id) || null,
        ...(await billing(b, w, w.document)),
      });
    }
    return json({
      ...listing(rows),
      plans: (
        await billing(b, workspaces[0] || { owner_id: actor.user.id }, {
          codes: [],
          assets: [],
        })
      ).plans,
      hosted: true,
      currency: "INR",
      canGrantAccountAccess: actor.staff === "super_admin",
    });
  }
  if (parts[1] === "workspaces" && parts[3] === "plan")
    throw problem(
      "Use Account access to grant a plan to the workspace owner.",
      409,
    );
  if (path === "/operator/workspaces")
    return json(
      listing(
        workspaces
          .filter((w) => matches(w.name, accountMap.get(w.owner_id)?.name))
          .map((w) => ({
            id: w.id,
            name: w.name,
            ownerName: accountMap.get(w.owner_id)?.name || "Account",
            members: 1,
            codes: w.document.codes.length,
            scans: 0,
            mediaBytes: w.document.assets.reduce((n, a) => n + a.size, 0),
            createdAt: w.created_at,
          })),
      ),
    );
  if (path === "/operator/users")
    return json(
      listing(
        accounts
          .filter((a) => matches(a.name))
          .map((a) => ({
            id: a.id,
            name: a.name,
            email: "Hidden",
            workspaces: workspaces.filter((w) => w.owner_id === a.id).length,
            sessions: 0,
            operator: staff.some((s) => s.user_id === a.id),
          })),
      ),
    );
  if (parts[1] === "users" && parts[3] === "suspension" && method === "POST") {
    allow("accounts:manage");
    const input = z
      .object({
        suspended: z.boolean(),
        password: z.string().min(1),
        reason: z.string().trim().min(5).max(500),
      })
      .parse(await body(req));
    if (staff.some((s) => s.user_id === parts[2]))
      throw problem("Company staff accounts cannot be suspended here.", 403);
    await reauthenticate(b, actor, input.password);
    await b.db("oq_accounts", `id=eq.${z.uuid().parse(parts[2])}`, "PATCH", {
      suspended: input.suspended,
    });
    await audit(
      input.suspended ? "account.suspended" : "account.restored",
      "account",
      parts[2],
      input.reason,
    );
    return json({ ok: true });
  }
  if (path === "/operator/audit") {
    const events = await b.db(
      "oq_staff_audit",
      "order=created_at.desc&limit=1000",
    );
    return json(
      listing(
        events.map((e) => ({
          id: e.id,
          action: e.action,
          targetType: e.target_type,
          targetId: e.target_id,
          reason: e.reason,
          at: e.created_at,
          actor: accountMap.get(e.actor_id)?.name || "Service",
        })),
      ),
    );
  }
  if (parts[1] === "staff") {
    if (method === "GET")
      return json(
        staff.map((s) => ({
          id: s.user_id,
          name: accountMap.get(s.user_id)?.name || "Account",
          email: "Staff account",
          role: s.role,
        })),
      );
    throw problem(
      "Additional staff provisioning is not open in this beta yet.",
      409,
    );
  }
  if (path === "/operator/cases/attention") {
    const cases = await b.db(
      "oq_events",
      "kind=eq.submission&data->>support=eq.true&limit=1000",
    );
    return json({
      count: cases.filter(
        (e) => !["resolved", "closed"].includes(e.data.status || "open"),
      ).length,
    });
  }
  if (path === "/operator/cases") {
    const cases = await b.db(
      "oq_events",
      "kind=eq.submission&data->>support=eq.true&order=created_at.desc&limit=1000",
    );
    return json(
      listing(
        cases.map((e) => ({
          number: e.id,
          workspace:
            workspaces.find((w) => w.id === e.workspace_id)?.name ||
            "Workspace",
          workspaceId: e.workspace_id,
          category: e.data.category,
          priority: e.data.priority || "normal",
          status: e.data.status || "open",
          subject: e.data.subject,
          updatedAt: e.data.updatedAt || e.created_at,
          assignee: accountMap.get(e.data.assignedTo)?.name || null,
        })),
      ),
    );
  }
  if (parts[1] === "cases" && parts[2]) {
    const e = (await b.db("oq_events", `id=eq.${Number(parts[2])}`))[0];
    if (!e?.data.support) throw problem("Case not found.", 404);
    if (parts[3] === "notes" && method === "POST") {
      const input = z
        .object({
          body: z.string().trim().min(1).max(2000),
          visibility: z.enum(["public", "internal"]),
        })
        .parse(await body(req));
      await b.rpc("oq_case_note", {
        p_event: e.id,
        p_actor: actor.user.id,
        p_body: input.body,
        p_visibility: input.visibility,
      });
      await audit(
        "case.note",
        "case",
        String(e.id),
        "Added " + input.visibility + " note",
      );
      return json({ ok: true });
    }
    if (method === "PATCH") {
      const input = z
        .object({
          status: z.enum(["open", "pending", "resolved", "closed"]).optional(),
          priority: z.enum(["low", "normal", "high"]).optional(),
          assign: z.enum(["me", "none"]).optional(),
        })
        .parse(await body(req));
      await b.rpc("oq_case_update", {
        p_event: e.id,
        p_actor: actor.user.id,
        p_patch: {
          ...input,
          ...(input.assign
            ? { assignedTo: input.assign === "me" ? actor.user.id : null }
            : {}),
        },
      });
      await audit(
        "case.updated",
        "case",
        String(e.id),
        "Updated case settings",
      );
      return json({ ok: true });
    }
    return json({
      number: e.id,
      workspace:
        workspaces.find((w) => w.id === e.workspace_id)?.name || "Workspace",
      workspaceId: e.workspace_id,
      category: e.data.category,
      priority: e.data.priority || "normal",
      status: e.data.status || "open",
      subject: e.data.subject,
      updatedAt: e.data.updatedAt || e.created_at,
      createdAt: e.created_at,
      assignedTo: e.data.assignedTo || null,
      assignee: accountMap.get(e.data.assignedTo)?.name || null,
      contact: null,
      notes: [
        {
          id: e.id,
          body: e.data.body,
          visibility: "public",
          at: e.created_at,
          author: e.data.author,
        },
        ...list(e.data.notes),
      ],
    });
  }
  if (parts[1] === "customers" && parts[2]) {
    const w = find(workspaces, parts[2], "Workspace");
    const a = accountMap.get(w.owner_id);
    await audit(
      "customer.viewed",
      "workspace",
      w.id,
      "Customer account lookup",
    );
    return json({
      id: w.id,
      name: w.name,
      createdAt: w.created_at,
      members: [
        {
          id: a.id,
          name: a.name,
          email: "Hidden",
          role: "owner",
          owner: true,
          suspended: a.suspended,
          staff: staff.some((s) => s.user_id === a.id),
        },
      ],
      cases: [],
      billing: await billing(b, w, w.document),
      canReveal: false,
      canManageAccounts: actor.staff === "super_admin",
      canManageCases: role.permissions.includes("cases:manage"),
      canManageBilling: role.permissions.includes("billing:manage"),
    });
  }
  if (path === "/operator/overview") {
    const scans = await b.db(
      "oq_events",
      "kind=eq.scan&select=id,created_at&limit=10000",
    );
    const codes = workspaces.flatMap((w) => w.document.codes);
    const assets = workspaces.flatMap((w) => w.document.assets);
    const day = now().slice(0, 10);
    const daily = Array.from({ length: 30 }, (_, i) => {
      const date = new Date(Date.now() - (29 - i) * 86400000)
        .toISOString()
        .slice(0, 10);
      return {
        date,
        scans: scans.filter((s) => s.created_at.slice(0, 10) === date).length,
      };
    });
    const types = [...new Set(codes.map((c) => c.type))].map((type) => ({
      type,
      count: codes.filter((c) => c.type === type).length,
    }));
    return json({
      access: {
        role: role.id,
        label: role.label,
        permissions: role.permissions,
      },
      at: now(),
      refreshSeconds: 5,
      totals: {
        users: accounts.length,
        workspaces: workspaces.length,
        codes: codes.length,
        scans: scans.length,
        scans24h: scans.filter(
          (s) => Date.now() - new Date(s.created_at) < 86400000,
        ).length,
        scans15m: scans.filter(
          (s) => Date.now() - new Date(s.created_at) < 900000,
        ).length,
        sessions: await b.rpc("oq_session_count", {}),
        mediaBytes: assets.reduce((n, a) => n + a.size, 0),
        mediaFiles: assets.length,
        paused: codes.filter((c) => !c.active).length,
      },
      daily,
      hourly: [],
      types,
      roles: staffRoles.map((r) => ({
        role: r.label,
        count: staff.filter((s) => s.role === r.id).length,
      })),
      events: [],
      operatorEvents: [],
      operations: role.permissions.includes("operations:read")
        ? {
            uptimeSeconds: 0,
            storageBackend: "Supabase",
            workspaceQuotaBytes: 10 * 1024 ** 2,
            maxUploadBytes: 20 * 1024 ** 2,
            publicUrl: SITE,
            backup: {
              state: "unavailable",
              intervalHours: null,
              retention: null,
              remoteEnabled: false,
              available: false,
            },
          }
        : null,
    });
  }
  if (path === "/operator/activity") return json(listing([]));
  if (path === "/operator/backups")
    throw problem(
      "Hosted backup exports are not available in this beta yet.",
      409,
    );
  return null;
}
