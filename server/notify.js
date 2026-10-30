import { createHmac } from "node:crypto";
import nodemailer from "nodemailer";

// Optional outbound support alerts. Messages never include request text: they only say
// that something needs attention, so private details stay inside the signed-in app.
export function createNotifier(options = {}, publicUrl = "") {
  const {
    smtpUrl,
    from,
    staffEmails = [],
    webhookUrl,
    webhookSecret = "",
    retryDelayMs = 500,
    attempts = 3,
  } = options;
  const mailer = smtpUrl ? nodemailer.createTransport(smtpUrl) : null;
  const sender = from || "OpenQR <no-reply@localhost>";
  const warn = (what, error) =>
    console.warn(
      `Support notification (${what}) failed: ${error?.code || error?.name || "error"}`,
    );
  // Delivery is retried with exponential backoff and jitter; the last failure is logged.
  const retry = async (what, job) => {
    for (let attempt = 1; ; attempt++) {
      try {
        return await job();
      } catch (error) {
        if (attempt >= attempts || error?.permanent) return warn(what, error);
        const wait = retryDelayMs * 2 ** (attempt - 1);
        await new Promise((r) => setTimeout(r, wait + Math.random() * wait * 0.25));
      }
    }
  };
  const mail = (to, subject, text) =>
    mailer
      ? retry("email", () => mailer.sendMail({ from: sender, to, subject, text }))
      : Promise.resolve();
  const hook = (text) =>
    webhookUrl
      ? retry("webhook", async () => {
          const body = JSON.stringify({ text }),
            timestamp = String(Math.floor(Date.now() / 1000));
          const res = await fetch(webhookUrl, {
            method: "POST",
            headers: {
              "content-type": "application/json",
              ...(webhookSecret
                ? {
                    "x-openqr-timestamp": timestamp,
                    // Receivers verify HMAC-SHA256 of `${timestamp}.${body}`.
                    "x-openqr-signature": `sha256=${createHmac("sha256", webhookSecret).update(`${timestamp}.${body}`).digest("hex")}`,
                  }
                : {}),
            },
            body,
            signal: AbortSignal.timeout(5000),
          });
          // A client error will not improve on retry; a server error might.
          if (res.status >= 400 && res.status < 500)
            throw Object.assign(new Error("rejected"), { code: res.status, permanent: true });
          if (!res.ok) throw Object.assign(new Error("failed"), { code: res.status });
        })
      : Promise.resolve();
  return {
    enabled: !!(mailer || webhookUrl),
    canEmail: !!mailer,
    // Tells a page owner a form was answered. Answers are never included.
    formAlert: (emails, page, form, url) =>
      mail(
        emails,
        `New response on ${page}`,
        `Someone answered "${form}" on your OpenQR page "${page}".

Open it to read the response: ${url}
`,
      ),
    // Resolves when delivery was attempted; never rejects.
    customerReply: (email, number) =>
      mail(
        email,
        `New reply on your OpenQR support request SUP-${number}`,
        `Support replied to your request SUP-${number}.\n\nSign in to read it: ${publicUrl}/\nOpen Workspace settings, then Support.\n`,
      ),
    staffAlert: (kind, number, workspace) => {
      const text = `${kind === "new" ? "New support request" : "Customer reply on"} SUP-${number} (${workspace}). Open the Control room to respond: ${publicUrl}/control-room`;
      return Promise.all([
        staffEmails.length
          ? mail(
              staffEmails,
              `OpenQR support: SUP-${number} needs a reply`,
              text,
            )
          : null,
        hook(text),
      ]);
    },
  };
}
