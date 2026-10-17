/**
 * NV-AGENT-CAPABILITY-ALIAS-001 — bridge partner task vocabulary to registry skills.
 *
 * ## The defect this closes
 *
 * `resolveAgentByCapability()` in `nv-client.ts` matched a caller's `taskType`
 * against an agent's `capabilities[]` with a raw substring test:
 *
 *     capability.toLowerCase().includes(taskType.toLowerCase())
 *
 * But the two vocabularies were never the same shape. The registry describes
 * agents with kebab-case *skills* — `case-law-research`, `statute-retrieval`,
 * `citation-verification`, `clause-drafting`. Partner callers (NSP, NYM, console,
 * SDK) send snake_case *task names* — `legal_research`, `statute_lookup`,
 * `citation_check`, `contract_review`.
 *
 * A substring test cannot bridge those. Measured against the real 164-agent
 * registry (`scripts/jrx-probe-agent-selection.ts`), only 5 of 21 partner
 * taskTypes bound an agent, and they bound by accident — bare one-word values
 * (`research`, `drafting`, `analysis`, `compliance`) happen to appear inside
 * `case-law-research`, `clause-drafting`, `risk-analysis`,
 * `compliance-gap-detection`. Every multi-word task fell through to
 * `agentKey = 'generic'`.
 *
 * Falling back to `generic` is not a soft degradation. It means:
 *   - none of the 164 specialist system prompts is used;
 *   - the agent-prompt depth ladder (NV-AGENT-PROMPT-DEPTH-001) has no bundle to
 *     draw jurisdiction / reasoning / evidence / citation sections from;
 *   - per-agent `preferredModels` / `ragNamespaces` never apply.
 *
 * That is the mechanism behind the IPC→BNS style regressions: the request was
 * answered by an unspecialised prompt that never received the statute-mapping
 * rules living in the specialist agent's bundle.
 *
 * ## Why an explicit table and not fuzzy matching
 *
 * Fuzzy or embedding similarity would bind *something* to every task, including
 * tasks we have no specialist for — silently routing a trust-accounting question
 * to a criminal-law agent. In a legal system a wrong specialist is worse than a
 * declared generalist, because the answer arrives with unearned authority. So the
 * mapping is explicit and auditable, and an unmapped task still falls back to
 * generic rather than guessing.
 *
 * Ordering inside each list is meaningful: earlier skills are better matches, and
 * the resolver prefers agents matching earlier entries before falling back to
 * later, broader ones.
 */

/** Canonical form: lowercase, separators unified, so `legal_research` ≡ `legal-research`. */
export function normalizeTaskToken(value: string): string {
  return value.toLowerCase().trim().replace(/[\s_]+/g, '-');
}

/**
 * Partner `taskType` → registry capability skills, best match first.
 *
 * Keys are stored normalised, so `legal_research`, `legal-research` and
 * `Legal Research` all resolve to the same entry.
 *
 * Every value here MUST be a capability string that actually exists in
 * `config/agent-registries/*.json`; `tests/unit/jrx-agent-capability-alias.test.ts`
 * asserts that, so a typo or a renamed skill fails CI instead of silently
 * reintroducing the generic fallback.
 */
export const TASK_TYPE_CAPABILITY_ALIASES: Readonly<Record<string, readonly string[]>> = {
  // ── Research ────────────────────────────────────────────────────────────────
  'legal-research': ['case-law-research', 'statute-retrieval', 'precedent-analysis', 'multi-hop-rag'],
  research: ['case-law-research', 'statute-retrieval', 'precedent-analysis', 'multi-hop-rag'],
  'case-law-research': ['case-law-research', 'precedent-analysis'],
  'precedent-search': ['precedent-analysis', 'case-law-research'],
  /** NV-AGENT-RESEARCH-PIN-001 — differentiate identical capability sets. */
  'statute-research': ['statute-retrieval', 'regulatory-mapping'],
  'caselaw-research': ['case-law-research', 'precedent-analysis'],
  'precedent-research': ['precedent-analysis', 'case-law-research'],

  // ── Statute / citation ──────────────────────────────────────────────────────
  // `statute_lookup` is the NSP name for what the registry calls
  // `statute-retrieval`; the words share no substring, which is exactly the
  // failure this table exists to fix.
  'statute-lookup': ['statute-retrieval', 'regulatory-mapping', 'jurisdiction-injection'],
  'statute-retrieval': ['statute-retrieval', 'regulatory-mapping'],
  'citation-check': ['citation-verification', 'citation-injection', 'hallucination-check'],
  'citation-verification': ['citation-verification', 'citation-injection'],

  // ── Drafting ────────────────────────────────────────────────────────────────
  drafting: ['document-generation', 'clause-drafting', 'template-management'],
  draft: ['document-generation', 'clause-drafting', 'template-management'],
  'document-drafting': ['document-generation', 'clause-drafting', 'template-management'],
  'document-generation': ['document-generation', 'template-management'],
  'clause-drafting': ['clause-drafting', 'document-generation'],
  correspondence: ['correspondence-drafting', 'document-generation'],
  'notice-drafting': ['correspondence-drafting', 'document-generation', 'clause-drafting'],

  // ── Review / analysis ───────────────────────────────────────────────────────
  'contract-review': ['clause-extraction', 'risk-analysis', 'risk-flagging', 'comparative-analysis'],
  review: ['clause-extraction', 'risk-analysis', 'risk-flagging'],
  'clause-extraction': ['clause-extraction', 'risk-flagging'],
  'case-analysis': ['precedent-analysis', 'risk-analysis', 'case-law-research', 'comparative-analysis'],
  analysis: ['risk-analysis', 'precedent-analysis', 'comparative-analysis'],
  'risk-assessment': ['risk-analysis', 'risk-flagging', 'compliance-gap-detection'],
  comparison: ['comparative-analysis', 'cross-jurisdiction-comparison'],
  'cross-jurisdiction': ['cross-jurisdiction-comparison', 'jurisdiction-adaptation'],

  // ── Compliance / regulatory ─────────────────────────────────────────────────
  compliance: ['compliance-gap-detection', 'regulatory-mapping', 'regulatory-monitoring'],
  'compliance-check': ['compliance-gap-detection', 'regulatory-mapping', 'audit-evidence'],
  regulatory: ['regulatory-monitoring', 'regulatory-mapping', 'update-monitoring'],
  audit: ['audit-evidence', 'audit-logging', 'audit-trail-generation'],
  privilege: ['privilege-classification'],
  'privilege-review': ['privilege-classification', 'clause-extraction'],

  // ── Deadlines / limitation ──────────────────────────────────────────────────
  limitation: ['limitation-monitoring', 'timeline-computation', 'deadline-tracking'],
  timeline: ['timeline-computation', 'limitation-monitoring', 'deadline-tracking'],
  deadline: ['deadline-tracking', 'limitation-monitoring', 'court-calendar-integration'],
  'court-calendar': ['court-calendar-integration', 'calendar-synchronisation', 'deadline-tracking'],

  // ── Billing / practice ops ──────────────────────────────────────────────────
  billing: ['invoice-generation', 'e-billing-formatting', 'time-entry-validation', 'rate-compliance'],
  invoice: ['invoice-generation', 'e-billing-formatting'],
  'trust-accounting': ['trust-accounting', 'financial-reporting'],

  // ── Language ────────────────────────────────────────────────────────────────
  translation: ['multi-language-output', 'tone-adaptation'],
  'multi-language': ['multi-language-output'],

  // ── Partner NSP/NYM orchestrate taskTypes (NV-PARTNER-TASKTYPE-ALIAS-001) ───
  // Bare + explicit `-fast` must share the same capability set so
  // `resolveAgentByCapability()` binds a named specialist (e.g. A-047 research,
  // A-001 drafting). Queen vs specialist *depth* stays in nv-partner-platform.
  'legal-chat': ['case-law-research', 'statute-retrieval'],
  'legal-chat-fast': ['case-law-research', 'statute-retrieval'],
  'legal-draft': ['document-generation', 'clause-drafting', 'template-management'],
  'legal-draft-fast': ['document-generation', 'clause-drafting', 'template-management'],
  'doc-draft': ['document-generation', 'clause-drafting', 'template-management'],
  'doc-draft-fast': ['document-generation', 'clause-drafting', 'template-management'],
  'document-draft-fast': ['document-generation', 'clause-drafting', 'template-management'],

  // ── Conversational / general ────────────────────────────────────────────────
  // These carry no single specialism, so they map to the broad legal-reasoning
  // skills. This is still far better than `generic`: it binds a real registry
  // agent with a full system prompt, jurisdiction rules and citation discipline.
  chat: ['case-law-research', 'statute-retrieval'],
  general: ['case-law-research', 'statute-retrieval'],
  qa: ['case-law-research', 'statute-retrieval'],
  'micro-faq': ['statute-retrieval', 'case-law-research'],
  summarization: ['clause-extraction', 'comparative-analysis', 'case-law-research'],
  summary: ['clause-extraction', 'comparative-analysis'],
  explain: ['case-law-research', 'statute-retrieval'],

  // ── Orchestration / platform ────────────────────────────────────────────────
  orchestration: ['workflow-orchestration', 'task-routing', 'swarm-coordination'],
  routing: ['task-routing', 'stakeholder-routing'],
  hitl: ['hitl-management', 'escalation-trigger'],
};

/**
 * Capability skills to try for a caller-supplied `taskType`, best match first.
 *
 * Resolution order:
 *   1. exact alias hit on the normalised task name;
 *   2. the normalised task itself (so a caller may pass a real skill directly,
 *      e.g. `precedent-analysis`, and still bind);
 *   3. alias hit on the longest trailing word — `corporate_contract_review`
 *      should reach `contract-review` rather than falling through;
 *   4. the raw token, preserving the old accidental-substring behaviour so no
 *      request that used to bind can stop binding.
 */
export function capabilitiesForTaskType(taskType: string): string[] {
  const norm = normalizeTaskToken(taskType);
  const out: string[] = [];
  const push = (v: string): void => { if (v && !out.includes(v)) out.push(v); };

  for (const v of TASK_TYPE_CAPABILITY_ALIASES[norm] ?? []) push(v);

  push(norm);

  // Progressive suffix match: drop leading qualifiers one word at a time.
  const parts = norm.split('-');
  for (let i = 1; i < parts.length; i += 1) {
    const suffix = parts.slice(i).join('-');
    for (const v of TASK_TYPE_CAPABILITY_ALIASES[suffix] ?? []) push(v);
    push(suffix);
  }

  // Never regress: the original raw token stays last so previously-binding
  // requests keep binding even if this table says nothing about them.
  push(taskType.toLowerCase().trim());

  return out;
}

/* ────────────────────────────────────────────────────────────────────────────
 * NV-AGENT-SUBJECT-MATTER-001 — pick the right *specialist*, not just the right
 * practice area.
 *
 * Capability matching alone cannot choose between agents, because capabilities
 * describe a practice area rather than a specialism: the 164 agents share only
 * **9 distinct capability sets**. All 18 research agents — Criminal Law Research,
 * Tax Law Research, Family Law Research, … — carry byte-identical
 * `capabilities[]`. Selecting on capability + tier therefore returns whichever
 * agent happens to sort first, which is how a BNS/IPC murder question was
 * answered by the *Tax Law Research Agent*.
 *
 * That is a dangerous failure rather than a cosmetic one: the answer arrives
 * carrying a specialist's authority and a specialist's system prompt, but the
 * wrong specialism's statute set and citation conventions.
 *
 * The distinguishing signal lives in `name` (and secondarily `description`).
 * Two existing lookups were meant to use it and cannot:
 *
 *   - `getAgentsByPracticeArea(area)` needs an **exact** match, but the
 *     classifier emits `criminal` / `tax` / `family` while the registry stores 9
 *     functional areas (`Legal Research & Intelligence`, …) — so it always
 *     returns `[]`.
 *   - `searchAgents(query)` substring-matches the **entire user sentence**
 *     against short fields like `name`, so it always returns `[]` for a real
 *     question.
 *
 * Both then fall through to `getAllAgents()[0]`, which is Q-001, the Queen
 * Orchestration Engine — measured 0/8 correct on real legal queries
 * (`scripts/jrx-probe-subject-matter-selection.ts`).
 *
 * This table maps a subject to the words that appear in the *names* of agents
 * specialising in it, so the existing 15-area keyword classifier can finally
 * reach the right agent. It deliberately does not re-implement that classifier
 * (NV-NO-DUPLICATE-001) — it supplies the missing name vocabulary it needs.
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * Subject area → words expected in a specialist agent's `name`, best first.
 *
 * Keys match `NvAgentAutoSelector.practiceAreaKeywords` so the existing
 * classifier's output feeds straight in. Values are asserted against real agent
 * names by `tests/unit/jrx-agent-capability-alias.test.ts`, so renaming an agent
 * out from under this table fails CI rather than silently degrading routing.
 */
/**
 * Subject area → words expected in a specialist agent's `name`, best first.
 *
 * Keys match `NvAgentAutoSelector.practiceAreaKeywords` so the existing
 * classifier's output feeds straight in. Every value is asserted to match a real
 * agent name/description by `tests/unit/jrx-agent-capability-alias.test.ts`, so
 * renaming an agent out from under this table fails CI rather than silently
 * degrading routing. Aspirational hints are deliberately absent: a hint that
 * matches nothing is dead weight that hides the real gap.
 *
 * Where the registry has no dedicated specialist, the hint names the honest
 * nearest one (Companies Act → `statutory`, matrimonial pleading → `pleading`)
 * rather than leaving ranking to arbitrary tie-breaks.
 */
export const SUBJECT_AGENT_NAME_HINTS: Readonly<Record<string, readonly string[]>> = {
  criminal: ['criminal'],
  // No matrimonial *drafting* agent exists (24 drafters, none family), so a
  // divorce petition routes to the pleading drafter — it is a court pleading.
  family: ['family', 'matrimonial', 'pleading'],
  tax: ['tax'],
  labor: ['employment', 'labour'],
  // No corporate/company *research* agent exists (18 researchers, none
  // corporate), so a Companies Act question routes to Statutory Research.
  corporate: ['corporate', 'shareholder', 'board', 'statutory'],
  property: ['real estate', 'property', 'lease', 'land'],
  ipr: ['ip law', 'ip ', 'patent', 'trademark'],
  banking: ['financial regulation', 'finance', 'loan'],
  constitutional: ['writ', 'court rules', 'statutory'],
  cyber: ['data protection', 'privacy'],
  consumer: ['consumer'],
  arbitration: ['arbitration', 'settlement'],
  environmental: ['environment'],
  immigration: ['immigration', 'visa'],
  insolvency: ['insolvency'],
  // Subject-neutral: no name hint, so ranking falls back to capability + tier.
  general: [],
};

/**
 * Subject keywords → area, mirroring the live classifier's vocabulary.
 *
 * Kept beside the name hints so a query can be classified wherever the registry
 * is consulted, without importing `nv-orchestration-services` (which needs a DB
 * handle for its audit write and cannot be imported from the hot path).
 */
export const SUBJECT_KEYWORDS: Readonly<Record<string, readonly string[]>> = {
  criminal: ['crime', 'criminal', 'theft', 'murder', 'bail', 'fir', 'arrest', 'police', 'prosecution', 'accused', 'ipc', 'bns', 'bnss', 'crpc', 'culpable homicide', 'cognizable'],
  corporate: ['company', 'companies act', 'merger', 'acquisition', 'shareholder', 'board', 'incorporation', 'llp', 'oppression'],
  family: ['divorce', 'custody', 'maintenance', 'alimony', 'marriage', 'domestic', 'child', 'hindu marriage'],
  property: ['land', 'property', 'tenant', 'lease', 'rent', 'eviction', 'title', 'deed', 'transfer of property'],
  labor: ['employment', 'salary', 'termination', 'workplace', 'labour', 'labor', 'gratuity', 'provident fund', 'industrial dispute'],
  tax: ['income tax', 'gst', 'tax', 'assessment', 'refund', 'deduction', 'tds', 'input tax credit'],
  ipr: ['patent', 'trademark', 'copyright', 'intellectual property', 'infringement', 'passing off'],
  banking: ['loan', 'bank', 'nbfc', 'rbi', 'cheque', 'sarfaesi', 'drt', 'mortgage', 'negotiable instrument'],
  constitutional: ['fundamental rights', 'constitution', 'writ', 'pil', 'article 14', 'article 21', 'article 226'],
  cyber: ['cyber', 'data protection', 'privacy', 'it act', 'online fraud', 'hacking', 'dpdp'],
  consumer: ['consumer', 'deficiency', 'product liability', 'service defect'],
  arbitration: ['arbitration', 'mediation', 'conciliation', 'dispute resolution', 'arbitral award'],
  environmental: ['environment', 'pollution', 'ngt', 'forest', 'wildlife', 'climate'],
  immigration: ['visa', 'immigration', 'passport', 'oci', 'deportation', 'work permit'],
  insolvency: ['ibc', 'insolvency', 'bankruptcy', 'nclt', 'cirp', 'liquidation', 'corporate debtor'],
};

/**
 * Highest-scoring subject area for a prompt, or `general` when nothing matches.
 *
 * Keywords are matched on **word boundaries**, not as bare substrings. A raw
 * `includes()` test made "please summarise" match `lease` and classify a generic
 * summarisation request as property law — which would then bind a real estate
 * specialist and answer with property-law framing. Multi-word keywords still
 * match across spaces, so "input tax credit" and "transfer of property" work.
 */
export function classifySubjectArea(prompt: string): string {
  if (!prompt) return 'general';
  const q = prompt.toLowerCase();
  let bestArea = 'general';
  let bestScore = 0;

  const matchesWord = (haystack: string, kw: string): boolean => {
    // Escape regex metacharacters; keywords are data, not patterns.
    const safe = kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // \b is unreliable next to non-word chars, so bound explicitly on
    // start/end-of-string or a non-letter/digit.
    return new RegExp(`(^|[^a-z0-9])${safe}([^a-z0-9]|$)`, 'i').test(haystack);
  };

  for (const [area, kws] of Object.entries(SUBJECT_KEYWORDS)) {
    let score = 0;
    for (const kw of kws) {
      if (!matchesWord(q, kw)) continue;
      // Longer keywords are more specific: "input tax credit" should outweigh a
      // bare "tax", and "hindu marriage" should outweigh "marriage".
      score += kw.includes(' ') ? 2 : 1;
    }
    if (score > bestScore) { bestScore = score; bestArea = area; }
  }

  return bestArea;
}

/** Name fragments that mark an agent as specialising in `area`. */
export function nameHintsForSubject(area: string): readonly string[] {
  return SUBJECT_AGENT_NAME_HINTS[normalizeTaskToken(area)] ?? [];
}

/**
 * NV-AGENT-RESEARCH-PIN-001 — when multiple research agents share identical
 * capabilities[], prefer the specialist whose id matches the primary skill.
 */
export const RESEARCH_CAPABILITY_AGENT_ID: Readonly<Record<string, string>> = {
  'statute-retrieval': 'A-047',
  'regulatory-mapping': 'A-047',
  'case-law-research': 'A-048',
  'precedent-analysis': 'A-051',
  'citation-verification': 'A-051',
};

/** Primary research agent id for the best-matching capability in `wanted`. */
export function researchAgentIdForCapabilities(wanted: readonly string[]): string | null {
  for (const cap of wanted) {
    const id = RESEARCH_CAPABILITY_AGENT_ID[cap.toLowerCase()];
    if (id) return id;
  }
  return null;
}
