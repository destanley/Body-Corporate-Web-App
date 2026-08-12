import React, { useState, useMemo, useRef, useEffect } from "react";

/* ---------- Design tokens ----------
   Ink navy   #1B2A38  – dark surfaces, headers
   Paper      #F6F1E7  – statement / ledger paper
   Ledger grn #2F5D50  – reconciled / positive
   Copper     #B5651D  – outstanding / attention
   Slate      #64748B  – secondary text
   Line       #D8D0BE  – hairline rule on paper
------------------------------------- */

const FONT_IMPORT = (
  <style>{`
    @import url('https://fonts.googleapis.com/css2?family=Spectral:wght@400;500;600;700&family=Inter:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap');
    .f-display { font-family: 'Spectral', serif; }
    .f-body { font-family: 'Inter', sans-serif; }
    .f-mono { font-family: 'IBM Plex Mono', monospace; }

    /* Print scoping: when "Download PDF" triggers window.print(), only the
       .print-area (the statement paper) is shown — everything else on the
       page is hidden so the saved PDF is just the statement, not the whole
       app chrome. The person picks "Save as PDF" as the print destination. */
    @media print {
      body * { visibility: hidden; }
      .print-area, .print-area * { visibility: visible; }
      .print-area {
        position: absolute; left: 0; top: 0; width: 100%; margin: 0; box-shadow: none; border: none;
      }
      .no-print { display: none !important; }
    }
  `}</style>
);

// ---------- Units ----------
// Mock fallback data, shown until the real rows load from Supabase on mount
// (see fetchUnitsFromDb / the useEffect in App). Declared with `let` so the
// fetched rows can replace it module-wide — every component and helper
// (including classifyBankTransaction) reads this same binding at call time,
// and App re-renders when the swap happens. Unit ids (U1–U7) are identical
// in both sources, so READINGS and other unit-keyed maps keep working either way.
let UNITS = [
  { id: "U1", owner: "M. Adams", pq: 14.2 },
  { id: "U2", owner: "T. Naidoo", pq: 12.8 },
  { id: "U3", owner: "S. van Wyk", pq: 15.0 },
  { id: "U4", owner: "R. Dlamini", pq: 13.6 },
  { id: "U5", owner: "L. Botha", pq: 12.4 },
  { id: "U6", owner: "K. Govender", pq: 16.1 },
  { id: "U7", owner: "P. Fischer", pq: 15.9 },
];

const READINGS = {
  // Actual June 2026 meter readings, from El_Cor_Jun_2026_Levy_Stats.xlsx
  U1: { wPrev: 6967.76, wCurr: 6986.03, ePrev: 168226, eCurr: 169011 },
  U2: { wPrev: 6178.36, wCurr: 6179.97, ePrev: 123228, eCurr: 123308 },
  U3: { wPrev: 7638.22, wCurr: 7652.01, ePrev: 205928, eCurr: 206452 },
  U4: { wPrev: 5157.52, wCurr: 5162.22, ePrev: 134241, eCurr: 134552 },
  U5: { wPrev: 5660.51, wCurr: 5672.19, ePrev: 177330, eCurr: 177804 },
  U6: { wPrev: 6640.19, wCurr: 6659.52, ePrev: 149928, eCurr: 150465 },
  U7: { wPrev: 2620.99, wCurr: 2623.11, ePrev: 115440, eCurr: 115463 },
};

const COUNCIL_INVOICE = {
  // Actual June 2026 bulk invoices: COJ_Water_Utility_June_2026.pdf and
  // COJ_Electricity_Utility_June_2026.pdf. Rand figures are the metered
  // consumption charge only (excl VAT) — Water Demand Levy, Sewer, and
  // Electricity Service/Network fees are handled separately elsewhere in the
  // app (as levy items / configured rates), so they're deliberately excluded
  // here to avoid double-counting.
  bulkWaterKl: 66,
  bulkWaterRand: 951.19,
  bulkElecKwh: 2374,
  bulkElecRand: 6114.24,
  sewerage: 4884.11, // complex-wide Sewer total shown on the bill (7 × 697.73, excl VAT)
  refuse: 0.0,        // actual PIKITUP Refuse charge this period was R0.00
  fixedBasic: 0.0,    // no separate "basic charge" line on the actual invoice — Property Rates was also R0.00 this period; flagging in case this assumption is wrong
  // Bill-driven levy inputs (all excl VAT — the app adds VAT when suggesting
  // grid values). Per-unit rates come straight off the water bill's
  // "per 7 living unit(s) @ R…" lines; the electricity fees are complex-wide.
  waterDemandLevyPerUnit: 65.08,
  sewerChargePerUnit: 697.73,
  elecServiceFee: 278.98,
  elecNetworkFee: 1125.75,
};

// Used when no council_invoices row exists for the selected period - i.e. the
// council utility bills for that month haven't arrived (or haven't been
// captured) yet. The app used to fall back to the seed invoice above, which
// made June 2026's bulk figures look like the current month's. Bulk water and
// bulk electricity now default to 0.00 instead, so an uncaptured month reads
// as empty rather than as stale data. The bill-driven per-unit inputs (Water
// Demand Levy, Sewer, Electricity Service/Network) are left as-is - they
// barely move month to month and only feed the AGM levy suggestions.
const COUNCIL_INVOICE_NO_BILL = {
  ...COUNCIL_INVOICE,
  bulkWaterKl: 0,
  bulkWaterRand: 0,
  bulkElecKwh: 0,
  bulkElecRand: 0,
};

// Levy line items — one amount per unit, per item, in statement order.
// Rules (trustee-confirmed, 12 July 2026), all VAT-inclusive on the statement:
//   Insurance                  — individualised per unit, from the insurance
//                                schedule (per annum / 12) — see the Insurance page
//   Blockwatch                 — R0.00 per unit (complex cost ~R150/mo, paid by Unit 1)
//   Garden Service             — R0.00 per unit (complex cost R352/visit, paid by Unit 2)
//   Common Property Water      — 20kL on the real tariff scale, +VAT, ÷7
//   Water Demand Levy          — bill's per-unit rate, +VAT
//   Sewerage                   — bill's per-unit rate, +VAT
//   Common Property Electricity— standard kWh × flat rate, +VAT, ÷7
//   Electricity Service Charge — bill total, +VAT, ÷7
//   Electricity Network Charge — bill total, +VAT, ÷7
// The grid stays fully editable — these rules drive the SUGGESTED values and
// the "fill grid" action on the Levy breakdown page, never a lock.
//
// The list itself is trustee-editable as of 11 August 2026 and lives in
// `levy_item_definitions`, keyed by financial year. The nine below are the
// seed and the offline fallback; `LEVY_ITEM_DEFS` and `LEVY_ITEMS` are swapped
// module-wide once the definitions for the selected FY have loaded, the same
// way UNITS is (see the UNITS comment). Everything that renders or totals a
// levy reads `LEVY_ITEMS`, so it all follows the swap without knowing about it.
//
// `system_key` is what code matches on when it needs a SPECIFIC line — never
// the label, which the trustee owns. A line the trustee added has none.
const LEVY_ITEM_DEFS_DEFAULT = [
  { label: "Insurance", systemKey: "insurance", sortOrder: 1, active: true },
  { label: "Blockwatch", systemKey: "blockwatch", sortOrder: 2, active: true },
  { label: "Garden Service", systemKey: "garden_service", sortOrder: 3, active: true },
  { label: "Common Property Water", systemKey: "common_property_water", sortOrder: 4, active: true },
  { label: "Water Demand Levy", systemKey: "water_demand_levy", sortOrder: 5, active: true },
  { label: "Sewerage", systemKey: "sewerage", sortOrder: 6, active: true },
  { label: "Common Property Electricity", systemKey: "common_property_electricity", sortOrder: 7, active: true },
  { label: "Electricity Service Charge", systemKey: "electricity_service_charge", sortOrder: 8, active: true },
  { label: "Electricity Network Charge", systemKey: "electricity_network_charge", sortOrder: 9, active: true },
];

// Every definition for the loaded FY, removed lines included — the AGM pack
// still reports what was levied in a year after a line has been dropped.
let LEVY_ITEM_DEFS = LEVY_ITEM_DEFS_DEFAULT.slice();
// The labels that are actually billed, in statement order. This is the binding
// every existing call site uses.
let LEVY_ITEMS = LEVY_ITEM_DEFS_DEFAULT.filter((d) => d.active).map((d) => d.label);

// Resolve a built-in line to whatever it is currently called, or null if the
// trustee has removed it. Callers must handle null rather than assume the line
// exists — that is the whole point of it being removable.
const levyLabelForSystemKey = (key, defs = LEVY_ITEM_DEFS) => {
  const d = defs.find((x) => x.systemKey === key && x.active);
  return d ? d.label : null;
};

// The levy grid is fully manual (trustee rule change, 12 July 2026): every
// line item for every unit is editable on the Levy breakdown page and
// defaults to 0.00. Nothing is locked and nothing auto-fills from rates —
// the Tariffs & rates figures appear on that page as suggestions only.
const LEVY_BREAKDOWN_DEFAULT = Object.fromEntries(
  UNITS.map((u) => [u.id, Object.fromEntries(LEVY_ITEMS.map((item) => [item, 0]))])
);

const BANK_TXNS = [
  { date: "2026-06-03", ref: "COR 1", amount: 5432.10, desc: "EFT RECEIVED - M ADAMS" },
  { date: "2026-06-04", ref: "COR 3", amount: 5810.55, desc: "EFT RECEIVED - S VAN WYK" },
  { date: "2026-06-05", ref: "COR2", amount: 4990.00, desc: "EFT RECEIVED - T NAIDOO" },
  { date: "2026-06-06", ref: "REF UNKNOWN", amount: 4602.30, desc: "EFT RECEIVED - NO REFERENCE" },
  { date: "2026-06-07", ref: "Cor-6", amount: 6120.40, desc: "EFT RECEIVED - K GOVENDER" },
  { date: "2026-06-10", ref: "COR7", amount: 6010.00, desc: "EFT RECEIVED - P FISCHER" },
];

// Real details from the actual FNB statement (61123184551_June-2026.pdf). Previously
// showed "Standard Bank" here in error — corrected. SWIFT and account type weren't
// visible on the statement itself; confirm with the bank before these go on a real
// resident-facing statement.
const BANK_DETAILS = {
  bank: "First National Bank (FNB)",
  accountName: "El Corazon Body Corporate",
  accountNumber: "61123184551",
  branchCode: "250655",
  accountType: "Business Current Account", // TBC — not shown on the statement, confirm with the bank
  swift: "FIRNZAJJ", // TBC — FNB's general SWIFT code, confirm this is correct for this account
};

const refToUnit = (ref) => {
  const m = ref.match(/(?:cor|unit)\D*(\d+)/i);
  return m ? "U" + m[1] : null;
};

// ---------- Bank statement PDF parsing (client-side, via pdf.js) ----------
// Loads pdf.js from a CDN once and reuses it. No backend yet, so this runs entirely
// in the browser, same approach validated against the real June 2026 FNB statement.
let pdfJsLoadPromise = null;
function ensurePdfJsLoaded() {
  if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
  if (pdfJsLoadPromise) return pdfJsLoadPromise;
  pdfJsLoadPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
    script.onload = () => {
      window.pdfjsLib.GlobalWorkerOptions.workerSrc =
        "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
      resolve(window.pdfjsLib);
    };
    script.onerror = () => reject(new Error("Could not load pdf.js"));
    document.head.appendChild(script);
  });
  return pdfJsLoadPromise;
}

// Reconstructs readable text lines from pdf.js text items by grouping items that
// share a y-position (a visual row on the page), then sorting left-to-right.
async function extractPdfLines(pdf) {
  const allLines = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();
    const rows = {};
    content.items.forEach((item) => {
      const y = Math.round(item.transform[5]);
      if (!rows[y]) rows[y] = [];
      rows[y].push({ x: item.transform[4], str: item.str });
    });
    const ys = Object.keys(rows).map(Number).sort((a, b) => b - a);
    ys.forEach((y) => {
      const line = rows[y].sort((a, b) => a.x - b.x).map((i) => i.str).join(" ").replace(/\s+/g, " ").trim();
      if (line) allLines.push(line);
    });
  }
  return allLines;
}

// Matches: "01 Jun <description> <amount> [Cr] <balance> [Cr] [accrued charge]"
// pdf.js extracts "Cr"/"Dr" as a separate token with a space before it (e.g.
// "3,103.25 Cr"), not glued to the amount — validated against the real FNB statement.
// The description group is OPTIONAL, and that is not a nicety: FNB prints its
// month-end service fee with an EMPTY description column —
//
//   "31 Aug                    69.00            187,172.24 Cr"
//
// Ten of the twelve FY 2025/2026 statements carry one. With `(.+?)` the line
// failed the match and `parseBankStatementLines` dropped it, losing the fee and
// leaving the statement out by exactly that amount. Found 8 August 2026 by
// running this regex over the twelve real statements.
const BANK_LINE_RE = /^(\d{2}\s+[A-Za-z]{3})\s+(?:(.*?)\s+)?([\d,]+\.\d{2})\s?(Cr)?\s+([\d,]+\.\d{2})\s?(Cr|Dr)?(?:\s+(\d+\.\d{2}))?$/;

// The "Statement Balances" box FNB prints at the top of every statement:
//
//   Opening Balance   206,930.38 Cr
//   Closing Balance   209,079.38 Cr
//   Statement Period : 30 April 2026 to 31 May 2026
//   Tax Invoice/Statement Number : 278
//   Money On Call : 61123184551
//
// Written against the real statements supplied 8 August 2026. Before that there
// was no sample to work from and the balances had to be derived from the
// running-balance column — which is still the fallback, because it works on any
// layout and these patterns only work on this one.
const STMT_OPENING_RE = /Opening\s+Balance\s+([\d,]+\.\d{2})\s*(Cr|Dr)?/i;
const STMT_CLOSING_RE = /Closing\s+Balance\s*:?\s+([\d,]+\.\d{2})\s*(Cr|Dr)?/i;
const STMT_PERIOD_RE = /Statement\s+Period\s*:\s*(\d{1,2}\s+[A-Za-z]+\s+\d{4})\s+to\s+(\d{1,2}\s+[A-Za-z]+\s+\d{4})/i;
const STMT_NUMBER_RE = /Statement\s+Number\s*:?\s*(\d+)/i;
const STMT_ACCOUNT_RE = /Money\s+On\s+Call\s*:\s*(\d{6,})/i;
// The Bank Charges box states the month's service fee. It is what lets the
// blank-description line above be labelled rather than left anonymous.
const STMT_SERVICE_FEES_RE = /Service\s+Fees\s+([\d,]+\.\d{2})\s*(?:Dr)?/i;
// "Turnover for Statement Period" at the foot: the bank's own count and total of
// credits and debits. A second, INDEPENDENT check — the balance walk proves the
// running balances are internally consistent, while these prove the right number
// of lines were read. A statement can pass one and fail the other.
const TURNOVER_CR_RE = /No\.\s*Credit\s*Transactions\s*(\d+)\s+([\d,]+\.\d{2})/i;
const TURNOVER_DR_RE = /No\.\s*Debit\s*Transactions\s*(\d+)\s+([\d,]+\.\d{2})/i;

// "30 April 2026" -> "2026-04-30". Full month names, unlike the transaction
// lines' three-letter abbreviations.
function longStatementDateToIso(s) {
  const m = String(s).match(/^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$/);
  if (!m) return null;
  const i = MONTH_NAMES.findIndex((n) => n.toLowerCase() === m[2].toLowerCase());
  if (i < 0) return null;
  return `${m[3]}-${String(i + 1).padStart(2, "0")}-${m[1].padStart(2, "0")}`;
}

// Reads the header box. Returns nulls rather than throwing where a field is
// absent, so a layout that doesn't carry one still produces the rest.
function parseStatementHeader(lines) {
  const text = lines.join("\n");
  const num = (re) => {
    const m = text.match(re);
    if (!m) return null;
    const v = parseFloat(m[1].replace(/,/g, ""));
    if (!isFinite(v)) return null;
    // An overdrawn balance prints "Dr". It is money owed, so it is negative.
    return m[2] && /dr/i.test(m[2]) ? -v : v;
  };
  const per = text.match(STMT_PERIOD_RE);
  const no = text.match(STMT_NUMBER_RE);
  const acc = text.match(STMT_ACCOUNT_RE);
  return {
    opening: num(STMT_OPENING_RE),
    closing: num(STMT_CLOSING_RE),
    from: per ? longStatementDateToIso(per[1]) : null,
    to: per ? longStatementDateToIso(per[2]) : null,
    statementNumber: no ? no[1] : null,
    accountNumber: acc ? acc[1] : null,
    serviceFees: (() => {
      const m = text.match(STMT_SERVICE_FEES_RE);
      if (!m) return null;
      const v = parseFloat(m[1].replace(/,/g, ""));
      return isFinite(v) ? v : null;
    })(),
    turnover: (() => {
      const c = text.match(TURNOVER_CR_RE), d = text.match(TURNOVER_DR_RE);
      if (!c && !d) return null;
      const pair = (m) => (m ? { count: Number(m[1]), total: parseFloat(m[2].replace(/,/g, "")) } : null);
      return { credits: pair(c), debits: pair(d) };
    })(),
  };
}

// Categorises one bank transaction line. Every line gets a category — nothing is
// silently dropped (per the execution plan's bank-ingestion rule).
function classifyBankTransaction(desc) {
  const lower = desc.toLowerCase();
  const unitId = refToUnit(desc);
  if (unitId && UNITS.some((u) => u.id === unitId)) {
    return { category: "resident_payment", matchedUnit: unitId, confidence: "high", note: `Matched via reference to ${unitId}` };
  }
  if (/\bcoj\b/i.test(desc)) {
    return { category: "council_payment", matchedUnit: null, confidence: "high", note: "Outgoing payment to the council — not a resident payment" };
  }
  if (/interest|int on/i.test(desc)) {
    return { category: "interest", matchedUnit: null, confidence: "high", note: "Interest earned on credit balance" };
  }
  if (/service fee|cash handling|cash deposit|bank charge|admin fee/i.test(desc)) {
    return { category: "bank_charge", matchedUnit: null, confidence: "high", note: "Bank fee" };
  }
  const nameMatch = UNITS.find((u) => lower.includes(u.owner.split(" ").pop().toLowerCase()));
  if (nameMatch) {
    return { category: "resident_payment", matchedUnit: nameMatch.id, confidence: "low", note: `Tentative match on owner surname "${nameMatch.owner}" — verify before relying on this` };
  }
  return { category: "needs_review", matchedUnit: null, confidence: "none", note: "No unit reference or owner-name match — needs manual matching" };
}

// Parses reconstructed PDF lines into transaction objects, deduping identical lines
// (defends against a line appearing more than once across pages).
//
// `balanceAfter` is the running balance printed against the line. It was always
// matched by BANK_LINE_RE and then discarded by a hole in the destructure — the
// Bank recon module needs it, because it is the only thing that can prove the
// import dropped nothing. `lineNo` preserves statement order, which is not the
// same as date order once two movements share a day.
function parseBankStatementLines(lines, header) {
  const seen = new Set();
  const out = [];
  lines.forEach((line) => {
    const m = line.match(BANK_LINE_RE);
    if (!m) return;
    const [, date, rawDesc, amountRaw, crFlag, balanceRaw, balanceSign, accrued] = m;
    const amount = parseFloat(amountRaw.replace(/,/g, ""));
    // A blank description is FNB's month-end service fee. The statement states
    // that fee in its own Bank Charges box, so where the amount agrees the line
    // is labelled from the statement rather than left anonymous — an inference,
    // but one the document itself supports. Anything else blank stays blank and
    // falls through to "needs review", which is the honest outcome.
    let desc = (rawDesc || "").trim();
    let labelledFromHeader = false;
    if (!desc) {
      if (header && header.serviceFees != null && Math.abs(round2(amount - header.serviceFees)) <= 0.005) {
        desc = "Service Fees";
        labelledFromHeader = true;
      } else {
        desc = "(no description on statement)";
      }
    }
    const key = date + "|" + desc + "|" + amountRaw;
    if (seen.has(key)) return;
    seen.add(key);
    const direction = crFlag ? "credit" : "debit";
    const cls = classifyBankTransaction(desc);
    out.push({
      date, desc, amount, direction, labelledFromHeader,
      accruedCharge: accrued ? parseFloat(accrued) : 0,
      // "Dr" on the balance column means the account was overdrawn at that
      // point. Previously the regex had no Dr branch at all, so such a line
      // failed the match and was silently dropped.
      balanceAfter: balanceRaw
        ? (balanceSign && /dr/i.test(balanceSign) ? -1 : 1) * parseFloat(balanceRaw.replace(/,/g, ""))
        : null,
      lineNo: out.length + 1,
      ref: desc, ...cls,
    });
  });
  return out;
}

// The statement envelope, derived from the transaction lines themselves.
//
// Deriving rather than reading the printed "Opening Balance" line is a deliberate
// choice, made because there is no sample statement to write that regex against
// and a wrong guess would be worse than an honest derivation. The closing balance
// is the last line's printed running balance; the opening balance is the FIRST
// line's running balance reversed by its own movement. Both come off figures the
// bank printed, so neither is invented — but `balanceSource` says "derived" so a
// later reader knows they were not read off the header.
//
// The check is the point: walking the lines and comparing each printed balance
// against the previous one plus the movement catches a dropped or duplicated
// line, which a simple opening-plus-net-equals-closing test cannot.
function deriveStatementBalances(txns) {
  const withBalance = txns.filter((t) => t.balanceAfter != null);
  if (!withBalance.length) {
    return { opening: null, closing: null, balanceSource: "unavailable", checks: [], ok: null,
      reason: "No running balance column was found on any line — this statement layout is not the one the parser was built for." };
  }
  const first = withBalance[0], last = withBalance[withBalance.length - 1];
  const signed = (t) => (t.direction === "credit" ? t.amount : -t.amount);
  const opening = round2(first.balanceAfter - signed(first));
  const closing = round2(last.balanceAfter);

  // Line-by-line: does each printed balance follow from the one before it?
  const checks = [];
  let running = opening;
  withBalance.forEach((t) => {
    running = round2(running + signed(t));
    const drift = round2(t.balanceAfter - running);
    if (Math.abs(drift) > 0.005) checks.push({ lineNo: t.lineNo, date: t.date, desc: t.desc, expected: running, printed: t.balanceAfter, drift });
    running = t.balanceAfter; // resync so one bad line doesn't cascade into every line after it
  });

  const credits = round2(txns.filter((t) => t.direction === "credit").reduce((s, t) => s + t.amount, 0));
  const debits = round2(txns.filter((t) => t.direction === "debit").reduce((s, t) => s + t.amount, 0));
  const net = round2(opening + credits - debits);
  const totalDrift = round2(closing - net);

  return {
    opening, closing, credits, debits, net, totalDrift,
    balanceSource: "derived",
    linesWithoutBalance: txns.length - withBalance.length,
    checks,
    ok: checks.length === 0 && Math.abs(totalDrift) <= 0.005,
  };
}

async function parseBankStatementPdf(file) {
  const pdfjsLib = await ensurePdfJsLoaded();
  const buf = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
  const lines = await extractPdfLines(pdf);
  return parseBankStatementLines(lines, parseStatementHeader(lines));
}

// Same parse, plus the derived envelope. The Bank recon module uses this; the
// Tenant recon page keeps calling parseBankStatementPdf, which is unchanged.
async function parseBankStatementWithBalances(file) {
  const pdfjsLib = await ensurePdfJsLoaded();
  const buf = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
  const lines = await extractPdfLines(pdf);
  const header = parseStatementHeader(lines);
  const txns = parseBankStatementLines(lines, header);
  const derived = deriveStatementBalances(txns);

  // The printed figures win where they are present — they are the bank's own
  // statement of the position, whereas the derived pair is reconstructed from
  // the running-balance column. Where both exist and DISAGREE, that is a real
  // finding: it means a transaction line was missed. It is reported, not hidden,
  // and the printed figures are still the ones used.
  const balances = { ...derived, header };
  if (header.opening != null || header.closing != null) {
    balances.balanceSource = "printed";
    if (header.opening != null) {
      balances.openingDerived = derived.opening;
      balances.openingMismatch = derived.opening != null && Math.abs(round2(header.opening - derived.opening)) > 0.005;
      balances.opening = header.opening;
    }
    if (header.closing != null) {
      balances.closingDerived = derived.closing;
      balances.closingMismatch = derived.closing != null && Math.abs(round2(header.closing - derived.closing)) > 0.005;
      balances.closing = header.closing;
    }
    // Re-run the totals check against the printed pair.
    balances.net = round2(balances.opening + (derived.credits || 0) - (derived.debits || 0));
    balances.totalDrift = round2(balances.closing - balances.net);
    balances.ok = (derived.checks || []).length === 0
      && Math.abs(balances.totalDrift) <= 0.005
      && !balances.openingMismatch && !balances.closingMismatch;
  }

  // Turnover cross-check. Zero-rand lines are excluded because FNB prints its
  // interest-rate notice as a dated line with an amount of 0.00 and does NOT
  // count it in the turnover — it is a notice, not a movement, and counting it
  // would report a false mismatch on every statement that carries one.
  if (header.turnover) {
    const movements = txns.filter((t) => t.amount !== 0);
    const side = (dir, printed) => {
      if (!printed) return null;
      const mine = movements.filter((t) => t.direction === dir);
      const total = round2(mine.reduce((s, t) => s + t.amount, 0));
      return {
        printedCount: printed.count, parsedCount: mine.length,
        printedTotal: round2(printed.total), parsedTotal: total,
        ok: printed.count === mine.length && Math.abs(round2(printed.total - total)) <= 0.005,
      };
    };
    balances.turnover = { credits: side("credit", header.turnover.credits), debits: side("debit", header.turnover.debits) };
    balances.turnoverOk = ["credits", "debits"].every((k) => !balances.turnover[k] || balances.turnover[k].ok);
    balances.ok = balances.ok && balances.turnoverOk;
    balances.noticeLines = txns.length - movements.length;
  }
  return { txns, balances };
}

// ---------- Insurance schedule PDF parsing (client-side, via pdf.js) ----------
// Reads the broker's annual Schedule of Insurance (GWK Welvaart / Renasa format,
// validated against "2026 Renewal.pdf") and turns it into per-item figures the
// allocation below can work from. Same client-side pdf.js approach as the bank
// statement: no backend, and nothing is written until the trustee confirms the
// preview — a mis-parse must never silently overwrite a year's schedule.
//
// The schedule lists one "Item" per insured thing. Items 1..7 are the units,
// one further item is the common property (wall, fence, paving, gate, DB
// boxes) and one is the geyser cover. Sasria and the broker fee are policy
// level and appear only in the premium summary at the front.

// "R16,766,714" / "R 2,206.95" -> Number. Returns null rather than NaN so a
// missing figure stays visibly missing instead of poisoning a total.
function parseInsMoney(s) {
  if (s == null) return null;
  const n = Number(String(s).replace(/[R\s,]/g, ""));
  return isFinite(n) ? n : null;
}

// The last rand amount on a line. The premium summary puts the pro-rata
// adjustment before the annual premium ("Broker Fee R0.00 R233.91"), and it is
// always the annual figure we want.
function lastRandOnLine(line) {
  const all = String(line).match(/R\s?[\d,]+\.\d{2}/g);
  return all && all.length ? parseInsMoney(all[all.length - 1]) : null;
}

// Item header, e.g.
//   "Item 1 - Unit 1 in extent 193 square meters - @ R8 Sum Insured R1,854,576 Item Premium R2,206.95"
//   "Item 8 - Wall and Electric Fence R266738 Paving Sum Insured R467,352 Item Premium R471.68"
// The sum insured captured here is the schedule's "Total Sum Insured" (the
// building value grossed up for the rent sub-section), which is the figure the
// AGM report has always carried.
const INS_ITEM_RE = /^Item\s+(\d+)\s*[-–]\s*(.*?)\s*Sum Insured\s*R\s?([\d,]+(?:\.\d{2})?)\s*Item Premium\s*R\s?([\d,]+\.\d{2})/i;

// Turns the reconstructed lines into items plus the policy-level figures.
// Geyser cover is read from each item's own "Geysers - Cover as Defined"
// extension flag rather than from the free-text description on the geyser
// item, because the flag is structured and the description is not.
// A line carrying nothing but amounts — the remainder of a table row whose
// label landed on its own line during reconstruction.
const INS_AMOUNTS_ONLY_RE = /^[R\d.,\s]+$/;

// Finds the annual amount for a labelled row of the premium summary.
//
// pdf.js rebuilds a table row by grouping text items on a rounded y-position,
// and the summary's labels are right-aligned in a middle column: "Sasria
// Sub-Total" and its "R0.00 R740.44" can end up a pixel apart and land on two
// separate lines. So the amount is looked for on the label's own line first,
// and only then on the next couple of lines — and only if those carry amounts
// and nothing else, so a label can never absorb an unrelated figure.
//
// The annual premium is always the LAST amount on the row: the pro-rata
// adjustment column sits before it.
function findInsSummaryAmount(lines, labelRe) {
  for (let i = 0; i < lines.length; i++) {
    if (!labelRe.test(lines[i])) continue;
    const own = lastRandOnLine(lines[i]);
    if (own != null) return own;
    for (let j = i + 1; j <= i + 2 && j < lines.length; j++) {
      if (!INS_AMOUNTS_ONLY_RE.test(lines[j])) break;
      const v = lastRandOnLine(lines[j]);
      if (v != null) return v;
    }
  }
  return null;
}

function parseInsuranceScheduleLines(lines) {
  const items = [];
  let current = null;
  const policy = {
    policyNumber: null, insurer: null, coverStart: null,
    coverSubTotal: null, brokerFee: null, sasriaTotal: null,
    policyTotal: null, totalSumInsured: null,
  };
  const norm = lines.map((l) => String(l).replace(/\s+/g, " ").trim()).filter(Boolean);

  norm.forEach((line) => {

    const m = line.match(INS_ITEM_RE);
    if (m) {
      const desc = m[2].trim();
      const unitMatch = desc.match(/^Unit\s+(\d+)\b/i);
      current = {
        itemNo: Number(m[1]),
        description: desc,
        unitNo: unitMatch ? Number(unitMatch[1]) : null,
        sumInsured: parseInsMoney(m[3]),
        premium: parseInsMoney(m[4]),
        geyserCovered: false,
        isGeyserItem: /geyser/i.test(desc),
      };
      items.push(current);
      return;
    }

    // Extension flags belong to the item block currently being read.
    if (current && /^Geysers\s*[-–]\s*Cover as Defined\b/i.test(line)) {
      current.geyserCovered = /\bYes\b/i.test(line);
      return;
    }

    if (policy.policyNumber == null) {
      const p = line.match(/^Policy Number:\s*(.+)$/i)
        || line.match(/^Policy Number\s+(.+?)\s+Previous Policy Number/i);
      if (p) { policy.policyNumber = p[1].trim(); return; }
    }
    if (policy.insurer == null) {
      const i = line.match(/^Insurer\s+(.+?)\s+Insurer Policy Number/i);
      if (i) { policy.insurer = i[1].trim(); return; }
    }
    if (policy.coverStart == null) {
      const c = line.match(/Cover Starts From\s+(\d{1,2}\s+[A-Za-z]+\s+\d{4})/i);
      if (c) { policy.coverStart = c[1].trim(); return; }
    }
    // "Buildings Combined Section 9 Yes Yes R16,766,714 R0.00 R23,390.81"
    if (policy.totalSumInsured == null && /^Buildings Combined Section\b/i.test(line)) {
      const si = line.match(/R\s?([\d,]+)(?:\s|$)/);
      if (si) policy.totalSumInsured = parseInsMoney(si[1]);
    }
  });

  // The premium summary is read in its own pass rather than inside the loop.
  // Doing it inline meant the sub-total branch overwrote whatever the detail
  // line had already found — including overwriting a good figure with null when
  // the sub-total row got split across two lines, which is exactly how the
  // Sasria premium silently went missing. Each figure is now resolved once,
  // sub-total first and detail line as the fallback, and a null result never
  // displaces a value that was found.
  const firstOf = (...candidates) => {
    for (const v of candidates) if (v != null) return v;
    return null;
  };
  // Everything here is scoped to the premium summary at the front of the
  // schedule, which ends at "Total Annual Payment". The same words appear
  // later in the document meaning something else entirely — "SASRIA: Security
  // Costs …" is a per-item extension, and "SASRIA Commission: R88.85" on the
  // disclosure pages is the broker's commission ON the Sasria premium, not a
  // premium. Summing those in overstated Sasria by R88.85.
  const summaryEnd = norm.findIndex((l) => /Total Annual Payment/i.test(l));
  const summary = summaryEnd === -1 ? norm : norm.slice(0, summaryEnd + 1);

  // Sasria can be itemised over more than one section, so the detail fallback
  // sums them rather than taking the first. A premium row carries no colon;
  // both of the impostors above do.
  const sasriaDetail = summary
    .filter((l) => /^SASRIA\b/i.test(l) && !/Sub-?Total/i.test(l)
      && !l.includes(":") && !/commission/i.test(l))
    .map((l) => lastRandOnLine(l))
    .filter((v) => v != null);

  policy.coverSubTotal = firstOf(
    findInsSummaryAmount(summary, /Cover Sub-?Total/i),
    findInsSummaryAmount(norm, /TOTAL SECTION PREMIUM/i),
  );
  policy.brokerFee = firstOf(
    findInsSummaryAmount(summary, /Fee Sub-?Total/i),
    findInsSummaryAmount(summary, /^Broker Fee\b/i),
  );
  policy.policyTotal = findInsSummaryAmount(norm, /Total Annual Payment/i);

  // Sasria is read from the detail rows FIRST, not from its sub-total row.
  //
  // pdf.js reconstructs that row as three separate lines, with the annual
  // amount orphaned ABOVE its own label:
  //     "SASRIA Fire - Domestic R740.44"
  //     "R740.44"                  <- the sub-total's annual premium column
  //     "Sasria Sub-Total R0.00"   <- label plus the pro-rata column only
  // Reading the label row therefore returns a confident, wrong R0.00 rather
  // than a null — which is exactly how the Sasria premium went missing with no
  // warning to show for it. The detail rows carry one unambiguous amount each.
  const sasriaFromDetail = sasriaDetail.length
    ? round2(sasriaDetail.reduce((s, v) => s + v, 0)) : null;
  const sasriaFromSubTotal = findInsSummaryAmount(summary, /Sasria Sub-?Total/i);

  // The summary is: section premium + fees + Sasria = total annual payment. So
  // Sasria can be derived from the other three, and that residual is what every
  // other route gets measured against — an allocation that doesn't tie to the
  // total the body corporate actually pays is wrong by definition.
  const sasriaResidual =
    (policy.policyTotal != null && policy.coverSubTotal != null && policy.brokerFee != null)
      ? round2(policy.policyTotal - policy.coverSubTotal - policy.brokerFee)
      : null;

  policy.sasriaTotal = firstOf(sasriaFromDetail, sasriaResidual, sasriaFromSubTotal);

  // Where what was read off the page disagrees with what the policy total
  // implies, the policy total wins and the disagreement is recorded. A silent
  // preference either way is how this went wrong the first time.
  if (sasriaResidual != null && policy.sasriaTotal != null
      && Math.abs(policy.sasriaTotal - sasriaResidual) > 0.01) {
    policy.sasriaNote = `Read a Sasria premium of R${policy.sasriaTotal.toFixed(2)} off the schedule, but the policy total implies R${sasriaResidual.toFixed(2)}. Used the policy total — check the Sasria rows on the premium summary.`;
    policy.sasriaTotal = sasriaResidual;
  }

  // Items that aren't a unit are either the geyser cover or common property.
  const geyserItems = items.filter((i) => i.unitNo == null && i.isGeyserItem);
  const commonItems = items.filter((i) => i.unitNo == null && !i.isGeyserItem);
  const sum = (arr, k) => (arr.length ? round2(arr.reduce((s, x) => s + (x[k] || 0), 0)) : 0);

  // A component that failed to parse allocates as R0.00 and every unit is
  // quietly under-charged for the year. That has happened once (the Sasria
  // premium), so anything missing is named here and shown in the preview
  // rather than left to be inferred from a tie-out that may itself be missing.
  const warnings = [
    policy.sasriaTotal == null && "Sasria premium",
    policy.brokerFee == null && "broker fee",
    policy.coverSubTotal == null && "section premium",
    policy.policyTotal == null && "total annual payment",
    !commonItems.length && "common property item",
  ].filter(Boolean);

  // The summary must add up: section premium + fees + Sasria = total annual
  // payment. Checking it here catches a component that parsed to a plausible
  // but wrong number — which a null-check cannot, and which is the failure
  // mode that actually occurred.
  const notes = [];
  if (policy.sasriaNote) notes.push(policy.sasriaNote);
  if (policy.policyTotal != null && policy.coverSubTotal != null
      && policy.brokerFee != null && policy.sasriaTotal != null) {
    const parts = round2(policy.coverSubTotal + policy.brokerFee + policy.sasriaTotal);
    if (Math.abs(parts - policy.policyTotal) > 0.01) {
      warnings.push(`premium summary that doesn't add up (section ${rand(policy.coverSubTotal)} + broker ${rand(policy.brokerFee)} + Sasria ${rand(policy.sasriaTotal)} = ${rand(parts)}, but the total annual payment reads ${rand(policy.policyTotal)})`);
    }
  }
  // The section premium should equal the sum of the items beneath it.
  const itemSum = round2(items.reduce((s, i) => s + (i.premium || 0), 0));
  if (policy.coverSubTotal != null && items.length
      && Math.abs(itemSum - policy.coverSubTotal) > 0.01) {
    warnings.push(`${items.length} items totalling ${rand(itemSum)} against a section premium of ${rand(policy.coverSubTotal)} — an item was missed or double-counted`);
  }

  return {
    items,
    unitItems: items.filter((i) => i.unitNo != null).sort((a, b) => a.unitNo - b.unitNo),
    geyserItems,
    commonItems,
    geyserPremium: sum(geyserItems, "premium"),
    geyserSumInsured: sum(geyserItems, "sumInsured"),
    commonPropertyPremium: sum(commonItems, "premium"),
    commonPropertySumInsured: sum(commonItems, "sumInsured"),
    warnings,
    notes,
    ...policy,
  };
}

async function parseInsuranceSchedulePdf(file) {
  const pdfjsLib = await ensurePdfJsLoaded();
  const buf = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
  const lines = await extractPdfLines(pdf);
  return parseInsuranceScheduleLines(lines);
}

// ---------- Insurance: per-unit allocation ----------
// Trustee-confirmed rules (7 August 2026), reproducing exactly how the
// FY 2025/2026 schedule was built by hand:
//   Premium       — the unit's own item premium, plus an equal share of the
//                   geyser item across only those units whose schedule carries
//                   "Geysers - Cover as Defined: Yes". Folded into premium
//                   rather than shown separately, so the report keeps its
//                   nine columns and last year's figures still reconcile.
//   Com prop      — the common property item premium, divided equally by unit.
//   Sasria        — the policy Sasria total, divided equally by unit.
//   Broker        — the broker fee, divided equally by unit.
// Every per-unit figure is rounded to the cent, which is how the insurer's own
// schedule adds up. Rounding seven ways rarely lands exactly on the policy
// total, so the difference is surfaced rather than absorbed — see tieOut.
function computeInsuranceAllocation(parsed, unitNumbers) {
  const nos = (unitNumbers || []).slice().sort((a, b) => a - b);
  const n = nos.length || 1;
  const geyserUnits = parsed.unitItems.filter((i) => i.geyserCovered).map((i) => i.unitNo);
  const geyserEach = geyserUnits.length ? round2((parsed.geyserPremium || 0) / geyserUnits.length) : 0;
  const commonEach = round2((parsed.commonPropertyPremium || 0) / n);
  const sasriaEach = round2((parsed.sasriaTotal || 0) / n);
  const brokerEach = round2((parsed.brokerFee || 0) / n);

  const rows = nos.map((no) => {
    const item = parsed.unitItems.find((i) => i.unitNo === no) || null;
    const geyserShare = geyserUnits.includes(no) ? geyserEach : 0;
    const premium = item ? round2((item.premium || 0) + geyserShare) : null;
    const perAnnum = premium == null ? null
      : round2(premium + commonEach + sasriaEach + brokerEach);
    return {
      no,
      matched: !!item,
      description: item ? item.description : null,
      sumInsured: item ? item.sumInsured : null,
      ownPremium: item ? item.premium : null,
      geyserCovered: geyserUnits.includes(no),
      geyserShare,
      premium,
      commonProperty: commonEach,
      sasria: sasriaEach,
      brokerFee: brokerEach,
      perAnnum,
      perMonth: perAnnum == null ? null : round2(perAnnum / 12),
    };
  });

  const allocated = round2(rows.reduce((s, r) => s + (r.perAnnum || 0), 0));
  const policyTotal = parsed.policyTotal;
  const variance = policyTotal == null ? null : round2(allocated - policyTotal);

  return {
    rows, geyserUnits, geyserEach, commonEach, sasriaEach, brokerEach,
    allocated, policyTotal, variance,
    unmatched: parsed.items.filter((i) => i.unitNo == null && !i.isGeyserItem && !parsed.commonItems.includes(i)),
    missingUnits: nos.filter((no) => !parsed.unitItems.some((i) => i.unitNo === no)),
  };
}

// ---------- Supabase (database) ----------
// Loads supabase-js from a CDN once and reuses it — same pattern as the pdf.js
// loader above, so no build-step dependency and it still previews as a Claude
// artifact. The publishable key is safe to ship to the browser by design;
// actual data protection comes from Row Level Security, which is NOT enabled
// yet (auth module is a later phase) — so don't put real resident data in the
// database until RLS lands.
const SUPABASE_URL = "https://ctqyxxlnnrgtyyxubsle.supabase.co";
const SUPABASE_KEY = "sb_publishable_N-VK52qyVB2MvvZDBzEXUQ_w720L3Sz";
let supabaseClientPromise = null;
function ensureSupabaseClient() {
  if (supabaseClientPromise) return supabaseClientPromise;
  supabaseClientPromise = new Promise((resolve, reject) => {
    if (window.supabase && window.supabase.createClient) { resolve(); return; }
    const script = document.createElement("script");
    script.src = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2";
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Could not load supabase-js"));
    document.head.appendChild(script);
  }).then(() => window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY));
  return supabaseClientPromise;
}

// ---------- Proof-of-payment storage ----------
// Proof documents live in the private "El Corazon" Storage bucket. The DB row
// (remittance_advices.proof_document_urls) stores the *storage paths*, not
// bare filenames, so the trustee can open the actual document later via a
// signed URL when approving a deduction.
// NOTE: the bucket's RLS policies currently allow authenticated users only —
// anonymous residents arriving via a token link can't upload yet (their whole
// submission will fail at the upload step). Needs an anon-scoped policy or a
// server-side upload route when resident links go live.
const PROOF_BUCKET = "El Corazon";

async function uploadProofFiles(unitAppId, files) {
  if (!files || files.length === 0) return [];
  const client = await ensureSupabaseClient();
  const stamp = Date.now();
  const paths = [];
  for (const file of files) {
    const safeName = file.name.replace(/[^\w.\-]+/g, "_");
    const path = `remittance-proofs/${ACTIVE_PERIOD}/${unitAppId}-${stamp}-${safeName}`;
    const { error } = await client.storage
      .from(PROOF_BUCKET)
      .upload(path, file, { upsert: true, contentType: file.type || undefined });
    if (error) throw new Error(`Proof upload failed for "${file.name}": ${error.message}`);
    paths.push(path);
  }
  return paths;
}

// Short-lived signed URL for viewing a stored proof (the bucket is private).
async function getProofSignedUrl(path) {
  const client = await ensureSupabaseClient();
  const { data, error } = await client.storage.from(PROOF_BUCKET).createSignedUrl(path, 3600);
  if (error) throw error;
  return data.signedUrl;
}

// Storage paths are ugly — show just the original filename. Tolerates legacy
// rows that stored a bare filename instead of a path.
function proofDisplayName(path) {
  const base = String(path).split("/").pop() || String(path);
  const m = base.match(/^.+?-\d{10,}-(.+)$/);
  return m ? m[1] : base;
}

// Clickable "View: <filename>" links for stored proof documents — opens each
// via a short-lived signed URL in a new tab.
function ProofLinks({ paths }) {
  if (!paths || paths.length === 0) return null;
  return (
    <div style={{ marginTop: 2 }}>
      {paths.map((p, i) => (
        <button
          key={i}
          onClick={async () => {
            try {
              const url = await getProofSignedUrl(p);
              window.open(url, "_blank", "noopener");
            } catch (err) {
              alert("Could not open proof document — it may predate document storage. " + (err.message || err));
            }
          }}
          style={{ display: "block", fontSize: 10.5, color: "#2F5D50", background: "none", border: "none", padding: 0, cursor: "pointer", textDecoration: "underline", textAlign: "left" }}
        >
          View: {proofDisplayName(p)}
        </button>
      ))}
    </div>
  );
}

// Fetches the 7 units and maps them to the shape the app already uses
// ({ id: "U<n>", owner, pq }), keeping dbId around for later write-backs
// (monthly_usage etc. reference units by uuid).
async function fetchUnitsFromDb() {
  const client = await ensureSupabaseClient();
  const { data, error } = await client
    .from("units")
    .select("id, unit_number, owner_name, participation_quota, access_token")
    .order("unit_number");
  if (error) throw error;
  if (!data || data.length === 0) throw new Error("units table returned no rows");
  return data.map((u) => ({
    id: "U" + u.unit_number,
    owner: u.owner_name,
    pq: Number(u.participation_quota),
    dbId: u.id,
    token: u.access_token, // feeds the trustee's "copy resident link" buttons
  }));
}

// ---------- Resident access via capability URL ----------
// Each unit has a permanent, unguessable uuid token (units.access_token).
// A resident opens the app as ?unit=<token>: no login, and the only thing
// the anon role can do against the database is call get_unit_by_token —
// a security-definer RPC that returns the matching unit's display fields
// (never the email or the token). Direct table reads stay blocked by RLS,
// so one unit can never see another's data. Trade-off to be aware of:
// anyone who obtains a unit's link sees that unit's statement (same model
// as a private share link) — if a link leaks, regenerate that one token.
const RESIDENT_TOKEN = (() => {
  try {
    return new URLSearchParams(window.location.search).get("unit");
  } catch {
    return null;
  }
})();

async function fetchUnitByToken(token) {
  const client = await ensureSupabaseClient();
  const { data, error } = await client.rpc("get_unit_by_token", { p_token: token });
  if (error) throw error;
  const u = data && data[0];
  if (!u) return null;
  return { id: "U" + u.unit_number, owner: u.owner_name, pq: Number(u.participation_quota) };
}

// The months this unit has a statement for, newest first — drives the
// resident/tenant past-statement selector. Anon-safe via the token RPC.
async function fetchUnitPeriods(token) {
  const client = await ensureSupabaseClient();
  const { data, error } = await client.rpc("get_unit_periods", { p_token: token });
  if (error) throw error;
  return (data || []).map((d) => (typeof d === "string" ? d : String(d)));
}

// This unit's statement inputs for one period (readings, levy grid, extras and
// the rate config), fetched through the token RPC so a link only ever sees its
// own unit. Returns the raw jsonb payload; computeStatementRow turns it into the
// `r` shape StatementPaper renders.
async function fetchUnitStatement(token, period) {
  const client = await ensureSupabaseClient();
  const { data, error } = await client.rpc("get_unit_statement", { p_token: token, p_period: period });
  if (error) throw error;
  return data; // null if the token/period is invalid
}

// Normalises deduction items into [{ amount, comment }]. Falls back to a single
// item built from the legacy deduction_amount / deduction_comment columns for
// rows saved before itemised deductions existed.
function normaliseDeductionItems(deductions, fallbackAmount, fallbackComment) {
  if (Array.isArray(deductions) && deductions.length > 0) {
    return deductions.map((d) => ({
      amount: Number(d.amount) || 0,
      comment: d.comment || "",
      expenseCategory: d.expenseCategory || "",
    }));
  }
  if (Number(fallbackAmount) > 0) {
    return [{ amount: Number(fallbackAmount), comment: fallbackComment || "", expenseCategory: "" }];
  }
  return [];
}

// Builds the statement row from RPC data using the exact same billing helpers
// the trustee allocation uses (individualWaterCost, the 6kL minimum charge, VAT),
// so a resident's past statement matches what the trustee sees to the cent.
function computeStatementRow(data) {
  if (!data) return null;
  const cfg = data.config || {};
  const bands = (cfg.waterBands || []).map((b) => ({
    label: b.label, from: Number(b.from), to: b.to == null ? null : Number(b.to),
    rate2025: Number(b.rate) || 0, rate2024: 0,
  }));
  const electricityRate = cfg.electricityRate != null ? Number(cfg.electricityRate) : ELECTRICITY_RATE_DEFAULT;
  const vatRate = cfg.vatRate != null ? Number(cfg.vatRate) : VAT_RATE_DEFAULT;
  const rd = data.readings || { wPrev: 0, wCurr: 0, ePrev: 0, eCurr: 0 };
  const wPrev = Number(rd.wPrev) || 0, wCurr = Number(rd.wCurr) || 0;
  const ePrev = Number(rd.ePrev) || 0, eCurr = Number(rd.eCurr) || 0;
  const wUse = round2(wCurr - wPrev);
  const eUse = round2(eCurr - ePrev);

  const waterCostComputed = individualWaterCost(wUse, bands, data.period);
  const elecCostComputed = eUse * electricityRate;
  // Apply any manual per-statement override so the tenant sees the same aligned
  // figures the trustee set (null = use computed).
  const ov = data.overrides || {};
  const waterCost = ov.waterDue != null ? Number(ov.waterDue) : waterCostComputed;
  const elecCost = ov.electricityDue != null ? Number(ov.electricityDue) : elecCostComputed;
  const subTotal = elecCost + waterCost;
  const vat = subTotal * vatRate;
  const utilitiesDue = subTotal + vat;

  const levyItems = data.levyItems || {};
  // The resident portal never loads the trustee app's data, so it cannot use
  // the LEVY_ITEMS module binding — that would be whatever the source-code
  // default is, and any line not in it was dropped from the resident's total
  // in silence. The RPC returns the order for the statement's own financial
  // year; the keys it actually returned are the fallback, so the total is
  // always over everything billed rather than over a list held elsewhere.
  const levyOrder = Array.isArray(data.levyItemOrder) && data.levyItemOrder.length
    ? data.levyItemOrder.filter((l) => l in levyItems)
    : [];
  const levyLines = [...levyOrder, ...Object.keys(levyItems).filter((l) => !levyOrder.includes(l))];
  const levy = levyLines.reduce((s, item) => s + (Number(levyItems[item]) || 0), 0);
  const extras = (data.additionalCharges || []).map((c, i) => ({ id: `ac${i}`, description: c.description, amount: Number(c.amount) || 0 }));
  const additionalTotal = extras.reduce((s, e) => s + e.amount, 0);
  const total = levy + utilitiesDue + additionalTotal;

  // A submitted deduction for this period (if any), shaped for the deduction
  // card so a tenant sees it when they open that month's statement.
  const rem = data.remittance;
  let deduction = null;
  if (rem && Number(rem.deductionAmount) > 0) {
    deduction = {
      period: data.period,
      amount: Number(rem.deductionAmount),
      comment: rem.deductionComment || "",
      items: normaliseDeductionItems(rem.deductions, rem.deductionAmount, rem.deductionComment),
      approved: !!rem.deductionApproved,
      proofAttached: (rem.proofNames || []).length > 0,
      proofFileNames: rem.proofNames || [],
      statementTotal: total,
      submittedAt: rem.submittedAt ? String(rem.submittedAt).slice(0, 10) : "",
    };
  }

  const u = data.unit || {};
  const payment = data.payment || null; // { amount, reviewed } from bank_transactions
  return {
    id: "U" + u.unitNumber, owner: u.owner, pq: Number(u.pq),
    wPrev, wCurr, ePrev, eCurr, wUse, eUse, electricityRate, vatRate,
    waterCost, elecCost, waterCostComputed, elecCostComputed,
    waterOverridden: ov.waterDue != null, elecOverridden: ov.electricityDue != null,
    subTotal, vat, utilitiesDue,
    levy, levyItems, levyLines, extras, additionalTotal, total,
    deduction, payment,
  };
}

// ---------- Database load & save (trustee, authenticated) ----------
// The most recent period, used as the default the app opens on. The trustee can
// switch to any past month via the period selector — see ACTIVE_PERIOD below.
const CURRENT_PERIOD = "2026-07-01";
// The period every data read/write currently targets. It's a module-level
// mutable binding (same pattern as UNITS) so the period-aware DB helpers below
// don't each need it threaded through — App keeps it in sync with the selected
// month and re-runs loadAppData whenever it changes.
let ACTIVE_PERIOD = CURRENT_PERIOD;
// South African body corp financial year runs August to July:
//   Aug 2025 – Jul 2026 = "2025/2026"
//   Aug 2026 – Jul 2027 = "2026/2027"
// Used ONLY for levy tables (levy_rates, levy_manual_entries) which are
// set annually at the AGM. Rate tables (water, electricity) now use
// effective_from dates instead — see loadAppData.
function periodToFY(period) {
  const [y, m] = String(period).split("-").map(Number);
  return m >= 8 ? `${y}/${y + 1}` : `${y - 1}/${y}`;
}
function previousFY(fy) {
  const [start] = fy.split("/").map(Number);
  return `${start - 1}/${start}`;
}
let FY_ACTIVE = periodToFY(CURRENT_PERIOD);     // body corp FY for levy tables
let FY_PREVIOUS = previousFY(FY_ACTIVE);

// ---- Financial-year helpers (analytics) ----
// The body corp FY runs 1 August – 31 July, so "2025/2026" covers
// 2025-08-01 .. 2026-07-31. periodToFY above takes a first-of-month period;
// these take any ISO date, because analytics buckets on transaction date.
function fyOfDate(dateStr) {
  const [y, m] = String(dateStr).split("-").map(Number);
  if (!y || !m) return null;
  return m >= 8 ? `${y}/${y + 1}` : `${y - 1}/${y}`;
}
function fyBounds(fy) {
  const start = Number(String(fy).split("/")[0]);
  return { from: `${start}-08-01`, to: `${start + 1}-07-31` };
}
function fyLabel(fy) {
  const start = Number(String(fy).split("/")[0]);
  return `Aug ${start} – Jul ${start + 1}`;
}

// A month's levies are billed for period M but only paid the following month,
// so they land on period M+1's bank statement. Reconciliation therefore matches
// period M's unit statements against the M+1 bank statement — the "payment
// period". nextPeriod does that +1-month step (with year rollover).
function nextPeriod(period) {
  const [y, m] = String(period).split("-").map(Number);
  const d = new Date(y, m, 1); // m (1-based) as month index = next month
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-01`;
}
function prevPeriod(period) {
  const [y, m] = String(period).split("-").map(Number);
  const d = new Date(y, m - 2, 1); // m-1 is current (0-based), m-2 is previous
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-01`;
}
// The bank-statement month the current statement period reconciles against.
let ACTIVE_PAYMENT_PERIOD = nextPeriod(CURRENT_PERIOD);

// "2026-06-01" -> "June 2026". Used for every period label in the UI so they
// track the selected month instead of a hardcoded "June 2026".
// Today, as an ISO date. Module scope because the tariff editor, the
// maintenance register and the inspection form all need it, and a second
// definition is how two screens end up disagreeing about what day it is.
const TODAY_ISO = new Date().toISOString().slice(0, 10);
const MONTH_NAMES = ["January","February","March","April","May","June","July","August","September","October","November","December"];
// "2026-08-06" -> "6 August 2026". Module level because the statement screen
// needs it too; the AGM report builder keeps its own local copy.
function fmtLongDate(iso) {
  if (!iso) return "";
  const [y, m, d] = String(iso).split("-").map(Number);
  if (!y || !m || !d) return String(iso);
  return `${d} ${MONTH_NAMES[m - 1] || m} ${y}`;
}

function periodLabel(period) {
  if (!period) return "";
  const [y, m] = String(period).split("-");
  const mi = parseInt(m, 10) - 1;
  return `${MONTH_NAMES[mi] || m} ${y}`;
}
// The levy "due by" date on a statement is the 7th of the month after the
// statement period (e.g. June 2026 statement -> due 7 July 2026).
function periodDueLabel(period) {
  if (!period) return "";
  const [y, m] = String(period).split("-").map(Number);
  const due = new Date(y, m, 7); // m (1-based) as month index = next month
  return `7 ${MONTH_NAMES[due.getMonth()]} ${due.getFullYear()}`;
}

// Distinct months that have statement data, newest first — drives the period
// selector. Uses monthly_usage since that's what every statement is built from.
async function fetchAvailablePeriods() {
  const client = await ensureSupabaseClient();
  const { data, error } = await client.from("monthly_usage").select("period");
  if (error) throw error;
  const uniq = Array.from(new Set([CURRENT_PERIOD, ...(data || []).map((r) => r.period)]));
  uniq.sort((a, b) => (a < b ? 1 : -1)); // newest first
  // Always offer the month after the newest one that has data. Without this the
  // selector can't reach a month until its readings are captured, which makes it
  // impossible to set up a new financial year's levies and rates in advance —
  // and the body corp FY turns over on 1 August, before any August readings exist.
  if (uniq.length) uniq.unshift(nextPeriod(uniq[0]));
  return uniq;
}

// One parallel fetch of everything the trustee screens need, mapped into the
// exact shapes the app's state already uses. Runs after login; on any error
// the app stays fully usable on the mock defaults.
async function loadAppData(units, period = ACTIVE_PERIOD, paymentPeriod = nextPeriod(period)) {
  const client = await ensureSupabaseClient();
  const unitByDbId = Object.fromEntries(units.map((u) => [u.dbId, u.id]));
  // Statement inputs (readings, levy, charges, council, remittances) are for the
  // statement `period`; the bank statement + transactions are for the following
  // month (`paymentPeriod`), because that's when this period's levies are paid.
  const [bands, elec, vat, levy, manual, itemDefs, usage, prevUsage, charges, expenses, invoice, btxns, bdocs, remits, overrides, manualPays, expCats, ownerChanges] = await Promise.all([
    client.from("water_tariff_bands").select("*"),
    // Electricity: most recent effective_from ≤ this period (top 2 for YoY comparison)
    client.from("electricity_rates").select("*").lte("effective_from", period).order("effective_from", { ascending: false }).limit(2),
    client.from("vat_rates").select("*").order("effective_from", { ascending: false }).limit(1),
    // Levy tables stay keyed to the body corp FY (Aug–Jul). Both years are
    // fetched in one round trip so a brand-new FY can carry last year's figures
    // forward rather than falling back to the source-code defaults.
    client.from("levy_rates").select("*").in("financial_year", [FY_ACTIVE, FY_PREVIOUS]),
    client.from("levy_manual_entries").select("*").in("financial_year", [FY_ACTIVE, FY_PREVIOUS]),
    // The line item list itself, same two years in the same round trip and for
    // the same reason: a brand-new FY carries last year's list forward.
    client.from("levy_item_definitions").select("*").in("financial_year", [FY_ACTIVE, FY_PREVIOUS]),
    client.from("monthly_usage").select("*").eq("period", period),
    // Previous period's readings — their "current" becomes this period's "previous"
    client.from("monthly_usage").select("*").eq("period", prevPeriod(period)),
    client.from("additional_charges").select("*").eq("period", period),
    client.from("ops_expenses").select("*").order("expense_date", { ascending: false }),
    client.from("council_invoices").select("*").eq("period", period).limit(1),
    // Two sets, unioned: everything on THIS bank statement (for the transaction
    // listing and needs-review work), plus any payment applied to this statement
    // month from another bank month — a resident paying early or late.
    client.from("bank_transactions").select("*")
      .or(`period.eq.${paymentPeriod},applied_period.eq.${period}`)
      .order("txn_date"),
    client.from("bank_statement_documents").select("*").eq("period", paymentPeriod).order("uploaded_at", { ascending: false }).limit(1),
    client.from("remittance_advices").select("*").eq("period", period),
    client.from("statement_overrides").select("*").eq("period", period),
    client.from("manual_payments").select("*").eq("applied_period", period),
    // Trustee-managed expense category list (Config module) — the single
    // vocabulary every tagging dropdown and the analytics dashboard use.
    client.from("expense_categories").select("*").order("sort_order").order("name"),
    // A unit that changed hands this month: its presence is what makes the
    // statement screen produce two statements instead of one.
    client.from("ownership_changes").select("*").eq("period", period),
  ]);
  const failed = [bands, elec, vat, levy, manual, itemDefs, usage, prevUsage, charges, expenses, invoice, btxns, bdocs, remits, overrides, manualPays, expCats, ownerChanges].find((r) => r.error);
  if (failed) throw failed.error;

  const expenseCategories = (expCats.data || []).map((c) => ({
    id: c.id, name: c.name, sortOrder: Number(c.sort_order || 0), active: c.active !== false,
  }));

  // Water bands: the DB stores one row per band per effective date; the app
  // wants one object per band with current + previous rates side by side.
  // Find the two most recent effective dates that are ≤ the viewing period.
  const allEffDates = [...new Set((bands.data || []).map((b) => b.effective_from))].sort().reverse();
  const waterActiveEffDate = allEffDates.find((d) => d <= period) || allEffDates[0] || null;
  const waterPrevEffDate = waterActiveEffDate ? (allEffDates.find((d) => d < waterActiveEffDate) || null) : null;

  const byLabel = {};
  bands.data.forEach((b) => {
    if (!byLabel[b.band_label]) {
      byLabel[b.band_label] = {
        id: b.band_label, label: b.band_label,
        from: Number(b.from_kl), to: b.to_kl == null ? null : Number(b.to_kl),
        rate2024: 0, rate2025: 0, // rate2025 = active set, rate2024 = previous set
      };
    }
    if (b.effective_from === waterActiveEffDate) byLabel[b.band_label].rate2025 = Number(b.rate_per_kl);
    if (b.effective_from === waterPrevEffDate) byLabel[b.band_label].rate2024 = Number(b.rate_per_kl);
  });
  const waterBands = Object.values(byLabel).sort((a, b) => a.from - b.from);

  // The complete rate-set history, keyed by effective date. The two collapsed
  // sets above are period-scoped (they answer "what did this month bill on?"),
  // which is right for billing but wrong for the Tariffs & rates editor — there
  // the trustee picks an effective date, and the Previous column must resolve
  // against that date, not against the month being viewed.
  const waterBandHistory = {};
  (bands.data || []).forEach((b) => {
    if (!waterBandHistory[b.effective_from]) waterBandHistory[b.effective_from] = {};
    waterBandHistory[b.effective_from][b.band_label] = {
      from: Number(b.from_kl),
      to: b.to_kl == null ? null : Number(b.to_kl),
      rate: Number(b.rate_per_kl),
    };
  });

  // Levy manual grid: start from the app defaults, overlay the saved rows for
  // this FY. A financial year that has never been set up has no rows at all —
  // in that case fall back to last year's grid as an editable starting point,
  // because the source-code defaults are years out of date. Nothing is written
  // until the trustee saves, so the previous year's rows stay untouched.
  const manualActive = (manual.data || []).filter((m) => m.financial_year === FY_ACTIVE);
  const manualPrevious = (manual.data || []).filter((m) => m.financial_year === FY_PREVIOUS);
  const levyCarriedForward = manualActive.length === 0 && manualPrevious.length > 0;
  const manualRows = manualActive.length ? manualActive : manualPrevious;

  // The line item list for this FY, carried forward from last year when the
  // year hasn't been set up — the same rule the grid above follows, so the
  // list and the figures on it can never disagree about which year they are.
  // Nothing is written until the trustee saves, so last year stays untouched.
  const defRow = (r) => ({
    label: r.label,
    systemKey: r.system_key || null,
    sortOrder: Number(r.sort_order || 0),
    active: r.active !== false,
  });
  const bySortThenLabel = (a, b) => (a.sortOrder - b.sortOrder) || a.label.localeCompare(b.label);
  const defsActiveFY = (itemDefs.data || []).filter((d) => d.financial_year === FY_ACTIVE).map(defRow);
  const defsPrevFY = (itemDefs.data || []).filter((d) => d.financial_year === FY_PREVIOUS).map(defRow);
  // A carried-forward list drops last year's removed lines rather than
  // resurrecting them: they were removed going forward, and this is forward.
  const levyItemDefs = (defsActiveFY.length
    ? defsActiveFY
    : (defsPrevFY.length ? defsPrevFY.filter((d) => d.active) : LEVY_ITEM_DEFS_DEFAULT.slice())
  ).sort(bySortThenLabel);
  const levyItemsCarriedForward = defsActiveFY.length === 0 && defsPrevFY.length > 0;
  const activeLabels = levyItemDefs.filter((d) => d.active).map((d) => d.label);

  const levyBreakdown = Object.fromEntries(
    units.map((u) => [u.id, Object.fromEntries(activeLabels.map((l) => [l, 0]))])
  );
  manualRows.forEach((m) => {
    const uid = unitByDbId[m.unit_id];
    if (!uid) return;
    if (!levyBreakdown[uid]) levyBreakdown[uid] = {};
    levyBreakdown[uid][m.item_label] = Number(m.amount);
  });

  // Build a lookup of the previous period's current readings — these become
  // this period's "previous" readings so the carry-forward is always correct.
  const prevReadings = {};
  (prevUsage.data || []).forEach((m) => {
    const uid = unitByDbId[m.unit_id];
    if (uid) prevReadings[uid] = { wCurr: Number(m.water_current), eCurr: Number(m.electricity_current) };
  });

  const readings = {};
  usage.data.forEach((m) => {
    const uid = unitByDbId[m.unit_id];
    if (!uid) return;
    const prev = prevReadings[uid];
    readings[uid] = {
      // Always derive previous from the prior month's current — this ensures
      // corrections to last month automatically flow through.
      wPrev: prev ? prev.wCurr : Number(m.water_previous),
      wCurr: Number(m.water_current),
      ePrev: prev ? prev.eCurr : Number(m.electricity_previous),
      eCurr: Number(m.electricity_current),
      dbId: m.id,
    };
  });
  // If this period has no rows yet (first time viewing), seed entries with
  // the previous period's current readings as the starting point.
  units.forEach((u) => {
    if (!readings[u.id]) {
      const prev = prevReadings[u.id];
      readings[u.id] = {
        wPrev: prev ? prev.wCurr : 0,
        wCurr: prev ? prev.wCurr : 0, // default current = previous (zero usage until entered)
        ePrev: prev ? prev.eCurr : 0,
        eCurr: prev ? prev.eCurr : 0,
        dbId: null,
      };
    }
  });

  const additionalCharges = Object.fromEntries(units.map((u) => [u.id, []]));
  charges.data.forEach((c) => {
    const uid = unitByDbId[c.unit_id];
    if (uid) additionalCharges[uid].push({
      id: c.id, description: c.description, amount: Number(c.amount),
      expenseCategory: c.expense_category || "",
    });
  });

  // supersededReason is non-null when the row duplicates a bank line or an
  // approved resident deduction — kept for audit, excluded from analytics.
  const opsExpenses = expenses.data.map((e) => ({
    id: e.id, date: e.expense_date, category: e.category, amount: Number(e.amount), notes: e.notes || "",
    supersededReason: e.superseded_reason || null,
  }));

  // Persisted bank statement (null when none uploaded yet — demo data stays).
  const bankTxns = btxns.data.length
    ? btxns.data.map((t) => ({
        dbId: t.id,
        date: t.txn_date, desc: t.description_raw, amount: Number(t.amount),
        direction: t.direction, accruedCharge: Number(t.accrued_bank_charge || 0),
        ref: t.description_raw, category: t.category,
        matchedUnit: t.matched_unit_id ? unitByDbId[t.matched_unit_id] || null : null,
        confidence: t.match_confidence, note: t.match_note,
        reviewed: !!t.reviewed, reviewNote: t.review_note || "",
        // Trustee-assigned expense category — what drives the analytics dashboard.
        expenseCategory: t.expense_category || "",
        // Which bank month the line is ON, vs which statement month it SETTLES.
        // These differ when a resident pays early, late, or twice in a month.
        period: t.period,
        appliedPeriod: t.applied_period || null,
      }))
    : null;

  // Provisional payments the trustee recorded before the bank statement landed.
  // Deduplication is derived, not stored: reconcileUnits ignores any manual
  // entry once a real bank line exists for the same unit and statement month.
  const manualPayments = (manualPays.data || []).map((m) => ({
    dbId: m.id,
    unit: unitByDbId[m.unit_id] || null,
    appliedPeriod: m.applied_period,
    amount: Number(m.amount),
    datePaid: m.date_paid || null,
    note: m.note || "",
  })).filter((m) => m.unit);

  const bdoc = bdocs.data[0];
  const bankStatementMeta = bdoc
    ? { fileName: bdoc.file_name, parsedAt: new Date(bdoc.uploaded_at).toLocaleString("en-ZA"), count: bdoc.transaction_count }
    : null;

  // Remittance deductions keyed by app unit id — only submissions that
  // actually claim a deduction appear on the Reconciliation page.
  const remittanceDeductions = {};
  remits.data.forEach((r) => {
    const uid = unitByDbId[r.unit_id];
    if (!uid || Number(r.deduction_amount || 0) <= 0) return;
    remittanceDeductions[uid] = {
      dbId: r.id,
      period: r.period, // the statement period this deduction belongs to
      amount: Number(r.deduction_amount),
      comment: r.deduction_comment || "",
      items: normaliseDeductionItems(r.deductions, r.deduction_amount, r.deduction_comment),
      proofAttached: (r.proof_document_urls || []).length > 0,
      proofFileNames: r.proof_document_urls || [],
      approved: !!r.deduction_approved,
      submittedAt: r.submitted_at ? String(r.submitted_at).slice(0, 10) : "",
    };
  });

  // Every submitted remittance advice (deduction or not), keyed by app unit
  // id — the Reconciliation page shows declared payments and proof documents
  // for all of them, not just deduction claims.
  const remittanceAdvices = {};
  remits.data.forEach((r) => {
    const uid = unitByDbId[r.unit_id];
    if (!uid) return;
    remittanceAdvices[uid] = {
      dbId: r.id,
      amountPaid: r.amount_paid == null ? null : Number(r.amount_paid),
      datePaid: r.date_paid || null,
      proofFileNames: r.proof_document_urls || [],
      submittedAt: r.submitted_at ? String(r.submitted_at).slice(0, 10) : "",
    };
  });

  // Manual per-statement overrides for the computed utility lines, keyed by app
  // unit id. A null column means "use the computed value".
  const statementOverrides = {};
  overrides.data.forEach((o) => {
    const uid = unitByDbId[o.unit_id];
    if (!uid) return;
    statementOverrides[uid] = {
      waterDue: o.water_due == null ? null : Number(o.water_due),
      electricityDue: o.electricity_due == null ? null : Number(o.electricity_due),
      note: o.note || "",
    };
  });

  // Keyed by app unit id, like statementOverrides. At most one per unit per
  // month — the table's unique constraint guarantees it.
  const ownershipChanges = {};
  (ownerChanges.data || []).forEach((o) => {
    const uid = unitByDbId[o.unit_id];
    if (!uid) return;
    ownershipChanges[uid] = {
      id: o.id,
      changeoverDate: o.changeover_date,
      waterReading: o.water_reading == null ? null : Number(o.water_reading),
      electricityReading: o.electricity_reading == null ? null : Number(o.electricity_reading),
      outgoingOwner: o.outgoing_owner || "",
      incomingOwner: o.incoming_owner || "",
      note: o.note || "",
    };
  });

  const inv = invoice.data[0];
  return {
    ownershipChanges,
    bankTxns,
    bankStatementMeta,
    manualPayments,
    remittanceDeductions,
    remittanceAdvices,
    statementOverrides,
    waterBands: waterBands.length ? waterBands : WATER_BANDS_DEFAULT,
    waterEffectiveFrom: waterActiveEffDate,
    waterPrevEffectiveFrom: waterPrevEffDate,
    waterBandHistory,
    electricityRate: elec.data[0] ? Number(elec.data[0].rate_per_kwh) : ELECTRICITY_RATE_DEFAULT,
    electricityEffectiveFrom: elec.data[0]?.effective_from || null,
    vatRate: vat.data[0] ? Number(vat.data[0].rate) : VAT_RATE_DEFAULT,
    // The common-property standards are set annually at the AGM and stored per
    // financial year. A year with no row yet shows last year's figures as a
    // starting point and says so, exactly as the levy grid does — saving then
    // writes a fresh row for the new year and leaves the old one untouched.
    levyRates: (() => {
      const own = (levy.data || []).find((r) => r.financial_year === FY_ACTIVE);
      const row = own || (levy.data || []).find((r) => r.financial_year === FY_PREVIOUS);
      if (!row) return null;
      const n = (v, fallback) => (v == null ? fallback : Number(v));
      return {
        commonPropertyElectricityKwh: n(row.common_property_electricity_kwh, COMMON_PROPERTY_ELECTRICITY_KWH_DEFAULT),
        commonPropertyWaterKl: n(row.common_property_water_kl, COMMON_PROPERTY_WATER_KL_DEFAULT),
        financialYear: FY_ACTIVE,
        carriedForward: !own,
        carriedFromFY: own ? null : row.financial_year,
      };
    })(),
    levyBreakdown,
    levyFinancialYear: FY_ACTIVE,
    levyCarriedForward,
    levyCarriedFromFY: levyCarriedForward ? FY_PREVIOUS : null,
    levyItemDefs,
    levyItemsCarriedForward,
    readings: Object.keys(readings).length ? readings : READINGS,
    additionalCharges,
    opsExpenses,
    expenseCategories,
    councilInvoice: inv
      ? {
          bulkWaterKl: Number(inv.bulk_water_kl), bulkWaterRand: Number(inv.bulk_water_rand),
          bulkElecKwh: Number(inv.bulk_elec_kwh), bulkElecRand: Number(inv.bulk_elec_rand),
          sewerage: Number(inv.sewerage), refuse: Number(inv.refuse), fixedBasic: Number(inv.fixed_basic),
          waterDemandLevyPerUnit: Number(inv.water_demand_levy_per_unit || 0),
          sewerChargePerUnit: Number(inv.sewer_charge_per_unit || 0),
          elecServiceFee: Number(inv.electricity_service_fee || 0),
          elecNetworkFee: Number(inv.electricity_network_fee || 0),
        }
      : COUNCIL_INVOICE_NO_BILL,
    // True when this month has no council_invoices row at all - the utility
    // bills haven't been received/captured, so the bulk figures above are the
    // zero defaults, not real numbers.
    councilInvoiceMissing: !inv,
  };
}

async function saveReadingsToDb(readings) {
  const client = await ensureSupabaseClient();
  // Upsert on (unit_id, period) so saving works whether or not rows already
  // exist for the current period. water/electricity_consumption are GENERATED
  // columns in the v2 schema — the database computes them, never send them.
  const rows = Object.entries(readings)
    .map(([uid, r]) => {
      const unitRow = UNITS.find((u) => u.id === uid);
      if (!unitRow || !unitRow.dbId) return null;
      return {
        unit_id: unitRow.dbId, period: ACTIVE_PERIOD,
        water_previous: r.wPrev, water_current: r.wCurr,
        electricity_previous: r.ePrev, electricity_current: r.eCurr,
        captured_by: "trustee",
      };
    })
    .filter(Boolean);
  if (rows.length === 0) throw new Error("Units haven't loaded from the database yet");
  const { error } = await client.from("monthly_usage").upsert(rows, { onConflict: "unit_id,period" });
  if (error) throw error;
}

// Tariffs & rates saves one section at a time — four independent writers, each
// touching only its own table. They were a single function behind one button;
// splitting them means a failure in one section can't abandon another
// half-written, and the trustee can correct a VAT rate without also committing
// a water rate set they were still working on.
const throwIfBad = (results) => {
  const bad = results.find((x) => x && x.error);
  if (bad) throw bad.error;
};

// Water: one or more rate sets, each keyed by its own effective date. Upsert by
// (effective_from, band_label), so a date with no set yet is created and an
// existing one is corrected in place. Only the sets the trustee actually
// touched are passed in — untouched history is never rewritten.
async function saveWaterBandsToDb(waterSets) {
  const client = await ensureSupabaseClient();
  const updates = [];
  (waterSets || []).forEach((set) => {
    set.bands.forEach((b) => {
      updates.push(client.from("water_tariff_bands").upsert({
        effective_from: set.effectiveFrom, band_label: b.label,
        from_kl: b.from, to_kl: b.to, rate_per_kl: b.rate,
        financial_year: null, // no longer the key — kept for reference
      }, { onConflict: "effective_from,band_label" }));
    });
  });
  throwIfBad(await Promise.all(updates));
}

// Electricity rate: upsert by effective_from (unique constraint).
async function saveElectricityRateToDb({ electricityRate, electricityEffectiveFrom }) {
  const client = await ensureSupabaseClient();
  const { error } = await client.from("electricity_rates").upsert({
    rate_per_kwh: electricityRate,
    effective_from: electricityEffectiveFrom,
    financial_year: null,
  }, { onConflict: "effective_from" });
  if (error) throw error;
}

// VAT is not date-scoped per rate set — single global rate.
async function saveVatRateToDb(vatRate) {
  const client = await ensureSupabaseClient();
  const { error } = await client.from("vat_rates").update({ rate: vatRate }).gte("effective_from", "1900-01-01");
  if (error) throw error;
}

// Common property standards, keyed by financial year. Check whether a row
// exists for the FY, then update or insert — not an upsert, because an upsert
// would carry the sibling columns (water_demand_levy etc.) into the INSERT
// values and overwrite them when the row already exists.
//
// The sibling fees are written as NULL, never 0. Creating this row is a side
// effect of saving the standards, and nobody has entered a demand levy or an
// electricity charge at that point — zero would print in the report as R 0,00,
// which reads as "the scheme charges nothing" rather than "not captured yet".
async function saveCommonPropertyStandardsToDb({ commonPropertyElectricityKwh, commonPropertyWaterKl }) {
  const client = await ensureSupabaseClient();
  const existing = await client.from("levy_rates").select("financial_year").eq("financial_year", FY_ACTIVE).limit(1);
  if (existing.error) throw existing.error;
  const { error } = existing.data?.length > 0
    ? await client.from("levy_rates").update({
        common_property_electricity_kwh: commonPropertyElectricityKwh,
        common_property_water_kl: commonPropertyWaterKl,
      }).eq("financial_year", FY_ACTIVE)
    : await client.from("levy_rates").insert({
        financial_year: FY_ACTIVE,
        common_property_electricity_kwh: commonPropertyElectricityKwh,
        common_property_water_kl: commonPropertyWaterKl,
        water_demand_levy: null, electricity_service_fee: null, electricity_network_fee: null,
      });
  if (error) throw error;
}

// Every grid cell is stored — the levy grid is fully manual.
//
// The delete is scoped to the labels being rewritten, NOT to the whole
// financial year. A removed line keeps its captured amounts (the AGM pack
// reports on what was actually levied in the year, so those figures cannot be
// thrown away) and a year-wide delete would have destroyed them on the next
// save of any cell — quietly, and a month later.
async function saveLevyBreakdownToDb(levyBreakdown) {
  const client = await ensureSupabaseClient();
  const labels = LEVY_ITEMS.slice();
  const rows = [];
  UNITS.forEach((u) => {
    if (!u.dbId) return;
    labels.forEach((item) => {
      rows.push({ unit_id: u.dbId, financial_year: FY_ACTIVE, item_label: item, amount: levyBreakdown[u.id]?.[item] ?? 0 });
    });
  });
  if (rows.length === 0) throw new Error("Units haven't loaded from the database yet");
  const { error: delErr } = await client.from("levy_manual_entries")
    .delete().eq("financial_year", FY_ACTIVE).in("item_label", labels);
  if (delErr) throw delErr;
  const { error } = await client.from("levy_manual_entries").insert(rows);
  if (error) throw error;
}

// Add, remove or restore a levy line for the ACTIVE financial year only.
//
// Every write materialises the whole list for FY_ACTIVE first. Until the year
// is set up it has no rows of its own and is being shown last year's list
// carried forward; editing that list has to write this year's copy rather than
// reach back and edit last year's, which is what keeps a closed year closed.
async function writeLevyItemDefsForActiveFY(defs) {
  const client = await ensureSupabaseClient();
  const rows = defs.map((d, i) => ({
    financial_year: FY_ACTIVE,
    label: d.label,
    system_key: d.systemKey || null,
    sort_order: d.sortOrder != null ? d.sortOrder : i + 1,
    active: d.active !== false,
    updated_at: new Date().toISOString(),
  }));
  // Upsert, NOT delete-then-insert. levy_manual_entries carries a foreign key
  // onto (financial_year, label) with ON DELETE RESTRICT, so clearing the year
  // first would be rejected the moment any figures had been captured against
  // it — which is always, after the first save.
  const { error } = await client.from("levy_item_definitions")
    .upsert(rows, { onConflict: "financial_year,label" });
  if (error) throw error;

  // Tidy up any definition for this year that has dropped off the list
  // entirely and has no figures against it. The UI deactivates rather than
  // dropping, so this normally does nothing; RESTRICT protects anything that
  // does have figures, which is the outcome we want.
  const keep = rows.map((r) => r.label);
  const stale = await client.from("levy_item_definitions")
    .select("label").eq("financial_year", FY_ACTIVE);
  if (stale.error) throw stale.error;
  const orphans = (stale.data || []).map((r) => r.label).filter((l) => !keep.includes(l));
  if (orphans.length) {
    const { error: delErr } = await client.from("levy_item_definitions")
      .delete().eq("financial_year", FY_ACTIVE).in("label", orphans);
    if (delErr) console.error("Could not clear unused levy line definitions:", delErr);
  }
}

// Suggested per-unit levy amounts from the confirmed rules — all VAT
// inclusive. Insurance is null here because it is the one line that differs per
// unit: it comes from that unit's own row on the insurance schedule, which
// LevySetup loads separately and applies per unit. These drive the suggestions
// strip and the "fill grid" action on the Levy breakdown page; the grid itself
// stays fully editable.
// Keyed by system_key, then mapped onto whatever those lines are currently
// called. Keying on the label would have meant a suggestion silently stopped
// matching the moment the trustee edited the text — and a line they invented
// has no rule the app could compute, so it correctly gets no suggestion at all
// rather than a zero that looks like an answer.
function computeSuggestedLevyItems({ waterBands, electricityRate, vatRate, commonPropertyElectricityKwh, commonPropertyWaterKl, councilInvoice }, defs = LEVY_ITEM_DEFS) {
  const withVat = (n) => n * (1 + vatRate);
  const bySystemKey = {
    // Insurance is null because it is the one line that differs per unit — it
    // comes from that unit's own row on the insurance schedule, which
    // LevySetup loads separately and applies per unit.
    insurance: null,
    blockwatch: 0,
    garden_service: 0,
    common_property_water: withVat(calcWaterCost(commonPropertyWaterKl, waterBands)) / UNITS.length,
    water_demand_levy: withVat(councilInvoice.waterDemandLevyPerUnit || 0),
    sewerage: withVat(councilInvoice.sewerChargePerUnit || 0),
    common_property_electricity: withVat(commonPropertyElectricityKwh * electricityRate) / UNITS.length,
    electricity_service_charge: withVat(councilInvoice.elecServiceFee || 0) / UNITS.length,
    electricity_network_charge: withVat(councilInvoice.elecNetworkFee || 0) / UNITS.length,
  };
  const out = {};
  defs.filter((d) => d.active).forEach((d) => {
    // `undefined` (no rule for this line) and `null` (a rule that deliberately
    // yields nothing, i.e. Insurance) are different and stay different.
    if (d.systemKey && d.systemKey in bySystemKey) out[d.label] = bySystemKey[d.systemKey];
  });
  return out;
}

async function saveCouncilInvoiceToDb(ci) {
  const client = await ensureSupabaseClient();
  // Upsert on period — a plain UPDATE silently does nothing when no row
  // exists yet for the month (which is how invoice uploads used to "save"
  // without actually writing anything).
  const { error } = await client
    .from("council_invoices")
    .upsert({
      period: ACTIVE_PERIOD,
      bulk_water_kl: ci.bulkWaterKl, bulk_water_rand: ci.bulkWaterRand,
      bulk_elec_kwh: ci.bulkElecKwh, bulk_elec_rand: ci.bulkElecRand,
      sewerage: ci.sewerage, refuse: ci.refuse, fixed_basic: ci.fixedBasic,
      water_demand_levy_per_unit: ci.waterDemandLevyPerUnit,
      sewer_charge_per_unit: ci.sewerChargePerUnit,
      electricity_service_fee: ci.elecServiceFee,
      electricity_network_fee: ci.elecNetworkFee,
    }, { onConflict: "period" });
  if (error) throw error;
}

// Best-effort extraction from the council utility bills. The per-unit lines
// are anchored on the known wording ("… per 7 living unit(s) @ R65.08");
// other patterns are provisional until calibrated against the real PDFs —
// anything unmatched is simply left for manual entry in the review form,
// which always sits between parsing and saving.
async function parseUtilityBillPdf(file, kind) {
  const pdfjsLib = await ensurePdfJsLoaded();
  const buf = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
  const lines = await extractPdfLines(pdf);
  const text = lines.join("\n");
  const grab = (re) => {
    const m = text.match(re);
    return m ? parseFloat(m[1].replace(/,/g, "")) : null;
  };
  const out = {};
  if (kind === "water") {
    out.sewerChargePerUnit = grab(/sewer[^@\n]*@\s*R?\s*([\d,]+\.\d{2})/i);
    out.waterDemandLevyPerUnit = grab(/water\s*demand\s*levy[^@\n]*@\s*R?\s*([\d,]+\.\d{2})/i);
    out.bulkWaterKl = grab(/consumption[^0-9\n]*([\d,]+(?:\.\d+)?)\s*kl/i);
  } else {
    out.elecServiceFee = grab(/service\s*charge[^0-9R\n]*R?\s*([\d,]+\.\d{2})/i);
    out.elecNetworkFee = grab(/network\s*(?:access\s*)?charge[^0-9R\n]*R?\s*([\d,]+\.\d{2})/i);
    out.bulkElecKwh = grab(/([\d,]+(?:\.\d+)?)\s*kwh/i);
  }
  const matched = Object.values(out).filter((v) => v != null).length;
  return { fields: out, matched, total: Object.keys(out).length };
}

// Parser dates look like "01 Jun"; demo data is already ISO. Falls back to
// the period itself if a date can't be made sense of.
//
// `forPeriod` is the statement's own period and supplies the year the printed
// day-and-month has to be resolved against. It defaults to ACTIVE_PAYMENT_PERIOD
// for the Tenant recon path, which only ever imports the current one — but Bank
// recon can import any month, and taking the year from whatever period happened
// to be selected would file a December 2025 statement in December 2026.
//
// A December statement carrying an early-January line is the case that breaks a
// naive year: the month rolls back to 01 while the statement's own month is 12,
// so the line belongs to the FOLLOWING year. Detected by comparing months and
// corrected in both directions.
function statementDateToIso(raw, forPeriod) {
  const base = forPeriod || ACTIVE_PAYMENT_PERIOD;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const m = String(raw).match(/^(\d{1,2})\s+([A-Za-z]{3})/);
  if (!m) return base;
  const months = { jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06", jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12" };
  const mm = months[m[2].toLowerCase()];
  if (!mm) return base;
  let year = Number(base.slice(0, 4));
  const baseMonth = Number(base.slice(5, 7));
  const lineMonth = Number(mm);
  if (baseMonth === 12 && lineMonth === 1) year += 1;
  else if (baseMonth === 1 && lineMonth === 12) year -= 1;
  return `${year}-${mm}-${m[1].padStart(2, "0")}`;
}

// Persists a parsed statement wholesale for the period — re-uploading a
// corrected PDF replaces the previous document and its transactions rather
// than duplicating them.
// THE single write path for an imported statement, and now the only one — the
// Tenant recon upload handler that used to call its own version was removed on
// 8 August 2026 when Bank recon took ownership of importing. One parser, one
// write path, one balance check.
//
// Re-importing a corrected PDF replaces that period's document and its
// transactions rather than duplicating them.
async function saveBankStatementForPeriod(period, fileName, txns, balances) {
  const client = await ensureSupabaseClient();
  const unitDbIdByAppId = Object.fromEntries(UNITS.filter((u) => u.dbId).map((u) => [u.id, u.dbId]));

  // Any trustee retargeting lives on rows the delete below is about to remove.
  // Capture it first and re-apply after the re-insert, or re-importing a
  // statement silently reverts the fix and the month quietly goes unpaid again.
  const defaultApplied = prevPeriod(period);
  const { data: priorTxns } = await client
    .from("bank_transactions")
    .select("txn_date, amount, description_raw, applied_period")
    .eq("period", period)
    .eq("category", "resident_payment");
  const retargeted = (priorTxns || []).filter(
    (p) => p.applied_period && p.applied_period !== defaultApplied
  );

  let { error } = await client.from("bank_transactions").delete().eq("period", period);
  if (error) throw error;
  ({ error } = await client.from("bank_statement_documents").delete().eq("period", period));
  if (error) throw error;
  const { data: doc, error: docErr } = await client
    .from("bank_statement_documents")
    .insert({
      period: period, file_name: fileName, parse_status: "parsed", transaction_count: txns.length,
      // Nulls where no balances were derived, so a statement imported by the
      // older path is visibly un-verified rather than falsely showing R0.00.
      opening_balance: balances && balances.opening != null ? balances.opening : null,
      closing_balance: balances && balances.closing != null ? balances.closing : null,
      balance_source: balances && balances.balanceSource ? balances.balanceSource : "unavailable",
      // The statement's own printed period wins over the first and last
      // transaction dates, which only bound the movements and miss a quiet
      // start or end to the month.
      statement_from: (balances && balances.header && balances.header.from)
        || (txns.length ? statementDateToIso(txns[0].date, period) : null),
      statement_to: (balances && balances.header && balances.header.to)
        || (txns.length ? statementDateToIso(txns[txns.length - 1].date, period) : null),
      account_number: (balances && balances.header && balances.header.accountNumber) || null,
    })
    .select("id")
    .single();
  if (docErr) throw docErr;
  const rows = txns.map((t) => ({
    bank_statement_document_id: doc.id,
    period: period,
    txn_date: statementDateToIso(t.date, period),
    description_raw: t.desc,
    amount: t.amount,
    direction: t.direction,
    accrued_bank_charge: t.accruedCharge || 0,
    category: t.category,
    matched_unit_id: t.matchedUnit ? unitDbIdByAppId[t.matchedUnit] || null : null,
    match_confidence: t.confidence,
    match_note: t.note,
    balance_after: t.balanceAfter == null ? null : t.balanceAfter,
    line_no: t.lineNo == null ? null : t.lineNo,
  }));
  ({ error } = await client.from("bank_transactions").insert(rows));
  if (error) throw error;

  // Re-apply retargeting, matched on the natural key. A deliberate compromise:
  // if the bank ever restates a line's date, amount or description the override
  // won't reattach and the line reverts to the default — which shows up as an
  // unpaid month on the Reconciliation page rather than a silently wrong figure.
  for (const o of retargeted) {
    const { error: upErr } = await client
      .from("bank_transactions")
      .update({ applied_period: o.applied_period })
      .eq("period", period)
      .eq("txn_date", o.txn_date)
      .eq("amount", o.amount)
      .eq("description_raw", o.description_raw);
    if (upErr) console.warn("Could not restore applied_period override:", upErr.message);
  }
  if (retargeted.length) {
    console.info(`Restored ${retargeted.length} applied-period override(s) after re-import.`);
  }
}

// Point a bank line at a different statement month — for a resident who paid
// early, late, or twice in one bank month.
async function setAppliedPeriodInDb(txnDbId, appliedPeriod) {
  const client = await ensureSupabaseClient();
  // .select() is required: without it Supabase returns count: null, so a failed
  // update is indistinguishable from a successful no-op.
  const { data, error } = await client
    .from("bank_transactions")
    .update({ applied_period: appliedPeriod })
    .eq("id", txnDbId)
    .select();
  if (error) throw new Error(`Could not change applied period: ${error.message}`);
  return data;
}

// Provisional payment, recorded before the bank statement exists. One per unit
// per statement month — re-recording overwrites rather than duplicating.
async function saveManualPaymentToDb({ unitId, appliedPeriod, amount, datePaid, note }) {
  const client = await ensureSupabaseClient();
  const unitDbId = (UNITS.find((u) => u.id === unitId) || {}).dbId;
  if (!unitDbId) throw new Error(`Unknown unit ${unitId}`);
  const { data, error } = await client
    .from("manual_payments")
    .upsert(
      { unit_id: unitDbId, applied_period: appliedPeriod, amount, date_paid: datePaid || null, note: note || null },
      { onConflict: "unit_id,applied_period" }
    )
    .select()
    .single();
  if (error) throw new Error(`Could not save manual payment: ${error.message}`);
  return data;
}

async function deleteManualPaymentFromDb(id) {
  const client = await ensureSupabaseClient();
  const { error } = await client.from("manual_payments").delete().eq("id", id);
  if (error) throw new Error(`Could not remove manual payment: ${error.message}`);
}

// Resident submissions go through the token RPC (anon); the trustee's
// resident-view demo uses a direct authenticated upsert instead. Returns the
// remittance row's id either way.
async function submitRemittanceToDb(unitId, payload) {
  const client = await ensureSupabaseClient();
  // Upload the actual proof files to Storage first — the DB row stores the
  // resulting storage paths. If an upload fails, the whole submission fails
  // (better than a deduction claim silently missing its evidence).
  const proofPaths = await uploadProofFiles(unitId, payload.proofFiles);
  // Itemised deductions: an array of { amount, comment }. Derive the total and a
  // summary comment so the reconciliation (which nets on the total) and the
  // legacy single-deduction columns stay consistent.
  const items = (payload.deductions || []).filter((d) => Number(d.amount) > 0);
  const total = items.reduce((s, d) => s + Number(d.amount), 0);
  const summary = items.map((d) => d.comment).filter(Boolean).join("; ") || null;
  if (RESIDENT_TOKEN) {
    const { data, error } = await client.rpc("submit_remittance", {
      p_token: RESIDENT_TOKEN,
      p_period: ACTIVE_PERIOD,
      p_amount_paid: payload.amountPaid,
      p_date_paid: payload.datePaid,
      p_deductions: items,
      p_proof_names: proofPaths,
    });
    if (error) throw error;
    if (!data) throw new Error("This resident link is no longer valid");
    return { id: data, proofPaths };
  }
  const unitRow = UNITS.find((u) => u.id === unitId);
  if (!unitRow || !unitRow.dbId) throw new Error("Units haven't loaded from the database yet");
  const { error: delErr } = await client.from("remittance_advices").delete().eq("unit_id", unitRow.dbId).eq("period", ACTIVE_PERIOD);
  if (delErr) throw delErr;
  const { data, error } = await client
    .from("remittance_advices")
    .insert({
      unit_id: unitRow.dbId, period: ACTIVE_PERIOD,
      amount_paid: payload.amountPaid, date_paid: payload.datePaid,
      deduction_amount: total, deduction_comment: summary,
      deductions: items, deduction_approved: false, proof_document_urls: proofPaths,
    })
    .select("id")
    .single();
  if (error) throw error;
  return { id: data.id, proofPaths };
}

// ---------- Auth (trustee login) ----------
// RLS is now enabled on every table with signed-in-users-only policies, so
// nothing loads from the database without a session. Only the trustee has an
// account for now — the resident view stays a demo until per-unit resident
// logins land. supabase-js persists the session in localStorage and refreshes
// tokens itself, so a page reload keeps you signed in.
async function signInWithPassword(email, password) {
  const client = await ensureSupabaseClient();
  const { error } = await client.auth.signInWithPassword({ email, password });
  return error ? error.message : null;
}

// scope: "local" is deliberate and matters.
//
// supabase-js defaults signOut() to scope "global", which destroys EVERY
// refresh token that user holds — on every device and browser they are signed
// in on, not just this one. So a trustee signing off on the clubhouse PC also
// drops themselves on their phone, and if two people are sharing an account
// they drop each other. "local" ends this session and leaves the rest alone,
// which is what a Sign out button is normally understood to mean.
//
// The global behaviour is still worth having, but as a decision the user makes
// on purpose — see "Sign out everywhere else" on Password management.
async function signOutOfApp() {
  const client = await ensureSupabaseClient();
  await client.auth.signOut({ scope: "local" });
}

// The deliberate version: end every OTHER session and keep this one. For "I
// left myself signed in somewhere I shouldn't have", which is the real reason
// to want the global behaviour.
async function signOutOtherSessions() {
  const client = await ensureSupabaseClient();
  const { error } = await client.auth.signOut({ scope: "others" });
  return error ? error.message : null;
}

// ---------- Trustee roles ----------
// 'finance' | 'approver' | 'maintenance'. The database is the authority — every
// table's write policy calls the matching SQL function — and this is only so
// the UI can disable what the server would refuse anyway. Hiding a control the
// user cannot use is kinder than letting them fill in a form and then showing
// them a policy violation, but it is not the control itself.
const TRUSTEE_ROLE_DEFAULT = { role: null, allowedPages: null, displayName: null, landingPage: null, loading: true };
const TrusteeRoleContext = React.createContext(TRUSTEE_ROLE_DEFAULT);
const useTrusteeRole = () => React.useContext(TrusteeRoleContext);
// Finance is the fallback for a signed-in user with no trustees row, matching
// the column default — a trustee who predates roles is not locked out.
const useCanWriteFinance = () => { const { role } = useTrusteeRole(); return role == null || role === "finance"; };
const useCanApprove = () => { const { role } = useTrusteeRole(); return role == null || role === "finance" || role === "approver"; };
const useCanManageMaintenance = () => { const { role } = useTrusteeRole(); return role == null || role === "finance" || role === "maintenance"; };

const ROLE_LABELS = {
  finance: "Finance trustee",
  approver: "Approving trustee",
  maintenance: "Maintenance trustee",
};

async function fetchTrusteeProfile() {
  const client = await ensureSupabaseClient();
  const { data, error } = await client.rpc("my_trustee_profile");
  if (error) throw error;
  const row = (data || [])[0] || {};
  return {
    role: row.role || null,
    allowedPages: row.allowed_pages || null,
    displayName: row.display_name || null,
    landingPage: row.landing_page || null,
  };
}

// Lets a signed-in trustee set their own password. Supabase handles the hash
// and the session stays valid, so there is nothing to re-authenticate.
async function changeOwnPassword(newPassword) {
  const client = await ensureSupabaseClient();
  const { error } = await client.auth.updateUser({ password: newPassword });
  return error ? error.message : null;
}

// ---------- Approvals ----------
// The four sign-offs that gate statement release. Scope is a financial year
// for the two annual subjects and a statement period for the two monthly ones
// — see the approvals table comment for why they differ.
// `gatesStatements` exists because not every sign-off is about statements.
// The first four are: nothing goes out until they are in. The maintenance plan
// is a PMR 22 decision on a ten-year schedule and has no bearing on whether
// July's levy statement can be printed — gating statements on it would hold
// every owner's account hostage to a property survey. It is listed here anyway
// so it shares one table, one component and one set of scoping rules with the
// others rather than growing a parallel approval mechanism of its own.
const APPROVAL_SUBJECTS = [
  { key: "levy_breakdown", label: "Levy breakdown", scopeKind: "fy", gatesStatements: true },
  { key: "insurance", label: "Insurance breakdown", scopeKind: "fy", gatesStatements: true },
  { key: "meter_readings", label: "Meter readings", scopeKind: "period", gatesStatements: true },
  { key: "statements", label: "Statements", scopeKind: "period", gatesStatements: true },
  { key: "maintenance_plan", label: "Maintenance plan", scopeKind: "fy", gatesStatements: false },
];

// Derived once. Everything that reasons about statement release reads THIS, so
// adding a sixth subject cannot silently start blocking statements.
const STATEMENT_GATE_SUBJECTS = APPROVAL_SUBJECTS.filter((s) => s.gatesStatements);

const approvalScopeFor = (subjectKey, period = ACTIVE_PERIOD) => {
  const s = APPROVAL_SUBJECTS.find((x) => x.key === subjectKey);
  return s && s.scopeKind === "fy" ? periodToFY(period) : period;
};

async function fetchApprovals(period = ACTIVE_PERIOD) {
  const client = await ensureSupabaseClient();
  const scopes = [...new Set(APPROVAL_SUBJECTS.map((s) => approvalScopeFor(s.key, period)))];
  const { data, error } = await client.from("approvals").select("*").in("scope", scopes);
  if (error) throw error;
  // Keyed by subject, but only where the scope is the one THIS period resolves
  // to — a row for another financial year shares the table, not the meaning.
  const out = {};
  (data || []).forEach((r) => {
    if (r.scope === approvalScopeFor(r.subject, period)) out[r.subject] = r;
  });
  return out;
}

async function setApproval(subjectKey, approved, period = ACTIVE_PERIOD, note = null) {
  const client = await ensureSupabaseClient();
  const scope = approvalScopeFor(subjectKey, period);
  if (!approved) {
    const { error } = await client.from("approvals").delete().eq("subject", subjectKey).eq("scope", scope);
    if (error) throw error;
    return null;
  }
  const { data: userData } = await client.auth.getUser();
  const user = userData && userData.user;
  if (!user) throw new Error("Not signed in.");
  const row = {
    subject: subjectKey, scope,
    approved_by: user.id, approved_by_email: user.email || null,
    approved_at: new Date().toISOString(), note,
  };
  const { error } = await client.from("approvals").upsert(row, { onConflict: "subject,scope" });
  if (error) throw error;
  return row;
}

// The approval control that appears on all four screens. One component so the
// four cannot drift apart in wording or behaviour — and so the thing that
// gates statements looks the same everywhere it is asked for.
// `onChanged` fires after a successful toggle, for a screen whose OWN behaviour
// depends on the approval — the maintenance register locks the moment the plan
// is approved, and a lock that only appears on the next page load is a lock the
// trustee will work around without realising.
function ApprovalCheckbox({ subject, period = ACTIVE_PERIOD, hint, onChanged }) {
  const canApprove = useCanApprove();
  const { role } = useTrusteeRole();
  const [row, setRow] = useState(undefined); // undefined = loading
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const meta = APPROVAL_SUBJECTS.find((s) => s.key === subject);
  const scope = approvalScopeFor(subject, period);

  const load = async () => {
    try {
      const all = await fetchApprovals(period);
      setRow(all[subject] || null);
    } catch (err) {
      console.error("Loading the approval failed:", err);
      setRow(null);
    }
  };
  useEffect(() => { load(); }, [subject, period]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = async () => {
    setBusy(true); setError(null);
    try {
      await setApproval(subject, !row, period);
      await load();
      if (onChanged) onChanged();
    } catch (err) {
      console.error("Saving the approval failed:", err);
      // The database refuses a write from a role without can_approve(), which
      // is the actual control — say so plainly rather than "save failed".
      setError(canApprove ? (err.message || "Couldn't save — see browser console.")
        : "Only the approving trustee can sign this off.");
    }
    setBusy(false);
  };

  const approved = Boolean(row);
  return (
    <Card style={{
      marginBottom: 16,
      background: approved ? "#EEF4F0" : "#FBF3E9",
      border: `1px solid ${approved ? "#B9D4C6" : "#E3C9A8"}`,
    }}>
      <label style={{ display: "flex", alignItems: "flex-start", gap: 11, cursor: canApprove && !busy ? "pointer" : "not-allowed" }}>
        <input
          type="checkbox"
          checked={approved}
          disabled={!canApprove || busy || row === undefined}
          onChange={toggle}
          style={{ width: 17, height: 17, marginTop: 1, flexShrink: 0, cursor: "inherit" }}
        />
        <span style={{ fontSize: 12.5, lineHeight: 1.7, color: approved ? "#2F5D50" : "#8A5A1E" }}>
          <b>{approved ? `${meta.label} approved` : `${meta.label} not yet approved`}</b>
          {" — "}{meta.scopeKind === "fy" ? `FY ${scope}` : periodLabel(scope)}.
          {approved && row.approved_by_email && (
            <> Signed off by <b>{row.approved_by_email}</b> on {String(row.approved_at).slice(0, 10)}.</>
          )}
          {/* Say the cadence out loud on the annual ones. A tick-box sitting on
              a screen with a month selector above it reads as monthly unless
              it says otherwise — and this one covers all twelve. */}
          {meta.scopeKind === "fy" && (
            <> {approved ? "This covers" : "Approving covers"} every month of FY {scope}; it is not asked again next month.</>
          )}
          {!approved && meta.scopeKind === "period" && <> Statements for this month are held until this is signed off.</>}
          {hint && <div style={{ marginTop: 4, color: "#94A0AC" }}>{hint}</div>}
          {!canApprove && (
            <div style={{ marginTop: 4, color: "#94A0AC" }}>
              Only the approving trustee can change this. You are signed in as {ROLE_LABELS[role] || "a trustee"}.
            </div>
          )}
          {error && <div style={{ marginTop: 4, color: "#B5651D", fontWeight: 600 }}>{error}</div>}
        </span>
      </label>
    </Card>
  );
}

// Whether statements may be produced for a period: all four sign-offs in.
//
// Deliberately re-read from the database rather than passed down from the four
// screens — the approving trustee may be signing off in another browser, and a
// gate computed from this tab's stale state is not a gate.
function useStatementReleaseGate(period = ACTIVE_PERIOD) {
  const [approvals, setApprovals] = useState(null); // null = still loading
  const [version, setVersion] = useState(0);
  useEffect(() => {
    let cancelled = false;
    fetchApprovals(period)
      .then((a) => { if (!cancelled) setApprovals(a); })
      .catch((err) => {
        console.error("Loading approvals for the statement gate failed:", err);
        // Fail CLOSED. An approvals table that cannot be read is not evidence
        // that everything was approved.
        if (!cancelled) setApprovals({});
      });
    return () => { cancelled = true; };
  }, [period, version]);

  const outstanding = approvals == null
    ? STATEMENT_GATE_SUBJECTS.map((s) => s.label)
    : STATEMENT_GATE_SUBJECTS.filter((s) => !approvals[s.key]).map((s) => s.label);
  const loading = approvals == null;
  return {
    loading,
    approvals: approvals || {},
    outstanding,
    released: !loading && outstanding.length === 0,
    blockedReason: loading
      ? "Checking approvals…"
      : `Outstanding sign-off: ${outstanding.join(", ")}.`,
    refresh: () => setVersion((v) => v + 1),
  };
}

function StatementReleaseGate({ gate, period }) {
  if (gate.loading) {
    return (
      <Card style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 12.5, color: "#64748B" }}>Checking approvals for {periodLabel(period)}…</div>
      </Card>
    );
  }
  if (gate.released) {
    return (
      <Card style={{ marginBottom: 16, background: "#EEF4F0", border: "1px solid #B9D4CE" }}>
        <div style={{ fontSize: 12.5, color: "#2F5D50", lineHeight: 1.7 }}>
          <b>All {STATEMENT_GATE_SUBJECTS.length} sign-offs are in for {periodLabel(period)}.</b> Statements can be produced and sent.
        </div>
      </Card>
    );
  }
  // Split the outstanding list by cadence. An annual sign-off missing in
  // August is a different job from a monthly one missing this month — the
  // first is done once and clears the rest of the year.
  const annual = STATEMENT_GATE_SUBJECTS.filter((s) => s.scopeKind === "fy" && !gate.approvals[s.key]);
  const monthly = STATEMENT_GATE_SUBJECTS.filter((s) => s.scopeKind === "period" && !gate.approvals[s.key]);
  return (
    <Card style={{ marginBottom: 16, background: "#FBF3E9", border: "1px solid #E3C9A8" }}>
      <div style={{ fontSize: 12.5, color: "#8A5A1E", lineHeight: 1.7 }}>
        <b>Statements are held for {periodLabel(period)}.</b> Producing or sending is blocked until the approving
        trustee has signed everything off.
        {annual.length > 0 && (
          <div style={{ marginTop: 4 }}>
            Outstanding for <b>FY {periodToFY(period)}</b> — approved once, then not asked again this year:{" "}
            <b>{annual.map((s) => s.label).join(", ")}</b>.
          </div>
        )}
        {monthly.length > 0 && (
          <div style={{ marginTop: 4 }}>
            Outstanding for <b>{periodLabel(period)}</b>: <b>{monthly.map((s) => s.label).join(", ")}</b>.
          </div>
        )}
        <div style={{ marginTop: 4, color: "#94A0AC" }}>
          The preview below is live and can be checked — it just cannot leave the building yet.
        </div>
      </div>
    </Card>
  );
}

function LoginScreen() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const err = await signInWithPassword(email.trim(), password);
    if (err) { setError(err); setBusy(false); }
    // On success, App's onAuthStateChange listener swaps to the app — no
    // navigation needed here.
  };

  return (
    <div className="f-body" style={{ minHeight: "100vh", background: "#1B2A38", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      {FONT_IMPORT}
      <form onSubmit={submit} style={{ background: "#F6F1E7", borderRadius: 10, padding: "36px 34px", width: 360, boxShadow: "0 8px 40px rgba(0,0,0,0.35)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
          <MeterMark />
          <div className="f-display" style={{ fontSize: 21, fontWeight: 700, color: "#1B2A38" }}>El Corazon</div>
        </div>
        <div style={{ fontSize: 12, color: "#64748B", marginBottom: 22, letterSpacing: 0.6, textTransform: "uppercase" }}>Trustee sign-in</div>
        <label style={{ fontSize: 12, fontWeight: 600, color: "#1B2A38", display: "block", marginBottom: 6 }}>Email</label>
        <input
          type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username"
          style={{ width: "100%", boxSizing: "border-box", padding: "9px 11px", borderRadius: 7, border: "1px solid #D8D0BE", fontSize: 13.5, marginBottom: 14, background: "#fff" }}
        />
        <label style={{ fontSize: 12, fontWeight: 600, color: "#1B2A38", display: "block", marginBottom: 6 }}>Password</label>
        <input
          type="password" required value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password"
          style={{ width: "100%", boxSizing: "border-box", padding: "9px 11px", borderRadius: 7, border: "1px solid #D8D0BE", fontSize: 13.5, marginBottom: 18, background: "#fff" }}
        />
        {error && (
          <div style={{ background: "#F6E7DA", color: "#B5651D", fontSize: 12.5, fontWeight: 600, borderRadius: 7, padding: "8px 11px", marginBottom: 14 }}>
            {error}
          </div>
        )}
        <button type="submit" disabled={busy} style={{ ...primaryBtn, width: "100%", opacity: busy ? 0.7 : 1 }}>
          {busy ? "Signing in…" : "Sign in"}
        </button>
        <div style={{ fontSize: 11, color: "#94A0AC", marginTop: 16, lineHeight: 1.5 }}>
          All body corporate data sits behind row-level security — nothing loads without a trustee session.
        </div>
      </form>
    </div>
  );
}

// ---------- Configurable tariffs (trustee-editable) ----------
// Increasing block tariff for water — matches the municipal 2025/2026 sliding scale.
const WATER_BANDS_DEFAULT = [
  { id: "b0", label: "0-6",    from: 0,  to: 6,    rate2024: 0.00,  rate2025: 0.00 },
  { id: "b1", label: ">6-10",  from: 6,  to: 10,   rate2024: 28.20, rate2025: 29.84 },
  { id: "b2", label: ">10-15", from: 10, to: 15,   rate2024: 27.35, rate2025: 31.15 },
  { id: "b3", label: ">15-20", from: 15, to: 20,   rate2024: 38.34, rate2025: 43.67 },
  { id: "b4", label: ">20-30", from: 20, to: 30,   rate2024: 52.99, rate2025: 60.36 },
  { id: "b5", label: ">30-40", from: 30, to: 40,   rate2024: 57.95, rate2025: 66.01 },
  { id: "b6", label: ">40-50", from: 40, to: 50,   rate2024: 73.12, rate2025: 83.28 },
  { id: "b7", label: ">50",    from: 50, to: null, rate2024: 78.35, rate2025: 89.24 },
];
const ELECTRICITY_RATE_DEFAULT = 2.58; // R / kWh, flat — rounded up from the municipal rate of R2.5755, per trustee convention
const VAT_RATE_DEFAULT = 0.15; // charged on metered water & electricity only

// Water Demand Levy, Sewerage, and the Electricity Service/Network charges
// are captured from the uploaded utility bills (stored per period on the
// council invoice — see COUNCIL_INVOICE fields above), not configured here.

// Common property (body corp) water — the monthly kL standard. Billed using the
// real, unmodified municipal tariff scale (i.e. still including the free first
// 6kL) since that's genuinely how the municipality bills bulk water — unlike
// individual units, which don't get that free tier (see deriveIndividualWaterBands
// below). Trustee-configurable per financial year under Tariffs & rates; this is
// only the fallback used before levy_rates loads, or if the fetch fails.
const COMMON_PROPERTY_WATER_KL_DEFAULT = 20;

// Common property (body corp) electricity — standard kWh/month assumption, billed
// at the flat electricity rate. Trustee-configurable under Tariffs & rates.
const COMMON_PROPERTY_ELECTRICITY_KWH_DEFAULT = 300;

// Ad-hoc, per-statement charges a trustee can add for a specific unit in a
// given month (e.g. a callout fee, a damage recovery) — not part of the
// annual AGM levy and not tied to meter readings.
const ADDITIONAL_CHARGES_DEFAULT = Object.fromEntries(UNITS.map((u) => [u.id, []]));
ADDITIONAL_CHARGES_DEFAULT.U3 = [
  { id: "ac1", description: "Locksmith call-out — communal gate", amount: 350.0 },
];

// Body Corp operating expenses — paid by the Body Corp itself, never billed to
// units, but tracked for the analytics dashboard and annual report (e.g. CSOS,
// Fire Extinguisher Servicing, and the actual Garden Service / Blockwatch cost).
// Expense categories are trustee-managed in the Config module and live in the
// `expense_categories` table — this array is only the offline fallback used
// before that table loads (or if the fetch fails). The live list always wins.
const EXPENSE_CATEGORIES_FALLBACK = [
  { id: "f1", name: "CoJ Water", sortOrder: 1, active: true },
  { id: "f2", name: "CoJ Electricity", sortOrder: 2, active: true },
  { id: "f3", name: "Insurance", sortOrder: 3, active: true },
  { id: "f4", name: "Garden Service", sortOrder: 4, active: true },
  { id: "f5", name: "BlockWatch", sortOrder: 5, active: true },
  { id: "f6", name: "Bank Charges", sortOrder: 6, active: true },
  { id: "f7", name: "Maintenance/Miscellaneous", sortOrder: 7, active: true },
  { id: "f8", name: "Other", sortOrder: 8, active: true },
];
const OPS_EXPENSES_DEFAULT = [
  { id: "ops1", date: "2026-06-05", category: "Garden Service (actual cost)", amount: 387.00, notes: "Paid by Unit 2, proof on file" },
  { id: "ops2", date: "2026-06-01", category: "Blockwatch (actual cost)", amount: 150.00, notes: "Paid by Unit 1, proof on file" },
];

// Applies the increasing block tariff to a consumption figure (kL), band by band.
function calcWaterCost(kl, bands, yearField = "rate2025") {
  let remaining = Math.max(0, kl);
  let cost = 0;
  for (const b of bands) {
    if (remaining <= 0) break;
    const bandWidth = b.to == null ? remaining : Math.max(0, b.to - b.from);
    const used = Math.min(remaining, bandWidth);
    cost += used * (b[yearField] || 0);
    remaining -= used;
  }
  return cost;
}

// SUPERSEDED from August 2026 — retained only for reprinting statements from
// July 2026 and earlier, which were billed this way and must not change.
// Merges the free 0-6kL band into the next paid band, so every kL from 0 bills
// at the >6-10 rate: 5kL cost 5 × R29.84 = R149.20. Replaced by a flat minimum
// charge — see individualWaterCost below. Nothing outside the legacy branch of
// that function should call this.
function deriveIndividualWaterBands(bands) {
  const sorted = [...bands].sort((a, b) => a.from - b.from);
  if (sorted.length < 2) return sorted;
  const [first, ...rest] = sorted;
  const isFreeBand = (first.rate2025 || 0) === 0 && (first.rate2024 || 0) === 0;
  if (!isFreeBand) return sorted;
  const merged = { ...rest[0], from: first.from };
  return [merged, ...rest.slice(1)];
}

// ---------- Individual-unit water: the minimum-charge rule ----------
//
// Trustee rule change, effective the August 2026 statement period. A unit's
// water is billed:
//   * 0 – 6 kL  → a FLAT minimum charge, whatever was used. Zero consumption
//                 still pays it: it is a charge for holding the connection,
//                 not for the water. 5kL = R33.57, not 5 × R33.57.
//   * over 6 kL → the configured tariff table, free first tier intact.
//                 Nothing else: no floor, no minimum, just the table.
//   * common property water is NOT affected — the 20kL standard keeps billing
//     on the real municipal scale, because that is how CoJ bills the bulk
//     meter. Only individual units get the minimum.
//
// The minimum charge is deliberately NOT a separately stored figure. It is one
// kL at the FIRST PAID band's rate — R33.57 on the set effective 1 Aug 2026,
// R29.84 on the 2025/2026 set. Deriving it from the tariff table means it
// re-prices itself when each July's rates are captured, and there is no second
// place to forget to update. If CoJ ever publishes a minimum that diverges from
// the >6-10 rate, this becomes an effective-dated column on water_tariff_bands
// and a field on Tariffs & rates — not a constant.
//
// KNOWN, ACCEPTED CONSEQUENCE — do not "fix" this without asking the trustee.
// The two rules meet at a step, not a slope. At the Aug 2026 rates a unit on
// 6.5kL pays 0.5 × R33.57 = R16.79, LESS than a unit on 5kL paying R33.57,
// because crossing 6kL earns the whole free tier. Usage between 6kL and 7kL
// therefore costs less than the minimum. Flooring the table at the minimum was
// offered and DECLINED (7 Aug 2026): over 6kL bills the tariff table and
// nothing else. The step is much smaller than the one it replaced (the old rule
// jumped ≈R201 at 5.99kL down to ≈R16.79 at 6.5kL), but it is still a step.
const WATER_MINIMUM_CHARGE_FROM = "2026-08";

// The free opening band's upper limit — 6kL on every rate set captured so far.
// 0 if the set does not open with a free band, in which case there is no
// minimum-charge threshold and the tariff table applies throughout.
function waterFreeBandLimit(bands) {
  const first = [...bands].sort((a, b) => a.from - b.from)[0];
  return first && (first.rate2025 || 0) === 0 ? (first.to || 0) : 0;
}

// One kL at the first paid band's rate. 0 when the set has no free opening
// band (nothing for a minimum to be the minimum of).
function waterMinimumCharge(bands) {
  const sorted = [...bands].sort((a, b) => a.from - b.from);
  const first = sorted[0];
  if (!first || (first.rate2025 || 0) !== 0) return 0;
  const firstPaid = sorted.find((b) => (b.rate2025 || 0) > 0);
  return firstPaid ? firstPaid.rate2025 || 0 : 0;
}

// THE single place an individual unit's water cost is worked out. The trustee
// allocation, the resident's statement view and the ownership-change split all
// go through this, so the rule cannot drift between the three screens — which
// is exactly how they drifted before.
//
// `period` is the statement month ("YYYY-MM"). Anything from August 2026 uses
// the rule above; earlier months keep the superseded merged-band calculation so
// statements already sent reprint to the cent. A MISSING period bills on the
// current rule, not the legacy one: an oversight that under-charges a historic
// reprint is recoverable, one that over-charges a live statement by 4× is not.
function individualWaterCost(kl, bands, period) {
  const use = Math.max(0, kl);
  const freeBandLimit = waterFreeBandLimit(bands);

  if (period && String(period) < WATER_MINIMUM_CHARGE_FROM) {
    return use > freeBandLimit
      ? calcWaterCost(use, bands)
      : calcWaterCost(use, deriveIndividualWaterBands(bands));
  }

  // At or under the free band: the flat minimum. Above it: the table, unfloored.
  return use <= freeBandLimit ? waterMinimumCharge(bands) : calcWaterCost(use, bands);
}

// ---------- Ownership change: pro-rata split on transfer ----------
// Turns one unit's statement row into two, for the month a unit changes hands.
//
// The three kinds of line obey different rules, and treating them the same is
// the usual mistake:
//   * Electricity is NOT pro-rated at all. A reading is taken on the changeover
//     date, so each owner is billed their ACTUAL consumption at a flat rate —
//     that is what the reading is for.
//   * Water is costed for the WHOLE MONTH and then divided by each owner's
//     actual consumption. It cannot be costed per half: the minimum charge and
//     the free first 6kL are both once-a-month-per-unit, and billing the halves
//     independently hands the unit two of each. Splitting by consumption keeps
//     the seller off the buyer's water while charging the month once.
//   * The fixed levy lines ARE pro-rated, by days of the month.
//
// Each levy line is apportioned individually and the incoming owner gets the
// REMAINDER rather than its own rounded share, so every line — and therefore
// the total — reconciles to the full month exactly, with no stray cent.
function splitStatementForChangeover(r, change, waterBands, period) {
  if (!r || !change || !change.changeoverDate) return null;
  const [y, m] = String(period).split("-").map(Number);
  const daysInMonth = new Date(y, m, 0).getDate();
  // The changeover date is the last day the outgoing owner is liable for,
  // inclusive: the 6th means they carry 6 of the month's days.
  const outDays = Number(String(change.changeoverDate).slice(8, 10));
  if (!(outDays > 0 && outDays < daysInMonth)) return null; // not a mid-month change
  const inDays = daysInMonth - outDays;

  const wMid = change.waterReading == null ? r.wCurr : Number(change.waterReading);
  const eMid = change.electricityReading == null ? r.eCurr : Number(change.electricityReading);

  // Water: the MONTH is costed once, then divided between the two owners in
  // proportion to what each of them actually ran.
  //
  // Costing each half independently — which is what this did before — now
  // double-charges the minimum: two owners each under 6kL would pay R33.57
  // apiece, R67.14 for a month a single owner would have been charged R33.57
  // for. A transfer is not a reason for the unit to owe twice the minimum. The
  // same objection applies further up the scale, where each half would get its
  // own free first 6kL.
  //
  // Consumption, not days, is the divisor — a reading is taken on the
  // changeover date precisely so nobody is billed for water someone else ran.
  // Days are only the fallback when neither owner used anything and there is
  // nothing to apportion by, which still leaves the minimum charge to split.
  const fullWaterUse = round2(r.wCurr - r.wPrev);
  const outWaterUse = round2(wMid - r.wPrev);
  const fullWaterCost = round2(individualWaterCost(fullWaterUse, waterBands, period));
  const outWaterCost = fullWaterUse > 0
    ? round2(fullWaterCost * outWaterUse / fullWaterUse)
    : round2(fullWaterCost * outDays / daysInMonth);
  // The incoming owner takes the remainder, so the two halves reconcile to the
  // full month exactly — the same convention every levy line below uses.
  const inWaterCost = round2(fullWaterCost - outWaterCost);

  const half = ({ wPrev, wCurr, ePrev, eCurr, waterCost, days, levyShare, owner, label, from, to, extras }) => {
    const wUse = round2(wCurr - wPrev);
    const eUse = round2(eCurr - ePrev);
    const elecCost = round2(eUse * r.electricityRate);
    const subTotal = round2(waterCost + elecCost);
    const vat = round2(subTotal * r.vatRate);
    const utilitiesDue = round2(subTotal + vat);
    const levy = round2(Object.values(levyShare).reduce((a, b) => a + b, 0));
    const additionalTotal = round2((extras || []).reduce((a, e) => a + (e.amount || 0), 0));
    return {
      ...r,
      owner: owner || r.owner,
      wPrev, wCurr, ePrev, eCurr, wUse, eUse,
      // A split statement is computed from readings, so a whole-month override
      // no longer describes it and must not be carried onto either half.
      waterOverridden: false, elecOverridden: false, overrideNote: "",
      waterCostComputed: waterCost, elecCostComputed: elecCost,
      waterCost, elecCost, subTotal, vat, utilitiesDue,
      levyItems: levyShare, levy, levyLines: LEVY_ITEMS.slice(),
      extras: extras || [], additionalTotal,
      total: round2(levy + utilitiesDue + additionalTotal),
      proRata: { label, from, to, days, daysInMonth },
    };
  };

  const outShare = {};
  const inShare = {};
  LEVY_ITEMS.forEach((item) => {
    const full = round2(r.levyItems[item] || 0);
    const out = round2(full * outDays / daysInMonth);
    outShare[item] = out;
    inShare[item] = round2(full - out); // remainder, so the line always reconciles
  });

  const iso = (d) => `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  return {
    daysInMonth, outDays, inDays,
    outgoing: half({
      wPrev: r.wPrev, wCurr: wMid, ePrev: r.ePrev, eCurr: eMid,
      waterCost: outWaterCost,
      days: outDays, levyShare: outShare, owner: change.outgoingOwner,
      label: "Outgoing owner", from: iso(1), to: iso(outDays),
      // Ad-hoc charges stay with the outgoing owner: they were raised against
      // the unit before the transfer. Move them on Additional charges if one
      // actually belongs to the incoming owner.
      extras: r.extras,
    }),
    incoming: half({
      wPrev: wMid, wCurr: r.wCurr, ePrev: eMid, eCurr: r.eCurr,
      waterCost: inWaterCost,
      days: inDays, levyShare: inShare, owner: change.incomingOwner,
      label: "Incoming owner", from: iso(outDays + 1), to: iso(daysInMonth),
      extras: [],
    }),
  };
}

// ---------- Allocation engine ----------
// unitsSource ("mock" | "database" | "error") is only used as a memo dependency:
// when the DB units replace the mock UNITS binding, the source flips and this
// recomputes against the fresh rows — nothing inside reads the value itself.
//
// `period` ("YYYY-MM") is the selected statement month. It is not used to pick
// rates — `waterBands` arrives already scoped to the month — only to decide
// which water billing RULE applies, so August 2026 onwards gets the minimum
// charge and earlier months reprint on the superseded calculation.
function useAllocation(waterBands, electricityRate, levyBreakdown, vatRate, additionalCharges, commonPropertyElectricityKwh, commonPropertyWaterKl, unitsSource, readings, councilInvoice, statementOverrides = {}, period = null) {
  return useMemo(() => {
    const totalW = round2(Object.values(readings).reduce((s, r) => s + (r.wCurr - r.wPrev), 0));
    const totalE = round2(Object.values(readings).reduce((s, r) => s + (r.eCurr - r.ePrev), 0));
    const commonWater = round2(councilInvoice.bulkWaterKl - totalW);
    const commonElec = round2(councilInvoice.bulkElecKwh - totalE);
    // Actual metered common-area gap, valued at the real tariff/rate — informational
    // only, shown on the Allocation page as a sanity check against the standard-based
    // AGM levy figures below (they won't match exactly, and that's expected).
    const commonWaterCostTotal = calcWaterCost(commonWater, waterBands);
    const commonElecCostTotal = commonElec * electricityRate;

    // Individual-unit water is billed by individualWaterCost — a flat minimum
    // charge at or under 6kL, the tariff table above it, floored at the
    // minimum. See the rule and its history where that function is defined.
    // Common property water (the kL standard below) is deliberately NOT put
    // through it: bulk water genuinely gets the free first 6kL.

    // Common property (body corp) standards: fixed 20kL of water (real, unmodified
    // scale) and a configurable kWh of electricity (flat rate), split equally across
    // all 7 units — these are what actually feed the AGM levy lines now, replacing
    // manual entry.
    const commonPropertyWaterCost = calcWaterCost(commonPropertyWaterKl, waterBands);
    const commonPropertyElecCost = commonPropertyElectricityKwh * electricityRate;
    const commonPropertyWaterPerUnit = commonPropertyWaterCost / UNITS.length;
    const commonPropertyElecPerUnit = commonPropertyElecCost / UNITS.length;

    // The levy grid is fully manual (12 July 2026 rule change) — statements
    // bill exactly what the trustee typed, default 0.00 per cell. The
    // rate-derived per-unit figures above are still computed, but only for
    // the informational comparisons on the Allocation and Levy pages; they
    // no longer override any grid value.
    const effectiveLevyItems = (unitId) => ({ ...(levyBreakdown[unitId] || {}) });

    const rows = UNITS.map((u) => {
      const r = readings[u.id] || { wPrev: 0, wCurr: 0, ePrev: 0, eCurr: 0 };
      const wUse = round2(r.wCurr - r.wPrev);
      const eUse = round2(r.eCurr - r.ePrev);
      // Computed utility "due" figures, before any manual override.
      const waterCostComputed = individualWaterCost(wUse, waterBands, period);
      const elecCostComputed = eUse * electricityRate;
      // Manual per-statement override (used to align a past statement to the one
      // physically sent). A null field falls back to the computed value.
      const ov = statementOverrides[u.id] || {};
      const waterOverridden = ov.waterDue != null;
      const elecOverridden = ov.electricityDue != null;
      const waterCost = waterOverridden ? Number(ov.waterDue) : waterCostComputed;
      const elecCost = elecOverridden ? Number(ov.electricityDue) : elecCostComputed;
      const subTotal = elecCost + waterCost;
      const vat = subTotal * vatRate;
      const utilitiesDue = subTotal + vat;
      const levyItems = effectiveLevyItems(u.id);
      const levy = LEVY_ITEMS.reduce((s, item) => s + (levyItems[item] || 0), 0);
      const extras = additionalCharges[u.id] || [];
      const additionalTotal = extras.reduce((s, e) => s + (e.amount || 0), 0);
      const total = levy + utilitiesDue + additionalTotal;
      return {
        ...u, ...r, wUse, eUse, electricityRate, vatRate,
        waterCostComputed, elecCostComputed, waterOverridden, elecOverridden, overrideNote: ov.note || "",
        waterCost, elecCost, subTotal, vat, utilitiesDue, levy, levyItems,
        // The lines this total was taken over, so the statement renders the
        // same set it billed. See the note where the statement prints them.
        levyLines: LEVY_ITEMS.slice(),
        extras, additionalTotal,
        total,
      };
    });

    const tariffWaterTotal = rows.reduce((s, r) => s + r.waterCost, 0) + commonPropertyWaterCost;
    const tariffElecTotal = rows.reduce((s, r) => s + r.elecCost, 0) + commonPropertyElecCost;

    return {
      rows, totalW, totalE, commonWater, commonElec, electricityRate, vatRate,
      commonWaterCostTotal, commonElecCostTotal,
      commonPropertyWaterCost, commonPropertyElecCost, commonPropertyWaterPerUnit, commonPropertyElecPerUnit,
      commonPropertyElectricityKwh,
      commonPropertyWaterKl,
      tariffWaterTotal, tariffElecTotal,
      councilInvoice,
    };
  }, [waterBands, electricityRate, levyBreakdown, vatRate, additionalCharges, commonPropertyElectricityKwh, commonPropertyWaterKl, unitsSource, readings, councilInvoice, statementOverrides, period]);
}

const rand = (n) => `R ${n.toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
// Rounds to 2 decimals as a number (not a string) — used at the point usage
// figures are derived, so floating-point noise from meter-reading subtraction
// (e.g. 6986.03 - 6967.76 = 18.269999999999527) doesn't creep into billing
// calculations or displays.
const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
// Parses a money input tolerantly: accepts a comma OR dot decimal separator
// (SA users often type "12,50"), strips spaces and stray "R", and never returns
// NaN. Used for amounts the resident types so a comma doesn't silently drop a value.
const parseAmount = (v) => {
  const n = parseFloat(String(v ?? "").replace(/[R\s]/gi, "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
};

// ---------- PDF export ----------
// No external PDF library is used (jsPDF/html2canvas aren't supported in the
// Claude artifact preview). Instead this triggers the browser's native print
// dialog, scoped via the .print-area/.no-print CSS below, so the person can
// choose "Save as PDF" as the destination — no dependencies required. This
// works the same way in a real deployed React app.
function printStatement() {
  window.print();
}

// ---------- Remittance email notification ----------
// Calls a backend endpoint (see api-notify-remittance.js) which uses Resend to
// email the trustee whenever a resident submits a remittance advice. This
// fetch will fail gracefully in this front-end-only prototype until that
// endpoint is deployed — the UI reports success/failure either way.
async function notifyTrusteeOfRemittance(payload) {
  try {
    const res = await fetch("/api/notify-remittance", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    return res.ok;
  } catch (err) {
    console.error("Remittance notification failed:", err);
    return false;
  }
}

// ---------- Shell ----------
export default function App() {
  const [tab, setTab] = useState("dashboard");
  const [selectedUnit, setSelectedUnit] = useState("U1");
  // The month the whole trustee app is looking at. Defaults to the latest
  // period; the period selector swaps it and every screen (recon, statements,
  // dashboard) recomputes for the chosen month. `periods` is the list of
  // months that actually have data, newest first.
  const [selectedPeriod, setSelectedPeriod] = useState(CURRENT_PERIOD);
  const [periods, setPeriods] = useState([CURRENT_PERIOD]);
  // Bank recon's own month. Defaults to the statement that carries the current
  // period's levy payments — the month after it — which is the one a trustee
  // reaches for. Kept separate from `selectedPeriod` so importing a historic
  // statement doesn't drag the dashboard and statements back with it.
  const [bankReconPeriod, setBankReconPeriod] = useState(nextPeriod(CURRENT_PERIOD));
  const [waterBands, setWaterBands] = useState(WATER_BANDS_DEFAULT);
  // Every saved water rate set, keyed by effective date. The Tariffs & rates
  // page works entirely off this; `waterBands` above stays period-scoped and is
  // what the selected month's statements are billed on.
  const [waterBandHistory, setWaterBandHistory] = useState({});
  // Bumped after a tariff save so the loader below re-runs and every screen
  // picks up the new rate set without a page refresh.
  const [dataVersion, setDataVersion] = useState(0);
  const [electricityRate, setElectricityRate] = useState(ELECTRICITY_RATE_DEFAULT);
  const [electricityEffectiveFrom, setElectricityEffectiveFrom] = useState("2025-07-01");
  const [levyBreakdown, setLevyBreakdown] = useState(LEVY_BREAKDOWN_DEFAULT);
  // Which FY the grid above belongs to, and whether it's last year's figures
  // shown as a starting point because this FY has never been set up.
  const [levyMeta, setLevyMeta] = useState({ financialYear: FY_ACTIVE, carriedForward: false, carriedFromFY: null });
  const [vatRate, setVatRate] = useState(VAT_RATE_DEFAULT);
  const [commonPropertyElectricityKwh, setCommonPropertyElectricityKwh] = useState(COMMON_PROPERTY_ELECTRICITY_KWH_DEFAULT);
  const [commonPropertyWaterKl, setCommonPropertyWaterKl] = useState(COMMON_PROPERTY_WATER_KL_DEFAULT);
  // Which FY the two standards above belong to, and whether they were carried
  // forward from the year before because this one has no row yet.
  const [standardsMeta, setStandardsMeta] = useState({ financialYear: null, carriedForward: false, carriedFromFY: null });
  const [additionalCharges, setAdditionalCharges] = useState(ADDITIONAL_CHARGES_DEFAULT);
  const [remittanceDeductions, setRemittanceDeductions] = useState({});
  const [remittanceAdvices, setRemittanceAdvices] = useState({});
  const [opsExpenses, setOpsExpenses] = useState(OPS_EXPENSES_DEFAULT);
  // Trustee-managed expense category list — Config edits it, every tagging
  // dropdown and the analytics dashboard read from it.
  const [expenseCategories, setExpenseCategories] = useState(EXPENSE_CATEGORIES_FALLBACK);
  const [readings, setReadings] = useState(READINGS);
  const [councilInvoice, setCouncilInvoice] = useState(COUNCIL_INVOICE_NO_BILL);
  const [councilInvoiceMissing, setCouncilInvoiceMissing] = useState(true);
  // Manual overrides of the computed utility due lines, per unit, for the
  // selected period — used to align a past statement to what was physically sent.
  const [statementOverrides, setStatementOverrides] = useState({});
  const [ownershipChanges, setOwnershipChanges] = useState({});
  const [bankTxns, setBankTxns] = useState(() =>
    BANK_TXNS.map((t) => ({
      ...t,
      direction: "credit",
      accruedCharge: 0,
      ...classifyBankTransaction(`${t.ref} ${t.desc}`),
    }))
  );
  // Payments the trustee recorded before the bank statement arrived. Ignored
  // automatically once a real bank line exists for the same unit and month.
  const [manualPayments, setManualPayments] = useState([]);
  const [bankStatementMeta, setBankStatementMeta] = useState(null); // { fileName, parsedAt, count } | null — read-only, filled from the DB
  // "mock" until the DB rows arrive, then "database"; "error" keeps the app
  // fully usable on the mock fallback if Supabase is unreachable.
  const [unitsSource, setUnitsSource] = useState("mock");
  // undefined = still checking for a stored session, null = signed out,
  // object = signed in. The whole app renders only once this is an object.
  const [session, setSession] = useState(undefined);
  // Resident capability-URL mode (?unit=<token>): undefined = validating the
  // token, null = invalid/unknown token, object = the resident's unit.
  const [residentUnit, setResidentUnit] = useState(undefined);

  useEffect(() => {
    if (!RESIDENT_TOKEN) return;
    let cancelled = false;
    fetchUnitByToken(RESIDENT_TOKEN)
      .then((unit) => {
        if (cancelled) return;
        if (unit) {
          // Patch this one unit's row in the module-wide binding so the
          // resident sees their real name from the DB, and flip the memo
          // dependency so the allocation recomputes.
          UNITS = UNITS.map((u) => (u.id === unit.id ? { ...u, owner: unit.owner, pq: unit.pq } : u));
          setUnitsSource("database");
        }
        setResidentUnit(unit);
      })
      .catch((err) => {
        console.error("Resident link validation failed:", err);
        if (!cancelled) setResidentUnit(null);
      });
    return () => { cancelled = true; };
  }, []);

  // Which trustee is signed in. Read once per session and held in context; the
  // database enforces the same thing on every write, so a stale value here can
  // only ever show a control that then refuses, never grant one.
  const [roleState, setRoleState] = useState(TRUSTEE_ROLE_DEFAULT);
  // Bumped by User management after a change, so an edit to your own row takes
  // effect without a reload.
  const [profileVersion, setProfileVersion] = useState(0);
  // The landing page is applied ONCE per sign-in. Without this guard the effect
  // would yank the user back to their landing page every time the profile is
  // re-read (which User management does after any edit) — so a finance trustee
  // whose landing page is the Dashboard could not stay on User management long
  // enough to make a second change.
  const landingApplied = React.useRef(false);
  useEffect(() => { if (!session) landingApplied.current = false; }, [session]);
  useEffect(() => {
    if (!session) { setRoleState({ ...TRUSTEE_ROLE_DEFAULT, loading: false }); return; }
    let cancelled = false;
    fetchTrusteeProfile()
      .then((p) => {
        if (cancelled) return;
        setRoleState({ ...p, loading: false });
        if (!landingApplied.current) {
          landingApplied.current = true;
          setTab(resolveLandingPage(p.role, p.allowedPages, p.landingPage));
        }
      })
      .catch((err) => {
        console.error("Could not read the trustee profile — treating as finance:", err);
        if (!cancelled) { landingApplied.current = true; setRoleState({ ...TRUSTEE_ROLE_DEFAULT, loading: false }); }
      });
    return () => { cancelled = true; };
  }, [session, profileVersion]);

  useEffect(() => {
    let cancelled = false;
    let subscription = null;
    ensureSupabaseClient()
      .then((client) => {
        if (cancelled) return;
        client.auth.getSession().then(({ data }) => { if (!cancelled) setSession(data.session); });
        const { data: sub } = client.auth.onAuthStateChange((_event, s) => { if (!cancelled) setSession(s); });
        subscription = sub.subscription;
      })
      .catch((err) => {
        console.error("Could not initialise Supabase auth:", err);
        if (!cancelled) setSession(null);
      });
    return () => { cancelled = true; if (subscription) subscription.unsubscribe(); };
  }, []);

  useEffect(() => {
    if (!session) return; // signed out — RLS would reject the fetch anyway
    let cancelled = false;
    // Keep the module-wide bindings in step with the selected month: statement
    // saves target the statement period; bank-statement saves target the month
    // its levies are paid (the following month).
    ACTIVE_PERIOD = selectedPeriod;
    ACTIVE_PAYMENT_PERIOD = nextPeriod(selectedPeriod);
    FY_ACTIVE = periodToFY(selectedPeriod);
    FY_PREVIOUS = previousFY(FY_ACTIVE);
    // Refresh the list of months that have data (cheap; also picks up a newly
    // uploaded statement for a month that had none before).
    fetchAvailablePeriods()
      .then((ps) => { if (!cancelled && ps.length) setPeriods(ps); })
      .catch((err) => console.error("Could not load available periods:", err));
    fetchUnitsFromDb()
      .then(async (units) => {
        if (cancelled) return;
        UNITS = units; // swap the module-wide binding — see the UNITS comment
        const data = await loadAppData(units, selectedPeriod, nextPeriod(selectedPeriod));
        if (cancelled) return;
        setWaterBands(data.waterBands);
        setWaterBandHistory(data.waterBandHistory || {});
        setElectricityRate(data.electricityRate);
        if (data.electricityEffectiveFrom) setElectricityEffectiveFrom(data.electricityEffectiveFrom);
        setVatRate(data.vatRate);
        if (data.levyRates) {
          setCommonPropertyElectricityKwh(data.levyRates.commonPropertyElectricityKwh);
          setCommonPropertyWaterKl(data.levyRates.commonPropertyWaterKl);
          setStandardsMeta({
            financialYear: data.levyRates.financialYear,
            carriedForward: Boolean(data.levyRates.carriedForward),
            carriedFromFY: data.levyRates.carriedFromFY || null,
          });
        }
        // Swap the item list before the grid, so nothing renders a cell for a
        // line the loaded FY doesn't have. Same module-wide binding trick as
        // UNITS above, and `unitsSource` flipping to "database" is what makes
        // useAllocation recompute against it.
        if (data.levyItemDefs && data.levyItemDefs.length) {
          LEVY_ITEM_DEFS = data.levyItemDefs;
          LEVY_ITEMS = data.levyItemDefs.filter((d) => d.active).map((d) => d.label);
        }
        setLevyBreakdown(data.levyBreakdown);
        setLevyMeta({
          financialYear: data.levyFinancialYear,
          carriedForward: Boolean(data.levyCarriedForward),
          carriedFromFY: data.levyCarriedFromFY || null,
          itemsCarriedForward: Boolean(data.levyItemsCarriedForward),
        });
        setReadings(data.readings);
        setAdditionalCharges(data.additionalCharges);
        setOpsExpenses(data.opsExpenses);
        if (data.expenseCategories && data.expenseCategories.length) setExpenseCategories(data.expenseCategories);
        setCouncilInvoice(data.councilInvoice);
        setCouncilInvoiceMissing(!!data.councilInvoiceMissing);
        setStatementOverrides(data.statementOverrides || {});
        setOwnershipChanges(data.ownershipChanges || {});
        // Reset the statement view for the selected month: show its data if
        // present, otherwise clear last month's so nothing stale lingers.
        if (data.bankTxns) {
          setBankTxns(data.bankTxns);
        } else {
          setBankTxns([]);
        }
        // Bank recon owns import status now, so there is no upload state to
        // drive here — only the metadata this screen displays.
        setBankStatementMeta(data.bankStatementMeta || null);
        setRemittanceDeductions(data.remittanceDeductions);
        setRemittanceAdvices(data.remittanceAdvices);
        setManualPayments(data.manualPayments || []);
        setUnitsSource("database");
      })
      .catch((err) => {
        console.error("Could not load app data from Supabase — staying on mock data:", err);
        if (!cancelled) setUnitsSource("error");
      });
    return () => { cancelled = true; };
  }, [session, selectedPeriod, dataVersion]);

  // The upload handler that used to live here moved to the Bank recon module on
  // 8 August 2026, along with `saveBankStatementToDb`'s only caller. Bank recon
  // owns the import so there is one parser, one write path and one balance
  // check; this screen's `bankStatementMeta` is still loaded from the database
  // for display and is set nowhere else.

  // Saves (or clears) the manual utility-line overrides for a unit's statement
  // in the selected period. `patch` carries the full desired state: waterDue /
  // electricityDue are numbers to override or null to fall back to computed.
  // Record or clear a mid-month ownership change. Clearing removes the row,
  // which puts the month straight back to a single statement.
  const saveOwnershipChange = async (unitId, patch) => {
    const client = await ensureSupabaseClient();
    const dbId = (UNITS.find((u) => u.id === unitId) || {}).dbId;
    if (!dbId) throw new Error("Unit hasn't loaded from the database yet");
    if (patch === null) {
      const { error } = await client.from("ownership_changes")
        .delete().eq("unit_id", dbId).eq("period", ACTIVE_PERIOD);
      if (error) throw error;
      setOwnershipChanges((prev) => {
        const next = { ...prev }; delete next[unitId]; return next;
      });
      return;
    }
    const row = {
      unit_id: dbId, period: ACTIVE_PERIOD,
      changeover_date: patch.changeoverDate,
      water_reading: patch.waterReading,
      electricity_reading: patch.electricityReading,
      outgoing_owner: patch.outgoingOwner || null,
      incoming_owner: patch.incomingOwner || null,
      note: patch.note || null,
      updated_at: new Date().toISOString(),
    };
    const { error } = await client.from("ownership_changes").upsert(row, { onConflict: "unit_id,period" });
    if (error) throw error;
    setOwnershipChanges((prev) => ({ ...prev, [unitId]: { ...patch } }));
  };

  const saveStatementOverride = async (unitId, patch) => {
    const clean = {
      waterDue: patch.waterDue == null ? null : Number(patch.waterDue),
      electricityDue: patch.electricityDue == null ? null : Number(patch.electricityDue),
      note: patch.note || "",
    };
    setStatementOverrides((prev) => ({ ...prev, [unitId]: clean }));
    const unitRow = UNITS.find((u) => u.id === unitId);
    if (!unitRow || !unitRow.dbId) return; // mock data — local only
    try {
      const client = await ensureSupabaseClient();
      const allNull = clean.waterDue == null && clean.electricityDue == null && !clean.note;
      if (allNull) {
        // Nothing overridden — remove the row entirely.
        const { error } = await client.from("statement_overrides")
          .delete().eq("period", ACTIVE_PERIOD).eq("unit_id", unitRow.dbId);
        if (error) throw error;
        return;
      }
      const { error } = await client.from("statement_overrides").upsert({
        period: ACTIVE_PERIOD, unit_id: unitRow.dbId,
        water_due: clean.waterDue, electricity_due: clean.electricityDue,
        note: clean.note || null, updated_at: new Date().toISOString(),
      }, { onConflict: "period,unit_id" });
      if (error) throw error;
    } catch (err) {
      console.error("Saving statement adjustment failed:", err);
    }
  };

  // Record (or overwrite) a provisional payment for a unit and statement month.
  const addManualPayment = async ({ unitId, amount, datePaid, note }) => {
    const saved = await saveManualPaymentToDb({
      unitId, appliedPeriod: selectedPeriod, amount, datePaid, note,
    });
    setManualPayments((prev) => [
      ...prev.filter((m) => !(m.unit === unitId && m.appliedPeriod === selectedPeriod)),
      { dbId: saved.id, unit: unitId, appliedPeriod: saved.applied_period, amount: Number(saved.amount), datePaid: saved.date_paid, note: saved.note || "" },
    ]);
  };

  const removeManualPayment = async (id) => {
    await deleteManualPaymentFromDb(id);
    setManualPayments((prev) => prev.filter((m) => m.dbId !== id));
  };

  // Retarget a bank line to a different statement month, then refresh so
  // reconciliation recomputes against the new applied period.
  const changeAppliedPeriod = async (txn, appliedPeriod) => {
    await setAppliedPeriodInDb(txn.dbId, appliedPeriod);
    setBankTxns((prev) => prev.map((t) => (t === txn ? { ...t, appliedPeriod } : t)));
  };

  // Records the trustee's review of a bank line: a free-text note explaining a
  // difference and whether it's been resolved. Updates the row in place (by
  // object reference — otherTxns/matches share the same objects) and persists
  // to the database when the line came from there (has a dbId).
  const updateTxnReview = async (txn, { reviewed, reviewNote }) => {
    setBankTxns((prev) => prev.map((t) => (t === txn ? { ...t, reviewed, reviewNote } : t)));
    if (!txn.dbId) return; // demo/unsaved statement — local-only
    try {
      const client = await ensureSupabaseClient();
      const { error } = await client
        .from("bank_transactions")
        .update({ reviewed, review_note: reviewNote })
        .eq("id", txn.dbId);
      if (error) throw error;
    } catch (err) {
      console.error("Saving the review note failed:", err);
    }
  };

  // Tags a bank line with an expense category. This is the primary tagging
  // point — bank transactions are the cash-basis source of truth for the
  // analytics dashboard, so an untagged debit shows up there as unclassified
  // rather than being silently dropped.
  const updateTxnExpenseCategory = async (txn, expenseCategory) => {
    const before = txn.expenseCategory || "";
    setBankTxns((prev) => prev.map((t) => (t === txn ? { ...t, expenseCategory } : t)));
    if (!txn.dbId) return; // demo/unsaved statement — local-only
    try {
      const client = await ensureSupabaseClient();
      const { error } = await client
        .from("bank_transactions")
        .update({ expense_category: expenseCategory || null })
        .eq("id", txn.dbId);
      if (error) throw error;
    } catch (err) {
      console.error("Saving the expense category failed:", err);
      setBankTxns((prev) => prev.map((t) => (t.dbId === txn.dbId ? { ...t, expenseCategory: before } : t)));
      window.alert("Couldn't save the expense category — see browser console.");
    }
  };

  const alloc = useAllocation(
    waterBands, electricityRate, levyBreakdown, vatRate, additionalCharges,
    commonPropertyElectricityKwh, commonPropertyWaterKl, unitsSource, readings, councilInvoice, statementOverrides,
    selectedPeriod
  );

  // Resident capability-URL mode takes precedence over the trustee login —
  // a valid ?unit=<token> link goes straight to that unit's portal, locked
  // to that unit, with no login and no way to switch units.
  if (RESIDENT_TOKEN) {
    if (residentUnit === undefined) {
      return (
        <div className="f-body" style={{ minHeight: "100vh", background: "#1B2A38", display: "flex", alignItems: "center", justifyContent: "center", color: "#B9C4CE", fontSize: 14 }}>
          {FONT_IMPORT}
          Checking your link…
        </div>
      );
    }
    if (!residentUnit) {
      return (
        <div className="f-body" style={{ minHeight: "100vh", background: "#1B2A38", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
          {FONT_IMPORT}
          <div style={{ background: "#F6F1E7", borderRadius: 10, padding: "32px 34px", maxWidth: 420, textAlign: "center" }}>
            <div className="f-display" style={{ fontSize: 19, fontWeight: 700, color: "#1B2A38", marginBottom: 8 }}>This link isn't valid</div>
            <div style={{ fontSize: 13, color: "#64748B", lineHeight: 1.6 }}>
              Your statement link may have been mistyped or replaced. Please contact the trustee for your unit's current link.
            </div>
          </div>
        </div>
      );
    }
    return (
      <ResidentTokenApp
        unit={residentUnit}
        remittanceDeductions={remittanceDeductions} setRemittanceDeductions={setRemittanceDeductions}
        setRemittanceAdvices={setRemittanceAdvices}
      />
    );
  }

  if (session === undefined) {
    return (
      <div className="f-body" style={{ minHeight: "100vh", background: "#1B2A38", display: "flex", alignItems: "center", justifyContent: "center", color: "#B9C4CE", fontSize: 14 }}>
        {FONT_IMPORT}
        Checking session…
      </div>
    );
  }
  if (!session) return <LoginScreen />;

  // The trustee/resident view switch was removed from the top bar on 11 August
  // 2026. It let a trustee preview the resident portal, but residents do not
  // reach the app that way — they arrive on a per-unit token link, handled by
  // the RESIDENT_TOKEN branch above, which is the real resident experience and
  // is what should be tested. ResidentPortal is still live; it renders there.
  return (
    <TrusteeRoleContext.Provider value={roleState}>
    <div className="f-body" style={{ minHeight: "100vh", background: "#EFEAE0", color: "#1B2A38" }}>
      {FONT_IMPORT}
      <TopBar unitsSource={unitsSource} onSignOut={signOutOfApp} period={pageHasPeriod(tab) ? selectedPeriod : null} />
        <div style={{ display: "flex" }}>
          <SideNav tab={tab} setTab={setTab} />
          <main style={{ flex: 1, padding: "28px 32px", maxWidth: 1100 }}>
            {/* No month selector on a screen that isn't about a month. */}
            {pageHasPeriod(tab) && (
              <PeriodBar periods={periods} selectedPeriod={selectedPeriod} setSelectedPeriod={setSelectedPeriod} />
            )}
            {tab === "dashboard" && <Dashboard alloc={alloc} setTab={setTab} setSelectedUnit={setSelectedUnit} bankTxns={bankTxns} period={selectedPeriod} remittanceDeductions={remittanceDeductions} manualPayments={manualPayments} />}
            {tab === "readings" && (
              <>
                <ApprovalCheckbox subject="meter_readings" period={selectedPeriod} />
                <Readings readings={readings} setReadings={setReadings} period={selectedPeriod} />
              </>
            )}
            {tab === "allocation" && (
              <>
                <UtilityBills
                  councilInvoice={councilInvoice}
                  setCouncilInvoice={setCouncilInvoice}
                  alloc={alloc}
                  period={selectedPeriod}
                  billMissing={councilInvoiceMissing}
                  setBillMissing={setCouncilInvoiceMissing}
                />
                <Allocation alloc={alloc} billMissing={councilInvoiceMissing} />
              </>
            )}
            {tab === "reconciliation" && (
              <Reconciliation
                alloc={alloc}
                period={selectedPeriod}
                remittanceDeductions={remittanceDeductions}
                setRemittanceDeductions={setRemittanceDeductions}
                remittanceAdvices={remittanceAdvices}
                bankTxns={bankTxns}
                manualPayments={manualPayments}
                onAddManualPayment={addManualPayment}
                onRemoveManualPayment={removeManualPayment}
                onChangeAppliedPeriod={changeAppliedPeriod}
                onReviewTxn={updateTxnReview}
                onTagTxn={updateTxnExpenseCategory}
                onGoToBankRecon={() => setTab("bank-recon")}
              />
            )}
            {tab === "statement-preview" && (
              <StatementPreview
                alloc={alloc} period={selectedPeriod} selectedUnit={selectedUnit} setSelectedUnit={setSelectedUnit}
                onSaveOverride={saveStatementOverride}
                ownershipChanges={ownershipChanges} onSaveOwnershipChange={saveOwnershipChange}
                waterBands={waterBands}
              />
            )}
            {tab === "tariffs" && (
              <RateSettings
                waterBands={waterBands}
                waterBandHistory={waterBandHistory}
                onSaved={() => setDataVersion((v) => v + 1)}
                electricityRate={electricityRate} setElectricityRate={setElectricityRate}
                electricityEffectiveFrom={electricityEffectiveFrom} setElectricityEffectiveFrom={setElectricityEffectiveFrom}
                vatRate={vatRate} setVatRate={setVatRate}
                commonPropertyElectricityKwh={commonPropertyElectricityKwh}
                setCommonPropertyElectricityKwh={setCommonPropertyElectricityKwh}
                commonPropertyWaterKl={commonPropertyWaterKl}
                setCommonPropertyWaterKl={setCommonPropertyWaterKl}
                standardsMeta={standardsMeta}
              />
            )}
            {/* Bank recon drives its own month rather than the app-wide period
                bar: the statement being imported is the month AFTER the one
                being reconciled, and importing a historic statement should not
                move every other screen with it. `dataVersion` bumps on a
                successful import so Tenant recon picks the new lines up. */}
            {tab === "bank-recon" && (
              <BankRecon
                // Every statement month the app knows about, plus the one after
                // the latest — a statement is imported before its own period has
                // any other data, so the list must run one month ahead.
                periods={(() => {
                  const set = new Set([...periods, ...periods.map(nextPeriod), bankReconPeriod]);
                  return [...set].sort().reverse();
                })()}
                period={bankReconPeriod}
                setPeriod={setBankReconPeriod}
                onImported={() => setDataVersion((v) => v + 1)}
              />
            )}
            {tab === "maintenance" && <MaintenancePlan />}
            {tab === "budget" && <Budget />}
            {tab === "rate-history" && <RateHistory />}
            {tab === "levy-setup" && (
              <>
                <ApprovalCheckbox subject="levy_breakdown" period={selectedPeriod}
                  hint="Levies are set annually at the AGM, so this sign-off covers the financial year rather than the month." />
                <LevySetup
                levyBreakdown={levyBreakdown} setLevyBreakdown={setLevyBreakdown}
                levyMeta={levyMeta} onSaved={() => setDataVersion((v) => v + 1)}
                waterBands={waterBands} electricityRate={electricityRate} vatRate={vatRate}
                commonPropertyElectricityKwh={commonPropertyElectricityKwh}
                commonPropertyWaterKl={commonPropertyWaterKl}
                councilInvoice={councilInvoice}
                />
              </>
            )}
            {tab === "insurance" && (
              <>
                <ApprovalCheckbox subject="insurance" period={selectedPeriod}
                  hint="The insurance schedule is set once a financial year, so this sign-off covers the year rather than the month." />
                <InsurancePage />
              </>
            )}
            {tab === "additional-charges" && (
              <AdditionalCharges additionalCharges={additionalCharges} setAdditionalCharges={setAdditionalCharges} />
            )}
            {tab === "ops-expenses" && (
              <OpsExpenses opsExpenses={opsExpenses} setOpsExpenses={setOpsExpenses} period={selectedPeriod} />
            )}
            {tab === "analytics" && (
              <>
                <Analytics expenseCategories={expenseCategories} />
                {/* The reserve fund is money, so it belongs with the money.
                    Moved off the Maintenance page 11 August 2026. */}
                <ReserveFund />
              </>
            )}
            {tab === "users" && <UserManagement onProfileChanged={() => setProfileVersion((v) => v + 1)} />}
            {tab === "config" && (
              <Config expenseCategories={expenseCategories} setExpenseCategories={setExpenseCategories} />
            )}
            {tab === "password" && <PasswordManagement />}
          </main>
        </div>
    </div>
    </TrusteeRoleContext.Provider>
  );
}

// `period` is null on screens that aren't about a month (see NAV_PAGES.noPeriod)
// — the subtitle then just omits it rather than showing a month the page
// ignores.
function TopBar({ unitsSource, onSignOut, period }) {
  const sourceBadge = {
    mock: { label: "Loading units…", bg: "#24374A", color: "#B9C4CE" },
    database: { label: "● Live database", bg: "#2F5D50", color: "#E4EFEA" },
    error: { label: "● DB offline — mock data", bg: "#B5651D", color: "#F6E7DA" },
  }[unitsSource] || { label: unitsSource, bg: "#24374A", color: "#B9C4CE" };
  return (
    <header
      style={{
        background: "#1B2A38",
        color: "#F6F1E7",
        padding: "16px 32px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <MeterMark />
        <div>
          <div className="f-display" style={{ fontSize: 20, fontWeight: 600, letterSpacing: 0.2 }}>
            El Corazon
          </div>
          <div style={{ fontSize: 11, color: "#B9C4CE", letterSpacing: 1, textTransform: "uppercase" }}>
            Body Corporate · 7 Units{period ? ` · ${periodLabel(period)}` : ""}
          </div>
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <span style={{ background: sourceBadge.bg, color: sourceBadge.color, fontSize: 10.5, fontWeight: 700, padding: "4px 10px", borderRadius: 20, letterSpacing: 0.4, whiteSpace: "nowrap" }}>
          {sourceBadge.label}
        </span>
        <button
          onClick={onSignOut}
          style={{ background: "transparent", border: "1px solid #3A4E63", color: "#B9C4CE", padding: "7px 14px", borderRadius: 7, fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}
        >
          Sign out
        </button>
      </div>
    </header>
  );
}

// Header for residents arriving via their capability URL — brand only, no
// role toggle, no sign-out, no way to navigate anywhere else.
function ResidentTopBar({ unit, period }) {
  return (
    <header style={{ background: "#1B2A38", color: "#F6F1E7", padding: "16px 32px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <MeterMark />
        <div>
          <div className="f-display" style={{ fontSize: 20, fontWeight: 600, letterSpacing: 0.2 }}>El Corazon</div>
          <div style={{ fontSize: 11, color: "#B9C4CE", letterSpacing: 1, textTransform: "uppercase" }}>
            Body Corporate{period ? ` · ${periodLabel(period)}` : ""}
          </div>
        </div>
      </div>
      <div className="f-mono" style={{ fontSize: 12.5, color: "#B9C4CE" }}>
        Unit {unit.id.slice(1)} · {unit.owner}
      </div>
    </header>
  );
}

function MeterMark() {
  return (
    <svg width="30" height="30" viewBox="0 0 30 30" fill="none">
      <circle cx="15" cy="15" r="13" stroke="#B5651D" strokeWidth="2" />
      <path d="M15 15 L15 6" stroke="#F6F1E7" strokeWidth="2" strokeLinecap="round" />
      <path d="M15 15 L21 19" stroke="#F6F1E7" strokeWidth="2" strokeLinecap="round" />
      <circle cx="15" cy="15" r="1.6" fill="#F6F1E7" />
    </svg>
  );
}

// Every trustee screen, in nav order, with the roles it defaults to. ONE list,
// shared by the side nav, the User management page and the landing-page picker
// — separate lists would drift, and a page missing from the management list is
// a page nobody can grant.
//
//   alwaysOn  — cannot be taken away. Password management is the only one:
//               removing it would lock somebody out of their own password.
//               (Config used to carry that and so used to be alwaysOn; since
//               the password screen moved out on 11 August 2026, Config is an
//               ordinary grantable page.)
//   financeOnly — the screen manages other users, so only the finance trustee
//               can ever see it, whatever the page list says.
//   noPeriod  — the screen has nothing to do with a month, so the period
//               selector and the month in the header are hidden on it. Showing
//               "August 2026" above a user list invites the reader to think the
//               list is somehow scoped to August.
const NAV_PAGES = [
  { key: "dashboard", label: "Dashboard", roles: ["finance", "approver", "maintenance"] },
  { key: "readings", label: "Meter readings", roles: ["finance", "approver"] },
  { key: "levy-setup", label: "Levy breakdown (AGM)", roles: ["finance", "approver"] },
  { key: "insurance", label: "Insurance", roles: ["finance", "approver"] },
  { key: "additional-charges", label: "Additional charges", roles: ["finance"] },
  { key: "ops-expenses", label: "Body corp expenses", roles: ["finance"] },
  { key: "allocation", label: "Invoice allocation", roles: ["finance"] },
  { key: "reconciliation", label: "Tenant recon", roles: ["finance"] },
  { key: "bank-recon", label: "Bank recon", roles: ["finance"] },
  { key: "maintenance", label: "Maintenance plan", roles: ["finance", "maintenance"] },
  { key: "budget", label: "Budget", roles: ["finance"] },
  { key: "statement-preview", label: "Statement preview", roles: ["finance", "approver"] },
  { key: "analytics", label: "Financial dashboard", roles: ["finance", "approver", "maintenance"] },
  { key: "tariffs", label: "Tariffs & rates", roles: ["finance"] },
  { key: "rate-history", label: "Rate history", roles: ["finance"] },
  { key: "users", label: "User management", roles: ["finance"], financeOnly: true, noPeriod: true },
  { key: "config", label: "Config", roles: ["finance", "approver", "maintenance"] },
  { key: "password", label: "Password management", roles: ["finance", "approver", "maintenance"], alwaysOn: true, noPeriod: true },
];

const NAV_PAGE_BY_KEY = Object.fromEntries(NAV_PAGES.map((p) => [p.key, p]));
const pageHasPeriod = (key) => !(NAV_PAGE_BY_KEY[key] || {}).noPeriod;

const defaultPagesForRole = (role) =>
  NAV_PAGES.filter((p) => p.roles.includes(role || "finance")).map((p) => p.key);

// `allowedPages` null means "use the role's defaults" — which is what a
// trustee added without a list gets, and what stops a screen ADDED to the app
// later from being invisible to everyone who already has an explicit list.
// An explicit list overrides, except for the two rules that are not the page
// list's to decide.
function visibleNavPages(role, allowedPages) {
  const granted = Array.isArray(allowedPages) && allowedPages.length
    ? allowedPages
    : defaultPagesForRole(role);
  return NAV_PAGES
    .filter((p) => {
      if (p.financeOnly && !(role == null || role === "finance")) return false;
      if (p.alwaysOn) return true;
      return granted.includes(p.key);
    })
    .map((p) => [p.key, p.label]);
}

// Which page to open on at sign-in.
//
// The stored preference is a HINT, not an instruction — see the note on
// trustees.landing_page. It can name a page the user has since lost access to,
// or one that no longer exists, and landing someone on a blank screen because
// of a stale preference is worse than ignoring the preference. So it is only
// honoured if it is in the list of pages they can actually see; otherwise the
// first visible page, which for every current role is the Dashboard.
function resolveLandingPage(role, allowedPages, landingPage) {
  const visible = visibleNavPages(role, allowedPages).map(([key]) => key);
  if (landingPage && visible.includes(landingPage)) return landingPage;
  return visible[0] || "dashboard";
}

function SideNav({ tab, setTab }) {
  const { role, allowedPages } = useTrusteeRole();
  const items = visibleNavPages(role, allowedPages);
  return (
    <nav style={{ width: 210, borderRight: "1px solid #D8D0BE", padding: "24px 12px", minHeight: "calc(100vh - 65px)" }}>
      {items.map(([key, label]) => (
        <button
          key={key}
          onClick={() => setTab(key)}
          style={{
            display: "block",
            width: "100%",
            textAlign: "left",
            padding: "10px 14px",
            borderRadius: 7,
            border: "none",
            background: tab === key ? "#1B2A38" : "transparent",
            color: tab === key ? "#F6F1E7" : "#1B2A38",
            fontSize: 13.5,
            fontWeight: 600,
            marginBottom: 4,
            cursor: "pointer",
          }}
        >
          {label}
        </button>
      ))}
    </nav>
  );
}

// ---------- Expense categories (shared across every tagging point) ----------
// Fetched once per page load and cached at module level, because four separate
// screens need the same list. Both trustee and resident sessions go through the
// SECURITY DEFINER RPC: expense_categories itself is trustee-only under RLS,
// and the RPC returns active names only.
let EXPENSE_CATEGORY_PROMISE = null;
function loadExpenseCategoryNames() {
  if (!EXPENSE_CATEGORY_PROMISE) {
    EXPENSE_CATEGORY_PROMISE = (async () => {
      const client = await ensureSupabaseClient();
      const { data, error } = await client.rpc("get_expense_categories");
      if (error) throw error;
      return (data || []).map((c) => c.name);
    })().catch((err) => {
      console.error("Loading expense categories failed:", err);
      EXPENSE_CATEGORY_PROMISE = null; // let a later mount retry
      return EXPENSE_CATEGORIES_FALLBACK.filter((c) => c.active).map((c) => c.name);
    });
  }
  return EXPENSE_CATEGORY_PROMISE;
}
// Call after any Config edit so open dropdowns pick the change up on next mount.
function invalidateExpenseCategoryCache() { EXPENSE_CATEGORY_PROMISE = null; }

function useExpenseCategoryNames() {
  const [names, setNames] = useState([]);
  useEffect(() => {
    let alive = true;
    loadExpenseCategoryNames().then((n) => { if (alive) setNames(n); });
    return () => { alive = false; };
  }, []);
  return names;
}

// The one dropdown used everywhere an expense can be tagged. `value` may be a
// category that has since been deactivated — it stays selectable so historic
// records keep their tag rather than silently reverting to untagged.
function ExpenseCategorySelect({ value, onChange, disabled, placeholder = "Untagged", style, names: namesProp }) {
  const loaded = useExpenseCategoryNames();
  const names = namesProp || loaded;
  const options = value && !names.includes(value) ? [...names, value] : names;
  return (
    <select
      value={value || ""}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      style={{
        padding: "6px 8px", borderRadius: 6, border: "1px solid #D8D0BE",
        fontSize: 12, fontFamily: "'Inter', sans-serif",
        background: value ? "#fff" : "#FBF6EC",
        color: value ? "#1B2A38" : "#8A6D1E",
        ...style,
      }}
    >
      <option value="">{placeholder}</option>
      {options.map((n) => <option key={n} value={n}>{n}</option>)}
    </select>
  );
}

function Card({ children, style, className }) {
  return (
    <div className={className} style={{ background: "#fff", border: "1px solid #E4DCC8", borderRadius: 10, padding: 20, ...style }}>
      {children}
    </div>
  );
}

// The app-wide month selector. Sits above every trustee screen so switching the
// period re-drives the dashboard, reconciliation and statements from the chosen
// month's data.
function PeriodBar({ periods, selectedPeriod, setSelectedPeriod }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 20 }}>
      <span style={{ fontSize: 11, fontWeight: 700, color: "#64748B", letterSpacing: 0.6, textTransform: "uppercase" }}>
        Viewing period
      </span>
      <select
        value={selectedPeriod}
        onChange={(e) => setSelectedPeriod(e.target.value)}
        style={{ padding: "7px 12px", borderRadius: 7, border: "1px solid #D8D0BE", background: "#fff", fontSize: 13, fontWeight: 600, color: "#1B2A38", cursor: "pointer" }}
      >
        {periods.map((p) => (
          <option key={p} value={p}>{periodLabel(p)}</option>
        ))}
      </select>
    </div>
  );
}

function StatusChip({ status }) {
  const map = {
    paid: { bg: "#E4EFEA", color: "#2F5D50", label: "Reconciled" },
    outstanding: { bg: "#F6E7DA", color: "#B5651D", label: "Outstanding" },
    review: { bg: "#F1EAD3", color: "#8A6D1E", label: "Needs review" },
    resolved: { bg: "#E4EFEA", color: "#2F5D50", label: "Resolved ✓" },
  };
  const s = map[status] || map.review;
  return (
    <span style={{ background: s.bg, color: s.color, fontSize: 11.5, fontWeight: 700, padding: "3px 9px", borderRadius: 20 }}>
      {s.label}
    </span>
  );
}

// ---------- Dashboard ----------
function Dashboard({ alloc, setTab, setSelectedUnit, bankTxns, period = CURRENT_PERIOD, remittanceDeductions = {}, manualPayments = [] }) {
  const [copiedId, setCopiedId] = useState(null);
  const copyResidentLink = (r) => {
    const link = `${window.location.origin}${window.location.pathname}?unit=${r.token}`;
    navigator.clipboard.writeText(link).then(() => {
      setCopiedId(r.id);
      setTimeout(() => setCopiedId(null), 2000);
    });
  };
  const ci = alloc.councilInvoice;
  const totalInvoice =
    ci.bulkWaterRand + ci.bulkElecRand + ci.sewerage +
    ci.refuse + ci.fixedBasic;
  const totalDue = alloc.rows.reduce((s, r) => s + r.total, 0);
  // Same reconciliation source of truth as the Tenant recon page, so the
  // two stay in sync — expected nets out approved deductions, settled lines
  // (paid within tolerance or a reviewed variance) count as reconciled.
  const matches = reconcileUnits(alloc.rows, bankTxns, remittanceDeductions, {}, period, manualPayments);
  const matchByUnit = Object.fromEntries(matches.map((m) => [m.unit.id, m]));
  const reconciledCount = matches.filter((m) => m.settled).length;
  const outstanding = matches.reduce((s, m) => s + (m.settled ? 0 : Math.max(m.expected - m.received, 0)), 0);

  return (
    <>
      <h1 className="f-display" style={{ fontSize: 26, marginBottom: 4 }}>{periodLabel(period)} close-out</h1>
      <p style={{ color: "#64748B", fontSize: 13.5, marginBottom: 22 }}>
        Council invoice loaded · readings captured for 7/7 units · statements not yet sent
      </p>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 14, marginBottom: 22 }}>
        <Stat label="Council invoice" value={rand(totalInvoice)} />
        <Stat label="Total levies raised" value={rand(totalDue)} accent="#2F5D50" />
        <Stat label="Reconciled" value={`${reconciledCount} / 7 units`} accent={reconciledCount === 7 ? "#2F5D50" : "#B5651D"} />
        <Stat label="Outstanding" value={rand(outstanding)} accent={outstanding < RECON_TOLERANCE ? "#2F5D50" : "#B5651D"} />
      </div>

      <Card>
        <div style={{ fontWeight: 700, fontSize: 13.5, marginBottom: 12, textTransform: "uppercase", letterSpacing: 0.4, color: "#64748B" }}>
          Units
        </div>
        <table style={{ width: "100%", fontSize: 13.5, borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ color: "#64748B", textAlign: "left", fontSize: 11.5, textTransform: "uppercase" }}>
              <th style={{ padding: "6px 8px" }}>Unit</th>
              <th style={{ padding: "6px 8px" }}>Owner</th>
              <th style={{ padding: "6px 8px" }}>PQ %</th>
              <th style={{ padding: "6px 8px", textAlign: "right" }}>Total due</th>
              <th style={{ padding: "6px 8px" }}>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {alloc.rows.map((r) => {
              const m = matchByUnit[r.id];
              return (
                <tr key={r.id} style={{ borderTop: "1px solid #EEE7D6" }}>
                  <td className="f-mono" style={{ padding: "9px 8px", fontWeight: 600 }}>{r.id}</td>
                  <td style={{ padding: "9px 8px" }}>{r.owner}</td>
                  <td className="f-mono" style={{ padding: "9px 8px" }}>{r.pq.toFixed(1)}</td>
                  <td className="f-mono" style={{ padding: "9px 8px", textAlign: "right" }}>{rand(r.total)}</td>
                  <td style={{ padding: "9px 8px" }}>
                    <StatusChip status={m ? m.status : "outstanding"} />
                  </td>
                  <td style={{ padding: "9px 8px", textAlign: "right", whiteSpace: "nowrap" }}>
                    <button
                      onClick={() => { setSelectedUnit(r.id); setTab("statement-preview"); }}
                      style={{ fontSize: 12, fontWeight: 600, color: "#1B2A38", background: "none", border: "none", cursor: "pointer", textDecoration: "underline" }}
                    >
                      View statement
                    </button>
                    {/* Permanent no-login link for this unit's resident —
                        only present once units have loaded from the DB. */}
                    {r.token && (
                      <button
                        onClick={() => copyResidentLink(r)}
                        style={{ marginLeft: 10, fontSize: 12, fontWeight: 600, color: copiedId === r.id ? "#2F5D50" : "#B5651D", background: "none", border: "none", cursor: "pointer", textDecoration: "underline" }}
                      >
                        {copiedId === r.id ? "✓ Copied" : "Resident link"}
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>
    </>
  );
}

function Stat({ label, value, accent = "#1B2A38" }) {
  return (
    <Card>
      <div style={{ fontSize: 11, color: "#64748B", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6 }}>{label}</div>
      <div className="f-mono" style={{ fontSize: 20, fontWeight: 600, color: accent }}>{value}</div>
    </Card>
  );
}

// ---------- Readings ----------
function Readings({ readings, setReadings, period = CURRENT_PERIOD }) {
  // Current readings are edited as local draft strings so half-typed numbers
  // never ripple into the live billing calculations — figures commit to app
  // state AND the database together when saved.
  // Every reading on this screen — typed or derived — is shown to two decimals
  // with a full stop, so the input columns read the same as the carried-forward
  // and usage columns beside them.
  const fmtReading = (v) => {
    const n = Number(v);
    return Number.isNaN(n) ? "—" : n.toFixed(2);
  };
  const toNum = (v) => parseFloat(String(v).replace(",", ".")) || 0;

  const toDraft = (rs) => Object.fromEntries(UNITS.map((u) => {
    const r = rs[u.id] || { wCurr: 0, eCurr: 0 };
    return [u.id, { wCurr: fmtReading(r.wCurr), eCurr: fmtReading(r.eCurr) }];
  }));
  const [draft, setDraft] = useState(() => toDraft(readings));
  const [status, setStatus] = useState("idle"); // idle | saving | saved | error
  useEffect(() => { setDraft(toDraft(readings)); }, [readings]);

  const updateDraft = (uid, field, value) =>
    setDraft((prev) => ({ ...prev, [uid]: { ...prev[uid], [field]: value } }));
  const draftNum = (uid, field) => toNum(draft[uid]?.[field]);
  // Snap what was typed to the shared format once the field loses focus, so a
  // comma-decimal or a bare "1234" doesn't sit out of step with its neighbours.
  const normalizeDraft = (uid, field) =>
    setDraft((prev) => {
      const raw = prev[uid]?.[field];
      const n = parseFloat(String(raw).replace(",", "."));
      if (Number.isNaN(n)) return prev;
      return { ...prev, [uid]: { ...prev[uid], [field]: n.toFixed(2) } };
    });

  const save = async () => {
    setStatus("saving");
    try {
      const next = {};
      Object.entries(readings).forEach(([uid, r]) => {
        next[uid] = { ...r, wCurr: draftNum(uid, "wCurr"), eCurr: draftNum(uid, "eCurr") };
      });
      await saveReadingsToDb(next);
      setReadings(next);
      setStatus("saved");
      setTimeout(() => setStatus("idle"), 2500);
    } catch (err) {
      console.error("Saving readings failed:", err);
      setStatus("error");
    }
  };

  return (
    <>
      <h1 className="f-display" style={{ fontSize: 24, marginBottom: 4 }}>Meter readings — {periodLabel(period)}</h1>
      <p style={{ color: "#64748B", fontSize: 13.5, marginBottom: 18 }}>
        Enter current readings; previous month carries forward automatically. Saving writes to the database and updates every dependent screen.
      </p>
      <Card>
        {/* Same treatment as the water tariff table: fixed layout + colgroup for
            seven equal columns, one shared cell style for a uniform row height,
            everything centred. */}
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", fontSize: 13.5, borderCollapse: "collapse", tableLayout: "fixed", minWidth: 7 * 110 }}>
            <colgroup>
              {Array.from({ length: 7 }).map((_, i) => <col key={i} style={{ width: `${100 / 7}%` }} />)}
            </colgroup>
            <thead>
              <tr style={{ color: "#64748B", textAlign: "center", fontSize: 11, textTransform: "uppercase" }}>
                <th style={readingHeadStyle}>Unit</th>
                <th style={readingHeadStyle}>Water prev (kL)</th>
                <th style={readingHeadStyle}>Water curr (kL)</th>
                <th style={{ ...readingHeadStyle, color: "#2F5D50" }}>Usage</th>
                <th style={readingHeadStyle}>Elec prev (kWh)</th>
                <th style={readingHeadStyle}>Elec curr (kWh)</th>
                <th style={{ ...readingHeadStyle, color: "#2F5D50" }}>Usage</th>
              </tr>
            </thead>
            <tbody>
              {UNITS.map((u) => {
                const r = readings[u.id] || { wPrev: 0, wCurr: 0, ePrev: 0, eCurr: 0 };
                return (
                  <tr key={u.id} style={{ borderTop: "1px solid #EEE7D6" }} className="f-mono">
                    <td style={{ ...readingCellStyle, fontWeight: 600 }}>{u.id}</td>
                    <td style={{ ...readingCellStyle, color: "#94A0AC" }}>{fmtReading(r.wPrev)}</td>
                    <td style={readingCellStyle}>
                      <input
                        value={draft[u.id]?.wCurr ?? ""}
                        onChange={(e) => updateDraft(u.id, "wCurr", e.target.value)}
                        onBlur={() => normalizeDraft(u.id, "wCurr")}
                        inputMode="decimal" style={readingInputStyle}
                      />
                    </td>
                    <td style={{ ...readingCellStyle, color: "#2F5D50", fontWeight: 600 }}>{round2(draftNum(u.id, "wCurr") - r.wPrev).toFixed(2)}</td>
                    <td style={{ ...readingCellStyle, color: "#94A0AC" }}>{fmtReading(r.ePrev)}</td>
                    <td style={readingCellStyle}>
                      <input
                        value={draft[u.id]?.eCurr ?? ""}
                        onChange={(e) => updateDraft(u.id, "eCurr", e.target.value)}
                        onBlur={() => normalizeDraft(u.id, "eCurr")}
                        inputMode="decimal" style={readingInputStyle}
                      />
                    </td>
                    <td style={{ ...readingCellStyle, color: "#2F5D50", fontWeight: 600 }}>{round2(draftNum(u.id, "eCurr") - r.ePrev).toFixed(2)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div style={{ marginTop: 16, display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 10 }}>
          {status === "saved" && <span style={{ fontSize: 12.5, color: "#2F5D50", fontWeight: 600 }}>✓ Saved to database</span>}
          {status === "error" && <span style={{ fontSize: 12.5, color: "#B5651D", fontWeight: 600 }}>Couldn't save — see browser console</span>}
          <button style={secondaryBtn} onClick={save} disabled={status === "saving"}>
            {status === "saving" ? "Saving…" : "Save readings"}
          </button>
          {/* Moved here from the Invoice allocation page - readings are the
              last input before statements can be produced. */}
          <button style={primaryBtn}>Confirm allocation &amp; generate statements</button>
        </div>
      </Card>
    </>
  );
}

const inputStyle = {
  width: 90, textAlign: "right", padding: "6px 8px", borderRadius: 6, border: "1px solid #D8D0BE",
  fontFamily: "'IBM Plex Mono', monospace", fontSize: 13.5,
};
const primaryBtn = {
  background: "#1B2A38", color: "#F6F1E7", border: "none", padding: "9px 16px",
  borderRadius: 7, fontWeight: 600, fontSize: 13, cursor: "pointer",
};
const secondaryBtn = {
  background: "transparent", color: "#1B2A38", border: "1px solid #D8D0BE", padding: "9px 16px",
  borderRadius: 7, fontWeight: 600, fontSize: 13, cursor: "pointer",
};
// Meter-readings table: uniform column width, row height and centring. Declared
// after inputStyle because readingInputStyle spreads it at module-eval time.
const readingHeadStyle = { padding: "6px 8px", height: 40, verticalAlign: "middle", textAlign: "center" };
const readingCellStyle = { padding: "6px 8px", height: 46, verticalAlign: "middle", textAlign: "center" };
const readingInputStyle = {
  ...inputStyle, textAlign: "center",
  width: "100%", maxWidth: 110, boxSizing: "border-box", display: "block", margin: "0 auto",
};

// ---------- Utility bills (feeds the levy suggestions & provision check) ----------
function UtilityBills({ councilInvoice, setCouncilInvoice, alloc, period = CURRENT_PERIOD, billMissing = false, setBillMissing }) {
  const waterInputRef = useRef(null);
  const elecInputRef = useRef(null);
  const [status, setStatus] = useState("idle"); // idle | parsing | review | saving | saved | error
  const [note, setNote] = useState(null);
  const toDraft = (ci) => ({
    bulkWaterKl: String(ci.bulkWaterKl), bulkWaterRand: String(ci.bulkWaterRand),
    bulkElecKwh: String(ci.bulkElecKwh), bulkElecRand: String(ci.bulkElecRand),
    waterDemandLevyPerUnit: String(ci.waterDemandLevyPerUnit), sewerChargePerUnit: String(ci.sewerChargePerUnit),
    elecServiceFee: String(ci.elecServiceFee), elecNetworkFee: String(ci.elecNetworkFee),
  });
  const [draft, setDraft] = useState(() => toDraft(councilInvoice));
  useEffect(() => { setDraft(toDraft(councilInvoice)); }, [councilInvoice]);
  const upd = (k) => (e) => setDraft((p) => ({ ...p, [k]: e.target.value }));

  const handleUpload = async (file, kind) => {
    setStatus("parsing");
    setNote(null);
    try {
      const { fields, matched, total } = await parseUtilityBillPdf(file, kind);
      setDraft((prev) => {
        const next = { ...prev };
        Object.entries(fields).forEach(([k, v]) => { if (v != null) next[k] = String(v); });
        return next;
      });
      setStatus("review");
      setNote(`"${file.name}": ${matched}/${total} figures recognised — check them below, fill in anything missing, then save.`);
    } catch (err) {
      console.error("Bill parsing failed:", err);
      setStatus("error");
      setNote("Couldn't read this PDF — enter the figures manually below.");
    }
  };

  const save = async () => {
    setStatus("saving");
    try {
      const num = (k) => parseFloat(draft[k]) || 0;
      const next = {
        ...councilInvoice,
        bulkWaterKl: num("bulkWaterKl"), bulkWaterRand: num("bulkWaterRand"),
        bulkElecKwh: num("bulkElecKwh"), bulkElecRand: num("bulkElecRand"),
        waterDemandLevyPerUnit: num("waterDemandLevyPerUnit"), sewerChargePerUnit: num("sewerChargePerUnit"),
        elecServiceFee: num("elecServiceFee"), elecNetworkFee: num("elecNetworkFee"),
        sewerage: round2(num("sewerChargePerUnit") * UNITS.length),
      };
      await saveCouncilInvoiceToDb(next);
      setCouncilInvoice(next);
      if (setBillMissing) setBillMissing(false); // a row now exists for this period
      setStatus("saved");
      setNote("Bill figures saved — levy suggestions and the provision check update immediately.");
      setTimeout(() => setStatus("idle"), 3000);
    } catch (err) {
      console.error("Saving bill figures failed:", err);
      setStatus("error");
      setNote("Couldn't save — see browser console.");
    }
  };

  const field = (label, key, hint) => (
    <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
      <span style={{ fontSize: 11, color: "#64748B", textTransform: "uppercase", letterSpacing: 0.3 }}>{label}</span>
      <input value={draft[key]} onChange={upd(key)} style={{ ...inputStyle, width: 130, textAlign: "left" }} />
      {hint && <span style={{ fontSize: 10.5, color: "#94A0AC" }}>{hint}</span>}
    </div>
  );

  // Provision check: actual common-area gap (bulk minus metered) vs the
  // standards used for the Common Property levy lines.
  const waterGap = alloc.commonWater;
  const elecGap = alloc.commonElec;
  const waterDiff = round2(alloc.commonPropertyWaterKl - waterGap);
  const elecDiff = round2(alloc.commonPropertyElectricityKwh - elecGap);
  const verdict = (diff, unit, provision, actual) =>
    Math.abs(diff) < 0.005
      ? `spot on (provision ${provision}${unit}, actual ${actual.toFixed(2)}${unit})`
      : diff > 0
        ? `provision is ${diff}${unit} HIGHER than the actual common-area usage of ${actual.toFixed(2)}${unit} — over-provisioned`
        : `provision is ${Math.abs(diff)}${unit} LOWER than the actual common-area usage of ${actual.toFixed(2)}${unit} — under-provisioned`;

  return (
    <Card style={{ marginBottom: 20 }}>
      <div style={{ fontWeight: 700, fontSize: 13.5, marginBottom: 4 }}>Utility bills — {periodLabel(period)}</div>
      {billMissing && (
        <div style={{
          background: "#FBF3E6", border: "1px solid #E4C9A0", borderRadius: 7,
          padding: "9px 12px", fontSize: 12.5, color: "#8A5A1D", marginBottom: 10, lineHeight: 1.6,
        }}>
          <b>No council bills captured for {periodLabel(period)}.</b> Bulk water and bulk
          electricity are showing as R0.00 / 0 rather than carrying last month's figures
          forward. Upload or enter the bills below to replace them.
        </div>
      )}
      <p style={{ fontSize: 12.5, color: "#64748B", marginBottom: 12 }}>
        Upload the council water and electricity bills; recognised figures fill the fields below for checking before anything is saved. These figures drive the bill-driven levy lines (Water Demand Levy, Sewerage, Electricity Service &amp; Network Charges) and the provision check.
      </p>
      <input ref={waterInputRef} type="file" accept="application/pdf" style={{ display: "none" }}
        onChange={(e) => { const f = e.target.files[0]; if (f) handleUpload(f, "water"); e.target.value = ""; }} />
      <input ref={elecInputRef} type="file" accept="application/pdf" style={{ display: "none" }}
        onChange={(e) => { const f = e.target.files[0]; if (f) handleUpload(f, "electricity"); e.target.value = ""; }} />
      <div style={{ display: "flex", gap: 10, marginBottom: 14, flexWrap: "wrap", alignItems: "center" }}>
        <button style={primaryBtn} onClick={() => waterInputRef.current && waterInputRef.current.click()} disabled={status === "parsing"}>
          {status === "parsing" ? "Reading…" : "Upload water bill PDF"}
        </button>
        <button style={primaryBtn} onClick={() => elecInputRef.current && elecInputRef.current.click()} disabled={status === "parsing"}>
          {status === "parsing" ? "Reading…" : "Upload electricity bill PDF"}
        </button>
        {note && (
          <span style={{ fontSize: 12, fontWeight: 600, color: status === "error" ? "#B5651D" : "#2F5D50" }}>{note}</span>
        )}
      </div>
      <div style={{ display: "flex", gap: 18, flexWrap: "wrap", marginBottom: 14 }}>
        {field("Bulk water (kL)", "bulkWaterKl")}
        {field("Bulk water (R excl)", "bulkWaterRand")}
        {field("Water Demand Levy", "waterDemandLevyPerUnit", "per unit, excl VAT")}
        {field("Sewer charge", "sewerChargePerUnit", "per unit, excl VAT")}
        {field("Bulk electricity (kWh)", "bulkElecKwh")}
        {field("Bulk electricity (R excl)", "bulkElecRand")}
        {field("Elec Service Charge", "elecServiceFee", "complex total, excl VAT")}
        {field("Elec Network Charge", "elecNetworkFee", "complex total, excl VAT")}
      </div>
      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <button style={primaryBtn} onClick={save} disabled={status === "saving" || status === "parsing"}>
          {status === "saving" ? "Saving…" : "Save bill figures"}
        </button>
      </div>
      <div style={{ marginTop: 14, borderTop: "1px dashed #D8D0BE", paddingTop: 12, fontSize: 12.5, color: "#64748B", lineHeight: 1.7 }}>
        <b>Common property provision check</b> (bulk minus the sum of unit meters):
        {billMissing ? (
          <><br />Waiting on this month's council bills — the check needs real bulk figures.</>
        ) : (
          <>
            <br />Water — {verdict(waterDiff, "kL", alloc.commonPropertyWaterKl, waterGap)}
            <br />Electricity — {verdict(elecDiff, "kWh", alloc.commonPropertyElectricityKwh, elecGap)}
          </>
        )}
      </div>
    </Card>
  );
}

// ---------- Allocation ----------
// Council-invoice summary only. The per-unit allocation table and the billing
// narrative that used to sit under it were removed (6 Aug 2026) - the per-unit
// figures live on the Levy breakdown and statement pages, and the "Confirm
// allocation & generate statements" action moved to the Meter readings page.
function Allocation({ alloc, billMissing = false }) {
  const ci = alloc.councilInvoice;
  return (
    <>
      <h1 className="f-display" style={{ fontSize: 24, marginBottom: 14 }}>Council invoice allocation</h1>

      {billMissing && (
        <Card style={{ marginBottom: 14, background: "#FBF3E6", border: "1px solid #E4C9A0" }}>
          <div style={{ fontSize: 12.5, color: "#8A5A1D", lineHeight: 1.6 }}>
            No council bills have been captured for this month yet, so bulk water and bulk
            electricity default to R0.00. Capture them under <b>Utility bills</b> above.
          </div>
        </Card>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(2,1fr)", gap: 14 }}>
        <Card>
          <div style={{ fontSize: 11, color: "#64748B", textTransform: "uppercase", marginBottom: 6 }}>Bulk water (council invoice)</div>
          <div className="f-mono" style={{ fontSize: 17, fontWeight: 600 }}>{rand(ci.bulkWaterRand)}</div>
          <div style={{ fontSize: 12, color: "#94A0AC", marginTop: 4 }}>{ci.bulkWaterKl} kL · metered sum {alloc.totalW.toFixed(2)} kL{billMissing ? "" : ` · common ${alloc.commonWater.toFixed(2)} kL`}</div>
          {!billMissing && (
            <div style={{ fontSize: 11.5, marginTop: 6, color: "#64748B" }}>
              Actual metered common-area gap valued at {rand(alloc.commonWaterCostTotal)}, vs. the suggested "Common Property Water" figure from the configurable {alloc.commonPropertyWaterKl}kL standard: {rand(alloc.commonPropertyWaterCost)} total ({rand(alloc.commonPropertyWaterPerUnit)}/unit) — a reference for the manual levy grid, not billed automatically.
            </div>
          )}
        </Card>
        <Card>
          <div style={{ fontSize: 11, color: "#64748B", textTransform: "uppercase", marginBottom: 6 }}>Bulk electricity (council invoice)</div>
          <div className="f-mono" style={{ fontSize: 17, fontWeight: 600 }}>{rand(ci.bulkElecRand)}</div>
          <div style={{ fontSize: 12, color: "#94A0AC", marginTop: 4 }}>{ci.bulkElecKwh} kWh · metered sum {alloc.totalE.toFixed(2)} kWh{billMissing ? "" : ` · common ${alloc.commonElec.toFixed(2)} kWh`}</div>
          {!billMissing && (
            <div style={{ fontSize: 11.5, marginTop: 6, color: "#64748B" }}>
              Actual metered common-area gap valued at {rand(alloc.commonElecCostTotal)}, vs. the suggested "Common Property Electricity" figure from the configurable {alloc.commonPropertyElectricityKwh}kWh standard: {rand(alloc.commonPropertyElecCost)} total ({rand(alloc.commonPropertyElecPerUnit)}/unit) — a reference for the manual levy grid, not billed automatically.
            </div>
          )}
        </Card>
      </div>
    </>
  );
}

// ---------- Levy breakdown setup (set annually at the AGM) ----------
function LevySetup({ levyBreakdown, setLevyBreakdown, levyMeta = {}, onSaved, waterBands, electricityRate, vatRate, commonPropertyElectricityKwh, commonPropertyWaterKl, councilInvoice }) {
  // VAT-inclusive suggested values from the confirmed rules (bill figures +
  // rates). They pre-fill via the button below but every cell stays editable.
  const suggestions = computeSuggestedLevyItems({ waterBands, electricityRate, vatRate, commonPropertyElectricityKwh, commonPropertyWaterKl, councilInvoice });

  // Insurance is the one line that differs per unit, so it is loaded from that
  // unit's own row on the insurance schedule rather than from the flat
  // suggestions object: per annum (premium + common property + Sasria + broker)
  // over twelve, exactly as section 6 of the AGM report prints it. Captured on
  // the Insurance page. Like every other line it pre-fills and stays editable.
  const [insurancePerUnit, setInsurancePerUnit] = useState({});
  const insuranceFY = levyMeta.financialYear || FY_ACTIVE;
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const client = await ensureSupabaseClient();
        const { data, error } = await client
          .from("insurance_schedule").select("*").eq("financial_year", insuranceFY);
        if (error) throw error;
        if (!alive) return;
        const byDbId = Object.fromEntries((data || []).map((r) => [r.unit_id, r]));
        const map = {};
        UNITS.forEach((u) => {
          const r = u.dbId ? byDbId[u.dbId] : null;
          if (!r) return;
          const parts = [r.premium, r.common_property, r.sasria, r.broker_fee];
          if (parts.every((v) => v == null)) return;
          map[u.id] = round2(round2(parts.reduce((s, v) => s + (v || 0), 0)) / 12);
        });
        setInsurancePerUnit(map);
      } catch (err) {
        // A missing schedule is not an error worth blocking the grid over — the
        // Insurance line simply stays as whatever is already in the cell.
        console.error("Loading the insurance schedule for the levy grid failed:", err);
      }
    })();
    return () => { alive = false; };
  }, [insuranceFY]);

  const insuranceCaptured = Object.keys(insurancePerUnit).length > 0;

  // The insurance line is found by system_key, not by being called
  // "Insurance" — the trustee owns the label.
  const insuranceLabel = levyLabelForSystemKey("insurance");
  const fillCalculated = () => {
    setLevyBreakdown((prev) => {
      const next = {};
      UNITS.forEach((u) => {
        next[u.id] = { ...prev[u.id] };
        LEVY_ITEMS.forEach((item) => {
          if (item === insuranceLabel) {
            const v = insurancePerUnit[u.id];
            if (v != null) next[u.id][item] = round2(v);
            return;
          }
          const s = suggestions[item];
          // A line the trustee added has no rule behind it, so it is left
          // exactly as typed rather than being zeroed by a fill.
          if (s !== null && s !== undefined) next[u.id][item] = round2(s);
        });
      });
      return next;
    });
  };
  const effectiveValue = (unitId, item) => levyBreakdown[unitId]?.[item] ?? 0;

  const updateCell = (unitId, item, value) => {
    setLevyBreakdown((prev) => ({
      ...prev,
      [unitId]: { ...prev[unitId], [item]: parseFloat(value) || 0 },
    }));
  };
  const unitTotal = (unitId) => LEVY_ITEMS.reduce((s, item) => s + effectiveValue(unitId, item), 0);
  const itemTotal = (item) => UNITS.reduce((s, u) => s + effectiveValue(u.id, item), 0);
  const grandTotal = UNITS.reduce((s, u) => s + unitTotal(u.id), 0);
  const [saveStatus, setSaveStatus] = useState("idle"); // idle | saving | saved | error
  const save = async () => {
    setSaveStatus("saving");
    try {
      await saveLevyBreakdownToDb(levyBreakdown);
      setSaveStatus("saved");
      // Reload so the grid stops being flagged as carried-forward once the new
      // financial year's rows actually exist.
      if (onSaved) onSaved();
      setTimeout(() => setSaveStatus("idle"), 2500);
    } catch (err) {
      console.error("Saving levy breakdown failed:", err);
      setSaveStatus("error");
    }
  };

  // ---------- Adding and removing lines ----------
  // Both commit immediately, and both save the grid first. A definition change
  // triggers a full reload, which would otherwise throw away whatever cells
  // were typed but not yet saved — so the grid goes down with it, as one
  // action. `LEVY_ITEM_DEFS` is the loaded FY's full list including anything
  // already removed, which is what a re-add needs to find.
  const [newItemLabel, setNewItemLabel] = useState("");
  const [itemsBusy, setItemsBusy] = useState(false);
  const [itemsError, setItemsError] = useState(null);

  const commitItemDefs = async (defs) => {
    setItemsBusy(true); setItemsError(null);
    try {
      await saveLevyBreakdownToDb(levyBreakdown);
      await writeLevyItemDefsForActiveFY(defs);
      if (onSaved) onSaved();
    } catch (err) {
      console.error("Saving the levy line items failed:", err);
      setItemsError(err.message || "Couldn't save the line items — see browser console.");
    } finally {
      setItemsBusy(false);
    }
  };

  const addItem = async () => {
    const label = newItemLabel.trim();
    if (!label) return;
    const existing = LEVY_ITEM_DEFS.find((d) => d.label.toLowerCase() === label.toLowerCase());
    if (existing && existing.active) {
      setItemsError(`"${existing.label}" is already on the grid.`);
      return;
    }
    // Re-adding a removed line restores it with its figures rather than
    // creating a second line with the same name — the unique constraint on
    // (financial_year, label) would reject that anyway, and the trustee
    // removing something by mistake should get it back whole.
    const defs = existing
      ? LEVY_ITEM_DEFS.map((d) => (d.label === existing.label ? { ...d, active: true } : d))
      : [...LEVY_ITEM_DEFS, {
          label,
          systemKey: null,
          sortOrder: Math.max(0, ...LEVY_ITEM_DEFS.map((d) => d.sortOrder || 0)) + 1,
          active: true,
        }];
    setNewItemLabel("");
    await commitItemDefs(defs);
  };

  const removeItem = async (label) => {
    const billed = UNITS.reduce((s, u) => s + effectiveValue(u.id, label), 0);
    const warning = billed > 0
      ? `\n\nUnits are currently billed ${rand(billed)} a month in total on this line. That stops from FY ${levyMeta.financialYear}.`
      : "";
    if (!window.confirm(
      `Remove "${label}" from the levy grid?${warning}\n\n`
      + `The figures already captured against it are kept — FY ${levyMeta.financialYear}'s AGM pack still reports them, and earlier years are untouched. `
      + `Re-adding the line brings them back.`
    )) return;
    await commitItemDefs(LEVY_ITEM_DEFS.map((d) => (d.label === label ? { ...d, active: false } : d)));
  };

  const removedItems = LEVY_ITEM_DEFS.filter((d) => !d.active);

  return (
    <>
      <h1 className="f-display" style={{ fontSize: 24, marginBottom: 4 }}>
        Levy breakdown — {levyMeta.financialYear ? `FY ${levyMeta.financialYear}` : "set annually at the AGM"}
      </h1>
      <p style={{ color: "#64748B", fontSize: 13.5, marginBottom: 14 }}>
        Each unit's monthly levy is the sum of these line items. Every cell is editable and defaults to 0.00 — enter the figures agreed at the AGM once a year; they carry forward every month until changed again. Statements bill exactly what's in this grid. The lines themselves can be added and removed here too, and the list is kept per financial year, so a change applies from FY {levyMeta.financialYear} on and never rewrites a year already billed.
      </p>

      {levyMeta.carriedForward && (
        <Card style={{ marginBottom: 16, background: "#FBF3E9", border: "1px solid #E3C9A8" }}>
          <div style={{ fontSize: 12.5, color: "#8A5A1E", lineHeight: 1.7 }}>
            <b>FY {levyMeta.financialYear} hasn't been set up yet.</b> This grid is showing FY {levyMeta.carriedFromFY}'s
            figures as a starting point — nothing has been saved against FY {levyMeta.financialYear} yet, and FY {levyMeta.carriedFromFY}
            {" "}stays untouched. Apply this year's increases, then save.
          </div>
        </Card>
      )}

      <Card style={{ marginBottom: 16, background: "#F4F1E9" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
          <div style={{ fontSize: 12, color: "#64748B", lineHeight: 1.7, flex: 1, minWidth: 320 }}>
            <b>Calculated per-unit values (VAT incl.)</b> from the utility bills and Tariffs &amp; rates:{" "}
            <span className="f-mono">
              {/* `!= null` catches both: a line with no rule at all reads
                  undefined here and used to print as "undefined". */}
              {LEVY_ITEMS.filter((i) => suggestions[i] != null).map((i) => `${i} ${rand(suggestions[i])}`).join(" · ")}
            </span>
            <br />
            {/* Nothing to say about the insurance line if the trustee has
                removed it from this year's grid. */}
            {insuranceLabel && (insuranceCaptured ? (
              <>
                <b>{insuranceLabel}</b> is per unit, from the FY {insuranceFY} insurance schedule (per annum ÷ 12):{" "}
                <span className="f-mono">
                  {UNITS.map((u) => `${u.id} ${insurancePerUnit[u.id] == null ? "—" : rand(insurancePerUnit[u.id])}`).join(" · ")}
                </span>
              </>
            ) : (
              <><b>{insuranceLabel}</b> has no schedule captured for FY {insuranceFY} — upload the broker's schedule on the Insurance page and it fills here.</>
            ))}
          </div>
          <button style={secondaryBtn} onClick={fillCalculated}>Fill grid with calculated values</button>
        </div>
      </Card>

      <Card>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", fontSize: 12, borderCollapse: "collapse", minWidth: 820 }}>
            <thead>
              <tr style={{ color: "#64748B", textAlign: "right", fontSize: 10, textTransform: "uppercase" }}>
                <th style={{ padding: "6px 6px", textAlign: "left", minWidth: 190 }}>Levy item</th>
                {UNITS.map((u) => (
                  <th key={u.id} style={{ padding: "6px 6px" }}>{u.id}</th>
                ))}
                <th style={{ padding: "6px 6px", color: "#1B2A38" }}>Item total</th>
                <th style={{ padding: "6px 6px", width: 28 }} aria-label="Remove line" />
              </tr>
            </thead>
            <tbody>
              {LEVY_ITEMS.map((item) => (
                <tr key={item} style={{ borderTop: "1px solid #EEE7D6" }}>
                  <td style={{ padding: "6px 6px", textAlign: "left" }}>{item}</td>
                  {UNITS.map((u) => (
                    <td key={u.id} style={{ padding: "3px" }}>
                      <input
                        type="number" step="0.01"
                        value={effectiveValue(u.id, item)}
                        onChange={(e) => updateCell(u.id, item, e.target.value)}
                        style={{ ...inputStyle, width: 78 }}
                      />
                    </td>
                  ))}
                  <td className="f-mono" style={{ padding: "6px 6px", textAlign: "right", color: "#64748B" }}>{rand(itemTotal(item))}</td>
                  <td style={{ padding: "3px", textAlign: "center" }}>
                    <button
                      type="button"
                      onClick={() => removeItem(item)}
                      disabled={itemsBusy || LEVY_ITEMS.length <= 1}
                      title={LEVY_ITEMS.length <= 1 ? "A levy has to have at least one line" : `Remove ${item}`}
                      aria-label={`Remove ${item}`}
                      style={{
                        border: "1px solid #E3D9C6", background: "#FFF", color: "#B5651D",
                        borderRadius: 6, width: 24, height: 24, lineHeight: "20px", fontSize: 14,
                        cursor: itemsBusy || LEVY_ITEMS.length <= 1 ? "not-allowed" : "pointer",
                        opacity: itemsBusy || LEVY_ITEMS.length <= 1 ? 0.4 : 1, padding: 0,
                      }}
                    >×</button>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr style={{ borderTop: "2px solid #1B2A38" }}>
                <td style={{ padding: "8px 6px", fontWeight: 700 }}>Total monthly levy</td>
                {UNITS.map((u) => (
                  <td key={u.id} className="f-mono" style={{ padding: "8px 6px", textAlign: "right", fontWeight: 700 }}>
                    {rand(unitTotal(u.id))}
                  </td>
                ))}
                <td className="f-mono" style={{ padding: "8px 6px", textAlign: "right", fontWeight: 700, color: "#2F5D50" }}>{rand(grandTotal)}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>

        {/* Adding a line. Deliberately below the table rather than as a ghost
            row inside it — a row in the grid reads as something already being
            billed. */}
        <div style={{ marginTop: 14, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <input
            type="text"
            value={newItemLabel}
            onChange={(e) => { setNewItemLabel(e.target.value); if (itemsError) setItemsError(null); }}
            onKeyDown={(e) => { if (e.key === "Enter") addItem(); }}
            placeholder="New levy line — e.g. Special Levy"
            style={{ ...inputStyle, width: 260, textAlign: "left", fontFamily: "inherit" }}
          />
          <button style={secondaryBtn} onClick={addItem} disabled={itemsBusy || !newItemLabel.trim()}>
            {itemsBusy ? "Saving…" : "Add line item"}
          </button>
          <span style={{ fontSize: 11.5, color: "#94A0AC", lineHeight: 1.6, flex: 1, minWidth: 260 }}>
            Adding or removing a line saves the grid at the same time, and applies to
            FY {levyMeta.financialYear} onwards — earlier years keep the lines they were billed on
            and reprint unchanged.
          </span>
        </div>
        {itemsError && (
          <div style={{ marginTop: 8, fontSize: 12.5, color: "#B5651D", fontWeight: 600 }}>{itemsError}</div>
        )}

        {removedItems.length > 0 && (
          <div style={{ marginTop: 12, padding: "9px 12px", borderRadius: 7, background: "#F4F1E9", border: "1px solid #E3D9C6", color: "#64748B", fontSize: 11.5, lineHeight: 1.7 }}>
            <b>Removed from FY {levyMeta.financialYear}:</b>{" "}
            {removedItems.map((d) => d.label).join(", ")}. Not billed and not on statements.
            The figures captured against {removedItems.length > 1 ? "them" : "it"} are kept and still
            appear in the AGM pack for this year — type the name above to put {removedItems.length > 1 ? "one" : "it"} back.
          </div>
        )}
        <div style={{ marginTop: 16, display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 10 }}>
          {saveStatus === "saved" && <span style={{ fontSize: 12.5, color: "#2F5D50", fontWeight: 600 }}>✓ Saved to database</span>}
          {saveStatus === "error" && <span style={{ fontSize: 12.5, color: "#B5651D", fontWeight: 600 }}>Couldn't save — see browser console</span>}
          <button style={primaryBtn} onClick={save} disabled={saveStatus === "saving"}>
            {saveStatus === "saving" ? "Saving…" : "Save levy breakdown for 2026 AGM year"}
          </button>
        </div>
      </Card>
    </>
  );
}

// ---------- Additional (ad-hoc) charges per statement ----------
function AdditionalCharges({ additionalCharges, setAdditionalCharges }) {
  const categoryNames = useExpenseCategoryNames();
  const [unit, setUnit] = useState("U1");
  const [desc, setDesc] = useState("");
  const [amount, setAmount] = useState("");
  // Optional: a charge recovering a cost the Body Corp incurred (a locksmith
  // call-out it paid for) can be tagged so the recovery shows against the same
  // category as the spend on the analytics dashboard.
  const [expenseCategory, setExpenseCategory] = useState("");

  const [dbError, setDbError] = useState(null);

  const addCharge = async () => {
    if (!desc.trim() || !amount) return;
    const unitRow = UNITS.find((u) => u.id === unit);
    const amt = parseFloat(amount) || 0;
    const description = desc.trim();
    setDbError(null);
    try {
      if (!unitRow || !unitRow.dbId) throw new Error("Units haven't loaded from the database yet");
      const client = await ensureSupabaseClient();
      const { data, error } = await client
        .from("additional_charges")
        .insert({ unit_id: unitRow.dbId, period: ACTIVE_PERIOD, description, amount: amt, expense_category: expenseCategory || null })
        .select("id")
        .single();
      if (error) throw error;
      setAdditionalCharges((prev) => ({
        ...prev,
        [unit]: [...(prev[unit] || []), { id: data.id, description, amount: amt, expenseCategory }],
      }));
      setDesc(""); setAmount(""); setExpenseCategory("");
    } catch (err) {
      console.error("Saving additional charge failed:", err);
      setDbError("Couldn't save the charge — see browser console.");
    }
  };
  const retagCharge = async (unitId, chargeId, next) => {
    setDbError(null);
    setAdditionalCharges((prev) => ({
      ...prev,
      [unitId]: (prev[unitId] || []).map((c) => (c.id === chargeId ? { ...c, expenseCategory: next } : c)),
    }));
    try {
      const client = await ensureSupabaseClient();
      const { error } = await client.from("additional_charges").update({ expense_category: next || null }).eq("id", chargeId);
      if (error) throw error;
    } catch (err) {
      console.error("Retagging additional charge failed:", err);
      setDbError("Couldn't change the category — see browser console.");
    }
  };
  const removeCharge = async (unitId, chargeId) => {
    setDbError(null);
    try {
      const client = await ensureSupabaseClient();
      const { error } = await client.from("additional_charges").delete().eq("id", chargeId);
      if (error) throw error;
      setAdditionalCharges((prev) => ({
        ...prev,
        [unitId]: prev[unitId].filter((c) => c.id !== chargeId),
      }));
    } catch (err) {
      console.error("Removing additional charge failed:", err);
      setDbError("Couldn't remove the charge — see browser console.");
    }
  };

  return (
    <>
      <h1 className="f-display" style={{ fontSize: 24, marginBottom: 4 }}>Additional charges</h1>
      <p style={{ color: "#64748B", fontSize: 13.5, marginBottom: 18 }}>
        One-off charges for a specific unit in a specific month — a call-out fee, damage recovery, and so on. These appear on that unit's statement only, on top of the usual levy and utility charges.
      </p>

      <Card>
        <div style={{ fontWeight: 700, fontSize: 13.5, marginBottom: 10 }}>Add a charge</div>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <select value={unit} onChange={(e) => setUnit(e.target.value)} style={{ padding: "8px 10px", borderRadius: 6, border: "1px solid #D8D0BE" }}>
            {UNITS.map((u) => <option key={u.id} value={u.id}>{u.id} — {u.owner}</option>)}
          </select>
          <input
            placeholder="Description (e.g. Locksmith call-out)"
            value={desc} onChange={(e) => setDesc(e.target.value)}
            style={{ ...inputStyle, width: 260, textAlign: "left" }}
          />
          <input
            placeholder="Amount (R)" type="number" step="0.01"
            value={amount} onChange={(e) => setAmount(e.target.value)}
            style={{ ...inputStyle, width: 140, textAlign: "left" }}
          />
          <ExpenseCategorySelect
            value={expenseCategory} onChange={setExpenseCategory} names={categoryNames}
            placeholder="Cost recovery for… (optional)"
            style={{ padding: "8px 10px", fontSize: 13 }}
          />
          <button style={primaryBtn} onClick={addCharge}>Add to statement</button>
        </div>
        {dbError && <div style={{ marginTop: 10, fontSize: 12.5, color: "#B5651D", fontWeight: 600 }}>{dbError}</div>}
      </Card>

      <Card style={{ marginTop: 16 }}>
        <div style={{ fontWeight: 700, fontSize: 13.5, marginBottom: 10 }}>Current month's additional charges</div>
        {UNITS.every((u) => (additionalCharges[u.id] || []).length === 0) ? (
          <p style={{ fontSize: 13, color: "#94A0AC" }}>No additional charges added for this statement run.</p>
        ) : (
          UNITS.map((u) => {
            const charges = additionalCharges[u.id] || [];
            if (charges.length === 0) return null;
            return (
              <div key={u.id} style={{ marginBottom: 14 }}>
                <div className="f-mono" style={{ fontWeight: 700, fontSize: 13, marginBottom: 6 }}>{u.id} — {u.owner}</div>
                {charges.map((c) => (
                  <div key={c.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 13, padding: "6px 0", borderTop: "1px solid #EEE7D6" }}>
                    <span>{c.description}</span>
                    <span style={{ display: "flex", alignItems: "center", gap: 12 }}>
                      <ExpenseCategorySelect
                        value={c.expenseCategory}
                        onChange={(v) => retagCharge(u.id, c.id, v)}
                        names={categoryNames}
                        placeholder="No cost recovery"
                      />
                      <span className="f-mono">{rand(c.amount)}</span>
                      <button
                        onClick={() => removeCharge(u.id, c.id)}
                        style={{ background: "none", border: "none", color: "#B5651D", fontSize: 12, fontWeight: 600, cursor: "pointer", textDecoration: "underline" }}
                      >
                        Remove
                      </button>
                    </span>
                  </div>
                ))}
              </div>
            );
          })
        )}
      </Card>
    </>
  );
}

// ---------- Body Corp operating expenses (never billed to units) ----------
function OpsExpenses({ opsExpenses, setOpsExpenses, period = CURRENT_PERIOD }) {
  // Filter expenses to the selected period's year-month.
  const periodYM = String(period).slice(0, 7); // "2026-07"
  const monthExpenses = opsExpenses.filter((e) => String(e.date).startsWith(periodYM));

  // Default the date picker to today (clamped to the selected month for convenience).
  const todayStr = new Date().toISOString().slice(0, 10);
  const defaultDate = todayStr.startsWith(periodYM) ? todayStr : `${periodYM}-01`;
  const categoryNames = useExpenseCategoryNames();
  const [date, setDate] = useState(defaultDate);
  const [category, setCategory] = useState("");
  const [amount, setAmount] = useState("");
  const [notes, setNotes] = useState("");

  // Reset the date default when the period changes.
  useEffect(() => {
    const t = new Date().toISOString().slice(0, 10);
    setDate(t.startsWith(periodYM) ? t : `${periodYM}-01`);
  }, [periodYM]);

  const [dbError, setDbError] = useState(null);

  const addExpense = async () => {
    if (!date || !amount) return;
    if (!category) { setDbError("Pick an expense category first."); return; }
    const amt = parseFloat(amount) || 0;
    setDbError(null);
    try {
      const client = await ensureSupabaseClient();
      const { data, error } = await client
        .from("ops_expenses")
        .insert({ expense_date: date, category, amount: amt, notes })
        .select("id")
        .single();
      if (error) throw error;
      setOpsExpenses((prev) => [...prev, { id: data.id, date, category, amount: amt, notes, supersededReason: null }]);
      setAmount(""); setNotes("");
    } catch (err) {
      console.error("Saving expense failed:", err);
      setDbError("Couldn't save the expense — see browser console.");
    }
  };
  const removeExpense = async (id) => {
    setDbError(null);
    try {
      const client = await ensureSupabaseClient();
      const { error } = await client.from("ops_expenses").delete().eq("id", id);
      if (error) throw error;
      setOpsExpenses((prev) => prev.filter((e) => e.id !== id));
    } catch (err) {
      console.error("Removing expense failed:", err);
      setDbError("Couldn't remove the expense — see browser console.");
    }
  };
  // Retag an existing row — the trustee often only knows the right category
  // after the fact, and the analytics dashboard reads straight off this field.
  const retagExpense = async (id, nextCategory) => {
    setDbError(null);
    const prevRows = opsExpenses;
    setOpsExpenses((prev) => prev.map((e) => (e.id === id ? { ...e, category: nextCategory } : e)));
    try {
      const client = await ensureSupabaseClient();
      const { error } = await client.from("ops_expenses").update({ category: nextCategory }).eq("id", id);
      if (error) throw error;
    } catch (err) {
      console.error("Retagging expense failed:", err);
      setOpsExpenses(prevRows);
      setDbError("Couldn't change the category — see browser console.");
    }
  };

  // Superseded rows duplicate a bank line or an approved resident deduction.
  // They're kept for audit but must never be added into a total.
  const countedExpenses = monthExpenses.filter((e) => !e.supersededReason);
  const total = countedExpenses.reduce((s, e) => s + e.amount, 0);
  const allTimeTotal = opsExpenses.filter((e) => !e.supersededReason).reduce((s, e) => s + e.amount, 0);
  const byCategory = Array.from(new Set(countedExpenses.map((e) => e.category))).map((cat) => ({
    cat, total: countedExpenses.filter((e) => e.category === cat).reduce((s, e) => s + e.amount, 0),
  })).filter((c) => c.total > 0).sort((a, b) => b.total - a.total);
  const supersededCount = monthExpenses.length - countedExpenses.length;

  return (
    <>
      <h1 className="f-display" style={{ fontSize: 24, marginBottom: 4 }}>Body corp operating expenses</h1>
      <p style={{ color: "#64748B", fontSize: 13.5, marginBottom: 18 }}>
        Costs the Body Corp pays directly. Never billed to a unit; tracked here for the analytics dashboard and the September annual report.
        <br />
        <strong>Log only expenses that never went through the bank account</strong> — anything on a bank statement is captured on the Bank recon page and tagged on the Tenant recon page, and anything a resident paid personally is captured on their deduction claim. Rows that duplicate either are greyed out below and excluded from every total.
      </p>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 14, marginBottom: 18 }}>
        <Stat label={`Total — ${periodLabel(period)}`} value={rand(total)} accent="#B5651D" />
        {byCategory.slice(0, 2).map((c) => (
          <Stat key={c.cat} label={c.cat} value={rand(c.total)} />
        ))}
      </div>
      {allTimeTotal !== total && (
        <div style={{ fontSize: 12, color: "#94A0AC", marginBottom: 14, marginTop: -8 }}>
          All-time total across all months: {rand(allTimeTotal)}
        </div>
      )}

      <Card>
        <div style={{ fontWeight: 700, fontSize: 13.5, marginBottom: 10 }}>Log an expense</div>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={{ ...inputStyle, width: 150, textAlign: "left" }} />
          <ExpenseCategorySelect
            value={category} onChange={setCategory} names={categoryNames}
            placeholder="Choose a category…"
            style={{ padding: "8px 10px", fontSize: 13 }}
          />
          <input placeholder="Amount (R)" type="number" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} style={{ ...inputStyle, width: 130, textAlign: "left" }} />
          <input placeholder="Notes (e.g. who paid, proof on file)" value={notes} onChange={(e) => setNotes(e.target.value)} style={{ ...inputStyle, width: 260, textAlign: "left" }} />
          <button style={primaryBtn} onClick={addExpense}>Add expense</button>
        </div>
        {dbError && <div style={{ marginTop: 10, fontSize: 12.5, color: "#B5651D", fontWeight: 600 }}>{dbError}</div>}
      </Card>

      <Card style={{ marginTop: 16 }}>
        <div style={{ fontWeight: 700, fontSize: 13.5, marginBottom: 10 }}>
          Expense log — {periodLabel(period)}
          {supersededCount > 0 && (
            <span style={{ fontWeight: 400, fontSize: 12, color: "#B5651D", marginLeft: 10 }}>
              ({supersededCount} excluded as duplicates — already counted elsewhere)
            </span>
          )}
          {monthExpenses.length === 0 && opsExpenses.length > 0 && (
            <span style={{ fontWeight: 400, fontSize: 12, color: "#94A0AC", marginLeft: 10 }}>
              (no expenses logged this month — {opsExpenses.length} in other months)
            </span>
          )}
        </div>
        <table style={{ width: "100%", fontSize: 13, borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ color: "#64748B", textAlign: "left", fontSize: 11, textTransform: "uppercase" }}>
              <th style={{ padding: "6px 8px" }}>Date</th>
              <th style={{ padding: "6px 8px" }}>Category</th>
              <th style={{ padding: "6px 8px" }}>Notes</th>
              <th style={{ padding: "6px 8px", textAlign: "right" }}>Amount</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {monthExpenses.length === 0 ? (
              <tr><td colSpan={5} style={{ padding: 16, textAlign: "center", color: "#94A0AC", fontSize: 13 }}>No expenses for {periodLabel(period)}</td></tr>
            ) : monthExpenses.map((e) => (
              <tr key={e.id} style={{ borderTop: "1px solid #EEE7D6", opacity: e.supersededReason ? 0.55 : 1 }}>
                <td className="f-mono" style={{ padding: "8px" }}>{e.date}</td>
                <td style={{ padding: "8px" }}>
                  <ExpenseCategorySelect
                    value={e.category}
                    onChange={(v) => retagExpense(e.id, v)}
                    names={categoryNames}
                    disabled={!!e.supersededReason}
                  />
                </td>
                <td style={{ padding: "8px", color: "#64748B" }}>
                  {e.notes}
                  {e.supersededReason && (
                    <div style={{ color: "#B5651D", fontSize: 11, fontWeight: 600, marginTop: 2 }}>
                      Excluded — {e.supersededReason.toLowerCase()}
                    </div>
                  )}
                </td>
                <td className="f-mono" style={{ padding: "8px", textAlign: "right", textDecoration: e.supersededReason ? "line-through" : "none" }}>{rand(e.amount)}</td>
                <td style={{ padding: "8px", textAlign: "right" }}>
                  <button onClick={() => removeExpense(e.id)} style={{ background: "none", border: "none", color: "#B5651D", fontSize: 12, cursor: "pointer", textDecoration: "underline" }}>Remove</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </>
  );
}

// ---------- Rate settings (trustee-editable tariffs) ----------
// Save control for one section of Tariffs & rates. Each card owns its own, so
// it is always unambiguous which figures a given button writes.
function SectionSave({ state = "idle", dirty, onSave, label = "Save" }) {
  return (
    <div style={{ marginTop: 14, display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 10, flexWrap: "wrap" }}>
      {dirty && state === "idle" && <span style={{ fontSize: 12.5, color: "#B5651D", fontWeight: 600 }}>Unsaved changes</span>}
      {state === "saved" && <span style={{ fontSize: 12.5, color: "#2F5D50", fontWeight: 600 }}>✓ Saved</span>}
      {state === "error" && <span style={{ fontSize: 12.5, color: "#B5651D", fontWeight: 600 }}>Couldn’t save — see browser console</span>}
      <button style={primaryBtn} onClick={onSave} disabled={state === "saving"}>
        {state === "saving" ? "Saving…" : label}
      </button>
    </div>
  );
}

function RateSettings({
  waterBands, waterBandHistory, onSaved,
  electricityRate, setElectricityRate,
  electricityEffectiveFrom, setElectricityEffectiveFrom,
  vatRate, setVatRate,
  commonPropertyElectricityKwh, setCommonPropertyElectricityKwh,
  commonPropertyWaterKl, setCommonPropertyWaterKl,
  standardsMeta = {},
}) {
  // The water card is a self-contained editor. It deliberately does NOT write
  // into the app-wide `waterBands` state, because that is what the month
  // currently on screen bills on — editing a future rate set here must not
  // silently re-price the statements behind it. Saving writes to the database
  // and then asks App to reload, which is what makes the change take effect.
  //
  // The three columns are anchored on TODAY, not on the statement month being
  // viewed, so this page is a stable "where the rates stand now" view:
  //   Previous = the set in force before the current one
  //   Current  = the newest set with an effective date on or before today
  //   Next     = the first set dated after today (blank until one is added)
  // Anything beyond "Next" is shown too, labelled by its own date.
  const historyDates = useMemo(() => Object.keys(waterBandHistory || {}).sort(), [waterBandHistory]);

  // Rate sets created via "Add new rates" but not yet saved.
  const [addedDates, setAddedDates] = useState([]);
  // Pending, unsaved edits: { [effectiveFrom]: { [bandLabel]: rate } }
  const [edits, setEdits] = useState({});
  const [adding, setAdding] = useState(false);
  const [newDate, setNewDate] = useState("");
  const [addError, setAddError] = useState(null);

  const allDates = useMemo(
    () => [...new Set([...historyDates, ...addedDates])].sort(),
    [historyDates, addedDates]
  );

  // Band geometry (labels and kL boundaries) comes from the newest saved set —
  // the bands themselves haven't changed in years; only the rates move.
  const bandDefs = useMemo(() => {
    const newest = historyDates.length ? waterBandHistory[historyDates[historyDates.length - 1]] : null;
    const defs = newest
      ? Object.entries(newest).map(([label, b]) => ({ label, from: b.from, to: b.to }))
      : waterBands.map((b) => ({ label: b.label, from: b.from, to: b.to }));
    return defs.sort((a, b) => a.from - b.from);
  }, [historyDates, waterBandHistory, waterBands]);

  const savedRate = (date, label) => {
    const set = (waterBandHistory || {})[date];
    return set && set[label] ? set[label].rate : null;
  };
  // A pending edit wins; then the saved figure; then — for a set that has just
  // been added and never saved — the rates carried forward from the set before it.
  const rateFor = (date, label) => {
    if (edits[date] && edits[date][label] !== undefined) return edits[date][label];
    const saved = savedRate(date, label);
    if (saved !== null) return saved;
    const base = [...allDates].filter((d) => d < date).reverse().find((d) => savedRate(d, label) !== null);
    return base ? savedRate(base, label) : 0;
  };
  const setRate = (date, label, value) => {
    setEdits((prev) => ({ ...prev, [date]: { ...prev[date], [label]: value } }));
  };

  // Rates are edited as text, not <input type="number">. The number input
  // renders its value through the browser locale, which on en-ZA showed
  // "33,57" next to the read-only column's "33.57" and dropped trailing zeros
  // ("100,4"). Holding the in-progress keystrokes in `editing` lets the field
  // show exactly what was typed while focused, and snap to the shared
  // two-decimal, full-stop format the moment it loses focus.
  const [editing, setEditing] = useState(null); // { date, label, text } | null
  const fmtRate = (v) => (v === null || v === undefined || Number.isNaN(v) ? "—" : v.toFixed(2));
  const rateInputValue = (date, label) =>
    editing && editing.date === date && editing.label === label
      ? editing.text
      : fmtRate(rateFor(date, label));
  const onRateChange = (date, label, text) => {
    setEditing({ date, label, text });
    const n = parseFloat(text.replace(",", "."));
    if (!Number.isNaN(n)) setRate(date, label, n);
  };

  const currentDate = [...allDates].filter((d) => d <= TODAY_ISO).pop() || null;
  const previousDate = currentDate ? [...allDates].filter((d) => d < currentDate).pop() || null : null;
  const futureDates = allDates.filter((d) => d > TODAY_ISO);
  const columns = [
    previousDate && { date: previousDate, heading: "Previous", editable: false },
    currentDate && { date: currentDate, heading: "Current", editable: true },
    ...futureDates.map((d, i) => ({ date: d, heading: i === 0 ? "Next" : "Later", editable: true })),
  ].filter(Boolean);
  const hasNext = futureDates.length > 0;
  const isUnsaved = (d) => addedDates.includes(d) || Boolean(edits[d]);
  const dirty = allDates.some(isUnsaved);

  const addRateSet = () => {
    setAddError(null);
    if (!newDate) return setAddError("Pick an effective date");
    if (allDates.includes(newDate)) return setAddError("A rate set already starts on that date");
    if (newDate <= TODAY_ISO) return setAddError("New rates must start on a future date");
    setAddedDates((prev) => [...prev, newDate]);
    setAdding(false);
    setNewDate("");
  };

  // The common-property preview below prices 20kL on the set in force today,
  // in the shape calcWaterCost expects.
  const currentBandsForCalc = bandDefs.map((b) => ({
    ...b, rate2025: currentDate ? rateFor(currentDate, b.label) : 0,
  }));

  // Each section saves on its own, so each carries its own status rather than
  // one shared flag that would light up all four cards at once.
  const [status, setStatus] = useState({}); // section -> idle | saving | saved | error
  const setSectionStatus = (key, value) =>
    setStatus((prev) => ({ ...prev, [key]: value }));

  // Electricity, VAT and the common-property standards are edited as LOCAL
  // drafts and only pushed to the app once their own section saves.
  //
  // Two reasons. A save reloads app data so every screen picks up the new
  // figures, and with four independent buttons that reload would silently
  // revert whatever was typed into the other three. And an unsaved rate has no
  // business changing what the dashboard bills on — which is exactly why the
  // water card below has always kept its edits local.
  const [elecDraft, setElecDraft] = useState(electricityRate);
  const [elecDateDraft, setElecDateDraft] = useState(electricityEffectiveFrom || "");
  const [vatDraft, setVatDraft] = useState(vatRate);
  const [waterKlDraft, setWaterKlDraft] = useState(commonPropertyWaterKl);
  const [elecKwhDraft, setElecKwhDraft] = useState(commonPropertyElectricityKwh);

  // A draft follows the app whenever it is clean. Once it differs it is the
  // trustee's unsaved work and a reload must not overwrite it.
  const elecDirty = elecDraft !== electricityRate || (elecDateDraft || "") !== (electricityEffectiveFrom || "");
  const vatDirty = vatDraft !== vatRate;
  const standardsDirty = waterKlDraft !== commonPropertyWaterKl || elecKwhDraft !== commonPropertyElectricityKwh;
  useEffect(() => { if (!elecDirty) { setElecDraft(electricityRate); setElecDateDraft(electricityEffectiveFrom || ""); } },
    [electricityRate, electricityEffectiveFrom]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!vatDirty) setVatDraft(vatRate); }, [vatRate]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!standardsDirty) { setWaterKlDraft(commonPropertyWaterKl); setElecKwhDraft(commonPropertyElectricityKwh); }
  }, [commonPropertyWaterKl, commonPropertyElectricityKwh]); // eslint-disable-line react-hooks/exhaustive-deps

  // One save runner: set saving, write, apply to the app, reload, clear.
  const runSave = (key, write, apply) => async () => {
    setSectionStatus(key, "saving");
    try {
      await write();
      if (apply) apply();
      setSectionStatus(key, "saved");
      if (onSaved) onSaved(); // reload so every screen sees the new figures
      setTimeout(() => setSectionStatus(key, "idle"), 2500);
    } catch (err) {
      console.error(`Saving ${key} failed:`, err);
      setSectionStatus(key, "error");
    }
  };

  const saveWater = runSave("water", async () => {
    // Only push sets that were actually touched — never rewrite history.
    const waterSets = columns
      .filter((c) => c.editable && isUnsaved(c.date))
      .map((c) => ({
        effectiveFrom: c.date,
        bands: bandDefs.map((b) => ({ label: b.label, from: b.from, to: b.to, rate: rateFor(c.date, b.label) })),
      }));
    await saveWaterBandsToDb(waterSets);
  }, () => { setEdits({}); setAddedDates([]); });

  const saveElectricity = runSave("electricity",
    () => saveElectricityRateToDb({ electricityRate: elecDraft, electricityEffectiveFrom: elecDateDraft || null }),
    () => { setElectricityRate(elecDraft); setElectricityEffectiveFrom(elecDateDraft || null); });

  const saveVat = runSave("vat",
    () => saveVatRateToDb(vatDraft),
    () => setVatRate(vatDraft));

  const saveStandards = runSave("standards",
    () => saveCommonPropertyStandardsToDb({
      commonPropertyElectricityKwh: elecKwhDraft, commonPropertyWaterKl: waterKlDraft,
    }),
    () => { setCommonPropertyElectricityKwh(elecKwhDraft); setCommonPropertyWaterKl(waterKlDraft); });

  // Format a date string for display (e.g. "2025-07-01" → "1 Jul 2025")
  const fmtDate = (d) => {
    if (!d) return "—";
    const dt = new Date(d + "T00:00:00");
    return dt.toLocaleDateString("en-ZA", { day: "numeric", month: "short", year: "numeric" });
  };

  // Every cell in the water table shares this, so the rows with inputs are
  // exactly as tall as the read-only ones.
  const rateCellStyle = { padding: "6px", height: 46, verticalAlign: "middle", textAlign: "center" };

  return (
    <>
      <h1 className="f-display" style={{ fontSize: 24, marginBottom: 4 }}>Tariffs & rates</h1>
      <p style={{ color: "#64748B", fontSize: 13.5, marginBottom: 18 }}>
        Rates are tied to their effective date — changing rates here only affects periods on or after that date. Older statements keep the rates they were issued with.
      </p>

      <Card>
        <div style={{ fontWeight: 700, fontSize: 13.5, marginBottom: 4 }}>Water — increasing block tariff (R / kL)</div>
        <p style={{ fontSize: 12, color: "#94A0AC", marginBottom: 12 }}>
          Each unit is charged band-by-band on its own consumption. The previous and current sets are shown for comparison; when the municipality publishes an increase, use <b>Add new rates</b> and give it the date it takes effect.
        </p>

        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14, flexWrap: "wrap" }}>
          {!adding && (
            <button
              onClick={() => { setAdding(true); setAddError(null); }}
              style={{ background: "#2F5D50", color: "#F6F1E7", border: "none", borderRadius: 6, padding: "7px 14px", fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}
            >
              + Add new rates
            </button>
          )}
          {adding && (
            <>
              <span style={{ fontSize: 12, fontWeight: 600, color: "#64748B" }}>New rates effective from</span>
              <input
                type="date" value={newDate}
                onChange={(e) => { setNewDate(e.target.value); setAddError(null); }}
                style={{ ...inputStyle, width: 160, textAlign: "left", borderColor: "#2F5D50", fontWeight: 700 }}
              />
              <button
                onClick={addRateSet}
                style={{ background: "#2F5D50", color: "#F6F1E7", border: "none", borderRadius: 6, padding: "7px 14px", fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}
              >
                Add
              </button>
              <button
                onClick={() => { setAdding(false); setNewDate(""); setAddError(null); }}
                style={{ background: "none", border: "none", color: "#64748B", fontSize: 12.5, cursor: "pointer", textDecoration: "underline" }}
              >
                Cancel
              </button>
              {addError && <span style={{ fontSize: 11.5, color: "#B5651D", fontWeight: 600 }}>{addError}</span>}
            </>
          )}
          {!hasNext && !adding && (
            <span style={{ fontSize: 11.5, color: "#94A0AC" }}>No future rate set scheduled.</span>
          )}
        </div>

        <div style={{ overflowX: "auto" }}>
          {/* Fixed layout + an explicit colgroup keeps every column exactly the
              same width however many rate sets are on screen, and a fixed row
              height keeps the read-only cells the same height as the input rows. */}
          <table style={{ width: "100%", fontSize: 13, borderCollapse: "collapse", tableLayout: "fixed", minWidth: 130 * (columns.length + 2) }}>
            <colgroup>
              {Array.from({ length: columns.length + 2 }).map((_, i) => (
                <col key={i} style={{ width: `${100 / (columns.length + 2)}%` }} />
              ))}
            </colgroup>
            <thead>
              <tr style={{ color: "#64748B", textAlign: "center", fontSize: 10.5, textTransform: "uppercase" }}>
                <th style={{ padding: "6px", height: 44, verticalAlign: "middle" }}>Band</th>
                {columns.map((c) => (
                  <th key={c.date} style={{ padding: "6px", height: 44, verticalAlign: "middle", color: c.heading === "Current" ? "#1B2A38" : "#64748B" }}>
                    {c.heading}
                    <div style={{ fontWeight: 400, textTransform: "none", fontSize: 10.5, color: "#94A0AC" }}>
                      {fmtDate(c.date)}{isUnsaved(c.date) ? " · unsaved" : ""}
                    </div>
                  </th>
                ))}
                <th style={{ padding: "6px", height: 44, verticalAlign: "middle" }}>Increase %</th>
              </tr>
            </thead>
            <tbody>
              {bandDefs.map((b) => {
                // Increase is measured across the two right-most columns —
                // i.e. the newest change, which is the one being decided on.
                const last = columns[columns.length - 1];
                const beforeLast = columns[columns.length - 2];
                const from = beforeLast ? rateFor(beforeLast.date, b.label) : 0;
                const to = last ? rateFor(last.date, b.label) : 0;
                const pct = from > 0 ? ((to - from) / from) * 100 : null;
                return (
                  <tr key={b.label} style={{ borderTop: "1px solid #EEE7D6", textAlign: "center" }}>
                    <td className="f-mono" style={{ ...rateCellStyle, fontWeight: 600 }}>{b.label}</td>
                    {columns.map((c) =>
                      c.editable ? (
                        <td key={c.date} style={rateCellStyle}>
                          <input
                            type="text" inputMode="decimal"
                            value={rateInputValue(c.date, b.label)}
                            onFocus={() => setEditing({ date: c.date, label: b.label, text: String(rateFor(c.date, b.label)) })}
                            onChange={(e) => onRateChange(c.date, b.label, e.target.value)}
                            onBlur={() => setEditing(null)}
                            style={{
                              ...inputStyle, textAlign: "center",
                              width: "100%", maxWidth: 110, boxSizing: "border-box", display: "block", margin: "0 auto",
                              borderColor: c.heading === "Current" ? "#D8D0BE" : "#2F5D50",
                              fontWeight: c.heading === "Current" ? 500 : 700,
                            }}
                          />
                        </td>
                      ) : (
                        // Read-only: superseded sets are history. Letting them be
                        // edited here would silently re-price issued statements.
                        // savedRate (not rateFor) so a genuine R0.00 band shows as
                        // 0.00 and only a band absent from that set shows as "—".
                        <td key={c.date} className="f-mono" style={{ ...rateCellStyle, color: "#64748B" }}>
                          {fmtRate(savedRate(c.date, b.label))}
                        </td>
                      )
                    )}
                    <td className="f-mono" style={{ ...rateCellStyle, color: "#B5651D" }}>
                      {pct === null ? "—" : `${pct.toFixed(2)}%`}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p style={{ fontSize: 11.5, color: "#94A0AC", marginTop: 10 }}>
          Increase % compares the two most recent sets. Superseded sets are read-only so statements already issued keep the rates they were billed on.
        </p>
        <SectionSave state={status.water} dirty={dirty} onSave={saveWater} label="Save water rates" />
      </Card>

      <Card style={{ marginTop: 16 }}>
        <div style={{ fontWeight: 700, fontSize: 13.5, marginBottom: 4 }}>Electricity — flat rate</div>
        <p style={{ fontSize: 12, color: "#94A0AC", marginBottom: 12 }}>
          Single rate applied to every kWh of metered and common-area electricity usage.
        </p>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: "#64748B" }}>Effective from</span>
          <input
            type="date" value={elecDateDraft || ""}
            onChange={(e) => setElecDateDraft(e.target.value)}
            style={{ ...inputStyle, width: 160, textAlign: "left", borderColor: "#2F5D50", fontWeight: 700 }}
          />
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 13.5 }} className="f-mono">R</span>
          <input
            type="number" step="0.0001" value={elecDraft}
            onChange={(e) => setElecDraft(parseFloat(e.target.value) || 0)}
            style={{ ...inputStyle, width: 120, borderColor: "#2F5D50", fontWeight: 700 }}
          />
          <span style={{ fontSize: 13.5, color: "#64748B" }}>per kWh</span>
        </div>
        <SectionSave state={status.electricity} dirty={elecDirty} onSave={saveElectricity} label="Save electricity rate" />
      </Card>

      <Card style={{ marginTop: 16 }}>
        <div style={{ fontWeight: 700, fontSize: 13.5, marginBottom: 4 }}>VAT on water & electricity</div>
        <p style={{ fontSize: 12, color: "#94A0AC", marginBottom: 12 }}>
          Applied to metered water and electricity charges only — shown as its own line on every statement, not absorbed into the rate.
        </p>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <input
            type="number" step="0.01" value={round2(vatDraft * 100)}
            onChange={(e) => setVatDraft((parseFloat(e.target.value) || 0) / 100)}
            style={{ ...inputStyle, width: 100, borderColor: "#2F5D50", fontWeight: 700 }}
          />
          <span style={{ fontSize: 13.5, color: "#64748B" }}>% (currently {(vatRate * 100).toFixed(2)}%)</span>
        </div>
        <SectionSave state={status.vat} dirty={vatDirty} onSave={saveVat} label="Save VAT rate" />
      </Card>

      <Card style={{ marginTop: 16 }}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", flexWrap: "wrap", gap: 8, marginBottom: 4 }}>
          <div style={{ fontWeight: 700, fontSize: 13.5 }}>Common property standards</div>
          {/* Both standards are set annually at the AGM and stored per financial
              year, so the year has to be on screen — otherwise there is no way
              to tell which year's figures are being edited. It follows the
              period selector in the top bar, like every other FY-scoped screen. */}
          {standardsMeta.financialYear && (
            <span style={{ fontSize: 11.5, color: "#64748B" }}>
              Financial year <b className="f-mono">{standardsMeta.financialYear}</b> — follows the period selected above
            </span>
          )}
        </div>
        <p style={{ fontSize: 12, color: "#94A0AC", marginBottom: 12 }}>
          Water Demand Levy, Sewerage, and the Electricity Service/Network charges now come from the uploaded utility bills — see <b>Invoice allocation</b>. Only the common-property standards live here; they drive the calculated values on the Levy breakdown page. Next year’s <i>proposed</i> figures for those four charges are captured under <b>AGM report figures</b> on Config, since the council hasn’t published them yet.
        </p>
        {standardsMeta.carriedForward && (
          <div style={{ marginBottom: 12, padding: "9px 12px", borderRadius: 7, background: "#FBF3E9", border: "1px solid #E3C9A8", color: "#8A5A1E", fontSize: 12, lineHeight: 1.6 }}>
            <b>FY {standardsMeta.financialYear} hasn’t been set up yet.</b> These are FY {standardsMeta.carriedFromFY}’s standards, shown as a starting point — nothing has been saved against FY {standardsMeta.financialYear}, and FY {standardsMeta.carriedFromFY} stays untouched. Adjust them for this year, then save.
          </div>
        )}
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 13, width: 220 }}>Common Property Water standard</span>
            <input
              type="number" step="1" min="0" value={waterKlDraft}
              onChange={(e) => setWaterKlDraft(parseFloat(e.target.value) || 0)}
              style={{ ...inputStyle, width: 110, borderColor: "#2F5D50", fontWeight: 700 }}
            />
            <span style={{ fontSize: 11.5, color: "#94A0AC" }}>kL / month, billed on the real tariff scale above (free first 6kL included), split 7 ways</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 13, width: 220 }}>Common Property Electricity standard</span>
            <input
              type="number" step="1" min="0" value={elecKwhDraft}
              onChange={(e) => setElecKwhDraft(parseFloat(e.target.value) || 0)}
              style={{ ...inputStyle, width: 110, borderColor: "#2F5D50", fontWeight: 700 }}
            />
            <span style={{ fontSize: 11.5, color: "#94A0AC" }}>kWh / month, billed at the flat rate above, split 7 ways</span>
          </div>
          <div style={{ fontSize: 12, color: "#64748B" }} className="f-mono">
            Common Property Water: {rand(calcWaterCost(waterKlDraft, currentBandsForCalc))} total · {rand(calcWaterCost(waterKlDraft, currentBandsForCalc) / UNITS.length)} per unit
            <br />
            Common Property Electricity: {rand(elecKwhDraft * elecDraft)} total · {rand((elecKwhDraft * elecDraft) / UNITS.length)} per unit
          </div>
        </div>
        <SectionSave state={status.standards} dirty={standardsDirty} onSave={saveStandards} label={`Save standards for FY ${standardsMeta.financialYear || ""}`.trim()} />
      </Card>

    </>
  );
}

// ---------- Rate History ----------
// Read-only page that loads ALL rate sets from the DB and displays them
// grouped by effective date — a full audit trail independent of the
// viewing period.
function RateHistory() {
  const [waterSets, setWaterSets] = useState(null); // null = loading
  const [elecRows, setElecRows] = useState(null);
  const [vatRows, setVatRows] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const client = await ensureSupabaseClient();
        const [w, e, v] = await Promise.all([
          client.from("water_tariff_bands").select("*").order("effective_from", { ascending: false }),
          client.from("electricity_rates").select("*").order("effective_from", { ascending: false }),
          client.from("vat_rates").select("*").order("effective_from", { ascending: false }),
        ]);
        if (cancelled) return;
        if (w.error) throw w.error;
        if (e.error) throw e.error;
        if (v.error) throw v.error;

        // Group water bands by effective_from
        const grouped = {};
        (w.data || []).forEach((b) => {
          const key = b.effective_from;
          if (!grouped[key]) grouped[key] = [];
          grouped[key].push(b);
        });
        // Sort bands within each group by from_kl
        Object.values(grouped).forEach((arr) => arr.sort((a, b) => Number(a.from_kl) - Number(b.from_kl)));
        // Sort groups newest first
        const sorted = Object.entries(grouped).sort((a, b) => (a[0] < b[0] ? 1 : -1));
        setWaterSets(sorted);
        setElecRows(e.data || []);
        setVatRows(v.data || []);
      } catch (err) {
        console.error("Loading rate history failed:", err);
        if (!cancelled) setError(err.message || "Failed to load rate history");
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const fmtDate = (d) => {
    if (!d) return "—";
    const dt = new Date(d + "T00:00:00");
    return dt.toLocaleDateString("en-ZA", { day: "numeric", month: "long", year: "numeric" });
  };

  if (error) return <Card><p style={{ color: "#B5651D" }}>{error}</p></Card>;

  return (
    <>
      <h1 className="f-display" style={{ fontSize: 24, marginBottom: 4 }}>Rate history</h1>
      <p style={{ color: "#64748B", fontSize: 13.5, marginBottom: 18 }}>
        Complete audit trail of every rate set on file. Each block shows the rates that applied from its effective date until the next set took over.
      </p>

      {/* Water tariff history */}
      <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 10, marginTop: 8 }}>Water — increasing block tariff</h2>
      {waterSets === null ? (
        <Card><p style={{ color: "#94A0AC", fontSize: 13 }}>Loading…</p></Card>
      ) : waterSets.length === 0 ? (
        <Card><p style={{ color: "#94A0AC", fontSize: 13 }}>No water rate history on file.</p></Card>
      ) : waterSets.map(([effDate, bands], idx) => (
        <Card key={effDate} style={{ marginBottom: 14, opacity: idx === 0 ? 1 : 0.85 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
            <span style={{ fontWeight: 700, fontSize: 13.5 }}>Effective from {fmtDate(effDate)}</span>
            {idx === 0 && <span style={{ fontSize: 11, fontWeight: 700, color: "#2F5D50", background: "#E8F0ED", padding: "2px 8px", borderRadius: 4 }}>CURRENT</span>}
          </div>
          <table style={{ width: "100%", fontSize: 13, borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ color: "#64748B", textAlign: "right", fontSize: 10.5, textTransform: "uppercase" }}>
                <th style={{ padding: "6px 8px", textAlign: "left" }}>Band</th>
                <th style={{ padding: "6px 8px", textAlign: "left" }}>Range (kL)</th>
                <th style={{ padding: "6px 8px" }}>Rate (R / kL)</th>
              </tr>
            </thead>
            <tbody>
              {bands.map((b) => (
                <tr key={b.band_label} style={{ borderTop: "1px solid #EEE7D6" }}>
                  <td style={{ padding: "8px", fontWeight: 600 }} className="f-mono">{b.band_label}</td>
                  <td style={{ padding: "8px", color: "#64748B" }} className="f-mono">
                    {Number(b.from_kl)} – {b.to_kl == null ? "∞" : Number(b.to_kl)}
                  </td>
                  <td style={{ padding: "8px", textAlign: "right", fontWeight: 700 }} className="f-mono">
                    {rand(Number(b.rate_per_kl))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      ))}

      {/* Electricity rate history */}
      <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 10, marginTop: 24 }}>Electricity — flat rate</h2>
      {elecRows === null ? (
        <Card><p style={{ color: "#94A0AC", fontSize: 13 }}>Loading…</p></Card>
      ) : elecRows.length === 0 ? (
        <Card><p style={{ color: "#94A0AC", fontSize: 13 }}>No electricity rate history on file.</p></Card>
      ) : (
        <Card>
          <table style={{ width: "100%", fontSize: 13, borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ color: "#64748B", textAlign: "right", fontSize: 10.5, textTransform: "uppercase" }}>
                <th style={{ padding: "6px 8px", textAlign: "left" }}>Effective from</th>
                <th style={{ padding: "6px 8px" }}>Rate (R / kWh)</th>
                <th style={{ padding: "6px 8px", textAlign: "left" }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {elecRows.map((r, idx) => (
                <tr key={r.id} style={{ borderTop: idx ? "1px solid #EEE7D6" : "none" }}>
                  <td style={{ padding: "8px", fontWeight: 600 }}>{fmtDate(r.effective_from)}</td>
                  <td style={{ padding: "8px", textAlign: "right", fontWeight: 700 }} className="f-mono">{rand(Number(r.rate_per_kwh))}</td>
                  <td style={{ padding: "8px" }}>
                    {idx === 0
                      ? <span style={{ fontSize: 11, fontWeight: 700, color: "#2F5D50", background: "#E8F0ED", padding: "2px 8px", borderRadius: 4 }}>CURRENT</span>
                      : <span style={{ fontSize: 11, color: "#94A0AC" }}>Superseded</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {/* VAT rate history */}
      <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 10, marginTop: 24 }}>VAT on water & electricity</h2>
      {vatRows === null ? (
        <Card><p style={{ color: "#94A0AC", fontSize: 13 }}>Loading…</p></Card>
      ) : vatRows.length === 0 ? (
        <Card><p style={{ color: "#94A0AC", fontSize: 13 }}>No VAT rate history on file.</p></Card>
      ) : (
        <Card>
          <table style={{ width: "100%", fontSize: 13, borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ color: "#64748B", textAlign: "right", fontSize: 10.5, textTransform: "uppercase" }}>
                <th style={{ padding: "6px 8px", textAlign: "left" }}>Effective from</th>
                <th style={{ padding: "6px 8px" }}>Rate</th>
                <th style={{ padding: "6px 8px", textAlign: "left" }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {vatRows.map((r, idx) => (
                <tr key={r.id} style={{ borderTop: idx ? "1px solid #EEE7D6" : "none" }}>
                  <td style={{ padding: "8px", fontWeight: 600 }}>{fmtDate(r.effective_from)}</td>
                  <td style={{ padding: "8px", textAlign: "right", fontWeight: 700 }} className="f-mono">{(Number(r.rate) * 100).toFixed(2)}%</td>
                  <td style={{ padding: "8px" }}>
                    {idx === 0
                      ? <span style={{ fontSize: 11, fontWeight: 700, color: "#2F5D50", background: "#E8F0ED", padding: "2px 8px", borderRadius: 4 }}>CURRENT</span>
                      : <span style={{ fontSize: 11, color: "#94A0AC" }}>Superseded</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </>
  );
}

// ---------- Reconciliation ----------
// Per-unit payment variances smaller than this (in Rand) auto-reconcile —
// covers rounding and a few cents' difference. At or above it, the line needs
// review. Set to R0.05 per the trustee's rule.
const RECON_TOLERANCE = 0.05;

// The single source of truth for per-unit reconciliation, used by BOTH the
// Reconciliation page and the Dashboard so their figures always agree. For each
// unit it returns the expected amount (statement total minus any APPROVED
// deduction), the matched bank payment, the variance, and whether it's settled.
//   settled = matched within tolerance, or a variance the trustee marked reviewed.
//   status  = paid | resolved | review | outstanding.
// ---------- Analytics: financial dashboard ----------
// Cash basis. Bank transactions are the source of truth for anything that moved
// through the account; approved resident deductions cover Body Corp expenses a
// resident paid personally; ops_expenses covers the rest (and excludes rows
// flagged as duplicating either of the other two).
//
// Owner Contributions are grossed up by approved deductions on purpose. A
// resident who owes R5 000 and pays R4 326 in cash after paying the gardener
// R674 directly has still contributed R5 000 — booking only the R4 326 while
// also booking the R674 as an expense would understate the surplus twice over.
const UNCLASSIFIED = "Unclassified";

function fyMonths(fy) {
  const start = Number(String(fy).split("/")[0]);
  const out = [];
  for (let i = 0; i < 12; i++) {
    const monthIndex = 7 + i;              // 7 = August (0-based)
    const y = start + Math.floor(monthIndex / 12);
    const m = (monthIndex % 12) + 1;
    out.push(`${y}-${String(m).padStart(2, "0")}`);
  }
  return out;
}
const ymOf = (dateStr) => String(dateStr).slice(0, 7);

// The income row that is levy money. Named rather than typed at each use
// because the PMR 22 reserve threshold keys off it: matching the label by hand
// in one more place is how it came to be summed with Interest Earned in the
// first place.
const INCOME_OWNER_CONTRIBUTIONS = "Owner Contributions";

function buildFinancialYearReport({
  fy, txns, ops, remits, charges, manualPays = [], categories,
  unitNumbers = {}, chaserImported = true, chaserMonth = null,
}) {
  const months = fyMonths(fy);
  const blank = () => Object.fromEntries(months.map((m) => [m, 0]));
  const add = (bucket, ym, amount) => {
    if (bucket[ym] === undefined) return; // outside the FY window — ignore
    bucket[ym] += amount;
  };

  const income = {
    [INCOME_OWNER_CONTRIBUTIONS]: blank(),
    "Interest Earned": blank(),
    "Other Credits": blank(),
  };
  const expenses = {};
  const ensureExpense = (name) => {
    if (!expenses[name]) expenses[name] = blank();
    return expenses[name];
  };
  // Every active category gets a row even at zero, so the dashboard shape is
  // stable month to month and a missing figure reads as "nothing spent" rather
  // than "line forgotten".
  categories.filter((c) => c.active).forEach((c) => ensureExpense(c.name));

  // --- Bank lines ---
  // Owner contributions are attributed to the STATEMENT month they settle
  // (applied_period), not the month the money landed. Levies for month M are
  // paid on the M+1 statement, so bucketing on txn_date would put June's levies
  // in the July column — and a resident who pays early or twice in one bank
  // month would land two statements' worth in the same column.
  //
  // Everything else has no statement month at all (the council doesn't bill
  // against a levy period, nor does the bank charge a fee against one), so it
  // is attributed to the date it occurred.
  txns.forEach((t) => {
    const amount = Number(t.amount) || 0;
    if (t.direction === "credit") {
      if (t.category === "resident_payment") {
        const settles = t.applied_period || (t.period ? ymOf(prevPeriod(t.period)) : ymOf(t.txn_date));
        add(income[INCOME_OWNER_CONTRIBUTIONS], ymOf(settles), amount);
      } else if (t.category === "interest") {
        add(income["Interest Earned"], ymOf(t.txn_date), amount);
      } else {
        add(income["Other Credits"], ymOf(t.txn_date), amount);
      }
    } else {
      add(ensureExpense(t.expense_category || UNCLASSIFIED), ymOf(t.txn_date), amount);
    }
  });

  // --- Trustee-recorded payments not yet on a bank statement ---
  // Deduplication is derived, exactly as reconcileUnits does it: a manual entry
  // is ignored the moment a real bank line exists for the same unit and
  // statement month, so importing the statement can't double count.
  const bankedKeys = new Set(
    txns
      .filter((t) => t.category === "resident_payment" && t.matched_unit_id && t.applied_period)
      .map((t) => `${t.matched_unit_id}|${ymOf(t.applied_period)}`)
  );
  let provisionalTotal = 0;
  const provisionalDetail = [];
  manualPays.forEach((m) => {
    const ym = ymOf(m.applied_period);
    if (bankedKeys.has(`${m.unit_id}|${ym}`)) return; // superseded by the real thing
    const amount = Number(m.amount) || 0;
    if (income[INCOME_OWNER_CONTRIBUTIONS][ym] === undefined) return;
    provisionalTotal += amount;
    provisionalDetail.push({ unit: unitNumbers[m.unit_id] || null, ym, amount });
    add(income[INCOME_OWNER_CONTRIBUTIONS], ym, amount);
  });

  // --- Approved resident deductions: expense incurred + contribution grossed up ---
  let deductionTotal = 0;
  remits.forEach((r) => {
    if (!r.deduction_approved) return;
    const ym = ymOf(r.period);
    const items = Array.isArray(r.deductions) && r.deductions.length
      ? r.deductions
      : (Number(r.deduction_amount) > 0
          ? [{ amount: r.deduction_amount, expenseCategory: null }]
          : []);
    items.forEach((it) => {
      const amount = Number(it.amount) || 0;
      if (!(amount > 0)) return;
      deductionTotal += amount;
      add(ensureExpense(it.expenseCategory || UNCLASSIFIED), ym, amount);
      add(income[INCOME_OWNER_CONTRIBUTIONS], ym, amount);
    });
  });

  // --- Non-bank, non-deduction expenses ---
  ops.forEach((e) => {
    add(ensureExpense(e.category || UNCLASSIFIED), ymOf(e.expense_date), Number(e.amount) || 0);
  });

  // --- Memo only: costs recovered from units via additional charges. Already
  //     inside Owner Contributions once paid, so never netted off expenses. ---
  const recoveries = {};
  charges.forEach((c) => {
    if (!c.expense_category) return;
    recoveries[c.expense_category] = (recoveries[c.expense_category] || 0) + (Number(c.amount) || 0);
  });

  const sumRow = (row) => months.reduce((s, m) => s + row[m], 0);
  const orderOf = (name) => {
    const hit = categories.find((c) => c.name === name);
    if (hit) return hit.sortOrder;
    return name === UNCLASSIFIED ? 9998 : 9999;
  };

  const incomeRows = Object.entries(income).map(([label, row]) => ({ label, row, total: sumRow(row) }));
  const expenseRows = Object.entries(expenses)
    .map(([label, row]) => ({ label, row, total: sumRow(row), recovered: recoveries[label] || 0 }))
    .sort((a, b) => orderOf(a.label) - orderOf(b.label) || a.label.localeCompare(b.label));

  const totalIncomeRow = blank();
  const totalExpenseRow = blank();
  months.forEach((m) => {
    incomeRows.forEach((r) => { totalIncomeRow[m] += r.row[m]; });
    expenseRows.forEach((r) => { totalExpenseRow[m] += r.row[m]; });
  });
  const surplusRow = Object.fromEntries(months.map((m) => [m, totalIncomeRow[m] - totalExpenseRow[m]]));

  const surplus = sumRow(totalIncomeRow) - sumRow(totalExpenseRow);

  // ---- Footnotes ----
  // Built from the figures themselves, so they appear, renumber and disappear
  // on their own as payments are allocated, statements imported and expenses
  // tagged. Nothing here is hard-coded to a month or a unit.
  const footnotes = [];
  const noteRefs = {};                       // row label -> [footnote numbers]
  const note = (label, text) => {
    footnotes.push(text);
    if (!noteRefs[label]) noteRefs[label] = [];
    noteRefs[label].push(footnotes.length);
  };
  const monthName = (ym) => {
    const [y, m] = ym.split("-");
    return `${MONTH_NAMES[Number(m) - 1]} ${y}`;
  };

  if (deductionTotal > 0) {
    note(INCOME_OWNER_CONTRIBUTIONS,
      `Includes ${rand(deductionTotal)} of levies settled by approved deductions — Body Corp expenses residents paid personally. The matching amounts appear under expenditure, so the surplus is not overstated.`);
  }
  if (provisionalTotal > 0) {
    const byUnit = provisionalDetail
      .map((d) => `${d.unit ? `Unit ${d.unit}` : "an unidentified unit"} ${rand(d.amount)} (${monthName(d.ym)})`)
      .join(", ");
    note(INCOME_OWNER_CONTRIBUTIONS,
      `Includes ${rand(provisionalTotal)} recorded manually and not yet confirmed on a bank statement: ${byUnit}. Each entry drops out automatically once the matching bank line is imported, so it cannot be double counted.`);
  }
  expenseRows.forEach((r) => {
    if (r.recovered > 0) {
      note(r.label,
        `${rand(r.recovered)} of this cost was recovered from units as an additional charge. That recovery arrives inside Owner Contributions and is deliberately not netted off here, so the gross cost to the Body Corp stays visible.`);
    }
  });
  if ((expenseRows.find((r) => r.label === UNCLASSIFIED)?.total || 0) > 0) {
    note(UNCLASSIFIED,
      `Expenditure with no category assigned yet. Tag the relevant debits on the Tenant recon page — and any untagged deduction claims below them — to move this onto the right lines.`);
  }
  if (!chaserImported && chaserMonth) {
    note("__surplus__",
      `Incomplete year. July levies are collected on the ${monthName(chaserMonth)} bank statement, which has not been imported yet, so contributions and this figure are understated by up to a month of levies. Import that statement to close the year off.`);
  }

  return {
    months, incomeRows, expenseRows,
    totalIncome: sumRow(totalIncomeRow), totalExpense: sumRow(totalExpenseRow),
    totalIncomeRow, totalExpenseRow, surplusRow, surplus,
    deductionTotal, provisionalTotal, provisionalDetail,
    footnotes, noteRefs,
    unclassified: expenseRows.find((r) => r.label === UNCLASSIFIED)?.total || 0,
  };
}

// Loads one financial year and builds its income & expenditure report. Split
// out of the Analytics screen so the AGM report can call it a second time for
// the comparative prior year without duplicating the fetch.
async function loadFyReport(fy, categories) {
  const { from, to } = fyBounds(fy);
  // Resident payments are bucketed by the statement month they settle, which
  // can be up to two months before the bank month (the trustee can retarget
  // that far back). So the bank fetch is widened by three months either side;
  // buildFinancialYearReport drops anything that ends up outside the financial
  // year once bucketed.
  const wideFrom = `${from.slice(0, 4)}-05-01`;   // FY start less 3 months
  const wideTo = `${to.slice(0, 4)}-10-31`;       // FY end plus 3 months
  const client = await ensureSupabaseClient();
  const [txns, manualPays, ops, remits, charges, unitRows] = await Promise.all([
    client.from("bank_transactions").select("txn_date, period, applied_period, matched_unit_id, direction, amount, category, expense_category")
      .gte("txn_date", wideFrom).lte("txn_date", wideTo),
    client.from("manual_payments").select("unit_id, applied_period, amount")
      .gte("applied_period", from).lte("applied_period", to),
    // Rows flagged as duplicating a bank line or a deduction are excluded.
    client.from("ops_expenses").select("expense_date, category, amount")
      .is("superseded_reason", null).gte("expense_date", from).lte("expense_date", to),
    client.from("remittance_advices").select("period, deduction_approved, deduction_amount, deductions")
      .gte("period", from).lte("period", to),
    client.from("additional_charges").select("period, amount, expense_category")
      .gte("period", from).lte("period", to),
    // Only to name units in the manual-allocation footnote.
    client.from("units").select("id, unit_number"),
  ]);
  const bad = [txns, manualPays, ops, remits, charges, unitRows].find((r) => r.error);
  if (bad) throw bad.error;
  // The FY's last statement month (July) is collected on the following month's
  // bank statement. Until that statement is imported, July shows almost no
  // contributions and the surplus reads as a false deficit — so the report says
  // so rather than let the number be misread.
  const chaserMonth = ymOf(nextPeriod(`${to.slice(0, 4)}-07-01`));
  const report = buildFinancialYearReport({
    fy,
    txns: txns.data || [], ops: ops.data || [],
    remits: remits.data || [], charges: charges.data || [],
    manualPays: manualPays.data || [],
    categories,
    unitNumbers: Object.fromEntries((unitRows.data || []).map((u) => [u.id, u.unit_number])),
    chaserImported: (txns.data || []).some((t) => ymOf(t.txn_date) === chaserMonth),
    chaserMonth,
  });
  // Whether this year predates the system at all — the AGM report leaves the
  // comparative column blank rather than printing a column of zeros that reads
  // as "we earned and spent nothing".
  report.hasData = (txns.data || []).length > 0 || (ops.data || []).length > 0;
  return report;
}

// Superscript markers next to a line item, e.g. "Owner Contributions ¹ ²".
function NoteRef({ nums }) {
  if (!nums || nums.length === 0) return null;
  return (
    <sup style={{ color: "#8A6D1E", fontWeight: 700, fontSize: 9.5, marginLeft: 3 }}>
      {nums.join(",")}
    </sup>
  );
}

function Analytics({ expenseCategories }) {
  const [fy, setFy] = useState(null);
  const [availableFys, setAvailableFys] = useState([]);
  const [report, setReport] = useState(null);
  const [status, setStatus] = useState("loading"); // loading | ready | error
  const [error, setError] = useState(null);
  const [showMonths, setShowMonths] = useState(false);
  const [agmStatus, setAgmStatus] = useState("idle"); // idle | working | ready | error
  const [agmFile, setAgmFile] = useState(null);       // { blob, filename } once built

  // Builds the AGM report for the selected financial year. The comparative
  // prior year is loaded on demand rather than held in state — it's only ever
  // needed here, and it keeps the dashboard's own load a single year.
  const generateAgmReport = async () => {
    setAgmStatus("working"); setAgmFile(null);
    try {
      // Usage is fetched here rather than read off the rendered charts so the
      // report doesn't depend on the trends card having finished loading, and
      // a failure there costs the section rather than the whole document.
      const [prevReport, extras, usage, bank, plan, budget] = await Promise.all([
        loadFyReport(previousFY(fy), expenseCategories).catch(() => null),
        fetchAgmExtras(fy),
        fetchUsageTrend(fy).catch((err) => { console.warn("Loading usage for the AGM report failed:", err); return null; }),
        fetchBankAccountSummary(fy).catch((err) => { console.warn("Loading the bank account summary for the AGM report failed:", err); return null; }),
        fetchMaintenancePlan(fy).catch((err) => { console.warn("Loading the maintenance plan for the AGM report failed:", err); return null; }),
        // The budget is for the year AHEAD — the report reviews fy and asks the
        // meeting to approve nfy.
        fetchBudget(nextFY(fy)).catch((err) => { console.warn("Loading the budget for the AGM report failed:", err); return null; }),
      ]);
      // The Regulation 2 floor needs figures from three places at once: the
      // reserve ledger, the year just ended's ACTUAL owner contributions, and
      // the coming year's BUDGETED contributions.
      //
      // Actual contributions are the Owner Contributions row ONLY. This used to
      // sum every income row, which swept in Interest Earned and Other Credits
      // — neither is a contribution, and both inflated the 25% threshold the
      // meeting is held to. Anything that isn't a contribution from an owner is
      // excluded by construction here rather than by listing what to skip, so a
      // new income row added later cannot quietly rejoin the calculation.
      const leviesRow = report && report.incomeRows
        ? report.incomeRows.find((r) => r.label === INCOME_OWNER_CONTRIBUTIONS) : null;
      const leviesCollected = leviesRow ? round2(leviesRow.total || 0) : null;
      // Which reading of "contribution to the administrative fund" the scheme
      // has adopted. Set on Config → AGM report figures; the budget rows carry
      // the classification the two readings differ on.
      const reserveBasis = (extras && extras.settingsNext && extras.settingsNext.reserveBasis) || "all_contributions";
      const budgetedContributions = contributionBase(budget, reserveBasis);
      const floor = plan && leviesCollected != null
        ? {
            ...reserveFundFloor({
              reserveBalance: plan.reserve.balance,
              priorYearContributions: leviesCollected,
              budgetedContributions,
              budgetedRM: budget ? budget.commonPropertyRM : null,
            }),
            leviesCollected,
            basis: reserveBasis,
          }
        : null;
      const file = await exportAgmReportDocx({ fy, report, prevReport, extras, usage, bank, plan, floor, budget });
      setAgmFile(file);
      setAgmStatus("ready");
    } catch (err) {
      console.error("Generating the AGM report failed:", err);
      setAgmStatus("error");
    }
  };

  // Which financial years actually have bank data, newest first. Defaults to the
  // most recent one with data rather than the calendar-current FY — on 4 August
  // the new FY is four days old and would render an empty dashboard.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const client = await ensureSupabaseClient();
        const [oldest, newest] = await Promise.all([
          client.from("bank_transactions").select("txn_date").order("txn_date", { ascending: true }).limit(1),
          client.from("bank_transactions").select("txn_date").order("txn_date", { ascending: false }).limit(1),
        ]);
        if (oldest.error) throw oldest.error;
        if (newest.error) throw newest.error;
        const first = oldest.data?.[0]?.txn_date;
        const last = newest.data?.[0]?.txn_date;
        const fallback = periodToFY(CURRENT_PERIOD);
        if (!first || !last) {
          if (alive) { setAvailableFys([fallback]); setFy(fallback); }
          return;
        }
        const startYear = Number(fyOfDate(first).split("/")[0]);
        const endYear = Number(fyOfDate(last).split("/")[0]);
        const list = [];
        for (let y = endYear; y >= startYear; y--) list.push(`${y}/${y + 1}`);
        if (alive) { setAvailableFys(list); setFy(list[0]); }
      } catch (err) {
        console.error("Loading financial years failed:", err);
        if (alive) { setStatus("error"); setError("Couldn't reach the database — see browser console."); }
      }
    })();
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    if (!fy) return;
    let alive = true;
    setStatus("loading");
    loadFyReport(fy, expenseCategories)
      .then((r) => { if (alive) { setReport(r); setStatus("ready"); } })
      .catch((err) => {
        console.error("Building the financial dashboard failed:", err);
        if (alive) { setStatus("error"); setError("Couldn't build the dashboard — see browser console."); }
      });
    return () => { alive = false; };
  }, [fy, expenseCategories]);

  const monthLabel = (ym) => {
    const [y, m] = ym.split("-");
    return `${MONTH_NAMES[Number(m) - 1].slice(0, 3)} ${y.slice(2)}`;
  };
  const th = { padding: "7px 8px", color: "#64748B", fontSize: 10.5, textTransform: "uppercase", textAlign: "right", whiteSpace: "nowrap" };
  const td = { padding: "7px 8px", textAlign: "right", whiteSpace: "nowrap" };

  return (
    <>
      <div className="no-print" style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 16, flexWrap: "wrap", marginBottom: 4 }}>
        <h1 className="f-display" style={{ fontSize: 24, margin: 0 }}>Financial dashboard</h1>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <label style={{ fontSize: 12, color: "#64748B", fontWeight: 600 }}>Financial year</label>
          <select
            value={fy || ""}
            onChange={(e) => setFy(e.target.value)}
            style={{ padding: "7px 10px", borderRadius: 6, border: "1px solid #D8D0BE", fontSize: 13, fontWeight: 600 }}
          >
            {availableFys.map((y) => <option key={y} value={y}>{y} ({fyLabel(y)})</option>)}
          </select>
          <button onClick={() => window.print()} style={{ ...secondaryBtn, padding: "7px 14px" }}>Print / PDF</button>
          <button
            onClick={generateAgmReport}
            disabled={status !== "ready" || agmStatus === "working"}
            style={{ ...primaryBtn, padding: "7px 14px", opacity: status !== "ready" || agmStatus === "working" ? 0.6 : 1 }}
          >
            {agmStatus === "working" ? "Generating…" : agmStatus === "ready" ? "Regenerate" : "Generate AGM report"}
          </button>
          {/* A separate click, on purpose. See downloadBlob. */}
          {agmStatus === "ready" && agmFile && (
            <button
              onClick={() => downloadBlob(agmFile.blob, agmFile.filename)}
              style={{ ...primaryBtn, padding: "7px 14px", background: "#2F5D50" }}
            >
              Download the AGM pack
            </button>
          )}
        </div>
      </div>
      {agmStatus === "error" && (
        <div className="no-print" style={{ color: "#B5651D", fontSize: 12.5, fontWeight: 600, marginBottom: 10, textAlign: "right" }}>
          Couldn’t generate the AGM report — see browser console.
        </div>
      )}
      {agmStatus === "ready" && (
        <div className="no-print" style={{ color: "#2F5D50", fontSize: 12.5, fontWeight: 600, marginBottom: 10, textAlign: "right" }}>
          {agmFile.filename} is ready — click Download to save it. It stays here until you regenerate or leave the page.
        </div>
      )}
      <p className="no-print" style={{ color: "#64748B", fontSize: 13.5, marginBottom: 18 }}>
        Year to date. Owner contributions are shown against the <strong>statement month they settle</strong>, not the month the money arrived — levies for month M are paid on the M+1 bank statement, so this is what lets a column be compared against what that month billed. Everything else has no statement month and is shown on the date it occurred. Approved resident deductions count as both a contribution and an expense. The body corp financial year runs August to July.
      </p>

      {status === "error" && (
        <Card><div style={{ color: "#B5651D", fontWeight: 600, fontSize: 13 }}>{error}</div></Card>
      )}
      {status === "loading" && (
        <Card><div style={{ color: "#94A0AC", fontSize: 13 }}>Loading {fy || "financial year"}…</div></Card>
      )}

      {status === "ready" && report && (
        <div className="print-area">
          <div style={{ marginBottom: 14 }}>
            <div className="f-display" style={{ fontSize: 20 }}>El Corazon Body Corporate — income &amp; expenditure</div>
            <div style={{ fontSize: 12, color: "#64748B" }}>
              Financial year {fy} ({fyLabel(fy)}) · cash basis · generated {new Date().toLocaleDateString("en-ZA")}
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 14, marginBottom: 18 }}>
            <Stat label={`Total income — ${fy}`} value={rand(report.totalIncome)} accent="#2F5D50" />
            <Stat label={`Total expenditure — ${fy}`} value={rand(report.totalExpense)} accent="#B5651D" />
            <Stat
              label={report.surplus >= 0 ? "Surplus" : "Deficit"}
              value={rand(Math.abs(report.surplus))}
              accent={report.surplus >= 0 ? "#2F5D50" : "#B5651D"}
            />
          </div>

          <Card>
            <div className="no-print" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <div style={{ fontWeight: 700, fontSize: 13.5 }}>Income &amp; expenditure — {fy}</div>
              <button
                onClick={() => setShowMonths((v) => !v)}
                style={{ background: "none", border: "none", padding: 0, fontSize: 11.5, fontWeight: 700, color: "#2A3E7A", cursor: "pointer", textDecoration: "underline" }}
              >
                {showMonths ? "Hide monthly breakdown" : "Show monthly breakdown"}
              </button>
            </div>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", fontSize: 12.5, borderCollapse: "collapse", minWidth: showMonths ? 1150 : 420 }}>
                <thead>
                  <tr>
                    <th style={{ ...th, textAlign: "left" }}>Line item</th>
                    {showMonths && report.months.map((m) => <th key={m} style={th}>{monthLabel(m)}</th>)}
                    <th style={{ ...th, color: "#1B2A38" }}>Year to date</th>
                  </tr>
                </thead>
                <tbody>
                  <tr><td colSpan={showMonths ? 14 : 2} style={{ padding: "10px 8px 4px", fontSize: 10.5, fontWeight: 700, letterSpacing: 0.4, textTransform: "uppercase", color: "#2F5D50" }}>Income</td></tr>
                  {report.incomeRows.map((r) => (
                    <tr key={r.label} style={{ borderTop: "1px solid #EEE7D6" }}>
                      <td style={{ padding: "7px 8px" }}>
                        {r.label}
                        <NoteRef nums={report.noteRefs[r.label]} />
                      </td>
                      {showMonths && report.months.map((m) => (
                        <td key={m} className="f-mono" style={{ ...td, color: r.row[m] ? "#1B2A38" : "#C7CDD4" }}>{r.row[m] ? rand(r.row[m]) : "—"}</td>
                      ))}
                      <td className="f-mono" style={{ ...td, fontWeight: 600 }}>{rand(r.total)}</td>
                    </tr>
                  ))}
                  <tr style={{ borderTop: "1px solid #1B2A38", background: "#FAF7EF" }}>
                    <td style={{ padding: "7px 8px", fontWeight: 700 }}>Total income</td>
                    {showMonths && report.months.map((m) => (
                      <td key={m} className="f-mono" style={{ ...td, fontWeight: 700 }}>{report.totalIncomeRow[m] ? rand(report.totalIncomeRow[m]) : "—"}</td>
                    ))}
                    <td className="f-mono" style={{ ...td, fontWeight: 700 }}>{rand(report.totalIncome)}</td>
                  </tr>

                  <tr><td colSpan={showMonths ? 14 : 2} style={{ padding: "16px 8px 4px", fontSize: 10.5, fontWeight: 700, letterSpacing: 0.4, textTransform: "uppercase", color: "#B5651D" }}>Expenditure</td></tr>
                  {report.expenseRows.map((r) => (
                    <tr key={r.label} style={{ borderTop: "1px solid #EEE7D6", opacity: r.total === 0 ? 0.5 : 1 }}>
                      <td style={{ padding: "7px 8px" }}>
                        {r.label === UNCLASSIFIED
                          ? <span style={{ color: "#B5651D", fontWeight: 600 }}>{r.label}</span>
                          : r.label}
                        <NoteRef nums={report.noteRefs[r.label]} />
                      </td>
                      {showMonths && report.months.map((m) => (
                        <td key={m} className="f-mono" style={{ ...td, color: r.row[m] ? "#1B2A38" : "#C7CDD4" }}>{r.row[m] ? rand(r.row[m]) : "—"}</td>
                      ))}
                      <td className="f-mono" style={{ ...td, fontWeight: 600 }}>{rand(r.total)}</td>
                    </tr>
                  ))}
                  <tr style={{ borderTop: "1px solid #1B2A38", background: "#FAF7EF" }}>
                    <td style={{ padding: "7px 8px", fontWeight: 700 }}>Total expenditure</td>
                    {showMonths && report.months.map((m) => (
                      <td key={m} className="f-mono" style={{ ...td, fontWeight: 700 }}>{report.totalExpenseRow[m] ? rand(report.totalExpenseRow[m]) : "—"}</td>
                    ))}
                    <td className="f-mono" style={{ ...td, fontWeight: 700 }}>{rand(report.totalExpense)}</td>
                  </tr>
                </tbody>
                <tfoot>
                  <tr style={{ borderTop: "2px solid #1B2A38" }}>
                    <td style={{ padding: "10px 8px", fontWeight: 700, fontSize: 13.5 }}>
                      {report.surplus >= 0 ? "Surplus" : "Deficit"} — income less expenditure
                      <NoteRef nums={report.noteRefs.__surplus__} />
                    </td>
                    {showMonths && report.months.map((m) => (
                      <td key={m} className="f-mono" style={{ ...td, fontWeight: 700, color: report.surplusRow[m] >= 0 ? "#2F5D50" : "#B5651D" }}>
                        {report.surplusRow[m] ? rand(report.surplusRow[m]) : "—"}
                      </td>
                    ))}
                    <td className="f-mono" style={{ ...td, fontWeight: 700, fontSize: 14, color: report.surplus >= 0 ? "#2F5D50" : "#B5651D" }}>
                      {rand(report.surplus)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
            {report.footnotes.length > 0 && (
              <div style={{ marginTop: 18, borderTop: "1px solid #E4DCC8", paddingTop: 12 }}>
                <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: 0.4, textTransform: "uppercase", color: "#64748B", marginBottom: 8 }}>
                  Notes to the statement
                </div>
                <ol style={{ margin: 0, paddingLeft: 20, fontSize: 11.5, color: "#64748B", lineHeight: 1.65 }}>
                  {report.footnotes.map((text, i) => (
                    <li key={i} style={{ marginBottom: 5 }}>{text}</li>
                  ))}
                </ol>
              </div>
            )}

            <div style={{ marginTop: 16, borderTop: "1px solid #E4DCC8", paddingTop: 12 }}>
              <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: 0.4, textTransform: "uppercase", color: "#64748B", marginBottom: 8 }}>
                Basis of preparation
              </div>
              <p style={{ fontSize: 11.5, color: "#94A0AC", margin: 0, lineHeight: 1.65 }}>
                Owner Contributions are attributed to the statement month they settle, so a month column can be read against what that month billed; a payment retargeted by the trustee follows the retarget. Interest, bank charges and council payments have no statement month and sit on their transaction date.
                Payments recorded before the bank statement arrives are included and drop out automatically once the matching bank line is imported.
                Body corp expenses flagged as duplicating a bank line or a deduction claim are excluded.
                The financial year runs August to July.
              </p>
            </div>
          </Card>

          <UsageTrends fy={fy} />
        </div>
      )}
    </>
  );
}

// ---------- AGM annual report (editable .docx) ----------
// Loads the docx library from a CDN once, the same pattern as supabase-js and
// pdf.js elsewhere in this file, so nothing is added to the bundle.
let docxLoadPromise = null;
function ensureDocxLoaded() {
  if (window.docx) return Promise.resolve(window.docx);
  if (docxLoadPromise) return docxLoadPromise;
  docxLoadPromise = new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://cdn.jsdelivr.net/npm/docx@8.5.0/build/index.umd.js";
    s.onload = () => resolve(window.docx);
    s.onerror = () => reject(new Error("Could not load docx"));
    document.head.appendChild(s);
  });
  return docxLoadPromise;
}

// "2025/2026" -> "2026/2027".
function nextFY(fy) {
  const start = Number(String(fy).split("/")[0]);
  return `${start + 1}/${start + 2}`;
}

// Everything the AGM report needs beyond the income & expenditure report
// itself: the unit list, this year's and next year's tariffs, the levy split,
// and the miscellaneous expense detail.
//
// Tariff lookups differ by table on purpose. water_tariff_bands carries a
// populated financial_year, so it is keyed on that. electricity_rates does not
// (the 2026/2027 rate was captured with a null financial_year), so it is
// resolved the way the rest of the app resolves it — the most recent
// effective_from on or before the financial year's first day.
async function fetchAgmExtras(fy) {
  const client = await ensureSupabaseClient();
  const nfy = nextFY(fy);
  const { from, to } = fyBounds(fy);
  const nextFrom = fyBounds(nfy).from;

  const [units, bands, elec, levies, split, itemDefs, ops, txns, invoices, remits, insurance, settings] = await Promise.all([
    client.from("units").select("id, unit_number, participation_quota, sqm").order("unit_number"),
    client.from("water_tariff_bands").select("*").in("financial_year", [fy, nfy]).order("from_kl"),
    client.from("electricity_rates").select("rate_per_kwh, effective_from").order("effective_from"),
    client.from("levy_rates").select("*").in("financial_year", [fy, nfy]),
    client.from("levy_manual_entries").select("unit_id, financial_year, item_label, amount").in("financial_year", [fy, nfy]),
    // The report covers a year that may have closed on a different set of levy
    // lines from the one loaded in the app right now, so section 11 reads the
    // list for THAT year rather than the module binding.
    client.from("levy_item_definitions").select("financial_year, label, system_key, sort_order, active").in("financial_year", [fy, nfy]),
    client.from("ops_expenses").select("expense_date, category, amount, notes")
      .is("superseded_reason", null).gte("expense_date", from).lte("expense_date", to),
    client.from("bank_transactions").select("txn_date, description_raw, amount, direction, expense_category")
      .gte("txn_date", from).lte("txn_date", to),
    // Every month of the year, oldest first — not just the latest one. The
    // "Current" column means the rate the year was billed on, and taking the
    // most recent invoice reported a tariff that rose in the final month as if
    // it had applied all year. Worse, where the new-year figure matched it the
    // report told the meeting the tariff was unchanged when it had just risen.
    client.from("council_invoices")
      .select("period, sewer_charge_per_unit, water_demand_levy_per_unit, electricity_service_fee, electricity_network_fee")
      .gte("period", from).lte("period", to).order("period", { ascending: true }),
    // Approved deductions are a third source of expenditure — a resident paid a
    // Body Corp cost personally and it was set off against their levy. They
    // carry no ops_expenses or bank row of their own.
    client.from("remittance_advices").select("unit_id, period, deduction_approved, deduction_amount, deduction_comment, deductions")
      .gte("period", from).lte("period", to),
    // Insurance schedule and the AGM-approved figures that have no home in
    // levy_rates or the tariff tables. Both are maintained on Config; a year
    // with no row renders as blank cells, exactly as the whole section used to.
    client.from("insurance_schedule").select("*").eq("financial_year", fy),
    // Both years: the year under review carries the Current column and the
    // report metadata; the year ahead carries every figure the meeting votes
    // on. One row per year, keyed by the year the figures APPLY TO.
    client.from("agm_report_settings").select("*").in("financial_year", [fy, nfy]),
  ]);
  const bad = [units, bands, elec, levies, split, itemDefs, ops, txns, invoices, remits, insurance, settings].find((r) => r.error);
  if (bad) throw bad.error;

  const unitList = (units.data || []).map((u) => ({
    id: u.id, no: u.unit_number, pq: Number(u.participation_quota) || 0,
    sqm: u.sqm == null ? null : Number(u.sqm),
  }));

  // Water bands, one row per band with the current and next year's rate side
  // by side. Keyed on band_label so a renamed or reordered band still lines up.
  const byLabel = {};
  (bands.data || []).forEach((b) => {
    const k = b.band_label;
    if (!byLabel[k]) byLabel[k] = { label: k, from: Number(b.from_kl), to: b.to_kl == null ? null : Number(b.to_kl), curr: null, next: null };
    if (b.financial_year === fy) byLabel[k].curr = Number(b.rate_per_kl);
    if (b.financial_year === nfy) byLabel[k].next = Number(b.rate_per_kl);
  });
  const waterBands = Object.values(byLabel).sort((a, b) => a.from - b.from);

  const rateAsOf = (dateStr) => {
    const applicable = (elec.data || []).filter((r) => String(r.effective_from) <= dateStr);
    return applicable.length ? Number(applicable[applicable.length - 1].rate_per_kwh) : null;
  };

  const levyFor = (year) => (levies.data || []).find((r) => r.financial_year === year) || {};

  // Levy split per unit. Next year's grid if it has been captured, otherwise
  // this year's as the starting point for the AGM to adjust.
  const noById = Object.fromEntries(unitList.map((u) => [u.id, u.no]));
  const gridFor = (year) => {
    const out = {};
    (split.data || []).forEach((r) => {
      if (r.financial_year !== year) return;
      const no = noById[r.unit_id];
      if (!no) return;
      if (!out[no]) out[no] = {};
      out[no][r.item_label] = Number(r.amount);
    });
    return out;
  };
  const nextGrid = gridFor(nfy);
  const levySplit = Object.keys(nextGrid).length ? nextGrid : gridFor(fy);
  const levySplitIsCarriedOver = Object.keys(nextGrid).length === 0;

  // The rows section 11 prints, for whichever year `levySplit` came from.
  //
  // Active lines, plus any line removed during that year that still has
  // figures captured against it — the report says what the scheme actually
  // levied, and dropping a line the moment it stops being charged would make
  // the table disagree with the statements the owners were sent. A removed
  // line with no figures is simply omitted; there is nothing to report.
  const levyItemLabelsFor = (year) => {
    const defs = (itemDefs.data || []).filter((d) => d.financial_year === year);
    const grid = gridFor(year);
    const captured = (label) => Object.values(grid).some((row) => row[label] != null);
    return defs
      .filter((d) => d.active !== false || captured(d.label))
      .sort((a, b) => (Number(a.sort_order || 0) - Number(b.sort_order || 0)) || a.label.localeCompare(b.label))
      .map((d) => d.label);
  };
  const splitYear = levySplitIsCarriedOver ? fy : nfy;
  // Falling back to the module binding keeps an un-migrated year rendering
  // rather than producing an empty section.
  const levySplitItems = levyItemLabelsFor(splitYear).length
    ? levyItemLabelsFor(splitYear)
    : LEVY_ITEMS.slice();
  const levySplitRemoved = (itemDefs.data || [])
    .filter((d) => d.financial_year === splitYear && d.active === false && levySplitItems.includes(d.label))
    .map((d) => d.label);

  // Every individual item tagged Miscellaneous, from all three sources that
  // feed an expenditure line in buildFinancialYearReport — operating expenses,
  // bank debits, and approved resident deductions. Listing all three is what
  // makes this table add up to the Miscellaneous line in section 1; omitting
  // deductions was why it previously fell short.
  const MISC = "Miscellaneous";
  const MAINT = "Repairs & Maintenance";
  const itemisedBy = (match, label) => {
    const out = [];
    (ops.data || []).forEach((e) => {
      if (!match(e.category)) return;
      out.push({ date: e.expense_date, amount: round2(Math.abs(Number(e.amount) || 0)), desc: e.notes || label, source: "Body corp expense" });
    });
    (txns.data || []).forEach((t) => {
      if (t.direction !== "debit" || !match(t.expense_category)) return;
      out.push({ date: t.txn_date, amount: round2(Math.abs(Number(t.amount) || 0)), desc: t.description_raw || label, source: "Bank payment" });
    });
    (remits.data || []).forEach((r) => {
      if (!r.deduction_approved) return;
      // Same shape-tolerance as the report: a claim either itemises its
      // deductions or carries a single untagged amount (which lands in
      // Unclassified, not here).
      const items = Array.isArray(r.deductions) && r.deductions.length
        ? r.deductions
        : (Number(r.deduction_amount) > 0 ? [{ amount: r.deduction_amount, expenseCategory: null, description: r.deduction_comment }] : []);
      items.forEach((it) => {
        if (!match(it.expenseCategory || null)) return;
        const amount = round2(Math.abs(Number(it.amount) || 0));
        if (!(amount > 0)) return;
        const who = noById[r.unit_id] ? `Unit ${noById[r.unit_id]}` : "a unit";
        // Each line of a claim carries its own `comment`; the claim-level
        // deduction_comment is only a fallback for a single untagged amount.
        // Using the claim comment per item would print the whole claim's text
        // against every one of its lines.
        const what = it.comment || it.description || it.note || r.deduction_comment || label;
        out.push({
          date: r.period,
          amount,
          desc: `${what} — paid by ${who}, recovered by levy deduction`,
          source: "Approved deduction",
        });
      });
    });
    return out.sort((a, b) => String(a.date).localeCompare(String(b.date)));
  };
  const itemisedFor = (category) => itemisedBy((c) => c === category, category);
  // Sections 4 and 5 are the same table over two different categories, so they
  // are built by the same function rather than a second hand-written copy that
  // could drift.
  const misc = itemisedFor(MISC);
  const maintenance = itemisedFor(MAINT);

  // Blockwatch is carried by the Body Corp and paid by a unit. It used to be
  // read from ops_expenses alone, which is why section 6 reported R 0.00 for a
  // year in which R 1,800.00 was paid: the unit that carries it pays it
  // personally every month and recovers it as an approved levy deduction, so
  // there is no ops_expenses row and no bank row — all twelve payments are
  // deductions. It now goes through the same three-source path as every other
  // expenditure line, which is what Garden Service (section 7) already did.
  // Matched case-insensitively because the category reads "BlockWatch" while
  // the operating-expense log has used "Blockwatch (actual cost)".
  const bwItems = itemisedBy((c) => /blockwatch/i.test(String(c || "")), "BlockWatch");
  const bwTotal = round2(bwItems.reduce((s, i) => s + i.amount, 0));
  // Distinct statement months, not item count: a month where Blockwatch shares
  // a claim with something else is still one month, and two entries in one
  // month must not halve the implied monthly fee.
  const bwMonthCount = new Set(bwItems.map((i) => String(i.date).slice(0, 7))).size;
  // Council tariffs for the "Current — FY" column. The rate the year opened on
  // is the one the scheme was billed on for the bulk of it, so that is what
  // "current" means here; a change part-way through is reported separately
  // rather than silently replacing it.
  const invRows = invoices.data || [];
  const rateAtStart = (field) => {
    const r = invRows.find((x) => x[field] != null);
    return r ? Number(r[field]) : null;
  };
  const rateChange = (field) => {
    const first = invRows.find((x) => x[field] != null);
    if (!first) return null;
    const moved = invRows.find((x) => x[field] != null && Number(x[field]) !== Number(first[field]));
    return moved ? { from: Number(first[field]), to: Number(moved[field]), at: moved.period } : null;
  };

  // Insurance schedule keyed by unit number. Per-annum is the sum of the four
  // charge columns and per-month is a twelfth of it — both derived here rather
  // than stored, so a total can never disagree with its own components. The
  // schedule total is the sum of the rounded per-unit figures, which is how the
  // insurer's own schedule adds up.
  const insById = Object.fromEntries((insurance.data || []).map((r) => [r.unit_id, r]));
  const insuranceRows = unitList.map((u) => {
    const r = insById[u.id];
    if (!r) return { no: u.no, sqm: u.sqm, sumInsured: null, premium: null, commonProperty: null, sasria: null, broker: null, perAnnum: null, perMonth: null };
    const premium = r.premium == null ? null : Number(r.premium);
    const cp = r.common_property == null ? null : Number(r.common_property);
    const sasria = r.sasria == null ? null : Number(r.sasria);
    const broker = r.broker_fee == null ? null : Number(r.broker_fee);
    const parts = [premium, cp, sasria, broker];
    const perAnnum = parts.every((v) => v == null) ? null : round2(parts.reduce((s, v) => s + (v || 0), 0));
    return {
      no: u.no, sqm: u.sqm,
      sumInsured: r.sum_insured == null ? null : Number(r.sum_insured),
      premium, commonProperty: cp, sasria, broker,
      perAnnum, perMonth: perAnnum == null ? null : round2(perAnnum / 12),
    };
  });
  const insuranceHasData = insuranceRows.some((r) => r.perAnnum != null || r.sumInsured != null);

  // agm_report_settings holds ONE row per financial year, carrying the figures
  // that apply to THAT year. There is no longer a "current" column beside a
  // "proposed" one — they are the same column on two rows, which is why the
  // report reads two: the year under review for the Current column, the year
  // ahead for the New column. Before 11 August 2026 both lived on one row and
  // every FY 2026/2027 proposal was filed under 2025/2026.
  const settingsFor = (year) => {
    const st = (settings.data || []).find((r) => r.financial_year === year) || {};
    const n = (v) => (v == null ? null : Number(v));
    return {
      fy: year,
      gardenRatePerDay: n(st.garden_rate_per_day),
      gardenIncreasePct: n(st.garden_increase_pct),
      gardenVisitsPerMonth: n(st.garden_visits_per_month),
      gardenBonusAmount: n(st.garden_bonus_amount),
      gardenBonusDueDate: st.garden_bonus_due_date || null,
      gardenIncreaseEffectiveDate: st.garden_increase_effective_date || null,
      blockwatchMonthly: n(st.blockwatch_monthly),
      // The four bill-driven charges. No council source until the tariff is
      // published, so for a future year these are the meeting's proposals; once
      // applied they are also written to levy_rates, which is what the billing
      // engine and the Current column read.
      seweragePerUnit: n(st.sewerage_per_unit),
      waterDemandLevy: n(st.water_demand_levy),
      electricityServiceFee: n(st.electricity_service_fee),
      electricityNetworkFee: n(st.electricity_network_fee),
      waterReconciliationFactor: n(st.water_reconciliation_factor),
      // Reserve fund, section 12. Neither is derivable: the basis is an
      // unresolved reading of Regulation 2, and the designation is a decision
      // the meeting takes.
      reserveBasis: st.reserve_contribution_basis || null,
      reserveProposedDesignation: n(st.reserve_proposed_designation),
      // Report metadata — these describe the document, not a rate, so they stay
      // on the year the report covers.
      servicesNoteAnnualEstimate: n(st.services_note_annual_estimate),
      preparedBy: st.prepared_by || null,
      checkedBy: st.checked_by || null,
      figuresApprovedOn: st.figures_approved_on || null,
      figuresApprovedBy: st.figures_approved_by || null,
      figuresAppliedAt: st.figures_applied_at || null,
    };
  };

  return {
    fy, nfy, units: unitList, waterBands,
    elecCurr: rateAsOf(from), elecNext: rateAsOf(nextFrom),
    levyCurr: levyFor(fy), levyNext: levyFor(nfy),
    levySplit, levySplitIsCarriedOver, levySplitItems, levySplitRemoved,
    misc, maintenance,
    insuranceRows, insuranceHasData,
    settings: settingsFor(fy),
    settingsNext: settingsFor(nfy),
    blockwatch: { actualTotal: bwTotal, monthCount: bwMonthCount, monthly: bwMonthCount ? round2(bwTotal / bwMonthCount) : null },
    sewerPerUnit: rateAtStart("sewer_charge_per_unit"),
    demandLevyPerUnit: rateAtStart("water_demand_levy_per_unit"),
    sewerChange: rateChange("sewer_charge_per_unit"),
    demandLevyChange: rateChange("water_demand_levy_per_unit"),
    elecServiceFeeInvoiced: rateAtStart("electricity_service_fee"),
    elecNetworkFeeInvoiced: rateAtStart("electricity_network_fee"),
  };
}

// Builds and downloads the AGM annual report as an editable .docx. Sections the
// database can fill are filled; the rest render as tables with empty cells so
// the figures can be typed straight into Word before the meeting.
async function exportAgmReportDocx({ fy, report, prevReport, extras, usage, bank, plan, floor, budget }) {
  const D = await ensureDocxLoaded();
  const {
    Document, Packer, Paragraph, TextRun, HeadingLevel,
    Table, TableRow, TableCell, WidthType, AlignmentType, PageOrientation, ImageRun,
  } = D;
  const {
    nfy, units, waterBands, elecCurr, elecNext, levyCurr, levyNext,
    levySplit, levySplitIsCarriedOver, levySplitItems, levySplitRemoved, misc, maintenance,
    insuranceRows, insuranceHasData, settings, settingsNext, blockwatch, sewerPerUnit, demandLevyPerUnit,
    sewerChange, demandLevyChange, elecServiceFeeInvoiced, elecNetworkFeeInvoiced,
  } = extras;
  const prev = prevReport && prevReport.hasData ? prevReport : null;

  // ---------- Money format for the whole report: "R 123 123 123.12" ----------
  // Trustee's house style, 11 August 2026: a space after the R, spaces between
  // thousands, and a FULL STOP for the decimal.
  //
  // Formatted by hand rather than through `toLocaleString("en-ZA")`, which is
  // what produced the old "R123 123 123,12". en-ZA is a comma-decimal locale,
  // so the separator could not be changed without post-processing the string
  // anyway, and the space it emits between thousands varies by engine (plain,
  // no-break and narrow no-break have all been seen in the wild). Building the
  // digits ourselves makes the output identical wherever the report is run.
  //
  // Every space is a non-breaking space, written as an escape, so an amount can
  // never be split across two lines inside a narrow table cell. That was the
  // reason `nb()` existed and it still holds.
  const NBSP = "\u00A0";
  const nb = (s) => String(s).replace(/\s/g, NBSP);
  // Unsigned digits — "123 123 123.12". Never called directly; both formatters
  // below add the sign themselves, so neither can drop one.
  const digits = (n) => {
    const [whole, frac] = Math.abs(round2(Number(n) || 0)).toFixed(2).split(".");
    return `${whole.replace(/\B(?=(\d{3})+(?!\d))/g, NBSP)}.${frac}`;
  };
  const sign = (n) => (round2(Number(n) || 0) < 0 ? "-" : "");
  // No R prefix — for the wide grids that carry an "all figures in rand" note
  // instead. These hold expenses and differences, so the sign matters.
  const dec = (n) => `${sign(n)}${digits(n)}`;
  // The minus sits before the R, never between it and the digits: "-R 1 234.56".
  const money = (n) => (n == null || n === "" ? "" : `${sign(n)}R${NBSP}${digits(n)}`);
  // "2027-01-01" -> "01-January-2027", the form the template uses for the
  // increase and bonus dates. Parsed off the string rather than through Date,
  // which would shift the day in a negative-offset timezone.
  const longDate = (iso) => {
    if (!iso) return "";
    const [y, m, d] = String(iso).slice(0, 10).split("-");
    const name = MONTH_NAMES[Number(m) - 1];
    return name ? nb(`${d}-${name}-${y}`) : "";
  };
  const pct = (n) => (n == null || n === "" ? "" : `${Number(n)}%`);
  // Same value without the "R" prefix, for grids wide enough that repeating the
  // prefix on every column is what pushes an amount onto a second line. Those
  // tables carry an "all figures in rand" note instead.
  const amt = (n) => (n == null || n === "" ? "" : nb(dec(n)));

  const H1 = (text) => new Paragraph({ text, heading: HeadingLevel.HEADING_1, spacing: { before: 320, after: 140 } });
  const H2 = (text) => new Paragraph({ text, heading: HeadingLevel.HEADING_2, spacing: { before: 200, after: 100 } });
  const para = (text, opts = {}) => new Paragraph({ spacing: { after: 100 }, children: [new TextRun({ text, ...opts })] });
  const hint = (text) => para(text, { italics: true, size: 18, color: "94A0AC" });
  const tc = (text, { bold = false, align = "left", shade, size, tight = false } = {}) => new TableCell({
    shading: shade ? { fill: shade } : undefined,
    margins: tight ? { top: 20, bottom: 20, left: 40, right: 40 } : { top: 40, bottom: 40, left: 90, right: 90 },
    children: [new Paragraph({
      alignment: align === "right" ? AlignmentType.RIGHT : (align === "center" ? AlignmentType.CENTER : AlignmentType.LEFT),
      children: [new TextRun({ text: text == null || text === "" ? "" : String(text), bold, size })],
    })],
  });
  const row = (cells, aligns = [], bold = false, shade, opts = {}) =>
    new TableRow({ children: cells.map((c, i) => tc(c, { bold, align: aligns[i] || "left", shade, ...opts })) });
  const tbl = (rows) => new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows });
  const hrow = (labels, aligns = [], opts = {}) => new TableRow({
    tableHeader: true,
    children: labels.map((l, i) => new TableCell({
      shading: { fill: "1B2A38" },
      margins: opts.tight ? { top: 20, bottom: 20, left: 40, right: 40 } : { top: 40, bottom: 40, left: 90, right: 90 },
      children: [new Paragraph({
        alignment: aligns[i] === "right" ? AlignmentType.RIGHT : (aligns[i] === "center" ? AlignmentType.CENTER : AlignmentType.LEFT),
        children: [new TextRun({ text: String(l), bold: true, color: "FFFFFF", size: opts.size })],
      })],
    })),
  });
  const BAND = "E7E1D3";
  // Wide grids get 8pt text and tighter padding so a full "1 234,56" stays on
  // one line instead of wrapping mid-number.
  const WIDE = { size: 16, tight: true };

  // ---------- Portrait A: cover + section 1 ----------
  const A = [];
  A.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 60 }, children: [new TextRun({ text: "El Corazon Body Corporate", bold: true, size: 40 })] }));
  A.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 40 }, children: [new TextRun({ text: `Annual General Meeting report — FY ${fy}`, size: 28 })] }));
  A.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 240 }, children: [new TextRun({ text: fyLabel(fy), italics: true, color: "64748B", size: 20 })] }));

  A.push(H1("1. Income & expenditure — year on year"));
  const a1 = [hrow(["Line", `FY ${previousFY(fy)}`, `FY ${fy}`], ["left", "right", "right"])];
  const yoy = (label, cur, isPrev) => row([label, isPrev == null ? "" : isPrev, cur], ["left", "right", "right"]);
  a1.push(row(["Income", "", ""], [], true, BAND));
  report.incomeRows.forEach((r) => {
    const p = prev && prev.incomeRows.find((x) => x.label === r.label);
    a1.push(yoy(r.label, money(r.total), p ? money(p.total) : ""));
  });
  a1.push(row(["Total income", prev ? money(prev.totalIncome) : "", money(report.totalIncome)], ["left", "right", "right"], true));
  a1.push(row(["Expenditure", "", ""], [], true, BAND));
  report.expenseRows.forEach((r) => {
    const p = prev && prev.expenseRows.find((x) => x.label === r.label);
    a1.push(yoy(r.label, money(r.total), p ? money(p.total) : ""));
  });
  a1.push(row(["Total expenditure", prev ? money(prev.totalExpense) : "", money(report.totalExpense)], ["left", "right", "right"], true));
  a1.push(row(["Surplus / (deficit)", prev ? money(prev.surplus) : "", money(report.surplus)], ["left", "right", "right"], true, BAND));
  A.push(tbl(a1));
  if (!prev) {
    A.push(hint(`FY ${previousFY(fy)} predates the system, so the comparative column is left blank — type last year's approved figures in before the meeting.`));
  }

  // ---------- Landscape B: section 2 ----------
  const B = [];
  B.push(H1("2. Income & expenditure — month to month"));
  // "2025-08" -> "Aug 25", matching the column headings on the dashboard.
  const mLabel = (ym) => {
    const [y, m] = String(ym).split("-");
    return `${MONTH_NAMES[Number(m) - 1].slice(0, 3)} ${y.slice(2)}`;
  };
  const mAligns = ["left", ...report.months.map(() => "right"), "right"];
  const b2 = [hrow(["Line", ...report.months.map(mLabel), "Total"], mAligns, WIDE)];
  const brow = (cells, bold = false, shade) => row(cells, mAligns, bold, shade, WIDE);
  const mrow = (r) => brow([r.label, ...report.months.map((m) => amt(r.row[m])), amt(r.total)]);
  b2.push(brow(["Income", ...report.months.map(() => ""), ""], true, BAND));
  report.incomeRows.forEach((r) => b2.push(mrow(r)));
  b2.push(brow(["Total income", ...report.months.map((m) => amt(report.totalIncomeRow[m])), amt(report.totalIncome)], true));
  b2.push(brow(["Expenditure", ...report.months.map(() => ""), ""], true, BAND));
  report.expenseRows.forEach((r) => b2.push(mrow(r)));
  b2.push(brow(["Total expenditure", ...report.months.map((m) => amt(report.totalExpenseRow[m])), amt(report.totalExpense)], true));
  b2.push(brow(["Surplus / (deficit)", ...report.months.map((m) => amt(report.surplusRow[m])), amt(report.surplus)], true, BAND));
  B.push(tbl(b2));
  B.push(hint("All figures in rand, including cents. The R prefix is dropped so each amount stays on one line. Owner contributions sit in the statement month they settle, not the month the money arrived."));

  // ---------- Portrait BK: section 3, bank account ----------
  // Sections 1 and 2 are the accrual view. This is the cash counterpart, and
  // the only part of the report a member can check against a document the bank
  // sent. It therefore reports not just the position but whether the position
  // is PROVEN — each month either ties to its own statement or it does not.
  const BK = [];
  BK.push(H1("3. Bank account"));
  if (!bank) {
    BK.push(hint(`The bank account summary could not be loaded for FY ${fy}, so this section is omitted. It rebuilds from the imported statements — check Bank recon and generate the report again.`));
  } else {
    const bt = bank.totals;
    BK.push(para(
      `Money on Call account${bank.accountNumber ? ` ${bank.accountNumber}` : ""}. Opening and closing balances are the figures printed on the bank's own statements, not a calculated position.`,
      { size: 20 }));

    const pAligns = ["left", "right"];
    const pRows = [hrow(["Position", `FY ${fy}`], pAligns)];
    pRows.push(row(["Opening balance", bt.opening == null ? "—" : money(bt.opening)], pAligns));
    pRows.push(row([`Money in (${bank.months.reduce((s, m) => s + (m.credits > 0 ? 1 : 0), 0)} months)`, money(bt.credits)], pAligns));
    pRows.push(row(["Money out", money(bt.debits)], pAligns));
    pRows.push(row(["Net movement", money(bt.movement)], pAligns, true));
    pRows.push(row(["Closing balance", bt.closing == null ? "—" : money(bt.closing)], pAligns, true, BAND));
    BK.push(tbl(pRows));

    // Cash cover. The figure that separates a balance which looks healthy from
    // one that is, and the reason it belongs in front of a meeting being asked
    // to fund a reserve.
    if (bank.monthsOfCover != null) {
      BK.push(H2("Cash cover"));
      const cAligns = ["left", "right"];
      const cRows = [hrow(["", `FY ${fy}`], cAligns)];
      cRows.push(row(["Average monthly expenditure", money(bank.avgMonthlySpend)], cAligns));
      cRows.push(row(["Closing balance", money(bt.closing)], cAligns));
      cRows.push(row(["Months of expenditure covered", nb(`${bank.monthsOfCover.toFixed(1)} months`)], cAligns, true, BAND));
      BK.push(tbl(cRows));
      BK.push(para(
        bank.monthsOfCover >= 12
          ? `The closing balance covers ${bank.monthsOfCover.toFixed(1)} months of the year's average spend — over a full year of expenditure held in cash. A balance this size is normally the sign of a scheme that has been accumulating without a stated purpose for the money, which is what section 12 addresses.`
          : bank.monthsOfCover >= 3
            ? `The closing balance covers ${bank.monthsOfCover.toFixed(1)} months of the year's average spend.`
            : `The closing balance covers only ${bank.monthsOfCover.toFixed(1)} months of the year's average spend. A scheme with no reserve and under three months of cover has no capacity to absorb an unplanned repair without a special levy.`,
        { size: 20 }));
    }

    BK.push(H2("Month by month"));
    const mAl = ["left", "right", "right", "right", "right", "center"];
    const mRows = [hrow(["Month", "Opening", "In", "Out", "Closing", "Reconciled"], mAl, WIDE)];
    bank.months.forEach((m) => {
      mRows.push(row([
        m.label,
        m.opening == null ? "—" : amt(m.opening),
        m.credits ? amt(m.credits) : "—",
        m.debits ? amt(m.debits) : "—",
        m.closing == null ? "—" : amt(m.closing),
        !m.hasStatement ? "no statement" : m.reconciled ? "yes" : `out by ${amt(m.drift)}`,
      ], mAl, false, m.hasStatement && !m.reconciled ? "F4E7E7" : undefined, WIDE));
    });
    mRows.push(row([
      "Year", bt.opening == null ? "—" : amt(bt.opening), amt(bt.credits), amt(bt.debits),
      bt.closing == null ? "—" : amt(bt.closing),
      bt.drift != null && Math.abs(bt.drift) <= 0.005 ? "yes" : (bt.drift == null ? "—" : `out by ${amt(bt.drift)}`),
    ], mAl, true, BAND, WIDE));
    BK.push(tbl(mRows));
    BK.push(hint("All figures in rand, without the R prefix so no amount wraps. Reconciled means the statement's own opening and closing balances bracket that month's movements exactly."));

    BK.push(H2("Verification"));
    const vAligns = ["left", "right"];
    const vRows = [hrow(["", `FY ${fy}`], vAligns)];
    vRows.push(row(["Statements imported", nb(`${bank.statementsPresent} of ${bank.statementsExpected}`)], vAligns));
    vRows.push(row(["Months reconciling to the statement", nb(`${bank.monthsReconciled} of ${bank.statementsPresent}`)], vAligns));
    vRows.push(row(["Transactions recorded", String(bank.months.reduce((s, m) => s + m.lineCount, 0))], vAligns));
    BK.push(tbl(vRows));
    if (bank.monthsReconciled === bank.statementsExpected) {
      BK.push(para(
        `Every month of FY ${fy} reconciles to its bank statement to the cent. The income and expenditure statement in section 1 is built on transactions that have been checked line by line against what the bank printed.`,
        { size: 20 }));
    }
    if (bank.monthsMissing.length) {
      BK.push(hint(`No statement is imported for ${bank.monthsMissing.join(", ")}. Those months carry no verified position — import them on Bank recon.`));
    }
    if (bank.monthsUnreconciled.length) {
      BK.push(hint(`${bank.monthsUnreconciled.join(", ")} ${bank.monthsUnreconciled.length === 1 ? "does" : "do"} not reconcile to the imported statement. The difference is shown against the month above and needs resolving before the accounts are presented.`));
    }
    if (bank.derivedMonths.length) {
      BK.push(hint(`Opening and closing for ${bank.derivedMonths.join(", ")} were derived from the transaction lines rather than read off the statement header. Re-importing the PDF replaces them with the printed figures.`));
    }
  }

  // ---------- Portrait C: sections 4 and 5 ----------
  const C = [];

  // Sections 4 and 5 are the same table over two expense categories. The total
  // is taken from the report's own line rather than from the sum of the rows
  // above, so the table can never contradict the figure on the dashboard and in
  // section 1 — and where the two disagree the document says so rather than
  // quietly printing a total the rows don't support.
  const itemisedSection = (heading, items, reportLabel, emptyText) => {
    const out = [];
    out.push(H1(heading));
    const aligns = ["left", "left", "right", "left"];
    const rows = [hrow(["Month", "Year", "Amount", "Description"], aligns)];
    items.forEach((it) => {
      const y = String(it.date).slice(0, 4);
      const m = MONTH_NAMES[parseInt(String(it.date).slice(5, 7), 10) - 1] || "";
      rows.push(row([m, y, money(it.amount), it.desc], aligns));
    });
    if (!items.length) rows.push(row(["", "", "", emptyText], aligns));
    const itemised = round2(items.reduce((s, it) => s + it.amount, 0));
    const reported = round2((report.expenseRows.find((r) => r.label === reportLabel) || {}).total || 0);
    rows.push(row(["Total", "", money(reported), ""], aligns, true, BAND));
    out.push(tbl(rows));
    if (Math.abs(reported - itemised) > 0.005) {
      out.push(hint(`The total shown is the ${reportLabel} line from section 1 (${money(reported)}); the rows above itemise ${money(itemised)}. The ${money(round2(Math.abs(reported - itemised)))} difference means an item is tagged ${reportLabel} somewhere the itemisation doesn't reach — check the Tenant recon and Body corp expenses pages before the meeting.`));
    }
    return out;
  };

  itemisedSection("4. Miscellaneous expenses", misc, "Miscellaneous", "No miscellaneous expenses recorded this year.").forEach((el) => C.push(el));
  itemisedSection("5. Maintenance expenses", maintenance, "Repairs & Maintenance", "No maintenance expenses recorded this year.").forEach((el) => C.push(el));

  // ---------- Landscape D: section 6 ----------
  const Dsec = [];
  Dsec.push(H1("6. Insurance schedule (per unit)"));
  const insCols = ["Unit No", "Sqm", "Sum Ins", "Premium", "Com Prop", "Sasria", "Broker", "Per Annum", "Per Month"];
  const insAligns = ["left", "right", "right", "right", "right", "right", "right", "right", "right"];
  const c4 = [hrow(insCols, insAligns)];
  // Per annum and per month are derived, never stored, so the schedule cannot
  // hold a total that disagrees with its own components. The column totals sum
  // the rounded per-unit figures — which is how the insurer's schedule adds up,
  // and half a cent off summing the raw values.
  const insTotals = { premium: 0, commonProperty: 0, sasria: 0, broker: 0, perAnnum: 0, perMonth: 0 };
  insuranceRows.forEach((r) => {
    Object.keys(insTotals).forEach((k) => { insTotals[k] = round2(insTotals[k] + (r[k] || 0)); });
    c4.push(row([
      `Unit ${r.no}`,
      r.sqm == null ? "" : String(r.sqm),
      r.sumInsured == null ? "" : money(r.sumInsured),
      r.premium == null ? "" : money(r.premium),
      r.commonProperty == null ? "" : money(r.commonProperty),
      r.sasria == null ? "" : money(r.sasria),
      r.broker == null ? "" : money(r.broker),
      r.perAnnum == null ? "" : money(r.perAnnum),
      r.perMonth == null ? "" : money(r.perMonth),
    ], insAligns));
  });
  c4.push(row([
    "Total", "", "",
    insTotals.premium ? money(insTotals.premium) : "",
    insTotals.commonProperty ? money(insTotals.commonProperty) : "",
    insTotals.sasria ? money(insTotals.sasria) : "",
    insTotals.broker ? money(insTotals.broker) : "",
    insTotals.perAnnum ? money(insTotals.perAnnum) : "",
    insTotals.perMonth ? money(insTotals.perMonth) : "",
  ], insAligns, true, BAND));
  Dsec.push(tbl(c4));
  Dsec.push(hint(insuranceHasData
    ? `Per annum is premium plus common property, Sasria and broker fee; per month is a twelfth of it. Maintained on Config — edit the schedule there rather than in this document, so next year's report carries it forward. On landscape so the nine columns fit without splitting an amount across lines.`
    : `No insurance schedule has been captured for FY ${fy}, so the cells are blank for entry from the insurer's schedule. Capture it on Config to have this table fill automatically.`));

  // ---------- Portrait E: sections 7, 8 and 9 ----------
  const E = [];
  const CUR = `Current — FY ${fy}`;
  const NEW = `New — FY ${nfy}`;

  E.push(H1("7. Blockwatch"));
  // The recorded monthly figure is the average of what actually went out; the
  // agreed fee is the one the meeting votes on, so a captured setting wins.
  const bwCurrent = settings.blockwatchMonthly != null ? settings.blockwatchMonthly : blockwatch.monthly;
  // The total shown is the BlockWatch line from section 1, exactly as garden
  // service below takes its own — so this table cannot contradict the figure on
  // the dashboard and in section 1. `blockwatch.actualTotal` is the same
  // arithmetic from the same three sources and is used to derive the monthly
  // fee; a disagreement between them is reported rather than papered over.
  const bwReported = (report.expenseRows.find((r) => r.label === "BlockWatch") || {}).total;
  const bwTotalShown = bwReported == null ? blockwatch.actualTotal : bwReported;
  const c5 = [hrow(["Item", "Amount"], ["left", "right"])];
  c5.push(row(["Monthly fee payable — current", bwCurrent == null ? "" : money(bwCurrent)], ["left", "right"]));
  c5.push(row([`Total paid in FY ${fy} (recorded)`, money(bwTotalShown)], ["left", "right"]));
  c5.push(row([`Monthly fee payable — proposed FY ${nfy}`,
    settingsNext.blockwatchMonthly == null ? "" : money(settingsNext.blockwatchMonthly)], ["left", "right"]));
  E.push(tbl(c5));
  const bwUnchanged = settingsNext.blockwatchMonthly != null && bwCurrent != null
    && round2(settingsNext.blockwatchMonthly) === round2(bwCurrent);
  E.push(para(
    bwUnchanged
      ? "Blockwatch contribution remains unchanged."
      : "Carried by the Body Corp and paid directly by a unit, then recovered by levy deduction against proof of payment — so it shows at R 0.00 on the levy statement.",
    { size: 20 }));
  if (bwReported != null && Math.abs(round2(bwReported - blockwatch.actualTotal)) > 0.005) {
    E.push(hint(`The total shown is the BlockWatch line from section 1 (${money(bwReported)}); itemising the operating expenses, bank debits and approved deductions tagged BlockWatch gives ${money(blockwatch.actualTotal)}. Check the Tenant recon and Body corp expenses pages before the meeting.`));
  } else if (blockwatch.monthCount && blockwatch.monthCount < 12) {
    E.push(hint(`Recorded over ${blockwatch.monthCount} of the year's 12 months — the remaining ${12 - blockwatch.monthCount} carry no BlockWatch expense, bank debit or approved deduction. If the fee was paid in those months it hasn't been captured.`));
  }

  E.push(H1("8. Garden service"));
  const gardenActual = (report.expenseRows.find((r) => r.label === "Garden Service") || {}).total || 0;
  // The current rate is this year's row; everything proposed is next year's.
  // They are the same columns on two rows now, which is what makes "proposed"
  // and "approved" the same field at different points in time.
  const gs = settings, gn = settingsNext;
  // Projected cost is derived from the proposed rate rather than typed, so it
  // moves with the increase instead of being a figure to remember to update.
  const gnVisits = gn.gardenVisitsPerMonth != null ? gn.gardenVisitsPerMonth : gs.gardenVisitsPerMonth;
  const projectedAnnual = gn.gardenRatePerDay != null && gnVisits != null
    ? round2(gn.gardenRatePerDay * gnVisits * 12) : null;
  const bonusLabel = gn.gardenBonusDueDate
    ? `Proposed year-end bonus (Payable by ${longDate(gn.gardenBonusDueDate)})`
    : "Proposed year-end bonus";
  const projLabel = gnVisits != null
    ? `Projected Annual cost — based on ${gnVisits} visits per month`
    : "Projected Annual cost";
  const c6 = [hrow(["Item", "Amount / value"], ["left", "right"])];
  c6.push(row([`Total salary costs FY ${fy} (actual)`, money(gardenActual)], ["left", "right"]));
  c6.push(row(["Current Rate Per Day", gs.gardenRatePerDay == null ? "" : money(gs.gardenRatePerDay)], ["left", "right"]));
  c6.push(row(["Proposed salary increase (%)", pct(gn.gardenIncreasePct)], ["left", "right"]));
  c6.push(row([`Proposed salary for FY ${nfy} — Per Day`, gn.gardenRatePerDay == null ? "" : money(gn.gardenRatePerDay)], ["left", "right"]));
  c6.push(row([bonusLabel, gn.gardenBonusAmount == null ? "" : money(gn.gardenBonusAmount)], ["left", "right"]));
  c6.push(row(["Increase Effective Date", longDate(gn.gardenIncreaseEffectiveDate)], ["left", "right"]));
  c6.push(row([projLabel, projectedAnnual == null ? "" : money(projectedAnnual)], ["left", "right"]));
  E.push(tbl(c6));
  E.push(hint("Actual cost is the spend recorded this year. Rate, increase, bonus and effective date are maintained on Config and are for approval at the meeting; the projected annual cost is the proposed rate times the visits per month, over twelve months."));

  // Water and electricity sit under one Tariffs heading, with the usage trends
  // as the closing subsection — the charts read against the rates the meeting
  // is being asked to approve.
  E.push(H1("9. Tariffs"));
  E.push(H2("Water — Increasing block tariff (R / kL)"));
  const c7 = [hrow(["Band (kL)", CUR, NEW], ["left", "right", "right"])];
  waterBands.forEach((b) => c7.push(row([b.label, b.curr == null ? "" : money(b.curr), b.next == null ? "" : money(b.next)], ["left", "right", "right"])));
  E.push(tbl(c7));
  E.push(H2("Provision, demand levy and sewerage"));
  // The New column for the bill-driven charges. An AGM-approved figure captured
  // against next year in levy_rates wins; otherwise the proposal captured on
  // Config, which is the only place these can be entered — Tariffs & rates
  // dropped the three inputs when the charges moved to the invoice-driven
  // model, so without this fallback the cells were a permanent blank. Tracks
  // whether anything is still uncaptured, so the closing hint below only fires
  // when there is actually a gap to fill in Word.
  let newGap = false;
  const newCell = (approved, proposed) => {
    const v = approved != null ? approved : proposed;
    if (v == null) { newGap = true; return ""; }
    return money(v);
  };
  const c7b = [hrow(["Item", CUR, NEW], ["left", "right", "right"])];
  const cpw = (l) => (l.common_property_water_kl == null ? "" : nb(`${Number(l.common_property_water_kl)} kL`));
  c7b.push(row(["Common property provision (kL / month)", cpw(levyCurr) || nb(`${COMMON_PROPERTY_WATER_KL_DEFAULT} kL`), cpw(levyNext)], ["left", "right", "right"]));
  c7b.push(row(["Water Demand Levy (per unit / month) excl VAT",
    money(levyCurr.water_demand_levy != null ? levyCurr.water_demand_levy : demandLevyPerUnit),
    newCell(levyNext.water_demand_levy, settingsNext.waterDemandLevy)], ["left", "right", "right"]));
  // The New column has no council source until the tariff is published, so it
  // is captured on Config alongside the other AGM figures.
  c7b.push(row(["Sewerage (per unit / month) excl VAT",
    sewerPerUnit == null ? "" : money(sewerPerUnit),
    newCell(null, settingsNext.seweragePerUnit)], ["left", "right", "right"]));
  E.push(tbl(c7b));
  // A council tariff that moved part-way through the year would otherwise be
  // invisible: the Current column carries the rate the year opened on, so the
  // increase already charged needs saying out loud before the meeting is asked
  // to approve next year's.
  // Only for rows whose Current figure actually came off the council invoice.
  // The demand levy row prefers the levy_rates figure — what the scheme bills a
  // unit — and that is a different number from what the council charges, so
  // reporting a council movement against it would be comparing two things.
  const tariffMoves = [
    sewerChange && `sewerage rose from ${money(sewerChange.from)} to ${money(sewerChange.to)} per unit in ${periodLabel(sewerChange.at)}`,
    levyCurr.water_demand_levy == null && demandLevyChange
      && `the water demand levy rose from ${money(demandLevyChange.from)} to ${money(demandLevyChange.to)} per unit in ${periodLabel(demandLevyChange.at)}`,
  ].filter(Boolean);
  if (tariffMoves.length) {
    E.push(hint(`The Current column is the rate FY ${fy} opened on. During the year ${tariffMoves.join(", and ")} — so part of the increase has already been charged.`));
  }

  E.push(H2("Electricity — Increasing tariffs"));
  const c8 = [hrow(["Item", CUR, NEW], ["left", "right", "right"])];
  c8.push(row(["Flat rate (R / kWh)",
    elecCurr == null ? "" : nb("R " + elecCurr.toFixed(4)),
    elecNext == null ? "" : nb("R " + elecNext.toFixed(4))], ["left", "right", "right"]));
  const cpe = (l) => (l.common_property_electricity_kwh == null ? "" : nb(`${Number(l.common_property_electricity_kwh)} kWh`));
  c8.push(row(["Common property provision (kWh / month)", cpe(levyCurr) || nb(`${COMMON_PROPERTY_ELECTRICITY_KWH_DEFAULT} kWh`), cpe(levyNext)], ["left", "right", "right"]));
  // An AGM-approved figure in levy_rates wins. Where there isn't one, the
  // uploaded council bill is the next best evidence — the same fallback the
  // demand levy row above already uses. Without it these two lines stayed
  // empty no matter how many bills had been uploaded, because they only ever
  // read levy_rates.
  const fromInvoice = [];
  const feeCell = (approved, invoiced, label) => {
    if (approved != null) return money(approved);
    if (invoiced == null) return "";
    if (!fromInvoice.includes(label)) fromInvoice.push(label);
    return money(invoiced);
  };
  c8.push(row(["Electricity Service Charge (complex, excl VAT)",
    feeCell(levyCurr.electricity_service_fee, elecServiceFeeInvoiced, "service charge"),
    newCell(levyNext.electricity_service_fee, settingsNext.electricityServiceFee)], ["left", "right", "right"]));
  c8.push(row(["Electricity Network Charge (complex, excl VAT)",
    feeCell(levyCurr.electricity_network_fee, elecNetworkFeeInvoiced, "network charge"),
    newCell(levyNext.electricity_network_fee, settingsNext.electricityNetworkFee)], ["left", "right", "right"]));
  E.push(tbl(c8));
  if (fromInvoice.length) {
    E.push(hint(`The electricity ${fromInvoice.join(" and ")} shown for FY ${fy} ${fromInvoice.length > 1 ? "are" : "is"} taken from the uploaded council invoice, not from an AGM-approved rate — no figure has been captured on Tariffs & rates for this year. Confirm before the meeting.`));
  }
  // Two different gaps, two different places to close them, so say which is
  // which rather than sending the reader to one page for both. The provision
  // rows come off levy_rates (Tariffs & rates); the four bill-driven charges
  // are proposals with no council source and live on Config.
  const noLevyNext = !levyNext || levyNext.financial_year == null;
  if (noLevyNext || newGap) {
    E.push(hint([
      noLevyNext && `No FY ${nfy} levy rates have been captured, so the common property provisions in the "New" column are blank — capture them on Tariffs & rates.`,
      newGap && `Where the demand levy, sewerage or the electricity service and network charges are blank in the "New" column, no figure has been proposed for FY ${nfy} — these have no council source until the tariff is published, so they are captured under AGM report figures on Config.`,
    ].filter(Boolean).join(" ")));
  }

  // ---------- Landscape G: section 9.4, the usage trend charts ----------
  // The same two charts as the Financial dashboard, from the same builder, so
  // the report cannot show a different picture from the screen. Landscape so
  // both fit at a legible width.
  const G = [];
  G.push(H2("Usage trends"));
  G.push(para(
    "The two charts below are the dashboard's usage trends for the year under review. Read the dotted line — everything the body corporate allocated, being the seven unit meters plus the common-property provision — against the solid CoJ bulk line: below it means the council metered consumption nobody was billed for, above it means the complex billed more than the council metered that month.",
    { size: 20 }));

  // A chart is a supporting exhibit, not the report. If the browser refuses to
  // rasterise (older Safari taints a canvas an SVG has been drawn into) the
  // section says where to find it and the document is still produced.
  let chartsEmbedded = 0;
  if (usage) {
    const trend = usageTrendSeries(usage);
    const charts = [
      { title: `Electricity — CoJ bulk vs allocated (kWh), FY ${fy}`, unit: "kWh", series: trend.electricity },
      { title: `Water — CoJ bulk vs allocated (kL), FY ${fy}`, unit: "kL", series: trend.water },
    ];
    for (const ch of charts) {
      const svg = buildTrendChartSvgWithLegend({ labels: usage.labels, series: ch.series, unit: ch.unit });
      const bytes = svg ? await svgToPngBytes(svg, 2) : null;
      G.push(new Paragraph({ spacing: { before: 220, after: 80 }, children: [new TextRun({ text: ch.title, bold: true, size: 20 })] }));
      if (bytes) {
        // Sized in points at the SVG's own aspect ratio — about 8.9in wide,
        // inside the text column of a landscape A4 page.
        const hm = /height="(\d+(?:\.\d+)?)"/.exec(svg);
        const svgH = hm ? Number(hm[1]) : CHART_H;
        const w = 640;
        G.push(new Paragraph({ children: [new ImageRun({ data: bytes, transformation: { width: w, height: Math.round((svgH / CHART_W) * w) } })] }));
        chartsEmbedded += 1;
      } else {
        G.push(hint("This chart could not be rendered into the document by your browser — it is on the Financial dashboard under Usage trends."));
      }
    }
  } else {
    G.push(hint(`No usage could be loaded for FY ${fy}, so the charts are omitted. They are on the Financial dashboard under Usage trends.`));
  }
  if (chartsEmbedded) {
    G.push(hint("The dotted line adds the flat common-property provision from the levy rates, not bulk less meters — that derived gap goes negative in some months because council invoice periods do not line up with reading months, and it is covered by the provision check on Utility bills."));
  }

  // ---------- Portrait E2: section 10 ----------
  const E2 = [];
  E2.push(H1("10. Service notes"));
  // Each note takes its recorded cost from its own line in section 1, so it
  // cannot contradict the statement and cannot go stale. The notes used to
  // assert WHERE a cost was recorded — "in the operating-expense log" — which
  // was wrong for fire extinguisher servicing (a bank debit) and for CSOS
  // (mostly levy deductions), and was the same assumption that had Blockwatch
  // reporting R 0.00. A cost reaches the report from any of three sources and
  // the note has no business claiming which.
  const recorded = (label) => {
    const r = report.expenseRows.find((x) => x.label === label);
    return r && r.total ? ` Recorded cost for FY ${fy} was ${money(r.total)}.` : "";
  };
  E2.push(H2("Fire extinguisher servicing"));
  E2.push(para(`Annual servicing of the complex's fire extinguishers, paid directly by the Body Corp and never billed to a unit.${recorded("Fire Extinguisher Servicing")}`, { size: 20 }));
  E2.push(H2("Garden service"));
  E2.push(para(`Grounds maintenance carried by the Body Corp, most commonly paid personally by a unit and reimbursed via a levy deduction with proof of payment. Shown at R 0.00 on the levy statement.${recorded("Garden Service")}`, { size: 20 }));
  E2.push(H2("Blockwatch"));
  E2.push(para(`Neighbourhood watch contribution carried by the Body Corp and paid directly by a unit, then recovered by levy deduction; shown at R 0.00 on the levy statement.${recorded("BlockWatch")}`, { size: 20 }));
  E2.push(H2("CSOS"));
  E2.push(para(`The statutory Community Schemes Ombud Service levy, payable quarterly. Carried by the Body Corp, whether paid directly or by a unit and recovered by levy deduction.${recorded("CSOS")}`, { size: 20 }));
  if (gs.servicesNoteAnnualEstimate != null) {
    E2.push(para(`Note: it is recommended that the above services are once again paid by the body corporate to keep levies low. The estimated annual cost of this would be ${money(gs.servicesNoteAnnualEstimate)}.`, { size: 20 }));
  }

  // ---------- Landscape F: section 11 ----------
  // Nine columns of rand amounts; landscape so no figure has to wrap.
  const F = [];
  F.push(H1(`11. Levy split — proposed for FY ${nfy}`));
  if (levySplitIsCarriedOver) {
    F.push(hint(`No FY ${nfy} levy grid has been captured yet, so this table carries forward the FY ${fy} figures as a starting point. Adjust each line for the new year.`));
  }
  const uCols = units.map((u) => `U${u.no}`);
  const lAligns = ["left", ...uCols.map(() => "right"), "right"];
  const c10 = [hrow(["Levy item", ...uCols, "Total"], lAligns, WIDE)];
  const colTotals = Object.fromEntries(units.map((u) => [u.no, 0]));
  (levySplitItems || LEVY_ITEMS).forEach((item) => {
    const vals = units.map((u) => (levySplit[u.no] && levySplit[u.no][item] != null ? Number(levySplit[u.no][item]) : null));
    units.forEach((u, i) => { colTotals[u.no] = round2(colTotals[u.no] + (vals[i] || 0)); });
    const lineTotal = round2(vals.reduce((a, v) => a + (v || 0), 0));
    // A line every unit was billed R0.00 on prints as R 0,00; a blank cell is
    // reserved for a figure that was never captured, which means something else.
    const anyVal = vals.some((v) => v != null);
    c10.push(row([item, ...vals.map((v) => (v == null ? "" : money(v))), anyVal ? money(lineTotal) : ""], lAligns, false, undefined, WIDE));
  });
  const grand = round2(units.reduce((a, u) => a + colTotals[u.no], 0));
  const anyCaptured = units.some((u) => levySplit[u.no] && Object.keys(levySplit[u.no]).length);
  c10.push(row(["Total per unit", ...units.map((u) => (anyCaptured ? money(colTotals[u.no]) : "")), anyCaptured ? money(grand) : ""], lAligns, true, BAND, WIDE));
  F.push(tbl(c10));
  // A line withdrawn part-way through the year is still reported, because the
  // owners were billed on it — but the table would otherwise imply it is still
  // being charged, and the per-unit total above includes it.
  if (levySplitRemoved && levySplitRemoved.length) {
    F.push(hint(
      `${levySplitRemoved.join(", ")} ${levySplitRemoved.length > 1 ? "were" : "was"} removed from the levy during the year. `
      + `${levySplitRemoved.length > 1 ? "They are" : "It is"} shown because ${levySplitRemoved.length > 1 ? "they were" : "it was"} billed for part of it; `
      + `${levySplitRemoved.length > 1 ? "they are" : "it is"} not charged going forward.`));
  }

  // ---------- Landscape MP: section 12 ----------
  // The reserve fund and the plan that justifies it, in that order.
  //
  // They share a section because Regulation 2 and PMR 22 answer two different
  // questions about the same money — the regulation sets a MINIMUM, s3(1)(b)
  // sets the actual standard ("reasonably sufficient"), and only the plan can
  // say what sufficient is. Splitting them would separate the floor from the
  // thing that decides whether the floor is anywhere near enough.
  //
  // Everything below the proposal is built from the register rather than typed,
  // so it cannot say one thing here and another on the Maintenance page. The
  // two figures that ARE typed — the basis and the proposed designation — are
  // decisions, not data, and they live on Config → AGM report figures.
  const MP = [];
  MP.push(H1("12. Reserve fund and the PMR 22 maintenance plan"));
  if (!plan) {
    MP.push(hint(`The reserve fund and maintenance plan could not be loaded for FY ${fy}, so this section is omitted. It rebuilds from the reserve ledger and the asset register — check the Financial dashboard and the Maintenance page, then generate the report again.`));
  } else {
    const perUnitMonth = (v) => money(round2(v / (units.length || 7) / 12));
    const basisIsLevyOnly = floor && floor.basis === "levy_only";
    const basisLabel = basisIsLevyOnly ? "levy contributions only" : "all owner contributions";
    const otherBase = budget && budget.contributions
      ? (basisIsLevyOnly ? budget.contributions.all : budget.contributions.levy) : null;
    const otherLabel = basisIsLevyOnly ? "all owner contributions" : "levy contributions only";
    const proposed = settingsNext.reserveProposedDesignation;

    MP.push(para(
      "Section 3(1)(b) of the Act requires the body corporate to establish and maintain a reserve fund reasonably sufficient to cover the future maintenance, repair and replacement of common property. Regulation 2 sets a minimum annual contribution to it, and Prescribed Management Rule 22 requires a written ten-year plan approved at each annual general meeting. The minimum and the plan are different tests: the regulation says what may not be gone below, the plan says what is actually needed. This section reports the fund's position, the minimum, what is proposed, and then the plan.",
      { size: 20 }));

    // ---- 1. Where the fund stands ----
    MP.push(H2("Where the fund stands"));
    const rAligns = ["left", "right"];
    const rRows = [hrow(["", `FY ${fy}`], rAligns)];
    rRows.push(row(["Contributions and interest to date", money(plan.reserve.contributions)], rAligns));
    rRows.push(row(["Drawdowns", money(plan.reserve.drawdowns)], rAligns));
    rRows.push(row(["Balance held", money(plan.reserve.balance)], rAligns, true, BAND));
    MP.push(tbl(rRows));
    if (plan.reserve.entryCount === 0) {
      MP.push(para(
        "There is no reserve fund. The ledger has no entries and nothing has ever been designated to it, so the whole replacement cost of every component still has to be funded from future contributions — which is what makes the annual figure further down as large as it is. A nil balance also fixes which tier of Regulation 2 applies: the minimum below is not optional.",
        { size: 20 }));
    }

    // ---- 2. The statutory minimum ----
    if (floor) {
      MP.push(H2("The statutory minimum — Regulation 2"));
      const fAligns = ["left", "right"];
      const fRows = [hrow(["", `FY ${nfy}`], fAligns)];
      // "Owner contributions" rather than the old "Levies collected", because
      // that is exactly what the figure now is — and the old label had been
      // sitting over a number that also contained bank interest.
      fRows.push(row([`Owner contributions collected in FY ${fy} (actual)`, money(floor.leviesCollected)], fAligns));
      fRows.push(row(["25% of that — the tier threshold", money(floor.threshold)], fAligns));
      fRows.push(row(["100% of that — the tier 3 threshold", money(floor.ceiling)], fAligns));
      fRows.push(row(["Reserve fund held at the start of the year", money(floor.balance)], fAligns));
      fRows.push(row(["Tier that applies", `Tier ${floor.tier}`], fAligns, true));
      if (floor.tier === 1 && floor.budgetedContributions != null) {
        fRows.push(row([`Budgeted contributions for FY ${nfy} — ${basisLabel}`, money(floor.budgetedContributions)], fAligns));
        fRows.push(row(["Minimum reserve contribution — 15% of it", money(floor.floor)], fAligns, true, BAND));
        fRows.push(row(["Per unit, per month", perUnitMonth(floor.floor)], fAligns));
      } else if (floor.tier === 2 && floor.budgetedRM != null) {
        fRows.push(row([`Budgeted repairs & maintenance to common property, FY ${nfy}`, money(floor.budgetedRM)], fAligns));
        fRows.push(row(["Minimum reserve contribution — that amount", money(floor.floor)], fAligns, true, BAND));
        fRows.push(row(["Per unit, per month", perUnitMonth(floor.floor)], fAligns));
      } else if (floor.tier === 3) {
        fRows.push(row(["Minimum reserve contribution", "None prescribed"], fAligns, true, BAND));
      }
      MP.push(tbl(fRows));

      if (floor.tier === 1 && floor.floor != null) {
        MP.push(para(
          `The fund is below 25% of the contributions actually collected last year, so Regulation 2(a) applies and the coming year's budgeted reserve contribution must be at least 15% of the budgeted contribution to the administrative fund — ${money(floor.floor)}, about ${perUnitMonth(floor.floor)} per unit per month. This is a floor set by regulation, not a proposal, and it applies whether or not the plan below has been completed.`,
          { size: 20 }));
      } else if (floor.tier === 2 && floor.floor != null) {
        MP.push(para(
          `The fund sits between 25% and 100% of last year's contributions, so Regulation 2(c) applies and the minimum is the amount budgeted to be spent from the ADMINISTRATIVE fund on repairs and maintenance to common property — ${money(floor.floor)}. Note what this is not: it is not what the scheme plans to spend out of the reserve. Reaching this tier lowers the obligation sharply, which is the reason the designation below is set above the 25% line rather than at the bare minimum.`,
          { size: 20 }));
      } else if (floor.tier === 3) {
        MP.push(para(
          "The fund equals or exceeds a full year of contributions, so Regulation 2 prescribes no minimum. Section 3(1)(b) still requires it to be reasonably sufficient, which is the plan's question rather than the regulation's.",
          { size: 20 }));
      }

      // The reading of "contribution" is contested, so the report says which one
      // it used and what the other would have produced. A single number with no
      // basis stated is the thing a reader has to reverse-engineer.
      MP.push(H2("Which figure the 15% was taken of"));
      MP.push(para(
        `Regulation 2 speaks of "the total budgeted contribution to the administrative fund" and does not define it. Section 3(1)(f) says contributions are levied in proportion to participation quota, which points at the levy grid alone; section 3(1)(a)(ii) puts the council water and electricity bill squarely in the administrative fund, which points at everything owners pay. The trustees have reported on ${basisLabel}. Note the levy grid already contains the fixed utility charges — sewerage, the water demand levy and common-property water and electricity — so only metered consumption separates the two.`,
        { size: 20 }));
      if (budget && budget.contributions) {
        const bAl = ["left", "right", "right"];
        const bR = [hrow([`Budgeted owner contributions, FY ${nfy}`, "Amount", "15% of it"], bAl)];
        bR.push(row(["Levy grid", money(budget.contributions.levy), money(round2(budget.contributions.levy * 0.15))], bAl, basisIsLevyOnly, basisIsLevyOnly ? BAND : undefined));
        bR.push(row(["Metered water and electricity recovered", money(budget.contributions.metered), "—"], bAl));
        bR.push(row(["All owner contributions", money(budget.contributions.all), money(round2(budget.contributions.all * 0.15))], bAl, !basisIsLevyOnly, !basisIsLevyOnly ? BAND : undefined));
        MP.push(tbl(bR));
        if (budget.contributions.unclassified.length) {
          MP.push(hint(`Not counted in either reading because they have not been classified on the Budget page: ${budget.contributions.unclassified.join(", ")}. Until they are, the figures above understate the base and therefore the minimum.`));
        }
        MP.push(hint(`Interest earned is excluded from both readings — it is not a contribution from an owner. On the other reading (${otherLabel}) the minimum would be ${money(round2((otherBase || 0) * 0.15))}. The question should be settled with the scheme's accountant; the designation proposed below is compliant on either.`));
      }

      // ---- 3. The proposal ----
      MP.push(H2("Proposed opening designation"));
      if (proposed == null) {
        MP.push(hint("No opening designation has been proposed. Capture it on Config → AGM report figures — it is a decision the meeting takes, not a figure any table here can produce."));
      } else {
        const cash = budget && budget.openingCash != null ? budget.openingCash : null;
        const monthly = budget && budget.totalExpenditure ? round2(budget.totalExpenditure / 12) : null;
        const pAl = ["left", "right"];
        const pR = [hrow(["", `FY ${nfy}`], pAl)];
        pR.push(row(["Proposed designation to the reserve fund", money(proposed)], pAl, true, BAND));
        // A null floor means the base could not be computed, not that the
        // minimum is nil. Printing R 0.00 for it would be a lie the meeting
        // would have no way to spot.
        pR.push(row(["Statutory minimum on the adopted basis", floor.floor == null ? "not computed" : money(floor.floor)], pAl));
        if (floor.floor != null) pR.push(row(["Margin over the minimum", money(round2(proposed - floor.floor))], pAl));
        if (budget && budget.contributions) {
          pR.push(row(["As % of all budgeted owner contributions", `${(proposed / budget.contributions.all * 100).toFixed(1)}%`], pAl));
          pR.push(row(["As % of budgeted levy contributions", `${(proposed / budget.contributions.levy * 100).toFixed(1)}%`], pAl));
        }
        if (cash != null) {
          pR.push(row(["Cash held", money(cash)], pAl));
          pR.push(row(["Administrative cash after the designation", money(round2(cash - proposed))], pAl));
          // Rounded once, not twice: round2 then toFixed(1) turns 6.246 into
          // 6.3 by way of 6.25, and disagrees with every other statement of the
          // same figure.
          if (monthly) pR.push(row(["Months of operating cover remaining", ((cash - proposed) / monthly).toFixed(1)], pAl));
        }
        MP.push(tbl(pR));

        MP.push(para(
          `No owner pays anything for this. The scheme holds ${cash == null ? "accumulated cash" : money(cash)} in a single account with no stated purpose, accumulated over years of collecting more than was spent. Designating ${money(proposed)} of it as the reserve fund changes the label on the money, not the bank balance: it is a transfer between two funds of the same body corporate, not an outflow, and it requires no increase in levies. This is the point most likely to be misunderstood, and it is why the contribution does not appear in the cash projection in section 13.`,
          { size: 20 }));

        if (budget && budget.contributions) {
          const pctAll = proposed / budget.contributions.all * 100;
          const pctLevy = proposed / budget.contributions.levy * 100;
          const clearsBoth = pctAll > 25 && pctLevy > 25;
          MP.push(para(
            `${money(proposed)} is chosen to clear the 25% line rather than to meet the minimum. At ${pctAll.toFixed(1)}% of all contributions and ${pctLevy.toFixed(1)}% of the levy grid it sits above 25% on ${clearsBoth ? "both readings" : "the adopted reading"}, so FY ${nextFY(nfy)} falls into tier 2 and its minimum becomes the year's budgeted repairs and maintenance — currently ${budget.commonPropertyRM == null ? "a figure yet to be budgeted" : money(budget.commonPropertyRM)} — instead of a further 15%. ${clearsBoth ? "It is therefore compliant whichever way the accountant reads the regulation, so the meeting need not wait for that answer to act. " : ""}Two cautions: the FY ${nextFY(nfy)} test runs against FY ${nfy} ACTUAL contributions rather than the budget, so if collections overshoot materially the designation should be topped up before year end; and a balance of exactly 25% falls in a drafting gap between paragraphs (a) and (c) of Regulation 2, so the line is one to clear rather than to land on.`,
            { size: 20 }));
        }
        MP.push(hint("Transferring accumulated administrative surplus between funds is a members' decision rather than a trustee one, so it is on the agenda as an express resolution rather than reported as already done. Nothing has been designated: the ledger above is still empty."));
      }

      if (floor.atGap) {
        MP.push(hint("The reserve balance sits at almost exactly 25% of last year's contributions. Regulation 2(a) catches a fund of LESS than 25% and 2(c) a fund of MORE than 25%, so a balance on the line is caught by neither. Move it clear in either direction rather than leaving it there."));
      }

      // ---- 4. The compliance gap the report will not hide ----
      MP.push(H2("Separate bank account — PMR 26(1)(b)"));
      MP.push(para(
        "Prescribed Management Rule 26(1)(b) requires separate books of account and separate bank accounts for the administrative fund and the reserve fund. The scheme operates one account. Reserve entries are therefore tracked notionally against it, which is enough to report the fund honestly but is not what the rule requires. The trustees have chosen to state this openly rather than present the notional position as compliance; opening the account is on the agenda, and PMR 21 then requires the balance to be held in a secure investment.",
        { size: 20 }));
    }

    // ---- 5. The plan ----
    MP.push(H2("The PMR 22 plan — register coverage"));
    MP.push(para(
      "The minimum above is a floor set by regulation. What the fund actually needs is set by the components it exists to replace, and that is the plan's question. The annual contribution below is the rule's own formula: replacement cost less the reserve already held, divided by the years remaining.",
      { size: 20 }));
    const cAligns = ["left", "right"];
    const cRows = [hrow(["", "Components"], cAligns)];
    cRows.push(row(["On the register", String(plan.totalCount)], cAligns));
    cRows.push(row(["Assessed — cost and remaining life known", String(plan.assessedCount)], cAligns, true));
    cRows.push(row(["Not yet assessed", String(plan.totalCount - plan.assessedCount)], cAligns));
    MP.push(tbl(cRows));
    if (plan.assessedCount === 0) {
      MP.push(para(
        `No component has been assessed yet, so no plan can be calculated and the tables below are empty. The register carries ${plan.totalCount} components as a checklist; each needs an age or install date, an expected life, a present condition and an estimated replacement cost. That is a walk around the property with a clipboard, not a consultant.`,
        { size: 20 }));
      MP.push(hint(`Until this is done nobody can say whether the reserve fund is reasonably sufficient, only that it is lawful. A seven-unit scheme with an uncosted roof does not know whether ${floor && floor.floor ? money(floor.floor) : "the statutory minimum"} a year is generous or negligent. This is the single largest gap in the AGM pack and it is the work that answers the question the fund exists to answer.`));
    } else if (plan.assessedCount < plan.totalCount) {
      MP.push(hint(`${plan.totalCount - plan.assessedCount} of ${plan.totalCount} components are unassessed and contribute nothing to the figures below, so the contribution is understated. They are listed at the end of this section.`));
    }

    if (plan.assessedCount > 0) {
      MP.push(H2("Annual contribution required by the plan"));
      const aAligns = ["left", "right"];
      const aRows = [hrow(["", `FY ${fy}`], aAligns)];
      aRows.push(row(["Replacement cost of assessed components", money(plan.totalReplacementCost)], aAligns));
      aRows.push(row(["Less reserve already held", money(plan.reserve.balance)], aAligns));
      aRows.push(row(["Annual contribution — PMR 22(2)", money(plan.annualContribution)], aAligns, true, BAND));
      aRows.push(row(["Per unit, per month", money(round2(plan.annualContribution / (units.length || 7) / 12))], aAligns));
      MP.push(tbl(aRows));
      MP.push(hint(`Each component contributes its own replacement cost less the reserve attributed to it, divided by its remaining life; the total is the sum. Reserve entries tagged to a component are attributed directly, and the untagged balance is apportioned in proportion to replacement cost.`));
      // Regulation 2's minimum does not discharge s3(1)(b). Where the plan asks
      // for more, the plan is the number that matters.
      if (floor && floor.floor != null) {
        const gap = round2(plan.annualContribution - floor.floor);
        MP.push(para(
          gap > 0
            ? `The plan asks for ${money(plan.annualContribution)} a year and the regulation for ${money(floor.floor)} — a difference of ${money(gap)}. The higher of the two governs: meeting a minimum set by regulation does not discharge the section 3(1)(b) duty to keep the fund reasonably sufficient, and a fund funded to the floor while the plan asks for more is a special levy waiting to happen.`
            : `The plan asks for ${money(plan.annualContribution)} a year against a statutory minimum of ${money(floor.floor)}, so the regulation is the binding figure this year. That holds only while the register stays as costed; the plan is the number to watch as components are assessed.`,
          { size: 20 }));
      }

      // The ten-year schedule.
      MP.push(H2("Ten-year schedule"));
      const sAligns = ["left", "left", "right"];
      const sRows = [hrow(["Year", "Components falling due", `Cost at ${plan.inflationPct}% inflation`], sAligns, WIDE)];
      plan.schedule.forEach((y) => {
        sRows.push(row([
          y.label,
          y.items.length ? y.items.map((i) => i.name).join(", ") : "—",
          y.total ? amt(y.total) : "—",
        ], sAligns, false, undefined, WIDE));
      });
      sRows.push(row(["Ten-year total", "", amt(round2(plan.schedule.reduce((s, y) => s + y.total, 0)))], sAligns, true, BAND, WIDE));
      MP.push(tbl(sRows));
      MP.push(hint(`Costs are shown at the year each component falls due, inflated at ${plan.inflationPct}% a year from today's estimate. A year with no components due is not a year with no maintenance — it is a year with no major capital replacement.`));
      if (plan.beyondWindow) {
        MP.push(hint(`${plan.beyondWindow} component(s) fall due beyond the ten-year window, ${money(plan.beyondWindowCost)} at the same inflation assumption. They are excluded from the table but included in the annual contribution, which is what the later years are building towards.`));
      }

      // Component detail.
      MP.push(H2("Component register"));
      const dAligns = ["left", "left", "left", "right", "right", "right", "right"];
      const dRows = [hrow(["Component", "Category", "Condition", "Life", "Remaining", "Replacement cost", "Annual provision"], dAligns, WIDE)];
      plan.rows.filter((r) => r.assessed).forEach((r) => {
        dRows.push(row([
          r.name, r.category, r.condition || "not inspected",
          r.expectedLife == null ? "—" : `${r.expectedLife}y`,
          r.remaining == null ? "—" : `${r.remaining}y`,
          amt(r.cost), amt(r.annualProvision),
        ], dAligns, false, undefined, WIDE));
      });
      dRows.push(row(["Total", "", "", "", "", amt(plan.totalReplacementCost), amt(plan.annualContribution)], dAligns, true, BAND, WIDE));
      MP.push(tbl(dRows));
    }

    if (plan.unassessed.length) {
      MP.push(H2("Not yet assessed"));
      MP.push(para(plan.unassessed.map((r) => r.name).join(" · "), { size: 18 }));
      MP.push(hint("Each needs an install date or age, an expected life, a present condition and an estimated replacement cost before it can carry a provision. Captured on the Maintenance page."));
    }

    if (plan.snapshot) {
      MP.push(hint(`A plan was approved for FY ${plan.snapshot.financial_year}${plan.snapshot.approved_on ? ` on ${plan.snapshot.approved_on}` : ""}${plan.snapshot.approved_by ? ` by ${plan.snapshot.approved_by}` : ""} and is held as a snapshot. The figures above are the live position from the register, which may since have moved.`));
    } else {
      MP.push(hint(`No approved plan is on record for FY ${fy}. Once the meeting adopts one, save it as a snapshot on the Maintenance page so the approved version is preserved — PMR 22 compliance rests on what was adopted, not on what the register says later.`));
    }
  }

  // ---------- Portrait BG: section 13, the budget ----------
  // Everything before this reports what happened. This is the only section that
  // asks the meeting to approve something, so it closes the document.
  const BG = [];
  BG.push(H1(`13. Budget — FY ${nfy}`));
  if (!budget || !budget.hasData) {
    BG.push(hint(`No budget has been captured for FY ${nfy}. Build it on the Budget page — it seeds from this year's actuals and the captured tariffs, and every line stays editable. This section prints what is saved there.`));
  } else {
    BG.push(para(
      "Every figure below is as captured on the Budget page — this section prints the budget, it does not recompute it, so what is tabled here is exactly what the trustees agreed. All amounts include VAT.",
      { size: 20 }));

    const bAligns = ["left", "right", "left"];
    const secTable = (rows, heading, totalLabel, totalValue) => {
      const t = [hrow([heading, "Amount", "Basis"], bAligns, WIDE)];
      rows.forEach((r) => t.push(row([
        r.label + (r.is_assumption ? " *" : ""),
        amt(r.amount),
        r.basis || "",
      ], bAligns, false, undefined, WIDE)));
      t.push(row([totalLabel, amt(totalValue), ""], bAligns, true, BAND, WIDE));
      return tbl(t);
    };

    BG.push(H2("Income"));
    BG.push(secTable(budget.income, "Line", "Total income", budget.totalIncome));

    BG.push(H2("Administrative expenditure"));
    BG.push(secTable(budget.expenditure, "Line", "Total expenditure", budget.totalExpenditure));

    BG.push(H2("Result"));
    const rAligns = ["left", "right"];
    const rr = [hrow(["", `FY ${nfy}`], rAligns)];
    rr.push(row(["Total income", money(budget.totalIncome)], rAligns));
    rr.push(row(["Total administrative expenditure", money(budget.totalExpenditure)], rAligns));
    rr.push(row(["Operating surplus / (deficit)", money(budget.operatingSurplus)], rAligns, true, BAND));
    if (budget.reserve.length) {
      budget.reserve.forEach((r) => rr.push(row([r.label, money(r.amount)], rAligns)));
      rr.push(row(["Position after the reserve contribution", money(budget.afterReserve)], rAligns, true, BAND));
    }
    BG.push(tbl(rr));

    if (budget.reserve.length && budget.afterReserve < 0 && budget.operatingSurplus >= 0) {
      BG.push(para(
        `The budget balances on operations and fails on the reserve: a surplus of ${money(budget.operatingSurplus)} becomes a shortfall of ${money(Math.abs(budget.afterReserve))} once the statutory reserve contribution of ${money(budget.totalReserve)} is added. Section 12 sets out why that contribution is a regulatory floor rather than a proposal, and proposes how it is funded. It does not follow that levies must rise — the contribution is a designation, and the scheme's accumulated cash is discussed below.`,
        { size: 20 }));
    }

    if (budget.openingCash != null) {
      BG.push(H2("Cash"));
      const cAligns = ["left", "right"];
      const cc = [hrow(["", `FY ${nfy}`], cAligns)];
      cc.push(row(["Opening cash", money(budget.openingCash)], cAligns));
      cc.push(row(["Operating surplus / (deficit)", money(budget.operatingSurplus)], cAligns));
      cc.push(row(["Projected closing cash", money(budget.closingCash)], cAligns, true, BAND));
      BG.push(tbl(cc));
      BG.push(hint("The reserve contribution does not appear here. It is a designation of existing funds, not a payment out — the cash stays in the account either way, and showing it as an outflow would understate the closing balance by that amount."));
    }

    if (budget.assumptions.length) {
      BG.push(hint(`* ${budget.assumptions.join(", ")} ${budget.assumptions.length === 1 ? "is an estimate" : "are estimates"} rather than a captured rate or a known cost. ${budget.assumptions.length === 1 ? "It is" : "They are"} the line${budget.assumptions.length === 1 ? "" : "s"} most worth challenging at the meeting.`));
    }
    if (budget.meta && budget.meta.approved_on) {
      BG.push(hint(`Approved ${budget.meta.approved_on}${budget.meta.approved_by ? ` by ${budget.meta.approved_by}` : ""}.`));
    }
    if (budget.meta && budget.meta.notes) {
      BG.push(para(budget.meta.notes, { size: 18, italics: true }));
    }
  }

  // Signature line. The names come from Config so the document doesn't have to
  // be edited in Word every year just to change who checked it; with none
  // captured it falls back to the generic trustee wording.
  const preparedDate = new Date().toISOString().slice(0, 10).replace(/-/g, "/");
  const who = [
    settings.preparedBy ? `${settings.preparedBy}` : "El Corazon Body Corporate finance trustee",
    settings.checkedBy ? `Checked by ${settings.checkedBy}` : null,
  ].filter(Boolean).join("; ");
  BG.push(new Paragraph({ spacing: { before: 300 }, children: [new TextRun({ text: `Prepared ${preparedDate} · ${who}`, italics: true, size: 18, color: "94A0AC" })] }));

  const portrait = { page: { size: { orientation: PageOrientation.PORTRAIT } } };
  const landscape = { page: { size: { orientation: PageOrientation.LANDSCAPE } } };
  const doc = new Document({
    styles: { default: { document: { run: { font: "Calibri", size: 20 } } } },
    sections: [
      { properties: portrait, children: A },
      { properties: landscape, children: B },
      { properties: portrait, children: BK },
      { properties: portrait, children: C },
      { properties: landscape, children: Dsec },
      { properties: portrait, children: E },
      { properties: landscape, children: G },
      { properties: portrait, children: E2 },
      { properties: landscape, children: F },
      { properties: landscape, children: MP },
      { properties: portrait, children: BG },
    ],
  });
  // Returns the file rather than downloading it. Building the pack takes
  // several seconds — the docx CDN load, six queries and the charts — and by
  // the time it finished the browser no longer connected the download to the
  // click that started it. Chrome treats that as an AUTOMATIC download and
  // blocks it behind the "Automatic downloads" site permission, which is the
  // "needs permission to download" the trustee hit. The caller now shows a
  // Download button, so the click that saves the file is a fresh user gesture
  // and the download is never automatic. It also means a missed or cancelled
  // download can be retried without rebuilding the document.
  return {
    blob: await Packer.toBlob(doc),
    filename: `ElCorazon-AGM-Report-FY${fy.replace("/", "-")}.docx`,
  };
}

// One place that turns a built file into a save. Must be called FROM a user
// gesture — see the note above.
function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

// ---------- Usage trends (CoJ bulk vs units vs total allocated) ----------
// Two line charts on the Financial dashboard, driven by the dashboard's own
// financial-year selector. Three lines each:
//   1. CoJ bulk meter          — what the council metered for the whole complex
//   2. All units combined      — what the seven unit meters account for
//   3. Units + common property — 2 plus the common-property provision, i.e.
//                                everything the body corp has allocated
//
// Line 3 is the one to read against line 1: where it sits below the bulk line
// the council metered consumption nobody was billed for; where it sits above,
// the complex billed more than the council metered that month. The provision
// is the flat billed figure from levy_rates (20 kL / 300 kWh), not "bulk minus
// meters" — that derived gap goes negative in several months because council
// invoice periods don't line up with reading months, and it already has a home
// on the Utility bills provision check.

// The twelve statement periods of a financial year, 1 Aug -> 31 Jul, as the
// "YYYY-MM-01" strings council_invoices and monthly_usage key on.
function fyPeriods(fy) {
  const start = Number(String(fy).split("/")[0]);
  return Array.from({ length: 12 }, (_, i) => {
    const month = (7 + i) % 12;            // 7 = August
    const year = i < 5 ? start : start + 1;
    return `${year}-${String(month + 1).padStart(2, "0")}-01`;
  });
}

// One financial year of bulk council usage, metered unit usage, and that year's
// common-property provision. Three queries, no per-month round trips.
async function fetchUsageTrend(fy) {
  const client = await ensureSupabaseClient();
  const { from, to } = fyBounds(fy);
  const [inv, usage, levy] = await Promise.all([
    client.from("council_invoices")
      .select("period, bulk_water_kl, bulk_elec_kwh")
      .gte("period", from).lte("period", to),
    client.from("monthly_usage")
      .select("period, water_current, water_previous, electricity_current, electricity_previous")
      .gte("period", from).lte("period", to),
    client.from("levy_rates")
      .select("common_property_water_kl, common_property_electricity_kwh")
      .eq("financial_year", fy).limit(1),
  ]);
  const failed = [inv, usage, levy].find((r) => r.error);
  if (failed) throw failed.error;

  const bulkW = {}, bulkE = {};
  (inv.data || []).forEach((r) => {
    const p = String(r.period).slice(0, 10);
    bulkW[p] = r.bulk_water_kl == null ? null : Number(r.bulk_water_kl);
    bulkE[p] = r.bulk_elec_kwh == null ? null : Number(r.bulk_elec_kwh);
  });

  // Each unit's own consumption (current less previous), summed. round2 at the
  // subtraction, same as the Readings screen, so float noise never accumulates
  // across seven units.
  const unitW = {}, unitE = {};
  (usage.data || []).forEach((r) => {
    const p = String(r.period).slice(0, 10);
    const w = round2(Number(r.water_current || 0) - Number(r.water_previous || 0));
    const e = round2(Number(r.electricity_current || 0) - Number(r.electricity_previous || 0));
    unitW[p] = round2((unitW[p] || 0) + w);
    unitE[p] = round2((unitE[p] || 0) + e);
  });

  // No levy_rates row for an older FY — fall back to the app defaults rather
  // than dropping the line entirely.
  const lr = (levy.data || [])[0];
  const cpWater = lr && lr.common_property_water_kl != null
    ? Number(lr.common_property_water_kl) : COMMON_PROPERTY_WATER_KL_DEFAULT;
  const cpElec = lr && lr.common_property_electricity_kwh != null
    ? Number(lr.common_property_electricity_kwh) : COMMON_PROPERTY_ELECTRICITY_KWH_DEFAULT;

  // A month with no readings stays null so the line breaks there instead of
  // dropping to zero. The allocated line is units + the common-property
  // provision, so it only exists where there are readings to add it to.
  const periods = fyPeriods(fy);

  return {
    labels: periods.map((p) => {
      const [y, m] = p.split("-");
      return `${MONTH_NAMES[parseInt(m, 10) - 1].slice(0, 3)} ${y.slice(2)}`;
    }),
    water: {
      bulk: periods.map((p) => (bulkW[p] == null ? null : bulkW[p])),
      units: periods.map((p) => (unitW[p] == null ? null : unitW[p])),
      allocated: periods.map((p) => (unitW[p] == null ? null : round2(unitW[p] + cpWater))),
    },
    electricity: {
      bulk: periods.map((p) => (bulkE[p] == null ? null : bulkE[p])),
      units: periods.map((p) => (unitE[p] == null ? null : unitE[p])),
      allocated: periods.map((p) => (unitE[p] == null ? null : round2(unitE[p] + cpElec))),
    },
    provision: { water: cpWater, electricity: cpElec },
  };
}

// ---------- Bank account status ----------
// Section 3 of the AGM report. The income & expenditure statement is an accrual
// view; this is the cash counterpart, and it is the one a meeting can verify
// against a piece of paper the bank sent.
//
// Everything here comes from `bank_statement_documents` and `bank_transactions`,
// both of which now carry the statement's own printed balances, so the section
// can state not just the position but whether it is PROVEN — every month either
// reconciles to its statement or it does not, and a month that does not is named.
async function fetchBankAccountSummary(fy) {
  const client = await ensureSupabaseClient();
  const { from, to } = fyBounds(fy);
  const [docs, txns] = await Promise.all([
    client.from("bank_statement_documents")
      .select("period, file_name, opening_balance, closing_balance, balance_source, statement_from, statement_to, account_number")
      .gte("period", from).lte("period", to).order("period"),
    client.from("bank_transactions")
      .select("period, amount, direction, balance_after, line_no, expense_category")
      .gte("period", from).lte("period", to),
  ]);
  const failed = [docs, txns].find((r) => r.error);
  if (failed) throw failed.error;

  const docByPeriod = {};
  (docs.data || []).forEach((d) => { docByPeriod[String(d.period).slice(0, 10)] = d; });
  const byPeriod = {};
  (txns.data || []).forEach((t) => {
    const p = String(t.period).slice(0, 10);
    if (!byPeriod[p]) byPeriod[p] = [];
    byPeriod[p].push(t);
  });

  const periods = fyPeriods(fy);
  const months = periods.map((p) => {
    const d = docByPeriod[p];
    const list = byPeriod[p] || [];
    const credits = round2(list.filter((t) => t.direction === "credit").reduce((s, t) => s + Number(t.amount), 0));
    const debits = round2(list.filter((t) => t.direction === "debit").reduce((s, t) => s + Number(t.amount), 0));
    const opening = d && d.opening_balance != null ? Number(d.opening_balance) : null;
    const closing = d && d.closing_balance != null ? Number(d.closing_balance) : null;
    // Reconciled means the statement's own opening and closing bracket the
    // movements exactly. Not "we think it is right" — the bank said so.
    const drift = opening != null && closing != null ? round2(opening + credits - debits - closing) : null;
    return {
      period: p,
      label: (() => { const [y, m] = p.split("-"); return `${MONTH_NAMES[parseInt(m, 10) - 1].slice(0, 3)} ${y.slice(2)}`; })(),
      opening, closing, credits, debits, drift,
      reconciled: drift != null && Math.abs(drift) <= 0.005,
      hasStatement: Boolean(d),
      balanceSource: d ? d.balance_source : null,
      lineCount: list.length,
      missingBalances: list.filter((t) => t.balance_after == null).length,
      fileName: d ? d.file_name : null,
    };
  });

  const present = months.filter((m) => m.hasStatement);
  const withBalances = months.filter((m) => m.opening != null && m.closing != null);
  const totals = {
    credits: round2(months.reduce((s, m) => s + m.credits, 0)),
    debits: round2(months.reduce((s, m) => s + m.debits, 0)),
    opening: withBalances.length ? withBalances[0].opening : null,
    closing: withBalances.length ? withBalances[withBalances.length - 1].closing : null,
  };
  totals.movement = round2(totals.credits - totals.debits);
  totals.drift = totals.opening != null && totals.closing != null
    ? round2(totals.opening + totals.credits - totals.debits - totals.closing) : null;

  // Months of cover: how long the closing balance would fund the scheme at this
  // year's average monthly spend. The number trustees actually want and that
  // nobody works out, because it is the difference between a healthy balance and
  // one that only looks healthy.
  const monthsWithSpend = months.filter((m) => m.debits > 0).length || 12;
  const avgMonthlySpend = monthsWithSpend ? round2(totals.debits / monthsWithSpend) : null;
  const monthsOfCover = avgMonthlySpend > 0 && totals.closing != null
    ? round2(totals.closing / avgMonthlySpend) : null;

  return {
    months, totals, avgMonthlySpend, monthsOfCover,
    accountNumber: (docs.data || []).map((d) => d.account_number).find(Boolean) || null,
    statementsPresent: present.length,
    statementsExpected: periods.length,
    monthsReconciled: months.filter((m) => m.reconciled).length,
    monthsUnreconciled: months.filter((m) => m.hasStatement && !m.reconciled).map((m) => m.label),
    monthsMissing: months.filter((m) => !m.hasStatement).map((m) => m.label),
    derivedMonths: months.filter((m) => m.balanceSource === "derived").map((m) => m.label),
  };
}

// ---------- PMR 22: maintenance plan and reserve fund ----------
// The plan is COMPUTED from the register every time rather than stored, so it
// cannot go stale. What gets stored is the version a meeting approved.
//
// Remaining life, in order of authority:
//   1. the latest inspection's revised figure, where an inspector gave one
//   2. expected life less age, where the install date and expected life are known
//   3. unknown — and the component is reported as unassessed rather than guessed
//
// PMR 22(2): annual contribution = (estimated cost − past contributions) ÷
// expected remaining life. "Past contributions" is the reserve already held.
// Where a reserve entry is tagged to a component that attribution is used;
// the untagged balance is apportioned across components in proportion to
// replacement cost, which is stated in the report rather than left implicit.
async function fetchMaintenancePlan(fy, opts = {}) {
  const client = await ensureSupabaseClient();
  const [assets, inspections, reserve, snapshot] = await Promise.all([
    client.from("assets").select("*").eq("active", true).order("sort_order").order("name"),
    client.from("asset_inspections").select("*").order("inspected_on", { ascending: false }),
    client.from("reserve_fund_entries").select("*").order("entry_date"),
    client.from("maintenance_plan_snapshots").select("*").eq("financial_year", fy).limit(1),
  ]);
  const failed = [assets, inspections, reserve, snapshot].find((r) => r.error);
  if (failed) throw failed.error;

  const inflationPct = opts.inflationPct != null ? Number(opts.inflationPct) : 6;
  const fyStartYear = Number(String(fy).split("/")[0]);
  const asOf = `${fyStartYear + 1}-07-31`;

  const latestByAsset = {};
  const inspectionCountByAsset = {};
  (inspections.data || []).forEach((i) => {
    if (!latestByAsset[i.asset_id]) latestByAsset[i.asset_id] = i;
    inspectionCountByAsset[i.asset_id] = (inspectionCountByAsset[i.asset_id] || 0) + 1;
  });

  const entries = reserve.data || [];
  const signed = (e) => (e.entry_type === "drawdown" ? -Math.abs(Number(e.amount)) : Number(e.amount));
  const reserveBalance = round2(entries.reduce((s, e) => s + signed(e), 0));
  const taggedByAsset = {};
  entries.forEach((e) => { if (e.asset_id) taggedByAsset[e.asset_id] = round2((taggedByAsset[e.asset_id] || 0) + signed(e)); });
  const taggedTotal = round2(Object.values(taggedByAsset).reduce((s, v) => s + v, 0));
  const untagged = round2(reserveBalance - taggedTotal);

  const rows = (assets.data || []).map((a) => {
    const insp = latestByAsset[a.id] || null;
    const cost = a.replacement_cost == null ? null : Number(a.replacement_cost);
    const life = a.expected_life_years == null ? null : Number(a.expected_life_years);
    let remaining = null, remainingBasis = null;
    if (insp && insp.revised_remaining_life_years != null) {
      remaining = Number(insp.revised_remaining_life_years);
      remainingBasis = `inspection ${String(insp.inspected_on).slice(0, 10)}`;
    } else if (life != null && a.installed_on) {
      const ageYears = (new Date(asOf) - new Date(a.installed_on)) / (365.25 * 24 * 3600 * 1000);
      remaining = Math.max(0, Math.round(life - ageYears));
      remainingBasis = `age against a ${life}-year life`;
    } else if (life != null) {
      remaining = life;
      remainingBasis = `full ${life}-year life — no install date captured`;
    }
    const assessed = cost != null && remaining != null;
    return {
      id: a.id, code: a.code, name: a.name, category: a.category, status: a.status,
      installedOn: a.installed_on, expectedLife: life, cost, costBasis: a.cost_basis, notes: a.notes,
      // Carried so the register grid and the spreadsheet round trip can edit
      // every stored field, not just the four a survey produces.
      location: a.location, quantity: a.quantity == null ? null : Number(a.quantity),
      condition: insp ? insp.condition : null,
      inspectedOn: insp ? String(insp.inspected_on).slice(0, 10) : null,
      remaining, remainingBasis, assessed,
      dueYear: assessed ? fyStartYear + Math.max(0, remaining) : null,
      // What the register screen needs to know whether this component can be
      // removed — the same three things the BEFORE DELETE trigger checks.
      sortOrder: a.sort_order == null ? 0 : Number(a.sort_order),
      inspectionCount: inspectionCountByAsset[a.id] || 0,
      reserveEntryCount: entries.filter((e) => e.asset_id === a.id).length,
    };
  });

  // Apportion the untagged reserve across assessed components by cost share.
  const assessedRows = rows.filter((r) => r.assessed);
  const assessedCost = round2(assessedRows.reduce((s, r) => s + r.cost, 0));
  assessedRows.forEach((r) => {
    const share = assessedCost > 0 ? untagged * (r.cost / assessedCost) : 0;
    r.reserveHeld = round2((taggedByAsset[r.id] || 0) + share);
    const years = Math.max(1, r.remaining || 0);
    r.annualProvision = round2(Math.max(0, r.cost - r.reserveHeld) / years);
    // Cost at the year it actually falls due, at the inflation assumption.
    r.inflatedCost = round2(r.cost * Math.pow(1 + inflationPct / 100, Math.max(0, r.remaining || 0)));
  });
  rows.filter((r) => !r.assessed).forEach((r) => { r.reserveHeld = null; r.annualProvision = null; r.inflatedCost = null; });

  const annualContribution = round2(assessedRows.reduce((s, r) => s + (r.annualProvision || 0), 0));

  // The ten-year schedule, by the year each component falls due.
  const schedule = Array.from({ length: 10 }, (_, i) => {
    const year = fyStartYear + i;
    const due = assessedRows.filter((r) => r.dueYear === year);
    return {
      year, label: `${year}/${year + 1}`,
      items: due.map((r) => ({ name: r.name, code: r.code, cost: r.cost, inflatedCost: r.inflatedCost })),
      total: round2(due.reduce((s, r) => s + (r.inflatedCost || 0), 0)),
    };
  });
  // Anything falling due beyond the ten-year window still matters — it is what
  // the later years of the contribution are building towards.
  const beyond = assessedRows.filter((r) => r.dueYear != null && r.dueYear >= fyStartYear + 10);

  return {
    fy, asOf, inflationPct,
    rows, assessedCount: assessedRows.length, totalCount: rows.length,
    unassessed: rows.filter((r) => !r.assessed),
    totalReplacementCost: assessedCost,
    reserve: {
      balance: reserveBalance, tagged: taggedTotal, untagged,
      entryCount: entries.length,
      contributions: round2(entries.filter((e) => e.entry_type !== "drawdown").reduce((s, e) => s + Number(e.amount), 0)),
      drawdowns: round2(entries.filter((e) => e.entry_type === "drawdown").reduce((s, e) => s + Math.abs(Number(e.amount)), 0)),
    },
    annualContribution,
    schedule, beyondWindow: beyond.length,
    beyondWindowCost: round2(beyond.reduce((s, r) => s + (r.inflatedCost || 0), 0)),
    snapshot: (snapshot.data || [])[0] || null,
  };
}

// ---------- Budget ----------
// Section 13 of the AGM report and the Budget page read the same rows. The
// report NEVER recomputes a line — it prints what is stored, so the document
// tabled at the meeting is exactly what the trustee agreed and saved. That is
// the opposite of sections 3, 10 and 12, which are computed on the fly because
// they report facts; a budget is a decision, and a decision has to be pinned.
async function fetchBudget(fy) {
  const client = await ensureSupabaseClient();
  const [lines, meta] = await Promise.all([
    client.from("budget_lines").select("*").eq("financial_year", fy).order("section").order("sort_order"),
    client.from("budget_meta").select("*").eq("financial_year", fy).limit(1),
  ]);
  const failed = [lines, meta].find((r) => r.error);
  if (failed) throw failed.error;

  const all = lines.data || [];
  const bySection = (s) => all.filter((r) => r.section === s)
    .map((r) => ({ ...r, amount: Number(r.amount) }))
    .sort((a, b) => a.sort_order - b.sort_order);
  const income = bySection("income"), expenditure = bySection("expenditure"), reserve = bySection("reserve");
  const total = (rows) => round2(rows.reduce((s, r) => s + r.amount, 0));

  const totalIncome = total(income), totalExpenditure = total(expenditure), totalReserve = total(reserve);

  // Regulation 2 is taken of "the total budgeted contribution to the
  // administrative fund" and never defines it. The two readings differ only on
  // the metered recoveries, so the rows carry their own class and the report
  // sums whichever the scheme has adopted. Classifying on the row rather than
  // matching labels in the report is deliberate: matching by label is exactly
  // how bank interest got inside the 25% threshold once already, and a new
  // income line added later would rejoin the calculation silently.
  const classTotal = (c) => total(income.filter((r) => r.contribution_class === c));
  const levyContributions = classTotal("levy");
  const meteredRecoveries = classTotal("metered_recovery");
  // An unclassified income row is not assumed either way. It is reported, so a
  // line added on the Budget page and left unclassified shows up as a gap in
  // the AGM pack rather than quietly moving the statutory floor.
  const unclassifiedIncome = income.filter((r) => !r.contribution_class).map((r) => r.label);
  // The tier 2 minimum: what is budgeted to be spent FROM THE ADMINISTRATIVE
  // FUND on repairs and maintenance to common property. Not what is planned to
  // be spent out of the reserve — that is the trap in Regulation 2(c).
  const rmRows = expenditure.filter((r) => r.is_common_property_rm);

  const m = (meta.data || [])[0] || null;
  const openingCash = m && m.opening_cash != null ? Number(m.opening_cash) : null;
  const operatingSurplus = round2(totalIncome - totalExpenditure);

  return {
    fy, income, expenditure, reserve,
    totalIncome, totalExpenditure, totalReserve,
    operatingSurplus,
    afterReserve: round2(operatingSurplus - totalReserve),
    openingCash,
    // The reserve contribution is a designation, not a payment — the cash stays
    // in the account either way, so it does not move the projected closing
    // balance. Getting this wrong understates cash by the contribution.
    closingCash: openingCash == null ? null : round2(openingCash + operatingSurplus),
    assumptions: all.filter((r) => r.is_assumption).map((r) => r.label),
    // The Regulation 2 inputs, both readings side by side so the report can
    // state the one adopted and cross-check the other in a line.
    contributions: {
      levy: levyContributions,
      metered: meteredRecoveries,
      all: round2(levyContributions + meteredRecoveries),
      unclassified: unclassifiedIncome,
    },
    commonPropertyRM: rmRows.length ? total(rmRows) : null,
    commonPropertyRMLabels: rmRows.map((r) => r.label),
    meta: m,
    hasData: all.length > 0,
  };
}

// The basis the scheme has adopted, resolved to an amount. Defaults to the
// broad reading when nothing has been chosen on Config — it is the larger of
// the two, so an unanswered question produces the more conservative floor
// rather than the more convenient one.
function contributionBase(budget, basis) {
  if (!budget || !budget.contributions) return null;
  return basis === "levy_only" ? budget.contributions.levy : budget.contributions.all;
}

// The Regulation 2 minimum, all three tiers.
//
// Two bases, and conflating them is the easy mistake. The THRESHOLD test runs
// against the previous year's ACTUAL contributions to the administrative fund;
// the 15% is of the coming year's BUDGETED contributions. They are different
// years and different quantities.
//
//   reserve < 25% of prior actual   → 15% of budgeted contributions   (tier 1)
//   25% – 100%                      → budgeted admin-fund R&M spend   (tier 2)
//   ≥ 100%                          → no minimum                      (tier 3)
//
// Two traps this function exists to stop the report walking into:
//
//   * Tier 2 is NOT what the scheme plans to spend out of the reserve. It is
//     what it budgets to spend from the ADMINISTRATIVE fund on repairs and
//     maintenance to common property. Small, but rarely nil — and the previous
//     version of this function returned null above 25%, which reads as "no
//     obligation" at exactly the point tier 2 starts to bite.
//   * Paragraph (a) catches a reserve of LESS than 25% and paragraph (c) MORE
//     than 25%. A balance of precisely 25% is caught by neither. The gap is a
//     defect in the drafting, not something to land on, so it is flagged.
function reserveFundFloor({ reserveBalance, priorYearContributions, budgetedContributions, budgetedRM }) {
  if (priorYearContributions == null) return null;
  const balance = round2(reserveBalance || 0);
  const threshold = round2(priorYearContributions * 0.25);
  const ceiling = round2(priorYearContributions);

  let tier, floor;
  if (balance < threshold) {
    tier = 1;
    floor = budgetedContributions == null ? null : round2(budgetedContributions * 0.15);
  } else if (balance < ceiling) {
    tier = 2;
    floor = budgetedRM == null ? null : round2(budgetedRM);
  } else {
    tier = 3;
    floor = 0;
  }

  return {
    tier, threshold, ceiling, floor, balance,
    below: tier === 1,            // kept: tier 1 is the only tier the 15% applies in
    atGap: Math.abs(balance - threshold) < 0.005,
    priorYearContributions: round2(priorYearContributions),
    budgetedContributions: budgetedContributions == null ? null : round2(budgetedContributions),
    budgetedRM: budgetedRM == null ? null : round2(budgetedRM),
    // What the balance would have to reach to leave the tier it is in.
    toNextTier: tier === 1 ? round2(threshold - balance) : tier === 2 ? round2(ceiling - balance) : 0,
  };
}

// The water band set in force on a given date, in the shape calcWaterCost and
// individualWaterCost expect. water_tariff_bands stores one row per band per
// effective date; pricing a month means resolving to the latest set that had
// started by then, which is the same rule the statement screen applies.
function waterBandsAsOf(bandRows, dateStr) {
  const effDates = [...new Set(bandRows.map((b) => b.effective_from))].sort();
  if (!effDates.length) return WATER_BANDS_DEFAULT;
  const active = [...effDates].reverse().find((d) => d <= dateStr) || effDates[0];
  return bandRows
    .filter((b) => b.effective_from === active)
    .map((b) => ({
      id: b.band_label, label: b.band_label,
      from: Number(b.from_kl), to: b.to_kl == null ? null : Number(b.to_kl),
      rate2025: Number(b.rate_per_kl) || 0, rate2024: 0,
    }))
    .sort((a, b) => a.from - b.from);
}

// Picks a readable y axis: a 1/2/2.5/5 x 10^n gridline step, then the smallest
// multiple of that step which clears the data. Sizing the step first (rather
// than rounding the maximum up to a round number) keeps the lines filling the
// plot instead of squashing into the bottom third.
function niceAxis(maxVal, targetTicks = 4) {
  if (!(maxVal > 0)) return { max: 1, ticks: [0, 1] };
  const raw = maxVal / targetTicks;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const n = raw / mag;
  const step = (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * mag;
  const max = Math.ceil(maxVal / step) * step;
  const ticks = [];
  for (let t = 0; t <= max + step / 1000; t += step) ticks.push(Math.round(t * 1000) / 1000);
  return { max, ticks };
}

// A minimal multi-series line chart, built as a standalone SVG string.
// Hand-rolled deliberately: no chart library in the bundle, and it prints with
// the rest of the dashboard.
//
// This is a pure string builder rather than JSX because the AGM report embeds
// the same two charts as PNGs. Rendering both from one function is the point —
// a chart in the report can never drift from the chart on screen. `TrendChart`
// below is a thin wrapper that drops the output into the page; the exporter
// rasterises the same string through a canvas.
//
// `standalone` adds the xmlns declaration and a solid background, which a
// browser doesn't need to render inline but a canvas does need to rasterise.
const CHART_W = 760, CHART_H = 280;
const CHART_M = { top: 16, right: 14, bottom: 34, left: 58 };
// Fonts are named with generic fallbacks on every text node. Inline SVG picks
// up the page's webfonts, but an SVG loaded into an Image for rasterising has
// no access to them and would otherwise fall back to a serif default.
const CHART_SANS = "Inter, 'Helvetica Neue', Arial, sans-serif";
const CHART_MONO = "'IBM Plex Mono', ui-monospace, 'Courier New', monospace";

function buildTrendChartSvg({ labels, series, unit, standalone = false }) {
  const W = CHART_W, H = CHART_H, M = CHART_M;
  const iw = W - M.left - M.right;
  const ih = H - M.top - M.bottom;

  const all = series.flatMap((s) => s.values).filter((v) => v != null && isFinite(v));
  if (!all.length) return null;

  const { max, ticks } = niceAxis(Math.max(...all));
  const x = (i) => M.left + (labels.length > 1 ? (i / (labels.length - 1)) * iw : iw / 2);
  const y = (v) => M.top + ih - (v / max) * ih;

  // Null-safe path: a gap in the data lifts the pen instead of drawing through
  // it, so a missing month reads as missing rather than as zero.
  const pathFor = (values) => {
    let d = "", pen = false;
    values.forEach((v, i) => {
      if (v == null || !isFinite(v)) { pen = false; return; }
      d += `${pen ? "L" : "M"}${x(i).toFixed(1)} ${y(v).toFixed(1)} `;
      pen = true;
    });
    return d.trim();
  };
  const fmt = (v) => (Number.isInteger(v) ? v.toLocaleString("en-ZA") : v.toFixed(1));
  // Series labels carry a "+300 kWh" suffix and month labels an en dash, so
  // anything interpolated into markup is escaped rather than trusted.
  const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

  const parts = [];

  ticks.forEach((t) => {
    parts.push(`<line x1="${M.left}" x2="${W - M.right}" y1="${y(t)}" y2="${y(t)}" stroke="#EEE7D6" stroke-width="1"/>`);
    parts.push(`<text x="${M.left - 9}" y="${y(t) + 4}" text-anchor="end" font-family="${CHART_MONO}" font-size="10.5" fill="#94A0AC">${esc(fmt(t))}</text>`);
  });
  parts.push(`<line x1="${M.left}" x2="${M.left}" y1="${M.top}" y2="${M.top + ih}" stroke="#D8D0BE" stroke-width="1"/>`);

  labels.forEach((lab, i) => {
    parts.push(`<text x="${x(i)}" y="${H - 12}" text-anchor="middle" font-family="${CHART_SANS}" font-size="10.5" fill="#64748B">${esc(lab)}</text>`);
  });

  series.forEach((s) => {
    const dash = s.dashed ? ' stroke-dasharray="6 4"' : "";
    parts.push(`<path d="${pathFor(s.values)}" fill="none" stroke="${esc(s.color)}" stroke-width="${s.dashed ? 2 : 2.2}"${dash} stroke-linejoin="round" stroke-linecap="round"/>`);
    if (!s.dashed) {
      s.values.forEach((v, i) => {
        if (v == null || !isFinite(v)) return;
        const tip = `${s.label} · ${labels[i]} · ${v.toLocaleString("en-ZA")} ${unit}`;
        parts.push(`<circle cx="${x(i)}" cy="${y(v)}" r="3" fill="#fff" stroke="${esc(s.color)}" stroke-width="1.8"><title>${esc(tip)}</title></circle>`);
      });
    }
  });

  parts.push(`<text x="${M.left - 9}" y="${M.top - 4}" text-anchor="end" font-family="${CHART_SANS}" font-size="10" fill="#94A0AC">${esc(unit)}</text>`);

  const open = standalone
    ? `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`
    : `<svg viewBox="0 0 ${W} ${H}" width="100%" style="min-width:520px;display:block" role="img">`;
  const bg = standalone ? `<rect width="${W}" height="${H}" fill="#FFFFFF"/>` : "";
  return `${open}${bg}${parts.join("")}</svg>`;
}

// The same legend as the screen, drawn into the SVG so the exported PNG is
// readable on its own. Screen keeps the HTML legend (it wraps responsively);
// the report needs it baked in, because a docx image carries nothing with it.
function buildTrendChartSvgWithLegend({ labels, series, unit }) {
  const chart = buildTrendChartSvg({ labels, series, unit, standalone: false });
  if (!chart) return null;
  const rowH = 20;
  const H = CHART_H + 8 + rowH * series.length;
  const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  // One legend entry per line, left-aligned under the y-axis. Stacking rather
  // than running them across avoids having to measure text width to know
  // whether three labels fit on one row.
  const rows = series.map((s, i) => {
    const yy = CHART_H + 8 + rowH * i + 12;
    const dash = s.dashed ? ' stroke-dasharray="5 3"' : "";
    return `<line x1="${CHART_M.left}" x2="${CHART_M.left + 22}" y1="${yy - 4}" y2="${yy - 4}" stroke="${esc(s.color)}" stroke-width="2.2"${dash} stroke-linecap="round"/>`
      + `<text x="${CHART_M.left + 30}" y="${yy}" font-family="${CHART_SANS}" font-size="11.5" fill="#1B2A38">${esc(s.label)}</text>`;
  }).join("");
  const inner = chart.replace(/^<svg[^>]*>/, "").replace(/<\/svg>$/, "");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${CHART_W}" height="${H}" viewBox="0 0 ${CHART_W} ${H}">`
    + `<rect width="${CHART_W}" height="${H}" fill="#FFFFFF"/>${inner}${rows}</svg>`;
}

// Rasterises an SVG string to PNG bytes via an offscreen canvas, at 2x for a
// print-resolution image. Returns null rather than throwing if the browser
// refuses — older Safari taints a canvas that has had an SVG drawn into it, and
// a chart is not worth failing the whole report over.
function svgToPngBytes(svg, scale = 2) {
  return new Promise((resolve) => {
    try {
      const m = /width="(\d+(?:\.\d+)?)" height="(\d+(?:\.\d+)?)"/.exec(svg);
      const w = m ? Number(m[1]) : CHART_W;
      const h = m ? Number(m[2]) : CHART_H;
      const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }));
      const img = new Image();
      const done = (bytes) => { URL.revokeObjectURL(url); resolve(bytes); };
      img.onload = () => {
        try {
          const canvas = document.createElement("canvas");
          canvas.width = Math.round(w * scale);
          canvas.height = Math.round(h * scale);
          const ctx = canvas.getContext("2d");
          ctx.fillStyle = "#FFFFFF";
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          const b64 = canvas.toDataURL("image/png").split(",")[1];
          const bin = atob(b64);
          const bytes = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
          done(bytes);
        } catch (err) {
          console.warn("Rasterising the usage chart failed:", err);
          done(null);
        }
      };
      img.onerror = () => done(null);
      img.src = url;
    } catch (err) {
      console.warn("Rasterising the usage chart failed:", err);
      resolve(null);
    }
  });
}

function TrendChart({ labels, series, unit }) {
  const svg = buildTrendChartSvg({ labels, series, unit });
  if (!svg) {
    return (
      <div style={{ padding: "36px 0", textAlign: "center", color: "#94A0AC", fontSize: 13 }}>
        No usage captured for this financial year yet.
      </div>
    );
  }
  return (
    <div className="scroll-x" style={{ margin: "0 -4px" }} dangerouslySetInnerHTML={{ __html: svg }} />
  );
}

function ChartLegend({ series }) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 18, marginTop: 10 }}>
      {series.map((s) => (
        <span key={s.label} style={{ display: "inline-flex", alignItems: "center", gap: 7, fontSize: 12.5, color: "#1B2A38" }}>
          <svg width="22" height="8" style={{ flex: "none" }}>
            <line x1="0" y1="4" x2="22" y2="4" stroke={s.color} strokeWidth="2.2"
                  strokeDasharray={s.dashed ? "5 3" : undefined} strokeLinecap="round" />
          </svg>
          {s.label}
        </span>
      ))}
    </div>
  );
}

// The three series per utility, shared by the dashboard and the AGM report so
// colours, labels and ordering are defined once. Takes the output of
// fetchUsageTrend() unchanged.
function usageTrendSeries(data) {
  const trio = (d, provision, unit) => [
    { label: "CoJ bulk meter", color: "#1B2A38", values: d.bulk },
    { label: "All units combined", color: "#2F5D50", values: d.units },
    { label: `Units + common property (+${provision} ${unit})`, color: "#B5651D", dashed: true, values: d.allocated },
  ];
  return {
    electricity: trio(data.electricity, data.provision.electricity, "kWh"),
    water: trio(data.water, data.provision.water, "kL"),
  };
}

function UsageTrends({ fy }) {
  const [data, setData] = useState(null);
  const [status, setStatus] = useState("loading"); // loading | ready | error

  useEffect(() => {
    if (!fy) return;
    let alive = true;
    setStatus("loading");
    fetchUsageTrend(fy)
      .then((d) => { if (alive) { setData(d); setStatus("ready"); } })
      .catch((err) => {
        console.error("Loading usage trends failed:", err);
        if (alive) setStatus("error");
      });
    return () => { alive = false; };
  }, [fy]);

  const elecSeries = data ? usageTrendSeries(data).electricity : [];
  const waterSeries = data ? usageTrendSeries(data).water : [];

  return (
    <div style={{ marginTop: 18 }}>
      <div style={{ fontWeight: 700, fontSize: 13.5, textTransform: "uppercase", letterSpacing: 0.4, color: "#64748B", marginBottom: 12 }}>
        Usage trends — {fy} ({fyLabel(fy)})
      </div>

      {status === "loading" && (
        <Card><div style={{ color: "#94A0AC", fontSize: 13 }}>Loading usage…</div></Card>
      )}
      {status === "error" && (
        <Card><div style={{ color: "#B5651D", fontWeight: 600, fontSize: 13 }}>
          Couldn’t load usage trends — see browser console.
        </div></Card>
      )}

      {status === "ready" && data && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(420px, 1fr))", gap: 14 }}>
          <Card>
            <div style={{ fontWeight: 700, fontSize: 13.5, marginBottom: 2 }}>Electricity (kWh / month)</div>
            <div style={{ fontSize: 12, color: "#64748B", marginBottom: 10 }}>
              Council bulk meter vs the seven unit meters combined. The dotted line adds the
              common-property provision — where it falls short of the bulk line, that month’s
              consumption wasn’t fully allocated.
            </div>
            <TrendChart labels={data.labels} series={elecSeries} unit="kWh" />
            <ChartLegend series={elecSeries} />
          </Card>
          <Card>
            <div style={{ fontWeight: 700, fontSize: 13.5, marginBottom: 2 }}>Water (kL / month)</div>
            <div style={{ fontSize: 12, color: "#64748B", marginBottom: 10 }}>
              Council bulk meter vs the seven unit meters combined. The dotted line adds the
              common-property provision — where it falls short of the bulk line, that month’s
              consumption wasn’t fully allocated.
            </div>
            <TrendChart labels={data.labels} series={waterSeries} unit="kL" />
            <ChartLegend series={waterSeries} />
          </Card>
        </div>
      )}
    </div>
  );
}

// ---------- Config: expense categories ----------
// The single vocabulary behind every tagging dropdown and every line on the
// analytics dashboard. Renaming goes through the rename_expense_category RPC so
// the change cascades to bank transactions, ops expenses, additional charges and
// resident deduction claims in one transaction — a plain UPDATE here would leave
// historic records pointing at a name that no longer exists.
// ---------- User management (finance trustee only) ----------
// Creating, deleting and setting a password go through the `manage-trustees`
// Edge Function: those need the service role key, which must never be in the
// browser. Role, page list and display name are ordinary table writes, already
// restricted to the finance trustee by the trustees_write policy.
async function callManageTrustees(action, payload = {}) {
  const client = await ensureSupabaseClient();
  const { data, error } = await client.functions.invoke("manage-trustees", {
    body: { action, ...payload },
  });
  // The function returns its reason in the body; supabase-js turns a non-2xx
  // into a generic FunctionsHttpError, so read the response before falling
  // back to it or the user gets "Edge Function returned a non-2xx status code".
  if (error) {
    let detail = null;
    try { detail = await error.context?.json?.(); } catch { /* body already read or empty */ }
    throw new Error((detail && detail.error) || error.message || "The request failed.");
  }
  if (data && data.error) throw new Error(data.error);
  return data;
}

function UserManagement({ onProfileChanged }) {
  const canWriteFinance = useCanWriteFinance();
  const [rows, setRows] = useState([]);
  const [status, setStatus] = useState("loading"); // loading | ready | error
  const [busy, setBusy] = useState(null);
  const [notice, setNotice] = useState(null);
  const [error, setError] = useState(null);
  const [meId, setMeId] = useState(null);
  const [expanded, setExpanded] = useState(null); // user_id whose pages are open
  const [draftPages, setDraftPages] = useState([]);
  const [invite, setInvite] = useState({ email: "", display_name: "", role: "approver", password: "" });

  const load = async () => {
    setStatus("loading");
    try {
      const client = await ensureSupabaseClient();
      const [{ data: u }, res] = await Promise.all([
        client.auth.getUser(),
        client.from("trustees").select("*").order("added_at"),
      ]);
      if (res.error) throw res.error;
      setMeId(u && u.user ? u.user.id : null);
      setRows(res.data || []);
      setStatus("ready");
    } catch (err) {
      console.error("Loading trustees failed:", err);
      setStatus("error");
    }
  };
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const run = async (key, fn, msg) => {
    setBusy(key); setError(null); setNotice(null);
    try {
      await fn();
      if (msg) setNotice(msg);
      await load();
      // A change to your OWN row alters your nav, so the app has to re-read it.
      if (onProfileChanged) onProfileChanged();
    } catch (err) {
      console.error("User management action failed:", err);
      setError(err.message || "Something went wrong — see browser console.");
    }
    setBusy(null);
  };

  const addUser = () => run("add", async () => {
    const email = invite.email.trim().toLowerCase();
    if (!email) throw new Error("Enter an email address.");
    if (rows.some((r) => (r.email || "").toLowerCase() === email)) {
      throw new Error(`${email} is already a trustee.`);
    }
    const res = await callManageTrustees("create", {
      email,
      display_name: invite.display_name.trim() || null,
      role: invite.role,
      password: invite.password || null,
      allowed_pages: defaultPagesForRole(invite.role),
    });
    setInvite({ email: "", display_name: "", role: "approver", password: "" });
    setNotice(res && res.invited
      ? `Invited ${email}. They'll get an email to set their own password.`
      : `Created ${email}. Give them the password you set — they can change it on Password management.`);
  });

  const removeUser = (r) => {
    const who = r.display_name || r.email;
    if (!window.confirm(
      `Remove ${who}?\n\nTheir login is deleted and they lose access immediately. `
      + `Anything they approved stays on record — approvals reference the user, so the record survives them.`
    )) return;
    run(`del-${r.user_id}`, () => callManageTrustees("delete", { user_id: r.user_id }), `Removed ${who}.`);
  };

  // Two ways, because the safe one is useless if they can't get the email.
  const emailReset = (r) => run(`mail-${r.user_id}`, async () => {
    const client = await ensureSupabaseClient();
    const { error: e } = await client.auth.resetPasswordForEmail(r.email, {
      redirectTo: window.location.origin,
    });
    if (e) throw e;
  }, `Reset link sent to ${r.email}.`);

  const setPassword = (r) => {
    const pw = window.prompt(
      `Set a temporary password for ${r.display_name || r.email}.\n\n`
      + `At least 8 characters. They can change it themselves on Password management.`);
    if (pw == null) return;
    if (pw.length < 8) { setError("Use at least 8 characters."); return; }
    run(`pw-${r.user_id}`, () => callManageTrustees("set_password", { user_id: r.user_id, password: pw }),
      `Password set for ${r.display_name || r.email}. Pass it on, and ask them to change it.`);
  };

  // Only offers pages that user can actually see, so a landing page cannot be
  // set to a screen they'd be bounced off. Changing their pages afterwards can
  // still strand it — resolveLandingPage() falls back at sign-in rather than
  // showing them a blank screen.
  const changeLanding = (r, value) => run(`land-${r.user_id}`, async () => {
    const client = await ensureSupabaseClient();
    const { error: e } = await client.from("trustees")
      .update({ landing_page: value || null }).eq("user_id", r.user_id);
    if (e) throw e;
  }, "Landing page updated.");

  const changeRole = (r, role) => run(`role-${r.user_id}`, async () => {
    const client = await ensureSupabaseClient();
    // Changing role resets the page list to that role's defaults unless one
    // was set deliberately — otherwise a demoted user keeps a nav full of
    // screens their new role has no business on.
    const patch = { role };
    if (!r.allowed_pages || !r.allowed_pages.length) patch.allowed_pages = null;
    const { error: e } = await client.from("trustees").update(patch).eq("user_id", r.user_id);
    if (e) throw e;
  }, "Role updated.");

  const openPages = (r) => {
    setExpanded(expanded === r.user_id ? null : r.user_id);
    setDraftPages(r.allowed_pages && r.allowed_pages.length ? r.allowed_pages : defaultPagesForRole(r.role));
  };

  const savePages = (r) => run(`pages-${r.user_id}`, async () => {
    // An empty list is indistinguishable from "no list" everywhere it is read
    // — both mean "use the role defaults", which is the safe reading of a
    // missing value. So saving nothing ticked would quietly restore the
    // defaults rather than do what it looks like it does. Say so instead.
    if (!draftPages.length) {
      throw new Error(
        "Nothing is ticked. An empty list means \"role defaults\", so this wouldn't remove their pages — "
        + "use \"Back to role defaults\" if that's what you want, or tick at least one page."
      );
    }
    const client = await ensureSupabaseClient();
    const { error: e } = await client.from("trustees")
      .update({ allowed_pages: draftPages }).eq("user_id", r.user_id);
    if (e) throw e;
    setExpanded(null);
  }, "Pages updated.");

  const resetPagesToRole = (r) => run(`pages-${r.user_id}`, async () => {
    const client = await ensureSupabaseClient();
    const { error: e } = await client.from("trustees")
      .update({ allowed_pages: null }).eq("user_id", r.user_id);
    if (e) throw e;
    setExpanded(null);
  }, "Pages back to the role defaults.");

  const th = { padding: "6px 8px", textAlign: "left", fontSize: 11, textTransform: "uppercase", color: "#64748B" };
  const td = { padding: "7px 8px", borderTop: "1px solid #F0EADC", fontSize: 12.5, verticalAlign: "top" };
  const inp = { ...inputStyle, padding: "4px 6px", fontSize: 12.5, textAlign: "left", fontFamily: "inherit" };
  const smallBtn = { ...secondaryBtn, padding: "3px 9px", fontSize: 11.5 };

  // Belt and braces. The nav already hides this screen, the trustees table
  // refuses writes from anyone but finance, and the Edge Function checks the
  // caller's role itself — this only stops the page rendering if the tab is
  // reached some other way.
  if (!canWriteFinance) {
    return (
      <Card>
        <div style={{ fontSize: 13, color: "#64748B" }}>
          User management is the finance trustee's. Your own password is on <b>Password management</b>.
        </div>
      </Card>
    );
  }
  if (status === "loading") return <Card><div style={{ fontSize: 13, color: "#64748B" }}>Loading trustees…</div></Card>;
  if (status === "error") return <Card><div style={{ fontSize: 13, color: "#B5651D" }}>Could not load the trustee list — see browser console.</div></Card>;

  return (
    <>
      <h1 className="f-display" style={{ fontSize: 24, marginBottom: 4 }}>User management</h1>
      <p style={{ color: "#64748B", fontSize: 13.5, marginBottom: 18 }}>
        Who can sign in, what they may change, and which screens they see.
        <br />
        <b>Role decides what someone can write</b> and is enforced by the database on every save.
        The page list and landing page only decide what appears in their side menu and which screen opens first —
        tidiness settings, not locks, so never rely on either to keep figures out of someone's hands.
      </p>

      {notice && <Card style={{ marginBottom: 14, borderColor: "#B9D4C6" }}><div style={{ fontSize: 12.5, fontWeight: 600, color: "#2F5D50" }}>{notice}</div></Card>}
      {error && <Card style={{ marginBottom: 14, borderColor: "#E3C9A8" }}><div style={{ fontSize: 12.5, fontWeight: 600, color: "#B5651D" }}>{error}</div></Card>}

      <Card style={{ marginBottom: 16 }}>
        <div style={{ fontWeight: 700, fontSize: 13.5, marginBottom: 10 }}>Register a user</div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
          <div style={{ flex: 2, minWidth: 200 }}>
            <div style={{ fontSize: 11, color: "#64748B" }}>Email</div>
            <input style={{ ...inp, width: "100%", boxSizing: "border-box" }} type="email" value={invite.email}
                   onChange={(e) => setInvite({ ...invite, email: e.target.value })} />
          </div>
          <div style={{ flex: 1, minWidth: 150 }}>
            <div style={{ fontSize: 11, color: "#64748B" }}>Name</div>
            <input style={{ ...inp, width: "100%", boxSizing: "border-box" }} value={invite.display_name}
                   onChange={(e) => setInvite({ ...invite, display_name: e.target.value })} />
          </div>
          <div>
            <div style={{ fontSize: 11, color: "#64748B" }}>Role</div>
            <select style={{ ...inp, width: 170 }} value={invite.role}
                    onChange={(e) => setInvite({ ...invite, role: e.target.value })}>
              {Object.entries(ROLE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
          <div>
            <div style={{ fontSize: 11, color: "#64748B" }}>Password (optional)</div>
            <input style={{ ...inp, width: 170 }} type="text" placeholder="blank = email an invite"
                   value={invite.password} onChange={(e) => setInvite({ ...invite, password: e.target.value })} />
          </div>
          <button style={primaryBtn} onClick={addUser} disabled={busy === "add"}>
            {busy === "add" ? "Creating…" : "Register user"}
          </button>
        </div>
        <div style={{ fontSize: 11.5, color: "#94A0AC", marginTop: 8, lineHeight: 1.6 }}>
          Leave the password blank and they get an email to set their own — better, because then nobody but them ever knows it.
          Set one only when email isn't practical.
        </div>
      </Card>

      <Card>
        <div style={{ fontWeight: 700, fontSize: 13.5, marginBottom: 10 }}>Trustees</div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 760 }}>
            <thead><tr>
              <th style={th}>User</th><th style={th}>Role</th><th style={th}>Pages</th>
              <th style={th}>Opens on</th><th style={th}>Password</th><th style={th} />
            </tr></thead>
            <tbody>
              {rows.map((r) => {
                const isMe = r.user_id === meId;
                const custom = Array.isArray(r.allowed_pages) && r.allowed_pages.length > 0;
                const pageCount = custom ? r.allowed_pages.length : defaultPagesForRole(r.role).length;
                // The pages this user can actually see — the only sensible
                // choices for where they land.
                const theirPages = visibleNavPages(r.role, r.allowed_pages);
                const landingResolved = resolveLandingPage(r.role, r.allowed_pages, r.landing_page);
                const landingStranded = r.landing_page && r.landing_page !== landingResolved;
                return (
                  <React.Fragment key={r.user_id}>
                    <tr>
                      <td style={td}>
                        <div style={{ fontWeight: 600 }}>{r.display_name || r.email}{isMe && <span style={{ color: "#94A0AC", fontWeight: 400 }}> — you</span>}</div>
                        {r.display_name && <div style={{ fontSize: 11, color: "#94A0AC" }}>{r.email}</div>}
                      </td>
                      <td style={td}>
                        <select style={{ ...inp, width: 165 }} value={r.role} disabled={busy === `role-${r.user_id}`}
                                onChange={(e) => changeRole(r, e.target.value)}>
                          {Object.entries(ROLE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                        </select>
                      </td>
                      <td style={td}>
                        <button style={smallBtn} onClick={() => openPages(r)}>
                          {pageCount} page{pageCount === 1 ? "" : "s"}{custom ? "" : " (role default)"}
                        </button>
                      </td>
                      <td style={td}>
                        <select
                          style={{ ...inp, width: 175 }} value={r.landing_page || ""}
                          disabled={busy === `land-${r.user_id}`}
                          onChange={(e) => changeLanding(r, e.target.value)}
                        >
                          <option value="">First page ({(theirPages[0] || ["", "—"])[1]})</option>
                          {theirPages.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
                        </select>
                        {landingStranded && (
                          // Their stored choice is a page they can no longer
                          // see. Nothing breaks — they land on {landingResolved}
                          // — but say so, because silently ignoring a setting
                          // that is still displayed is how people lose trust in
                          // the screen.
                          <div style={{ fontSize: 11, color: "#B5651D", marginTop: 3, lineHeight: 1.5 }}>
                            Set to a page they can't see — they'll open on{" "}
                            {(NAV_PAGE_BY_KEY[landingResolved] || {}).label || landingResolved}.
                          </div>
                        )}
                      </td>
                      <td style={td}>
                        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                          <button style={smallBtn} onClick={() => emailReset(r)} disabled={busy === `mail-${r.user_id}`}>
                            {busy === `mail-${r.user_id}` ? "Sending…" : "Email reset"}
                          </button>
                          <button style={smallBtn} onClick={() => setPassword(r)} disabled={busy === `pw-${r.user_id}`}>
                            Set one
                          </button>
                        </div>
                      </td>
                      <td style={td}>
                        {!isMe && (
                          <button
                            style={{ ...smallBtn, color: "#B5651D" }}
                            onClick={() => removeUser(r)}
                            disabled={busy === `del-${r.user_id}`}
                          >{busy === `del-${r.user_id}` ? "Removing…" : "Remove"}</button>
                        )}
                      </td>
                    </tr>
                    {expanded === r.user_id && (
                      <tr><td colSpan={6} style={{ ...td, background: "#F6F1E7" }}>
                        <div style={{ fontSize: 12, color: "#64748B", marginBottom: 8, lineHeight: 1.6 }}>
                          Screens {r.display_name || r.email} sees in the side menu.
                          {" "}<b>Password management is always shown</b> — it carries their own password, so it cannot be taken away.
                          {" "}User management is finance-only whatever is ticked here.
                        </div>
                        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: "4px 18px" }}>
                          {NAV_PAGES.map((p) => {
                            const fixed = p.alwaysOn || p.financeOnly;
                            const on = fixed ? (p.alwaysOn || r.role === "finance") : draftPages.includes(p.key);
                            return (
                              <label key={p.key} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, color: fixed ? "#94A0AC" : "#1B2A38" }}>
                                <input
                                  type="checkbox" checked={on} disabled={fixed}
                                  onChange={(e) => setDraftPages((prev) => (
                                    e.target.checked ? [...prev, p.key] : prev.filter((k) => k !== p.key)
                                  ))}
                                />
                                {p.label}{p.alwaysOn && " (always)"}{p.financeOnly && " (finance only)"}
                              </label>
                            );
                          })}
                        </div>
                        <div style={{ marginTop: 12, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                          <button style={primaryBtn} onClick={() => savePages(r)} disabled={busy === `pages-${r.user_id}`}>
                            {busy === `pages-${r.user_id}` ? "Saving…" : "Save pages"}
                          </button>
                          <button style={secondaryBtn} onClick={() => resetPagesToRole(r)} disabled={busy === `pages-${r.user_id}`}>
                            Back to role defaults
                          </button>
                          <span style={{ fontSize: 11.5, color: "#94A0AC" }}>
                            On the defaults, a screen added to the app later appears automatically. A custom list will not include it until you tick it.
                          </span>
                        </div>
                      </td></tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}

// ---------- Your login ----------
// Self-service password change for whoever is signed in. Deliberately not a
// trustee-management screen: nobody sets anybody else's password, so there is
// no path here for one trustee to take over another's approval rights.
// Its own page since 11 August 2026 (it was a card at the bottom of Config).
// This is the one page nobody can be denied — see NAV_PAGES.alwaysOn — because
// a user who cannot reach their own password has no way to change it without
// asking the finance trustee to set it for them, which is the exact thing this
// screen exists to avoid.
function PasswordManagement() {
  return (
    <>
      <h1 className="f-display" style={{ fontSize: 24, marginBottom: 4 }}>Password management</h1>
      <p style={{ color: "#64748B", fontSize: 13.5, marginBottom: 4 }}>
        Your own password, and any sessions you have open elsewhere. Every trustee has this page.
      </p>
      <YourLogin />
    </>
  );
}

function YourLogin() {
  const { role, loading } = useTrusteeRole();
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [busyOthers, setBusyOthers] = useState(false);
  const [notice, setNotice] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    ensureSupabaseClient()
      .then((c) => c.auth.getUser())
      .then(({ data }) => { if (!cancelled && data && data.user) setEmail(data.user.email || ""); })
      .catch((err) => console.error("Could not read the signed-in user:", err));
    return () => { cancelled = true; };
  }, []);

  const submit = async (e) => {
    e.preventDefault();
    setNotice(null); setError(null);
    if (pw.length < 8) { setError("Use at least 8 characters."); return; }
    if (pw !== confirm) { setError("The two passwords don't match."); return; }
    setBusy(true);
    const err = await changeOwnPassword(pw);
    if (err) { setError(err); } else {
      setPw(""); setConfirm("");
      setNotice("Password changed. It applies the next time you sign in — this session stays open.");
    }
    setBusy(false);
  };

  const inp = { ...inputStyle, width: 240, textAlign: "left", fontFamily: "inherit" };
  return (
    <Card style={{ marginTop: 16 }}>
      <div style={{ fontWeight: 700, fontSize: 13.5, marginBottom: 4 }}>Your login</div>
      <p style={{ fontSize: 12, color: "#94A0AC", marginTop: 0, marginBottom: 14, lineHeight: 1.6 }}>
        Signed in as <b>{email || "…"}</b>
        {!loading && <> — {ROLE_LABELS[role] || ROLE_LABELS.finance}.</>}
        <br />
        Set your own password here. Nobody else can set it for you, and changing it does not sign you out.
      </p>
      <div style={{ fontSize: 12, color: "#94A0AC", marginBottom: 14, lineHeight: 1.6 }}>
        Changing your password <b>does not</b> end sessions already open elsewhere.
        If you're changing it because someone may have had the old one, sign the other sessions out too.
      </div>
      <form onSubmit={submit} style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
        {/* Helps password managers associate the entry with this account. */}
        <input type="email" value={email} autoComplete="username" readOnly hidden />
        <div>
          <div style={{ fontSize: 11, color: "#64748B" }}>New password</div>
          <input type="password" style={inp} value={pw} autoComplete="new-password"
                 onChange={(e) => setPw(e.target.value)} />
        </div>
        <div>
          <div style={{ fontSize: 11, color: "#64748B" }}>Confirm</div>
          <input type="password" style={inp} value={confirm} autoComplete="new-password"
                 onChange={(e) => setConfirm(e.target.value)} />
        </div>
        <button type="submit" style={primaryBtn} disabled={busy || !pw || !confirm}>
          {busy ? "Saving…" : "Change password"}
        </button>
      </form>
      {notice && <div style={{ fontSize: 12.5, color: "#2F5D50", fontWeight: 600, marginTop: 12 }}>{notice}</div>}
      {error && <div style={{ fontSize: 12.5, color: "#B5651D", fontWeight: 600, marginTop: 12 }}>{error}</div>}

      {/* Signing out normally only ends THIS session. This is the deliberate
          way to reach the other ones — a phone, or a shared computer you left
          signed in. It keeps the session you are using, so it cannot lock you
          out by accident. */}
      <div style={{ borderTop: "1px solid #F0EADC", marginTop: 18, paddingTop: 14 }}>
        <div style={{ fontWeight: 600, fontSize: 12.5, marginBottom: 4 }}>Other sessions</div>
        <p style={{ fontSize: 12, color: "#94A0AC", marginTop: 0, marginBottom: 10, lineHeight: 1.6 }}>
          Signs you out everywhere except here — another browser, a phone, a computer you left logged in.
          This session stays open, so you can't lock yourself out.
        </p>
        <button
          style={secondaryBtn}
          disabled={busyOthers}
          onClick={async () => {
            if (!window.confirm(
              "Sign out of every other session?\n\n"
              + "Anywhere else you're signed in as this user will need the password again. "
              + "This browser stays signed in."
            )) return;
            setBusyOthers(true); setNotice(null); setError(null);
            const err = await signOutOtherSessions();
            if (err) setError(err);
            else setNotice("Signed out everywhere else. This session is still open.");
            setBusyOthers(false);
          }}
        >
          {busyOthers ? "Signing out…" : "Sign out everywhere else"}
        </button>
      </div>
    </Card>
  );
}

function Config({ expenseCategories, setExpenseCategories }) {
  const canWriteFinance = useCanWriteFinance();
  const [usage, setUsage] = useState({});
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);

  const refreshUsage = async () => {
    try {
      const client = await ensureSupabaseClient();
      const { data, error: e } = await client.rpc("expense_category_usage");
      if (e) throw e;
      setUsage(Object.fromEntries((data || []).map((r) => [r.name, Number(r.usage_count)])));
    } catch (err) {
      console.error("Loading category usage failed:", err);
    }
  };
  useEffect(() => { refreshUsage(); }, []);

  const sorted = [...expenseCategories].sort(
    (a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name)
  );

  const run = async (fn, successMsg) => {
    setBusy(true); setError(null); setNotice(null);
    try {
      await fn();
      if (successMsg) setNotice(successMsg);
      invalidateExpenseCategoryCache();
    } catch (err) {
      console.error("Config change failed:", err);
      setError(err.message || "Something went wrong — see browser console.");
    } finally {
      setBusy(false);
    }
  };

  const addCategory = () => run(async () => {
    const name = newName.trim();
    if (!name) throw new Error("Give the category a name.");
    if (expenseCategories.some((c) => c.name.toLowerCase() === name.toLowerCase())) {
      throw new Error(`"${name}" already exists.`);
    }
    const nextOrder = Math.max(0, ...expenseCategories.map((c) => c.sortOrder)) + 1;
    const client = await ensureSupabaseClient();
    const { data, error: e } = await client
      .from("expense_categories")
      .insert({ name, sort_order: nextOrder, active: true })
      .select("id, name, sort_order, active")
      .single();
    if (e) throw e;
    setExpenseCategories((prev) => [...prev, { id: data.id, name: data.name, sortOrder: Number(data.sort_order), active: data.active }]);
    setNewName("");
    refreshUsage();
  }, "Category added.");

  const renameCategory = (cat) => {
    const next = window.prompt(`Rename "${cat.name}" to:`, cat.name);
    if (next == null) return;
    const name = next.trim();
    if (!name || name === cat.name) return;
    run(async () => {
      if (expenseCategories.some((c) => c.id !== cat.id && c.name.toLowerCase() === name.toLowerCase())) {
        throw new Error(`"${name}" already exists.`);
      }
      const client = await ensureSupabaseClient();
      const { error: e } = await client.rpc("rename_expense_category", { old_name: cat.name, new_name: name });
      if (e) throw e;
      setExpenseCategories((prev) => prev.map((c) => (c.id === cat.id ? { ...c, name } : c)));
      refreshUsage();
    }, `Renamed to "${name}" — every record using the old name was updated too.`);
  };

  const toggleActive = (cat) => run(async () => {
    const client = await ensureSupabaseClient();
    const { error: e } = await client.from("expense_categories").update({ active: !cat.active }).eq("id", cat.id);
    if (e) throw e;
    setExpenseCategories((prev) => prev.map((c) => (c.id === cat.id ? { ...c, active: !cat.active } : c)));
  }, null);

  // Moves a category one place and renumbers the whole list 1..n. Renumbering
  // rather than swapping two values means the order is always well-defined even
  // if two rows somehow ended up sharing a sort_order.
  const move = (cat, direction) => run(async () => {
    const idx = sorted.findIndex((c) => c.id === cat.id);
    const target = idx + direction;
    if (target < 0 || target >= sorted.length) return;
    const reordered = [...sorted];
    [reordered[idx], reordered[target]] = [reordered[target], reordered[idx]];
    const client = await ensureSupabaseClient();
    for (let i = 0; i < reordered.length; i++) {
      if (reordered[i].sortOrder === i + 1) continue; // already correct
      const { error: e } = await client.from("expense_categories").update({ sort_order: i + 1 }).eq("id", reordered[i].id);
      if (e) throw e;
    }
    const nextOrders = Object.fromEntries(reordered.map((c, i) => [c.id, i + 1]));
    setExpenseCategories((prev) => prev.map((c) => (nextOrders[c.id] ? { ...c, sortOrder: nextOrders[c.id] } : c)));
  }, null);

  const deleteCategory = (cat) => {
    const used = usage[cat.name] || 0;
    if (used > 0) {
      window.alert(`"${cat.name}" is used by ${used} record${used === 1 ? "" : "s"}. Deactivate it instead — deleting would orphan those figures.`);
      return;
    }
    if (!window.confirm(`Delete "${cat.name}"? Nothing currently uses it.`)) return;
    run(async () => {
      const client = await ensureSupabaseClient();
      const { error: e } = await client.rpc("delete_expense_category", { cat_name: cat.name });
      if (e) throw e;
      setExpenseCategories((prev) => prev.filter((c) => c.id !== cat.id));
      refreshUsage();
    }, `"${cat.name}" deleted.`);
  };

  const th = { padding: "6px 8px", color: "#64748B", fontSize: 10.5, textTransform: "uppercase", textAlign: "left" };
  const linkBtn = { background: "none", border: "none", padding: 0, fontSize: 11.5, fontWeight: 700, color: "#2A3E7A", cursor: "pointer", textDecoration: "underline" };

  // Showing a non-finance trustee a category editor the database would refuse
  // every write from would be an invitation to a policy error.
  //
  // Config used to be everyone's page because it carried the password card.
  // That moved to Password management on 11 August 2026, so Config is now an
  // ordinary page the finance trustee can grant or withhold — and for anyone
  // who still has it without finance rights, this is all there is.
  if (!canWriteFinance) {
    return (
      <>
        <h1 className="f-display" style={{ fontSize: 24, marginBottom: 4 }}>Config</h1>
        <p style={{ color: "#64748B", fontSize: 13.5, marginBottom: 18 }}>
          Expense categories, AGM report figures and the other scheme settings are maintained by the finance trustee.
          <br />
          Your own password is on <b>Password management</b>.
        </p>
      </>
    );
  }

  return (
    <>
      <h1 className="f-display" style={{ fontSize: 24, marginBottom: 4 }}>Config — expense categories</h1>
      <p style={{ color: "#64748B", fontSize: 13.5, marginBottom: 18 }}>
        The list every expense tag draws from — bank statement lines, body corp expenses, resident deduction claims and additional charges. The order set here is the order the dropdowns show, and each active category becomes a line on the analytics dashboard.
      </p>

      <Card>
        <div style={{ fontWeight: 700, fontSize: 13.5, marginBottom: 10 }}>Add a category</div>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <input
            placeholder="Category name (e.g. Security)"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") addCategory(); }}
            style={{ ...inputStyle, width: 280, textAlign: "left" }}
          />
          <button style={primaryBtn} onClick={addCategory} disabled={busy}>Add category</button>
        </div>
        {error && <div style={{ marginTop: 10, fontSize: 12.5, color: "#B5651D", fontWeight: 600 }}>{error}</div>}
        {notice && <div style={{ marginTop: 10, fontSize: 12.5, color: "#2F5D50", fontWeight: 600 }}>{notice}</div>}
      </Card>

      <Card style={{ marginTop: 16 }}>
        <div style={{ fontWeight: 700, fontSize: 13.5, marginBottom: 10 }}>
          Categories ({sorted.filter((c) => c.active).length} active, {sorted.filter((c) => !c.active).length} retired)
        </div>
        <table style={{ width: "100%", fontSize: 13, borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={{ ...th, width: 70 }}>Order</th>
              <th style={th}>Name</th>
              <th style={{ ...th, textAlign: "right" }}>Records using it</th>
              <th style={th}>Status</th>
              <th style={{ ...th, textAlign: "right" }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 ? (
              <tr><td colSpan={5} style={{ padding: 16, textAlign: "center", color: "#94A0AC" }}>No categories yet — add one above.</td></tr>
            ) : sorted.map((c, i) => (
              <tr key={c.id} style={{ borderTop: "1px solid #EEE7D6", opacity: c.active ? 1 : 0.55 }}>
                <td style={{ padding: "8px" }}>
                  <button disabled={busy || i === 0} onClick={() => move(c, -1)} title="Move up" style={{ ...linkBtn, marginRight: 8, opacity: i === 0 ? 0.3 : 1 }}>↑</button>
                  <button disabled={busy || i === sorted.length - 1} onClick={() => move(c, 1)} title="Move down" style={{ ...linkBtn, opacity: i === sorted.length - 1 ? 0.3 : 1 }}>↓</button>
                </td>
                <td style={{ padding: "8px", fontWeight: 600 }}>{c.name}</td>
                <td className="f-mono" style={{ padding: "8px", textAlign: "right", color: "#64748B" }}>{usage[c.name] ?? "—"}</td>
                <td style={{ padding: "8px" }}>
                  <span style={{
                    background: c.active ? "#E4EFEA" : "#F1EAD3", color: c.active ? "#2F5D50" : "#8A6D1E",
                    fontSize: 11, fontWeight: 700, padding: "3px 9px", borderRadius: 20,
                  }}>
                    {c.active ? "Active" : "Retired"}
                  </span>
                </td>
                <td style={{ padding: "8px", textAlign: "right" }}>
                  <button disabled={busy} onClick={() => renameCategory(c)} style={{ ...linkBtn, marginRight: 12 }}>Rename</button>
                  <button disabled={busy} onClick={() => toggleActive(c)} style={{ ...linkBtn, marginRight: 12 }}>{c.active ? "Retire" : "Reactivate"}</button>
                  <button disabled={busy} onClick={() => deleteCategory(c)} style={{ ...linkBtn, color: "#B5651D" }}>Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p style={{ fontSize: 11.5, color: "#94A0AC", marginTop: 12, lineHeight: 1.6 }}>
          <strong>Rename</strong> cascades to every record already tagged with the old name, so historic figures stay intact.
          <strong> Retire</strong> hides a category from new dropdowns while leaving past records tagged and still reported — this is what you want for a supplier you no longer use.
          <strong> Delete</strong> is only permitted when nothing references the category.
        </p>
      </Card>

      <AgmReportSettings />
    </>
  );
}

// ---------- Insurance ----------
// Section 5 of the AGM report ("Insurance schedule (per unit)") given its own
// page, because it is the one part of the report that arrives as a document
// from a third party once a year and then has to be turned into a per-unit
// number that bills every month. Everything the report prints is derived here:
// upload the broker's schedule, check the preview, save, and the Insurance levy
// line picks it up on the Levy breakdown page.
//
// The grid used to live on Config alongside the garden and Blockwatch figures.
// It was moved here rather than duplicated: two editable grids over one table
// is how the two drift apart.
const INS_FIELDS = [
  { key: "sum_insured", label: "Sum insured" },
  { key: "premium", label: "Premium" },
  { key: "common_property", label: "Com prop" },
  { key: "sasria", label: "Sasria" },
  { key: "broker_fee", label: "Broker" },
];
const INS_POLICY_FIELDS = [
  { key: "insurance_policy_number", label: "Policy number", kind: "text" },
  { key: "insurance_insurer", label: "Insurer", kind: "text" },
  { key: "insurance_cover_start", label: "Cover starts from", kind: "text" },
  { key: "insurance_policy_total", label: "Policy total per annum", kind: "money" },
];

function InsurancePage() {
  // The insurance policy renews 1 September but the body corp financial year
  // runs 1 August – 31 July, so the year that matters is the one the levy is
  // being set for. The next FY is offered first: a renewal always arrives to be
  // captured against the year ahead.
  const years = useMemo(() => {
    const start = Number(periodToFY(CURRENT_PERIOD).split("/")[0]);
    return [1, 0, -1, -2, -3].map((n) => `${start + n}/${start + n + 1}`);
  }, []);
  const [fy, setFy] = useState(years[0]);
  const [units, setUnits] = useState([]);
  const [ins, setIns] = useState({});        // unitId -> { field: string }
  const [policy, setPolicy] = useState({});  // policy metadata, as strings
  const [status, setStatus] = useState("loading");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null);
  const [error, setError] = useState(null);

  // Upload state. Nothing here touches `ins` until the trustee confirms — a
  // parser that mis-reads the schedule must not be able to overwrite a year.
  const [parsing, setParsing] = useState(false);
  const [preview, setPreview] = useState(null);   // { parsed, alloc, fileName }
  const [parseError, setParseError] = useState(null);

  useEffect(() => {
    let alive = true;
    setStatus("loading"); setNotice(null); setError(null); setPreview(null); setParseError(null);
    (async () => {
      try {
        const client = await ensureSupabaseClient();
        const [u, i, s] = await Promise.all([
          client.from("units").select("id, unit_number, sqm").order("unit_number"),
          client.from("insurance_schedule").select("*").eq("financial_year", fy),
          client.from("agm_report_settings").select("*").eq("financial_year", fy).limit(1),
        ]);
        const bad = [u, i, s].find((r) => r.error);
        if (bad) throw bad.error;
        if (!alive) return;
        setUnits((u.data || []).map((r) => ({ id: r.id, no: r.unit_number, sqm: r.sqm == null ? "" : String(r.sqm) })));
        const byUnit = {};
        (i.data || []).forEach((r) => {
          byUnit[r.unit_id] = Object.fromEntries(INS_FIELDS.map((f) => [f.key, r[f.key] == null ? "" : String(r[f.key])]));
        });
        setIns(byUnit);
        const row = (s.data || [])[0] || {};
        setPolicy(Object.fromEntries(INS_POLICY_FIELDS.map((f) => [f.key, row[f.key] == null ? "" : String(row[f.key])])));
        setStatus("ready");
      } catch (err) {
        console.error("Loading the insurance schedule failed:", err);
        if (alive) setStatus("error");
      }
    })();
    return () => { alive = false; };
  }, [fy]);

  // "1234,56" and "1234.56" mean the same thing to a South African typing into
  // this form; parseFloat on the comma form silently returns 1234.
  const num = (v) => {
    const t = String(v ?? "").trim().replace(/\s/g, "").replace(",", ".");
    if (t === "") return null;
    const n = Number(t);
    return isFinite(n) ? n : null;
  };
  const txt = (v) => { const t = String(v ?? "").trim(); return t === "" ? null : t; };

  const setInsField = (unitId, key, value) =>
    setIns((prev) => ({ ...prev, [unitId]: { ...(prev[unitId] || {}), [key]: value } }));

  // Per annum and per month are derived, never stored, so a saved total can
  // never drift from the components it is supposed to be the sum of.
  const derived = (unitId) => {
    const r = ins[unitId] || {};
    const parts = ["premium", "common_property", "sasria", "broker_fee"].map((k) => num(r[k]));
    if (parts.every((v) => v == null)) return { perAnnum: null, perMonth: null };
    const perAnnum = round2(parts.reduce((s, v) => s + (v || 0), 0));
    return { perAnnum, perMonth: round2(perAnnum / 12) };
  };

  const onFile = async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = "";
    if (!file) return;
    setParsing(true); setParseError(null); setPreview(null); setNotice(null);
    try {
      const parsed = await parseInsuranceSchedulePdf(file);
      if (!parsed.unitItems.length) {
        throw new Error("No per-unit items found. Check this is the Schedule of Insurance and not the policy wording.");
      }
      const nos = units.map((u) => u.no).sort((a, b) => a - b);
      const alloc = computeInsuranceAllocation(parsed, nos);
      setPreview({ parsed, alloc, fileName: file.name });
    } catch (err) {
      console.error("Parsing the insurance schedule failed:", err);
      setParseError(err.message || "Could not read this PDF — see browser console.");
    } finally {
      setParsing(false);
    }
  };

  // Confirm writes the parsed figures into the editable grid only. Saving to
  // the database is still the explicit Save below, so the trustee gets a last
  // look with everything in one place.
  const applyPreview = () => {
    if (!preview) return;
    const byNo = Object.fromEntries(preview.alloc.rows.map((r) => [r.no, r]));
    setIns((prev) => {
      const next = { ...prev };
      units.forEach((u) => {
        const r = byNo[u.no];
        if (!r || !r.matched) return;
        next[u.id] = {
          sum_insured: r.sumInsured == null ? "" : String(r.sumInsured),
          premium: String(r.premium),
          common_property: String(r.commonProperty),
          sasria: String(r.sasria),
          broker_fee: String(r.brokerFee),
        };
      });
      return next;
    });
    const p = preview.parsed;
    setPolicy({
      insurance_policy_number: p.policyNumber || "",
      insurance_insurer: p.insurer || "",
      insurance_cover_start: p.coverStart || "",
      insurance_policy_total: p.policyTotal == null ? "" : String(p.policyTotal),
    });
    setPreview(null);
    setNotice(`Figures from ${preview.fileName} loaded into the grid below. Nothing is saved yet — check them, then save.`);
  };

  const save = async () => {
    setBusy(true); setNotice(null); setError(null);
    try {
      const client = await ensureSupabaseClient();
      // Floor area is a title-deed fact, so it is written back to the unit
      // rather than repeated on every year's schedule.
      for (const u of units) {
        const { error: e } = await client.from("units").update({ sqm: num(u.sqm) }).eq("id", u.id);
        if (e) throw e;
      }
      const rows = units.map((u) => {
        const r = ins[u.id] || {};
        return {
          financial_year: fy, unit_id: u.id,
          ...Object.fromEntries(INS_FIELDS.map((f) => [f.key, num(r[f.key])])),
          updated_at: new Date().toISOString(),
        };
      });
      const { error: ie } = await client.from("insurance_schedule").upsert(rows, { onConflict: "financial_year,unit_id" });
      if (ie) throw ie;
      const payload = { financial_year: fy, updated_at: new Date().toISOString() };
      INS_POLICY_FIELDS.forEach((f) => {
        payload[f.key] = f.kind === "money" ? num(policy[f.key]) : txt(policy[f.key]);
      });
      const { error: se } = await client.from("agm_report_settings").upsert(payload, { onConflict: "financial_year" });
      // The two writes are separate tables and the grid has already committed by
      // this point, so a failure here is PARTIAL — and a bare "save failed" sent
      // someone hunting for a grid that had in fact saved perfectly well. Say
      // which half survived.
      if (se) {
        throw new Error(
          `The per-unit schedule saved, but the policy details did not: ${se.message}. `
          + `If this mentions a missing column, the insurance_policy_metadata migration hasn't been applied to this database.`
        );
      }
      setNotice(`Saved for FY ${fy}. Section 5 of the AGM report and the Insurance levy line both read from this.`);
    } catch (err) {
      console.error("Saving the insurance schedule failed:", err);
      setError(err.message || "Save failed — see browser console.");
    } finally {
      setBusy(false);
    }
  };

  const cellInput = { ...inputStyle, width: 104 };
  const th = { padding: "6px 8px", color: "#64748B", fontSize: 10.5, textTransform: "uppercase", textAlign: "right", whiteSpace: "nowrap" };

  const totals = INS_FIELDS.reduce((acc, f) => {
    acc[f.key] = round2(units.reduce((s, u) => s + (num((ins[u.id] || {})[f.key]) || 0), 0));
    return acc;
  }, {});
  const totalPerAnnum = round2(units.reduce((s, u) => s + (derived(u.id).perAnnum || 0), 0));
  const totalPerMonth = round2(units.reduce((s, u) => s + (derived(u.id).perMonth || 0), 0));
  const savedPolicyTotal = num(policy.insurance_policy_total);
  const savedVariance = savedPolicyTotal == null || !totalPerAnnum ? null : round2(totalPerAnnum - savedPolicyTotal);

  return (
    <>
      <h1 className="f-display" style={{ fontSize: 24, marginBottom: 4 }}>Insurance</h1>
      <p style={{ color: "#64748B", fontSize: 13.5, marginBottom: 14 }}>
        Upload the broker's annual Schedule of Insurance and it becomes the per-unit insurance figure — section 6 of the AGM report, and the Insurance line on every statement.
        The policy year runs 1 September; the body corp financial year runs 1 August to 31 July, so capture a renewal against the year it will be billed in.
      </p>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10, marginBottom: 14 }}>
        <label style={{ fontSize: 12.5, color: "#64748B" }}>
          Financial year{" "}
          <select value={fy} onChange={(e) => setFy(e.target.value)}
                  style={{ ...inputStyle, width: 130, textAlign: "left", fontFamily: "inherit" }}>
            {years.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </label>
      </div>

      {status === "loading" && <Card><div style={{ color: "#94A0AC", fontSize: 13 }}>Loading…</div></Card>}
      {status === "error" && <Card><div style={{ color: "#B5651D", fontWeight: 600, fontSize: 13 }}>Couldn’t load the insurance schedule — see browser console.</div></Card>}

      {status === "ready" && (
        <>
          {/* ---- Upload ---- */}
          <Card style={{ marginBottom: 16 }}>
            <div style={{ fontWeight: 700, fontSize: 13.5, marginBottom: 6 }}>Upload the schedule</div>
            <p style={{ fontSize: 11.5, color: "#94A0AC", marginTop: 0, marginBottom: 12, lineHeight: 1.6 }}>
              PDF from the broker (GWK Welvaart / Renasa format). It is read in your browser — nothing is uploaded anywhere, and nothing is written until you confirm the preview.
            </p>
            <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
              <label style={{ ...secondaryBtn, display: "inline-block" }}>
                {parsing ? "Reading…" : "Choose PDF…"}
                <input type="file" accept="application/pdf,.pdf" onChange={onFile} disabled={parsing}
                       style={{ display: "none" }} />
              </label>
              {parseError && <span style={{ fontSize: 12.5, color: "#B5651D", fontWeight: 600 }}>{parseError}</span>}
            </div>
          </Card>

          {preview && <InsurancePreview preview={preview} onApply={applyPreview} onDiscard={() => setPreview(null)} />}

          {/* ---- Section 5 table ---- */}
          <Card style={{ marginBottom: 16 }}>
            <div style={{ fontWeight: 700, fontSize: 13.5, marginBottom: 4 }}>Insurance schedule (per unit) — section 6 of the AGM report</div>
            <p style={{ fontSize: 11.5, color: "#94A0AC", marginTop: 0, marginBottom: 14, lineHeight: 1.6 }}>
              Per annum is premium plus common property, Sasria and broker fee; per month is a twelfth of it. Both are derived, never stored, so they cannot disagree with their own components.
              Every cell stays editable — the upload fills them, it doesn’t lock them.
            </p>
            <div className="scroll-x">
              <table style={{ width: "100%", fontSize: 13, borderCollapse: "collapse", minWidth: 820 }}>
                <thead>
                  <tr>
                    <th style={{ ...th, textAlign: "left" }}>Unit</th>
                    <th style={th}>Sqm</th>
                    {INS_FIELDS.map((f) => <th key={f.key} style={th}>{f.label}</th>)}
                    <th style={th}>Per annum</th>
                    <th style={th}>Per month</th>
                  </tr>
                </thead>
                <tbody>
                  {units.map((u) => {
                    const d = derived(u.id);
                    return (
                      <tr key={u.id} style={{ borderTop: "1px solid #EEE7D6" }}>
                        <td style={{ padding: "6px 8px", fontWeight: 600 }}>Unit {u.no}</td>
                        <td style={{ padding: "6px 8px", textAlign: "right" }}>
                          <input type="text" inputMode="decimal" value={u.sqm}
                                 onChange={(e) => setUnits((prev) => prev.map((x) => (x.id === u.id ? { ...x, sqm: e.target.value } : x)))}
                                 style={{ ...cellInput, width: 70 }} />
                        </td>
                        {INS_FIELDS.map((f) => (
                          <td key={f.key} style={{ padding: "6px 8px", textAlign: "right" }}>
                            <input type="text" inputMode="decimal" value={(ins[u.id] || {})[f.key] ?? ""}
                                   onChange={(e) => setInsField(u.id, f.key, e.target.value)}
                                   style={cellInput} />
                          </td>
                        ))}
                        <td className="f-mono" style={{ padding: "6px 8px", textAlign: "right", color: "#64748B" }}>{d.perAnnum == null ? "—" : rand(d.perAnnum)}</td>
                        <td className="f-mono" style={{ padding: "6px 8px", textAlign: "right", fontWeight: 700 }}>{d.perMonth == null ? "—" : rand(d.perMonth)}</td>
                      </tr>
                    );
                  })}
                  <tr style={{ borderTop: "2px solid #D8D0BE", background: "#F6F1E7" }}>
                    <td style={{ padding: "8px", fontWeight: 700 }}>Total</td>
                    <td />
                    {INS_FIELDS.map((f) => (
                      <td key={f.key} className="f-mono" style={{ padding: "8px", textAlign: "right", fontWeight: 700 }}>
                        {totals[f.key] ? rand(totals[f.key]) : "—"}
                      </td>
                    ))}
                    <td className="f-mono" style={{ padding: "8px", textAlign: "right", fontWeight: 700 }}>{totalPerAnnum ? rand(totalPerAnnum) : "—"}</td>
                    <td className="f-mono" style={{ padding: "8px", textAlign: "right", fontWeight: 700 }}>{totalPerMonth ? rand(totalPerMonth) : "—"}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            {savedVariance != null && <TieOut allocated={totalPerAnnum} policyTotal={savedPolicyTotal} variance={savedVariance} />}
          </Card>

          {/* ---- Policy details ---- */}
          <Card style={{ marginBottom: 16 }}>
            <div style={{ fontWeight: 700, fontSize: 13.5, marginBottom: 12 }}>Policy details</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: "10px 24px" }}>
              {INS_POLICY_FIELDS.map((f) => (
                <label key={f.key} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, fontSize: 12.5 }}>
                  <span style={{ color: "#1B2A38" }}>{f.label}</span>
                  <input
                    type="text"
                    inputMode={f.kind === "money" ? "decimal" : undefined}
                    value={policy[f.key] ?? ""}
                    onChange={(e) => setPolicy((prev) => ({ ...prev, [f.key]: e.target.value }))}
                    style={{ ...inputStyle, width: f.kind === "money" ? 120 : 180, textAlign: f.kind === "money" ? "right" : "left", fontFamily: f.kind === "money" ? inputStyle.fontFamily : "inherit" }}
                  />
                </label>
              ))}
            </div>
          </Card>

          <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
            <button style={primaryBtn} onClick={save} disabled={busy}>
              {busy ? "Saving…" : `Save insurance schedule for FY ${fy}`}
            </button>
            {notice && <span style={{ fontSize: 12.5, color: "#2F5D50", fontWeight: 600 }}>{notice}</span>}
            {error && <span style={{ fontSize: 12.5, color: "#B5651D", fontWeight: 600 }}>{error}</span>}
          </div>
          <p style={{ fontSize: 11.5, color: "#94A0AC", marginTop: 12, lineHeight: 1.6 }}>
            The Insurance line on the Levy breakdown page fills from the per-month column above. Leaving a cell blank renders that row of the report as an empty cell to complete in Word, which is how the section used to work.
          </p>
        </>
      )}
    </>
  );
}

// Rounding seven ways almost never lands exactly on the insurer's total. The
// difference is shown rather than absorbed into a unit — a few cents is fine
// and expected, rands mean an item was missed.
function TieOut({ allocated, policyTotal, variance }) {
  const material = Math.abs(variance) >= 1;
  return (
    <div style={{
      marginTop: 12, padding: "9px 12px", borderRadius: 7, fontSize: 12,
      background: material ? "#FBF3E9" : "#F1F5F2",
      border: `1px solid ${material ? "#E3C9A8" : "#D5E2D9"}`,
      color: material ? "#8A5A1E" : "#2F5D50", lineHeight: 1.6,
    }}>
      <b>Tie-out:</b> allocated <span className="f-mono">{rand(allocated)}</span> against a policy total of{" "}
      <span className="f-mono">{rand(policyTotal)}</span> —{" "}
      {variance === 0 ? "exact." : (
        <>
          <span className="f-mono">{variance > 0 ? "+" : ""}{rand(variance)}</span>{" "}
          {material
            ? "difference. That is more than rounding: check every item on the schedule has been captured."
            : "from rounding each unit to the cent. Expected, and how the insurer's own schedule adds up."}
        </>
      )}
    </div>
  );
}

// Preview of a parsed schedule: what was read off the PDF, and what it works out
// to per unit, before anything is written.
function InsurancePreview({ preview, onApply, onDiscard }) {
  const { parsed, alloc, fileName } = preview;
  const th = { padding: "6px 8px", color: "#64748B", fontSize: 10.5, textTransform: "uppercase", textAlign: "right", whiteSpace: "nowrap" };
  const td = { padding: "6px 8px", textAlign: "right" };
  return (
    <Card style={{ marginBottom: 16, background: "#FBFAF6", border: "1px solid #D8D0BE" }}>
      <div style={{ fontWeight: 700, fontSize: 13.5, marginBottom: 4 }}>Preview — {fileName}</div>
      <p style={{ fontSize: 11.5, color: "#94A0AC", marginTop: 0, marginBottom: 12, lineHeight: 1.6 }}>
        Policy <b>{parsed.policyNumber || "—"}</b>{parsed.insurer ? ` · ${parsed.insurer}` : ""}{parsed.coverStart ? ` · cover from ${parsed.coverStart}` : ""}.
        {" "}Nothing has been changed yet.
      </p>

      <div style={{ display: "flex", gap: 24, flexWrap: "wrap", fontSize: 12, marginBottom: 14, color: "#1B2A38" }}>
        <span>Section premium <b className="f-mono">{parsed.coverSubTotal == null ? "—" : rand(parsed.coverSubTotal)}</b></span>
        <span>Common property <b className="f-mono">{rand(parsed.commonPropertyPremium)}</b> ÷ {alloc.rows.length} = <b className="f-mono">{rand(alloc.commonEach)}</b></span>
        <span>Geysers <b className="f-mono">{rand(parsed.geyserPremium)}</b> ÷ {alloc.geyserUnits.length || 0} = <b className="f-mono">{rand(alloc.geyserEach)}</b> (units {alloc.geyserUnits.join(", ") || "none"})</span>
        <span>Sasria <b className="f-mono">{parsed.sasriaTotal == null ? "—" : rand(parsed.sasriaTotal)}</b> ÷ {alloc.rows.length} = <b className="f-mono">{rand(alloc.sasriaEach)}</b></span>
        <span>Broker <b className="f-mono">{parsed.brokerFee == null ? "—" : rand(parsed.brokerFee)}</b> ÷ {alloc.rows.length} = <b className="f-mono">{rand(alloc.brokerEach)}</b></span>
      </div>

      {!!parsed.warnings.length && (
        <div style={{ marginBottom: 12, padding: "9px 12px", borderRadius: 7, background: "#F8E4DA", border: "1px solid #DDA98A", color: "#8A3A1E", fontSize: 12, lineHeight: 1.6 }}>
          <b>Couldn’t read the {parsed.warnings.join(", ")} off this PDF.</b>{" "}
          Anything missing allocates as R0.00 and would under-charge every unit for the year — type it into the grid below before saving, or check the premium summary page of the schedule.
        </div>
      )}

      {!!parsed.notes.length && (
        <div style={{ marginBottom: 12, padding: "9px 12px", borderRadius: 7, background: "#F4F1E9", border: "1px solid #D8D0BE", color: "#5A6672", fontSize: 12, lineHeight: 1.6 }}>
          {parsed.notes.map((n, i) => <div key={i}>{n}</div>)}
        </div>
      )}

      {!!alloc.missingUnits.length && (
        <div style={{ marginBottom: 12, padding: "9px 12px", borderRadius: 7, background: "#FBF3E9", border: "1px solid #E3C9A8", color: "#8A5A1E", fontSize: 12, lineHeight: 1.6 }}>
          <b>No schedule item found for unit {alloc.missingUnits.join(", ")}.</b> Those rows will be left as they are — check the PDF describes each unit as “Unit N …”.
        </div>
      )}

      <div className="scroll-x">
        <table style={{ width: "100%", fontSize: 12.5, borderCollapse: "collapse", minWidth: 820 }}>
          <thead>
            <tr>
              <th style={{ ...th, textAlign: "left" }}>Unit</th>
              <th style={th}>Sum insured</th>
              <th style={th}>Item premium</th>
              <th style={th}>Geyser</th>
              <th style={th}>Premium</th>
              <th style={th}>Com prop</th>
              <th style={th}>Sasria</th>
              <th style={th}>Broker</th>
              <th style={th}>Per annum</th>
              <th style={th}>Per month</th>
            </tr>
          </thead>
          <tbody>
            {alloc.rows.map((r) => (
              <tr key={r.no} style={{ borderTop: "1px solid #EEE7D6", opacity: r.matched ? 1 : 0.45 }}>
                <td style={{ padding: "6px 8px", fontWeight: 600 }}>Unit {r.no}</td>
                <td className="f-mono" style={td}>{r.sumInsured == null ? "—" : rand(r.sumInsured)}</td>
                <td className="f-mono" style={td}>{r.ownPremium == null ? "—" : rand(r.ownPremium)}</td>
                <td className="f-mono" style={{ ...td, color: r.geyserShare ? "#1B2A38" : "#B9C4CE" }}>{r.geyserShare ? rand(r.geyserShare) : "—"}</td>
                <td className="f-mono" style={{ ...td, fontWeight: 600 }}>{r.premium == null ? "—" : rand(r.premium)}</td>
                <td className="f-mono" style={td}>{rand(r.commonProperty)}</td>
                <td className="f-mono" style={td}>{rand(r.sasria)}</td>
                <td className="f-mono" style={td}>{rand(r.brokerFee)}</td>
                <td className="f-mono" style={td}>{r.perAnnum == null ? "—" : rand(r.perAnnum)}</td>
                <td className="f-mono" style={{ ...td, fontWeight: 700 }}>{r.perMonth == null ? "—" : rand(r.perMonth)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {alloc.policyTotal != null
        ? <TieOut allocated={alloc.allocated} policyTotal={alloc.policyTotal} variance={alloc.variance} />
        : (
          <div style={{ marginTop: 12, padding: "9px 12px", borderRadius: 7, background: "#FBF3E9", border: "1px solid #E3C9A8", color: "#8A5A1E", fontSize: 12, lineHeight: 1.6 }}>
            <b>No policy total found, so there is nothing to tie the allocation back to.</b>{" "}
            Allocated <span className="f-mono">{rand(alloc.allocated)}</span> — check it against the “Total Annual Payment” on the schedule and enter it under Policy details.
          </div>
        )}

      <div style={{ marginTop: 16, display: "flex", gap: 12, flexWrap: "wrap" }}>
        <button style={primaryBtn} onClick={onApply}>Use these figures</button>
        <button style={secondaryBtn} onClick={onDiscard}>Discard</button>
      </div>
    </Card>
  );
}

// ---------- Config: AGM report figures ----------
// The insurance schedule and the garden/blockwatch figures the AGM approves are
// the two parts of the annual report with no other home in the schema — they
// used to render as blank cells for typing into Word each September, which meant
// re-keying them every year. Kept per financial year so last year's report can
// still be regenerated exactly as it was signed off.
// ---------- Water rate card: the reconciliation factor, computed ----------
// Everything this needs is already captured, so the trustee should never have
// to work it out by hand:
//
//   numerator   — the year's council water CONSUMPTION charges, ex VAT
//                 (`council_invoices.bulk_water_rand`). Not sewerage and not
//                 the water demand levy: those are flat per-dwelling charges
//                 passed through at cost and recover exactly.
//   denominator — the same months of unit readings priced on CoJ's own step
//                 rates, stopped at the highest step any invoice reached in
//                 the year.
//
// The cap is a SINGLE step for the whole year, not per month: the output is a
// rate card printed once and used for twelve months, so it cannot vary. The
// step each month reached is inferred from bulk kL ÷ dwellings against the
// band table — `council_invoices` doesn't store the reading-period day count,
// and a nominal calendar month is close enough to place the step (FY 2025/2026
// reaches step 3 in eleven months and step 2 in the twelfth).
//
// Returns null when there is nothing to compute from, otherwise the factor
// plus its inputs so the card can show its working.
async function computeWaterReconciliationFactor(fy, unitCount = UNITS.length) {
  const client = await ensureSupabaseClient();
  const { from, to } = fyBounds(fy);
  const [inv, usage, bands] = await Promise.all([
    client.from("council_invoices").select("period, bulk_water_kl, bulk_water_rand").gte("period", from).lte("period", to),
    client.from("monthly_usage").select("period, water_current, water_previous").gte("period", from).lte("period", to),
    client.from("water_tariff_bands").select("band_label, from_kl, to_kl, rate_per_kl, effective_from")
      .lte("effective_from", to).order("effective_from", { ascending: false }),
  ]);
  const failed = [inv, usage, bands].find((r) => r.error);
  if (failed) throw failed.error;

  // Newest rate set that had taken effect by the end of the year.
  const rows = bands.data || [];
  if (!rows.length) return null;
  const newest = rows[0].effective_from;
  const scale = rows.filter((r) => r.effective_from === newest)
    .map((r) => ({ from: Number(r.from_kl), to: r.to_kl == null ? null : Number(r.to_kl), rate: Number(r.rate_per_kl) || 0 }))
    .sort((a, b) => a.from - b.from);
  if (scale.length < 2) return null;

  // Which step did the complex itself reach? Highest across the year.
  let topStep = 1;
  const invoices = (inv.data || []).filter((r) => r.bulk_water_rand != null && Number(r.bulk_water_rand) > 0);
  invoices.forEach((r) => {
    const perDwelling = (Number(r.bulk_water_kl) || 0) / unitCount;
    for (let i = scale.length - 1; i >= 1; i -= 1) {
      if (perDwelling > scale[i].from) { topStep = Math.max(topStep, i); break; }
    }
  });

  // Price one unit-month on that scale, with everything above the top step
  // charged AT the top step's rate rather than climbing past it.
  const priceOne = (kl) => {
    let r = Math.max(0, kl), c = 0;
    for (let i = 0; i < scale.length; i += 1) {
      if (r <= 0) break;
      const b = scale[i];
      const width = (i === topStep || b.to == null) ? r : Math.max(0, b.to - b.from);
      const used = Math.min(r, width);
      c += used * b.rate;
      r -= used;
    }
    return c;
  };

  // Only months that have BOTH an invoice and readings can be compared.
  const priced = new Set(invoices.map((r) => String(r.period).slice(0, 10)));
  const usageMonths = new Set();
  let denominator = 0;
  (usage.data || []).forEach((r) => {
    const p = String(r.period).slice(0, 10);
    if (!priced.has(p)) return;
    usageMonths.add(p);
    denominator += priceOne(round2((Number(r.water_current) || 0) - (Number(r.water_previous) || 0)));
  });
  const usable = invoices.filter((r) => usageMonths.has(String(r.period).slice(0, 10)));
  const numerator = usable.reduce((s, r) => s + Number(r.bulk_water_rand), 0);
  if (!(denominator > 0) || !(numerator > 0)) return null;

  return {
    factor: numerator / denominator,
    numerator, denominator,
    months: usable.length,
    topStepLabel: scale[topStep] ? `${scale[topStep].from}–${scale[topStep].to == null ? "" : scale[topStep].to} kL @ ${rand(scale[topStep].rate)}` : "",
    cardRates: scale.slice(1).map((b) => ({ from: b.from, to: b.to, nominal: b.rate, card: b.rate * (numerator / denominator) }))
      .slice(0, topStep),
    effectiveFrom: newest,
    missingInvoice: [...usageMonths].length !== (inv.data || []).length,
  };
}

// One row per financial year, holding the figures that APPLY TO that year.
//
// Until 11 August 2026 this list mixed two different years on one row: a
// "current" column beside its "proposed" successor, and four *_new columns
// holding the year after's charges. That is why every FY 2026/2027 proposal was
// filed under 2025/2026, and it left no way to mark a figure as approved other
// than by editing something called "new".
//
// Now "current" and "proposed" are the SAME field on two rows. Which one it is
// depends only on which year you are looking at and whether the meeting has
// approved it. `scope` says which year a field belongs to:
//
//   "year"   — a rate or a decision. Belongs to the year it applies to.
//   "report" — describes the DOCUMENT, not a rate. Belongs to the year the
//              report covers, and is not carried forward or applied.
const AGM_FIELDS = [
  { key: "garden_rate_per_day", label: "Garden — rate per day", kind: "money", scope: "year" },
  { key: "garden_increase_pct", label: "Garden — increase on the prior year (%)", kind: "number", scope: "year" },
  { key: "garden_visits_per_month", label: "Garden — visits per month", kind: "number", scope: "year" },
  { key: "garden_bonus_amount", label: "Garden — year-end bonus", kind: "money", scope: "year" },
  { key: "garden_bonus_due_date", label: "Garden — bonus payable by", kind: "date", scope: "year" },
  { key: "garden_increase_effective_date", label: "Garden — increase effective date", kind: "date", scope: "year" },
  { key: "blockwatch_monthly", label: "Blockwatch — monthly fee", kind: "money", scope: "year" },
  { key: "sewerage_per_unit", label: "Sewerage — rate per unit / month", kind: "money", scope: "year", applies: "levy_rates" },
  { key: "water_demand_levy", label: "Water demand levy — rate per unit / month", kind: "money", scope: "year", applies: "levy_rates" },
  { key: "electricity_service_fee", label: "Electricity service charge — complex total", kind: "money", scope: "year", applies: "levy_rates" },
  { key: "electricity_network_fee", label: "Electricity network charge — complex total", kind: "money", scope: "year", applies: "levy_rates" },
  { key: "services_note_annual_estimate", label: "Service notes — estimated annual cost", kind: "money", scope: "report" },
  // Section 12. Neither figure is derivable from anything the app holds.
  //
  // The BASIS is an unresolved reading of Regulation 2 — s3(1)(f) points at the
  // levy grid alone, s3(1)(a)(ii) at everything owners pay — and the difference
  // is which budget income rows count. Left blank it defaults to the broad
  // reading, which is the larger base and therefore the more conservative floor:
  // an unanswered question should not produce the more convenient answer.
  //
  // The DESIGNATION is a decision the meeting takes, in the same way the four
  // charge fields above are proposals the meeting votes on rather than figures
  // the council or an invoice can supply.
  {
    key: "reserve_contribution_basis",
    label: "Reserve fund — basis for the 15% minimum",
    kind: "select",
    scope: "year",
    options: [
      { value: "", label: "Not chosen — defaults to all contributions" },
      { value: "all_contributions", label: "All owner contributions" },
      { value: "levy_only", label: "Levy contributions only" },
    ],
  },
  { key: "reserve_proposed_designation", label: "Reserve fund — opening designation", kind: "money", scope: "year", applies: "reserve_ledger" },
  // Water rate-card reconciliation factor. Multiply CoJ's published step rates
  // by it to get the card owners are billed on:  card rate = step rate × factor.
  // It belongs to the year it APPLIES to, and is computed from the year BEFORE
  // that — which is why the calculated panel resolves the previous year.
  //
  // How it is worked out, once a year, from data already captured:
  //   numerator   — the twelve council consumption charges, ex VAT
  //                 (`council_invoices.bulk_water_rand`)
  //   denominator — the same twelve months of unit readings priced on CoJ's
  //                 NOMINAL step rates, capped at the highest step any invoice
  //                 reached that year
  // FY 2025/2026 worked out at 14 165.50 / 14 844.40 = 0.9543. It sits below 1
  // because CoJ pools the free 6kL allowance across the complex and the light
  // users never claim theirs; that effect (−R3 166) slightly outweighs the
  // common-property water CoJ charges for and no unit meter records (+R2 547).
  //
  // DELIBERATELY NOT EFFECTIVE-DATED — trustee's decision, 11 Aug 2026: one
  // current value, edited here. Safe today because NOTHING BILLS ON IT: the
  // engine still uses individualWaterCost and the August 2026 minimum-charge
  // rule, and this field feeds the AGM discussion only. If option D is ever
  // adopted into the billing engine, this must become effective-dated first —
  // otherwise editing it silently re-prices every statement already issued,
  // which is exactly the bug the water-band rate versioning fixed in August.
  { key: "water_reconciliation_factor", label: "Water rate card — reconciliation factor", kind: "number", scope: "year" },
  { key: "prepared_by", label: "Report prepared by", kind: "text", scope: "report" },
  { key: "checked_by", label: "Report checked by", kind: "text", scope: "report" },
];

// The figures an application writes through to the tables the app bills and
// reports on, and where each one lands. A field with no `applies` is read
// straight off agm_report_settings by the report and needs no promotion.
const AGM_APPLY_TARGETS = {
  levy_rates: "levy_rates",
  reserve_ledger: "reserve_fund_entries",
};

function AgmReportSettings() {
  // The year picked here is now the year the figures APPLY TO, so the list has
  // to reach one year FORWARD — that is where every proposal the September
  // meeting votes on belongs. Three years back covers reprinting an old report.
  const years = useMemo(() => {
    const start = Number(periodToFY(CURRENT_PERIOD).split("/")[0]);
    return [-1, 0, 1, 2, 3].map((n) => `${start - n}/${start - n + 1}`);
  }, []);
  // Default to the year ahead: that is the one being prepared for the meeting.
  const [fy, setFy] = useState(years[0]);
  const [settings, setSettings] = useState({});
  const [row, setRow] = useState({});   // as loaded, for approval/applied state
  // The factor implied for THIS year, computed from the year BEFORE it — the
  // council invoices and readings the factor is derived from are last year's.
  // The stored field is only ever an override of it.
  const [calcFactor, setCalcFactor] = useState(undefined); // undefined = still working, null = can't
  const [status, setStatus] = useState("loading"); // loading | ready | error
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null);
  const [error, setError] = useState(null);
  const [applyResult, setApplyResult] = useState(null);

  // Values are held as strings while editing — the same reason the Tariffs and
  // Meter readings tables do: an <input type="number"> renders through the en-ZA
  // locale and turns 33.57 into 33,57, and strips trailing zeros.
  useEffect(() => {
    let alive = true;
    setStatus("loading"); setNotice(null); setError(null); setApplyResult(null);
    (async () => {
      try {
        const client = await ensureSupabaseClient();
        const s = await client.from("agm_report_settings").select("*").eq("financial_year", fy).limit(1);
        if (s.error) throw s.error;
        if (!alive) return;
        const r = (s.data || [])[0] || {};
        setRow(r);
        setSettings(Object.fromEntries(AGM_FIELDS.map((f) => [f.key, r[f.key] == null ? "" : String(r[f.key])])));
        setStatus("ready");
      } catch (err) {
        console.error("Loading AGM report settings failed:", err);
        if (alive) setStatus("error");
      }
    })();
    // Worked out separately so a failure costs the suggestion, not the card.
    // Computed from the PREVIOUS year: the factor that applies to FY X is the
    // one FY X−1's council invoices and unit readings imply.
    setCalcFactor(undefined);
    computeWaterReconciliationFactor(previousFY(fy))
      .then((r) => { if (alive) setCalcFactor(r); })
      .catch((err) => { console.warn("Computing the water reconciliation factor failed:", err); if (alive) setCalcFactor(null); });
    return () => { alive = false; };
  }, [fy]);

  // Parses what a South African actually types into a money field: a space or a
  // comma for thousands, a comma or a full stop for the decimal, and often the
  // figure pasted straight off an invoice complete with its R.
  //
  // THE BUG THIS REPLACES (found 11 Aug 2026): the old parser did
  // `.replace(",", ".")`, which replaces only the FIRST comma. "1 125,75" came
  // through fine, but "1,125.75" became the unparseable "1.125.75", Number()
  // returned NaN, and the function returned **null** — so the save wrote null,
  // reported "Saved", and the figure was gone. Anything with an R prefix went
  // the same way. That is how the water demand levy and the two electricity
  // charges emptied themselves while sewerage (typed "774.48", no separator,
  // no R) survived.
  //
  // Returns null for an empty field and **NaN for something typed that cannot
  // be read** — the caller must refuse to save on NaN rather than storing null.
  //
  // `kind` matters: for "money" a lone group of exactly three digits is read as
  // a thousands separator, so "1,125" is 1125. For "number" it never is, because
  // the reconciliation factor is a decimal — "1.045" must stay 1.045, not 1045.
  const num = (v, kind = "money") => {
    // \u00A0 is written as an escape, not pasted: a literal non-breaking
    // space in source is invisible and does not survive every editor.
    let t = String(v ?? "").trim().replace(/[\s\u00A0]/g, "").replace(/^r/i, "");
    if (t === "") return null;
    const neg = /^[-(]/.test(t);
    t = t.replace(/[()+-]/g, "");
    const seps = (t.match(/[.,]/g) || []).length;
    if (seps > 1) {
      // Every separator but the last is a thousands mark: "1.234.567,89".
      const last = Math.max(t.lastIndexOf(","), t.lastIndexOf("."));
      t = t.slice(0, last).replace(/[.,]/g, "") + "." + t.slice(last + 1);
    } else if (seps === 1) {
      t = kind === "money" && /^[1-9]\d{0,2}[.,]\d{3}$/.test(t)
        ? t.replace(/[.,]/g, "")   // "1,125" / "1.125" -> 1125
        : t.replace(",", ".");     // otherwise the separator is the decimal
    }
    const n = Number(t);
    return isFinite(n) ? (neg ? -n : n) : NaN;
  };
  const txt = (v) => { const t = String(v ?? "").trim(); return t === "" ? null : t; };

  const save = async () => {
    setBusy(true); setNotice(null); setError(null);
    try {
      const client = await ensureSupabaseClient();
      const payload = { financial_year: fy, updated_at: new Date().toISOString() };
      // A field that was typed but can't be read must STOP the save. Writing
      // null for it is what silently lost three figures before — the row saved,
      // the notice said "Saved", and only a later refresh showed the damage.
      const unreadable = [];
      AGM_FIELDS.forEach((f) => {
        if (f.kind === "money" || f.kind === "number") {
          const n = num(settings[f.key], f.kind);
          if (Number.isNaN(n)) unreadable.push(f.label);
          payload[f.key] = n;
        } else {
          payload[f.key] = txt(settings[f.key]);
        }
      });
      if (unreadable.length) {
        setError(`Couldn't read a number in: ${unreadable.join("; ")}. Nothing was saved — check those fields and try again.`);
        setBusy(false);
        return;
      }
      const { error: se } = await client.from("agm_report_settings").upsert(payload, { onConflict: "financial_year" });
      if (se) throw se;
      const back = await client.from("agm_report_settings").select("*").eq("financial_year", fy).limit(1);
      if (!back.error) setRow((back.data || [])[0] || {});
      setNotice(`Saved for FY ${fy}. The AGM report picks this up the next time it is generated.`);
    } catch (err) {
      console.error("Saving AGM report settings failed:", err);
      setError(err.message || "Save failed — see browser console.");
    } finally {
      setBusy(false);
    }
  };

  // ---------- Approving, and applying ----------
  //
  // Three states, and the difference between them matters:
  //
  //   proposed  — typed here, printed in the report's "New" column, billing
  //               untouched
  //   approved  — the meeting carried it. Recorded, still not billing.
  //   applied   — written through to levy_rates and the reserve ledger, which
  //               is what the app actually bills and reports on
  //
  // Before this existed there was no third step at all: an approved figure had
  // to be re-typed on another screen and nothing recorded that the meeting had
  // decided anything. Nothing in the app has ever written the levy_rates fee
  // columns — they were inserted as null and left that way — so the report's
  // "an approved figure in levy_rates wins" branch was unreachable.
  const markApproved = async (on, by) => {
    setBusy(true); setNotice(null); setError(null);
    try {
      const client = await ensureSupabaseClient();
      const { error: e } = await client.from("agm_report_settings")
        .upsert({ financial_year: fy, figures_approved_on: on || null, figures_approved_by: by || null, updated_at: new Date().toISOString() },
                { onConflict: "financial_year" });
      if (e) throw e;
      const back = await client.from("agm_report_settings").select("*").eq("financial_year", fy).limit(1);
      if (back.error) throw back.error;
      setRow((back.data || [])[0] || {});
      setNotice(on ? `Recorded as approved on ${on}.` : "Approval withdrawn.");
    } catch (err) {
      console.error("Recording the AGM approval failed:", err);
      setError(err.message || "Couldn't record the approval — see browser console.");
    } finally { setBusy(false); }
  };

  const applyFigures = async () => {
    setBusy(true); setNotice(null); setError(null); setApplyResult(null);
    try {
      // Guard 1: only an approved set may be applied. The button is hidden
      // otherwise, but the check is here because the button is a convenience.
      if (!row.figures_approved_on) {
        setError("Record the meeting's approval first. Only approved figures can be applied.");
        setBusy(false); return;
      }
      // Guard 2: never backwards. Applying to a year already billed would
      // re-price statements that have gone out — the same failure the water
      // band versioning exists to prevent.
      const activeFY = periodToFY(CURRENT_PERIOD);
      if (fy < activeFY) {
        setError(`FY ${fy} has already been billed. Figures can only be applied to FY ${activeFY} or later — applying backwards would re-price statements already issued.`);
        setBusy(false); return;
      }

      const client = await ensureSupabaseClient();
      const written = [], skipped = [], manual = [];
      const val = (k) => (row[k] == null ? null : Number(row[k]));

      // ---- levy_rates: the three charges the billing engine reads ----
      const fees = {
        water_demand_levy: val("water_demand_levy"),
        electricity_service_fee: val("electricity_service_fee"),
        electricity_network_fee: val("electricity_network_fee"),
      };
      const haveFees = Object.entries(fees).filter(([, v]) => v != null);
      if (haveFees.length) {
        const existing = await client.from("levy_rates").select("financial_year").eq("financial_year", fy).limit(1);
        if (existing.error) throw existing.error;
        const patch = Object.fromEntries(haveFees);
        const { error: le } = (existing.data || []).length
          ? await client.from("levy_rates").update({ ...patch, updated_at: new Date().toISOString() }).eq("financial_year", fy)
          : await client.from("levy_rates").insert({ financial_year: fy, ...patch });
        if (le) throw le;
        haveFees.forEach(([k, v]) => written.push({ figure: k, to: "levy_rates", value: v }));
      }
      Object.entries(fees).filter(([, v]) => v == null)
        .forEach(([k]) => skipped.push({ figure: k, reason: "no figure captured for this year" }));

      // Sewerage has no column in levy_rates — it is billed as a levy grid line,
      // not a rate. Saying so beats writing it nowhere and reporting success.
      if (val("sewerage_per_unit") != null) {
        manual.push({ figure: "sewerage_per_unit", where: "Levy breakdown — the Sewerage line", value: val("sewerage_per_unit") });
      }

      // ---- reserve ledger: the opening designation ----
      const designation = val("reserve_proposed_designation");
      if (designation != null) {
        // Idempotent: a second application must not designate the money twice.
        const already = await client.from("reserve_fund_entries")
          .select("id, amount").eq("financial_year", fy).eq("entry_type", "contribution");
        if (already.error) throw already.error;
        const dup = (already.data || []).some((e) => Math.abs(Number(e.amount) - designation) < 0.005);
        if (dup) {
          skipped.push({ figure: "reserve_proposed_designation", reason: "a contribution of this amount is already on the reserve ledger for this year" });
        } else {
          const { error: re } = await client.from("reserve_fund_entries").insert({
            entry_date: row.figures_approved_on,
            financial_year: fy,
            entry_type: "contribution",
            amount: designation,
            description: `Opening designation approved at the AGM${row.figures_approved_by ? ` (${row.figures_approved_by})` : ""} — transfer from accumulated administrative funds, not a new levy.`,
          });
          if (re) throw re;
          written.push({ figure: "reserve_proposed_designation", to: "reserve_fund_entries", value: designation });
        }
      }

      // ---- deliberately not applied ----
      if (val("water_reconciliation_factor") != null) {
        skipped.push({
          figure: "water_reconciliation_factor",
          reason: "nothing bills on the factor — the engine still uses individualWaterCost and the August 2026 minimum-charge rule. It must become effective-dated before it can be applied, or editing it would silently re-price statements already issued.",
        });
      }
      ["garden_rate_per_day", "garden_bonus_amount", "blockwatch_monthly"].forEach((k) => {
        if (val(k) != null) manual.push({ figure: k, where: "Levy breakdown — the matching levy line", value: val(k) });
      });

      const result = { written, skipped, manual, approved_on: row.figures_approved_on };
      const me = (await client.auth.getUser()).data?.user?.email || null;
      const { error: ae } = await client.from("agm_figure_applications")
        .insert({ financial_year: fy, applied_by: me, result });
      if (ae) throw ae;
      const { error: ue } = await client.from("agm_report_settings")
        .update({ figures_applied_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq("financial_year", fy);
      if (ue) throw ue;

      const back = await client.from("agm_report_settings").select("*").eq("financial_year", fy).limit(1);
      if (!back.error) setRow((back.data || [])[0] || {});
      setApplyResult(result);
      setNotice(`Applied to FY ${fy}: ${written.length} figure(s) written.${manual.length ? ` ${manual.length} still need entering by hand.` : ""}`);
    } catch (err) {
      console.error("Applying the AGM figures failed:", err);
      setError(err.message || "Applying failed — see browser console. Check what was written before retrying.");
    } finally { setBusy(false); }
  };

  return (
    <Card style={{ marginTop: 16 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10, marginBottom: 4 }}>
        <div style={{ fontWeight: 700, fontSize: 13.5 }}>AGM figures — FY {fy}</div>
        <label style={{ fontSize: 12.5, color: "#64748B" }}>
          Figures apply to{" "}
          <select value={fy} onChange={(e) => setFy(e.target.value)}
                  style={{ ...inputStyle, width: 130, textAlign: "left", fontFamily: "inherit" }}>
            {years.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </label>
      </div>
      <p style={{ fontSize: 11.5, color: "#94A0AC", marginTop: 0, marginBottom: 14, lineHeight: 1.6 }}>
        <b>The year above is the year these figures apply to</b> — not the year the report covers. A September 2026 meeting reviewing FY 2025/2026 votes on the FY <b>2026/2027</b> figures, so that is where they are captured. There is no longer a "current" field beside a "proposed" one: they are the same field on two different years, and the report reads both — this year's row for its <i>Current</i> column, next year's for <i>New</i>.
        <br />
        <b>A figure here is a proposal until the meeting approves it, and a proposal changes nothing.</b> Record the approval below, then <i>apply</i> it — that is what writes the charges to <b>levy_rates</b> and the reserve designation to the <b>reserve ledger</b>, which is what the app actually bills and reports on. Before this, an approved figure had to be re-typed on another screen and nothing recorded that the meeting had decided anything.
        <br />
        <b>Sewerage, the water demand levy and the two electricity charges</b> have no council source until the tariff is published, and the invoice only carries what is being billed now — so for a future year these are the meeting's proposals and have no other origin. The insurance schedule lives on its own <b>Insurance</b> page.
        <br />
        <b>The two reserve fund fields</b> drive section 12. The <i>basis</i> settles which budget income lines the 15% statutory minimum is taken of — Regulation 2 says "the total budgeted contribution to the administrative fund" and never defines it, so this is the reading the trustees have adopted on the accountant's advice. Left unchosen it defaults to <b>all owner contributions</b>, the larger base and so the more conservative floor. Which rows fall into each reading is set per line on the <b>Budget</b> page.
        <br />
        <b>The water reconciliation factor</b> for FY {fy} is worked out from FY {previousFY(fy)}'s council invoices and readings, which is what the panel below computes. <b>Nothing is billed on it</b> — statements still use the tariff table directly — so it is never applied, only reported.
      </p>

      {status === "loading" && <div style={{ color: "#94A0AC", fontSize: 13 }}>Loading…</div>}
      {status === "error" && <div style={{ color: "#B5651D", fontWeight: 600, fontSize: 13 }}>Couldn’t load the AGM figures — see browser console.</div>}

      {status === "ready" && (
        <>
          <div style={{ fontWeight: 700, fontSize: 12, color: "#1B2A38", marginBottom: 8 }}>
            Figures for FY {fy}
            <span style={{ fontWeight: 400, color: "#94A0AC" }}> — rates and decisions that apply to this year</span>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: "10px 24px" }}>
            {AGM_FIELDS.filter((f) => f.scope !== "report").map((f) => (
              <label key={f.key} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, fontSize: 12.5 }}>
                <span style={{ color: "#1B2A38" }}>{f.label}</span>
                {f.kind === "select" ? (
                  <select
                    value={settings[f.key] ?? ""}
                    onChange={(e) => setSettings((prev) => ({ ...prev, [f.key]: e.target.value }))}
                    style={{ ...inputStyle, width: 230, textAlign: "left", fontFamily: "inherit" }}>
                    {f.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                ) : (
                <input
                  type={f.kind === "date" ? "date" : "text"}
                  inputMode={f.kind === "money" || f.kind === "number" ? "decimal" : undefined}
                  value={settings[f.key] ?? ""}
                  onChange={(e) => setSettings((prev) => ({ ...prev, [f.key]: e.target.value }))}
                  // Show what was actually understood, the moment focus leaves.
                  // Typing "1,125.75" and seeing it settle to 1125.75 is the
                  // difference between catching a mis-read and losing the figure.
                  onBlur={() => {
                    if (f.kind !== "money" && f.kind !== "number") return;
                    const n = num(settings[f.key], f.kind);
                    if (n === null || Number.isNaN(n)) return;
                    setSettings((prev) => ({ ...prev, [f.key]: f.kind === "money" ? n.toFixed(2) : String(n) }));
                  }}
                  style={{ ...inputStyle, width: f.kind === "text" || f.kind === "date" ? 150 : 110, textAlign: f.kind === "text" ? "left" : "right", fontFamily: f.kind === "text" || f.kind === "date" ? "inherit" : inputStyle.fontFamily }}
                />
                )}
              </label>
            ))}
          </div>

          <div style={{ fontWeight: 700, fontSize: 12, color: "#1B2A38", margin: "18px 0 8px" }}>
            Report metadata
            <span style={{ fontWeight: 400, color: "#94A0AC" }}> — describes a report COVERING FY {fy}, not a rate. Never applied.</span>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: "10px 24px" }}>
            {AGM_FIELDS.filter((f) => f.scope === "report").map((f) => (
              <label key={f.key} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, fontSize: 12.5 }}>
                <span style={{ color: "#1B2A38" }}>{f.label}</span>
                <input
                  type={f.kind === "date" ? "date" : "text"}
                  inputMode={f.kind === "money" || f.kind === "number" ? "decimal" : undefined}
                  value={settings[f.key] ?? ""}
                  onChange={(e) => setSettings((prev) => ({ ...prev, [f.key]: e.target.value }))}
                  onBlur={() => {
                    if (f.kind !== "money" && f.kind !== "number") return;
                    const n = num(settings[f.key], f.kind);
                    if (n === null || Number.isNaN(n)) return;
                    setSettings((prev) => ({ ...prev, [f.key]: f.kind === "money" ? n.toFixed(2) : String(n) }));
                  }}
                  style={{ ...inputStyle, width: f.kind === "text" || f.kind === "date" ? 150 : 110, textAlign: f.kind === "text" ? "left" : "right", fontFamily: f.kind === "text" || f.kind === "date" ? "inherit" : inputStyle.fontFamily }}
                />
              </label>
            ))}
          </div>

          <div style={{ marginTop: 16, padding: "10px 12px", background: "#F4F7F9", borderLeft: "3px solid #2F5D50", borderRadius: 4 }}>
            <div style={{ fontSize: 12.5, fontWeight: 700, color: "#1B2A38", marginBottom: 4 }}>
              Water rate card for FY {fy} — calculated from FY {previousFY(fy)}
            </div>
            {calcFactor === undefined && <div style={{ fontSize: 12, color: "#94A0AC" }}>Working it out from the council invoices and meter readings…</div>}
            {calcFactor === null && (
              <div style={{ fontSize: 12, color: "#94A0AC", lineHeight: 1.6 }}>
                Can’t be worked out from FY {previousFY(fy)} — it needs both council water invoices and unit meter readings for the same months. Capture them on <b>Utility bills</b> and <b>Meter readings</b>.
              </div>
            )}
            {calcFactor && (
              <div style={{ fontSize: 12, color: "#3D4B57", lineHeight: 1.7 }}>
                <b style={{ fontSize: 14 }}>{calcFactor.factor.toFixed(4)}</b>
                {" — "}{rand(calcFactor.numerator)} charged by the council over {calcFactor.months} month{calcFactor.months === 1 ? "" : "s"},
                {" "}divided by {rand(calcFactor.denominator)} of metered water priced on the council’s own scale, stopped at {calcFactor.topStepLabel}.
                {calcFactor.cardRates.length > 0 && (
                  <>
                    <br />
                    Card that produces: first {calcFactor.cardRates[0].from} kL free
                    {calcFactor.cardRates.map((b) => `, ${rand(b.card)}/kL ${b.to == null ? `above ${b.from}` : `for ${b.from}–${b.to}`} kL`).join("")}.
                  </>
                )}
                <br />
                <span style={{ color: "#94A0AC" }}>
                  Leave the field above blank to use this figure. Type one only to override what the meeting actually approved.
                  {calcFactor.missingInvoice && " Some months have readings but no invoice, or the reverse, and are left out of both sides."}
                </span>
                {" "}
                <button
                  style={{ ...primaryBtn, padding: "3px 10px", fontSize: 11.5, marginLeft: 2 }}
                  onClick={() => setSettings((p) => ({ ...p, water_reconciliation_factor: calcFactor.factor.toFixed(4) }))}>
                  Use this figure
                </button>
              </div>
            )}
          </div>

          <div style={{ marginTop: 18, display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
            <button style={primaryBtn} onClick={save} disabled={busy}>
              {/* Now safe to name the year: the row holds one year's figures. */}
              {busy ? "Saving…" : `Save FY ${fy} figures`}
            </button>
            {notice && <span style={{ fontSize: 12.5, color: "#2F5D50", fontWeight: 600 }}>{notice}</span>}
            {error && <span style={{ fontSize: 12.5, color: "#B5651D", fontWeight: 600 }}>{error}</span>}
          </div>
          <p style={{ fontSize: 11.5, color: "#94A0AC", marginTop: 12, lineHeight: 1.6 }}>
            The projected annual garden cost in the report is this year's rate per day times the visits per month, over twelve months — it isn’t entered here, so it can’t fall out of step with the rate.
            Leaving a field blank renders that row of the report as an empty cell to complete in Word, which is how the whole section used to work.
          </p>

          {/* ---------- Approval, and applying ---------- */}
          <div style={{ marginTop: 18, padding: "12px 14px", borderRadius: 6, background: row.figures_applied_at ? "#F1F6F3" : "#FBFAF6", border: `1px solid ${row.figures_applied_at ? "#B9D3C6" : "#D8D0BE"}` }}>
            <div style={{ fontWeight: 700, fontSize: 12.5, color: "#1B2A38", marginBottom: 6 }}>
              Approval and application — FY {fy}
            </div>
            <p style={{ fontSize: 11.5, color: "#94A0AC", margin: "0 0 10px", lineHeight: 1.6 }}>
              The figures above are <b>proposals</b> and change nothing on their own. Record the meeting's decision, then apply it — applying writes the three council charges to <b>levy_rates</b> and the opening designation to the <b>reserve ledger</b>. Sewerage and the garden and blockwatch fees are levy grid lines and still have to be entered on <b>Levy breakdown</b>; the panel says which, rather than reporting success for something it didn't write.
            </p>
            <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", fontSize: 12.5 }}>
              <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ color: "#1B2A38" }}>Approved on</span>
                <input type="date" value={row.figures_approved_on || ""}
                       onChange={(e) => markApproved(e.target.value, row.figures_approved_by)}
                       disabled={busy}
                       style={{ ...inputStyle, width: 150, textAlign: "left", fontFamily: "inherit" }} />
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ color: "#1B2A38" }}>by</span>
                <input value={row.figures_approved_by || ""}
                       placeholder="meeting / resolution"
                       onChange={(e) => setRow((p) => ({ ...p, figures_approved_by: e.target.value }))}
                       onBlur={(e) => { if (row.figures_approved_on) markApproved(row.figures_approved_on, e.target.value); }}
                       disabled={busy}
                       style={{ ...inputStyle, width: 190, textAlign: "left", fontFamily: "inherit" }} />
              </label>
              {row.figures_approved_on && (
                <button style={{ ...primaryBtn, background: "#2F5D50" }} onClick={applyFigures} disabled={busy}>
                  {busy ? "Applying…" : row.figures_applied_at ? `Apply again to FY ${fy}` : `Apply approved figures to FY ${fy}`}
                </button>
              )}
            </div>
            {row.figures_applied_at && (
              <div style={{ fontSize: 11.5, color: "#2F5D50", marginTop: 8, fontWeight: 600 }}>
                Last applied {new Date(row.figures_applied_at).toLocaleString("en-ZA")}. Applying again is safe — a designation already on the ledger is not written twice.
              </div>
            )}
            {!row.figures_approved_on && (
              <div style={{ fontSize: 11.5, color: "#94A0AC", marginTop: 8 }}>
                Nothing can be applied until an approval date is recorded.
              </div>
            )}
            {applyResult && (
              <div style={{ marginTop: 10, fontSize: 11.5, lineHeight: 1.7, color: "#3D4B57" }}>
                {applyResult.written.length > 0 && (
                  <div><b style={{ color: "#2F5D50" }}>Written:</b> {applyResult.written.map((w) => `${w.figure} → ${w.to} (${rand(w.value)})`).join(" · ")}</div>
                )}
                {applyResult.manual.length > 0 && (
                  <div><b style={{ color: "#8A6A1E" }}>Still to enter by hand:</b> {applyResult.manual.map((m) => `${m.figure} → ${m.where}`).join(" · ")}</div>
                )}
                {applyResult.skipped.length > 0 && (
                  <div><b style={{ color: "#94A0AC" }}>Not applied:</b> {applyResult.skipped.map((k) => `${k.figure} — ${k.reason}`).join(" · ")}</div>
                )}
              </div>
            )}
          </div>
        </>
      )}
    </Card>
  );
}

function reconcileUnits(rows, bankTxns, remittanceDeductions = {}, remittanceAdvices = {}, period = CURRENT_PERIOD, manualPayments = []) {
  return rows.map((r) => {
    const ded = remittanceDeductions[r.id];
    const adv = remittanceAdvices[r.id];
    const expected = ded && ded.approved ? r.total - ded.amount : r.total;

    // Every bank line applied to THIS statement month — not just the first one
    // (the old .find() silently discarded the rest), and not tied to whichever
    // bank month it happened to land in.
    const txns = bankTxns.filter(
      (t) => t.category === "resident_payment" && t.matchedUnit === r.id && t.appliedPeriod === period
    );

    // Real bank data always wins. A manual entry is only used while no bank line
    // exists for this unit and month, so importing the statement supersedes it
    // automatically — nothing to flag, and re-importing stays correct.
    const manual = manualPayments.filter((m) => m.unit === r.id && m.appliedPeriod === period);
    const usingManual = txns.length === 0 && manual.length > 0;
    const sources = txns.length ? txns : manual;

    if (!sources.length) {
      return { unit: r, txn: null, txns: [], manual: [], provisional: false, status: "outstanding", expected, received: 0, diff: undefined, settled: false, ded, adv };
    }

    const received = round2(sources.reduce((s, t) => s + t.amount, 0));
    const diff = round2(received - expected);
    const withinTolerance = Math.abs(diff) < RECON_TOLERANCE;
    const reviewed = txns.some((t) => t.reviewed);
    const settled = withinTolerance || reviewed;
    const status = withinTolerance ? "paid" : (reviewed ? "resolved" : "review");

    // `txn` retained so the existing single-line ReviewControls keep working.
    return {
      unit: r, txn: txns[0] || null, txns, manual,
      provisional: usingManual,
      status, diff, expected, received, settled, ded, adv,
    };
  });
}

const CATEGORY_LABELS = {
  resident_payment: "Resident payment",
  council_payment: "Council payment",
  interest: "Interest",
  bank_charge: "Bank charge",
  needs_review: "Needs review",
};
const CATEGORY_COLORS = {
  resident_payment: { bg: "#E4EFEA", color: "#2F5D50" },
  council_payment: { bg: "#E4E8F1", color: "#2A3E7A" },
  interest: { bg: "#E4EFEA", color: "#2F5D50" },
  bank_charge: { bg: "#F6E7DA", color: "#B5651D" },
  needs_review: { bg: "#F1EAD3", color: "#8A6D1E" },
};
function CategoryBadge({ category }) {
  const c = CATEGORY_COLORS[category] || CATEGORY_COLORS.needs_review;
  return (
    <span style={{ background: c.bg, color: c.color, fontSize: 11, fontWeight: 700, padding: "3px 9px", borderRadius: 20, whiteSpace: "nowrap" }}>
      {CATEGORY_LABELS[category] || category}
    </span>
  );
}

// Lets the trustee write a note against a bank line (explaining a difference or
// an unmatched deposit) and mark it resolved. Used both on the per-unit
// variance rows and on any "needs review" statement line.
function ReviewControls({ txn, onReviewTxn, compact }) {
  const [editing, setEditing] = useState(false);
  const [note, setNote] = useState(txn.reviewNote || "");
  useEffect(() => { setNote(txn.reviewNote || ""); }, [txn.reviewNote]);
  const linkBtn = { background: "none", border: "none", padding: 0, fontSize: 11, fontWeight: 700, color: "#2A3E7A", cursor: "pointer", textDecoration: "underline" };

  if (txn.reviewed && !editing) {
    return (
      <div style={{ minWidth: compact ? 0 : 160 }}>
        <span style={{ color: "#2F5D50", fontWeight: 700, fontSize: 11 }}>✓ Reviewed</span>
        {txn.reviewNote && <div style={{ color: "#64748B", fontSize: 11, marginTop: 2, maxWidth: 220 }}>{txn.reviewNote}</div>}
        <button onClick={() => setEditing(true)} style={{ ...linkBtn, marginTop: 2 }}>Edit</button>
      </div>
    );
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 5, minWidth: 200 }}>
      <input
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Note — explain the difference"
        style={{ padding: "5px 8px", borderRadius: 6, border: "1px solid #D8D0BE", fontSize: 11.5, fontFamily: "'Inter', sans-serif" }}
      />
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <button
          onClick={() => { onReviewTxn(txn, { reviewed: true, reviewNote: note.trim() }); setEditing(false); }}
          style={{ fontSize: 11, fontWeight: 700, color: "#1B2A38", background: "#F1EAD3", border: "none", borderRadius: 5, padding: "3px 10px", cursor: "pointer" }}
        >
          Mark reviewed
        </button>
        {txn.reviewed && (
          <button onClick={() => { onReviewTxn(txn, { reviewed: false, reviewNote: note.trim() }); setEditing(false); }} style={linkBtn}>
            Re-open
          </button>
        )}
      </div>
    </div>
  );
}

// Points a bank line at a different statement month. A payment normally settles
// the previous month's statement, but residents pay early, late, and sometimes
// twice in one bank month — the July 2026 statement had two Cor 6 credits, one
// for June and one for July.
function AppliedPeriodSelect({ txn, onChange }) {
  const [busy, setBusy] = useState(false);
  const bankPeriod = txn.period;
  if (!bankPeriod) return null;

  const defaultApplied = prevPeriod(bankPeriod);
  const options = [prevPeriod(defaultApplied), defaultApplied, bankPeriod];
  const current = txn.appliedPeriod || defaultApplied;
  const isOverride = current !== defaultApplied;

  return (
    <select
      value={current}
      disabled={busy}
      title={isOverride ? "Retargeted by trustee" : "Statement month this payment settles"}
      onChange={async (e) => {
        setBusy(true);
        try { await onChange(txn, e.target.value); }
        catch (err) { window.alert(err.message); }
        finally { setBusy(false); }
      }}
      style={{
        marginLeft: 8, fontSize: 10.5, fontWeight: 700, padding: "1px 4px", borderRadius: 4,
        border: "1px solid #C9C1B2",
        background: isOverride ? "#F1EAD3" : "transparent",
        color: isOverride ? "#8A6D1E" : "#64748B",
      }}
    >
      {options.map((p) => <option key={p} value={p}>{periodLabel(p)}</option>)}
    </select>
  );
}

// Records a payment before the bank statement exists — needed when the AGM
// falls before the statement showing those payments has been issued. The entry
// is provisional: reconcileUnits drops it the moment a real bank line appears
// for the same unit and month, so importing the statement can't double count.
function ManualPaymentControls({ match, period, onAdd, onRemove }) {
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [datePaid, setDatePaid] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const existing = match.manual && match.manual[0];
  const supersededByBank = existing && match.txns.length > 0;

  // A manual entry that the bank statement has since confirmed is dead weight —
  // surface it so the trustee can clear it rather than leaving it to rot.
  if (supersededByBank) {
    return (
      <div style={{ marginTop: 6, fontSize: 10.5, color: "#64748B" }}>
        manual entry superseded by bank
        {onRemove && (
          <button
            onClick={async () => { setBusy(true); try { await onRemove(existing.dbId); } finally { setBusy(false); } }}
            disabled={busy}
            style={{ background: "none", border: "none", padding: "0 0 0 6px", fontSize: 10.5, fontWeight: 700, color: "#2A3E7A", cursor: "pointer", textDecoration: "underline" }}
          >clear</button>
        )}
      </div>
    );
  }

  if (existing) {
    return (
      <div style={{ marginTop: 6, fontSize: 10.5 }}>
        {onRemove && (
          <button
            onClick={async () => { setBusy(true); try { await onRemove(existing.dbId); } finally { setBusy(false); } }}
            disabled={busy}
            style={{ background: "none", border: "none", padding: 0, fontSize: 10.5, fontWeight: 700, color: "#B5651D", cursor: "pointer", textDecoration: "underline" }}
          >remove manual payment</button>
        )}
      </div>
    );
  }

  if (match.txns.length) return null; // already reconciled against the bank

  if (!open) {
    return (
      <div style={{ marginTop: 6 }}>
        <button
          onClick={() => { setOpen(true); setAmount(String(match.expected.toFixed(2))); }}
          style={{ background: "none", border: "none", padding: 0, fontSize: 10.5, fontWeight: 700, color: "#2A3E7A", cursor: "pointer", textDecoration: "underline" }}
        >record payment manually</button>
      </div>
    );
  }

  const submit = async () => {
    const amt = parseAmount(amount);
    if (!(amt > 0)) { window.alert("Enter an amount greater than zero."); return; }
    setBusy(true);
    try {
      await onAdd({ unitId: match.unit.id, amount: amt, datePaid: datePaid || null, note: note || null });
      setOpen(false); setAmount(""); setDatePaid(""); setNote("");
    } catch (err) {
      window.alert(err.message);
    } finally {
      setBusy(false);
    }
  };

  const inp = { fontSize: 11, padding: "3px 5px", border: "1px solid #C9C1B2", borderRadius: 4, width: "100%" };

  return (
    <div style={{ marginTop: 6, display: "grid", gap: 4, minWidth: 150 }}>
      <input style={inp} value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="Amount" inputMode="decimal" />
      <input style={inp} value={datePaid} onChange={(e) => setDatePaid(e.target.value)} type="date" title="Date paid" />
      <input style={inp} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (e.g. EFT proof)" />
      <div style={{ display: "flex", gap: 6 }}>
        <button onClick={submit} disabled={busy}
          style={{ background: "#2F5D50", color: "#fff", border: 0, borderRadius: 4, padding: "3px 9px", fontSize: 10.5, fontWeight: 700, cursor: "pointer" }}>
          {busy ? "Saving…" : "Save"}
        </button>
        <button onClick={() => setOpen(false)} disabled={busy}
          style={{ background: "none", border: "none", fontSize: 10.5, fontWeight: 700, color: "#64748B", cursor: "pointer" }}>
          Cancel
        </button>
      </div>
    </div>
  );
}

function Reconciliation({
  alloc, period, remittanceDeductions, setRemittanceDeductions, remittanceAdvices,
  bankTxns, manualPayments = [], onAddManualPayment, onRemoveManualPayment, onChangeAppliedPeriod,
  onReviewTxn, onTagTxn, onGoToBankRecon,
}) {
  const categoryNames = useExpenseCategoryNames();

  const approve = async (unitId) => {
    const ded = remittanceDeductions[unitId];
    try {
      if (ded && ded.dbId) {
        const client = await ensureSupabaseClient();
        const { error } = await client.from("remittance_advices").update({ deduction_approved: true }).eq("id", ded.dbId);
        if (error) throw error;
      }
      setRemittanceDeductions((prev) => ({
        ...prev,
        [unitId]: { ...prev[unitId], approved: true },
      }));
    } catch (err) {
      console.error("Approving deduction failed:", err);
    }
  };

  // Retag one line of a resident's deduction claim. Residents can pick a
  // category when they submit, but often don't (or pick the wrong one), so the
  // trustee gets the final say — these amounts are real Body Corp expenses and
  // feed the analytics dashboard exactly like a bank debit does.
  const retagDeductionItem = async (unitId, index, next) => {
    const ded = remittanceDeductions[unitId];
    if (!ded) return;
    const nextItems = ded.items.map((it, i) => (i === index ? { ...it, expenseCategory: next } : it));
    setRemittanceDeductions((prev) => ({ ...prev, [unitId]: { ...prev[unitId], items: nextItems } }));
    try {
      if (!ded.dbId) return; // demo data — local-only
      const client = await ensureSupabaseClient();
      const { error } = await client
        .from("remittance_advices")
        .update({
          deductions: nextItems.map((it) => ({
            amount: it.amount, comment: it.comment, expenseCategory: it.expenseCategory || null,
          })),
        })
        .eq("id", ded.dbId);
      if (error) throw error;
    } catch (err) {
      console.error("Retagging deduction failed:", err);
      setRemittanceDeductions((prev) => ({ ...prev, [unitId]: { ...prev[unitId], items: ded.items } }));
      window.alert("Couldn't save the deduction category — see browser console.");
    }
  };

  const matches = reconcileUnits(alloc.rows, bankTxns, remittanceDeductions, remittanceAdvices || {}, period, manualPayments);

  // The transaction listing shows this bank statement only. Lines pulled in
  // from another bank month (a payment applied here) are already represented
  // in the per-unit rows above and would look like strays in the listing.
  // (t.period is undefined for the in-memory demo statement — keep those.)
  const otherTxns = bankTxns.filter(
    (t) => !(t.category === "resident_payment" && t.matchedUnit) && (!t.period || t.period === nextPeriod(period))
  );
  // Outstanding review work = unmatched "needs review" lines not yet handled,
  // plus per-unit variances not yet marked resolved.
  const needsReviewCount =
    bankTxns.filter((t) => t.category === "needs_review" && !t.reviewed).length +
    matches.filter((m) => m.status === "review").length;
  // Debits with no expense tag — these land under "Unclassified" on the
  // analytics dashboard until the trustee tags them.
  const untaggedDebits = otherTxns.filter((t) => t.direction === "debit" && !t.expenseCategory).length;

  return (
    <>
      <h1 className="f-display" style={{ fontSize: 24, marginBottom: 4 }}>Tenant recon — {periodLabel(period)} statements</h1>
      <p style={{ color: "#64748B", fontSize: 13.5, marginBottom: 18 }}>
        {periodLabel(period)} levies are paid the following month, so these statements are matched against the <strong>{periodLabel(nextPeriod(period))} bank statement</strong>, by payment reference (Cor/Unit + number) against submitted remittance advices. Approved Body Corp expense deductions reduce the expected payment before comparing. Any "needs review" line or variance can be noted and marked resolved below.
      </p>

      {/* Importing moved to Bank recon on 8 August 2026. Two upload paths writing
          one table is how the two drift apart — Bank recon owns the import and
          verifies it against the statement's own balances; this page consumes
          what it produced and does the matching. */}
      <Card style={{ marginBottom: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
          <button style={primaryBtn} onClick={() => onGoToBankRecon && onGoToBankRecon()}>
            Go to Bank recon
          </button>
          <div style={{ fontSize: 12.5, color: "#64748B" }}>
            Bank statements are imported on <strong>Bank recon</strong>, which checks the import against the statement's own opening and closing balances before it is saved. This page reads what it imported.
            {bankTxns && bankTxns.length ? (
              <span style={{ color: "#2F5D50", fontWeight: 600 }}>{" "}✓ {bankTxns.length} transactions loaded for {periodLabel(nextPeriod(period))}.</span>
            ) : (
              <span style={{ color: "#B5651D", fontWeight: 600 }}>{" "}No transactions loaded for {periodLabel(nextPeriod(period))} — import that statement first.</span>
            )}
          </div>
        </div>
      </Card>

      <Card>
        <div style={{ fontWeight: 700, fontSize: 13.5, marginBottom: 10 }}>Per-unit reconciliation</div>
        <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", fontSize: 13, borderCollapse: "collapse", minWidth: 1000 }}>
          <thead>
            <tr style={{ color: "#64748B", textAlign: "left", fontSize: 11, textTransform: "uppercase" }}>
              <th style={{ padding: "6px 8px" }}>Unit</th>
              <th style={{ padding: "6px 8px" }}>Statement total</th>
              <th style={{ padding: "6px 8px" }}>Remittance advice</th>
              <th style={{ padding: "6px 8px" }}>Expected</th>
              <th style={{ padding: "6px 8px" }}>Bank ref</th>
              <th style={{ padding: "6px 8px" }}>Amount received</th>
              <th style={{ padding: "6px 8px" }}>Variance</th>
              <th style={{ padding: "6px 8px" }}>Status</th>
            </tr>
          </thead>
          <tbody>
            {matches.map((m) => {
              const dedItems = m.ded
                ? (m.ded.items && m.ded.items.length ? m.ded.items : [{ amount: m.ded.amount, comment: m.ded.comment }])
                : [];
              return (
              <React.Fragment key={m.unit.id}>
              <tr style={{ borderTop: "1px solid #EEE7D6" }}>
                <td className="f-mono" style={{ padding: "9px 8px", fontWeight: 600 }}>{m.unit.id}</td>
                <td className="f-mono" style={{ padding: "9px 8px" }}>{rand(m.unit.total)}</td>
                <td style={{ padding: "9px 8px", fontSize: 12 }}>
                  {m.adv ? (
                    <div>
                      <div className="f-mono">{m.adv.amountPaid != null ? rand(m.adv.amountPaid) : "—"}</div>
                      <div style={{ color: "#64748B", fontSize: 11 }}>
                        {m.adv.datePaid ? `paid ${m.adv.datePaid}` : "payment date not given"}
                      </div>
                      <ProofLinks paths={m.adv.proofFileNames} />
                    </div>
                  ) : (
                    <span style={{ color: "#94A3B8", fontSize: 11 }}>none submitted</span>
                  )}
                </td>
                <td className="f-mono" style={{ padding: "9px 8px", fontWeight: 600 }}>{rand(m.expected)}</td>
                <td style={{ padding: "9px 8px", fontSize: 12 }}>
                  {m.provisional ? (
                    m.manual.map((mp) => (
                      <div key={mp.dbId} style={{ marginBottom: 3 }}>
                        <span style={{ background: "#F1EAD3", color: "#8A6D1E", fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 20 }}>
                          MANUAL
                        </span>
                        <span style={{ color: "#64748B", fontSize: 11, marginLeft: 6 }}>
                          {mp.datePaid ? `paid ${mp.datePaid}` : "no date"}{mp.note ? ` · ${mp.note}` : ""}
                        </span>
                      </div>
                    ))
                  ) : m.txns.length ? (
                    m.txns.map((t, i) => (
                      <div key={t.dbId || i} className="f-mono" style={{ marginBottom: 3 }}>
                        {t.ref}
                        <span className="f-sans" style={{ color: "#64748B", fontSize: 11 }}> · {rand(t.amount)}</span>
                        {t.dbId && onChangeAppliedPeriod && (
                          <AppliedPeriodSelect txn={t} onChange={onChangeAppliedPeriod} />
                        )}
                      </div>
                    ))
                  ) : "—"}
                </td>
                <td className="f-mono" style={{ padding: "9px 8px" }}>
                  {m.received ? rand(m.received) : "—"}
                  {m.txns.length > 1 && (
                    <div className="f-sans" style={{ color: "#64748B", fontSize: 10.5 }}>{m.txns.length} payments</div>
                  )}
                </td>
                <td className="f-mono" style={{ padding: "9px 8px", color: m.diff ? "#B5651D" : "#2F5D50" }}>
                  {m.diff !== undefined ? rand(m.diff) : "—"}
                </td>
                <td style={{ padding: "9px 8px" }}>
                  <StatusChip status={m.status} />
                  {m.provisional && (
                    <div style={{ fontSize: 10, color: "#8A6D1E", fontWeight: 700, marginTop: 3 }}>
                      awaiting bank confirmation
                    </div>
                  )}
                  {m.txn && (m.status === "review" || m.status === "resolved") && (
                    <div style={{ marginTop: 6 }}>
                      <ReviewControls txn={m.txn} onReviewTxn={onReviewTxn} />
                    </div>
                  )}
                  {onAddManualPayment && (
                    <ManualPaymentControls
                      match={m}
                      period={period}
                      onAdd={onAddManualPayment}
                      onRemove={onRemoveManualPayment}
                    />
                  )}
                </td>
              </tr>
              {m.ded && (
                <tr>
                  <td colSpan={8} style={{ padding: "0 8px 12px 8px" }}>
                    <div style={{ marginLeft: 24, background: "#FBF6EC", border: "1px solid #EAD9C4", borderRadius: 8, padding: "10px 12px", maxWidth: 560 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                        <span style={{ fontSize: 10.5, fontWeight: 700, color: "#8A6D1E", textTransform: "uppercase", letterSpacing: 0.4 }}>
                          Deductions — {m.unit.id} ({dedItems.length})
                        </span>
                        {m.ded.approved ? (
                          <span style={{ color: "#2F5D50", fontWeight: 700, fontSize: 11 }}>✓ Approved</span>
                        ) : (
                          <button onClick={() => approve(m.unit.id)} style={{ fontSize: 11, fontWeight: 700, color: "#1B2A38", background: "#F1EAD3", border: "none", borderRadius: 4, padding: "3px 10px", cursor: "pointer" }}>
                            Approve all
                          </button>
                        )}
                      </div>
                      <table style={{ width: "100%", fontSize: 12, borderCollapse: "collapse" }}>
                        <thead>
                          <tr style={{ color: "#94A0AC", textAlign: "left", fontSize: 10, textTransform: "uppercase" }}>
                            <th style={{ padding: "2px 6px" }}>Description</th>
                            <th style={{ padding: "2px 6px" }}>Expense tag</th>
                            <th style={{ padding: "2px 6px", textAlign: "right" }}>Amount</th>
                          </tr>
                        </thead>
                        <tbody>
                          {dedItems.map((it, i) => (
                            <tr key={i} style={{ borderTop: "1px solid #EEE7D6" }}>
                              <td style={{ padding: "4px 6px", color: "#64748B" }}>{it.comment || "Deduction"}</td>
                              <td style={{ padding: "4px 6px" }}>
                                <ExpenseCategorySelect
                                  value={it.expenseCategory}
                                  onChange={(v) => retagDeductionItem(m.unit.id, i, v)}
                                  names={categoryNames}
                                  placeholder="Untagged"
                                  style={{ fontSize: 11, padding: "3px 6px" }}
                                />
                              </td>
                              <td className="f-mono" style={{ padding: "4px 6px", textAlign: "right", color: "#B5651D" }}>−{rand(it.amount)}</td>
                            </tr>
                          ))}
                        </tbody>
                        <tfoot>
                          <tr style={{ borderTop: "1px solid #1B2A38" }}>
                            <td colSpan={2} style={{ padding: "4px 6px", fontWeight: 700 }}>Total deductions</td>
                            <td className="f-mono" style={{ padding: "4px 6px", textAlign: "right", fontWeight: 700, color: "#B5651D" }}>−{rand(m.ded.amount)}</td>
                          </tr>
                        </tfoot>
                      </table>
                      {!m.ded.proofAttached && (
                        <div style={{ color: "#B5651D", fontSize: 10.5, marginTop: 6 }}>No proof of payment attached</div>
                      )}
                      <div style={{ fontSize: 10.5, color: "#94A0AC", marginTop: 4 }}>
                        Deductions only reduce the expected amount once approved. Proof documents are shown under “Remittance advice”.
                      </div>
                    </div>
                  </td>
                </tr>
              )}
              </React.Fragment>
              );
            })}
          </tbody>
        </table>
        </div>
      </Card>

      <Card style={{ marginTop: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 10 }}>
          <div style={{ fontWeight: 700, fontSize: 13.5 }}>All bank statement lines ({bankTxns.length})</div>
          <div style={{ display: "flex", gap: 14 }}>
            {untaggedDebits > 0 && (
              <div style={{ fontSize: 12, color: "#B5651D", fontWeight: 600 }}>{untaggedDebits} untagged expense{untaggedDebits === 1 ? "" : "s"}</div>
            )}
            {needsReviewCount > 0 && (
              <div style={{ fontSize: 12, color: "#8A6D1E", fontWeight: 600 }}>{needsReviewCount} to review</div>
            )}
          </div>
        </div>
        <p style={{ fontSize: 12, color: "#64748B", marginBottom: 12 }}>
          Every line from the statement, categorised — council payments, interest, and bank charges are captured here too, not just resident levy payments, so nothing is silently dropped.
          Tag each <strong>debit</strong> with an expense category: that tag is what the analytics dashboard reports on. Anything left untagged appears there as “Unclassified”.
        </p>
        <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", fontSize: 12.5, borderCollapse: "collapse", minWidth: 820 }}>
          <thead>
            <tr style={{ color: "#64748B", textAlign: "left", fontSize: 10.5, textTransform: "uppercase" }}>
              <th style={{ padding: "6px 8px" }}>Date</th>
              <th style={{ padding: "6px 8px" }}>Description</th>
              <th style={{ padding: "6px 8px", textAlign: "right" }}>Amount</th>
              <th style={{ padding: "6px 8px" }}>Category</th>
              <th style={{ padding: "6px 8px" }}>Expense tag</th>
              <th style={{ padding: "6px 8px" }}>Unit</th>
              <th style={{ padding: "6px 8px" }}>Note</th>
              <th style={{ padding: "6px 8px" }}>Review</th>
            </tr>
          </thead>
          <tbody>
            {otherTxns.map((t, i) => {
              const canReview = t.category === "needs_review" || t.reviewed;
              return (
              <tr key={i} style={{ borderTop: "1px solid #EEE7D6" }}>
                <td className="f-mono" style={{ padding: "8px" }}>{t.date}</td>
                <td style={{ padding: "8px" }}>{t.desc}</td>
                <td className="f-mono" style={{ padding: "8px", textAlign: "right", color: t.direction === "debit" ? "#B5651D" : "#1B2A38" }}>
                  {t.direction === "debit" ? "−" : ""}{rand(t.amount)}
                </td>
                <td style={{ padding: "8px" }}><CategoryBadge category={t.category} /></td>
                <td style={{ padding: "8px" }}>
                  {t.direction === "debit" ? (
                    <ExpenseCategorySelect
                      value={t.expenseCategory}
                      onChange={(v) => onTagTxn(t, v)}
                      names={categoryNames}
                      placeholder="Untagged"
                    />
                  ) : (
                    <span style={{ color: "#C7CDD4" }}>—</span>
                  )}
                </td>
                <td className="f-mono" style={{ padding: "8px" }}>{t.matchedUnit || "—"}</td>
                <td style={{ padding: "8px", color: "#64748B", fontSize: 11.5 }}>{t.note}</td>
                <td style={{ padding: "8px" }}>
                  {canReview ? <ReviewControls txn={t} onReviewTxn={onReviewTxn} /> : <span style={{ color: "#C7CDD4" }}>—</span>}
                </td>
              </tr>
              );
            })}
          </tbody>
        </table>
        </div>
      </Card>
    </>
  );
}

// ---------- Statement preview (paper look) ----------
function StatementPreview({
  alloc, period, selectedUnit, setSelectedUnit, onSaveOverride,
  ownershipChanges = {}, onSaveOwnershipChange, waterBands = [],
}) {
  const r = alloc.rows.find((x) => x.id === selectedUnit);
  const change = ownershipChanges[selectedUnit] || null;
  const split = useMemo(
    () => splitStatementForChangeover(r, change, waterBands, period),
    [r, change, waterBands, period]
  );
  // Only one half prints at a time — a statement is a document sent to one
  // person, and printing both onto one page would send each owner the other's.
  const [printing, setPrinting] = useState(null); // null | "outgoing" | "incoming"
  const gate = useStatementReleaseGate(period);
  const printHalf = (which) => {
    if (!gate.released) return;
    setPrinting(which);
    // Let the class land before the print dialog reads the DOM.
    setTimeout(() => { printStatement(); setTimeout(() => setPrinting(null), 0); }, 50);
  };
  const printWhole = () => { if (gate.released) printStatement(); };
  // Disabled rather than hidden: the trustee needs to see that the action
  // exists and why it is unavailable, not wonder where it went.
  const releaseBtn = (base) => (gate.released ? base : { ...base, opacity: 0.45, cursor: "not-allowed" });

  return (
    <>
      <div className="no-print" style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 16 }}>
        <h1 className="f-display" style={{ fontSize: 24 }}>Statement preview — {periodLabel(period)}</h1>
        <select value={selectedUnit} onChange={(e) => setSelectedUnit(e.target.value)} style={{ padding: "6px 10px", borderRadius: 6, border: "1px solid #D8D0BE" }}>
          {UNITS.map((u) => <option key={u.id} value={u.id}>{u.id} — {u.owner}</option>)}
        </select>
      </div>

      <div className="no-print">
        <ApprovalCheckbox subject="statements" period={period} />
        <StatementReleaseGate gate={gate} period={period} />
      </div>

      {split ? (
        <>
          <Card className="no-print" style={{ marginBottom: 16, background: "#F1F5F2", border: "1px solid #D5E2D9" }}>
            <div style={{ fontSize: 12.5, color: "#2F5D50", lineHeight: 1.7 }}>
              <b>Unit {selectedUnit.slice(1)} changed hands on {fmtLongDate(change.changeoverDate)}.</b> Two statements for {periodLabel(period)}:
              the outgoing owner carries {split.outDays} of {split.daysInMonth} days, the incoming owner {split.inDays}.
              <br />
              Water and electricity are <b>not</b> pro-rated — each owner is billed the actual consumption either side of the changeover reading.
              The fixed levy lines are split by days, and each line reconciles to the full month exactly.
            </div>
          </Card>

          {[["outgoing", split.outgoing], ["incoming", split.incoming]].map(([key, half]) => (
            <div key={key} style={{ marginBottom: 28 }} className={printing && printing !== key ? "no-print" : undefined}>
              <div className="no-print" style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 8, flexWrap: "wrap" }}>
                <span style={{ fontWeight: 700, fontSize: 14 }}>{half.proRata.label}</span>
                <span style={{ fontSize: 12.5, color: "#64748B" }}>
                  {fmtLongDate(half.proRata.from)} – {fmtLongDate(half.proRata.to)} · {half.proRata.days}/{half.proRata.daysInMonth} days
                  {half.owner ? ` · ${half.owner}` : ""}
                </span>
              </div>
              <StatementPaper r={half} period={period} />
              <div className="no-print" style={{ marginTop: 12, display: "flex", gap: 10 }}>
                <button style={releaseBtn(secondaryBtn)} onClick={() => printHalf(key)} disabled={!gate.released}
                        title={gate.released ? undefined : gate.blockedReason}>
                  Download {half.proRata.label.toLowerCase()} PDF
                </button>
              </div>
            </div>
          ))}
        </>
      ) : (
        <>
          <StatementPaper r={r} period={period} />
          <div className="no-print" style={{ marginTop: 16, display: "flex", gap: 10 }}>
            <button style={releaseBtn(primaryBtn)} disabled={!gate.released}
                    title={gate.released ? undefined : gate.blockedReason}>
              Send to {r.owner}
            </button>
            <button style={releaseBtn(secondaryBtn)} onClick={printWhole} disabled={!gate.released}
                    title={gate.released ? undefined : gate.blockedReason}>
              Download PDF
            </button>
          </div>
        </>
      )}

      {onSaveOwnershipChange && (
        <OwnershipChangeCard
          r={r} period={period} change={change} split={split} onSave={onSaveOwnershipChange}
        />
      )}
      {onSaveOverride && !split && <StatementAdjustments r={r} period={period} onSaveOverride={onSaveOverride} />}
    </>
  );
}

// Records a mid-month transfer for the selected unit and month. Removing the
// record puts the month straight back to a single statement, so it is safe to
// experiment with.
function OwnershipChangeCard({ r, period, change, split, onSave }) {
  const [date, setDate] = useState(change?.changeoverDate || "");
  const [water, setWater] = useState(change?.waterReading != null ? String(change.waterReading) : "");
  const [elec, setElec] = useState(change?.electricityReading != null ? String(change.electricityReading) : "");
  const [outName, setOutName] = useState(change?.outgoingOwner || "");
  const [inName, setInName] = useState(change?.incomingOwner || "");
  const [note, setNote] = useState(change?.note || "");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    setDate(change?.changeoverDate || "");
    setWater(change?.waterReading != null ? String(change.waterReading) : "");
    setElec(change?.electricityReading != null ? String(change.electricityReading) : "");
    setOutName(change?.outgoingOwner || "");
    setInName(change?.incomingOwner || "");
    setNote(change?.note || "");
    setStatus(null); setError(null);
  }, [r.id, period, change]);

  const num = (v) => {
    const t = String(v ?? "").trim().replace(/\s/g, "").replace(",", ".");
    if (t === "") return null;
    const n = Number(t);
    return isFinite(n) ? n : null;
  };
  const run = async (fn, msg) => {
    setBusy(true); setStatus(null); setError(null);
    try { await fn(); setStatus(msg); }
    catch (err) { console.error("Saving the ownership change failed:", err); setError(err.message || "Save failed — see browser console."); }
    finally { setBusy(false); }
  };
  const save = () => run(() => onSave(r.id, {
    changeoverDate: date, waterReading: num(water), electricityReading: num(elec),
    outgoingOwner: outName.trim(), incomingOwner: inName.trim(), note: note.trim(),
  }), "Saved — the statement above is now split.");
  const clear = () => run(() => onSave(r.id, null), "Removed — back to one statement for the month.");

  const fieldStyle = { width: 170, padding: "7px 10px", borderRadius: 6, border: "1px solid #D8D0BE", fontFamily: "'IBM Plex Mono', monospace", fontSize: 13 };
  const labelStyle = { display: "block", fontSize: 11.5, fontWeight: 600, color: "#1B2A38", marginBottom: 4 };
  const [y, m] = String(period).split("-").map(Number);
  const monthEnd = `${y}-${String(m).padStart(2, "0")}-${String(new Date(y, m, 0).getDate()).padStart(2, "0")}`;

  return (
    <Card className="no-print" style={{ marginTop: 20, background: "#FBF8F1", border: "1px solid #E4DCC8" }}>
      <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 4 }}>Ownership change — Unit {r.id.slice(1)}, {periodLabel(period)}</div>
      <p style={{ fontSize: 12.5, color: "#64748B", marginBottom: 14 }}>
        For a unit that transferred mid-month. Enter the date the outgoing owner's liability <b>ends</b> (inclusive) and the meter readings taken that day.
        The month then produces two statements: metered usage split at the reading, fixed levy lines split by days.
      </p>
      <div style={{ display: "flex", gap: 18, flexWrap: "wrap", alignItems: "flex-end" }}>
        <div>
          <label style={labelStyle}>Changeover date</label>
          <input type="date" value={date} min={`${y}-${String(m).padStart(2, "0")}-01`} max={monthEnd}
                 onChange={(e) => { setDate(e.target.value); setStatus(null); }} style={{ ...fieldStyle, fontFamily: "inherit" }} />
        </div>
        <div>
          <label style={labelStyle}>Water reading that day (kL)</label>
          <input value={water} inputMode="decimal" onChange={(e) => { setWater(e.target.value); setStatus(null); }}
                 placeholder={`opening ${r.wPrev}`} style={fieldStyle} />
        </div>
        <div>
          <label style={labelStyle}>Electricity reading that day (kWh)</label>
          <input value={elec} inputMode="decimal" onChange={(e) => { setElec(e.target.value); setStatus(null); }}
                 placeholder={`opening ${r.ePrev}`} style={fieldStyle} />
        </div>
      </div>
      <div style={{ display: "flex", gap: 18, flexWrap: "wrap", alignItems: "flex-end", marginTop: 14 }}>
        <div>
          <label style={labelStyle}>Outgoing owner</label>
          <input value={outName} onChange={(e) => { setOutName(e.target.value); setStatus(null); }}
                 placeholder={r.owner} style={{ ...fieldStyle, fontFamily: "inherit" }} />
        </div>
        <div>
          <label style={labelStyle}>Incoming owner</label>
          <input value={inName} onChange={(e) => { setInName(e.target.value); setStatus(null); }}
                 placeholder="new owner" style={{ ...fieldStyle, fontFamily: "inherit" }} />
        </div>
        <div style={{ flex: 1, minWidth: 220 }}>
          <label style={labelStyle}>Note</label>
          <input value={note} onChange={(e) => { setNote(e.target.value); setStatus(null); }}
                 placeholder="e.g. transfer registered 6 August 2026"
                 style={{ ...fieldStyle, width: "100%", fontFamily: "inherit" }} />
        </div>
      </div>

      {split && (
        <div className="f-mono" style={{ marginTop: 14, fontSize: 12, color: "#2F5D50", lineHeight: 1.7 }}>
          Outgoing {split.outDays}/{split.daysInMonth} days · levy {rand(split.outgoing.levy)} · utilities {rand(split.outgoing.utilitiesDue)} · total <b>{rand(split.outgoing.total)}</b>
          <br />
          Incoming {split.inDays}/{split.daysInMonth} days · levy {rand(split.incoming.levy)} · utilities {rand(split.incoming.utilitiesDue)} · total <b>{rand(split.incoming.total)}</b>
          <br />
          Levy halves sum to {rand(round2(split.outgoing.levy + split.incoming.levy))} against a full month of {rand(r.levy)}.
        </div>
      )}

      <div style={{ marginTop: 16, display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <button style={primaryBtn} onClick={save} disabled={busy || !date}>{busy ? "Saving…" : "Save ownership change"}</button>
        {change && <button style={secondaryBtn} onClick={clear} disabled={busy}>Remove</button>}
        {status && <span style={{ fontSize: 12.5, color: "#2F5D50", fontWeight: 600 }}>{status}</span>}
        {error && <span style={{ fontSize: 12.5, color: "#B5651D", fontWeight: 600 }}>{error}</span>}
      </div>
    </Card>
  );
}

// Lets the trustee override the computed Electricity / Water "due" lines on a
// statement, to align a past statement to the one physically sent. A blank field
// means "use the computed value" (shown as the placeholder). Levy lines and
// additional charges are already manual entry elsewhere, so they aren't here.
function StatementAdjustments({ r, period, onSaveOverride }) {
  const [elec, setElec] = useState(r.elecOverridden ? String(r.elecCost) : "");
  const [water, setWater] = useState(r.waterOverridden ? String(r.waterCost) : "");
  const [note, setNote] = useState(r.overrideNote || "");
  const [status, setStatus] = useState(null);

  // Re-sync the inputs when the unit, period, or override state changes.
  useEffect(() => {
    setElec(r.elecOverridden ? String(r.elecCost) : "");
    setWater(r.waterOverridden ? String(r.waterCost) : "");
    setNote(r.overrideNote || "");
    setStatus(null);
  }, [r.id, period, r.elecOverridden, r.waterOverridden]);

  const num2 = (n) => n.toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const anyOverride = r.elecOverridden || r.waterOverridden;

  const save = () => {
    onSaveOverride(r.id, {
      electricityDue: elec.trim() === "" ? null : (parseFloat(elec) || 0),
      waterDue: water.trim() === "" ? null : (parseFloat(water) || 0),
      note: note.trim() || null,
    });
    setStatus("saved");
  };
  const clearAll = () => {
    setElec(""); setWater(""); setNote("");
    onSaveOverride(r.id, { electricityDue: null, waterDue: null, note: null });
    setStatus("cleared");
  };

  const fieldStyle = { width: 150, padding: "7px 10px", borderRadius: 6, border: "1px solid #D8D0BE", fontFamily: "'IBM Plex Mono', monospace", fontSize: 13 };

  return (
    <Card className="no-print" style={{ marginTop: 20, background: "#FBF8F1", border: "1px solid #E4DCC8" }}>
      <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 4 }}>Manual statement adjustments</div>
      <p style={{ fontSize: 12.5, color: "#64748B", marginBottom: 14 }}>
        Override the computed <strong>Electricity</strong> or <strong>Water</strong> due (before VAT) to match the statement physically sent for {periodLabel(period)}. Leave a field blank to keep the computed value. VAT and the total recalculate automatically, and the reconciliation "expected" figure follows.
      </p>
      <div style={{ display: "flex", gap: 20, flexWrap: "wrap", alignItems: "flex-end" }}>
        <div>
          <label style={{ display: "block", fontSize: 11.5, fontWeight: 600, color: "#1B2A38", marginBottom: 4 }}>Electricity due (R)</label>
          <input value={elec} onChange={(e) => { setElec(e.target.value); setStatus(null); }} placeholder={`computed ${num2(r.elecCostComputed)}`} style={fieldStyle} />
          <div style={{ fontSize: 10.5, color: "#94A0AC", marginTop: 3 }}>computed: R {num2(r.elecCostComputed)}</div>
        </div>
        <div>
          <label style={{ display: "block", fontSize: 11.5, fontWeight: 600, color: "#1B2A38", marginBottom: 4 }}>Water due (R)</label>
          <input value={water} onChange={(e) => { setWater(e.target.value); setStatus(null); }} placeholder={`computed ${num2(r.waterCostComputed)}`} style={fieldStyle} />
          <div style={{ fontSize: 10.5, color: "#94A0AC", marginTop: 3 }}>computed: R {num2(r.waterCostComputed)}</div>
        </div>
        <div style={{ flex: 1, minWidth: 200 }}>
          <label style={{ display: "block", fontSize: 11.5, fontWeight: 600, color: "#1B2A38", marginBottom: 4 }}>Reason / note (optional)</label>
          <input value={note} onChange={(e) => { setNote(e.target.value); setStatus(null); }} placeholder="e.g. aligning to statement sent by previous trustee" style={{ ...fieldStyle, width: "100%", fontFamily: "'Inter', sans-serif", boxSizing: "border-box" }} />
        </div>
      </div>
      <div style={{ marginTop: 14, display: "flex", alignItems: "center", gap: 12 }}>
        <button style={primaryBtn} onClick={save}>Save adjustments</button>
        {anyOverride && <button style={{ background: "none", border: "none", color: "#B5651D", fontSize: 12.5, fontWeight: 600, cursor: "pointer", textDecoration: "underline" }} onClick={clearAll}>Clear (use computed)</button>}
        {status === "saved" && <span style={{ fontSize: 12, color: "#2F5D50", fontWeight: 600 }}>✓ Saved — statement updated</span>}
        {status === "cleared" && <span style={{ fontSize: 12, color: "#64748B", fontWeight: 600 }}>Reverted to computed values</span>}
        {anyOverride && status == null && <span style={{ fontSize: 11.5, color: "#8A6D1E", fontWeight: 600 }}>This statement is currently adjusted</span>}
      </div>
    </Card>
  );
}

function StatementPaper({ r, period = CURRENT_PERIOD }) {
  const num = (n) => n.toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const vatPct = (r.vatRate * 100).toFixed(0);
  const unitNumber = r.id.slice(1);
  const utilityRows = [
    { desc: `Electricity`, curr: r.eCurr, prev: r.ePrev, cons: `${r.eUse.toFixed(2)} kWh`, rate: r.elecOverridden ? "Adjusted" : `${num(r.electricityRate)} / kWh`, due: r.elecCost },
    { desc: `Water`, curr: r.wCurr, prev: r.wPrev, cons: `${r.wUse.toFixed(2)} kL`, rate: r.waterOverridden ? "Adjusted" : "Tiered", due: r.waterCost },
  ];

  return (
    <div className="print-area stmt-paper" style={{
      background: "#F6F1E7", border: "1px solid #D8D0BE", borderRadius: 4,
      padding: "24px 16px", boxShadow: "0 1px 0 #fff inset", maxWidth: 680,
    }}>
      <style>{`
        .stmt-paper { font-size: 13px; overflow: visible; }
        .stmt-header { display: flex; justify-content: space-between; border-bottom: 2px solid #1B2A38; padding-bottom: 12px; margin-bottom: 18px; gap: 12px; }
        .stmt-header-right { text-align: right; font-size: 11.5px; }
        .stmt-scroll-wrapper {
          overflow-x: auto;
          -webkit-overflow-scrolling: touch;
          margin: 0 -16px;
          padding: 0 16px;
        }
        .stmt-util-table { min-width: 560px; width: 100%; }
        .stmt-bank-grid { display: grid; grid-template-columns: 1fr 1fr; row-gap: 4px; font-size: 12.5px; }
        .stmt-grand { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; }
        @media (max-width: 540px) {
          .stmt-paper { padding: 16px 12px !important; }
          .stmt-scroll-wrapper { margin: 0 -12px; padding: 0 12px; }
          .stmt-header { flex-direction: column; gap: 8px; }
          .stmt-header-right { text-align: left; }
          .stmt-bank-grid { grid-template-columns: 1fr !important; }
          .stmt-grand { flex-wrap: wrap; }
        }
      `}</style>

      <div className="stmt-header">
        <div>
          <div className="f-display" style={{ fontSize: 19, fontWeight: 700 }}>El Corazon Body Corporate</div>
          <div style={{ fontSize: 11.5, color: "#64748B" }}>Levy & utility statement — {periodLabel(period)}</div>
          {/* PAID stamp — shown when a bank payment has been matched to this unit/period */}
          {r.payment && (
            <div style={{ marginTop: 12 }}>
              <div style={{
                display: "inline-block", transform: "rotate(-8deg)",
                border: "4px solid #2F5D50", borderRadius: 8,
                padding: "4px 22px", fontSize: 26, fontWeight: 900,
                color: "#2F5D50", opacity: 0.18, letterSpacing: 4,
                fontFamily: "monospace", textTransform: "uppercase",
              }}>PAID</div>
            </div>
          )}
        </div>
        <div className="stmt-header-right">
          <div className="f-mono">Ref: Cor {unitNumber}</div>
          <div style={{ color: "#64748B" }}>{r.owner} · Unit {unitNumber}</div>
          <div style={{ marginTop: 8, color: "#64748B", lineHeight: 1.4 }}>
            <div>{unitNumber} El Corazon</div>
            <div>Vercueil Street</div>
            <div>OntdekkersPark</div>
            <div>1709</div>
          </div>
        </div>
      </div>

      {/* Section 1 — utility charges */}
      <div style={{ fontWeight: 700, fontSize: 12.5, marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.4, color: "#64748B" }}>
        Utility Charges
      </div>
      <div className="stmt-scroll-wrapper">
        <table className="stmt-util-table" style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <thead>
            <tr style={{ textAlign: "right", color: "#64748B", fontSize: 10, textTransform: "uppercase" }}>
              <th style={{ padding: "0 6px 8px 0", textAlign: "left", whiteSpace: "nowrap" }}>Description</th>
              <th style={{ padding: "0 6px 8px", whiteSpace: "nowrap" }}>Current</th>
              <th style={{ padding: "0 6px 8px", whiteSpace: "nowrap" }}>Previous</th>
              <th style={{ padding: "0 6px 8px", whiteSpace: "nowrap" }}>Consumption</th>
              <th style={{ padding: "0 6px 8px", whiteSpace: "nowrap" }}>Rate</th>
              <th style={{ padding: "0 0 8px 6px", whiteSpace: "nowrap" }}>Due</th>
            </tr>
          </thead>
          <tbody>
            {utilityRows.map((row, i) => (
              <tr key={i} style={{ borderTop: "1px solid #E4DCC8" }}>
                <td style={{ padding: "7px 6px 7px 0", textAlign: "left", whiteSpace: "nowrap" }}>{row.desc}</td>
                <td className="f-mono" style={{ padding: "7px 6px", textAlign: "right", color: "#64748B", whiteSpace: "nowrap" }}>{row.curr}</td>
                <td className="f-mono" style={{ padding: "7px 6px", textAlign: "right", color: "#64748B", whiteSpace: "nowrap" }}>{row.prev}</td>
                <td className="f-mono" style={{ padding: "7px 6px", textAlign: "right", whiteSpace: "nowrap" }}>{row.cons}</td>
                <td className="f-mono" style={{ padding: "7px 6px", textAlign: "right", color: "#64748B", whiteSpace: "nowrap" }}>{row.rate}</td>
                <td className="f-mono" style={{ padding: "7px 0 7px 6px", textAlign: "right", fontWeight: 600, whiteSpace: "nowrap" }}>{rand(row.due)}</td>
              </tr>
            ))}
            <tr style={{ borderTop: "1px solid #1B2A38" }}>
              <td colSpan={5} style={{ padding: "7px 6px 7px 0", textAlign: "left", fontWeight: 600 }}>Sub-Total</td>
              <td className="f-mono" style={{ padding: "7px 0 7px 6px", textAlign: "right", fontWeight: 600, whiteSpace: "nowrap" }}>{rand(r.subTotal)}</td>
            </tr>
            <tr>
              <td colSpan={5} style={{ padding: "5px 6px 5px 0", textAlign: "left" }}>VAT ({vatPct}%)</td>
              <td className="f-mono" style={{ padding: "5px 0 5px 6px", textAlign: "right", whiteSpace: "nowrap" }}>{rand(r.vat)}</td>
            </tr>
            <tr style={{ borderTop: "1px solid #1B2A38" }}>
              <td colSpan={5} style={{ padding: "7px 6px 7px 0", textAlign: "left", fontWeight: 700 }}>Total Due</td>
              <td className="f-mono" style={{ padding: "7px 0 7px 6px", textAlign: "right", fontWeight: 700, whiteSpace: "nowrap" }}>{rand(r.utilitiesDue)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Section 2 — levy breakdown */}
      <div style={{ marginTop: 22, borderTop: "1px dashed #D8D0BE", paddingTop: 14 }}>
        <div style={{ fontWeight: 700, fontSize: 12.5, marginBottom: 2, textTransform: "uppercase", letterSpacing: 0.4, color: "#64748B" }}>
          Levy Breakdown
        </div>
        <div style={{ fontSize: 11, color: "#94A0AC", marginBottom: 8 }}>Set annually at the AGM</div>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <tbody>
            {/* `levyLines` is the list the row was actually totalled over —
                the trustee app's loaded FY, or the statement's own FY on the
                resident portal. Rendering LEVY_ITEMS instead would let the
                lines shown disagree with the total printed below them. */}
            {(r.levyLines || LEVY_ITEMS).map((item) => (
              <tr key={item} style={{ borderTop: "1px solid #EEE7D6" }}>
                <td style={{ padding: "5px 6px 5px 0", textAlign: "left" }}>{item}</td>
                <td className="f-mono" style={{ padding: "5px 0 5px 6px", textAlign: "right", whiteSpace: "nowrap" }}>{rand(r.levyItems?.[item] || 0)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div style={{ display: "flex", justifyContent: "space-between", borderTop: "1px solid #1B2A38", marginTop: 4, paddingTop: 6, fontSize: 12.5 }}>
          <span style={{ fontWeight: 700 }}>Total levy</span>
          <span className="f-mono" style={{ fontWeight: 700 }}>{rand(r.levy)}</span>
        </div>
      </div>

      {/* Additional charges — only shown if any exist this month */}
      {r.extras && r.extras.length > 0 && (
        <div style={{ marginTop: 22, borderTop: "1px dashed #D8D0BE", paddingTop: 14 }}>
          <div style={{ fontWeight: 700, fontSize: 12.5, marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.4, color: "#64748B" }}>
            Additional Charges
          </div>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <tbody>
              {r.extras.map((e) => (
                <tr key={e.id} style={{ borderTop: "1px solid #EEE7D6" }}>
                  <td style={{ padding: "5px 6px 5px 0", textAlign: "left" }}>{e.description}</td>
                  <td className="f-mono" style={{ padding: "5px 0 5px 6px", textAlign: "right", whiteSpace: "nowrap" }}>{rand(e.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{ display: "flex", justifyContent: "space-between", borderTop: "1px solid #1B2A38", marginTop: 4, paddingTop: 6, fontSize: 12.5 }}>
            <span style={{ fontWeight: 700 }}>Total additional charges</span>
            <span className="f-mono" style={{ fontWeight: 700 }}>{rand(r.additionalTotal)}</span>
          </div>
        </div>
      )}

      {/* Grand total */}
      <div className="stmt-grand" style={{ borderTop: "2px solid #1B2A38", marginTop: 18, paddingTop: 12 }}>
        <div className="f-display stmt-grand-label" style={{ fontWeight: 700 }}>Total amount due by {periodDueLabel(period)}</div>
        <div className="f-mono stmt-grand-value" style={{ fontWeight: 700 }}>{rand(r.total)}</div>
      </div>

      {/* Section 3 — banking details */}
      <div style={{ marginTop: 22, borderTop: "1px dashed #D8D0BE", paddingTop: 14 }}>
        <div style={{ fontWeight: 700, fontSize: 12.5, marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.4, color: "#64748B" }}>
          El Corazon Banking Details
        </div>
        <div className="stmt-bank-grid">
          <BankRow label="Bank" value={BANK_DETAILS.bank} />
          <BankRow label="Account name" value={BANK_DETAILS.accountName} />
          <BankRow label="Account number" value={BANK_DETAILS.accountNumber} mono />
          <BankRow label="Branch code" value={BANK_DETAILS.branchCode} mono />
          <BankRow label="Account type" value={BANK_DETAILS.accountType} />
          <BankRow label="SWIFT" value={BANK_DETAILS.swift} mono />
        </div>
        <div style={{ marginTop: 10, fontSize: 11, color: "#B5651D", fontWeight: 600 }}>
          Payment reference: <span className="f-mono">Cor {r.id.slice(1)}</span>
        </div>
      </div>
    </div>
  );
}

function BankRow({ label, value, mono }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", paddingRight: 18 }}>
      <span style={{ color: "#64748B" }}>{label}</span>
      <span className={mono ? "f-mono" : ""} style={{ fontWeight: 600 }}>{value}</span>
    </div>
  );
}

// ---------- Resident / tenant token app ----------
// The experience a resident or tenant gets from their capability link. Unlike
// the trustee's in-app "resident view" demo (which reuses live trustee state),
// this loads the unit's real statement per period through the token RPCs, so a
// tenant can open any past month's statement. The remittance form submits
// against whichever month is selected (the RPC upserts by unit + period).
function ResidentTokenApp({ unit, remittanceDeductions, setRemittanceDeductions, setRemittanceAdvices }) {
  const [periods, setPeriods] = useState([]);
  const [period, setPeriod] = useState(null);
  const [stmt, setStmt] = useState(undefined); // undefined = loading, null = error, object = ready
  const [reloadKey, setReloadKey] = useState(0); // bumped after a submit to re-pull

  useEffect(() => {
    let cancelled = false;
    fetchUnitPeriods(RESIDENT_TOKEN)
      .then((ps) => {
        if (cancelled) return;
        const list = ps.length ? ps : [CURRENT_PERIOD];
        setPeriods(list);
        setPeriod(list[0]);
      })
      .catch((err) => {
        console.error("Could not load your statement periods:", err);
        if (!cancelled) { setPeriods([CURRENT_PERIOD]); setPeriod(CURRENT_PERIOD); }
      });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!period) return;
    let cancelled = false;
    // Keep proof-upload / submit paths aligned with the month being viewed.
    ACTIVE_PERIOD = period;
    fetchUnitStatement(RESIDENT_TOKEN, period)
      .then((d) => { if (!cancelled) setStmt(computeStatementRow(d)); })
      .catch((err) => { console.error("Could not load your statement:", err); if (!cancelled) setStmt(null); });
    return () => { cancelled = true; };
  }, [period, reloadKey]);

  // Switching months shows the loading state; a post-submit reload updates in
  // place without flashing "Loading".
  const changePeriod = (p) => { setStmt(undefined); setPeriod(p); };

  const periodControls = (
    <select
      value={period || ""}
      onChange={(e) => changePeriod(e.target.value)}
      style={{ padding: "6px 10px", borderRadius: 6, border: "1px solid #D8D0BE", fontWeight: 600 }}
    >
      {periods.map((p) => <option key={p} value={p}>{periodLabel(p)}</option>)}
    </select>
  );

  return (
    <div className="f-body" style={{ minHeight: "100vh", background: "#EFEAE0", color: "#1B2A38" }}>
      {FONT_IMPORT}
      <ResidentTopBar unit={unit} period={period} />
      {stmt === undefined ? (
        <div style={{ maxWidth: 680, margin: "0 auto", padding: "40px 20px", color: "#64748B", fontSize: 14 }}>Loading your statement…</div>
      ) : stmt === null ? (
        <div style={{ maxWidth: 680, margin: "0 auto", padding: "40px 20px" }}>
          <Card>
            <div style={{ fontWeight: 700, marginBottom: 6 }}>This statement couldn't be loaded</div>
            <div style={{ fontSize: 13, color: "#64748B" }}>There may be no statement for this month yet. Try another month, or contact the trustee.</div>
          </Card>
        </div>
      ) : (
        <ResidentPortal
          alloc={null} selectedUnit={unit.id} setSelectedUnit={() => {}} locked
          statementRow={stmt} period={period} periodControls={periodControls}
          onSubmitted={() => setReloadKey((k) => k + 1)}
          remittanceDeductions={remittanceDeductions} setRemittanceDeductions={setRemittanceDeductions}
          setRemittanceAdvices={setRemittanceAdvices}
        />
      )}
    </div>
  );
}

// ---------- Resident portal ----------
function ResidentPortal({
  alloc, selectedUnit, setSelectedUnit, remittanceDeductions, setRemittanceDeductions,
  setRemittanceAdvices, locked,
  // Token/tenant mode: a specific period's statement row (from the RPC), the
  // period, a period-selector node to render in the header, whether to show the
  // remittance form (defaults on; submits for the selected period), and a hook
  // to re-pull the statement after a submit so the deduction card refreshes.
  statementRow, period = CURRENT_PERIOD, periodControls, allowSubmit = true, onSubmitted,
}) {
  const [files, setFiles] = useState([]); // multiple proof-of-payment documents
  // Itemised deductions — one row per Body Corp expense paid personally.
  const [deductionItems, setDeductionItems] = useState([{ amount: "", comment: "", expenseCategory: "" }]);
  const [amountPaid, setAmountPaid] = useState("");
  const [datePaid, setDatePaid] = useState("");
  const [notifyStatus, setNotifyStatus] = useState(null); // null | "sending" | "sent" | "failed" | "save-failed"
  const fileInputRef = useRef(null);
  const r = statementRow || (alloc && alloc.rows.find((x) => x.id === selectedUnit));
  const deductionTotal = deductionItems.reduce((s, d) => s + parseAmount(d.amount), 0);
  const amountToPay = r ? r.total - deductionTotal : 0;

  const updateDeductionItem = (i, field, value) =>
    setDeductionItems((prev) => prev.map((d, idx) => (idx === i ? { ...d, [field]: value } : d)));
  const addDeductionItem = () => setDeductionItems((prev) => [...prev, { amount: "", comment: "", expenseCategory: "" }]);
  const removeDeductionItem = (i) =>
    setDeductionItems((prev) => (prev.length <= 1 ? [{ amount: "", comment: "", expenseCategory: "" }] : prev.filter((_, idx) => idx !== i)));
  // The deduction card for the viewed period. In token/tenant mode it comes from
  // the per-period statement RPC (so past-month deductions load from the DB);
  // in trustee mode it comes from the period-scoped remittanceDeductions state,
  // gated to the viewed period so switching months doesn't show a stale card.
  const existingRaw = remittanceDeductions[selectedUnit];
  const existing = statementRow
    ? (statementRow.deduction || null)
    : (existingRaw && (existingRaw.period == null || existingRaw.period === period) ? existingRaw : null);

  const addFiles = (fileList) => {
    const incoming = Array.from(fileList || []);
    if (incoming.length === 0) return;
    setFiles((prev) => [...prev, ...incoming]);
  };
  const removeFile = (index) => setFiles((prev) => prev.filter((_, i) => i !== index));
  const proofFileNames = files.map((f) => f.name);

  const submitRemittance = async () => {
    setNotifyStatus("sending");
    // Blank "amount paid" means the full statement total.
    const paid = amountPaid.trim() === "" ? r.total : parseAmount(amountPaid);
    let dbId = null;
    let storedProofPaths = [];
    try {
      const saved = await submitRemittanceToDb(selectedUnit, {
        amountPaid: paid,
        datePaid: datePaid || null,
        deductions: deductionItems.map((d) => ({
          amount: parseAmount(d.amount),
          comment: d.comment.trim(),
          // Optional — the trustee can retag on the reconciliation page.
          expenseCategory: d.expenseCategory || null,
        })),
        proofFiles: files,
      });
      dbId = saved.id;
      storedProofPaths = saved.proofPaths;
    } catch (err) {
      console.error("Submitting remittance failed:", err);
      setNotifyStatus("save-failed");
      return;
    }
    if (setRemittanceAdvices) {
      setRemittanceAdvices((prev) => ({
        ...prev,
        [selectedUnit]: {
          dbId, amountPaid: paid, datePaid: datePaid || null,
          proofFileNames: storedProofPaths, submittedAt: new Date().toISOString().slice(0, 10),
        },
      }));
    }
    const submittedItems = deductionItems
      .map((d) => ({ amount: parseAmount(d.amount), comment: d.comment.trim() }))
      .filter((d) => d.amount > 0);
    const submittedComment = submittedItems.map((d) => d.comment).filter(Boolean).join("; ");
    if (deductionTotal > 0) {
      setRemittanceDeductions((prev) => ({
        ...prev,
        [selectedUnit]: {
          dbId, period, amount: deductionTotal, comment: submittedComment, items: submittedItems,
          proofAttached: files.length > 0, proofFileNames: storedProofPaths,
          approved: false, statementTotal: r.total, submittedAt: new Date().toISOString().slice(0, 10),
        },
      }));
    }
    const ok = await notifyTrusteeOfRemittance({
      unit: r.id, owner: r.owner, statementTotal: r.total, amountPaid: paid, datePaid,
      deduction: deductionTotal, comment: submittedComment, proofAttached: files.length > 0, proofFileNames,
    });
    setNotifyStatus(ok ? "sent" : "failed");
    // Re-pull the statement (token mode) so the deduction card reflects what was
    // just saved for this period.
    if (onSubmitted) onSubmitted();
  };

  if (!r) return null;

  return (
    <main style={{ maxWidth: 680, margin: "0 auto", padding: "20px 12px" }}>
      <div className="no-print" style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 14, flexWrap: "wrap", gap: 8 }}>
        <h1 className="f-display" style={{ fontSize: 20 }}>Your statement</h1>
        {/* In token/tenant mode a period selector lets the resident browse past
            statements. Otherwise the unit switcher is a trustee-demo convenience
            — residents arriving via their capability URL are locked to their unit. */}
        {periodControls
          ? periodControls
          : (!locked && (
            <select value={selectedUnit} onChange={(e) => setSelectedUnit(e.target.value)} style={{ padding: "6px 10px", borderRadius: 6, border: "1px solid #D8D0BE" }}>
              {UNITS.map((u) => <option key={u.id} value={u.id}>{u.id} — {u.owner}</option>)}
            </select>
          ))}
      </div>

      <StatementPaper r={r} period={period} />
      <div className="no-print" style={{ marginTop: 12, display: "flex", justifyContent: "flex-end" }}>
        <button style={secondaryBtn} onClick={printStatement}>Download PDF</button>
      </div>

      {allowSubmit && (
      <div className="no-print">
      {existing && (
        <Card style={{ marginTop: 20, background: existing.approved ? "#EAF2EE" : "#FBF1E9", border: `1px solid ${existing.approved ? "#BFE0D3" : "#EAD9C4"}` }}>
          <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 6 }}>
            {existing.approved ? "✓ Deduction approved by trustee" : "⏳ Deduction submitted — pending trustee approval"}
          </div>
          {(existing.items && existing.items.length > 0
            ? existing.items
            : [{ amount: existing.amount, comment: existing.comment }]
          ).map((it, i) => (
            <div key={i} style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, marginBottom: 2 }}>
              <span style={{ color: "#64748B" }}>{it.comment || "Deduction"}</span>
              <span className="f-mono" style={{ color: "#B5651D" }}>−{rand(it.amount)}</span>
            </div>
          ))}
          {existing.proofFileNames && existing.proofFileNames.length > 0 && (
            <div style={{ fontSize: 11.5, color: "#64748B", marginTop: 4 }}>
              {existing.proofFileNames.length} document{existing.proofFileNames.length > 1 ? "s" : ""} submitted as proof
            </div>
          )}
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginTop: 8 }} className="f-mono">
            {/* DB-loaded submissions don't carry a stored statement total — the live one applies */}
            <span>Statement total</span><span>{rand(existing.statementTotal ?? r.total)}</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }} className="f-mono">
            <span>Total deducted (paid on your own behalf)</span><span style={{ color: "#B5651D" }}>−{rand(existing.amount)}</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13.5, fontWeight: 700, borderTop: "1px solid #1B2A38", marginTop: 4, paddingTop: 6 }} className="f-mono">
            <span>Amount to pay the Body Corp</span><span>{rand((existing.statementTotal ?? r.total) - existing.amount)}</span>
          </div>
        </Card>
      )}

      <Card style={{ marginTop: 20 }}>
        <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 10 }}>Submit remittance advice — {periodLabel(period)}</div>
        <p style={{ fontSize: 12.5, color: "#64748B", marginBottom: 14 }}>
          Already paid for {periodLabel(period)}? Confirm the amount and upload your proof of payment so it matches automatically. To submit for a different month, change the period above.
        </p>
        <div style={{ display: "flex", gap: 10, marginBottom: 12 }}>
          <input
            placeholder={`Amount paid (R) — default ${r.total.toFixed(2)}`}
            value={amountPaid} onChange={(e) => setAmountPaid(e.target.value)}
            style={{ ...inputStyle, width: 220, textAlign: "left" }}
          />
          <input
            placeholder="Date paid" type="date"
            value={datePaid} onChange={(e) => setDatePaid(e.target.value)}
            style={{ ...inputStyle, width: 160, textAlign: "left" }}
          />
        </div>

        <div style={{ marginBottom: 12, background: "#FBF1E9", border: "1px solid #EAD9C4", borderRadius: 8, padding: 14 }}>
          <div style={{ fontWeight: 700, fontSize: 12.5, marginBottom: 8 }}>Paid Body Corp expenses out of your own pocket?</div>
          <p style={{ fontSize: 12, color: "#64748B", marginBottom: 12 }}>
            E.g. the garden service or Blockwatch fee. Add each expense on its own line — the total comes off what you pay the Body Corp this month, provided you can produce proof of payment.
          </p>
          {deductionItems.map((item, i) => (
            <div key={i} className="wrap-sm" style={{ display: "flex", gap: 8, marginBottom: 8, alignItems: "flex-start" }}>
              <input
                placeholder="Amount (R)"
                type="text"
                inputMode="decimal"
                value={item.amount}
                onChange={(e) => updateDeductionItem(i, "amount", e.target.value)}
                style={{ ...inputStyle, width: 110, textAlign: "left" }}
              />
              <input
                placeholder="What it was for — e.g. 'Garden service, paid 5 June'"
                value={item.comment}
                onChange={(e) => updateDeductionItem(i, "comment", e.target.value)}
                style={{ ...inputStyle, flex: 1, textAlign: "left" }}
              />
              <ExpenseCategorySelect
                value={item.expenseCategory}
                onChange={(v) => updateDeductionItem(i, "expenseCategory", v)}
                placeholder="Type of expense"
                style={{ padding: "10px", fontSize: 16, minWidth: 150 }}
              />
              <button
                type="button"
                onClick={() => removeDeductionItem(i)}
                title="Remove this line"
                style={{ background: "none", border: "1px solid #E0C9AF", color: "#B5651D", borderRadius: 6, padding: "8px 11px", fontSize: 13, fontWeight: 700, cursor: "pointer", lineHeight: 1 }}
              >
                ×
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={addDeductionItem}
            style={{ background: "none", border: "none", color: "#2A3E7A", fontSize: 12, fontWeight: 700, cursor: "pointer", textDecoration: "underline", padding: 0, marginTop: 2 }}
          >
            + Add another deduction
          </button>
          {deductionTotal > 0 && (
            <div style={{ marginTop: 12, borderTop: "1px solid #EAD9C4", paddingTop: 8 }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }} className="f-mono">
                <span style={{ color: "#64748B" }}>Total deductions</span>
                <span style={{ color: "#B5651D" }}>−{rand(deductionTotal)}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, marginTop: 3 }} className="f-mono">
                <span>Amount to pay the Body Corp</span>
                <span style={{ fontWeight: 700, color: "#2F5D50" }}>{rand(amountToPay)}</span>
              </div>
            </div>
          )}
        </div>

        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept="application/pdf,image/*"
          style={{ display: "none" }}
          onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }}
        />
        <div
          style={{
            border: "1.5px dashed #B5651D", borderRadius: 8, padding: "18px", textAlign: "center",
            color: files.length > 0 ? "#2F5D50" : "#B5651D", background: files.length > 0 ? "#EAF2EE" : "#FBF1E9",
            fontSize: 13, fontWeight: 600, cursor: "pointer",
          }}
          onClick={() => fileInputRef.current && fileInputRef.current.click()}
        >
          {files.length > 0
            ? `✓ ${files.length} document${files.length > 1 ? "s" : ""} attached — click to add more`
            : "Click to attach proof of payment (PDF / photo) — you can select multiple files"}
        </div>
        {files.length > 0 && (
          <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 6 }}>
            {files.map((f, i) => (
              <div key={`${f.name}-${i}`} style={{
                display: "flex", justifyContent: "space-between", alignItems: "center",
                fontSize: 12, background: "#F6F1E7", border: "1px solid #E4DCC8", borderRadius: 6, padding: "6px 10px",
              }}>
                <span className="f-mono" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 380 }}>
                  {f.name}
                </span>
                <button
                  onClick={() => removeFile(i)}
                  style={{ background: "none", border: "none", color: "#B5651D", fontSize: 11.5, fontWeight: 600, cursor: "pointer", textDecoration: "underline" }}
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        )}
        <div style={{ marginTop: 14, display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 12 }}>
          {notifyStatus === "sending" && <span style={{ fontSize: 12, color: "#94A0AC" }}>Submitting…</span>}
          {notifyStatus === "sent" && <span style={{ fontSize: 12, color: "#2F5D50", fontWeight: 600 }}>✓ Submitted & trustee notified by email</span>}
          {notifyStatus === "failed" && <span style={{ fontSize: 12, color: "#B5651D", fontWeight: 600 }}>Submitted — email notification couldn't be sent</span>}
          {notifyStatus === "save-failed" && <span style={{ fontSize: 12, color: "#B5651D", fontWeight: 600 }}>Couldn't submit — please try again or contact the trustee</span>}
          <button style={primaryBtn} onClick={submitRemittance}>Submit remittance</button>
        </div>
      </Card>
      </div>
      )}
    </main>
  );
}

// ---------- Bank recon ----------
// Added 8 August 2026. Owns statement import; Tenant recon consumes what this
// produces and does the matching.
//
// Its whole job is to reproduce a statement faithfully and then prove it did.
// The proof is arithmetic and comes from the bank's own figures: every line
// carries the running balance the bank printed against it, so the module can
// walk the ledger and assert that each printed balance follows from the one
// above it plus that line's movement. If a line were dropped, duplicated or
// misread, the walk breaks at exactly that line and says which.
//
// Opening and closing balances are DERIVED from that same column rather than
// read off the statement header — there was no sample statement to write a
// header regex against, and a wrong guess is worse than an honest derivation.
// `balance_source` records this so a later reader is never misled.

// One statement's saved state, rebuilt from the database.
async function fetchBankStatement(period) {
  const client = await ensureSupabaseClient();
  const [doc, txns] = await Promise.all([
    client.from("bank_statement_documents").select("*").eq("period", period).limit(1),
    client.from("bank_transactions")
      .select("id, txn_date, description_raw, amount, direction, accrued_bank_charge, category, balance_after, line_no, expense_category, matched_unit_id")
      .eq("period", period)
      .order("line_no", { ascending: true, nullsFirst: false })
      .order("txn_date", { ascending: true }),
  ]);
  const failed = [doc, txns].find((r) => r.error);
  if (failed) throw failed.error;
  return { doc: (doc.data || [])[0] || null, txns: txns.data || [] };
}

// The same arithmetic as deriveStatementBalances, but over rows already saved.
// Re-checking on read rather than trusting a stored flag means a statement that
// was edited in the database afterwards still reports honestly.
function verifySavedStatement(doc, txns) {
  if (!txns.length) return { state: "empty" };
  const withBalance = txns.filter((t) => t.balance_after != null);
  if (!withBalance.length) {
    return { state: "unverifiable", reason: "No running balances were captured for this statement — it was imported before Bank recon existed. Re-import the PDF to verify it." };
  }
  const signed = (t) => (t.direction === "credit" ? Number(t.amount) : -Number(t.amount));
  const opening = doc && doc.opening_balance != null
    ? Number(doc.opening_balance)
    : round2(Number(withBalance[0].balance_after) - signed(withBalance[0]));
  const closing = Number(withBalance[withBalance.length - 1].balance_after);

  const breaks = [];
  let running = opening;
  withBalance.forEach((t) => {
    running = round2(running + signed(t));
    const drift = round2(Number(t.balance_after) - running);
    if (Math.abs(drift) > 0.005) breaks.push({ ...t, expected: running, drift });
    running = Number(t.balance_after);
  });

  const credits = round2(txns.filter((t) => t.direction === "credit").reduce((s, t) => s + Number(t.amount), 0));
  const debits = round2(txns.filter((t) => t.direction === "debit").reduce((s, t) => s + Number(t.amount), 0));
  const net = round2(opening + credits - debits);
  const totalDrift = round2(closing - net);

  return {
    state: breaks.length === 0 && Math.abs(totalDrift) <= 0.005 ? "ok" : "broken",
    opening, closing, credits, debits, net, totalDrift, breaks,
    missingBalances: txns.length - withBalance.length,
  };
}

function BankRecon({ periods, period, setPeriod, onImported }) {
  const fileRef = useRef(null);
  const [status, setStatus] = useState("idle");   // idle | parsing | review | saving | error
  const [error, setError] = useState(null);
  const [preview, setPreview] = useState(null);   // { fileName, txns, balances }
  const [saved, setSaved] = useState(null);       // { doc, txns }
  const [loading, setLoading] = useState(true);

  const reload = async (p) => {
    setLoading(true);
    try { setSaved(await fetchBankStatement(p)); }
    catch (err) { console.error("Loading the saved statement failed:", err); setSaved(null); }
    setLoading(false);
  };
  // `reload` is intentionally not a dependency — it is recreated every render,
  // and depending on it would refetch the statement on every keystroke.
  useEffect(() => { reload(period); }, [period]); // eslint-disable-line react-hooks/exhaustive-deps

  const onFile = async (file) => {
    setStatus("parsing"); setError(null); setPreview(null);
    try {
      const { txns, balances } = await parseBankStatementWithBalances(file);
      if (!txns.length) throw new Error("No transaction lines were recognised in this PDF. Check it is an FNB statement and not a scan.");
      setPreview({ fileName: file.name, txns, balances });
      setStatus("review");
    } catch (err) {
      console.error("Bank statement parsing failed:", err);
      setError("Couldn't parse this PDF: " + (err.message || "Unknown error"));
      setStatus("error");
    }
  };

  // Nothing is written until the trustee has seen the preview and the balance
  // check — the same rule the insurance and utility-bill parsers follow. A
  // mis-parse must never silently replace a month that was correct.
  const commit = async () => {
    if (!preview) return;
    setStatus("saving"); setError(null);
    try {
      await saveBankStatementForPeriod(period, preview.fileName, preview.txns, preview.balances);
      setPreview(null); setStatus("idle");
      await reload(period);
      if (onImported) onImported();
    } catch (err) {
      console.error("Saving the statement failed:", err);
      setError("Parsed OK, but saving failed — see browser console. Nothing was written.");
      setStatus("error");
    }
  };

  const money = (n) => (n == null ? "—" : `R ${Number(n).toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
  const check = saved && saved.txns.length ? verifySavedStatement(saved.doc, saved.txns) : null;

  const Pill = ({ tone, children }) => (
    <span style={{
      display: "inline-block", padding: "3px 10px", borderRadius: 999, fontSize: 11.5, fontWeight: 700,
      background: tone === "ok" ? "#E3EFE9" : tone === "warn" ? "#FBEEE0" : "#F4E7E7",
      color: tone === "ok" ? "#2F5D50" : tone === "warn" ? "#B5651D" : "#9B2C2C",
    }}>{children}</span>
  );

  const th = { padding: "6px 8px", textAlign: "left" };
  const td = { padding: "6px 8px", borderTop: "1px solid #F0EADC" };
  const tdR = { ...td, textAlign: "right", fontFamily: "'IBM Plex Mono', ui-monospace, monospace" };

  return (
    <>
      <h1 className="f-display" style={{ fontSize: 24, marginBottom: 4 }}>Bank recon — {periodLabel(period)}</h1>
      <p style={{ color: "#64748B", fontSize: 13.5, marginBottom: 18 }}>
        Imports a bank statement and recreates it line for line — opening balance, every transaction with the running balance the bank printed against it, and the closing balance. The import is only worth trusting if it reconciles, so every line is checked against the one above it before anything is saved. This is the single place a statement enters the system; <strong>Tenant recon</strong> reads what lands here.
      </p>

      <Card style={{ marginBottom: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
          <label style={{ fontSize: 12.5, color: "#64748B", fontWeight: 600 }}>Statement month</label>
          <select value={period} onChange={(e) => { setPreview(null); setStatus("idle"); setPeriod(e.target.value); }} style={inputStyle}>
            {periods.map((p) => <option key={p} value={p}>{periodLabel(p)}</option>)}
          </select>
          <input ref={fileRef} type="file" accept="application/pdf" style={{ display: "none" }}
            onChange={(e) => { const f = e.target.files[0]; if (f) onFile(f); e.target.value = ""; }} />
          <button style={primaryBtn} onClick={() => fileRef.current && fileRef.current.click()} disabled={status === "parsing" || status === "saving"}>
            {status === "parsing" ? "Parsing…" : "Import statement PDF"}
          </button>
          {error && <span style={{ fontSize: 12.5, color: "#B5651D", fontWeight: 600 }}>{error}</span>}
        </div>
        <div style={{ fontSize: 12, color: "#94A0AC", marginTop: 8 }}>
          Importing replaces whatever is stored for {periodLabel(period)}. Trustee retargeting of a payment's applied period is preserved across a re-import.
        </div>
      </Card>

      {/* ---- Preview: shown before anything is written ---- */}
      {preview && (
        <Card style={{ marginBottom: 16, borderColor: preview.balances.ok ? "#B9D4C6" : "#E0B48A" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 10 }}>
            <div style={{ fontWeight: 700, fontSize: 14 }}>
              Preview — {preview.txns.length} lines from "{preview.fileName}"
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              {preview.balances.ok
                ? <Pill tone="ok">Balances reconcile</Pill>
                : <Pill tone="bad">Does not reconcile</Pill>}
              <button style={secondaryBtn} onClick={() => { setPreview(null); setStatus("idle"); }}>Discard</button>
              <button style={primaryBtn} onClick={commit} disabled={status === "saving"}>
                {status === "saving" ? "Saving…" : `Save to ${periodLabel(period)}`}
              </button>
            </div>
          </div>
          <div style={{ display: "flex", gap: 24, flexWrap: "wrap", fontSize: 13 }}>
            <div>Opening <strong>{money(preview.balances.opening)}</strong></div>
            <div>Credits <strong style={{ color: "#2F5D50" }}>{money(preview.balances.credits)}</strong></div>
            <div>Debits <strong style={{ color: "#9B2C2C" }}>{money(preview.balances.debits)}</strong></div>
            <div>Closing <strong>{money(preview.balances.closing)}</strong></div>
          </div>
          {!preview.balances.ok && (
            <div style={{ marginTop: 10, fontSize: 12.5, color: "#B5651D" }}>
              {preview.balances.checks && preview.balances.checks.length
                ? `${preview.balances.checks.length} line(s) don't follow from the balance above them — first at line ${preview.balances.checks[0].lineNo} (${preview.balances.checks[0].desc}), printed ${money(preview.balances.checks[0].printed)} against an expected ${money(preview.balances.checks[0].expected)}. A line was probably missed or misread.`
                : `Opening plus credits less debits gives ${money(preview.balances.net)}, but the last line's balance is ${money(preview.balances.closing)} — out by ${money(preview.balances.totalDrift)}.`}
              {" "}Saving anyway is allowed, but the discrepancy will keep showing below until it is resolved.
            </div>
          )}
          {preview.balances.turnover && (
            <div style={{ marginTop: 8, fontSize: 12, color: preview.balances.turnoverOk ? "#94A0AC" : "#B5651D" }}>
              {preview.balances.turnoverOk ? (
                <>Turnover check: the bank counts {preview.balances.turnover.credits ? `${preview.balances.turnover.credits.printedCount} credits` : ""}{preview.balances.turnover.credits && preview.balances.turnover.debits ? " and " : ""}{preview.balances.turnover.debits ? `${preview.balances.turnover.debits.printedCount} debits` : ""} — the same lines and the same totals were read.
                {preview.balances.noticeLines ? ` ${preview.balances.noticeLines} zero-rand notice line(s) sit outside the count, as they do on the statement.` : ""}</>
              ) : (
                <><strong>The line count disagrees with the bank's own turnover.</strong>{" "}
                {["credits", "debits"].map((k) => {
                  const t = preview.balances.turnover[k];
                  if (!t || t.ok) return null;
                  return `${k}: bank says ${t.printedCount} totalling ${money(t.printedTotal)}, ${t.parsedCount} totalling ${money(t.parsedTotal)} were read. `;
                })}
                A line was missed or read twice.</>
              )}
            </div>
          )}
          {preview.balances.balanceSource === "printed" && (
            <div style={{ marginTop: 8, fontSize: 12, color: (preview.balances.openingMismatch || preview.balances.closingMismatch) ? "#B5651D" : "#94A0AC" }}>
              {preview.balances.openingMismatch || preview.balances.closingMismatch ? (
                <>
                  <strong>The statement's printed balances disagree with its own transaction lines.</strong>{" "}
                  {preview.balances.openingMismatch && `Printed opening ${money(preview.balances.opening)} against ${money(preview.balances.openingDerived)} implied by the lines. `}
                  {preview.balances.closingMismatch && `Printed closing ${money(preview.balances.closing)} against ${money(preview.balances.closingDerived)} implied by the lines. `}
                  That gap is the size of what the parser missed — a line was almost certainly not read. The printed figures are the ones saved.
                </>
              ) : (
                <>Opening and closing read off the statement's own Statement Balances box, and both agree with the transaction lines.
                {preview.balances.header && preview.balances.header.statementNumber ? ` Statement ${preview.balances.header.statementNumber}.` : ""}</>
              )}
            </div>
          )}
          {preview.balances.linesWithoutBalance > 0 && (
            <div style={{ marginTop: 6, fontSize: 12, color: "#94A0AC" }}>
              {preview.balances.linesWithoutBalance} line(s) carry no running balance and are excluded from the walk.
            </div>
          )}
        </Card>
      )}

      {/* ---- The saved statement ---- */}
      {loading ? (
        <Card><div style={{ fontSize: 13, color: "#64748B" }}>Loading {periodLabel(period)}…</div></Card>
      ) : !saved || !saved.txns.length ? (
        <Card>
          <div style={{ fontSize: 13.5, fontWeight: 600, marginBottom: 4 }}>Nothing imported for {periodLabel(period)} yet.</div>
          <div style={{ fontSize: 12.5, color: "#64748B" }}>Import the PDF above. Until then Tenant recon has no transactions to match against for this month.</div>
        </Card>
      ) : (
        <>
          <Card style={{ marginBottom: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 12 }}>
              <div style={{ fontWeight: 700, fontSize: 13.5 }}>Reconciliation</div>
              {check.state === "ok" && <Pill tone="ok">✓ Reconciles to the cent</Pill>}
              {check.state === "broken" && <Pill tone="bad">Does not reconcile</Pill>}
              {check.state === "unverifiable" && <Pill tone="warn">Cannot be verified</Pill>}
            </div>
            {check.state === "unverifiable" ? (
              <div style={{ fontSize: 12.5, color: "#B5651D" }}>{check.reason}</div>
            ) : (
              <>
                <table style={{ width: "100%", fontSize: 13, borderCollapse: "collapse", maxWidth: 460 }}>
                  <tbody>
                    <tr><td style={td}>Opening balance</td><td style={tdR}>{money(check.opening)}</td></tr>
                    <tr><td style={td}>Plus credits ({saved.txns.filter((t) => t.direction === "credit").length})</td><td style={{ ...tdR, color: "#2F5D50" }}>{money(check.credits)}</td></tr>
                    <tr><td style={td}>Less debits ({saved.txns.filter((t) => t.direction === "debit").length})</td><td style={{ ...tdR, color: "#9B2C2C" }}>{money(check.debits)}</td></tr>
                    <tr><td style={{ ...td, fontWeight: 700 }}>Expected closing</td><td style={{ ...tdR, fontWeight: 700 }}>{money(check.net)}</td></tr>
                    <tr><td style={{ ...td, fontWeight: 700 }}>Closing balance per statement</td><td style={{ ...tdR, fontWeight: 700 }}>{money(check.closing)}</td></tr>
                    <tr style={{ background: Math.abs(check.totalDrift) > 0.005 ? "#F4E7E7" : "#E3EFE9" }}>
                      <td style={{ ...td, fontWeight: 700 }}>Difference</td>
                      <td style={{ ...tdR, fontWeight: 700 }}>{money(check.totalDrift)}</td>
                    </tr>
                  </tbody>
                </table>
                {check.state === "broken" && check.breaks.length > 0 && (
                  <div style={{ marginTop: 10, fontSize: 12.5, color: "#B5651D" }}>
                    {check.breaks.length} line(s) break the running balance. First: <strong>{check.breaks[0].description_raw}</strong> on {check.breaks[0].txn_date} — the statement prints {money(check.breaks[0].balance_after)} where {money(check.breaks[0].expected)} follows from the line above. Re-import the PDF; if it persists, the parser missed a line in this layout.
                  </div>
                )}
                {check.missingBalances > 0 && (
                  <div style={{ marginTop: 8, fontSize: 12, color: "#94A0AC" }}>
                    {check.missingBalances} line(s) have no running balance stored and sit outside the walk.
                  </div>
                )}
                {saved.doc && saved.doc.balance_source === "derived" && (
                  <div style={{ marginTop: 8, fontSize: 12, color: "#94A0AC" }}>
                    Opening and closing are derived from the running-balance column the bank prints against each line, not read off the statement header. Both are the bank's own figures.
                  </div>
                )}
              </>
            )}
          </Card>

          <Card>
            <div style={{ fontWeight: 700, fontSize: 13.5, marginBottom: 4 }}>Statement, line for line</div>
            <div style={{ fontSize: 12, color: "#94A0AC", marginBottom: 10 }}>
              In statement order. "{saved.doc ? saved.doc.file_name : "—"}"
              {saved.doc && saved.doc.statement_from ? ` · ${saved.doc.statement_from} to ${saved.doc.statement_to}` : ""}
            </div>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", fontSize: 13, borderCollapse: "collapse", minWidth: 760 }}>
                <thead>
                  <tr style={{ color: "#64748B", fontSize: 11, textTransform: "uppercase" }}>
                    <th style={th}>#</th><th style={th}>Date</th><th style={th}>Description</th>
                    <th style={{ ...th, textAlign: "right" }}>Debit</th>
                    <th style={{ ...th, textAlign: "right" }}>Credit</th>
                    <th style={{ ...th, textAlign: "right" }}>Balance</th>
                    <th style={{ ...th, textAlign: "right" }}>Fee</th>
                  </tr>
                </thead>
                <tbody>
                  <tr style={{ background: "#F6F1E7", fontWeight: 700 }}>
                    <td style={td} /><td style={td} /><td style={td}>Opening balance</td>
                    <td style={tdR} /><td style={tdR} />
                    <td style={tdR}>{money(check.opening)}</td><td style={tdR} />
                  </tr>
                  {saved.txns.map((t, i) => {
                    const broken = check.breaks && check.breaks.some((b) => b.id === t.id);
                    return (
                      <tr key={t.id} style={broken ? { background: "#F4E7E7" } : undefined}>
                        <td style={{ ...td, color: "#94A0AC" }}>{t.line_no == null ? i + 1 : t.line_no}</td>
                        <td style={td}>{t.txn_date}</td>
                        <td style={td}>{t.description_raw}</td>
                        <td style={{ ...tdR, color: "#9B2C2C" }}>{t.direction === "debit" ? money(t.amount) : ""}</td>
                        <td style={{ ...tdR, color: "#2F5D50" }}>{t.direction === "credit" ? money(t.amount) : ""}</td>
                        <td style={tdR}>{t.balance_after == null ? "—" : money(t.balance_after)}</td>
                        <td style={{ ...tdR, color: "#94A0AC" }}>{Number(t.accrued_bank_charge) ? money(t.accrued_bank_charge) : ""}</td>
                      </tr>
                    );
                  })}
                  <tr style={{ background: "#F6F1E7", fontWeight: 700 }}>
                    <td style={td} /><td style={td} /><td style={td}>Closing balance</td>
                    <td style={tdR}>{money(check.debits)}</td>
                    <td style={tdR}>{money(check.credits)}</td>
                    <td style={tdR}>{money(check.closing)}</td>
                    <td style={tdR} />
                  </tr>
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}
    </>
  );
}

// ---------- Maintenance plan & reserve fund ----------
// Added 8 August 2026. Where the PMR 22 register actually lives: the component
// list, its condition history, and the reserve fund ledger. Section 12 of the
// AGM report is computed from exactly this data, so anything captured here
// appears in the report and nothing has to be typed twice.
// ---------- Maintenance register: the spreadsheet round trip ----------
// The register is completed by walking the property, which happens on paper and
// in a spreadsheet, not in a browser. So the register exports to .xlsx, gets
// filled in, and comes back — and on the way back THE FILE IS THE SOURCE OF
// TRUTH: a row that has gone from the sheet goes from the register.
//
// Three things make that survivable:
//
//  1. **Removal is deactivation, never a delete.** `active = false` drops the
//     component out of the register and out of the plan — fetchMaintenancePlan
//     already filters on active — while its inspections and any tagged reserve
//     entry survive. A mistaken upload is recoverable; a delete is not, and
//     asset_inspections cascades.
//  2. **Nothing is written until the diff has been seen.** The upload parses
//     into a preview naming every add, every change and every removal. An
//     import that silently deletes is the failure mode this design exists to
//     avoid.
//  3. **Validation is total and up front.** Supabase-js has no transaction, so
//     a half-applied "source of truth" file would leave the register in a state
//     that matches neither the sheet nor what it replaced. Every row is checked
//     before the first write; one unreadable cell refuses the whole import.
//
// Loaded from a CDN on first use, the same pattern as supabase-js, pdf.js and
// docx. 0.20.3 from SheetJS's own CDN rather than 0.18.5 from jsDelivr: 0.18.5
// is the last build npm mirrors and it carries the prototype-pollution advisory
// that later versions fix.
let xlsxLoadPromise = null;
function ensureXlsxLoaded() {
  if (window.XLSX) return Promise.resolve(window.XLSX);
  if (xlsxLoadPromise) return xlsxLoadPromise;
  xlsxLoadPromise = new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js";
    s.onload = () => resolve(window.XLSX);
    s.onerror = () => { xlsxLoadPromise = null; reject(new Error("Could not load the spreadsheet library")); };
    document.head.appendChild(s);
  });
  return xlsxLoadPromise;
}

// Mirrors assets_status_chk in the schema. Kept as a list rather than free text
// so an import cannot write a status the CHECK constraint will reject halfway
// through the file.
const ASSET_STATUSES = ["not_assessed", "assessed", "scheduled", "replaced", "retired"];
const ASSET_COST_BASES = ["quote", "valuation", "insurer schedule", "estimate"];

// ONE definition drives the export, the import and the on-screen grid. Two
// lists would drift, and a column present in the export but missing from the
// import map is a column the trustee fills in and quietly loses.
const REGISTER_COLUMNS = [
  { key: "id", header: "ID (do not edit)", kind: "id", width: 38 },
  { key: "name", header: "Component", kind: "text", width: 34, required: true },
  { key: "category", header: "Category", kind: "text", width: 18, required: true },
  { key: "code", header: "Code", kind: "text", width: 10 },
  { key: "location", header: "Location", kind: "text", width: 18 },
  { key: "quantity", header: "Qty", kind: "number", width: 7, min: 0 },
  { key: "installed_on", header: "Installed on", kind: "date", width: 14 },
  { key: "expected_life_years", header: "Expected life (yrs)", kind: "int", width: 17, min: 1 },
  { key: "replacement_cost", header: "Replacement cost", kind: "number", width: 18, min: 0 },
  { key: "cost_basis", header: "Cost basis", kind: "choice", width: 16, choices: ASSET_COST_BASES },
  { key: "status", header: "Status", kind: "choice", width: 14, choices: ASSET_STATUSES },
  { key: "notes", header: "Notes", kind: "text", width: 48 },
];
const REGISTER_SHEET = "Register";
// The grid shows every exportable column plus three computed ones (condition,
// remaining, provision) and the actions cell. Counted rather than typed, so a
// new column cannot leave a colSpan short and break the category headings.
const REGISTER_GRID_COLS = REGISTER_COLUMNS.filter((c) => c.kind !== "id").length + 4;

// A cell that was filled in but cannot be read. Deliberately NOT null: session
// 19 lost a year of AGM proposals because an unreadable figure was stored as
// null and the save said "Saved". Unreadable stops the import and is named.
const CELL_UNREADABLE = Symbol("unreadable");

const normaliseHeader = (h) => String(h == null ? "" : h).replace(/\u00A0/g, " ").trim().toLowerCase();

// NOT `v instanceof Date`. The spreadsheet library constructs the Date, and a
// value that has crossed a realm boundary — an iframe, a worker, or the test
// harness that evaluates this block in a vm context — fails instanceof while
// being a perfectly good date. The round-trip test caught exactly that, and
// outside the main realm it would have shown up as "can't read this install
// date" on a cell that was fine.
const isDate = (v) => Object.prototype.toString.call(v) === "[object Date]";

function cellText(v) {
  if (v == null) return null;
  const s = String(v).replace(/\u00A0/g, " ").trim();
  return s === "" ? null : s;
}

// Tolerant of what people actually type — "R 12 000,00", "1,125.75", "1.500" —
// and strict about what it cannot read. Where several separators appear, all
// but the last are thousands marks; a lone final group of exactly three digits
// is thousands too, so "1,125" is 1125 rather than 1.125. That last rule is why
// this is not shared with parseAmount(), which is for a resident typing a
// single amount and where "1,125" means 1.125.
function cellNumber(v) {
  if (v == null || v === "") return null;
  if (isDate(v)) return CELL_UNREADABLE;
  if (typeof v === "number") return Number.isFinite(v) ? v : CELL_UNREADABLE;
  let s = String(v).replace(/\u00A0/g, " ").trim().replace(/^R/i, "").replace(/\s/g, "");
  if (s === "") return null;
  const negative = s.startsWith("-");
  if (negative) s = s.slice(1);
  const parts = s.split(/[.,]/);
  if (parts.length > 1) {
    const last = parts[parts.length - 1];
    const lastIsThousands = parts.length === 2 && /^\d{3}$/.test(last);
    s = lastIsThousands ? parts.join("") : `${parts.slice(0, -1).join("")}.${last}`;
  }
  if (!/^\d+(\.\d+)?$/.test(s)) return CELL_UNREADABLE;
  const n = Number(s);
  if (!Number.isFinite(n)) return CELL_UNREADABLE;
  return negative ? -n : n;
}

// Real Date cells (what the export writes) and ISO text only. A slash date is
// REFUSED rather than guessed: 03/04/2020 is two different dates depending on
// who typed it, and a component's install date drives its remaining life.
function cellDate(v) {
  if (v == null || v === "") return null;
  if (isDate(v)) {
    if (!Number.isFinite(v.getTime())) return CELL_UNREADABLE;
    const p = (n) => String(n).padStart(2, "0");
    return `${v.getFullYear()}-${p(v.getMonth() + 1)}-${p(v.getDate())}`;
  }
  const s = String(v).trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return CELL_UNREADABLE;
  return Number.isFinite(new Date(`${s}T00:00:00`).getTime()) ? s : CELL_UNREADABLE;
}

// ---------- Export ----------
function buildRegisterWorkbook(XLSX, rows, fy) {
  const header = REGISTER_COLUMNS.map((c) => c.header);
  const body = rows.map((r) => REGISTER_COLUMNS.map((c) => {
    switch (c.key) {
      case "id": return r.id;
      case "name": return r.name || "";
      case "category": return r.category || "";
      case "code": return r.code || "";
      case "location": return r.location || "";
      case "quantity": return r.quantity == null ? "" : Number(r.quantity);
      // A real Date cell, so the round trip never goes through a string and
      // never meets the slash-date ambiguity cellDate() refuses.
      case "installed_on": return r.installedOn ? new Date(`${String(r.installedOn).slice(0, 10)}T00:00:00`) : "";
      case "expected_life_years": return r.expectedLife == null ? "" : Number(r.expectedLife);
      case "replacement_cost": return r.cost == null ? "" : Number(r.cost);
      case "cost_basis": return r.costBasis || "";
      case "status": return r.status || "";
      case "notes": return r.notes || "";
      default: return "";
    }
  }));

  const ws = XLSX.utils.aoa_to_sheet([header, ...body], { cellDates: true });
  ws["!cols"] = REGISTER_COLUMNS.map((c) => ({ wch: c.width, hidden: c.kind === "id" }));
  // Column A is hidden, so it neither prints nor invites editing — but it is
  // still in the file, which is what makes a renamed component update instead
  // of duplicating. Number formats so the printed sheet reads as money and
  // dates rather than as serial numbers.
  const range = XLSX.utils.decode_range(ws["!ref"]);
  for (let R = 1; R <= range.e.r; R++) {
    REGISTER_COLUMNS.forEach((c, C) => {
      const cell = ws[XLSX.utils.encode_cell({ r: R, c: C })];
      if (!cell) return;
      if (c.kind === "date") cell.z = "yyyy-mm-dd";
      else if (c.key === "replacement_cost") cell.z = "#,##0.00";
    });
  }

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, REGISTER_SHEET);

  const guide = [
    [`El Corazon — component register, FY ${fy}`],
    [`Exported ${TODAY_ISO}`],
    [],
    ["How to complete this sheet"],
    ["1.", "Print the Register tab, or work in it directly. Column A is hidden on purpose — leave it alone."],
    ["2.", "Fill in what the walk-round establishes. Every column is editable except the hidden ID."],
    ["3.", "To ADD a component, type a new row at the bottom and leave the ID blank. Name and Category are required."],
    ["4.", "To REMOVE a component, delete its whole row. Deleting the row is what removes it — blanking the cells is not."],
    ["5.", "Upload the saved file on the Maintenance plan page. You will see exactly what will change before anything is written."],
    [],
    ["What the columns will accept"],
    ["Installed on", "A date cell, or text in the form 2020-05-01. 03/04/2020 is refused — it means two different dates."],
    ["Expected life (yrs)", "A whole number of years, 1 or more. Blank if unknown."],
    ["Replacement cost", "Rands. R 12 000,00 and 12000 are both read. Blank if not yet costed."],
    ["Qty", "A number. Blank if it does not apply."],
    ["Cost basis", ASSET_COST_BASES.join(" / ") + "  (or blank)"],
    ["Status", ASSET_STATUSES.join(" / ")],
    [],
    ["Worth knowing"],
    ["", "A component carries a provision in the ten-year plan only once it has BOTH an expected life and a replacement cost."],
    ["", "Once the maintenance plan has been approved for the year, components can still be added — but no upload can remove one."],
  ];
  const gs = XLSX.utils.aoa_to_sheet(guide);
  gs["!cols"] = [{ wch: 22 }, { wch: 104 }];
  XLSX.utils.book_append_sheet(wb, gs, "How to complete");

  const out = XLSX.write(wb, { bookType: "xlsx", type: "array" });
  return new Blob([out], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}

// ---------- Import ----------
// Returns { rows, error }. The header row is located rather than assumed to be
// row 1, so a title line pasted above the table does not break the import.
function readRegisterSheet(XLSX, arrayBuffer) {
  const wb = XLSX.read(arrayBuffer, { cellDates: true });
  const name = wb.SheetNames.includes(REGISTER_SHEET) ? REGISTER_SHEET : wb.SheetNames[0];
  const ws = wb.Sheets[name];
  if (!ws) return { rows: [], error: "The workbook has no sheets." };
  const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, blankrows: false, defval: null });

  const wanted = new Map(REGISTER_COLUMNS.map((c) => [normaliseHeader(c.header), c.key]));
  let headerRow = -1, colFor = null;
  for (let i = 0; i < Math.min(aoa.length, 20); i++) {
    const map = {};
    (aoa[i] || []).forEach((h, idx) => {
      const key = wanted.get(normaliseHeader(h));
      if (key && map[key] == null) map[key] = idx;
    });
    if (map.name != null && map.category != null) { headerRow = i; colFor = map; break; }
  }
  if (headerRow < 0) {
    return { rows: [], error: `Could not find the header row on the "${name}" sheet — it needs at least a "Component" and a "Category" column. Export a fresh copy and work in that.` };
  }

  const rows = [];
  for (let i = headerRow + 1; i < aoa.length; i++) {
    const raw = aoa[i] || [];
    const cells = {};
    let anything = false;
    REGISTER_COLUMNS.forEach((c) => {
      const idx = colFor[c.key];
      const v = idx == null ? null : raw[idx];
      cells[c.key] = v;
      if (c.kind !== "id" && v != null && String(v).trim() !== "") anything = true;
    });
    if (!anything) continue;                       // a blank row is not a component
    rows.push({ excelRow: i + 1, cells });
  }
  return { rows, error: null, sheetName: name };
}

// The whole point of the preview. Nothing here writes; it decides what WOULD be
// written and what cannot be read, and hands both back to be shown.
function diffRegisterImport(sheetRows, planRows, { locked }) {
  const errors = [];
  const byId = new Map(planRows.map((r) => [String(r.id), r]));
  const seen = new Set();
  const adds = [], updates = [];
  let unchanged = 0;

  const parsed = sheetRows.map(({ excelRow, cells }) => {
    const out = { excelRow, values: {} };
    REGISTER_COLUMNS.forEach((c) => {
      const v = cells[c.key];
      if (c.kind === "id") { out.id = cellText(v); return; }
      let parsedValue;
      if (c.kind === "text") parsedValue = cellText(v);
      else if (c.kind === "date") parsedValue = cellDate(v);
      else if (c.kind === "int" || c.kind === "number") parsedValue = cellNumber(v);
      else if (c.kind === "choice") {
        const t = cellText(v);
        if (t == null) parsedValue = null;
        else {
          const match = c.choices.find((x) => x.toLowerCase() === t.toLowerCase());
          parsedValue = match || CELL_UNREADABLE;
        }
      }
      if (parsedValue === CELL_UNREADABLE) {
        const hint = c.kind === "choice" ? ` It has to be one of: ${c.choices.join(", ")}.`
          : c.kind === "date" ? " Use a date cell, or type it as 2020-05-01."
          : " It has to be a number.";
        errors.push(`Row ${excelRow}, "${c.header}": can't read "${String(v).trim()}".${hint}`);
        parsedValue = null;
      }
      if (parsedValue != null && (c.kind === "int" || c.kind === "number")) {
        if (c.kind === "int" && !Number.isInteger(parsedValue)) {
          errors.push(`Row ${excelRow}, "${c.header}": ${parsedValue} is not a whole number of years.`);
        } else if (c.min != null && parsedValue < c.min) {
          errors.push(`Row ${excelRow}, "${c.header}": ${parsedValue} is below the minimum of ${c.min}.`);
        }
      }
      if (c.required && parsedValue == null) {
        errors.push(`Row ${excelRow}: "${c.header}" is required and is blank.`);
      }
      out.values[c.key] = parsedValue;
    });
    return out;
  });

  // A code has a UNIQUE constraint in the schema. Catching a clash here names
  // both rows; catching it at the insert names neither.
  const codes = new Map();
  parsed.forEach((p) => {
    const code = p.values.code;
    if (!code) return;
    const k = code.toLowerCase();
    if (codes.has(k)) errors.push(`Rows ${codes.get(k)} and ${p.excelRow} both use the code "${code}". Codes have to be unique.`);
    else codes.set(k, p.excelRow);
  });

  parsed.forEach((p) => {
    if (!p.id) { adds.push(p); return; }
    const existing = byId.get(p.id);
    if (!existing) {
      errors.push(`Row ${p.excelRow}: the ID in the hidden column does not match any component on the register. Don't retype IDs — leave the cell blank and the row is added as new.`);
      return;
    }
    if (seen.has(p.id)) {
      errors.push(`Row ${p.excelRow}: "${existing.name}" appears more than once. Copying a row copies its ID; clear the ID on the copy.`);
      return;
    }
    seen.add(p.id);
    const changes = {};
    const current = {
      name: existing.name ?? null, category: existing.category ?? null,
      code: existing.code ?? null, location: existing.location ?? null,
      quantity: existing.quantity ?? null,
      installed_on: existing.installedOn ? String(existing.installedOn).slice(0, 10) : null,
      expected_life_years: existing.expectedLife ?? null,
      replacement_cost: existing.cost ?? null,
      cost_basis: existing.costBasis ?? null, status: existing.status ?? null,
      notes: existing.notes ?? null,
    };
    Object.keys(current).forEach((k) => {
      const was = current[k], now = p.values[k] === undefined ? null : p.values[k];
      const same = typeof was === "number" || typeof now === "number"
        ? Number(was ?? NaN) === Number(now ?? NaN) || (was == null && now == null)
        : was === now;
      if (!same) changes[k] = { from: was, to: now };
    });
    if (Object.keys(changes).length) updates.push({ ...p, existing, changes });
    else unchanged += 1;
  });

  // Anything on the register that the sheet no longer carries. THE FILE IS THE
  // SOURCE OF TRUTH — except once the plan is approved, when removal stops
  // being available at all and these are reported as kept.
  const missing = planRows.filter((r) => !seen.has(String(r.id)));
  return {
    adds, updates, unchanged, errors,
    deactivations: locked ? [] : missing,
    blockedRemovals: locked ? missing : [],
  };
}

// The preview between reading the file and writing anything. It exists because
// "the uploaded file is the source of truth" is a rule that deletes things, and
// nobody should discover what it deleted afterwards.
function ImportPreview({ state, onApply, onCancel, busy, locked, money }) {
  const { diff, filename, rowCount } = state;
  const { adds, updates, deactivations, blockedRemovals, unchanged, errors } = diff;
  const blocked = errors.length > 0;
  const nothing = !blocked && !adds.length && !updates.length && !deactivations.length;

  const box = { marginTop: 14, borderTop: "1px solid #EEE7D6", paddingTop: 14 };
  const head = { fontWeight: 700, fontSize: 12.5, marginBottom: 5 };
  const list = { fontSize: 12, color: "#4A5A67", lineHeight: 1.75, margin: 0, paddingLeft: 18 };
  const show = (v) => (v == null || v === "" ? "—" : typeof v === "number" ? money(v) : String(v));
  const fieldLabel = (k) => (REGISTER_COLUMNS.find((c) => c.key === k) || { header: k }).header;

  return (
    <div style={box}>
      <div style={{ fontSize: 12.5, marginBottom: 10 }}>
        Read <b>{filename}</b> — {rowCount} component row{rowCount === 1 ? "" : "s"}.{" "}
        {blocked
          ? <span style={{ color: "#B5651D", fontWeight: 600 }}>Nothing will be written until these are fixed.</span>
          : nothing
            ? <span style={{ color: "#64748B" }}>It matches the register exactly — there is nothing to apply.</span>
            : <span style={{ color: "#64748B" }}>{unchanged} row{unchanged === 1 ? "" : "s"} unchanged.</span>}
      </div>

      {blocked && (
        <div style={{ marginBottom: 12, background: "#FBF3E9", border: "1px solid #E3C9A8", borderRadius: 8, padding: "10px 12px" }}>
          <div style={{ ...head, color: "#8A5A1E" }}>{errors.length} problem{errors.length === 1 ? "" : "s"} in the file</div>
          <ul style={{ ...list, color: "#8A5A1E" }}>{errors.map((e, i) => <li key={i}>{e}</li>)}</ul>
        </div>
      )}

      {!blocked && adds.length > 0 && (
        <div style={{ marginBottom: 10 }}>
          <div style={head}>{adds.length} component{adds.length === 1 ? "" : "s"} will be added</div>
          <ul style={list}>
            {adds.map((a) => (
              <li key={a.excelRow}>
                <b>{a.values.name}</b> ({a.values.category})
                {a.values.replacement_cost != null && a.values.expected_life_years != null
                  ? <> — {money(a.values.replacement_cost)} over {a.values.expected_life_years}y, so it joins the plan straight away</>
                  : <> — no cost and life yet, so it carries no provision</>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {!blocked && updates.length > 0 && (
        <div style={{ marginBottom: 10 }}>
          <div style={head}>{updates.length} component{updates.length === 1 ? "" : "s"} will change</div>
          <ul style={list}>
            {updates.map((u) => (
              <li key={u.excelRow}>
                <b>{u.existing.name}</b> —{" "}
                {Object.entries(u.changes).map(([k, c], i, arr) => (
                  <span key={k}>{fieldLabel(k)} {show(c.from)} → <b>{show(c.to)}</b>{i < arr.length - 1 ? "; " : ""}</span>
                ))}
              </li>
            ))}
          </ul>
        </div>
      )}

      {!blocked && deactivations.length > 0 && (
        <div style={{ marginBottom: 10, background: "#FBF3E9", border: "1px solid #E3C9A8", borderRadius: 8, padding: "10px 12px" }}>
          <div style={{ ...head, color: "#8A5A1E" }}>{deactivations.length} component{deactivations.length === 1 ? "" : "s"} will be removed</div>
          <ul style={{ ...list, color: "#8A5A1E" }}>
            {deactivations.map((d) => (
              <li key={d.id}>
                <b>{d.name}</b> ({d.category}){d.annualProvision ? <> — currently carrying {money(d.annualProvision)} a year in the plan</> : null}
                {d.inspectionCount ? <> · {d.inspectionCount} inspection{d.inspectionCount === 1 ? "" : "s"} kept</> : null}
              </li>
            ))}
          </ul>
          <div style={{ fontSize: 11.5, color: "#8A5A1E", marginTop: 6 }}>
            They are marked inactive, not deleted — they leave the register and the ten-year plan, and their inspections and any tagged reserve entries are kept. If this list is not what you meant, the row is probably missing from the sheet by accident.
          </div>
        </div>
      )}

      {!blocked && locked && blockedRemovals.length > 0 && (
        <div style={{ marginBottom: 10, background: "#EEF4F0", border: "1px solid #B9D4C6", borderRadius: 8, padding: "10px 12px" }}>
          <div style={{ ...head, color: "#2F5D50" }}>{blockedRemovals.length} component{blockedRemovals.length === 1 ? "" : "s"} missing from the sheet will be KEPT</div>
          <div style={{ fontSize: 12, color: "#2F5D50", lineHeight: 1.7 }}>
            The maintenance plan is approved, so an upload can add components but cannot remove them:{" "}
            <b>{blockedRemovals.map((d) => d.name).join(", ")}</b>. Everything else in the file applies as normal.
          </div>
        </div>
      )}

      <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 6 }}>
        <button style={{ ...primaryBtn, opacity: blocked || nothing ? 0.5 : 1 }} onClick={onApply} disabled={blocked || nothing || busy}>
          {busy ? "Applying…" : "Apply to the register"}
        </button>
        <button style={secondaryBtn} onClick={onCancel} disabled={busy}>Cancel</button>
      </div>
    </div>
  );
}

function MaintenancePlan() {
  const [plan, setPlan] = useState(null);
  const [status, setStatus] = useState("loading"); // loading | ready | error
  const [saving, setSaving] = useState(null);
  const [notice, setNotice] = useState(null);
  const [edits, setEdits] = useState({});          // assetId -> patch
  const [inspectFor, setInspectFor] = useState(null);
  const [newComponent, setNewComponent] = useState({ name: "", category: "", code: "", location: "" });
  // The financial years a maintenance plan has been approved for. undefined =
  // not yet known, and removal is refused while it is unknown — the same
  // fail-closed rule as the statement gate: not knowing whether the plan is
  // approved is not evidence that it is not.
  //
  // ANY approved year locks the register, which is exactly what
  // maintenance_plan_is_approved() asks in the database. The two have to agree,
  // and matching the database's question is the only way to guarantee that —
  // see the note in migrations/maintenance_plan_approval_and_removal_lock.sql
  // for the version that looked more precise and drifted.
  const [approvedYears, setApprovedYears] = useState(undefined);
  const [importState, setImportState] = useState(null); // { filename, diff } once a file has been read
  const [importBusy, setImportBusy] = useState(false);
  const fileInputRef = useRef(null);
  const canManage = useCanManageMaintenance();
  const fy = FY_ACTIVE;

  // The reserve ledger is no longer fetched here — only the plan, which already
  // carries the balance it was computed net of. See ReserveFund on the
  // Financial dashboard.
  const load = async () => {
    setStatus("loading");
    try {
      const client = await ensureSupabaseClient();
      const [p, approved] = await Promise.all([
        fetchMaintenancePlan(fy),
        client.from("approvals").select("scope").eq("subject", "maintenance_plan")
          .then(({ data, error }) => {
            if (error) throw error;
            return (data || []).map((r) => r.scope).sort();
          })
          .catch((err) => {
            console.error("Loading the maintenance plan approval failed:", err);
            return undefined;             // undefined -> unknown -> locked
          }),
      ]);
      setPlan(p);
      setApprovedYears(approved);
      setStatus("ready");
    } catch (err) {
      console.error("Loading the maintenance plan failed:", err);
      setStatus("error");
    }
  };
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Warm the spreadsheet library while the page is being read, so the export
  // click does not have to wait on a CDN. The AGM pack needs its two-step
  // download because generating it takes seconds and Chrome stops treating the
  // save as user-initiated; this export builds from data already in memory, so
  // one click is enough — provided the library is already here.
  useEffect(() => { ensureXlsxLoaded().catch(() => {}); }, []);

  // Approved means: add, don't remove. Unknown counts as approved for the
  // purpose of refusing a removal.
  const lockKnown = approvedYears !== undefined;
  const planLocked = !lockKnown || approvedYears.length > 0;
  const lockedFor = lockKnown && approvedYears.length ? approvedYears.join(", ") : null;

  const patch = (id, field, value) => setEdits((e) => ({ ...e, [id]: { ...(e[id] || {}), [field]: value } }));
  const dirty = Object.keys(edits).length;

  // Every stored field is editable here, not just the four a survey produces.
  // That was a deliberate narrowing once — name, category and code read as
  // register structure rather than survey findings — but the register is being
  // completed from a spreadsheet that carries all of them, and a grid that
  // could not make a correction the upload could make would send every small
  // fix back through Excel.
  //
  // The text fields go through the same parsers as the import, so a cost typed
  // as "R 12 000,00" means the same thing on both routes. An unreadable value
  // REFUSES THE SAVE naming the field — writing null for something the trustee
  // typed is the session-19 data loss, and it is not repeated here.
  const saveAssets = async () => {
    setSaving("assets"); setNotice(null);
    const problems = [];
    const staged = [];
    for (const [id, p] of Object.entries(edits)) {
      const existing = plan.rows.find((r) => r.id === id) || {};
      const row = { updated_at: new Date().toISOString() };
      const put = (field, value, label) => {
        if (value === CELL_UNREADABLE) { problems.push(`${existing.name || "component"} — ${label}`); return; }
        row[field] = value;
      };
      if ("name" in p) put("name", cellText(p.name), "Component");
      if ("category" in p) put("category", cellText(p.category), "Category");
      if ("code" in p) put("code", cellText(p.code), "Code");
      if ("location" in p) put("location", cellText(p.location), "Location");
      if ("quantity" in p) put("quantity", cellNumber(p.quantity), "Qty");
      if ("installed_on" in p) put("installed_on", cellDate(p.installed_on), "Installed on");
      if ("expected_life_years" in p) put("expected_life_years", cellNumber(p.expected_life_years), "Expected life");
      if ("replacement_cost" in p) put("replacement_cost", cellNumber(p.replacement_cost), "Replacement cost");
      if ("cost_basis" in p) row.cost_basis = p.cost_basis || null;
      if ("status" in p) row.status = p.status || existing.status;
      if ("notes" in p) row.notes = cellText(p.notes);
      if (row.name === null) problems.push(`${existing.name || "component"} — Component cannot be blank`);
      if (row.category === null) problems.push(`${existing.name || "component"} — Category cannot be blank`);
      if (row.expected_life_years != null && (!Number.isInteger(row.expected_life_years) || row.expected_life_years < 1)) {
        problems.push(`${existing.name || "component"} — Expected life must be a whole number of years, 1 or more`);
      }
      if (row.replacement_cost != null && row.replacement_cost < 0) {
        problems.push(`${existing.name || "component"} — Replacement cost cannot be negative`);
      }
      // A component with both a cost and a life is assessed by definition.
      const cost = "replacement_cost" in row ? row.replacement_cost : existing.cost;
      const life = "expected_life_years" in row ? row.expected_life_years : existing.expectedLife;
      if (cost != null && life != null && existing.status === "not_assessed" && !("status" in row)) row.status = "assessed";
      staged.push([id, row]);
    }
    if (problems.length) {
      setNotice(`Nothing was saved. Fix these first: ${problems.join("; ")}.`);
      setSaving(null);
      return;
    }
    try {
      const client = await ensureSupabaseClient();
      for (const [id, row] of staged) {
        const { error } = await client.from("assets").update(row).eq("id", id);
        if (error) throw error;
      }
      setEdits({}); setNotice(`Saved ${staged.length} component(s).`);
      await load();
    } catch (err) {
      console.error("Saving the register failed:", err);
      setNotice(err.message || "Saving failed — see browser console.");
    }
    setSaving(null);
  };

  // ---------- Spreadsheet round trip ----------
  const exportRegister = async () => {
    setSaving("export"); setNotice(null);
    try {
      const XLSX = await ensureXlsxLoaded();
      const blob = buildRegisterWorkbook(XLSX, plan.rows, fy);
      downloadBlob(blob, `El-Corazon-component-register-${fy.replace("/", "-")}.xlsx`);
      setNotice("Register exported. Print the Register tab, or fill it in and upload it below.");
    } catch (err) {
      console.error("Exporting the register failed:", err);
      setNotice("Exporting the register failed — see browser console.");
    }
    setSaving(null);
  };

  // Reads and diffs. WRITES NOTHING — applyImport does that, after the diff has
  // been shown.
  const readImportFile = async (file) => {
    if (!file) return;
    setImportBusy(true); setNotice(null); setImportState(null);
    try {
      const XLSX = await ensureXlsxLoaded();
      const buf = await file.arrayBuffer();
      const { rows, error } = readRegisterSheet(XLSX, buf);
      if (error) { setNotice(error); setImportBusy(false); return; }
      const diff = diffRegisterImport(rows, plan.rows, { locked: planLocked });
      setImportState({ filename: file.name, rowCount: rows.length, diff });
    } catch (err) {
      console.error("Reading the uploaded register failed:", err);
      setNotice("Could not read that file — see browser console. It needs to be an .xlsx workbook.");
    }
    setImportBusy(false);
  };

  const cancelImport = () => {
    setImportState(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const applyImport = async () => {
    if (!importState || importState.diff.errors.length) return;
    const { adds, updates, deactivations } = importState.diff;
    setImportBusy(true); setNotice(null);
    const failures = [];
    try {
      const client = await ensureSupabaseClient();
      let maxSort = Math.max(0, ...plan.rows.map((r) => Number(r.sortOrder || 0)));

      for (const u of updates) {
        const row = { updated_at: new Date().toISOString() };
        Object.entries(u.changes).forEach(([field, { to }]) => { row[field] = to; });
        const cost = "replacement_cost" in row ? row.replacement_cost : u.existing.cost;
        const life = "expected_life_years" in row ? row.expected_life_years : u.existing.expectedLife;
        if (cost != null && life != null && (row.status || u.existing.status) === "not_assessed") row.status = "assessed";
        const { error } = await client.from("assets").update(row).eq("id", u.id);
        if (error) failures.push(`Row ${u.excelRow} (${u.existing.name}): ${error.message}`);
      }

      for (const a of adds) {
        maxSort += 1;
        const v = a.values;
        const assessed = v.replacement_cost != null && v.expected_life_years != null;
        const { error } = await client.from("assets").insert({
          name: v.name, category: v.category, code: v.code, location: v.location,
          quantity: v.quantity, installed_on: v.installed_on,
          expected_life_years: v.expected_life_years, replacement_cost: v.replacement_cost,
          cost_basis: v.cost_basis, notes: v.notes,
          status: v.status || (assessed ? "assessed" : "not_assessed"),
          active: true, sort_order: maxSort,
        });
        if (error) failures.push(`Row ${a.excelRow} (${v.name}): ${error.message}`);
      }

      // Deactivation, not deletion. See the note above ensureXlsxLoaded.
      for (const d of deactivations) {
        const { error } = await client.from("assets")
          .update({ active: false, updated_at: new Date().toISOString() })
          .eq("id", d.id);
        if (error) failures.push(`${d.name}: ${error.message}`);
      }

      const done = [];
      if (updates.length) done.push(`${updates.length} updated`);
      if (adds.length) done.push(`${adds.length} added`);
      if (deactivations.length) done.push(`${deactivations.length} removed`);
      setNotice(failures.length
        ? `Applied with problems — ${done.join(", ") || "nothing written"}. Failed: ${failures.join("; ")}. Check the register before re-uploading.`
        : `Register updated from ${importState.filename} — ${done.join(", ") || "nothing to change"}.`);
      cancelImport();
      await load();
    } catch (err) {
      console.error("Applying the uploaded register failed:", err);
      setNotice(err.message || "Applying the upload failed — see browser console.");
    }
    setImportBusy(false);
  };

  const addInspection = async (assetId, form) => {
    setSaving("inspection"); setNotice(null);
    try {
      const client = await ensureSupabaseClient();
      const { error } = await client.from("asset_inspections").upsert({
        asset_id: assetId, inspected_on: form.inspected_on, condition: form.condition,
        inspector: form.inspector || null, notes: form.notes || null,
        revised_remaining_life_years: form.revised === "" || form.revised == null ? null : Number(form.revised),
      }, { onConflict: "asset_id,inspected_on" });
      if (error) throw error;
      setInspectFor(null); setNotice("Inspection recorded.");
      await load();
    } catch (err) {
      console.error("Recording the inspection failed:", err);
      setNotice("Recording the inspection failed — see browser console.");
    }
    setSaving(null);
  };

  // ---------- Adding and removing components ----------
  // Removal is guarded in the database by a BEFORE DELETE trigger, not here —
  // the maintenance trustee can write to assets through the API and the UI is
  // not a control. This only avoids offering a button that would fail.
  const addComponent = async () => {
    const name = (newComponent.name || "").trim();
    const category = (newComponent.category || "").trim();
    if (!name || !category) { setNotice("A component needs a name and a category."); return; }
    setSaving("add"); setNotice(null);
    try {
      const client = await ensureSupabaseClient();
      const maxSort = Math.max(0, ...plan.rows.map((r) => Number(r.sortOrder || 0)));
      const { error } = await client.from("assets").insert({
        name, category,
        code: (newComponent.code || "").trim() || null,
        location: (newComponent.location || "").trim() || null,
        status: "not_assessed", active: true, sort_order: maxSort + 1,
      });
      if (error) throw error;
      setNewComponent({ name: "", category: "", code: "", location: "" });
      setNotice(`Added "${name}". It carries no provision until it has an expected life and a replacement cost.`);
      await load();
    } catch (err) {
      console.error("Adding the component failed:", err);
      setNotice(err.message || "Adding the component failed — see browser console.");
    }
    setSaving(null);
  };

  // Mirrors the trigger's rule so the button can explain itself before it is
  // pressed. The trigger remains the authority; if these two ever disagree the
  // database wins and the user sees its message.
  const captureBlocking = (r) => {
    const reasons = [];
    if (r.inspectionCount) reasons.push(`${r.inspectionCount} inspection${r.inspectionCount === 1 ? "" : "s"}`);
    if (r.reserveEntryCount) reasons.push(`${r.reserveEntryCount} reserve entr${r.reserveEntryCount === 1 ? "y" : "ies"}`);
    if (r.cost != null) reasons.push("a replacement cost");
    if (r.expectedLife != null) reasons.push("an expected life");
    return reasons;
  };

  const removeComponent = async (r) => {
    // The approval lock comes first, and it is absolute: an approved plan is a
    // schedule the meeting adopted, so a component can join it but none can
    // quietly leave. Mirrored in the database by a trigger — this only lets the
    // button explain itself before it is pressed.
    if (planLocked) {
      setNotice(lockKnown
        ? `The maintenance plan is approved (FY ${lockedFor}), so components can be added but not removed. The approving trustee can withdraw the approval on this page to remove one.`
        : "Can't tell whether the maintenance plan is approved, so removal is refused. Reload the page.");
      return;
    }
    const blocking = captureBlocking(r);
    if (blocking.length) {
      setNotice(`"${r.name}" has ${blocking.join(", ")} captured against it, so it can't be removed. Clear those first, or leave it on the register.`);
      return;
    }
    if (!window.confirm(`Remove "${r.name}" from the component register?\n\nNothing has been captured against it, so nothing is lost.`)) return;
    setSaving("remove"); setNotice(null);
    try {
      const client = await ensureSupabaseClient();
      const { error } = await client.from("assets").delete().eq("id", r.id);
      if (error) throw error;
      setNotice(`Removed "${r.name}".`);
      await load();
    } catch (err) {
      console.error("Removing the component failed:", err);
      // The trigger's message names what is captured, which is more useful
      // than anything this layer could invent.
      setNotice(err.message || "Removing the component failed — see browser console.");
    }
    setSaving(null);
  };

  const money = (n) => (n == null ? "—" : `R ${Number(n).toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
  const th = { padding: "6px 8px", textAlign: "left", fontSize: 11, textTransform: "uppercase", color: "#64748B" };
  const td = { padding: "5px 8px", borderTop: "1px solid #F0EADC", fontSize: 12.5 };
  const inp = { ...inputStyle, padding: "4px 6px", fontSize: 12.5, width: "100%", boxSizing: "border-box" };

  if (status === "loading") return <Card><div style={{ fontSize: 13, color: "#64748B" }}>Loading the register…</div></Card>;
  if (status === "error") return <Card><div style={{ fontSize: 13, color: "#B5651D" }}>Could not load the maintenance plan — see browser console.</div></Card>;

  const val = (r, field, fallback) => {
    const e = edits[r.id] || {};
    return field in e ? e[field] : (fallback == null ? "" : fallback);
  };

  return (
    <>
      <h1 className="f-display" style={{ fontSize: 24, marginBottom: 4 }}>Maintenance plan</h1>
      <p style={{ color: "#64748B", fontSize: 13.5, marginBottom: 18 }}>
        The component register behind the statutory ten-year plan. Section 12 of the AGM report is computed from exactly this data — capture it once here and it appears in the report. A component needs <strong>an expected life and a replacement cost</strong> before it can carry a provision; everything else sharpens the estimate. The reserve fund ledger is on the <b>Financial dashboard</b>.
      </p>

      {notice && (
        <Card style={{ marginBottom: 14, borderColor: "#B9D4C6" }}>
          <div style={{ fontSize: 12.5, fontWeight: 600, color: "#2F5D50" }}>{notice}</div>
        </Card>
      )}

      <ApprovalCheckbox
        subject="maintenance_plan"
        onChanged={() => { cancelImport(); load(); }}
        hint="Approving fixes the components the plan is built on: from then on a component can be added, but none can be removed — not from this grid and not by an upload. It does not hold statements; those are gated by the other four sign-offs."
      />

      {/* ---------- Spreadsheet round trip ---------- */}
      {canManage && (
        <Card style={{ marginBottom: 16 }}>
          <div style={{ fontWeight: 700, fontSize: 13.5, marginBottom: 6 }}>Complete the register on paper</div>
          <div style={{ fontSize: 12.5, color: "#64748B", lineHeight: 1.7, marginBottom: 12 }}>
            The register is finished by walking the property, which is not a job for a browser. Export it, print the <b>Register</b> tab or fill it in directly, then upload it back.
            {" "}<b>The uploaded file is the source of truth</b> — a row you add becomes a component, a row you delete removes one{planLocked ? " (except while the plan is approved, when removals are refused)" : ""}, and the rest are updated to match. Nothing is written until you have seen exactly what will change.
          </div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
            <button style={primaryBtn} onClick={exportRegister} disabled={saving === "export"}>
              {saving === "export" ? "Building…" : "Export register to Excel"}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              onChange={(e) => readImportFile(e.target.files && e.target.files[0])}
              disabled={importBusy}
              style={{ fontSize: 12.5 }}
            />
            {importBusy && <span style={{ fontSize: 12, color: "#64748B" }}>Reading…</span>}
          </div>
          <div style={{ fontSize: 11.5, color: "#94A0AC", marginTop: 8 }}>
            Column A of the exported sheet is hidden and holds each component's ID. It is what makes a renamed component update instead of duplicating — leave it alone, and leave it blank on any row you add.
          </div>

          {importState && <ImportPreview state={importState} onApply={applyImport} onCancel={cancelImport} busy={importBusy} locked={planLocked} money={money} />}
        </Card>
      )}

      <Card style={{ marginBottom: 16 }}>
        <div style={{ display: "flex", gap: 28, flexWrap: "wrap", fontSize: 13 }}>
          <div><div style={{ color: "#64748B", fontSize: 11.5 }}>ASSESSED</div><strong>{plan.assessedCount} of {plan.totalCount}</strong></div>
          <div><div style={{ color: "#64748B", fontSize: 11.5 }}>REPLACEMENT COST</div><strong>{money(plan.totalReplacementCost)}</strong></div>
          <div><div style={{ color: "#64748B", fontSize: 11.5 }}>RESERVE HELD</div><strong>{money(plan.reserve.balance)}</strong></div>
          <div><div style={{ color: "#64748B", fontSize: 11.5 }}>ANNUAL CONTRIBUTION</div><strong>{money(plan.annualContribution)}</strong></div>
          <div><div style={{ color: "#64748B", fontSize: 11.5 }}>PER UNIT / MONTH</div><strong>{money(plan.annualContribution / 7 / 12)}</strong></div>
        </div>
      </Card>

      <Card style={{ marginBottom: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10, gap: 12, flexWrap: "wrap" }}>
          <div style={{ fontWeight: 700, fontSize: 13.5 }}>Component register</div>
          <button style={{ ...primaryBtn, opacity: dirty ? 1 : 0.5 }} onClick={saveAssets} disabled={!dirty || saving === "assets"}>
            {saving === "assets" ? "Saving…" : dirty ? `Save ${dirty} change(s)` : "No changes"}
          </button>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 1720 }}>
            <thead><tr>
              <th style={th}>Component</th><th style={th}>Category</th><th style={th}>Code</th><th style={th}>Location</th>
              <th style={th}>Qty</th><th style={th}>Installed</th><th style={th}>Life (yrs)</th>
              <th style={th}>Replacement cost</th><th style={th}>Cost basis</th><th style={th}>Status</th><th style={th}>Notes</th>
              <th style={th}>Condition</th><th style={th}>Remaining</th><th style={th}>Provision / yr</th><th style={th} />
            </tr></thead>
            <tbody>
              {plan.rows.map((r, i) => {
                const prev = i === 0 || plan.rows[i - 1].category !== r.category;
                return (
                  <React.Fragment key={r.id}>
                    {/* Grouping reads the SAVED category, not the edited one, so
                        a row being recategorised stays put until it is saved
                        rather than jumping out from under the cursor. */}
                    {prev && (
                      <tr><td colSpan={REGISTER_GRID_COLS} style={{ ...td, background: "#F6F1E7", fontWeight: 700, fontSize: 12 }}>{r.category}</td></tr>
                    )}
                    <tr style={r.assessed ? undefined : { background: "#FCFAF5" }}>
                      <td style={td}><input style={{ ...inp, minWidth: 190, fontWeight: 600 }} value={val(r, "name", r.name)} onChange={(e) => patch(r.id, "name", e.target.value)} /></td>
                      <td style={td}>
                        <input style={{ ...inp, minWidth: 120 }} list="asset-categories" value={val(r, "category", r.category)} onChange={(e) => patch(r.id, "category", e.target.value)} />
                      </td>
                      <td style={td}><input style={{ ...inp, maxWidth: 80 }} value={val(r, "code", r.code)} onChange={(e) => patch(r.id, "code", e.target.value)} /></td>
                      <td style={td}><input style={{ ...inp, minWidth: 110 }} value={val(r, "location", r.location)} onChange={(e) => patch(r.id, "location", e.target.value)} /></td>
                      <td style={td}><input style={{ ...inp, maxWidth: 60 }} inputMode="decimal" value={val(r, "quantity", r.quantity)} onChange={(e) => patch(r.id, "quantity", e.target.value)} /></td>
                      <td style={td}><input type="date" style={inp} value={val(r, "installed_on", r.installedOn)} onChange={(e) => patch(r.id, "installed_on", e.target.value)} /></td>
                      <td style={td}><input style={{ ...inp, maxWidth: 70 }} inputMode="numeric" value={val(r, "expected_life_years", r.expectedLife)} onChange={(e) => patch(r.id, "expected_life_years", e.target.value)} /></td>
                      <td style={td}><input style={{ ...inp, maxWidth: 120 }} inputMode="decimal" value={val(r, "replacement_cost", r.cost)} onChange={(e) => patch(r.id, "replacement_cost", e.target.value)} /></td>
                      <td style={td}>
                        <select style={{ ...inp, maxWidth: 130 }} value={val(r, "cost_basis", r.costBasis)} onChange={(e) => patch(r.id, "cost_basis", e.target.value)}>
                          <option value="">—</option>
                          {ASSET_COST_BASES.map((b) => <option key={b} value={b}>{b.charAt(0).toUpperCase() + b.slice(1)}</option>)}
                        </select>
                      </td>
                      <td style={td}>
                        {/* Status is offered because the register carries it and
                            the spreadsheet can set it. It is still derived on
                            save: capturing a cost and a life promotes a
                            not_assessed component by itself. */}
                        <select style={{ ...inp, maxWidth: 125 }} value={val(r, "status", r.status)} onChange={(e) => patch(r.id, "status", e.target.value)}>
                          {ASSET_STATUSES.map((s) => <option key={s} value={s}>{s.replace(/_/g, " ")}</option>)}
                        </select>
                      </td>
                      <td style={td}><input style={{ ...inp, minWidth: 200 }} value={val(r, "notes", r.notes)} onChange={(e) => patch(r.id, "notes", e.target.value)} /></td>
                      <td style={td}>
                        {r.condition ? <span style={{ fontWeight: 600 }}>{r.condition}</span> : <span style={{ color: "#94A0AC" }}>—</span>}
                        {r.inspectedOn && <div style={{ fontSize: 10.5, color: "#94A0AC" }}>{r.inspectedOn}</div>}
                      </td>
                      <td style={{ ...td, textAlign: "right" }}>{r.remaining == null ? "—" : `${r.remaining}y`}</td>
                      <td style={{ ...td, textAlign: "right", fontWeight: r.annualProvision ? 600 : 400 }}>{r.annualProvision == null ? "—" : money(r.annualProvision)}</td>
                      <td style={td}>
                        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                          <button style={{ ...secondaryBtn, padding: "3px 8px", fontSize: 11.5 }} onClick={() => setInspectFor(inspectFor === r.id ? null : r.id)}>
                            {inspectFor === r.id ? "Close" : "Inspect"}
                          </button>
                          {canManage && (() => {
                            const blocking = captureBlocking(r);
                            const locked = planLocked || blocking.length > 0;
                            const why = planLocked
                              ? (lockKnown
                                  ? `The maintenance plan is approved (FY ${lockedFor}) — components can be added but not removed`
                                  : "Can't tell whether the plan is approved, so removal is refused")
                              : blocking.length
                                ? `Can't be removed — has ${blocking.join(", ")} captured against it`
                                : `Remove ${r.name}`;
                            return (
                              <button
                                type="button"
                                onClick={() => removeComponent(r)}
                                disabled={saving === "remove"}
                                aria-label={`Remove ${r.name}`}
                                title={why}
                                style={{
                                  border: "1px solid #E3D9C6", background: "#FFF",
                                  color: locked ? "#C3BCAD" : "#B5651D",
                                  borderRadius: 6, width: 24, height: 24, lineHeight: "20px",
                                  fontSize: 14, padding: 0,
                                  cursor: locked ? "not-allowed" : "pointer",
                                }}
                              >{locked ? "🔒" : "×"}</button>
                            );
                          })()}
                        </div>
                      </td>
                    </tr>
                    {inspectFor === r.id && (
                      <tr><td colSpan={REGISTER_GRID_COLS} style={{ ...td, background: "#F6F1E7" }}>
                        <InspectionForm onSave={(f) => addInspection(r.id, f)} saving={saving === "inspection"} />
                      </td></tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
        {/* Shared by the inline category cells and the add form below, so both
            offer the same set. */}
        <datalist id="asset-categories">
          {[...new Set(plan.rows.map((r) => r.category).filter(Boolean))].map((c) => <option key={c} value={c} />)}
        </datalist>
        <div style={{ fontSize: 11.5, color: "#94A0AC", marginTop: 10 }}>
          A shaded row is not yet assessed and contributes nothing to the plan. Remaining life comes from the latest inspection where one gives a revised figure, otherwise from age against the expected life. Condition is not edited here — it belongs to a dated inspection, so use <b>Inspect</b>.
          {canManage && (planLocked
            ? <> {lockKnown
                ? <>The plan is approved (FY {lockedFor}), so every component shows 🔒</>
                : <>The approval could not be read, so removal is refused and every component shows 🔒</>}: components can be added, but none can be removed until the approval is withdrawn.</>
            : <> A component showing 🔒 has an inspection, a tagged reserve entry, a replacement cost or an expected life captured against it and cannot be removed — it is carrying history or a provision.</>)}
        </div>

        {canManage && (
          <div style={{ marginTop: 16, borderTop: "1px solid #EEE7D6", paddingTop: 14 }}>
            <div style={{ fontWeight: 700, fontSize: 12.5, marginBottom: 8 }}>Add a component</div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
              <div style={{ flex: 2, minWidth: 180 }}>
                <div style={{ fontSize: 11, color: "#64748B" }}>Name</div>
                <input style={inp} value={newComponent.name} placeholder="e.g. Driveway gate motor"
                       onChange={(e) => setNewComponent({ ...newComponent, name: e.target.value })} />
              </div>
              <div style={{ flex: 1, minWidth: 140 }}>
                <div style={{ fontSize: 11, color: "#64748B" }}>Category</div>
                {/* Existing categories offered rather than enforced — the
                    register groups by this text, so a typo makes a new group.
                    The datalist itself lives under the grid, shared with the
                    inline category cells. */}
                <input style={inp} list="asset-categories" value={newComponent.category} placeholder="e.g. Security"
                       onChange={(e) => setNewComponent({ ...newComponent, category: e.target.value })} />
              </div>
              <div style={{ width: 110 }}>
                <div style={{ fontSize: 11, color: "#64748B" }}>Code</div>
                <input style={inp} value={newComponent.code}
                       onChange={(e) => setNewComponent({ ...newComponent, code: e.target.value })} />
              </div>
              <div style={{ flex: 1, minWidth: 130 }}>
                <div style={{ fontSize: 11, color: "#64748B" }}>Location</div>
                <input style={inp} value={newComponent.location}
                       onChange={(e) => setNewComponent({ ...newComponent, location: e.target.value })} />
              </div>
              <button style={primaryBtn} onClick={addComponent} disabled={saving === "add"}>
                {saving === "add" ? "Adding…" : "Add component"}
              </button>
            </div>
            <div style={{ fontSize: 11.5, color: "#94A0AC", marginTop: 8 }}>
              A new component starts unassessed and carries no provision. Give it an expected life and a replacement cost above, and it joins the ten-year plan — and can no longer be removed.
            </div>
          </div>
        )}
      </Card>

      {/* The reserve fund ledger used to sit here. It moved to the Financial
          dashboard on 11 August 2026: it is money, not a component, and the
          people who maintain the register are not the people who move funds.
          The balance stays on the summary above because the plan's annual
          contribution is computed net of it — the figure would be unreadable
          without it. */}
      <Card style={{ background: "#F4F1E9" }}>
        <div style={{ fontSize: 12.5, color: "#64748B", lineHeight: 1.7 }}>
          <b>The reserve fund ledger is on the Financial dashboard.</b>{" "}
          Balance <strong>{money(plan.reserve.balance)}</strong> across {plan.reserve.entryCount} entr{plan.reserve.entryCount === 1 ? "y" : "ies"},
          already netted off the annual contribution above. Section 12 of the AGM report reports the reserve fund and the plan together, because Regulation 2 sets the floor and PMR 22 decides whether the floor is enough.
        </div>
      </Card>
    </>
  );
}

// ---------- Reserve fund ledger (Financial dashboard) ----------
// Split out of the Maintenance page on 11 August 2026. Notional entries — book
// movements against the main FNB account, not a separate bank account.
//
// It reads its balance through fetchMaintenancePlan rather than summing the
// ledger itself, so the number here and the number the plan is computed net of
// are the same number, arrived at once.
function ReserveFund() {
  const [plan, setPlan] = useState(null);
  const [rows, setRows] = useState([]);
  const [status, setStatus] = useState("loading"); // loading | ready | error
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState(null);
  const [entry, setEntry] = useState({ entry_date: TODAY_ISO, entry_type: "contribution", amount: "", description: "" });
  const fy = FY_ACTIVE;

  const load = async () => {
    setStatus("loading");
    try {
      const client = await ensureSupabaseClient();
      const [p, r] = await Promise.all([
        fetchMaintenancePlan(fy),
        client.from("reserve_fund_entries").select("*").order("entry_date", { ascending: false }),
      ]);
      if (r.error) throw r.error;
      setPlan(p); setRows(r.data || []); setStatus("ready");
    } catch (err) {
      console.error("Loading the reserve fund failed:", err);
      setStatus("error");
    }
  };
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const addEntry = async () => {
    const amount = parseAmount(entry.amount);
    if (!amount) { setNotice("Enter an amount."); return; }
    setSaving(true); setNotice(null);
    try {
      const client = await ensureSupabaseClient();
      const { error } = await client.from("reserve_fund_entries").insert({
        entry_date: entry.entry_date, financial_year: fy, entry_type: entry.entry_type,
        // A drawdown is stored as a positive amount with its type carrying the
        // sign, so the ledger reads the way a bank statement does.
        amount: Math.abs(amount), description: entry.description || null,
      });
      if (error) throw error;
      setEntry({ entry_date: TODAY_ISO, entry_type: "contribution", amount: "", description: "" });
      setNotice("Reserve fund entry added.");
      await load();
    } catch (err) {
      console.error("Adding the reserve entry failed:", err);
      setNotice("Adding the entry failed — see browser console.");
    }
    setSaving(false);
  };

  const money = (n) => (n == null ? "—" : `R ${Number(n).toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
  const th = { padding: "6px 8px", textAlign: "left", fontSize: 11, textTransform: "uppercase", color: "#64748B" };
  const td = { padding: "5px 8px", borderTop: "1px solid #F0EADC", fontSize: 12.5 };
  const inp = { ...inputStyle, padding: "4px 6px", fontSize: 12.5, width: "100%", boxSizing: "border-box" };

  if (status === "loading") return <Card style={{ marginTop: 16 }}><div style={{ fontSize: 13, color: "#64748B" }}>Loading the reserve fund…</div></Card>;
  if (status === "error") return <Card style={{ marginTop: 16 }}><div style={{ fontSize: 13, color: "#B5651D" }}>Could not load the reserve fund — see browser console.</div></Card>;

  return (
    <Card style={{ marginTop: 16 }}>
      <div style={{ fontWeight: 700, fontSize: 13.5, marginBottom: 4 }}>Reserve fund ledger</div>
      <div style={{ fontSize: 12, color: "#94A0AC", marginBottom: 12 }}>
        Notional — book entries against the main FNB account, not a separate bank account. Balance <strong>{money(plan.reserve.balance)}</strong> across {plan.reserve.entryCount} entr{plan.reserve.entryCount === 1 ? "y" : "ies"}.
        The ten-year plan on <b>Maintenance plan</b> is computed net of this balance.
      </div>

      {notice && <div style={{ fontSize: 12.5, fontWeight: 600, color: "#2F5D50", marginBottom: 10 }}>{notice}</div>}

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end", marginBottom: 14 }}>
        <div><div style={{ fontSize: 11, color: "#64748B" }}>Date</div>
          <input type="date" style={{ ...inp, width: 150 }} value={entry.entry_date} onChange={(e) => setEntry({ ...entry, entry_date: e.target.value })} /></div>
        <div><div style={{ fontSize: 11, color: "#64748B" }}>Type</div>
          <select style={{ ...inp, width: 140 }} value={entry.entry_type} onChange={(e) => setEntry({ ...entry, entry_type: e.target.value })}>
            <option value="opening">Opening balance</option><option value="contribution">Contribution</option>
            <option value="interest">Interest</option><option value="drawdown">Drawdown</option><option value="adjustment">Adjustment</option>
          </select></div>
        <div><div style={{ fontSize: 11, color: "#64748B" }}>Amount</div>
          <input style={{ ...inp, width: 120 }} inputMode="decimal" value={entry.amount} onChange={(e) => setEntry({ ...entry, amount: e.target.value })} /></div>
        <div style={{ flex: 1, minWidth: 200 }}><div style={{ fontSize: 11, color: "#64748B" }}>Description</div>
          <input style={inp} value={entry.description} onChange={(e) => setEntry({ ...entry, description: e.target.value })} /></div>
        <button style={primaryBtn} onClick={addEntry} disabled={saving}>{saving ? "Adding…" : "Add entry"}</button>
      </div>

      {rows.length === 0 ? (
        <div style={{ fontSize: 12.5, color: "#64748B" }}>
          No entries. The reserve fund does not exist yet — until it does, the whole replacement cost of every component has to be funded from future contributions, which is what makes the statutory annual figure as large as it is.
        </div>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead><tr><th style={th}>Date</th><th style={th}>Type</th><th style={th}>Description</th><th style={{ ...th, textAlign: "right" }}>Amount</th></tr></thead>
          <tbody>
            {rows.map((e) => (
              <tr key={e.id}>
                <td style={td}>{String(e.entry_date).slice(0, 10)}</td>
                <td style={td}>{e.entry_type}</td>
                <td style={td}>{e.description || "—"}</td>
                <td style={{ ...td, textAlign: "right", color: e.entry_type === "drawdown" ? "#9B2C2C" : "#2F5D50" }}>
                  {e.entry_type === "drawdown" ? "−" : ""}{money(Math.abs(Number(e.amount)))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}

// Condition capture. Separate from the register grid because an inspection is
// an event with its own date, not an edit to the component.
function InspectionForm({ onSave, saving }) {
  const [f, setF] = useState({ inspected_on: TODAY_ISO, condition: "good", inspector: "", notes: "", revised: "" });
  const inp = { ...inputStyle, padding: "4px 6px", fontSize: 12.5 };
  return (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
      <div><div style={{ fontSize: 11, color: "#64748B" }}>Inspected</div>
        <input type="date" style={{ ...inp, width: 145 }} value={f.inspected_on} onChange={(e) => setF({ ...f, inspected_on: e.target.value })} /></div>
      <div><div style={{ fontSize: 11, color: "#64748B" }}>Condition</div>
        <select style={{ ...inp, width: 100 }} value={f.condition} onChange={(e) => setF({ ...f, condition: e.target.value })}>
          <option value="good">Good</option><option value="fair">Fair</option><option value="poor">Poor</option><option value="failed">Failed</option>
        </select></div>
      <div><div style={{ fontSize: 11, color: "#64748B" }}>Revised life left (yrs)</div>
        <input style={{ ...inp, width: 130 }} inputMode="numeric" value={f.revised} onChange={(e) => setF({ ...f, revised: e.target.value })} /></div>
      <div><div style={{ fontSize: 11, color: "#64748B" }}>Inspector</div>
        <input style={{ ...inp, width: 140 }} value={f.inspector} onChange={(e) => setF({ ...f, inspector: e.target.value })} /></div>
      <div style={{ flex: 1, minWidth: 180 }}><div style={{ fontSize: 11, color: "#64748B" }}>Notes</div>
        <input style={{ ...inp, width: "100%", boxSizing: "border-box" }} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></div>
      <button style={primaryBtn} onClick={() => onSave(f)} disabled={saving}>{saving ? "Saving…" : "Record"}</button>
    </div>
  );
}

// ---------- Budget ----------
// Added 8 August 2026. Section 13 of the AGM report prints exactly what is saved
// here — it does not recompute. A budget is a decision rather than a fact, so
// what the meeting sees has to be what the trustee agreed, not what a formula
// produced at the moment the document was generated.
const BUDGET_SECTIONS = [
  ["income", "Income"],
  ["expenditure", "Administrative expenditure"],
  ["reserve", "Reserve fund contribution"],
];

function Budget() {
  const nfy = nextFY(FY_ACTIVE);
  const [fy, setFy] = useState(nfy);
  const [data, setData] = useState(null);
  const [status, setStatus] = useState("loading"); // loading | ready | error
  const [edits, setEdits] = useState({});   // id -> { amount, basis, label, is_assumption }
  const [meta, setMeta] = useState({ opening_cash: "", approved_on: "", approved_by: "", notes: "" });
  const [metaDirty, setMetaDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState(null);
  const [adding, setAdding] = useState(null); // section key

  const load = async (year) => {
    setStatus("loading"); setEdits({}); setMetaDirty(false);
    try {
      const b = await fetchBudget(year);
      setData(b);
      setMeta({
        opening_cash: b.openingCash == null ? "" : String(b.openingCash),
        approved_on: b.meta && b.meta.approved_on ? String(b.meta.approved_on).slice(0, 10) : "",
        approved_by: b.meta && b.meta.approved_by ? b.meta.approved_by : "",
        notes: b.meta && b.meta.notes ? b.meta.notes : "",
      });
      setStatus("ready");
    } catch (err) {
      console.error("Loading the budget failed:", err);
      setStatus("error");
    }
  };
  useEffect(() => { load(fy); }, [fy]); // eslint-disable-line react-hooks/exhaustive-deps

  const patch = (id, field, value) => setEdits((e) => ({ ...e, [id]: { ...(e[id] || {}), [field]: value } }));
  const dirty = Object.keys(edits).length || metaDirty;

  // Live totals reflect unsaved edits, so the surplus moves as you type. A
  // budget you have to save before you can see the effect of is a budget nobody
  // iterates on.
  const liveAmount = (r) => {
    const e = edits[r.id];
    return e && "amount" in e ? parseAmount(e.amount) : r.amount;
  };
  const sectionTotal = (key) => (data ? round2((data[key === "income" ? "income" : key === "expenditure" ? "expenditure" : "reserve"] || [])
    .filter((r) => !(edits[r.id] || {})._deleted)
    .reduce((s, r) => s + liveAmount(r), 0)) : 0);
  const tIncome = sectionTotal("income"), tExp = sectionTotal("expenditure"), tRes = sectionTotal("reserve");
  const operating = round2(tIncome - tExp);
  const afterReserve = round2(operating - tRes);
  const openingCash = meta.opening_cash === "" ? null : parseAmount(meta.opening_cash);
  const closingCash = openingCash == null ? null : round2(openingCash + operating);

  const save = async () => {
    setSaving(true); setNotice(null);
    try {
      const client = await ensureSupabaseClient();
      for (const [id, p] of Object.entries(edits)) {
        if (p._deleted) {
          const { error } = await client.from("budget_lines").delete().eq("id", id);
          if (error) throw error;
          continue;
        }
        const row = { updated_at: new Date().toISOString() };
        if ("label" in p) row.label = p.label;
        if ("amount" in p) row.amount = parseAmount(p.amount);
        if ("basis" in p) row.basis = p.basis || null;
        if ("is_assumption" in p) row.is_assumption = Boolean(p.is_assumption);
        const { error } = await client.from("budget_lines").update(row).eq("id", id);
        if (error) throw error;
      }
      if (metaDirty) {
        const { error } = await client.from("budget_meta").upsert({
          financial_year: fy,
          opening_cash: meta.opening_cash === "" ? null : parseAmount(meta.opening_cash),
          approved_on: meta.approved_on || null,
          approved_by: meta.approved_by || null,
          notes: meta.notes || null,
          updated_at: new Date().toISOString(),
        }, { onConflict: "financial_year" });
        if (error) throw error;
      }
      setNotice("Saved. Section 13 of the AGM report now prints these figures.");
      await load(fy);
    } catch (err) {
      console.error("Saving the budget failed:", err);
      setNotice("Saving failed — see browser console. Nothing was written.");
    }
    setSaving(false);
  };

  const addLine = async (section, label) => {
    if (!label || !label.trim()) return;
    setSaving(true); setNotice(null);
    try {
      const client = await ensureSupabaseClient();
      const existing = (data[section] || []);
      const { error } = await client.from("budget_lines").insert({
        financial_year: fy, section, label: label.trim(), amount: 0,
        sort_order: existing.length ? Math.max(...existing.map((r) => r.sort_order)) + 10 : 10,
        is_assumption: true,
        basis: "Added manually — record how this figure was arrived at.",
      });
      if (error) throw error;
      setAdding(null);
      await load(fy);
    } catch (err) {
      console.error("Adding the line failed:", err);
      setNotice("Adding the line failed — a line with that name may already exist for this year.");
    }
    setSaving(false);
  };

  const money = (n) => (n == null ? "—" : `R ${Number(n).toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
  const th = { padding: "6px 8px", textAlign: "left", fontSize: 11, textTransform: "uppercase", color: "#64748B" };
  const td = { padding: "5px 8px", borderTop: "1px solid #F0EADC", fontSize: 12.5 };
  const inp = { ...inputStyle, padding: "4px 6px", fontSize: 12.5, width: "100%", boxSizing: "border-box" };

  if (status === "loading") return <Card><div style={{ fontSize: 13, color: "#64748B" }}>Loading the FY {fy} budget…</div></Card>;
  if (status === "error") return <Card><div style={{ fontSize: 13, color: "#B5651D" }}>Could not load the budget — see browser console.</div></Card>;

  const years = [...new Set([nfy, FY_ACTIVE, fy])].sort().reverse();
  const val = (r, field) => {
    const e = edits[r.id] || {};
    return field in e ? e[field] : (r[field] == null ? "" : r[field]);
  };

  const SectionTable = ({ sectionKey, title, rows, total }) => (
    <Card style={{ marginBottom: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10, gap: 12, flexWrap: "wrap" }}>
        <div style={{ fontWeight: 700, fontSize: 13.5 }}>{title}</div>
        <div style={{ fontWeight: 700, fontSize: 14 }}>{money(total)}</div>
      </div>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 760 }}>
          <thead><tr>
            <th style={{ ...th, width: "26%" }}>Line</th>
            <th style={{ ...th, width: "14%" }}>Amount</th>
            <th style={th}>Basis</th>
            <th style={{ ...th, width: 90, textAlign: "center" }}>Estimate</th>
            <th style={{ ...th, width: 40 }} />
          </tr></thead>
          <tbody>
            {rows.filter((r) => !(edits[r.id] || {})._deleted).map((r) => (
              <tr key={r.id}>
                <td style={td}><input style={inp} value={val(r, "label")} onChange={(e) => patch(r.id, "label", e.target.value)} /></td>
                <td style={td}><input style={{ ...inp, textAlign: "right", fontFamily: "'IBM Plex Mono', ui-monospace, monospace" }}
                  inputMode="decimal" value={val(r, "amount")} onChange={(e) => patch(r.id, "amount", e.target.value)} /></td>
                <td style={td}><input style={inp} value={val(r, "basis")} onChange={(e) => patch(r.id, "basis", e.target.value)} placeholder="How was this figure arrived at?" /></td>
                <td style={{ ...td, textAlign: "center" }}>
                  <input type="checkbox" checked={Boolean(val(r, "is_assumption"))} onChange={(e) => patch(r.id, "is_assumption", e.target.checked)} />
                </td>
                <td style={td}>
                  <button style={{ ...secondaryBtn, padding: "2px 7px", fontSize: 11 }} title="Remove this line"
                    onClick={() => patch(r.id, "_deleted", true)}>×</button>
                </td>
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={5} style={{ ...td, color: "#94A0AC" }}>No lines yet.</td></tr>}
          </tbody>
        </table>
      </div>
      {adding === sectionKey ? (
        <AddLine onAdd={(label) => addLine(sectionKey, label)} onCancel={() => setAdding(null)} saving={saving} />
      ) : (
        <button style={{ ...secondaryBtn, marginTop: 10, padding: "5px 11px", fontSize: 12 }} onClick={() => setAdding(sectionKey)}>+ Add a line</button>
      )}
    </Card>
  );

  return (
    <>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16, flexWrap: "wrap" }}>
        <div>
          <h1 className="f-display" style={{ fontSize: 24, marginBottom: 4 }}>Budget — FY {fy}</h1>
          <p style={{ color: "#64748B", fontSize: 13.5, marginBottom: 18, maxWidth: 720 }}>
            Every figure is editable and every figure is printed. <strong>Section 13 of the AGM report prints exactly what is saved here</strong> — it does not recompute, so what is tabled at the meeting is what you agreed. Totals below move as you type; nothing is written until you save.
          </p>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <select value={fy} onChange={(e) => setFy(e.target.value)} style={inputStyle}>
            {years.map((y) => <option key={y} value={y}>FY {y}</option>)}
          </select>
          <button style={{ ...primaryBtn, opacity: dirty ? 1 : 0.5 }} onClick={save} disabled={!dirty || saving}>
            {saving ? "Saving…" : dirty ? "Save budget" : "Saved"}
          </button>
        </div>
      </div>

      {notice && (
        <Card style={{ marginBottom: 14, borderColor: "#B9D4C6" }}>
          <div style={{ fontSize: 12.5, fontWeight: 600, color: "#2F5D50" }}>{notice}</div>
        </Card>
      )}

      <Card style={{ marginBottom: 16 }}>
        <div style={{ display: "flex", gap: 28, flexWrap: "wrap", fontSize: 13 }}>
          <div><div style={{ color: "#64748B", fontSize: 11.5 }}>INCOME</div><strong>{money(tIncome)}</strong></div>
          <div><div style={{ color: "#64748B", fontSize: 11.5 }}>EXPENDITURE</div><strong>{money(tExp)}</strong></div>
          <div><div style={{ color: "#64748B", fontSize: 11.5 }}>OPERATING</div>
            <strong style={{ color: operating >= 0 ? "#2F5D50" : "#9B2C2C" }}>{money(operating)}</strong></div>
          <div><div style={{ color: "#64748B", fontSize: 11.5 }}>RESERVE</div><strong>{money(tRes)}</strong></div>
          <div><div style={{ color: "#64748B", fontSize: 11.5 }}>AFTER RESERVE</div>
            <strong style={{ color: afterReserve >= 0 ? "#2F5D50" : "#9B2C2C" }}>{money(afterReserve)}</strong></div>
          <div><div style={{ color: "#64748B", fontSize: 11.5 }}>PER UNIT / MONTH</div>
            <strong>{money(round2(tExp / 7 / 12))}</strong></div>
        </div>
      </Card>

      {BUDGET_SECTIONS.map(([key, title]) => (
        <SectionTable key={key} sectionKey={key} title={title}
          rows={data[key] || []} total={key === "income" ? tIncome : key === "expenditure" ? tExp : tRes} />
      ))}

      <Card>
        <div style={{ fontWeight: 700, fontSize: 13.5, marginBottom: 10 }}>Cash and approval</div>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
          <div><div style={{ fontSize: 11, color: "#64748B" }}>Opening cash</div>
            <input style={{ ...inp, width: 150 }} inputMode="decimal" value={meta.opening_cash}
              onChange={(e) => { setMeta({ ...meta, opening_cash: e.target.value }); setMetaDirty(true); }} /></div>
          <div><div style={{ fontSize: 11, color: "#64748B" }}>Approved on</div>
            <input type="date" style={{ ...inp, width: 150 }} value={meta.approved_on}
              onChange={(e) => { setMeta({ ...meta, approved_on: e.target.value }); setMetaDirty(true); }} /></div>
          <div><div style={{ fontSize: 11, color: "#64748B" }}>Approved by</div>
            <input style={{ ...inp, width: 180 }} value={meta.approved_by}
              onChange={(e) => { setMeta({ ...meta, approved_by: e.target.value }); setMetaDirty(true); }} /></div>
          <div style={{ flex: 1, minWidth: 220 }}><div style={{ fontSize: 11, color: "#64748B" }}>Note (printed under the budget)</div>
            <input style={inp} value={meta.notes}
              onChange={(e) => { setMeta({ ...meta, notes: e.target.value }); setMetaDirty(true); }} /></div>
        </div>
        <div style={{ marginTop: 12, fontSize: 13 }}>
          Projected closing cash: <strong>{money(closingCash)}</strong>
        </div>
        <div style={{ fontSize: 11.5, color: "#94A0AC", marginTop: 4 }}>
          Opening cash plus the operating surplus. The reserve contribution is excluded on purpose — it is a designation of existing funds, not a payment out, so the cash stays in the account either way.
        </div>
      </Card>
    </>
  );
}

function AddLine({ onAdd, onCancel, saving }) {
  const [label, setLabel] = useState("");
  return (
    <div style={{ display: "flex", gap: 8, marginTop: 10, alignItems: "center" }}>
      <input autoFocus style={{ ...inputStyle, padding: "4px 6px", fontSize: 12.5, width: 260 }}
        placeholder="Line name" value={label} onChange={(e) => setLabel(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") onAdd(label); if (e.key === "Escape") onCancel(); }} />
      <button style={{ ...primaryBtn, padding: "5px 11px", fontSize: 12 }} onClick={() => onAdd(label)} disabled={saving || !label.trim()}>Add</button>
      <button style={{ ...secondaryBtn, padding: "5px 11px", fontSize: 12 }} onClick={onCancel}>Cancel</button>
    </div>
  );
}
