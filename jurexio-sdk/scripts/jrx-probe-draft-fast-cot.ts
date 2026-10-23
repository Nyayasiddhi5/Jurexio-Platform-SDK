/**
 * NV-DRAFT-FAST-COT-001 — reproduce the reported NSP failure.
 *
 *   NSP: "Draft generation timed out. Please retry."
 *   JRX: rejects `legal-draft-fast` for missing `cot`
 *
 * NV-EXECUTE-BEFORE-CLAIM-001: this probe must reproduce the contradiction from
 * the real exported functions before any fix is designed. Nothing here is
 * mocked except the Express `Request` shape the resolvers read.
 *
 * The hypothesis under test: for `taskType=legal-draft-fast` on an NSP request,
 * the platform simultaneously
 *   (a) turns CoT OFF   — resolveNspNymBestOutcomeQuality → enableCoT:false
 *   (b) requires CoT ON — adaptive router → requireCoT:true
 * and the quality envelope then fail-closes on the missing `cot` step, which
 * NSP surfaces as a timeout/failure.
 *
 * Run: npx tsx scripts/jrx-probe-draft-fast-cot.ts
 */
import type { Request } from 'express';
import {
  isPartnerSlaFastTask,
  isPartnerCounselOrDraftTask,
  wantsNspCounselQueen,
  wantsNspNymBestOutcome,
  resolveNspNymBestOutcomeQuality,
} from '../src/utils/jrx-partner-platform.js';
import {
  createQualityEnvelope,
  markIngressGates,
  markSafetyRingGates,
  markResponseAndAudit,
  snapshotQualityEnvelope,
} from '../src/orchestration/jrx-quality-envelope.js';

/** Minimal NSP-shaped request: sdkContext present ⇒ JRX-dependent platform. */
function nspRequest(body: Record<string, unknown>): Request {
  return {
    body,
    headers: { 'x-jrx-platform': 'NSP' },
    sdkContext: { partnerCode: 'NSP', tenantId: 't-nsp' },
  } as unknown as Request;
}

const TASK_TYPES = [
  'legal-draft-fast',
  'legal_draft_fast',
  'legal-chat-fast',
  'doc-draft-fast',
  'drafting',
  'legal-draft',
  'legal_research',
];

function row(taskType: string) {
  const req = nspRequest({ taskType, prompt: 'Draft a Written Statement in a civil suit for recovery.' });

  const bestOutcome = wantsNspNymBestOutcome(req);
  const counselQueen = wantsNspCounselQueen(req);
  const isCounselDraft = isPartnerCounselOrDraftTask(taskType);
  const slaFast = isPartnerSlaFastTask(req, { taskType });

  const quality = resolveNspNymBestOutcomeQuality(req, {
    userId: 'u-1',
    taskType,
    partnerLean: undefined,
  });

  return { taskType, bestOutcome, counselQueen, isCounselDraft, slaFast, enableCoT: quality.enableCoT };
}

/**
 * Second half of the contradiction: with CoT disabled by the SLA resolver but
 * `requireCoT` still true from the router, does the envelope fail closed?
 */
function envelopeVerdict(requireCoT: boolean, cotRan: boolean, partnerLean: boolean) {
  const env = createQualityEnvelope({
    requestId: 'probe-req',
    path: 'specialist',
    partnerLean,
    risk: 'medium',
    requireCoT,
    requireMakerChecker: false,
    requireHitlScaled: false,
  });
  markIngressGates(env);
  markSafetyRingGates(env, {
    ragAttempted: true,
    ragGrounded: true,
    hallucinationRan: true,
    citationRan: true,
    biasRan: true,
    piiRan: true,
    complianceRan: true,
    llmRouted: true,
    cotRan,
  });
  markResponseAndAudit(env);
  const snap = snapshotQualityEnvelope(env);
  return { ok: snap.ok, missing: snap.missingMandatory };
}

function main(): void {
  // The live gateway runs with these defaults; make them explicit so the probe
  // is not silently measuring a different configuration than production.
  process.env.JRX_NSP_COUNSEL_QUEEN = process.env.JRX_NSP_COUNSEL_QUEEN ?? '1';

  console.log('');
  console.log('NV-DRAFT-FAST-COT-001 — is the fast-draft SLA self-contradictory?');
  console.log('='.repeat(100));
  console.log(`JRX_NSP_COUNSEL_QUEEN=${process.env.JRX_NSP_COUNSEL_QUEEN}`);
  console.log('');

  console.log('taskType            bestOut counselQ counsel/draft slaFast enableCoT');
  console.log('-'.repeat(100));
  const rows = TASK_TYPES.map(row);
  for (const r of rows) {
    console.log(
      `${r.taskType.padEnd(20)}${String(r.bestOutcome).padEnd(8)}${String(r.counselQueen).padEnd(9)}`
      + `${String(r.isCounselDraft).padEnd(14)}${String(r.slaFast).padEnd(8)}${String(r.enableCoT)}`,
    );
  }

  // POSITIVE CONTROL (NV-VALIDATE-THE-PROBE-001): a task that is unambiguously
  // SLA-fast and NOT counsel/draft must come back slaFast=true. If this is false
  // the probe is not exercising the SLA path at all and every row is meaningless.
  const control = row('web_search');
  console.log('');
  console.log(`positive control  web_search slaFast=${control.slaFast} (MUST be true)`);
  if (!control.slaFast) {
    console.log('PROBE BROKEN: SLA detection never fires — results above prove nothing.');
    process.exit(3);
  }

  console.log('');
  console.log('Envelope behaviour when the router requires CoT but the SLA disabled it');
  console.log('-'.repeat(100));
  const contradiction = envelopeVerdict(true, false, true);
  const consistent = envelopeVerdict(false, false, true);
  console.log(`requireCoT=true  cotRan=false → ok=${contradiction.ok} missing=[${contradiction.missing.join(',')}]`);
  console.log(`requireCoT=false cotRan=false → ok=${consistent.ok} missing=[${consistent.missing.join(',')}]`);

  console.log('');
  console.log('VERDICT');
  console.log('-'.repeat(100));
  const draftFast = rows.find((r) => r.taskType === 'legal-draft-fast')!;
  if (draftFast.slaFast === false && draftFast.isCounselDraft === true) {
    console.log('REPRODUCED (routing half): `legal-draft-fast` is classified as counsel/draft, so');
    console.log('  isPartnerSlaFastTask() returns FALSE and the explicit `-fast` SLA is discarded.');
    console.log('  The request is therefore routed to full Queen + CoT — the multi-minute path NSP');
    console.log('  was explicitly trying to avoid by asking for `-fast`.');
  } else {
    console.log(`NOT reproduced as theorised: slaFast=${draftFast.slaFast} counselDraft=${draftFast.isCounselDraft}`);
  }
  if (!contradiction.ok && contradiction.missing.includes('cot')) {
    console.log('');
    console.log('REPRODUCED (envelope half): with requireCoT=true and CoT not run, the envelope');
    console.log('  reports missing=[cot] and fail-closes in production → the "rejects for missing cot".');
  }
}

main();
