import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCsv } from "../src/components/itemCsv.ts";

test("item CSV import handles headers, quotes, separators and blank lines", () => {
  assert.deepEqual(
    parseCsv('Name,Serial,Warranty\r\n"Kettle, big",SN-1,2027-01-01\r\n"Say ""hi""",,\r\n\r\nPlain,SN-3,'),
    [
      { name: "Kettle, big", serial: "SN-1", warrantyUntil: "2027-01-01" },
      { name: 'Say "hi"', serial: "", warrantyUntil: "" },
      { name: "Plain", serial: "SN-3", warrantyUntil: "" },
    ],
  );
  assert.deepEqual(parseCsv("﻿Kettle;S1;2027-02-02\nB;S2;"), [
    { name: "Kettle", serial: "S1", warrantyUntil: "2027-02-02" },
    { name: "B", serial: "S2", warrantyUntil: "" },
  ]);
  assert.deepEqual(parseCsv(""), []);
  assert.deepEqual(parseCsv("name\n"), []);
});
