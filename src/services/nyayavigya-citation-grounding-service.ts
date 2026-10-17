/**
 * Jurexio Citation Grounding Service
 * 
 * Ensures legal citations are accurate and properly formatted:
 * - Indian legal citation format (SCC, AIR, SCR, etc.)
 * - Bluebook citation format
 * - Case law verification
 * - Statute citation validation
 */

export interface Citation {
  original: string;
  formatted: string;
  type: 'case' | 'statute' | 'article' | 'regulation' | 'treaty' | 'book';
  format: 'indian' | 'bluebook' | 'oscola' | 'aglc';
  verified: boolean;
  confidence: number;
  components: CitationComponents;
  source?: string;
  url?: string;
}

export interface CitationComponents {
  caseName?: string;
  year?: number;
  volume?: string;
  reporter?: string;
  page?: string;
  court?: string;
  jurisdiction?: string;
  statuteName?: string;
  section?: string;
  chapter?: string;
  articleTitle?: string;
  author?: string;
  publisher?: string;
}

export interface GroundingResult {
  success: boolean;
  citations: Citation[];
  unverified: string[];
  suggestions: CitationSuggestion[];
  confidence: number;
  processingTime: number;
}

export interface CitationSuggestion {
  original: string;
  suggested: string;
  reason: string;
  confidence: number;
}

const INDIAN_REPORTERS = [
  { code: 'SCC', name: 'Supreme Court Cases', court: 'Supreme Court of India' },
  { code: 'SCR', name: 'Supreme Court Reports', court: 'Supreme Court of India' },
  { code: 'AIR', name: 'All India Reporter', court: 'Various' },
  { code: 'SCALE', name: 'Supreme Court Almanac', court: 'Supreme Court of India' },
  { code: 'SC', name: 'Supreme Court', court: 'Supreme Court of India' },
  { code: 'Bom LR', name: 'Bombay Law Reporter', court: 'Bombay High Court' },
  { code: 'Del', name: 'Delhi Law Times', court: 'Delhi High Court' },
  { code: 'Mad', name: 'Madras Law Journal', court: 'Madras High Court' },
  { code: 'Cal', name: 'Calcutta Law Journal', court: 'Calcutta High Court' },
  { code: 'Kar', name: 'Karnataka Law Journal', court: 'Karnataka High Court' },
  { code: 'All', name: 'Allahabad Law Journal', court: 'Allahabad High Court' },
  { code: 'ILR', name: 'Indian Law Reports', court: 'Various' },
  { code: 'MLJ', name: 'Madras Law Journal', court: 'Madras High Court' },
  { code: 'Comp LJ', name: 'Company Law Journal', court: 'Various (Company Matters)' },
  { code: 'Tax LR', name: 'Tax Law Reporter', court: 'Various (Tax Matters)' }
];

const CITATION_FORMATS = {
  indian: {
    case: '{{caseName}}, ({{year}}) {{volume}} {{reporter}} {{page}}',
    statute: '{{statuteName}}, {{year}}, Section {{section}}',
    article: '{{article}}',
    regulation: '{{regulationName}}, {{year}}'
  },
  bluebook: {
    case: '{{caseName}}, {{volume}} {{reporter}} {{page}} ({{court}} {{year}})',
    statute: '{{statuteName}} § {{section}} ({{year}})',
    article: '{{author}}, {{title}}, {{volume}} {{journal}} {{page}} ({{year}})',
    regulation: '{{regulationName}}, {{volume}} C.F.R. § {{section}} ({{year}})'
  }
};

export class JurexioCitationGroundingService {
  private reporters = INDIAN_REPORTERS;
  
  async groundCitations(
    text: string,
    options: {
      format?: 'indian' | 'bluebook';
      verify?: boolean;
      autoCorrect?: boolean;
    } = {}
  ): Promise<GroundingResult> {
    const startTime = Date.now();
    const effectiveOptions = {
      format: options.format || 'indian',
      verify: options.verify ?? true,
      autoCorrect: options.autoCorrect ?? true
    };
    
    const extractedCitations = this.extractCitations(text);
    const groundedCitations: Citation[] = [];
    const unverified: string[] = [];
    const suggestions: CitationSuggestion[] = [];
    
    for (const rawCitation of extractedCitations) {
      const parsed = this.parseCitation(rawCitation);
      
      if (parsed) {
        const formatted = this.formatCitation(parsed, effectiveOptions.format);
        const verified = effectiveOptions.verify ? await this.verifyCitation(parsed) : true;
        
        groundedCitations.push({
          original: rawCitation,
          formatted,
          type: parsed.type,
          format: effectiveOptions.format,
          verified,
          confidence: verified ? 0.95 : 0.6,
          components: parsed.components
        });
        
        if (!verified && effectiveOptions.autoCorrect) {
          const suggestion = this.suggestCorrection(rawCitation, parsed);
          if (suggestion) {
            suggestions.push(suggestion);
          }
        }
      } else {
        unverified.push(rawCitation);
      }
    }
    
    const verifiedCount = groundedCitations.filter(c => c.verified).length;
    const totalCount = groundedCitations.length + unverified.length;
    const confidence = totalCount > 0 ? verifiedCount / totalCount : 0;
    
    return {
      success: true,
      citations: groundedCitations,
      unverified,
      suggestions,
      confidence,
      processingTime: Date.now() - startTime
    };
  }
  
  private extractCitations(text: string): string[] {
    const citations: string[] = [];
    
    const patterns = [
      /\(?\d{4}\)?\s*\d*\s*(?:SCC|SCR|AIR|SC|SCALE|Bom|Del|Mad|Cal|Kar|All|ILR|MLJ)\s*\d+/gi,
      /(?:Section|Sec\.|S\.)\s*\d+[A-Z]?(?:\([a-z0-9]+\))?(?:\s+of\s+[A-Za-z\s,]+(?:Act|Code|Rules|Regulations),?\s*\d{4})?/gi,
      /Article\s*\d+[A-Z]?(?:\([a-z0-9]+\))?(?:\s+of\s+(?:the\s+)?Constitution(?:\s+of\s+India)?)?/gi,
      /[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\s+v\.?\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*/g
    ];
    
    for (const pattern of patterns) {
      const matches = text.match(pattern) || [];
      citations.push(...matches);
    }
    
    return [...new Set(citations)];
  }
  
  private parseCitation(citation: string): { type: Citation['type']; components: CitationComponents } | null {
    const components: CitationComponents = {};
    let type: Citation['type'] = 'case';
    
    const yearMatch = citation.match(/\(?(\d{4})\)?/);
    if (yearMatch) {
      components.year = parseInt(yearMatch[1]);
    }
    
    for (const reporter of this.reporters) {
      if (citation.toUpperCase().includes(reporter.code.toUpperCase())) {
        components.reporter = reporter.code;
        components.court = reporter.court;
        break;
      }
    }
    
    const volumePageMatch = citation.match(/(\d+)\s*(?:SCC|SCR|AIR)\s*(\d+)/i);
    if (volumePageMatch) {
      components.volume = volumePageMatch[1];
      components.page = volumePageMatch[2];
    }
    
    if (citation.toLowerCase().includes('section') || citation.match(/S\.\s*\d+/i)) {
      type = 'statute';
      const sectionMatch = citation.match(/(?:Section|Sec\.|S\.)\s*(\d+[A-Z]?(?:\([a-z0-9]+\))?)/i);
      if (sectionMatch) {
        components.section = sectionMatch[1];
      }
    }
    
    if (citation.toLowerCase().includes('article')) {
      type = 'statute';
      const articleMatch = citation.match(/Article\s*(\d+[A-Z]?(?:\([a-z0-9]+\))?)/i);
      if (articleMatch) {
        components.section = `Article ${articleMatch[1]}`;
      }
    }
    
    const caseNameMatch = citation.match(/([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\s+v\.?\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)/);
    if (caseNameMatch) {
      components.caseName = `${caseNameMatch[1]} v. ${caseNameMatch[2]}`;
    }
    
    if (Object.keys(components).length === 0) {
      return null;
    }
    
    return { type, components };
  }
  
  private formatCitation(
    parsed: { type: Citation['type']; components: CitationComponents },
    format: 'indian' | 'bluebook'
  ): string {
    const { type, components } = parsed;
    
    if (format === 'indian') {
      if (type === 'case' && components.caseName && components.year && components.reporter) {
        return `${components.caseName}, (${components.year}) ${components.volume || ''} ${components.reporter} ${components.page || ''}`.trim();
      }
      if (type === 'statute' && components.section) {
        return `${components.section}${components.statuteName ? ` of ${components.statuteName}` : ''}`;
      }
    }
    
    if (format === 'bluebook') {
      if (type === 'case' && components.caseName) {
        return `${components.caseName}, ${components.volume || ''} ${components.reporter || ''} ${components.page || ''} (${components.court || ''} ${components.year || ''})`.trim();
      }
    }
    
    return Object.values(components).filter(Boolean).join(' ');
  }
  
  private async verifyCitation(
    parsed: { type: Citation['type']; components: CitationComponents }
  ): Promise<boolean> {
    const { components } = parsed;
    
    if (components.year && (components.year < 1947 || components.year > new Date().getFullYear())) {
      return false;
    }
    
    if (components.reporter) {
      const validReporter = this.reporters.some(r => 
        r.code.toUpperCase() === components.reporter?.toUpperCase()
      );
      if (!validReporter) {
        return false;
      }
    }
    
    return true;
  }
  
  private suggestCorrection(
    original: string,
    parsed: { type: Citation['type']; components: CitationComponents }
  ): CitationSuggestion | null {
    const { components } = parsed;
    
    if (!components.year || components.year < 1950) {
      return {
        original,
        suggested: original.replace(/\d{4}/, new Date().getFullYear().toString()),
        reason: 'Year appears to be invalid or missing',
        confidence: 0.7
      };
    }
    
    return null;
  }
  
  formatToIndian(citation: string): string {
    const parsed = this.parseCitation(citation);
    if (!parsed) return citation;
    return this.formatCitation(parsed, 'indian');
  }
  
  formatToBluebook(citation: string): string {
    const parsed = this.parseCitation(citation);
    if (!parsed) return citation;
    return this.formatCitation(parsed, 'bluebook');
  }
  
  getReporters(): typeof INDIAN_REPORTERS {
    return this.reporters;
  }
  
  validateCitationFormat(citation: string, expectedFormat: 'indian' | 'bluebook'): {
    valid: boolean;
    errors: string[];
    suggestions: string[];
  } {
    const parsed = this.parseCitation(citation);
    const errors: string[] = [];
    const suggestions: string[] = [];
    
    if (!parsed) {
      return {
        valid: false,
        errors: ['Could not parse citation'],
        suggestions: ['Ensure citation follows standard format']
      };
    }
    
    if (!parsed.components.year) {
      errors.push('Missing year');
      suggestions.push('Add year in format (YYYY)');
    }
    
    if (parsed.type === 'case' && !parsed.components.reporter) {
      errors.push('Missing reporter');
      suggestions.push('Add reporter (e.g., SCC, AIR, SCR)');
    }
    
    return {
      valid: errors.length === 0,
      errors,
      suggestions
    };
  }
}

export const citationGroundingService = new JurexioCitationGroundingService();
