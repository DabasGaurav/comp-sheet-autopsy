"use client";
import { useCallback, useMemo, useRef, useState } from "react";
import type { Autopsy, ColumnMap, Extraction, Rules } from "@/lib/types";
import { readWorkbook, buildLedger, hygieneChecks, type ParsedWorkbook } from "@/lib/workbook";
import { runAutopsy, qualify } from "@/lib/engine";
import { SAMPLES } from "@/lib/samples";
import { CAUSE_LABEL, aggregateFindings, loadLeads, saveLeads, sessionId, track, usd, type Lead } from "@/lib/client";

type Stage = "upload" | "reading" | "confirm" | "report";

export default function AutopsyApp() {
  const [stage, setStage] = useState<Stage>("upload");
  const [pw, setPw] = useState<ParsedWorkbook | null>(null);
  const [sampleFile, setSampleFile] = useState<string | null>(null);
  const [ex, setEx] = useState<(Extraction & { fallbackReason?: string }) | null>(null);
  const [rules, setRules] = useState<Rules | null>(null);
  const [map, setMap] = useState<ColumnMap | null>(null);
  const [autopsy, setAutopsy] = useState<Autopsy | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [edits, setEdits] = useState<string[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  const start = useCallback(async (buf: ArrayBuffer, fileName: string, sample: string | null) => {
    setError(null); setAutopsy(null); setEdits([]);
    track("autopsy_started", { source: sample ? "sample" : "own_file" });
    let parsed: ParsedWorkbook;
    try {
      parsed = readWorkbook(buf, fileName);
      track("parsed_ok", { sheets: parsed.sheetNames.length });
    } catch {
      track("parsed_err");
      setError("That file didn't open as a spreadsheet. Try an .xlsx export.");
      return;
    }
    setPw(parsed); setSampleFile(sample); setStage("reading");
    try {
      const res = await fetch("/api/extract", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planText: parsed.planText, headers: parsed.headers, sampleFile: sample, sessionId: sessionId() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Extraction failed");
      track(data.source === "live" ? "extraction_ok_client" : "extraction_cached", { latencyMs: data.latencyMs ?? null, inputTokens: data.inputTokens ?? null, outputTokens: data.outputTokens ?? null, model: data.model ?? null });
      setEx(data); setRules(data.rules); setMap(data.columnMap); setStage("confirm");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Extraction failed"); setStage("upload");
    }
  }, []);

  const onFile = async (f: File) => {
    if (f.size > 5_000_000) { setError("Keep it under 5 MB for now."); return; }
    start(await f.arrayBuffer(), f.name, null);
  };
  const onSample = async (file: string) => {
    const buf = await (await fetch(`/samples/${encodeURIComponent(file)}`)).arrayBuffer();
    start(buf, file, file);
  };

  const run = () => {
    if (!pw || !rules || !map || !ex) return;
    try {
      const ledger = buildLedger(pw, map);
      const a = runAutopsy(ledger, rules, ex.ambiguities, hygieneChecks(pw));
      setAutopsy(a); setStage("report"); setError(null);
      track("report_viewed", {
        payees: a.reps.length, repsWithErrors: a.repsWithErrors,
        dollarsWrong: Math.round(a.totals.overpaid + a.totals.underpaid), edits: edits.length,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't build the ledger — check the column mapping.");
    }
  };

  const editRule = (field: string, next: Rules) => {
    setRules(next);
    if (!edits.includes(field)) setEdits([...edits, field]);
    track("rule_edited", { field });
  };

  return (
    <div className="space-y-8">
      {stage === "upload" || stage === "reading" ? (
        <Hero stage={stage} error={error} fileRef={fileRef} onFile={onFile} onSample={onSample} />
      ) : null}

      {stage === "confirm" && ex && rules && map && pw && (
        <Confirm ex={ex} rules={rules} map={map} pw={pw} edits={edits} onRule={editRule} onMap={setMap} onRun={run} error={error}
          onBack={() => setStage("upload")} />
      )}

      {stage === "report" && autopsy && pw && (
        <Report a={autopsy} pw={pw} ex={ex!} onBack={() => setStage("confirm")} onRestart={() => { setStage("upload"); setAutopsy(null); }} sampleFile={sampleFile} />
      )}
    </div>
  );
}

/* ---------------- Upload ---------------- */
function Hero({ stage, error, fileRef, onFile, onSample }: {
  stage: Stage; error: string | null; fileRef: React.RefObject<HTMLInputElement | null>;
  onFile: (f: File) => void; onSample: (f: string) => void;
}) {
  const [over, setOver] = useState(false);
  return (
    <section className="grid md:grid-cols-[1.15fr_1fr] gap-10 items-start">
      <div className="pt-4">
        <p className="text-xs uppercase tracking-[0.2em] text-muted mb-3">For RevOps & comp teams still on spreadsheets</p>
        <h1 className="font-serif text-5xl leading-[1.05] font-semibold">
          Your comp spreadsheet died.<br /><span className="italic text-blood">Let&apos;s find out how.</span>
        </h1>
        <p className="mt-5 text-lg text-muted max-w-xl">
          Drop last quarter&apos;s commission workbook. We read the plan, recompute every payout with deterministic code,
          and show you exactly which cells paid the wrong amount — in dollars.
        </p>
        <ul className="mt-6 space-y-2 text-sm">
          <li>🔒 <b>Rows never leave your browser.</b> Only the plan text and column headers go to the model.</li>
          <li>🧮 <b>The model does no math.</b> It reads the plan; code computes every dollar.</li>
          <li>⚖️ <b>Ambiguous clauses get priced, not guessed.</b> We run both readings and show what the sentence is worth.</li>
        </ul>
      </div>

      <div className="rounded-2xl border border-line bg-white p-6 shadow-sm">
        <div
          onDragOver={(e) => { e.preventDefault(); setOver(true); }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => { e.preventDefault(); setOver(false); const f = e.dataTransfer.files?.[0]; if (f) onFile(f); }}
          onClick={() => fileRef.current?.click()}
          className={`cursor-pointer rounded-xl border-2 border-dashed p-8 text-center transition ${over ? "border-bow bg-bow/5" : "border-line hover:border-ink/40"}`}
        >
          {stage === "reading" ? (
            <div className="py-6">
              <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-line border-t-ink" />
              <p className="mt-4 text-sm">Reading the plan… <span className="text-muted">(the model is only reading — no math)</span></p>
            </div>
          ) : (
            <>
              <div className="text-4xl">⚰️</div>
              <p className="mt-3 font-medium">Drop your comp workbook (.xlsx)</p>
              <p className="text-xs text-muted mt-1">Needs a Plan tab (plan wording), a Deals tab and a Payouts tab</p>
            </>
          )}
          <input ref={fileRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); }} />
        </div>
        <div className="mt-5">
          <p className="text-xs text-muted mb-2">No sheet handy? Try an <b>illustrative</b> one (synthetic data, planted mistakes):</p>
          <div className="space-y-2">
            {SAMPLES.map((s) => (
              <button key={s.file} disabled={stage === "reading"} onClick={() => onSample(s.file)}
                className="w-full text-left rounded-lg border border-line px-3 py-2 hover:bg-paper disabled:opacity-50">
                <div className="font-mono text-xs">{s.file}</div>
                <div className="text-xs text-muted">{s.title}</div>
              </button>
            ))}
          </div>
        </div>
        {error && <p className="mt-4 text-sm text-blood">{error}</p>}
      </div>
    </section>
  );
}

/* ---------------- Confirm (human in the loop) ---------------- */
function Confirm({ ex, rules, map, pw, edits, onRule, onMap, onRun, onBack, error }: {
  ex: Extraction & { fallbackReason?: string }; rules: Rules; map: ColumnMap; pw: ParsedWorkbook; edits: string[];
  onRule: (field: string, r: Rules) => void; onMap: (m: ColumnMap) => void; onRun: () => void; onBack: () => void; error: string | null;
}) {
  const q = ex.quotes as Record<string, string | null | undefined>;
  const pct = (n: number) => Math.round(n * 1000) / 10;
  return (
    <section className="space-y-6">
      <div className="flex items-end justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-muted">Step 2 of 3 · you confirm, we compute</p>
          <h2 className="font-serif text-3xl font-semibold mt-1">Here&apos;s how we read your plan</h2>
          <p className="text-sm text-muted mt-1">Every rule shows the sentence it came from. Fix anything we got wrong — edits are logged.</p>
        </div>
        <SourceBadge ex={ex} />
      </div>

      <div className="grid md:grid-cols-[1.4fr_1fr] gap-6">
        <div className="rounded-2xl border border-line bg-white divide-y divide-line">
          <RuleRow label="Rate tiers" quote={q.tiers} edited={edits.includes("tiers")}>
            <div className="space-y-1">
              {rules.tiers.map((t, i) => (
                <div key={i} className="flex items-center gap-2 text-sm num">
                  <span className="w-28 text-muted">{t.fromPct}% → {t.toPct == null ? "∞" : `${t.toPct}%`}</span>
                  <input type="number" step="0.5" value={pct(t.rate)} className="w-20 rounded border border-line px-2 py-0.5"
                    onChange={(e) => {
                      const tiers = rules.tiers.map((x, j) => (j === i ? { ...x, rate: Number(e.target.value) / 100 } : x));
                      onRule("tiers", { ...rules, tiers });
                    }} />
                  <span>%</span>
                </div>
              ))}
            </div>
          </RuleRow>
          <RuleRow label="Accelerator applies to" quote={q.acceleratorMode} edited={edits.includes("acceleratorMode")}>
            <select value={rules.acceleratorMode} className="rounded border border-line px-2 py-1 text-sm"
              onChange={(e) => onRule("acceleratorMode", { ...rules, acceleratorMode: e.target.value as Rules["acceleratorMode"] })}>
              <option value="marginal">Only bookings above each threshold (marginal)</option>
              <option value="retroactive">All bookings once a threshold is hit (retroactive)</option>
            </select>
          </RuleRow>
          <RuleRow label="Cap" quote={q.capPct} edited={edits.includes("capPct")}>
            <NumOrNone value={rules.capPct} suffix="% of quota" onChange={(v) => onRule("capPct", { ...rules, capPct: v })} />
          </RuleRow>
          <RuleRow label="Clawback window" quote={q.clawbackDays} edited={edits.includes("clawbackDays")}>
            <NumOrNone value={rules.clawbackDays} suffix="days after close" onChange={(v) => onRule("clawbackDays", { ...rules, clawbackDays: v })} />
          </RuleRow>
          <RuleRow label="Split deals" quote={q.splitRule} edited={edits.includes("splitRule")}>
            <select value={rules.splitRule} className="rounded border border-line px-2 py-1 text-sm"
              onChange={(e) => onRule("splitRule", { ...rules, splitRule: e.target.value as Rules["splitRule"] })}>
              <option value="pro_rata">Each rep credited their split %</option>
              <option value="full_credit_each">Each rep credited 100%</option>
            </select>
          </RuleRow>
          <RuleRow label="SPIFFs" quote={q.spiffs} edited={edits.includes("spiffs")}>
            {rules.spiffs.length === 0 ? <span className="text-sm text-muted">None in plan</span> :
              rules.spiffs.map((s, i) => (
                <div key={i} className="text-sm num">{usd(s.amount)} per deal ≥ {usd(s.minDealAmount)}</div>
              ))}
            {rules.spiffs.length > 0 && (
              <select value={rules.spiffSplit} className="mt-1 rounded border border-line px-2 py-1 text-xs"
                onChange={(e) => onRule("spiffSplit", { ...rules, spiffSplit: e.target.value as Rules["spiffSplit"] })}>
                <option value="pro_rata">On split deals: paid by split share</option>
                <option value="full_each">On split deals: full SPIFF to each rep</option>
              </select>
            )}
          </RuleRow>
        </div>

        <div className="space-y-4">
          <div className="rounded-2xl border border-gold/40 bg-gold/5 p-4">
            <h3 className="font-semibold text-sm">⚖️ Ambiguous clauses ({ex.ambiguities.length})</h3>
            <p className="text-xs text-muted mb-3">We don&apos;t pick a reading. We&apos;ll price both in the report.</p>
            {ex.ambiguities.length === 0 && <p className="text-sm text-muted">None found.</p>}
            <div className="space-y-3">
              {ex.ambiguities.map((a) => (
                <div key={a.id} className="text-sm">
                  <p className="font-serif italic">“{a.clause}”</p>
                  <p className="text-xs text-muted mt-1">{a.issue}</p>
                </div>
              ))}
            </div>
          </div>

          <details className="rounded-2xl border border-line bg-white p-4 text-sm">
            <summary className="cursor-pointer font-semibold">Column mapping <span className="font-normal text-muted">(read from headers only)</span></summary>
            <MapEditor map={map} pw={pw} onMap={onMap} />
          </details>
        </div>
      </div>

      {error && <p className="text-sm text-blood">{error}</p>}
      <div className="flex gap-3">
        <button onClick={onRun} className="rounded-full bg-ink text-paper px-6 py-3 font-medium hover:opacity-90">Run the autopsy →</button>
        <button onClick={onBack} className="rounded-full border border-line px-5 py-3 text-sm">Back</button>
      </div>
    </section>
  );
}

function SourceBadge({ ex }: { ex: Extraction & { fallbackReason?: string } }) {
  if (ex.source === "live")
    return <span className="text-xs rounded-full bg-bow/10 text-bow px-3 py-1 whitespace-nowrap">● Live read · {ex.model} · {((ex.latencyMs ?? 0) / 1000).toFixed(1)}s</span>;
  return <span className="text-xs rounded-full bg-gold/15 text-gold px-3 py-1 whitespace-nowrap" title={ex.fallbackReason}>● Cached read of the sample ({ex.fallbackReason ?? "offline"})</span>;
}

function RuleRow({ label, quote, edited, children }: { label: string; quote?: string | null; edited: boolean; children: React.ReactNode }) {
  return (
    <div className="p-4 grid grid-cols-[150px_1fr] gap-4">
      <div className="text-sm font-medium">{label}{edited && <span className="ml-2 text-[10px] rounded bg-ink text-paper px-1.5 py-0.5">edited</span>}</div>
      <div>
        {children}
        <p className="mt-2 text-xs text-muted font-serif italic">{quote ? `“${quote}”` : "Plan is silent on this."}</p>
      </div>
    </div>
  );
}

function NumOrNone({ value, suffix, onChange }: { value: number | null; suffix: string; onChange: (v: number | null) => void }) {
  return (
    <div className="flex items-center gap-2 text-sm">
      <input type="number" value={value ?? ""} placeholder="none" className="w-24 rounded border border-line px-2 py-0.5 num"
        onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))} />
      <span className="text-muted">{value == null ? "none" : suffix}</span>
    </div>
  );
}

function MapEditor({ map, pw, onMap }: { map: ColumnMap; pw: ParsedWorkbook; onMap: (m: ColumnMap) => void }) {
  const sel = (sheet: string, value: string | null, set: (v: string) => void, optional = false) => (
    <select value={value ?? ""} onChange={(e) => set(e.target.value)} className="rounded border border-line px-1 py-0.5 text-xs max-w-[160px]">
      {optional && <option value="">— none —</option>}
      {(pw.headers[sheet] ?? []).filter(Boolean).map((h) => <option key={h} value={h}>{h}</option>)}
    </select>
  );
  const D = map.deals, P = map.payouts;
  const setD = (k: keyof ColumnMap["deals"], v: string) => onMap({ ...map, deals: { ...D, [k]: v || null } });
  const setP = (k: keyof ColumnMap["payouts"], v: string) => onMap({ ...map, payouts: { ...P, [k]: v } });
  return (
    <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
      <span className="text-muted">Deals tab</span><span className="font-mono">{map.dealsSheet}</span>
      <span>Rep</span>{sel(map.dealsSheet, D.rep, (v) => setD("rep", v))}
      <span>Amount</span>{sel(map.dealsSheet, D.amount, (v) => setD("amount", v))}
      <span>Close date</span>{sel(map.dealsSheet, D.closeDate, (v) => setD("closeDate", v))}
      <span>Split %</span>{sel(map.dealsSheet, D.splitPct, (v) => setD("splitPct", v), true)}
      <span>Churn date</span>{sel(map.dealsSheet, D.churnDate, (v) => setD("churnDate", v), true)}
      <span className="text-muted">Payouts tab</span><span className="font-mono">{map.payoutsSheet}</span>
      <span>Rep</span>{sel(map.payoutsSheet, P.rep, (v) => setP("rep", v))}
      <span>Quota</span>{sel(map.payoutsSheet, P.quota, (v) => setP("quota", v))}
      <span>Payout</span>{sel(map.payoutsSheet, P.payout, (v) => setP("payout", v))}
    </div>
  );
}

/* ---------------- Report + last mile ---------------- */
function Report({ a, pw, ex, onBack, onRestart, sampleFile }: { a: Autopsy; pw: ParsedWorkbook; ex: Extraction; onBack: () => void; onRestart: () => void; sampleFile: string | null }) {
  const wrong = a.totals.overpaid + a.totals.underpaid;
  const errCells = a.hygiene.filter((h) => h.kind === "error_cell");
  const flagged = a.reps.filter((r) => r.causes.length);
  const lid = useMemo(() => [
    ...flagged.map((r) => `${r.cell.split("!")[1]}  ${r.variance > 0 ? "+" : "−"}${usd(Math.abs(r.variance))}`),
    ...errCells.map((h) => `${h.where.split("!")[1]}  #REF!`),
  ], [flagged, errCells]);

  return (
    <section className="space-y-8">
      <div className="flex items-end justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-muted">Step 3 of 3 · autopsy of <span className="font-mono normal-case tracking-normal">{pw.fileName}</span>{sampleFile && " (illustrative)"}</p>
          <h2 className="font-serif text-4xl font-semibold mt-1">Cause of death: <span className="italic text-blood">{usd(wrong)}</span> paid wrong</h2>
          <p className="text-sm text-muted mt-1">{a.repsWithErrors} of {a.reps.length} payees affected · recomputed with deterministic code against the rules you confirmed</p>
        </div>
        <div className="flex gap-2">
          <button onClick={onBack} className="rounded-full border border-line px-4 py-2 text-sm">Edit rules</button>
          <button onClick={onRestart} className="rounded-full border border-line px-4 py-2 text-sm">New file</button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="Overpaid" value={usd(a.totals.overpaid)} tone="blood" />
        <Stat label="Underpaid" value={usd(a.totals.underpaid)} tone="gold" />
        <Stat label="Sheet total" value={usd(a.totals.sheet)} />
        <Stat label="Should have been" value={usd(a.totals.expected)} tone="bow" />
      </div>

      <div className="grid md:grid-cols-[1.5fr_1fr] gap-6">
        <div className="rounded-2xl border border-line bg-white overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-paper text-xs text-muted">
              <tr><th className="text-left p-3">Payee</th><th className="text-right p-3">Attain.</th><th className="text-right p-3">Sheet paid</th><th className="text-right p-3">Should be</th><th className="text-right p-3">Variance</th><th className="text-left p-3">Cause</th></tr>
            </thead>
            <tbody className="divide-y divide-line">
              {a.reps.map((r) => (
                <tr key={r.rep} className={r.causes.length ? "bg-blood/[0.03]" : ""}>
                  <td className="p-3"><div>{r.rep}</div><div className="font-mono text-[11px] text-muted">{r.cell}</div></td>
                  <td className="p-3 text-right num">{r.attainmentPct}%</td>
                  <td className="p-3 text-right num">{usd(r.sheetPayout)}</td>
                  <td className="p-3 text-right num">{usd(r.expectedPayout)}</td>
                  <td className={`p-3 text-right num font-medium ${r.variance > 1 ? "text-blood" : r.variance < -1 ? "text-gold" : "text-muted"}`}>
                    {Math.abs(r.variance) <= 1 ? "✓" : `${r.variance > 0 ? "+" : "−"}${usd(Math.abs(r.variance))}`}
                  </td>
                  <td className="p-3 text-xs">
                    {r.causes.map((c) => <div key={c} className="font-medium">{CAUSE_LABEL[c]}</div>)}
                    {r.notes.map((n, i) => <div key={i} className="text-muted">{n}</div>)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="space-y-4">
          <div className="rounded-2xl bg-ink text-paper p-5">
            <p className="text-[10px] uppercase tracking-[0.25em] text-paper/60">The casket lid</p>
            <p className="font-serif text-lg mt-1">Here lie the cells that paid wrong.</p>
            <div className="mt-3 font-mono text-sm space-y-0.5">
              {lid.length ? lid.map((l) => <div key={l}>{l}</div>) : <div className="text-paper/60">Nothing. This sheet lives to see another quarter.</div>}
            </div>
          </div>

          {a.ambiguityPrices.map((p) => (
            <div key={p.id} className="rounded-2xl border border-gold/40 bg-gold/5 p-4">
              <p className="text-xs uppercase tracking-wider text-gold">This sentence is worth {usd(p.dollarsAtStake)}</p>
              <p className="font-serif italic mt-1">“{p.clause}”</p>
              <div className="mt-2 space-y-1 text-xs">
                {p.readings.map((r) => <div key={r.label} className="flex justify-between gap-3"><span>{r.label}</span><span className="num font-medium">{usd(r.totalPayout)}</span></div>)}
              </div>
              <p className="text-[11px] text-muted mt-2">Total payout across all payees under each reading. Rewrite the clause before plans go out.</p>
            </div>
          ))}

          {a.hygiene.length > 0 && (
            <div className="rounded-2xl border border-line bg-white p-4">
              <h3 className="text-sm font-semibold">Workbook hygiene</h3>
              <ul className="mt-2 space-y-1 text-xs">
                {a.hygiene.map((h, i) => <li key={i}><span className="font-mono">{h.where}</span> — {h.detail}</li>)}
              </ul>
            </div>
          )}
        </div>
      </div>

      <LeadCapture a={a} ex={ex} />
    </section>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "blood" | "gold" | "bow" }) {
  const c = tone === "blood" ? "text-blood" : tone === "gold" ? "text-gold" : tone === "bow" ? "text-bow" : "";
  return (
    <div className="rounded-2xl border border-line bg-white p-4">
      <p className="text-xs text-muted">{label}</p>
      <p className={`text-2xl font-semibold num mt-1 ${c}`}>{value}</p>
    </div>
  );
}

function LeadCapture({ a, ex }: { a: Autopsy; ex: Extraction }) {
  const [form, setForm] = useState({ email: "", company: "", role: "Head of RevOps" });
  const [state, setState] = useState<"idle" | "sending" | "done">("idle");
  const [lead, setLead] = useState<Lead | null>(null);
  const verdict = qualify(a);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(form.email)) return;
    setState("sending");
    const findings = aggregateFindings(a);
    const top = a.ambiguityPrices[0] ? { clause: a.ambiguityPrices[0].clause, dollarsAtStake: a.ambiguityPrices[0].dollarsAtStake } : null;
    track("lead_submitted", { qualified: verdict.qualified, extraction: ex.source });
    let draft = "", source: "live" | "none" = "none";
    if (verdict.qualified) {
      track("lead_qualified", { reasons: verdict.reasons.length });
      try {
        const r = await fetch("/api/opener", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ company: form.company, role: form.role, payees: a.reps.length, overpaid: a.totals.overpaid, underpaid: a.totals.underpaid, repsWithErrors: a.repsWithErrors, topFindings: findings.slice(0, 3), topAmbiguity: top }),
        });
        const d = await r.json();
        if (r.ok) { draft = d.text; source = "live"; } else draft = "";
      } catch {}
    }
    const domain = form.email.split("@")[1] ?? "";
    const l: Lead = {
      id: Math.random().toString(36).slice(2, 10), createdAt: new Date().toISOString(),
      email: form.email, company: form.company || domain, role: form.role, payees: a.reps.length,
      qualified: verdict.qualified, reasons: verdict.reasons, findings,
      overpaid: a.totals.overpaid, underpaid: a.totals.underpaid, repsWithErrors: a.repsWithErrors, topAmbiguity: top,
      opener: { draft, source, status: "pending" },
      hubspotPayload: {
        _note: "MOCK — shaped like a HubSpot CRM v3 contact upsert + task; not sent anywhere",
        contact: { properties: {
          email: form.email, company: form.company || domain, jobtitle: form.role,
          lifecyclestage: verdict.qualified ? "marketingqualifiedlead" : "lead",
          autopsy_payees: a.reps.length, autopsy_dollars_wrong: Math.round(a.totals.overpaid + a.totals.underpaid),
          autopsy_reps_affected: a.repsWithErrors, autopsy_top_ambiguity_usd: top?.dollarsAtStake ?? 0, lead_source_detail: "comp_sheet_autopsy",
        } },
        task: verdict.qualified ? { properties: { hs_task_subject: `Autopsy follow-up: ${form.company || domain}`, hs_task_priority: "HIGH", hs_task_type: "EMAIL", hs_timestamp: new Date(Date.now() + 2 * 3600e3).toISOString() } } : null,
      },
    };
    saveLeads([l, ...loadLeads()]);
    setLead(l); setState("done");
  };

  if (state === "done" && lead)
    return (
      <div className="rounded-2xl border border-bow/40 bg-bow/5 p-6">
        {lead.qualified ? (
          <>
            <h3 className="font-serif text-2xl font-semibold">Routed to a BDR — follow-up already drafted.</h3>
            <p className="text-sm text-muted mt-1">Qualified by rule, not by a model: {lead.reasons.join(" · ")}.</p>
            <p className="text-sm mt-3">The BDR gets a ready task with the findings and a first draft to approve or edit. <a className="underline font-medium" href="/bdr">Open the BDR queue →</a></p>
          </>
        ) : (
          <>
            <h3 className="font-serif text-2xl font-semibold">Saved. Your full autopsy is on its way.</h3>
            <p className="text-sm text-muted mt-1">Not routed to sales (the rule needs ≥ 8 payees and something actually wrong). It goes to nurture instead.</p>
          </>
        )}
      </div>
    );

  return (
    <form onSubmit={submit} className="rounded-2xl border border-line bg-white p-6 grid md:grid-cols-[1fr_auto] gap-6 items-end">
      <div>
        <h3 className="font-serif text-2xl font-semibold">Want the casket? It comes with a 20-minute walkthrough.</h3>
        <p className="text-sm text-muted mt-1">We&apos;ll send the full autopsy and a comp specialist walks you through fixing it. (That&apos;s the price.)</p>
        <div className="mt-4 grid md:grid-cols-3 gap-3">
          <input required type="email" placeholder="work email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="rounded-lg border border-line px-3 py-2 text-sm" />
          <input placeholder="company" value={form.company} onChange={(e) => setForm({ ...form, company: e.target.value })} className="rounded-lg border border-line px-3 py-2 text-sm" />
          <input placeholder="role" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} className="rounded-lg border border-line px-3 py-2 text-sm" />
        </div>
      </div>
      <button disabled={state === "sending"} className="rounded-full bg-bow text-white px-6 py-3 font-medium disabled:opacity-60">
        {state === "sending" ? "Sending…" : "Send me the autopsy"}
      </button>
    </form>
  );
}
