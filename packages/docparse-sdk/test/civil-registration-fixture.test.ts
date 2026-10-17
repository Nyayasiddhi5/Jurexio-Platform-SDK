import { describe, it, expect } from 'vitest';
import { classify } from '../src/doctype/classify.js';
import { LEGAL_IN_CIVIL_PACK } from '../src/domain/domain-pack.js';
import type { Page } from '../src/types.js';
import { runAnchorProfile } from '../src/anchors/engine.js';
import { PROFILE_INDEX } from '../src/anchors/profiles.js';

/** Synthetic Vasee-class registration scan text (no PII). */
export const VASEE_CLASS_SYNTHETIC_TEXT = `
Mee Seva — Government of Telangana
Certificate of Registration
Name of establishment: Vasee and Company Synthetic Pvt Ltd
Registration No.: TS-REG-2025-0042
Corporate Identity Number (CIN): U74999TS2025PTC000042
Registered office address: Plot 12, HITEC City, Hyderabad, Telangana 500081
Date of registration: 15-03-2025
Department: Industries and Commerce
`.trim();

function syntheticPage(text: string): Page {
  const lines = text.split('\n').map((t, i) => ({
    text: t.trim(),
    bbox: { x: 36, y: 36 + i * 14, w: 500, h: 12 },
    lineIndex: i,
  }));
  return {
    pageNo: 1,
    width: 595,
    height: 842,
    deskewDeg: 0,
    lines,
    blocks: [],
    tables: [],
    script: 'Latn',
    route: 'OCR',
    quality: { textLayerCoverage: 0, meanConf: 0.82, garbleRate: 0.02, handwrittenSuspected: false },
  };
}

describe('civil registration fixture (Vasee-class synthetic)', () => {
  it('classifies as STATE_COMPANY_REGISTRATION under legal-in-civil', () => {
    const pages = [syntheticPage(VASEE_CLASS_SYNTHETIC_TEXT)];
    const hit = classify(pages, { extraProfiles: LEGAL_IN_CIVIL_PACK.docTypes });
    expect(hit.code).toBe('STATE_COMPANY_REGISTRATION');
  });

  it('extracts at least one company field via anchors', () => {
    const pages = [syntheticPage(VASEE_CLASS_SYNTHETIC_TEXT)];
    const profile = PROFILE_INDEX.get('COMPANY_REGISTRATION');
    expect(profile).toBeDefined();
    const candidates = runAnchorProfile(profile!, pages, 'doc-synthetic', 1);
    const paths = new Set(candidates.map((c) => c.fieldPath));
    expect(paths.has('company.name') || paths.has('registration.number') || paths.has('ids.cin')).toBe(true);
  });
});
