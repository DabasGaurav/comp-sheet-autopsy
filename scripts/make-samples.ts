// Generates the illustrative sample workbooks (with planted defects) + eval labels.
// Run: npx tsx scripts/make-samples.ts
import * as XLSX from "xlsx";
import { writeFileSync } from "node:fs";
import { SAMPLES } from "../src/lib/samples";
import { payoutFor } from "../src/lib/engine";
import type { Rules } from "../src/lib/types";

const labels: Record<string, unknown> = {};

for (const s of SAMPLES) {
  const wb = XLSX.utils.book_new();
  const ledger = { deals: s.deals, payouts: [] };

  // Plan sheet: one line per row
  const plan = XLSX.utils.aoa_to_sheet(s.planText.split("\n").map((l) => [l]));
  plan["!cols"] = [{ wch: 120 }];
  XLSX.utils.book_append_sheet(wb, plan, "Plan");

  // Deals sheet
  const dealsAoa: unknown[][] = [["Deal ID", "Owner", "Close Date", "ACV (USD)", "Split %", "Churn Date"]];
  for (const d of s.deals) dealsAoa.push([d.dealId, d.rep, d.closeDate, d.amount, d.splitPct, d.churnDate ?? ""]);
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(dealsAoa), "Deals");

  // Payouts sheet, with the spreadsheet's (possibly wrong) numbers
  const ws: XLSX.WorkSheet = {};
  const header = ["Rep", "Quarterly Quota", "Credited ACV", "Attainment", "Commission (USD)", "Paid Month", "Adj", "Notes"];
  header.forEach((h, c) => (ws[XLSX.utils.encode_cell({ r: 0, c })] = { t: "s", v: h }));
  s.reps.forEach((rep, i) => {
    const r = i + 1;
    const row = r + 1;
    const defect = s.defects.find((x) => x.rep === rep.rep);
    let rules: Rules = s.truthRules;
    if (defect?.cause === "accelerator_mode") rules = { ...rules, acceleratorMode: rules.acceleratorMode === "marginal" ? "retroactive" : "marginal" };
    if (defect?.cause === "clawback_missed") rules = { ...rules, clawbackDays: null };
    if (defect?.cause === "split_double_credit") rules = { ...rules, splitRule: "full_credit_each", spiffSplit: "full_each" };
    if (defect?.cause === "cap_ignored") rules = { ...rules, capPct: null };
    const { credited, payout } = payoutFor(rep.rep, rep.quota, ledger, rules);
    const sheetPayout = defect?.cause === "hardcoded_override" ? payout + (defect.overrideDelta ?? 0) : payout;

    ws[`A${row}`] = { t: "s", v: rep.rep };
    ws[`B${row}`] = { t: "n", v: rep.quota, z: "$#,##0" };
    ws[`C${row}`] = { t: "n", v: credited, f: `SUMIFS(Deals!D:D,Deals!B:B,A${row})*IFERROR(VLOOKUP(A${row},Deals!B:E,4,0)/100,1)`, z: "$#,##0" };
    ws[`D${row}`] = { t: "n", v: credited / rep.quota, f: `C${row}/B${row}`, z: "0.0%" };
    ws[`E${row}`] = defect?.cause === "hardcoded_override"
      ? { t: "n", v: sheetPayout, z: "$#,##0.00" }
      : { t: "n", v: sheetPayout, f: `MIN(C${row},2*B${row})*IF(D${row}>=1.5,0.2,IF(D${row}>=1,0.15,0.1))+SPIFF_CALC(A${row})`, z: "$#,##0.00" };
    ws[`F${row}`] = { t: "s", v: "Oct-2026" };
    if (s.refErrorCell === `G${row}`) ws[`G${row}`] = { t: "e", v: 0x17, f: "Rates_OLD_do_not_use!#REF!*1.1", w: "#REF!" };
    if (defect?.cause === "hardcoded_override") ws[`H${row}`] = { t: "s", v: "adjusted per VP email" };
  });
  ws["!ref"] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: s.reps.length, c: header.length - 1 } });
  ws["!cols"] = [{ wch: 16 }, { wch: 16 }, { wch: 14 }, { wch: 11 }, { wch: 18 }, { wch: 11 }, { wch: 8 }, { wch: 24 }];
  XLSX.utils.book_append_sheet(wb, ws, "Payouts");

  if (s.hiddenSheet) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["Tier", "Rate"], ["<100%", 0.09], ["100-150%", 0.14]]), s.hiddenSheet);
    wb.Workbook = { Sheets: wb.SheetNames.map((name) => ({ name, Hidden: name === s.hiddenSheet ? 1 : 0 })) };
  }

  XLSX.writeFile(wb, `public/samples/${s.file}`);
  labels[s.file] = {
    defects: s.defects.map((x) => ({ rep: x.rep, cause: x.cause })),
    errorCells: s.refErrorCell ? 1 : 0,
    hiddenSheets: s.hiddenSheet ? 1 : 0,
  };
  console.log("wrote", s.file);
}
writeFileSync("eval/labels.json", JSON.stringify(labels, null, 2));
