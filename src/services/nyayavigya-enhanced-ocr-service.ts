import { createLogger } from '../utils/logger.js';
import { nvOcrAdapterService, type OcrOptions, type OcrResult as AdapterOcrResult } from './document-pipeline/jrx-got-ocr-adapter-service.js';

const logger = createLogger('nyayavigya-enhanced-ocr-service');

/**
 * Jurexio Enhanced OCR Pipeline Service
 *
 * Thin, legal-aware wrapper over the single real OCR engine
 * (nv-got-ocr-adapter-service). This service owns the Indian legal document
 * taxonomy, the supported-language table, the OCR prompt, and the structured
 * post-processing (tables / form fields / signatures / stamps). All actual text
 * extraction is delegated to the adapter — there is no separate OCR implementation
 * here.
 *
 * Features:
 * - Real provider precedence (self-hosted GOT/Mistral OCR → Mistral OCR API →
 *   Gemini vision → OpenAI vision → local Tesseract)
 * - Indian legal document type detection
 * - Multi-language support
 * - Legal form field extraction, table / signature / stamp detection
 */

export interface OCRConfig {
  engine: 'gpt4v' | 'tesseract' | 'azure' | 'auto';
  language: string;
  documentType?: string;
  extractTables?: boolean;
  extractHandwriting?: boolean;
  enhanceQuality?: boolean;
}

export interface OCRResult {
  success: boolean;
  text: string;
  confidence: number;
  documentType: string;
  language: string;
  tables?: ExtractedTable[];
  formFields?: FormField[];
  signatures?: SignatureInfo[];
  stamps?: StampInfo[];
  metadata: OCRMetadata;
  processingTime: number;
  engine: string;
}

export interface ExtractedTable {
  id: string;
  rows: string[][];
  headers?: string[];
  confidence: number;
}

export interface FormField {
  label: string;
  value: string;
  fieldType: 'text' | 'date' | 'number' | 'checkbox' | 'signature';
  confidence: number;
  boundingBox?: { x: number; y: number; width: number; height: number };
}

export interface SignatureInfo {
  present: boolean;
  location?: string;
  verified: boolean;
}

export interface StampInfo {
  type: 'court' | 'notary' | 'revenue' | 'official';
  text?: string;
  date?: string;
}

export interface OCRMetadata {
  pageCount: number;
  orientation: 'portrait' | 'landscape';
  quality: 'high' | 'medium' | 'low';
  hasHandwriting: boolean;
  hasTables: boolean;
  hasStamps: boolean;
  hasSignatures: boolean;
}

const INDIAN_LEGAL_DOCUMENT_TYPES = [
  { id: 'fir', name: 'First Information Report (FIR)', patterns: ['FIR No', 'Police Station', 'Section', 'IPC', 'BNS'] },
  { id: 'court_order', name: 'Court Order', patterns: ['ORDER', 'Hon\'ble', 'Court', 'Petitioner', 'Respondent'] },
  { id: 'affidavit', name: 'Affidavit', patterns: ['AFFIDAVIT', 'solemnly affirm', 'deponent', 'sworn'] },
  { id: 'vakalatnama', name: 'Vakalatnama', patterns: ['VAKALATNAMA', 'Power of Attorney', 'advocate', 'Bar Council'] },
  { id: 'plaint', name: 'Plaint/Petition', patterns: ['PLAINT', 'PETITION', 'plaintiff', 'prayer', 'relief'] },
  { id: 'written_statement', name: 'Written Statement', patterns: ['Written Statement', 'defendant', 'denied', 'admitted'] },
  { id: 'chargesheet', name: 'Chargesheet', patterns: ['CHARGESHEET', 'accused', 'investigation', 'Section'] },
  { id: 'bail_application', name: 'Bail Application', patterns: ['BAIL', 'custody', 'surety', 'undertaking'] },
  { id: 'sale_deed', name: 'Sale Deed', patterns: ['SALE DEED', 'vendor', 'vendee', 'consideration', 'property'] },
  { id: 'lease_agreement', name: 'Lease Agreement', patterns: ['LEASE', 'lessor', 'lessee', 'rent', 'premises'] },
  { id: 'power_of_attorney', name: 'Power of Attorney', patterns: ['POWER OF ATTORNEY', 'principal', 'attorney', 'authorize'] },
  { id: 'will', name: 'Will/Testament', patterns: ['WILL', 'testament', 'executor', 'bequest', 'legatee'] },
  { id: 'contract', name: 'Contract/Agreement', patterns: ['AGREEMENT', 'CONTRACT', 'parties', 'consideration', 'terms'] },
  { id: 'notice', name: 'Legal Notice', patterns: ['LEGAL NOTICE', 'advocate', 'behalf', 'demand', 'reply'] },
  { id: 'summons', name: 'Summons', patterns: ['SUMMONS', 'appear', 'court', 'date', 'time'] }
];

const SUPPORTED_LANGUAGES = [
  { code: 'en', name: 'English', tesseractCode: 'eng' },
  { code: 'hi', name: 'Hindi', tesseractCode: 'hin' },
  { code: 'bn', name: 'Bengali', tesseractCode: 'ben' },
  { code: 'te', name: 'Telugu', tesseractCode: 'tel' },
  { code: 'mr', name: 'Marathi', tesseractCode: 'mar' },
  { code: 'ta', name: 'Tamil', tesseractCode: 'tam' },
  { code: 'gu', name: 'Gujarati', tesseractCode: 'guj' },
  { code: 'kn', name: 'Kannada', tesseractCode: 'kan' },
  { code: 'ml', name: 'Malayalam', tesseractCode: 'mal' },
  { code: 'pa', name: 'Punjabi', tesseractCode: 'pan' },
  { code: 'or', name: 'Odia', tesseractCode: 'ori' },
  { code: 'as', name: 'Assamese', tesseractCode: 'asm' },
  { code: 'ur', name: 'Urdu', tesseractCode: 'urd' },
  { code: 'ar', name: 'Arabic', tesseractCode: 'ara' }
];

export class JurexioEnhancedOCRService {
  async processDocument(
    imageData: Buffer | string,
    config: Partial<OCRConfig> = {}
  ): Promise<OCRResult> {
    const startTime = Date.now();
    const effectiveConfig: OCRConfig = {
      engine: config.engine || 'auto',
      language: config.language || 'en',
      extractTables: config.extractTables ?? true,
      extractHandwriting: config.extractHandwriting ?? true,
      enhanceQuality: config.enhanceQuality ?? true,
      documentType: config.documentType
    };

    const { buffer, mimeType } = this.toBuffer(imageData);

    const ocrOptions: OcrOptions = {
      language: effectiveConfig.language,
      documentType: effectiveConfig.extractHandwriting ? 'handwritten' : 'printed',
      quality: 'auto',
      // 'tesseract' engine maps to the adapter's key-free local path.
      forceLocal: effectiveConfig.engine === 'tesseract',
      prompt: this.buildOCRPrompt(effectiveConfig),
    };

    const adapterResult: AdapterOcrResult =
      mimeType === 'application/pdf'
        ? await nvOcrAdapterService.ocrDocument(buffer, mimeType, ocrOptions)
        : await nvOcrAdapterService.ocrImage(buffer, mimeType, ocrOptions);

    const text = adapterResult.text;
    const tables = effectiveConfig.extractTables ? this.detectTables(text) : [];
    const formFields = this.detectFormFields(text);
    const signatures = this.detectSignatures(text);
    const stamps = this.detectStamps(text);

    return {
      success: true,
      text,
      confidence: adapterResult.confidence,
      documentType: this.detectDocumentType(text),
      language: adapterResult.language || effectiveConfig.language,
      tables: effectiveConfig.extractTables ? tables : undefined,
      formFields,
      signatures,
      stamps,
      metadata: {
        pageCount: adapterResult.pages.length || 1,
        orientation: 'portrait',
        quality: adapterResult.confidence >= 0.85 ? 'high' : adapterResult.confidence >= 0.6 ? 'medium' : 'low',
        hasHandwriting: effectiveConfig.extractHandwriting === true && adapterResult.extractionMethod !== 'digital-text',
        hasTables: tables.length > 0,
        hasStamps: stamps.length > 0,
        hasSignatures: signatures.some(s => s.present),
      },
      processingTime: Date.now() - startTime,
      // Honest engine label = the provider that actually produced the text.
      engine: adapterResult.provider,
    };
  }

  /** Normalise Buffer | base64 | data-URL input into a Buffer + MIME type. */
  private toBuffer(imageData: Buffer | string): { buffer: Buffer; mimeType: string } {
    if (Buffer.isBuffer(imageData)) {
      return { buffer: imageData, mimeType: this.sniffMime(imageData) };
    }
    const dataUrlMatch = /^data:([^;]+);base64,(.*)$/s.exec(imageData);
    if (dataUrlMatch) {
      return { buffer: Buffer.from(dataUrlMatch[2], 'base64'), mimeType: dataUrlMatch[1] };
    }
    const buffer = Buffer.from(imageData, 'base64');
    return { buffer, mimeType: this.sniffMime(buffer) };
  }

  /** Detect the container type from magic bytes; defaults to PNG for unknown image payloads. */
  private sniffMime(buffer: Buffer): string {
    if (buffer.length >= 5 && buffer.toString('latin1', 0, 5) === '%PDF-') return 'application/pdf';
    if (buffer.length >= 8 && buffer[0] === 0x89 && buffer[1] === 0x50) return 'image/png';
    if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
    if (buffer.length >= 12 && buffer.toString('latin1', 0, 4) === 'RIFF' && buffer.toString('latin1', 8, 12) === 'WEBP') return 'image/webp';
    if (buffer.length >= 3 && (buffer.toString('latin1', 0, 2) === 'II' || buffer.toString('latin1', 0, 2) === 'MM')) return 'image/tiff';
    return 'image/png';
  }

  private detectTables(text: string): ExtractedTable[] {
    const tables: ExtractedTable[] = [];
    const tablePattern = /\|.+\|(?:\n\|.+\|)+/g;
    let match: RegExpExecArray | null;
    let idx = 0;
    while ((match = tablePattern.exec(text)) !== null) {
      const rows = match[0].split('\n').filter(r => r.trim());
      if (rows.length < 2) continue;
      const parseRow = (row: string): string[] => row.split('|').map(c => c.trim()).filter(Boolean);
      const headers = parseRow(rows[0]);
      const dataRows = rows.slice(1).filter(r => !/^[\|\s\-:]+$/.test(r)).map(parseRow);
      tables.push({ id: `table-${idx++}`, headers, rows: dataRows, confidence: 0.8 });
    }
    return tables;
  }

  private detectFormFields(text: string): FormField[] {
    const fields: FormField[] = [];
    const fieldPattern = /^([A-Za-z][A-Za-z .\/]{2,40}?)\s*:\s*(.+?)\s*$/gm;
    let match: RegExpExecArray | null;
    let idx = 0;
    while ((match = fieldPattern.exec(text)) !== null && idx < 200) {
      const label = match[1].trim();
      const value = match[2].trim();
      if (!value) continue;
      let fieldType: FormField['fieldType'] = 'text';
      if (/^\d+$/.test(value)) fieldType = 'number';
      if (/\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}/.test(value)) fieldType = 'date';
      if (/^(?:yes|no|true|false|x|✓|☑)$/i.test(value)) fieldType = 'checkbox';
      fields.push({ label, value, fieldType, confidence: 0.75 });
      idx++;
    }
    return fields;
  }

  private detectSignatures(text: string): SignatureInfo[] {
    const present = /\b(signature|signed|sd\/-|\/s\/|signatory|witnesseth|in witness whereof)\b/i.test(text);
    return present ? [{ present: true, verified: false }] : [];
  }

  private detectStamps(text: string): StampInfo[] {
    const stamps: StampInfo[] = [];
    if (/\bnotary|notarial\b/i.test(text)) stamps.push({ type: 'notary' });
    if (/\bcourt seal|seal of the court|registrar\b/i.test(text)) stamps.push({ type: 'court' });
    if (/\brevenue stamp|stamp duty|e-stamp\b/i.test(text)) stamps.push({ type: 'revenue' });
    if (stamps.length === 0 && /\b(seal|stamp)\b/i.test(text)) stamps.push({ type: 'official' });
    return stamps;
  }

  
  private detectDocumentType(text: string): string {
    const upperText = text.toUpperCase();
    
    for (const docType of INDIAN_LEGAL_DOCUMENT_TYPES) {
      const matchCount = docType.patterns.filter(pattern => 
        upperText.includes(pattern.toUpperCase())
      ).length;
      
      if (matchCount >= 2) {
        return docType.id;
      }
    }
    
    return 'unknown';
  }
  
  private buildOCRPrompt(config: OCRConfig): string {
    return `Extract all text from this legal document image.
Language: ${config.language}
Document Type: ${config.documentType || 'Auto-detect'}

Instructions:
1. Extract all visible text maintaining structure
2. Identify form fields and their values
3. Detect any tables and preserve their structure
4. Note any signatures, stamps, or seals
5. Flag handwritten portions separately
6. Identify the document type (FIR, Court Order, Affidavit, etc.)

Output structured JSON with:
- extractedText: Full text content
- formFields: Array of {label, value} pairs
- tables: Array of table data
- documentType: Detected document type
- confidence: Confidence score (0-1)`;
  }
  
  getDocumentTypes(): typeof INDIAN_LEGAL_DOCUMENT_TYPES {
    return INDIAN_LEGAL_DOCUMENT_TYPES;
  }
  
  getSupportedLanguages(): typeof SUPPORTED_LANGUAGES {
    return SUPPORTED_LANGUAGES;
  }
  
  getCapabilities(): object {
    return {
      engines: nvOcrAdapterService.detectAvailableProviders(),
      documentTypes: INDIAN_LEGAL_DOCUMENT_TYPES.length,
      languages: SUPPORTED_LANGUAGES.length,
      features: [
        'Text extraction',
        'Table detection',
        'Form field extraction',
        'Handwriting recognition',
        'Signature detection',
        'Stamp recognition',
        'Multi-language support',
        'Legal document classification'
      ],
      version: '3.1.1'
    };
  }
}

export const enhancedOCRService = new JurexioEnhancedOCRService();
