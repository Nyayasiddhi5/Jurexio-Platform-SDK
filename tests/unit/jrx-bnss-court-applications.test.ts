/**
 * NV-BNSS-COURT-APPS-001 — unit tests for 25 BNSS court applications pack.
 */
import { describe, it, expect } from 'vitest';
import {
  BNSS_COURT_APPLICATIONS_25,
  matchBnssCourtApplications,
  formatBnssApplicationsOverlay,
} from '../../src/data/jrx-bnss-court-applications-pack.js';
import {
  buildLegalDraftSystemPrompt,
  inferDraftDocFamily,
} from '../../src/services/jrx-legal-drafting-prompt.js';
import { IN_BNSS_COURT_APPS } from '../../src/data/jrx-statutes-expansion-2026-08-bnss-court-apps.js';
import seed from '../../src/data/jrx-legal-templates/seed-templates-in-bnss-applications-2026-08.json';

describe('BNSS 25 court applications pack', () => {
  it('has exactly 25 applications with template slugs', () => {
    expect(BNSS_COURT_APPLICATIONS_25).toHaveLength(25);
    for (const app of BNSS_COURT_APPLICATIONS_25) {
      expect(app.templateSlug).toMatch(/^in-bnss-/);
      expect(app.sections.length).toBeGreaterThan(0);
    }
  });

  it('seed file has 25 templates + checklist with filing-ready bodies', () => {
    expect(seed).toHaveLength(26);
    const apps = seed.filter((t: { kind?: string }) => t.kind === 'template');
    expect(apps).toHaveLength(25);
    for (const t of apps as Array<{ body: string; slug: string }>) {
      expect(t.body.length).toBeGreaterThanOrEqual(1200);
      expect(t.body).toMatch(/MOST RESPECTFULLY SHOWETH/i);
      expect(t.body).toMatch(/PRAYER/i);
      expect(t.body).toMatch(/BNSS/i);
    }
  });

  it('matches anticipatory bail / default bail / adjournment / discharge', () => {
    expect(matchBnssCourtApplications('draft anticipatory bail under BNSS 482')[0]?.id).toBe(1);
    expect(matchBnssCourtApplications('default bail application section 187')[0]?.id).toBe(3);
    expect(matchBnssCourtApplications('adjournment application tomorrow')[0]?.id).toBe(17);
    expect(matchBnssCourtApplications('discharge in sessions case section 250')[0]?.id).toBe(5);
  });

  it('resolves list-alias sections to correct BNSS headings', () => {
    expect(matchBnssCourtApplications('cancellation of bail section 494')[0]?.sections).toContain('492');
    expect(matchBnssCourtApplications('transfer by high court section 448')[0]?.id).toBe(20);
    expect(matchBnssCourtApplications('custody of property section 499')[0]?.sections).toContain('497');
  });

  it('formats overlay with section-map notes', () => {
    const overlay = formatBnssApplicationsOverlay(matchBnssCourtApplications('regular bail', 2));
    expect(overlay).toMatch(/BNSS/);
    expect(overlay).toMatch(/Template:/);
    expect(overlay).toMatch(/Cancellation=§492/);
  });

  it('injects BNSS overlay into India draft system prompt', () => {
    const sp = buildLegalDraftSystemPrompt({
      jurisdiction: 'IN',
      template: 'custom',
      instruction: 'Draft adjournment application under BNSS',
      partnerBestOutcome: true,
    });
    expect(sp).toMatch(/Adjournment/i);
    expect(sp).toMatch(/346/);
    expect(inferDraftDocFamily('custom', undefined, 'discharge application sessions')).toBe('application');
  });

  it('exports BNSS court-app statute expansion rows', () => {
    expect(IN_BNSS_COURT_APPS.length).toBeGreaterThanOrEqual(20);
    expect(IN_BNSS_COURT_APPS.every((r) => r.actShortTitle === 'BNSS' && r.jurisdiction === 'IN')).toBe(true);
    const secs = new Set(IN_BNSS_COURT_APPS.map((r) => r.sectionNumber));
    for (const s of ['482', '480', '187', '492', '250', '346', '447', '497']) {
      expect(secs.has(s)).toBe(true);
    }
  });
});
