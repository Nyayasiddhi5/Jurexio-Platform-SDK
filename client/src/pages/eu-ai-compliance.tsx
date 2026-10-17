/**
 * eu-ai-compliance.tsx — AI Governance Compliance dashboard.
 *
 * Task #299 — replaces the old EU AI Act stub with three side-by-side
 * framework cards (ISO 42001:2023 / ISO 27001:2022 / SOC 2 Type II), a
 * jurisdiction filter (US / IN / GLOBAL), a framework filter, and a
 * drilldown drawer for any single control. Deep-link supported via
 * /console/eu-ai-compliance/control/:id.
 */
import { useEffect, useMemo, useState, useCallback } from 'react';
import { useLocation } from 'wouter';
import { nv, p } from '../lib/jrx-api-paths';
import { nvFetchJson } from '../lib/jrx-fetch-json';
import { getAuthHeader } from '../lib/jrx-auth-token';
import { Button } from '../components/ui/button';
import { Download } from 'lucide-react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '../components/ui/sheet';
import { Badge } from '../components/ui/badge';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '../components/ui/select';

type Verdict = 'PASS' | 'PARTIAL' | 'FAIL' | 'N-A';
type Framework =
  | 'iso_42001'
  | 'iso_27001'
  | 'soc2'
  | 'dpdpa'
  | 'eu_ai_act'
  | 'gdpr';

const FRAMEWORK_OPTIONS: ReadonlyArray<Framework> = [
  'iso_42001', 'iso_27001', 'soc2', 'dpdpa', 'eu_ai_act', 'gdpr',
];

interface ControlSummary {
  controlId: string;
  title: string;
  category: string;
  verdict: Verdict;
  owner: string;
  hasEvidence: boolean;
  reason?: string | null;
}

interface FrameworkSummary {
  framework: Framework;
  name: string;
  longName: string;
  controlsExpected: number;
  total: number;
  counts: Record<Verdict, number>;
  controls: ControlSummary[];
}

interface IsoSummaryResponse {
  generatedAt: string;
  jurisdiction: 'US' | 'IN' | 'GLOBAL';
  overall: { counts: Record<Verdict, number>; passingPct: number };
  frameworks: FrameworkSummary[];
}

interface EvidenceRow {
  sourceKey: string;
  summary: string;
  artefact: string;
  capturedAt: string;
}
interface ControlDetail {
  controlId: string;
  framework: Framework;
  frameworkName: string;
  category: string;
  title: string;
  text: string;
  verdict: Verdict;
  baseVerdict: Verdict;
  jurisdictionVerdicts: Record<string, Verdict>;
  owner: string;
  reason: string | null;
  remediation: string | null;
  evidence: EvidenceRow[];
}

const VERDICT_STYLES: Record<Verdict, { bg: string; fg: string; chip: string; label: string }> = {
  PASS:    { bg: 'bg-green-50 border-green-200',    fg: 'text-green-700',    chip: 'bg-green-100 text-green-800 border-green-300',     label: 'Pass' },
  PARTIAL: { bg: 'bg-amber-50 border-amber-200',    fg: 'text-amber-700',    chip: 'bg-amber-100 text-amber-800 border-amber-300',     label: 'Partial' },
  FAIL:    { bg: 'bg-red-50 border-red-200',        fg: 'text-red-700',      chip: 'bg-red-100 text-red-800 border-red-300',           label: 'Fail' },
  'N-A':   { bg: 'bg-slate-50 border-slate-200',    fg: 'text-slate-600',    chip: 'bg-slate-100 text-slate-700 border-slate-300',     label: 'N/A' },
};

interface PageProps {
  initialControlId?: string;
}

export default function EuAiCompliancePage({ initialControlId }: PageProps = {}) {
  const [, setLocation] = useLocation();
  const [summary, setSummary] = useState<IsoSummaryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [jurisdiction, setJurisdiction] = useState<'US' | 'IN' | 'GLOBAL'>('GLOBAL');
  const [framework, setFramework] = useState<Framework | 'ALL'>('ALL');

  const [openControlId, setOpenControlId] = useState<string | null>(initialControlId ?? null);
  const [detail, setDetail] = useState<ControlDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  // Load summary whenever filters change.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({ jurisdiction });
    if (framework !== 'ALL') params.set('framework', framework);
    nvFetchJson<IsoSummaryResponse & { success: boolean }>(`${p('COMPLIANCE_ISO')}?${params.toString()}`)
      .then((data) => { if (!cancelled) setSummary(data); })
      .catch((e: any) => { if (!cancelled) setError(e?.message ?? 'Failed to load'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [jurisdiction, framework]);

  // Load detail when drawer opens.
  const loadDetail = useCallback((controlId: string) => {
    setDetailLoading(true);
    setDetail(null);
    setDetailError(null);
    nvFetchJson<{ control: ControlDetail }>(
      `${nv('compliance/control/' + encodeURIComponent(controlId))}?jurisdiction=${jurisdiction}`,
    )
      .then((j) => setDetail(j.control))
      .catch((e: any) => setDetailError(e?.message ?? 'Failed to load drilldown'))
      .finally(() => setDetailLoading(false));
  }, [jurisdiction]);

  useEffect(() => {
    if (openControlId) loadDetail(openControlId);
  }, [openControlId, loadDetail]);

  const handleOpenControl = (controlId: string) => {
    setOpenControlId(controlId);
    setLocation(`/eu-ai-compliance/control/${encodeURIComponent(controlId)}`);
  };
  const handleCloseDrawer = (open: boolean) => {
    if (!open) {
      setOpenControlId(null);
      setLocation('/eu-ai-compliance');
    }
  };

  const visibleFrameworks = useMemo<FrameworkSummary[]>(
    () => summary?.frameworks ?? [],
    [summary],
  );

  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const handleExport = useCallback(async () => {
    setExporting(true);
    setExportError(null);
    try {
      const params = new URLSearchParams({ jurisdiction });
      if (framework !== 'ALL') params.set('framework', framework);
      const url = `${p('COMPLIANCE_ISO_EXPORT')}?${params.toString()}`;
      const r = await fetch(url, { credentials: 'include', headers: getAuthHeader() });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const blob = await r.blob();
      const fwSuffix = framework !== 'ALL' ? `-${framework}` : '';
      const filename =
        `jurexio-compliance-${jurisdiction.toLowerCase()}${fwSuffix}-` +
        `${new Date().toISOString().slice(0, 10)}.pdf`;
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = objectUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(objectUrl), 1500);
    } catch (e: any) {
      setExportError(e?.message ?? 'Failed to export');
    } finally {
      setExporting(false);
    }
  }, [jurisdiction, framework]);

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 p-6" data-testid="page-ai-governance-compliance">
      <div className="max-w-7xl mx-auto">
        <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-4 mb-6">
          <div>
            <h1 className="text-2xl lg:text-3xl font-bold tracking-tight">AI Governance Compliance</h1>
            <p className="text-sm text-slate-600 mt-1 max-w-3xl">
              Posture across <strong>ISO/IEC 42001:2023</strong> (AI Management System),
              {' '}<strong>ISO/IEC 27001:2022</strong> (Information Security — Annex A),
              {' '}<strong>SOC 2 Type II</strong> (Trust Service Criteria),
              {' '}<strong>DPDPA 2023</strong> (India), the
              {' '}<strong>EU AI Act</strong> (Regulation 2024/1689) and
              {' '}<strong>GDPR</strong> (Regulation 2016/679). Click any control
              to see the full text, current evidence, and remediation.
            </p>
          </div>

          <div className="flex flex-wrap gap-3 items-end">
            <div>
              <label className="text-xs font-medium text-slate-700 uppercase tracking-wide">Jurisdiction</label>
              <Select
                value={jurisdiction}
                onValueChange={(v) => {
                  if (v === 'US' || v === 'IN' || v === 'GLOBAL') setJurisdiction(v);
                }}
              >
                <SelectTrigger className="w-[160px] mt-1" data-testid="filter-jurisdiction">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="GLOBAL">Global</SelectItem>
                  <SelectItem value="US">United States</SelectItem>
                  <SelectItem value="IN">India</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs font-medium text-slate-700 uppercase tracking-wide">Framework</label>
              <Select
                value={framework}
                onValueChange={(v) => {
                  if (v === 'ALL' || (FRAMEWORK_OPTIONS as readonly string[]).includes(v)) {
                    setFramework(v as Framework | 'ALL');
                  }
                }}
              >
                <SelectTrigger className="w-[220px] mt-1" data-testid="filter-framework">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">All frameworks</SelectItem>
                  <SelectItem value="iso_42001">ISO 42001:2023</SelectItem>
                  <SelectItem value="iso_27001">ISO 27001:2022</SelectItem>
                  <SelectItem value="soc2">SOC 2 Type II</SelectItem>
                  <SelectItem value="dpdpa">DPDPA 2023</SelectItem>
                  <SelectItem value="eu_ai_act">EU AI Act</SelectItem>
                  <SelectItem value="gdpr">GDPR</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Button
                onClick={handleExport}
                disabled={exporting || loading || !!error}
                className="mt-1"
                data-testid="btn-export-auditor-pack"
                title="Generate a tamper-evident PDF auditor pack stamped with an IronLedger hash"
              >
                <Download className="h-4 w-4 mr-2" />
                {exporting ? 'Generating…' : 'Download auditor pack'}
              </Button>
              {exportError && (
                <p
                  className="text-xs text-red-600 mt-1 max-w-[200px]"
                  data-testid="export-error"
                >
                  {exportError}
                </p>
              )}
            </div>
          </div>
        </div>

        {loading && (
          <div className="text-sm text-slate-700" data-testid="state-loading">Loading framework posture…</div>
        )}
        {error && !loading && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700" data-testid="state-error">
            Failed to load compliance posture: {error}
          </div>
        )}

        {!loading && !error && summary && (
          <>
            {/* Overall posture tile */}
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6" data-testid="overall-posture">
              <div className="bg-white rounded-xl border border-slate-200 p-4">
                <p className="text-xs font-medium text-slate-700 uppercase">Overall passing</p>
                <p className="text-3xl font-bold text-slate-900 mt-1">{summary.overall.passingPct}%</p>
              </div>
              {(['PASS', 'PARTIAL', 'FAIL', 'N-A'] as Verdict[]).map((v) => (
                <div key={v} className={`rounded-xl border p-4 ${VERDICT_STYLES[v].bg}`}>
                  <p className={`text-xs font-medium uppercase ${VERDICT_STYLES[v].fg}`}>{VERDICT_STYLES[v].label}</p>
                  <p className={`text-3xl font-bold mt-1 ${VERDICT_STYLES[v].fg}`}>{summary.overall.counts[v]}</p>
                </div>
              ))}
            </div>

            {/* Framework cards */}
            <div className={`grid gap-4 ${visibleFrameworks.length === 1 ? '' : 'lg:grid-cols-3'}`}>
              {visibleFrameworks.map((fw) => (
                <FrameworkCard key={fw.framework} framework={fw} onOpen={handleOpenControl} />
              ))}
            </div>
          </>
        )}
      </div>

      {/* Drilldown drawer */}
      <Sheet open={openControlId !== null} onOpenChange={handleCloseDrawer}>
        <SheetContent side="right" className="w-full sm:max-w-2xl overflow-y-auto bg-white text-slate-900">
          <SheetHeader>
            <SheetTitle data-testid="drilldown-title">
              {detail ? detail.controlId : openControlId}
            </SheetTitle>
          </SheetHeader>

          {detailLoading && (
            <div className="text-sm text-slate-700 mt-6" data-testid="drilldown-loading">Loading drilldown…</div>
          )}
          {detailError && !detailLoading && (
            <div className="mt-6 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
              Failed to load drilldown: {detailError}
            </div>
          )}

          {detail && !detailLoading && (
            <ControlDrilldown detail={detail} jurisdiction={jurisdiction} />
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function FrameworkCard({ framework: fw, onOpen }:
  { framework: FrameworkSummary; onOpen: (id: string) => void }) {
  const total = fw.total;
  const pass = fw.counts.PASS;
  const pct = total > 0 ? Math.round((pass / Math.max(total - fw.counts['N-A'], 1)) * 100) : 0;

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5" data-testid={`framework-card-${fw.framework}`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">{fw.name}</h2>
          <p className="text-xs text-slate-700 mt-0.5 line-clamp-2">{fw.longName}</p>
        </div>
        <span className="text-xs font-medium bg-slate-100 text-slate-600 px-2 py-0.5 rounded">
          {total}/{fw.controlsExpected} ctl
        </span>
      </div>

      <div className="grid grid-cols-4 gap-2 my-4 text-center">
        {(['PASS', 'PARTIAL', 'FAIL', 'N-A'] as Verdict[]).map((v) => (
          <div key={v} className={`rounded-lg border p-2 ${VERDICT_STYLES[v].bg}`}>
            <p className={`text-[10px] font-medium uppercase ${VERDICT_STYLES[v].fg}`}>{VERDICT_STYLES[v].label}</p>
            <p className={`text-xl font-bold ${VERDICT_STYLES[v].fg}`} data-testid={`count-${fw.framework}-${v}`}>
              {fw.counts[v]}
            </p>
          </div>
        ))}
      </div>

      <div className="w-full bg-slate-200 rounded-full h-1.5 mb-3">
        <div className="bg-green-500 h-1.5 rounded-full" style={{ width: `${pct}%` }} />
      </div>
      <p className="text-xs text-slate-700 mb-4">{pct}% passing (excluding N/A)</p>

      <div className="border-t border-slate-100 pt-3 max-h-96 overflow-y-auto -mx-2">
        <ul className="divide-y divide-slate-100" data-testid={`controls-list-${fw.framework}`}>
          {fw.controls.map((c) => (
            <li key={c.controlId}>
              <button
                onClick={() => onOpen(c.controlId)}
                className="w-full text-left px-2 py-2 hover:bg-slate-50 rounded transition-colors flex items-start justify-between gap-2"
                data-testid={`control-row-${c.controlId}`}
              >
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-mono text-slate-700 truncate">{c.controlId}</p>
                  <p className="text-sm text-slate-800 truncate">{c.title}</p>
                </div>
                <Badge
                  variant="outline"
                  className={`shrink-0 text-[10px] ${VERDICT_STYLES[c.verdict].chip}`}
                >
                  {VERDICT_STYLES[c.verdict].label}
                </Badge>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function ControlDrilldown({ detail, jurisdiction }: { detail: ControlDetail; jurisdiction: string }) {
  const v = VERDICT_STYLES[detail.verdict];
  return (
    <div className="mt-4 space-y-5" data-testid="drilldown-body">
      <div className="flex items-center gap-2 flex-wrap">
        <span className={`px-2.5 py-0.5 rounded-full border text-xs font-semibold ${v.chip}`} data-testid="drilldown-verdict">
          {v.label}
        </span>
        <span className="text-xs text-slate-700">{detail.frameworkName}</span>
        <span className="text-xs text-slate-600">•</span>
        <span className="text-xs text-slate-700">{detail.category}</span>
        <span className="text-xs text-slate-600">•</span>
        <span className="text-xs text-slate-700">Owner: {detail.owner}</span>
        {jurisdiction !== 'GLOBAL' && (
          <span className="ml-auto text-[10px] uppercase font-medium bg-blue-50 text-blue-700 border border-blue-200 px-2 py-0.5 rounded">
            {jurisdiction} posture
          </span>
        )}
      </div>

      <div>
        <h3 className="text-sm font-semibold text-slate-900 mb-1">{detail.title}</h3>
        <p className="text-sm text-slate-700 leading-relaxed">{detail.text}</p>
      </div>

      {(detail.verdict === 'PARTIAL' || detail.verdict === 'FAIL') && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3" data-testid="drilldown-why">
          <p className="text-xs font-semibold text-amber-900 uppercase mb-1">Why {detail.verdict.toLowerCase()}?</p>
          <p className="text-sm text-amber-900">{detail.reason ?? 'No reason recorded.'}</p>
          {detail.remediation && (
            <>
              <p className="text-xs font-semibold text-amber-900 uppercase mt-3 mb-1">Suggested remediation</p>
              <p className="text-sm text-amber-900">{detail.remediation}</p>
            </>
          )}
        </div>
      )}

      {Object.keys(detail.jurisdictionVerdicts).length > 0 && (
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
          <p className="text-xs font-semibold text-slate-700 uppercase mb-2">Per-jurisdiction posture</p>
          <div className="flex flex-wrap gap-2">
            <span className="text-xs">
              <span className="font-mono text-slate-700">GLOBAL:</span>{' '}
              <span className={`px-1.5 py-0.5 rounded ${VERDICT_STYLES[detail.baseVerdict].chip}`}>
                {VERDICT_STYLES[detail.baseVerdict].label}
              </span>
            </span>
            {Object.entries(detail.jurisdictionVerdicts).map(([j, vv]) => (
              <span key={j} className="text-xs">
                <span className="font-mono text-slate-700">{j}:</span>{' '}
                <span className={`px-1.5 py-0.5 rounded ${VERDICT_STYLES[vv as Verdict].chip}`}>
                  {VERDICT_STYLES[vv as Verdict].label}
                </span>
              </span>
            ))}
          </div>
        </div>
      )}

      <div>
        <p className="text-xs font-semibold text-slate-700 uppercase mb-2">
          Evidence ({detail.evidence.length})
        </p>
        {detail.evidence.length === 0 ? (
          <p className="text-sm text-slate-700 italic">No evidence rows captured for this control yet.</p>
        ) : (
          <ol className="space-y-2" data-testid="drilldown-evidence">
            {detail.evidence.map((ev, i) => (
              <li key={`${ev.sourceKey}-${i}`} className="rounded-lg border border-slate-200 bg-white p-3">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm text-slate-800 leading-snug flex-1">{ev.summary}</p>
                  <span className="shrink-0 text-[10px] font-mono text-slate-600 bg-slate-50 border border-slate-200 px-1.5 py-0.5 rounded">
                    {new Date(ev.capturedAt).toLocaleDateString()}
                  </span>
                </div>
                {/^https?:\/\//i.test(ev.artefact) || ev.artefact.startsWith('/') ? (
                  <a
                    href={ev.artefact}
                    target={ev.artefact.startsWith('/api/') ? '_blank' : '_self'}
                    rel="noreferrer"
                    className="text-xs font-mono text-blue-600 hover:text-blue-800 hover:underline mt-1 break-all block"
                    data-testid={`evidence-link-${i}`}
                  >
                    {ev.artefact}
                  </a>
                ) : (
                  <p className="text-xs font-mono text-slate-700 mt-1 break-all">{ev.artefact}</p>
                )}
                <p className="text-[10px] uppercase tracking-wide text-slate-600 mt-1">source: {ev.sourceKey}</p>
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}
