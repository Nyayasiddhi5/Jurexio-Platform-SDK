/**
 * NV-AGENT-TOOL-BRIDGE + INTENT mesh unit tests.
 */
import { describe, it, expect } from 'vitest';
import {
  resolveCapabilityIdsFromAgentTools,
  formatAgentToolDirective,
  REQUIRED_INTENT_MESH_LEAF_IDS,
} from '../../src/orchestration/jrx-agent-tool-bridge.js';
import {
  getDeclaredCapabilitiesForIntent,
  capabilityManifest,
  INTENT_CAPABILITY_MAP,
} from '../../src/orchestration/capability-manifest.js';

describe('./jrx-agent-tool-bridge', () => {
  it('maps registry tool tokens to live capability leaves', () => {
    const ids = resolveCapabilityIdsFromAgentTools({
      tools: ['legal-research', 'document-generation', 'risk-analysis'],
      mcpToolsAllowed: ['nys_search_caselaw', 'nys_check_citations', 'web_search'],
    });
    expect(ids).toContain('rag.search');
    expect(ids).toContain('templates.generate');
    expect(ids).toContain('intelligence.doc-analyze');
    expect(ids).toContain('intelligence.precedent');
    expect(ids).toContain('safety.citation-verify');
    expect(ids).toContain('enterprise.web-search');
  });

  it('formats directive only when caps present', () => {
    expect(formatAgentToolDirective([])).toBe('');
    expect(formatAgentToolDirective(['rag.search'])).toMatch(/PLATFORM TOOLS/);
  });
});

describe('NV-MESH-001 intent coverage', () => {
  it('every REQUIRED_INTENT_MESH leaf has INTENT coverage', () => {
    const covered = new Set<string>();
    for (const b of INTENT_CAPABILITY_MAP) {
      for (const id of b.capabilityIds) covered.add(id);
    }
    for (const id of REQUIRED_INTENT_MESH_LEAF_IDS) {
      expect(capabilityManifest.get(id), `manifest missing ${id}`).toBeTruthy();
      expect(covered.has(id), `INTENT missing for ${id}`).toBe(true);
    }
  });

  it('core intent tokens resolve', () => {
    for (const token of ['ocr', 'compare', 'automateai', 'bmad', 'web_search', 'grpo']) {
      const ids = getDeclaredCapabilitiesForIntent(token);
      expect(ids && ids.length > 0, `unbound ${token}`).toBe(true);
    }
  });
});
