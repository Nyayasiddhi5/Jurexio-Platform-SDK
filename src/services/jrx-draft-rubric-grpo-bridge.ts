/**
 * NV-DRAFT-RUBRIC-GRPO-BRIDGE-001 — optional offline observation log for SME rubric scores
 * (Phase 4 Option B). Gated by NYV_DRAFT_RUBRIC_GRPO_LOG=1; never stores full draft bodies.
 */
import fs from 'node:fs';
import path from 'node:path';

export type DraftRubricObservation = {
  ts: string;
  caseId?: string;
  documentType: string;
  tier: 'medium' | 'comprehensive' | string;
  rubricPct: number;
  requestId?: string;
  model?: string;
};

function logEnabled(): boolean {
  return process.env.NYV_DRAFT_RUBRIC_GRPO_LOG === '1';
}

function logPath(): string {
  const root = process.env.NYV_DRAFT_RUBRIC_GRPO_DIR
    || path.join(process.cwd(), '.local/grpo');
  return path.join(root, 'draft-rubric-observations.jsonl');
}

/** Append one rubric row for nightly GRPO / SME trend review (no PII, no content). */
export function recordDraftRubricObservation(obs: Omit<DraftRubricObservation, 'ts'>): void {
  if (!logEnabled()) return;
  const row: DraftRubricObservation = { ...obs, ts: new Date().toISOString() };
  const file = logPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, `${JSON.stringify(row)}\n`, { encoding: 'utf8', mode: 0o600 });
}
