/**
 * NV-REASONING-TRAIL-001 — audited reasoning trail for one AI deliverable.
 *
 * Renders the server `qualityEnvelope` gate-by-gate for a reviewing lawyer:
 * which gate ran, when, and what it concluded. Hosted inside
 * `ExecutionTraceRail`, which already sits beside the answer on every surface
 * where a deliverable is reviewed (LegalChat, SME workspace, drafting, live
 * testing, orchestration trace).
 *
 * The distinction this panel exists to protect: a stage that was deliberately
 * skipped for budget is neither a pass nor a failure. `scaledOptional:
 * ['cot','maker_checker','hitl']` with `ok: true` is a legitimate pass with
 * three optional stages off — 16 green ticks would be a lie, and so would three
 * red crosses.
 */
import { useMemo, useState } from 'react';
import {
  CheckCircle2,
  MinusCircle,
  XCircle,
  AlertTriangle,
  HelpCircle,
  Clock,
  ShieldCheck,
  Layers,
  Quote,
  ScrollText,
} from 'lucide-react';
import { BRAND } from '@/features/legal-chat/brand';
import {
  buildTrailStages,
  hasChainOfThought,
  NV_STAGE_STATE_LABEL,
  readAuthorities,
  readFailClosed,
  readLayers,
  readRoutingReason,
  summarizeTrail,
  type NvReasoningTrailSource,
  type NvStageState,
} from '@/lib/jrx-reasoning-trail';

export interface ReasoningTrailPanelProps {
  source?: NvReasoningTrailSource | null;
  /** Why the envelope is absent, when the host knows (e.g. an older task). */
  unavailableReason?: string;
  defaultOpen?: boolean;
}

const STATE_STYLE: Record<NvStageState, { Icon: typeof CheckCircle2; color: string; bg: string }> = {
  passed: { Icon: CheckCircle2, color: BRAND.emerald, bg: BRAND.emeraldSoft },
  scaled_off: { Icon: MinusCircle, color: BRAND.muted, bg: '#F1F3F7' },
  deferred: { Icon: Clock, color: BRAND.info, bg: '#EAF2FC' },
  failed: { Icon: XCircle, color: BRAND.error, bg: '#FBECEC' },
  missing_mandatory: { Icon: AlertTriangle, color: BRAND.error, bg: '#FBECEC' },
  not_captured: { Icon: HelpCircle, color: '#94a3b8', bg: '#F8FAFC' },
};

function Chip({ label, tone }: { label: string; tone: 'ok' | 'warn' | 'bad' | 'neutral' }) {
  const color = tone === 'ok' ? BRAND.emerald
    : tone === 'bad' ? BRAND.error
      : tone === 'warn' ? BRAND.warning
        : BRAND.muted;
  const bg = tone === 'ok' ? BRAND.emeraldSoft
    : tone === 'bad' ? '#FBECEC'
      : tone === 'warn' ? '#FDF4E7'
        : '#F1F3F7';
  return (
    <span
      className="inline-flex items-center rounded-full px-2 py-[2px] text-[10px] font-semibold"
      style={{ color, background: bg }}
    >
      {label}
    </span>
  );
}

function StageRow({
  label,
  state,
  note,
  at,
  mandatory,
}: {
  label: string;
  state: NvStageState;
  note?: string;
  at?: string;
  mandatory: boolean;
}) {
  const { Icon, color, bg } = STATE_STYLE[state];
  const time = at ? at.slice(11, 19) + 'Z' : null;
  return (
    <li
      className="flex items-start gap-2 rounded-md px-2 py-1.5"
      style={{ background: bg }}
      data-testid={`trail-stage-${state}`}
      data-stage-state={state}
    >
      <Icon className="h-3.5 w-3.5 mt-[1px] flex-shrink-0" style={{ color }} aria-hidden />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-1.5 flex-wrap">
          <span className="text-[11px] font-semibold" style={{ color: BRAND.ink }}>{label}</span>
          <span className="text-[10px] font-semibold" style={{ color }}>
            {NV_STAGE_STATE_LABEL[state]}
          </span>
          {mandatory && state !== 'passed' && state !== 'missing_mandatory' ? (
            <span className="text-[9px] uppercase tracking-wide" style={{ color: BRAND.muted }}>mandatory</span>
          ) : null}
          {time ? (
            <span className="ml-auto font-mono text-[9.5px]" style={{ color: BRAND.muted }}>{time}</span>
          ) : null}
        </div>
        {note ? (
          <p className="text-[10px] leading-snug mt-[1px]" style={{ color: BRAND.muted }}>{note}</p>
        ) : null}
      </div>
    </li>
  );
}

export function ReasoningTrailPanel({
  source,
  unavailableReason,
  defaultOpen = false,
}: ReasoningTrailPanelProps) {
  const [open, setOpen] = useState(defaultOpen);
  const envelope = source?.qualityEnvelope ?? null;
  const hasEnvelope = !!envelope
    && (Array.isArray(envelope.steps)
      || Array.isArray(envelope.completed)
      || Array.isArray(envelope.missingMandatory)
      || typeof envelope.ok === 'boolean');

  const stages = useMemo(() => (hasEnvelope ? buildTrailStages(envelope) : []), [envelope, hasEnvelope]);
  const summary = useMemo(() => summarizeTrail(stages, hasEnvelope), [stages, hasEnvelope]);

  const authorities = readAuthorities(source?.trust ?? null);
  const layers = readLayers(source?.layersUsed ?? null);
  const routingReason = readRoutingReason(source?.routing?.reason ?? null);
  const failClosed = readFailClosed(envelope);
  const cotCaptured = hasChainOfThought(source?.chainOfThought);
  const risk = envelope?.risk || source?.routing?.risk || null;

  if (!hasEnvelope) {
    return (
      <section
        className="border-t border-slate-200 p-3"
        data-testid="reasoning-trail-panel"
        data-trail-state="not-captured"
      >
        <div className="flex items-center gap-1.5">
          <ScrollText className="h-3.5 w-3.5" style={{ color: BRAND.muted }} aria-hidden />
          <h3 className="text-[11px] font-bold" style={{ color: BRAND.royal }}>Reasoning trail</h3>
          <Chip label="Not captured" tone="warn" />
        </div>
        <p className="mt-1 text-[10.5px] leading-snug" style={{ color: BRAND.muted }} data-testid="trail-not-captured">
          {unavailableReason
            || 'No audited quality envelope was returned for this task, so no gate outcome can be shown. This is not a pass.'}
        </p>
      </section>
    );
  }

  return (
    <section
      className="border-t border-slate-200 p-3"
      data-testid="reasoning-trail-panel"
      data-trail-state="captured"
    >
      <div className="flex items-center gap-1.5 flex-wrap">
        <ScrollText className="h-3.5 w-3.5" style={{ color: BRAND.royal }} aria-hidden />
        <h3 className="text-[11px] font-bold" style={{ color: BRAND.royal }}>Reasoning trail</h3>
        <span className="text-[10px]" style={{ color: BRAND.muted }} data-testid="trail-counts">
          {summary.passed} completed · {summary.scaledOff} scaled off · {summary.deferred} deferred
          · {summary.failed + summary.missingMandatory} failed · {summary.notCaptured} not captured
        </span>
        <button
          onClick={() => setOpen((v) => !v)}
          className="ml-auto text-[10px] px-2 py-[3px] rounded-md border font-semibold hover:bg-[#FBF9F0]"
          style={{ borderColor: BRAND.goldBorder, color: '#7A6A1F' }}
          data-testid="trail-toggle"
          aria-expanded={open}
        >
          {open ? 'Hide gates' : `Show ${summary.total} gates`}
        </button>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <span
          className="inline-flex items-center gap-1 rounded-full px-2 py-[2px] text-[10px] font-semibold"
          style={
            failClosed.severity === 'ok'
              ? { color: BRAND.emerald, background: BRAND.emeraldSoft }
              : failClosed.severity === 'bad'
                ? { color: BRAND.error, background: '#FBECEC' }
                : { color: BRAND.warning, background: '#FDF4E7' }
          }
          title={failClosed.detail}
          data-testid="trail-fail-closed"
        >
          <ShieldCheck className="h-3 w-3" aria-hidden /> {failClosed.headline}
        </span>
        {risk ? <Chip label={`Risk: ${risk}`} tone={/high|critical/i.test(risk) ? 'bad' : /low|minimal/i.test(risk) ? 'ok' : 'warn'} /> : null}
        {envelope?.path ? <Chip label={`Path: ${envelope.path}`} tone="neutral" /> : null}
        {envelope?.partnerLean ? <Chip label="Partner lean" tone="neutral" /> : null}
      </div>

      <p className="mt-1 text-[10px] leading-snug" style={{ color: BRAND.muted }} data-testid="trail-fail-closed-detail">
        {failClosed.detail}
      </p>

      {summary.missingMandatory > 0 || summary.failed > 0 ? (
        <p
          className="mt-1.5 text-[10.5px] font-semibold leading-snug"
          style={{ color: BRAND.error }}
          data-testid="trail-mandatory-alert"
        >
          {summary.missingMandatory > 0
            ? `${summary.missingMandatory} mandatory gate${summary.missingMandatory === 1 ? '' : 's'} unmet — do not rely on this answer without review.`
            : `${summary.failed} gate${summary.failed === 1 ? '' : 's'} failed.`}
        </p>
      ) : null}

      <dl className="mt-2 space-y-1">
        <div className="flex items-start gap-2">
          <dt className="flex items-center gap-1 text-[10px] uppercase tracking-wide min-w-[92px]" style={{ color: BRAND.muted }}>
            <Quote className="h-3 w-3" aria-hidden /> Authorities
          </dt>
          <dd className="text-[10.5px] flex items-center gap-1.5 flex-wrap" data-testid="trail-authorities">
            <Chip
              label={authorities.label}
              tone={authorities.unknown ? 'warn' : authorities.present ? 'ok' : 'bad'}
            />
            {source?.trust?.grounded ? <Chip label="Retrieval grounded" tone="neutral" /> : null}
          </dd>
        </div>

        <div className="flex items-start gap-2">
          <dt className="flex items-center gap-1 text-[10px] uppercase tracking-wide min-w-[92px]" style={{ color: BRAND.muted }}>
            <Layers className="h-3 w-3" aria-hidden /> Layers
          </dt>
          <dd className="text-[10.5px] flex items-center gap-1.5 flex-wrap" data-testid="trail-layers">
            {!layers.captured ? (
              <Chip label="Not captured" tone="warn" />
            ) : layers.layers.length === 0 ? (
              <Chip label="No layers reported" tone="bad" />
            ) : (
              layers.layers.map((l) => (
                <span key={l} className="font-mono text-[10px]" style={{ color: '#8A7420' }}>{l}</span>
              ))
            )}
            {layers.captured && layers.layers.length > 0 && !layers.corpusConsulted ? (
              <Chip label="Caselaw corpus not consulted" tone="bad" />
            ) : null}
          </dd>
        </div>

        <div className="flex items-start gap-2">
          <dt className="text-[10px] uppercase tracking-wide min-w-[92px]" style={{ color: BRAND.muted }}>Route reason</dt>
          <dd
            className="text-[10.5px]"
            style={{ color: routingReason.disclosed ? BRAND.ink : BRAND.muted }}
            data-testid="trail-routing-reason"
          >
            {routingReason.text}
            {source?.routing?.complexity ? (
              <span style={{ color: BRAND.muted }}> · complexity {source.routing.complexity}</span>
            ) : null}
          </dd>
        </div>

        <div className="flex items-start gap-2">
          <dt className="text-[10px] uppercase tracking-wide min-w-[92px]" style={{ color: BRAND.muted }}>Chain of thought</dt>
          <dd className="text-[10.5px]" data-testid="trail-cot">
            <Chip label={cotCaptured ? 'Captured' : 'Not captured'} tone={cotCaptured ? 'ok' : 'warn'} />
          </dd>
        </div>

        {source?.auditHash ? (
          <div className="flex items-start gap-2">
            <dt className="text-[10px] uppercase tracking-wide min-w-[92px]" style={{ color: BRAND.muted }}>Audit hash</dt>
            <dd className="font-mono text-[10px] break-all" style={{ color: '#8A7420' }} data-testid="trail-audit-hash">
              {source.auditHash}
            </dd>
          </div>
        ) : null}
      </dl>

      {open ? (
        <ul className="mt-2 space-y-1 max-h-72 overflow-y-auto" data-testid="trail-stage-list">
          {stages.map((s) => (
            <StageRow
              key={s.id}
              label={s.label}
              state={s.state}
              note={s.note}
              at={s.at}
              mandatory={s.mandatory}
            />
          ))}
        </ul>
      ) : null}
    </section>
  );
}

export default ReasoningTrailPanel;
