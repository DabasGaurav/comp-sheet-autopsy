// Synthetic, illustrative sample workbooks with PLANTED defects, used for the demo and the eval.
// Nothing here is real company or customer data.
import type { Ambiguity, ColumnMap, Deal, Rules } from "./types";

export type SampleSpec = {
  file: string;
  title: string;
  planText: string;
  /** the rules a careful human reading of planText arrives at (ground truth for the eval) */
  truthRules: Rules;
  ambiguities: Ambiguity[];
  reps: { rep: string; quota: number }[];
  deals: Deal[];
  /** planted defects: which rep's sheet payout is computed wrongly, and how */
  defects: { rep: string; cause: "accelerator_mode" | "clawback_missed" | "split_double_credit" | "cap_ignored" | "hardcoded_override"; overrideDelta?: number }[];
  refErrorCell?: string; // e.g. "G9" on Payouts
  hiddenSheet?: string;
};

export const COLUMN_MAP: ColumnMap = {
  dealsSheet: "Deals",
  deals: { dealId: "Deal ID", rep: "Owner", closeDate: "Close Date", amount: "ACV (USD)", splitPct: "Split %", churnDate: "Churn Date" },
  payoutsSheet: "Payouts",
  payouts: { rep: "Rep", quota: "Quarterly Quota", payout: "Commission (USD)" },
};

const AE_PLAN = `Q3 FY26 Account Executive Commission Plan (ILLUSTRATIVE SAMPLE)

1. Quota. Each AE's quarterly ACV quota is listed on the Payouts tab.
2. Base commission. AEs earn 10% of credited ACV up to 100% of quota.
3. Accelerators. An accelerated rate of 15% applies to bookings once a rep exceeds 100% of quota, and 20% once a rep exceeds 150% of quota.
4. Cap. No commission is earned on bookings above 200% of quota.
5. Split deals. When AEs share a deal, each AE is credited the split percentage recorded on the deal.
6. Clawback. If a customer cancels within 90 days of the close date, commission on that deal is recovered.
7. SPIFF. Any deal with ACV of $100,000 or more earns an additional $1,000 bonus.
8. Payment. Commissions are paid monthly in arrears, subject to finance review.`;

const AE_TRUTH: Rules = {
  tiers: [
    { fromPct: 0, toPct: 100, rate: 0.10 },
    { fromPct: 100, toPct: 150, rate: 0.15 },
    { fromPct: 150, toPct: null, rate: 0.20 },
  ],
  acceleratorMode: "marginal",
  capPct: 200,
  clawbackDays: 90,
  splitRule: "pro_rata",
  spiffs: [{ label: "Deal ≥ $100k", minDealAmount: 100000, amount: 1000 }],
  spiffSplit: "pro_rata",
};

const AE_AMBIGUITIES: Ambiguity[] = [
  {
    id: "accelerator-scope",
    clause: "An accelerated rate of 15% applies to bookings once a rep exceeds 100% of quota",
    issue: "Does the higher rate apply only to bookings above 100% (marginal), or to all bookings once 100% is passed (retroactive)?",
    readings: [
      { label: "Only bookings above the threshold (marginal)", patch: { acceleratorMode: "marginal" } },
      { label: "All bookings once the threshold is passed (retroactive)", patch: { acceleratorMode: "retroactive" } },
    ],
  },
  {
    id: "spiff-split",
    clause: "Any deal with ACV of $100,000 or more earns an additional $1,000 bonus",
    issue: "On a split deal, does each rep get the full $1,000 or their split share of it?",
    readings: [
      { label: "Split share of the bonus", patch: { spiffSplit: "pro_rata" } },
      { label: "Full bonus to every rep on the deal", patch: { spiffSplit: "full_each" } },
    ],
  },
];

// deterministic deal generator (no Math.random) so the files are reproducible
function d(id: number, rep: string, close: string, amount: number, split = 100, churn: string | null = null): Deal {
  return { dealId: `D-${id}`, rep, closeDate: close, amount, splitPct: split, churnDate: churn };
}

const AE_REPS = [
  { rep: "Avery Chen", quota: 300000 },
  { rep: "Ben Okafor", quota: 300000 },
  { rep: "Priya Nair", quota: 300000 },
  { rep: "Diego Ramos", quota: 250000 },
  { rep: "Marcus Webb", quota: 300000 },
  { rep: "Hana Sato", quota: 250000 },
  { rep: "Leo Fischer", quota: 300000 },
  { rep: "Sofia Marin", quota: 300000 },
];

const AE_DEALS: Deal[] = [
  d(1001, "Avery Chen", "2026-07-08", 82000), d(1002, "Avery Chen", "2026-08-14", 64000), d(1003, "Avery Chen", "2026-09-02", 58000),
  d(1021, "Avery Chen", "2026-09-18", 120000, 50), d(1021, "Hana Sato", "2026-09-18", 120000, 50),
  d(1004, "Ben Okafor", "2026-07-21", 91000), d(1005, "Ben Okafor", "2026-08-30", 77000), d(1006, "Ben Okafor", "2026-09-25", 66000),
  d(1007, "Priya Nair", "2026-07-03", 140000), d(1008, "Priya Nair", "2026-08-11", 112000), d(1009, "Priya Nair", "2026-09-15", 138000),
  d(1010, "Diego Ramos", "2026-07-29", 69000), d(1011, "Diego Ramos", "2026-08-19", 88000), d(1012, "Diego Ramos", "2026-09-27", 54000),
  d(1013, "Marcus Webb", "2026-07-12", 96000), d(1014, "Marcus Webb", "2026-08-05", 105000, 100, "2026-09-14"), d(1015, "Marcus Webb", "2026-09-09", 83000),
  d(1016, "Hana Sato", "2026-07-17", 72000), d(1017, "Hana Sato", "2026-08-26", 61000),
  d(1018, "Leo Fischer", "2026-07-24", 99000), d(1019, "Leo Fischer", "2026-09-04", 97000),
  d(1020, "Sofia Marin", "2026-07-06", 210000), d(1022, "Sofia Marin", "2026-08-13", 185000), d(1023, "Sofia Marin", "2026-09-22", 295000),
];

export const SAMPLES: SampleSpec[] = [
  {
    file: "Q3_Comp_FINAL_v7_USE_THIS.xlsx",
    title: "AE team, 8 payees — messy (5 planted defects)",
    planText: AE_PLAN,
    truthRules: AE_TRUTH,
    ambiguities: AE_AMBIGUITIES,
    reps: AE_REPS,
    deals: AE_DEALS,
    defects: [
      { rep: "Priya Nair", cause: "accelerator_mode" },
      { rep: "Marcus Webb", cause: "clawback_missed" },
      { rep: "Avery Chen", cause: "split_double_credit" },
      { rep: "Hana Sato", cause: "split_double_credit" },
      { rep: "Sofia Marin", cause: "cap_ignored" },
      { rep: "Leo Fischer", cause: "hardcoded_override", overrideDelta: 2500 },
    ],
    refErrorCell: "G9",
    hiddenSheet: "Rates_OLD_do_not_use",
  },
  {
    file: "Q3_Comp_clean_control.xlsx",
    title: "AE team, 8 payees — clean control (0 defects)",
    planText: AE_PLAN,
    truthRules: AE_TRUTH,
    ambiguities: AE_AMBIGUITIES,
    reps: AE_REPS,
    deals: AE_DEALS,
    defects: [],
  },
  {
    file: "MidMarket_Q3_payouts_v3-copy.xlsx",
    title: "Mid-market team, retroactive plan — 3 planted defects",
    planText: `Mid-Market AE Plan, Q3 FY26 (ILLUSTRATIVE SAMPLE)

1. Quota is the quarterly ACV figure on the Payouts tab.
2. Commission rate is 8% of credited ACV below quota.
3. Once a rep reaches 100% of quota, all ACV for the quarter is paid at 12%. Reps reaching 125% are paid 14% on all ACV for the quarter.
4. There is no cap on earnings.
5. Shared deals are credited by the split percentage on the deal.
6. Deals cancelled within 60 days of close are clawed back.`,
    truthRules: {
      tiers: [
        { fromPct: 0, toPct: 100, rate: 0.08 },
        { fromPct: 100, toPct: 125, rate: 0.12 },
        { fromPct: 125, toPct: null, rate: 0.14 },
      ],
      acceleratorMode: "retroactive",
      capPct: null,
      clawbackDays: 60,
      splitRule: "pro_rata",
      spiffs: [],
      spiffSplit: "pro_rata",
    },
    ambiguities: [
      {
        id: "clawback-start",
        clause: "Deals cancelled within 60 days of close are clawed back.",
        issue: "Is the clawback window 60 or 90 days? Finance's old template used 90.",
        readings: [
          { label: "60-day window (as written)", patch: { clawbackDays: 60 } },
          { label: "90-day window (old template)", patch: { clawbackDays: 90 } },
        ],
      },
    ],
    reps: [
      { rep: "Nina Patel", quota: 200000 },
      { rep: "Omar Haddad", quota: 200000 },
      { rep: "Grace Liu", quota: 220000 },
      { rep: "Tom Becker", quota: 200000 },
      { rep: "Ines Duarte", quota: 180000 },
    ],
    deals: [
      d(2001, "Nina Patel", "2026-07-10", 90000), d(2002, "Nina Patel", "2026-08-20", 140000),
      d(2003, "Omar Haddad", "2026-07-15", 80000), d(2004, "Omar Haddad", "2026-09-01", 60000, 100, "2026-10-12"),
      d(2005, "Grace Liu", "2026-07-30", 150000), d(2006, "Grace Liu", "2026-09-10", 135000),
      d(2007, "Tom Becker", "2026-08-02", 70000), d(2008, "Tom Becker", "2026-09-19", 50000, 100, "2026-11-25"),
      d(2009, "Ines Duarte", "2026-07-22", 120000), d(2010, "Ines Duarte", "2026-09-05", 95000),
    ],
    defects: [
      { rep: "Nina Patel", cause: "accelerator_mode" },
      { rep: "Omar Haddad", cause: "clawback_missed" },
      { rep: "Ines Duarte", cause: "hardcoded_override", overrideDelta: -1800 },
    ],
    refErrorCell: "G5",
  },
];
