import { createLogger } from '../../utils/logger.js';

const logger = createLogger('./jrx-legal-parser');

export type LegalDocType = 'statute' | 'case' | 'contract' | 'pleading' | 'affidavit' | 'order' | 'gazette' | 'other';

export interface LegalDocumentStructure {
  docType: LegalDocType;
  sections: Array<{ level: 1 | 2 | 3 | 4 | 5; title: string; content: string; sectionRef?: string }>;
  parties: string[];
  dates: Array<{ type: string; date: string; description: string }>;
  courts: string[];
  statutes: string[];
  definitions: Record<string, string>;
}

export interface LegalMetadata {
  docType: LegalDocType;
  title: string;
  parties: string[];
  courts: string[];
  statutes: string[];
  dateCount: number;
  definitionCount: number;
  sectionCount: number;
  wordCount: number;
  language: string;
}

export interface ParsedDocument {
  content: string;
  structure: LegalDocumentStructure;
  metadata: LegalMetadata;
  mimeType: string;
  parseMethod: string;
}

const DOC_TYPE_PATTERNS: Array<{ type: LegalDocType; patterns: RegExp[] }> = [
  { type: 'gazette', patterns: [/G\.S\.R\.|S\.O\.\s+\d+|भारत का राजपत्र|GAZETTE\s+OF\s+INDIA/i] },
  { type: 'order', patterns: [/IN THE.*COURT|HON['']?BLE|JUDGMENT|ORDER DATED|CORAM/i] },
  { type: 'case', patterns: [/VERSUS|vs\.?\s|APPEAL|PETITION|WRIT|SLP|CIVIL\s+APPEAL/i] },
  { type: 'contract', patterns: [/AGREEMENT|WHEREAS|NOW\s+THEREFORE|IN\s+WITNESS\s+WHEREOF|RECITALS/i] },
  { type: 'statute', patterns: [/BE\s+IT\s+ENACTED|An\s+Act\s+to|CHAPTER\s+[IVXLCDM]+|PART\s+[IVXLCDM]+|SECTION\s+\d+/i] },
  { type: 'pleading', patterns: [/PETITION|PLAINT|WRITTEN\s+STATEMENT|REJOINDER|PRAYER/i] },
  { type: 'affidavit', patterns: [/AFFIDAVIT|SOLEMNLY\s+AFFIRM|DEPONENT|SWORN|OATH/i] },
];

const STATUTE_PATTERN = /(?:Section|S\.)\s*(\d+[A-Z]?(?:\(\d+\))*)\s+(?:of\s+)?(?:the\s+)?([A-Z][A-Za-z\s,]+(?:Act|Code|Rules|Regulations|Ordinance|Sanhita)\s*,?\s*\d{4})/gi;
const DATE_PATTERN = /(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{2,4})|(\d{1,2})\s+(?:January|February|March|April|May|June|July|August|September|October|November|December)\s*,?\s*(\d{4})/gi;
const PARTY_PATTERN = /(?:between|by and between|M\/s\.?\s+|Sh\.\s+|Smt\.\s+|Dr\.\s+|Mr\.\s+|Mrs\.\s+|Ms\.\s+)([A-Z][A-Za-z\s&.,]+?)(?:\s+(?:and|vs\.?|versus|hereinafter)\s+)/gi;
const COURT_PATTERN = /(?:SUPREME\s+COURT|HIGH\s+COURT|DISTRICT\s+COURT|SESSIONS\s+COURT|TRIBUNAL|NCLT|NCLAT|NCDRC|RERA|SAT|DRT|DRAT)(?:\s+OF\s+[A-Z][A-Za-z\s]+)?/gi;
const DEFINITION_PATTERN = /"([^"]+)"\s+(?:means|shall mean|includes?|refers? to)\s+([^.;]+)[.;]/gi;

const SECTION_HEADING_PATTERNS = [
  /^(CHAPTER\s+[IVXLCDM\d]+)\s*[.:\-—]\s*(.+)/im,
  /^(PART\s+[IVXLCDM\d]+)\s*[.:\-—]\s*(.+)/im,
  /^(SECTION\s+\d+[A-Z]?)\s*[.:\-—]\s*(.+)/im,
  /^(Article\s+\d+)\s*[.:\-—]\s*(.+)/im,
  /^(\d+\.)\s+(.+)/m,
];

export class NvLegalParserService {
  private static instance: NvLegalParserService;

  private constructor() {}

  static getInstance(): NvLegalParserService {
    if (!NvLegalParserService.instance) {
      NvLegalParserService.instance = new NvLegalParserService();
    }
    return NvLegalParserService.instance;
  }

  async parseDocument(content: string, mimeType: string): Promise<ParsedDocument> {
    const startTime = Date.now();
    try {
      const cleanedContent = this.postProcessLegalContent(content);
      const structure = this.detectDocumentStructure(cleanedContent);
      const metadata = this.extractLegalMetadata(structure, cleanedContent);

      logger.info({
        service: 'NvLegalParserService',
        method: 'parseDocument',
        docType: structure.docType,
        sections: structure.sections.length,
        statutes: structure.statutes.length,
        durationMs: Date.now() - startTime,
      });

      return {
        content: cleanedContent,
        structure,
        metadata,
        mimeType,
        parseMethod: 'text-parser',
      };
    } catch (error: any) {
      logger.error({
        service: 'NvLegalParserService',
        method: 'parseDocument',
        error: error instanceof Error ? error.message : 'Unknown error',
        durationMs: Date.now() - startTime,
      });
      return {
        content,
        structure: { docType: 'other', sections: [{ level: 1, title: 'Document', content }], parties: [], dates: [], courts: [], statutes: [], definitions: {} },
        metadata: { docType: 'other', title: 'Unparsed Document', parties: [], courts: [], statutes: [], dateCount: 0, definitionCount: 0, sectionCount: 1, wordCount: content.split(/\s+/).length, language: 'en' },
        mimeType,
        parseMethod: 'fallback',
      };
    }
  }

  detectDocumentStructure(content: string): LegalDocumentStructure {
    const docType = this.classifyDocumentType(content);
    const sections = this.extractSections(content, docType);
    const parties = this.extractParties(content);
    const dates = this.extractDates(content);
    const courts = this.extractCourts(content);
    const statutes = this.extractStatutes(content);
    const definitions = this.extractDefinitions(content);

    return { docType, sections, parties, dates, courts, statutes, definitions };
  }

  extractLegalMetadata(structure: LegalDocumentStructure, content: string): LegalMetadata {
    const wordCount = content.split(/\s+/).filter(Boolean).length;
    const title = structure.sections[0]?.title || 'Untitled Legal Document';
    const language = /[\u0900-\u097F]/.test(content) ? 'hi' : /[\u0C00-\u0C7F]/.test(content) ? 'te' : /[\u0B80-\u0BFF]/.test(content) ? 'ta' : 'en';

    return {
      docType: structure.docType,
      title,
      parties: structure.parties,
      courts: structure.courts,
      statutes: structure.statutes,
      dateCount: structure.dates.length,
      definitionCount: Object.keys(structure.definitions).length,
      sectionCount: structure.sections.length,
      wordCount,
      language,
    };
  }

  postProcessLegalContent(raw: string): string {
    let cleaned = raw.replace(/\r\n/g, '\n');
    cleaned = cleaned.replace(/\n{3,}/g, '\n\n');
    cleaned = cleaned.replace(/\s{2,}/g, ' ');
    cleaned = cleaned.replace(/^\s+/gm, '');
    return cleaned.trim();
  }

  private classifyDocumentType(content: string): LegalDocType {
    const firstChunk = content.substring(0, 2000);
    for (const { type, patterns } of DOC_TYPE_PATTERNS) {
      for (const pattern of patterns) {
        if (pattern.test(firstChunk)) return type;
      }
    }
    return 'other';
  }

  private extractSections(content: string, docType: LegalDocType): LegalDocumentStructure['sections'] {
    const sections: LegalDocumentStructure['sections'] = [];
    const lines = content.split('\n');
    let currentSection = { level: 1 as 1 | 2 | 3 | 4 | 5, title: '', content: '', sectionRef: '' };
    let buffer = '';

    for (const line of lines) {
      let matched = false;
      for (const pattern of SECTION_HEADING_PATTERNS) {
        const match = line.match(pattern);
        if (match) {
          if (buffer.trim()) {
            currentSection.content = buffer.trim();
            sections.push({ ...currentSection });
          }
          const ref = match[1];
          const title = match[2]?.trim() || ref;
          const level = ref.startsWith('CHAPTER') ? 1 : ref.startsWith('PART') ? 2 : ref.startsWith('SECTION') || ref.startsWith('Article') ? 3 : ref.match(/^\d+\./) ? 4 : 3;
          currentSection = { level: level as 1 | 2 | 3 | 4 | 5, title, content: '', sectionRef: ref };
          buffer = '';
          matched = true;
          break;
        }
      }
      if (!matched) {
        buffer += line + '\n';
      }
    }

    if (buffer.trim()) {
      currentSection.content = buffer.trim();
      sections.push({ ...currentSection });
    }

    if (sections.length === 0) {
      sections.push({ level: 1, title: 'Document', content });
    }

    return sections;
  }

  private extractParties(content: string): string[] {
    const parties: string[] = [];
    let match;
    const pattern = new RegExp(PARTY_PATTERN.source, PARTY_PATTERN.flags);
    while ((match = pattern.exec(content)) !== null) {
      const party = match[1]?.trim();
      if (party && party.length > 2 && party.length < 100 && !parties.includes(party)) {
        parties.push(party);
      }
    }
    return parties.slice(0, 20);
  }

  private extractDates(content: string): LegalDocumentStructure['dates'] {
    const dates: LegalDocumentStructure['dates'] = [];
    let match;
    const pattern = new RegExp(DATE_PATTERN.source, DATE_PATTERN.flags);
    while ((match = pattern.exec(content)) !== null) {
      dates.push({ type: 'reference', date: match[0], description: content.substring(Math.max(0, match.index - 30), match.index + match[0].length + 30).trim() });
      if (dates.length >= 20) break;
    }
    return dates;
  }

  private extractCourts(content: string): string[] {
    const courts: string[] = [];
    let match;
    const pattern = new RegExp(COURT_PATTERN.source, COURT_PATTERN.flags);
    while ((match = pattern.exec(content)) !== null) {
      const court = match[0].trim();
      if (!courts.includes(court)) courts.push(court);
    }
    return courts.slice(0, 10);
  }

  private extractStatutes(content: string): string[] {
    const statutes: string[] = [];
    let match;
    const pattern = new RegExp(STATUTE_PATTERN.source, STATUTE_PATTERN.flags);
    while ((match = pattern.exec(content)) !== null) {
      const statute = `${match[2]?.trim()} S.${match[1]}`;
      if (!statutes.includes(statute)) statutes.push(statute);
    }
    return statutes.slice(0, 50);
  }

  private extractDefinitions(content: string): Record<string, string> {
    const definitions: Record<string, string> = {};
    let match;
    const pattern = new RegExp(DEFINITION_PATTERN.source, DEFINITION_PATTERN.flags);
    while ((match = pattern.exec(content)) !== null) {
      const term = match[1]?.trim();
      const def = match[2]?.trim();
      if (term && def) definitions[term] = def;
    }
    return definitions;
  }
}

export const nvLegalParserService = NvLegalParserService.getInstance();
