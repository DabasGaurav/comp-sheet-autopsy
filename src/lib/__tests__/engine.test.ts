// Hand-computed expectations (worked out on paper, not by the engine) for the core money paths.
import { describe, expect, it } from "vitest";
import { tieredCommission, payoutFor, runAutopsy } from "../engine";
import type { Ledger, Rules } from "../types";

const PLAN: Rules = {
  tiers: [ { fromPct: 0, toPct: 100, rate: 0.1 }, { fromPct: 100, toPct: 150, rate: 0.15 }, { fromPct: 150, toPct: null, rate: 0.2 } ],
  acceleratorMode: "marginal", capPct: 200, clawbackDays: 90, splitRule: "pro_rata",
  spiffs: [{ label: "big deal", minDealAmount: 100000, amount: 1000 }],
};

describe("tiered commission", () => {
  it("marginal: 390k on 300k quota = 300k@10% + 90k@15% = 43,500", () => {
    expect(tieredCommission(390000, 300000, PLAN)).toBeCloseTo(43500, 2);
  });
  it("retroactive: 390k on 300k quota = 390k@15% = 58,500", () => {
    expect(tieredCommission(390000, 300000, { ...PLAN, acceleratorMode: "retroactive" })).toBeCloseTo(58500, 2);
  });
  it("cap at 200%: 690k on 300k = 30,000 + 22,500 + 30,000 = 82,500", () => {
    expect(tieredCommission(690000, 300000, PLAN)).toBeCloseTo(82500, 2);
  });
  it("uncapped 690k = 82,500 + 90k@20% = 100,500", () => {
    expect(tieredCommission(690000, 300000, { ...PLAN, capPct: null })).toBeCloseTo(100500, 2);
  });
  it("exactly 100% attainment in retroactive mode pays the 100% tier rate (inclusive boundary)", () => {
    expect(tieredCommission(300000, 300000, { ...PLAN, acceleratorMode: "retroactive" })).toBeCloseTo(45000, 2);
  });
  it("zero quota or zero bookings pays nothing", () => {
    expect(tieredCommission(0, 300000, PLAN)).toBe(0);
    expect(tieredCommission(1000, 0, PLAN)).toBe(0);
  });
});

describe("credits", () => {
  const ledger: Ledger = {
    deals: [
      { dealId: "1", rep: "A", closeDate: "2026-07-01", amount: 120000, splitPct: 50, churnDate: null },
      { dealId: "2", rep: "A", closeDate: "2026-07-01", amount: 50000, splitPct: 100, churnDate: "2026-08-10" }, // 40 days -> clawed back
      { dealId: "3", rep: "A", closeDate: "2026-07-01", amount: 30000, splitPct: 100, churnDate: "2026-12-01" }, // 153 days -> kept
    ],
    payouts: [],
  };
  it("split pro-rata, clawback within 90 days, SPIFF split share: credit 90k, pay 9,000 + 500", () => {
    const r = payoutFor("A", 300000, ledger, PLAN);
    expect(r.credited).toBe(90000);
    expect(r.payout).toBe(9500);
  });
});

describe("reconciliation", () => {
  it("flags a typed-in override and explains a retroactive mistake", () => {
    const ledger: Ledger = {
      deals: [
        { dealId: "1", rep: "A", closeDate: "2026-07-01", amount: 390000, splitPct: 100, churnDate: null },
        { dealId: "2", rep: "B", closeDate: "2026-07-01", amount: 200000, splitPct: 100, churnDate: null },
        { dealId: "3", rep: "C", closeDate: "2026-07-01", amount: 90000, splitPct: 100, churnDate: null },
      ],
      payouts: [
        { rep: "A", quota: 300000, sheetPayout: 58500 + 1000, cell: "P!E2", isFormula: true }, // retroactive
        { rep: "B", quota: 300000, sheetPayout: 22500, cell: "P!E3", isFormula: false },        // typed: truth = 21,000
        { rep: "C", quota: 300000, sheetPayout: 9000, cell: "P!E4", isFormula: true },          // correct
      ],
    };
    const a = runAutopsy(ledger, PLAN);
    expect(a.reps[0].causes).toEqual(["accelerator_mode"]);
    expect(a.reps[0].variance).toBe(15000);
    expect(a.reps[1].causes).toEqual(["hardcoded_override"]);
    expect(a.reps[1].variance).toBe(1500);
    expect(a.reps[2].causes).toEqual([]);
    expect(a.totals.overpaid).toBe(16500);
  });
});
