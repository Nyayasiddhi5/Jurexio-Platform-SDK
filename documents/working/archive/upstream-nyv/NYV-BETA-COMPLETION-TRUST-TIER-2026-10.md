# NYV Beta completion loop + trust tiers (2026-10)

> **GO P0+P1** — NV-BETA-QUALITY-FIRST-001, NV-AI-COMPLETION-LOOP-001, NV-TRUST-TIER-001.

## Beta quality-first tokens

When `NYV_F_BETA_QUALITY_FIRST=1` (default **ON** in non-dev):

| Env | Default (Beta) | Legacy |
|-----|----------------|--------|
| `NYV_BETA_PARTNER_MAX_TOKENS_FLOOR` | 16384 | 2048 (non-ecosystem) |
| `NYV_BETA_PARTNER_MAX_TOKENS_CHAT_FAST` | 4096 | 768 |
| `NYV_BETA_PARTNER_MAX_TOKENS_CHAT` | 16384 | 8192 |
| `NYV_BETA_PARTNER_MAX_TOKENS_FAST` | 8192 | 2048 |
| `NYV_BETA_PARTNER_MAX_TOKENS_DRAFT_FAST` | 16384 | 4096 |
| `NYV_BETA_DRAFT_FAST_SLA_MAX_TOKENS` | 16384 | 8192 medium band |

Opt out: `NYV_BETA_QUALITY_FIRST=0` or `NYV_F_BETA_QUALITY_FIRST=0`.

## Completion loop

After enforcers + structure checker, `/orchestrate` runs **automatic LLM continuation** when:

- `analyzeDraftCompletion` reports abrupt / truncated structure, or
- provider `finishReason` is `length` / `max_tokens`.

Env: `NYV_BETA_COMPLETION_MAX_SEGMENTS` (default **4**), `NYV_BETA_COMPLETION_SEGMENT_MAX_TOKENS` (default **16384**).

Disable: `NYV_F_BETA_COMPLETION_LOOP=0`.

## NSP “Continue” button (additive contract)

Response fields (not breaking):

| Field | Meaning |
|-------|---------|
| `completion` | `{ status, continuationAvailable, continuationCount, hint, continueRequest }` |
| `completionStatus` | `complete` \| `incomplete` \| `continued` |
| `continuationAvailable` | Show Continue when `true` |
| `draftQuality.completion*` | Same mirrors for draft UIs |

When `continuationAvailable` is true, NSP re-posts `/orchestrate` with:

```json
{
  "taskType": "<same>",
  "prompt": "<same user instruction>",
  "options": {
    "continueIncomplete": true,
    "segmentIndex": 1,
    "priorContent": "<full text from prior response.content>",
    "priorRequestId": "<optional requestId>"
  }
}
```

NYV merges `priorContent` with the new segment and may run further auto-continuations in the same request.

Incomplete drafts set `requestPhase: degraded` (content present; user should continue or review).

## Trust tiers (memory / recall)

| Tier | Write | Recall |
|------|-------|--------|
| T0 authority | ingest pipelines | yes |
| T1 matter facts | docparse / CNR | yes |
| T2 session scratch | ecosystem chat turns | session-scoped |
| T3 AI draft output | **blocked** | **filtered from graph recall** |
| T4 accepted counsel | `options.counselAccepted` / `acceptToMatterKnowledge` | yes |
| T5 eval/test | **blocked** (`x-nyv-eval`, `eval-*` matter/session) | never |

Flag: `NYV_F_TRUST_TIER_MEMORY=1` (default ON non-dev).

## Code map

- `src/config/nv-beta-quality-profile.ts`
- `src/services/nv-ai-completion-loop.ts`
- `src/services/nv-trust-tier.ts`
- `src/orchestration/nv-orchestration-completion-seam.ts`
- `src/utils/nv-partner-platform.ts` (token floors)
- `src/services/nv-client.ts` (memory write gate)

## Verify

```bash
cd nyayavigya-platform-312
npx vitest run tests/unit/nv-trust-tier.test.ts tests/unit/nv-ai-completion-loop.test.ts
npm run guardrail:no-new-orphans
```
