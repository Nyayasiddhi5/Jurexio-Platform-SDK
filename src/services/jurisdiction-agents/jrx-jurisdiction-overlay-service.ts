import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createLogger } from '../../utils/logger.js';

const logger = createLogger('./jrx-jurisdiction-overlay');
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REGISTRIES_DIR = path.join(__dirname, '../../../config/agent-registries');

type JurisdictionCode = 'IN' | 'UK' | 'EU' | 'US' | 'GC' | 'SG';

interface AgentDefinition {
  id: string;
  jurisdiction: string;
  tools: string[];
  supportedLanguages: string[];
  compliance: Record<string, boolean>;
  jurisdictionScope: Record<string, unknown>;
  slmBinding: Record<string, unknown>;
  [key: string]: unknown;
}

interface ValidationReport {
  jurisdiction: string;
  agentCount: number;
  validCount: number;
  issues: string[];
}

const IN_SPECIFIC_TOOLS = ['aadhaar-verify', 'pan-lookup', 'sebi-api'];

const JURISDICTION_TOOLS: Record<string, string[]> = {
  UK: ['companies-house-api', 'fca-register-api', 'hmcts-api', 'legal-research', 'document-generation', 'citation-verification', 'contract-analysis'],
  EU: ['eur-lex-api', 'euipo-api', 'ecj-case-api', 'legal-research', 'document-generation', 'citation-verification', 'contract-analysis'],
  US: ['pacer-api', 'sec-edgar-api', 'uscis-api', 'legal-research', 'document-generation', 'citation-verification', 'contract-analysis'],
  GC: ['difc-api', 'adgm-api', 'uae-moi-api', 'legal-research', 'document-generation', 'citation-verification', 'contract-analysis'],
  SG: ['singpass-api', 'acra-api', 'mas-api', 'siac-api', 'legal-research', 'document-generation', 'citation-verification', 'contract-analysis'],
};

const JURISDICTION_COMPLIANCE: Record<string, Record<string, boolean>> = {
  IN: { dpdpApplicable: true, gdprApplicable: false, hipaaApplicable: false, ukGdprApplicable: false, gccRegionalCompliance: false, pdpaApplicable: false, ccpaApplicable: false, euAiActApplicable: false },
  UK: { dpdpApplicable: false, gdprApplicable: true, hipaaApplicable: false, ukGdprApplicable: true, gccRegionalCompliance: false, pdpaApplicable: false, ccpaApplicable: false, euAiActApplicable: false },
  EU: { dpdpApplicable: false, gdprApplicable: true, hipaaApplicable: false, ukGdprApplicable: false, gccRegionalCompliance: false, pdpaApplicable: false, ccpaApplicable: false, euAiActApplicable: true },
  US: { dpdpApplicable: false, gdprApplicable: false, hipaaApplicable: true, ukGdprApplicable: false, gccRegionalCompliance: false, pdpaApplicable: false, ccpaApplicable: true, euAiActApplicable: false },
  GC: { dpdpApplicable: true, gdprApplicable: false, hipaaApplicable: false, ukGdprApplicable: false, gccRegionalCompliance: true, pdpaApplicable: false, ccpaApplicable: false, euAiActApplicable: false },
  SG: { dpdpApplicable: false, gdprApplicable: false, hipaaApplicable: false, ukGdprApplicable: false, gccRegionalCompliance: false, pdpaApplicable: true, ccpaApplicable: false, euAiActApplicable: false },
};

const JURISDICTION_SLM: Record<string, Record<string, unknown>> = {
  IN: { primarySLM: 'NS-SLM-IND', fallbackSLM: ['NS-SLM-UK', 'NS-SLM-SGP'], requiresLRM: true },
  UK: { primarySLM: 'NS-SLM-UK', fallbackSLM: ['NS-SLM-IND', 'NS-SLM-EU'], requiresLRM: true },
  EU: { primarySLM: 'NS-SLM-EU', fallbackSLM: ['NS-SLM-UK', 'NS-SLM-IND'], requiresLRM: true },
  US: { primarySLM: 'NS-SLM-US', fallbackSLM: ['NS-SLM-UK', 'NS-SLM-IND'], requiresLRM: true },
  GC: { primarySLM: 'NS-SLM-GCC', fallbackSLM: ['NS-SLM-IND', 'NS-SLM-UK'], requiresLRM: true },
  SG: { primarySLM: 'NS-SLM-SGP', fallbackSLM: ['NS-SLM-IND', 'NS-SLM-UK'], requiresLRM: true },
};

const JURISDICTION_LANGUAGES: Record<string, string[]> = {
  IN: ['en', 'hi', 'te', 'ta', 'kn', 'ml', 'mr', 'gu', 'pa', 'or', 'as', 'bn', 'ur'],
  UK: ['en'],
  EU: ['en', 'de', 'fr', 'es', 'it', 'nl', 'pt', 'pl', 'ro'],
  US: ['en', 'es'],
  GC: ['en', 'ar'],
  SG: ['en', 'zh', 'ms', 'ta'],
};

export class NvJurisdictionOverlayService {
  private static instance: NvJurisdictionOverlayService;

  private constructor() {}

  static getInstance(): NvJurisdictionOverlayService {
    if (!NvJurisdictionOverlayService.instance) {
      NvJurisdictionOverlayService.instance = new NvJurisdictionOverlayService();
    }
    return NvJurisdictionOverlayService.instance;
  }

  applyOverlay(agent: AgentDefinition, jurisdiction: JurisdictionCode): AgentDefinition {
    const tools = JURISDICTION_TOOLS[jurisdiction];
    if (tools && jurisdiction !== 'IN') {
      agent.tools = agent.tools.filter(t => !IN_SPECIFIC_TOOLS.includes(t));
      const baseTools = agent.tools.filter(t => !tools.includes(t));
      agent.tools = [...new Set([...baseTools, ...tools])];
    }

    const compliance = JURISDICTION_COMPLIANCE[jurisdiction];
    if (compliance) {
      agent.compliance = { ...agent.compliance, ...compliance };
    }

    const slm = JURISDICTION_SLM[jurisdiction];
    if (slm) {
      agent.slmBinding = { ...agent.slmBinding, ...slm };
    }

    const languages = JURISDICTION_LANGUAGES[jurisdiction];
    if (languages) {
      agent.supportedLanguages = languages;
    }

    return agent;
  }

  async generateRegistryOverlays(jurisdiction: JurisdictionCode): Promise<number> {
    const fileMap: Record<string, string> = {
      IN: 'Jurexio-Legal-registry-IN.json',
      UK: 'Jurexio-Legal-registry-UK.json',
      EU: 'Jurexio-Legal-registry-EU.json',
      US: 'Jurexio-Legal-registry-US.json',
      GC: 'Jurexio-Legal-registry-GC.json',
      SG: 'Jurexio-Legal-registry-SG.json',
    };

    const file = fileMap[jurisdiction];
    if (!file) return 0;

    const filePath = path.join(REGISTRIES_DIR, file);
    const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    let modified = 0;

    for (const agent of data.agents) {
      this.applyOverlay(agent, jurisdiction);
      modified++;
    }

    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
    logger.info({ service: 'NvJurisdictionOverlayService', jurisdiction, modified });
    return modified;
  }

  async validateOverlays(jurisdiction: JurisdictionCode): Promise<ValidationReport> {
    const fileMap: Record<string, string> = {
      IN: 'Jurexio-Legal-registry-IN.json',
      UK: 'Jurexio-Legal-registry-UK.json',
      EU: 'Jurexio-Legal-registry-EU.json',
      US: 'Jurexio-Legal-registry-US.json',
      GC: 'Jurexio-Legal-registry-GC.json',
      SG: 'Jurexio-Legal-registry-SG.json',
    };

    const file = fileMap[jurisdiction];
    if (!file) return { jurisdiction, agentCount: 0, validCount: 0, issues: ['Unknown jurisdiction'] };

    const filePath = path.join(REGISTRIES_DIR, file);
    const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    const issues: string[] = [];
    let validCount = 0;

    for (const agent of data.agents) {
      let valid = true;
      if (jurisdiction !== 'IN') {
        for (const tool of IN_SPECIFIC_TOOLS) {
          if (agent.tools?.includes(tool)) {
            issues.push(`${agent.id}: still has IN-specific tool '${tool}'`);
            valid = false;
          }
        }
      }
      if (valid) validCount++;
    }

    return { jurisdiction, agentCount: data.agents.length, validCount, issues };
  }
}

export const nvJurisdictionOverlayService = NvJurisdictionOverlayService.getInstance();

if (process.argv[1] && (process.argv[1].includes('./jrx-jurisdiction-overlay-service') || process.argv.includes('--run-overlays'))) {
  (async () => {
    console.log('Applying jurisdiction overlays...\n');
    const jurisdictions: JurisdictionCode[] = ['IN', 'UK', 'EU', 'US', 'GC', 'SG'];
    for (const j of jurisdictions) {
      const count = await nvJurisdictionOverlayService.generateRegistryOverlays(j);
      const report = await nvJurisdictionOverlayService.validateOverlays(j);
      console.log(`  ✓ ${j}: ${count} agents overlaid, ${report.validCount}/${report.agentCount} valid`);
      if (report.issues.length > 0) {
        report.issues.forEach(i => console.log(`    ⚠ ${i}`));
      }
    }
    console.log('\nJurisdiction overlays complete.');
  })();
}
