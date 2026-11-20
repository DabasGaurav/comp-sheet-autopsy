import { NextResponse } from "next/server";
import { extractPlan, MODEL } from "@/lib/llm";
import { cachedSampleExtraction } from "@/lib/cached";
import { logEvent } from "@/lib/store";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request) {
  const body = (await req.json()) as { planText?: string; headers?: Record<string, string[]>; sampleFile?: string; sessionId?: string };
  const planText = (body.planText ?? "").slice(0, 20000);
  if (planText.trim().length < 40) return NextResponse.json({ error: "Couldn't find plan text in the workbook. Add a 'Plan' tab with the plan wording." }, { status: 400 });
  try {
    const ex = await extractPlan(planText, body.headers ?? {});
    await logEvent({ type: "extraction_ok", sessionId: body.sessionId, props: { latencyMs: ex.latencyMs, inputTokens: ex.inputTokens, outputTokens: ex.outputTokens, model: MODEL, ambiguities: ex.ambiguities.length } });
    return NextResponse.json(ex);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("extract failed:", (e as { status?: number }).status, msg.slice(0, 500));
    await logEvent({ type: "extraction_err", sessionId: body.sessionId, props: { error: msg.slice(0, 200) } });
    // Fallback is ONLY allowed for the bundled sample, and is labelled as cached in the UI.
    const cached = body.sampleFile ? cachedSampleExtraction(body.sampleFile) : null;
    if (cached) return NextResponse.json({ ...cached, fallbackReason: msg === "NO_API_KEY" ? "No API key configured" : `Live model call failed: ${msg.slice(0, 160)}` });
    return NextResponse.json({ error: msg === "NO_API_KEY" ? "The live model isn't configured on this deployment." : "The model couldn't read this plan. Try again, or check the Plan tab." }, { status: 502 });
  }
}
