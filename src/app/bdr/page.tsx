"use client";
import { useEffect, useState } from "react";
import { editRatio, loadLeads, saveLeads, track, usd, type Lead } from "@/lib/client";

const REASONS = ["Wrong or unsupported fact", "Tone off-brand", "Too long", "Needs more personalisation", "CTA wrong", "Other"];

export default function BdrQueue() {
  const [leads, setLeads] = useState<Lead[]>([]);
  useEffect(() => setLeads(loadLeads()), []);
  const update = (l: Lead) => { const next = leads.map((x) => (x.id === l.id ? l : x)); setLeads(next); saveLeads(next); };
  const queue = leads.filter((l) => l.qualified);
  const done = queue.filter((l) => l.opener.status !== "pending");
  const edited = done.filter((l) => l.opener.status === "edited");
  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-muted">Internal view · what the BDR sees</p>
          <h1 className="font-serif text-4xl font-semibold mt-1">BDR queue</h1>
          <p className="text-sm text-muted mt-1">Machine did the deterministic part (find, size, qualify, route, draft). The rep keeps the judgement: approve, or edit with a reason.</p>
        </div>
        <div className="text-right text-sm">
          <div><span className="text-muted">Reviewed</span> <b className="num">{done.length}/{queue.length}</b></div>
          <div><span className="text-muted">Edit rate</span> <b className="num">{done.length ? Math.round((edited.length / done.length) * 100) : 0}%</b></div>
        </div>
      </div>
      <p className="text-xs text-muted">Demo store: leads live in this browser&apos;s local storage. In production this is a HubSpot task queue.</p>
      {queue.length === 0 && <div className="rounded-2xl border border-line bg-white p-8 text-center text-muted">No qualified leads yet. Run an autopsy and submit the form.</div>}
      {queue.map((l) => <LeadCard key={l.id} lead={l} onUpdate={update} />)}
    </div>
  );
}

function LeadCard({ lead, onUpdate }: { lead: Lead; onUpdate: (l: Lead) => void }) {
  const [text, setText] = useState(lead.opener.final ?? lead.opener.draft);
  const [reason, setReason] = useState("");
  const changed = text.trim() !== lead.opener.draft.trim();
  const approve = () => {
    if (changed && !reason) return;
    const ratio = editRatio(lead.opener.draft, text);
    const status = changed ? "edited" : "approved";
    onUpdate({ ...lead, opener: { ...lead.opener, final: text, status, editReason: changed ? reason : undefined, editRatio: ratio } });
    track(changed ? "opener_edited" : "opener_approved", { editRatio: ratio, reason: changed ? reason : null, draftSource: lead.opener.source });
  };
  return (
    <div className="rounded-2xl border border-line bg-white p-5 grid md:grid-cols-[1fr_1.3fr] gap-6">
      <div>
        <div className="flex items-center gap-2">
          <h3 className="font-semibold">{lead.company}</h3>
          <span className="text-[10px] rounded-full bg-bow/10 text-bow px-2 py-0.5">MQL · routed by rule</span>
        </div>
        <p className="text-xs text-muted">{lead.role} · {lead.email} · {new Date(lead.createdAt).toLocaleString()}</p>
        <div className="mt-3 text-sm space-y-1">
          <p><b className="text-blood num">{usd(lead.overpaid + lead.underpaid)}</b> paid wrong across <b>{lead.repsWithErrors}</b> of {lead.payees} payees</p>
          {lead.findings.slice(0, 3).map((f) => <p key={f} className="text-xs">• {f}</p>)}
          {lead.topAmbiguity && <p className="text-xs">• Ambiguous clause worth <b>{usd(lead.topAmbiguity.dollarsAtStake)}</b>: <i>“{lead.topAmbiguity.clause}”</i></p>}
          <p className="text-xs text-muted mt-2">Why routed: {lead.reasons.join(" · ")}</p>
        </div>
        <details className="mt-3 text-xs"><summary className="cursor-pointer text-muted">HubSpot payload (mock)</summary>
          <pre className="mt-2 overflow-auto rounded bg-paper p-2 text-[10px]">{JSON.stringify(lead.hubspotPayload, null, 2)}</pre></details>
      </div>
      <div>
        <div className="flex items-center justify-between text-xs text-muted mb-1">
          <span>First draft {lead.opener.source === "live" ? "(model-drafted from aggregated findings only)" : "(no draft — write by hand)"}</span>
          {lead.opener.status !== "pending" && <span className="font-medium text-ink">{lead.opener.status === "approved" ? "✓ Approved as drafted" : `✎ Edited (${Math.round((lead.opener.editRatio ?? 0) * 100)}% changed) · ${lead.opener.editReason}`}</span>}
        </div>
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={9} disabled={lead.opener.status !== "pending"}
          className="w-full rounded-lg border border-line p-3 text-sm font-[inherit] disabled:bg-paper" />
        {lead.opener.status === "pending" && (
          <div className="mt-2 flex items-center gap-2">
            {changed && (
              <select value={reason} onChange={(e) => setReason(e.target.value)} className="rounded border border-line px-2 py-1.5 text-xs">
                <option value="">Why did you edit? (required)</option>
                {REASONS.map((r) => <option key={r}>{r}</option>)}
              </select>
            )}
            <button onClick={approve} disabled={changed && !reason} className="ml-auto rounded-full bg-ink text-paper px-5 py-2 text-sm disabled:opacity-40">
              {changed ? "Save edit & send (mock)" : "Approve & send (mock)"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
