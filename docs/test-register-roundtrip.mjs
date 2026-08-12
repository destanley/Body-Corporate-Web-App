// Round-trip test for the maintenance register export/import.
//
// It slices the REAL functions out of src/App.jsx and imports them, rather than
// testing a copy that can drift — the technique that caught the landing-page
// fallbacks in session 17. Run with the SheetJS UMD build sitting beside it:
//
//   curl -sSLO https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js
//   node docs/test-register-roundtrip.mjs
//
// Node 22 has no `window`, so the harness makes one before evaluating the slice
// and drops the real XLSX onto it — the same object the browser would have.

import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const src = fs.readFileSync(path.join(here, "..", "src", "App.jsx"), "utf8");

const START = "// ---------- Maintenance register: the spreadsheet round trip ----------";
const END = "// The preview between reading the file and writing anything.";
const from = src.indexOf(START), to = src.indexOf(END);
if (from < 0 || to < 0) {
  console.error("Could not find the register round-trip block in App.jsx. If it was renamed, update the markers in this file.");
  process.exit(1);
}
const slice = src.slice(from, to);

// SheetJS is evaluated INSIDE the same context as the slice, not imported from
// the harness realm. That is not tidiness — SheetJS decides whether a cell is a
// date with `instanceof Date`, so a Date built in the harness realm and handed
// across is silently written as a bare object and the install-date column comes
// out empty. The browser has one realm; the test has to have one too, or it
// tests a situation that never occurs and misses the one that does.
const sandbox = {
  document: { createElement: () => ({}), head: { appendChild() {} } },
  TODAY_ISO: "2026-08-12", console,
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(here, "xlsx.full.min.js"), "utf8"), sandbox);
vm.runInContext(`
globalThis.Blob = class { constructor(parts) { this.parts = parts; } };
${slice}
globalThis.__api = { buildRegisterWorkbook, readRegisterSheet, diffRegisterImport,
                     cellNumber, cellDate, cellText, CELL_UNREADABLE, REGISTER_COLUMNS,
                     ASSET_STATUSES, ASSET_COST_BASES, REGISTER_GRID_COLS,
                     Date: Date, U8: Uint8Array };`, sandbox);
const A = sandbox.__api;
const XLSX = sandbox.XLSX;
const RealmDate = A.Date;   // the sandbox's Date, so `instanceof Date` holds there
// Bytes have to cross into the sandbox as a sandbox-realm buffer for the same
// reason: SheetJS's reader type-checks what it is handed.
const intoRealm = (nodeBuf) => { const u = new A.U8(nodeBuf.length); u.set(nodeBuf); return u.buffer; };

let pass = 0, fail = 0;
const eq = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; } else { fail++; console.log(`  FAIL  ${label}\n        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`); }
};

// ---------------------------------------------------------------- parsers
console.log("\nMoney and number parsing — the session-19 shapes");
const U = "UNREADABLE";
const num = (v) => { const r = A.cellNumber(v); return r === A.CELL_UNREADABLE ? U : r; };
eq("plain", num("450000"), 450000);
eq("numeric cell", num(12345.67), 12345.67);
eq("dot decimal", num("774.48"), 774.48);
eq("comma decimal", num("12,50"), 12.5);
eq("SA thousands space + comma decimal", num("12 000,00"), 12000);
eq("comma thousands + dot decimal", num("1,125.75"), 1125.75);
eq("dot thousands + comma decimal", num("1.234.567,89"), 1234567.89);
eq("lone 3-digit group is thousands", num("1,125"), 1125);
eq("dot form of the same", num("1.500"), 1500);
eq("leading R", num("R 12 000,00"), 12000);
eq("non-breaking space", num("R 12 000,00"), 12000);
eq("negative", num("-1 234.56"), -1234.56);
eq("blank is null not zero", num(""), null);
eq("null is null", num(null), null);
eq("text refuses", num("about 12k"), U);
eq("stray letters refuse", num("12000x"), U);
eq("a date in a number column refuses", num(new RealmDate("2020-05-01")), U);

console.log("Dates");
const dt = (v) => { const r = A.cellDate(v); return r === A.CELL_UNREADABLE ? U : r; };
eq("Date cell", dt(new RealmDate(2020, 4, 1)), "2020-05-01");
eq("ISO text", dt("2020-05-01"), "2020-05-01");
eq("ISO timestamp", dt("2020-05-01T00:00:00Z"), "2020-05-01");
eq("slash date is REFUSED, not guessed", dt("03/04/2020"), U);
eq("blank", dt(""), null);
eq("nonsense", dt("soon"), U);

// ---------------------------------------------------------------- round trip
console.log("\nExport -> re-import round trip");
const rows = [
  { id: "11111111-1111-1111-1111-111111111111", code: "R-01", name: "Roof sheeting", category: "Structure",
    location: "Block A", quantity: 1, status: "assessed", installedOn: "2012-03-15", expectedLife: 25,
    cost: 450000, costBasis: "quote", notes: "Painted 2021", sortOrder: 1 },
  { id: "22222222-2222-2222-2222-222222222222", code: null, name: "Driveway gate motor", category: "Security",
    location: null, quantity: null, status: "not_assessed", installedOn: null, expectedLife: null,
    cost: null, costBasis: null, notes: null, sortOrder: 2 },
  { id: "33333333-3333-3333-3333-333333333333", code: "G-01", name: "Geyser, unit 3", category: "Plumbing",
    location: "Unit 3", quantity: 1, status: "assessed", installedOn: "2019-11-01", expectedLife: 10,
    cost: 18500.5, costBasis: "insurer schedule", notes: null, sortOrder: 3 },
];
const blob = A.buildRegisterWorkbook(XLSX, rows, "2026/2027");
const buf = Buffer.concat(blob.parts.map((p) => Buffer.from(p)));
const wb = XLSX.read(intoRealm(buf), { cellDates: true });
eq("two sheets", wb.SheetNames, ["Register", "How to complete"]);
// Checked against the bytes actually written, not against a re-read: the
// reader does not restore !cols, so asserting on the parsed workbook would
// have quietly passed whatever the writer did.
const xml = buf.toString("latin1");
eq("column A is written hidden", /<col[^>]*min="1"[^>]*hidden="true"/.test(xml), true);

const back = A.readRegisterSheet(XLSX, intoRealm(buf));
eq("no read error", back.error, null);
eq("all three rows read", back.rows.length, 3);

const clean = A.diffRegisterImport(back.rows, rows, { locked: false });
eq("round trip changes nothing", [clean.adds.length, clean.updates.length, clean.deactivations.length, clean.errors.length], [0, 0, 0, 0]);
eq("all three counted unchanged", clean.unchanged, 3);

// ---------------------------------------------------------------- the diff
console.log("\nDiff: add, edit, remove");
// A shallow copy that KEEPS the cell values by reference. A JSON clone would
// turn the Date cells into UTC strings, and in SAST (UTC+2) an install date of
// midnight local reads back as the previous day — the test would then have been
// measuring its own clone, not the import.
const edited = back.rows.map((r) => ({ ...r, cells: { ...r.cells } }));
edited[0].cells.replacement_cost = "R 512 000,00";     // a change
edited[0].cells.notes = "Painted 2021; ridge redone 2025";
edited.splice(2, 1);                                   // geyser row deleted -> removal
edited.push({ excelRow: 9, cells: { id: null, name: "Intercom panel", category: "Security", code: "S-09",
  location: "Gate", quantity: 1, installed_on: "2023-02-01", expected_life_years: 12,
  replacement_cost: "24 500", cost_basis: "estimate", status: null, notes: null } });

const d = A.diffRegisterImport(edited, rows, { locked: false });
eq("no errors", d.errors, []);
eq("one add", d.adds.map((a) => a.values.name), ["Intercom panel"]);
eq("add parsed its cost", d.adds[0].values.replacement_cost, 24500);
eq("one update", d.updates.map((u) => u.existing.name), ["Roof sheeting"]);
eq("update names both fields", Object.keys(d.updates[0].changes).sort(), ["notes", "replacement_cost"]);
eq("cost change read correctly", d.updates[0].changes.replacement_cost.to, 512000);
eq("one removal", d.deactivations.map((r) => r.name), ["Geyser, unit 3"]);
eq("untouched row is unchanged", d.unchanged, 1);

console.log("\nDiff when the plan is APPROVED");
const locked = A.diffRegisterImport(edited, rows, { locked: true });
eq("nothing is removed", locked.deactivations, []);
eq("the removal is reported as kept", locked.blockedRemovals.map((r) => r.name), ["Geyser, unit 3"]);
eq("adds still apply", locked.adds.length, 1);
eq("edits still apply", locked.updates.length, 1);

// ---------------------------------------------------------------- refusals
console.log("\nWhat the import refuses");
const bad = (cells, excelRow = 2) => A.diffRegisterImport([{ excelRow, cells }], rows, { locked: false }).errors;
eq("blank name", bad({ id: null, category: "Security" }).length, 1);
eq("blank category", bad({ id: null, name: "Thing" }).length, 1);
eq("unreadable cost", bad({ id: null, name: "T", category: "C", replacement_cost: "about 5k" }).length, 1);
eq("bad status", bad({ id: null, name: "T", category: "C", status: "broken" }).length, 1);
eq("good status, any case", bad({ id: null, name: "T", category: "C", status: "Not_Assessed" }).length, 0);
eq("fractional life", bad({ id: null, name: "T", category: "C", expected_life_years: "7.5" }).length, 1);
eq("zero life is below the minimum", bad({ id: null, name: "T", category: "C", expected_life_years: "0" }).length, 1);
eq("negative cost", bad({ id: null, name: "T", category: "C", replacement_cost: "-5" }).length, 1);
eq("slash date", bad({ id: null, name: "T", category: "C", installed_on: "03/04/2020" }).length, 1);
eq("unknown ID", bad({ id: "99999999-9999-9999-9999-999999999999", name: "T", category: "C" }).length, 1);

const dupCode = A.diffRegisterImport([
  { excelRow: 2, cells: { id: null, name: "A", category: "C", code: "X-1" } },
  { excelRow: 3, cells: { id: null, name: "B", category: "C", code: "x-1" } },
], rows, { locked: false });
eq("duplicate code, any case, names both rows", dupCode.errors.length, 1);

const dupId = A.diffRegisterImport([
  { excelRow: 2, cells: { id: rows[0].id, name: "Roof sheeting", category: "Structure" } },
  { excelRow: 3, cells: { id: rows[0].id, name: "Roof sheeting copy", category: "Structure" } },
], rows, { locked: false });
eq("a copied row keeps its ID and is caught", dupId.errors.length, 1);

// An empty sheet would remove everything. It must be POSSIBLE — the file is the
// source of truth — but it must never be silent, which is what the preview is for.
const emptied = A.diffRegisterImport([], rows, { locked: false });
eq("an empty sheet removes all three, and says so", emptied.deactivations.length, 3);

console.log("\nGrid column count");
eq("colSpan matches the header", A.REGISTER_GRID_COLS, 15);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
