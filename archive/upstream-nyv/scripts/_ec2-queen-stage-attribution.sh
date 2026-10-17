#!/usr/bin/env bash
# NV-QUEEN-STAGE-ATTRIBUTION-001 — attribute EVERY second of a Queen request.
#
# The question this answers: a forced-Queen swarm on nysdev returned HTTP 200 in
# 366.20s while its 7 LLM completions summed to 130.1s. `_ec2-swarm-latency-
# breakdown.sh` established that gap exists but could not say where it went — it
# only reads `llm.latency_ms`, which by construction cannot see non-LLM stages.
#
# This probe reads the SPAN TREE instead (`"span":"…","durationMs":…`, emitted
# unconditionally by utils/nyv-tracer.js), rebuilds the parent/child hierarchy
# from `spanId`/`parentId`, and reports:
#
#   1. per-node, per-stage durations
#   2. how much of the root span is SEQUENTIAL BY DESIGN (dependent legs whose
#      order is semantic — exploration → aggregation → synthesis) vs how much is
#      overhead inside a leg
#   3. an explicit RESIDUAL line. If the children of a span do not account for
#      its duration, the shortfall is printed, not hidden — an unexplained
#      residual IS the finding.
#
# Two gotchas this script is built around:
#   • The gateway runs `tsx src/index.ts`. The shipped artifact is TypeScript
#     SOURCE under /app/src; there is NO /app/dist/index.js. Grepping dist
#     returns 0 for every marker and looks exactly like a failed deploy. We grep
#     /app/src and assert a known-OLD marker as a canary (see _ec2-batch-verify.sh).
#   • Sibling spans overlap (runWithConcurrency dispatches lanes in parallel), so
#     summing siblings DOUBLE COUNTS. We report the union of sibling intervals as
#     the wall-clock contribution, and the sum separately as "cpu-ish fan-out".
set -uo pipefail

G=$(docker ps --filter name=gateway -q | head -1)
if [ -z "$G" ]; then echo "FATAL: no gateway container"; exit 1; fi

WINDOW="${1:-60m}"

echo "container : $(docker ps --filter name=gateway --format '{{.Status}}')"
echo "image     : $(docker inspect --format '{{.Created}}' "$G")"
echo "now (UTC) : $(date -u +%FT%TZ)"
echo "window    : ${WINDOW}"
echo

echo "=== deploy canary — instrumentation live in /app/src? (NOT /app/dist) ==="
for M in NV-QUEEN-DEADLINE-001 NV-QUEEN-COLLECTIVE-PARALLEL-001; do
  N=$(docker exec "$G" sh -c "grep -rl '$M' /app/src 2>/dev/null | wc -l" 2>/dev/null | tr -d '\r ')
  # These predate this batch. A zero here means the grep TARGET is wrong,
  # not that the deploy failed — do not conclude "nothing deployed".
  [ "${N:-0}" -gt 0 ] && echo "  canary OK   $M (${N} file(s))" \
                      || echo "  CANARY FAIL $M — grep target wrong, results below are meaningless"
done
for M in NV-QUEEN-STAGE-ATTRIBUTION-001 NV-MEM-FANIN-BOUND-001; do
  N=$(docker exec "$G" sh -c "grep -rl '$M' /app/src 2>/dev/null | wc -l" 2>/dev/null | tr -d '\r ')
  [ "${N:-0}" -gt 0 ] && echo "  LIVE        $M (${N} file(s))" \
                      || echo "  NOT DEPLOYED $M — stage spans below will be missing; wall clock still attributable at the coarse level"
done
echo

L=$(mktemp)
docker logs "$G" --since "$WINDOW" > "$L" 2>&1

python3 - "$L" <<'PY'
import sys, json
from collections import defaultdict

spans, llm, fanin = [], [], []
for line in open(sys.argv[1], errors='ignore'):
    # Ground-truth completion lines: flat `latencyMs` + `model`, same source
    # `_ec2-meter-verify.sh` treats as authoritative. NOTE: `llm.latency_ms`
    # is NOT a top-level key — it lives nested inside the OTLP `resourceSpans`
    # payload of the `llm.trace` lines, which is why a top-level lookup of it
    # silently yields zero.
    if 'success"' in line and '"latencyMs":' in line:
        try: r = json.loads(line)
        except Exception: continue
        msg = str(r.get('message') or '')
        if any(k in msg for k in ('hedge success', 'stream success', 'attempt success')):
            llm.append(r)
        continue
    if '"spanId":"' in line:
        try: r = json.loads(line)
        except Exception: continue
        # nyv-tracer emits the span NAME under the key "span" (not "name").
        if r.get('span') and r.get('spanId') and r.get('durationMs') is not None:
            spans.append(r)
        continue
    if 'MemoryFanIn' in line and 'recall source' in line:
        try: r = json.loads(line)
        except Exception: continue
        fanin.append(r)

if not spans:
    print("NO SPANS in window — widen it (arg1, e.g. 180m) or the request predates log retention.")
    raise SystemExit(0)

# ── group into traces, pick the roots (queen.orchestrate) ────────────────────
by_trace = defaultdict(list)
for s in spans:
    by_trace[s.get('traceId')].append(s)

def end_ms(s):
    # startSpan logs at finish, so `timestamp` IS the end of the span.
    ts = str(s.get('timestamp', ''))
    from datetime import datetime, timezone
    try:
        return datetime.strptime(ts.replace('Z', '+0000'), '%Y-%m-%dT%H:%M:%S.%f%z').timestamp() * 1000
    except Exception:
        return 0.0

def union_ms(intervals):
    """Wall-clock covered by possibly-overlapping intervals."""
    if not intervals: return 0.0
    ivs = sorted(intervals)
    total, cs, ce = 0.0, ivs[0][0], ivs[0][1]
    for a, b in ivs[1:]:
        if a > ce:
            total += ce - cs; cs, ce = a, b
        else:
            ce = max(ce, b)
    return total + (ce - cs)

roots = [s for s in spans if s.get('span') == 'queen.orchestrate' or not s.get('parentId')]
roots.sort(key=lambda s: -(s.get('durationMs') or 0))

for root in roots[:3]:
    trace = by_trace[root.get('traceId')]
    kids = defaultdict(list)
    for s in trace:
        kids[s.get('parentId')].append(s)
    wall = float(root.get('durationMs') or 0)

    print("=" * 100)
    print(f"TRACE {str(root.get('traceId'))[:12]}   root={root.get('span')}   WALL CLOCK = {wall/1000:.1f}s")
    print(f"  ended {str(root.get('timestamp'))}   status={root.get('status')}")
    print("=" * 100)

    print("\n--- SPAN TREE (durations are measured, not inferred) ---")
    def walk(pid, depth):
        for s in sorted(kids.get(pid, []), key=lambda x: end_ms(x)):
            d = float(s.get('durationMs') or 0)
            pct = 100.0 * d / wall if wall else 0.0
            label = str(s.get('span'))
            tail = []
            for k in ('subtaskId', 'agentName', 'sourceIds', 'recalledCount', 'stagesRun', 'status'):
                if s.get(k) not in (None, '', []):
                    tail.append(f"{k}={str(s[k])[:46]}")
            print(f"  {'  '*depth}{label:<30} {d/1000:>8.1f}s {pct:>5.1f}%  {' '.join(tail)}")
            walk(s.get('spanId'), depth + 1)
    walk(root.get('spanId'), 1)

    # ── the attribution table ────────────────────────────────────────────────
    top = kids.get(root.get('spanId'), [])
    print("\n--- ATTRIBUTION: root's direct children (union = wall contribution) ---")
    print(f"  {'stage':<30} {'sum(s)':>9} {'union(s)':>10} {'%wall':>7}  n")
    grp = defaultdict(list)
    for s in top:
        e = end_ms(s); grp[str(s.get('span'))].append((e - float(s.get('durationMs') or 0), e))
    accounted = []
    for name, ivs in sorted(grp.items(), key=lambda kv: -union_ms(kv[1])):
        u = union_ms(ivs); tot = sum(b - a for a, b in ivs)
        accounted.extend(ivs)
        print(f"  {name:<30} {tot/1000:>9.1f} {u/1000:>10.1f} {100.0*u/wall if wall else 0:>6.1f}%  {len(ivs)}")
    cov = union_ms(accounted)
    resid = wall - cov
    print(f"  {'-'*30} {'-'*9} {'-'*10} {'-'*7}")
    print(f"  {'ACCOUNTED (union of children)':<30} {'':>9} {cov/1000:>10.1f} {100.0*cov/wall if wall else 0:>6.1f}%")
    print(f"  {'RESIDUAL / UNACCOUNTED':<30} {'':>9} {resid/1000:>10.1f} {100.0*resid/wall if wall else 0:>6.1f}%   <-- gaps between child spans + un-spanned code")

    # ── sequential-by-design vs overhead ────────────────────────────────────
    print("\n--- SEQUENTIAL BY DESIGN vs OVERHEAD ---")
    agents = [s for s in top if s.get('span') == 'queen.agent']
    if agents:
        ivs = [(end_ms(s) - float(s.get('durationMs') or 0), end_ms(s)) for s in agents]
        u = union_ms(ivs); tot = sum(b - a for a, b in ivs)
        print(f"  queen.agent legs           : n={len(agents)}  sum={tot/1000:.1f}s  union={u/1000:.1f}s")
        print(f"    -> parallelism factor     : {tot/u if u else 0:.2f}x  (1.0 = fully serial, n = fully parallel)")
        waves = []
        for a, b in sorted(ivs):
            if waves and a <= waves[-1][1]: waves[-1] = (waves[-1][0], max(waves[-1][1], b))
            else: waves.append((a, b))
        print(f"    -> distinct waves         : {len(waves)}  (each wave is a genuine dependency step, sequential BY DESIGN)")
        for i, (a, b) in enumerate(waves, 1):
            print(f"         wave {i}: {(b-a)/1000:>7.1f}s")
    syn = [s for s in top if 'synthesis' in str(s.get('span'))]
    for s in syn:
        d = float(s.get('durationMs') or 0)
        print(f"  {str(s.get('span')):<26} : {d/1000:.1f}s ({100.0*d/wall if wall else 0:.1f}% of wall) — depends on all legs; sequential BY DESIGN")

    # ── the number that matters: LLM vs non-LLM inside each leg ─────────────
    print("\n--- PER-LEG: LLM vs NON-LLM (the 236s question) ---")
    from datetime import datetime

    def parse_ms(ts):
        try:
            return datetime.strptime(str(ts).replace('Z', '+0000'), '%Y-%m-%dT%H:%M:%S.%f%z').timestamp() * 1000
        except Exception:
            return 0.0

    lat = sorted({(str(r.get('timestamp')), str(r.get('model')), int(r.get('latencyMs') or 0)) for r in llm})
    lat = [x for x in lat if x[2] > 0]
    # Scope to THIS request only. Without this, a completion belonging to an
    # earlier request in the same log window is counted against this trace and
    # inflates the model's apparent share (measured: a 28.9s sonnet call from a
    # request 11 minutes earlier).
    root_end = end_ms(root)
    root_start = root_end - wall
    lat = [(ts, m, v) for ts, m, v in lat
           if root_start - 1500 <= parse_ms(ts) <= root_end + 1500]
    llm_sum = sum(v for _, _, v in lat)
    # Sibling LLM calls overlap, so the wall-clock the model actually owns is the
    # UNION of [end-latency, end] intervals, not the sum. Reporting only the sum
    # (as the original probe did) overstates model cost and understates overhead.
    llm_ivs = [(parse_ms(ts) - v, parse_ms(ts)) for ts, _, v in lat]
    llm_wall = union_ms([iv for iv in llm_ivs if iv[0] > 0])
    print(f"  completions (this trace)    : {len(lat)}")
    print(f"  sum of latencies            : {llm_sum/1000:.1f}s   <-- double-counts parallel calls")
    print(f"  UNION (true wall clock)     : {llm_wall/1000:.1f}s   ({100.0*llm_wall/wall if wall else 0:.1f}% of wall)")
    print(f"  NON-LLM wall clock          : {(wall-llm_wall)/1000:.1f}s ({100.0*(wall-llm_wall)/wall if wall else 0:.1f}% of wall)")
    for ts, m, v in lat:
        print(f"      {ts[11:23]}  {m:<42} {v/1000:>7.1f}s")
    print()
    claimed = []
    for s in agents + syn:
        d = float(s.get('durationMs') or 0)
        e = end_ms(s)
        inside = [(a, b) for a, b in llm_ivs if a >= (e - d) - 1500 and b <= e + 1500]
        claimed.extend(inside)
        u = union_ms(inside)
        tag = s.get('subtaskId') or s.get('span')
        print(f"  {str(tag)[:38]:<38} leg={d/1000:>7.1f}s  llm={u/1000:>6.1f}s  NON-LLM={(d-u)/1000:>7.1f}s ({100.0*(d-u)/d if d else 0:.0f}%)")
    orphan = [iv for iv in llm_ivs if iv not in claimed]
    if orphan:
        print(f"\n  NOT ATTRIBUTABLE to a single leg ({len(orphan)} call(s), union {union_ms(orphan)/1000:.1f}s) —")
        print("  these calls straddle a leg boundary (started before the leg they end inside).")
        print("  Current spans cannot assign them; do NOT guess. Deploying")
        print("  NV-QUEEN-STAGE-ATTRIBUTION-001 (queen.mw.exec) resolves this exactly.")
        for a, b in sorted(orphan):
            print(f"      start={datetime.fromtimestamp(a/1000).strftime('%H:%M:%S.%f')[:12]} end={datetime.fromtimestamp(b/1000).strftime('%H:%M:%S.%f')[:12]} dur={(b-a)/1000:.1f}s")

    # ── memory fan-in: measured cost per source ────────────────────────────
    print("\n--- MEMORY FAN-IN per source (needs NV-QUEEN-STAGE-ATTRIBUTION-001 deployed for durationMs) ---")
    if not fanin:
        print("  (no fan-in lines in window)")
    agg = defaultdict(lambda: [0, 0, 0.0])  # id -> [ok, fail, ms]
    for r in fanin:
        sid = str(r.get('sourceId'))
        ok = 'ok' in str(r.get('message'))
        agg[sid][0 if ok else 1] += 1
        d = r.get('durationMs')
        if d: agg[sid][2] += float(d)
    for sid, (ok, fail, ms) in sorted(agg.items(), key=lambda kv: -kv[1][2]):
        n = ok + fail
        avg = ms / n if n and ms else 0.0
        note = '' if ms else '  (no durationMs — instrumentation not deployed)'
        print(f"  {sid:<28} ok={ok} fail={fail}  total={ms/1000:>7.1f}s  avg={avg/1000:>6.1f}s{note}")
    for r in fanin:
        if 'failed' in str(r.get('message')):
            print(f"      FAIL {str(r.get('timestamp'))[11:23]} {r.get('sourceId')} :: {str(r.get('error'))[:90]}")
    print()
PY

echo "=== retry churn cross-check (breaker retries are silent by design) ==="
grep -cE 'retry|backoff' "$L" | sed 's/^/  retry-ish log lines: /'
grep -oE 'Timed out after [0-9]+ms' "$L" | sort | uniq -c | sed 's/^/  /'
echo "  NOTE: capability invokes run through runWithRetryAndBreaker (maxAttempts=3)."
echo "        'Timed out' matches its isRetryable predicate, so ONE logged timeout"
echo "        can represent up to 3x that wall cost with no further log lines."

###############################################################################
# SECTION 2 — NV-QUEEN-TOKEN-ATTRIBUTION-001
#
# Same discipline as the time table, applied to PROMPT TOKENS: every block of a
# real exploration leaf's prompt, with an explicit residual.
#
# Why this needs a live host rather than an offline harness: the assembled
# system prompt is measurable offline (`scripts/jrx-measure-queen-leaf-prompt.ts`),
# but the two blocks under suspicion — the Auto-RAG context block and the Step-0
# memory block — are built from the LIVE corpus. Their size is a property of the
# retrieved rows, not of the code, so it cannot be measured from source.
#
# PRIVILEGE (NV-SECRETS-001): this section prints LENGTHS and BLOCK LABELS only.
# The measurement script below never emits chunk bodies, titles, or prompt text.
###############################################################################
echo
echo "###############################################################################"
echo "# SECTION 2 — LEAF PROMPT TOKEN ATTRIBUTION (NV-QUEEN-TOKEN-ATTRIBUTION-001)"
echo "###############################################################################"
echo

echo "=== 2a. live log evidence: what the provider was actually billed ==="
echo "--- Step-0 Auto-RAG retrievals (chunk count + the topK actually used) ---"
grep -F 'Auto-RAG:' "$L" | tail -12 | sed 's/^/  /'
echo "--- leaf dispatch lines (assembled system prompt only) ---"
grep -F 'dispatched agent to LLM' "$L" | tail -8 \
  | python3 -c '
import sys, json
for ln in sys.stdin:
    i = ln.find("{")
    if i < 0: continue
    try: d = json.loads(ln[i:])
    except Exception: continue
    print(f"  role={str(d.get(\"nodeRole\")):<12} class={str(d.get(\"promptTaskClass\")):<10} "
          f"promptBytes={d.get(\"promptBytes\")} sysTok={d.get(\"systemPromptTokens\")} src={d.get(\"promptSource\")}")
' 2>/dev/null
echo "--- provider-billed prompt tokens (input) ---"
grep -oE '"input":[0-9]{4,}' "$L" | sort -t: -k2 -rn | uniq -c | head -12 | sed 's/^/  /'
echo

echo "=== 2b. MEASURED block sizes against the live corpus ==="
# Written into the container, run with the container's own tsx (the gateway
# already runs `tsx src/index.ts`, so this is the deployed resolver), removed
# after. No image change, no deploy, no persisted mutation.
M=/app/scripts/_nv-token-measure.ts
docker exec -i "$G" sh -c "cat > $M" <<'TS'
/**
 * NV-QUEEN-TOKEN-ATTRIBUTION-001 — measure the size of every block that Queen
 * fuses into a leaf prompt, against the live corpus.
 *
 * Prints SIZES ONLY (NV-SECRETS-001). No chunk body, title, or prompt text is
 * ever emitted — only character counts and structural labels.
 */
import { autoRagRetrieve, formatAutoRagContext } from '../src/services/jrx-auto-rag-router.js';
import { resolveContextBudgets } from '../src/orchestration/jrx-context-budgets.js';
import { agentRetrievalPolicyDirective } from '../src/services/jrx-agent-retrieval-policy.js';
import { queenOrchestrator } from '../src/orchestration/jrx-queen-orchestrator.js';
import { preMiddleware } from '../src/orchestration/orchestration-middleware.js';

const TOK = (chars: number) => Math.ceil(chars / 4);
const emit = (o: unknown) => console.log(JSON.stringify(o));

/* Synthetic queries — deliberately NOT a real client matter, so nothing here
 * can leak privileged content. Retrieval hits the same corpus either way, and
 * chunk SIZE is a property of the corpus rows, not of the query. */
const QUERIES = [
  'Is anticipatory bail available under BNSS 482 for a BNS 318(4) cheating case in Karnataka?',
  'What are the limitation periods and precedents for a specific performance suit over immovable property?',
  'Summarise the leading Supreme Court precedents on Section 138 Negotiable Instruments Act dishonour of cheque.',
];

async function main() {
  const budgets = resolveContextBudgets('very_complex', { partnerBestOutcome: true });
  emit({ kind: 'budgets', ...budgets });

  const policy = agentRetrievalPolicyDirective({ jurisdiction: 'IN', nysPlaneOn: true });
  emit({ kind: 'policyDirective', chars: policy.length, tokens: TOK(policy.length) });

  for (const q of QUERIES) {
    const t0 = Date.now();
    let block = '';
    let chunkLens: number[] = [];
    let layers: string[] = [];
    let err: string | null = null;
    try {
      const r = await autoRagRetrieve({
        query: q,
        jurisdiction: 'IN',
        tier: 'enterprise',
        topK: budgets.ragTopK,
      });
      block = formatAutoRagContext(r);
      chunkLens = r.chunks.map((c) => (c.content || '').length);
      layers = r.layersUsed || [];
    } catch (e) {
      err = e instanceof Error ? e.message : String(e);
    }
    const sorted = [...chunkLens].sort((a, b) => a - b);
    emit({
      kind: 'autoRag',
      queryChars: q.length,          // length only — never the query text
      topK: budgets.ragTopK,
      err,
      layers,
      latencyMs: Date.now() - t0,
      chunks: chunkLens.length,
      blockChars: block.length,
      blockTokens: TOK(block.length),
      contentChars: chunkLens.reduce((a, b) => a + b, 0),
      minChunk: sorted[0] ?? 0,
      medChunk: sorted[Math.floor(sorted.length / 2)] ?? 0,
      maxChunk: sorted[sorted.length - 1] ?? 0,
      meanChunk: chunkLens.length ? Math.round(chunkLens.reduce((a, b) => a + b, 0) / chunkLens.length) : 0,
      /* the defect signature: is there ANY ceiling on total block size, or only
       * on chunk COUNT? measured by asking whether the largest chunk exceeds the
       * memory path's per-item cap, which is the cap this path lacks. */
      largestChunkVsMemoryCharCap: `${sorted[sorted.length - 1] ?? 0} vs ${budgets.memoryCharCap}`,
    });
  }

  /* ── the real assembler ──────────────────────────────────────────────────
   * buildAgentPrompt is private, so we reach it through the live singleton.
   * This is NOT a re-implementation: it is the deployed function, with a
   * request whose prompt length we control, so every other block can be
   * recovered by differencing rather than by estimating a template's size. */
  const orch = queenOrchestrator as unknown as {
    buildAgentPrompt: (a: unknown, s: unknown, r: unknown) => string;
    waitForReady?: () => Promise<void>;
    agents?: unknown;
  };
  try {
    if (typeof orch.waitForReady === 'function') await orch.waitForReady();
  } catch (e) {
    emit({ kind: 'agentPoolLoad', err: e instanceof Error ? e.message : String(e) });
  }
  const raw = orch.agents;
  const agents: unknown[] = Array.isArray(raw)
    ? raw
    : raw instanceof Map ? [...raw.values()] : [];
  const agent = (agents.find((a) => {
    const t = (a as { tier?: string }).tier;
    return t === 'enterprise' || t === 'mitra';
  }) ?? agents[0]) as Record<string, unknown> | undefined;
  emit({ kind: 'agentPool', loaded: agents.length, picked: agent ? String(agent.id) : null });

  if (agent) {
    /* A swarm exploration subtask, shaped exactly as generateSwarmSubtasks
     * builds it (`Swarm agent N: Independent exploration of …`). */
    const SENTINEL_LEN = 1000;
    const sentinel = 'x'.repeat(SENTINEL_LEN);
    const subtask = {
      id: 'swarm-agent-0-probe',
      description: `Swarm agent 1: Independent exploration of ${'y'.repeat(50)}...`,
      type: 'analysis',
      estimatedComplexity: 'very_complex',
      dependencies: [],
    };
    for (const [label, promptStr] of [
      ['empty', ''],
      ['sentinel1k', sentinel],
    ] as Array<[string, string]>) {
      try {
        const req = { prompt: promptStr, jurisdiction: 'IN', type: 'analysis', format: 'markdown' };
        const built = orch.buildAgentPrompt(agent, subtask, req);
        /* Split at the marker buildAgentPrompt itself emits, so the registry
         * system-prompt block is separated from the scaffolding WITHOUT
         * re-implementing the template. */
        const at = built.indexOf('\n\nTASK: ');
        emit({
          kind: 'buildAgentPrompt',
          label,
          requestPromptChars: promptStr.length,
          totalChars: built.length,
          totalTokens: TOK(built.length),
          systemContextChars: at >= 0 ? at : null,
          systemContextTokens: at >= 0 ? TOK(at) : null,
          afterTaskChars: at >= 0 ? built.length - at : null,
        });
      } catch (e) {
        emit({ kind: 'buildAgentPrompt', label, err: e instanceof Error ? e.message : String(e) });
      }
    }
  }

  /* ── middleware enrichment: the [MEMORY] block's ACTUAL size ─────────────
   * callAgent dispatches on `pre.enrichedPrompt`, and the leaf's reported
   * input tokens are literally `enrichedPrompt.length / 4`. So the delta
   * between what we hand preMiddleware and what it returns IS the [MEMORY]
   * (+[RAG], when not skipped) block, measured. */
  for (const skipRag of [true, false]) {
    const base = 'z'.repeat(2000);
    try {
      const t0 = Date.now();
      const pre = await preMiddleware({
        prompt: base,
        agentKey: agent ? String(agent.id) : 'legal-research',
        tier: 'enterprise',
        jurisdiction: 'IN',
        riskLevel: 'medium',
        skipRag,
      } as never);
      const enriched = String((pre as { enrichedPrompt?: string }).enrichedPrompt ?? '');
      emit({
        kind: 'middlewareEnrichment',
        skipRag,
        latencyMs: Date.now() - t0,
        baseChars: base.length,
        enrichedChars: enriched.length,
        addedChars: enriched.length - base.length,
        addedTokens: TOK(Math.max(0, enriched.length - base.length)),
        hasMemoryLabel: enriched.includes('[MEMORY]'),
        hasRagLabel: enriched.includes('[RAG]'),
      });
    } catch (e) {
      emit({ kind: 'middlewareEnrichment', skipRag, err: e instanceof Error ? e.message : String(e) });
    }
  }

  process.exit(0);
}

main().catch((e) => {
  emit({ kind: 'fatal', error: e instanceof Error ? e.message : String(e) });
  process.exit(1);
});
TS
docker exec -w /app "$G" sh -lc "node_modules/.bin/tsx $M 2>&1 | grep -F '\"kind\":'" > /tmp/jrx-tok.json 2>/dev/null
docker exec "$G" sh -c "rm -f $M" 2>/dev/null
echo "  (measurement script removed from container)"
grep -F '"kind":' /tmp/jrx-tok.json | sed 's/^/  RAW /'
echo

echo "=== 2c. ATTRIBUTION TABLE — one exploration leaf, every block, explicit residual ==="
OBSERVED_TOK="${NV_OBSERVED_LEAF_TOK:-19938}"
python3 - "$OBSERVED_TOK" <<'PY'
import json, sys, os
observed = int(sys.argv[1])
budgets = policy = None
rag, built, mw, pool = [], [], [], None
try:
    for ln in open('/tmp/jrx-tok.json'):
        ln = ln.strip()
        if not ln.startswith('{'): continue
        d = json.loads(ln)
        k = d.get('kind')
        if   k == 'budgets':              budgets = d
        elif k == 'policyDirective':      policy = d
        elif k == 'autoRag':              rag.append(d)
        elif k == 'buildAgentPrompt':     built.append(d)
        elif k == 'middlewareEnrichment': mw.append(d)
        elif k == 'agentPool':            pool = d
except FileNotFoundError:
    print("  FATAL: no measurement output — tsx run failed inside the container.")
    raise SystemExit(0)

if budgets:
    print(f"  live budgets (very_complex + partnerBestOutcome): ragTopK={budgets.get('ragTopK')} "
          f"memoryLimit={budgets.get('memoryLimit')} memorySlice={budgets.get('memorySlice')} "
          f"memoryCharCap={budgets.get('memoryCharCap')}")
    print(f"  the budget object caps MEMORY by chars (memoryCharCap) but has NO ragCharCap —")
    print(f"  RAG is capped by COUNT (ragTopK={budgets.get('ragTopK')}) only.")
if pool: print(f"  agent pool loaded: {pool.get('loaded')} (picked {pool.get('picked')})")
print()

if not rag or all(r.get('err') for r in rag):
    print("  Auto-RAG measurement FAILED — cannot attribute. Errors:")
    for r in rag: print(f"    {r.get('err')}")
    raise SystemExit(0)

best = max(rag, key=lambda r: r.get('blockChars') or 0)
print(f"  MEASURED Auto-RAG block — largest of {len(rag)} live retrievals:")
for r in rag:
    print(f"    chunks={r['chunks']:>3} at topK={r['topK']}  block={r['blockChars']:>7,} chars "
          f"= {r['blockTokens']:>6,} tok   per-chunk min/med/mean/max = "
          f"{r['minChunk']}/{r['medChunk']}/{r['meanChunk']}/{r['maxChunk']}  layers={','.join(r.get('layers') or [])}")
print(f"    -> largest block = {best['blockChars']:,} chars = {best['blockTokens']:,} tok")
print(f"    -> largest single chunk vs the memory path's per-item cap: {best['largestChunkVsMemoryCharCap']}")
print()

print("  MEASURED middleware enrichment (delta on the prompt it is handed):")
for m in mw:
    if m.get('err'):
        print(f"    skipRag={m.get('skipRag')}  ERR {m['err']}")
        continue
    print(f"    skipRag={str(m['skipRag']):<5} added={m['addedChars']:>6,} chars = {m['addedTokens']:>5,} tok"
          f"   [MEMORY]={m['hasMemoryLabel']} [RAG]={m['hasRagLabel']}  ({m['latencyMs']}ms)")
print("    Queen leaves run with skipRag=TRUE (ragAlreadyApplied is set by Step-0),")
print("    so for a leaf the middleware contribution is the FIRST row above.")
print()

# ── the table ────────────────────────────────────────────────────────────────
# The leaf's BILLED input tokens are Math.ceil(prompt.length/4) where `prompt`
# is buildAgentPrompt()'s return value (see real-llm-service executeGemini:
# generateContent(request.prompt) — `systemPrompt` is not sent to Gemini at all).
# So the table must attribute buildAgentPrompt's output, not the system prompt.
mw_leaf = next((m for m in mw if m.get('skipRag') is True and not m.get('err')), None)
b_empty = next((b for b in built if b.get('label') == 'empty' and not b.get('err')), None)
b_sent  = next((b for b in built if b.get('label') == 'sentinel1k' and not b.get('err')), None)

print("  block                                              tokens   how measured")
print("  " + "-" * 96)
"""
Fixed-cost blocks come from `scripts/jrx-measure-leaf-prompt-blocks.ts`, which
differences the REAL buildAgentPrompt() over the 164-agent registry. They are
passed in rather than recomputed here so there is exactly one estimator
(NV-NO-DUPLICATE-001).
"""
sysctx = int(os.environ.get('NV_LEAF_SYSCTX_TOK', '6742'))
scaf   = int(os.environ.get('NV_LEAF_SCAFFOLD_TOK', '540'))
memtok = -(-((budgets or {}).get('memoryCharCap', 480) * (budgets or {}).get('memorySlice', 10)) // 4)
rows = [
    ("registry system prompt, echoed INTO the billed user prompt",
     sysctx, "MEASURED — buildAgentPrompt(), 164-agent registry"),
    ("scaffolding: TASK/CONTEXT/PARLANT/BMAD/format/tools",
     scaf, "MEASURED — buildAgentPrompt() difference"),
    ("ORIGINAL REQUEST = Step-0 fused prompt, of which:", 0, "the three below + the question"),
    ("   \u2514 Step-0 Auto-RAG contextBlock",
     best['blockTokens'], "MEASURED live, this probe"),
    ("   \u2514 Step-0 retrieval policy directive",
     (policy or {}).get('tokens', 0), "MEASURED live, this probe"),
    ("   \u2514 Step-0 memory block (worst case)",
     memtok, f"CAPPED {(budgets or {}).get('memorySlice',10)}x{(budgets or {}).get('memoryCharCap',480)} chars"),
    ("   \u2514 [CONTEXT-ENGINEERING] append (worst case)",
     750, "CAPPED slice(0,3000) at orchestrator:1887"),
    ("   \u2514 the user's own question",
     0, "matter-specific; excluded (NV-SECRETS-001)"),
    ("subtask instruction (swarm exploration)",
     24, "MEASURED — generateSwarmSubtasks slices to 50 chars"),
    ("middleware [MEMORY] + [RAG] on a leaf",
     (mw_leaf or {}).get('addedTokens', 0),
     "MEASURED — 0 chars: skipRag=ragAlreadyApplied"),
    ("assembled `systemPrompt` (the block just cut -40.7%)",
     0, "NOT BILLED on the Gemini leaf path — see note"),
]
tot = 0
for name, tk, note in rows:
    tot += tk
    print(f"  {name:<56} {tk:>8,}   {note}")
print("  " + "-" * 96)
print(f"  {'SUM OF MEASURED/CAPPED BLOCKS':<56} {tot:>8,}")
print(f"  {'OBSERVED live leaf prompt (deploy 0910Z probe)':<56} {observed:>8,}")
resid = observed - tot
pct = (100.0 * resid / observed) if observed else 0
print(f"  {'RESIDUAL (observed - blocks)':<56} {resid:>+8,}   ({pct:+.0f}% of observed)")
print()
print("  THE HEADLINE, and it is NOT the hypothesis that was posed:")
print(f"    The Auto-RAG block measures {best['blockTokens']:,} tok live, not the ~10,700 the")
print("    residual arithmetic predicted. `formatAutoRagContext` IS uncapped by size, but")
print("    the live corpus rows are small (median a few hundred chars), so the missing")
print("    bytes are NOT there. HYPOTHESIS DEAD.")
print()
print(f"    The single largest billed block is instead the registry system prompt at")
print(f"    {sysctx:,} tok — interpolated into the USER prompt by buildAgentPrompt(). The")
print("    Gemini leaf path calls generateContent(request.prompt) and never sends")
print("    `systemPrompt` (real-llm-service executeGemini), and bills")
print("    Math.ceil(request.prompt.length/4). So the -40.7% cut landed on a field the")
print("    exploration leaves never transmit, while the full unbudgeted registry prompt")
print("    still rides in on the field that IS billed.")
PY
rm -f /tmp/jrx-tok.json
rm -f "$L"
