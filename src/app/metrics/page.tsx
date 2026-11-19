"use client";
import { useEffect, useMemo, useState } from "react";

type Ev = { type: string; sessionId?: string; props?: Record<string, unknown>; ts: string };
const FUNNEL: [string, string][] = [
  ["autopsy_started", "Autopsy started"], ["parsed_ok", "Workbook parsed"], ["extraction_ok", "Plan read (live model)"],
  ["report_viewed", "Report viewed"], ["lead_submitted", "Lead submitted"], ["lead_qualified", "Qualified → BDR"],
];

export default function Metrics() {
  const [data, setData] = useState<{ store: string; events: Ev[] } | null>(null);
  useEffect(() => { fetch("/api/events", { cache: "no-store" }).then((r) => r.json()).then(setData); }, []);
  const ev = data?.events ?? [];
  const count = (t: string) => ev.filter((e) => e.type === t).length;
  const m = useMemo(() => {
    const lat = ev.filter((e) => e.type === "extraction_ok").map((e) => Number(e.props?.latencyMs ?? 0)).sort((a, b) => a - b);
    const tok = ev.filter((e) => e.type === "extraction_ok").map((e) => Number(e.props?.inputTokens ?? 0) + Number(e.props?.outputTokens ?? 0));
    const reviewed = count("opener_approved") + count("opener_edited");
    const reasons = new Map<string, number>();
    ev.filter((e) => e.type === "opener_edited").forEach((e) => { const r = String(e.props?.reason ?? "?"); reasons.set(r, (reasons.get(r) ?? 0) + 1); });
    const ratios = ev.filter((e) => e.type === "opener_edited").map((e) => Number(e.props?.editRatio ?? 0));
    const ruleEdits = new Map<string, number>();
    ev.filter((e) => e.type === "rule_edited").forEach((e) => { const f = String(e.props?.field); ruleEdits.set(f, (ruleEdits.get(f) ?? 0) + 1); });
    return {
      p50: lat.length ? lat[Math.floor(lat.length / 2)] : null,
      tokens: tok.length ? Math.round(tok.reduce((a, b) => a + b, 0) / tok.length) : null,
      extractFail: count("extraction_ok") + count("extraction_err") ? count("extraction_err") / (count("extraction_ok") + count("extraction_err")) : null,
      editRate: reviewed ? count("opener_edited") / reviewed : null,
      avgEditRatio: ratios.length ? ratios.reduce((a, b) => a + b, 0) / ratios.length : null,
      reviewed, reasons: [...reasons.entries()].sort((a, b) => b[1] - a[1]), ruleEdits: [...ruleEdits.entries()],
      ownFile: ev.filter((e) => e.type === "autopsy_started" && e.props?.source === "own_file").length,
    };
  }, [ev]);
  const top = Math.max(1, count("autopsy_started"));
  const pct = (x: number | null) => (x == null ? "—" : `${Math.round(x * 100)}%`);

  return (
    <div className="space-y-8">
      <div>
        <p className="text-xs uppercase tracking-[0.2em] text-muted">Built into the product · real events only, no seeded data</p>
        <h1 className="font-serif text-4xl font-semibold mt-1">Is it working?</h1>
        <p className="text-sm text-muted mt-1">Store: <span className="font-mono">{data?.store ?? "…"}</span>{data?.store === "memory" && " (resets when the server instance restarts — Supabase in production)"}</p>
      </div>

      <div className="grid md:grid-cols-[1.3fr_1fr] gap-6">
        <div className="rounded-2xl border border-line bg-white p-5">
          <h2 className="font-semibold">Funnel</h2>
          <div className="mt-4 space-y-2">
            {FUNNEL.map(([t, label]) => {
              const n = count(t);
              return (
                <div key={t} className="grid grid-cols-[170px_1fr_50px] items-center gap-3 text-sm">
                  <span>{label}</span>
                  <div className="h-5 rounded bg-paper overflow-hidden"><div className="h-full bg-ink" style={{ width: `${(n / top) * 100}%` }} /></div>
                  <span className="num text-right">{n}</span>
                </div>
              );
            })}
          </div>
          <p className="text-xs text-muted mt-3">{m.ownFile} of {count("autopsy_started")} runs used the visitor&apos;s own file (the riskiest assumption: will people upload?).</p>
        </div>

        <div className="grid grid-cols-2 gap-3 content-start">
          <Tile label="Opener edit rate" value={pct(m.editRate)} hint={`${m.reviewed} reviewed · healthy band ≈ some edits, few rewrites`} />
          <Tile label="Avg. share of draft changed" value={pct(m.avgEditRatio)} hint="1.0 = full rewrite → prompt is broken" />
          <Tile label="Extraction failure rate" value={pct(m.extractFail)} hint="guardrail" />
          <Tile label="p50 plan-read latency" value={m.p50 == null ? "—" : `${(m.p50 / 1000).toFixed(1)}s`} hint={m.tokens ? `${m.tokens.toLocaleString()} tokens / read` : ""} />
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        <div className="rounded-2xl border border-line bg-white p-5">
          <h2 className="font-semibold">Why BDRs edited the draft</h2>
          <p className="text-xs text-muted">Any reason in &gt;30% of edits goes back into the prompt.</p>
          <table className="mt-3 w-full text-sm">{m.reasons.length ? m.reasons.map(([r, n]) => <tr key={r}><td className="py-1">{r}</td><td className="text-right num">{n}</td></tr>) : <tr><td className="text-muted py-1">No edits yet.</td></tr>}</table>
          <h2 className="font-semibold mt-5">Which rules users corrected</h2>
          <p className="text-xs text-muted">Where the plan-reader is wrong most often.</p>
          <table className="mt-3 w-full text-sm">{m.ruleEdits.length ? m.ruleEdits.map(([r, n]) => <tr key={r}><td className="py-1 font-mono text-xs">{r}</td><td className="text-right num">{n}</td></tr>) : <tr><td className="text-muted py-1">No corrections yet.</td></tr>}</table>
        </div>
        <div className="rounded-2xl border border-line bg-white p-5 text-sm space-y-3">
          <h2 className="font-semibold">How we&apos;d know it worked</h2>
          <p><b>North star:</b> SQLs per 100 completed autopsies, vs. the current gated ROI-report CTA.</p>
          <p><b>Step 0 (2 weeks):</b> fake-door CTA on the spreadsheet-funeral page to test upload willingness before investing further.</p>
          <p><b>Step 1:</b> sequential holdout on comp-content traffic (Autopsy CTA vs ROI-report CTA), sample size set from the real baseline.</p>
          <p><b>Guardrails:</b> extraction failure rate, false flags disputed by users, opener full-rewrite rate.</p>
          <p><b>Off-switch test:</b> pause the BDR hand-off for two weeks. If nobody asks for it back, it wasn&apos;t working.</p>
          <p className="text-blood"><b>Kill if:</b> upload intent at the fake door stays under the threshold agreed upfront, or Autopsy-sourced SQL rate doesn&apos;t beat the ROI-report arm at the agreed sample size.</p>
        </div>
      </div>
    </div>
  );
}

function Tile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-2xl border border-line bg-white p-4">
      <p className="text-xs text-muted">{label}</p>
      <p className="text-2xl font-semibold num mt-1">{value}</p>
      {hint && <p className="text-[11px] text-muted mt-1">{hint}</p>}
    </div>
  );
}
