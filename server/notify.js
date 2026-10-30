import nodemailer from "nodemailer";

// Optional outbound support alerts. Messages never include request text: they only say
// that something needs attention, so private details stay inside the signed-in app.
export function createNotifier(options = {}, publicUrl = "") {
  const { smtpUrl, from, staffEmails = [], webhookUrl } = options;
  const mailer = smtpUrl ? nodemailer.createTransport(smtpUrl) : null;
  const sender = from || "OpenQR <no-reply@localhost>";
  const warn = (what, error) =>
    console.warn(
      `Support notification (${what}) failed: ${error?.code || error?.name || "error"}`,
    );
  const mail = (to, subject, text) =>
    mailer
      ? mailer
          .sendMail({ from: sender, to, subject, text })
          .catch((e) => warn("email", e))
      : Promise.resolve();
  const hook = (text) =>
    webhookUrl
      ? fetch(webhookUrl, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ text }),
          signal: AbortSignal.timeout(5000),
        })
          .then((res) => {
            if (!res.ok) warn("webhook", { code: res.status });
          })
          .catch((e) => warn("webhook", e))
      : Promise.resolve();
  return {
    enabled: !!(mailer || webhookUrl),
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
