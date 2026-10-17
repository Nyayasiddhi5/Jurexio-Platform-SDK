#!/usr/bin/env python3
"""NV-COST-MODEL-001 — cost math from the measured 2026-08-15 baseline.

Inputs are live-measured token counts (SSM 74ae0e73) and published per-1M prices.
Output is the per-request cost today vs after each optimization phase, so the
"70% reduction" claim is arithmetic rather than aspiration.
"""

# USD per 1M tokens (in, out) — taken from OUR OWN model-catalog.ts so the
# model is auditable against the code, not against external price pages.
PRICE = {
    "gemini-3-1-pro": (1.50, 12.00),        # model-catalog.ts:gemini-3-1-pro-preview
    "gemini-3-flash": (0.30, 2.50),         # model-catalog.ts:gemini-3-flash-preview  lq=90 spd=95
    "gemini-3-1-flash-lite": (0.075, 0.60), # model-catalog.ts  lq=82 spd=98
    "claude-sonnet-5": (3.00, 15.00),       # global.anthropic.claude-sonnet-5  lq=100
    "claude-opus-5": (5.00, 25.00),         # us.anthropic.claude-opus-5  lq=100
    "claude-haiku-4-5": (1.00, 5.00),       # global.anthropic.claude-haiku-4-5  lq=88
    "nova-pro": (0.80, 3.20),
    "deterministic": (0.0, 0.0),
}

def cost(model, tin, tout):
    pin, pout = PRICE[model]
    return tin * pin / 1e6 + tout * pout / 1e6

# ── Measured today (live orchestrate, SSM 74ae0e73) ───────────────────────────
# label, model, prompt_tokens, completion_tokens, wall_seconds, share_of_traffic
TODAY = [
    ("micro-FAQ statute",   "gemini-3-1-pro", 3592, 1537, 33.0, 0.22),
    ("mapping",             "deterministic",     0,    0,  0.07, 0.08),
    ("short chat",          "gemini-3-1-pro", 5345, 1432, 34.4, 0.30),
    ("classify/extract",    "gemini-3-1-pro", 3442, 1489, 40.7, 0.10),
    ("research",            "gemini-3-1-pro", 5388, 1660, 40.8, 0.20),
    ("drafting",            "gemini-3-1-pro", 5426, 2444, 65.4, 0.10),
]

# NV-HEDGE-WASTE-001: measured live, 33/33 LLM requests fired the hedge
# (NYV_LLM_HEDGE_MS=2500, eligible>=2). callModel() takes no caller AbortSignal
# (llm-orchestrator.ts:735-745), so the LOSING branch runs to completion and is
# billed by the provider — but recordLlmUsage() only records the winner
# (llm-orchestrator.ts:934-940). Real spend is therefore ~2x what we meter.
HEDGE_FIRE_RATE = 1.00      # measured 33/33
HEDGE_LOSER_BILLED = True   # no cancellation


def hedge_multiplier():
    """Provider-side cost multiplier from the un-cancelled hedge loser."""
    return 1.0 + HEDGE_FIRE_RATE if HEDGE_LOSER_BILLED else 1.0

# ── Target after phases 1-4 ──────────────────────────────────────────────────
# Deterministic where NYS returned llmRequired=False (measured); budgeted
# prompts + right-sized model elsewhere. Drafting keeps a frontier model.
TARGET = [
    # label, model, prompt_tokens, completion_tokens, wall_seconds, det_share
    # det_share = fraction of that class answered with ZERO LLM
    # Models chosen from OUR catalog: gemini-3-flash-preview (lq=90, spd=95) is
    # already present and currently never selected.
    ("micro-FAQ statute",   "gemini-3-flash",         600,  400,  1.0, 0.85),
    ("mapping",             "deterministic",            0,    0,  0.07, 1.00),
    ("short chat",          "gemini-3-flash",         900,  700,  7.0, 0.45),
    ("classify/extract",    "gemini-3-1-flash-lite",  500,  300,  3.1, 0.30),
    ("research",            "gemini-3-flash",        1800, 1100,  8.0, 0.25),
    # Drafting: Sonnet 5 is the workhorse (lq=100, same as Opus 5, 0.6x price).
    # Opus 5 is escalation-only — see ESCALATION below.
    ("drafting",            "claude-sonnet-5",       2200, 2444, 20.0, 0.00),
]

# Escalation policy: only this fraction of drafting requests earn Opus 5
# (filing-grade pleadings, high-risk litigation strategy). Everything else
# stays on Sonnet 5. This single knob dominates the cost outcome.
OPUS_ESCALATION_SHARE = 0.20

def line(w, label, c, tokens, secs, note=""):
    print(f"  {label:<22s} ${c:>9.5f}  {tokens:>7,d} tok  {secs:>6.1f}s  {note}")

print("=" * 78)
print("TODAY — measured live per-request cost (2026-08-15)")
print("=" * 78)
today_blended = 0.0
today_tokens = 0.0
today_secs = 0.0
for label, model, tin, tout, secs, share in TODAY:
    c = cost(model, tin, tout)
    today_blended += c * share
    today_tokens += (tin + tout) * share
    today_secs += secs * share
    line(0, label, c, tin + tout, secs, f"{model}  share={share:.0%}")
print(f"\n  BLENDED per request: ${today_blended:.5f}"
      f"   {today_tokens:,.0f} tokens   {today_secs:.1f}s avg")
print(f"  METERED (winner only, what recordLlmUsage records)")
hm = hedge_multiplier()
print(f"  TRUE PROVIDER SPEND: ${today_blended * hm:.5f}"
      f"   — hedge loser is never cancelled, x{hm:.1f}")

print()
print("=" * 78)
print("HEDGE WASTE — measured 33/33 requests fired the hedge")
print("=" * 78)
print("  NYV_LLM_HEDGE_MS=2500, eligible>=2 -> hedge fires on EVERY request.")
print("  Winners: gemini-3-1-pro 78.8% (median 25.9s) | sonnet-5 21.2% (16.2s)")
print("  us.anthropic.claude-opus-5 is the configured cascade LEAD but won 0/33.")
print("  callModel() accepts no AbortSignal -> loser runs to completion, billed.")
print(f"  Unmetered waste today: ${today_blended * (hm - 1):.5f}/req"
      f"  ({(hm - 1) * 100:.0f}% invisible overspend)")

print()
print("=" * 78)
print("TARGET — after phases 1-4 (deterministic tier + cache + budgets + routing)")
print("=" * 78)
tgt_blended = 0.0
tgt_tokens = 0.0
tgt_secs = 0.0
for (label, model, tin, tout, secs, det), (_, _, _, _, _, share) in zip(TARGET, TODAY):
    # det fraction costs nothing and returns in ~0.1s
    c_llm = cost(model, tin, tout)
    if label == "drafting":
        # blend Sonnet 5 workhorse with an Opus 5 escalation slice
        c_llm = (
            cost("claude-sonnet-5", tin, tout) * (1 - OPUS_ESCALATION_SHARE)
            + cost("claude-opus-5", tin, tout) * OPUS_ESCALATION_SHARE
        )
        secs = 20.0 * (1 - OPUS_ESCALATION_SHARE) + 35.0 * OPUS_ESCALATION_SHARE
    c = c_llm * (1 - det)
    tk = (tin + tout) * (1 - det)
    sc = secs * (1 - det) + 0.1 * det
    tgt_blended += c * share
    tgt_tokens += tk * share
    tgt_secs += sc * share
    tag = f"sonnet-5 + {OPUS_ESCALATION_SHARE:.0%} opus-5" if label == "drafting" else model
    line(0, label, c, int(tk), sc, f"{tag}  det={det:.0%}")
print(f"\n  BLENDED per request: ${tgt_blended:.5f}"
      f"   {tgt_tokens:,.0f} tokens   {tgt_secs:.1f}s avg")

print()
print("=" * 78)
cost_cut = (1 - tgt_blended / today_blended) * 100
tok_cut = (1 - tgt_tokens / today_tokens) * 100
lat_cut = (1 - tgt_secs / today_secs) * 100
print(f"COST reduction   : {cost_cut:5.1f} %   (${today_blended:.5f} -> ${tgt_blended:.5f})")
print(f"TOKEN reduction  : {tok_cut:5.1f} %   ({today_tokens:,.0f} -> {tgt_tokens:,.0f})")
print(f"LATENCY reduction: {lat_cut:5.1f} %   ({today_secs:.1f}s -> {tgt_secs:.1f}s)")
print("=" * 78)
print()
print("Contribution of each lever to the cost cut (removing one at a time):")

def blended(target):
    tot = 0.0
    for (label, model, tin, tout, secs, det), (_, _, _, _, _, share) in zip(target, TODAY):
        c = cost(model, tin, tout)
        if label == "drafting" and model == "claude-sonnet-5":
            c = (
                cost("claude-sonnet-5", tin, tout) * (1 - OPUS_ESCALATION_SHARE)
                + cost("claude-opus-5", tin, tout) * OPUS_ESCALATION_SHARE
            )
        tot += c * (1 - det) * share
    return tot

# no deterministic tier
no_det = [(l, m, i, o, s, 0.0) for l, m, i, o, s, d in TARGET]
no_det[1] = ("mapping", "gemini-3-1-pro", 5000, 1400, 27.0, 0.0)  # mapping back to LLM
# no prompt budgets (keep today's inflated prompts)
no_budget = [(l, m, ti, to, s, d) for (l, m, _, _, s, d), (_, _, ti, to, _, _)
             in zip(TARGET, TODAY)]
# no model right-sizing (everything on Gemini 3.1 Pro)
no_route = [(l, "gemini-3-1-pro", i, o, s, d) for l, m, i, o, s, d in TARGET]
# drafting always Opus 5 (no escalation discipline)
all_opus = [(l, "claude-opus-5" if l == "drafting" else m, i, o, s, d)
            for l, m, i, o, s, d in TARGET]

for name, variant in (
    ("without deterministic tier", no_det),
    ("without prompt budgets", no_budget),
    ("without model right-sizing", no_route),
    ("drafting always on Opus 5", all_opus),
):
    b = blended(variant)
    print(f"  {name:<30s} ${b:.5f}  -> only {(1 - b / today_blended) * 100:5.1f}% cut")

print()
print("Sensitivity: how much does the Opus-5 escalation share cost us?")
for share in (0.0, 0.1, 0.2, 0.35, 0.5, 1.0):
    globals()["OPUS_ESCALATION_SHARE"] = share
    b = blended(TARGET)
    print(f"  opus-5 on {share:4.0%} of drafts -> ${b:.5f}"
          f"  ({(1 - b / today_blended) * 100:5.1f}% cut)")

# ── Phase 2 additional lever: working semantic cache ──────────────────────────
# A cache hit costs ~0. Legal Q&A repeats heavily (same sections, same
# offences). Applied AFTER the deterministic tier, on what remains.
print()
print("Adding Phase 2 (working semantic cache) on top of phases 1/3/4:")
print("  cache hit-rate    blended $   cost cut   (opus escalation held at 10%)")
globals()["OPUS_ESCALATION_SHARE"] = 0.10
base = blended(TARGET)
for hit in (0.0, 0.15, 0.25, 0.35, 0.50):
    b = base * (1 - hit)
    print(f"  {hit:>6.0%}          ${b:.5f}    {(1 - b / today_blended) * 100:5.1f}%")

# ── Provider prompt caching ──────────────────────────────────────────────────
# NV-PROMPT-CACHE-001: audit found NO cache_control / cachedContent anywhere in
# src/. The static prefix (L1 registry layer + legal overlay) is byte-identical
# across requests for the same agent, and bundle.hash + a 30-min TTL already
# exist as the correct cache key. Anthropic/Bedrock bill cache reads at ~0.1x
# input; Gemini context caching is ~0.25x input.
STATIC_PREFIX_TOKENS = 2130   # L1 registry 1192 + UNIVERSAL_LEGAL_CORE 806 + jurisdiction 134
CACHE_READ_DISCOUNT = 0.15    # blended across Anthropic 0.1x and Gemini 0.25x

print()
print("Adding provider prompt caching on the static preamble:")
print(f"  static prefix = {STATIC_PREFIX_TOKENS} tok/req, billed at {CACHE_READ_DISCOUNT:.2f}x on a hit")


def blended_with_prompt_cache(target, hit_rate):
    """Discount the static prefix portion of input tokens on a cache hit."""
    tot = 0.0
    for (label, model, tin, tout, secs, det), (_, _, _, _, _, share) in zip(target, TODAY):
        if model == "deterministic":
            continue
        pin, pout = PRICE[model]
        if label == "drafting":
            pin = (
                PRICE["claude-sonnet-5"][0] * (1 - OPUS_ESCALATION_SHARE)
                + PRICE["claude-opus-5"][0] * OPUS_ESCALATION_SHARE
            )
            pout = (
                PRICE["claude-sonnet-5"][1] * (1 - OPUS_ESCALATION_SHARE)
                + PRICE["claude-opus-5"][1] * OPUS_ESCALATION_SHARE
            )
        # Prefix cannot exceed the budgeted prompt.
        prefix = min(STATIC_PREFIX_TOKENS, tin)
        variable = tin - prefix
        eff_prefix = prefix * (hit_rate * CACHE_READ_DISCOUNT + (1 - hit_rate))
        c = (variable + eff_prefix) * pin / 1e6 + tout * pout / 1e6
        tot += c * (1 - det) * share
    return tot


print("  prefix hit-rate   blended $   cost cut   (with 25% semantic cache)")
for hit in (0.0, 0.5, 0.8, 0.95):
    b = blended_with_prompt_cache(TARGET, hit) * (1 - 0.25)
    print(f"  {hit:>6.0%}          ${b:.5f}    {(1 - b / today_blended) * 100:5.1f}%")
print("  NOTE: only ~2 pts, because prompt budgets already cut the prefix to ~1.3k")
print("  tokens. Caching and budgets are SUBSTITUTES, not additive. If the prompt")
print("  eval blocks aggressive budgets, caching recovers most of the lost saving")
print("  with zero wording change — a useful fallback, not a parallel win.")

print()
print("=" * 78)
print("VERDICT")
print("=" * 78)
print("  70% IS ACHIEVABLE. Measured levers, each necessary, none sufficient:")
print("    1. model right-sizing (gemini-3-flash for FAQ/chat, not Pro)  ~8 pts")
print("    2. prompt token budgets (5.9k -> 1.3k tokens)                 ~9 pts")
print("    3. deterministic tier (honour NYS llmRequired=False)          ~11 pts")
print("    4. Opus-5 escalation discipline (<=10% of drafts)             ~9 pts")
print("    5. working semantic cache (>=25% hit rate)                    ~6 pts")
print("    6. cancel the hedge loser (AbortSignal)                       50% of")
print("       TRUE spend — this is pure invisible waste, not a trade-off")
print()
print("  Phases 1/3/4 together already clear the bar at 76.3%.")
print("  Adding a 25% cache hit rate takes it to 83.1%.")
print()
print("  NOTE: all four single-lever removals still land 65-68%, because the")
print("  levers overlap. The claim is robust — but ONLY if the whole set ships.")
print("  Today we ship none of them: every task class routes to gemini-3-1-pro")
print("  with a ~5k-token prompt and an un-cancelled parallel hedge.")
print()
print("  Against TRUE provider spend (incl. the un-cancelled hedge loser):")
print(f"    ${today_blended * hm:.5f} -> ${base * 0.75:.5f}"
      f" = {(1 - base * 0.75 / (today_blended * hm)) * 100:.1f}% cut.")
print("=" * 78)
