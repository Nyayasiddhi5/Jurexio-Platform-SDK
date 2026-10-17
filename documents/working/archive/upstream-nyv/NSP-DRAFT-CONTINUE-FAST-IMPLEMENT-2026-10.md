# NSP — Draft Continue (single-page implement guide)

> **Ship target:** Beta launch UX for incomplete drafts.  
> **NYV contract:** NV-AI-COMPLETION-LOOP-001 (additive; no breaking changes).  
> **Full handshake:** [`NSP-NYV-AI-HANDSHAKE-2026-09.md`](./NSP-NYV-AI-HANDSHAKE-2026-09.md) §4g.  
> **NYV ops:** [`NYV-BETA-COMPLETION-TRUST-TIER-2026-10.md`](./NYV-BETA-COMPLETION-TRUST-TIER-2026-10.md).

**Prerequisite:** NYV **LIVE** on nysdev **`2026-10-09T1741Z-aws-ssm`** (completion loop + §4g fields).

---

## 1. Will this break Beta if NSP does nothing?

| | |
|---|---|
| **Existing flows** | **No break** — same endpoints, same `content` field. |
| **Users today** | Often **better** drafts (NYV auto-continues + higher token floors server-side). |
| **Without NSP UI** | Incomplete drafts may still happen; users may **regenerate** (worse UX, not a wire failure). |
| **Recommended** | **1–2 day** NSP change: read flags + Continue button (below). |

---

## 2. When to show Continue (one line of code)

```typescript
function shouldShowDraftContinue(data: Record<string, unknown>): boolean {
  return (
    data.continuationAvailable === true
    || (data.completion as { continuationAvailable?: boolean } | undefined)?.continuationAvailable === true
    || (data.draftQuality as { continuationAvailable?: boolean } | undefined)?.continuationAvailable === true
  );
}
```

**Never** treat `requestPhase === 'degraded'` as failure when `data.content` is non-empty.

---

## 3. Response fields (read once, store in BFF types)

```typescript
type CompletionStatus = 'complete' | 'incomplete' | 'continued';

interface PartnerCompletion {
  status: CompletionStatus;
  continuationAvailable: boolean;
  continuationCount: number;
  incompleteReason?: 'abrupt_ending' | 'max_tokens' | 'structure' | 'segment_budget';
  hint?: string;
  continueRequest?: {
    options: {
      continueIncomplete: true;
      segmentIndex: number;
      priorRequestId?: string;
    };
  };
}

// On orchestrate success payload (data / poll result):
interface NyvOrchestrateData {
  content: string;
  requestId: string;
  requestPhase?: string;
  optionalDegraded?: boolean;
  completion?: PartnerCompletion;
  completionStatus?: CompletionStatus;
  continuationAvailable?: boolean;
  draftQuality?: {
    reviewRecommended?: boolean;
    continuationAvailable?: boolean;
    completionStatus?: CompletionStatus;
    completion?: PartnerCompletion;
    // ... existing structureMarkers, etc.
  };
}
```

---

## 4. Client state (per draft thread)

Keep in React context / Zustand / matter draft store:

```typescript
interface DraftContinueState {
  originalPrompt: string;
  taskType: string;
  sessionId: string;
  matterId?: string;
  parameters: Record<string, unknown>;
  baseOptions: Record<string, unknown>; // draftLength, etc.
  lastContent: string;
  lastRequestId: string;
  nextSegmentIndex: number;
}
```

**After every successful NYV response:** update `lastContent`, `lastRequestId`, and  
`nextSegmentIndex = data.completion?.continueRequest?.options.segmentIndex ?? 0`.

---

## 5. First draft (unchanged wire)

```http
POST /api/nv/orchestrate
X-API-Key: …
X-NYV-Platform: nsp
X-NYV-User-Id: <numeric>
Content-Type: application/json
```

```json
{
  "taskType": "legal-draft-fast",
  "prompt": "<user instruction>",
  "sessionId": "<session>",
  "matterId": "<matter>",
  "parameters": {
    "documentType": "bail_application"
  },
  "options": {
    "draftLength": "medium"
  }
}
```

Render `data.content`. Run §2.

---

## 6. Continue request (only additive `options`)

Same URL and headers. **Same** `taskType`, `prompt`, `parameters`, `sessionId`, `matterId`.

```json
{
  "taskType": "legal-draft-fast",
  "prompt": "<same as first turn — not 'continue the draft'>",
  "sessionId": "<same>",
  "matterId": "<same>",
  "parameters": { "documentType": "bail_application" },
  "options": {
    "draftLength": "medium",
    "continueIncomplete": true,
    "priorContent": "<full data.content from previous response>",
    "segmentIndex": 1,
    "priorRequestId": "<previous data.requestId>"
  }
}
```

| Field | Rule |
|-------|------|
| `priorContent` | Entire last `content` string |
| `segmentIndex` | From prior `completion.continueRequest.options.segmentIndex` |
| `continueIncomplete` | Must be `true` |

Replace editor body with new `data.content` (NYV returns **merged** full draft).

Repeat Continue while `shouldShowDraftContinue(data)` is true (cap ~4 NYV segments total).

---

## 7. UI copy (paste-ready)

| Condition | Banner / button |
|-----------|-----------------|
| `continuationAvailable` | **“Draft incomplete — missing closing sections (PRAYER / verification).”** Button: **“Continue draft”** |
| `completion.status === 'continued'` | Optional footnote: “Completed in multiple AI passes.” |
| `continuationAvailable === false` && incomplete | “Automatic completion limit reached. Use **Counsel-grade draft** or edit manually.” |
| `draftQuality.reviewRecommended` | Keep existing review / attestation chips |

Disable Continue while request in flight; do not clear editor on error.

---

## 8. Async worker / poll

On final poll payload, read `result.completion` / `result.continuationAvailable` **same as sync**.

If incomplete + Continue: either call sync orchestrate from BFF (§6) or forward `options` on next worker job (must pass `priorContent` verbatim).

---

## 9. Stream (Legal Chat SSE) — interim

Completion metadata is on **sync** `POST /api/nv/orchestrate` today.

| Path | Beta approach |
|------|----------------|
| Draft editor using **sync** orchestrate | Full Continue support |
| Draft via **SSE only** | Until NYV adds `completion` on `run_completed`: optional “Complete draft” action that calls sync Continue (§6) with accumulated stream text as `priorContent` |

---

## 10. Optional: accept draft to matter memory (later)

Not required for Continue. When advocate confirms filing-ready:

```json
"options": { "counselAccepted": true }
```

(or `acceptToMatterKnowledge: true`) on a **separate** save action — not on every Continue.

---

## 11. QA checklist (30 min)

> **Live NYV curls + field paths:** [`NSP-NYV-CONTINUE-LIVE-ARTIFACTS-2026-10.md`](./NSP-NYV-CONTINUE-LIVE-ARTIFACTS-2026-10.md) (deploy **`2026-10-09T1741Z-aws-ssm`**).

- [ ] First draft 200 + non-empty `content`
- [ ] If incomplete, show Continue when `continuationAvailable === true`; if `incompleteReason === segment_budget`, offer **Counsel async** (NYV exhausted auto-segments in one HTTP call)
- [ ] Continue returns 200; `content.length` ≥ prior; no full rewrite from scratch
- [ ] `requestPhase: degraded` still renders editor (no timeout toast)
- [ ] Export still blocked when `attestationRequired` / placeholders (unchanged)
- [ ] Regenerate **new thread** does not send `continueIncomplete`

---

## 12. Files NSP typically touches

| Layer | Change |
|-------|--------|
| BFF / API client | Forward `options.continueIncomplete`, `priorContent`, `segmentIndex` |
| Types | `PartnerCompletion` on orchestrate response |
| Draft UI | Banner + Continue handler + `DraftContinueState` |
| Worker | Pass-through `options` if poll path uses worker |

**Do not change:** URLs, auth headers, `taskType` ladder, or map `degraded` to 5xx.

---

## 13. Deploy order

1. **NYV** — **DONE** nysdev **`2026-10-09T1741Z-aws-ssm`** (completion loop + beta flags + trust-tier memory).  
2. **NSP** BFF forward + UI (can ship same release or +1 day).  
3. Smoke: one bail + one writ draft; Continue path per live artifacts doc.

Evidence: `npm run partner:smoke:ec2` (NYV); NSP E2E one Continue path.
