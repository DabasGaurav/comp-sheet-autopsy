import { NextResponse } from "next/server";
import { draftOpener, type OpenerInput } from "@/lib/llm";
import { logEvent } from "@/lib/store";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(req: Request) {
  const body = (await req.json()) as OpenerInput & { sessionId?: string };
  try {
    const out = await draftOpener(body);
    await logEvent({ type: "opener_drafted", sessionId: body.sessionId, props: { latencyMs: out.latencyMs, inputTokens: out.inputTokens, outputTokens: out.outputTokens } });
    return NextResponse.json({ ...out, source: "live" });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("opener failed:", (e as { status?: number }).status, msg.slice(0, 500));
    await logEvent({ type: "opener_err", sessionId: body.sessionId, props: { error: msg.slice(0, 200) } });
    return NextResponse.json({ error: "Draft unavailable — the BDR writes this one by hand.", source: "none" }, { status: 502 });
  }
}
