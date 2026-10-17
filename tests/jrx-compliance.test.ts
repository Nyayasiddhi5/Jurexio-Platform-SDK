/**
 * Compliance Module Tests — ISO 42001 · SOC 2 · EU AI Act · DPDPA · Bias
 * @version 3.1.2
 */
import { describe, it, expect } from 'vitest';
import { aimsService } from '../src/services/aims-ai-management-service.js';
import { euAiActComplianceService } from '../src/services/eu-ai-act-compliance-service.js';

describe('ISO 42001 AIMS Service', () => {
  it('returns AI system inventory', () => {
    const inventory = aimsService.getInventory();
    expect(inventory).toBeInstanceOf(Array);
    expect(inventory.length).toBeGreaterThan(0);
    expect(inventory[0]).toHaveProperty('systemId');
    expect(inventory[0]).toHaveProperty('riskLevel');
    expect(inventory[0]).toHaveProperty('humanOversight');
  });

  it('returns risk register with expected fields', () => {
    const risks = aimsService.getRiskRegister();
    expect(risks.length).toBeGreaterThan(0);
    for (const risk of risks) {
      expect(risk).toHaveProperty('riskId');
      expect(risk).toHaveProperty('riskScore');
      expect(risk.riskScore).toBeGreaterThan(0);
      expect(['open', 'mitigated', 'accepted', 'closed']).toContain(risk.status);
    }
  });

  it('returns model cards', () => {
    const cards = aimsService.getModelCards();
    expect(cards.length).toBeGreaterThan(0);
    expect(cards[0]).toHaveProperty('euAiActClassification');
    expect(cards[0]).toHaveProperty('iso42001Controls');
  });

  it('computes compliance summary', () => {
    const summary = aimsService.getComplianceSummary();
    expect(summary).toHaveProperty('iso42001');
    expect(summary).toHaveProperty('openRisks');
    expect(summary).toHaveProperty('systemsInventoried');
    expect(summary.systemsInventoried).toBeGreaterThan(0);
    expect(typeof summary.openRisks).toBe('number');
  });

  it('filters risk register by systemId', () => {
    const risks = aimsService.getRiskRegister({ systemId: 'nyv-ns-queen' });
    for (const r of risks) expect(r.systemId).toBe('nyv-ns-queen');
  });

  it('filters risk register by status', () => {
    const open = aimsService.getRiskRegister({ status: 'open' });
    for (const r of open) expect(r.status).toBe('open');
  });
});

describe('EU AI Act Compliance Service', () => {
  it('returns classifications for all registered systems', () => {
    const classifications = euAiActComplianceService.getAllClassifications();
    expect(classifications.length).toBeGreaterThan(0);
    for (const c of classifications) {
      expect(['unacceptable', 'high', 'limited', 'minimal']).toContain(c.riskCategory);
      expect(c.obligations.length).toBeGreaterThan(0);
    }
  });

  it('classifies nyv-ns-queen as high risk', () => {
    const c = euAiActComplianceService.classifySystem('nyv-ns-queen');
    expect(c).not.toBeNull();
    expect(c!.riskCategory).toBe('high');
    expect(c!.annexIIICategory).toBeDefined();
  });

  it('returns null for unknown system', () => {
    const c = euAiActComplianceService.classifySystem('nonexistent-system-xyz');
    expect(c).toBeNull();
  });

  it('gap analysis identifies critical gaps', () => {
    const gap = euAiActComplianceService.getComplianceGap();
    expect(gap).toHaveProperty('highRiskSystems');
    expect(gap.highRiskSystems).toBeGreaterThan(0);
    expect(gap.criticalGaps.length).toBeGreaterThan(0);
    expect(gap.nextActions.length).toBeGreaterThan(0);
  });

  it('returns bias reports', () => {
    const reports = euAiActComplianceService.getBiasReport();
    expect(reports.length).toBeGreaterThan(0);
    for (const r of reports) {
      expect(r.overallFairnessScore).toBeGreaterThan(0);
      expect(r.overallFairnessScore).toBeLessThanOrEqual(1);
      expect(r.metrics.length).toBeGreaterThan(0);
      for (const m of r.metrics) {
        expect(['pass', 'fail', 'warning']).toContain(m.status);
      }
    }
  });

  it('filters bias reports by systemId', () => {
    const reports = euAiActComplianceService.getBiasReport('nyv-ns-queen');
    for (const r of reports) expect(r.systemId).toBe('nyv-ns-queen');
  });
});
