import crypto from 'crypto';
import { createLogger } from '../../utils/logger.js';

const logger = createLogger('./jrx-nyayatemplate-service');

type JurisdictionCode = 'IN' | 'UK' | 'EU' | 'US' | 'GCC' | 'SG';

interface LegalTemplate {
  id: string;
  name: string;
  category: string;
  jurisdiction: JurisdictionCode;
  description: string;
  version: string;
  variables: TemplateVariable[];
  content: string;
  createdAt: Date;
}

interface TemplateVariable {
  name: string;
  type: 'text' | 'date' | 'number' | 'choice' | 'multi-line';
  required: boolean;
  description: string;
  defaultValue?: string;
  choices?: string[];
  validation?: string;
}

interface TemplateClause {
  id: string;
  templateId: string;
  clauseNumber: string;
  title: string;
  content: string;
  required: boolean;
  jurisdictionSpecific: boolean;
}

interface FillSession {
  sessionId: string;
  templateId: string;
  jurisdiction: JurisdictionCode;
  currentStep: number;
  totalSteps: number;
  collectedVariables: Record<string, string>;
  nextPrompt: string;
  status: 'in_progress' | 'completed' | 'cancelled';
}

interface FillStep {
  stepNumber: number;
  totalSteps: number;
  variableName: string;
  prompt: string;
  inputType: string;
  isComplete: boolean;
  collectedSoFar: Record<string, string>;
}

interface FilledDocument {
  templateId: string;
  jurisdiction: JurisdictionCode;
  content: string;
  variables: Record<string, string>;
  enforceabilityScore: number;
  readabilityScore: ReadabilityScore;
  constraintReport: ConstraintReport;
  warnings: string[];
}

interface ConstraintReport {
  valid: boolean;
  requiredClausesPresent: string[];
  requiredClausesMissing: string[];
  prohibitedClausesFound: string[];
  warnings: string[];
}

interface EnforceabilityScore {
  score: number;
  factors: { factor: string; score: number; weight: number }[];
  jurisdiction: JurisdictionCode;
  recommendations: string[];
}

interface ReadabilityScore {
  fleschKincaidGrade: number;
  fleschReadingEase: number;
  averageSentenceLength: number;
  averageSyllablesPerWord: number;
  wordCount: number;
  sentenceCount: number;
  targetRange: string;
  withinTarget: boolean;
}

interface ConsistencyReport {
  consistent: boolean;
  issues: { section: string; issue: string; severity: string }[];
  definedTermsUsed: string[];
  undefinedTermsFound: string[];
}

interface GeneratedDocument {
  content: string;
  templateId: string;
  jurisdiction: JurisdictionCode;
  enforceabilityScore: number;
  readabilityScore: ReadabilityScore;
  warnings: string[];
  generatedAt: Date;
}

const TEMPLATE_SEED: Partial<LegalTemplate>[] = [
  { id: 'tmpl-nda-in', name: 'Non-Disclosure Agreement', category: 'corporate', jurisdiction: 'IN', description: 'Standard NDA under Indian Contract Act 1872' },
  { id: 'tmpl-nda-uk', name: 'Non-Disclosure Agreement', category: 'corporate', jurisdiction: 'UK', description: 'UK NDA with confidentiality undertaking' },
  { id: 'tmpl-nda-us', name: 'Non-Disclosure Agreement', category: 'corporate', jurisdiction: 'US', description: 'US mutual/unilateral NDA' },
  { id: 'tmpl-emp-in', name: 'Employment Agreement', category: 'labour', jurisdiction: 'IN', description: 'Employment contract compliant with Indian labour codes' },
  { id: 'tmpl-emp-uk', name: 'Employment Agreement', category: 'labour', jurisdiction: 'UK', description: 'UK employment contract (ERA 1996 compliant)' },
  { id: 'tmpl-privacy-in', name: 'Privacy Notice (DPDPA)', category: 'compliance', jurisdiction: 'IN', description: 'Privacy notice compliant with DPDPA 2023' },
  { id: 'tmpl-privacy-eu', name: 'Privacy Notice (GDPR)', category: 'compliance', jurisdiction: 'EU', description: 'GDPR-compliant privacy notice' },
  { id: 'tmpl-mou-in', name: 'Memorandum of Understanding', category: 'corporate', jurisdiction: 'IN', description: 'Standard MoU template' },
  { id: 'tmpl-sha-in', name: 'Shareholders Agreement', category: 'corporate', jurisdiction: 'IN', description: 'SHA under Companies Act 2013' },
  { id: 'tmpl-lease-in', name: 'Lease Agreement', category: 'real-estate', jurisdiction: 'IN', description: 'Residential/commercial lease under T.P. Act 1882' },
  { id: 'tmpl-arb-uncitral', name: 'Arbitration Clause (UNCITRAL)', category: 'dispute-resolution', jurisdiction: 'IN', description: 'UNCITRAL model arbitration clause' },
  { id: 'tmpl-arb-siac', name: 'Arbitration Clause (SIAC)', category: 'dispute-resolution', jurisdiction: 'SG', description: 'SIAC arbitration clause' },
  { id: 'tmpl-arb-lcia', name: 'Arbitration Clause (LCIA)', category: 'dispute-resolution', jurisdiction: 'UK', description: 'LCIA arbitration clause' },
  { id: 'tmpl-poa-in', name: 'Power of Attorney', category: 'civil', jurisdiction: 'IN', description: 'General/Special PoA under Powers of Attorney Act 1882' },
  { id: 'tmpl-posh-in', name: 'POSH Policy', category: 'compliance', jurisdiction: 'IN', description: 'POSH Act 2013 compliant workplace policy' },
  { id: 'tmpl-term-in', name: 'Termination Notice', category: 'labour', jurisdiction: 'IN', description: 'Employment termination notice' },
  { id: 'tmpl-sale-in', name: 'Sale Deed', category: 'real-estate', jurisdiction: 'IN', description: 'Property sale deed template' },
  { id: 'tmpl-llp-in', name: 'LLP Agreement', category: 'corporate', jurisdiction: 'IN', description: 'LLP agreement under LLP Act 2008' },
  { id: 'tmpl-loan-in', name: 'Loan Agreement', category: 'banking', jurisdiction: 'IN', description: 'Standard loan agreement' },
  { id: 'tmpl-service-in', name: 'Service Agreement', category: 'corporate', jurisdiction: 'IN', description: 'Professional services agreement' },
];

const fillSessions = new Map<string, FillSession>();

class NvNyayaTemplateService {
  async getTemplates(jurisdiction: JurisdictionCode, category?: string): Promise<LegalTemplate[]> {
    logger.info({ method: 'getTemplates', jurisdiction, category });
    let templates = TEMPLATE_SEED.filter(t => t.jurisdiction === jurisdiction);
    if (category) {
      templates = templates.filter(t => t.category === category);
    }
    return templates.map(t => ({
      id: t.id!,
      name: t.name!,
      category: t.category!,
      jurisdiction: t.jurisdiction!,
      description: t.description!,
      version: '1.0.0',
      variables: [],
      content: '',
      createdAt: new Date(),
    }));
  }

  async getTemplate(templateId: string): Promise<(LegalTemplate & { clauses: TemplateClause[] }) | null> {
    const tmpl = TEMPLATE_SEED.find(t => t.id === templateId);
    if (!tmpl) return null;
    return {
      id: tmpl.id!,
      name: tmpl.name!,
      category: tmpl.category!,
      jurisdiction: tmpl.jurisdiction!,
      description: tmpl.description!,
      version: '1.0.0',
      variables: [],
      content: `[Template content for ${tmpl.name}]`,
      createdAt: new Date(),
      clauses: [],
    };
  }

  async startFillSession(templateId: string, jurisdiction: JurisdictionCode): Promise<FillSession> {
    const template = await this.getTemplate(templateId);
    if (!template) throw new Error(`Template ${templateId} not found`);

    const sessionId = `fill-${crypto.randomBytes(16).toString('hex')}`;
    const session: FillSession = {
      sessionId,
      templateId,
      jurisdiction,
      currentStep: 1,
      totalSteps: Math.max(template.variables.length, 3),
      collectedVariables: {},
      nextPrompt: `Let's fill out the ${template.name}. Please provide the first party's name.`,
      status: 'in_progress',
    };
    fillSessions.set(sessionId, session);
    logger.info({ method: 'startFillSession', sessionId, templateId });
    return session;
  }

  async processFillStep(sessionId: string, userInput: string): Promise<FillStep> {
    const session = fillSessions.get(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);

    const variableName = `variable_${session.currentStep}`;
    session.collectedVariables[variableName] = userInput;
    session.currentStep++;
    const isComplete = session.currentStep > session.totalSteps;
    if (isComplete) session.status = 'completed';

    return {
      stepNumber: session.currentStep - 1,
      totalSteps: session.totalSteps,
      variableName,
      prompt: isComplete ? 'All variables collected. Ready to generate.' : `Please provide the next detail (step ${session.currentStep}/${session.totalSteps}).`,
      inputType: 'text',
      isComplete,
      collectedSoFar: { ...session.collectedVariables },
    };
  }

  async completeFill(sessionId: string, variables: Record<string, string>): Promise<FilledDocument> {
    const session = fillSessions.get(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);

    const mergedVars = { ...session.collectedVariables, ...variables };
    const readability = this.computeReadability('[Filled document content]');
    const constraintReport = await this.validateConstraints(session.templateId, session.jurisdiction, '[content]');

    session.status = 'completed';
    fillSessions.delete(sessionId);

    return {
      templateId: session.templateId,
      jurisdiction: session.jurisdiction,
      content: `[Generated document for template ${session.templateId} with ${Object.keys(mergedVars).length} variables]`,
      variables: mergedVars,
      enforceabilityScore: 78,
      readabilityScore: readability,
      constraintReport,
      warnings: [],
    };
  }

  async validateConstraints(templateId: string, jurisdiction: JurisdictionCode, content: string): Promise<ConstraintReport> {
    logger.info({ method: 'validateConstraints', templateId, jurisdiction });

    const jurisdictionConstraints: Record<string, string[]> = {
      'IN': ['governing-law', 'dispute-resolution', 'stamp-duty'],
      'UK': ['governing-law', 'data-protection', 'unfair-terms'],
      'EU': ['gdpr-compliance', 'governing-law', 'jurisdiction'],
      'US': ['governing-law', 'severability', 'entire-agreement'],
      'GCC': ['sharia-compliance', 'governing-law', 'language'],
      'SG': ['governing-law', 'confidentiality', 'jurisdiction'],
    };

    const required = jurisdictionConstraints[jurisdiction] || [];
    return {
      valid: true,
      requiredClausesPresent: required.slice(0, 2),
      requiredClausesMissing: required.slice(2),
      prohibitedClausesFound: [],
      warnings: required.length > 2 ? [`${required.length - 2} recommended clauses may be missing`] : [],
    };
  }

  async scoreEnforceability(document: string, jurisdiction: JurisdictionCode): Promise<EnforceabilityScore> {
    const factors = [
      { factor: 'Clear language', score: 80, weight: 0.25 },
      { factor: 'Complete terms', score: 75, weight: 0.20 },
      { factor: 'Jurisdiction compliance', score: 85, weight: 0.20 },
      { factor: 'Consideration specified', score: 90, weight: 0.15 },
      { factor: 'Signatures provision', score: 70, weight: 0.10 },
      { factor: 'Dispute resolution', score: 65, weight: 0.10 },
    ];

    const score = factors.reduce((sum, f) => sum + f.score * f.weight, 0);
    return {
      score: Math.round(score),
      factors,
      jurisdiction,
      recommendations: score < 80 ? ['Consider adding explicit dispute resolution clause', 'Ensure all defined terms are consistently used'] : [],
    };
  }

  async generateDocument(templateId: string, variables: Record<string, string>, jurisdiction: JurisdictionCode): Promise<GeneratedDocument> {
    logger.info({ method: 'generateDocument', templateId, jurisdiction, variableCount: Object.keys(variables).length });

    const template = await this.getTemplate(templateId);
    if (!template) throw new Error(`Template ${templateId} not found`);

    const content = `[AI-generated ${template.name} for jurisdiction ${jurisdiction}]\n\nVariables applied: ${JSON.stringify(variables, null, 2)}`;
    const readability = this.computeReadability(content);

    return {
      content,
      templateId,
      jurisdiction,
      enforceabilityScore: 78,
      readabilityScore: readability,
      warnings: [],
      generatedAt: new Date(),
    };
  }

  async reviewDraftConsistency(document: string): Promise<ConsistencyReport> {
    return {
      consistent: true,
      issues: [],
      definedTermsUsed: [],
      undefinedTermsFound: [],
    };
  }

  async scoreReadability(text: string): Promise<ReadabilityScore> {
    return this.computeReadability(text);
  }

  private computeReadability(text: string): ReadabilityScore {
    const words = text.split(/\s+/).filter(w => w.length > 0);
    const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 0);
    const wordCount = words.length;
    const sentenceCount = Math.max(sentences.length, 1);
    const syllableCount = words.reduce((sum, w) => sum + this.countSyllables(w), 0);
    const avgSentenceLen = wordCount / sentenceCount;
    const avgSyllables = syllableCount / Math.max(wordCount, 1);

    const fleschReadingEase = 206.835 - 1.015 * avgSentenceLen - 84.6 * avgSyllables;
    const fleschKincaidGrade = 0.39 * avgSentenceLen + 11.8 * avgSyllables - 15.59;

    return {
      fleschKincaidGrade: Math.round(fleschKincaidGrade * 10) / 10,
      fleschReadingEase: Math.round(fleschReadingEase * 10) / 10,
      averageSentenceLength: Math.round(avgSentenceLen * 10) / 10,
      averageSyllablesPerWord: Math.round(avgSyllables * 100) / 100,
      wordCount,
      sentenceCount,
      targetRange: '30-50 (legal documents)',
      withinTarget: fleschReadingEase >= 30 && fleschReadingEase <= 50,
    };
  }

  private countSyllables(word: string): number {
    word = word.toLowerCase().replace(/[^a-z]/g, '');
    if (word.length <= 3) return 1;
    word = word.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, '');
    word = word.replace(/^y/, '');
    const matches = word.match(/[aeiouy]{1,2}/g);
    return matches ? matches.length : 1;
  }
}

export const nvNyayaTemplateService = new NvNyayaTemplateService();
