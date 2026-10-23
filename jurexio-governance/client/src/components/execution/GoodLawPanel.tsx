/**
 * NV-GOOD-LAW-PANEL-001 — "is this authority still good law?" for a lawyer.
 *
 * Hosted inside `ExecutionTraceRail` (so it appears on every surface where a
 * deliverable and its authorities are reviewed) and on the Instant Search
 * caselaw column (where a lawyer reads an authority directly). One component,
 * two hosts — the same discipline `ReasoningTrailPanel` follows.
 *
 * The rendering contract, and why each rule is absolute:
 *
 *  - There is NO affirmative badge, because there is no affirmative verdict.
 *    `good` is unreachable in `jrx-citator-treatment.ts` by construction, and a
 *    green tick here would be read as a clearance the platform cannot give.
 *  - `unknown` gets its own amber state and the words "not cleared". A grey tick
 *    or a hidden panel reads as "safe" to a scanning eye, which is the failure
 *    mode that ends in a filing on overruled law.
 *  - `coverage` renders unconditionally, in the header, never behind the
 *    expander. At ~70% corpus coverage the distinction between "no adverse
 *    treatment found" and "we did not look at enough of the corpus" IS the
 *    answer, so it cannot be one click away.
 *  - Every treatment row carries its `extractedBy` provenance chip. A verified
 *    phrase match and an LLM inference must not look alike.
 *  - `matched: false` replaces the verdict with an explicit "authority not
 *    identified" state, and offers `exact=true`. A partner hit this: the
 *    endpoint token-matched "Kesavananda Bharati v. State of Kerala" onto a 2018
 *    Kerala HC matter named "KESAVAN". Nothing unsafe was asserted, but a UI
 *    trusting `authority.title` would have shown the wrong case.
 *
 * The check is never fired automatically. One call costs two upstream NYS
 * searches with a 60 s budget, so it is an explicit act by the reader.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertOctagon,
  AlertTriangle,
  HelpCircle,
  Loader2,
  ScanSearch,
  ShieldQuestion,
  Scale,
} from 'lucide-react';
import { BRAND } from '@/features/legal-chat/brand';
import { p } from '@/lib/jrx-api-paths';
import { getAuthToken } from '@/lib/jrx-auth-token';
import {
  extractTreatmentPayload,
  formatTreatmentKind,
  isAdverseTreatment,
  NV_GOOD_LAW_LIMITATION,
  NV_GOOD_LAW_NOT_SIMILARITY,
  readCoverage,
  readExtractedBy,
  readGoodLaw,
  readResolution,
  treatmentRows,
  type NvGoodLawState,
  type NvTreatmentPayload,
} from '@/lib/jrx-good-law';

export type NvTreatmentFetcher = (
  citation: string,
  opts: { exact: boolean; signal?: AbortSignal },
) => Promise<NvTreatmentPayload | null>;

export interface GoodLawPanelProps {
  /** Authority as the lawyer wrote it. Echoed verbatim in the header. */
  citation?: string | null;
  /**
   * Pre-fetched payload. When supplied the panel renders it and performs no
   * request — used by hosts that already hold a response, and by tests.
   */
  payload?: NvTreatmentPayload | null;
  /** Injected for tests; defaults to the live gateway call. */
  fetchTreatment?: NvTreatmentFetcher;
  /** Start in `exact=true` (citation-only identification). */
  defaultExact?: boolean;
  compact?: boolean;
}

/**
 * Colour is load-bearing: `unknown` must not share a palette with either an
 * adverse finding or anything that could read as a clearance. Amber-on-cream is
 * the "we do not know" state; red is reserved for a positive adverse finding.
 */
const STATE_STYLE: Record<NvGoodLawState, { color: string; bg: string; border: string; Icon: typeof AlertOctagon }> = {
  overruled: { color: BRAND.error, bg: '#FBECEC', border: '#F0C9C9', Icon: AlertOctagon },
  doubted: { color: BRAND.error, bg: '#FBECEC', border: '#F0C9C9', Icon: AlertTriangle },
  unknown: { color: '#8A5B00', bg: '#FDF4E7', border: '#E9D3A8', Icon: ShieldQuestion },
  unresolved_authority: { color: '#8A5B00', bg: '#FDF4E7', border: '#E9D3A8', Icon: HelpCircle },
  unverifiable: { color: '#8A5B00', bg: '#FDF4E7', border: '#E9D3A8', Icon: HelpCircle },
  not_checked: { color: BRAND.muted, bg: '#F1F3F7', border: BRAND.border, Icon: ScanSearch },
};

async function liveFetchTreatment(
  citation: string,
  opts: { exact: boolean; signal?: AbortSignal },
): Promise<NvTreatmentPayload | null> {
  const qs = new URLSearchParams({ citation });
  if (opts.exact) qs.set('exact', 'true');
  const token = getAuthToken();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${p('KNOWLEDGE_CASELAW_TREATMENT')}?${qs}`, {
    credentials: 'include',
    headers,
    signal: opts.signal,
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    const message = (json as { error?: { message?: string } } | null)?.error?.message;
    throw new Error(message || `Treatment check failed (HTTP ${res.status})`);
  }
  return extractTreatmentPayload(json);
}

function Chip({
  label,
  color,
  bg,
  title,
  testId,
}: {
  label: string;
  color: string;
  bg: string;
  title?: string;
  testId?: string;
}) {
  return (
    <span
      className="inline-flex items-center rounded-full px-2 py-[2px] text-[10px] font-semibold"
      style={{ color, background: bg }}
      title={title}
      data-testid={testId}
    >
      {label}
    </span>
  );
}

export function GoodLawPanel({
  citation,
  payload: payloadProp,
  fetchTreatment = liveFetchTreatment,
  defaultExact = false,
  compact = false,
}: GoodLawPanelProps) {
  const [exact, setExact] = useState(defaultExact);
  const [payload, setPayload] = useState<NvTreatmentPayload | null>(payloadProp ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showRows, setShowRows] = useState(true);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (payloadProp !== undefined) setPayload(payloadProp ?? null);
  }, [payloadProp]);

  /* A new authority invalidates the previous verdict. Leaving the old one on
   * screen would attribute one case's treatment to another. */
  useEffect(() => {
    if (payloadProp === undefined) {
      setPayload(null);
      setError(null);
    }
  }, [citation, payloadProp]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const runCheck = useCallback(
    async (useExact: boolean) => {
      const target = (citation ?? '').trim();
      if (!target) return;
      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;
      setBusy(true);
      setError(null);
      try {
        const next = await fetchTreatment(target, { exact: useExact, signal: ac.signal });
        if (ac.signal.aborted) return;
        setPayload(next);
        if (!next) {
          setError('The treatment endpoint returned no readable payload. Nothing is being reported.');
        }
      } catch (e) {
        if ((e as { name?: string })?.name === 'AbortError') return;
        /* On failure the previous verdict is dropped: a stale "no adverse
         * treatment" beside a failed refresh is the worst of both. */
        setPayload(null);
        setError(e instanceof Error ? e.message : 'Treatment check failed');
      } finally {
        if (!ac.signal.aborted) setBusy(false);
      }
    },
    [citation, fetchTreatment],
  );

  const verdict = readGoodLaw(payload);
  const coverage = readCoverage(payload?.coverage);
  const resolution = readResolution(payload?.authority);
  const rows = treatmentRows(payload);
  const style = STATE_STYLE[verdict.state];
  const { Icon } = style;
  const target = (citation ?? '').trim();

  return (
    <section
      className={compact ? 'p-2.5' : 'border-t border-slate-200 p-3'}
      data-testid="good-law-panel"
      data-good-law-state={verdict.state}
      data-good-law-adverse={verdict.adverse ? 'true' : 'false'}
    >
      <div className="flex items-center gap-1.5 flex-wrap">
        <Scale className="h-3.5 w-3.5" style={{ color: BRAND.royal }} aria-hidden />
        <h3 className="text-[11px] font-bold" style={{ color: BRAND.royal }}>
          Is this still good law?
        </h3>
        {target ? (
          <span className="font-mono text-[10px] truncate max-w-[220px]" style={{ color: BRAND.muted }} data-testid="good-law-requested-citation">
            {target}
          </span>
        ) : null}
        <button
          type="button"
          onClick={() => void runCheck(exact)}
          disabled={busy || !target}
          className="ml-auto inline-flex items-center gap-1 text-[10px] px-2 py-[3px] rounded-md border font-semibold hover:bg-[#FBF9F0] disabled:opacity-50"
          style={{ borderColor: BRAND.goldBorder, color: '#7A6A1F' }}
          data-testid="good-law-check"
        >
          {busy ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> : <ScanSearch className="h-3 w-3" aria-hidden />}
          {busy ? 'Checking…' : payload ? 'Re-check' : 'Check treatment'}
        </button>
      </div>

      <div
        className="mt-2 rounded-md border px-2.5 py-2"
        style={{ background: style.bg, borderColor: style.border }}
      >
        <div className="flex items-start gap-2">
          <Icon className="h-4 w-4 mt-[1px] flex-shrink-0" style={{ color: style.color }} aria-hidden />
          <div className="min-w-0">
            <p className="text-[11.5px] font-bold" style={{ color: style.color }} data-testid="good-law-headline">
              {verdict.headline}
            </p>
            <p className="text-[10.5px] leading-snug mt-[2px]" style={{ color: BRAND.ink }} data-testid="good-law-detail">
              {verdict.detail}
            </p>
          </div>
        </div>
      </div>

      {/* Coverage is a sibling of the verdict, not a child of an expander:
        * without it "no adverse treatment found" is unreadable. */}
      <div
        className="mt-1.5 rounded-md px-2.5 py-1.5"
        style={{ background: '#F8FAFC', border: `1px solid ${BRAND.border}` }}
        data-testid="good-law-coverage"
      >
        <p className="text-[10px] font-semibold" style={{ color: BRAND.ink }} data-testid="good-law-coverage-headline">
          Coverage: {coverage.headline}
        </p>
        <p className="text-[10px] leading-snug mt-[1px]" style={{ color: BRAND.muted }} data-testid="good-law-coverage-detail">
          {coverage.detail}
        </p>
      </div>

      <div className="mt-1.5 flex flex-wrap items-center gap-1.5" data-testid="good-law-resolution">
        <Chip
          label={resolution.headline}
          color={resolution.matched ? BRAND.royal : '#8A5B00'}
          bg={resolution.matched ? BRAND.royalSoft : '#FDF4E7'}
          testId="good-law-resolution-badge"
        />
        <span className="font-mono text-[9.5px]" style={{ color: BRAND.muted }} data-testid="good-law-resolution-method">
          method={resolution.method}
          {resolution.confidence !== null ? ` · confidence=${resolution.confidence}` : ' · confidence=not reported'}
          {resolution.exactModeRequested ? ' · exact=true' : ''}
        </span>
      </div>
      <p className="mt-[2px] text-[10px] leading-snug" style={{ color: BRAND.muted }} data-testid="good-law-resolution-detail">
        {resolution.detail}
      </p>

      {resolution.offerExactMode && target ? (
        <button
          type="button"
          onClick={() => {
            setExact(true);
            void runCheck(true);
          }}
          disabled={busy}
          className="mt-1.5 text-[10px] px-2 py-[3px] rounded-md border font-semibold hover:bg-[#FBF9F0] disabled:opacity-50"
          style={{ borderColor: BRAND.goldBorder, color: '#7A6A1F' }}
          data-testid="good-law-exact-retry"
        >
          Retry with exact citation only (no party-name matching)
        </button>
      ) : null}

      {error ? (
        <p className="mt-1.5 text-[10.5px] font-semibold" style={{ color: BRAND.error }} data-testid="good-law-error">
          {error}
        </p>
      ) : null}

      {rows.length > 0 ? (
        <div className="mt-2">
          <button
            type="button"
            onClick={() => setShowRows((v) => !v)}
            className="text-[10px] font-semibold underline-offset-2 hover:underline"
            style={{ color: BRAND.royal }}
            aria-expanded={showRows}
            data-testid="good-law-rows-toggle"
          >
            {showRows ? 'Hide' : 'Show'} {rows.length} treatment {rows.length === 1 ? 'row' : 'rows'}
          </button>
          {showRows ? (
            <ul className="mt-1 space-y-1 max-h-64 overflow-y-auto" data-testid="good-law-rows">
              {rows.map((row, i) => {
                const prov = readExtractedBy(row.extractedBy);
                const adverse = isAdverseTreatment(row.treatment);
                return (
                  <li
                    key={`${row.citation ?? 'no-citation'}-${i}`}
                    className="rounded-md border px-2 py-1.5"
                    style={{
                      background: adverse ? '#FBECEC' : BRAND.surface,
                      borderColor: adverse ? '#F0C9C9' : BRAND.border,
                    }}
                    data-testid="good-law-row"
                    data-treatment={row.treatment ?? 'unlabelled'}
                    data-extracted-by={prov.key}
                  >
                    <div className="flex items-baseline gap-1.5 flex-wrap">
                      <span
                        className="text-[10.5px] font-bold"
                        style={{ color: adverse ? BRAND.error : BRAND.ink }}
                      >
                        {formatTreatmentKind(row.treatment)}
                      </span>
                      {/* Provenance per row — verified phrase vs AI-suggested must
                        * never be indistinguishable. */}
                      <Chip
                        label={prov.label}
                        color={prov.reproducible ? BRAND.royal : '#8A5B00'}
                        bg={prov.reproducible ? BRAND.royalSoft : '#FDF4E7'}
                        title={prov.detail}
                        testId="good-law-row-extracted-by"
                      />
                      {typeof row.confidence === 'number' ? (
                        <span className="font-mono text-[9.5px]" style={{ color: BRAND.muted }} title="Confidence in the EXTRACTION, not in the law.">
                          extraction confidence {row.confidence}
                        </span>
                      ) : null}
                      {row.citation ? (
                        <span className="ml-auto font-mono text-[9.5px]" style={{ color: BRAND.muted }}>
                          {row.citation}
                        </span>
                      ) : (
                        <span className="ml-auto text-[9.5px]" style={{ color: BRAND.muted }}>
                          citing judgment not identified
                        </span>
                      )}
                    </div>
                    {row.paragraph ? (
                      <p className="mt-[2px] text-[10px] leading-snug italic" style={{ color: BRAND.ink }}>
                        “{row.paragraph}”
                      </p>
                    ) : (
                      <p className="mt-[2px] text-[10px]" style={{ color: BRAND.muted }}>
                        No passage was returned for this row, so it cannot be verified from here.
                      </p>
                    )}
                  </li>
                );
              })}
            </ul>
          ) : null}
        </div>
      ) : null}

      <p className="mt-2 text-[10px] leading-snug" style={{ color: BRAND.muted }} data-testid="good-law-limitation">
        {NV_GOOD_LAW_LIMITATION}
      </p>
      <p className="mt-[2px] text-[10px] leading-snug" style={{ color: BRAND.muted }} data-testid="good-law-not-similarity">
        {NV_GOOD_LAW_NOT_SIMILARITY}
      </p>
    </section>
  );
}

export default GoodLawPanel;
