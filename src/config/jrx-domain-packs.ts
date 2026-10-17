/**
 * NV-DOMAIN-PACK-001 — multi-domain vertical substrate.
 *
 * DEFAULT PACK = legal. Runtime still loads Jurexio-Legal-registry-*.json
 * (see registry-paths.ts). Do not change NYV_DOMAIN_PACK default or rename
 * Legal filenames in this sprint — partner APIs (orchestrate, legal-chat,
 * legal-work, RAG, CNR, EDJ, platforms) stay frozen.
 *
 * Future pack swap (no new Queen / dashboard / schema): drop
 * Jurexio-{Pack}-registry-Default.json beside Legal, point registryHint
 * at it, seed RAG corpora + master DB. Scaffolds below are documentation
 * only until a domain owner supplies prompts.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

export type DomainPackId = 'legal' | 'general' | 'finance' | 'healthcare';

export interface DomainPack {
  id: DomainPackId;
  displayName: string;
  description: string;
  registryHint: string;
  templateDomains: string[];
  jurisdictions: string[];
  ragFixtureRelPath: string;
  smokeQueries: string[];
  status: 'ga' | 'scaffold';
}

const PACKS: DomainPack[] = [
  {
    id: 'legal',
    displayName: 'Legal (India-first)',
    description: 'Governed Legal AI OS — 164 agents, BNS/BNSS, India templates, caselaw plane.',
    registryHint: 'IN',
    templateDomains: ['legal', 'court', 'filing', 'contract'],
    jurisdictions: ['IN', 'US', 'UK', 'EU', 'SG', 'GC'],
    ragFixtureRelPath: 'tests/fixtures/rag/in-ndcg-sample.json',
    smokeQueries: [
      'What is Section 103 of the Bharatiya Nyaya Sanhita about?',
      'Notice period under Karnataka Rent Act?',
    ],
    status: 'ga',
  },
  {
    id: 'general',
    displayName: 'General enterprise',
    description: 'Cross-domain orchestration substrate — policy, ops, knowledge Q&A.',
    registryHint: 'Default',
    templateDomains: ['policy', 'ops', 'knowledge', 'general'],
    jurisdictions: ['IN', 'US', 'GLOBAL'],
    ragFixtureRelPath: 'tests/fixtures/rag/general-ndcg-sample.json',
    smokeQueries: [
      'Summarize our change-management policy in three bullets.',
      'What is an RACI matrix used for?',
    ],
    status: 'scaffold',
  },
  {
    id: 'finance',
    displayName: 'Finance & compliance ops',
    description: 'Finance vertical scaffold — KYC, vendor risk, board memo (not investment advice).',
    registryHint: 'Default',
    templateDomains: ['finance', 'kyc', 'risk', 'board'],
    jurisdictions: ['IN', 'US', 'GLOBAL'],
    ragFixtureRelPath: 'tests/fixtures/rag/finance-ndcg-sample.json',
    smokeQueries: [
      'Outline a vendor due-diligence checklist for a payment processor.',
      'What sections belong in a quarterly board risk memo?',
    ],
    status: 'scaffold',
  },
  {
    id: 'healthcare',
    displayName: 'Healthcare ops (non-clinical)',
    description: 'Healthcare ops scaffold — privacy, incident intake, BAA checklist (not clinical advice).',
    registryHint: 'Default',
    templateDomains: ['healthcare', 'privacy', 'incident', 'vendor'],
    jurisdictions: ['IN', 'US', 'GLOBAL'],
    ragFixtureRelPath: 'tests/fixtures/rag/healthcare-ndcg-sample.json',
    smokeQueries: [
      'Draft an outline for a patient data incident intake form.',
      'List sections for a vendor BAA review checklist.',
    ],
    status: 'scaffold',
  },
];

export function listDomainPacks(): DomainPack[] {
  return PACKS.map((p) => ({ ...p }));
}

export function getDomainPack(id: string): DomainPack | undefined {
  return PACKS.find((p) => p.id === String(id || '').toLowerCase());
}

export function resolveActiveDomainPack(): DomainPack {
  const envId = String(process.env.NYV_DOMAIN_PACK || 'legal').toLowerCase();
  return getDomainPack(envId) || PACKS[0];
}

export function resolveDomainRagFixture(pack: DomainPack, cwd = process.cwd()): string | null {
  const abs = path.resolve(cwd, pack.ragFixtureRelPath);
  return fs.existsSync(abs) ? abs : null;
}
