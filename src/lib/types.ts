// Core types for Comp Sheet Autopsy.
// The LLM only ever produces `Rules`, `ColumnMap` and `Ambiguity` objects. All money is computed in engine.ts.

export type Tier = {
  /** attainment % where this tier starts (inclusive), e.g. 0, 100, 150 */
  fromPct: number;
  /** attainment % where this tier ends (exclusive); null = no upper bound */
  toPct: number | null;
  /** commission rate as a fraction of credited bookings, e.g. 0.10 */
  rate: number;
};

export type Spiff = { label: string; minDealAmount: number; amount: number };

export type Rules = {
  tiers: Tier[];
  /** marginal: each tier's rate applies only to bookings inside that band.
   *  retroactive: the rate of the highest tier reached applies to ALL bookings. */
  acceleratorMode: "marginal" | "retroactive";
  /** attainment % above which bookings earn nothing; null = uncapped */
  capPct: number | null;
  /** a deal that churns within this many days of close is clawed back; null = no clawback */
  clawbackDays: number | null;
  /** pro_rata: split deals credit amount × split%. full_credit_each: every rep on the deal gets 100%. */
  splitRule: "pro_rata" | "full_credit_each";
  spiffs: Spiff[];
};

export type RuleField = keyof Rules;

export type Quoted<T> = { value: T; quote: string | null };

export type ColumnMap = {
  dealsSheet: string;
  deals: {
    dealId: string;
    rep: string;
    closeDate: string;
    amount: string;
    splitPct: string | null;
    churnDate: string | null;
  };
  payoutsSheet: string;
  payouts: { rep: string; quota: string; payout: string };
};

export type Ambiguity = {
  id: string;
  clause: string;
  issue: string;
  readings: { label: string; patch: Partial<Rules> }[];
};

export type Extraction = {
  rules: Rules;
  quotes: Partial<Record<RuleField, string | null>>;
  columnMap: ColumnMap;
  ambiguities: Ambiguity[];
  /** where the extraction came from — shown in the UI so a cached result is never passed off as live */
  source: "live" | "cached-sample";
  model?: string;
  latencyMs?: number;
  inputTokens?: number;
  outputTokens?: number;
};

export type Deal = {
  dealId: string;
  rep: string;
  closeDate: string; // ISO yyyy-mm-dd
  amount: number;
  splitPct: number; // 0-100
  churnDate: string | null;
};

export type PayoutRow = {
  rep: string;
  quota: number;
  sheetPayout: number;
  /** address of the payout cell in the workbook, e.g. "Payouts!E5" */
  cell: string;
  /** true when the payout cell holds a formula; false = typed-in number */
  isFormula: boolean;
};

export type Ledger = { deals: Deal[]; payouts: PayoutRow[] };

export type Cause =
  | "accelerator_mode"
  | "clawback_missed"
  | "split_double_credit"
  | "cap_ignored"
  | "spiff_missed"
  | "hardcoded_override"
  | "unexplained";

export type RepResult = {
  rep: string;
  quota: number;
  creditedBookings: number;
  attainmentPct: number;
  expectedPayout: number;
  sheetPayout: number;
  variance: number; // sheet - expected (positive = overpaid)
  cell: string;
  causes: Cause[];
  notes: string[];
};

export type HygieneFinding = {
  kind: "error_cell" | "hardcoded_in_formula_column" | "hidden_sheet" | "version_chaos_filename";
  where: string;
  detail: string;
};

export type AmbiguityPrice = {
  id: string;
  clause: string;
  issue: string;
  readings: { label: string; totalPayout: number }[];
  /** absolute $ difference between the two readings across all reps */
  dollarsAtStake: number;
};

export type Autopsy = {
  reps: RepResult[];
  totals: { expected: number; sheet: number; overpaid: number; underpaid: number; net: number };
  repsWithErrors: number;
  hygiene: HygieneFinding[];
  ambiguityPrices: AmbiguityPrice[];
};
