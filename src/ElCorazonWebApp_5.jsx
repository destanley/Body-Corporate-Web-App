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
    const path = `remittance-proofs/${CURRENT_PERIOD}/${unitAppId}-${stamp}-${safeName}`;
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

// ---------- Database load & save (trustee, authenticated) ----------
// The app is single-period for now — June 2026 everywhere in the UI.
const CURRENT_PERIOD = "2026-06-01";
const FY_ACTIVE = "2025/2026";   // maps to the app's rate2025 fields
const FY_PREVIOUS = "2024/2025"; // maps to the app's rate2024 fields

// One parallel fetch of everything the trustee screens need, mapped into the
// exact shapes the app's state already uses. Runs after login; on any error
// the app stays fully usable on the mock defaults.
async function loadAppData(units) {
  const client = await ensureSupabaseClient();
  const unitByDbId = Object.fromEntries(units.map((u) => [u.dbId, u.id]));
  const [bands, elec, vat, levy, manual, usage, charges, expenses, invoice, btxns, bdocs, remits] = await Promise.all([
    client.from("water_tariff_bands").select("*"),
    client.from("electricity_rates").select("*").eq("financial_year", FY_ACTIVE).limit(1),
    client.from("vat_rates").select("*").order("effective_from", { ascending: false }).limit(1),
    client.from("levy_rates").select("*").eq("financial_year", FY_ACTIVE).limit(1),
    client.from("levy_manual_entries").select("*").eq("financial_year", FY_ACTIVE),
    client.from("monthly_usage").select("*").eq("period", CURRENT_PERIOD),
    client.from("additional_charges").select("*").eq("period", CURRENT_PERIOD),
    client.from("ops_expenses").select("*").order("expense_date", { ascending: false }),
    client.from("council_invoices").select("*").eq("period", CURRENT_PERIOD).limit(1),
    client.from("bank_transactions").select("*").eq("period", CURRENT_PERIOD).order("txn_date"),
    client.from("bank_statement_documents").select("*").eq("period", CURRENT_PERIOD).order("uploaded_at", { ascending: false }).limit(1),
    client.from("remittance_advices").select("*").eq("period", CURRENT_PERIOD),
  ]);
  const failed = [bands, elec, vat, levy, manual, usage, charges, expenses, invoice, btxns, bdocs, remits].find((r) => r.error);
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
        date: t.txn_date, desc: t.description_raw, amount: Number(t.amount),
        direction: t.direction, accruedCharge: Number(t.accrued_bank_charge || 0),
        ref: t.description_raw, category: t.category,
        matchedUnit: t.matched_unit_id ? unitByDbId[t.matched_unit_id] || null : null,
        confidence: t.match_confidence, note: t.match_note,
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
      amount: Number(r.deduction_amount),
      comment: r.deduction_comment || "",
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

  const inv = invoice.data[0];
  return {
    bankTxns,
    bankStatementMeta,
    remittanceDeductions,
    remittanceAdvices,
    waterBands: waterBands.length ? waterBands : WATER_BANDS_DEFAULT,
    electricityRate: elec.data[0] ? Number(elec.data[0].rate_per_kwh) : ELECTRICITY_RATE_DEFAULT,
    vatRate: vat.data[0] ? Number(vat.data[0].rate) : VAT_RATE_DEFAULT,
    levyRates: levy.data[0]
      ? { commonPropertyElectricityKwh: Number(levy.data[0].common_property_electricity_kwh) }
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
        unit_id: unitRow.dbId, period: CURRENT_PERIOD,
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

async function saveTariffsToDb({ waterBands, electricityRate, vatRate, commonPropertyElectricityKwh }) {
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
      period: CURRENT_PERIOD,
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
  if (!m) return CURRENT_PERIOD;
  const months = { jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06", jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12" };
  const mm = months[m[2].toLowerCase()];
  if (!mm) return CURRENT_PERIOD;
  return `${CURRENT_PERIOD.slice(0, 4)}-${mm}-${m[1].padStart(2, "0")}`;
}

// Persists a parsed statement wholesale for the period — re-uploading a
// corrected PDF replaces the previous document and its transactions rather
// than duplicating them.
async function saveBankStatementToDb(fileName, txns) {
  const client = await ensureSupabaseClient();
  const unitDbIdByAppId = Object.fromEntries(UNITS.filter((u) => u.dbId).map((u) => [u.id, u.dbId]));
  let { error } = await client.from("bank_transactions").delete().eq("period", CURRENT_PERIOD);
  if (error) throw error;
  ({ error } = await client.from("bank_statement_documents").delete().eq("period", CURRENT_PERIOD));
  if (error) throw error;
  const { data: doc, error: docErr } = await client
    .from("bank_statement_documents")
    .insert({ period: CURRENT_PERIOD, file_name: fileName, parse_status: "parsed", transaction_count: txns.length })
    .select("id")
    .single();
  if (docErr) throw docErr;
  const rows = txns.map((t) => ({
    bank_statement_document_id: doc.id,
    period: CURRENT_PERIOD,
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
  if (RESIDENT_TOKEN) {
    const { data, error } = await client.rpc("submit_remittance", {
      p_token: RESIDENT_TOKEN,
      p_period: CURRENT_PERIOD,
      p_amount_paid: payload.amountPaid,
      p_date_paid: payload.datePaid,
      p_deduction_amount: payload.deduction,
      p_deduction_comment: payload.comment,
      p_proof_names: proofPaths,
    });
    if (error) throw error;
    if (!data) throw new Error("This resident link is no longer valid");
    return { id: data, proofPaths };
  }
  const unitRow = UNITS.find((u) => u.id === unitId);
  if (!unitRow || !unitRow.dbId) throw new Error("Units haven't loaded from the database yet");
  const { error: delErr } = await client.from("remittance_advices").delete().eq("unit_id", unitRow.dbId).eq("period", CURRENT_PERIOD);
  if (delErr) throw delErr;
  const { data, error } = await client
    .from("remittance_advices")
    .insert({
      unit_id: unitRow.dbId, period: CURRENT_PERIOD,
      amount_paid: payload.amountPaid, date_paid: payload.datePaid,
      deduction_amount: payload.deduction || 0, deduction_comment: payload.comment || null,
      deduction_approved: false, proof_document_urls: proofPaths,
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
const OPS_EXPENSE_CATEGORIES = [
  "CSOS Levy",
  "Fire Extinguisher Servicing",
  "Garden Service (actual cost)",
  "Blockwatch (actual cost)",
  "Other",
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
function useAllocation(waterBands, electricityRate, levyBreakdown, vatRate, additionalCharges, commonPropertyElectricityKwh, unitsSource, readings, councilInvoice) {
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
      const waterCost = wUse > freeBandLimit
        ? calcWaterCost(wUse, waterBands)           // rule 1 — free tier applies
        : calcWaterCost(wUse, individualWaterBands); // rule 2 — minimum charge
      const elecCost = eUse * electricityRate;
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
  }, [waterBands, electricityRate, levyBreakdown, vatRate, additionalCharges, commonPropertyElectricityKwh, unitsSource, readings, councilInvoice]);
}

const rand = (n) => `R ${n.toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
// Rounds to 2 decimals as a number (not a string) — used at the point usage
// figures are derived, so floating-point noise from meter-reading subtraction
// (e.g. 6986.03 - 6967.76 = 18.269999999999527) doesn't creep into billing
// calculations or displays.
const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

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
  const [waterBands, setWaterBands] = useState(WATER_BANDS_DEFAULT);
  const [electricityRate, setElectricityRate] = useState(ELECTRICITY_RATE_DEFAULT);
  const [levyBreakdown, setLevyBreakdown] = useState(LEVY_BREAKDOWN_DEFAULT);
  const [vatRate, setVatRate] = useState(VAT_RATE_DEFAULT);
  const [commonPropertyElectricityKwh, setCommonPropertyElectricityKwh] = useState(COMMON_PROPERTY_ELECTRICITY_KWH_DEFAULT);
  const [additionalCharges, setAdditionalCharges] = useState(ADDITIONAL_CHARGES_DEFAULT);
  const [remittanceDeductions, setRemittanceDeductions] = useState({});
  const [remittanceAdvices, setRemittanceAdvices] = useState({});
  const [opsExpenses, setOpsExpenses] = useState(OPS_EXPENSES_DEFAULT);
  const [readings, setReadings] = useState(READINGS);
  const [councilInvoice, setCouncilInvoice] = useState(COUNCIL_INVOICE);
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
    fetchUnitsFromDb()
      .then(async (units) => {
        if (cancelled) return;
        UNITS = units; // swap the module-wide binding — see the UNITS comment
        const data = await loadAppData(units);
        if (cancelled) return;
        setWaterBands(data.waterBands);
        setElectricityRate(data.electricityRate);
        setVatRate(data.vatRate);
        if (data.levyRates) {
          setCommonPropertyElectricityKwh(data.levyRates.commonPropertyElectricityKwh);
        }
        setLevyBreakdown(data.levyBreakdown);
        setReadings(data.readings);
        setAdditionalCharges(data.additionalCharges);
        setOpsExpenses(data.opsExpenses);
        setCouncilInvoice(data.councilInvoice);
        if (data.bankTxns) setBankTxns(data.bankTxns);
        if (data.bankStatementMeta) {
          setBankStatementMeta(data.bankStatementMeta);
          setBankStatementStatus("done");
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
  }, [session]);

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

  const alloc = useAllocation(
    waterBands, electricityRate, levyBreakdown, vatRate, additionalCharges,
    commonPropertyElectricityKwh, unitsSource, readings, councilInvoice
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
      <div className="f-body" style={{ minHeight: "100vh", background: "#EFEAE0", color: "#1B2A38" }}>
        {FONT_IMPORT}
        <ResidentTopBar unit={residentUnit} />
        <ResidentPortal
          alloc={alloc} selectedUnit={residentUnit.id} setSelectedUnit={() => {}} locked
          remittanceDeductions={remittanceDeductions} setRemittanceDeductions={setRemittanceDeductions}
          setRemittanceAdvices={setRemittanceAdvices}
        />
      </div>
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
      <TopBar role={role} setRole={setRole} setTab={setTab} unitsSource={unitsSource} onSignOut={signOutOfApp} />
      {role === "trustee" ? (
        <div style={{ display: "flex" }}>
          <SideNav tab={tab} setTab={setTab} />
          <main style={{ flex: 1, padding: "28px 32px", maxWidth: 1100 }}>
            {tab === "dashboard" && <Dashboard alloc={alloc} setTab={setTab} setSelectedUnit={setSelectedUnit} bankTxns={bankTxns} />}
            {tab === "readings" && <Readings readings={readings} setReadings={setReadings} />}
            {tab === "allocation" && (
              <>
                <UtilityBills councilInvoice={councilInvoice} setCouncilInvoice={setCouncilInvoice} alloc={alloc} />
                <Allocation alloc={alloc} />
              </>
            )}
            {tab === "reconciliation" && (
              <Reconciliation
                alloc={alloc}
                remittanceDeductions={remittanceDeductions}
                setRemittanceDeductions={setRemittanceDeductions}
                remittanceAdvices={remittanceAdvices}
                bankTxns={bankTxns}
                onUploadStatement={handleBankStatementUpload}
                statementMeta={bankStatementMeta}
                statementStatus={bankStatementStatus}
                statementError={bankStatementError}
              />
            )}
            {tab === "statement-preview" && (
              <StatementPreview alloc={alloc} selectedUnit={selectedUnit} setSelectedUnit={setSelectedUnit} />
            )}
            {tab === "tariffs" && (
              <RateSettings
                waterBands={waterBands} setWaterBands={setWaterBands}
                electricityRate={electricityRate} setElectricityRate={setElectricityRate}
                vatRate={vatRate} setVatRate={setVatRate}
                commonPropertyElectricityKwh={commonPropertyElectricityKwh}
                setCommonPropertyElectricityKwh={setCommonPropertyElectricityKwh}
              />
            )}
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
              <OpsExpenses opsExpenses={opsExpenses} setOpsExpenses={setOpsExpenses} />
            )}
          </main>
        </div>
      ) : (
        <ResidentPortal
          alloc={alloc} selectedUnit={selectedUnit} setSelectedUnit={setSelectedUnit}
          remittanceDeductions={remittanceDeductions} setRemittanceDeductions={setRemittanceDeductions}
          setRemittanceAdvices={setRemittanceAdvices}
        />
      )}
    </div>
  );
}

function TopBar({ role, setRole, setTab, unitsSource, onSignOut }) {
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
            Body Corporate · 7 Units · June 2026
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
function ResidentTopBar({ unit }) {
  return (
    <header style={{ background: "#1B2A38", color: "#F6F1E7", padding: "16px 32px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <MeterMark />
        <div>
          <div className="f-display" style={{ fontSize: 20, fontWeight: 600, letterSpacing: 0.2 }}>El Corazon</div>
          <div style={{ fontSize: 11, color: "#B9C4CE", letterSpacing: 1, textTransform: "uppercase" }}>
            Body Corporate · June 2026
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

function Card({ children, style }) {
  return (
    <div style={{ background: "#fff", border: "1px solid #E4DCC8", borderRadius: 10, padding: 20, ...style }}>
      {children}
    </div>
  );
}

function StatusChip({ status }) {
  const map = {
    paid: { bg: "#E4EFEA", color: "#2F5D50", label: "Reconciled" },
    outstanding: { bg: "#F6E7DA", color: "#B5651D", label: "Outstanding" },
    review: { bg: "#F1EAD3", color: "#8A6D1E", label: "Needs review" },
  };
  const s = map[status];
  return (
    <span style={{ background: s.bg, color: s.color, fontSize: 11.5, fontWeight: 700, padding: "3px 9px", borderRadius: 20 }}>
      {s.label}
    </span>
  );
}

// ---------- Dashboard ----------
function Dashboard({ alloc, setTab, setSelectedUnit, bankTxns }) {
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
  const residentPayments = bankTxns.filter((t) => t.category === "resident_payment" && t.matchedUnit);
  const paidRefs = new Set(residentPayments.map((t) => t.matchedUnit));
  const reconciledCount = alloc.rows.filter((r) => paidRefs.has(r.id)).length;
  const totalReceived = residentPayments.reduce((s, t) => s + t.amount, 0);

  return (
    <>
      <h1 className="f-display" style={{ fontSize: 26, marginBottom: 4 }}>June 2026 close-out</h1>
      <p style={{ color: "#64748B", fontSize: 13.5, marginBottom: 22 }}>
        Council invoice loaded · readings captured for 7/7 units · statements not yet sent
      </p>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 14, marginBottom: 22 }}>
        <Stat label="Council invoice" value={rand(totalInvoice)} />
        <Stat label="Total levies raised" value={rand(totalDue)} accent="#2F5D50" />
        <Stat label="Reconciled" value={`${reconciledCount} / 7 units`} accent={reconciledCount === 7 ? "#2F5D50" : "#B5651D"} />
        <Stat label="Outstanding" value={rand(totalDue - totalReceived)} accent="#B5651D" />
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
              const matched = paidRefs.has(r.id);
              return (
                <tr key={r.id} style={{ borderTop: "1px solid #EEE7D6" }}>
                  <td className="f-mono" style={{ padding: "9px 8px", fontWeight: 600 }}>{r.id}</td>
                  <td style={{ padding: "9px 8px" }}>{r.owner}</td>
                  <td className="f-mono" style={{ padding: "9px 8px" }}>{r.pq.toFixed(1)}</td>
                  <td className="f-mono" style={{ padding: "9px 8px", textAlign: "right" }}>{rand(r.total)}</td>
                  <td style={{ padding: "9px 8px" }}>
                    <StatusChip status={matched ? "paid" : "outstanding"} />
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
function Readings({ readings, setReadings }) {
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
      <h1 className="f-display" style={{ fontSize: 24, marginBottom: 4 }}>Meter readings — June 2026</h1>
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
function UtilityBills({ councilInvoice, setCouncilInvoice, alloc }) {
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
      <div style={{ fontWeight: 700, fontSize: 13.5, marginBottom: 4 }}>Utility bills — June 2026</div>
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
        .insert({ unit_id: unitRow.dbId, period: CURRENT_PERIOD, description, amount: amt })
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
function OpsExpenses({ opsExpenses, setOpsExpenses }) {
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
  const total = opsExpenses.reduce((s, e) => s + e.amount, 0);
  const byCategory = OPS_EXPENSE_CATEGORIES.map((cat) => ({
    cat, total: opsExpenses.filter((e) => e.category === cat).reduce((s, e) => s + e.amount, 0),
  })).filter((c) => c.total > 0);

  return (
    <>
      <h1 className="f-display" style={{ fontSize: 24, marginBottom: 4 }}>Body corp operating expenses</h1>
      <p style={{ color: "#64748B", fontSize: 13.5, marginBottom: 18 }}>
        Costs the Body Corp pays directly — CSOS, fire extinguisher servicing, and the actual Garden Service / Blockwatch spend. Never billed to a unit; tracked here for the analytics dashboard and the September annual report.
      </p>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 14, marginBottom: 18 }}>
        <Stat label="Total this month" value={rand(total)} accent="#B5651D" />
        {byCategory.slice(0, 2).map((c) => (
          <Stat key={c.cat} label={c.cat} value={rand(c.total)} />
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
        <div style={{ fontWeight: 700, fontSize: 13.5, marginBottom: 10 }}>Expense log</div>
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
            {opsExpenses.map((e) => (
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
}) {
  const updateBand = (id, field, value) => {
    setWaterBands((prev) => prev.map((b) => (b.id === id ? { ...b, [field]: parseFloat(value) || 0 } : b)));
  };
  const increasePct = (b) => (b.rate2024 > 0 ? ((b.rate2025 - b.rate2024) / b.rate2024) * 100 : null);
  const [saveStatus, setSaveStatus] = useState("idle"); // idle | saving | saved | error
  const save = async () => {
    setSaveStatus("saving");
    try {
      await saveTariffsToDb({ waterBands, electricityRate, vatRate, commonPropertyElectricityKwh });
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
        <table style={{ width: "100%", fontSize: 13, borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ color: "#64748B", textAlign: "right", fontSize: 10.5, textTransform: "uppercase" }}>
              <th style={{ padding: "6px 6px", textAlign: "left" }}>Band</th>
              <th style={{ padding: "6px 6px" }}>2024/2025</th>
              <th style={{ padding: "6px 6px", color: "#1B2A38" }}>2025/2026 (active)</th>
              <th style={{ padding: "6px 6px" }}>Increase %</th>
            </tr>
          </thead>
          <tbody>
            {waterBands.map((b) => {
              const pct = increasePct(b);
              return (
                <tr key={b.id} style={{ borderTop: "1px solid #EEE7D6" }}>
                  <td style={{ padding: "8px 6px", fontWeight: 600 }} className="f-mono">{b.label}</td>
                  <td style={{ padding: "4px" }}>
                    <input
                      type="number" step="0.01" value={b.rate2024}
                      onChange={(e) => updateBand(b.id, "rate2024", e.target.value)}
                      style={inputStyle}
                    />
                  </td>
                  <td style={{ padding: "4px" }}>
                    <input
                      type="number" step="0.01" value={b.rate2025}
                      onChange={(e) => updateBand(b.id, "rate2025", e.target.value)}
                      style={{ ...inputStyle, borderColor: "#2F5D50", fontWeight: 700 }}
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
            Common Property Water: {rand(calcWaterCost(COMMON_PROPERTY_WATER_KL, waterBands))} total · {rand(calcWaterCost(COMMON_PROPERTY_WATER_KL, waterBands) / UNITS.length)} per unit
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

function Reconciliation({
  alloc, remittanceDeductions, setRemittanceDeductions, remittanceAdvices,
  bankTxns, onUploadStatement, statementMeta, statementStatus, statementError,
}) {
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

  const matches = alloc.rows.map((r) => {
    const ded = remittanceDeductions[r.id];
    const adv = (remittanceAdvices || {})[r.id];
    const expected = ded && ded.approved ? r.total - ded.amount : r.total;
    const txn = bankTxns.find((t) => t.category === "resident_payment" && t.matchedUnit === r.id);
    if (!txn) return { unit: r, txn: null, status: "outstanding", expected, ded, adv };
    const diff = Math.round((txn.amount - expected) * 100) / 100;
    return { unit: r, txn, status: Math.abs(diff) < 0.01 ? "paid" : "review", diff, expected, ded, adv };
  });

  const otherTxns = bankTxns.filter((t) => !(t.category === "resident_payment" && t.matchedUnit));
  const needsReviewCount = bankTxns.filter((t) => t.category === "needs_review").length;

  return (
    <>
      <h1 className="f-display" style={{ fontSize: 24, marginBottom: 4 }}>Bank reconciliation</h1>
      <p style={{ color: "#64748B", fontSize: 13.5, marginBottom: 18 }}>
        Matched by payment reference (Cor/Unit + number) against submitted remittance advices. Approved Body Corp expense deductions reduce the expected payment before comparing against the bank statement.
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
            {statementStatus === "idle" && "Showing demo data — upload a real statement to replace it."}
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
              <th style={{ padding: "6px 8px" }}>Deduction</th>
              <th style={{ padding: "6px 8px" }}>Expected</th>
              <th style={{ padding: "6px 8px" }}>Bank ref</th>
              <th style={{ padding: "6px 8px" }}>Amount received</th>
              <th style={{ padding: "6px 8px" }}>Variance</th>
              <th style={{ padding: "6px 8px" }}>Status</th>
            </tr>
          </thead>
          <tbody>
            {matches.map((m) => (
              <tr key={m.unit.id} style={{ borderTop: "1px solid #EEE7D6" }}>
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
                <td style={{ padding: "9px 8px", fontSize: 12 }}>
                  {m.ded ? (
                    <div>
                      <div className="f-mono" style={{ color: "#B5651D" }}>−{rand(m.ded.amount)}</div>
                      <div style={{ color: "#64748B", fontSize: 11, maxWidth: 180 }}>{m.ded.comment}</div>
                      {!m.ded.proofAttached && (
                        <div style={{ color: "#B5651D", fontSize: 10.5, marginTop: 2 }}>No proof of payment attached</div>
                      )}
                      {m.ded.approved ? (
                        <span style={{ color: "#2F5D50", fontWeight: 700, fontSize: 11 }}>✓ Approved</span>
                      ) : (
                        <button onClick={() => approve(m.unit.id)} style={{ marginTop: 2, fontSize: 11, fontWeight: 700, color: "#1B2A38", background: "#F1EAD3", border: "none", borderRadius: 4, padding: "2px 8px", cursor: "pointer" }}>
                          Approve
                        </button>
                      )}
                    </div>
                  ) : "—"}
                </td>
                <td className="f-mono" style={{ padding: "9px 8px", fontWeight: 600 }}>{rand(m.expected)}</td>
                <td className="f-mono" style={{ padding: "9px 8px", fontSize: 12 }}>{m.txn ? m.txn.ref : "—"}</td>
                <td className="f-mono" style={{ padding: "9px 8px" }}>{m.txn ? rand(m.txn.amount) : "—"}</td>
                <td className="f-mono" style={{ padding: "9px 8px", color: m.diff ? "#B5651D" : "#2F5D50" }}>
                  {m.diff !== undefined ? rand(m.diff) : "—"}
                </td>
                <td style={{ padding: "9px 8px" }}><StatusChip status={m.status} /></td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </Card>

      <Card style={{ marginTop: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 10 }}>
          <div style={{ fontWeight: 700, fontSize: 13.5 }}>All bank statement lines ({bankTxns.length})</div>
          {needsReviewCount > 0 && (
            <div style={{ fontSize: 12, color: "#8A6D1E", fontWeight: 600 }}>{needsReviewCount} need manual matching</div>
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
              <th style={{ padding: "6px 8px" }}>Note</th>
            </tr>
          </thead>
          <tbody>
            {otherTxns.map((t, i) => (
              <tr key={i} style={{ borderTop: "1px solid #EEE7D6" }}>
                <td className="f-mono" style={{ padding: "8px" }}>{t.date}</td>
                <td style={{ padding: "8px" }}>{t.desc}</td>
                <td className="f-mono" style={{ padding: "8px", textAlign: "right", color: t.direction === "debit" ? "#B5651D" : "#1B2A38" }}>
                  {t.direction === "debit" ? "−" : ""}{rand(t.amount)}
                </td>
                <td style={{ padding: "8px" }}><CategoryBadge category={t.category} /></td>
                <td className="f-mono" style={{ padding: "8px" }}>{t.matchedUnit || "—"}</td>
                <td style={{ padding: "8px", color: "#64748B", fontSize: 11.5 }}>{t.note}</td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </Card>
    </>
  );
}

// ---------- Statement preview (paper look) ----------
function StatementPreview({ alloc, selectedUnit, setSelectedUnit }) {
  const r = alloc.rows.find((x) => x.id === selectedUnit);
  return (
    <>
      <div className="no-print" style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 16 }}>
        <h1 className="f-display" style={{ fontSize: 24 }}>Statement preview</h1>
        <select value={selectedUnit} onChange={(e) => setSelectedUnit(e.target.value)} style={{ padding: "6px 10px", borderRadius: 6, border: "1px solid #D8D0BE" }}>
          {UNITS.map((u) => <option key={u.id} value={u.id}>{u.id} — {u.owner}</option>)}
        </select>
      </div>
      <StatementPaper r={r} />
      <div className="no-print" style={{ marginTop: 16, display: "flex", gap: 10 }}>
        <button style={primaryBtn}>Send to {r.owner}</button>
        <button style={secondaryBtn} onClick={printStatement}>Download PDF</button>
      </div>
    </>
  );
}

function StatementPaper({ r }) {
  const num = (n) => n.toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const vatPct = (r.vatRate * 100).toFixed(0);
  const unitNumber = r.id.slice(1);
  const utilityRows = [
    { desc: `Electricity`, curr: r.eCurr, prev: r.ePrev, cons: `${r.eUse.toFixed(2)} kWh`, rate: `${num(r.electricityRate)} / kWh`, due: r.elecCost },
    { desc: `Water`, curr: r.wCurr, prev: r.wPrev, cons: `${r.wUse.toFixed(2)} kL`, rate: r.wUse ? `${num(r.waterCost / r.wUse)} / kL avg` : "Tiered", due: r.waterCost },
  ];

  return (
    <div className="print-area" style={{
      background: "#F6F1E7", border: "1px solid #D8D0BE", borderRadius: 4, padding: 32,
      boxShadow: "0 1px 0 #fff inset", maxWidth: 680,
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", borderBottom: "2px solid #1B2A38", paddingBottom: 12, marginBottom: 18 }}>
        <div>
          <div className="f-display" style={{ fontSize: 19, fontWeight: 700 }}>El Corazon Body Corporate</div>
          <div style={{ fontSize: 11.5, color: "#64748B" }}>Levy & utility statement — June 2026</div>
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
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
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
        <div className="f-display" style={{ fontWeight: 700, fontSize: 15 }}>Total amount due by 7 July 2026</div>
        <div className="f-mono" style={{ fontWeight: 700, fontSize: 15 }}>{rand(r.total)}</div>
      </div>

      {/* Section 3 — banking details */}
      <div style={{ marginTop: 22, borderTop: "1px dashed #D8D0BE", paddingTop: 14 }}>
        <div style={{ fontWeight: 700, fontSize: 12.5, marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.4, color: "#64748B" }}>
          El Corazon Banking Details
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", rowGap: 4, fontSize: 12.5 }}>
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

// ---------- Resident portal ----------
function ResidentPortal({ alloc, selectedUnit, setSelectedUnit, remittanceDeductions, setRemittanceDeductions, setRemittanceAdvices, locked }) {
  const [files, setFiles] = useState([]); // multiple proof-of-payment documents
  const [deduction, setDeduction] = useState("");
  const [comment, setComment] = useState("");
  const [amountPaid, setAmountPaid] = useState("");
  const [datePaid, setDatePaid] = useState("");
  const [notifyStatus, setNotifyStatus] = useState(null); // null | "sending" | "sent" | "failed" | "save-failed"
  const fileInputRef = useRef(null);
  const r = alloc.rows.find((x) => x.id === selectedUnit);
  const deductionAmt = parseFloat(deduction) || 0;
  const amountToPay = r.total - deductionAmt;
  const existing = remittanceDeductions[selectedUnit];

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
    const paid = amountPaid === "" ? r.total : (parseFloat(amountPaid) || 0);
    let dbId = null;
    let storedProofPaths = [];
    try {
      const saved = await submitRemittanceToDb(selectedUnit, {
        amountPaid: paid,
        datePaid: datePaid || null,
        deduction: deductionAmt,
        comment,
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
    if (deductionAmt > 0) {
      setRemittanceDeductions((prev) => ({
        ...prev,
        [selectedUnit]: {
          dbId, amount: deductionAmt, comment, proofAttached: files.length > 0, proofFileNames: storedProofPaths,
          approved: false, statementTotal: r.total, submittedAt: new Date().toISOString().slice(0, 10),
        },
      }));
    }
    const ok = await notifyTrusteeOfRemittance({
      unit: r.id, owner: r.owner, statementTotal: r.total, amountPaid: paid, datePaid,
      deduction: deductionAmt, comment, proofAttached: files.length > 0, proofFileNames,
    });
    setNotifyStatus(ok ? "sent" : "failed");
  };

  return (
    <main style={{ maxWidth: 680, margin: "0 auto", padding: "28px 20px" }}>
      <div className="no-print" style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 14 }}>
        <h1 className="f-display" style={{ fontSize: 22 }}>Your statement</h1>
        {/* The unit switcher is a trustee-demo convenience only — residents
            arriving via their capability URL are locked to their own unit. */}
        {!locked && (
          <select value={selectedUnit} onChange={(e) => setSelectedUnit(e.target.value)} style={{ padding: "6px 10px", borderRadius: 6, border: "1px solid #D8D0BE" }}>
            {UNITS.map((u) => <option key={u.id} value={u.id}>{u.id} — {u.owner}</option>)}
          </select>
        )}
      </div>

      <StatementPaper r={r} />
      <div className="no-print" style={{ marginTop: 12, display: "flex", justifyContent: "flex-end" }}>
        <button style={secondaryBtn} onClick={printStatement}>Download PDF</button>
      </div>

      <div className="no-print">
      {existing && (
        <Card style={{ marginTop: 20, background: existing.approved ? "#EAF2EE" : "#FBF1E9", border: `1px solid ${existing.approved ? "#BFE0D3" : "#EAD9C4"}` }}>
          <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 4 }}>
            {existing.approved ? "✓ Deduction approved by trustee" : "⏳ Deduction submitted — pending trustee approval"}
          </div>
          <div style={{ fontSize: 12.5, color: "#64748B" }}>{existing.comment}</div>
          {existing.proofFileNames && existing.proofFileNames.length > 0 && (
            <div style={{ fontSize: 11.5, color: "#64748B", marginTop: 2 }}>
              {existing.proofFileNames.length} document{existing.proofFileNames.length > 1 ? "s" : ""} submitted as proof
            </div>
          )}
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginTop: 8 }} className="f-mono">
            {/* DB-loaded submissions don't carry a stored statement total — the live one applies */}
            <span>Statement total</span><span>{rand(existing.statementTotal ?? r.total)}</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }} className="f-mono">
            <span>Deducted (paid on your own behalf)</span><span style={{ color: "#B5651D" }}>−{rand(existing.amount)}</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13.5, fontWeight: 700, borderTop: "1px solid #1B2A38", marginTop: 4, paddingTop: 6 }} className="f-mono">
            <span>Amount to pay the Body Corp</span><span>{rand((existing.statementTotal ?? r.total) - existing.amount)}</span>
          </div>
        </Card>
      )}

      <Card style={{ marginTop: 20 }}>
        <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 10 }}>Submit remittance advice</div>
        <p style={{ fontSize: 12.5, color: "#64748B", marginBottom: 14 }}>
          Already paid? Confirm the amount and upload your proof of payment so it matches automatically.
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
          <div style={{ fontWeight: 700, fontSize: 12.5, marginBottom: 8 }}>Paid a Body Corp expense out of your own pocket?</div>
          <p style={{ fontSize: 12, color: "#64748B", marginBottom: 10 }}>
            E.g. the garden service or Blockwatch fee. Note the amount here, and it comes off what you pay the Body Corp this month — provided you can produce proof of payment.
          </p>
          <div style={{ display: "flex", gap: 10, marginBottom: 10 }}>
            <input
              placeholder="Amount to deduct (R)"
              type="number"
              value={deduction}
              onChange={(e) => setDeduction(e.target.value)}
              style={{ ...inputStyle, width: 180, textAlign: "left" }}
            />
          </div>
          <textarea
            placeholder="Comments — e.g. 'Garden service R387 paid directly to the gardener, 5 June'"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            rows={3}
            style={{
              width: "100%", padding: "8px 10px", borderRadius: 6, border: "1px solid #D8D0BE",
              fontFamily: "'Inter', sans-serif", fontSize: 12.5, resize: "vertical", boxSizing: "border-box",
            }}
          />
          {deductionAmt > 0 && (
            <div style={{ marginTop: 10, display: "flex", justifyContent: "space-between", fontSize: 12.5 }} className="f-mono">
              <span>Amount to pay the Body Corp</span>
              <span style={{ fontWeight: 700, color: "#2F5D50" }}>{rand(amountToPay)}</span>
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

      <Card style={{ marginTop: 16 }}>
        <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 8 }}>Your history</div>
        <div style={{ fontSize: 12.5, color: "#64748B", display: "flex", flexDirection: "column", gap: 6 }}>
          <div>May 2026 — {rand(r.total * 0.97)} — <span style={{ color: "#2F5D50", fontWeight: 600 }}>Reconciled</span></div>
          <div>Apr 2026 — {rand(r.total * 1.02)} — <span style={{ color: "#2F5D50", fontWeight: 600 }}>Reconciled</span></div>
        </div>
      </Card>
      </div>
    </main>
  );
}
