import { describe, it, expect } from 'vitest';
import {
  inferCourtTypeFromIdentifier,
  inferenceToCaseApiCourtLevel,
} from '../../src/utils/jrx-cnr-court-type-inference.js';

describe('NV-CNR-COURT-TYPE-INFER-001', () => {
  describe('SC diary identifiers', () => {
    it('infers sc + diary for slash form', () => {
      const out = inferCourtTypeFromIdentifier('17329/2025');
      expect(out.courtType).toBe('sc');
      expect(out.kind).toBe('diary');
      expect(out.normalized).toBe('17329/2025');
      expect(out.confidence).toBe('high');
    });

    it('infers sc + diary for compact form', () => {
      const out = inferCourtTypeFromIdentifier('173292025');
      expect(out.courtType).toBe('sc');
      expect(out.kind).toBe('diary');
      expect(out.normalized).toBe('17329/2025');
    });

    it('infers sc + diary for INSC citation', () => {
      const out = inferCourtTypeFromIdentifier('2023 INSC 1081');
      expect(out.courtType).toBe('sc');
      expect(out.kind).toBe('diary');
      expect(out.normalized).toBe('2023 INSC 1081');
    });
  });

  describe('SC case numbers (no CNR resolve)', () => {
    it('infers sc + case_number for SLP', () => {
      const out = inferCourtTypeFromIdentifier('SLP(C) No. 31416/2026');
      expect(out.courtType).toBe('sc');
      expect(out.kind).toBe('case_number');
      expect(out.notes.some((n) => n.includes('diaryNumber'))).toBe(true);
    });

    it('infers sc + case_number for C.A.', () => {
      const out = inferCourtTypeFromIdentifier('C.A. No. 4657/2026');
      expect(out.courtType).toBe('sc');
      expect(out.kind).toBe('case_number');
    });
  });

  describe('HC CNR (positions 3–4 = HC)', () => {
    it('infers hc from MHHC sample', () => {
      const out = inferCourtTypeFromIdentifier('MHHC01-001234-2022');
      expect(out.courtType).toBe('hc');
      expect(out.kind).toBe('cnr');
      expect(out.normalized).toBe('MHHC010012342022');
      expect(out.confidence).toBe('high');
    });

    it('infers hc from RJHC sample', () => {
      const out = inferCourtTypeFromIdentifier('RJHC010012342022');
      expect(out.courtType).toBe('hc');
      expect(out.kind).toBe('cnr');
    });

    /**
     * TSWL is corpus-classified DC despite Telangana association — positions 3–4 are WL not HC.
     * JRX must not treat TSWL as High Court from prefix alone.
     */
    it('documents TSWL tricky case as dc not hc', () => {
      const out = inferCourtTypeFromIdentifier('TSWL000000742024');
      expect(out.courtType).toBe('dc');
      expect(out.kind).toBe('cnr');
      expect(out.notes.some((n) => n.includes('non-HC'))).toBe(true);
      expect(inferenceToCaseApiCourtLevel(out)).toBe('DC');
    });
  });

  describe('SC CNR (SCIN prefix)', () => {
    it('infers sc from SCIN eCourts CNR (not dc)', () => {
      for (const cnr of [
        'SCIN010001372024',
        'SCIN010716542025',
        'SCIN010154682026',
      ]) {
        const out = inferCourtTypeFromIdentifier(cnr);
        expect(out.courtType).toBe('sc');
        expect(out.kind).toBe('cnr');
        expect(inferenceToCaseApiCourtLevel(out)).toBe('SC');
      }
    });
  });

  describe('DC CNR (positions 3–4 != HC)', () => {
    it('infers dc from DLCT sample', () => {
      const out = inferCourtTypeFromIdentifier('DLCT01-000123-2023');
      expect(out.courtType).toBe('dc');
      expect(out.kind).toBe('cnr');
      expect(out.normalized).toBe('DLCT010001232023');
    });

    it('notes B9 duplicate risk for DLCT CNR', () => {
      const out = inferCourtTypeFromIdentifier('DLCT010043082025');
      expect(out.courtType).toBe('dc');
      expect(out.notes.some((n) => n.includes('B9'))).toBe(true);
    });
  });

  describe('edge cases', () => {
    it('returns unknown for empty input', () => {
      const out = inferCourtTypeFromIdentifier('   ');
      expect(out.courtType).toBe('unknown');
      expect(out.kind).toBe('ambiguous');
    });

    it('maps hc inference to nysapi HC', () => {
      const out = inferCourtTypeFromIdentifier('GJHC010012342022');
      expect(inferenceToCaseApiCourtLevel(out)).toBe('HC');
    });

    it('maps sc diary inference to nysapi SC', () => {
      const out = inferCourtTypeFromIdentifier('17329/2025');
      expect(inferenceToCaseApiCourtLevel(out)).toBe('SC');
    });
  });
});
