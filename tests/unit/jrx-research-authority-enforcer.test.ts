import { describe, it, expect } from 'vitest';
import {
  enforceResearchAuthorities,
  formatLocatableAuthorityLine,
  buildResearchAuthoritiesBlock,
  mergeRetrievedAuthoritySources,
  sourcesFromCitationsEnvelope,
} from '../../src/services/jrx-research-authority-enforcer.js';
import { countLocatableAuthorities } from '../../src/utils/jrx-authority-body-detection.js';
import {
  detectReporterCitations,
  detectCaseNames,
} from '../../scripts/_nv-counsel-grade-assertions.js';

describe('NV-RESEARCH-AUTHORITY-ENFORCE-001', () => {
  it('no-op when body already carries locatable authorities', () => {
    const body = 'In Sushila Aggarwal versus State (NCT of Delhi), (2020) 5 SCC 1, the Court held.';
    const result = enforceResearchAuthorities(body, {
      taskType: 'legal_research',
      citations: { verified: 1, details: [{ title: 'Sushila Aggarwal', citation: '(2020) 5 SCC 1' }] },
      retrievedSources: [{ name: 'Other Case', citation: 'AIR 2019 SC 1' }],
    });
    expect(result.appended).toBe(false);
    expect(result.content).toBe(body);
  });

  it('appends AUTHORITIES block when envelope had sources but body is citation-free', () => {
    const body = [
      '## Section 139 NI Act presumption',
      'The presumption under Section 139 is rebuttable on preponderance of probabilities.',
      'The burden shifts once cheque and signature are proved.',
    ].join('\n');
    expect(countLocatableAuthorities(body)).toBe(0);

    const sources = [
      { name: 'Rangappa versus Sri Mohan', citation: '(2010) 11 SCC 93' },
      { name: 'Basalingappa versus Muddenahalli', citation: '(2019) 5 SCC 418' },
    ];
    const result = enforceResearchAuthorities(body, {
      taskType: 'legal_research',
      citations: { verified: 2, unverified: 0, details: sources.map((s) => ({ title: s.name, citation: s.citation })) },
      retrievedSources: sources,
    });
    expect(result.appended).toBe(true);
    expect(result.content).toMatch(/\*\*AUTHORITIES\*\*/);
    expect(result.locatableAfter).toBeGreaterThanOrEqual(1);
    expect(detectReporterCitations(result.content).length).toBeGreaterThanOrEqual(1);
  });

  it('formatLocatableAuthorityLine keeps party pair adjacent to reporter cite', () => {
    const line = formatLocatableAuthorityLine({
      name: 'Rangappa versus Sri Mohan',
      citation: '(2010) 11 SCC 93',
    });
    expect(line).toBe('- Rangappa versus Sri Mohan, (2010) 11 SCC 93');
    const names = detectCaseNames(`Research note. ${line!.replace(/^- /, '')}`);
    expect(names.cited.length).toBeGreaterThanOrEqual(1);
  });

  it('mergeRetrievedAuthoritySources dedupes context + citations', () => {
    const merged = mergeRetrievedAuthoritySources({
      retrievedSources: [{ name: 'A v. B', citation: '(2020) 1 SCC 1' }],
      citations: { details: [{ title: 'A v. B', citation: '(2020) 1 SCC 1' }, { title: 'C v. D', citation: 'AIR 2018 SC 10' }] },
    });
    expect(merged).toHaveLength(2);
  });

  it('buildResearchAuthoritiesBlock returns empty without locatable lines', () => {
    expect(buildResearchAuthoritiesBlock([{ name: 'Statute only' }])).toBe('');
  });

  it('skips non-research task types', () => {
    const result = enforceResearchAuthorities('No citations here.', {
      taskType: 'legal-draft-fast',
      retrievedSources: [{ name: 'X v. Y', citation: '(2020) 1 SCC 1' }],
    });
    expect(result.appended).toBe(false);
  });

  it('sourcesFromCitationsEnvelope ignores statute-only verifier strings', () => {
    const sources = sourcesFromCitationsEnvelope({
      verified: 5,
      details: [
        { text: 'Section 139 NI Act' },
        { text: 'Section 138 Negotiable Instruments Act' },
        { title: 'Rangappa versus Sri Mohan', citation: '(2010) 11 SCC 93' },
      ],
    });
    expect(sources).toHaveLength(1);
    expect(sources[0]?.name).toMatch(/Rangappa/i);
  });
});
