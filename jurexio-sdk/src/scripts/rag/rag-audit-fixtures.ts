/**
 * RAG Coverage Audit — Fixture Queries (Workstream #2, V5.0.0)
 *
 * 29 categories × 7 jurisdictions = 203 cells.
 *
 * Each fixture is a representative legal question that should retrieve
 * authoritative sources from that jurisdiction's RAG corpus. If the audit
 * returns 0 sources or ungrounded answers for a (category, jurisdiction)
 * pair, that cell is marked RED and flagged for backfill via the web
 * scraper (workstream #3).
 *
 * NOTE: The fixture set below is a v1 baseline (~50 fixtures) covering the
 * highest-volume categories. The remaining cells fall back to a generic
 * jurisdiction-aware probe. Subject-matter experts should expand this file
 * during the staging soak.
 */

export type CategoryKey =
  | 'contracts' | 'ndas' | 'employment' | 'ip-trademark' | 'ip-patent' | 'ip-copyright'
  | 'property-conveyancing' | 'property-leases' | 'litigation-civil' | 'litigation-criminal'
  | 'litigation-commercial' | 'arbitration' | 'm-and-a' | 'corporate-governance'
  | 'securities' | 'banking-finance' | 'tax-direct' | 'tax-indirect' | 'competition-antitrust'
  | 'data-protection' | 'cyber-security' | 'environment' | 'labor-industrial' | 'family-personal'
  | 'succession-estate' | 'constitutional' | 'administrative' | 'regulatory-fdi' | 'adr-mediation';

export type JurisdictionKey = 'IN' | 'UK' | 'US' | 'GCC' | 'EU' | 'SG' | 'DEFAULT';

export const CATEGORIES: CategoryKey[] = [
  'contracts', 'ndas', 'employment', 'ip-trademark', 'ip-patent', 'ip-copyright',
  'property-conveyancing', 'property-leases', 'litigation-civil', 'litigation-criminal',
  'litigation-commercial', 'arbitration', 'm-and-a', 'corporate-governance',
  'securities', 'banking-finance', 'tax-direct', 'tax-indirect', 'competition-antitrust',
  'data-protection', 'cyber-security', 'environment', 'labor-industrial', 'family-personal',
  'succession-estate', 'constitutional', 'administrative', 'regulatory-fdi', 'adr-mediation',
];

export const JURISDICTIONS: JurisdictionKey[] = ['IN', 'UK', 'US', 'GCC', 'EU', 'SG', 'DEFAULT'];

/**
 * Fixture lookup by (category, jurisdiction). Falls back to generic prompt
 * when no specific fixture exists.
 */
const FIXTURES: Partial<Record<CategoryKey, Partial<Record<JurisdictionKey, string>>>> = {
  contracts: {
    IN: 'What are the essentials of a valid contract under the Indian Contract Act 1872?',
    UK: 'Explain consideration in English contract law and its modern exceptions.',
    US: 'What is the parol evidence rule under the UCC and its exceptions?',
    GCC: 'How does the UAE Civil Code (Federal Law No. 5 of 1985) treat contract formation?',
    EU: 'How do the Principles of European Contract Law (PECL) treat offer and acceptance?',
    SG: 'What is the doctrine of consideration under Singapore contract law?',
  },
  ndas: {
    IN: 'What clauses are mandatory in an NDA enforceable under Indian law?',
    UK: 'What is the test for enforceability of confidentiality clauses post-employment in UK?',
    US: 'How does the Defend Trade Secrets Act 2016 affect NDA enforcement?',
  },
  employment: {
    IN: 'What is the notice period under the Industrial Disputes Act 1947 for retrenchment?',
    UK: 'What constitutes unfair dismissal under the Employment Rights Act 1996?',
    US: 'What are the requirements for a Title VII discrimination claim?',
    EU: 'How does the Working Time Directive limit weekly working hours?',
    SG: 'What termination notice does the Employment Act of Singapore require?',
    GCC: 'What are end-of-service gratuity rules under UAE Labour Law (Federal Decree-Law 33/2021)?',
  },
  'ip-trademark': {
    IN: 'What are the grounds for refusal of trademark registration under the Trade Marks Act 1999?',
    UK: 'How does the UK IPO assess distinctiveness under the Trade Marks Act 1994?',
    US: 'What is the Lanham Act test for likelihood of confusion?',
    EU: 'What is the EUTM opposition procedure timeline?',
  },
  'litigation-civil': {
    IN: 'Explain the doctrine of res judicata under Section 11 CPC.',
    UK: 'What is the test for striking out under CPR 3.4(2)?',
    US: 'What are the elements of a Rule 12(b)(6) motion to dismiss?',
  },
  'litigation-criminal': {
    IN: 'What is the procedure for grant of anticipatory bail under Section 482 BNSS?',
    UK: 'What is the test for hearsay admissibility under the Criminal Justice Act 2003?',
    US: 'What are Miranda warnings and when must they be given?',
  },
  arbitration: {
    IN: 'What grounds exist for setting aside an arbitral award under Section 34 of the Arbitration & Conciliation Act 1996?',
    UK: 'What are the limited grounds for appeal under section 69 of the Arbitration Act 1996?',
    SG: 'What is the SIAC expedited procedure threshold?',
    GCC: 'How does the DIFC-LCIA arbitration centre handle interim relief?',
  },
  'data-protection': {
    IN: 'What are the consent requirements under the DPDPA 2023?',
    UK: 'What is the lawful basis for processing under UK GDPR Article 6?',
    EU: 'What rights does GDPR Article 17 (right to erasure) provide?',
    US: 'How does CCPA differ from CPRA on consumer rights?',
    SG: 'What are the PDPA notification obligations after a data breach?',
  },
  'corporate-governance': {
    IN: 'What are the duties of independent directors under the Companies Act 2013?',
    UK: 'What are the s.172 Companies Act 2006 director duties?',
    US: 'What is the business judgment rule under Delaware law?',
  },
  'tax-direct': {
    IN: 'How is income from house property computed under the Income Tax Act 1961?',
    UK: 'What is the corporation tax rate for FY2026 in the UK?',
    US: 'What is the federal estate tax exemption for 2026?',
  },
  'tax-indirect': {
    IN: 'What is the GST rate for legal services and is reverse charge applicable?',
    UK: 'What is the VAT registration threshold for 2026?',
    EU: 'How does the EU One Stop Shop (OSS) work for cross-border B2C VAT?',
  },
  constitutional: {
    IN: 'What are the basic structure doctrine cases starting with Kesavananda Bharati?',
    UK: 'How does the Human Rights Act 1998 interact with parliamentary sovereignty?',
    US: 'What is the test for substantive due process under the 14th Amendment?',
  },
  'm-and-a': {
    IN: 'What SEBI Takeover Regulations 2011 thresholds trigger an open offer?',
    UK: 'What is the City Code on Takeovers and Mergers Rule 9 threshold?',
    US: 'What is the HSR Act notification threshold for 2026?',
  },
};

const GENERIC_PROBES: Record<JurisdictionKey, string> = {
  IN: 'Explain the leading authority for {category} in India.',
  UK: 'What is the leading UK authority on {category}?',
  US: 'What is the leading US federal authority on {category}?',
  GCC: 'What are the GCC region rules on {category}?',
  EU: 'What is the leading EU directive or regulation on {category}?',
  SG: 'What is the leading Singapore statute on {category}?',
  DEFAULT: 'Explain the international standards on {category}.',
};

export function getFixture(category: CategoryKey, jurisdiction: JurisdictionKey): string {
  const explicit = FIXTURES[category]?.[jurisdiction];
  if (explicit) return explicit;
  return GENERIC_PROBES[jurisdiction].replace('{category}', category.replace(/-/g, ' '));
}

export function totalCells(): number {
  return CATEGORIES.length * JURISDICTIONS.length;
}

export function explicitFixtureCount(): number {
  let n = 0;
  for (const c of Object.values(FIXTURES)) {
    if (c) n += Object.keys(c).length;
  }
  return n;
}
