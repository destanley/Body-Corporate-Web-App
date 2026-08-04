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

// Levy line items — one amount per unit, per item, in statement order.
// Rules (trustee-confirmed, 12 July 2026), all VAT-inclusive on the statement:
//   Insurance                  — individualised per unit per year, manual entry
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
const LEVY_ITEMS = [
  "Insurance",
  "Blockwatch",
  "Garden Service",
  "Common Property Water",
  "Water Demand Levy",
  "Sewerage",
  "Common Property Electricity",
  "Electricity Service Charge",
  "Electricity Network Charge",
];

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
const BANK_LINE_RE = /^(\d{2}\s+[A-Za-z]{3})\s+(.+?)\s+([\d,]+\.\d{2})\s?(Cr)?\s+([\d,]+\.\d{2})\s?(?:Cr)?(?:\s+(\d+\.\d{2}))?$/;

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
function parseBankStatementLines(lines) {
  const seen = new Set();
  const out = [];
  lines.forEach((line) => {
    const m = line.match(BANK_LINE_RE);
    if (!m) return;
    const [, date, desc, amountRaw, crFlag, , accrued] = m;
    const key = date + "|" + desc + "|" + amountRaw;
    if (seen.has(key)) return;
    seen.add(key);
    const amount = parseFloat(amountRaw.replace(/,/g, ""));
    const direction = crFlag ? "credit" : "debit";
    const cls = classifyBankTransaction(desc);
    out.push({ date, desc, amount, direction, accruedCharge: accrued ? parseFloat(accrued) : 0, ref: desc, ...cls });
  });
  return out;
}

async function parseBankStatementPdf(file) {
  const pdfjsLib = await ensurePdfJsLoaded();
  const buf = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
  const lines = await extractPdfLines(pdf);
  return parseBankStatementLines(lines);
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
// the trustee allocation uses (calcWaterCost, the 6kL minimum-charge rule, VAT),
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

  const individualBands = deriveIndividualWaterBands(bands);
  const sortedByFrom = [...bands].sort((a, b) => a.from - b.from);
  const freeBandLimit = sortedByFrom[0] && (sortedByFrom[0].rate2025 || 0) === 0 ? (sortedByFrom[0].to || 0) : 0;
  const waterCostComputed = wUse > freeBandLimit ? calcWaterCost(wUse, bands) : calcWaterCost(wUse, individualBands);
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
  const levy = LEVY_ITEMS.reduce((s, item) => s + (Number(levyItems[item]) || 0), 0);
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
    levy, levyItems, extras, additionalTotal, total,
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
const MONTH_NAMES = ["January","February","March","April","May","June","July","August","September","October","November","December"];
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
  const [bands, elec, vat, levy, manual, usage, prevUsage, charges, expenses, invoice, btxns, bdocs, remits, overrides, manualPays, expCats] = await Promise.all([
    client.from("water_tariff_bands").select("*"),
    // Electricity: most recent effective_from ≤ this period (top 2 for YoY comparison)
    client.from("electricity_rates").select("*").lte("effective_from", period).order("effective_from", { ascending: false }).limit(2),
    client.from("vat_rates").select("*").order("effective_from", { ascending: false }).limit(1),
    // Levy tables stay keyed to the body corp FY (Aug–Jul)
    client.from("levy_rates").select("*").eq("financial_year", FY_ACTIVE).limit(1),
    client.from("levy_manual_entries").select("*").eq("financial_year", FY_ACTIVE),
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
  ]);
  const failed = [bands, elec, vat, levy, manual, usage, prevUsage, charges, expenses, invoice, btxns, bdocs, remits, overrides, manualPays, expCats].find((r) => r.error);
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

  // Levy manual grid: start from the app defaults, overlay any saved rows.
  const levyBreakdown = Object.fromEntries(
    Object.entries(LEVY_BREAKDOWN_DEFAULT).map(([k, v]) => [k, { ...v }])
  );
  manual.data.forEach((m) => {
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

  const inv = invoice.data[0];
  return {
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
    levyRates: levy.data[0]
      ? { commonPropertyElectricityKwh: Number(levy.data[0].common_property_electricity_kwh) }
      : null,
    levyBreakdown,
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
      : COUNCIL_INVOICE,
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

async function saveTariffsToDb({ waterSets, electricityRate, electricityEffectiveFrom, vatRate, commonPropertyElectricityKwh }) {
  const client = await ensureSupabaseClient();
  const updates = [];
  // Water: one or more rate sets, each keyed by its own effective date. Upsert
  // by (effective_from, band_label), so a date with no set yet is created and
  // an existing one is corrected in place. Only the sets the trustee actually
  // touched are passed in — untouched history is never rewritten.
  (waterSets || []).forEach((set) => {
    set.bands.forEach((b) => {
      updates.push(client.from("water_tariff_bands").upsert({
        effective_from: set.effectiveFrom, band_label: b.label,
        from_kl: b.from, to_kl: b.to, rate_per_kl: b.rate,
        financial_year: null, // no longer the key — kept for reference
      }, { onConflict: "effective_from,band_label" }));
    });
  });
  // Electricity rate: upsert by effective_from (unique constraint).
  updates.push(client.from("electricity_rates").upsert({
    rate_per_kwh: electricityRate,
    effective_from: electricityEffectiveFrom,
    financial_year: null,
  }, { onConflict: "effective_from" }));
  // VAT is not date-scoped per rate set — single global rate.
  updates.push(client.from("vat_rates").update({ rate: vatRate }).gte("effective_from", "1900-01-01"));
  // Levy rates: check if a row exists for this FY, then update or insert.
  // Can't use upsert because PostgreSQL enforces NOT NULL on INSERT values
  // before checking ON CONFLICT, and we don't want to overwrite the other
  // columns (water_demand_levy etc.) with zeros when the row already exists.
  const existingLevy = await client.from("levy_rates").select("financial_year").eq("financial_year", FY_ACTIVE).limit(1);
  if (existingLevy.data?.length > 0) {
    updates.push(client.from("levy_rates").update({
      common_property_electricity_kwh: commonPropertyElectricityKwh,
    }).eq("financial_year", FY_ACTIVE));
  } else {
    updates.push(client.from("levy_rates").insert({
      financial_year: FY_ACTIVE,
      common_property_electricity_kwh: commonPropertyElectricityKwh,
      water_demand_levy: 0, electricity_service_fee: 0, electricity_network_fee: 0,
    }));
  }
  const results = await Promise.all(updates);
  const bad = results.find((x) => x.error);
  if (bad) throw bad.error;
}

// Every grid cell is stored — the levy grid is fully manual.
async function saveLevyBreakdownToDb(levyBreakdown) {
  const client = await ensureSupabaseClient();
  const rows = [];
  UNITS.forEach((u) => {
    if (!u.dbId) return;
    LEVY_ITEMS.forEach((item) => {
      rows.push({ unit_id: u.dbId, financial_year: FY_ACTIVE, item_label: item, amount: levyBreakdown[u.id]?.[item] ?? 0 });
    });
  });
  if (rows.length === 0) throw new Error("Units haven't loaded from the database yet");
  const { error: delErr } = await client.from("levy_manual_entries").delete().eq("financial_year", FY_ACTIVE);
  if (delErr) throw delErr;
  const { error } = await client.from("levy_manual_entries").insert(rows);
  if (error) throw error;
}

// Suggested per-unit levy amounts from the confirmed rules — all VAT
// inclusive. Insurance is null (individualised manual entry, never filled).
// These drive the suggestions strip and the "fill grid" action on the Levy
// breakdown page; the grid itself stays fully editable.
function computeSuggestedLevyItems({ waterBands, electricityRate, vatRate, commonPropertyElectricityKwh, councilInvoice }) {
  const withVat = (n) => n * (1 + vatRate);
  return {
    "Insurance": null,
    "Blockwatch": 0,
    "Garden Service": 0,
    "Common Property Water": withVat(calcWaterCost(COMMON_PROPERTY_WATER_KL, waterBands)) / UNITS.length,
    "Water Demand Levy": withVat(councilInvoice.waterDemandLevyPerUnit || 0),
    "Sewerage": withVat(councilInvoice.sewerChargePerUnit || 0),
    "Common Property Electricity": withVat(commonPropertyElectricityKwh * electricityRate) / UNITS.length,
    "Electricity Service Charge": withVat(councilInvoice.elecServiceFee || 0) / UNITS.length,
    "Electricity Network Charge": withVat(councilInvoice.elecNetworkFee || 0) / UNITS.length,
  };
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
function statementDateToIso(raw) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const m = String(raw).match(/^(\d{1,2})\s+([A-Za-z]{3})/);
  // Bank transactions belong to the payment-period month (the bank statement
  // being reconciled), so fall back to and take the year from that period.
  if (!m) return ACTIVE_PAYMENT_PERIOD;
  const months = { jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06", jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12" };
  const mm = months[m[2].toLowerCase()];
  if (!mm) return ACTIVE_PAYMENT_PERIOD;
  return `${ACTIVE_PAYMENT_PERIOD.slice(0, 4)}-${mm}-${m[1].padStart(2, "0")}`;
}

// Persists a parsed statement wholesale for the period — re-uploading a
// corrected PDF replaces the previous document and its transactions rather
// than duplicating them.
async function saveBankStatementToDb(fileName, txns) {
  const client = await ensureSupabaseClient();
  const unitDbIdByAppId = Object.fromEntries(UNITS.filter((u) => u.dbId).map((u) => [u.id, u.dbId]));

  // Any trustee retargeting lives on rows the delete below is about to remove.
  // Capture it first and re-apply after the re-insert, or re-importing a
  // statement silently reverts the fix and the month quietly goes unpaid again.
  const defaultApplied = prevPeriod(ACTIVE_PAYMENT_PERIOD);
  const { data: priorTxns } = await client
    .from("bank_transactions")
    .select("txn_date, amount, description_raw, applied_period")
    .eq("period", ACTIVE_PAYMENT_PERIOD)
    .eq("category", "resident_payment");
  const retargeted = (priorTxns || []).filter(
    (p) => p.applied_period && p.applied_period !== defaultApplied
  );

  let { error } = await client.from("bank_transactions").delete().eq("period", ACTIVE_PAYMENT_PERIOD);
  if (error) throw error;
  ({ error } = await client.from("bank_statement_documents").delete().eq("period", ACTIVE_PAYMENT_PERIOD));
  if (error) throw error;
  const { data: doc, error: docErr } = await client
    .from("bank_statement_documents")
    .insert({ period: ACTIVE_PAYMENT_PERIOD, file_name: fileName, parse_status: "parsed", transaction_count: txns.length })
    .select("id")
    .single();
  if (docErr) throw docErr;
  const rows = txns.map((t) => ({
    bank_statement_document_id: doc.id,
    period: ACTIVE_PAYMENT_PERIOD,
    txn_date: statementDateToIso(t.date),
    description_raw: t.desc,
    amount: t.amount,
    direction: t.direction,
    accrued_bank_charge: t.accruedCharge || 0,
    category: t.category,
    matched_unit_id: t.matchedUnit ? unitDbIdByAppId[t.matchedUnit] || null : null,
    match_confidence: t.confidence,
    match_note: t.note,
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
      .eq("period", ACTIVE_PAYMENT_PERIOD)
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

async function signOutOfApp() {
  const client = await ensureSupabaseClient();
  await client.auth.signOut();
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

// Common property (body corp) water — fixed 20kL/month standard, confirmed by the
// trustee. Billed using the real, unmodified municipal tariff scale (i.e. still
// including the free first 6kL) since that's genuinely how the municipality bills
// bulk water — unlike individual units, which don't get that free tier (see
// deriveIndividualWaterBands below). Not trustee-configurable for now.
const COMMON_PROPERTY_WATER_KL = 20;

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

// No-free-tier scale: merges the free 0-6kL band into the next paid band, so
// every kL from 0 bills at the >6-10 rate. Per the trustee's July 2026 rule
// update this now applies ONLY to units consuming at or under 6kL (the
// "minimum charge" for low-usage units) — units over 6kL bill on the real
// municipal scale with the free tier intact, same as common property water.
function deriveIndividualWaterBands(bands) {
  const sorted = [...bands].sort((a, b) => a.from - b.from);
  if (sorted.length < 2) return sorted;
  const [first, ...rest] = sorted;
  const isFreeBand = (first.rate2025 || 0) === 0 && (first.rate2024 || 0) === 0;
  if (!isFreeBand) return sorted;
  const merged = { ...rest[0], from: first.from };
  return [merged, ...rest.slice(1)];
}

// ---------- Allocation engine ----------
// unitsSource ("mock" | "database" | "error") is only used as a memo dependency:
// when the DB units replace the mock UNITS binding, the source flips and this
// recomputes against the fresh rows — nothing inside reads the value itself.
function useAllocation(waterBands, electricityRate, levyBreakdown, vatRate, additionalCharges, commonPropertyElectricityKwh, unitsSource, readings, councilInvoice, statementOverrides = {}) {
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

    // Water billing rules (trustee-confirmed, 12 July 2026):
    //   1. Consumption OVER the free band (6kL): real municipal scale,
    //      free tier included — the first 6kL cost nothing.
    //   2. Consumption AT or UNDER 6kL: no free tier — every kL bills at the
    //      first paid band's rate (the minimum charge for low-usage units,
    //      so nobody's water line is R0.00).
    //   3. Common property water (20kL standard): always the real scale.
    // Note the deliberate step at the boundary: ~5.99kL bills ≈R178.74 while
    // ~6.5kL bills ≈R14.92, because crossing 6kL earns the whole free tier.
    const individualWaterBands = deriveIndividualWaterBands(waterBands);
    const sortedByFrom = [...waterBands].sort((a, b) => a.from - b.from);
    const freeBandLimit = sortedByFrom[0] && (sortedByFrom[0].rate2025 || 0) === 0 ? (sortedByFrom[0].to || 0) : 0;

    // Common property (body corp) standards: fixed 20kL of water (real, unmodified
    // scale) and a configurable kWh of electricity (flat rate), split equally across
    // all 7 units — these are what actually feed the AGM levy lines now, replacing
    // manual entry.
    const commonPropertyWaterCost = calcWaterCost(COMMON_PROPERTY_WATER_KL, waterBands);
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
      const waterCostComputed = wUse > freeBandLimit
        ? calcWaterCost(wUse, waterBands)           // rule 1 — free tier applies
        : calcWaterCost(wUse, individualWaterBands); // rule 2 — minimum charge
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
      tariffWaterTotal, tariffElecTotal,
      councilInvoice,
    };
  }, [waterBands, electricityRate, levyBreakdown, vatRate, additionalCharges, commonPropertyElectricityKwh, unitsSource, readings, councilInvoice, statementOverrides]);
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
  const [role, setRole] = useState("trustee");
  const [tab, setTab] = useState("dashboard");
  const [selectedUnit, setSelectedUnit] = useState("U1");
  // The month the whole trustee app is looking at. Defaults to the latest
  // period; the period selector swaps it and every screen (recon, statements,
  // dashboard) recomputes for the chosen month. `periods` is the list of
  // months that actually have data, newest first.
  const [selectedPeriod, setSelectedPeriod] = useState(CURRENT_PERIOD);
  const [periods, setPeriods] = useState([CURRENT_PERIOD]);
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
  const [vatRate, setVatRate] = useState(VAT_RATE_DEFAULT);
  const [commonPropertyElectricityKwh, setCommonPropertyElectricityKwh] = useState(COMMON_PROPERTY_ELECTRICITY_KWH_DEFAULT);
  const [additionalCharges, setAdditionalCharges] = useState(ADDITIONAL_CHARGES_DEFAULT);
  const [remittanceDeductions, setRemittanceDeductions] = useState({});
  const [remittanceAdvices, setRemittanceAdvices] = useState({});
  const [opsExpenses, setOpsExpenses] = useState(OPS_EXPENSES_DEFAULT);
  // Trustee-managed expense category list — Config edits it, every tagging
  // dropdown and the analytics dashboard read from it.
  const [expenseCategories, setExpenseCategories] = useState(EXPENSE_CATEGORIES_FALLBACK);
  const [readings, setReadings] = useState(READINGS);
  const [councilInvoice, setCouncilInvoice] = useState(COUNCIL_INVOICE);
  // Manual overrides of the computed utility due lines, per unit, for the
  // selected period — used to align a past statement to what was physically sent.
  const [statementOverrides, setStatementOverrides] = useState({});
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
  const [bankStatementMeta, setBankStatementMeta] = useState(null); // { fileName, parsedAt, count } | null
  const [bankStatementStatus, setBankStatementStatus] = useState("idle"); // idle | parsing | done | error
  const [bankStatementError, setBankStatementError] = useState(null);
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
        }
        setLevyBreakdown(data.levyBreakdown);
        setReadings(data.readings);
        setAdditionalCharges(data.additionalCharges);
        setOpsExpenses(data.opsExpenses);
        if (data.expenseCategories && data.expenseCategories.length) setExpenseCategories(data.expenseCategories);
        setCouncilInvoice(data.councilInvoice);
        setStatementOverrides(data.statementOverrides || {});
        // Reset the statement view for the selected month: show its data if
        // present, otherwise clear last month's so nothing stale lingers.
        if (data.bankTxns) {
          setBankTxns(data.bankTxns);
        } else {
          setBankTxns([]);
        }
        if (data.bankStatementMeta) {
          setBankStatementMeta(data.bankStatementMeta);
          setBankStatementStatus("done");
        } else {
          setBankStatementMeta(null);
          setBankStatementStatus("idle");
        }
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

  const handleBankStatementUpload = async (file) => {
    setBankStatementStatus("parsing");
    setBankStatementError(null);
    try {
      const parsed = await parseBankStatementPdf(file);
      setBankTxns(parsed);
      setBankStatementMeta({ fileName: file.name, parsedAt: new Date().toLocaleString("en-ZA"), count: parsed.length });
      try {
        await saveBankStatementToDb(file.name, parsed);
        setBankStatementStatus("done");
      } catch (persistErr) {
        console.error("Statement parsed but saving to the database failed:", persistErr);
        setBankStatementError("Parsed OK, but saving to the database failed — see browser console. The transactions below are NOT persisted.");
        setBankStatementStatus("error");
      }
    } catch (err) {
      console.error("Bank statement parsing failed:", err);
      setBankStatementError("Couldn't parse this PDF: " + (err.message || "Unknown error"));
      setBankStatementStatus("error");
    }
  };

  // Saves (or clears) the manual utility-line overrides for a unit's statement
  // in the selected period. `patch` carries the full desired state: waterDue /
  // electricityDue are numbers to override or null to fall back to computed.
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
    commonPropertyElectricityKwh, unitsSource, readings, councilInvoice, statementOverrides
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

  return (
    <div className="f-body" style={{ minHeight: "100vh", background: "#EFEAE0", color: "#1B2A38" }}>
      {FONT_IMPORT}
      <TopBar role={role} setRole={setRole} setTab={setTab} unitsSource={unitsSource} onSignOut={signOutOfApp} period={selectedPeriod} />
      {role === "trustee" ? (
        <div style={{ display: "flex" }}>
          <SideNav tab={tab} setTab={setTab} />
          <main style={{ flex: 1, padding: "28px 32px", maxWidth: 1100 }}>
            <PeriodBar periods={periods} selectedPeriod={selectedPeriod} setSelectedPeriod={setSelectedPeriod} />
            {tab === "dashboard" && <Dashboard alloc={alloc} setTab={setTab} setSelectedUnit={setSelectedUnit} bankTxns={bankTxns} period={selectedPeriod} remittanceDeductions={remittanceDeductions} manualPayments={manualPayments} />}
            {tab === "readings" && <Readings readings={readings} setReadings={setReadings} period={selectedPeriod} />}
            {tab === "allocation" && (
              <>
                <UtilityBills councilInvoice={councilInvoice} setCouncilInvoice={setCouncilInvoice} alloc={alloc} period={selectedPeriod} />
                <Allocation alloc={alloc} />
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
                onUploadStatement={handleBankStatementUpload}
                statementMeta={bankStatementMeta}
                statementStatus={bankStatementStatus}
                statementError={bankStatementError}
              />
            )}
            {tab === "statement-preview" && (
              <StatementPreview alloc={alloc} period={selectedPeriod} selectedUnit={selectedUnit} setSelectedUnit={setSelectedUnit} onSaveOverride={saveStatementOverride} />
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
              />
            )}
            {tab === "rate-history" && <RateHistory />}
            {tab === "levy-setup" && (
              <LevySetup
                levyBreakdown={levyBreakdown} setLevyBreakdown={setLevyBreakdown}
                waterBands={waterBands} electricityRate={electricityRate} vatRate={vatRate}
                commonPropertyElectricityKwh={commonPropertyElectricityKwh}
                councilInvoice={councilInvoice}
              />
            )}
            {tab === "additional-charges" && (
              <AdditionalCharges additionalCharges={additionalCharges} setAdditionalCharges={setAdditionalCharges} />
            )}
            {tab === "ops-expenses" && (
              <OpsExpenses opsExpenses={opsExpenses} setOpsExpenses={setOpsExpenses} period={selectedPeriod} />
            )}
            {tab === "analytics" && <Analytics expenseCategories={expenseCategories} />}
            {tab === "config" && (
              <Config expenseCategories={expenseCategories} setExpenseCategories={setExpenseCategories} />
            )}
          </main>
        </div>
      ) : (
        <ResidentPortal
          alloc={alloc} period={selectedPeriod} selectedUnit={selectedUnit} setSelectedUnit={setSelectedUnit}
          remittanceDeductions={remittanceDeductions} setRemittanceDeductions={setRemittanceDeductions}
          setRemittanceAdvices={setRemittanceAdvices}
        />
      )}
    </div>
  );
}

function TopBar({ role, setRole, setTab, unitsSource, onSignOut, period }) {
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
            Body Corporate · 7 Units · {periodLabel(period)}
          </div>
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <span style={{ background: sourceBadge.bg, color: sourceBadge.color, fontSize: 10.5, fontWeight: 700, padding: "4px 10px", borderRadius: 20, letterSpacing: 0.4, whiteSpace: "nowrap" }}>
          {sourceBadge.label}
        </span>
      <div style={{ display: "flex", background: "#24374A", borderRadius: 8, padding: 4 }}>
        {["trustee", "resident"].map((r) => (
          <button
            key={r}
            onClick={() => { setRole(r); setTab("dashboard"); }}
            style={{
              padding: "7px 16px",
              borderRadius: 6,
              border: "none",
              fontSize: 13,
              fontWeight: 600,
              cursor: "pointer",
              background: role === r ? "#F6F1E7" : "transparent",
              color: role === r ? "#1B2A38" : "#B9C4CE",
            }}
          >
            {r === "trustee" ? "Trustee view" : "Resident view"}
          </button>
        ))}
      </div>
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

function SideNav({ tab, setTab }) {
  const items = [
    ["dashboard", "Dashboard"],
    ["readings", "Meter readings"],
    ["levy-setup", "Levy breakdown (AGM)"],
    ["additional-charges", "Additional charges"],
    ["ops-expenses", "Body corp expenses"],
    ["allocation", "Invoice allocation"],
    ["reconciliation", "Bank reconciliation"],
    ["statement-preview", "Statement preview"],
    ["analytics", "Financial dashboard"],
    ["tariffs", "Tariffs & rates"],
    ["rate-history", "Rate history"],
    ["config", "Config"],
  ];
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
  // Same reconciliation source of truth as the Bank reconciliation page, so the
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
  const toDraft = (rs) => Object.fromEntries(UNITS.map((u) => {
    const r = rs[u.id] || { wCurr: 0, eCurr: 0 };
    return [u.id, { wCurr: String(r.wCurr), eCurr: String(r.eCurr) }];
  }));
  const [draft, setDraft] = useState(() => toDraft(readings));
  const [status, setStatus] = useState("idle"); // idle | saving | saved | error
  useEffect(() => { setDraft(toDraft(readings)); }, [readings]);

  const updateDraft = (uid, field, value) =>
    setDraft((prev) => ({ ...prev, [uid]: { ...prev[uid], [field]: value } }));
  const draftNum = (uid, field) => parseFloat(draft[uid]?.[field]) || 0;

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
        <table style={{ width: "100%", fontSize: 13.5, borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ color: "#64748B", textAlign: "right", fontSize: 11, textTransform: "uppercase" }}>
              <th style={{ padding: "6px 8px", textAlign: "left" }}>Unit</th>
              <th style={{ padding: "6px 8px" }}>Water prev (kL)</th>
              <th style={{ padding: "6px 8px" }}>Water curr (kL)</th>
              <th style={{ padding: "6px 8px", color: "#2F5D50" }}>Usage</th>
              <th style={{ padding: "6px 8px" }}>Elec prev (kWh)</th>
              <th style={{ padding: "6px 8px" }}>Elec curr (kWh)</th>
              <th style={{ padding: "6px 8px", color: "#2F5D50" }}>Usage</th>
            </tr>
          </thead>
          <tbody>
            {UNITS.map((u) => {
              const r = readings[u.id] || { wPrev: 0, wCurr: 0, ePrev: 0, eCurr: 0 };
              return (
                <tr key={u.id} style={{ borderTop: "1px solid #EEE7D6" }} className="f-mono">
                  <td style={{ padding: "8px", textAlign: "left", fontWeight: 600 }}>{u.id}</td>
                  <td style={{ padding: "8px", textAlign: "right", color: "#94A0AC" }}>{r.wPrev}</td>
                  <td style={{ padding: "4px" }}>
                    <input value={draft[u.id]?.wCurr ?? ""} onChange={(e) => updateDraft(u.id, "wCurr", e.target.value)} style={inputStyle} />
                  </td>
                  <td style={{ padding: "8px", textAlign: "right", color: "#2F5D50", fontWeight: 600 }}>{round2(draftNum(u.id, "wCurr") - r.wPrev).toFixed(2)}</td>
                  <td style={{ padding: "8px", textAlign: "right", color: "#94A0AC" }}>{r.ePrev}</td>
                  <td style={{ padding: "4px" }}>
                    <input value={draft[u.id]?.eCurr ?? ""} onChange={(e) => updateDraft(u.id, "eCurr", e.target.value)} style={inputStyle} />
                  </td>
                  <td style={{ padding: "8px", textAlign: "right", color: "#2F5D50", fontWeight: 600 }}>{round2(draftNum(u.id, "eCurr") - r.ePrev).toFixed(2)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div style={{ marginTop: 16, display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 10 }}>
          {status === "saved" && <span style={{ fontSize: 12.5, color: "#2F5D50", fontWeight: 600 }}>✓ Saved to database</span>}
          {status === "error" && <span style={{ fontSize: 12.5, color: "#B5651D", fontWeight: 600 }}>Couldn't save — see browser console</span>}
          <button style={primaryBtn} onClick={save} disabled={status === "saving"}>
            {status === "saving" ? "Saving…" : "Save readings"}
          </button>
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

// ---------- Utility bills (feeds the levy suggestions & provision check) ----------
function UtilityBills({ councilInvoice, setCouncilInvoice, alloc, period = CURRENT_PERIOD }) {
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
  const waterDiff = round2(COMMON_PROPERTY_WATER_KL - waterGap);
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
        <br />Water — {verdict(waterDiff, "kL", COMMON_PROPERTY_WATER_KL, waterGap)}
        <br />Electricity — {verdict(elecDiff, "kWh", alloc.commonPropertyElectricityKwh, elecGap)}
      </div>
    </Card>
  );
}

// ---------- Allocation ----------
function Allocation({ alloc }) {
  const ci = alloc.councilInvoice;
  return (
    <>
      <h1 className="f-display" style={{ fontSize: 24, marginBottom: 4 }}>Council invoice allocation</h1>
      <p style={{ color: "#64748B", fontSize: 13.5, marginBottom: 18 }}>
        Water and electricity are billed per unit on actual consumption, plus VAT. Sewerage and common-area water/electricity are covered by the AGM levy breakdown, not billed again here. Refuse and the basic municipal charge are no longer billed to units at all.
      </p>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(2,1fr)", gap: 14, marginBottom: 20 }}>
        <Card>
          <div style={{ fontSize: 11, color: "#64748B", textTransform: "uppercase", marginBottom: 6 }}>Bulk water (council invoice)</div>
          <div className="f-mono" style={{ fontSize: 17, fontWeight: 600 }}>{rand(ci.bulkWaterRand)}</div>
          <div style={{ fontSize: 12, color: "#94A0AC", marginTop: 4 }}>{ci.bulkWaterKl} kL · metered sum {alloc.totalW.toFixed(2)} kL · common {alloc.commonWater.toFixed(2)} kL</div>
          <div style={{ fontSize: 11.5, marginTop: 6, color: "#64748B" }}>
            Actual metered common-area gap valued at {rand(alloc.commonWaterCostTotal)}, vs. the suggested "Common Property Water" figure from the fixed {COMMON_PROPERTY_WATER_KL}kL standard: {rand(alloc.commonPropertyWaterCost)} total ({rand(alloc.commonPropertyWaterPerUnit)}/unit) — a reference for the manual levy grid, not billed automatically.
          </div>
        </Card>
        <Card>
          <div style={{ fontSize: 11, color: "#64748B", textTransform: "uppercase", marginBottom: 6 }}>Bulk electricity (council invoice)</div>
          <div className="f-mono" style={{ fontSize: 17, fontWeight: 600 }}>{rand(ci.bulkElecRand)}</div>
          <div style={{ fontSize: 12, color: "#94A0AC", marginTop: 4 }}>{ci.bulkElecKwh} kWh · metered sum {alloc.totalE.toFixed(2)} kWh · common {alloc.commonElec.toFixed(2)} kWh</div>
          <div style={{ fontSize: 11.5, marginTop: 6, color: "#64748B" }}>
            Actual metered common-area gap valued at {rand(alloc.commonElecCostTotal)}, vs. the suggested "Common Property Electricity" figure from the configurable {alloc.commonPropertyElectricityKwh}kWh standard: {rand(alloc.commonPropertyElecCost)} total ({rand(alloc.commonPropertyElecPerUnit)}/unit) — a reference for the manual levy grid, not billed automatically.
          </div>
        </Card>
      </div>
      <p style={{ color: "#64748B", fontSize: 12, marginTop: -8, marginBottom: 18 }}>
        Water and electricity are charged to units using the tariff bands under <b>Tariffs &amp; rates</b>, not a proportional split of the invoice — so the invoice totals above won't match the billed totals exactly. That's expected, not an error to chase down. Units using more than 6kL get the municipal free first-6kL allowance; units at or under 6kL are billed every kL at the first paid rate instead (a minimum charge, so low usage never bills R0.00). Common property water always uses the real, unmodified scale. Refuse ({rand(ci.refuse)}) and the basic municipal charge ({rand(ci.fixedBasic)}) are on the council invoice but not recovered from any unit — confirm that's intentional.
      </p>

      <Card>
        <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", fontSize: 12.5, borderCollapse: "collapse", minWidth: 780 }}>
          <thead>
            <tr style={{ color: "#64748B", textAlign: "right", fontSize: 10.5, textTransform: "uppercase" }}>
              <th style={{ padding: "6px 6px", textAlign: "left" }}>Unit</th>
              <th style={{ padding: "6px 6px" }}>Electricity</th>
              <th style={{ padding: "6px 6px" }}>Water</th>
              <th style={{ padding: "6px 6px" }}>Sub-Total</th>
              <th style={{ padding: "6px 6px" }}>VAT</th>
              <th style={{ padding: "6px 6px" }}>Utilities due</th>
              <th style={{ padding: "6px 6px" }}>Levy</th>
              <th style={{ padding: "6px 6px" }}>Additional</th>
              <th style={{ padding: "6px 6px", color: "#1B2A38" }}>Total due</th>
            </tr>
          </thead>
          <tbody>
            {alloc.rows.map((r) => (
              <tr key={r.id} style={{ borderTop: "1px solid #EEE7D6" }} className="f-mono">
                <td style={{ padding: "8px 6px", textAlign: "left", fontWeight: 600 }}>{r.id}</td>
                <td style={{ padding: "8px 6px", textAlign: "right" }}>{rand(r.elecCost)}</td>
                <td style={{ padding: "8px 6px", textAlign: "right" }}>{rand(r.waterCost)}</td>
                <td style={{ padding: "8px 6px", textAlign: "right" }}>{rand(r.subTotal)}</td>
                <td style={{ padding: "8px 6px", textAlign: "right" }}>{rand(r.vat)}</td>
                <td style={{ padding: "8px 6px", textAlign: "right" }}>{rand(r.utilitiesDue)}</td>
                <td style={{ padding: "8px 6px", textAlign: "right" }}>{rand(r.levy)}</td>
                <td style={{ padding: "8px 6px", textAlign: "right", color: r.additionalTotal ? "#B5651D" : "#94A0AC" }}>{rand(r.additionalTotal)}</td>
                <td style={{ padding: "8px 6px", textAlign: "right", fontWeight: 700 }}>{rand(r.total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
        <div style={{ marginTop: 16, display: "flex", justifyContent: "flex-end", gap: 10 }}>
          <button style={primaryBtn}>Confirm allocation & generate statements</button>
        </div>
      </Card>
    </>
  );
}

// ---------- Levy breakdown setup (set annually at the AGM) ----------
function LevySetup({ levyBreakdown, setLevyBreakdown, waterBands, electricityRate, vatRate, commonPropertyElectricityKwh, councilInvoice }) {
  // VAT-inclusive suggested values from the confirmed rules (bill figures +
  // rates). They pre-fill via the button below but every cell stays editable.
  const suggestions = computeSuggestedLevyItems({ waterBands, electricityRate, vatRate, commonPropertyElectricityKwh, councilInvoice });
  const fillCalculated = () => {
    setLevyBreakdown((prev) => {
      const next = {};
      UNITS.forEach((u) => {
        next[u.id] = { ...prev[u.id] };
        LEVY_ITEMS.forEach((item) => {
          const s = suggestions[item];
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
      setTimeout(() => setSaveStatus("idle"), 2500);
    } catch (err) {
      console.error("Saving levy breakdown failed:", err);
      setSaveStatus("error");
    }
  };

  return (
    <>
      <h1 className="f-display" style={{ fontSize: 24, marginBottom: 4 }}>Levy breakdown — set annually at the AGM</h1>
      <p style={{ color: "#64748B", fontSize: 13.5, marginBottom: 14 }}>
        Each unit's monthly levy is the sum of these line items. Every cell is editable and defaults to 0.00 — enter the figures agreed at the AGM once a year; they carry forward every month until changed again. Statements bill exactly what's in this grid.
      </p>

      <Card style={{ marginBottom: 16, background: "#F4F1E9" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
          <div style={{ fontSize: 12, color: "#64748B", lineHeight: 1.7, flex: 1, minWidth: 320 }}>
            <b>Calculated per-unit values (VAT incl.)</b> from the utility bills and Tariffs &amp; rates:{" "}
            <span className="f-mono">
              {LEVY_ITEMS.filter((i) => suggestions[i] !== null).map((i) => `${i} ${rand(suggestions[i])}`).join(" · ")}
            </span>
            <br />Insurance stays manual — individualised per unit per year.
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
              </tr>
            </tfoot>
          </table>
        </div>
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
        <strong>Log only expenses that never went through the bank account</strong> — anything on a bank statement is captured (and tagged) on the Bank reconciliation page, and anything a resident paid personally is captured on their deduction claim. Rows that duplicate either are greyed out below and excluded from every total.
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
function RateSettings({
  waterBands, waterBandHistory, onSaved,
  electricityRate, setElectricityRate,
  electricityEffectiveFrom, setElectricityEffectiveFrom,
  vatRate, setVatRate,
  commonPropertyElectricityKwh, setCommonPropertyElectricityKwh,
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
  const TODAY_ISO = new Date().toISOString().slice(0, 10);
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
    setEdits((prev) => ({ ...prev, [date]: { ...prev[date], [label]: parseFloat(value) || 0 } }));
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

  const [saveStatus, setSaveStatus] = useState("idle"); // idle | saving | saved | error
  const save = async () => {
    setSaveStatus("saving");
    try {
      // Only push sets that were actually touched — never rewrite history.
      const waterSets = columns
        .filter((c) => c.editable && isUnsaved(c.date))
        .map((c) => ({
          effectiveFrom: c.date,
          bands: bandDefs.map((b) => ({ label: b.label, from: b.from, to: b.to, rate: rateFor(c.date, b.label) })),
        }));
      await saveTariffsToDb({ waterSets, electricityRate, electricityEffectiveFrom, vatRate, commonPropertyElectricityKwh });
      setEdits({});
      setAddedDates([]);
      setSaveStatus("saved");
      if (onSaved) onSaved(); // reload so every screen sees the new set
      setTimeout(() => setSaveStatus("idle"), 2500);
    } catch (err) {
      console.error("Saving tariffs failed:", err);
      setSaveStatus("error");
    }
  };

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
                            type="number" step="0.01" value={rateFor(c.date, b.label)}
                            onChange={(e) => setRate(c.date, b.label, e.target.value)}
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
                        <td key={c.date} className="f-mono" style={{ ...rateCellStyle, color: "#64748B" }}>
                          {rateFor(c.date, b.label) ? rateFor(c.date, b.label).toFixed(2) : "—"}
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
      </Card>

      <Card style={{ marginTop: 16 }}>
        <div style={{ fontWeight: 700, fontSize: 13.5, marginBottom: 4 }}>Electricity — flat rate</div>
        <p style={{ fontSize: 12, color: "#94A0AC", marginBottom: 12 }}>
          Single rate applied to every kWh of metered and common-area electricity usage.
        </p>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: "#64748B" }}>Effective from</span>
          <input
            type="date" value={electricityEffectiveFrom || ""}
            onChange={(e) => setElectricityEffectiveFrom(e.target.value)}
            style={{ ...inputStyle, width: 160, textAlign: "left", borderColor: "#2F5D50", fontWeight: 700 }}
          />
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 13.5 }} className="f-mono">R</span>
          <input
            type="number" step="0.0001" value={electricityRate}
            onChange={(e) => setElectricityRate(parseFloat(e.target.value) || 0)}
            style={{ ...inputStyle, width: 120, borderColor: "#2F5D50", fontWeight: 700 }}
          />
          <span style={{ fontSize: 13.5, color: "#64748B" }}>per kWh</span>
        </div>
      </Card>

      <Card style={{ marginTop: 16 }}>
        <div style={{ fontWeight: 700, fontSize: 13.5, marginBottom: 4 }}>VAT on water & electricity</div>
        <p style={{ fontSize: 12, color: "#94A0AC", marginBottom: 12 }}>
          Applied to metered water and electricity charges only — shown as its own line on every statement, not absorbed into the rate.
        </p>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <input
            type="number" step="0.01" value={vatRate * 100}
            onChange={(e) => setVatRate((parseFloat(e.target.value) || 0) / 100)}
            style={{ ...inputStyle, width: 100, borderColor: "#2F5D50", fontWeight: 700 }}
          />
          <span style={{ fontSize: 13.5, color: "#64748B" }}>% (currently {(vatRate * 100).toFixed(2)}%)</span>
        </div>
      </Card>

      <Card style={{ marginTop: 16 }}>
        <div style={{ fontWeight: 700, fontSize: 13.5, marginBottom: 4 }}>Common property standards</div>
        <p style={{ fontSize: 12, color: "#94A0AC", marginBottom: 12 }}>
          Water Demand Levy, Sewerage, and the Electricity Service/Network charges now come from the uploaded utility bills — see <b>Invoice allocation</b>. Only the common-property standards live here; they drive the calculated values on the Levy breakdown page.
        </p>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 13, width: 220 }}>Common Property Water standard</span>
            <span className="f-mono" style={{ fontSize: 13, fontWeight: 700 }}>{COMMON_PROPERTY_WATER_KL} kL</span>
            <span style={{ fontSize: 11.5, color: "#94A0AC" }}>fixed, not configurable — billed on the real tariff scale above, split 7 ways</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 13, width: 220 }}>Common Property Electricity standard</span>
            <input
              type="number" step="1" value={commonPropertyElectricityKwh}
              onChange={(e) => setCommonPropertyElectricityKwh(parseFloat(e.target.value) || 0)}
              style={{ ...inputStyle, width: 110, borderColor: "#2F5D50", fontWeight: 700 }}
            />
            <span style={{ fontSize: 11.5, color: "#94A0AC" }}>kWh / month, billed at the flat rate above, split 7 ways</span>
          </div>
          <div style={{ fontSize: 12, color: "#64748B" }} className="f-mono">
            Common Property Water: {rand(calcWaterCost(COMMON_PROPERTY_WATER_KL, currentBandsForCalc))} total · {rand(calcWaterCost(COMMON_PROPERTY_WATER_KL, currentBandsForCalc) / UNITS.length)} per unit
            <br />
            Common Property Electricity: {rand(commonPropertyElectricityKwh * electricityRate)} total · {rand((commonPropertyElectricityKwh * electricityRate) / UNITS.length)} per unit
          </div>
        </div>
      </Card>

      <div style={{ marginTop: 16, display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 10 }}>
        {dirty && saveStatus === "idle" && <span style={{ fontSize: 12.5, color: "#B5651D", fontWeight: 600 }}>Unsaved water rate changes</span>}
        {saveStatus === "saved" && <span style={{ fontSize: 12.5, color: "#2F5D50", fontWeight: 600 }}>✓ Saved to database</span>}
        {saveStatus === "error" && <span style={{ fontSize: 12.5, color: "#B5651D", fontWeight: 600 }}>Couldn't save — see browser console</span>}
        <button style={primaryBtn} onClick={save} disabled={saveStatus === "saving"}>
          {saveStatus === "saving" ? "Saving…" : "Save tariffs & rates"}
        </button>
      </div>
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
    "Owner Contributions": blank(),
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
        add(income["Owner Contributions"], ymOf(settles), amount);
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
    if (income["Owner Contributions"][ym] === undefined) return;
    provisionalTotal += amount;
    provisionalDetail.push({ unit: unitNumbers[m.unit_id] || null, ym, amount });
    add(income["Owner Contributions"], ym, amount);
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
      add(income["Owner Contributions"], ym, amount);
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
    note("Owner Contributions",
      `Includes ${rand(deductionTotal)} of levies settled by approved deductions — Body Corp expenses residents paid personally. The matching amounts appear under expenditure, so the surplus is not overstated.`);
  }
  if (provisionalTotal > 0) {
    const byUnit = provisionalDetail
      .map((d) => `${d.unit ? `Unit ${d.unit}` : "an unidentified unit"} ${rand(d.amount)} (${monthName(d.ym)})`)
      .join(", ");
    note("Owner Contributions",
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
      `Expenditure with no category assigned yet. Tag the relevant debits on the Bank reconciliation page — and any untagged deduction claims below them — to move this onto the right lines.`);
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
    (async () => {
      try {
        const { from, to } = fyBounds(fy);
        // Resident payments are bucketed by the statement month they settle,
        // which can be up to two months before the bank month (the trustee can
        // retarget that far back). So the bank fetch is widened by three months
        // either side; buildFinancialYearReport drops anything that ends up
        // outside the financial year once bucketed.
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
        if (!alive) return;
        // The FY's last statement month (July) is collected on the following
        // month's bank statement. Until that statement is imported, July shows
        // almost no contributions and the surplus reads as a false deficit —
        // so the report says so rather than let the number be misread.
        const chaserMonth = ymOf(nextPeriod(`${to.slice(0, 4)}-07-01`));
        setReport(buildFinancialYearReport({
          fy,
          txns: txns.data || [], ops: ops.data || [],
          remits: remits.data || [], charges: charges.data || [],
          manualPays: manualPays.data || [],
          categories: expenseCategories,
          unitNumbers: Object.fromEntries((unitRows.data || []).map((u) => [u.id, u.unit_number])),
          chaserImported: (txns.data || []).some((t) => ymOf(t.txn_date) === chaserMonth),
          chaserMonth,
        }));
        setStatus("ready");
      } catch (err) {
        console.error("Building the financial dashboard failed:", err);
        if (alive) { setStatus("error"); setError("Couldn't build the dashboard — see browser console."); }
      }
    })();
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
          <button onClick={() => window.print()} style={{ ...primaryBtn, padding: "7px 14px" }}>Print / PDF</button>
        </div>
      </div>
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
        </div>
      )}
    </>
  );
}

// ---------- Config: expense categories ----------
// The single vocabulary behind every tagging dropdown and every line on the
// analytics dashboard. Renaming goes through the rename_expense_category RPC so
// the change cascades to bank transactions, ops expenses, additional charges and
// resident deduction claims in one transaction — a plain UPDATE here would leave
// historic records pointing at a name that no longer exists.
function Config({ expenseCategories, setExpenseCategories }) {
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
    </>
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
  onReviewTxn, onTagTxn, onUploadStatement, statementMeta, statementStatus, statementError,
}) {
  const categoryNames = useExpenseCategoryNames();
  const fileInputRef = useRef(null);

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
      <h1 className="f-display" style={{ fontSize: 24, marginBottom: 4 }}>Bank reconciliation — {periodLabel(period)} statements</h1>
      <p style={{ color: "#64748B", fontSize: 13.5, marginBottom: 18 }}>
        {periodLabel(period)} levies are paid the following month, so these statements are matched against the <strong>{periodLabel(nextPeriod(period))} bank statement</strong>, by payment reference (Cor/Unit + number) against submitted remittance advices. Approved Body Corp expense deductions reduce the expected payment before comparing. Any "needs review" line or variance can be noted and marked resolved below.
      </p>

      <Card style={{ marginBottom: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/pdf"
            style={{ display: "none" }}
            onChange={(e) => { const f = e.target.files[0]; if (f) onUploadStatement(f); e.target.value = ""; }}
          />
          <button style={primaryBtn} onClick={() => fileInputRef.current && fileInputRef.current.click()} disabled={statementStatus === "parsing"}>
            {statementStatus === "parsing" ? "Parsing…" : "Upload bank statement PDF"}
          </button>
          <div style={{ fontSize: 12.5, color: "#64748B" }}>
            {statementStatus === "idle" && `Upload the ${periodLabel(nextPeriod(period))} bank statement (where ${periodLabel(period)}'s levies are paid).`}
            {statementStatus === "parsing" && "Extracting and classifying transactions…"}
            {statementStatus === "done" && statementMeta && (
              <span style={{ color: "#2F5D50", fontWeight: 600 }}>
                ✓ {statementMeta.count} transactions parsed from "{statementMeta.fileName}" ({statementMeta.parsedAt})
              </span>
            )}
            {statementStatus === "error" && (
              <span style={{ color: "#B5651D", fontWeight: 600 }}>{statementError}</span>
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
function StatementPreview({ alloc, period, selectedUnit, setSelectedUnit, onSaveOverride }) {
  const r = alloc.rows.find((x) => x.id === selectedUnit);
  return (
    <>
      <div className="no-print" style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 16 }}>
        <h1 className="f-display" style={{ fontSize: 24 }}>Statement preview — {periodLabel(period)}</h1>
        <select value={selectedUnit} onChange={(e) => setSelectedUnit(e.target.value)} style={{ padding: "6px 10px", borderRadius: 6, border: "1px solid #D8D0BE" }}>
          {UNITS.map((u) => <option key={u.id} value={u.id}>{u.id} — {u.owner}</option>)}
        </select>
      </div>
      <StatementPaper r={r} period={period} />
      <div className="no-print" style={{ marginTop: 16, display: "flex", gap: 10 }}>
        <button style={primaryBtn}>Send to {r.owner}</button>
        <button style={secondaryBtn} onClick={printStatement}>Download PDF</button>
      </div>
      {onSaveOverride && <StatementAdjustments r={r} period={period} onSaveOverride={onSaveOverride} />}
    </>
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
            {LEVY_ITEMS.map((item) => (
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
