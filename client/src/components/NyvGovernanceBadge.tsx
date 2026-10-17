/**
 * NyvGovernanceBadge — AI Output Risk & Governance Badge
 *
 * Displays the NYV AI Risk Score, risk tier badge (🟢/🟡/🔴), governance
 * metadata, jurisdiction scan results, and lawyer-confirmation gate for
 * HIGH-risk outputs.
 *
 * Usage:
 *   <NyvGovernanceBadge governance={response._nyv_governance} compact />
 *   <NyvGovernanceBadge governance={response._nyv_governance} onConfirm={handleLawyerApproval} />
 *
 * @file client/src/components/NyvGovernanceBadge.tsx
 * @version 5.0.0
 */

import React, { useState } from 'react';
import { cn } from '../lib/utils';
import { Badge } from './ui/badge';
import {
  AlertTriangle,
  CheckCircle2,
  ShieldAlert,
  ShieldCheck,
  ShieldX,
  ChevronDown,
  ChevronUp,
  Scale,
  FileWarning,
  Globe2,
  Layers,
  LockKeyhole,
  ClipboardCheck,
} from 'lucide-react';
import { Button } from './ui/button';

/* ── Types ───────────────────────────────────────────────────────────────── */

export type RiskTier = 'GREEN' | 'YELLOW' | 'RED';

export interface JurisdictionScan {
  prohibited_phrases_found?: string[];
  phrase_count?: number;
  jurisdiction_clean?: boolean;
  jurisdiction?: string;
}

export interface TemplateModeResult {
  mode?: 'STRICT' | 'GUIDED' | 'MENTOR';
  violations?: string[];
  compliant?: boolean;
}

export interface NyvGovernanceBlock {
  risk_score: number;
  risk_badge: RiskTier;
  risk_blocked: boolean;
  warnings?: string[];
  jurisdiction_scan?: JurisdictionScan;
  template_mode_result?: TemplateModeResult;
  pattern_key?: string;
  agent_id?: string;
  model_used?: string;
  tokens?: number;
  audit_hash?: string;
  timestamp?: string;
}

export interface NyvGovernanceBadgeProps {
  governance: NyvGovernanceBlock;
  compact?: boolean;
  onConfirm?: (reason: string) => void;
  onReject?: () => void;
  className?: string;
  showAuditHash?: boolean;
}

/* ── Config ──────────────────────────────────────────────────────────────── */

const RISK_CONFIG: Record<
  RiskTier,
  {
    label: string;
    emoji: string;
    bg: string;
    border: string;
    text: string;
    icon: React.ElementType;
    badgeCls: string;
    ring: string;
  }
> = {
  GREEN: {
    label: 'Low Risk',
    emoji: '🟢',
    bg: 'bg-emerald-50',
    border: 'border-emerald-200',
    text: 'text-emerald-800',
    icon: ShieldCheck,
    badgeCls: 'bg-emerald-100 text-emerald-800 border-emerald-300',
    ring: 'ring-emerald-200',
  },
  YELLOW: {
    label: 'Moderate Risk',
    emoji: '🟡',
    bg: 'bg-amber-50',
    border: 'border-amber-200',
    text: 'text-amber-800',
    icon: ShieldAlert,
    badgeCls: 'bg-amber-100 text-amber-800 border-amber-300',
    ring: 'ring-amber-200',
  },
  RED: {
    label: 'High Risk — Review Required',
    emoji: '🔴',
    bg: 'bg-red-50',
    border: 'border-red-300',
    text: 'text-red-800',
    icon: ShieldX,
    badgeCls: 'bg-red-100 text-red-800 border-red-400',
    ring: 'ring-red-300',
  },
};

/* ── Score Gauge ─────────────────────────────────────────────────────────── */

function ScoreGauge({ score, tier }: { score: number; tier: RiskTier }) {
  const pct = Math.min(100, Math.max(0, score));
  const colours = {
    GREEN: '#10b981',
    YELLOW: '#f59e0b',
    RED: '#ef4444',
  };

  return (
    <div className="flex items-center gap-2">
      <div className="relative w-10 h-10 flex-shrink-0">
        <svg viewBox="0 0 36 36" className="w-10 h-10 -rotate-90">
          <circle cx="18" cy="18" r="14" fill="none" stroke="#e5e7eb" strokeWidth="3" />
          <circle
            cx="18"
            cy="18"
            r="14"
            fill="none"
            stroke={colours[tier]}
            strokeWidth="3"
            strokeDasharray={`${(pct / 100) * 87.96} 87.96`}
            strokeLinecap="round"
          />
        </svg>
        <span
          className="absolute inset-0 flex items-center justify-center text-[9px] font-bold"
          style={{ color: colours[tier] }}
        >
          {score}
        </span>
      </div>
      <div className="text-xs text-muted-foreground leading-tight">
        <div className="font-medium">Risk Score</div>
        <div>0–30 Low · 31–60 Med · 61–100 High</div>
      </div>
    </div>
  );
}

/* ── Lawyer Confirmation Gate ────────────────────────────────────────────── */

function LawyerConfirmationGate({
  onConfirm,
  onReject,
}: {
  onConfirm: (reason: string) => void;
  onReject: () => void;
}) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');

  const handleConfirm = () => {
    if (!reason.trim() || reason.trim().length < 10) {
      setError('Please provide a reason (minimum 10 characters) for approving this high-risk output.');
      return;
    }
    setError('');
    onConfirm(reason.trim());
  };

  return (
    <div className="mt-3 rounded-lg border border-red-300 bg-red-50 p-3 space-y-2">
      <div className="flex items-start gap-2">
        <LockKeyhole className="h-4 w-4 text-red-600 mt-0.5 flex-shrink-0" />
        <div className="text-xs text-red-800 font-medium leading-tight">
          Mandatory Lawyer Confirmation Required
        </div>
      </div>
      <p className="text-xs text-red-700">
        This AI output has been flagged as <strong>HIGH RISK</strong> (score ≥ 61). Per §3.3.4
        and §4.4 of the AI Governance Framework, you must explicitly review, confirm, and log
        your approval before this output is used or shared with any client.
      </p>
      <textarea
        className="w-full rounded border border-red-300 bg-white text-xs p-2 resize-none focus:outline-none focus:ring-1 focus:ring-red-400"
        rows={2}
        placeholder="Enter your review notes and reason for approving this output..."
        value={reason}
        onChange={(e) => {
          setReason(e.target.value);
          if (error) setError('');
        }}
      />
      {error && <p className="text-xs text-red-600">{error}</p>}
      <div className="flex gap-2">
        <Button
          size="sm"
          variant="destructive"
          className="text-xs h-7"
          onClick={handleConfirm}
        >
          <ClipboardCheck className="h-3 w-3 mr-1" />
          I Confirm & Accept Responsibility
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="text-xs h-7 border-red-300 text-red-700 hover:bg-red-100"
          onClick={onReject}
        >
          Reject Output
        </Button>
      </div>
    </div>
  );
}

/* ── Main Component ──────────────────────────────────────────────────────── */

export function NyvGovernanceBadge({
  governance,
  compact = false,
  onConfirm,
  onReject,
  className,
  showAuditHash = false,
}: NyvGovernanceBadgeProps) {
  const [expanded, setExpanded] = useState(false);
  const [confirmed, setConfirmed] = useState(false);

  const tier: RiskTier = governance.risk_badge ?? 'GREEN';
  const cfg = RISK_CONFIG[tier];
  const RiskIcon = cfg.icon;
  const isHighRisk = tier === 'RED';
  const hasWarnings = (governance.warnings?.length ?? 0) > 0;
  const hasJurisdictionIssues = governance.jurisdiction_scan?.jurisdiction_clean === false;
  const hasTemplateViolations =
    governance.template_mode_result?.compliant === false &&
    (governance.template_mode_result?.violations?.length ?? 0) > 0;

  const handleConfirm = (reason: string) => {
    setConfirmed(true);
    onConfirm?.(reason);
  };

  /* ── COMPACT mode: just the pill badge ─────────────────────────────── */
  if (compact) {
    return (
      <span
        className={cn(
          'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-semibold cursor-default select-none',
          cfg.badgeCls,
          className
        )}
        title={`NYV AI Risk: ${governance.risk_score}/100 — ${cfg.label}`}
      >
        <RiskIcon className="h-3 w-3" />
        {cfg.emoji} {cfg.label}
        <span className="opacity-60 text-[10px]">({governance.risk_score})</span>
      </span>
    );
  }

  /* ── FULL mode ───────────────────────────────────────────────────────── */
  return (
    <div
      className={cn(
        'rounded-xl border p-3 space-y-2 text-sm',
        cfg.bg,
        cfg.border,
        className
      )}
    >
      {/* ── Header row ─────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <RiskIcon className={cn('h-5 w-5', cfg.text)} />
          <div>
            <div className={cn('font-semibold text-sm leading-tight', cfg.text)}>
              {cfg.emoji} {cfg.label}
            </div>
            <div className="text-xs text-muted-foreground">NYV AI Governance Badge</div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <ScoreGauge score={governance.risk_score} tier={tier} />
          <button
            onClick={() => setExpanded((v) => !v)}
            className={cn(
              'rounded-full p-1 transition-colors hover:bg-white/60',
              cfg.text
            )}
            aria-label={expanded ? 'Collapse details' : 'Expand details'}
          >
            {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </button>
        </div>
      </div>

      {/* ── Inline warning pills ────────────────────────────────────────── */}
      {(hasWarnings || hasJurisdictionIssues || hasTemplateViolations) && (
        <div className="flex flex-wrap gap-1">
          {hasJurisdictionIssues && (
            <span className="inline-flex items-center gap-1 rounded-full bg-orange-100 text-orange-700 border border-orange-200 text-[10px] px-2 py-0.5">
              <Globe2 className="h-2.5 w-2.5" />
              Jurisdiction issue
            </span>
          )}
          {hasTemplateViolations && (
            <span className="inline-flex items-center gap-1 rounded-full bg-purple-100 text-purple-700 border border-purple-200 text-[10px] px-2 py-0.5">
              <Layers className="h-2.5 w-2.5" />
              Template violation
            </span>
          )}
          {governance.warnings?.slice(0, 3).map((w, i) => (
            <span
              key={i}
              className="inline-flex items-center gap-1 rounded-full bg-yellow-100 text-yellow-800 border border-yellow-200 text-[10px] px-2 py-0.5"
            >
              <AlertTriangle className="h-2.5 w-2.5" />
              {w.length > 40 ? w.slice(0, 40) + '…' : w}
            </span>
          ))}
          {(governance.warnings?.length ?? 0) > 3 && (
            <span className="text-[10px] text-muted-foreground">
              +{(governance.warnings?.length ?? 0) - 3} more
            </span>
          )}
        </div>
      )}

      {/* ── Expanded details ─────────────────────────────────────────────── */}
      {expanded && (
        <div className="space-y-2 border-t pt-2 mt-1">

          {/* Jurisdiction scan */}
          {governance.jurisdiction_scan && (
            <div className="rounded-lg border border-white/60 bg-white/40 p-2 space-y-1">
              <div className="flex items-center gap-1 text-xs font-semibold text-foreground">
                <Globe2 className="h-3.5 w-3.5" />
                Jurisdiction Scan
                {governance.jurisdiction_scan.jurisdiction_clean ? (
                  <span className="ml-auto text-emerald-600 flex items-center gap-0.5">
                    <CheckCircle2 className="h-3 w-3" /> Clean
                  </span>
                ) : (
                  <span className="ml-auto text-red-600 flex items-center gap-0.5">
                    <AlertTriangle className="h-3 w-3" /> Issues found
                  </span>
                )}
              </div>
              {governance.jurisdiction_scan.jurisdiction && (
                <div className="text-xs text-muted-foreground">
                  Jurisdiction: <strong>{governance.jurisdiction_scan.jurisdiction}</strong>
                </div>
              )}
              {(governance.jurisdiction_scan.prohibited_phrases_found?.length ?? 0) > 0 && (
                <div className="text-xs text-red-700">
                  Prohibited phrases:{' '}
                  <code className="bg-red-100 px-1 rounded text-[10px]">
                    {governance.jurisdiction_scan.prohibited_phrases_found!.join(', ')}
                  </code>
                </div>
              )}
            </div>
          )}

          {/* Template mode */}
          {governance.template_mode_result && (
            <div className="rounded-lg border border-white/60 bg-white/40 p-2 space-y-1">
              <div className="flex items-center gap-1 text-xs font-semibold text-foreground">
                <Layers className="h-3.5 w-3.5" />
                Template Mode:{' '}
                <span className="font-bold">{governance.template_mode_result.mode ?? 'N/A'}</span>
                {governance.template_mode_result.compliant ? (
                  <span className="ml-auto text-emerald-600 flex items-center gap-0.5">
                    <CheckCircle2 className="h-3 w-3" /> Compliant
                  </span>
                ) : (
                  <span className="ml-auto text-amber-600 flex items-center gap-0.5">
                    <FileWarning className="h-3 w-3" /> Violations
                  </span>
                )}
              </div>
              {(governance.template_mode_result.violations?.length ?? 0) > 0 && (
                <ul className="text-xs text-amber-800 space-y-0.5 list-disc list-inside">
                  {governance.template_mode_result.violations!.map((v, i) => (
                    <li key={i}>{v}</li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {/* All warnings */}
          {(governance.warnings?.length ?? 0) > 0 && (
            <div className="rounded-lg border border-white/60 bg-white/40 p-2 space-y-1">
              <div className="flex items-center gap-1 text-xs font-semibold text-foreground">
                <AlertTriangle className="h-3.5 w-3.5" />
                Warnings ({governance.warnings!.length})
              </div>
              <ul className="text-xs text-muted-foreground space-y-0.5 list-disc list-inside">
                {governance.warnings!.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Legal framework metadata */}
          <div className="rounded-lg border border-white/60 bg-white/40 p-2 space-y-1">
            <div className="flex items-center gap-1 text-xs font-semibold text-foreground">
              <Scale className="h-3.5 w-3.5" />
              AI Output Metadata
            </div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-[11px] text-muted-foreground">
              {governance.pattern_key && (
                <>
                  <span>Pattern</span>
                  <span className="font-mono font-medium">{governance.pattern_key}</span>
                </>
              )}
              {governance.agent_id && (
                <>
                  <span>Agent</span>
                  <span className="font-mono truncate">{governance.agent_id}</span>
                </>
              )}
              {governance.model_used && (
                <>
                  <span>Model</span>
                  <span className="font-mono">{governance.model_used}</span>
                </>
              )}
              {governance.tokens !== undefined && (
                <>
                  <span>Tokens</span>
                  <span>{governance.tokens.toLocaleString()}</span>
                </>
              )}
              {governance.timestamp && (
                <>
                  <span>Generated</span>
                  <span>{new Date(governance.timestamp).toLocaleString()}</span>
                </>
              )}
            </div>
            {showAuditHash && governance.audit_hash && (
              <div className="text-[10px] text-muted-foreground font-mono break-all mt-1">
                Audit Hash: {governance.audit_hash}
              </div>
            )}
          </div>

          {/* Blocked notice */}
          {governance.risk_blocked && !confirmed && (
            <div className="flex items-start gap-2 rounded-lg border border-red-300 bg-red-100 p-2 text-xs text-red-800">
              <ShieldX className="h-4 w-4 flex-shrink-0 mt-0.5" />
              <span>
                This output has been <strong>blocked</strong> by the NYV AI Risk Gate. A
                qualified legal professional must review before this can be used.
              </span>
            </div>
          )}

          {/* High-risk confirmation gate */}
          {isHighRisk && !confirmed && onConfirm && (
            <LawyerConfirmationGate onConfirm={handleConfirm} onReject={onReject ?? (() => {})} />
          )}

          {/* Confirmed notice */}
          {isHighRisk && confirmed && (
            <div className="flex items-center gap-2 rounded-lg border border-emerald-300 bg-emerald-50 p-2 text-xs text-emerald-800">
              <CheckCircle2 className="h-4 w-4 flex-shrink-0" />
              <span>
                Output reviewed and approved by qualified legal professional. Approval logged to
                immutable audit chain.
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ── Convenience: inline strip for chat/completions output ───────────────── */

export function NyvGovernanceStrip({
  score,
  badge,
  blocked,
  warningCount = 0,
  onExpand,
}: {
  score: number;
  badge: RiskTier;
  blocked?: boolean;
  warningCount?: number;
  onExpand?: () => void;
}) {
  const cfg = RISK_CONFIG[badge];
  const RiskIcon = cfg.icon;

  return (
    <div
      className={cn(
        'flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs',
        cfg.bg,
        cfg.border
      )}
    >
      <RiskIcon className={cn('h-3.5 w-3.5 flex-shrink-0', cfg.text)} />
      <span className={cn('font-semibold', cfg.text)}>
        {cfg.emoji} {cfg.label}
      </span>
      <span className="text-muted-foreground">Score: {score}/100</span>
      {blocked && (
        <Badge variant="destructive" className="text-[10px] px-1.5 py-0">
          Blocked
        </Badge>
      )}
      {warningCount > 0 && (
        <span className="text-amber-600">
          ⚠ {warningCount} warning{warningCount > 1 ? 's' : ''}
        </span>
      )}
      {onExpand && (
        <button
          onClick={onExpand}
          className="ml-auto text-muted-foreground hover:text-foreground underline"
        >
          Details
        </button>
      )}
    </div>
  );
}

export default NyvGovernanceBadge;
