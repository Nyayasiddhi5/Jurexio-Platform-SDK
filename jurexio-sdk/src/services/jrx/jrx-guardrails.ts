import { sql } from 'drizzle-orm';
import { db as _rawDb } from '../../db/index.js';
import { lazyRequire } from '../../utils/jrx-type-helpers.js';
import { createLogger } from '../../utils/logger.js';
import { isSoftPolicyActive } from '../../middleware/jrx-integration-soft-policy.js';

const db = lazyRequire(() => _rawDb, 'db');
const logger = createLogger('jrx-guardrails');

export type BarCouncilEnforcement = 'ALLOW' | 'WARN' | 'BLOCK' | 'HITL' | 'MANDATORY_HITL';

export interface BarCouncilRule {
  jurisdiction: string;
  ruleId: string;
  ruleText: string;
  enforcement: Exclude<BarCouncilEnforcement, 'ALLOW'>;
}

export interface BarCouncilEvaluationInput {
  requestId: string;
  agentId?: string;
  jurisdiction?: string;
  promptText?: string;
  responseText: string;
  matterId?: string;
  citations?: { verified?: number; unverified?: number };
  hallucinationCheck?: { flaggedClaims?: string[]; status?: string };
  metadata?: {
    awsRegion?: string;
    clientConsent?: boolean;
    conflictCheckLogged?: boolean;
  };
}

export interface BarCouncilEvaluationResult {
  jurisdiction: string;
  enforcement: BarCouncilEnforcement;
  matchedRules: BarCouncilRule[];
  warnings: string[];
  reason: string | null;
}

const ENFORCEMENT_ORDER: Record<BarCouncilEnforcement, number> = {
  ALLOW: 0,
  WARN: 1,
  HITL: 2,
  BLOCK: 3,
  MANDATORY_HITL: 4,
};

const DISCLAIMER_RX = /not (?:legal )?advice|consult (?:a )?(?:qualified )?(?:advocate|lawyer|attorney|solicitor)|informational purpose/i;
const SOLICITATION_RX = /\b(hire us|engage our firm|retain our services|contact us to represent|we can represent you)\b/i;
const BILLING_RX = /\b(fee|fees|billing|retainer|quote|estimate)\b/i;
const ESTIMATE_RX = /\bestimate\b/i;
const LEGACY_INDIAN_STATUTE_RX = /\b(?:IPC\s*1860|CrPC\s*1973|Indian Evidence Act|IEA)\b/i;
const COURT_SUBMISSION_RX = /\b(court|tribunal|submission|filing|pleading|affidavit|petition)\b/i;
const SHARIA_RX = /\bsharia|shari'?a|fiqh|fatwa|islamic finance\b/i;
const DECISION_LIKE_RX = /\b(approve|deny|liable|guilty|must comply|terminate|suspend)\b/i;
const CLIENT_DATA_RX = /\bclient|matter|privileged|confidential\b/i;

function toJcnJurisdiction(jurisdiction?: string): string {
  switch (String(jurisdiction || '').trim().toUpperCase()) {
    case 'IN':
      return 'JCN-IN';
    case 'UK':
      return 'JCN-UK';
    case 'US':
      return 'JCN-US';
    case 'EU':
      return 'JCN-EU';
    case 'GC':
      return 'JCN-GCC';
    case 'SG':
      return 'JCN-SG';
    default:
      return 'JCN-IN';
  }
}

function normalizeRule(row: any): BarCouncilRule {
  return {
    jurisdiction: String(row.jurisdiction),
    ruleId: String(row.rule_id || row.ruleId),
    ruleText: String(row.rule_text || row.ruleText),
    enforcement: String(row.enforcement).toUpperCase() as Exclude<BarCouncilEnforcement, 'ALLOW'>,
  };
}

/** Local/dev fallback when jrx.bar_council_config is not provisioned. */
const BUILT_IN_GATE8_RULES: BarCouncilRule[] = [
  { jurisdiction: 'JCN-IN', ruleId: 'BCI_RULE_33', ruleText: 'Disclaimer required on legal outputs', enforcement: 'WARN' },
  { jurisdiction: 'JCN-IN', ruleId: 'BCI_RULE_36', ruleText: 'No solicitation / touting', enforcement: 'BLOCK' },
  { jurisdiction: 'JCN-IN', ruleId: 'BCI_RULE_46', ruleText: 'Fee disclosure must include estimate framing', enforcement: 'WARN' },
  { jurisdiction: 'JCN-IN', ruleId: 'BCI_RULE_17', ruleText: 'Conflict check required when matter_id present', enforcement: 'HITL' },
  { jurisdiction: 'JCN-IN', ruleId: 'BCI_CITATION_BNS', ruleText: 'Use BNS 2023 not repealed IPC/CrPC', enforcement: 'WARN' },
  { jurisdiction: 'JCN-UK', ruleId: 'SRA_CODE_6_3', ruleText: 'Court submission citation integrity', enforcement: 'MANDATORY_HITL' },
  { jurisdiction: 'JCN-US', ruleId: 'ABA_MRPC_1_6', ruleText: 'Client confidentiality / consent', enforcement: 'HITL' },
];

// Whether jrx.bar_council_config is provisioned in this environment. Cached so
// that a missing table/schema (e.g. RDS where the jrx schema isn't migrated)
// does NOT re-query and re-log on every request — we fall straight through to
// the built-in BCI/SRA/ABA rules below. null = not yet probed.
let gate8TableAvailable: boolean | null = null;

/** Postgres error codes for "table missing" (42P01) and "schema missing" (3F000). */
function isMissingRelation(error: any): boolean {
  const code = error?.code || error?.cause?.code;
  if (code === '42P01' || code === '3F000') return true;
  const msg = String(error?.message || '').toLowerCase();
  return msg.includes('does not exist') && (msg.includes('jrx') || msg.includes('bar_council_config'));
}

async function loadRules(jurisdiction: string): Promise<BarCouncilRule[]> {
  // Known-unprovisioned: skip the doomed query entirely, no per-request log.
  if (gate8TableAvailable === false) return [];
  try {
    const result = await db.execute(sql`
      SELECT jurisdiction, rule_id, rule_text, enforcement
      FROM jrx.bar_council_config
      WHERE active = TRUE
        AND jurisdiction = ${jurisdiction}
        AND (effective_from IS NULL OR effective_from <= CURRENT_DATE)
        AND (effective_to IS NULL OR effective_to >= CURRENT_DATE)
      ORDER BY rule_id ASC
    `);
    gate8TableAvailable = true;
    const rows: any[] = (result as any).rows ?? (Array.isArray(result) ? result : []);
    return rows.map(normalizeRule);
  } catch (error: any) {
    if (isMissingRelation(error)) {
      // Provisioning gap, not a runtime fault: latch it and log ONCE (the early
      // return above skips this path on every subsequent call). Gate 8 keeps
      // enforcing via BUILT_IN_GATE8_RULES (fail-soft, not fail-open).
      gate8TableAvailable = false;
      logger.info('[JRX Guardrails] jrx.bar_council_config not provisioned — using built-in BCI/SRA/ABA gate rules');
      return [];
    }
    // Transient/unexpected DB error: keep a warning (but accurate — gates still
    // fall back to built-in rules, the request is NOT blindly allowed).
    logger.warn('[JRX Guardrails] Rule lookup failed; falling back to built-in gate rules', {
      jurisdiction,
      error: error?.message,
    });
    return [];
  }
}

function ruleTriggered(rule: BarCouncilRule, input: BarCouncilEvaluationInput): boolean {
  const response = input.responseText || '';
  const prompt = input.promptText || '';
  const citationsUnverified = Number(input.citations?.unverified || 0);
  const hallucinated = Number(input.hallucinationCheck?.flaggedClaims?.length || 0) > 0;
  const combined = `${prompt}\n${response}`;

  switch (rule.ruleId) {
    case 'BCI_RULE_33':
      return !DISCLAIMER_RX.test(response);
    case 'BCI_RULE_36':
      return SOLICITATION_RX.test(response);
    case 'BCI_RULE_46':
      return BILLING_RX.test(combined) && !ESTIMATE_RX.test(response);
    case 'BCI_RULE_17':
      return Boolean(input.matterId) && !input.metadata?.conflictCheckLogged;
    case 'BCI_CITATION_BNS':
      return LEGACY_INDIAN_STATUTE_RX.test(combined);
    case 'SRA_AI_GUIDANCE_2024':
    case 'ABA_OPINION_512':
    case 'LSS_AI_GUIDELINES_2023':
      return true;
    case 'SRA_CODE_6_3':
    case 'BSB_RULE_C9':
    case 'ABA_MRPC_3_3':
    case 'PCR_RULE_23':
      return COURT_SUBMISSION_RX.test(combined) && (citationsUnverified > 0 || hallucinated);
    case 'ABA_MRPC_1_6':
      return CLIENT_DATA_RX.test(combined) && input.metadata?.clientConsent === false;
    case 'UAE_PDPL_SOVEREIGNTY':
      return Boolean(input.metadata?.awsRegion) && input.metadata?.awsRegion !== 'me-south-1';
    case 'SHARIA_DISCLOSURE':
      return SHARIA_RX.test(combined) && !DISCLAIMER_RX.test(response);
    case 'GDPR_ART_22':
    case 'EU_AI_ACT_ART_14':
      return DECISION_LIKE_RX.test(response);
    default:
      return false;
  }
}

function highestEnforcement(rules: BarCouncilRule[]): BarCouncilEnforcement {
  let current: BarCouncilEnforcement = 'ALLOW';
  for (const rule of rules) {
    if (ENFORCEMENT_ORDER[rule.enforcement] > ENFORCEMENT_ORDER[current]) {
      current = rule.enforcement;
    }
  }
  return current;
}

export class JrxGuardrailsService {
  async evaluate(input: BarCouncilEvaluationInput): Promise<BarCouncilEvaluationResult> {
    const jurisdiction = toJcnJurisdiction(input.jurisdiction);
    const rules = await loadRules(jurisdiction);
    const effectiveRules = rules.length > 0
      ? rules
      : BUILT_IN_GATE8_RULES.filter(r => r.jurisdiction === jurisdiction);
    if (effectiveRules.length === 0) {
      return {
        jurisdiction,
        enforcement: 'ALLOW',
        matchedRules: [],
        warnings: [],
        reason: null,
      };
    }

    const matchedRules = effectiveRules.filter(rule => ruleTriggered(rule, input));
    let enforcement = highestEnforcement(matchedRules);
    const warnings = matchedRules.map(rule => `${rule.ruleId}: ${rule.ruleText}`);

    // Soft policy (NSP/NYM): never BLOCK — keep WARN so callers get full AI content.
    if (isSoftPolicyActive() && (enforcement === 'BLOCK' || enforcement === 'HITL' || enforcement === 'MANDATORY_HITL')) {
      enforcement = 'WARN';
      warnings.push('SOFT_POLICY: Gate-8 BLOCK/HITL downgraded to WARN for integration testing');
    }

    if (enforcement !== 'ALLOW') {
      logger.warn('[JRX Guardrails] Gate 8 enforcement triggered', {
        requestId: input.requestId,
        agentId: input.agentId,
        jurisdiction,
        enforcement,
        matchedRules: matchedRules.map(rule => rule.ruleId),
      });
    }

    return {
      jurisdiction,
      enforcement,
      matchedRules,
      warnings,
      reason: warnings[0] || null,
    };
  }
}

export const jrxGuardrailsService = new JrxGuardrailsService();
