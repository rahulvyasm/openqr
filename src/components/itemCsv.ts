export type Row = { name: string; serial: string; warrantyUntil: string };
export const MAX_BATCH = 1000;

// Reads a spreadsheet export: quoted cells, doubled quotes, and an optional header.
export function parseCsv(input: string): Row[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const text = input.replace(/^\uFEFF/, "");
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === "," || c === ";" || c === "\t") {
      row.push(cell);
      cell = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      cell = "";
      rows.push(row);
      row = [];
    } else cell += c;
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  const cleaned = rows
    .map((r) => r.map((v) => v.trim()))
    .filter((r) => r.some(Boolean));
  const header = /^(name|item|item name|product)$/i.test(cleaned[0]?.[0] ?? "");
  return (header ? cleaned.slice(1) : cleaned).map(
    ([name = "", serial = "", warrantyUntil = ""]) => ({
      name,
      serial,
      warrantyUntil,
    }),
  );
}
