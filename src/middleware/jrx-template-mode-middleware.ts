/**
 * Jurexio Enterprise Platform 3.1.2 — Template Mode Enforcement Middleware
 * NYV-MW-TEMPLATEMODE-001
 *
 * Handover §3.3.2 — Template control modes:
 *   STRICT  (default — all tiers): AI CANNOT restructure template. Fill only designated fields.
 *   GUIDED  (Pro+ only): AI may suggest structural alternatives marked [SUGGESTED CHANGE].
 *   MENTOR  (all tiers): AI explains changes but does NOT apply them.
 *
 * This middleware:
 * 1. Reads template_mode from request body (default: STRICT)
 * 2. Validates tier eligibility for GUIDED mode
 * 3. Builds and returns the template mode system prompt clause to inject
 * 4. Validates AI outputs for STRICT mode violations
 */

import { Request, Response, NextFunction } from 'express';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('./jrx-template-mode');

// ─────────────────────────────────────────
// Types
// ─────────────────────────────────────────

export type TemplateMode = 'STRICT' | 'GUIDED' | 'MENTOR';

const GUIDED_ELIGIBLE_TIERS = ['pro', 'elite', 'enterprise', 'government'];

// ─────────────────────────────────────────
// System Prompt Clauses per Mode
// ─────────────────────────────────────────

const TEMPLATE_MODE_PROMPTS: Record<TemplateMode, string> = {
  STRICT: `
TEMPLATE MODE: STRICT (MANDATORY — NON-NEGOTIABLE)
You are operating in STRICT template mode. You MUST follow ALL of these rules:
1. DO NOT restructure, reorder, rename, or remove any section of the provided template.
2. Fill ONLY the designated blank fields within the template.
3. If a field cannot be filled with the available information, leave it blank or write [TO BE PROVIDED].
4. DO NOT add new sections, clauses, or headings not present in the template.
5. DO NOT suggest alternative structures — this is strictly prohibited in STRICT mode.
6. Any output that modifies the template structure will be flagged as a structural deviation (risk score increase).
Compliance: Output must be structurally identical to the template with blanks filled in.
`.trim(),

  GUIDED: `
TEMPLATE MODE: GUIDED
You may suggest structural improvements, but MUST follow these rules:
1. Always mark suggested structural changes with [SUGGESTED CHANGE: <explanation>].
2. Present alternatives as options, not fait accompli — never silently apply structural changes.
3. Fill designated fields as in STRICT mode.
4. Clearly separate "filled template" from "structural suggestions" in your output.
5. The lawyer MUST confirm before any structural suggestion is applied.
`.trim(),

  MENTOR: `
TEMPLATE MODE: MENTOR
You are in educational MENTOR mode. Follow these rules:
1. Fill the template fields as requested.
2. After the filled template, add a "MENTOR NOTES" section.
3. In MENTOR NOTES, explain what structural improvements you would suggest and WHY — do not apply them.
4. Be educational: cite the relevant legal principle or best practice that supports each suggestion.
5. Never modify the template structure itself — the lawyer learns from your suggestions.
`.trim(),
};

// ─────────────────────────────────────────
// Middleware
// ─────────────────────────────────────────

/**
 * Attaches templateMode to req.templateMode.
 * Validates tier eligibility for GUIDED mode.
 * Defaults to STRICT for all tiers.
 */
export function templateModeMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const requestedMode: string =
    ((req.body?.template_mode as string) || 'STRICT').toUpperCase();
  const user = req.user;
  const userTier: string = user?.subscriptionTier || user?.tier || 'alpha';

  let resolvedMode: TemplateMode = 'STRICT';

  if (requestedMode === 'GUIDED') {
    if (GUIDED_ELIGIBLE_TIERS.includes(userTier.toLowerCase())) {
      resolvedMode = 'GUIDED';
    } else {
      // Silently downgrade to STRICT — per handover spec STRICT is default
      logger.warn('GUIDED mode requested by ineligible tier — downgrading to STRICT', {
        userTier, requestedMode,
      });
      resolvedMode = 'STRICT';
    }
  } else if (requestedMode === 'MENTOR') {
    resolvedMode = 'MENTOR'; // Available to all tiers
  }

  req.templateMode = resolvedMode;
  logger.debug('Template mode resolved', { resolvedMode, userTier });
  next();
}

/**
 * Returns the system prompt clause to inject for the given template mode.
 */
export function getTemplateModePromptClause(mode: TemplateMode): string {
  return TEMPLATE_MODE_PROMPTS[mode] || TEMPLATE_MODE_PROMPTS['STRICT'];
}

/**
 * Validates an AI output for STRICT mode violations.
 * Returns list of violations found (empty if clean).
 */
export function validateStrictModeOutput(output: string): string[] {
  if (!output) return [];
  const violations: string[] = [];
  const strictViolationPatterns: Array<{ pattern: RegExp; label: string }> = [
    { pattern: /\[SUGGESTED CHANGE\]/gi, label: 'Contains structural suggestions (STRICT mode prohibits)' },
    { pattern: /I would restructure/gi, label: 'AI attempted restructuring (STRICT mode prohibits)' },
    { pattern: /alternatively, the structure could/gi, label: 'Alternative structure proposed (STRICT mode prohibits)' },
    { pattern: /I have reorganized/gi, label: 'AI reorganized template (STRICT mode prohibits)' },
    { pattern: /I have added a new section/gi, label: 'AI added new section (STRICT mode prohibits)' },
    { pattern: /you may want to add/gi, label: 'AI suggested additions (STRICT mode prohibits suggestions)' },
  ];
  for (const { pattern, label } of strictViolationPatterns) {
    if (pattern.test(output)) violations.push(label);
  }
  return violations;
}
