export function contactCard(d) {
  const esc = (s = "") =>
    s
      .replace(/\\/g, "\\\\")
      .replace(/\r\n|\r|\n/g, "\\n")
      .replace(/([;,])/g, "\\$1");
  const lines = [
    "BEGIN:VCARD",
    "VERSION:3.0",
    `FN:${esc(d.fullName)}`,
    `N:;${esc(d.fullName)};;;`,
    `ORG:${esc(d.company)}`,
    `TITLE:${esc(d.jobTitle)}`,
    `TEL;TYPE=CELL:${esc(d.phone)}`,
    `EMAIL:${esc(d.email)}`,
  ];
  if (d.website) lines.push(`URL:${esc(d.website)}`);
  if (d.address) lines.push(`ADR;TYPE=WORK:;;${esc(d.address)};;;;`);
  if (d.description) lines.push(`NOTE:${esc(d.description)}`);
  lines.push("END:VCARD");
  const encoder = new TextEncoder();
  const fold = (line) => {
    let result = "",
      length = 0;
    for (const char of line) {
      const bytes = encoder.encode(char).length;
      if (length + bytes > 75) {
        result += "\r\n ";
        length = 1;
      }
      result += char;
      length += bytes;
    }
    return result;
  };
  return lines.map(fold).join("\r\n") + "\r\n";
}
