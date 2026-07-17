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

    /* ---------- Responsive: resident-facing pages ---------- */
    /* Wide statement tables scroll inside their box instead of pushing the
       whole page sideways. */
    .scroll-x { overflow-x: auto; -webkit-overflow-scrolling: touch; }

    /* Reconciled "PAID" stamp — the ::before draws the inner hairline for a
       classic double-ruled rubber-stamp border. */
    .paid-stamp .stamp-box { position: relative; }
    .paid-stamp .stamp-box::before {
      content: ""; position: absolute; inset: 3px;
      border: 1.5px solid #2F5D50; border-radius: 6px;
    }

    @media (max-width: 640px) {
      .resident-scope .resident-main { padding: 16px 12px 40px !important; }
      .resident-scope .statement-paper { padding: 18px 14px !important; }

      /* Header and input rows stack rather than overflow. */
      .resident-scope .wrap-sm { flex-wrap: wrap; }

      /* 16px inputs stop iOS Safari from auto-zooming on focus. */
      .resident-scope input,
      .resident-scope select,
      .resident-scope textarea { font-size: 16px !important; }

      /* Period / unit selector spans the row. */
      .resident-scope .resident-main select { width: 100%; }

      /* Banking details collapse to a single column. */
      .resident-scope .bank-grid { grid-template-columns: 1fr !important; }

      /* Primary actions go full-width and meet the 44px touch target. */
      .resident-scope .resident-actions { flex-wrap: wrap; }
      .resident-scope .resident-actions button { flex: 1 1 100% !important; min-height: 44px; }
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
    return deductions.map((d) => ({ amount: Number(d.amount) || 0, comment: d.comment || "", expenseCategory: d.expenseCategory || null }));
  }
  if (Number(fallbackAmount) > 0) {
    return [{ amount: Number(fallbackAmount), comment: fallbackComment || "", expenseCategory: null }];
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

  // Reconciled = the trustee's Bank Reconciliation treats this unit + period as
  // settled: a matched resident payment within tolerance of the expected amount
  // (statement total minus any APPROVED deduction), or one the trustee reviewed.
  // Mirrors reconcileUnits() exactly so the resident's PAID stamp and the
  // trustee page never disagree. `data.payment` is the matched bank line for the
  // payment period (statement month + 1), supplied by the get_unit_statement RPC.
  const pay = data.payment && data.payment.amount != null
    ? { amount: Number(data.payment.amount), reviewed: !!data.payment.reviewed }
    : null;
  let reconciled = false;
  if (pay) {
    const expected = deduction && deduction.approved ? round2(total - deduction.amount) : total;
    const diff = round2(pay.amount - expected);
    reconciled = Math.abs(diff) < RECON_TOLERANCE || pay.reviewed;
  }

  const u = data.unit || {};
  return {
    id: "U" + u.unitNumber, owner: u.owner, pq: Number(u.pq),
    wPrev, wCurr, ePrev, eCurr, wUse, eUse, electricityRate, vatRate,
    waterCost, elecCost, waterCostComputed, elecCostComputed,
    waterOverridden: ov.waterDue != null, elecOverridden: ov.electricityDue != null,
    subTotal, vat, utilitiesDue,
    levy, levyItems, extras, additionalTotal, total,
    deduction, reconciled,
  };
}

// ---------- Database load & save (trustee, authenticated) ----------
// The most recent period, used as the default the app opens on. The trustee can
// switch to any past month via the period selector — see ACTIVE_PERIOD below.
const CURRENT_PERIOD = "2026-06-01";
// The period every data read/write currently targets. It's a module-level
// mutable binding (same pattern as UNITS) so the period-aware DB helpers below
// don't each need it threaded through — App keeps it in sync with the selected
// month and re-runs loadAppData whenever it changes.
let ACTIVE_PERIOD = CURRENT_PERIOD;
const FY_ACTIVE = "2025/2026";   // maps to the app's rate2025 fields
const FY_PREVIOUS = "2024/2025"; // maps to the app's rate2024 fields

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
  const uniq = Array.from(new Set((data || []).map((r) => r.period)));
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
  const [bands, elec, vat, levy, manual, usage, charges, expenses, invoice, btxns, bdocs, remits, overrides] = await Promise.all([
    client.from("water_tariff_bands").select("*"),
    client.from("electricity_rates").select("*").eq("financial_year", FY_ACTIVE).limit(1),
    client.from("vat_rates").select("*").order("effective_from", { ascending: false }).limit(1),
    client.from("levy_rates").select("*").eq("financial_year", FY_ACTIVE).limit(1),
    client.from("levy_manual_entries").select("*").eq("financial_year", FY_ACTIVE),
    client.from("monthly_usage").select("*").eq("period", period),
    client.from("additional_charges").select("*").eq("period", period),
    client.from("ops_expenses").select("*").order("expense_date", { ascending: false }),
    client.from("council_invoices").select("*").eq("period", period).limit(1),
    client.from("bank_transactions").select("*").eq("period", paymentPeriod).order("txn_date"),
    client.from("bank_statement_documents").select("*").eq("period", paymentPeriod).order("uploaded_at", { ascending: false }).limit(1),
    client.from("remittance_advices").select("*").eq("period", period),
    client.from("statement_overrides").select("*").eq("period", period),
  ]);
  const failed = [bands, elec, vat, levy, manual, usage, charges, expenses, invoice, btxns, bdocs, remits, overrides].find((r) => r.error);
  if (failed) throw failed.error;

  // Water bands: the DB stores one row per band per financial year; the app
  // wants one object per band with both years' rates side by side.
  const byLabel = {};
  bands.data.forEach((b) => {
    if (!byLabel[b.band_label]) {
      byLabel[b.band_label] = {
        id: b.band_label, label: b.band_label,
        from: Number(b.from_kl), to: b.to_kl == null ? null : Number(b.to_kl),
        rate2024: 0, rate2025: 0,
      };
    }
    if (b.financial_year === FY_ACTIVE) byLabel[b.band_label].rate2025 = Number(b.rate_per_kl);
    if (b.financial_year === FY_PREVIOUS) byLabel[b.band_label].rate2024 = Number(b.rate_per_kl);
  });
  const waterBands = Object.values(byLabel).sort((a, b) => a.from - b.from);

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

  const readings = {};
  usage.data.forEach((m) => {
    const uid = unitByDbId[m.unit_id];
    if (!uid) return;
    readings[uid] = {
      wPrev: Number(m.water_previous), wCurr: Number(m.water_current),
      ePrev: Number(m.electricity_previous), eCurr: Number(m.electricity_current),
      dbId: m.id,
    };
  });

  const additionalCharges = Object.fromEntries(units.map((u) => [u.id, []]));
  charges.data.forEach((c) => {
    const uid = unitByDbId[c.unit_id];
    if (uid) additionalCharges[uid].push({ id: c.id, description: c.description, amount: Number(c.amount) });
  });

  const opsExpenses = expenses.data.map((e) => ({
    id: e.id, date: e.expense_date, category: e.category, amount: Number(e.amount), notes: e.notes || "",
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
        expenseCategory: t.expense_category || null,
        cojWater: t.coj_water_amount == null ? null : Number(t.coj_water_amount),
        cojElec: t.coj_elec_amount == null ? null : Number(t.coj_elec_amount),
      }))
    : null;
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
    remittanceDeductions,
    remittanceAdvices,
    statementOverrides,
    waterBands: waterBands.length ? waterBands : WATER_BANDS_DEFAULT,
    electricityRate: elec.data[0] ? Number(elec.data[0].rate_per_kwh) : ELECTRICITY_RATE_DEFAULT,
    vatRate: vat.data[0] ? Number(vat.data[0].rate) : VAT_RATE_DEFAULT,
    levyRates: levy.data[0]
      ? {
          commonPropertyElectricityKwh: Number(levy.data[0].common_property_electricity_kwh),
          commonPropertyWaterKl: levy.data[0].common_property_water_kl != null ? Number(levy.data[0].common_property_water_kl) : COMMON_PROPERTY_WATER_KL,
        }
      : null,
    levyBreakdown,
    readings: Object.keys(readings).length ? readings : READINGS,
    additionalCharges,
    opsExpenses,
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

async function saveTariffsToDb({ waterBands, electricityRate, vatRate, commonPropertyElectricityKwh, commonPropertyWaterKl }) {
  const client = await ensureSupabaseClient();
  const updates = [];
  waterBands.forEach((b) => {
    updates.push(client.from("water_tariff_bands").update({ rate_per_kl: b.rate2025 }).eq("financial_year", FY_ACTIVE).eq("band_label", b.label));
    updates.push(client.from("water_tariff_bands").update({ rate_per_kl: b.rate2024 }).eq("financial_year", FY_PREVIOUS).eq("band_label", b.label));
  });
  updates.push(client.from("electricity_rates").update({ rate_per_kwh: electricityRate }).eq("financial_year", FY_ACTIVE));
  updates.push(client.from("vat_rates").update({ rate: vatRate }).gte("effective_from", "1900-01-01"));
  // The bill-driven figures (water demand levy, sewer, service/network fees)
  // now live on council_invoices, captured from the uploaded utility bills —
  // levy_rates only carries the common-property electricity standard.
  updates.push(client.from("levy_rates").update({
    common_property_electricity_kwh: commonPropertyElectricityKwh,
    common_property_water_kl: commonPropertyWaterKl,
  }).eq("financial_year", FY_ACTIVE));
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
function computeSuggestedLevyItems({ waterBands, electricityRate, vatRate, commonPropertyElectricityKwh, commonPropertyWaterKl = COMMON_PROPERTY_WATER_KL, councilInvoice }) {
  const withVat = (n) => n * (1 + vatRate);
  return {
    "Insurance": null,
    "Blockwatch": 0,
    "Garden Service": 0,
    "Common Property Water": withVat(calcWaterCost(commonPropertyWaterKl, waterBands)) / UNITS.length,
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
// Unified expense categories. The source of truth is the expense_categories
// table (managed on the "Expense categories" config page); these module-level
// lists are the in-memory copy — seeded with defaults and replaced when the
// table loads (same pattern as UNITS). Every category dropdown AND the annual
// report's expense lines read from them, so adding a category on the config
// page flows through everywhere with no code change.
let EXPENSE_CATEGORIES = [
  "CoJ Water", "CoJ Electricity", "Insurance", "Garden Service", "BlockWatch",
  "Bank Charges", "Maintenance/Miscellaneous", "Repairs & Maintenance",
  "Fire Extinguisher Servicing", "CSOS", "Other",
];
let EXPENSE_LINES = EXPENSE_CATEGORIES;
let OPS_EXPENSE_CATEGORIES = EXPENSE_CATEGORIES;
function applyExpenseCategories(names) {
  if (!names || !names.length) return;
  EXPENSE_CATEGORIES = names;
  EXPENSE_LINES = names;
  OPS_EXPENSE_CATEGORIES = names;
}
async function fetchExpenseCategories() {
  const client = await ensureSupabaseClient();
  const { data, error } = await client.from("expense_categories").select("*").order("sort_order");
  if (error) throw error;
  return data || [];
}
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
function useAllocation(waterBands, electricityRate, levyBreakdown, vatRate, additionalCharges, commonPropertyElectricityKwh, unitsSource, readings, councilInvoice, statementOverrides = {}, commonPropertyWaterKl = COMMON_PROPERTY_WATER_KL) {
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
      commonPropertyElectricityKwh, commonPropertyWaterKl,
      tariffWaterTotal, tariffElecTotal,
      councilInvoice,
    };
  }, [waterBands, electricityRate, levyBreakdown, vatRate, additionalCharges, commonPropertyElectricityKwh, unitsSource, readings, councilInvoice, statementOverrides, commonPropertyWaterKl]);
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

// ---------- Financials: year-to-date P&L + annual report ----------
// The Financials dashboard and the annual report source EVERY income and
// expense line from the bank statement (trustee decision, July 2026). The
// financial year runs 1 August -> 31 July; the annual report is due each
// September. Expense lines that the `category` enum can't distinguish
// (Insurance / BlockWatch / Garden Service / Maintenance, and the CoJ
// water/electricity split) come from the manual `expenseCategory` /
// `cojWater` / `cojElec` tags the trustee sets on the Reconciliation page.

// The seven P&L expense lines the trustee can tag a debit as.

// FY runs 1 Aug -> 31 July. For a start year (2025 => the 2025/26 year),
// returns the inclusive ISO window.
function fyWindow(startYear) {
  return { start: `${startYear}-08-01`, end: `${startYear + 1}-07-31` };
}
// Which FY start-year a date falls in (Aug or later => that calendar year).
function fyStartYearFor(dateStr) {
  const d = new Date(dateStr);
  const y = d.getFullYear();
  return d.getMonth() >= 7 ? y : y - 1;
}

// Aggregates bank transactions into the ten income/expense lines + surplus.
// PURE — no I/O, no React — so it can be reasoned about and unit-tested.
// Untagged debits are surfaced, never silently dropped.
// `deductions` are personal-capacity Body Corp expenses a resident paid out of
// pocket (e.g. Garden Service). They never hit the bank as a debit, so — when
// tagged and approved — they're added to the EXPENSE side only (trustee
// decision, July 2026): the cost is real, but income isn't grossed up, so the
// surplus reflects them as an unreimbursed cost. Each item is { amount,
// expenseCategory, approved }.
function generateAnnualReport(txns, fyStart, deductions = []) {
  const income = { "Owner Contributions": 0, "Interest Earned": 0, "Other Credits": 0 };
  // Expense lines come from the configurable category list; the core lines the
  // auto-tagging relies on are always present even if removed from the table.
  const expense = {};
  for (const l of [...new Set([...EXPENSE_LINES, "CoJ Water", "CoJ Electricity", "Bank Charges"])]) expense[l] = 0;
  const bump = (line, amt) => { if (expense[line] != null) { expense[line] = round2(expense[line] + amt); return true; } return false; };
  const untagged = [];
  let deductionsTotal = 0;

  for (const t of txns) {
    const amt = round2(Math.abs(Number(t.amount) || 0));
    const accrued = round2(Number(t.accruedCharge) || 0);
    if (accrued) bump("Bank Charges", accrued);

    if (t.direction === "credit") {
      if (t.category === "resident_payment") income["Owner Contributions"] = round2(income["Owner Contributions"] + amt);
      else if (t.category === "interest") income["Interest Earned"] = round2(income["Interest Earned"] + amt);
      else income["Other Credits"] = round2(income["Other Credits"] + amt);
      continue;
    }

    // debit
    if (t.category === "bank_charge") { bump("Bank Charges", amt); continue; }
    // Combined CoJ debit split manually into water + electricity.
    if (t.cojWater != null || t.cojElec != null) {
      bump("CoJ Water", Number(t.cojWater) || 0);
      bump("CoJ Electricity", Number(t.cojElec) || 0);
      continue;
    }
    if (t.expenseCategory && expense[t.expenseCategory] != null) {
      bump(t.expenseCategory, amt);
    } else if (t.expenseCategory !== "Other Credit") {
      untagged.push(t);
    }
  }

  // Approved, tagged personal-capacity deductions — added to expenses only.
  for (const d of deductions) {
    if (!d.approved) continue;
    const cat = d.expenseCategory;
    const amt = round2(Math.abs(Number(d.amount) || 0));
    if (cat && expense[cat] != null) {
      expense[cat] = round2(expense[cat] + amt);
      deductionsTotal = round2(deductionsTotal + amt);
    }
  }

  const totalIncome = round2(Object.values(income).reduce((a, b) => a + b, 0));
  const totalExpense = round2(Object.values(expense).reduce((a, b) => a + b, 0));
  return {
    financialYear: `${fyStart}/${(fyStart + 1) % 100}`,
    window: fyWindow(fyStart),
    income, expense, totalIncome, totalExpense,
    surplus: round2(totalIncome - totalExpense),
    untagged,
    untaggedTotal: round2(untagged.reduce((a, t) => a + Math.abs(Number(t.amount) || 0), 0)),
    deductionsTotal,
  };
}

// Report line ordering for the monthly breakdown matrix.
const INCOME_LINES = ["Owner Contributions", "Interest Earned", "Other Credits"];
// EXPENSE_LINES is defined dynamically above (driven by the expense_categories table).

// The 12 months of an Aug–Jul financial year, as { key:'YYYY-MM', label:'Aug' }.
function fyMonths(fyStart) {
  const out = [];
  for (let i = 0; i < 12; i++) {
    const m = (7 + i) % 12;                 // 7 = August (0-based)
    const year = fyStart + (7 + i >= 12 ? 1 : 0);
    out.push({ key: `${year}-${String(m + 1).padStart(2, "0")}`, label: MONTH_NAMES[m].slice(0, 3), year });
  }
  return out;
}

// Same classification as generateAnnualReport, but bucketed per month — every
// income/expense line × 12 months. Approved deductions land in their tagged
// expense line for the month of their statement period.
function buildMonthlyBreakdown(txns, deductions, fyStart) {
  const months = fyMonths(fyStart);
  const idx = Object.fromEntries(months.map((m, i) => [m.key, i]));
  const rows = {};
  [...INCOME_LINES, ...EXPENSE_LINES].forEach((l) => (rows[l] = months.map(() => 0)));
  const add = (line, mkey, amt) => {
    const i = idx[mkey];
    if (i == null || rows[line] == null) return;
    rows[line][i] = round2(rows[line][i] + amt);
  };
  txns.forEach((t) => {
    const mkey = String(t.date).slice(0, 7);
    const amt = round2(Math.abs(Number(t.amount) || 0));
    const accrued = round2(Number(t.accruedCharge) || 0);
    if (accrued) add("Bank Charges", mkey, accrued);
    if (t.direction === "credit") {
      if (t.category === "resident_payment") add("Owner Contributions", mkey, amt);
      else if (t.category === "interest") add("Interest Earned", mkey, amt);
      else add("Other Credits", mkey, amt);
      return;
    }
    if (t.category === "bank_charge") { add("Bank Charges", mkey, amt); return; }
    if (t.cojWater != null || t.cojElec != null) {
      add("CoJ Water", mkey, Number(t.cojWater) || 0);
      add("CoJ Electricity", mkey, Number(t.cojElec) || 0);
      return;
    }
    if (t.expenseCategory && rows[t.expenseCategory]) add(t.expenseCategory, mkey, amt);
  });
  deductions.forEach((d) => {
    if (!d.approved) return;
    if (d.expenseCategory && rows[d.expenseCategory]) add(d.expenseCategory, String(d.period).slice(0, 7), Math.abs(Number(d.amount) || 0));
  });
  const colSum = (lines, i) => round2(lines.reduce((a, l) => a + rows[l][i], 0));
  const incomeByMonth = months.map((_, i) => colSum(INCOME_LINES, i));
  const expenseByMonth = months.map((_, i) => colSum(EXPENSE_LINES, i));
  const surplusByMonth = months.map((_, i) => round2(incomeByMonth[i] - expenseByMonth[i]));
  const lineTotal = (line) => round2(rows[line].reduce((a, b) => a + b, 0));
  return { months, rows, incomeByMonth, expenseByMonth, surplusByMonth, lineTotal };
}

// Loads SheetJS from a CDN once (same pattern as the pdf.js / supabase-js
// loaders) so the annual report can be exported as a real .xlsx with no
// build-step dependency.
let sheetJsLoadPromise = null;
function ensureSheetJsLoaded() {
  if (window.XLSX) return Promise.resolve(window.XLSX);
  if (sheetJsLoadPromise) return sheetJsLoadPromise;
  sheetJsLoadPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js";
    script.onload = () => resolve(window.XLSX);
    script.onerror = () => reject(new Error("Could not load SheetJS"));
    document.head.appendChild(script);
  });
  return sheetJsLoadPromise;
}

// Every bank_transactions row inside the FY window, for the P&L rollup.
// Independent of the monthly period load — the report spans the whole year.
async function fetchYearBankTxns(fyStart) {
  const client = await ensureSupabaseClient();
  const { start, end } = fyWindow(fyStart);
  const { data, error } = await client
    .from("bank_transactions")
    .select("*")
    .gte("txn_date", start)
    .lte("txn_date", end)
    .order("txn_date");
  if (error) throw error;
  return (data || []).map((t) => ({
    dbId: t.id,
    date: t.txn_date, desc: t.description_raw, amount: Number(t.amount),
    direction: t.direction, accruedCharge: Number(t.accrued_bank_charge || 0),
    category: t.category,
    expenseCategory: t.expense_category || null,
    cojWater: t.coj_water_amount == null ? null : Number(t.coj_water_amount),
    cojElec: t.coj_elec_amount == null ? null : Number(t.coj_elec_amount),
  }));
}

// Personal-capacity deduction items inside the FY window, flattened to
// { amount, expenseCategory, approved } for the annual report. Each remittance
// carries a deductions jsonb array; the item's expenseCategory is set by the
// trustee on the Reconciliation page. approved comes from deduction_approved.
async function fetchYearDeductions(fyStart) {
  const client = await ensureSupabaseClient();
  const { start, end } = fyWindow(fyStart);
  const { data, error } = await client
    .from("remittance_advices")
    .select("deductions, deduction_amount, deduction_comment, deduction_approved, period")
    .gte("period", start)
    .lte("period", end);
  if (error) throw error;
  const out = [];
  (data || []).forEach((r) => {
    const approved = !!r.deduction_approved;
    const items = normaliseDeductionItems(r.deductions, r.deduction_amount, r.deduction_comment);
    items.forEach((it) => out.push({
      amount: Number(it.amount) || 0,
      expenseCategory: it.expenseCategory || null,
      approved,
      period: r.period,
      comment: it.comment || "",
    }));
  });
  return out;
}

// Per-month bulk (CoJ) vs combined-resident usage, for the usage charts.
// Bulk figures come from council_invoices; the combined resident total is the
// sum of every unit's metered consumption for that period. Keyed by 'YYYY-MM'.
async function fetchYearUsage(fyStart) {
  const client = await ensureSupabaseClient();
  const { start, end } = fyWindow(fyStart);
  const [ci, mu] = await Promise.all([
    client.from("council_invoices").select("period, bulk_elec_kwh, bulk_water_kl").gte("period", start).lte("period", end),
    client.from("monthly_usage").select("period, electricity_consumption, water_consumption").gte("period", start).lte("period", end),
  ]);
  if (ci.error) throw ci.error;
  if (mu.error) throw mu.error;
  const bulkByMonth = {};
  (ci.data || []).forEach((r) => {
    bulkByMonth[String(r.period).slice(0, 7)] = {
      elec: Number(r.bulk_elec_kwh) || 0,
      water: Number(r.bulk_water_kl) || 0,
    };
  });
  const unitByMonth = {};
  (mu.data || []).forEach((r) => {
    const k = String(r.period).slice(0, 7);
    if (!unitByMonth[k]) unitByMonth[k] = { elec: 0, water: 0 };
    unitByMonth[k].elec = round2(unitByMonth[k].elec + (Number(r.electricity_consumption) || 0));
    unitByMonth[k].water = round2(unitByMonth[k].water + (Number(r.water_consumption) || 0));
  });
  // Common-property standards (electricity is trustee-configurable in levy_rates;
  // water is the fixed 20kL standard). Used for the "units + common property" line.
  const fy = `${fyStart}/${fyStart + 1}`;
  const lr = await client.from("levy_rates").select("common_property_electricity_kwh, common_property_water_kl").eq("financial_year", fy).limit(1);
  const lrRow = (!lr.error && lr.data && lr.data[0]) ? lr.data[0] : null;
  const cpElecKwh = lrRow ? Number(lrRow.common_property_electricity_kwh) : COMMON_PROPERTY_ELECTRICITY_KWH_DEFAULT;
  const cpWaterKl = lrRow && lrRow.common_property_water_kl != null ? Number(lrRow.common_property_water_kl) : COMMON_PROPERTY_WATER_KL;
  return { bulkByMonth, unitByMonth, cpElecKwh, cpWaterKl };
}

// Extra data needed only by the formal Word annual report: the prior financial
// year (for the year-on-year statement), the water/electricity tariff scales,
// the unit list (for the insurance schedule and levy split), and the per-unit
// levy split. Fetched lazily when the report is generated.
async function fetchReportExtras(fyStart) {
  const client = await ensureSupabaseClient();
  const fy = `${fyStart}/${fyStart + 1}`;
  const prevFy = `${fyStart - 1}/${fyStart}`;
  const nextFy = `${fyStart + 1}/${fyStart + 2}`;
  const [prevTxns, prevDeds] = await Promise.all([fetchYearBankTxns(fyStart - 1), fetchYearDeductions(fyStart - 1)]);
  const prevReport = generateAnnualReport(prevTxns, fyStart - 1, prevDeds);
  const [bandsR, elecR, vatR, levyR, unitsR, manualR] = await Promise.all([
    client.from("water_tariff_bands").select("*"),
    client.from("electricity_rates").select("*").eq("financial_year", fy).limit(1),
    client.from("vat_rates").select("*").order("effective_from", { ascending: false }).limit(1),
    client.from("levy_rates").select("*").eq("financial_year", fy).limit(1),
    client.from("units").select("id, unit_number, owner_name, participation_quota").order("unit_number"),
    client.from("levy_manual_entries").select("*").eq("financial_year", fy),
  ]);
  const byLabel = {};
  (bandsR.data || []).forEach((b) => {
    if (!byLabel[b.band_label]) byLabel[b.band_label] = { label: b.band_label, from: Number(b.from_kl), to: b.to_kl == null ? null : Number(b.to_kl), curr: null, prev: null };
    if (b.financial_year === fy) byLabel[b.band_label].curr = Number(b.rate_per_kl);
    if (b.financial_year === prevFy) byLabel[b.band_label].prev = Number(b.rate_per_kl);
  });
  const waterBands = Object.values(byLabel).sort((a, b) => a.from - b.from);
  const units = (unitsR.data || []).map((u) => ({ id: u.id, no: u.unit_number, owner: u.owner_name, pq: Number(u.participation_quota) }));
  const unitNoById = Object.fromEntries(units.map((u) => [u.id, u.no]));
  const levySplit = {};
  (manualR.data || []).forEach((m) => {
    const no = unitNoById[m.unit_id];
    if (no == null) return;
    (levySplit[no] = levySplit[no] || {})[m.item_label] = Number(m.amount);
  });
  return {
    fy, prevFy, nextFy, prevReport, waterBands, units, levySplit,
    electricityRate: elecR.data && elecR.data[0] ? Number(elecR.data[0].rate_per_kwh) : null,
    vatRate: vatR.data && vatR.data[0] ? Number(vatR.data[0].rate) : null,
    levyRates: levyR.data && levyR.data[0] ? levyR.data[0] : {},
  };
}

// Builds and downloads the annual report as a multi-sheet .xlsx. The workbook
// mirrors every section shown on the Financials page — Summary, Monthly
// breakdown, Miscellaneous, and the two usage tables. Everything visible in the
// module is exported here; new sections should be added as further sheets.
async function exportAnnualReportXlsx(payload) {
  const XLSX = await ensureSheetJsLoaded();
  const { report, breakdown, miscItems = [], elec, water } = payload;
  const wb = XLSX.utils.book_new();

  // 1. Summary (income / expense / surplus)
  const summary = [
    ["El Corazon Body Corporate — Annual Financial Report"],
    [`Financial year ${report.financialYear}  (${report.window.start} to ${report.window.end})`],
    [],
    ["INCOME", "Rand"],
    ...Object.entries(report.income).map(([k, v]) => [k, round2(v)]),
    ["Total income", report.totalIncome],
    [],
    ["EXPENSES", "Rand"],
    ...Object.entries(report.expense).map(([k, v]) => [k, round2(v)]),
    ["Total expenses", report.totalExpense],
    [],
    ["SURPLUS / (DEFICIT)", report.surplus],
  ];
  if (report.deductionsTotal > 0) summary.push([], ["Incl. approved personal-capacity deductions", report.deductionsTotal]);
  if (report.untagged && report.untagged.length) summary.push([], [`Untagged debits (${report.untagged.length}) — needs categorising`, report.untaggedTotal]);
  const wsSummary = XLSX.utils.aoa_to_sheet(summary);
  wsSummary["!cols"] = [{ wch: 42 }, { wch: 16 }];
  XLSX.utils.book_append_sheet(wb, wsSummary, "Summary");

  // 2. Monthly breakdown matrix
  if (breakdown) {
    const monthLabels = breakdown.months.map((m) => m.label);
    const dataRow = (line) => [line, ...breakdown.rows[line], breakdown.lineTotal(line)];
    const sumRow = (label, arr) => [label, ...arr, round2(arr.reduce((a, b) => a + b, 0))];
    const mb = [
      ["Line", ...monthLabels, "Total"],
      ["Income"],
      ...INCOME_LINES.map(dataRow),
      sumRow("Total income", breakdown.incomeByMonth),
      [],
      ["Expenses"],
      ...EXPENSE_LINES.map(dataRow),
      sumRow("Total expenses", breakdown.expenseByMonth),
      sumRow("Surplus / (deficit)", breakdown.surplusByMonth),
    ];
    const wsMB = XLSX.utils.aoa_to_sheet(mb);
    wsMB["!cols"] = [{ wch: 28 }, ...monthLabels.map(() => ({ wch: 10 })), { wch: 12 }];
    XLSX.utils.book_append_sheet(wb, wsMB, "Monthly Breakdown");
  }

  // 3. Miscellaneous items
  const misc = [["Month", "Description", "Amount"], ...miscItems.map((it) => [periodLabel(it.date), it.desc, round2(it.amount)])];
  misc.push([], ["Total", "", round2(miscItems.reduce((s, it) => s + it.amount, 0))]);
  const wsMisc = XLSX.utils.aoa_to_sheet(misc);
  wsMisc["!cols"] = [{ wch: 18 }, { wch: 50 }, { wch: 14 }];
  XLSX.utils.book_append_sheet(wb, wsMisc, "Miscellaneous");

  // 4 & 5. Usage tables (bulk vs units vs units + common property)
  const usageSheet = (series, unit) => {
    const head = ["Month", `CoJ bulk meter (${unit})`, `Resident units combined (${unit})`, `Units + common property (${unit})`];
    const rows = (breakdown ? breakdown.months : []).map((m, i) => [m.label, series.bulk[i] ?? "", series.units[i] ?? "", series.common[i] ?? ""]);
    const ws = XLSX.utils.aoa_to_sheet([head, ...rows]);
    ws["!cols"] = [{ wch: 10 }, { wch: 24 }, { wch: 28 }, { wch: 28 }];
    return ws;
  };
  if (elec) XLSX.utils.book_append_sheet(wb, usageSheet(elec, "kWh"), "Electricity Usage");
  if (water) XLSX.utils.book_append_sheet(wb, usageSheet(water, "kL"), "Water Usage");

  XLSX.writeFile(wb, `ElCorazon-AnnualReport-${report.financialYear.replace("/", "-")}.xlsx`);
}

// Loads the docx library from a CDN once (same pattern as the other loaders) so
// the annual report can be exported as an editable Word document.
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

// Builds and downloads the formal annual report as an editable .docx. Sections
// backed by data are filled in; sections that depend on figures the app doesn't
// hold (insurance schedule, garden salary, next-year tariff scale, proposed
// increases) are laid out as editable tables with blank cells for the trustee.
async function exportAnnualReportDocx(payload) {
  const D = await ensureDocxLoaded();
  const { Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell, WidthType, AlignmentType, PageOrientation } = D;
  const { report, breakdown, miscItems = [], extras = {} } = payload;
  const { prevReport, fy, prevFy, nextFy, waterBands = [], units = [], levySplit = {}, electricityRate, levyRates = {} } = extras;

  // Non-breaking money/number strings so a value like "R 1 234,56" never wraps
  // across two lines inside a narrow table cell (en-ZA uses spaces as separators).
  const nb = (s) => String(s).replace(/\s/g, " ");
  const money = (n) => nb("R " + (Math.round((Number(n) || 0) * 100) / 100).toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
  const H1 = (text) => new Paragraph({ text, heading: HeadingLevel.HEADING_1, spacing: { before: 320, after: 140 } });
  const H2 = (text) => new Paragraph({ text, heading: HeadingLevel.HEADING_2, spacing: { before: 200, after: 100 } });
  const para = (text, opts = {}) => new Paragraph({ spacing: { after: 100 }, children: [new TextRun({ text, ...opts })] });
  const tc = (text, { bold = false, align = "left", shade } = {}) => new TableCell({
    shading: shade ? { fill: shade } : undefined,
    margins: { top: 40, bottom: 40, left: 90, right: 90 },
    children: [new Paragraph({ alignment: align === "right" ? AlignmentType.RIGHT : (align === "center" ? AlignmentType.CENTER : AlignmentType.LEFT), children: [new TextRun({ text: text == null || text === "" ? "" : String(text), bold })] })],
  });
  const row = (cells, aligns = [], bold = false, shade) => new TableRow({ children: cells.map((c, i) => tc(c, { bold, align: aligns[i] || "left", shade })) });
  const tbl = (rows) => new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows });
  // Header cells sit on dark fill, so give them light text.
  const hrowLight = (labels, aligns = []) => new TableRow({ tableHeader: true, children: labels.map((l, i) => new TableCell({
    shading: { fill: "1B2A38" }, margins: { top: 40, bottom: 40, left: 90, right: 90 },
    children: [new Paragraph({ alignment: aligns[i] === "right" ? AlignmentType.RIGHT : (aligns[i] === "center" ? AlignmentType.CENTER : AlignmentType.LEFT), children: [new TextRun({ text: String(l), bold: true, color: "FFFFFF" })] })],
  })) });

  // ---- Portrait section 1: title + year-on-year statement ----
  const portraitA = [];
  portraitA.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 60 }, children: [new TextRun({ text: "El Corazon Body Corporate", bold: true, size: 40 })] }));
  portraitA.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 40 }, children: [new TextRun({ text: `Annual Financial Report — FY ${report.financialYear}`, size: 28 })] }));
  portraitA.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 240 }, children: [new TextRun({ text: `Financial year ${report.window.start} to ${report.window.end}`, italics: true, color: "64748B", size: 20 })] }));

  portraitA.push(H1("1. Income & Expense Statement (year-on-year)"));
  const s1 = [hrowLight(["Line", `FY ${prevFy || "prev"}`, `FY ${fy || report.financialYear}`], ["left", "right", "right"])];
  s1.push(row(["Income", "", ""], [], true, "E7E1D3"));
  INCOME_LINES.forEach((l) => s1.push(row([l, money(prevReport ? prevReport.income[l] : 0), money(report.income[l])], ["left", "right", "right"])));
  s1.push(row(["Total income", money(prevReport ? prevReport.totalIncome : 0), money(report.totalIncome)], ["left", "right", "right"], true));
  s1.push(row(["Expenses", "", ""], [], true, "E7E1D3"));
  EXPENSE_LINES.forEach((l) => s1.push(row([l, money(prevReport ? prevReport.expense[l] : 0), money(report.expense[l])], ["left", "right", "right"])));
  s1.push(row(["Total expenses", money(prevReport ? prevReport.totalExpense : 0), money(report.totalExpense)], ["left", "right", "right"], true));
  s1.push(row(["Surplus / (deficit)", money(prevReport ? prevReport.surplus : 0), money(report.surplus)], ["left", "right", "right"], true, "E7E1D3"));
  portraitA.push(tbl(s1));

  // ---- Landscape section: month-to-month statement ----
  const landscapeB = [];
  landscapeB.push(H1("2. Income & Expense Statement (month to month)"));
  if (breakdown) {
    const monthLabels = breakdown.months.map((m) => m.label);
    const wAligns = ["left", ...breakdown.months.map(() => "right"), "right"];
    const s2 = [hrowLight(["Line", ...monthLabels, "Total"], wAligns)];
    const whole = (v) => (v ? nb(Math.round(v).toLocaleString("en-ZA")) : "–");
    const drow = (l) => row([l, ...breakdown.rows[l].map(whole), whole(breakdown.lineTotal(l))], wAligns);
    s2.push(row(["Income", ...breakdown.months.map(() => ""), ""], [], true, "E7E1D3"));
    INCOME_LINES.forEach((l) => s2.push(drow(l)));
    s2.push(row(["Total income", ...breakdown.incomeByMonth.map(whole), whole(breakdown.incomeByMonth.reduce((a, b) => a + b, 0))], wAligns, true));
    s2.push(row(["Expenses", ...breakdown.months.map(() => ""), ""], [], true, "E7E1D3"));
    EXPENSE_LINES.forEach((l) => s2.push(drow(l)));
    s2.push(row(["Total expenses", ...breakdown.expenseByMonth.map(whole), whole(breakdown.expenseByMonth.reduce((a, b) => a + b, 0))], wAligns, true));
    s2.push(row(["Surplus / (deficit)", ...breakdown.surplusByMonth.map(whole), whole(breakdown.surplusByMonth.reduce((a, b) => a + b, 0))], wAligns, true, "E7E1D3"));
    landscapeB.push(tbl(s2));
    landscapeB.push(para("Figures in whole rand.", { italics: true, size: 18, color: "94A0AC" }));
  }

  // ---- Portrait section 2: everything from Miscellaneous onwards ----
  const portraitC = [];

  // 3. Miscellaneous expenses
  portraitC.push(H1("3. Miscellaneous Expenses"));
  const s3 = [hrowLight(["Month", "Year", "Amount", "Description"], ["left", "left", "right", "left"])];
  miscItems.forEach((it) => {
    const y = String(it.date).slice(0, 4);
    const m = MONTH_NAMES[parseInt(String(it.date).slice(5, 7), 10) - 1] || "";
    s3.push(row([m, y, money(it.amount), it.desc], ["left", "left", "right", "left"]));
  });
  s3.push(row(["Total", "", money(miscItems.reduce((s, it) => s + it.amount, 0)), ""], ["left", "left", "right", "left"], true, "E7E1D3"));
  portraitC.push(tbl(s3));

  // 4. Insurance schedule per unit
  portraitC.push(H1("4. Insurance Schedule (per unit)"));
  portraitC.push(para("Complete the insurance figures per unit for the year. Blank cells are for entry from the insurer's schedule.", { italics: true, size: 18, color: "94A0AC" }));
  const insCols = ["Unit No", "Sqm", "Sum Ins", "Premium", "Com Prop", "Sasria", "Broker", "Per Annum", "Per Month"];
  const insAligns = ["left", "right", "right", "right", "right", "right", "right", "right", "right"];
  const s4 = [hrowLight(insCols, insAligns)];
  units.forEach((u) => s4.push(row([`Unit ${u.no}`, "", "", "", "", "", "", "", ""], insAligns)));
  s4.push(row(["Total", "", "", "", "", "", "", "", ""], [], true, "E7E1D3"));
  portraitC.push(tbl(s4));

  // 5. Garden Service
  portraitC.push(H1("5. Garden Service"));
  const s6 = [hrowLight(["Item", "Amount / Value"], ["left", "right"])];
  s6.push(row(["Total servicing costs this FY (actual)", money(report.expense["Garden Service"])], ["left", "right"]));
  s6.push(row(["Total salary (annual)", ""], ["left", "right"]));
  s6.push(row(["Proposed salary increase (%)", ""], ["left", "right"]));
  s6.push(row(["Proposed year-end bonus", ""], ["left", "right"]));
  portraitC.push(tbl(s6));
  portraitC.push(para("Servicing cost is the actual Garden Service spend recorded this year. Enter the salary, proposed increase, and year-end bonus for approval at the AGM.", { size: 20 }));

  // 6. Tariffs (water + electricity, with sub-sections)
  portraitC.push(H1("6. Tariffs"));
  portraitC.push(H2("Water — increasing block tariff (R / kL)"));
  const s7 = [hrowLight(["Band (kL)", `Current FY ${fy || ""}`, `Proposed FY ${nextFy || ""}`], ["left", "right", "right"])];
  waterBands.forEach((b) => s7.push(row([b.label, b.curr == null ? "" : money(b.curr), ""], ["left", "right", "right"])));
  portraitC.push(tbl(s7));
  portraitC.push(H2("Water — common property, demand levy & sewerage"));
  const s7b = [hrowLight(["Item", "Current", "Proposed"], ["left", "right", "right"])];
  s7b.push(row(["Common property provision (kL / month)", String(levyRates.common_property_water_kl != null ? levyRates.common_property_water_kl : COMMON_PROPERTY_WATER_KL), ""], ["left", "right", "right"]));
  s7b.push(row(["Water Demand Levy (per unit / month)", levyRates.water_demand_levy != null ? money(levyRates.water_demand_levy) : "", ""], ["left", "right", "right"]));
  s7b.push(row(["Sewerage (per unit / month)", "", ""], ["left", "right", "right"]));
  portraitC.push(tbl(s7b));
  portraitC.push(H2("Electricity"));
  const s8 = [hrowLight(["Item", "Current", "Proposed"], ["left", "right", "right"])];
  s8.push(row(["Flat rate (R / kWh)", electricityRate != null ? electricityRate.toFixed(4) : "", ""], ["left", "right", "right"]));
  s8.push(row(["Common property provision (kWh / month)", String(levyRates.common_property_electricity_kwh != null ? levyRates.common_property_electricity_kwh : COMMON_PROPERTY_ELECTRICITY_KWH_DEFAULT), ""], ["left", "right", "right"]));
  s8.push(row(["Electricity Service Charge (complex, excl VAT)", levyRates.electricity_service_fee != null ? money(levyRates.electricity_service_fee) : "", ""], ["left", "right", "right"]));
  s8.push(row(["Electricity Network Charge (complex, excl VAT)", levyRates.electricity_network_fee != null ? money(levyRates.electricity_network_fee) : "", ""], ["left", "right", "right"]));
  portraitC.push(tbl(s8));

  // 7. Service notes (Blockwatch note carries the monthly-fee detail)
  portraitC.push(H1("7. Service Notes"));
  portraitC.push(H2("Fire Extinguisher Servicing"));
  portraitC.push(para("Annual servicing of the complex's fire extinguishers, paid directly by the Body Corp and never billed to a unit. Recorded in the operating-expense log.", { size: 20 }));
  portraitC.push(H2("Garden Service"));
  portraitC.push(para("Grounds maintenance carried by the Body Corp, most commonly paid personally by Unit 2 and reimbursed via a levy deduction with proof of payment. Shown at R0.00 on the levy statement.", { size: 20 }));
  portraitC.push(H2("Blockwatch"));
  portraitC.push(para(`Neighbourhood watch contribution carried by the Body Corp and paid directly by Unit 1; shown at R0.00 on the levy statement. The monthly fee payable is ${money(150)} (${money(1800)} per annum).`, { size: 20 }));
  portraitC.push(H2("CSOS"));
  portraitC.push(para("The statutory Community Schemes Ombud Service levy, paid by the Body Corp. Tracked in the operating-expense log for the annual report.", { size: 20 }));

  // 8. Levy split for next FY, per unit
  portraitC.push(H1("8. Levy Split — proposed for FY " + (nextFy || "next")));
  portraitC.push(para("Per-unit levy split. Pre-filled from the current year where captured; adjust each line for the new financial year.", { italics: true, size: 18, color: "94A0AC" }));
  const unitCols = units.map((u) => `U${u.no}`);
  const aligns10 = ["left", ...unitCols.map(() => "right"), "right"];
  const s10 = [hrowLight(["Levy item", ...unitCols, "Total"], aligns10)];
  LEVY_ITEMS.forEach((item) => {
    const vals = units.map((u) => (levySplit[u.no] && levySplit[u.no][item] != null ? Number(levySplit[u.no][item]) : null));
    const rowTotal = vals.reduce((a, v) => a + (v || 0), 0);
    s10.push(row([item, ...vals.map((v) => (v == null ? "" : money(v))), rowTotal ? money(rowTotal) : ""], aligns10));
  });
  portraitC.push(tbl(s10));

  portraitC.push(new Paragraph({ spacing: { before: 300 }, children: [new TextRun({ text: `Prepared ${new Date().toLocaleDateString("en-ZA")} · El Corazon Body Corporate finance trustee.`, italics: true, size: 18, color: "94A0AC" })] }));

  const portrait = { page: { size: { orientation: PageOrientation.PORTRAIT } } };
  const landscape = { page: { size: { orientation: PageOrientation.LANDSCAPE } } };
  const doc = new Document({
    styles: { default: { document: { run: { font: "Calibri", size: 20 } } } },
    sections: [
      { properties: portrait, children: portraitA },
      { properties: landscape, children: landscapeB },
      { properties: portrait, children: portraitC },
    ],
  });
  const blob = await Packer.toBlob(doc);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `ElCorazon-AnnualReport-${report.financialYear.replace("/", "-")}.docx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

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
  const [electricityRate, setElectricityRate] = useState(ELECTRICITY_RATE_DEFAULT);
  const [levyBreakdown, setLevyBreakdown] = useState(LEVY_BREAKDOWN_DEFAULT);
  const [vatRate, setVatRate] = useState(VAT_RATE_DEFAULT);
  const [commonPropertyElectricityKwh, setCommonPropertyElectricityKwh] = useState(COMMON_PROPERTY_ELECTRICITY_KWH_DEFAULT);
  const [commonPropertyWaterKl, setCommonPropertyWaterKl] = useState(COMMON_PROPERTY_WATER_KL);
  const [additionalCharges, setAdditionalCharges] = useState(ADDITIONAL_CHARGES_DEFAULT);
  const [remittanceDeductions, setRemittanceDeductions] = useState({});
  const [remittanceAdvices, setRemittanceAdvices] = useState({});
  const [opsExpenses, setOpsExpenses] = useState(OPS_EXPENSES_DEFAULT);
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
  // Trustee-managed expense categories (source of truth: expense_categories
  // table). Loaded once; the module-level lists + every dropdown/report follow.
  const [expenseCategories, setExpenseCategories] = useState([]);

  const reloadCategories = () => fetchExpenseCategories().then(setExpenseCategories).catch((e) => console.error("Load categories failed:", e));
  useEffect(() => { reloadCategories(); }, []);
  useEffect(() => {
    const active = expenseCategories.filter((c) => c.active).slice().sort((a, b) => a.sort_order - b.sort_order).map((c) => c.name);
    applyExpenseCategories(active);
  }, [expenseCategories]);

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
        setElectricityRate(data.electricityRate);
        setVatRate(data.vatRate);
        if (data.levyRates) {
          setCommonPropertyElectricityKwh(data.levyRates.commonPropertyElectricityKwh);
          if (data.levyRates.commonPropertyWaterKl != null) setCommonPropertyWaterKl(data.levyRates.commonPropertyWaterKl);
        }
        setLevyBreakdown(data.levyBreakdown);
        setReadings(data.readings);
        setAdditionalCharges(data.additionalCharges);
        setOpsExpenses(data.opsExpenses);
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
        setUnitsSource("database");
      })
      .catch((err) => {
        console.error("Could not load app data from Supabase — staying on mock data:", err);
        if (!cancelled) setUnitsSource("error");
      });
    return () => { cancelled = true; };
  }, [session, selectedPeriod]);

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

  // Records the trustee's manual expense tag on a bank line (which P&L line a
  // debit is, and — for a combined CoJ debit — its water/electricity split).
  // Updates in place by object reference and persists when the row came from
  // the database. Feeds the Financials dashboard and annual report.
  const updateTxnTag = async (txn, { expenseCategory, cojWater, cojElec }) => {
    const patch = {};
    if (expenseCategory !== undefined) patch.expenseCategory = expenseCategory;
    if (cojWater !== undefined) patch.cojWater = cojWater;
    if (cojElec !== undefined) patch.cojElec = cojElec;
    setBankTxns((prev) => prev.map((t) => (t === txn ? { ...t, ...patch } : t)));
    if (!txn.dbId) return; // demo/unsaved statement — local-only
    try {
      const client = await ensureSupabaseClient();
      const dbPatch = {};
      if (expenseCategory !== undefined) dbPatch.expense_category = expenseCategory;
      if (cojWater !== undefined) dbPatch.coj_water_amount = cojWater;
      if (cojElec !== undefined) dbPatch.coj_elec_amount = cojElec;
      const { error } = await client.from("bank_transactions").update(dbPatch).eq("id", txn.dbId);
      if (error) throw error;
    } catch (err) {
      console.error("Saving the expense tag failed:", err);
    }
  };

  const alloc = useAllocation(
    waterBands, electricityRate, levyBreakdown, vatRate, additionalCharges,
    commonPropertyElectricityKwh, unitsSource, readings, councilInvoice, statementOverrides, commonPropertyWaterKl
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
            {tab !== "financials" && <PeriodBar periods={periods} selectedPeriod={selectedPeriod} setSelectedPeriod={setSelectedPeriod} />}
            {tab === "dashboard" && <Dashboard alloc={alloc} setTab={setTab} setSelectedUnit={setSelectedUnit} bankTxns={bankTxns} period={selectedPeriod} remittanceDeductions={remittanceDeductions} />}
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
                onReviewTxn={updateTxnReview}
                onTagTxn={updateTxnTag}
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
                waterBands={waterBands} setWaterBands={setWaterBands}
                electricityRate={electricityRate} setElectricityRate={setElectricityRate}
                vatRate={vatRate} setVatRate={setVatRate}
                commonPropertyElectricityKwh={commonPropertyElectricityKwh}
                setCommonPropertyElectricityKwh={setCommonPropertyElectricityKwh}
                commonPropertyWaterKl={commonPropertyWaterKl}
                setCommonPropertyWaterKl={setCommonPropertyWaterKl}
              />
            )}
            {tab === "levy-setup" && (
              <LevySetup
                levyBreakdown={levyBreakdown} setLevyBreakdown={setLevyBreakdown}
                waterBands={waterBands} electricityRate={electricityRate} vatRate={vatRate}
                commonPropertyElectricityKwh={commonPropertyElectricityKwh}
                commonPropertyWaterKl={commonPropertyWaterKl}
                councilInvoice={councilInvoice}
              />
            )}
            {tab === "additional-charges" && (
              <AdditionalCharges additionalCharges={additionalCharges} setAdditionalCharges={setAdditionalCharges} />
            )}
            {tab === "ops-expenses" && (
              <OpsExpenses opsExpenses={opsExpenses} setOpsExpenses={setOpsExpenses} period={selectedPeriod} />
            )}
            {tab === "financials" && <Financials />}
            {tab === "expense-categories" && (
              <ExpenseCategoriesConfig categories={expenseCategories} reload={reloadCategories} />
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
    <header className="wrap-sm" style={{ background: "#1B2A38", color: "#F6F1E7", padding: "14px 20px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
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

// ---------- Expense categories config (trustee) ----------
function ExpenseCategoriesConfig({ categories, reload }) {
  const [newName, setNewName] = useState("");
  const [editingId, setEditingId] = useState(null);
  const [editName, setEditName] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const sorted = [...categories].sort((a, b) => a.sort_order - b.sort_order);

  const iconBtn = { background: "none", border: "1px solid #D8D0BE", borderRadius: 5, padding: "2px 7px", marginRight: 4, cursor: "pointer", fontSize: 12 };
  const linkBtn = { background: "none", border: "none", color: "#2A3E7A", fontSize: 12, fontWeight: 600, cursor: "pointer", textDecoration: "underline", marginLeft: 8, padding: 0 };

  const run = async (fn, okMsg) => {
    setBusy(true); setMsg(null);
    try {
      await fn();
      await reload();
      if (okMsg) { setMsg(okMsg); setTimeout(() => setMsg(null), 2000); }
    } catch (e) { console.error("Category action failed:", e); setMsg("Error: " + (e.message || e)); }
    finally { setBusy(false); }
  };
  const add = () => {
    const name = newName.trim();
    if (!name) return;
    run(async () => {
      const client = await ensureSupabaseClient();
      const maxOrder = categories.reduce((m, c) => Math.max(m, c.sort_order), 0);
      const { error } = await client.from("expense_categories").insert({ name, sort_order: maxOrder + 1 });
      if (error) throw error;
      setNewName("");
    }, "Category added");
  };
  const rename = (cat) => {
    const name = editName.trim();
    if (!name || name === cat.name) { setEditingId(null); return; }
    run(async () => {
      const client = await ensureSupabaseClient();
      const { error } = await client.rpc("rename_expense_category", { old_name: cat.name, new_name: name });
      if (error) throw error;
      setEditingId(null);
    }, "Renamed everywhere it's used");
  };
  const toggleActive = (cat) => run(async () => {
    const client = await ensureSupabaseClient();
    const { error } = await client.from("expense_categories").update({ active: !cat.active }).eq("id", cat.id);
    if (error) throw error;
  });
  const move = (cat, dir) => {
    const idx = sorted.findIndex((c) => c.id === cat.id);
    const swap = sorted[idx + dir];
    if (!swap) return;
    run(async () => {
      const client = await ensureSupabaseClient();
      await client.from("expense_categories").update({ sort_order: swap.sort_order }).eq("id", cat.id);
      await client.from("expense_categories").update({ sort_order: cat.sort_order }).eq("id", swap.id);
    });
  };

  return (
    <>
      <h1 className="f-display" style={{ fontSize: 24, marginBottom: 4 }}>Expense categories</h1>
      <p style={{ color: "#64748B", fontSize: 13.5, marginBottom: 18 }}>
        One shared list of expense categories. It drives the dropdown whenever you log a Body Corp expense or tag a resident deduction or bank line, and each category becomes its own line in the annual report. Renaming a category updates it everywhere it's already used.
      </p>

      <Card style={{ marginBottom: 16 }}>
        <div style={{ fontWeight: 700, fontSize: 13.5, marginBottom: 10 }}>Add a category</div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="e.g. CSOS" onKeyDown={(e) => { if (e.key === "Enter") add(); }} style={{ ...inputStyle, width: 240, textAlign: "left" }} />
          <button style={primaryBtn} onClick={add} disabled={busy || !newName.trim()}>Add category</button>
          {msg && <span style={{ fontSize: 12.5, fontWeight: 600, color: String(msg).startsWith("Error") ? "#B5651D" : "#2F5D50" }}>{msg}</span>}
        </div>
      </Card>

      <Card>
        <div style={{ fontWeight: 700, fontSize: 13.5, marginBottom: 10 }}>Categories</div>
        <table style={{ width: "100%", fontSize: 13, borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ color: "#64748B", textAlign: "left", fontSize: 11, textTransform: "uppercase" }}>
              <th style={{ padding: "6px 8px" }}>Order</th>
              <th style={{ padding: "6px 8px" }}>Name</th>
              <th style={{ padding: "6px 8px" }}>Status</th>
              <th style={{ padding: "6px 8px", textAlign: "right" }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((cat, i) => (
              <tr key={cat.id} style={{ borderTop: "1px solid #EEE7D6", opacity: cat.active ? 1 : 0.55 }}>
                <td style={{ padding: "8px", whiteSpace: "nowrap" }}>
                  <button onClick={() => move(cat, -1)} disabled={busy || i === 0} title="Move up" style={iconBtn}>↑</button>
                  <button onClick={() => move(cat, 1)} disabled={busy || i === sorted.length - 1} title="Move down" style={iconBtn}>↓</button>
                </td>
                <td style={{ padding: "8px" }}>
                  {editingId === cat.id ? (
                    <input value={editName} onChange={(e) => setEditName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") rename(cat); if (e.key === "Escape") setEditingId(null); }} autoFocus style={{ ...inputStyle, width: 220, textAlign: "left" }} />
                  ) : (
                    <span style={{ fontWeight: 500 }}>{cat.name}</span>
                  )}
                </td>
                <td style={{ padding: "8px" }}>
                  <span style={{ fontSize: 11.5, fontWeight: 700, color: cat.active ? "#2F5D50" : "#94A0AC" }}>{cat.active ? "Active" : "Hidden"}</span>
                </td>
                <td style={{ padding: "8px", textAlign: "right", whiteSpace: "nowrap" }}>
                  {editingId === cat.id ? (
                    <>
                      <button onClick={() => rename(cat)} disabled={busy} style={linkBtn}>Save</button>
                      <button onClick={() => setEditingId(null)} style={linkBtn}>Cancel</button>
                    </>
                  ) : (
                    <>
                      <button onClick={() => { setEditingId(cat.id); setEditName(cat.name); }} style={linkBtn}>Rename</button>
                      <button onClick={() => toggleActive(cat)} disabled={busy} style={linkBtn}>{cat.active ? "Hide" : "Restore"}</button>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p style={{ fontSize: 11.5, color: "#94A0AC", marginTop: 10 }}>
          "Hide" removes a category from the dropdowns without deleting it, so anything already tagged with it keeps its label. Order controls how categories appear in the dropdowns and the report.
        </p>
      </Card>
    </>
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
    ["financials", "Financials & annual report"],
    ["expense-categories", "Expense categories"],
    ["tariffs", "Tariffs & rates"],
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
function Dashboard({ alloc, setTab, setSelectedUnit, bankTxns, period = CURRENT_PERIOD, remittanceDeductions = {} }) {
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
  const matches = reconcileUnits(alloc.rows, bankTxns, remittanceDeductions);
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

// ---------- Financials & annual report ----------
// Year-to-date profit & loss for the Aug–Jul financial year, every line
// sourced from the bank statement. "Export Excel" builds a real .xlsx; "Export
// PDF" uses the same print-to-PDF path as statements, scoped to the report.
function Financials() {
  const currentFY = fyStartYearFor(new Date().toISOString().slice(0, 10));
  const [fyStart, setFyStart] = useState(currentFY);
  const [txns, setTxns] = useState([]);
  const [deductions, setDeductions] = useState([]);
  const [usage, setUsage] = useState({ bulkByMonth: {}, unitByMonth: {} });
  const [status, setStatus] = useState("loading"); // loading | ready | error
  const [error, setError] = useState(null);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setStatus("loading");
    Promise.all([fetchYearBankTxns(fyStart), fetchYearDeductions(fyStart), fetchYearUsage(fyStart)])
      .then(([rows, deds, use]) => { if (!cancelled) { setTxns(rows); setDeductions(deds); setUsage(use); setStatus("ready"); } })
      .catch((err) => { if (!cancelled) { setError(err.message || String(err)); setStatus("error"); } });
    return () => { cancelled = true; };
  }, [fyStart]);

  const report = useMemo(() => generateAnnualReport(txns, fyStart, deductions), [txns, fyStart, deductions]);
  const breakdown = useMemo(() => buildMonthlyBreakdown(txns, deductions, fyStart), [txns, deductions, fyStart]);
  const miscItems = useMemo(() => {
    const out = [];
    txns.forEach((t) => {
      if (t.direction === "debit" && t.expenseCategory === "Maintenance/Miscellaneous")
        out.push({ date: t.date, amount: round2(Math.abs(Number(t.amount) || 0)), desc: t.desc });
    });
    deductions.forEach((d) => {
      if (d.approved && d.expenseCategory === "Maintenance/Miscellaneous")
        out.push({ date: d.period, amount: round2(Math.abs(Number(d.amount) || 0)), desc: `${d.comment || "Deduction"} (resident deduction)` });
    });
    out.sort((a, b) => String(a.date).localeCompare(String(b.date)));
    return out;
  }, [txns, deductions]);
  const elecSeries = useMemo(() => ({
    bulk: breakdown.months.map((m) => (usage.bulkByMonth[m.key] ? usage.bulkByMonth[m.key].elec : null)),
    units: breakdown.months.map((m) => (usage.unitByMonth[m.key] ? usage.unitByMonth[m.key].elec : null)),
    common: breakdown.months.map((m) => (usage.unitByMonth[m.key] ? round2(usage.unitByMonth[m.key].elec + (usage.cpElecKwh || 0)) : null)),
  }), [breakdown.months, usage]);
  const waterSeries = useMemo(() => ({
    bulk: breakdown.months.map((m) => (usage.bulkByMonth[m.key] ? usage.bulkByMonth[m.key].water : null)),
    units: breakdown.months.map((m) => (usage.unitByMonth[m.key] ? usage.unitByMonth[m.key].water : null)),
    common: breakdown.months.map((m) => (usage.unitByMonth[m.key] ? round2(usage.unitByMonth[m.key].water + (usage.cpWaterKl || 0)) : null)),
  }), [breakdown.months, usage]);

  const maxExp = Math.max(1, ...Object.values(report.expense));
  const years = [currentFY, currentFY - 1, currentFY - 2];
  const win = report.window;

  const exportWord = async () => {
    setExporting(true);
    try {
      const ex = await fetchReportExtras(fyStart);
      await exportAnnualReportDocx({ report, breakdown, miscItems, extras: ex });
    } catch (e) {
      console.error("Word export failed:", e);
      alert("Word export failed: " + (e.message || e));
    } finally {
      setExporting(false);
    }
  };

  return (
    <>
      <div className="no-print" style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", flexWrap: "wrap", gap: 12, marginBottom: 18 }}>
        <div>
          <h1 className="f-display" style={{ fontSize: 24, marginBottom: 4 }}>Financials &amp; annual report</h1>
          <p style={{ color: "#64748B", fontSize: 13.5, margin: 0 }}>
            FY {report.financialYear} ({win.start} to {win.end}) · sourced from bank transactions
          </p>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button style={secondaryBtn} disabled={status !== "ready"} onClick={() => exportAnnualReportXlsx({ report, breakdown, miscItems, elec: elecSeries, water: waterSeries })}>Export Excel</button>
          <button style={primaryBtn} disabled={status !== "ready" || exporting} onClick={exportWord}>{exporting ? "Generating…" : "Export Word"}</button>
        </div>
      </div>

      {status === "loading" && <Card><div style={{ color: "#64748B", fontSize: 13 }}>Loading transactions…</div></Card>}
      {status === "error" && (
        <Card><div style={{ color: "#B5651D", fontSize: 13, fontWeight: 600 }}>
          Couldn’t load transactions ({error}). Confirm the expense-tagging migration has been applied.
        </div></Card>
      )}

      {status === "ready" && (
        <div className="print-area">
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 14, marginBottom: 20 }}>
            <Stat label="Total income" value={rand(report.totalIncome)} accent="#2F5D50" />
            <Stat label="Total expenses" value={rand(report.totalExpense)} accent="#B5651D" />
            <Stat label="Surplus / (deficit)" value={rand(report.surplus)} accent={report.surplus >= 0 ? "#2F5D50" : "#B5651D"} />
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 }}>
            <PnlPanel title="Income" data={report.income} total={report.totalIncome} />
            <PnlPanel title="Expenses" data={report.expense} total={report.totalExpense} />
          </div>

          {report.deductionsTotal > 0 && (
            <p style={{ fontSize: 12, color: "#64748B", marginTop: -4, marginBottom: 16 }}>
              Expenses include {rand(report.deductionsTotal)} of approved personal-capacity deductions
              (Body Corp costs residents paid directly) — added to expenses only, so the surplus reflects them.
            </p>
          )}

          <Card>
            <div style={{ fontWeight: 700, fontSize: 13.5, marginBottom: 12, textTransform: "uppercase", letterSpacing: 0.4, color: "#64748B" }}>
              Expense composition
            </div>
            {Object.entries(report.expense).sort((a, b) => b[1] - a[1]).map(([k, v]) => (
              <div key={k} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 7, fontSize: 12.5 }}>
                <span style={{ width: 170, color: "#64748B" }}>{k}</span>
                <span style={{ flex: 1, background: "#EEE7D6", borderRadius: 3, height: 14 }}>
                  <span style={{ display: "block", width: `${(v / maxExp) * 100}%`, background: "#2F5D50", height: 14, borderRadius: 3 }} />
                </span>
                <span className="f-mono" style={{ width: 100, textAlign: "right" }}>{rand(v)}</span>
              </div>
            ))}
          </Card>

          <MonthlyMatrixTable breakdown={breakdown} />

          <MiscTable items={miscItems} />

          <UsageLineChart
            title="Electricity usage per month — CoJ bulk vs resident units combined (kWh)"
            months={breakdown.months} bulk={elecSeries.bulk} units={elecSeries.units} common={elecSeries.common}
          />
          <UsageLineChart
            title="Water usage per month — CoJ bulk vs resident units combined (kL)"
            months={breakdown.months} bulk={waterSeries.bulk} units={waterSeries.units} common={waterSeries.common}
          />

          {report.untagged.length > 0 && (
            <Card className="no-print" style={{ marginTop: 16, borderColor: "#EAD9C4", background: "#FBF6EC" }}>
              <div style={{ fontSize: 12.5, color: "#8A6D1E", fontWeight: 600 }}>
                {report.untagged.length} debit(s) totalling {rand(report.untaggedTotal)} are untagged — assign an expense
                category on the Bank reconciliation page so they land in this report.
              </div>
            </Card>
          )}
        </div>
      )}

      {/* Financial-year selector — moved to the bottom of the page */}
      <div className="no-print" style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 24, paddingTop: 16, borderTop: "1px solid #E4DCC8" }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: "#64748B", letterSpacing: 0.6, textTransform: "uppercase" }}>Financial year</span>
        <select
          value={fyStart}
          onChange={(e) => setFyStart(Number(e.target.value))}
          style={{ padding: "7px 12px", borderRadius: 7, border: "1px solid #D8D0BE", background: "#fff", fontSize: 13, fontWeight: 600, color: "#1B2A38", cursor: "pointer" }}
        >
          {years.map((y) => <option key={y} value={y}>{`FY ${y}/${(y + 1) % 100} (Aug–Jul)`}</option>)}
        </select>
      </div>
    </>
  );
}

function PnlPanel({ title, data, total }) {
  return (
    <Card>
      <div style={{ fontWeight: 700, fontSize: 13.5, marginBottom: 10 }}>{title}</div>
      <table style={{ width: "100%", fontSize: 13, borderCollapse: "collapse" }}>
        <tbody>
          {Object.entries(data).map(([k, v]) => (
            <tr key={k} style={{ borderTop: "1px solid #EEE7D6" }}>
              <td style={{ padding: "7px 4px", color: "#64748B" }}>{k}</td>
              <td className="f-mono" style={{ padding: "7px 4px", textAlign: "right" }}>{rand(v)}</td>
            </tr>
          ))}
          <tr style={{ borderTop: "2px solid #1B2A38" }}>
            <td style={{ padding: "8px 4px", fontWeight: 700 }}>Total {title.toLowerCase()}</td>
            <td className="f-mono" style={{ padding: "8px 4px", textAlign: "right", fontWeight: 700 }}>{rand(total)}</td>
          </tr>
        </tbody>
      </table>
    </Card>
  );
}

// Month × line matrix of income and expenses (whole rand, for width).
function MonthlyMatrixTable({ breakdown }) {
  const { months, rows, incomeByMonth, expenseByMonth, surplusByMonth, lineTotal } = breakdown;
  const cell = (v) => (v ? Math.round(v).toLocaleString("en-ZA") : "–");
  const sum = (arr) => Math.round(arr.reduce((a, b) => a + b, 0)).toLocaleString("en-ZA");
  const th = { padding: "5px 6px", textAlign: "right", fontSize: 10, color: "#64748B", textTransform: "uppercase", whiteSpace: "nowrap" };
  const td = { padding: "4px 6px", textAlign: "right", whiteSpace: "nowrap" };
  const lbl = { padding: "4px 6px", textAlign: "left", whiteSpace: "nowrap", color: "#64748B" };
  const dataRow = (line) => (
    <tr key={line} style={{ borderTop: "1px solid #EEE7D6" }}>
      <td style={lbl}>{line}</td>
      {rows[line].map((v, i) => <td key={i} className="f-mono" style={td}>{cell(v)}</td>)}
      <td className="f-mono" style={{ ...td, fontWeight: 600 }}>{cell(lineTotal(line))}</td>
    </tr>
  );
  const totalRow = (label, arr, strong) => (
    <tr style={{ borderTop: strong ? "2px solid #1B2A38" : "1px solid #1B2A38", background: "#FBF8F0" }}>
      <td style={{ ...lbl, fontWeight: 700, color: "#1B2A38" }}>{label}</td>
      {arr.map((v, i) => <td key={i} className="f-mono" style={{ ...td, fontWeight: 700 }}>{cell(v)}</td>)}
      <td className="f-mono" style={{ ...td, fontWeight: 700 }}>{sum(arr)}</td>
    </tr>
  );
  return (
    <Card style={{ marginTop: 16 }}>
      <div style={{ fontWeight: 700, fontSize: 13.5, marginBottom: 10, textTransform: "uppercase", letterSpacing: 0.4, color: "#64748B" }}>Monthly breakdown (whole rand)</div>
      <div style={{ overflowX: "auto" }}>
        <table style={{ borderCollapse: "collapse", fontSize: 11, minWidth: 940 }}>
          <thead>
            <tr>
              <th style={{ ...th, textAlign: "left" }}>Line</th>
              {months.map((m) => <th key={m.key} style={th}>{m.label}</th>)}
              <th style={{ ...th, fontWeight: 700 }}>Total</th>
            </tr>
          </thead>
          <tbody>
            <tr><td colSpan={months.length + 2} style={{ padding: "6px", fontWeight: 700, fontSize: 10.5, color: "#2F5D50", textTransform: "uppercase", letterSpacing: 0.4 }}>Income</td></tr>
            {INCOME_LINES.map(dataRow)}
            {totalRow("Total income", incomeByMonth, false)}
            <tr><td colSpan={months.length + 2} style={{ padding: "6px", fontWeight: 700, fontSize: 10.5, color: "#B5651D", textTransform: "uppercase", letterSpacing: 0.4 }}>Expenses</td></tr>
            {EXPENSE_LINES.map(dataRow)}
            {totalRow("Total expenses", expenseByMonth, false)}
            {totalRow("Surplus / (deficit)", surplusByMonth, true)}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

// Flat list of everything tagged Maintenance/Miscellaneous.
function MiscTable({ items }) {
  const total = items.reduce((s, it) => s + it.amount, 0);
  return (
    <Card style={{ marginTop: 16 }}>
      <div style={{ fontWeight: 700, fontSize: 13.5, marginBottom: 4, textTransform: "uppercase", letterSpacing: 0.4, color: "#64748B" }}>Miscellaneous items this year</div>
      <div style={{ fontSize: 11.5, color: "#94A0AC", marginBottom: 10 }}>Everything tagged Maintenance/Miscellaneous — bank payments and approved deductions.</div>
      {items.length === 0 ? (
        <div style={{ fontSize: 12.5, color: "#64748B" }}>No miscellaneous items this year.</div>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
          <thead>
            <tr style={{ color: "#64748B", textAlign: "left", fontSize: 10.5, textTransform: "uppercase" }}>
              <th style={{ padding: "5px 6px" }}>Month</th>
              <th style={{ padding: "5px 6px" }}>Description</th>
              <th style={{ padding: "5px 6px", textAlign: "right" }}>Amount</th>
            </tr>
          </thead>
          <tbody>
            {items.map((it, i) => (
              <tr key={i} style={{ borderTop: "1px solid #EEE7D6" }}>
                <td style={{ padding: "5px 6px", color: "#64748B", whiteSpace: "nowrap" }}>{periodLabel(it.date)}</td>
                <td style={{ padding: "5px 6px" }}>{it.desc}</td>
                <td className="f-mono" style={{ padding: "5px 6px", textAlign: "right" }}>{rand(it.amount)}</td>
              </tr>
            ))}
            <tr style={{ borderTop: "2px solid #1B2A38" }}>
              <td style={{ padding: "6px", fontWeight: 700 }} colSpan={2}>Total miscellaneous</td>
              <td className="f-mono" style={{ padding: "6px", textAlign: "right", fontWeight: 700 }}>{rand(total)}</td>
            </tr>
          </tbody>
        </table>
      )}
    </Card>
  );
}

// Dependency-free SVG line chart: CoJ bulk usage vs combined resident usage.
// `bulk` and `units` are arrays aligned to `months` (values may be null).
function UsageLineChart({ title, months, bulk, units, common }) {
  const cmn = common || [];
  const W = 680, H = 250, padL = 56, padR = 14, padT = 14, padB = 36;
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const vals = [...bulk, ...units, ...cmn].filter((v) => v != null && !isNaN(v));
  const rawMax = Math.max(1, ...vals);
  const pow = Math.pow(10, Math.floor(Math.log10(rawMax)));
  const niceMax = Math.ceil(rawMax / pow) * pow || 1;
  const n = months.length;
  const x = (i) => padL + (n <= 1 ? plotW / 2 : (i / (n - 1)) * plotW);
  const y = (v) => padT + plotH - (v / niceMax) * plotH;
  const fmt = (v) => Math.round(v).toLocaleString("en-ZA");
  const ticks = 4;
  const line = (arr) => arr.map((v, i) => (v == null || isNaN(v) ? null : `${x(i).toFixed(1)},${y(v).toFixed(1)}`)).filter(Boolean).join(" ");
  const A = "#B5651D", B = "#2F5D50", C = "#2A3E7A";
  const dots = (arr, color, hollow) => arr.map((v, i) => (v == null || isNaN(v) ? null : <circle key={i} cx={x(i)} cy={y(v)} r="2.6" fill={hollow ? "#F6F1E7" : color} stroke={color} strokeWidth={hollow ? 1.4 : 0} />));
  return (
    <Card style={{ marginTop: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6, flexWrap: "wrap", gap: 8 }}>
        <div style={{ fontWeight: 700, fontSize: 13.5 }}>{title}</div>
        <div style={{ display: "flex", gap: 14, fontSize: 11.5, color: "#64748B", flexWrap: "wrap" }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><span style={{ width: 14, height: 3, background: A, display: "inline-block" }} />CoJ bulk meter</span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><span style={{ width: 14, height: 3, background: B, display: "inline-block" }} />Resident units combined</span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><span style={{ width: 14, height: 0, borderTop: `2px dotted ${C}`, display: "inline-block" }} />Units + common property</span>
        </div>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={title} style={{ display: "block" }}>
        {Array.from({ length: ticks + 1 }).map((_, t) => {
          const v = (niceMax / ticks) * t;
          const yy = y(v);
          return (
            <g key={t}>
              <line x1={padL} y1={yy} x2={W - padR} y2={yy} stroke="#E4DCC8" strokeWidth="1" />
              <text x={padL - 6} y={yy + 3} textAnchor="end" fontSize="9" fill="#94A0AC">{fmt(v)}</text>
            </g>
          );
        })}
        {months.map((m, i) => (
          <text key={m.key} x={x(i)} y={H - padB + 16} textAnchor="middle" fontSize="9" fill="#94A0AC">{m.label}</text>
        ))}
        <polyline points={line(bulk)} fill="none" stroke={A} strokeWidth="2" />
        <polyline points={line(units)} fill="none" stroke={B} strokeWidth="2" />
        <polyline points={line(cmn)} fill="none" stroke={C} strokeWidth="2" strokeDasharray="5 3" />
        {dots(bulk, A)}
        {dots(units, B)}
        {dots(cmn, C, true)}
      </svg>
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
        <br />Water — {verdict(waterDiff, "kL", alloc.commonPropertyWaterKl, waterGap)}
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
            Actual metered common-area gap valued at {rand(alloc.commonWaterCostTotal)}, vs. the suggested "Common Property Water" figure from the configurable {alloc.commonPropertyWaterKl}kL standard: {rand(alloc.commonPropertyWaterCost)} total ({rand(alloc.commonPropertyWaterPerUnit)}/unit) — a reference for the manual levy grid, not billed automatically.
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
function LevySetup({ levyBreakdown, setLevyBreakdown, waterBands, electricityRate, vatRate, commonPropertyElectricityKwh, commonPropertyWaterKl, councilInvoice }) {
  // VAT-inclusive suggested values from the confirmed rules (bill figures +
  // rates). They pre-fill via the button below but every cell stays editable.
  const suggestions = computeSuggestedLevyItems({ waterBands, electricityRate, vatRate, commonPropertyElectricityKwh, commonPropertyWaterKl, councilInvoice });
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
  const [unit, setUnit] = useState("U1");
  const [desc, setDesc] = useState("");
  const [amount, setAmount] = useState("");

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
        .insert({ unit_id: unitRow.dbId, period: ACTIVE_PERIOD, description, amount: amt })
        .select("id")
        .single();
      if (error) throw error;
      setAdditionalCharges((prev) => ({
        ...prev,
        [unit]: [...(prev[unit] || []), { id: data.id, description, amount: amt }],
      }));
      setDesc(""); setAmount("");
    } catch (err) {
      console.error("Saving additional charge failed:", err);
      setDbError("Couldn't save the charge — see browser console.");
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
  const [date, setDate] = useState("");
  const [category, setCategory] = useState(OPS_EXPENSE_CATEGORIES[0]);
  const [amount, setAmount] = useState("");
  const [notes, setNotes] = useState("");

  const [dbError, setDbError] = useState(null);

  const addExpense = async () => {
    if (!date || !amount) return;
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
      setOpsExpenses((prev) => [...prev, { id: data.id, date, category, amount: amt, notes }]);
      setDate(""); setAmount(""); setNotes("");
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
  // Each expense counts in the month of its logged date (expense_date), not the
  // month currently being viewed. The page is period-scoped like the rest of the
  // app: the viewing period decides which month's expenses are shown/totalled.
  const monthKey = String(period).slice(0, 7);
  const monthExpenses = opsExpenses.filter((e) => String(e.date).slice(0, 7) === monthKey);
  const monthTotal = monthExpenses.reduce((s, e) => s + e.amount, 0);
  const allTotal = opsExpenses.reduce((s, e) => s + e.amount, 0);
  const byCategory = OPS_EXPENSE_CATEGORIES.map((cat) => ({
    cat, total: monthExpenses.filter((e) => e.category === cat).reduce((s, e) => s + e.amount, 0),
  })).filter((c) => c.total > 0);

  return (
    <>
      <h1 className="f-display" style={{ fontSize: 24, marginBottom: 4 }}>Body corp operating expenses</h1>
      <p style={{ color: "#64748B", fontSize: 13.5, marginBottom: 18 }}>
        Costs the Body Corp pays directly — CSOS, fire extinguisher servicing, and the actual Garden Service / Blockwatch spend. Never billed to a unit; tracked here for the analytics dashboard and the September annual report.
      </p>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 14, marginBottom: 18 }}>
        <Stat label={`${periodLabel(period)} total`} value={rand(monthTotal)} accent="#B5651D" />
        <Stat label="All logged (all months)" value={rand(allTotal)} />
        {byCategory.slice(0, 1).map((c) => (
          <Stat key={c.cat} label={`${c.cat} — ${periodLabel(period)}`} value={rand(c.total)} />
        ))}
      </div>

      <Card>
        <div style={{ fontWeight: 700, fontSize: 13.5, marginBottom: 10 }}>Log an expense</div>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={{ ...inputStyle, width: 150, textAlign: "left" }} />
          <select value={category} onChange={(e) => setCategory(e.target.value)} style={{ padding: "8px 10px", borderRadius: 6, border: "1px solid #D8D0BE" }}>
            {OPS_EXPENSE_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <input placeholder="Amount (R)" type="number" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} style={{ ...inputStyle, width: 130, textAlign: "left" }} />
          <input placeholder="Notes (e.g. who paid, proof on file)" value={notes} onChange={(e) => setNotes(e.target.value)} style={{ ...inputStyle, width: 260, textAlign: "left" }} />
          <button style={primaryBtn} onClick={addExpense}>Add expense</button>
        </div>
        {dbError && <div style={{ marginTop: 10, fontSize: 12.5, color: "#B5651D", fontWeight: 600 }}>{dbError}</div>}
      </Card>

      <Card style={{ marginTop: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 8, marginBottom: 10 }}>
          <div style={{ fontWeight: 700, fontSize: 13.5 }}>Expense log — {periodLabel(period)}</div>
          <div style={{ fontSize: 11.5, color: "#94A0AC" }}>Each expense appears under the month of its date. Change the viewing period above to see other months.</div>
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
              <tr><td colSpan={5} style={{ padding: "12px 8px", color: "#94A0AC", fontSize: 12.5 }}>No body corp expenses logged for {periodLabel(period)}.</td></tr>
            ) : monthExpenses.map((e) => (
              <tr key={e.id} style={{ borderTop: "1px solid #EEE7D6" }}>
                <td className="f-mono" style={{ padding: "8px" }}>{e.date}</td>
                <td style={{ padding: "8px" }}>{e.category}</td>
                <td style={{ padding: "8px", color: "#64748B" }}>{e.notes}</td>
                <td className="f-mono" style={{ padding: "8px", textAlign: "right" }}>{rand(e.amount)}</td>
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
  waterBands, setWaterBands, electricityRate, setElectricityRate, vatRate, setVatRate,
  commonPropertyElectricityKwh, setCommonPropertyElectricityKwh,
  commonPropertyWaterKl, setCommonPropertyWaterKl,
}) {
  const updateBand = (id, field, value) => {
    setWaterBands((prev) => prev.map((b) => (b.id === id ? { ...b, [field]: parseFloat(value) || 0 } : b)));
  };
  const increasePct = (b) => (b.rate2024 > 0 ? ((b.rate2025 - b.rate2024) / b.rate2024) * 100 : null);
  const [saveStatus, setSaveStatus] = useState("idle"); // idle | saving | saved | error
  const save = async () => {
    setSaveStatus("saving");
    try {
      await saveTariffsToDb({ waterBands, electricityRate, vatRate, commonPropertyElectricityKwh, commonPropertyWaterKl });
      setSaveStatus("saved");
      setTimeout(() => setSaveStatus("idle"), 2500);
    } catch (err) {
      console.error("Saving tariffs failed:", err);
      setSaveStatus("error");
    }
  };

  return (
    <>
      <h1 className="f-display" style={{ fontSize: 24, marginBottom: 4 }}>Tariffs & rates</h1>
      <p style={{ color: "#64748B", fontSize: 13.5, marginBottom: 18 }}>
        These figures drive every water and electricity calculation across the app. Editing a rate here updates readings, allocation, statements, and reconciliation immediately.
      </p>

      <Card>
        <div style={{ fontWeight: 700, fontSize: 13.5, marginBottom: 4 }}>Water — increasing block tariff (R / kL)</div>
        <p style={{ fontSize: 12, color: "#94A0AC", marginBottom: 12 }}>
          Each unit is charged band-by-band on its own consumption. The active rate used in calculations is 2025/2026.
        </p>
        <table style={{ width: "100%", fontSize: 13, borderCollapse: "collapse", tableLayout: "fixed" }}>
          <thead>
            <tr style={{ color: "#64748B", fontSize: 10.5, textTransform: "uppercase" }}>
              <th style={{ padding: "6px 6px", textAlign: "left", width: "16%" }}>Band</th>
              <th style={{ padding: "6px 6px", textAlign: "left", width: "27%" }}>2024/2025</th>
              <th style={{ padding: "6px 6px", textAlign: "left", color: "#1B2A38", width: "30%" }}>2025/2026 (active)</th>
              <th style={{ padding: "6px 6px", textAlign: "right", width: "27%" }}>Increase %</th>
            </tr>
          </thead>
          <tbody>
            {waterBands.map((b) => {
              const pct = increasePct(b);
              return (
                <tr key={b.id} style={{ borderTop: "1px solid #EEE7D6" }}>
                  <td style={{ padding: "8px 6px", fontWeight: 600 }} className="f-mono">{b.label}</td>
                  <td style={{ padding: "4px 6px" }}>
                    <input
                      type="number" step="0.01" value={b.rate2024}
                      onChange={(e) => updateBand(b.id, "rate2024", e.target.value)}
                      style={{ ...inputStyle, width: "100%" }}
                    />
                  </td>
                  <td style={{ padding: "4px 6px" }}>
                    <input
                      type="number" step="0.01" value={b.rate2025}
                      onChange={(e) => updateBand(b.id, "rate2025", e.target.value)}
                      style={{ ...inputStyle, width: "100%", borderColor: "#2F5D50", fontWeight: 700 }}
                    />
                  </td>
                  <td className="f-mono" style={{ padding: "8px 6px", textAlign: "right", color: "#B5651D" }}>
                    {pct === null ? "—" : `${pct.toFixed(2)}%`}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>

      <Card style={{ marginTop: 16 }}>
        <div style={{ fontWeight: 700, fontSize: 13.5, marginBottom: 4 }}>Electricity — flat rate</div>
        <p style={{ fontSize: 12, color: "#94A0AC", marginBottom: 12 }}>
          Single rate applied to every kWh of metered and common-area electricity usage.
        </p>
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
            <input
              type="number" step="1" value={commonPropertyWaterKl}
              onChange={(e) => setCommonPropertyWaterKl(parseFloat(e.target.value) || 0)}
              style={{ ...inputStyle, width: 110, borderColor: "#2F5D50", fontWeight: 700 }}
            />
            <span style={{ fontSize: 11.5, color: "#94A0AC" }}>kL / month, billed on the real tariff scale above, split 7 ways</span>
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
            Common Property Water: {rand(calcWaterCost(commonPropertyWaterKl, waterBands))} total · {rand(calcWaterCost(commonPropertyWaterKl, waterBands) / UNITS.length)} per unit
            <br />
            Common Property Electricity: {rand(commonPropertyElectricityKwh * electricityRate)} total · {rand((commonPropertyElectricityKwh * electricityRate) / UNITS.length)} per unit
          </div>
        </div>
      </Card>

      <div style={{ marginTop: 16, display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 10 }}>
        {saveStatus === "saved" && <span style={{ fontSize: 12.5, color: "#2F5D50", fontWeight: 600 }}>✓ Saved to database</span>}
        {saveStatus === "error" && <span style={{ fontSize: 12.5, color: "#B5651D", fontWeight: 600 }}>Couldn't save — see browser console</span>}
        <button style={primaryBtn} onClick={save} disabled={saveStatus === "saving"}>
          {saveStatus === "saving" ? "Saving…" : "Save tariffs & rates"}
        </button>
      </div>
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
function reconcileUnits(rows, bankTxns, remittanceDeductions = {}, remittanceAdvices = {}) {
  return rows.map((r) => {
    const ded = remittanceDeductions[r.id];
    const adv = remittanceAdvices[r.id];
    const expected = ded && ded.approved ? r.total - ded.amount : r.total;
    const txn = bankTxns.find((t) => t.category === "resident_payment" && t.matchedUnit === r.id);
    if (!txn) return { unit: r, txn: null, status: "outstanding", expected, received: 0, diff: undefined, settled: false, ded, adv };
    const diff = Math.round((txn.amount - expected) * 100) / 100;
    const withinTolerance = Math.abs(diff) < RECON_TOLERANCE;
    const settled = withinTolerance || !!txn.reviewed;
    const status = withinTolerance ? "paid" : (txn.reviewed ? "resolved" : "review");
    return { unit: r, txn, status, diff, expected, received: txn.amount, settled, ded, adv };
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

// Manual expense tag for a bank line, feeding the Financials dashboard and
// annual report. Credits are auto-classified (shown as a muted label); debits
// get a P&L category dropdown. A combined CoJ payment additionally gets two
// inputs to split it into its water and electricity portions.
function ExpenseTagControls({ txn, draft, onChange }) {
  if (txn.direction === "credit") {
    const label = txn.category === "resident_payment" ? "→ Owner contributions"
      : txn.category === "interest" ? "→ Interest earned" : "→ Other credits";
    return <span style={{ color: "#94A0AC", fontSize: 11 }}>{label}</span>;
  }
  // Controlled by the parent's tag draft — nothing persists until "Save tags".
  const cat = draft?.expenseCategory ?? "";
  const isCoj = txn.category === "council_payment" || cat === "CoJ Water" || cat === "CoJ Electricity";
  const dirty = draft?.dirty;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <select
        value={cat}
        onChange={(e) => onChange({ expenseCategory: e.target.value })}
        style={{ fontSize: 11.5, padding: "4px 6px", borderRadius: 5, border: `1px solid ${dirty ? "#B5651D" : "#D8D0BE"}`, background: "#fff", minWidth: 150 }}
      >
        <option value="">— tag —</option>
        {EXPENSE_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
      </select>
      {isCoj && (
        <div style={{ display: "flex", gap: 4 }}>
          <input
            type="text" inputMode="decimal" placeholder="Water R" title="CoJ water portion of this payment"
            value={draft?.cojWater ?? ""}
            onChange={(e) => onChange({ cojWater: e.target.value })}
            style={{ width: 66, fontSize: 11, padding: "3px 5px", borderRadius: 5, border: "1px solid #D8D0BE" }}
          />
          <input
            type="text" inputMode="decimal" placeholder="Elec R" title="CoJ electricity portion of this payment"
            value={draft?.cojElec ?? ""}
            onChange={(e) => onChange({ cojElec: e.target.value })}
            style={{ width: 66, fontSize: 11, padding: "3px 5px", borderRadius: 5, border: "1px solid #D8D0BE" }}
          />
        </div>
      )}
    </div>
  );
}

function Reconciliation({
  alloc, period, remittanceDeductions, setRemittanceDeductions, remittanceAdvices,
  bankTxns, onReviewTxn, onTagTxn, onUploadStatement, statementMeta, statementStatus, statementError,
}) {
  const fileInputRef = useRef(null);

  // ----- Expense tags: draft-then-save -----
  // Tags are edited into a local draft and only written to the database when
  // the trustee clicks "Save tags". Drafts re-initialise from the loaded data
  // whenever the period (and therefore bankTxns / deductions) changes, so
  // switching periods never silently loses or mixes up tags.
  const txnKey = (t) => t.dbId || `${t.date}|${t.desc}|${t.amount}|${t.direction}`;
  const buildTagDrafts = (txns) => {
    const d = {};
    txns.forEach((t) => {
      if (t.direction !== "debit") return;
      d[txnKey(t)] = {
        expenseCategory: t.expenseCategory || "",
        cojWater: t.cojWater == null ? "" : String(t.cojWater),
        cojElec: t.cojElec == null ? "" : String(t.cojElec),
      };
    });
    return d;
  };
  const buildDedDrafts = (map) => {
    const d = {};
    Object.entries(map).forEach(([uid, ded]) => {
      const items = ded.items && ded.items.length ? ded.items : (ded.amount ? [{ expenseCategory: ded.expenseCategory }] : []);
      d[uid] = items.map((it) => it.expenseCategory || "");
    });
    return d;
  };
  const [tagDrafts, setTagDrafts] = useState(() => buildTagDrafts(bankTxns));
  const [dedDrafts, setDedDrafts] = useState(() => buildDedDrafts(remittanceDeductions));
  const [savingTags, setSavingTags] = useState(false);
  const [savedNote, setSavedNote] = useState(false);
  useEffect(() => { setTagDrafts(buildTagDrafts(bankTxns)); }, [bankTxns]);
  useEffect(() => { setDedDrafts(buildDedDrafts(remittanceDeductions)); }, [remittanceDeductions]);

  const updateTagDraft = (key, patch) => setTagDrafts((prev) => ({ ...prev, [key]: { ...prev[key], ...patch } }));
  const updateDedDraft = (uid, idx, value) =>
    setDedDrafts((prev) => ({ ...prev, [uid]: (prev[uid] || []).map((v, i) => (i === idx ? value : v)) }));

  const parseOrNull = (s) => (String(s).trim() === "" ? null : parseAmount(s));
  const numEq = (a, b) => (a == null && b == null ? true : a != null && b != null && round2(a) === round2(b));
  const changedTxns = bankTxns.filter((t) => {
    if (t.direction !== "debit") return false;
    const d = tagDrafts[txnKey(t)];
    if (!d) return false;
    return (d.expenseCategory || "") !== (t.expenseCategory || "")
      || !numEq(parseOrNull(d.cojWater), t.cojWater ?? null)
      || !numEq(parseOrNull(d.cojElec), t.cojElec ?? null);
  });
  const changedDedUnits = Object.keys(dedDrafts).filter((uid) => {
    const ded = remittanceDeductions[uid];
    if (!ded) return false;
    const items = ded.items && ded.items.length ? ded.items : [];
    return (dedDrafts[uid] || []).some((v, i) => (v || "") !== ((items[i] && items[i].expenseCategory) || ""));
  });
  const tagDirtyCount = changedTxns.length + changedDedUnits.length;

  const saveAllTags = async () => {
    setSavingTags(true);
    try {
      for (const t of changedTxns) {
        const d = tagDrafts[txnKey(t)];
        await onTagTxn(t, {
          expenseCategory: d.expenseCategory || null,
          cojWater: parseOrNull(d.cojWater),
          cojElec: parseOrNull(d.cojElec),
        });
      }
      for (const uid of changedDedUnits) {
        const ded = remittanceDeductions[uid];
        const baseItems = ded.items && ded.items.length ? ded.items : (ded.amount ? [{ amount: ded.amount, comment: ded.comment || "" }] : []);
        const items = baseItems.map((it, i) => ({ ...it, expenseCategory: (dedDrafts[uid] || [])[i] || null }));
        if (ded.dbId) {
          const client = await ensureSupabaseClient();
          const { error } = await client.from("remittance_advices").update({ deductions: items }).eq("id", ded.dbId);
          if (error) throw error;
        }
        setRemittanceDeductions((prev) => ({ ...prev, [uid]: { ...prev[uid], items } }));
      }
      setSavedNote(true);
      setTimeout(() => setSavedNote(false), 2500);
    } catch (err) {
      console.error("Saving tags failed:", err);
      alert("Saving tags failed: " + (err.message || err));
    } finally {
      setSavingTags(false);
    }
  };

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

  const matches = reconcileUnits(alloc.rows, bankTxns, remittanceDeductions, remittanceAdvices || {});

  const otherTxns = bankTxns.filter((t) => !(t.category === "resident_payment" && t.matchedUnit));
  // Outstanding review work = unmatched "needs review" lines not yet handled,
  // plus per-unit variances not yet marked resolved.
  const needsReviewCount =
    bankTxns.filter((t) => t.category === "needs_review" && !t.reviewed).length +
    matches.filter((m) => m.status === "review").length;

  return (
    <>
      <h1 className="f-display" style={{ fontSize: 24, marginBottom: 4 }}>Bank reconciliation — {periodLabel(period)} statements</h1>
      <p style={{ color: "#64748B", fontSize: 13.5, marginBottom: 18 }}>
        {periodLabel(period)} levies are paid the following month, so these statements are matched against the <strong>{periodLabel(nextPeriod(period))} bank statement</strong>, by payment reference (Cor/Unit + number) against submitted remittance advices. Approved Body Corp expense deductions reduce the expected payment before comparing. Any "needs review" line or variance can be noted and marked resolved below.
      </p>

      {(tagDirtyCount > 0 || savedNote) && (
        <div className="no-print" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, background: tagDirtyCount > 0 ? "#FBF6EC" : "#E4EFEA", border: `1px solid ${tagDirtyCount > 0 ? "#EAD9C4" : "#BBD8CC"}`, borderRadius: 8, padding: "10px 14px", marginBottom: 16 }}>
          <span style={{ fontSize: 12.5, fontWeight: 600, color: tagDirtyCount > 0 ? "#8A6D1E" : "#2F5D50" }}>
            {tagDirtyCount > 0
              ? `${tagDirtyCount} unsaved expense tag change${tagDirtyCount > 1 ? "s" : ""} — save before switching period, or they’ll be lost.`
              : "✓ Tags saved."}
          </span>
          {tagDirtyCount > 0 && (
            <button style={primaryBtn} disabled={savingTags} onClick={saveAllTags}>
              {savingTags ? "Saving…" : "Save tags"}
            </button>
          )}
        </div>
      )}

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
                <td className="f-mono" style={{ padding: "9px 8px", fontSize: 12 }}>{m.txn ? m.txn.ref : "—"}</td>
                <td className="f-mono" style={{ padding: "9px 8px" }}>{m.txn ? rand(m.txn.amount) : "—"}</td>
                <td className="f-mono" style={{ padding: "9px 8px", color: m.diff ? "#B5651D" : "#2F5D50" }}>
                  {m.diff !== undefined ? rand(m.diff) : "—"}
                </td>
                <td style={{ padding: "9px 8px" }}>
                  <StatusChip status={m.status} />
                  {m.txn && (m.status === "review" || m.status === "resolved") && (
                    <div style={{ marginTop: 6 }}>
                      <ReviewControls txn={m.txn} onReviewTxn={onReviewTxn} />
                    </div>
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
                            <th style={{ padding: "2px 6px" }}>Expense (P&amp;L)</th>
                            <th style={{ padding: "2px 6px", textAlign: "right" }}>Amount</th>
                          </tr>
                        </thead>
                        <tbody>
                          {dedItems.map((it, i) => (
                            <tr key={i} style={{ borderTop: "1px solid #EEE7D6" }}>
                              <td style={{ padding: "4px 6px", color: "#64748B" }}>{it.comment || "Deduction"}</td>
                              <td style={{ padding: "4px 6px" }}>
                                <select
                                  value={(dedDrafts[m.unit.id] || [])[i] || ""}
                                  onChange={(e) => updateDedDraft(m.unit.id, i, e.target.value)}
                                  style={{ fontSize: 11, padding: "3px 5px", borderRadius: 5, border: `1px solid ${((dedDrafts[m.unit.id] || [])[i] || "") !== (it.expenseCategory || "") ? "#B5651D" : "#D8D0BE"}`, background: "#fff", minWidth: 140 }}
                                >
                                  <option value="">— tag —</option>
                                  {EXPENSE_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                                </select>
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
                        Deductions only reduce the expected amount once approved. Tag each to a P&amp;L line and click “Save tags” — approved, tagged deductions are added to that expense line in the annual report. Proof documents are shown under “Remittance advice”.
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
          {needsReviewCount > 0 && (
            <div style={{ fontSize: 12, color: "#8A6D1E", fontWeight: 600 }}>{needsReviewCount} to review</div>
          )}
        </div>
        <p style={{ fontSize: 12, color: "#64748B", marginBottom: 12 }}>
          Every line from the statement, categorised — council payments, interest, and bank charges are captured here too, not just resident levy payments, so nothing is silently dropped.
        </p>
        <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", fontSize: 12.5, borderCollapse: "collapse", minWidth: 820 }}>
          <thead>
            <tr style={{ color: "#64748B", textAlign: "left", fontSize: 10.5, textTransform: "uppercase" }}>
              <th style={{ padding: "6px 8px" }}>Date</th>
              <th style={{ padding: "6px 8px" }}>Description</th>
              <th style={{ padding: "6px 8px", textAlign: "right" }}>Amount</th>
              <th style={{ padding: "6px 8px" }}>Category</th>
              <th style={{ padding: "6px 8px" }}>Unit</th>
              <th style={{ padding: "6px 8px" }}>Expense (P&amp;L)</th>
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
                <td className="f-mono" style={{ padding: "8px" }}>{t.matchedUnit || "—"}</td>
                <td style={{ padding: "8px" }}>
                  <ExpenseTagControls
                    txn={t}
                    draft={{ ...(tagDrafts[txnKey(t)] || {}), dirty: changedTxns.includes(t) }}
                    onChange={(patch) => updateTagDraft(txnKey(t), patch)}
                  />
                </td>
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
    { desc: `Water`, curr: r.wCurr, prev: r.wPrev, cons: `${r.wUse.toFixed(2)} kL`, rate: "", due: r.waterCost },
  ];

  return (
    <div className="print-area statement-paper" style={{
      background: "#F6F1E7", border: "1px solid #D8D0BE", borderRadius: 4, padding: 32,
      boxShadow: "0 1px 0 #fff inset", maxWidth: 680, width: "100%", position: "relative",
    }}>
      {r.reconciled && (
        <div className="paid-stamp" aria-hidden="true" style={{
          position: "absolute", top: 132, left: "50%",
          transform: "translateX(-50%) rotate(-13deg)",
          mixBlendMode: "multiply", pointerEvents: "none", textAlign: "center", zIndex: 2,
        }}>
          <div className="stamp-box" style={{ border: "3px solid #2F5D50", borderRadius: 9, padding: "7px 20px 6px", opacity: 0.9 }}>
            <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 7, letterSpacing: 2, color: "#2F5D50", fontWeight: 600, marginBottom: 2 }}>EL CORAZON BODY CORP</div>
            <div className="f-display" style={{ fontWeight: 700, fontSize: 36, lineHeight: 1, letterSpacing: 3, color: "#2F5D50" }}>PAID</div>
            <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 8, letterSpacing: 1, color: "#2F5D50", fontWeight: 600, marginTop: 3 }}>{periodLabel(period).toUpperCase()} · RECONCILED</div>
          </div>
        </div>
      )}
      <div className="wrap-sm" style={{ display: "flex", justifyContent: "space-between", gap: 12, borderBottom: "2px solid #1B2A38", paddingBottom: 12, marginBottom: 18 }}>
        <div>
          <div className="f-display" style={{ fontSize: 19, fontWeight: 700 }}>El Corazon Body Corporate</div>
          <div style={{ fontSize: 11.5, color: "#64748B" }}>Levy & utility statement — {periodLabel(period)}</div>
        </div>
        <div style={{ textAlign: "right", fontSize: 11.5 }}>
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
      <div className="scroll-x">
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, minWidth: 440 }}>
        <thead>
          <tr style={{ textAlign: "right", color: "#64748B", fontSize: 10, textTransform: "uppercase" }}>
            <th style={{ padding: "0 6px 8px 0", textAlign: "left" }}>Description</th>
            <th style={{ padding: "0 6px 8px" }}>Current<br/>reading</th>
            <th style={{ padding: "0 6px 8px" }}>Previous<br/>reading</th>
            <th style={{ padding: "0 6px 8px" }}>Consumption</th>
            <th style={{ padding: "0 6px 8px" }}>Rate</th>
            <th style={{ padding: "0 0 8px 6px" }}>Due</th>
          </tr>
        </thead>
        <tbody>
          {utilityRows.map((row, i) => (
            <tr key={i} style={{ borderTop: "1px solid #E4DCC8" }}>
              <td style={{ padding: "7px 6px 7px 0", textAlign: "left" }}>{row.desc}</td>
              <td className="f-mono" style={{ padding: "7px 6px", textAlign: "right", color: "#64748B" }}>{row.curr}</td>
              <td className="f-mono" style={{ padding: "7px 6px", textAlign: "right", color: "#64748B" }}>{row.prev}</td>
              <td className="f-mono" style={{ padding: "7px 6px", textAlign: "right" }}>{row.cons}</td>
              <td className="f-mono" style={{ padding: "7px 6px", textAlign: "right", color: "#64748B" }}>{row.rate}</td>
              <td className="f-mono" style={{ padding: "7px 0 7px 6px", textAlign: "right", fontWeight: 600 }}>{rand(row.due)}</td>
            </tr>
          ))}
          <tr style={{ borderTop: "1px solid #1B2A38" }}>
            <td colSpan={5} style={{ padding: "7px 6px 7px 0", textAlign: "left", fontWeight: 600 }}>Sub-Total</td>
            <td className="f-mono" style={{ padding: "7px 0 7px 6px", textAlign: "right", fontWeight: 600 }}>{rand(r.subTotal)}</td>
          </tr>
          <tr>
            <td colSpan={5} style={{ padding: "5px 6px 5px 0", textAlign: "left" }}>VAT ({vatPct}%)</td>
            <td className="f-mono" style={{ padding: "5px 0 5px 6px", textAlign: "right" }}>{rand(r.vat)}</td>
          </tr>
          <tr style={{ borderTop: "1px solid #1B2A38" }}>
            <td colSpan={5} style={{ padding: "7px 6px 7px 0", textAlign: "left", fontWeight: 700 }}>Total Due</td>
            <td className="f-mono" style={{ padding: "7px 0 7px 6px", textAlign: "right", fontWeight: 700 }}>{rand(r.utilitiesDue)}</td>
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
                <td className="f-mono" style={{ padding: "5px 0 5px 6px", textAlign: "right" }}>{rand(r.levyItems?.[item] || 0)}</td>
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
                  <td className="f-mono" style={{ padding: "5px 0 5px 6px", textAlign: "right" }}>{rand(e.amount)}</td>
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
      <div style={{ display: "flex", justifyContent: "space-between", borderTop: "2px solid #1B2A38", marginTop: 18, paddingTop: 12 }}>
        <div className="f-display" style={{ fontWeight: 700, fontSize: 15 }}>Total amount due by {periodDueLabel(period)}</div>
        <div className="f-mono" style={{ fontWeight: 700, fontSize: 15 }}>{rand(r.total)}</div>
      </div>

      {/* Section 3 — banking details */}
      <div style={{ marginTop: 22, borderTop: "1px dashed #D8D0BE", paddingTop: 14 }}>
        <div style={{ fontWeight: 700, fontSize: 12.5, marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.4, color: "#64748B" }}>
          El Corazon Banking Details
        </div>
        <div className="bank-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", rowGap: 4, fontSize: 12.5 }}>
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
    <div className="f-body resident-scope" style={{ minHeight: "100vh", background: "#EFEAE0", color: "#1B2A38" }}>
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
  const [deductionItems, setDeductionItems] = useState([{ amount: "", comment: "" }]);
  const [amountPaid, setAmountPaid] = useState("");
  const [datePaid, setDatePaid] = useState("");
  const [notifyStatus, setNotifyStatus] = useState(null); // null | "sending" | "sent" | "failed" | "save-failed"
  const fileInputRef = useRef(null);
  const r = statementRow || (alloc && alloc.rows.find((x) => x.id === selectedUnit));
  const deductionTotal = deductionItems.reduce((s, d) => s + parseAmount(d.amount), 0);
  const amountToPay = r ? r.total - deductionTotal : 0;

  const updateDeductionItem = (i, field, value) =>
    setDeductionItems((prev) => prev.map((d, idx) => (idx === i ? { ...d, [field]: value } : d)));
  const addDeductionItem = () => setDeductionItems((prev) => [...prev, { amount: "", comment: "" }]);
  const removeDeductionItem = (i) =>
    setDeductionItems((prev) => (prev.length <= 1 ? [{ amount: "", comment: "" }] : prev.filter((_, idx) => idx !== i)));
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
        deductions: deductionItems.map((d) => ({ amount: parseAmount(d.amount), comment: d.comment.trim() })),
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
    <main className="resident-main" style={{ maxWidth: 680, margin: "0 auto", padding: "28px 20px" }}>
      <div className="no-print wrap-sm" style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10, marginBottom: 14 }}>
        <h1 className="f-display" style={{ fontSize: 22 }}>Your statement</h1>
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
      <div className="no-print resident-actions" style={{ marginTop: 12, display: "flex", justifyContent: "flex-end" }}>
        <button style={secondaryBtn} onClick={printStatement}>Download PDF</button>
      </div>

      {allowSubmit && (
      <div className="no-print">
      {existing && (
        <Card style={{ marginTop: 20, background: existing.approved ? "#EAF2EE" : "#FBF1E9", border: `1px solid ${existing.approved ? "#BFE0D3" : "#EAD9C4"}` }}>
          <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 6 }}>
            {existing.approved ? "✓ Deduction approved by trustee" : "⏳ Deduction submitted — pending trustee approval"}
          </div>
          {/* Deductions grouped by the Body Corp expense category the trustee
              tagged them with, with a subtotal per category. */}
          {(() => {
            const items = existing.items && existing.items.length > 0
              ? existing.items
              : [{ amount: existing.amount, comment: existing.comment, expenseCategory: null }];
            const groups = {};
            items.forEach((it) => {
              const key = it.expenseCategory || "Untagged";
              (groups[key] = groups[key] || { items: [], total: 0 });
              groups[key].items.push(it);
              groups[key].total = round2(groups[key].total + (Number(it.amount) || 0));
            });
            return Object.entries(groups).map(([cat, g]) => (
              <div key={cat} style={{ marginBottom: 8 }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, fontWeight: 700, color: "#8A6D1E", textTransform: "uppercase", letterSpacing: 0.3, borderBottom: "1px solid #EAD9C4", paddingBottom: 2, marginBottom: 3 }}>
                  <span>{cat}</span>
                  <span className="f-mono">−{rand(g.total)}</span>
                </div>
                {g.items.map((it, i) => (
                  <div key={i} style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, marginBottom: 2, paddingLeft: 8 }}>
                    <span style={{ color: "#64748B" }}>{it.comment || "Deduction"}</span>
                    <span className="f-mono" style={{ color: "#B5651D" }}>−{rand(it.amount)}</span>
                  </div>
                ))}
              </div>
            ));
          })()}
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
        <div className="wrap-sm" style={{ display: "flex", gap: 10, marginBottom: 12 }}>
          <input
            placeholder={`Amount paid (R) — default ${r.total.toFixed(2)}`}
            value={amountPaid} onChange={(e) => setAmountPaid(e.target.value)}
            style={{ ...inputStyle, flex: "1 1 200px", minWidth: 0, textAlign: "left" }}
          />
          <input
            placeholder="Date paid" type="date"
            value={datePaid} onChange={(e) => setDatePaid(e.target.value)}
            style={{ ...inputStyle, flex: "1 1 150px", minWidth: 0, textAlign: "left" }}
          />
        </div>

        <div style={{ marginBottom: 12, background: "#FBF1E9", border: "1px solid #EAD9C4", borderRadius: 8, padding: 14 }}>
          <div style={{ fontWeight: 700, fontSize: 12.5, marginBottom: 8 }}>Paid Body Corp expenses out of your own pocket?</div>
          <p style={{ fontSize: 12, color: "#64748B", marginBottom: 12 }}>
            E.g. the garden service or Blockwatch fee. Add each expense on its own line — the total comes off what you pay the Body Corp this month, provided you can produce proof of payment.
          </p>
          {deductionItems.map((item, i) => (
            <div key={i} style={{ display: "flex", gap: 8, marginBottom: 8, alignItems: "flex-start" }}>
              <input
                placeholder="Amount (R)"
                type="text"
                inputMode="decimal"
                value={item.amount}
                onChange={(e) => updateDeductionItem(i, "amount", e.target.value)}
                style={{ ...inputStyle, width: 110, flex: "0 0 auto", textAlign: "left" }}
              />
              <input
                placeholder="What it was for — e.g. 'Garden service, paid 5 June'"
                value={item.comment}
                onChange={(e) => updateDeductionItem(i, "comment", e.target.value)}
                style={{ ...inputStyle, flex: "1 1 0", minWidth: 0, textAlign: "left" }}
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
        <div className="resident-actions" style={{ marginTop: 14, display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 12 }}>
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
