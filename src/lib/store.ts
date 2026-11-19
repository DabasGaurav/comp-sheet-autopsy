// Event store. Supabase (table `events`) when SUPABASE_URL + SUPABASE_SERVICE_KEY are set;
// otherwise an in-memory store for the running instance (labelled "demo store" in /metrics).
export type EventIn = { type: string; sessionId?: string; props?: Record<string, unknown> };
export type EventRow = EventIn & { ts: string };

const g = globalThis as unknown as { __events?: EventRow[] };
g.__events ??= [];

const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_KEY;
export const storeKind = SB_URL && SB_KEY ? "supabase" : "memory";

export async function logEvent(e: EventIn) {
  const row: EventRow = { type: e.type, sessionId: e.sessionId?.slice(0, 64), props: e.props ?? {}, ts: new Date().toISOString() };
  if (storeKind === "supabase") {
    try {
      await fetch(`${SB_URL}/rest/v1/events`, {
        method: "POST",
        headers: { apikey: SB_KEY!, Authorization: `Bearer ${SB_KEY}`, "Content-Type": "application/json", Prefer: "return=minimal" },
        body: JSON.stringify({ type: row.type, session_id: row.sessionId, props: row.props, ts: row.ts }),
      });
    } catch { /* never break the user flow for analytics */ }
  } else {
    g.__events!.push(row);
    if (g.__events!.length > 5000) g.__events!.shift();
  }
}

export async function listEvents(): Promise<{ store: string; events: EventRow[] }> {
  if (storeKind === "supabase") {
    try {
      const r = await fetch(`${SB_URL}/rest/v1/events?select=type,session_id,props,ts&order=ts.desc&limit=5000`, {
        headers: { apikey: SB_KEY!, Authorization: `Bearer ${SB_KEY}` }, cache: "no-store",
      });
      const rows = (await r.json()) as { type: string; session_id: string; props: Record<string, unknown>; ts: string }[];
      return { store: "supabase", events: rows.map((x) => ({ type: x.type, sessionId: x.session_id, props: x.props, ts: x.ts })) };
    } catch { return { store: "supabase (unreachable)", events: [] }; }
  }
  return { store: "memory", events: [...g.__events!].reverse() };
}
