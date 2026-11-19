// Deterministic commission engine + reconciliation. No LLM, no randomness, no I/O.
// Same input -> same output, every time ("governed math").
import type {
  Ambiguity, AmbiguityPrice, Autopsy, Cause, Deal, HygieneFinding, Ledger, PayoutRow, RepResult, Rules,
} from "./types";

const cents = (n: number) => Math.round(n * 100) / 100;
const TOLERANCE = 1; // $1 rounding tolerance before a difference counts as an error

function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);
}

export function isClawedBack(deal: Deal, rules: Rules): boolean {
  if (rules.clawbackDays == null || !deal.churnDate) return false;
  return daysBetween(deal.closeDate, deal.churnDate) <= rules.clawbackDays;
}

export function creditFor(deal: Deal, rules: Rules): number {
  if (isClawedBack(deal, rules)) return 0;
  const share = rules.splitRule === "pro_rata" ? deal.splitPct / 100 : 1;
  return deal.amount * share;
}

/** Commission on `credited` bookings against `quota` under the tier table. */
export function tieredCommission(credited: number, quota: number, rules: Rules): number {
  if (quota <= 0 || credited <= 0) return 0;
  const cappedCredit = rules.capPct == null ? credited : Math.min(credited, (rules.capPct / 100) * quota);
  const tiers = [...rules.tiers].sort((a, b) => a.fromPct - b.fromPct);

  if (rules.acceleratorMode === "retroactive") {
    const attainment = (credited / quota) * 100;
    // highest tier whose start has been reached (inclusive boundary)
    let rate = tiers[0]?.rate ?? 0;
    for (const t of tiers) if (attainment >= t.fromPct) rate = t.rate;
    return cappedCredit * rate;
  }

  // marginal: pay each band at its own rate
  let total = 0;
  for (const t of tiers) {
    const lo = (t.fromPct / 100) * quota;
    const hi = t.toPct == null ? Infinity : (t.toPct / 100) * quota;
    const inBand = Math.max(0, Math.min(cappedCredit, hi) - lo);
    total += inBand * t.rate;
  }
  return total;
}

export function spiffsFor(deals: Deal[], rules: Rules): number {
  let total = 0;
  for (const d of deals) {
    if (isClawedBack(d, rules)) continue;
    const share = rules.spiffSplit === "full_each" ? 1 : d.splitPct / 100;
    for (const s of rules.spiffs) if (d.amount >= s.minDealAmount) total += s.amount * share;
  }
  return total;
}

export function payoutFor(rep: string, quota: number, ledger: Ledger, rules: Rules) {
  const deals = ledger.deals.filter((d) => d.rep === rep);
  const credited = deals.reduce((s, d) => s + creditFor(d, rules), 0);
  const payout = tieredCommission(credited, quota, rules) + spiffsFor(deals, rules);
  return { credited: cents(credited), payout: cents(payout) };
}

/** Alternative rule-sets that reproduce common spreadsheet mistakes, used to explain a variance. */
function diagnosticVariants(rules: Rules): { cause: Cause; rules: Rules; note: string }[] {
  const v: { cause: Cause; rules: Rules; note: string }[] = [];
  v.push({
    cause: "accelerator_mode",
    rules: { ...rules, acceleratorMode: rules.acceleratorMode === "marginal" ? "retroactive" : "marginal" },
    note: `Sheet pays the accelerator ${rules.acceleratorMode === "marginal" ? "retroactively on all bookings" : "only on bookings above the threshold"}; confirmed plan says ${rules.acceleratorMode}.`,
  });
  if (rules.clawbackDays != null)
    v.push({ cause: "clawback_missed", rules: { ...rules, clawbackDays: null }, note: `A deal that churned within ${rules.clawbackDays} days was not clawed back.` });
  if (rules.splitRule === "pro_rata")
    v.push({ cause: "split_double_credit", rules: { ...rules, splitRule: "full_credit_each", spiffSplit: "full_each" }, note: "A split deal was credited at 100% to more than one rep." });
  if (rules.capPct != null)
    v.push({ cause: "cap_ignored", rules: { ...rules, capPct: null }, note: `Bookings above the ${rules.capPct}% cap were still paid.` });
  if (rules.spiffs.length)
    v.push({ cause: "spiff_missed", rules: { ...rules, spiffs: [] }, note: "A SPIFF the rep qualified for was not paid." });
  return v;
}

function diagnose(row: PayoutRow, ledger: Ledger, rules: Rules, formulaColumn: boolean): { causes: Cause[]; notes: string[] } {
  const causes: Cause[] = [];
  const notes: string[] = [];
  for (const variant of diagnosticVariants(rules)) {
    const alt = payoutFor(row.rep, row.quota, ledger, variant.rules).payout;
    if (Math.abs(alt - row.sheetPayout) <= TOLERANCE) {
      causes.push(variant.cause);
      notes.push(variant.note);
    }
  }
  if (!row.isFormula && formulaColumn) {
    causes.push("hardcoded_override");
    notes.push(`${row.cell} is a typed-in number in a column of formulas (manual override).`);
  }
  if (!causes.length) {
    causes.push("unexplained");
    notes.push("Variance not explained by any known rule mistake — check the formula in this cell.");
  }
  return { causes, notes };
}

export function priceAmbiguities(ledger: Ledger, rules: Rules, ambiguities: Ambiguity[]): AmbiguityPrice[] {
  return ambiguities
    .filter((a) => a.readings.length >= 2)
    .map((a) => {
      const readings = a.readings.map((r) => {
        const patched: Rules = { ...rules, ...r.patch };
        const total = ledger.payouts.reduce((s, p) => s + payoutFor(p.rep, p.quota, ledger, patched).payout, 0);
        return { label: r.label, totalPayout: cents(total) };
      });
      const amounts = readings.map((r) => r.totalPayout);
      return { id: a.id, clause: a.clause, issue: a.issue, readings, dollarsAtStake: cents(Math.max(...amounts) - Math.min(...amounts)) };
    })
    .sort((x, y) => y.dollarsAtStake - x.dollarsAtStake);
}

export function runAutopsy(ledger: Ledger, rules: Rules, ambiguities: Ambiguity[] = [], hygiene: HygieneFinding[] = []): Autopsy {
  const formulaShare = ledger.payouts.filter((p) => p.isFormula).length / Math.max(1, ledger.payouts.length);
  const formulaColumn = formulaShare >= 0.5;

  const reps: RepResult[] = ledger.payouts.map((row) => {
    const { credited, payout } = payoutFor(row.rep, row.quota, ledger, rules);
    const variance = cents(row.sheetPayout - payout);
    const base: RepResult = {
      rep: row.rep, quota: row.quota, creditedBookings: credited,
      attainmentPct: row.quota > 0 ? Math.round((credited / row.quota) * 1000) / 10 : 0,
      expectedPayout: payout, sheetPayout: row.sheetPayout, variance, cell: row.cell, causes: [], notes: [],
    };
    if (Math.abs(variance) > TOLERANCE) Object.assign(base, diagnose(row, ledger, rules, formulaColumn));
    return base;
  });

  const expected = cents(reps.reduce((s, r) => s + r.expectedPayout, 0));
  const sheet = cents(reps.reduce((s, r) => s + r.sheetPayout, 0));
  const overpaid = cents(reps.filter((r) => r.variance > TOLERANCE).reduce((s, r) => s + r.variance, 0));
  const underpaid = cents(-reps.filter((r) => r.variance < -TOLERANCE).reduce((s, r) => s + r.variance, 0));

  return {
    reps,
    totals: { expected, sheet, overpaid, underpaid, net: cents(sheet - expected) },
    repsWithErrors: reps.filter((r) => r.causes.length).length,
    hygiene,
    ambiguityPrices: priceAmbiguities(ledger, rules, ambiguities),
  };
}

/** Deterministic lead qualifier. Thresholds are explicit and editable — a rule, not a judgement. */
export const QUALIFIER = { minPayees: 8, minDollarsAtRisk: 1000, minErrorCells: 1 };
export function qualify(a: Autopsy): { qualified: boolean; reasons: string[] } {
  const reasons: string[] = [];
  const atRisk = a.totals.overpaid + a.totals.underpaid;
  if (a.reps.length >= QUALIFIER.minPayees) reasons.push(`${a.reps.length} payees in the sheet (≥ ${QUALIFIER.minPayees})`);
  if (atRisk >= QUALIFIER.minDollarsAtRisk) reasons.push(`$${Math.round(atRisk).toLocaleString("en-US")} paid incorrectly (≥ $${QUALIFIER.minDollarsAtRisk.toLocaleString("en-US")})`);
  const errCells = a.hygiene.filter((h) => h.kind === "error_cell").length;
  if (errCells >= QUALIFIER.minErrorCells) reasons.push(`${errCells} broken cell(s) in the workbook`);
  // qualified when the sheet is big enough to hurt AND something is actually wrong
  const qualified = a.reps.length >= QUALIFIER.minPayees && (atRisk >= QUALIFIER.minDollarsAtRisk || errCells >= QUALIFIER.minErrorCells);
  return { qualified, reasons };
}
