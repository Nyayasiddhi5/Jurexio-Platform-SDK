#!/usr/bin/env python3
"""NV-PROVIDER-USAGE-EXTRACT-001 — the ONE ground-truth extractor for billed
provider completions.

Reads gateway log lines on stdin, emits JSON on stdout. This is the single
extractor referenced by NV-NO-DUPLICATE-001: `scripts/_ec2-meter-verify.sh` and
`scripts/_ec2-bench-set.sh` each carry an inline copy of the same grep+parse,
and this file is the canonical version they should collapse onto. It cannot be
`source`d by those scripts today because every SSM payload must be
self-contained (the EC2 host has no repo checkout) — the driver
`scripts/nv-benchmark-cost.mjs` therefore inlines THIS file into the payload it
ships, so there is exactly one authored copy.

── Why this exists at all ────────────────────────────────────────────────────
The response envelope's `cost.completions` is our own accounting. It was wrong
before NV-METER-ENVELOPE-001 (claimed 1 completion while 5 were billed), so any
cost figure that trusts it is unverified by construction. The provider log
lines are emitted immediately after each `recordLlmUsage()` call and are
therefore an independent count. A benchmark that reports spend MUST cross-check
the two and fail loudly on disagreement.

── The markers, taken from the four recordLlmUsage() call sites ──────────────
`src/services/intelligent-router/llm-orchestrator.ts` is the only file that
calls `recordLlmUsage()`, so its log lines enumerate every billed completion:

  :1258 -> 'llm-orchestrator: hedge success'   billed, hedge winner
  :1415 -> 'llm-orchestrator: success'         billed, sequential cascade
  :2143 -> 'llm-orchestrator: stream success'  billed, streamed
  :1214 -> 'llm-orchestrator: hedge loser spend recorded as waste'  wasted

CORRECTION vs the inline copy in `_ec2-meter-verify.sh`: that script greps
`'hedge success|attempt success|stream success'`. There is no `attempt success`
string anywhere in `src/` — the sequential-cascade marker is the bare
`llm-orchestrator: success`. So the older pattern silently UNDER-COUNTS every
completion that did not go through the hedge or a stream, which reads as an
"envelope over-reports" mismatch when the truth is the opposite. Matching is
done here on exact `message` equality after JSON parse rather than on a
substring, so `success` cannot bleed across markers.

── Field availability is NOT uniform (this drives the residual accounting) ───
  hedge success  : model, provider, latencyMs             — NO tokens, NO cost
  success        : model, provider, latencyMs, tokensIn/Out, costUsd
  stream success : model, latencyMs, tokensIn/Out, usageSource, chars

A hedge-won completion therefore contributes a real billed call with no token
detail. Callers must reconcile the per-call sum against the envelope total and
report the difference as a residual instead of pretending the sum is complete.

── Zero-cost attribution (NV-ZEROCOST-ATTRIBUTION-001) ───────────────────────
A zero-completion answer is not self-explaining: it can be a semantic-cache hit,
a deterministic resolver, a statute fast path, or a fast path answering a
question it should have escalated. The first two are savings; the last is a
quality failure that presents as a 100 % saving. `resolutionLines` carries the
request-scoped statement of which one it was, for `_nv-benchmark-attribution.mjs`
to attribute. `cacheHintLines` is NOT usable for this — it is a window-wide
count, so on a shared host it credits this request with another request's hit.
"""
from __future__ import annotations

import argparse
import json
import sys
from collections import Counter

BILLED_MARKERS = {
    'llm-orchestrator: hedge success': 'hedge-winner',
    'llm-orchestrator: success': 'sequential',
    'llm-orchestrator: stream success': 'stream',
}
WASTE_MARKER = 'llm-orchestrator: hedge loser spend recorded as waste'
CANCEL_MARKER = 'llm-orchestrator: hedge loser cancelled'

# Substrings that indicate a served-from-cache answer. Kept as substrings (not
# exact messages) because the cache layers log through several services; the
# count is reported as a signal, never used as a completion count.
CACHE_HINTS = ('LM cache hit', 'cache hit', 'prompt cache hit')

# NV-ZEROCOST-ATTRIBUTION-001 — the request-scoped statement of HOW a response
# was produced, emitted by `nv-orchestration-routes.ts` alongside the envelope's
# `cost.resolution`. Matched on exact message equality and scoped by requestId,
# unlike CACHE_HINTS above: a window-scoped cache count on a shared host
# attributes another request's hit to this one, which is exactly the defect that
# invalidated the v1 fan-out figures.
RESOLUTION_MARKER = '[NV-Orchestrate] zero-cost resolution'


def _num(value):
    return value if isinstance(value, (int, float)) and not isinstance(value, bool) else None


# NV-BENCH-LEAF-SCOPE-001 — a dispatch id is a CHILD of the request id, and there
# are four real shapes in the codebase. Exact equality saw only the first.
#
#   <requestId>                          parent call            nv-client.ts:1226
#   <requestId>-selfrag                  Self-RAG regeneration  nv-client.ts:1435
#   <requestId>-jsonretry                strict JSON re-prompt   nv-client.ts:1348
#   orch-<requestId>::leaf-*             Queen swarm leaf        nv-queen:4820
#   orch-<requestId>::{synthesis,cot,plan,synthesis-blocking}    nv-queen:192/2721/5267/5325
#
# The Queen prefix is `orch-<requestId>` because `orchestrationId` defaults to
# `orch-${request.requestId}` (nv-queen-orchestrator.ts:1584). So a naive
# `startswith(request_id + '::')` — my first attempt — still would NOT have matched a
# single Queen leaf. That is worth recording: the fix has to follow the id shapes the
# code actually emits, not the shape one assumes it emits.
#
# Consequence of the old exact match: the v2 benchmark metering gate reported 7
# MISMATCH rows shaped "envelope 4-5 vs provider log 1" and refused to publish any
# cost figure. The envelope reads the request-scoped accumulator, which sees every
# dispatch; the extractor counted only the parent. So the platform was metering
# correctly and the instrument was under-counting (NV-VALIDATE-THE-PROBE-001).
#
# Separators are matched explicitly rather than by bare prefix so a different request
# can never be absorbed. UUIDs are fixed-length and cannot be proper prefixes of one
# another, and requiring a separator makes it impossible even if they could.
LEAF_SEPARATOR = '::'
CHILD_SEPARATORS = ('::', '-')
QUEEN_ID_PREFIX = 'orch-'


def _belongs_to_request(candidate, request_id):
    """True when `candidate` is the request itself or one of its scoped dispatches."""
    if not candidate or not request_id:
        return False
    if candidate == request_id:
        return True
    for base in (request_id, QUEEN_ID_PREFIX + request_id):
        if candidate == base:
            return True
        for sep in CHILD_SEPARATORS:
            if candidate.startswith(base + sep):
                return True
    return False


def _dispatch_stage(candidate, request_id):
    """'parent', or the leaf/stage suffix, for per-dispatch reporting."""
    if candidate == request_id:
        return 'parent'
    for base in (QUEEN_ID_PREFIX + request_id, request_id):
        if candidate == base:
            return 'parent'
        for sep in CHILD_SEPARATORS:
            if candidate.startswith(base + sep):
                return candidate[len(base) + len(sep):] or 'unknown'
    return 'foreign'


def extract(lines, request_id=None):
    calls = []
    wasted = []
    resolutions = []
    cache_hint_lines = 0
    cancel_lines = 0
    parsed = 0
    unparsed = 0

    for raw in lines:
        line = raw.strip()
        if not line:
            continue
        # Production logging is JSON (logger.ts formatJSON when NODE_ENV=production).
        # A non-JSON line is pretty-printed output, which means the gateway is not
        # in production mode — counted so the caller can see the extractor is blind.
        start = line.find('{')
        if start < 0:
            unparsed += 1
            continue
        try:
            rec = json.loads(line[start:])
        except Exception:
            unparsed += 1
            continue
        if not isinstance(rec, dict):
            unparsed += 1
            continue
        parsed += 1

        message = str(rec.get('message') or '')
        if any(hint in message for hint in CACHE_HINTS):
            cache_hint_lines += 1
        if message == CANCEL_MARKER:
            cancel_lines += 1
        if message == RESOLUTION_MARKER:
            resolutions.append({
                'requestId': rec.get('requestId'),
                'resolution': rec.get('resolution'),
                'detail': rec.get('detail'),
                'semanticMatch': rec.get('semanticMatch'),
            })

        kind = BILLED_MARKERS.get(message)
        is_waste = message == WASTE_MARKER
        if not kind and not is_waste:
            continue

        entry = {
            'kind': kind or 'wasted',
            'requestId': rec.get('requestId'),
            'model': rec.get('model'),
            'provider': rec.get('provider'),
            'latencyMs': _num(rec.get('latencyMs')),
            'tokensIn': _num(rec.get('tokensIn')),
            'tokensOut': _num(rec.get('tokensOut')),
            'costUsd': _num(rec.get('costUsd')),
            # 'provider' means the count came from the provider's usage block;
            # 'estimate' means length/4 (M3/M4). Absent on non-streamed calls.
            'usageSource': rec.get('usageSource'),
        }
        (wasted if is_waste else calls).append(entry)

    scoped = None
    if request_id:
        scoped = [c for c in calls if _belongs_to_request(c.get('requestId'), request_id)]

    # Scope to the request when the orchestrator's requestId matches the envelope's.
    # It does not always: the envelope id is minted by the route, the log id comes
    # from the orchestration input. When nothing matches we fall back to the log
    # window and SAY SO, because a silent fallback would turn concurrent traffic on
    # a shared dev host into phantom completions.
    if scoped:
        billed = scoped
        scope_mode = 'requestId'
    else:
        billed = calls
        scope_mode = 'window'

    with_tokens = [c for c in billed if c['tokensIn'] is not None or c['tokensOut'] is not None]

    # Resolution lines are scoped STRICTLY by requestId and never fall back to
    # the window. A resolution is a claim about one specific answer, so an
    # unattributable line is worse than no line: it would let another request's
    # cache hit excuse this request's zero cost.
    if request_id:
        scoped_resolutions = [r for r in resolutions if _belongs_to_request(r.get('requestId'), request_id)]
        resolution_scope = 'requestId'
    else:
        scoped_resolutions = []
        resolution_scope = 'unscoped-none'

    return {
        'scopeMode': scope_mode,
        'requestIdFilter': request_id,
        'billedCompletions': len(billed),
        'billedCompletionsWindow': len(calls),
        # NV-BENCH-LEAF-SCOPE-001 — report the parent and its scoped dispatches
        # separately. Merging them is what hid the defect: a count of 1 looked
        # plausible, so nobody asked which calls were being dropped.
        'billedParentCalls': (
            sum(1 for c in billed if c.get('requestId') == request_id) if request_id else None
        ),
        'billedLeafCalls': (
            sum(1 for c in billed if c.get('requestId') != request_id) if request_id else None
        ),
        'byDispatchStage': (
            dict(Counter(_dispatch_stage(str(c.get('requestId')), request_id) for c in billed))
            if request_id else {}
        ),
        'calls': billed,
        'resolutionLines': scoped_resolutions,
        'resolutionLinesWindow': len(resolutions),
        'resolutionScopeMode': resolution_scope,
        'byKind': dict(Counter(c['kind'] for c in billed)),
        'byModel': dict(Counter(str(c['model']) for c in billed)),
        'usageSource': dict(Counter(str(c['usageSource']) for c in billed)),
        'tokensInKnown': sum(c['tokensIn'] or 0 for c in billed),
        'tokensOutKnown': sum(c['tokensOut'] or 0 for c in billed),
        'costUsdKnown': sum(c['costUsd'] or 0.0 for c in billed),
        'callsWithTokenDetail': len(with_tokens),
        'callsWithoutTokenDetail': len(billed) - len(with_tokens),
        'wastedCompletions': len(wasted),
        'wastedTokensIn': sum(c['tokensIn'] or 0 for c in wasted),
        'wastedTokensOut': sum(c['tokensOut'] or 0 for c in wasted),
        'wastedCostUsd': sum(c['costUsd'] or 0.0 for c in wasted),
        'hedgeLoserCancelledLines': cancel_lines,
        'cacheHintLines': cache_hint_lines,
        'logLinesParsedJson': parsed,
        'logLinesUnparsed': unparsed,
    }


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--request-id', default=None,
                    help='scope to this requestId when the log lines carry it')
    ap.add_argument('--pretty', action='store_true')
    args = ap.parse_args()
    out = extract(sys.stdin, args.request_id)
    json.dump(out, sys.stdout, indent=2 if args.pretty else None)
    sys.stdout.write('\n')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
