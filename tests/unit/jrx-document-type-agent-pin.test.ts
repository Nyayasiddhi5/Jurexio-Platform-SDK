import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  DOCUMENT_TYPE_AGENT_PIN,
  resolvePinnedAgentIdForDocumentType,
  shouldApplyDocumentTypeAgentPin,
} from '../../src/services/jrx-document-type-agent-pin.js';
import { DRAFT_LENGTH_REGISTRY } from '../../src/config/jrx-draft-length-registry.js';

function loadRegistryIds(): Set<string> {
  const dir = path.resolve(process.cwd(), 'config/agent-registries');
  const ids = new Set<string>();
  for (const file of fs.readdirSync(dir)) {
    if (!file.endsWith('.json')) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
    } catch {
      continue;
    }
    const arr = Array.isArray(parsed)
      ? parsed
      : ((parsed as { agents?: unknown[] })?.agents ?? []);
    for (const a of arr as Array<{ id?: string }>) {
      if (a?.id) ids.add(a.id);
    }
  }
  return ids;
}

describe('NV-DOCUMENT-TYPE-AGENT-PIN-001', () => {
  const registryIds = loadRegistryIds();

  it('maps every draft registry type including general fallback', () => {
    const registryKeys = Object.keys(DRAFT_LENGTH_REGISTRY);
    expect(registryKeys).toContain('general_legal_document');
    for (const key of registryKeys) {
      expect(DOCUMENT_TYPE_AGENT_PIN[key as keyof typeof DOCUMENT_TYPE_AGENT_PIN]).toBeTruthy();
    }
  });

  it('every pinned agent id exists in the registry', () => {
    const unknown: string[] = [];
    for (const id of new Set(Object.values(DOCUMENT_TYPE_AGENT_PIN))) {
      if (!registryIds.has(id)) unknown.push(id);
    }
    expect(unknown).toEqual([]);
  });

  it('pins bail_application to A-004 Pleading', () => {
    expect(resolvePinnedAgentIdForDocumentType({ documentType: 'bail_application' })).toBe('A-004');
  });

  it('pins legal_notice to A-005', () => {
    expect(resolvePinnedAgentIdForDocumentType({ documentType: 'legal_notice' })).toBe('A-005');
  });

  it('pins affidavit_case to A-006', () => {
    expect(resolvePinnedAgentIdForDocumentType({ documentType: 'affidavit_case' })).toBe('A-006');
  });

  it('pins simple_agreement and nda to A-001', () => {
    expect(resolvePinnedAgentIdForDocumentType({ documentType: 'simple_agreement' })).toBe('A-001');
    expect(resolvePinnedAgentIdForDocumentType({ documentType: 'nda' })).toBe('A-001');
  });

  it('pins writ_petition and criminal_petition to A-004', () => {
    expect(resolvePinnedAgentIdForDocumentType({ documentType: 'writ_petition' })).toBe('A-004');
    expect(resolvePinnedAgentIdForDocumentType({ documentType: 'criminal_petition' })).toBe('A-004');
  });

  it('applies pin only on partner draft task types', () => {
    expect(shouldApplyDocumentTypeAgentPin('legal-draft-fast')).toBe(true);
    expect(shouldApplyDocumentTypeAgentPin('legal-chat-fast')).toBe(false);
  });
});
