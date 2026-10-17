# NSP ↔ NYV construct crosscheck (beta-safe)

> **Audience:** NSP backend, BFF, mobile/web leads, beta QA  
> **Updated:** 2026-10-13T12:45:00Z (UTC)  
> **NYV bundle:** Option B program pack (Phases 1–4 in repo; **live deploy pending** merge gate)  
> **Principle:** **No mandatory NSP wire changes** for existing beta teams. NYV improvements are **server-side** and **additive** on responses.

**Related (detail):**

| Doc | Use for |
|-----|---------|
| [`NSP-NYV-AI-TASK-SURFACE-2026-09.md`](./NSP-NYV-AI-TASK-SURFACE-2026-09.md) | Task → endpoint matrix (already **PASS** for beta wiring) |
| [`NSP-NYV-AI-HANDSHAKE-2026-09.md`](./NSP-NYV-AI-HANDSHAKE-2026-09.md) | Full orchestrate/stream contract, §4g Continue |
| [`NSP-DRAFT-CONTINUE-FAST-IMPLEMENT-2026-10.md`](./NSP-DRAFT-CONTINUE-FAST-IMPLEMENT-2026-10.md) | Optional Continue UX (1–2 days; not required for beta stability) |
| [`NSP-OPTION-B-95-RELEASE-PROGRAM-2026-10.md`](./NSP-OPTION-B-95-RELEASE-PROGRAM-2026-10.md) | NYV quality gates & 95% roadmap (**NYV + SME**; not a beta blocker) |

---

## 1. Executive summary for beta

| Question | Answer |
|----------|--------|
| Will NYV Option B / quality work **break** current NSP beta if NSP ships **nothing**? | **No** — same URLs, same `taskType` aliases, same `content` success shape. |
| Must beta teams change API payloads before next NYV deploy? | **No** — all new NYV fields are **optional on request** and **additive on response**. |
| What improves without NSP changes? | Draft token floors, completion loop, rubric-aligned scoring on NYV side, structure checker, forum/CNR **when you already send** `parameters`. |
| What should NSP **avoid** changing during beta? | Task type renames, moving off `/orchestrate`, new required body fields, switching to `POST /api/nv/gateway/documents/draft`. |
| When should NSP change anything? | **Optional** UX (Continue button), **optional** quality pass-through (below), or **after** NYV deploy when you want higher rubric scores—not for stability. |

---

## 2. Construct map (who owns what)

```text
NSP (product)                    NYV (platform)
─────────────────                ─────────────────
UX, matter, session              Auth, platform policy (nsp)
buildNyvOrchestrateWire()        Queen vs specialist routing
Headers: Platform, User-Id       PII, quality envelope, audit hash
Persist requestId, auditHash     LLM ring, citations verify
Export / attestation gates       draftQuality, completion*, trust
Continue button (optional)       Auto-continue + segment options
CNR resolve call (optional)      mergeCnrFactsIntoOrchestrateBody
Template picker (optional)       templateId → prompt anchor
```

NYV **never** requires NSP to adopt new UI to keep **HTTP 200 + content** working.

---

## 3. Crosscheck matrix (beta teams)

Use this to audit your **current** beta BFF against NYV. Status **OK** = no change required for beta.

| # | Construct | NYV expectation | If beta already does… | NSP change for beta? |
|---|-----------|-----------------|-------------------------|----------------------|
| 1 | **Entry point** | `POST /api/nv/orchestrate` or `/stream` | Same | **None** |
| 2 | **Forbidden path** | Do **not** use `POST /api/nv/gateway/documents/draft` for product drafts | Not used | **None** (if used → migrate once, not beta-blocking if orchestrate works) |
| 3 | **Interactive draft** | `taskType: legal-draft-fast` | Same | **None** |
| 4 | **Interactive chat** | `taskType: legal-chat-fast` | Same | **None** |
| 5 | **Comprehensive draft** | Worker → `legal-draft` + `options.draftLength: comprehensive` | Wired per handshake §3.4 | **None** if already async worker |
| 6 | **Headers** | `X-API-Key`, `X-NYV-Platform: nsp`, `X-NYV-User-Id` (recommended) | Present | **None** |
| 7 | **`parameters.documentType`** | Recommended; NYV **infers** if missing (**200**, not 400) | Omitted or sent | **None** — optional: start sending for better routing (no version bump) |
| 8 | **`options.draftLength`** | `low` / `medium` / `comprehensive` | Sent on drafts | **None** |
| 9 | **`parameters.cnrFacts` / resolve** | Optional; NYV merges `cnrResolve` into parameters | Not sent | **None** for beta — **optional** pass-through when matter has CNR (quality only) |
| 10 | **`parameters.matterRecall`** | Optional string or `{ summary, stage, lastOrder }` | Not sent | **None** for beta — **optional** when matter vault has summary |
| 11 | **`parameters.templateId`** | Optional catalog anchor | Not sent | **None** for beta — **optional** when user picks template from `/api/nv/templates` |
| 12 | **`ragDocumentIds`** | When docs indexed | Sent or not | **None** — keep indexing path; avoid huge inline PDF paste |
| 13 | **Response `content`** | Primary body | Rendered | **None** |
| 14 | **`draftQuality`** | Structure hints, `inferredDocumentType`, `routingHint` | Ignored or partial | **None** — optional: show comprehensive upgrade banner (already done on some Pro builds) |
| 15 | **`completion` / `continuationAvailable`** | §4g Continue contract | Ignored | **None** for stability — **optional** Continue UX per Continue guide |
| 16 | **`qualityEnvelope`, `riskBadge`, `auditHash`** | Compliance | Logged or not | **None** — recommended: persist `requestId` + `auditHash` (you likely already do) |
| 17 | **Stream gated deltas** | `gated: true` → **replace** editor body | Append bug? | **Fix only if** you append gated drafts (behavior fix, not NYV version) |
| 18 | **Web search / research / CNR / docparse** | Dedicated routes in task surface | Per matrix PASS | **None** |

---

## 4. Proper NSP changes (by priority)

### P0 — Do **not** do during beta (risk to testers)

- Rename or split `taskType` values beta clients already send.
- Make new request fields **required** in BFF validation.
- Force all drafts through a new endpoint or SDK major bump.
- Rotate API keys or change `X-NYV-Platform` value.
- Block responses when `optionalDegraded: true` but `content` is non-empty.

### P1 — **Optional**, additive, low risk (quality + UX; ship when ready)

| Change | Where | Beta impact |
|--------|-------|-------------|
| Pass **`parameters.documentType`** when user selects doc type in UI | BFF wire | Better inference; same JSON shape |
| Pass **`parameters.cnrFacts`** after `cnr/resolve` (subset of resolve payload) | Matter-linked drafts | Richer cause title; optional |
| Pass **`parameters.matterRecall`** one paragraph from matter vault | Matter-linked drafts | Optional |
| Pass **`parameters.templateId`** when user picks template | Template flows | Optional |
| Read **`continuationAvailable`** + Continue button | Draft UI | UX only; see Continue guide |
| Honor **`draftQuality.routingHint`** for comprehensive CTA | Draft UI | Already on some Pro builds |

**Implementation pattern (additive only):**

```typescript
// Extend existing parameters object — do not replace the wire helper.
parameters: {
  ...existingParameters,
  ...(documentType && { documentType }),
  ...(cnrFacts && { cnrFacts }),
  ...(matterSummary && { matterRecall: matterSummary }),
  ...(templateId && { templateId }),
},
```

### P2 — After NYV deploy + merge gate (95% program; not beta)

- Expand automated QA per [`NSP-OPTION-B-95-RELEASE-PROGRAM-2026-10.md`](./NSP-OPTION-B-95-RELEASE-PROGRAM-2026-10.md).
- SME sign-off on sample matters.
- E2E comprehensive worker smoke in prod (handshake §3.4).

---

## 5. NYV-side changes (for NSP awareness — no NSP action)

These land on **NYV deploy**; beta clients keep the same wire:

- Phase 1 rubric tier / doc-type completion / token truth (draft quality measurement).
- Phase 2 depth hints + fast structure checker.
- Phase 3 matter/template **prompt** injection when optional parameters are present.
- Completion loop + trust fields (already live on **`2026-10-09T1917Z`** class deploys for §4g).

**NSP crosscheck after NYV deploy:** run existing beta flows + `npm run nsp:ai:matrix:ec2` (ops); no BFF change required unless you opt into P1.

---

## 6. Beta verification checklist (NSP QA)

Run against **your current beta build** + `https://api.nyayasiddhi.online` (no code changes):

1. **Legal chat fast** — stream completes; `content` non-empty; no 4xx on valid key.
2. **Legal draft fast** — medium draft returns `content`; optional `draftQuality` present.
3. **Comprehensive path** — worker poll returns final `content` (if beta uses it).
4. **Instant search / CNR** — unchanged knowledge + resolve routes.
5. **Regression:** same `sessionId` multi-turn chat still works.
6. **Continue (if UI not shipped):** confirm responses still 200 when `continuationAvailable` is true (ignore flag).

If all pass → **no NSP construct change required** for beta continuity.

---

## 7. One-page decision for PM

| Goal | NSP action |
|------|------------|
| Keep beta stable | **Ship nothing** on the wire; verify checklist §6 |
| Better incomplete-draft UX | **P1 Continue** only ([Continue guide](./NSP-DRAFT-CONTINUE-FAST-IMPLEMENT-2026-10.md)) |
| Better matter-linked draft quality | **P1 optional** `cnrFacts` / `matterRecall` pass-through |
| Template-led drafts | **P1 optional** `templateId` when catalog UI exists |
| Public “95% quality” claim | Wait for NYV **release95** gate + SME sign-off; optional P1 helps scores |

---

## 8. Contact / evidence

- NYV task PASS matrix: `NSP-NYV-AI-TASK-SURFACE-2026-09.md`
- Live deploy id (beta baseline): see `deployment-status.md` / handshake banner — **post–Option-B deploy TBD**
- Questions on inference: read `draftQuality.inferredDocumentType` in responses instead of adding new required fields

**Tracker (NYV):** `Project-Tracker.md` — 2026-10-13T12:45:00Z NSP construct crosscheck doc.
