import { describe, expect, it } from 'vitest';
import {
  parseIntelligenceDepth,
  resolveIntelligenceDepth,
  depthToLegacyDetailLevel,
  depthToPipelineLength,
  depthDeniedForTier,
  DEPTH_WORD_LIMITS,
  depthAnalysisFlags,
} from '../../src/config/jrx-intelligence-depth.js';

describe('./jrx-intelligence-depth', () => {
  it('parses aliases to concise|detailed|comprehensive', () => {
    expect(parseIntelligenceDepth('brief')).toBe('concise');
    expect(parseIntelligenceDepth('short')).toBe('concise');
    expect(parseIntelligenceDepth('standard')).toBe('detailed');
    expect(parseIntelligenceDepth('medium')).toBe('detailed');
    expect(parseIntelligenceDepth('long')).toBe('comprehensive');
    expect(parseIntelligenceDepth('full')).toBe('comprehensive');
  });

  it('resolves from body depth | detailLevel | length', () => {
    expect(resolveIntelligenceDepth({ depth: 'concise' })).toBe('concise');
    expect(resolveIntelligenceDepth({ detailLevel: 'brief' })).toBe('concise');
    expect(resolveIntelligenceDepth({ length: 'long' })).toBe('comprehensive');
  });

  it('maps to legacy gateway and pipeline enums', () => {
    expect(depthToLegacyDetailLevel('concise')).toBe('brief');
    expect(depthToLegacyDetailLevel('detailed')).toBe('standard');
    expect(depthToLegacyDetailLevel('comprehensive')).toBe('detailed');
    expect(depthToPipelineLength('concise')).toBe('short');
    expect(depthToPipelineLength('comprehensive')).toBe('long');
  });

  it('has increasing word budgets', () => {
    expect(DEPTH_WORD_LIMITS.concise).toBeLessThan(DEPTH_WORD_LIMITS.detailed);
    expect(DEPTH_WORD_LIMITS.detailed).toBeLessThan(DEPTH_WORD_LIMITS.comprehensive);
  });

  it('gates comprehensive for free when JRX_ENFORCE_DEPTH_TIERS=1', () => {
    const prev = process.env.JRX_ENFORCE_DEPTH_TIERS;
    process.env.JRX_ENFORCE_DEPTH_TIERS = '1';
    expect(depthDeniedForTier('comprehensive', 'free')).toMatch(/enterprise|pro/i);
    expect(depthDeniedForTier('concise', 'free')).toBeNull();
    process.env.JRX_ENFORCE_DEPTH_TIERS = prev;
  });

  it('expands analysis flags for comprehensive', () => {
    const c = depthAnalysisFlags('concise');
    const f = depthAnalysisFlags('comprehensive');
    expect(c.extractClauses).toBe(false);
    expect(f.extractMissingTerms).toBe(true);
    expect(f.extractPrivacy).toBe(true);
  });
});
