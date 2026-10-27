// RFC 5545 content shared by the live preview and exported QR payload.
export function calendarEvent(data) {
  const format = (value) =>
    new Date(value)
      .toISOString()
      .replace(/[-:]/g, "")
      .replace(/\.\d{3}/, "");
  const escape = (value = "") =>
    value
      .replace(/\\/g, "\\\\")
      .replace(/\r?\n/g, "\\n")
      .replace(/([;,])/g, "\\$1");
  let hash = 2166136261;
  for (const ch of `${data.title}|${data.startsAt}|${data.endsAt}`)
    hash = Math.imul(hash ^ ch.codePointAt(0), 16777619);
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//OpenQR//EN",
    "BEGIN:VEVENT",
    `UID:${(hash >>> 0).toString(16)}@openqr.local`,
    `DTSTAMP:${format(data.startsAt)}`,
    `SUMMARY:${escape(data.title)}`,
    `DTSTART:${format(data.startsAt)}`,
    `DTEND:${format(data.endsAt)}`,
    `LOCATION:${escape(data.location)}`,
    `DESCRIPTION:${escape(data.description)}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  const encoder = new TextEncoder();
  return lines
    .map((line) => {
      let current = "",
        count = 0;
      const folded = [];
      for (const ch of line) {
        const bytes = encoder.encode(ch).length;
        if (count + bytes > 75) {
          folded.push(current);
          current = " ";
          count = 1;
        }
        current += ch;
        count += bytes;
      }
      folded.push(current);
      return folded.join("\r\n");
    })
    .join("\r\n");
}
