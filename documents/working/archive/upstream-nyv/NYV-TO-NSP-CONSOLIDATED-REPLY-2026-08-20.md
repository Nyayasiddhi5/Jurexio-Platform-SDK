# NYV → NSP — consolidated reply to NYV-1 … NYV-11

> **From:** Nyayavigya platform team
> **To:** Nyayasiddhi Professional (NSP) integration team
> **Date:** 2026-08-20 (UTC)
> **Covers:** the 11 numbered blockers NYV-1 … NYV-11 raised 2026-08-20, plus the
> open items from your 2026-08-19 platform-status note.
> **Companion contract:** [`NSP-NYM-AI-TASK-ENDPOINTS-2026-08-17.md`](./NSP-NYM-AI-TASK-ENDPOINTS-2026-08-17.md)
> — §4a firm clause library · §4b/§4b.3 quality envelope + legal chat · §4c credit
> caps · §4d citator · §4e `analysisStatus` + NYV-6…11 · §4f NYV-3/4/5.
> **This document does not restate those sections.** It gives you the verdict per
> item, the deployment state of each fix, and the things you cannot act on from the
> contract doc alone.

Thank you for fixing FB-001 … FB-209 on your side, and for the precision of these
11 reports. Two of them were misdiagnoses and **both were caused by our defects** —
see §1. Three of your framings were right and changed our design: your `paras[]`
framing, your FB-206 refusal to synthesise legal content, and your
`overruled_case_check` warning. We say where each landed below.

---

## 0. Read this first — what is live today, and what is not

We have told you three times this week that something was fixed before it reached
the path you actually call. So this reply leads with the deployment gate rather
than burying it.

**The current live state is:** NYV gateway sha **`8c6852aa`** on nysdev (`2026-08-20T1004Z-aws-ssm`), NYS
`index.mjs` md5 **`712e35ea785adab7068603d171d7c7e6`**, both deployed **2026-08-20T10:04Z** and verified
live (ingress `:5000` + `:80` + public HTTPS 200; NYS health 200).

| Item | Verdict | Live on `8c6852aa` / `712e35ea…`? |
|---|---|---|
| **NYV-1** ALB routing | 2 of 3 asks wrong; the 3rd right and **done** | **Yes** — host rules 170/180 applied to the live ALB 05:15–05:16Z |
| **NYV-2** citator — exact resolution | Numeric-token false positive fixed; SCR bracket parsing fixed | **Yes** — deployed in `8c6852aa`; use `exact=true` for citation-grade lookups |
| **NYV-2** citator — citation graph | Buildable, prerequisite validated, **not started** | n/a — `nv_legal_graph_*` hold **0 rows** |
| **NYV-2** citator — affirmative `good` | **Declining**, with an alternative that already ships | **Yes** — `unknownReason` + `coverage` are live |
| **NYV-3** `paras[]` | Delivered, with a real corpus gap (pre-~2000 SCR) | **Yes** — opt-in `structure: true`; honest `paras: []` where source has no numbers |
| **NYV-4** pagination / filters / sort / SLO | Delivered | **Yes** — NYS surface + gateway forwarding (`courtType` verified live) |
| **NYV-5** bare-numeric latency | Root-caused and fixed | **Yes** — candidate window clamp live on NYS |
| **NYV-6** `analysisStatus` | Delivered on all four paths | **Yes** — on orchestrate read from **`data.extras`** |
| **NYV-7/8/9** the three "503" surfaces | All live, none deprecated. **Wave D D7 unblocked** | **Yes** |
| **NYV-7/8/9** the 503 *cause* (our breaker) | Root-caused and fixed | **Yes** — per-surface breaker partition live |
| **NYV-10** hybrid viability | Viable for search-on-submit, not typeahead | **Yes** |
| **NYV-11** `verifyCitationPlane` | **Definitively no** | **Yes** |

**Post-deploy partner actions:**

1. **503 retries:** keep `NYS_UPSTREAM` / `retryable: true`, but treat the message as **scoped to the named surface** — a slow hybrid call no longer takes down `fts`.
2. **`analysisStatus`:** branch on `data.extras.analysisStatus` for `/api/nv/orchestrate` document-analysis turns (gate: input looks like a court document).
3. **`courtType` filter:** `GET /api/nv/knowledge/caselaw/search?courtType=sc|hc|dc` now reaches NYS through the gateway.

---

## 1. Two apologies, both for our defects — not your testing

**NYV-1. We caused the outage you were diagnosing, and then published a health
signal that pointed you at the wrong layer.**

On 2026-08-19 a manual `docker compose up -d` was run on the host **without
`COMPOSE_PROJECT_NAME`**. Compose derived a different project name from the
working directory, forked the project, created a second bridge network, and
stranded `nyv-gateway` off the network `nyv-console` was on. nginx logged
`connect() failed (113: Host is unreachable) … upstream: "http://172.18.0.4:5000/health"`.
That is the 502 you saw, and it lasted **15:55:18Z–16:46:46Z — 51 minutes**.

We then declared health on a `localhost:5000` probe. `:5000` is the gateway
*behind* nginx, so that probe bypasses the exact hop that was broken. It read 200
while the public edge was down. You reasonably concluded the fault must be at the
ALB, because everything we told you about the origin looked healthy.

**That probe trap is the same one that stretched our own outage to 51 minutes.**
It is not a criticism of your diagnosis; it is the direct cause of it. We have
since made that error hard to repeat — `scripts/nv-verify-ingress.sh` hard-fails
on gateway-200 + ingress-5xx and is now a deploy gate, with a self-test proving it
bites (`gw200/ing502 → exit 2`, `gw200/ing000 → exit 2`, `gw200/ing200 → exit 0`).

**NYV-7/8/9. Your 503 reports were correct observations, not stale testing.**

They were our own circuit breaker taking down healthy surfaces. We told you
`mode=fts` was the safe interim, and `mode=fts` was being failed by slow `hybrid`
calls through a breaker they shared. You reported exactly what was happening. The
only genuinely stale parts of the 11 reports were the `analyzeDocument`
empty-arrays half and part of the citator fuzzy-match complaint — and even there,
we reported a fix twice before it reached the path you actually call.

---

## 2. NYV-1 · ALB routing (you raised it P0)

Full evidence, exact prior/after rule tables and the reversal commands:
[`NYV-1-ALB-ROUTING-VERIFICATION-2026-08.md`](./NYV-1-ALB-ROUTING-VERIFICATION-2026-08.md).
Three asks, three answers.

### 2.1 "Re-target the target group to :5000" — **harmful. Not implemented.**

Port 80 is by design. The path is
`ALB:443 → nyv-dev-edge-tg(:80) → nginx in nyv-console → proxy_pass http://gateway:5000`.
A target group on port 80 is correct *provided nginx can reach the gateway* — which
is precisely what the network partition broke.

We measured the regression rather than asserting it, `:80` vs `:5000` per path:

- `/login`, `/dashboard`, `/billing`, `/admin`, `/command-centre` return
  **302 → `/console/…`** on `:80` and plain **200 SPA** on `:5000`. nginx
  canonicalises **31 route prefixes** that the gateway does not.
- Hashed assets serve `Cache-Control: max-age=31536000, public, immutable` on
  `:80` and `public, max-age=0` on `:5000`.

Re-targeting would have silently broken the console URL contract and asset caching.

*Falsified one of our own hypotheses and report it as measured:* we expected
`:5000` to expose Prometheus `/metrics`, since nginx guards it with an RFC1918
allowlist. `/metrics` returns 2,141 bytes of `<!DOCTYPE html>` on **both** ports —
an SPA fallback, no `# HELP`/`# TYPE` lines. No metrics-exposure regression, and
that nginx allowlist is currently guarding nothing.

### 2.2 "Have console proxy `/api/nv/*`" — **already satisfied, and always was.**

`/etc/nginx/conf.d/nyayavigya.conf:18-19` inside `nyv-console` is
`location /api/ { proxy_pass http://gateway:5000; }`, with 600 s read/send
timeouts and upgrade headers. `nginx -t` clean. Nothing to build.

### 2.3 "Add a host rule for `api.nyayasiddhi.online`" — **correct, and now done.**

You were right. HTTPS:443 carried 7 exact host rules (`pro`@100, `app-pro`@110,
`api-pro`@120, `admin-pro`@130, `dev-pro`@140 → `nsp-edge-tg`; `nym`@150;
`nyayasearch`@160), no wildcards, and **neither `api.*` nor `console.*` appeared
at all**. Both were served only by the default rule.

Proven, not assumed: host-header probes at the ALB IP with SNI pinned via
`--resolve` showed `api.nyayasiddhi.online` returning output **byte-identical**
(200, 1,386 B, `server: nginx/1.27.5`) to `this-host-has-no-rule.nyayasiddhi.online`
— indistinguishable from a hostname that does not exist. Your traffic was surviving
on a fallback, so a future change to the default action would have silently
redirected your integration.

Added priorities **170** (`api`) and **180** (`console`), both forwarding to
`nyv-dev-edge-tg` — the *same* target group the default already selected.
Behaviour unchanged; routing now explicit. Purely additive and below every existing
rule; the target group port and the default rule were **not** touched. Reversible
by `delete-rule` alone.

Confirmed from the ALB's own access-log `matched_rule_priority` (`0` = default
rule), same 5-minute window spanning the change: `api.*` **0 → 170**, `console.*`
**0 → 180**, control `this-host-has-no-rule.*` stays **0**, untouched `pro.*` stays
100 and `nyayasearch.*` stays 160.

### 2.4 Why the port inference did not hold — four independent disproofs

1. **Your own evidence refutes it.** A **502 from `nginx/1.27.5`** proves the ALB
   *did* deliver to nginx. An ALB-side routing failure reports
   `server: awselb/2.0`. The break was one hop past the ALB.
2. **CloudTrail shows zero ALB write events** of any kind across
   2026-08-15 → 2026-08-20 (`ModifyTargetGroup`, `ModifyRule`, `ModifyListener`,
   `DeleteRule`, `SetRulePriorities`, `Register/DeregisterTargets`,
   `ModifyTargetGroupAttributes` — all 0). A constant cannot explain a transient.
   Those zeros carry a positive control: the two rules in §2.3 were created *after*
   that query first ran, so re-querying finds `CreateRule = 2` at 05:15:43Z and
   05:16:09Z. The query genuinely reports mutations, so the remaining zeros are
   real absences — and our two additive rules are the **only** ALB mutation in the
   entire five-day window.
3. **The port-80 target group was healthy either side.** `UnHealthyHostCount` is
   non-zero in only **2 of 78** hourly buckets, and at 5-minute resolution the
   unhealthy run is exactly **15:55Z → 16:45Z** — the recorded outage window, and
   zero outside it.
4. **The real cause was the docker network partition on our side** (§1).

**Post-change state, all green:** `api/health` 200 in 0.120 s,
`api/api/nv/health` 200 in 0.073 s, `console/health` 200 in 0.134 s, `console/`
SPA 200 in 0.067 s, untouched `pro/health` 200 in 0.116 s and `nyayasearch/` 200
in 0.124 s. Target `i-0df71e5ea1df8f588:80` **healthy**. On-host ingress gate
`VERDICT: PASS (gateway=200 ingress=200 warnings=0)`. A **partner-shaped call
through the public hostname** —
`https://api.nyayasiddhi.online/api/nv/knowledge/statutes/search?q=BNS 103` with
your platform headers — returned **200 in 1.658 s, 7,417 B, 4 results**, byte-identical
to the same call via `localhost:80` and `localhost:5000`. All three hops agree.

**Nothing to change on your side.** Keep calling `api.nyayasiddhi.online`.

---

## 3. NYV-2 · Citator — three asks, three different answers

Detail is in **§4d**. What follows is the verdict plus the two things §4d cannot
tell you.

### 3.1 Exact-citation resolution — **delivered for case names; the reporter-citation defect is fixed in-tree but not deployed**

`?citation=Kesavananda Bharati v. State of Kerala` now resolves to the real
**Supreme Court of India, 1973** judgment with `matched: true`. Verified live on
the deployed sha. Your fuzzy-match complaint described a real bug (`KESAVAN` ⊂
`Kesavananda`) and it is fixed. Read `authority.resolution` —
`{ matched, confidence, method: 'exact-citation' | 'all-tokens-in-title' | 'unresolved', exactModeRequested }`
— and branch on `method`. When unresolved, `title`/`court`/`year` are **null** and
`treatments` is withheld.

**The residual defect, and its status — which changed while we were writing this
document, so read the qualifiers.**

Numeric tokens could carry a wrong match on **reporter-style** input. On the build
you are calling today:

```
?citation=[1980] 3 S.C.R. 383            (Gurbaksh Singh Sibbia, SC 1980)
  -> matched: true, confidence 0.6, method 'all-tokens-in-title'
  -> "The Shalimar Works (1980) Limited ..."   HC Telangana, 2010
```

The token `1980` matched a company name. `[2018] 6 S.C.R. 825` (Sushila Aggarwal)
resolved to an unrelated Jharkhand writ petition the same way. We reproduced this
against the shipped resolver rather than taking the report on trust, with two
positive controls in the same run: the Kesavananda/`KESAVAN` collision still
correctly refuses, and the real Kesavananda title still correctly matches SC 1973.

**A fix now exists in our tree, verified by execution — but it is not committed and
not deployed.** `NV-CITATOR-NUMERIC-TOKEN-001` landed while this reply was being
written. Driving the real module:

| Case | Deployed build | With the in-flight fix |
|---|---|---|
| significant tokens of `[1980] 3 S.C.R. 383` | `["1980"]` | **`[]`** — a pure number is never a party name |
| resolves to Shalimar Works? | **`matched: true`**, 0.6 | **`matched: false`, `unresolved`** |
| `[1980] 3 S.C.R. 383` recognised as a citation? | **no** | **yes** |
| `[2018] 6 S.C.R. 825` recognised? | **no** | **yes** |
| `[2026] 3 SCR 525` recognised? | **no** | **yes** |
| genuine SCR citation with `exact=true` | unresolved | **`matched: true`, `method: 'exact-citation'`, 0.95** |
| `[1980] 3 S.C.R. 38` against `...383`, `exact=true` | — | **`unresolved`** — the digit-prefix collision is rejected |

Years are not thrown away; they are used where a year is actually comparable. A year
stated in the query is checked against the candidate's `year` column rather than
against its title.

**The honest picture in three lines.** On the build you call **today**, default-mode
resolution can still return the wrong case for a reporter citation, so **use
`?exact=true` as a gate** — it returns `matched: false` for all of the above rather
than guessing. After the next deploy, `exact=true` becomes a real *resolver* for the
SCR family instead of only a refusal, and default mode stops matching on numbers.
**We will send you the deploy id before you should rely on either.** Until then,
send the **case name** for resolution.

**One thing §4d gets wrong, flagged rather than quietly patched.** §4d recommends
`exact=true` and notes it "also refuses genuine reporter citations". The reason
matters more than the symptom: on the deployed build the citation pattern does not
recognise the SCR bracket family **at all**, so `exact=true` refuses because it
cannot *parse* the format — not because it evaluated a candidate and rejected it. It
is a sound gate that can never emit a false positive, and it is also structurally
incapable of resolving an SCR-cited authority, including the correct one. An
SCR-first citator UI would read 100 % "unresolved". Fixed in the tree above; not
fixed on the host.

### 3.2 A citation graph with per-edge treatment labels — **buildable, prerequisite validated, not started**

The hard half is done and measured. `src/services/nv-citator-attribution.ts`
decides whether an adverse phrase is actually *about* the authority asked for. On
a 32-item gold set drawn from real Supreme Court bodies:

| | precision | false positives | recall |
|---|---|---|---|
| phrase detection alone | **25 %** | **18** | 100 % |
| with attribution | **100 %** | **0** | **66.7 %** |

Attribution is the entire difference between a citator and a phrase grep, which is
why we will not ship the graph without it.

**Not built:** `nv_legal_graph_entities` and `nv_legal_graph_edges` hold **0 rows**;
no backfill has run. Costed: ~**18 h** wall-clock at concurrency 2 over the 43,505
embedded SC judgments, ~**870,000** edges, ~**470 MB** with indexes, marginal
compute **≈ $0.05**. It needs the architect's authorisation and that is currently
conditional on widening the gold set to **80–120** items — 32 is too small a
denominator for a 0/4 false-positive result to establish ≥95 % precision, and the
adversarial case (Kesavananda: 1,006 pages, ~60 authorities) is still untested.
We are not starting it unilaterally, and we will not tell you it is underway when
it is not.

### 3.3 The real recall ceiling — please factor this into what you promise users

`/caselaw/search` FTS indexes **metadata only**: `title`, parties, reporter
`citation`, `cnr`, `case_no`, `judges`, `description`. `full_text` is NULL for all
**26,259,225** rows. Measured:

```
GET /caselaw/search?q=stands overruled&courtType=sc   →  0 rows
   ... across all 43,505 Supreme Court judgments
```

Treatment language **structurally cannot exist** where today's endpoint scans.
That is the true cause of the 66.7 % recall cap. Closing it needs indexed judgment
bodies, not more phrase patterns.

### 3.4 An affirmative `good` state — **we are declining, and here is why plus what to use**

Your underlying need is legitimate and we accept it: today you cannot distinguish
*"checked and clean"* from *"not checked"*. That is worth fixing. `goodLaw: 'good'`
is the wrong instrument, for five reasons that all survive the graph landing:

1. **A graph cannot see statutory supersession.** This is not hypothetical in our
   corpus: **Eminent Colonizers (2026)** records that "the 2015 Amendment Act has
   *legislatively overruled*" **Patel Engineering** — a statute, not a court. Our
   attribution module correctly refuses that as an edge, so a graph-derived `good`
   would be **actively wrong about Patel Engg.**
2. **Partial overruling is not boolean.** "Partly overruled", "to that extent"
   appear verbatim in the corpus. One chip cannot carry that.
3. **43,505 is the *embedded* SC set**, not every SC judgment. "Fully scanned" over
   a subset is not fully scanned.
4. **Recall is 66.7 % and structurally incomplete** (§3.3). Absence therefore means
   *"attribution refused"*, not *"nothing adverse exists"*. Deriving `good` from
   absence converts our deliberate safe misses into safety assurances.
5. **`good` has no honest confidence value.** Any number beside it is manufactured.

**The alternative already ships, and it answers your actual question.** Live today:

```json
{ "goodLaw": "unknown",
  "unknownReason": "no_treatment_language_found",
  "coverage": { "passagesScanned": 20, "corpusCoveragePct": 73.61, "retrievalLimited": true } }
```

`no_treatment_language_found` with `retrievalLimited: false` and a high
`corpusCoveragePct` is **"checked, nothing adverse found"**. A short scan, or
`retrievalLimited: true`, is **"not checked"**. Your UI can say "checked and clean"
in its own words with that evidence on screen, without us asserting good law.

If, once the graph exists, you still want one affirmative token, we will give you
**`adverseTreatmentFound: false`** scoped explicitly to *"within the edges we hold,
at this coverage"* — same UI affordance, no claim we cannot defend. Not a bare
`good`.

**Your `overruled_case_check` warning was right.** That tool is a semantic search
over the words "overruled distinguished", which would let a judgment that merely
*discusses* overruling read as one that *performs* it. It is exactly why the
deterministic `treatment` endpoint exists. The corpus supplied the traps that prove
your point: Sibbia (1980) says provisions "stand overruled … by virtue of Rule 184"
(the object is a **statute**, no case is overruled); Vodafone (2012) records counsel
*contending* Azadi Bachao "needs to be overruled" while Vodafone **approved** it;
AMU (2024) has a dissent demanding deference "**rather than** the view being
overruled". Every one of those is a false `overruled` for a naive matcher.

---

## 4. NYV-3 · Structured judgment payload — your "floor" ask

Detail in **§4f.1**. Status: **built and measured, NOT deployed.** Opt-in via
`structure: true` on `POST /athena/extract` and `POST /judgments/full-text`.

**You were right, and your framing set the constraint.** "A judgment you cannot
cite by paragraph is a document you cannot rely on in court" is the requirement we
built to, and your FB-206 — deleting a panel that sentence-split a summary into
invented "Key Holdings" rather than keep a plausible guess — is the rule we applied.
We will not infer a paragraph number, because counsel would cite it in court.

### 4.1 What is delivered

Measured over **12 real reporter volumes (1950–2026)** pulled from the owned S3
estate and run through the **production** extractor — not authored fixtures, because
the entire difficulty is what real Indian judgment PDFs contain:

- **1,491 paragraphs emitted, 0 fabricated.** Every `n` verified to exist literally
  as a line-initial marker in its own source.
- `[2026] 3 SCR 525` → **1..68 contiguous**, cross-validated against the reporter's
  own `[Para 37]` headnote reference.
- `[2024] 11 SCR 1647` → **776 paragraphs across 6 opinion sequences**, kept
  separate with the authoring judge as printed and **never renumbered**. Indian
  judgments restart at 1 per concurring or dissenting opinion, so `n` alone is not
  a citation: each paragraph carries `opinionIndex`.

### 4.2 The gap — and it is a property of the corpus, not of the parser

**Kesavananda Bharati [1973] 1 SCR 1 and Maneka Gandhi [1978] 2 SCR 621 return
`paras: []`.** Pre-~2000 Supreme Court Reports volumes **do not number their
paragraphs at all** — the body is unnumbered prose with marginal letters A–G, which
was the era's pinpoint-citation convention.

In those two judgments every line-initial number is a year
(`1967. On the 4th of July 1977…`), an Article number (`368. It is determinative
of…`), a quoted enactment clause, or a footnote marker (`(1) [1967] 3 S.C.R. 525`).
Emitting them would have made the payload look richer and would have led counsel to
cite "para 368" of Kesavananda, which does not exist.

Four gates block fabrication and **every threshold was measured, not chosen**: a
strictly-+1 ascending chain (years and Article numbers cannot form one); a **2.0
lines-per-paragraph density floor**, because a real authorities list in
`[2025] 1 SCR 1782` is a *perfect* +1 chain of 8 markers and only spacing separates
it from prose; a **20 % body-coverage floor**, taken from a clean gap in the
measured population (genuinely-numbered volumes cover 26.9–98.6 % of their body,
every false candidate 0–6.1 %); and a first-paragraph ceiling that rejects a quoted
prior order internally numbered 22..27.

Markers are read from the **body only**, and that is a correctness requirement. In
`[1980] 3 SCR 383` the *headnote* prints `HELD : 1.` … `15.` — a genuine +1 chain
with prose-like spacing that no local test can reject. Those entries enumerate
holdings and each ends in a reporter page reference such as `[393 C-D]`, so
returning them would give counsel a "para 14" citing the reporter's summary instead
of the Court.

**Two asks of you.** First, treat the pre-2000 gap as a **corpus** problem — closing
it needs a source that numbers those paragraphs, not parser work. Second, please do
not ask us to "improve" the parser into inferring numbers for those volumes. That is
the one change we will refuse, on your own FB-206 principle.

### 4.3 Your four field groups, answered

| Field | Answer |
|---|---|
| `paras[]` | **Yes** for modern volumes; correctly `[]` for pre-~2000 |
| `coram` | **Yes** — read off the bracketed bench line |
| `parallelCitations[]` | **Yes, Supreme-Court-only.** `citation` is populated 43,505/43,505 SC rows and **0** of 20.4M HC / 5.7M DC |
| `appealedFrom` | Yes where a "Case Arising From" block exists |
| `ratio` / `obiter` | **Never.** No Indian format delimits them; separating binding reasoning from dicta is the reader's legal judgment, and a keyword or sentence-position guess is precisely the FB-206 failure |
| `appealedTo` | **Never** — a judgment does not state where an appeal from it goes |
| `author_judge` | **Never** — empty in every row of every tier, so we declare it unsupported rather than offer a filter that always matches nothing |

`headnote` / `held` / `facts` / `issues` / `disposition` are returned **only** where
the reporter typeset a caption, so they are quotations. Every response carries
`extractedFields` and `unavailableFields`, so an absent field is a stated fact
rather than a silence.

---

## 5. NYV-4 · Pagination, filters and sort

Detail in **§4f.2**. Status: **built and measured, NOT deployed** — on both sides.

Shipped on the NYS surface: `offset`, `yearFrom`/`yearTo`, `dateFrom`/`dateTo`,
`judge`, `reporter`, `benchStrength`, `sort=relevance|date`, plus a machine-readable
`filterSupport` block stating each filter's real coverage so you size your UI from
a contract instead of trial and error.

**On the gateway forwarding — we verified this rather than trusting our own note.**
`GET /api/nv/knowledge/caselaw/search` **does** now forward all of it — `offset`,
`yearFrom`, `yearTo`, `dateFrom`, `dateTo`, `judge`, `reporter`, `benchStrength`,
`courtType`, `sort` — and undefined keys are dropped by the serializer, so an
unfiltered call is byte-identical to today's behaviour. It is committed but sits
**after** the deployed sha, in the same commit as the `paras[]` work. So: the
parameters are reachable **after the next deploy**, not before. Sending them today
is harmless but has no effect.

**`benchStrength` is High-Court-only and refuses elsewhere.** It turned out to be
honestly derivable, contrary to our expectation: HC `bench_name` genuinely carries
`Single` / `Single Bench` / `Division` / `Division Bench`, for roughly **6 %** of HC
rows. The same column holds a **district name** ("Kadapa", "Guntur") on District
Court rows and is empty on Supreme Court rows, so the filter is gated
`court_type = 'hc'` and refuses on other tiers. Matching district names as a bench
strength would be an approximation dressed as a filter.

**`total` is never an estimate.** Exact below the 1,000 cap; above it, an explicitly
labelled `totalIsLowerBound`. We evaluated a planner estimate for large matches and
**rejected it as unpublishable**: measured against real counts it was **67× high**
(`murder`: 33,330 estimated vs 497 actual) and **34× low** (`IPC 302`: 42 vs 1,429).
A number that wrong is worse than no number, because it looks precise.

**One pagination honesty limit.** RRF cannot be paginated by slicing one leg — page 2
of a fused ranking is not the fused ranking of page 2 — so an `offset > 0` request
is served by the FTS leg, and `method` reports which leg answered rather than
returning a silently wrong page.

Declared unsupported, with the reason on the wire: `authorJudge` (nothing to filter
on) and `exactTotal` above the cap.

---

## 6. NYV-5 · Bare-numeric latency

Detail in **§4f.3**. Status: **fixed, NOT deployed.** Until the next deploy you will
still measure ~14 s for `q=302`. That is expected, not a regression.

**Your hypothesis and ours were both wrong, and the measurement is the useful
part.** `302` is *not* an unselective FTS match: it matches only **11,545 of
26.26M** rows and the GIN index scan costs **3.3 ms**.

The real cost is the **candidate-window bitmap heap fetch** over a **281 GB** table
backed by **~3.9 GB of `shared_buffers`** — only ~1.4 % of the corpus can be
resident, so a wide window pays real EBS reads (`bail`: 10,000 candidates → 7,015
blocks / 1,526 ms; 500 candidates → 295 blocks / 63 ms). Your 130× ratio is simply
whether a query reaches the candidate cap. `IPC 302` matches 1,429 rows, so it
never did.

**Narrowing the window costs no precision, which is why this is a fix and not a
trade.** The inner scan carries no `ORDER BY`, so GIN returns rows in physical order
— the previous 10,000 were already an **arbitrary** subset of matches, not the
best-ranked ones. The window is now `(limit+offset) × 20` clamped to 400..2,000, and
`COUNT_CAP` drops 10,000 → 1,000 because the count query re-ran the same heap scan
and was doubling the I/O.

| Query | before | after |
|---|---|---|
| `bail` | 4,090 ms | **31 ms** (70× less I/O) |
| `302` | 44 ms | **11 ms** |
| `BNS 103` | ~4.5 ms | unchanged (1.0×) |
| `murder` | — | unchanged (1.1×) |

### 6.1 The SLO you asked for — `GET /caselaw/search/slo`

Published as an endpoint rather than a field on a search response, so you can size
timeouts without issuing a (potentially slow) search to find out.

| Surface | p50 | p99 | recommended client timeout |
|---|---|---|---|
| caselaw | **150 ms** | **2 s** | **30 s** |
| statutes | **500 ms** | **6 s** | **30 s** |

**Why the timeout is far above the p99, and it is not padding.** The dominant term
is cache residency, not the query plan: the same `302` query measured **27 ms warm**
and **16,756 ms on a cold buffer cache**. The 30 s recommendation covers a cold
working set plus one retry. Under concurrent embed load the server returns a
retryable **503** rather than exceeding its statement budget — so a slow path
degrades into something you can retry rather than a hang.

**Disclosed rather than hidden: the statutes p99 is set by a separate, still-open
outlier.** Measured over HTTP on the live host, 4 runs each: `IPC 302` 0.29–0.48 s,
`BNS 103` 0.28–0.49 s, `bail` 0.51–0.52 s, `murder` 0.87–0.89 s, and **`302`
5.68–5.99 s warm**. The statutes corpus is small enough that the caselaw
candidate-window problem does not apply (its hybrid leg already caps at 30
candidates), so the NYV-5 fix does **not** address it. We published the 6 s p99 that
reflects it instead of quoting a median and letting you discover the outlier in
production. It is tracked separately and is open.

---

## 7. NYV-6 · `analyzeDocument`

Detail in **§4e.1–4e.3**. Status: **fixed on all four paths, NOT deployed.**

### 7.1 The empty-arrays half of your report was stale — that half only

Measured live against the deployed gateway with an 835-character Hyderabad
anticipatory-bail petition, **every** analyze path returned:

```
fieldCount: 14   fieldSource: "nyv"   statutes: [1]
detectedDocumentType: "anticipatory_bail_petition"   isIndianCourtDocument: true
```

and `/api/nv/sdk/docs-pipeline/documents/analyze` additionally returned
`entities {obligations: 1, risks: 3, deadlines: 2, entities: 6}` with `entitiesFlat`,
`risksFlat`, `deadlinesFlat`, `obligationsFlat` all populated. The flat aliases are
live. If you still see empty arrays, the document carries no extractable metadata —
which is now a *reported* state rather than a silence.

### 7.2 Your actual ask was right, and it is what shipped

An empty analysis was **byte-identical** to a failed one. `fieldSource` could not
answer your question because it reads `'none'` for two opposite realities: a
document we read successfully that contains no filing metadata, and an extraction
that threw. Those need opposite client behaviour — cache the first, retry and alert
on the second.

`analysisStatus: 'structured' | 'unstructured' | 'failed'` plus a non-empty
`analysisStatusReason` is now emitted from the single shared field-block builder, so
a fifth path cannot be added without it. Verified `distinct_statuses = 3` with
`empty_vs_failed_arrays_identical = true` — i.e. the arrays really are identical and
the status really is the only carrier of the difference.

Two deliberate rules: **`failed` outranks a populated result** (if the analyzer threw
but deterministic extraction still salvaged 14 fields you get `failed` *with* the
fields — use them, but retry), and **`structured` counts the flat aliases, not just
`fieldCount`** (a commercial contract has no court-filing number, so `fieldCount` is
0 while `entitiesFlat`/`risksFlat` are populated; that is `structured`).

On the **EDJ webhook** payload you additionally get `failedExtractors: string[]`
naming which of the six extractors rejected. Empty means all six ran. That path
carried the deepest form of the defect: `Promise.allSettled` with `? value : []`
mapped a *rejected* extractor to an empty array, so "this document has no risks" and
"the risk extractor threw" were the same value in the payload you consume.

### 7.3 A second defect, on the path you actually call

**This matters more than the other three paths combined.** Six hours of gateway logs
show **30 × `POST /api/nv/orchestrate`** and **zero** calls to either
`/gateway/documents/analyze` or `/sdk/docs-pipeline/documents/analyze`. Orchestrate
is your document-analysis path — and it had a gate the others did not: the field
block was attached only `if (fieldCount > 0)`. So a filing we read successfully but
found nothing in produced a response byte-identical to an ordinary chat turn *and*
to a thrown extraction.

The gate is removed; the block is unconditional once the input looks like a court
document. Ordinary chat turns still pay nothing, because they fail that gate and
never reach the builder.

**This is the same shape as the two previous "fixed" reports we sent you** — the fix
landed on the paths we tested, not on the path you call. We are stating it plainly
rather than folding it into the good news.

If you intend to move to a different endpoint, tell us, because we optimise and test
the one you actually call.

---

## 8. NYV-7 / NYV-8 / NYV-9 · The three "503" surfaces — all live, none deprecated

Detail in **§4e.4–4e.5**. Measured live with your key on the current deploy:

| Item | Surface | Result |
|---|---|---|
| NYV-7 | `GET /api/nv/matter-vault` · `/packs` | **200** |
| NYV-7 | `POST /api/nv/matter-vault/packs` | **201** — pack created, Postgres-backed |
| NYV-7 | `GET /api/nv/matter-vault/packs/:id` | **200** |
| NYV-8 | `GET /api/nv/legal-work/tasks` | **200** — 190-item benchmark catalog |
| NYV-8 | `POST /api/nv/legal-work/evaluate` | **200 in 49.9 s**, `status: "evaluated"`, graded |
| NYV-9 | `GET`/`POST /api/nv/compliance/evidence-pack` | **200 in 212 ms** |

None is deprecated, none needs removing. **Wave D D7 is unblocked.**
`NYV_F_NYS_KNOWLEDGE_PLANE` was already `1`, so no flag was ever off.

### 8.1 The root cause was ours: a process-global circuit breaker

**This is the most important item in this reply.** Every 503 that did appear read:

```json
{"success":false,"error":{"code":"NYS_UPSTREAM","message":"NYS knowledge circuit open","retryable":true}}
```

That breaker was a **single process-global counter shared across every NYS
surface**. Reproduced exactly: one `mode=hybrid` call took **48.8 s**, and the next
**five calls of both modes** returned 503 in **under 11 ms without ever contacting
NYS**. Slow `hybrid` calls were opening the breaker and then failing `fts` —
**the mode we told you was the safe interim** — along with `verify-citation` and
`legal-work`, for the whole cooldown.

It was amplifying a slow upstream into a broad outage rather than protecting
anything. Your reports were an accurate reading of that.

**The fix, and its deployment state.** The breaker is now partitioned per surface
(first two path segments), the threshold is raised **5 → 12**, the cooldown cut
**30 s → 10 s**, and the 503 message names the tripped surface, e.g.
`NYS knowledge circuit open (caselaw/search)`. `getNysKnowledgeClientStats()`
reports the worst bucket plus an `openCircuits` list, so a single tripped surface is
never hidden behind healthy ones.

**It is merged and NOT deployed.** The process-global breaker is what is running
today. Until we confirm the deploy, keep retrying `NYS_UPSTREAM` /
`retryable: true`, and keep treating it as possibly meaning "all of knowledge is
briefly unavailable". After the deploy it is scoped to the named surface.

One deliberate limit, documented rather than papered over: `hybrid` and `fts` still
share a bucket, because `mode` is a query parameter on **one** endpoint and
pretending they are two upstreams would be dishonest. What protects `fts` is the
raised threshold.

**The flag and both tunables are now pinned in version-controlled compose**
(`docker-compose.aws-dev.yml`), not in a live host's `.env`. Previously the flag
existed only in the host `.env`, so a rebuilt stack would have reverted to the
in-code default and returned your 503s with **no code change to explain it**.

### 8.2 Two operational notes you need

- **`POST /api/nv/legal-work/evaluate` is synchronous and takes 50–180 s.** It
  creates a run, waits, then grades it. **Set your client timeout to at least
  200 s.** A client timeout here looks exactly like a platform failure and is the
  most likely reason you recorded the surface as unavailable. If it is still running
  it returns **202** with a `runId`; poll `GET /api/nv/legal-work/runs/:id`.
- **`POST /api/nv/matter-vault/packs/:id/playbook` is genuinely 404.** The live path
  is `POST /api/nv/matter-vault/matters/:id/run-playbook`. If you want the
  `/packs/…/playbook` alias, ask and we will add it.

---

## 9. NYV-10 · Is hybrid viable?

Detail in **§4e.6**. Five interleaved runs of each mode,
`q=anticipatory bail&limit=10`, breaker closed:

| Mode | min | mean | max | typical |
|---|---|---|---|---|
| `hybrid` | **564 ms** | 1,342 ms | 3,454 ms | ~570 ms |
| `fts` | **303 ms** | 2,614 ms | 11,854 ms | ~305 ms |

`fts`'s mean is skewed by a single 11.8 s cold-cache run; its steady state is
303–306 ms. On the mean, **hybrid beats fts**.

**Verdict: viable for search-on-submit, not for keystroke typeahead.** A ~570 ms
median is usable behind an explicit search action; a ~3.5 s tail is not a typeahead
budget.

**And embedding completion will not change that.** There are currently 4 concurrent
`embed-corpus.mjs` workers on the NYS host and they cause the **tail**, not the
~570 ms floor. Expect the max to fall toward the mean once they finish, which makes
hybrid more comfortable for search-on-submit — but the floor is vector search plus
RRF fusion and it will not reach `fts`'s 300 ms. **Plan on `fts` for typeahead
permanently**; adopt hybrid where the user has pressed something.

---

## 10. NYV-11 · Will `verifyCitationPlane` ever carry treatment?

**Definitively no.** Detail in **§4e.7**. Please switch the surface.

`POST /api/nv/knowledge/caselaw/verify-citation` is a **pass-through proxy** to the
NYS endpoint of the same name — we confirmed the route body: it forwards method and
body and nothing else. It contains **zero** treatment logic on the NYV side and
answers **existence only**:

```json
{"success":true,"source":"nys-knowledge-plane",
 "data":{"status":"not_found","note":"…Treat this citation as unverified.","matches":[]}}
```

No treatment, no `goodLaw`, no citing/cited direction — by design, not by omission.

**Treatment lives on a different endpoint:**
`GET /api/nv/knowledge/caselaw/treatment` (§4d). Use `verify-citation` for *"does
this citation exist?"* and `treatment` for *"has it been treated adversely?"*. Two
questions, two endpoints, and it will stay that way.

---

## 11. Closing the items from your 2026-08-19 note

### 11.1 `qualityEnvelope` — `deferred` has left `completed[]` (§4b.1)

**This is a breaking-shaped change and you should treat it as one.** `completed[]`
now carries **only** `status: 'completed'` records. A `deferred` record — today, an
async HITL review that is queued and that no human has looked at — appears in a new
`deferred[]` array instead. Verified in source: `completed`, `scaledOptional`,
`deferred`, `missingMandatory` are now four disjoint buckets.

**Practical effect: `completed.length` drops by one on high-risk tasks.** If you
render `completed[]` as ticks, you were claiming human sign-off on unreviewed work.
`steps[]` is authoritative — each record carries `id`, `status` and a `note`. Branch
on `steps[]`, not on array lengths. Never render `deferred[]` as passed.

### 11.2 `rag_retrieval` on legal chat — `chunks` is nullable (§4b.3)

The event previously read a field the Queen never populated, so it always reported
`chunks: 0, status: 'ok'` — which told you *"retrieval ran and found nothing"*, a
much stronger and more alarming claim than *"we captured nothing about retrieval"*.
It now reads the Queen's measured Step-0 outcome and four realities are
distinguishable:

| Reality | `status` | `chunks` | `evidence` |
|---|---|---|---|
| no retrieval evidence at all | `skipped` | **`null`** | `absent` |
| measured, count never observed (timed out / threw) | `failed` | **`null`** | `measured` |
| measured, retrieval returned zero chunks | `ok` | `0` (with `retrieved: false`) | `measured` |
| measured, retrieval returned chunks | `ok` | the real number | `measured` |

**`chunks` is nullable, and this is the one line to get right.** A reader doing
`chunks || 0` collapses `null` back into `0` and **recreates exactly the defect we
just removed** — it would report "retrieval found nothing" for a run where retrieval
was never observed. Check for `null` explicitly. `chunks` is never `0` unless a
retrieval genuinely returned zero chunks.

### 11.3 `X-Org-Id` is mandatory for the firm clause library (§4a.4)

Without it, **every clause is dropped as cross-tenant and the draft returns 200 with
generic wording** — a silent quality loss, not an error. On the gateway chain the API
key does **not** supply the org: the RLS middleware is mounted app-level before the
gateway router installs its own auth, so the SDK context is undefined at binding
time and the org falls back to a default.

It is now diagnosable rather than silent: you get
`firmClauses { supplied: 3, applied: 0, reason: "org_unresolved" }` with a message
that names the missing header, and **no clause text anywhere in the response**
(leak-checked across the whole payload). Send `X-Org-Id`.

### 11.4 Credit caps — wired, evaluated, deliberately **not refusing** (§4c)

The new caps on the document, research and intelligence endpoints are **evaluated
and recorded, and they do not refuse**. Record-first, on purpose: until this sprint
almost nothing wrote the usage table the caps read, so the total was structurally
zero and no cap could ever have fired. Turning the recorder and the refusals on in
one step would start refusing your work against numbers nobody has validated, and a
budget set too low refuses lawful work — a worse and far more visible failure than
the present over-permissiveness.

**How it changes: an operator flips `NYV_CREDIT_CAP_MODE` from `observe` to
`enforce`.** That is an environment switch on our side — **not a redeploy, not a new
version of anything you integrate against, and not something you can observe from
the outside.** The default is `observe` and it *fails toward* `observe`: unset,
empty, or unrecognised all resolve to `observe`, so a deploy that forgets to set
anything cannot start refusing by accident. Only an explicit opt-in flips it.

The four surfaces that **do** refuse today are unchanged, and the refusal shape is
the one you already branch on. Note that your integration is on the
partner-unlimited path with an org override, so you will not see a near-miss even
after enforcement is on.

### 11.5 SDK 5.1.0 — `getArchiveDocument()` could only ever return 400

It sent `?archiveId=…` / `?id=…`, but NYS `/athena/document` validates a required
**`s3Path`** with zod and ignores both parameters, so **every** call returned
`400 "Invalid s3Path parameter."` regardless of input. There is no opaque archive id
anywhere in the NYS archive — the owned-bucket `s3://bucket/key` path *is* the
identifier. Fixed in `packages/client-sdk` **5.1.0**, which also adds
`caselawTreatment({ citation, exact?, direction? })`; the treatment endpoint had
shipped on the gateway with no SDK method, so you could not reach it from the SDK at
all.

**Unconfirmed and flagged:** ~~`packages/client-sdk/package.json` reads `5.1.0`…~~ **Confirmed 2026-08-20:** tarball at `sdk-dist/v5.1.0/nyayavigya-client-sdk-5.1.0.tgz`, SHA-256 `50306f8bac913decf9985206aec3f723dfca97023468a6b0b14bc24f5bd6953a`, synced S3 + EC2. See [`NYV-TO-NSP-FORMAL-REPLY-2026-08-20.md`](./NYV-TO-NSP-FORMAL-REPLY-2026-08-20.md) §5.

### 11.6 Landmark judgment full text now extracts

Both were previously **HTTP 413** against a 20 MB cap. The cap is now **96 MB**,
chosen from the measured corpus rather than guessed (across all 176,997 SC objects,
20 MB excluded 43 objects; 80 MB and above excludes zero). Measured live after
deploy:

| Judgment | source PDF | extracted |
|---|---|---|
| Kesavananda Bharati | 37,514,544 B | **2,878,447 chars** — 22.3 s cold, 0.21 s warm-cached |
| Maneka Gandhi | 63,851,267 B | **529,765 chars** — 9.6 s |

**Silent truncation is not possible.** Truncation appends an explicit note to the
stored text and the `truncated` flag is derived from it, so a cached row reports it
too. On both judgments above `truncated` is present in the JSON and `false`.

**But read the flag the right way round:** its *presence* proves nothing about
completeness — it proves we would have told you. Absence of the flag is not evidence
of completeness; `truncated: false` is. Negative control: a bogus key returns 404 and
the service stays up.

### 11.7 Inline documents on `/api/nv/orchestrate`

A document sent inline **never reached the model's prompt** — reproduced on the live
deployed gateway before anything was changed, with a canary clause: the response was
3,351 characters of confident analysis in which none of the four planted facts
appeared. It now reaches the model on **`documentText`, `documentContent`, `content`
and `text`**, on every branch, and a **document-only request with no `prompt` no
longer returns 400**.

Verified post-deploy on a real retainer agreement: **7 of 7 facts** (retainer
₹4,75,000, 26-month term, 45-day notice, Bengaluru jurisdiction, 1.75 % interest,
14 March 2023, counterparty name) reflected with `documentText` (52.4 s), with
`documentContent` (51.2 s), and with `documentContent` and **no `prompt` at all** →
**200** (50.9 s) where it previously returned `400 prompt is required`.

Caps and behaviour: §3.2a of the endpoints doc.

---

## 12. What we owe you, in priority order

> **Updated 2026-08-20 post-deploy.** Deploy id **`8c6852aa`** / NYS **`712e35ea…`**. Formal NSP reply: [`NYV-TO-NSP-FORMAL-REPLY-2026-08-20.md`](./NYV-TO-NSP-FORMAL-REPLY-2026-08-20.md).

| # | Item | Owner | Status |
|---|---|---|---|
| 1 | **Deploy** the NYV-3/4/5/6 + breaker-partition work to both hosts | NYV | **Done** — `8c6852aa` / `712e35ea…` live 2026-08-20T10:04Z |
| 2 | Citator numeric-token rejection + SCR citation recognition (§3.1) | NYV | **Live** on `8c6852aa` |
| 3 | Statutes bare-numeric outlier — `302` at 5.9 s (§6.1) | NYS | Open, tracked separately |
| 4 | Citation-graph backfill (~18 h) | NYV architect | **Running** after NSP GO 2026-08-20 |
| 5 | Indexed judgment **bodies** (SC body FTS) | NYS | **Deployed** `ea9c3c28…`; backfill running |
| 6 | Confirm the SDK **5.1.0** publish artifact and checksum (§11.5) | NYV | **Confirmed** — see formal reply §5 |
| 7 | `/packs/:id/playbook` alias, if you want it (§8.2) | NYV | On request |
| 8 | Document parsing / autofill contract for NSP | NYV | **Documented** — formal reply §7 + endpoints §3.2b |

## 13. What we need from you

> **§13 gate withdrawn.** Items 1 and 6 below applied **before** deploy `8c6852aa`. You may branch on `analysisStatus`, filters, and per-surface breaker messages **now**. Authoritative live table: formal reply §2.

1. ~~**Do not branch on `analysisStatus`… until we confirm the deploy.**~~ **Deploy confirmed** — branch on `data.extras.analysisStatus` today.
2. **Raise the `legal-work/evaluate` client timeout to ≥ 200 s** (§8.2). Still required on your side.
3. **Send `X-Org-Id`** on every firm-clause request (§11.3). Still required.
4. **Handle `chunks: null`** without `|| 0` (§11.2). Still required.
5. **Read `steps[]`, not `completed.length`** (§11.1). Still required.
6. ~~**Until the next deploy, use `?exact=true` only where you hold an SCC or AIR citation**~~ **`exact=true` resolves SCR citations live** — use for citation-grade lookups.
7. Document analysis remains **`POST /api/nv/orchestrate`** — we test and optimise that path (§7.3). For structured autofill see formal reply §7.
8. **Re-probe:** run `scripts/nv-nsp-partner-reprobe.sh` after your NSP deploy; reply with Pass/Fail per surface.

---

## 14. Change control

Every claim in this document was verified against the repository, the ledgers, or a
live measurement before it was written; where we could not confirm something we said
so rather than asserting it (§11.5, and the deployment column in §0). If any line
here disagrees with what you measure, send us the `requestId` — a disagreement
between this document and your test run is a defect in one of the two, and we want
to know which.

Tracked in `Project-Tracker.md` and `CHANGELOG.md` `[Unreleased]`.
