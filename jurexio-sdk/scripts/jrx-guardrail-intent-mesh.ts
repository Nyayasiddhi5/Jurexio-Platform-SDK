#!/usr/bin/env tsx
/**
 * NV-GUARDRAIL-INTENT-MESH-001
 * Fail CI if high-value capability leaves lack INTENT_CAPABILITY_MAP coverage.
 * Prevents "built but never Queen-scheduled" regressions after Cursor/Replit moves.
 */
import { capabilityManifest, getDeclaredCapabilitiesForIntent, INTENT_CAPABILITY_MAP } from '../src/orchestration/capability-manifest.js';
import { REQUIRED_INTENT_MESH_LEAF_IDS } from '../src/orchestration/jrx-agent-tool-bridge.js';

const covered = new Set<string>();
for (const b of INTENT_CAPABILITY_MAP) {
  for (const id of b.capabilityIds) covered.add(id);
}

const missing: string[] = [];
for (const id of REQUIRED_INTENT_MESH_LEAF_IDS) {
  if (!capabilityManifest.get(id)) {
    console.error(`[intent-mesh] REQUIRED leaf missing from manifest: ${id}`);
    missing.push(id);
    continue;
  }
  if (!covered.has(id)) {
    console.error(`[intent-mesh] leaf has NO INTENT alias: ${id}`);
    missing.push(id);
  }
}

// Sanity: intent resolver returns something for core tokens
for (const token of ['ocr', 'compare', 'automateai', 'bmad', 'a2a', 'web_search', 'grpo']) {
  const ids = getDeclaredCapabilitiesForIntent(token);
  if (!ids || ids.length === 0) {
    console.error(`[intent-mesh] intent token unbound: ${token}`);
    missing.push(`intent:${token}`);
  }
}

if (missing.length) {
  console.error(`\nNV-GUARDRAIL-INTENT-MESH-001 FAILED — ${missing.length} gap(s)`);
  console.error('Add INTENT_CAPABILITY_MAP entries + analyzePrompt hints. Do NOT re-implement factories that already exist.');
  process.exit(1);
}

console.log(`NV-GUARDRAIL-INTENT-MESH-001 PASS — ${REQUIRED_INTENT_MESH_LEAF_IDS.length} required leaves INTENT-covered; ${INTENT_CAPABILITY_MAP.length} intent bindings.`);
