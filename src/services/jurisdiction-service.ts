/**
 * Jurisdiction Service - Global Legal Operating System
 * 
 * Manages 6 jurisdictions with:
 * - Data residency requirements
 * - Compliance rules (GDPR, CCPA, DPDP, PDPA)
 * - LLM routing based on jurisdiction
 * - Language support
 * - Legal agent distribution
 */

interface Jurisdiction {
  code: string;
  name: string;
  region: string;
  statutes: number;
  courts: number;
  agents: number;
  languages: string[];
  primaryLanguage: string;
  compliance: ComplianceRule[];
  dataResidency: DataResidencyConfig;
  llmRouting: LLMRoutingConfig;
  status: 'active' | 'beta' | 'development';
}

interface ComplianceRule {
  id: string;
  name: string;
  description: string;
  requirements: string[];
  enforcementLevel: 'mandatory' | 'recommended' | 'optional';
  penalties?: string;
}

interface DataResidencyConfig {
  primaryRegion: string;
  allowedRegions: string[];
  dataLocalisation: boolean;
  crossBorderTransfer: boolean;
  encryptionRequired: boolean;
  retentionPeriod: string;
  deletionPolicy: string;
}

interface LLMRoutingConfig {
  primaryProvider: string;
  primaryModel: string;
  fallbackProviders: string[];
  dataResidencyCompliant: boolean;
  preferredForLanguages: string[];
  costTier: 'economy' | 'standard' | 'premium';
}

interface JurisdictionAgent {
  id: string;
  name: string;
  jurisdiction: string;
  practiceArea: string;
  specialization: string;
  languages: string[];
  status: 'active' | 'ready';
}

class JurisdictionService {
  private jurisdictions: Jurisdiction[] = [
    {
      code: 'IN',
      name: 'India',
      region: 'Asia Pacific',
      statutes: 15,
      courts: 12,
      agents: 200,
      languages: ['hi', 'en', 'bn', 'te', 'mr', 'ta', 'gu', 'kn', 'ml', 'pa', 'or', 'as', 'mai', 'sat', 'ks', 'ne', 'sd', 'kok', 'doi', 'mni', 'sa', 'bo'],
      primaryLanguage: 'en',
      compliance: [
        {
          id: 'dpdp',
          name: 'Digital Personal Data Protection Act 2023',
          description: 'India\'s primary data protection law',
          requirements: [
            'Consent-based processing',
            'Data localisation for sensitive data',
            'Data principal rights',
            'Data fiduciary obligations',
            'Cross-border transfer restrictions'
          ],
          enforcementLevel: 'mandatory',
          penalties: 'Up to ₹250 crore per violation'
        },
        {
          id: 'it_act',
          name: 'Information Technology Act 2000',
          description: 'Cybersecurity and electronic governance',
          requirements: [
            'Reasonable security practices',
            'Data breach notification',
            'Intermediary liability'
          ],
          enforcementLevel: 'mandatory'
        },
        {
          id: 'bar_council',
          name: 'Bar Council of India Rules',
          description: 'Professional conduct for advocates',
          requirements: [
            'Client confidentiality',
            'No advertising restrictions',
            'Professional ethics compliance'
          ],
          enforcementLevel: 'mandatory'
        }
      ],
      dataResidency: {
        primaryRegion: 'ap-south-1',
        allowedRegions: ['ap-south-1', 'ap-south-2'],
        dataLocalisation: true,
        crossBorderTransfer: false,
        encryptionRequired: true,
        retentionPeriod: '7 years',
        deletionPolicy: 'Secure deletion within 30 days of request'
      },
      llmRouting: {
        primaryProvider: 'sarvam-ai',
        primaryModel: 'saaras-1.0',
        fallbackProviders: ['krutrim', 'openai', 'anthropic'],
        dataResidencyCompliant: true,
        preferredForLanguages: ['hi', 'bn', 'te', 'mr', 'ta', 'gu', 'kn', 'ml', 'pa'],
        costTier: 'standard'
      },
      status: 'active'
    },
    {
      code: 'US',
      name: 'United States',
      region: 'North America',
      statutes: 50,
      courts: 50,
      agents: 50,
      languages: ['en', 'es'],
      primaryLanguage: 'en',
      compliance: [
        {
          id: 'ccpa',
          name: 'California Consumer Privacy Act',
          description: 'California consumer privacy rights',
          requirements: [
            'Right to know',
            'Right to delete',
            'Right to opt-out',
            'Right to non-discrimination',
            'Privacy policy requirements'
          ],
          enforcementLevel: 'mandatory',
          penalties: 'Up to $7,500 per intentional violation'
        },
        {
          id: 'hipaa',
          name: 'Health Insurance Portability and Accountability Act',
          description: 'Healthcare data protection',
          requirements: [
            'Protected health information safeguards',
            'Business associate agreements',
            'Breach notification'
          ],
          enforcementLevel: 'mandatory'
        },
        {
          id: 'sox',
          name: 'Sarbanes-Oxley Act',
          description: 'Financial data protection',
          requirements: [
            'Internal controls',
            'Audit trail requirements',
            'Document retention'
          ],
          enforcementLevel: 'mandatory'
        },
        {
          id: 'state_bar',
          name: 'ABA Model Rules of Professional Conduct',
          description: 'Attorney professional conduct',
          requirements: [
            'Client confidentiality',
            'Competent representation',
            'Technology competence'
          ],
          enforcementLevel: 'mandatory'
        }
      ],
      dataResidency: {
        primaryRegion: 'us-east-1',
        allowedRegions: ['us-east-1', 'us-west-2', 'us-east-2'],
        dataLocalisation: false,
        crossBorderTransfer: true,
        encryptionRequired: true,
        retentionPeriod: '5 years',
        deletionPolicy: 'Deletion within 45 days of verified request'
      },
      llmRouting: {
        primaryProvider: 'openai',
        primaryModel: 'gpt-4.1',
        fallbackProviders: ['anthropic', 'google'],
        dataResidencyCompliant: true,
        preferredForLanguages: ['en', 'es'],
        costTier: 'premium'
      },
      status: 'active'
    },
    {
      code: 'EU',
      name: 'Europe',
      region: 'Europe',
      statutes: 30,
      courts: 30,
      agents: 50,
      languages: ['en', 'de', 'fr', 'es', 'it', 'nl', 'pl'],
      primaryLanguage: 'en',
      compliance: [
        {
          id: 'gdpr',
          name: 'General Data Protection Regulation',
          description: 'EU comprehensive data protection law',
          requirements: [
            'Lawful basis for processing',
            'Data subject rights (access, rectification, erasure, portability)',
            'Privacy by design',
            'Data protection impact assessments',
            'Data protection officer requirement',
            'Cross-border transfer restrictions (SCCs, adequacy)',
            '72-hour breach notification'
          ],
          enforcementLevel: 'mandatory',
          penalties: 'Up to €20M or 4% of global annual turnover'
        },
        {
          id: 'eu_ai_act',
          name: 'EU AI Act',
          description: 'AI system regulation',
          requirements: [
            'Risk-based classification',
            'High-risk AI transparency',
            'Human oversight requirements'
          ],
          enforcementLevel: 'mandatory'
        },
        {
          id: 'ccbe',
          name: 'CCBE Code of Conduct',
          description: 'European lawyers code of conduct',
          requirements: [
            'Professional secrecy',
            'Conflicts of interest',
            'Cross-border practice rules'
          ],
          enforcementLevel: 'mandatory'
        }
      ],
      dataResidency: {
        primaryRegion: 'eu-central-1',
        allowedRegions: ['eu-central-1', 'eu-west-1', 'eu-west-2', 'eu-west-3', 'eu-north-1'],
        dataLocalisation: true,
        crossBorderTransfer: false,
        encryptionRequired: true,
        retentionPeriod: '10 years',
        deletionPolicy: 'Right to erasure within 30 days'
      },
      llmRouting: {
        primaryProvider: 'mistral',
        primaryModel: 'mistral-large-3',
        fallbackProviders: ['anthropic'],
        dataResidencyCompliant: true,
        preferredForLanguages: ['de', 'fr', 'es', 'it', 'nl', 'pl'],
        costTier: 'premium'
      },
      status: 'active'
    },
    {
      code: 'AE',
      name: 'GCC Region',
      region: 'Middle East',
      statutes: 8,
      courts: 5,
      agents: 25,
      languages: ['ar', 'en'],
      primaryLanguage: 'en',
      compliance: [
        {
          id: 'difc_dp',
          name: 'DIFC Data Protection Law',
          description: 'Dubai International Financial Centre data protection',
          requirements: [
            'Data protection registration',
            'Lawful processing',
            'Data subject rights',
            'Cross-border transfers'
          ],
          enforcementLevel: 'mandatory'
        },
        {
          id: 'adgm_dp',
          name: 'ADGM Data Protection Regulations',
          description: 'Abu Dhabi Global Market data protection',
          requirements: [
            'Personal data processing principles',
            'Controller obligations',
            'Commissioner notification'
          ],
          enforcementLevel: 'mandatory'
        }
      ],
      dataResidency: {
        primaryRegion: 'me-south-1',
        allowedRegions: ['me-south-1'],
        dataLocalisation: true,
        crossBorderTransfer: false,
        encryptionRequired: true,
        retentionPeriod: '5 years',
        deletionPolicy: 'Deletion upon request'
      },
      llmRouting: {
        primaryProvider: 'mistral',
        primaryModel: 'mistral-large-3',
        fallbackProviders: ['openai'],
        dataResidencyCompliant: true,
        preferredForLanguages: ['ar', 'en'],
        costTier: 'standard'
      },
      status: 'active'
    },
    {
      code: 'SA',
      name: 'GCC',
      region: 'Middle East',
      statutes: 6,
      courts: 4,
      agents: 25,
      languages: ['ar', 'en'],
      primaryLanguage: 'ar',
      compliance: [
        {
          id: 'pdpl',
          name: 'Personal Data Protection Law',
          description: 'GCC\'s data protection law',
          requirements: [
            'Consent for processing',
            'Data minimization',
            'Security measures',
            'Cross-border transfer approval'
          ],
          enforcementLevel: 'mandatory',
          penalties: 'Up to SAR 5M per violation'
        }
      ],
      dataResidency: {
        primaryRegion: 'me-south-1',
        allowedRegions: ['me-south-1'],
        dataLocalisation: true,
        crossBorderTransfer: false,
        encryptionRequired: true,
        retentionPeriod: '5 years',
        deletionPolicy: 'Deletion upon request'
      },
      llmRouting: {
        primaryProvider: 'mistral',
        primaryModel: 'mistral-large-3',
        fallbackProviders: ['openai'],
        dataResidencyCompliant: true,
        preferredForLanguages: ['ar'],
        costTier: 'standard'
      },
      status: 'active'
    },
    {
      code: 'SG',
      name: 'Singapore',
      region: 'Asia Pacific',
      statutes: 10,
      courts: 6,
      agents: 25,
      languages: ['en', 'zh', 'ms', 'ta'],
      primaryLanguage: 'en',
      compliance: [
        {
          id: 'pdpa',
          name: 'Personal Data Protection Act',
          description: 'Singapore\'s data protection law',
          requirements: [
            'Consent obligation',
            'Purpose limitation',
            'Notification obligation',
            'Access and correction',
            'Data protection policy',
            'Cross-border transfer restrictions'
          ],
          enforcementLevel: 'mandatory',
          penalties: 'Up to SGD 1M per violation'
        },
        {
          id: 'mas_guidelines',
          name: 'MAS Technology Risk Guidelines',
          description: 'Financial sector technology risk',
          requirements: [
            'Technology risk management',
            'Cyber security',
            'System availability'
          ],
          enforcementLevel: 'mandatory'
        }
      ],
      dataResidency: {
        primaryRegion: 'ap-southeast-1',
        allowedRegions: ['ap-southeast-1'],
        dataLocalisation: false,
        crossBorderTransfer: true,
        encryptionRequired: true,
        retentionPeriod: '5 years',
        deletionPolicy: 'Deletion within 30 days of request'
      },
      llmRouting: {
        primaryProvider: 'openai',
        primaryModel: 'gpt-4.1',
        fallbackProviders: ['anthropic', 'google'],
        dataResidencyCompliant: true,
        preferredForLanguages: ['en', 'zh'],
        costTier: 'premium'
      },
      status: 'active'
    }
  ];

  getJurisdictions() {
    return this.jurisdictions.map(j => ({
      code: j.code,
      name: j.name,
      region: j.region,
      statutes: j.statutes,
      courts: j.courts,
      agents: j.agents,
      languages: j.languages.length,
      primaryLanguage: j.primaryLanguage,
      status: j.status
    }));
  }

  getJurisdictionByCode(code: string): Jurisdiction | undefined {
    return this.jurisdictions.find(j => j.code.toLowerCase() === code.toLowerCase());
  }

  getComplianceRules(jurisdictionCode: string): ComplianceRule[] {
    const jurisdiction = this.getJurisdictionByCode(jurisdictionCode);
    return jurisdiction?.compliance || [];
  }

  getDataResidencyConfig(jurisdictionCode: string): DataResidencyConfig | undefined {
    const jurisdiction = this.getJurisdictionByCode(jurisdictionCode);
    return jurisdiction?.dataResidency;
  }

  getLLMRoutingConfig(jurisdictionCode: string): LLMRoutingConfig | undefined {
    const jurisdiction = this.getJurisdictionByCode(jurisdictionCode);
    return jurisdiction?.llmRouting;
  }

  routeLLMByJurisdiction(jurisdictionCode: string): { provider: string; model: string; fallbacks: string[] } {
    const config = this.getLLMRoutingConfig(jurisdictionCode);
    if (!config) {
      return {
        provider: 'openai',
        model: 'gpt-4.1',
        fallbacks: ['anthropic', 'google']
      };
    }
    return {
      provider: config.primaryProvider,
      model: config.primaryModel,
      fallbacks: config.fallbackProviders
    };
  }

  validateDataTransfer(fromJurisdiction: string, toJurisdiction: string): {
    allowed: boolean;
    requirements: string[];
    safeguards: string[];
  } {
    const fromConfig = this.getDataResidencyConfig(fromJurisdiction);
    const toConfig = this.getDataResidencyConfig(toJurisdiction);

    if (!fromConfig || !toConfig) {
      return { allowed: false, requirements: ['Unknown jurisdiction'], safeguards: [] };
    }

    if (fromConfig.dataLocalisation && !fromConfig.crossBorderTransfer) {
      return {
        allowed: false,
        requirements: ['Data localisation required - cross-border transfer not permitted'],
        safeguards: []
      };
    }

    const requirements: string[] = [];
    const safeguards: string[] = [];

    if (fromJurisdiction === 'EU') {
      requirements.push('Standard Contractual Clauses (SCCs) required');
      requirements.push('Supplementary measures assessment');
      safeguards.push('Encryption in transit and at rest');
      safeguards.push('Access controls');
    }

    if (fromJurisdiction === 'IN') {
      requirements.push('DPDP Act cross-border provisions compliance');
      safeguards.push('Adequate security measures');
    }

    return {
      allowed: true,
      requirements,
      safeguards
    };
  }

  getLanguagesForJurisdiction(jurisdictionCode: string): string[] {
    const jurisdiction = this.getJurisdictionByCode(jurisdictionCode);
    return jurisdiction?.languages || ['en'];
  }

  getGlobalStats() {
    return {
      totalJurisdictions: this.jurisdictions.length,
      totalStatutes: this.jurisdictions.reduce((acc, j) => acc + j.statutes, 0),
      totalCourts: this.jurisdictions.reduce((acc, j) => acc + j.courts, 0),
      totalAgents: this.jurisdictions.reduce((acc, j) => acc + j.agents, 0),
      totalLanguages: [...new Set(this.jurisdictions.flatMap(j => j.languages))].length,
      complianceFrameworks: this.jurisdictions.flatMap(j => j.compliance.map(c => c.name)),
      dataResidencyRegions: [...new Set(this.jurisdictions.flatMap(j => j.dataResidency.allowedRegions))]
    };
  }

  getComplianceSummary() {
    return {
      gdpr: { jurisdiction: 'EU', status: 'active', scope: 'Data protection' },
      ccpa: { jurisdiction: 'US', status: 'active', scope: 'Consumer privacy' },
      dpdp: { jurisdiction: 'IN', status: 'active', scope: 'Personal data protection' },
      pdpa: { jurisdiction: 'SG', status: 'active', scope: 'Personal data protection' },
      pdpl: { jurisdiction: 'SA', status: 'active', scope: 'Data protection' },
      difc: { jurisdiction: 'AE', status: 'active', scope: 'Financial zone data protection' }
    };
  }
}

export const jurisdictionService = new JurisdictionService();
export type { Jurisdiction, ComplianceRule, DataResidencyConfig, LLMRoutingConfig, JurisdictionAgent };
