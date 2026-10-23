/**
 * NV-LMCACHE-STABLE-KEY-001 — canonical key derivation for the LM prompt cache.
 *
 * This is the `jrx-llm-cache-key` feature named in `FEATURES-REGISTRY.md` §3; it
 * previously had no implementation file and the key was derived ad hoc inside
 * `lm-cache-service.ts`. There is exactly one LM answer cache in this repo
 * (`lm-cache-service.ts`) and this module is its key SSoT — do not add a second
 * key scheme anywhere (NV-NO-DUPLICATE-001).
 *
 * ── Why this module exists ────────────────────────────────────────────────────
 *
 * Every live caller hands the cache the **assembled** prompt, not the user's
 * question. That assembled string carries per-request material, so the key
 * mutated on every request and the cache could never hit. Measured examples of
 * the volatile material, with the site that appends it:
 *
 *   • `orchestration-middleware.ts:226` — `[MEMORY]` block, built as
 *     `JSON.stringify(row).slice(0,240)` over rows returned by
 *     `NvMemoryService.retrieve()` (a `SELECT *`). Those rows carry the memory
 *     row's `id` (uuid), `created_at`, `updated_at` and an FTS `_relevance`
 *     float. `postMiddleware` step 8 (`orchestration-middleware.ts:385`) writes
 *     a *new* memory row on every turn, so the recalled set — and therefore the
 *     key — differs on every request even when the user asks the identical
 *     question. This is the per-request nonce that poisoned the key.
 *   • `orchestration-middleware.ts:229` — `[RAG]` block, which embeds each
 *     chunk's floating-point retrieval `score`.
 *   • `orchestration-middleware.ts:231` — assembles both onto the prompt; that
 *     result is what reaches `lmCacheService.get` at
 *     `jrx-queen-orchestrator.ts:4473` and `.set` at `:4737`.
 *   • `jrx-client.ts:866` — `${contextParts}\n\n[User Query]\n${prompt}`, where
 *     `contextParts` holds the Auto-RAG header, memory/GraphRAG blocks and the
 *     grounded-statute block.
 *   • `jrx-prompt-enhancement-pipeline.ts` — `Context:`/`Request:` wrapper plus
 *     trailing format / chain-of-thought / example scaffolds.
 *
 * The same asymmetry also breaks the specialist path independently of any
 * nonce: `jrx-client.ts:974` reads the cache with the *pre*-enhancement prompt
 * while `jrx-client.ts:1733` writes it with the *post*-enhancement prompt
 * (reassigned at `jrx-client.ts:1053`), so the read key and the write key are
 * different strings by construction. Reducing both to the same user turn
 * repairs that too, without editing the caller.
 *
 * ── Safety posture ────────────────────────────────────────────────────────────
 *
 * Over-stripping a cache key is worse than under-stripping: two different legal
 * questions collapsing onto one key would serve the wrong answer. Every removal
 * here is therefore anchored on an **exact literal** emitted by a known site —
 * either a delimiter we cut at, or a trailing scaffold we match in full. When
 * extraction yields something implausibly short we fall back to the full
 * normalized prompt, which is never worse than today's behaviour.
 */

import { createHash } from 'crypto';

/**
 * Markers that terminate the user turn: everything from the marker onward is
 * appended context, never part of the question. Cut at the FIRST occurrence
 * because these blocks are strictly appended after the prompt.
 */
const TRAILING_CONTEXT_MARKERS = [
  '\n\n[MEMORY]\n',
  '\n\n[RAG]\n',
  '\n\n--- Relevant Legal Knowledge (Auto-RAG',
] as const;

/**
 * `jrx-client.ts:866` builds `${contextParts}\n\n[User Query]\n${prompt}`.
 * Only one such marker is ever emitted, so the last occurrence is that one.
 */
const USER_QUERY_MARKER = '\n\n[User Query]\n';

/**
 * `jrx-prompt-enhancement-pipeline.ts:260` builds
 * `Context:\n${contextBlock}\n\nRequest:\n${prompt}`. Anchored on the leading
 * `Context:\n` so a user question that merely contains the word "Request:" can
 * never be truncated.
 */
const CONTEXT_PREFIX = 'Context:\n';
const REQUEST_MARKER = '\n\nRequest:\n';

/**
 * Exact trailing scaffolds appended by `jrx-prompt-enhancement-pipeline.ts`
 * (`addOutputFormatting` :263-295, `addChainOfThought` :297, `addExamples`
 * :301). Matched in full at the end of the string — a prefix match would risk
 * eating real prose.
 */
const TRAILING_SCAFFOLDS = [
  'Please provide your response as valid JSON.',
  'Format your response in Markdown with appropriate headers, lists, and code blocks.',
  'Provide your response as code with appropriate comments and documentation.',
  'Organize your response with clear sections and bullet points.',
  'Provide a clear, well-organized response.',
  'Please think through this step by step:\n1. First, understand what is being asked\n2. Break down the problem into smaller parts\n3. Address each part systematically\n4. Synthesize your findings\n5. Provide your final answer',
  'Now, please handle the following:',
] as const;

/**
 * Below this many characters the extraction is treated as failed and we key on
 * the full prompt instead. Guards against a malformed upstream envelope
 * collapsing many distinct questions onto one key.
 */
const MIN_PLAUSIBLE_TURN_CHARS = 8;

const STOP_WORDS = new Set([
  'a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
  'should', 'may', 'might', 'shall', 'can', 'need', 'dare', 'ought',
  'used', 'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by', 'from',
  'as', 'into', 'through', 'during', 'before', 'after', 'above', 'below',
  'between', 'out', 'off', 'over', 'under', 'again', 'further', 'then',
  'once', 'here', 'there', 'when', 'where', 'why', 'how', 'all', 'each',
  'every', 'both', 'few', 'more', 'most', 'other', 'some', 'such', 'no',
  'nor', 'not', 'only', 'own', 'same', 'so', 'than', 'too', 'very',
  'just', 'because', 'but', 'and', 'or', 'if', 'while', 'about', 'up',
  'it', 'its', 'this', 'that', 'these', 'those', 'i', 'me', 'my', 'we',
  'our', 'you', 'your', 'he', 'him', 'his', 'she', 'her', 'they', 'them',
  'their', 'what', 'which', 'who', 'whom',
]);

/**
 * Recover the stable user turn from an assembled prompt.
 *
 * Deterministic and idempotent: `extract(extract(p)) === extract(p)`, which is
 * what makes the read key equal the write key even though `jrx-client` reads
 * before prompt enhancement and writes after it.
 */
export function extractStableUserTurn(prompt: string): string {
  if (!prompt) return '';
  let text = prompt;

  // 1. Drop appended context blocks (Queen middleware / Auto-RAG). These are
  //    strictly suffixes, so cutting at the first marker is exact.
  for (const marker of TRAILING_CONTEXT_MARKERS) {
    const at = text.indexOf(marker);
    if (at >= 0) text = text.slice(0, at);
  }

  // 2. Unwrap the prompt-enhancement `Context:`/`Request:` envelope. Anchored
  //    on the leading `Context:\n` that `injectContext` always emits.
  if (text.startsWith(CONTEXT_PREFIX)) {
    const at = text.indexOf(REQUEST_MARKER, CONTEXT_PREFIX.length);
    if (at >= 0) text = text.slice(at + REQUEST_MARKER.length);
  }

  // 3. Keep only what follows the `[User Query]` delimiter — everything before
  //    it is retrieved grounding (RAG / memory / GraphRAG / statute authority),
  //    which is exactly the material that varies per request.
  const uq = text.lastIndexOf(USER_QUERY_MARKER);
  if (uq >= 0) text = text.slice(uq + USER_QUERY_MARKER.length);

  // 4. Remove trailing output-format / CoT / example scaffolds. Repeated
  //    because `enhance()` can append more than one.
  let changed = true;
  while (changed) {
    changed = false;
    const trimmed = text.replace(/\s+$/, '');
    for (const scaffold of TRAILING_SCAFFOLDS) {
      if (trimmed.endsWith(scaffold)) {
        text = trimmed.slice(0, trimmed.length - scaffold.length);
        changed = true;
        break;
      }
    }
  }

  const candidate = text.trim();
  // A collapsed extraction would merge distinct questions onto one key, so
  // prefer today's (miss-prone but safe) behaviour over a wrong hit.
  return candidate.length >= MIN_PLAUSIBLE_TURN_CHARS ? candidate : prompt.trim();
}

/**
 * Normalize a user turn for keying: case-fold, collapse whitespace, drop stop
 * words. Absorbs the trivial phrasing variation ("What is BNS 103?" vs
 * "what is the BNS 103") that the plan (§1.3) measured as a guaranteed miss.
 */
export function normalizeForCacheKey(text: string): string {
  return text
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
    // Only sentence-terminal punctuation, only at the very end of the turn.
    // "What is BNS 103?" and "what is the BNS 103" are the same question, but a
    // blanket punctuation strip is not safe here: internal punctuation carries
    // legal meaning ("s.103(1)" vs "s.1031", "Art. 21" vs "Art 21").
    .replace(/[?.!]+$/, '')
    .trim()
    .split(' ')
    .filter((word) => !STOP_WORDS.has(word))
    .join(' ');
}

/**
 * Corpus/law version stamped into every key and entry.
 *
 * A statute answer cached before an amendment is a wrong answer, and neither
 * tenant nor jurisdiction changes when a statute is amended. Bumping
 * `JRX_LEGAL_CORPUS_VERSION` therefore orphans every pre-amendment entry
 * instantly and fleet-wide (including the Redis copy), which is the only
 * invalidation primitive that cannot be forgotten at an individual call site.
 */
export function resolveCorpusVersion(): string {
  const raw = (process.env.JRX_LEGAL_CORPUS_VERSION || '').trim();
  return raw === '' ? 'v0' : raw;
}

/**
 * Namespaces are joined to the normalized turn with `::`. A namespace that
 * itself contains `::` would make the boundary ambiguous and let one scope
 * forge another's key, so the digraph is escaped. Single colons are untouched
 * because every live namespace shape uses them (`jrx-agent:tenant:…`,
 * `specialist:…`) and `RedisLMCacheBackend.delByNamespace` matches on the
 * literal `${namespace}::` prefix.
 */
export function escapeNamespace(namespace: string): string {
  return namespace.replace(/::/g, '%3A%3A');
}

/**
 * Sentinels that mean "we could not identify the tenant". A shared fallback
 * bucket is not isolation: `jrx-client.ts:968` collapses a missing tenant to
 * `anon` and `jrx-cache-namespace.ts:22` collapses it to `global`, so every
 * untenanted request lands in ONE bucket keyed only by jurisdiction + agent.
 */
const UNATTRIBUTED_TENANT_IDS = new Set([
  'global', 'anon', 'anonymous', 'undefined', 'null', 'default', '', 'unknown',
]);

/**
 * Positive parse of the tenant id out of a cache namespace.
 *
 * Deliberately a *whitelist* of the shapes this platform actually emits rather
 * than a denylist of bad ones: a namespace that carries no tenant dimension at
 * all (e.g. `patterns:IN` from `jrx-patterns-routes.ts:1583`) is exactly as
 * unsafe as one that says `tenant:global`, and a denylist would wave it
 * through.
 *
 *   `jrx-agent:tenant:<id>:juris:<J>:agent:<id>` — jrx-cache-namespace.ts:39
 *   `specialist:<tenantId>:<JUR>:<agentKey>`    — jrx-client.ts:966-971
 *   `app_<applicationId>`                       — jrx-sdk-gateway-routes.ts:2296
 */
export function parseNamespaceTenant(namespace?: string): string | null {
  if (!namespace) return null;
  const agent = /^jrx-agent:tenant:([^:]+):juris:[^:]+:agent:.+$/.exec(namespace);
  if (agent) return agent[1];
  const specialist = /^specialist:([^:]+):[^:]+:.+$/.exec(namespace);
  if (specialist) return specialist[1];
  const app = /^app_(.+)$/.exec(namespace);
  if (app) return app[1];
  return null;
}

/**
 * True when the namespace proves which tenant owns the entry, and is therefore
 * safe to match *fuzzily* against.
 *
 * Fuzzy (embedding) matching is the dangerous direction: it deliberately serves
 * an answer that was produced for a *different* prompt, so if the scope is not
 * tenant-pinned it will eventually serve a different customer's answer. The
 * previous guards were written as `if (namespace && entry.metadata.namespace !==
 * namespace)`, which degraded to "no filter at all" whenever the caller omitted
 * the namespace — a cross-tenant read waiting for its first caller.
 *
 * Exact-key matching is *not* gated on this: the exact path is already
 * namespace-partitioned by {@link buildCacheKeyParts} and requires a
 * byte-identical question, so gating it would silently disable caching for the
 * legitimate non-tenant scopes (`legal` warm seeds, ops/test namespaces).
 */
export function isFuzzyMatchSafeNamespace(namespace?: string): boolean {
  const tenant = parseNamespaceTenant(namespace);
  if (tenant === null) return false;
  return !UNATTRIBUTED_TENANT_IDS.has(tenant.trim().toLowerCase());
}

/**
 * Completions we must never cache. Caching any of these turns a transient
 * failure or a deliberate abstain into a persistent, fleet-wide wrong answer
 * that is also invisible (it reports as a cache hit, not as an error).
 *
 * Every marker is a literal this platform emits:
 *   • `jrx-client.ts:1743/1747` — Gate-8 block + compliance filter envelopes.
 *   • `jrx-legal-response-format.ts:127` — ungrounded abstain heading.
 *   • `jrx-cost-optimization-suite.ts:84/142/198` — the suite's placeholder jrx-allow-placeholder: names strings to REFUSE.
 *     strings, which must never be mistaken for a real answer.
 */
const NON_CACHEABLE_MARKERS = [
  '[Response blocked by Jurexio Gate 8',
  '[Response filtered by Jurexio compliance engine]',
  '## Insufficient grounding for a reliable legal answer',
  '[Draft response from ',
  '[Batch response for: ',
  '[System prompt for agent ',
];

/** Minimum stored answer length; `JRX_LMCACHE_MIN_VALUE_CHARS` raises it. */
function minValueChars(): number {
  const raw = Number(process.env.JRX_LMCACHE_MIN_VALUE_CHARS);
  return Number.isFinite(raw) && raw > 0 ? Math.trunc(raw) : 1;
}

export type CacheRejectReason =
  | 'empty'
  | 'too-short'
  | 'error-envelope'
  | 'blocked-or-filtered'
  | 'abstain-or-degraded'
  | 'placeholder';

/**
 * Decide whether a completion may enter the cache. Returns the reason on
 * refusal so the caller can meter it instead of silently dropping the write.
 */
export function classifyCompletionForCache(
  value: unknown,
): { cacheable: true } | { cacheable: false; reason: CacheRejectReason } {
  if (typeof value !== 'string') return { cacheable: false, reason: 'empty' };
  const trimmed = value.trim();
  if (trimmed === '') return { cacheable: false, reason: 'empty' };
  if (trimmed.length < minValueChars()) return { cacheable: false, reason: 'too-short' };

  for (const marker of NON_CACHEABLE_MARKERS) {
    if (!trimmed.includes(marker)) continue;
    if (marker.startsWith('## Insufficient grounding')) {
      return { cacheable: false, reason: 'abstain-or-degraded' };
    }
    if (marker.startsWith('[Response ')) {
      return { cacheable: false, reason: 'blocked-or-filtered' };
    }
    return { cacheable: false, reason: 'placeholder' };
  }

  // Structured error envelopes: `jrx-client.ts:1746` returns
  // `JSON.stringify({ error: 'compliance_filtered', … })` as the answer for two
  // agent keys, which is a failure, not content.
  if (trimmed.startsWith('{') && /"error"\s*:/.test(trimmed.slice(0, 200))) {
    return { cacheable: false, reason: 'error-envelope' };
  }

  return { cacheable: true };
}

export interface CacheKeyInput {
  /** The assembled prompt as handed in by the caller. */
  prompt: string;
  /** Tenant/jurisdiction/agent scope. Required for a shareable entry. */
  namespace?: string;
  /** Defaults to {@link resolveCorpusVersion}. */
  corpusVersion?: string;
}

export interface CacheKeyParts {
  /** The recovered user turn, before normalization (useful for embedding). */
  userTurn: string;
  /** Stop-word-normalized user turn. */
  normalized: string;
  /** Corpus version folded into the key. */
  corpusVersion: string;
  /**
   * The full lookup key: `<namespace>::<corpus>::<normalized>` (namespace
   * omitted when absent, preserving the legacy un-namespaced slot).
   */
  lookupKey: string;
}

/**
 * Build every key component in one place so `get`, `set`, `invalidate` and the
 * shared-backend write can never disagree about what the key is.
 */
export function buildCacheKeyParts(input: CacheKeyInput): CacheKeyParts {
  const corpusVersion = input.corpusVersion ?? resolveCorpusVersion();
  const userTurn = extractStableUserTurn(input.prompt);
  const normalized = normalizeForCacheKey(userTurn);
  const versioned = `c=${corpusVersion}::${normalized}`;
  const lookupKey = input.namespace
    ? `${escapeNamespace(input.namespace)}::${versioned}`
    : versioned;
  return { userTurn, normalized, corpusVersion, lookupKey };
}

/** Stable digest of a lookup key — used only for logging, never for matching. */
export function fingerprintKey(lookupKey: string): string {
  return createHash('sha256').update(lookupKey).digest('hex').slice(0, 12);
}
