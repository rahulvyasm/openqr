const UPSTREAM =
  "https://abicsqdzzocayiquvepy.supabase.co/functions/v1/openqr-api";
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (
      url.pathname.startsWith("/api/") ||
      url.pathname.startsWith("/r/") ||
      url.pathname === "/health/ready"
    ) {
      if (!env.GATEWAY_TOKEN)
        return Response.json(
          { error: "Hosted service is not configured." },
          { status: 503 },
        );
      const headers = new Headers(request.headers);
      headers.delete("authorization");
      headers.set("x-openqr-site", url.origin);
      headers.set(
        "x-openqr-ip",
        request.headers.get("cf-connecting-ip") || "unknown",
      );
      headers.set("x-openqr-gateway", env.GATEWAY_TOKEN);
      const response = await fetch(UPSTREAM + url.pathname + url.search, {
        method: request.method,
        headers,
        body: ["GET", "HEAD"].includes(request.method)
          ? undefined
          : request.body,
        redirect: "manual",
      });
      return new Response(response.body, {
        status: response.status,
        headers: response.headers,
      });
    }
    let response = await env.ASSETS.fetch(request);
    if (
      response.status === 404 &&
      !url.pathname.split("/").at(-1).includes(".")
    )
      response = await env.ASSETS.fetch(
        new Request(new URL("/index.html", url), request),
      );
    const headers = new Headers(response.headers);
    headers.set("X-Content-Type-Options", "nosniff");
    headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
    headers.set(
      "Content-Security-Policy",
      "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self' blob:; font-src 'self' data:; connect-src 'self'; frame-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'self'",
    );
    return new Response(response.body, { status: response.status, headers });
  },
};
