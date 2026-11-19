// Cached extraction for the bundled ILLUSTRATIVE sample only. Used when the live model is unavailable,
// and always labelled "cached" in the UI so it is never mistaken for a live call.
import { SAMPLES, COLUMN_MAP } from "./samples";
import type { Extraction } from "./types";

export function cachedSampleExtraction(file: string): Extraction | null {
  const s = SAMPLES.find((x) => x.file === file);
  if (!s) return null;
  const line = (re: RegExp) => s.planText.split("\n").find((l) => re.test(l)) ?? null;
  return {
    rules: s.truthRules,
    quotes: {
      tiers: line(/commission rate|earn \d+%|Base commission/i),
      acceleratorMode: line(/accelerat|all ACV|Once a rep/i),
      capPct: line(/cap/i),
      clawbackDays: line(/claw|cancel/i),
      splitRule: line(/split|shared/i),
      spiffs: line(/SPIFF|bonus/i),
      spiffSplit: null,
    },
    columnMap: COLUMN_MAP,
    ambiguities: s.ambiguities,
    source: "cached-sample",
  };
}
