# NYV system prompt — what exists, what is wired, what to enhance (2026-08-18)

> Answering the architect's question directly: **do we have a platform-level system prompt,
> is it actually configured, and does it carry our packages / tools / skills?**
> Every claim below is traced through the live code path, not inferred.

---

## 1. Short answer

**Yes, a platform-level prompt exists and it IS wired — on by default, on every safety-ring
path.** It is not the file I first suspected, and it is not the `22-section` engine.

| layer | file | scope | wired? |
|---|---|---|---|
| **Platform / legal-counsel overlay** | `src/services/nv-legal-intelligence-overlay.ts` (331 lines) | **whole platform** | ✅ **default ON** via `NYV_LEGAL_INTEL_FORCE` (opt-**out** only) |
| Per-agent 22/23-section registry prompt | `src/services/nv-system-prompt-engine.ts` (1,114) | one agent | ✅ via routes, `nv-client`, `nyv-prompt-compiler` |
| Layered agent assembly + turn constitution | `assembleLayeredAgentSystemPrompt`, `beginPromptConstitutionTurn` | per session turn | ✅ |
| Parlant standards | `src/packages/protocols/parlant-standards.ts` (912) | governance vocabulary | ✅ 3 importers |
| `v10` engine + `comprehensive-agent-system-v10` | `src/system-prompts/*` | agent registry generation | ⚠️ only imported by each other + `index.ts` — **not on the live request path** |
| `src/chat/system-prompt-manager.ts` | 20 lines | — | ❌ **0 importers** |

### How it actually composes, per request

```
nv-client.ts (safety ring)
  ├─ forceIntel = !NYV_LEGAL_INTEL_FORCE(off)          ← default TRUE
  ├─ overlay  = buildUniversalLegalIntelligenceOverlay({ prompt, jurisdiction, depth })
  ├─ registry = agent.systemPrompt (22/23-section)     ← if an agent is bound
  ├─ promptDepth = resolveAgentPromptDepth(...)        ← budget-aware §3/§4/§5/§6/§17/§18
  └─ assembleLayeredAgentSystemPrompt(...)             ← turn-aware constitution
```

**A correction to my own first read:** `nv-orchestration-routes.ts:1306` falls back to the
one-liner *"You are a precise legal AI assistant."* for non-partner traffic, which looked
like a serious hole. It is **not** — `nv-client` then applies the overlay unconditionally
(`NV-LEGAL-INTEL-MANDATE-001`), so that string is superseded before the LLM sees it. Worth
removing anyway as a trap, but not a live defect.

The overlay enforces a genuine counsel-grade output contract — **ISSUE & SHORT ANSWER ·
FACTS ASSUMED · APPLICABLE LAW & INGREDIENTS · ANALYSIS · AUTHORITIES · RISKS & CAVEATS ·
NEXT STEPS / PRAYER** — which is exactly why NSP answers read better than a raw LLM reply.

---

## 2. The real gap: the prompt never tells the model what it can do

Measured keyword coverage in the platform overlay:

| concept | occurrences |
|---|---|
| retrieval / RAG / caselaw / citation | 10 / 3 / 3 / 6 |
| memory | 2 |
| NYS | 2 |
| **tools** | **0** |
| **skills** | **0** |
| **MCP** | **0** |

And no layer emits a tool manifest: `grep` for `available tools` / `you have access to` /
`toolsAvailable` returns **0** in the overlay, **0** in the 22-section engine, and the only
place `mcpToolsAllowed` appears is `nv-agent-tool-bridge.ts` — which wires tools for
*execution* but never *describes* them to the model.

**Why this matters for the architect's stated priority (quality + cost):**

1. **Quality.** A model that is not told a statute-lookup, caselaw-search or CNR-resolve
   capability exists will answer from parametric memory instead of asking for it. That is
   precisely how "BNS 138 = Abduction" class errors happen.
2. **Cost.** Undirected models pad. A prompt that says *"a verified statute mapping is
   available — do not restate the section text from memory"* shortens output and reduces
   the need for a second corrective turn.
3. This is the single clearest difference from how Claude/OpenAI system prompts are
   constructed: they enumerate capability, refusal boundaries and tool-use discipline.

---

## 3. Enhancements proposed (item 7 of the sprint)

All **additive to the existing overlay** — no new prompt engine, no parallel pipeline
(**NV-NO-DUPLICATE-001**). The overlay is already the single platform layer; it just needs
three sections it does not have.

### 3.1 Capability & tool-use discipline — the main win
Inject a compact, **budget-aware** manifest of what is actually available for *this* request
(not a static list): NYS statute/caselaw retrieval, CNR resolve, document analysis fields,
memory recall, web search when enabled. Paired with explicit discipline:
- prefer a retrieved authority over recalled text;
- never invent a case title, citation or URL;
- say plainly when an authority could not be verified.

Must respect `promptBudget` — `micro_faq` / `chat` / `classify` already run lean L1, and this
section must not push a one-line question over budget (a documented past regression).

### 3.2 Jurisdiction currency guard
The registry has repeal rules (IPC→BNS, CrPC→BNSS, IEA→BSA) but §3 is only included when
`promptDepth` affords it. A **one-line** always-on statement of the new-code-first rule costs
almost nothing and directly prevents the highest-severity legal error class.

### 3.3 Refusal & escalation boundaries
Explicit: no forum-shopping advice, no guarantees of outcome, flag when a matter needs a
licensed advocate, and escalate rather than guess when the statute is ambiguous. This is
standard in mature agentic system prompts and currently implicit.

**Verification for all three:** `npm run eval:quality-trend` — prompt changes move answer
quality and unit tests cannot see that. Plus a token-budget assertion so lean classes stay lean.

---

## 4. Sprint scope (one deploy at the end)

| # | item | state |
|---|---|---|
| 1 | Cost benchmark baseline (`npm run bench:cost`) | pending — read-only, do first |
| 2 | Deploy drain / readiness gate | pending |
| 3 | Memory tiers durable (`graph-memory-service`: 12 Maps, **0** durable writes) | pending |
| 4 | Memory breadth for partner `*-fast` (currently **1 of 5** tiers) | pending |
| 5 | Wire `rerankResults` / MMR at the Auto-RAG fusion point | pending |
| 6 | Gemini prompt/context caching on the flash rail | pending |
| 7 | **Platform system prompt enhancements (§3 above)** | pending |

**One build, one deploy, one live verification at the end** — per the standing instruction
that multiple deploys for related work is a process failure.
