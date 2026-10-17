#!/usr/bin/env node
/**
 * Quantifies the ~11,300-token residual in live Queen leaf prompts.
 *
 * Phase 8 cut the ASSEMBLED system prompt (3,213 -> 1,905 tok), but the live leaf
 * measured 19,938 and the highest assembled figure is 8,616 — leaving ~11,300 tok
 * unaccounted for. The middleware [MEMORY]/[RAG] blocks are NOT the culprit: they
 * cap at 5 items x 240 chars (~600 tok total).
 *
 * `formatAutoRagContext` (nv-auto-rag-router.ts:485-495) is a different path and
 * interpolates `c.content` RAW — no per-chunk truncation, no total-size ceiling:
 *
 *     .map((c, i) => `[${i+1}|${c.layer}|${c.source}] ${c.title}\n${c.content}`)
 *
 * With topK defaulting to 5, that is 5 x full statute/judgment text. This is the
 * SAME cap-on-count-not-size shape as NV-MEM-BUDGET-001, where `memoryCharCap` was
 * enforced at one call site while another interpolated raw content.
 *
 * This script does NOT assert the conclusion — it computes what chunk sizes WOULD
 * be required to produce the observed residual, so the hypothesis is falsifiable
 * against real corpus rows rather than asserted from source reading.
 */

const OBSERVED_LEAF_TOKENS = 19938;   // live, forced-Queen probe 2026-08-16
const ASSEMBLED_MAX_TOKENS = 8616;    // highest assembled system prompt measured
const MIDDLEWARE_CAP_TOKENS = 600;    // [MEMORY] + [RAG]: 10 items x 240 chars / 4
const CHARS_PER_TOKEN = 4;            // platform estimator convention

const residualTokens = OBSERVED_LEAF_TOKENS - ASSEMBLED_MAX_TOKENS - MIDDLEWARE_CAP_TOKENS;
const residualChars = residualTokens * CHARS_PER_TOKEN;

console.log('=== Queen leaf prompt residual ===');
console.log(`  observed live leaf prompt      ${OBSERVED_LEAF_TOKENS.toLocaleString()} tok`);
console.log(`  assembled system prompt (max)  ${ASSEMBLED_MAX_TOKENS.toLocaleString()} tok`);
console.log(`  middleware [MEMORY]+[RAG] cap  ${MIDDLEWARE_CAP_TOKENS.toLocaleString()} tok  (5+5 items x 240 chars)`);
console.log(`  ------------------------------------------`);
console.log(`  UNATTRIBUTED                   ${residualTokens.toLocaleString()} tok  (${residualChars.toLocaleString()} chars)`);

console.log('\n=== falsifiable prediction: uncapped Auto-RAG chunks ===');
console.log('  formatAutoRagContext interpolates c.content with no truncation.');
console.log('  Required mean chunk size to explain the residual, by topK:\n');
console.log('    topK   chars/chunk   plausible for legal corpus?');
for (const topK of [3, 5, 8, 10]) {
  const perChunk = Math.round(residualChars / topK);
  // A BNS/BNSS section runs ~1-3k chars; a judgment extract 3-10k.
  const verdict =
    perChunk > 12000 ? 'unlikely (larger than most single rows)'
    : perChunk >= 1000 ? 'YES — typical statute section / judgment extract'
    : 'too small (would imply another source dominates)';
  console.log(`    ${String(topK).padEnd(6)} ${String(perChunk.toLocaleString()).padEnd(12)} ${verdict}`);
}

console.log('\n=== how to confirm (must be measured, not inferred) ===');
console.log('  Log actual formatAutoRagContext() output length per leaf on the live');
console.log('  path and compare against this residual. If it lands near',
  residualChars.toLocaleString(), 'chars,');
console.log('  the cap-on-count-not-size defect is confirmed live in a SECOND place.');
console.log('  If it does not, the residual is elsewhere and this hypothesis is dead.');
