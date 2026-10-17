/**
 * Assist pass — optional AI recovery (platform injects provider; core stays deterministic).
 */
import type { ExtractionResult } from "../types.js";

export interface AssistPassInput {
  result: ExtractionResult;
  missingOrLowPaths: string[];
  jurisdiction: string;
}

export interface AssistPassPatch {
  applied: boolean;
  model?: string;
  filledPaths: string[];
  notes: string[];
}

export interface AssistPassProvider {
  readonly id: string;
  recover(input: AssistPassInput): Promise<AssistPassPatch>;
}

/** No-op provider — default for SDK embed. NYV wires Nova Micro when flag ON. */
export const NOOP_ASSIST_PROVIDER: AssistPassProvider = {
  id: "noop",
  async recover(): Promise<AssistPassPatch> {
    return { applied: false, filledPaths: [], notes: ["assist disabled"] };
  },
};

export async function applyAssistPass(
  result: ExtractionResult,
  provider: AssistPassProvider,
  threshold = 0.7,
): Promise<AssistPassPatch> {
  const missingOrLowPaths = result.resolutions
    .filter((r) => r.status === "ABSENT" || r.status === "LOW_CONFIDENCE")
    .filter((r) => (r.chosen?.confidence ?? 0) < threshold)
    .map((r) => r.fieldPath);
  if (missingOrLowPaths.length === 0) {
    return { applied: false, filledPaths: [], notes: ["nothing to recover"] };
  }
  return provider.recover({ result, missingOrLowPaths, jurisdiction: "IN" });
}
