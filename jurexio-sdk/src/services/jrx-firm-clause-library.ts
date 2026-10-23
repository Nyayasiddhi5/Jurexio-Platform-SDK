/**
 * NV-FIRM-CLAUSE-DRAFT-001 — firm clause library → drafting prompt.
 *
 * ── What the clause library actually is on the JRX side ─────────────────────
 * There is no org-scoped firm clause library table in this repository. The
 * audited state (2026-08-19):
 *   • `sdk_clause_library`   — 15 seeded rows, NO `org_id` column, `is_system`
 *                              flag. A platform-curated catalogue, not a firm's
 *                              negotiated positions. Read unfiltered by
 *                              sdk-document-pipeline-service (correctly — it is
 *                              global reference data).
 *   • `nv_template_clauses`  — FK to `nv_legal_templates`, no `org_id`.
 *   • `ns_clause_library`    — does not exist anywhere in this tree. It is the
 *                              PARTNER (NSP) table, and it is the one that is
 *                              org-scoped and seeded.
 * So the firm's own wording lives at NSP, not here. This module is therefore
 * a RECEIVING CONTRACT plus an injection layer, not a wrapper over a local
 * table we do not have. Two sources are supported, both tenant-bound:
 *   A. caller-supplied (`parameters._firmClauseLibrary`) — the NSP path;
 *   B. `nv_organizations.settings->'clauseLibrary'` — the JRX-native path,
 *      an existing org-scoped row, so no new table and no migration.
 *
 * ── Why tenant identity travels WITH each clause ────────────────────────────
 * The partner fixed FB-190 ("clause library readable cross-tenant and
 * injectable into other firms' AI prompts") in this exact data. A single
 * scoping layer demonstrably failed there, so this module keeps two:
 *   1. the read is issued on the `TenantTx` handle (RLS GUC pinned to the
 *      request's org) AND carries an explicit `WHERE id::text = <orgId>`;
 *   2. every clause carries the org id of the ROW IT CAME FROM, and
 *      `selectFirmClauses` drops any clause whose org id is not the request's.
 * Layer 2 is deliberately not fed from the request — stamping the requested
 * org onto whatever the query returned would make the check vacuous and
 * re-open FB-190. If layer 1's filter is ever dropped, layer 2 still holds.
 */

import { AsyncLocalStorage } from 'async_hooks';
import { sql } from 'drizzle-orm';
import type { NextFunction, Request, Response } from 'express';
import type { TenantTx } from '../middleware/jrx-org-rls-middleware.js';
import type { LegalDraftDocFamily } from './jrx-legal-drafting-prompt.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('./jrx-firm-clause-library');

export interface FirmClause {
  /** Org that owns this wording. Sourced from the row/payload, never from the request. */
  orgId: string;
  clauseType: string;
  title: string;
  /** The firm's house wording for this clause. */
  text: string;
  /** Instrument / template slugs this clause is written for. Empty = firm-wide default. */
  documentTypes?: string[];
  practiceAreas?: string[];
  jurisdiction?: string;
  /** Higher wins when the cap forces a choice. */
  priority?: number;
}

/**
 * A firm clause library is a set of negotiated COMMERCIAL positions. Putting an
 * indemnity carve-out into a bail application or an SLP paper-book is not
 * "firm voice", it is a drafting defect that a registry would reject, so the
 * gate is an allow-list of transactional instruments rather than a deny-list.
 * `notice` and `letter` are in because demand notices and pre-contractual
 * correspondence do carry house wording (reservation of rights, cure periods).
 */
export const FIRM_CLAUSE_ELIGIBLE_FAMILIES: ReadonlySet<LegalDraftDocFamily> = new Set<LegalDraftDocFamily>([
  /* `agreement` used to be listed here and was a DEAD entry —
   * `inferDraftDocFamily` never returned it. NV-FIRM-CLAUSE-ORCH-001 removed the
   * family rather than making it reachable: it emitted the same skeleton as
   * `contract`, so it was a synonym, and every agreement-shaped slug now infers
   * `contract`. See the note on `LegalDraftDocFamily`. */
  'contract',
  'notice',
  'letter',
]);

/**
 * Explicit caps. The drafting task class allows 24,000 prompt tokens, but a
 * concurrent change already blew the 600-token `micro_faq` ceiling by 13 tokens
 * and had to be compressed rather than given more room, so this block is capped
 * at source instead of relying on headroom.
 *
 * `maxCharsPerClause` is the length of the text that reaches the prompt,
 * truncation marker INCLUDED — the first cut of this counted the marker outside
 * the cap, which made `maxClauses` unreachable (4 x 604 > 2,400, so only three
 * clauses ever injected) and turned the advertised clause cap into a fiction.
 */
export const FIRM_CLAUSE_CAPS = {
  maxClauses: 4,
  maxCharsPerClause: 600,
  maxTotalChars: 2_400,
} as const;

export type FirmClauseCaps = {
  maxClauses: number;
  maxCharsPerClause: number;
  maxTotalChars: number;
};

/**
 * Caps for the interactive drafting roles (`legal-draft-fast`, `doc-draft-fast`,
 * a Queen exploration leaf) — NV-FIRM-CLAUSE-ORCH-001.
 *
 * Measured, not guessed. The `full` legal-intelligence overlay for a drafting
 * instruction is 2,100 prompt tokens and the `compact` tier is 1,093; the
 * tightest ceiling a drafting prompt can legitimately land in is the `chat`
 * tier's 2,500 (`jrx-prompt-budget.ts`, where a Queen exploration leaf is
 * clamped). 4 x 600 chars costs ~873 tokens, which does not fit next to the
 * compact overlay with room for retrieval. 2 x 400 costs ~456.
 *
 * The reduction is entirely in the PAYLOAD, never in `FIRM_CLAUSE_PRECEDENCE`.
 * The precedence paragraph is the part that keeps house wording below statute
 * and below a Court-prescribed form; shortening it to buy tokens on the fast
 * path would trade a legal correctness guarantee for latency, which is the one
 * trade this module may not make. Fewer, shorter clauses is a smaller loss than
 * a weaker ranking instruction.
 */
export const FIRM_CLAUSE_CAPS_FAST: FirmClauseCaps = {
  maxClauses: 2,
  maxCharsPerClause: 400,
  maxTotalChars: 800,
};

const TRUNCATION_MARKER = ' […]';

export function firmClausesApplyTo(family: LegalDraftDocFamily): boolean {
  return FIRM_CLAUSE_ELIGIBLE_FAMILIES.has(family);
}

function str(v: unknown): string {
  return v == null ? '' : String(v).trim();
}

function strArray(v: unknown): string[] {
  if (Array.isArray(v)) return v.map((x) => str(x).toLowerCase()).filter(Boolean);
  const s = str(v);
  if (!s) return [];
  return s
    .split(/[,;|]/)
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * Coerce one untrusted entry into a FirmClause. Returns null when the entry
 * carries no usable wording or no owning org — an unattributed clause cannot be
 * tenant-checked, so it is discarded rather than defaulted to the caller.
 */
export function toFirmClause(raw: unknown): FirmClause | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const orgId = str(r.orgId ?? r.org_id ?? r.tenantId ?? r.tenant_id);
  const text = str(r.text ?? r.clauseText ?? r.clause_text ?? r.defaultText ?? r.default_text ?? r.body);
  if (!orgId || !text) return null;
  const clauseType = str(r.clauseType ?? r.clause_type ?? r.category ?? r.type) || 'general';
  const title = str(r.title ?? r.clauseName ?? r.clause_name ?? r.name) || clauseType;
  const priorityRaw = Number(r.priority ?? r.popularity ?? 0);
  return {
    orgId,
    clauseType,
    title,
    text,
    documentTypes: strArray(r.documentTypes ?? r.document_types ?? r.documentType ?? r.document_type ?? r.templates),
    practiceAreas: strArray(r.practiceAreas ?? r.practice_areas ?? r.practiceArea ?? r.practice_area),
    jurisdiction: str(r.jurisdiction).toUpperCase() || undefined,
    priority: Number.isFinite(priorityRaw) ? priorityRaw : 0,
  };
}

export function toFirmClauses(raw: unknown): FirmClause[] {
  const list = Array.isArray(raw)
    ? raw
    : raw && typeof raw === 'object' && Array.isArray((raw as { clauses?: unknown[] }).clauses)
      ? (raw as { clauses: unknown[] }).clauses
      : [];
  return list.map(toFirmClause).filter((c): c is FirmClause => c !== null);
}

function truncateClauseText(text: string, caps: FirmClauseCaps): string {
  const collapsed = text.replace(/\s+/g, ' ').trim();
  if (collapsed.length <= caps.maxCharsPerClause) return collapsed;
  const room = caps.maxCharsPerClause - TRUNCATION_MARKER.length;
  const cut = collapsed.slice(0, room);
  const lastSpace = cut.lastIndexOf(' ');
  const body = lastSpace > room * 0.6 ? cut.slice(0, lastSpace) : cut;
  return `${body.trimEnd()}${TRUNCATION_MARKER}`;
}

export interface SelectFirmClausesInput {
  clauses: FirmClause[];
  /** The RLS-bound org of the current request. The only org whose wording may be injected. */
  orgId: string;
  family: LegalDraftDocFamily;
  documentType?: string;
  template?: string;
  practiceArea?: string;
  jurisdiction?: string;
  /** Defaults to the gateway caps. Fast interactive roles pass `FIRM_CLAUSE_CAPS_FAST`. */
  caps?: FirmClauseCaps;
}

export interface SelectFirmClausesResult {
  selected: FirmClause[];
  /** Clauses discarded because they belong to another org. Non-zero means a scoping bug upstream. */
  crossTenantDropped: number;
}

/**
 * Deterministic selection — no embeddings. `sdk_clause_library` has no
 * embedding column and neither does the NSP payload contract, so semantic
 * ranking would have to be invented; instrument/practice/jurisdiction matching
 * is the boring approach that works and is testable without a model.
 */
export function selectFirmClauses(input: SelectFirmClausesInput): SelectFirmClausesResult {
  const caps = input.caps ?? FIRM_CLAUSE_CAPS;
  const requestOrg = str(input.orgId);
  if (!requestOrg || !firmClausesApplyTo(input.family)) {
    return { selected: [], crossTenantDropped: 0 };
  }

  let crossTenantDropped = 0;
  const ownedByThisOrg = input.clauses.filter((c) => {
    if (str(c.orgId) === requestOrg) return true;
    crossTenantDropped += 1;
    return false;
  });

  const jur = str(input.jurisdiction).toUpperCase();
  const haystack = `${str(input.documentType)} ${str(input.template)} ${input.family}`.toLowerCase();
  const practice = str(input.practiceArea).toLowerCase();

  const scored: Array<{ clause: FirmClause; score: number }> = [];
  for (const clause of ownedByThisOrg) {
    if (clause.jurisdiction && jur && clause.jurisdiction !== jur) continue;

    const docTypes = clause.documentTypes ?? [];
    const practices = clause.practiceAreas ?? [];
    const docMatch = docTypes.some((d) => haystack.includes(d));
    const practiceMatch = practices.length > 0 && practice ? practices.includes(practice) : false;

    // A clause that names instruments it belongs to and matches none of them is
    // out — that targeting is the firm telling us where the wording applies.
    if (docTypes.length > 0 && !docMatch && !practiceMatch) continue;
    if (practices.length > 0 && practice && !practiceMatch && !docMatch) continue;

    let score = 0;
    if (docMatch) score += 4;
    if (practiceMatch) score += 3;
    if (clause.jurisdiction && clause.jurisdiction === jur) score += 1;
    if (docTypes.length === 0 && practices.length === 0) score += 1; // firm-wide default
    score += Math.max(0, Math.min(2, (clause.priority ?? 0) / 50));
    scored.push({ clause, score });
  }

  scored.sort((a, b) => (b.score - a.score) || a.clause.title.localeCompare(b.clause.title));

  const selected: FirmClause[] = [];
  let totalChars = 0;
  for (const { clause } of scored) {
    if (selected.length >= caps.maxClauses) break;
    const text = truncateClauseText(clause.text, caps);
    if (totalChars + text.length > caps.maxTotalChars) continue;
    totalChars += text.length;
    selected.push({ ...clause, text });
  }

  return { selected, crossTenantDropped };
}

/**
 * The precedence paragraph is the legally load-bearing part of this feature.
 * A house clause is a commercial preference; it is not a licence to depart from
 * a statutory form, a Court-mandated paper-book, or the anti-fabrication rule.
 * Stating the ranking inside the block (rather than relying on block order)
 * means the model cannot read "the firm always uses this wording" as authority.
 *
 * Compressed deliberately: the first draft measured 283 tokens of fixed cost
 * for a block whose payload caps at ~600. Every clause below carries a distinct
 * instruction — the ranking, the departure record, the adaptation licence, the
 * do-not-insert rule, the Court-filing bar, and the no-authority statement —
 * so this was shortened by removing restatement, not by dropping a rule.
 */
export const FIRM_CLAUSE_PRECEDENCE = `FIRM CLAUSE LIBRARY — house wording. A PREFERENCE ONLY, ranked BELOW everything above it.
PRECEDENCE (highest first; on any conflict the higher wins): (1) statute, subordinate legislation, binding precedent; (2) the mandatory form / scope rules stated above and any Court-prescribed form; (3) the anti-fabrication rule — never invent citations, parties, section numbers, dates or figures, use [SQUARE BRACKETS]; (4) the facts supplied for this matter; (5) the firm's wording below.
Where 1–4 require a departure from the house wording, depart and note it in one line under a non-operative "Counsel notes" appendix.
Adopt the house wording only where the clause belongs in this instrument, adapting defined terms, party names, cross-references and figures. Do not insert a clause the instrument does not need, and never carry negotiated commercial positions into a Court filing.
These are the firm's own negotiated positions — not statutory text. Never cite them as law or precedent.`;

export function formatFirmClauseOverlay(clauses: FirmClause[]): string {
  if (!clauses.length) return '';
  const body = clauses
    .map((c, i) => `${i + 1}. [${c.clauseType}] ${c.title}\n"${c.text}"`)
    .join('\n');
  return `${FIRM_CLAUSE_PRECEDENCE}\n\nFIRM PREFERRED CLAUSES (${clauses.length}):\n${body}`;
}

/**
 * Tenant-scoped read of the JRX-native source.
 *
 * MUST be given the `TenantTx` handle from `withTenantTx` / `req.withTenant`.
 * A zero-argument `withTenant(async () => …)` callback would leave this read on
 * the global pool with no `app.current_org_id` bound, which is how a scoped
 * read silently becomes an unscoped one.
 *
 * `id::text` rather than a numeric cast of the input: `req.orgId` is a string
 * that is legitimately non-numeric in some deployments ('default'), and casting
 * the column keeps a non-numeric org from raising instead of returning nothing.
 * The selected `org_id` is returned so the caller can verify what it received
 * rather than assume it.
 */
export async function loadOrgFirmClauses(orgId: string, tx: TenantTx): Promise<FirmClause[]> {
  const result = (await tx.execute(sql`
    SELECT id::text AS org_id, settings -> 'clauseLibrary' AS clause_library
    FROM nv_organizations
    WHERE id::text = ${String(orgId)}
    LIMIT 1
  `)) as { rows?: Array<Record<string, unknown>> };
  const rows = result?.rows ?? [];
  const out: FirmClause[] = [];
  for (const row of rows) {
    const rowOrg = str(row.org_id);
    for (const clause of toFirmClauses(row.clause_library)) {
      // Identity comes from the row, not the request — see the header note.
      out.push({ ...clause, orgId: clause.orgId || rowOrg });
    }
  }
  return out;
}

/* ── Request context (NV-FIRM-CLAUSE-ORCH-001) ──────────────────────────────
 *
 * Defect this closes: `resolveFirmClauseOverlay` had exactly ONE call site,
 * `POST /api/jrx/gateway/documents/draft` — the path §3.4 of the endpoints doc
 * tells partners NOT to use for interactive AI because it hardcodes
 * `enableCoT: true` and so cannot meet the 90 s `*-fast` SLA. Firm wording and
 * interactive drafting were therefore mutually exclusive.
 *
 * Why AsyncLocalStorage and not another parameter. The drafting system prompt is
 * composed by `buildLegalDraftSystemPrompt`, which every orchestrate drafting
 * branch reaches — directly, or through `buildUniversalLegalIntelligenceOverlay`
 * on the `draft` task kind. That composer is SYNC and has no request context, and
 * the four branches that reach it sit in three different files, two of which are
 * owned by concurrent lanes. Threading an argument would mean editing each
 * branch — exactly the branch-by-branch fix that was reported complete twice
 * while three of four paths still saw nothing. One request-scoped store read at
 * the single composer covers every branch, present and future, by construction.
 *
 * The tenant guarantees are NOT weakened: the store carries the org that
 * `orgRlsMiddleware` bound, the stored clauses are still read through
 * `req.withTenant` (RLS GUC pinned) with the explicit `WHERE id::text = <orgId>`,
 * and `selectFirmClauses` still drops any clause whose own org id is not the
 * request's. Both FB-190 layers stay intact — the store only moves WHERE the
 * already-scoped result is read from, never how it is scoped.
 */

export interface FirmClauseRequestContext {
  /** The org `orgRlsMiddleware` bound for this request. '' when unresolvable. */
  orgId: string;
  /** Clauses the caller supplied on this request (the NSP path). Untrusted. */
  suppliedClauses: FirmClause[];
  /** How many the caller supplied, before any filtering — for the diagnostic count. */
  suppliedCount: number;
  /** Org-scoped clauses already read through the tenant transaction, if any. */
  storedClauses: FirmClause[];
  /** Caps for this request's role. Fast interactive roles get the tighter set. */
  caps: FirmClauseCaps;
  /** Set by the composer when clauses were supplied and none could be applied. */
  diagnostic?: FirmClauseDiagnostic;
}

const firmClauseStore = new AsyncLocalStorage<FirmClauseRequestContext>();

/**
 * Org values that mean "no partner tenant was established".
 *
 * `orgRlsMiddleware` falls back to the literal `'default'` in production (and
 * `'1'` in dev) when neither the JWT nor `sdkContext` nor `X-Org-Id` supplies
 * one. Probed on the real chain: no header ⇒ `default`, header ⇒ `4001`. Since
 * `sdkGatewayAuth` runs AFTER the app-level RLS mount, an API key alone never
 * supplies the org — so `default` on a request that supplied clauses is the
 * missing-header case, and reporting it as merely "cross-tenant" would send the
 * partner looking at their clause data instead of their headers.
 */
const PLACEHOLDER_ORG_IDS: ReadonlySet<string> = new Set(['default']);

function isPartnerOrgResolved(orgId: string): boolean {
  return !!orgId && !PLACEHOLDER_ORG_IDS.has(orgId.toLowerCase());
}

export function getFirmClauseRequestContext(): FirmClauseRequestContext | undefined {
  return firmClauseStore.getStore();
}

export function runWithFirmClauseContext<T>(ctx: FirmClauseRequestContext, fn: () => T): T {
  return firmClauseStore.run(ctx, fn);
}

/**
 * The `*-fast` task types are the interactive ones §3.4 documents a 90 s SLA
 * for, and `jrx-prompt-budget` clamps a Queen exploration leaf on them to the
 * `chat` tier (2,500 prompt tokens). They get the reduced payload.
 */
const FAST_TASK_TYPE_RE = /(^|[-_])fast($|[-_])/i;

export function firmClauseCapsForTaskType(taskType?: string | null): FirmClauseCaps {
  return FAST_TASK_TYPE_RE.test(String(taskType || '')) ? FIRM_CLAUSE_CAPS_FAST : FIRM_CLAUSE_CAPS;
}

/**
 * Does this request plausibly want firm wording? Gates the one extra
 * `nv_organizations` read so non-drafting `/api/jrx/*` traffic does not pay for
 * it. Deliberately generous — a false positive costs one indexed primary-key
 * read on a request that is already going to call an LLM, while a false
 * negative is the defect this whole change exists to fix.
 */
const DRAFTISH_RE =
  /\b(draft|drafting|redraft|prepare|agreement|contract|nda|mou|msa|sla|notice|letter|clause|engagement)\b/i;

/** Deadline for the one stored-library read. See `firmClauseRequestContext`. */
export const FIRM_CLAUSE_PREREAD_TIMEOUT_MS = 400;

export function looksLikeFirmClauseCandidate(body: unknown): boolean {
  if (!body || typeof body !== 'object') return false;
  const b = body as Record<string, unknown>;
  const params = (b.parameters && typeof b.parameters === 'object' ? b.parameters : {}) as Record<string, unknown>;
  if (b._firmClauseLibrary != null || params._firmClauseLibrary != null || params.firmClauseLibrary != null) {
    return true;
  }
  const blob = [b.taskType, b.template, b.documentType, b.prompt, b.instruction, params.template, params.documentType]
    .filter((v) => typeof v === 'string')
    .join(' ');
  return DRAFTISH_RE.test(blob);
}

/**
 * Express middleware. Binds the firm-clause context for the whole request so the
 * drafting composer can read it on any branch.
 *
 * MUST be mounted AFTER `orgRlsMiddleware` — it reads `req.orgId` and
 * `req.withTenant`, which that middleware installs. Mounted before it, the org
 * is undefined and every clause is correctly dropped as cross-tenant, which is
 * the silent-200 failure mode this change also makes observable.
 */
export function firmClauseRequestContext(req: Request, _res: Response, next: NextFunction): void {
  try {
    const body = (req as { body?: unknown }).body;
    if (!looksLikeFirmClauseCandidate(body)) {
      next();
      return;
    }
    const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
    const params = (b.parameters && typeof b.parameters === 'object' ? b.parameters : {}) as Record<string, unknown>;
    const rawSupplied = b._firmClauseLibrary ?? params._firmClauseLibrary ?? params.firmClauseLibrary;
    const suppliedClauses = toFirmClauses(rawSupplied);
    const suppliedCount = countSuppliedClauseEntries(rawSupplied);
    const orgId = str((req as { orgId?: string }).orgId);
    const caps = firmClauseCapsForTaskType(typeof b.taskType === 'string' ? b.taskType : undefined);
    const ctx: FirmClauseRequestContext = {
      orgId,
      suppliedClauses,
      suppliedCount,
      storedClauses: [],
      caps,
    };
    (req as { nvFirmClauseContext?: FirmClauseRequestContext }).nvFirmClauseContext = ctx;

    const withTenant = (req as { withTenant?: <T>(fn: (tx: TenantTx) => Promise<T>) => Promise<T> }).withTenant;
    // Only the stored source needs a read, and only when the caller supplied
    // nothing — a supplied library is the firm telling us what to use here.
    if (!orgId || suppliedClauses.length > 0 || typeof withTenant !== 'function') {
      firmClauseStore.run(ctx, () => next());
      return;
    }
    /* Deadline, not best-effort. This read sits in front of every draftish
     * request, including the `*-fast` task types whose whole contract is a 90 s
     * SLA — an unreachable or slow `nv_organizations` must cost the draft
     * milliseconds, not the SLA. On timeout the request proceeds with no house
     * wording, which is exactly today's behaviour. `next` is guarded so a late
     * resolution after the deadline cannot invoke it twice. */
    let proceeded = false;
    const proceed = () => {
      if (proceeded) return;
      proceeded = true;
      firmClauseStore.run(ctx, () => next());
    };
    const timer = setTimeout(proceed, FIRM_CLAUSE_PREREAD_TIMEOUT_MS);
    // Not `.unref()`d deliberately: a pending timer here means a request is
    // still in flight, and letting the process exit under it would abandon it.
    void withTenant((tx) => loadOrgFirmClauses(orgId, tx))
      .then((stored) => {
        if (!proceeded) ctx.storedClauses = stored;
      })
      .catch((err: unknown) => {
        logger.debug('[firm-clause] stored clause pre-read failed; drafting proceeds without house wording', {
          orgId,
          error: err instanceof Error ? err.message : String(err),
        });
      })
      .finally(() => {
        clearTimeout(timer);
        proceed();
      });
  } catch (err) {
    logger.debug('[firm-clause] request context binding failed; drafting proceeds unchanged', {
      error: err instanceof Error ? err.message : String(err),
    });
    next();
  }
}

/** Entries the caller sent, including ones too malformed to coerce. */
function countSuppliedClauseEntries(raw: unknown): number {
  if (Array.isArray(raw)) return raw.length;
  if (raw && typeof raw === 'object' && Array.isArray((raw as { clauses?: unknown[] }).clauses)) {
    return (raw as { clauses: unknown[] }).clauses.length;
  }
  return 0;
}

export interface SyncFirmClauseOverlayInput {
  family: LegalDraftDocFamily;
  documentType?: string;
  template?: string;
  practiceArea?: string;
  jurisdiction?: string;
}

/**
 * Render the overlay for the current request, synchronously, from the context
 * the middleware bound. Returns '' when there is no context, no clause, or the
 * family is ineligible — so a drafting prompt composed outside a request (every
 * unit test, every cron job) is byte-for-byte what it is today.
 *
 * The DB read already happened in the middleware; this function performs no I/O,
 * which is what lets the sync composer call it.
 */
export function resolveFirmClauseOverlaySync(input: SyncFirmClauseOverlayInput): string {
  const ctx = firmClauseStore.getStore();
  if (!ctx) return '';
  try {
    if (!ctx.orgId) {
      if (ctx.suppliedCount > 0 && !ctx.diagnostic) {
        ctx.diagnostic = buildFirmClauseDiagnostic(ctx.suppliedCount, 'org_unresolved');
        logger.warn('[firm-clause] NV-FIRM-CLAUSE-DIAG-001 clauses supplied but the org could not be resolved', {
          supplied: ctx.suppliedCount,
          applied: 0,
          reason: 'org_unresolved',
        });
      }
      return '';
    }
    if (!firmClausesApplyTo(input.family)) {
      // Not a diagnostic: a partner asking for a bail application has not made a
      // mistake, and the family gate refusing commercial wording there is the
      // feature working. Recording it as "unapplied" would train them to expect
      // house clauses in a Court filing.
      return '';
    }
    const clauses = [...ctx.suppliedClauses, ...ctx.storedClauses];
    if (!clauses.length) return '';

    const { selected, crossTenantDropped } = selectFirmClauses({
      clauses,
      orgId: ctx.orgId,
      family: input.family,
      documentType: input.documentType,
      template: input.template,
      practiceArea: input.practiceArea,
      jurisdiction: input.jurisdiction,
      caps: ctx.caps,
    });
    if (crossTenantDropped > 0) {
      logger.warn('[firm-clause] NV-FIRM-CLAUSE-TENANT-001 dropped clauses owned by another org', {
        orgId: ctx.orgId,
        crossTenantDropped,
      });
    }
    if (!selected.length) {
      if (ctx.suppliedCount > 0 && !ctx.diagnostic) {
        const reason: FirmClauseUnappliedReason = !isPartnerOrgResolved(ctx.orgId)
          ? 'org_unresolved'
          : crossTenantDropped >= ctx.suppliedClauses.length && crossTenantDropped > 0
            ? 'cross_tenant'
            : 'no_match';
        ctx.diagnostic = buildFirmClauseDiagnostic(ctx.suppliedCount, reason);
        logger.warn('[firm-clause] NV-FIRM-CLAUSE-DIAG-001 supplied clauses were not applied', {
          orgId: ctx.orgId,
          supplied: ctx.suppliedCount,
          applied: 0,
          reason,
          family: input.family,
        });
      }
      return '';
    }
    ctx.diagnostic = undefined;
    return formatFirmClauseOverlay(selected);
  } catch (err) {
    logger.debug('[firm-clause] sync overlay resolution failed; drafting proceeds unchanged', {
      error: err instanceof Error ? err.message : String(err),
    });
    return '';
  }
}

/**
 * The non-fatal signal for the response envelope. Read by the route after the
 * draft is produced — a draft is ALWAYS produced, per NV-FIRM-CLAUSE-DRAFT-001's
 * fail-soft rule; this only tells the caller their wording did not land.
 */
export function getFirmClauseDiagnostic(): FirmClauseDiagnostic | undefined {
  return firmClauseStore.getStore()?.diagnostic;
}

export interface ResolveFirmClauseOverlayInput {
  orgId?: string;
  family: LegalDraftDocFamily;
  documentType?: string;
  template?: string;
  practiceArea?: string;
  jurisdiction?: string;
  /** Caller-supplied clauses (the NSP path). Untrusted: tenant-checked like any other source. */
  requestClauses?: unknown;
  /** `req.withTenant`. Omitted when the caller has no tenant binding — then only the request path runs. */
  withTenant?: <T>(fn: (tx: TenantTx) => Promise<T>) => Promise<T>;
  /** Interactive `*-fast` roles pass `FIRM_CLAUSE_CAPS_FAST`; the gateway leaves it unset. */
  caps?: FirmClauseCaps;
}

/**
 * Why clauses were supplied and not applied. NV-FIRM-CLAUSE-DIAG-001.
 *
 * `org_unresolved` is the case a partner cannot debug from outside: `X-Org-Id`
 * is mandatory in practice (see §4a of the endpoints doc) because
 * `orgRlsMiddleware` binds the tenant BEFORE `sdkGatewayAuth` resolves
 * `sdkContext`, so the API key cannot supply the org. Omit the header and every
 * clause is dropped as cross-tenant while the draft still returns 200.
 */
export type FirmClauseUnappliedReason =
  | 'org_unresolved'
  | 'cross_tenant'
  | 'family_ineligible'
  | 'no_match';

export interface FirmClauseDiagnostic {
  /** How many clauses the caller supplied in the request payload. */
  supplied: number;
  applied: number;
  reason: FirmClauseUnappliedReason;
  /** Caller-safe sentence. Never contains clause text or another org's identifier. */
  message: string;
}

export interface ResolveFirmClauseOverlayResult {
  overlay: string;
  /** Present only when clauses were supplied and NONE were applied. */
  diagnostic?: FirmClauseDiagnostic;
}

const UNAPPLIED_REASON_TEXT: Record<FirmClauseUnappliedReason, string> = {
  /* Deliberately names the header and the mechanism: the whole point of this
   * signal is that the 200-with-generic-wording response was undebuggable. */
  org_unresolved:
    'the organisation for this request could not be resolved, so every clause was treated as cross-tenant — send the X-Org-Id header (the API key does not supply the org on this chain)',
  cross_tenant:
    'none of the supplied clauses carried the organisation id of this request; clauses are only applied to the firm that owns them',
  family_ineligible:
    'the inferred document family is not one the firm clause library applies to (transactional instruments only — never a Court filing)',
  no_match:
    'the supplied clauses were all targeted at a different instrument, practice area or jurisdiction than this draft',
};

/** Caller-safe diagnostic. Counts only — never clause content, never another org's id. */
function buildFirmClauseDiagnostic(
  supplied: number,
  reason: FirmClauseUnappliedReason,
): FirmClauseDiagnostic {
  return {
    supplied,
    applied: 0,
    reason,
    message: `0 of ${supplied} supplied clauses applied: ${UNAPPLIED_REASON_TEXT[reason]}.`,
  };
}

/**
 * Fail-soft: returns '' on any error. A firm-voice preference must never be
 * able to stop a draft from being produced, so every failure degrades to
 * today's behaviour (generic wording) rather than surfacing.
 */
export async function resolveFirmClauseOverlay(input: ResolveFirmClauseOverlayInput): Promise<string> {
  return (await resolveFirmClauseOverlayDetailed(input)).overlay;
}

/**
 * The overlay plus the "supplied but not applied" signal.
 *
 * Split from `resolveFirmClauseOverlay` rather than replacing it: the gateway
 * route and the orchestrate lane both want the diagnostic, but every existing
 * caller and test wants a plain string, and changing a fail-soft function's
 * return type is how a fail-soft path stops being fail-soft.
 */
export async function resolveFirmClauseOverlayDetailed(
  input: ResolveFirmClauseOverlayInput,
): Promise<ResolveFirmClauseOverlayResult> {
  let suppliedCount = 0;
  try {
    const orgId = str(input.orgId);
    const supplied = toFirmClauses(input.requestClauses);
    suppliedCount = supplied.length;

    if (!orgId) {
      return suppliedCount > 0
        ? { overlay: '', diagnostic: buildFirmClauseDiagnostic(suppliedCount, 'org_unresolved') }
        : { overlay: '' };
    }
    if (!firmClausesApplyTo(input.family)) {
      return suppliedCount > 0
        ? { overlay: '', diagnostic: buildFirmClauseDiagnostic(suppliedCount, 'family_ineligible') }
        : { overlay: '' };
    }

    const clauses: FirmClause[] = [...supplied];
    if (input.withTenant) {
      try {
        const fromDb = await input.withTenant((tx) => loadOrgFirmClauses(orgId, tx));
        clauses.push(...fromDb);
      } catch (err) {
        logger.debug('[firm-clause] tenant-scoped clause read failed; drafting proceeds without house wording', {
          orgId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    if (!clauses.length) return { overlay: '' };

    const { selected, crossTenantDropped } = selectFirmClauses({
      clauses,
      orgId,
      family: input.family,
      documentType: input.documentType,
      template: input.template,
      practiceArea: input.practiceArea,
      jurisdiction: input.jurisdiction,
      caps: input.caps,
    });
    if (crossTenantDropped > 0) {
      // Not a warning about the caller — a warning about us. Reaching here means
      // a clause for another org was one filter away from an AI prompt (FB-190).
      logger.warn('[firm-clause] NV-FIRM-CLAUSE-TENANT-001 dropped clauses owned by another org', {
        orgId,
        crossTenantDropped,
      });
    }
    if (!selected.length && suppliedCount > 0) {
      const reason: FirmClauseUnappliedReason = crossTenantDropped >= suppliedCount ? 'cross_tenant' : 'no_match';
      const diagnostic = buildFirmClauseDiagnostic(suppliedCount, reason);
      logger.warn('[firm-clause] NV-FIRM-CLAUSE-DIAG-001 supplied clauses were not applied', {
        orgId,
        supplied: suppliedCount,
        applied: 0,
        reason,
        family: input.family,
      });
      return { overlay: '', diagnostic };
    }
    return { overlay: formatFirmClauseOverlay(selected) };
  } catch (err) {
    logger.debug('[firm-clause] overlay resolution failed; drafting proceeds unchanged', {
      error: err instanceof Error ? err.message : String(err),
    });
    return { overlay: '' };
  }
}
