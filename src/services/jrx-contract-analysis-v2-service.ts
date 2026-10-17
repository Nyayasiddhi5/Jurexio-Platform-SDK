import { createLogger } from '../utils/logger.js';

const logger = createLogger('./jrx-contract-analysis-v2-service');

type JurisdictionCode = 'IN' | 'UK' | 'EU' | 'US' | 'GCC' | 'SG';

interface AnalyzedClause {
  clauseNumber: string;
  title: string;
  text: string;
  category: string;
  riskScore: number;
  riskReason: string;
}

interface RequiredClause {
  name: string;
  category: string;
  jurisdiction: JurisdictionCode;
  reason: string;
}

interface ClauseConflict {
  clauseA: string;
  clauseB: string;
  nature: string;
  severity: 'low' | 'medium' | 'high';
}

interface TermDefinition {
  term: string;
  definition: string;
  firstUsed: string;
  usageCount: number;
  isCircular: boolean;
}

interface ContractAnalysis {
  clauses: AnalyzedClause[];
  missingClauses: RequiredClause[];
  conflicts: ClauseConflict[];
  definedTerms: TermDefinition[];
  riskSummary: { critical: number; high: number; medium: number; low: number };
  overallRiskScore: number;
  recommendations: string[];
}

const REQUIRED_CLAUSES: Record<JurisdictionCode, RequiredClause[]> = {
  'IN': [
    { name: 'Governing Law', category: 'general', jurisdiction: 'IN', reason: 'Required to determine applicable law and jurisdiction' },
    { name: 'Dispute Resolution', category: 'dispute', jurisdiction: 'IN', reason: 'Arbitration & Conciliation Act 1996 — recommended' },
    { name: 'Stamp Duty', category: 'compliance', jurisdiction: 'IN', reason: 'Indian Stamp Act 1899 compliance' },
    { name: 'Force Majeure', category: 'risk', jurisdiction: 'IN', reason: 'Section 56 Indian Contract Act 1872' },
    { name: 'Confidentiality', category: 'protection', jurisdiction: 'IN', reason: 'Trade secret and DPDPA 2023 protection' },
    { name: 'Indemnification', category: 'risk', jurisdiction: 'IN', reason: 'Liability allocation' },
    { name: 'Termination', category: 'general', jurisdiction: 'IN', reason: 'Exit mechanism' },
  ],
  'UK': [
    { name: 'Governing Law', category: 'general', jurisdiction: 'UK', reason: 'English law specification' },
    { name: 'Data Protection', category: 'compliance', jurisdiction: 'UK', reason: 'UK GDPR / DPA 2018 compliance' },
    { name: 'Unfair Terms', category: 'compliance', jurisdiction: 'UK', reason: 'CRA 2015 / UCTA 1977' },
  ],
  'EU': [
    { name: 'GDPR Compliance', category: 'compliance', jurisdiction: 'EU', reason: 'GDPR data processing terms' },
    { name: 'Governing Law', category: 'general', jurisdiction: 'EU', reason: 'Applicable member state law' },
  ],
  'US': [
    { name: 'Governing Law', category: 'general', jurisdiction: 'US', reason: 'State law specification' },
    { name: 'Severability', category: 'general', jurisdiction: 'US', reason: 'Standard US contract clause' },
    { name: 'Entire Agreement', category: 'general', jurisdiction: 'US', reason: 'Parol evidence rule support' },
  ],
  'GCC': [
    { name: 'Sharia Compliance', category: 'compliance', jurisdiction: 'GCC', reason: 'Islamic law compliance' },
    { name: 'Governing Law', category: 'general', jurisdiction: 'GCC', reason: 'Applicable emirate/country law' },
    { name: 'Language', category: 'general', jurisdiction: 'GCC', reason: 'Arabic language requirements' },
  ],
  'SG': [
    { name: 'Governing Law', category: 'general', jurisdiction: 'SG', reason: 'Singapore law specification' },
    { name: 'Dispute Resolution', category: 'dispute', jurisdiction: 'SG', reason: 'SIAC or Singapore courts' },
  ],
};

class NvContractAnalysisV2Service {
  async analyzeContract(text: string, jurisdiction: JurisdictionCode): Promise<ContractAnalysis> {
    logger.info({ method: 'analyzeContract', jurisdiction, textLength: text.length });

    const clauses = this.extractClauses(text);
    const analyzedClauses = clauses.map(c => this.analyzeClause(c, jurisdiction));
    const missingClauses = this.detectMissingClauses(analyzedClauses, jurisdiction);
    const conflicts = this.detectConflicts(analyzedClauses);
    const definedTerms = this.extractDefinedTerms(text);

    const riskSummary = {
      critical: analyzedClauses.filter(c => c.riskScore >= 5).length,
      high: analyzedClauses.filter(c => c.riskScore === 4).length,
      medium: analyzedClauses.filter(c => c.riskScore === 3).length,
      low: analyzedClauses.filter(c => c.riskScore <= 2).length,
    };

    const overallRiskScore = analyzedClauses.length > 0
      ? Math.round(analyzedClauses.reduce((sum, c) => sum + c.riskScore, 0) / analyzedClauses.length * 10) / 10
      : 1;

    const recommendations = this.generateRecommendations(missingClauses, conflicts, riskSummary, jurisdiction);

    return {
      clauses: analyzedClauses,
      missingClauses,
      conflicts,
      definedTerms,
      riskSummary,
      overallRiskScore: Math.min(5, Math.max(1, overallRiskScore)),
      recommendations,
    };
  }

  private extractClauses(text: string): { number: string; title: string; text: string }[] {
    const clausePattern = /(?:^|\n)\s*(\d+(?:\.\d+)?)\s*[.\-)]\s*([A-Z][^\n]*)/g;
    const matches: { number: string; title: string; text: string }[] = [];
    let match;

    while ((match = clausePattern.exec(text)) !== null) {
      matches.push({
        number: match[1],
        title: match[2].trim(),
        text: text.slice(match.index, match.index + 500),
      });
    }

    if (matches.length === 0) {
      const paragraphs = text.split(/\n\n+/).filter(p => p.trim().length > 20);
      return paragraphs.slice(0, 20).map((p, i) => ({
        number: `${i + 1}`,
        title: p.trim().split(/[.\n]/)[0].slice(0, 50),
        text: p.trim(),
      }));
    }

    return matches;
  }

  private analyzeClause(clause: { number: string; title: string; text: string }, jurisdiction: JurisdictionCode): AnalyzedClause {
    const textLower = clause.text.toLowerCase();
    let riskScore = 2;
    let riskReason = 'Standard clause — low risk';
    let category = 'general';

    const riskIndicators = [
      { pattern: /unlimited liability|no liability cap/i, risk: 5, reason: 'Unlimited liability exposure', cat: 'risk' },
      { pattern: /waive|waiver of rights/i, risk: 4, reason: 'Rights waiver clause', cat: 'risk' },
      { pattern: /indemnif/i, risk: 3, reason: 'Indemnification obligations', cat: 'risk' },
      { pattern: /terminat/i, risk: 2, reason: 'Termination provisions', cat: 'termination' },
      { pattern: /confidential/i, risk: 2, reason: 'Confidentiality obligations', cat: 'protection' },
      { pattern: /force majeure/i, risk: 2, reason: 'Force majeure provision', cat: 'risk' },
      { pattern: /governing law|jurisdiction/i, risk: 1, reason: 'Governing law specification', cat: 'general' },
      { pattern: /arbitrat/i, risk: 2, reason: 'Arbitration clause', cat: 'dispute' },
      { pattern: /non-compete|restraint of trade/i, risk: 4, reason: 'Restrictive covenant', cat: 'restriction' },
      { pattern: /intellectual property|ip rights/i, risk: 3, reason: 'IP rights allocation', cat: 'ip' },
    ];

    for (const indicator of riskIndicators) {
      if (indicator.pattern.test(clause.text)) {
        if (indicator.risk > riskScore) {
          riskScore = indicator.risk;
          riskReason = indicator.reason;
          category = indicator.cat;
        }
      }
    }

    return {
      clauseNumber: clause.number,
      title: clause.title,
      text: clause.text.slice(0, 300),
      category,
      riskScore,
      riskReason,
    };
  }

  private detectMissingClauses(analyzed: AnalyzedClause[], jurisdiction: JurisdictionCode): RequiredClause[] {
    const required = REQUIRED_CLAUSES[jurisdiction] || [];
    const existingCategories = new Set(analyzed.map(c => c.category));
    const existingTitles = analyzed.map(c => c.title.toLowerCase());

    return required.filter(req => {
      const nameWords = req.name.toLowerCase().split(/\s+/);
      return !existingTitles.some(t => nameWords.some(w => t.includes(w)));
    });
  }

  private detectConflicts(clauses: AnalyzedClause[]): ClauseConflict[] {
    const conflicts: ClauseConflict[] = [];

    for (let i = 0; i < clauses.length; i++) {
      for (let j = i + 1; j < clauses.length; j++) {
        if (clauses[i].category === clauses[j].category && clauses[i].category !== 'general') {
          const textI = clauses[i].text.toLowerCase();
          const textJ = clauses[j].text.toLowerCase();

          if ((textI.includes('shall') && textJ.includes('shall not')) ||
              (textI.includes('exclusive') && textJ.includes('non-exclusive'))) {
            conflicts.push({
              clauseA: clauses[i].clauseNumber,
              clauseB: clauses[j].clauseNumber,
              nature: `Potential contradiction in ${clauses[i].category} clauses`,
              severity: 'medium',
            });
          }
        }
      }
    }

    return conflicts;
  }

  private extractDefinedTerms(text: string): TermDefinition[] {
    const definedTermPattern = /"([A-Z][a-zA-Z\s]+)"\s*(?:means|shall mean|refers to|is defined as)/g;
    const terms: TermDefinition[] = [];
    let match;

    while ((match = definedTermPattern.exec(text)) !== null) {
      const term = match[1].trim();
      const defStart = match.index + match[0].length;
      const defEnd = text.indexOf('.', defStart);
      const definition = text.slice(defStart, defEnd > 0 ? defEnd : defStart + 200).trim();

      const usageCount = (text.match(new RegExp(term, 'g')) || []).length;
      const isCircular = definition.toLowerCase().includes(term.toLowerCase());

      terms.push({
        term,
        definition: definition.slice(0, 200),
        firstUsed: `Position ${match.index}`,
        usageCount,
        isCircular,
      });
    }

    return terms;
  }

  private generateRecommendations(
    missing: RequiredClause[],
    conflicts: ClauseConflict[],
    riskSummary: { critical: number; high: number; medium: number; low: number },
    jurisdiction: JurisdictionCode
  ): string[] {
    const recs: string[] = [];

    if (missing.length > 0) {
      recs.push(`Add ${missing.length} missing required clause(s): ${missing.map(m => m.name).join(', ')}`);
    }
    if (conflicts.length > 0) {
      recs.push(`Resolve ${conflicts.length} internal conflict(s) between clauses`);
    }
    if (riskSummary.critical > 0) {
      recs.push(`Review ${riskSummary.critical} critical-risk clause(s) immediately`);
    }
    if (riskSummary.high > 0) {
      recs.push(`Negotiate ${riskSummary.high} high-risk clause(s) before signing`);
    }

    return recs;
  }
}

export const nvContractAnalysisV2Service = new NvContractAnalysisV2Service();
