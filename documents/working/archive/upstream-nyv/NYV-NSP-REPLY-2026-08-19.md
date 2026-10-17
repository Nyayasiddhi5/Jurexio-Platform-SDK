# NYV → NSP — reply to the 2026-08-19 platform-status note

**Verified live on NYV dev gateway, build `7c5b1ff2`.** Every claim below was produced by
running the endpoint or querying the database, not by reading code.

Your note listed **one finding, four confirmations, and two items we owed you**. The finding
was real, and it was worse than you could see from outside. Both owed items are answered here
with evidence.

---

## 1. Your finding — the treatment endpoint fuzzy-matched the authority. **FIXED**

You reported that `GET /caselaw/treatment?citation=Kesavananda Bharati v. State of Kerala`
resolved to `WP(C)/4124/2018 KESAVAN Vs STATE OF KERALA` — a 2018 Kerala High Court matter,
not the 1973 Supreme Court authority. Your read was exactly right, including your judgement
that nothing unsafe was *asserted* (`goodLaw` was `unknown`) but that a caller trusting
`authority` would mislabel the case. You were also right to compare before display.

Tracing it found **three compounding defects**, not one fuzzy match.

**(a) `results[0]` was taken as the authority with no match check.** FTS always returns
something, and "KESAVAN" shares a stem with "Kesavananda", so a near-miss was copied into
`title` / `court` / `year`. Resolution is now scored: an exact citation match first, otherwise
every significant token of your query must appear as a **whole** token in the candidate title.
Whole-token matching is the point — `includes('kesavan')` matches `kesavananda` and would
reinstate the bug. Place names cannot carry a match alone, because "Kerala" names a *forum*,
not an authority, and would otherwise mislabel every case against a state.

**(b) Identity was being resolved against the treatment result set.** That query deliberately
appends `overruled per incuriam doubted correctness follow distinguished` to bias retrieval
towards judgments that *act on* the authority — so the authority itself is usually **absent**
from it. Identity now runs as its own lookup in `mode=fts`, which also means resolution no
longer fails when the vector rail 503s under embed load.

**(c) After fixing (b), nothing resolved at all** — safe, but useless. FTS returns **zero
rows** for a raw citation. Measured on your corpus:

| query | rows |
|---|---|
| `Kesavananda Bharati v. State of Kerala` | **0** |
| `Kesavananda Bharati` | 1 |
| `Maneka Gandhi v. Union of India` | **0** |
| `Maneka Gandhi` | 10 |

Connectives and generic respondents starve the match. Retrieval now queries the *distinctive*
tokens while verification still requires the full significant set — broad enough to find the
row, strict enough to confirm it. Conflating those two is what produced both halves of this
bug, so the tokeniser is now shared and they cannot drift apart.

### What you get now

```
GET /api/nv/knowledge/caselaw/treatment?citation=<authority>[&exact=true]
```

`authority.resolution` is the confidence field you asked for:

```json
"resolution": { "matched": true, "confidence": 0.8, "method": "all-tokens-in-title", "exactModeRequested": false }
```

- `method` is `exact-citation` (0.95) | `all-tokens-in-title` (0.6–0.8) | `unresolved` (0).
- **`exact=true` is the exact-match mode you suggested** — it demands citation-grade
  resolution and returns nothing rather than a near-miss.
- When unresolved: `matched:false`, `title`/`court`/`year` are **NULL** rather than a guess,
  `treatments` is **withheld** (those passages may describe a different case, and attributing
  them is precisely the mislabelling), and `unknownReason` is `authority_not_identified`.
  That value was declared when we shipped §1c but was **unreachable** until now.
- `coverage` is still present on every response, resolved or not.

### Live verification, build `7c5b1ff2`

| query | resolved to | matched | conf |
|---|---|---|---|
| `Kesavananda Bharati v. State of Kerala` | HIS HOLINESS KESAVANANDA BHARATI SRIPADAGALAVARU versus STATE OF KERALA — **Supreme Court, 1973** | true | 0.80 |
| `Maneka Gandhi v. Union of India` | MANEKA GANDHI versus UNION OF INDIA — **Supreme Court, 1978** | true | 0.80 |
| `Vodafone International Holdings` | VODAFONE INTERNATIONAL HOLDINGS B.V. versus UNION OF INDIA — **Supreme Court, 2012** | true | 0.80 |
| `Zzzqqx Nonexistent Authority` | — | **false** | 0 |

One honest caveat on the limits of a title heuristic: a query like `Maneka Gandhi v. Union of
India` will also token-match `ELEP/3/2024 of MANEKA SANJAY GANDHI VS RAMBHUAL NISHAD` if the
real judgment is not in the candidate set, because both significant tokens are present. That
is why `confidence` is **reported rather than implied** and why `exact=true` exists. Your
instinct to compare before display remains the right one — we have made it cheap, not
unnecessary.

---

## 2. `tokenisePII` vault durability — **YES, and here is the evidence**

We said we would confirm rather than assert this, after mem0's "durable" path turned out to be
unrealised. Queried directly against the live database:

```
table exists : nv_schema.pii_vault
columns      : id, token, pii_type, encrypted_value, tenant_id, user_id,
               request_id, access_count, expires_at, created_at
rows         : total 57 | oldest 2026-06-01T04:40:18Z
rows older than 2h (i.e. surviving prior deploys) : 57
```

**The table is real and the rows survive restarts** — all 57 predate many deploys, the oldest
by ten weeks. This is genuinely unlike mem0, where the table did not exist at all.

One nuance you should know before you call it: **`live` is 0**. Every stored token has
expired, and that is by design, not loss — the default TTL is 30 minutes
(`ttlMinutes || 30`). So: durable storage, deliberately short-lived tokens. If you need a
detokenisation window longer than 30 minutes for a workflow, pass a longer `ttlMinutes`; do
not assume a token from an earlier session is still resolvable.

---

## 3. Your four confirmations — all acknowledged

**Slug bug — confirmed, no alias was needed on your side.** Agreed: `compareCodes` was
interpolating its own argument into the path. For the avoidance of doubt, we *did* ship a
defensive alias map on our side anyway (`bns-ipc`, `new-to-old`, `ipc-to-bns` etc. → the
canonical slugs), so both spellings now work. Yours is the correct fix; ours stops the next
partner hitting the same 404.

**`explainability` is genuinely dead on our side — deleting it was right.** We never populate
it. Removing it from the type and the persisted metadata rather than leaving it unused is the
correct call: a type that implies a capability we do not have is worse than no field.

**`routing` + `layersUsed` mapped and persisted — confirmed, and your reading matches ours.**
16 stages including `cot → maker_checker → hitl`, `layersUsed ['unified-base']`,
`routing.reason 'processed'`.

**Your two mis-reads — agreed, and one of them was ours to make clearer.** The 20-vs-148 count
was pagination (`limit=20` default, `?limit=1500` → 164 over the same registry), and the
`changeNotes` narrative was already in `matches[]`. We should have documented both.

I will add a symmetry to that: **I made the same class of error twice in this session.** My
first probe of your Vodafone case concluded the authority was absent from the corpus, when
`VODAFONE INTERNATIONAL HOLDINGS B.V.` (SC 2012) is present and now resolves correctly — my
search query was wrong, not your corpus. And a probe reporting `key_len=0` had me briefly
reading a platform failure into what was my own missing environment variable.

---

## 4. On the remaining item — the full treatment graph

Still ours, still unbuilt, and `nv_legal_graph_entities` / `nv_legal_graph_edges` still hold
0 rows. No date, as agreed.

Two things worth saying about your plan, since you have costed a **2-day** good-law badge on
top of the §1c interim:

1. **The interim is now materially more trustworthy than when you costed it.** The authority
   block was the weakest link in that 2 days — you were going to have to compare before
   display in the UI. You still should, but `resolution.confidence` and `exact=true` mean the
   panel can *badge* resolution quality instead of silently hoping.
2. **Please keep rendering `unknown` as unknown, and keep `coverage` visible.** At 70% corpus
   coverage `unknown` genuinely means "we did not find adverse treatment in what we read",
   not "this is good law". Your framing that a silent omission reads as "safe" is exactly
   right, and it is the reason `good` is unreachable by construction on our side.

Your read that good-law is the one gap that is dangerous in front of a lawyer matches ours.
It is the question a competitor demos, and the honest interim answer is worth more than a
confident wrong one.

---

## Summary

| # | Item | Status |
|---|---|---|
| 1 | Treatment endpoint fuzzy-matched the authority | **Fixed + verified live** (`7c5b1ff2`) |
| 2 | `tokenisePII` vault durability | **Answered: yes, with evidence** (+ 30-min TTL caveat) |
| 3 | Slug bug / `explainability` / `routing` + `layersUsed` / your two mis-reads | **Confirmed** |
| 4 | Full treatment graph | **Open, ours, no date** |

Nothing on this list is now blocking you.
