/**
 * US legal document domain packs (Phase C) — schema stubs for complaint, motion, contract.
 */
export const US_DOMAIN_PACK_IDS = ['us-civil-complaint', 'us-motion', 'us-contract'] as const;

export type UsDomainPackId = (typeof US_DOMAIN_PACK_IDS)[number];

export interface UsDomainPackStub {
  id: UsDomainPackId;
  jurisdiction: 'US';
  fields: string[];
}

export const US_DOMAIN_PACK_STUBS: UsDomainPackStub[] = [
  { id: 'us-civil-complaint', jurisdiction: 'US', fields: ['caption', 'jurisdiction', 'parties', 'facts', 'claims', 'prayer'] },
  { id: 'us-motion', jurisdiction: 'US', fields: ['caption', 'motion_type', 'grounds', 'relief'] },
  { id: 'us-contract', jurisdiction: 'US', fields: ['parties', 'recitals', 'terms', 'governing_law', 'signatures'] },
];
