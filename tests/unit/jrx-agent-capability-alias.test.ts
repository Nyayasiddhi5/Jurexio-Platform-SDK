import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  TASK_TYPE_CAPABILITY_ALIASES,
  SUBJECT_AGENT_NAME_HINTS,
  capabilitiesForTaskType,
  classifySubjectArea,
  nameHintsForSubject,
  normalizeTaskToken,
  researchAgentIdForCapabilities,
} from '../../src/services/jrx-agent-capability-alias.js';

/**
 * Reads the registry from disk rather than through the service, so these tests
 * assert against the real source of truth without booting the service graph.
 */
function loadRegistryAgents(): Array<{
  id: string; name: string; tier: string; capabilities: string[];
  jurisdictions?: string[]; jurisdiction?: string; description?: string;
}> {
  const dir = path.resolve(process.cwd(), 'config/agent-registries');
  const byId = new Map<string, never>();
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
      : ((parsed as { agents?: unknown[]; registry?: unknown[] })?.agents
        ?? (parsed as { registry?: unknown[] })?.registry ?? []);
    for (const a of arr as Array<{ id?: string }>) {
      if (a?.id && !byId.has(a.id)) byId.set(a.id, a as never);
    }
  }
  return [...byId.values()] as never;
}

const AGENTS = loadRegistryAgents();
const ALL_CAPS = new Set(AGENTS.flatMap((a) => (a.capabilities ?? []).map((c) => String(c).toLowerCase())));

describe('NV-AGENT-CAPABILITY-ALIAS-001: the alias table matches the real registry', () => {
  it('loads the registry (control — everything below is meaningless without it)', () => {
    expect(AGENTS.length).toBeGreaterThan(100);
    expect(ALL_CAPS.size).toBeGreaterThan(20);
  });

  it('every aliased capability exists in config/agent-registries/*.json', () => {
    // A typo here silently reintroduces the generic fallback for that task,
    // which is exactly the failure this table was written to close.
    const unknown: string[] = [];
    for (const [task, caps] of Object.entries(TASK_TYPE_CAPABILITY_ALIASES)) {
      for (const c of caps) {
        if (!ALL_CAPS.has(c.toLowerCase())) unknown.push(`${task} -> ${c}`);
      }
    }
    expect(unknown, 'aliases pointing at capabilities no agent declares').toEqual([]);
  });

  it('every subject name-hint matches at least one real agent name', () => {
    const dead: string[] = [];
    for (const [area, hints] of Object.entries(SUBJECT_AGENT_NAME_HINTS)) {
      for (const h of hints) {
        const hit = AGENTS.some((a) => `${a.name ?? ''} ${a.description ?? ''}`.toLowerCase().includes(h.toLowerCase()));
        if (!hit) dead.push(`${area} -> "${h}"`);
      }
    }
    expect(dead, 'name hints matching no agent (agent renamed?)').toEqual([]);
  });
});

describe('NV-AGENT-CAPABILITY-ALIAS-001: task vocabulary is bridged', () => {
  it('treats snake_case, kebab-case and spacing as the same task', () => {
    expect(normalizeTaskToken('legal_research')).toBe('legal-research');
    expect(normalizeTaskToken('Legal Research')).toBe('legal-research');
    // The alias-derived capabilities must be identical. The trailing
    // never-regress raw token is excluded from the comparison because it is
    // intentionally verbatim: `legal_research` appends itself, while
    // `legal-research` already appears and de-duplicates.
    const drop = new Set(['legal_research', 'legal-research', 'legal research']);
    const snake = capabilitiesForTaskType('legal_research').filter((c) => !drop.has(c));
    const kebab = capabilitiesForTaskType('legal-research').filter((c) => !drop.has(c));
    const spaced = capabilitiesForTaskType('Legal Research').filter((c) => !drop.has(c));
    expect(snake).toEqual(kebab);
    expect(spaced).toEqual(kebab);
  });

  it('maps statute_lookup to statute-retrieval, which shares no substring', () => {
    // The exact pair that proved a raw `includes()` test could never work.
    expect(capabilitiesForTaskType('statute_lookup')).toContain('statute-retrieval');
    expect('statute-retrieval'.includes('statute_lookup')).toBe(false);
  });

  it('maps citation_check to citation-verification', () => {
    expect(capabilitiesForTaskType('citation_check')).toContain('citation-verification');
  });

  it('resolves a qualified task by its trailing words', () => {
    expect(capabilitiesForTaskType('corporate_contract_review')).toContain('clause-extraction');
  });

  it('keeps the raw token last so previously-binding requests cannot regress', () => {
    const out = capabilitiesForTaskType('some_unmapped_task');
    expect(out[out.length - 1]).toBe('some_unmapped_task');
  });

  it('orders capabilities best-match-first', () => {
    const out = capabilitiesForTaskType('legal_research');
    expect(out.indexOf('case-law-research')).toBeLessThan(out.indexOf('multi-hop-rag'));
  });

  it('NV-PARTNER-TASKTYPE-ALIAS-001: -fast taskTypes mirror bare partner bindings', () => {
    expect(TASK_TYPE_CAPABILITY_ALIASES['legal-chat-fast'])
      .toEqual(TASK_TYPE_CAPABILITY_ALIASES['legal-chat']);
    expect(TASK_TYPE_CAPABILITY_ALIASES['legal-draft-fast'])
      .toEqual(TASK_TYPE_CAPABILITY_ALIASES['legal-draft']);
    expect(TASK_TYPE_CAPABILITY_ALIASES['doc-draft-fast'])
      .toEqual(TASK_TYPE_CAPABILITY_ALIASES['doc-draft']);

    expect(capabilitiesForTaskType('legal-chat-fast')).toContain('case-law-research');
    expect(capabilitiesForTaskType('legal-draft-fast')).toContain('document-generation');
    expect(capabilitiesForTaskType('doc-draft-fast')).toContain('document-generation');
  });
});

describe('NV-PARTNER-TASKTYPE-ALIAS-001: -fast binds a named registry agent', () => {
  const TIER_PRIORITY: Record<string, number> = {
    sovereign: 5, expert: 4, professional: 3, assistant: 2, executor: 1,
  };

  function resolveAgentByCapability(taskType: string): { id: string; name: string } | null {
    const ranked: Array<{ agent: typeof AGENTS[0]; capRank: number; subjectRank: number }> = [];
    const wanted = capabilitiesForTaskType(taskType);
    const nameHints = nameHintsForSubject('general');

    for (const a of AGENTS) {
      const caps = (a.capabilities ?? []).map((c) => c.toLowerCase());
      if (caps.length === 0) continue;
      let capRank = -1;
      for (let i = 0; i < wanted.length; i += 1) {
        const w = wanted[i].toLowerCase();
        if (caps.some((c) => c === w || c.includes(w))) { capRank = i; break; }
      }
      if (capRank === -1) continue;

      const haystack = `${a.name ?? ''} ${a.description ?? ''}`.toLowerCase();
      let subjectRank = nameHints.length;
      for (let i = 0; i < nameHints.length; i += 1) {
        if (haystack.includes(nameHints[i].toLowerCase())) { subjectRank = i; break; }
      }
      ranked.push({ agent: a, capRank, subjectRank });
    }
    if (ranked.length === 0) return null;
    ranked.sort((x, y) => {
      if (x.capRank !== y.capRank) return x.capRank - y.capRank;
      if (x.subjectRank !== y.subjectRank) return x.subjectRank - y.subjectRank;
      const t = (TIER_PRIORITY[y.agent.tier] || 0) - (TIER_PRIORITY[x.agent.tier] || 0);
      if (t !== 0) return t;
      return x.agent.id.localeCompare(y.agent.id);
    });
    const hit = ranked[0].agent;
    return { id: hit.id, name: String(hit.name ?? '') };
  }

  it('legal-chat-fast binds the same named agent as legal-chat (not generic)', () => {
    const bare = resolveAgentByCapability('legal-chat');
    const fast = resolveAgentByCapability('legal-chat-fast');
    expect(bare, 'control: bare legal-chat must bind').toBeTruthy();
    expect(fast, 'legal-chat-fast must bind a specialist').toBeTruthy();
    expect(fast!.id).toBe(bare!.id);
    expect(fast!.id).not.toBe('generic');
  });

  it('legal-draft-fast and doc-draft-fast bind the same drafting specialist as bare', () => {
    const bare = resolveAgentByCapability('legal-draft');
    const draftFast = resolveAgentByCapability('legal-draft-fast');
    const docFast = resolveAgentByCapability('doc-draft-fast');
    expect(bare, 'control: bare legal-draft must bind').toBeTruthy();
    expect(draftFast!.id).toBe(bare!.id);
    expect(docFast!.id).toBe(bare!.id);
    expect(draftFast!.id).not.toBe('generic');
  });
});

describe('NV-AGENT-SUBJECT-MATTER-001: subject classification', () => {
  it('classifies a BNS/IPC murder question as criminal', () => {
    // The regression the user reported: this must not land on tax or general.
    expect(classifySubjectArea('Which BNS section replaces IPC 302 for murder?')).toBe('criminal');
  });

  it('classifies GST input tax credit as tax', () => {
    expect(classifySubjectArea('Is GST input tax credit available on cab services?')).toBe('tax');
  });

  it('classifies an IBC/NCLT question as insolvency, not corporate', () => {
    expect(classifySubjectArea('CIRP timeline under IBC for a corporate debtor before NCLT')).toBe('insolvency');
  });

  it('prefers a multi-word keyword over a bare one', () => {
    // "hindu marriage" (family) must outrank a stray "marriage".
    expect(classifySubjectArea('Section 13B Hindu Marriage Act mutual divorce')).toBe('family');
  });

  it('falls back to general when no subject keyword appears', () => {
    expect(classifySubjectArea('Please summarise the attached document.')).toBe('general');
  });

  it('does not match a keyword inside a longer word', () => {
    // "please" contains "lease": a bare substring test classified generic
    // summarisation requests as property law and bound a real estate specialist.
    expect(classifySubjectArea('Please review and please confirm.')).toBe('general');
    // …while a real lease question still classifies as property.
    expect(classifySubjectArea('Is the lease renewable after five years?')).toBe('property');
  });

  it('still matches multi-word keywords across spaces', () => {
    expect(classifySubjectArea('Claim for transfer of property between co-owners')).toBe('property');
  });

  it('gives general no name hints, so ranking falls back to capability + tier', () => {
    expect(nameHintsForSubject('general')).toEqual([]);
  });
});

describe('NV-AGENT-SUBJECT-MATTER-001: capabilities cannot discriminate specialists', () => {
  it('proves capability sets are shared, which is why name matching is required', () => {
    // 164 agents share only a handful of capability sets, so capability+tier
    // ranking alone returns whichever agent happens to sort first.
    const sets = new Set(AGENTS.map((a) => (a.capabilities ?? []).slice().sort().join('|')));
    expect(sets.size).toBeLessThan(20);
    expect(AGENTS.length / sets.size).toBeGreaterThan(5);
  });

  it('the research group contains many same-capability, different-subject agents', () => {
    const research = AGENTS.filter((a) => (a.capabilities ?? []).includes('case-law-research'));
    expect(research.length).toBeGreaterThan(10);
    const criminal = research.find((a) => /criminal/i.test(a.name));
    const tax = research.find((a) => /tax/i.test(a.name));
    expect(criminal, 'a criminal-law researcher must exist').toBeTruthy();
    expect(tax, 'a tax-law researcher must exist').toBeTruthy();
    // Identical capabilities: only the name separates them.
    expect((criminal!.capabilities ?? []).slice().sort())
      .toEqual((tax!.capabilities ?? []).slice().sort());
  });
});

describe('NV-AGENT-RESEARCH-PIN-001: differentiate A-047 / A-048 / A-051', () => {
  it('maps statute-retrieval to A-047', () => {
    expect(researchAgentIdForCapabilities(['statute-retrieval', 'case-law-research'])).toBe('A-047');
  });

  it('maps case-law-research to A-048 when statute is absent', () => {
    expect(researchAgentIdForCapabilities(['case-law-research', 'precedent-analysis'])).toBe('A-048');
  });

  it('maps precedent-analysis to A-051', () => {
    expect(researchAgentIdForCapabilities(['precedent-analysis'])).toBe('A-051');
  });

  it('statute-research task alias prefers statute-retrieval capability', () => {
    expect(capabilitiesForTaskType('statute-research')).toContain('statute-retrieval');
  });
});
