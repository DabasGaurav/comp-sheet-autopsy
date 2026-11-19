"use client";
// Browser-side helpers: session id, event logging, local demo store for leads.
import type { Autopsy, Cause } from "./types";

export const CAUSE_LABEL: Record<Cause, string> = {
  accelerator_mode: "Accelerator applied the wrong way",
  clawback_missed: "Clawback not applied",
  split_double_credit: "Split deal double-credited",
  cap_ignored: "Paid above the cap",
  spiff_missed: "SPIFF not paid",
  hardcoded_override: "Typed-over formula",
  unexplained: "Unexplained variance",
};

let sid: string | null = null;
export function sessionId() {
  if (sid) return sid;
  try { sid = sessionStorage.getItem("csa_sid"); } catch {}
  if (!sid) {
    sid = (crypto.randomUUID?.() ?? String(Date.now())).slice(0, 18);
    try { sessionStorage.setItem("csa_sid", sid); } catch {}
  }
  return sid;
}

export function track(type: string, props: Record<string, unknown> = {}) {
  const body = JSON.stringify({ type, sessionId: sessionId(), props });
  try {
    fetch("/api/events", { method: "POST", headers: { "Content-Type": "application/json" }, body, keepalive: true });
  } catch {}
}

export const usd = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;

/** Aggregated, name-free findings — the only autopsy detail that is ever sent to the model. */
export function aggregateFindings(a: Autopsy): string[] {
  const by = new Map<Cause, { reps: number; dollars: number }>();
  for (const r of a.reps) for (const c of r.causes) {
    const cur = by.get(c) ?? { reps: 0, dollars: 0 };
    cur.reps += 1; cur.dollars += r.variance; by.set(c, cur);
  }
  return [...by.entries()]
    .sort((x, y) => Math.abs(y[1].dollars) - Math.abs(x[1].dollars))
    .map(([c, v]) => `${CAUSE_LABEL[c]}: ${v.reps} rep${v.reps > 1 ? "s" : ""}, ${usd(Math.abs(v.dollars))} ${v.dollars >= 0 ? "overpaid" : "underpaid"}`);
}

export type Lead = {
  id: string;
  createdAt: string;
  email: string; company: string; role: string; payees: number;
  qualified: boolean; reasons: string[];
  findings: string[];
  overpaid: number; underpaid: number; repsWithErrors: number;
  topAmbiguity: { clause: string; dollarsAtStake: number } | null;
  opener: { draft: string; source: "live" | "none"; final?: string; status: "pending" | "approved" | "edited"; editReason?: string; editRatio?: number };
  hubspotPayload: unknown;
};

export function loadLeads(): Lead[] {
  try { return JSON.parse(localStorage.getItem("csa_leads") ?? "[]"); } catch { return []; }
}
export function saveLeads(leads: Lead[]) {
  try { localStorage.setItem("csa_leads", JSON.stringify(leads)); } catch {}
}

/** Normalised word-level edit ratio (0 = untouched, 1 = fully rewritten). */
export function editRatio(a: string, b: string): number {
  const x = a.split(/\s+/).filter(Boolean), y = b.split(/\s+/).filter(Boolean);
  const dp = Array.from({ length: x.length + 1 }, (_, i) => [i, ...Array(y.length).fill(0)]);
  for (let j = 1; j <= y.length; j++) dp[0][j] = j;
  for (let i = 1; i <= x.length; i++)
    for (let j = 1; j <= y.length; j++)
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (x[i - 1] === y[j - 1] ? 0 : 1));
  return Math.round((dp[x.length][y.length] / Math.max(1, x.length, y.length)) * 100) / 100;
}
