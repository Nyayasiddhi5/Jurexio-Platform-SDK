import { describe, it, expect } from 'vitest';
import {
  enforceSourcesConsulted,
  enforceStatuteFastPathSources,
  hasSourcesConsultedSection,
  buildSourcesConsultedBlock,
  sourcesFromStatuteMapping,
} from '../../src/services/jrx-sources-consulted-enforcer.js';

describe('NV-SOURCES-CONSULTED-001', () => {
  it('detects existing SOURCES CONSULTED section', () => {
    expect(hasSourcesConsultedSection('Answer text\n\n**SOURCES CONSULTED**\n- Case A')).toBe(true);
  });

  it('appends none-retrieved block when RAG ran but no sources', () => {
    const content = '## Issue\nBail is discretionary under BNSS.';
    const result = enforceSourcesConsulted(content, { ragAttempted: true, ragGrounded: false });
    expect(result.appended).toBe(true);
    expect(result.content).toMatch(/SOURCES CONSULTED/i);
    expect(result.content).toMatch(/None retrieved — general principles only/i);
  });

  it('appends retrieved authority names only', () => {
    const content = '## Analysis\nSee Sibbia principles.';
    const result = enforceSourcesConsulted(content, {
      ragGrounded: true,
      retrievedSources: [
        { name: 'Gurbaksh Singh Sibbia v. State of Punjab', citation: '1980 SCC' },
      ],
    });
    expect(result.appended).toBe(true);
    expect(result.content).toContain('Gurbaksh Singh Sibbia');
    expect(result.content).not.toMatch(/fabricated/i);
  });

  it('buildSourcesConsultedBlock formats list', () => {
    const block = buildSourcesConsultedBlock([
      { name: 'Sushila Aggarwal', citation: '(2020) 5 SCC 1', proposition: 'Anticipatory bail discretion' },
    ]);
    expect(block).toMatch(/Sushila Aggarwal/);
    expect(block).toMatch(/\(2020\) 5 SCC 1/);
  });

  it('no-op when section already present', () => {
    const content = 'Text\n\n**SOURCES CONSULTED**\n- Already listed';
    const result = enforceSourcesConsulted(content, { ragAttempted: true });
    expect(result.appended).toBe(false);
    expect(result.content).toBe(content);
  });
});

describe('NV-STATUTE-FAQ-SOURCES-001', () => {
  it('statute mapping fast path appends BNS section source (not fabricated case)', () => {
    const content = [
      '## IPC → BNS § 103',
      '',
      '**IPC 302** (repealed) is replaced by **BNS 103** (Murder).',
    ].join('\n');
    const sources = sourcesFromStatuteMapping({
      fromCode: 'IPC',
      fromSection: '302',
      toCode: 'BNS',
      toSection: '103',
      toHeading: 'Murder',
    });
    const result = enforceStatuteFastPathSources(content, sources);
    expect(result.appended).toBe(true);
    expect(result.content).toMatch(/SOURCES CONSULTED/i);
    expect(result.content).toContain('BNS Section 103');
    expect(result.content).toContain('Murder');
    expect(result.content).not.toMatch(/v\.\s*State of/i);
  });
});
