/**
 * jrx-iso-compliance-routes.ts — Task #299
 *
 * Mounts under /api/jrx/compliance (alongside jrx-compliance-routes.ts and
 * jrx-compliance-aggregators.ts).
 *
 *   GET /iso                      — six framework summaries with per-control verdicts
 *   GET /iso/control/:id          — drilldown payload (text, verdict, evidence, remediation)
 *
 * Both endpoints are read-only and gated by the standard authenticateToken
 * middleware. Per-jurisdiction posture is selected via ?jurisdiction=US|IN|GLOBAL,
 * framework filter via ?framework=iso_42001|iso_27001|soc2|dpdpa|eu_ai_act|gdpr
 * (Task #311 added the privacy / AI-regulation frameworks alongside the
 * original ISO/SOC2 trio so the Console has one pane of glass).
 *
 * NV-NAMING-001: jrx- prefix.
 * NV-WIRING-001: mounted in src/index.ts under /api/jrx/compliance.
 * NV-CONTRACT-001: response shape documented inline; surfaced in jrx-api-paths.ts.
 */
import { Router, Request, Response } from 'express';
import { createHash } from 'node:crypto';
import PDFDocument from 'pdfkit';
import { authenticateToken, requireRole } from '../middleware/jrx-auth.js';
import { appendAuditRecord } from '../middleware/jrx-sdk-tracking-middleware.js';
import { createLogger } from '../utils/logger.js';
import { sendApiError, safeError } from '../utils/jrx-api-error.js';
import {
  ISO_CONTROL_CATALOGUE,
  FRAMEWORK_META,
  effectiveVerdict,
  getControlById,
  type IsoControl,
  type IsoFramework,
  type IsoJurisdiction,
  type IsoVerdict,
} from '../data/jrx-iso-control-catalogue.js';
import {
  getEvidenceForControl,
  getEvidenceCounts,
  type IsoEvidenceRow,
  refreshIsoControlEvidence,
  getLastIsoEvidenceRefresh,
} from '../services/compliance/jrx-iso-evidence-mapper.js';

const router = Router();
const logger = createLogger('./jrx-iso-compliance-routes');

router.use(authenticateToken);

function parseJurisdiction(raw: unknown): IsoJurisdiction {
  const v = String(raw ?? 'GLOBAL').toUpperCase();
  if (v === 'US' || v === 'IN' || v === 'GLOBAL') return v as IsoJurisdiction;
  return 'GLOBAL';
}

function parseFramework(raw: unknown): IsoFramework | null {
  const v = String(raw ?? '').toLowerCase();
  if (
    v === 'iso_42001' ||
    v === 'iso_27001' ||
    v === 'soc2' ||
    v === 'dpdpa' ||
    v === 'eu_ai_act' ||
    v === 'gdpr'
  ) {
    return v as IsoFramework;
  }
  return null;
}

interface FrameworkSummary {
  framework: IsoFramework;
  name: string;
  longName: string;
  controlsExpected: number;
  total: number;
  counts: Record<IsoVerdict, number>;
  controls: Array<{
    controlId: string;
    title: string;
    category: string;
    verdict: IsoVerdict;
    owner: string;
    hasEvidence: boolean;
    reason?: string;
  }>;
}

async function summariseFramework(
  framework: IsoFramework,
  jurisdiction: IsoJurisdiction,
  evidenceCounts: Map<string, number>,
): Promise<FrameworkSummary> {
  const meta = FRAMEWORK_META[framework];
  const list = ISO_CONTROL_CATALOGUE.filter((c) => c.framework === framework);
  const counts: Record<IsoVerdict, number> = { PASS: 0, PARTIAL: 0, FAIL: 0, 'N-A': 0 };
  const controls = list.map((c) => {
    const verdict = effectiveVerdict(c, jurisdiction);
    counts[verdict] = (counts[verdict] ?? 0) + 1;
    // hasEvidence reflects what's actually in the DB (incl. derived
    // jurisdiction-scoped rows), not just the catalogue's declared
    // base sources, so the per-control chip stays truthful.
    const liveCount = evidenceCounts.get(c.controlId) ?? 0;
    return {
      controlId: c.controlId,
      title: c.title,
      category: c.category,
      verdict,
      owner: c.owner,
      hasEvidence: liveCount > 0,
      reason: c.reason,
    };
  });
  return {
    framework,
    name: meta.name,
    longName: meta.longName,
    controlsExpected: meta.controlsExpected,
    total: list.length,
    counts,
    controls,
  };
}

// ── GET /api/jrx/compliance/iso ─────────────────────────────────────────────
router.get('/iso', async (req: Request, res: Response): Promise<void> => {
  try {
    const jurisdiction = parseJurisdiction(req.query.jurisdiction);
    const onlyFramework = parseFramework(req.query.framework);
    const evidenceCounts = await getEvidenceCounts(jurisdiction);

    const frameworks: FrameworkSummary[] = await Promise.all(
      (['iso_42001', 'iso_27001', 'soc2', 'dpdpa', 'eu_ai_act', 'gdpr'] as IsoFramework[])
        .filter((f) => !onlyFramework || onlyFramework === f)
        .map((f) => summariseFramework(f, jurisdiction, evidenceCounts)),
    );

    // Overall posture rollup for dashboard tile.
    const overall: Record<IsoVerdict, number> = { PASS: 0, PARTIAL: 0, FAIL: 0, 'N-A': 0 };
    for (const fw of frameworks) {
      for (const k of Object.keys(overall) as IsoVerdict[]) {
        overall[k] += fw.counts[k];
      }
    }
    const inScope = overall.PASS + overall.PARTIAL + overall.FAIL;
    const overallPct = inScope > 0 ? Math.round((overall.PASS / inScope) * 100) : 0;

    res.json({
      success: true,
      generatedAt: new Date().toISOString(),
      jurisdiction,
      frameworkFilter: onlyFramework,
      overall: { counts: overall, passingPct: overallPct },
      frameworks,
    });
  } catch (err: any) {
    logger.error('iso_summary_failed', { errClass: err?.name ?? 'Error' });
    safeError(res, 'Failed to build ISO compliance summary', 500);
  }
});

// ── GET /api/jrx/compliance/iso/control/:id ─────────────────────────────────
// Also alias as /control/:id for the route described in the task brief.
async function controlDrilldown(req: Request, res: Response): Promise<void> {
  try {
    const id = String(req.params.id ?? '');
    const control: IsoControl | undefined = getControlById(id);
    if (!control) {
      res.status(404).json({ error: 'Unknown control id', controlId: id });
      return;
    }

    const jurisdiction = parseJurisdiction(req.query.jurisdiction);
    const verdict = effectiveVerdict(control, jurisdiction);
    const evidence = await getEvidenceForControl(control, jurisdiction, 10);

    res.json({
      success: true,
      generatedAt: new Date().toISOString(),
      jurisdiction,
      control: {
        controlId: control.controlId,
        framework: control.framework,
        frameworkName: FRAMEWORK_META[control.framework].name,
        category: control.category,
        title: control.title,
        text: control.text,
        verdict,
        baseVerdict: control.verdict,
        jurisdictionVerdicts: control.jurisdictionVerdicts ?? {},
        owner: control.owner,
        reason: verdict === 'PASS' || verdict === 'N-A' ? null : control.reason ?? null,
        remediation: verdict === 'PASS' || verdict === 'N-A' ? null : control.remediation ?? null,
        evidence,
      },
    });
  } catch (err: any) {
    logger.error('iso_control_drilldown_failed', { errClass: err?.name ?? 'Error' });
    safeError(res, 'Failed to load control drilldown', 500);
  }
}
router.get('/iso/control/:id', controlDrilldown);
router.get('/control/:id', controlDrilldown);

// ── GET /api/jrx/compliance/iso/export ──────────────────────────────────────
// Auditor-grade PDF artefact (Task #310). Mirrors /iso payload shape but
// includes per-control evidence (last 10) for PARTIAL/FAIL controls and
// stamps a Jurexio Ledger hash for tamper-evidence.
router.get('/iso/export', async (req: Request, res: Response): Promise<void> => {
  try {
    const jurisdiction = parseJurisdiction(req.query.jurisdiction);
    const onlyFramework = parseFramework(req.query.framework);
    const evidenceCounts = await getEvidenceCounts(jurisdiction);

    const frameworks = await Promise.all(
      (['iso_42001', 'iso_27001', 'soc2'] as IsoFramework[])
        .filter((f) => !onlyFramework || onlyFramework === f)
        .map((f) => summariseFramework(f, jurisdiction, evidenceCounts)),
    );

    // Roll-up posture.
    const overall: Record<IsoVerdict, number> = { PASS: 0, PARTIAL: 0, FAIL: 0, 'N-A': 0 };
    for (const fw of frameworks) {
      for (const k of Object.keys(overall) as IsoVerdict[]) overall[k] += fw.counts[k];
    }
    const inScope = overall.PASS + overall.PARTIAL + overall.FAIL;
    const overallPct = inScope > 0 ? Math.round((overall.PASS / inScope) * 100) : 0;

    // Resolve evidence for every PARTIAL/FAIL control, in parallel.
    type FailEvidence = { controlId: string; rows: IsoEvidenceRow[] };
    const evidenceJobs: Promise<FailEvidence>[] = [];
    for (const fw of frameworks) {
      for (const ctl of fw.controls) {
        if (ctl.verdict === 'PARTIAL' || ctl.verdict === 'FAIL') {
          const cat = getControlById(ctl.controlId);
          if (cat) {
            evidenceJobs.push(
              getEvidenceForControl(cat, jurisdiction, 10).then((rows) => ({
                controlId: ctl.controlId,
                rows,
              })),
            );
          }
        }
      }
    }
    const evidenceList = await Promise.all(evidenceJobs);
    const evidenceByControl = new Map<string, IsoEvidenceRow[]>();
    for (const e of evidenceList) evidenceByControl.set(e.controlId, e.rows);

    // ── Tamper-evident hash via Jurexio Ledger audit chain ──────────────
    const generatedAt = new Date().toISOString();
    const contentDigest = createHash('sha256')
      .update(
        JSON.stringify({
          jurisdiction,
          frameworkFilter: onlyFramework,
          generatedAt,
          overall,
          frameworks,
          evidence: Object.fromEntries(evidenceByControl),
        }),
      )
      .digest('hex');

    let ledgerHash = contentDigest; // fallback if chain write fails
    let ledgerPrev = '';
    let ledgerCreatedAt = generatedAt;
    let ledgerId = '';
    try {
      const rec = await appendAuditRecord({
        eventType: 'compliance.iso.export',
        payload: JSON.stringify({
          jurisdiction,
          frameworkFilter: onlyFramework,
          contentDigest,
          generatedAt,
          actor: (req as any).user?.id ?? (req as any).user?.userId ?? 'unknown',
        }),
        strict: false,
      });
      ledgerHash = rec.recordHash;
      ledgerPrev = rec.previousHash;
      ledgerCreatedAt = rec.createdAt;
      ledgerId = rec.id;
    } catch (err: any) {
      // Non-fatal: still emit a PDF stamped with the content digest.
      logger.warn('iso_export_audit_chain_unavailable', { errClass: err?.name ?? 'Error' });
    }

    // ── Build PDF ────────────────────────────────────────────────────────
    const filenameJur = jurisdiction.toLowerCase();
    const filenameFw = onlyFramework ? `-${onlyFramework}` : '';
    const filename = `jurexio-compliance-${filenameJur}${filenameFw}-${generatedAt.slice(0, 10)}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('X-Jrx-IronLedger-Hash', ledgerHash);
    res.setHeader('X-Jrx-IronLedger-Prev', ledgerPrev);
    res.setHeader('X-Jrx-IronLedger-Generated-At', ledgerCreatedAt);

    const doc = new PDFDocument({
      size: 'A4',
      margin: 48,
      info: {
        Title: `Jurexio Compliance Posture (${jurisdiction})`,
        Author: 'Jurexio Enterprise Platform',
        Subject: 'ISO 42001 / ISO 27001 / SOC 2 — auditor pack',
        Keywords: `iso42001,iso27001,soc2,${jurisdiction},jurexio,ironledger`,
        CreationDate: new Date(ledgerCreatedAt),
      },
    });
    doc.pipe(res);

    // Header.
    doc.fontSize(18).fillColor('#0F172A').text('Jurexio — Compliance Posture', { continued: false });
    doc.moveDown(0.2);
    doc.fontSize(10).fillColor('#475569').text(
      `ISO/IEC 42001:2023 · ISO/IEC 27001:2022 · SOC 2 Type II   |   ` +
        `Jurisdiction: ${jurisdiction}` +
        (onlyFramework ? `   |   Framework filter: ${FRAMEWORK_META[onlyFramework].name}` : ''),
    );
    doc.fontSize(9).fillColor('#64748B').text(`Generated: ${generatedAt}`);
    doc.moveDown(0.6);

    // Overall summary block.
    doc.fontSize(12).fillColor('#0F172A').text('Overall posture', { underline: false });
    doc.moveDown(0.2);
    doc
      .fontSize(10)
      .fillColor('#0F172A')
      .text(
        `Passing: ${overallPct}%   ·   PASS: ${overall.PASS}   ·   PARTIAL: ${overall.PARTIAL}   ` +
          `·   FAIL: ${overall.FAIL}   ·   N/A: ${overall['N-A']}`,
      );
    doc.moveDown(0.6);

    // Per-framework summary table.
    doc.fontSize(12).fillColor('#0F172A').text('Framework summary');
    doc.moveDown(0.2);
    for (const fw of frameworks) {
      doc
        .fontSize(11)
        .fillColor('#0F172A')
        .text(`${fw.name} — ${fw.longName}`);
      doc
        .fontSize(9)
        .fillColor('#475569')
        .text(
          `  Controls in scope: ${fw.total}/${fw.controlsExpected}   ` +
            `PASS ${fw.counts.PASS}   PARTIAL ${fw.counts.PARTIAL}   ` +
            `FAIL ${fw.counts.FAIL}   N/A ${fw.counts['N-A']}`,
        );
      doc.moveDown(0.3);
    }

    // Detail: every PARTIAL/FAIL control with reason + remediation + evidence.
    doc.addPage();
    doc.fontSize(14).fillColor('#0F172A').text('Findings — controls requiring attention');
    doc.fontSize(9).fillColor('#475569').text(
      'Every PARTIAL or FAIL control is listed below with its reason, suggested remediation, ' +
        'and the last 10 evidence rows captured for that control.',
    );
    doc.moveDown(0.5);

    let anyFindings = false;
    for (const fw of frameworks) {
      const findings = fw.controls.filter((c) => c.verdict === 'PARTIAL' || c.verdict === 'FAIL');
      if (findings.length === 0) continue;
      anyFindings = true;
      doc.moveDown(0.3);
      doc.fontSize(12).fillColor('#0F172A').text(fw.name, { underline: true });
      for (const c of findings) {
        const cat = getControlById(c.controlId);
        const verdictColor = c.verdict === 'FAIL' ? '#B91C1C' : '#B45309';
        doc.moveDown(0.4);
        doc.fontSize(10).fillColor(verdictColor).text(`[${c.verdict}] ${c.controlId} — ${c.title}`);
        doc.fontSize(9).fillColor('#475569').text(`Category: ${c.category}   Owner: ${c.owner}`);
        if (c.reason ?? cat?.reason) {
          doc.fontSize(9).fillColor('#0F172A').text(`Reason: ${c.reason ?? cat?.reason ?? ''}`);
        }
        if (cat?.remediation) {
          doc.fontSize(9).fillColor('#0F172A').text(`Remediation: ${cat.remediation}`);
        }
        const ev = evidenceByControl.get(c.controlId) ?? [];
        if (ev.length > 0) {
          doc.fontSize(9).fillColor('#0F172A').text(`Evidence (${ev.length}):`);
          for (const row of ev) {
            doc
              .fontSize(8)
              .fillColor('#334155')
              .text(`  • [${row.capturedAt.slice(0, 10)}] ${row.summary}`);
            doc
              .fontSize(7)
              .fillColor('#64748B')
              .text(`      source=${row.sourceKey}  artefact=${row.artefact}`);
          }
        } else {
          doc.fontSize(8).fillColor('#94A3B8').text('  (no evidence rows captured yet)');
        }
      }
    }
    if (!anyFindings) {
      doc.fontSize(10).fillColor('#15803D').text('No PARTIAL or FAIL controls in the selected scope.');
    }

    // IronLedger footer (final page).
    doc.addPage();
    doc.fontSize(14).fillColor('#0F172A').text('Tamper-evidence — Jurexio Ledger receipt');
    doc.moveDown(0.4);
    doc
      .fontSize(9)
      .fillColor('#475569')
      .text(
        'This artefact is bound to an entry in the Jurexio Ledger SHA-256 hash chain. ' +
          'Re-running the export will produce a new chained record with a different recordHash. ' +
          'Auditors can verify the chain via /api/jrx/audit/chain.',
      );
    doc.moveDown(0.6);
    const kv: Array<[string, string]> = [
      ['Jurisdiction', jurisdiction],
      ['Framework filter', onlyFramework ?? 'all'],
      ['Generated at', generatedAt],
      ['Jurexio Ledger record id', ledgerId || '(unavailable — chain write failed; content digest only)'],
      ['Jurexio Ledger record hash', ledgerHash],
      ['Jurexio Ledger previous hash', ledgerPrev || '(none)'],
      ['Content SHA-256 digest', contentDigest],
    ];
    for (const [k, v] of kv) {
      doc.fontSize(9).fillColor('#0F172A').text(`${k}:`, { continued: false });
      doc.fontSize(9).fillColor('#1E293B').font('Courier').text(`  ${v}`).font('Helvetica');
      doc.moveDown(0.15);
    }

    doc.end();
  } catch (err: any) {
    logger.error('iso_export_failed', { errClass: err?.name ?? 'Error', message: err?.message });
    if (!res.headersSent) {
      safeError(res, 'Failed to build compliance export', 500);
    } else {
      try { res.end(); } catch { /* noop */ }
    }
  }
});

// ── POST /api/jrx/compliance/iso/refresh ────────────────────────────────────
// Task #312 — admin-triggered re-sweep of the evidence manifest. The
// scheduler ticks every 15 min by default; this gives ops a way to
// force a refresh after a CAM action / audit run / security scan
// completes without waiting for the next interval. Returns the result
// of this run plus the last successful run for diagnostics.
router.post(
  '/iso/refresh',
  requireRole('admin', 'super_admin'),
  async (_req: Request, res: Response): Promise<void> => {
    try {
      const result = await refreshIsoControlEvidence({ trigger: 'manual' });
      if (!result) {
        sendApiError(res, 'BAD_REQUEST', { status: 503, overrideMessage: 'Evidence refresh unavailable (no DB).' });
        return;
      }
      res.json({
        success: true,
        result,
        lastRefresh: getLastIsoEvidenceRefresh(),
      });
    } catch (err: any) {
      logger.error('iso_refresh_failed', { errClass: err?.name ?? 'Error' });
      sendApiError(res, 'BAD_REQUEST', { status: 500, overrideMessage: 'Failed to refresh ISO evidence' });
    }
  },
);

// ── GET /api/jrx/compliance/iso/refresh/status ──────────────────────────────
// Read-only diagnostic so ops can confirm the scheduler is ticking.
// Admin-gated to match the POST refresh endpoint — refresh metadata
// (timing, error counts, prune skips) is operational rather than
// reviewer-facing, and we don't want to broaden its surface.
router.get(
  '/iso/refresh/status',
  requireRole('admin', 'super_admin'),
  (_req: Request, res: Response): void => {
    res.json({ success: true, lastRefresh: getLastIsoEvidenceRefresh() });
  },
);

export default router;
