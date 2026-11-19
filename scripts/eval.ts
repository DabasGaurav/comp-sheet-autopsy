// Offline eval: does the deterministic engine recover every planted defect, with zero false flags?
// Run: npx tsx scripts/eval.ts   (writes eval/results.json, shown on /eval in the app)
import { readFileSync, writeFileSync } from "node:fs";
import { SAMPLES, COLUMN_MAP } from "../src/lib/samples";
import { readWorkbook, buildLedger, hygieneChecks } from "../src/lib/workbook";
import { runAutopsy } from "../src/lib/engine";

const labels = JSON.parse(readFileSync("eval/labels.json", "utf8"));
const rows: unknown[] = [];
let planted = 0, found = 0, falseFlags = 0, runsIdentical = true;

for (const s of SAMPLES) {
  const buf = readFileSync(`public/samples/${s.file}`);
  const pw = readWorkbook(new Uint8Array(buf), s.file);
  const ledger = buildLedger(pw, COLUMN_MAP);
  const hyg = hygieneChecks(pw);
  const a = runAutopsy(ledger, s.truthRules, s.ambiguities, hyg);
  const b = runAutopsy(ledger, s.truthRules, s.ambiguities, hyg);
  if (JSON.stringify(a) !== JSON.stringify(b)) runsIdentical = false;

  const lab = labels[s.file] as { defects: { rep: string; cause: string }[]; errorCells: number; hiddenSheets: number };
  const flagged = a.reps.filter((r) => r.causes.length);
  let hit = 0;
  for (const d of lab.defects) {
    const r = a.reps.find((x) => x.rep === d.rep);
    if (r && r.causes.includes(d.cause as never)) hit++;
  }
  const fp = flagged.filter((r) => !lab.defects.some((d) => d.rep === r.rep)).length;
  const errCellsFound = hyg.filter((h) => h.kind === "error_cell").length;
  const hiddenFound = hyg.filter((h) => h.kind === "hidden_sheet").length;
  const p = lab.defects.length + lab.errorCells + lab.hiddenSheets;
  const f = hit + Math.min(errCellsFound, lab.errorCells) + Math.min(hiddenFound, lab.hiddenSheets);
  const extra = fp + Math.max(0, errCellsFound - lab.errorCells) + Math.max(0, hiddenFound - lab.hiddenSheets);
  planted += p; found += f; falseFlags += extra;
  rows.push({
    file: s.file, payees: a.reps.length, plantedDefects: p, recovered: f, falseFlags: extra,
    overpaid: a.totals.overpaid, underpaid: a.totals.underpaid,
    topAmbiguity: a.ambiguityPrices[0] ? { clause: a.ambiguityPrices[0].clause, dollarsAtStake: a.ambiguityPrices[0].dollarsAtStake } : null,
    flagged: flagged.map((r) => ({ rep: r.rep, variance: r.variance, causes: r.causes })),
  });
}
const result = { ranAt: new Date().toISOString(), engine: "deterministic (no LLM)", planted, recovered: found, falseFlags, identicalOnRerun: runsIdentical, workbooks: rows };
writeFileSync("eval/results.json", JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
