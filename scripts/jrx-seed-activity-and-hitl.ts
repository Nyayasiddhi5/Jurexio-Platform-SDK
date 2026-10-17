/**
 * jrx-seed-activity-and-hitl.ts — Task #301 (Demo G2B)
 * ─────────────────────────────────────────────────────────────────────────────
 * Seeds two demo surfaces that render empty on a fresh DB:
 *
 *   1. `nv_schema.hitl_reviews`    — the table behind /api/jrx/hitl/queue and
 *                                    /api/jrx/hitl/stats (read by
 *                                    client/src/pages/hitl-decision-cards.tsx).
 *                                    ≥30 cards split US / IN with a realistic
 *                                    mix of pending / approved / rejected /
 *                                    modified status, matter contexts, agent
 *                                    keys, reviewers, decision rationales.
 *
 *   2. `nv_schema.ai_activity`     — backfill of the last 7 days of
 *                                    synthetic activity events projected into
 *                                    the activity-event shape so the Live
 *                                    Activity Feed (/api/jrx/activity/recent)
 *                                    is non-empty on first load and a 7-day
 *                                    trend can be plotted.
 *
 *                                    Note: this is an explicit *synthetic*
 *                                    fixture for the G2B demo, not a
 *                                    projection from real CAM telemetry. On a
 *                                    fresh dev DB there is no CAM history to
 *                                    project from, so we generate balanced
 *                                    rows across the six jurisdictions and
 *                                    ten core route prefixes used elsewhere
 *                                    in the platform. Rows are tagged
 *                                    `user_id = '_global'` so the activity
 *                                    DB-fallback predicate (org-scoped, with
 *                                    a documented `_global` allowlist) shows
 *                                    them to any signed-in caller without
 *                                    leaking real per-tenant traffic. Real
 *                                    traffic continues to land in the same
 *                                    table from the activity publisher and
 *                                    is filtered by org as normal.
 *
 * Idempotent: every INSERT is gated on `WHERE NOT EXISTS` against a stable
 * (request_id) / (trace_id) key.  Re-running tops up missing rows but never
 * duplicates.
 *
 * Guardrails honored:
 *   - NV-NAMING-001  : grep first; new file `jrx-` prefix.
 *   - NV-DB-SCRIPT-001: uses `makePgSql()` — never the neon HTTP driver.
 *   - NV-ARCH-001 / NV-LLM-001: pure data seed, no LLM calls.
 */

import { makePgSql } from './_pg-pool.js';
import { assertColumns } from './_assert-columns.js';

// task #347: schema-drift guard — fail loud before any INSERT.
const REQUIRED_COLUMNS = {
  'nv_schema.hitl_reviews': [
    'id', 'request_id', 'user_id', 'tenant_id', 'agent_key', 'risk_level',
    'ai_output', 'review_status', 'sla_deadline', 'reviewer_id',
    'reviewer_decision', 'reviewer_notes', 'reviewed_at', 'created_at',
  ],
  'nv_schema.ai_activity': [
    'trace_id', 'user_id', 'jurisdiction', 'pattern_key', 'route',
    'template_mode', 'risk_score', 'prompt_hash', 'blocked',
    'model_provider', 'model_name', 'tokens_used', 'latency_ms',
    'created_at', 'jurisdiction_validated',
  ],
} as const;
import * as crypto from 'crypto';
import * as dotenv from 'dotenv';

dotenv.config();
const sql = makePgSql();

// ─── HITL fixtures ───────────────────────────────────────────────────────────
type Status = 'pending' | 'approved' | 'rejected' | 'modified';
type Risk = 'critical' | 'high' | 'medium' | 'low';

interface MatterFixture {
  jurisdiction: 'US' | 'IN';
  agentKey: string;
  matterId: string;
  matterContext: string;
  recommendation: string;
  rationale: string;
  riskLevel: Risk;
  confidence: number;
}

const MATTERS: MatterFixture[] = [
  // ───── US (15) ─────
  { jurisdiction:'US', agentKey:'JRX-LRM-US',                 matterId:'M-US-2026-0011', matterContext:'NDA review — mutual NDA between client and prospective acquirer, 5-year term.', recommendation:'Approve with one redline: limit residual-knowledge clause to non-trade-secret information.',           rationale:'Boilerplate residual-knowledge language exceeds DTSA carve-out; one-line edit brings it inside safe harbor.',                                                            riskLevel:'medium',  confidence:0.78 },
  { jurisdiction:'US', agentKey:'JRX-LRM-US',                 matterId:'M-US-2026-0014', matterContext:'M&A due diligence — IP schedule for $42M asset acquisition (SaaS target).',          recommendation:'Flag two open-source license violations (AGPL in core repo) before signing.',                                rationale:'AGPL § 13 obligations would propagate to acquirer\'s hosted offering; cure or carve-out required.',                                                                       riskLevel:'high',    confidence:0.71 },
  { jurisdiction:'US', agentKey:'aba-512-supervisor',         matterId:'M-US-2026-0016', matterContext:'Generative-AI use disclosure — drafting motion in opposition with LLM assistance.',  recommendation:'Append ABA Formal Op. 512 disclosure to filing; verify all citations.',                                       rationale:'Op. 512 (July 2024) requires competence + confidentiality + candor. Two cite-checks failed Shepard\'s.',                                                                  riskLevel:'critical',confidence:0.55 },
  { jurisdiction:'US', agentKey:'sox-compliance-US',          matterId:'M-US-2026-0019', matterContext:'SOX 404(b) — quarterly ICFR walkthrough for revenue recognition control C-RR-04.',  recommendation:'Escalate to audit committee — control design gap on multi-element arrangements.',                              rationale:'Auditor MD AS 2201 deficiency rises to material weakness if uncorrected this quarter.',                                                                                   riskLevel:'critical',confidence:0.62 },
  { jurisdiction:'US', agentKey:'hipaa-counsel-US',           matterId:'M-US-2026-0021', matterContext:'HIPAA — vendor BAA review for hosted analytics processor handling 14k PHI records.',recommendation:'Reject — BAA omits breach-notification window and subcontractor flow-down.',                                rationale:'45 CFR § 164.504(e)(2)(ii)(B/D) requires both clauses; cannot waive.',                                                                                                   riskLevel:'high',    confidence:0.83 },
  { jurisdiction:'US', agentKey:'federal-rules-evidence-US',  matterId:'M-US-2026-0023', matterContext:'FRE 702 — expert designation for damages witness in patent infringement.',           recommendation:'Modify designation to narrow opinion scope; current draft invites Daubert challenge.',                          rationale:'Reasonable-royalty model relies on EMVR without apportionment; circuits split.',                                                                                          riskLevel:'medium',  confidence:0.69 },
  { jurisdiction:'US', agentKey:'JRX-LRM-US',                 matterId:'M-US-2026-0027', matterContext:'Employment — disability accommodation request (ADA), warehouse role.',               recommendation:'Approve interactive-process plan: temporary lift restriction + ergonomic review.',                              rationale:'Documented medical restriction + essential-function analysis supports reasonable accommodation.',                                                                          riskLevel:'low',     confidence:0.86 },
  { jurisdiction:'US', agentKey:'clause-classifier-US',       matterId:'M-US-2026-0028', matterContext:'MSA — limitation-of-liability clause classification for upstream vendor contract.', recommendation:'Approve clause as MUTUAL-CAP-12M (no carve-outs), within risk envelope.',                                       rationale:'Cap = 12 months fees; standard for tier-2 vendor; no IP indemnity carve-out needed at this scope.',                                                                       riskLevel:'low',     confidence:0.91 },
  { jurisdiction:'US', agentKey:'aba-512-supervisor',         matterId:'M-US-2026-0030', matterContext:'Conflict check — partner moving from opposing counsel mid-case.',                    recommendation:'Reject lateral assignment to matter; build ethical wall.',                                                      rationale:'Imputed conflict under MR 1.10 unless screened + notice given to former client.',                                                                                          riskLevel:'critical',confidence:0.58 },
  { jurisdiction:'US', agentKey:'JRX-LRM-US',                 matterId:'M-US-2026-0031', matterContext:'Force majeure — invoking clause due to port strike on inbound components.',          recommendation:'Modify notice draft — current language overclaims; cite specific operative facts.',                             rationale:'Counterparty has 10-day cure right; vague notice will be contested.',                                                                                                       riskLevel:'medium',  confidence:0.72 },
  { jurisdiction:'US', agentKey:'sox-compliance-US',          matterId:'M-US-2026-0033', matterContext:'Whistleblower hotline triage — anonymous tip alleges revenue cut-off manipulation.',recommendation:'Escalate to audit committee chair within 24h; preserve all artifacts.',                                       rationale:'Section 301(4) requires independent receipt + retention; cannot route to mgmt first.',                                                                                    riskLevel:'critical',confidence:0.49 },
  { jurisdiction:'US', agentKey:'hipaa-counsel-US',           matterId:'M-US-2026-0035', matterContext:'Breach assessment — laptop with 1,820 PHI records lost in transit, encrypted.',     recommendation:'Approve low-probability-of-compromise determination; document four-factor analysis.',                          rationale:'Encryption-at-rest meets safe-harbor under HHS guidance; no Form HHS-700 required.',                                                                                       riskLevel:'low',     confidence:0.88 },
  { jurisdiction:'US', agentKey:'JRX-LRM-US',                 matterId:'M-US-2026-0037', matterContext:'Trademark — opposition to USPTO Application 98/123,456 for confusingly similar mark.',recommendation:'Approve filing of Notice of Opposition before May-30 deadline.',                                              rationale:'DuPont factors 1, 2, 3 all favor opposer; likelihood-of-confusion strong.',                                                                                                riskLevel:'medium',  confidence:0.74 },
  { jurisdiction:'US', agentKey:'federal-rules-evidence-US',  matterId:'M-US-2026-0041', matterContext:'Privilege log — 312 documents flagged AC-priv on second pass review.',               recommendation:'Modify log — 17 entries lack subject-matter detail required by FRCP 26(b)(5).',                                  rationale:'Vague privilege descriptions invite Rule 37 motion to compel.',                                                                                                          riskLevel:'medium',  confidence:0.66 },
  { jurisdiction:'US', agentKey:'aba-512-supervisor',         matterId:'M-US-2026-0044', matterContext:'AI-assisted contract drafting — outside counsel using GenAI without disclosure.',   recommendation:'Reject deliverable; require redrafted version with Op. 512 disclosure + cite verification.',                    rationale:'Six citations are hallucinated (no Westlaw match); duty of candor breached.',                                                                                              riskLevel:'critical',confidence:0.41 },
  // ───── IN (15) ─────
  { jurisdiction:'IN', agentKey:'NS-LRM-IN',                  matterId:'M-IN-2026-0102', matterContext:'Section 138 NI Act — cheque dishonour notice draft, ₹47L claim amount.',             recommendation:'Approve notice; verify 30-day demand window from return memo dated 2026-04-22.',                                rationale:'Notice within statutory window; cause of action accrues on day-31 if unpaid.',                                                                                              riskLevel:'medium',  confidence:0.81 },
  { jurisdiction:'IN', agentKey:'contract-analyst-IN',        matterId:'M-IN-2026-0104', matterContext:'Master Services Agreement — IT services, 36-month term, ₹12 cr annual value.',       recommendation:'Modify clause 14.3 — indemnity cap below typical for this scope; raise to 2× annual fees.',                     rationale:'Standard tier-1 IN benchmark is 2× fees; current 1× exposes firm if IP flow-up materialises.',                                                                              riskLevel:'high',    confidence:0.69 },
  { jurisdiction:'IN', agentKey:'dpdp-compliance-IN',         matterId:'M-IN-2026-0107', matterContext:'DPDPA 2023 — DPIA for new credit-scoring product processing 3.2M records.',         recommendation:'Reject deployment until consent-artefact mechanism live; significant-data-fiduciary obligations triggered.',     rationale:'Section 10 DPDPA + draft rules require DPO + algorithmic-impact assessment; both missing.',                                                                                 riskLevel:'critical',confidence:0.52 },
  { jurisdiction:'IN', agentKey:'litigation-strategist-IN',   matterId:'M-IN-2026-0109', matterContext:'Writ petition — challenge to GST demand of ₹3.4 cr under Section 74 CGST Act.',     recommendation:'Approve filing under Article 226; pre-deposit waiver argument viable on grounds of jurisdiction.',              rationale:'Show-cause notice issued without DRC-01A; procedural infirmity supports stay.',                                                                                            riskLevel:'medium',  confidence:0.74 },
  { jurisdiction:'IN', agentKey:'arbitration-counsel-IN',     matterId:'M-IN-2026-0111', matterContext:'A&C Act § 11 — appointment-of-arbitrator petition, 3-member tribunal, ₹85 cr claim.',recommendation:'Modify draft — proposed sole arbitrator name has prior commercial relationship with respondent\'s parent.',     rationale:'Schedule V Item 1 disclosure required; pre-empt s.12(5) ineligibility challenge.',                                                                                          riskLevel:'high',    confidence:0.68 },
  { jurisdiction:'IN', agentKey:'tax-advisor-IN',             matterId:'M-IN-2026-0114', matterContext:'TP — APA renewal, contract R&D services to US affiliate, ₹220 cr cost base.',       recommendation:'Approve cost-plus 18.5% renewal; documentation supports berry-ratio benchmarking.',                              rationale:'Range falls within current TPO acceptance band; no rollback adjustments required.',                                                                                         riskLevel:'low',     confidence:0.87 },
  { jurisdiction:'IN', agentKey:'NS-LRM-IN',                  matterId:'M-IN-2026-0117', matterContext:'IBC § 7 — financial creditor admission application, default ₹14 cr unsecured loan.',recommendation:'Approve filing; default established by NeSL record + auditor confirmation.',                                   rationale:'Threshold met (>₹1 cr post-2020 amendment); IU evidence is admissible primary proof.',                                                                                      riskLevel:'medium',  confidence:0.79 },
  { jurisdiction:'IN', agentKey:'contract-analyst-IN',        matterId:'M-IN-2026-0119', matterContext:'Distributor agreement termination — exclusive distributor in Tamil Nadu region.',  recommendation:'Reject draft termination notice; runway insufficient under Indian Contract Act and CCI Order 2024.',           rationale:'Reasonable-notice doctrine + recent CCI guidance suggest 180-day notice for 7-year exclusive relationships.',                                                              riskLevel:'high',    confidence:0.63 },
  { jurisdiction:'IN', agentKey:'dpdp-compliance-IN',         matterId:'M-IN-2026-0121', matterContext:'Cross-border transfer — child data analytics workflow to processor in Singapore.',  recommendation:'Reject transfer; consent age-gate fails verifiable-parental-consent standard under DPDPA § 9.',                  rationale:'Section 9(1) requires verifiable consent; current OTP flow does not bind to a parent.',                                                                                    riskLevel:'critical',confidence:0.47 },
  { jurisdiction:'IN', agentKey:'litigation-strategist-IN',   matterId:'M-IN-2026-0123', matterContext:'CrPC § 482 — quashing petition against FIR alleging Section 420 IPC, commercial dispute.',recommendation:'Approve petition; settlement deed + repayment receipts attached; State of Haryana v. Bhajan Lal applies.',     rationale:'Pure civil dispute dressed as criminal; HC has consistently quashed identical fact patterns since 2023.',                                                                  riskLevel:'medium',  confidence:0.76 },
  { jurisdiction:'IN', agentKey:'NS-LRM-IN',                  matterId:'M-IN-2026-0125', matterContext:'Employment — POSH Act internal complaint, sr. manager respondent, multi-state team.',recommendation:'Modify ICC composition — current panel lacks external member required by § 4(2)(c).',                          rationale:'Inquiry findings vulnerable to set-aside if external-member requirement breached.',                                                                                         riskLevel:'high',    confidence:0.71 },
  { jurisdiction:'IN', agentKey:'tax-advisor-IN',             matterId:'M-IN-2026-0128', matterContext:'GST ITC mismatch — GSTR-2B vs GSTR-3B variance of ₹62L for FY24-25.',                recommendation:'Approve voluntary DRC-03 reversal + interest under § 50; pre-empts § 73 notice.',                                rationale:'Self-assessment under Circular 183/15/2022 supports proactive cure; avoids penalty.',                                                                                      riskLevel:'medium',  confidence:0.82 },
  { jurisdiction:'IN', agentKey:'arbitration-counsel-IN',     matterId:'M-IN-2026-0131', matterContext:'Section 9 A&C Act — interim relief application, freezing order over ₹17 cr in escrow.',recommendation:'Approve application; balance of convenience + irreparable harm both established on record.',                    rationale:'Counterparty ledger shows imminent dissipation; standard for s.9 met (Adhunik Steels).',                                                                                    riskLevel:'high',    confidence:0.77 },
  { jurisdiction:'IN', agentKey:'contract-analyst-IN',        matterId:'M-IN-2026-0133', matterContext:'SaaS subscription — data-residency clause for healthtech customer in Maharashtra.', recommendation:'Approve clause locking processing to Mumbai region with audit-rights addendum.',                                rationale:'Customer-side regulatory ask (state procurement policy 2024); commercially neutral.',                                                                                       riskLevel:'low',     confidence:0.89 },
  { jurisdiction:'IN', agentKey:'dpdp-compliance-IN',         matterId:'M-IN-2026-0136', matterContext:'Breach notification — internal portal misconfiguration exposed 4,200 employee PII for 6h.',recommendation:'Approve notification draft to Data Protection Board within 72h; trigger breach playbook.',                      rationale:'Significant-data-fiduciary status + sensitive personal data → mandatory notice under DPDPA § 8(6).',                                                                       riskLevel:'critical',confidence:0.61 },
];

const REVIEWERS: Record<'US' | 'IN', string[]> = {
  US: ['reviewer-jrx-001', 'reviewer-jrx-002', 'reviewer-jrx-003'],
  IN: ['reviewer-nsp-001', 'reviewer-nsp-002', 'reviewer-nsp-003', 'reviewer-nsi-001'],
};

// Stable-but-deterministic UUID derivation from request_id so re-runs are
// idempotent at the (id, request_id) level — without requiring a dedicated
// natural-key UNIQUE constraint we don't own.
function deriveUuid(seed: string): string {
  const h = crypto.createHash('sha256').update(seed).digest('hex');
  return [
    h.slice(0, 8),
    h.slice(8, 12),
    '4' + h.slice(13, 16),
    ((parseInt(h[16], 16) & 0x3) | 0x8).toString(16) + h.slice(17, 20),
    h.slice(20, 32),
  ].join('-');
}

async function seedHitlReviews(): Promise<void> {
  console.log('  ── Seeding nv_schema.hitl_reviews (≥30 cards US/IN) ──');
  let inserted = 0, skipped = 0;
  for (let i = 0; i < MATTERS.length; i++) {
    const m = MATTERS[i];
    const requestId = `req-301-${m.matterId.toLowerCase()}`;
    const id = deriveUuid(requestId);

    // Mix: index 0..3 → pending; 4..6 → modified; 7..9 → rejected; rest → approved
    const bucket = i % 10;
    const status: Status =
      bucket < 4 ? 'pending' :
      bucket < 6 ? 'modified' :
      bucket < 8 ? 'rejected' : 'approved';

    // Spread created_at across the past 7 days; reviewed_at after a realistic
    // review window so avg-time-to-decision is non-zero.
    const ageHours = (i * 5.7) % (7 * 24);
    const reviewMins = 8 + ((i * 11) % 220);  // 8–228 min decision window
    const createdAt = new Date(Date.now() - ageHours * 3600 * 1000);
    const reviewedAt = status === 'pending'
      ? null
      : new Date(createdAt.getTime() + reviewMins * 60 * 1000);
    const slaDeadline = new Date(createdAt.getTime() + (m.riskLevel === 'critical' ? 2 : 24) * 3600 * 1000);

    const reviewer = status === 'pending' ? null : REVIEWERS[m.jurisdiction][i % REVIEWERS[m.jurisdiction].length];
    const reviewerDecision = status === 'pending' ? null : status;

    const aiOutput = {
      matterId: m.matterId,
      jurisdiction: m.jurisdiction,
      agentKey: m.agentKey,
      recommendation: m.recommendation,
      confidenceScore: m.confidence,
      summary: m.matterContext,
    };

    // tenant_id = jurisdiction so /hitl/stats?tenantId=US|IN slices correctly.
    const r = await sql`
      INSERT INTO nv_schema.hitl_reviews (
        id, request_id, user_id, tenant_id, agent_key, risk_level, ai_output,
        review_status, sla_deadline, reviewer_id, reviewer_decision, reviewer_notes,
        reviewed_at, created_at
      ) VALUES (
        ${id}::uuid, ${requestId}, ${'demo-' + m.jurisdiction.toLowerCase()},
        ${m.jurisdiction}, ${m.agentKey}, ${m.riskLevel},
        ${JSON.stringify(aiOutput)}::jsonb,
        ${status},
        ${slaDeadline.toISOString()}::timestamptz,
        ${reviewer}, ${reviewerDecision}, ${status === 'pending' ? null : m.rationale},
        ${reviewedAt ? reviewedAt.toISOString() : null}::timestamptz,
        ${createdAt.toISOString()}::timestamptz
      )
      ON CONFLICT (id) DO NOTHING
      RETURNING id
    `;
    if (r.length > 0) inserted++; else skipped++;
  }
  console.log(`    ✓ ${inserted} inserted, ${skipped} already present (total fixtures: ${MATTERS.length})`);
}

// ─── Activity backfill ───────────────────────────────────────────────────────
const ROUTES = [
  '/api/jrx/orchestrate',
  '/api/jrx/ai/chat',
  '/api/jrx/intelligence/citations/verify',
  '/api/jrx/intelligence/hitl/check',
  '/api/jrx/agent/invoke',
  '/api/jrx/audit/chain',
  '/api/jrx/consent/check',
  '/api/jrx/rag/search',
  '/api/jrx/digital-twin/predict',
  '/api/jrx/orchestrate/stream',
];
const MODELS: Array<[string, string]> = [
  ['google',     'gemini-2.5-flash'],
  ['openai',     'gpt-4o-mini'],
  ['anthropic',  'claude-haiku-4.5'],
  ['openrouter', 'qwen/qwen-2.5-72b-instruct'],
  ['sarvam',     'sarvam-m'],
  ['bedrock',    'amazon.nova-lite-v1'],
];
const PATTERNS = ['react', 'cot', 'graph-rag', 'hitl-gate', 'consent-gate', 'audit-emit', 'rrf-rerank', 'citation-verify'];
const JURISDICTIONS = ['IN', 'US', 'EU', 'UK', 'SG', 'GC'];

async function seedActivityBackfill(): Promise<void> {
  console.log('  ── Backfilling nv_schema.ai_activity (last 7 days) ──');

  // Skip if we already have a healthy backfill (rerun-friendly).
  const existing = (await sql`SELECT COUNT(*)::int AS c FROM nv_schema.ai_activity`)[0].c as number;
  if (existing >= 700) {
    console.log(`    ⊙ ${existing} rows already present; skipping backfill.`);
    return;
  }

  const TARGET = 1000;  // ≈6/hour over 7 days
  let inserted = 0;
  for (let i = 0; i < TARGET; i++) {
    const ageMin = Math.floor((i / TARGET) * 7 * 24 * 60);
    const createdAt = new Date(Date.now() - ageMin * 60 * 1000);
    const route = ROUTES[i % ROUTES.length];
    const [provider, model] = MODELS[i % MODELS.length];
    const pattern = PATTERNS[i % PATTERNS.length];
    const jurisdiction = JURISDICTIONS[i % JURISDICTIONS.length];
    const blocked = i % 47 === 0;
    const riskScore = blocked ? 80 + (i % 20) : (i * 3) % 60;
    const traceId = `trace-301-backfill-${String(i).padStart(5, '0')}`;
    const promptHash = crypto.createHash('sha256').update(traceId).digest('hex');
    const tokens = 200 + ((i * 37) % 3800);
    const latency = 80 + ((i * 53) % 1900);

    const r = await sql`
      INSERT INTO nv_schema.ai_activity (
        trace_id, user_id, jurisdiction, pattern_key, route, template_mode,
        risk_score, prompt_hash, blocked, model_provider, model_name,
        tokens_used, latency_ms, created_at, jurisdiction_validated
      ) VALUES (
        ${traceId}, ${'_global'}, ${jurisdiction}, ${pattern},
        ${route}, ${'STRICT'}, ${riskScore}, ${promptHash}, ${blocked},
        ${provider}, ${model}, ${tokens}, ${latency},
        ${createdAt.toISOString()}::timestamptz, ${true}
      )
      ON CONFLICT (trace_id) DO NOTHING
      RETURNING id
    `;
    if (r.length > 0) inserted++;
  }
  console.log(`    ✓ ${inserted} activity rows backfilled across last 7 days`);
}

async function main(): Promise<void> {
  await assertColumns(sql, './jrx-seed-activity-and-hitl', REQUIRED_COLUMNS);
  await seedHitlReviews();
  await seedActivityBackfill();
  console.log('  ✓ Activity + HITL seed complete.');
}

main()
  .catch((err) => { console.error('Activity/HITL seed failed:', err); process.exit(1); })
  .finally(() => sql.end());
