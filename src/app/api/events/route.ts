import { NextResponse } from "next/server";
import { listEvents, logEvent, type EventIn } from "@/lib/store";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const e = (await req.json()) as EventIn;
  if (!e?.type || typeof e.type !== "string" || e.type.length > 40) return NextResponse.json({ error: "bad event" }, { status: 400 });
  await logEvent(e);
  return NextResponse.json({ ok: true });
}

export async function GET() {
  return NextResponse.json(await listEvents());
}
