// LLM calls. The model reads text and drafts text. It never computes money.
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import type { Extraction } from "./types";

export const MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5";

const TierZ = z.object({ fromPct: z.number().min(0), toPct: z.number().nullable(), rate: z.number().min(0).max(1) });
const SpiffZ = z.object({ label: z.string(), minDealAmount: z.number().min(0), amount: z.number().min(0) });
const RulesZ = z.object({
  tiers: z.array(TierZ).min(1).max(8),
  acceleratorMode: z.enum(["marginal", "retroactive"]),
  capPct: z.number().positive().nullable(),
  clawbackDays: z.number().int().positive().nullable(),
  splitRule: z.enum(["pro_rata", "full_credit_each"]),
  spiffs: z.array(SpiffZ).max(5),
});
const PatchZ = RulesZ.partial();
export const ExtractionZ = z.object({
  rules: RulesZ,
  quotes: z.record(z.string(), z.string().nullable()),
  columnMap: z.object({
    dealsSheet: z.string(),
    deals: z.object({
      dealId: z.string(), rep: z.string(), closeDate: z.string(), amount: z.string(),
      splitPct: z.string().nullable(), churnDate: z.string().nullable(),
    }),
    payoutsSheet: z.string(),
    payouts: z.object({ rep: z.string(), quota: z.string(), payout: z.string() }),
  }),
  ambiguities: z.array(z.object({
    id: z.string(), clause: z.string(), issue: z.string(),
    readings: z.array(z.object({ label: z.string(), patch: PatchZ })).min(2).max(3),
  })).max(5),
});

const tierSchema = { type: "object", properties: { fromPct: { type: "number" }, toPct: { type: ["number", "null"] }, rate: { type: "number", description: "fraction, e.g. 0.10 for 10%" } }, required: ["fromPct", "toPct", "rate"] };
const spiffSchema = { type: "object", properties: { label: { type: "string" }, minDealAmount: { type: "number" }, amount: { type: "number" } }, required: ["label", "minDealAmount", "amount"] };
const rulesProps = {
  tiers: { type: "array", items: tierSchema },
  acceleratorMode: { type: "string", enum: ["marginal", "retroactive"] },
  capPct: { type: ["number", "null"], description: "attainment % above which bookings earn nothing; null if no cap stated" },
  clawbackDays: { type: ["integer", "null"] },
  splitRule: { type: "string", enum: ["pro_rata", "full_credit_each"] },
  spiffs: { type: "array", items: spiffSchema },
};

const EXTRACT_TOOL = {
  name: "record_plan",
  description: "Record the commission plan rules, where each came from, how the workbook columns map, and any genuinely ambiguous clauses.",
  input_schema: {
    type: "object" as const,
    properties: {
      rules: { type: "object", properties: rulesProps, required: Object.keys(rulesProps) },
      quotes: {
        type: "object",
        description: "For each rule field (tiers, acceleratorMode, capPct, clawbackDays, splitRule, spiffs): the exact sentence from the plan it came from, or null if the plan is silent.",
        properties: Object.fromEntries(Object.keys(rulesProps).map((k) => [k, { type: ["string", "null"] }])),
      },
      columnMap: {
        type: "object",
        description: "Use EXACT header strings from the provided headers.",
        properties: {
          dealsSheet: { type: "string" },
          deals: { type: "object", properties: { dealId: { type: "string" }, rep: { type: "string" }, closeDate: { type: "string" }, amount: { type: "string" }, splitPct: { type: ["string", "null"] }, churnDate: { type: ["string", "null"] } }, required: ["dealId", "rep", "closeDate", "amount", "splitPct", "churnDate"] },
          payoutsSheet: { type: "string" },
          payouts: { type: "object", properties: { rep: { type: "string" }, quota: { type: "string" }, payout: { type: "string" } }, required: ["rep", "quota", "payout"] },
        },
        required: ["dealsSheet", "deals", "payoutsSheet", "payouts"],
      },
      ambiguities: {
        type: "array",
        items: {
          type: "object",
          properties: {
            id: { type: "string", description: "short kebab-case id" },
            clause: { type: "string", description: "exact sentence from the plan" },
            issue: { type: "string", description: "one sentence: the two ways a reasonable person could read it" },
            readings: { type: "array", items: { type: "object", properties: { label: { type: "string" }, patch: { type: "object", properties: rulesProps, description: "ONLY the rule fields that change under this reading" } }, required: ["label", "patch"] } },
          },
          required: ["id", "clause", "issue", "readings"],
        },
      },
    },
    required: ["rules", "quotes", "columnMap", "ambiguities"],
  },
};

const SYSTEM_EXTRACT = `You read sales commission plans for a reconciliation tool.
Rules:
- Extract ONLY what the plan text states. Never invent rates, caps or windows. If the plan is silent on cap or clawback, use null. If there are no SPIFFs, use [].
- Rates are fractions (10% -> 0.10). Tier boundaries are attainment percentages of quota.
- acceleratorMode: "retroactive" only if the text says the higher rate applies to ALL bookings / the whole quarter; otherwise use the most literal reading and, if a reasonable reader could disagree, record an ambiguity.
- For every rule field, quote the exact source sentence (or null).
- Ambiguities: only clauses where two reasonable readings would change what a rep is paid AND each reading can be expressed by changing rule fields. Give 2 readings as patches. Do not pick a winner. Max 3.
- columnMap: choose from the exact header strings provided. Use null for optional columns that do not exist.
- You do not calculate any payouts. Ever.`;

export async function extractPlan(planText: string, headers: Record<string, string[]>): Promise<Extraction> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("NO_API_KEY");
  const client = new Anthropic({ apiKey: key });
  const t0 = Date.now();
  const msg = await client.messages.create({
    model: MODEL,
    max_tokens: 3000,
    temperature: 0,
    system: SYSTEM_EXTRACT,
    tools: [EXTRACT_TOOL],
    tool_choice: { type: "tool", name: "record_plan" },
    messages: [{
      role: "user",
      content: `PLAN TEXT:\n"""\n${planText.slice(0, 20000)}\n"""\n\nWORKBOOK SHEETS AND HEADER ROWS (no data rows are shared):\n${JSON.stringify(headers, null, 1)}`,
    }],
  });
  const block = msg.content.find((b) => b.type === "tool_use");
  if (!block || block.type !== "tool_use") throw new Error("Model did not return structured output");
  const parsed = ExtractionZ.parse(block.input);
  return {
    ...parsed,
    quotes: parsed.quotes,
    source: "live",
    model: MODEL,
    latencyMs: Date.now() - t0,
    inputTokens: msg.usage.input_tokens,
    outputTokens: msg.usage.output_tokens,
  } as Extraction;
}

export type OpenerInput = {
  company: string; role: string; payees: number;
  overpaid: number; underpaid: number; repsWithErrors: number;
  topFindings: string[]; topAmbiguity: { clause: string; dollarsAtStake: number } | null;
};

const SYSTEM_OPENER = `You draft a first email from a BDR to a RevOps/comp lead who just ran a commission-spreadsheet autopsy on a vendor's website.
Constraints:
- 70-110 words. Plain text. Subject line on the first line as "Subject: ...".
- Lead with ONE specific finding from their autopsy, using the exact dollar figures given. Never introduce a number that is not in the input.
- Warm, dry, a little witty (the vendor's brand jokes about spreadsheet funerals) but never mocking the reader.
- Offer one thing: a 20-minute walkthrough of their autopsy with a comp specialist. No feature lists, no "AI agent" language.
- Sign off as "{{BDR first name}}".`;

export async function draftOpener(input: OpenerInput) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("NO_API_KEY");
  const client = new Anthropic({ apiKey: key });
  const t0 = Date.now();
  const msg = await client.messages.create({
    model: MODEL,
    max_tokens: 400,
    temperature: 0.4,
    system: SYSTEM_OPENER,
    messages: [{ role: "user", content: `AUTOPSY FINDINGS (aggregated; no rep-level data):\n${JSON.stringify(input, null, 1)}` }],
  });
  const text = msg.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join("").trim();
  return { text, model: MODEL, latencyMs: Date.now() - t0, inputTokens: msg.usage.input_tokens, outputTokens: msg.usage.output_tokens };
}
