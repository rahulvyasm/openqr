import { createHmac, timingSafeEqual } from "node:crypto";
export function publicTicket(codeId, secret, minutes = 15) {
  const expires = Date.now() + Math.min(25 * 60, Math.max(1, minutes)) * 60000;
  return `${expires}.${createHmac("sha256", secret).update(`${codeId}|${expires}`).digest("hex")}`;
}
export function validPublicTicket(token, codeId, secret) {
  if (typeof token !== "string" || !/^\d{13}\.[a-f0-9]{64}$/.test(token))
    return false;
  const [expires, mac] = token.split(".");
  if (
    Number(expires) <= Date.now() ||
    Number(expires) > Date.now() + 25 * 60 * 60000 + 60000
  )
    return false;
  return timingSafeEqual(
    Buffer.from(mac, "hex"),
    createHmac("sha256", secret).update(`${codeId}|${expires}`).digest(),
  );
}
export function availability(code, { ignoreCap = false } = {}) {
  const now = Date.now(),
    c = code.campaign || {};
  if (!code.active)
    return { status: 410, message: "This QR code is currently paused." };
  if (c.startsAt && now < +new Date(c.startsAt))
    return {
      status: 423,
      message: "This campaign has not started yet. Please try again later.",
    };
  if (c.expiresAt && now >= +new Date(c.expiresAt))
    return { status: 410, message: "This campaign has ended." };
  if (!ignoreCap && c.scanLimit && code.scans >= c.scanLimit)
    return {
      status: 410,
      message: "This campaign has reached its scan limit.",
    };
  return null;
}
