/**
 * NYV Jurisdiction Binding Service — binds currency, court structure, clause bank
 * to every AI execution. Mandatory per §3.3.1.
 * @file src/services/jrx-jurisdiction-binding-service.ts
 */

export interface JurisdictionProfile {
  code: string;
  name: string;
  currency: { code: string; symbol: string; name: string };
  courtStructure: string[];
  statutes: { primary: string[]; replaced: Record<string, string> };
  aiFormatRules: {
    dateFormat: string;
    addressFormat: string;
    prohibitedPhrases: string[];
    requiredPhrases: string[];
  };
  complianceFlags: string[];
  language: { primary: string; supported: string[] };
}

export const JURISDICTION_PROFILES: Record<string, JurisdictionProfile> = {
  IN: {
    code: 'IN', name: 'India',
    currency: { code: 'INR', symbol: '₹', name: 'Indian Rupees' },
    courtStructure: [
      'Supreme Court of India', 'High Court', 'District Court',
      'Sessions Court', 'Magistrate Court', 'Tribunal', 'NCLT', 'NCLAT',
      'Consumer Forum', 'Family Court', 'Labour Court',
    ],
    statutes: {
      primary: ['BNS 2023', 'BNSS 2023', 'BSA 2023', 'CPC', 'Companies Act 2013', 'GST Act'],
      replaced: { 'IPC': 'BNS 2023', 'CrPC': 'BNSS 2023', 'Evidence Act': 'BSA 2023' },
    },
    aiFormatRules: {
      dateFormat: 'DD/MM/YYYY',
      addressFormat: 'Street, City, State - PIN Code',
      prohibitedPhrases: [
        'pre-trial discovery', 'District Court, City State ZIP',
        'United States Dollar', 'USD', 'deposition', 'motion practice',
        'IPC', 'CrPC', 'Indian Penal Code', 'Code of Criminal Procedure',
      ],
      requiredPhrases: [],
    },
    complianceFlags: ['DPDPA_2023', 'GST', 'BNS_TERMINOLOGY', 'BNSS_TERMINOLOGY'],
    language: { primary: 'en-IN', supported: ['hi', 'ta', 'te', 'mr', 'bn', 'gu', 'kn', 'ml'] },
  },
  UK: {
    code: 'UK', name: 'United Kingdom',
    currency: { code: 'GBP', symbol: '£', name: 'British Pounds Sterling' },
    courtStructure: [
      'Supreme Court', 'Court of Appeal', 'High Court', 'Crown Court',
      'County Court', 'Magistrates Court', 'Employment Tribunal',
    ],
    statutes: {
      primary: ['Companies Act 2006', 'GDPR', 'UK GDPR', 'Equality Act 2010'],
      replaced: {},
    },
    aiFormatRules: {
      dateFormat: 'DD/MM/YYYY',
      addressFormat: 'Street, City, Postcode',
      prohibitedPhrases: ['IPC', 'BNS', 'INR', 'rupee', 'district court'],
      requiredPhrases: [],
    },
    complianceFlags: ['UK_GDPR', 'CPR'],
    language: { primary: 'en-GB', supported: [] },
  },
  US: {
    code: 'US', name: 'United States',
    currency: { code: 'USD', symbol: '$', name: 'US Dollars' },
    courtStructure: [
      'Supreme Court', 'Circuit Court of Appeals', 'District Court',
      'Bankruptcy Court', 'State Supreme Court', 'State Appellate Court',
    ],
    statutes: {
      primary: ['UCC', 'Federal Rules of Civil Procedure', 'CCPA'],
      replaced: {},
    },
    aiFormatRules: {
      dateFormat: 'MM/DD/YYYY',
      addressFormat: 'Street, City, State ZIP',
      prohibitedPhrases: ['BNS', 'BNSS', 'INR', 'rupee', 'High Court'],
      requiredPhrases: [],
    },
    complianceFlags: ['CCPA', 'HIPAA_READY'],
    language: { primary: 'en-US', supported: [] },
  },
  EU: {
    code: 'EU', name: 'European Union',
    currency: { code: 'EUR', symbol: '€', name: 'Euros' },
    courtStructure: ['CJEU', 'National Courts', 'European Court of Human Rights'],
    statutes: { primary: ['GDPR', 'EU AI Act', 'Digital Services Act'], replaced: {} },
    aiFormatRules: {
      dateFormat: 'DD.MM.YYYY', addressFormat: 'Street, Postal Code City',
      prohibitedPhrases: ['IPC', 'BNS', 'INR'],
      requiredPhrases: [],
    },
    complianceFlags: ['GDPR', 'EU_AI_ACT'],
    language: { primary: 'en', supported: ['de', 'fr', 'es', 'it', 'nl'] },
  },
  GCC: {
    code: 'GCC', name: 'Gulf Cooperation Council',
    currency: { code: 'AED', symbol: 'د.إ', name: 'UAE Dirham' },
    courtStructure: ['Federal Court', 'DIFC Courts', 'ADGM Courts', 'DIAC Arbitration'],
    statutes: { primary: ['UAE Civil Code', 'DIFC Law', 'UAE Cybercrime Law'], replaced: {} },
    aiFormatRules: {
      dateFormat: 'DD/MM/YYYY', addressFormat: 'Building, Area, Emirate',
      prohibitedPhrases: ['IPC', 'BNS', 'INR', 'pre-trial discovery'],
      requiredPhrases: [],
    },
    complianceFlags: ['UAE_PDPL', 'SHARIA_COMPLIANCE'],
    language: { primary: 'en', supported: ['ar'] },
  },
  SG: {
    code: 'SG', name: 'Singapore',
    currency: { code: 'SGD', symbol: 'S$', name: 'Singapore Dollars' },
    courtStructure: ['Court of Appeal', 'High Court', 'SICC', 'District Court', 'SIAC'],
    statutes: { primary: ['Companies Act', 'PDPA', 'Penal Code'], replaced: {} },
    aiFormatRules: {
      dateFormat: 'DD/MM/YYYY', addressFormat: 'Street, Building, Singapore POSTAL',
      prohibitedPhrases: ['IPC', 'BNS', 'INR'],
      requiredPhrases: [],
    },
    complianceFlags: ['PDPA_SG'],
    language: { primary: 'en-SG', supported: ['zh', 'ms', 'ta'] },
  },
};

export class NyvJurisdictionBindingService {
  static bind(jurisdictionCode: string): JurisdictionProfile {
    const profile = JURISDICTION_PROFILES[jurisdictionCode.toUpperCase()];
    if (!profile) {
      throw new Error(`JURISDICTION_NOT_FOUND: ${jurisdictionCode}. Valid: ${Object.keys(JURISDICTION_PROFILES).join(', ')}`);
    }
    return profile;
  }

  static validateOutput(output: string, jurisdictionCode: string): {
    valid: boolean; violations: string[];
  } {
    const profile = this.bind(jurisdictionCode);
    const violations: string[] = [];

    for (const phrase of profile.aiFormatRules.prohibitedPhrases) {
      if (output.toLowerCase().includes(phrase.toLowerCase())) {
        violations.push(`Prohibited phrase "${phrase}" found in ${jurisdictionCode} document`);
      }
    }

    for (const [old, replacement] of Object.entries(profile.statutes.replaced)) {
      if (output.includes(old)) {
        violations.push(`Outdated statute "${old}" — use "${replacement}" in ${jurisdictionCode}`);
      }
    }

    return { valid: violations.length === 0, violations };
  }

  static buildSystemPromptInjection(jurisdictionCode: string): string {
    const profile = this.bind(jurisdictionCode);
    return `
JURISDICTION BINDING: ${profile.name} (${profile.code})
- Currency: ${profile.currency.symbol} ${profile.currency.code} (${profile.currency.name})
- Court Structure: ${profile.courtStructure.join(' → ')}
- Date Format: ${profile.aiFormatRules.dateFormat}
- Address Format: ${profile.aiFormatRules.addressFormat}
- PROHIBITED in this jurisdiction: ${profile.aiFormatRules.prohibitedPhrases.join(', ')}
- UPDATED STATUTES: ${Object.entries(profile.statutes.replaced).map(([o, n]) => `${o} → ${n}`).join(', ') || 'None'}
- Compliance: ${profile.complianceFlags.join(', ')}

ABSOLUTE RULE: All currency references = ${profile.currency.symbol}. All court references = exact jurisdiction court names above. ZERO foreign legal constructs.
`.trim();
  }

  static getAvailableJurisdictions(): string[] {
    return Object.keys(JURISDICTION_PROFILES);
  }
}
