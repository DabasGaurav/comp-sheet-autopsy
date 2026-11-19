// Workbook parsing + deterministic hygiene checks. Runs in the BROWSER (rows never leave the device)
// and in Node (eval). Uses SheetJS.
import * as XLSX from "xlsx";
import type { ColumnMap, Deal, HygieneFinding, Ledger, PayoutRow } from "./types";

export type ParsedWorkbook = {
  fileName: string;
  sheetNames: string[];
  /** header row per sheet — the only structural info sent to the server, besides plan text */
  headers: Record<string, string[]>;
  planText: string;
  wb: XLSX.WorkBook;
};

export function readWorkbook(data: ArrayBuffer | Uint8Array, fileName: string): ParsedWorkbook {
  const wb = XLSX.read(data, { type: "array", cellFormula: true, cellDates: false, cellNF: false });
  const headers: Record<string, string[]> = {};
  for (const name of wb.SheetNames) {
    const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[name], { header: 1, blankrows: false });
    headers[name] = ((rows[0] as unknown[]) ?? []).map((h) => String(h ?? "").trim());
  }
  return { fileName, sheetNames: wb.SheetNames, headers, planText: findPlanText(wb), wb };
}

/** Plan text = the sheet whose name looks like a plan, else the sheet with the most prose. */
function findPlanText(wb: XLSX.WorkBook): string {
  const byName = wb.SheetNames.find((n) => /plan|policy|rules/i.test(n));
  const candidates = byName ? [byName] : wb.SheetNames;
  let best = "";
  for (const name of candidates) {
    const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[name], { header: 1, blankrows: false });
    const text = rows.map((r) => (r as unknown[]).filter((c) => c != null && c !== "").join(" ")).join("\n");
    const letters = text.replace(/[^a-z]/gi, "").length;
    if (letters > best.replace(/[^a-z]/gi, "").length) best = text;
  }
  return best.slice(0, 20000);
}

function toIsoDate(v: unknown): string | null {
  if (v == null || v === "") return null;
  if (typeof v === "number") {
    // Excel serial date -> ISO
    const ms = Math.round((v - 25569) * 86400 * 1000);
    return new Date(ms).toISOString().slice(0, 10);
  }
  const s = String(v).trim();
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : new Date(t).toISOString().slice(0, 10);
}

function num(v: unknown): number {
  if (typeof v === "number") return v;
  const n = Number(String(v ?? "").replace(/[$,%\s]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

export function buildLedger(pw: ParsedWorkbook, map: ColumnMap): Ledger {
  const ds = pw.wb.Sheets[map.dealsSheet];
  const ps = pw.wb.Sheets[map.payoutsSheet];
  if (!ds || !ps) throw new Error(`Could not find sheets "${map.dealsSheet}" / "${map.payoutsSheet}"`);

  const dealRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ds, { defval: null });
  const deals: Deal[] = dealRows
    .filter((r) => r[map.deals.rep] != null && r[map.deals.amount] != null)
    .map((r) => ({
      dealId: String(r[map.deals.dealId] ?? ""),
      rep: String(r[map.deals.rep]).trim(),
      closeDate: toIsoDate(r[map.deals.closeDate]) ?? "1970-01-01",
      amount: num(r[map.deals.amount]),
      splitPct: map.deals.splitPct && r[map.deals.splitPct] != null ? num(r[map.deals.splitPct]) : 100,
      churnDate: map.deals.churnDate ? toIsoDate(r[map.deals.churnDate]) : null,
    }));

  // payouts: walk cells so we know the address and whether it's a formula
  const range = XLSX.utils.decode_range(ps["!ref"] ?? "A1");
  const headerRow = range.s.r;
  const col: Record<string, number> = {};
  for (let c = range.s.c; c <= range.e.c; c++) {
    const cell = ps[XLSX.utils.encode_cell({ r: headerRow, c })];
    if (cell) col[String(cell.v).trim()] = c;
  }
  const need = [map.payouts.rep, map.payouts.quota, map.payouts.payout];
  for (const h of need) if (col[h] == null) throw new Error(`Column "${h}" not found on ${map.payoutsSheet}`);

  const payouts: PayoutRow[] = [];
  for (let r = headerRow + 1; r <= range.e.r; r++) {
    const repCell = ps[XLSX.utils.encode_cell({ r, c: col[map.payouts.rep] })];
    if (!repCell || repCell.v == null || String(repCell.v).trim() === "") continue;
    const addr = XLSX.utils.encode_cell({ r, c: col[map.payouts.payout] });
    const payCell = ps[addr];
    payouts.push({
      rep: String(repCell.v).trim(),
      quota: num(ps[XLSX.utils.encode_cell({ r, c: col[map.payouts.quota] })]?.v),
      sheetPayout: num(payCell?.v),
      cell: `${map.payoutsSheet}!${addr}`,
      isFormula: Boolean(payCell?.f),
    });
  }
  return { deals, payouts };
}

const ERROR_TEXT = /^#(REF!|N\/A|VALUE!|DIV\/0!|NAME\?|NUM!|NULL!)$/;

export function hygieneChecks(pw: ParsedWorkbook): HygieneFinding[] {
  const out: HygieneFinding[] = [];
  for (const name of pw.wb.SheetNames) {
    const ws = pw.wb.Sheets[name];
    for (const addr of Object.keys(ws)) {
      if (addr.startsWith("!")) continue;
      const c = ws[addr] as XLSX.CellObject;
      const text = typeof c.w === "string" ? c.w : typeof c.v === "string" ? c.v : "";
      if (c.t === "e" || ERROR_TEXT.test(String(text))) out.push({ kind: "error_cell", where: `${name}!${addr}`, detail: `Cell shows ${c.w ?? text ?? "an error"}` });
    }
  }
  const meta = pw.wb.Workbook?.Sheets ?? [];
  meta.forEach((s) => {
    if (s.Hidden) out.push({ kind: "hidden_sheet", where: s.name ?? "?", detail: "Hidden sheet — is anyone still reading from it?" });
  });
  if (/final|v\d+|use[_ ]?this|copy|\(\d+\)/i.test(pw.fileName))
    out.push({ kind: "version_chaos_filename", where: pw.fileName, detail: "File name suggests several live versions of the truth." });
  return out;
}
