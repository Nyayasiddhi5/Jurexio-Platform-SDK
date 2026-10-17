/**
 * Unit Tests — NyvJurisdictionBindingService
 * Tests: 6 jurisdiction profiles, prohibited phrases, statute replacement detection
 * Coverage target: 100% branches on jurisdiction binding logic
 */
import { describe, it, expect } from 'vitest';
import { NyvJurisdictionBindingService, JURISDICTION_PROFILES } from '../../../src/services/jrx-jurisdiction-binding-service.js';

describe('NyvJurisdictionBindingService', () => {
  describe('bind() — profile lookup', () => {
    it('binds correct currency for India', () => {
      const profile = NyvJurisdictionBindingService.bind('IN');
      expect(profile.currency.code).toBe('INR');
      expect(profile.currency.symbol).toBe('₹');
      expect(profile.currency.name).toBe('Indian Rupees');
    });

    it('binds correct currency for UK', () => {
      const profile = NyvJurisdictionBindingService.bind('UK');
      expect(profile.currency.code).toBe('GBP');
      expect(profile.currency.symbol).toBe('£');
    });

    it('binds correct currency for US', () => {
      const profile = NyvJurisdictionBindingService.bind('US');
      expect(profile.currency.code).toBe('USD');
      expect(profile.currency.symbol).toBe('$');
    });

    it('binds correct currency for EU', () => {
      const profile = NyvJurisdictionBindingService.bind('EU');
      expect(profile.currency.code).toBe('EUR');
      expect(profile.currency.symbol).toBe('€');
    });

    it('binds correct currency for GCC', () => {
      const profile = NyvJurisdictionBindingService.bind('GCC');
      expect(profile.currency.code).toBe('AED');
    });

    it('binds correct currency for Singapore', () => {
      const profile = NyvJurisdictionBindingService.bind('SG');
      expect(profile.currency.code).toBe('SGD');
    });

    it('is case-insensitive', () => {
      const profileLower = NyvJurisdictionBindingService.bind('in');
      const profileUpper = NyvJurisdictionBindingService.bind('IN');
      expect(profileLower.code).toBe(profileUpper.code);
    });

    it('throws JURISDICTION_NOT_FOUND for unknown code', () => {
      expect(() => NyvJurisdictionBindingService.bind('XY')).toThrow('JURISDICTION_NOT_FOUND');
    });

    it('throws with valid jurisdiction list in error message', () => {
      try {
        NyvJurisdictionBindingService.bind('UNKNOWN');
      } catch (err: any) {
        expect(err.message).toContain('Valid:');
        expect(err.message).toContain('IN');
      }
    });
  });

  describe('validateOutput() — prohibited phrase detection', () => {
    it('detects IPC as prohibited phrase for India', () => {
      const { valid, violations } = NyvJurisdictionBindingService.validateOutput(
        'Under IPC Section 302, the accused is liable.',
        'IN'
      );
      expect(valid).toBe(false);
      expect(violations.length).toBeGreaterThan(0);
      expect(violations.some(v => v.includes('IPC'))).toBe(true);
    });

    it('detects CrPC as prohibited phrase for India', () => {
      const { valid, violations } = NyvJurisdictionBindingService.validateOutput(
        'The CrPC provision shall apply.',
        'IN'
      );
      expect(valid).toBe(false);
      expect(violations.some(v => v.toLowerCase().includes('crpc'))).toBe(true);
    });

    it('detects Indian Penal Code as prohibited for India', () => {
      const { valid, violations } = NyvJurisdictionBindingService.validateOutput(
        'Under the Indian Penal Code, Section 420.',
        'IN'
      );
      expect(valid).toBe(false);
      expect(violations.length).toBeGreaterThan(0);
    });

    it('detects pre-trial discovery as prohibited for India', () => {
      const { valid, violations } = NyvJurisdictionBindingService.validateOutput(
        'The parties shall proceed with pre-trial discovery.',
        'IN'
      );
      expect(valid).toBe(false);
      expect(violations.some(v => v.includes('pre-trial discovery'))).toBe(true);
    });

    it('returns valid for clean BNS-compliant Indian output', () => {
      const { valid, violations } = NyvJurisdictionBindingService.validateOutput(
        'Under Bharatiya Nyaya Sanhita (BNS) 2023 Section 302, the High Court of Delhi held.',
        'IN'
      );
      expect(valid).toBe(true);
      expect(violations).toHaveLength(0);
    });

    it('detects INR as prohibited for US output', () => {
      const { valid, violations } = NyvJurisdictionBindingService.validateOutput(
        'The settlement amount is INR 10,00,000.',
        'US'
      );
      expect(valid).toBe(false);
      expect(violations.some(v => v.includes('INR'))).toBe(true);
    });
  });

  describe('validateOutput() — statute replacement detection', () => {
    it('flags outdated Evidence Act for India (should be BSA 2023)', () => {
      const { valid, violations } = NyvJurisdictionBindingService.validateOutput(
        'Section 65B of the Evidence Act applies.',
        'IN'
      );
      expect(valid).toBe(false);
      expect(violations.some(v => v.includes('Evidence Act'))).toBe(true);
    });

    it('validates against all replaced statutes for India', () => {
      const profile = JURISDICTION_PROFILES['IN'];
      const replacedStatutes = Object.keys(profile.statutes.replaced);
      expect(replacedStatutes).toContain('IPC');
      expect(replacedStatutes).toContain('CrPC');
      expect(replacedStatutes).toContain('Evidence Act');
    });
  });

  describe('buildSystemPromptInjection()', () => {
    it('returns non-empty string for all 6 jurisdictions', () => {
      for (const code of ['IN', 'UK', 'US', 'EU', 'GCC', 'SG']) {
        const injection = NyvJurisdictionBindingService.buildSystemPromptInjection(code);
        expect(injection.length).toBeGreaterThan(50);
        expect(injection).toContain('JURISDICTION BINDING');
        expect(injection).toContain('ABSOLUTE RULE');
      }
    });

    it('includes correct currency for India', () => {
      const injection = NyvJurisdictionBindingService.buildSystemPromptInjection('IN');
      expect(injection).toContain('₹');
      expect(injection).toContain('INR');
    });

    it('lists prohibited phrases', () => {
      const injection = NyvJurisdictionBindingService.buildSystemPromptInjection('IN');
      expect(injection).toContain('PROHIBITED');
      expect(injection).toContain('IPC');
    });

    it('shows statute replacements for India', () => {
      const injection = NyvJurisdictionBindingService.buildSystemPromptInjection('IN');
      expect(injection).toContain('BNS 2023');
      expect(injection).toContain('BNSS 2023');
    });
  });

  describe('getAvailableJurisdictions()', () => {
    it('returns all 6 supported jurisdictions', () => {
      const jurisdictions = NyvJurisdictionBindingService.getAvailableJurisdictions();
      expect(jurisdictions).toHaveLength(6);
      expect(jurisdictions).toContain('IN');
      expect(jurisdictions).toContain('UK');
      expect(jurisdictions).toContain('US');
      expect(jurisdictions).toContain('EU');
      expect(jurisdictions).toContain('GCC');
      expect(jurisdictions).toContain('SG');
    });
  });

  describe('JURISDICTION_PROFILES constant', () => {
    it('all profiles have required fields', () => {
      for (const profile of Object.values(JURISDICTION_PROFILES)) {
        expect(profile.code).toBeTruthy();
        expect(profile.name).toBeTruthy();
        expect(profile.currency.code).toBeTruthy();
        expect(profile.currency.symbol).toBeTruthy();
        expect(profile.courtStructure.length).toBeGreaterThan(0);
        expect(profile.complianceFlags.length).toBeGreaterThan(0);
      }
    });
  });
});
