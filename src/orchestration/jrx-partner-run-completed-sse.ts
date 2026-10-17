/**
 * NV-NSP-SSE-FILING-MIRROR-001 — partner `run_completed` SSE envelope.
 *
 * Canonical filing fields live on `result` (sync JSON parity). NSP BFF parsers
 * that read the event root get the same `draftProfile` / `validationResults[]`
 * without losing the nested contract.
 */

export const PARTNER_RUN_COMPLETED_MIRROR_KEYS = [
  'draftProfile',
  'validationResults',
  'formattedBlocks',
  'draftQuality',
  /** NV-NSP-STREAM-META-002 — sync parity for stream-only UX (§4g). */
  'completionStatus',
  'continuationAvailable',
  'completion',
  'requestPhase',
  'optionalDegraded',
] as const;

export type PartnerRunCompletedMirrorKey = (typeof PARTNER_RUN_COMPLETED_MIRROR_KEYS)[number];

export function wrapPartnerRunCompletedSseEvent(input: {
  runId: string;
  timestamp: string;
  result: Record<string, unknown>;
}): Record<string, unknown> {
  const event: Record<string, unknown> = {
    type: 'run_completed',
    runId: input.runId,
    timestamp: input.timestamp,
    result: input.result,
  };
  for (const key of PARTNER_RUN_COMPLETED_MIRROR_KEYS) {
    const val = input.result[key];
    if (val !== undefined) {
      event[key] = val;
    }
  }
  return event;
}
