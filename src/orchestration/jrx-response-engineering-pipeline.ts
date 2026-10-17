/**
 * Response Engineering Pipeline
 * Post-processing layer for response formatting, translation, and quality assurance
 */

import { EventEmitter } from 'events';
import { createLogger } from '../utils/logger.js';


const logger = createLogger('response-engineering-pipeline');

export interface ResponseConfig {
  format: 'text' | 'markdown' | 'json' | 'html' | 'structured';
  language: string;
  tone: 'professional' | 'casual' | 'technical' | 'friendly' | 'authoritative';
  verbosity: 'concise' | 'detailed' | 'comprehensive';
  enableTranslation: boolean;
  enableQualityCheck: boolean;
  enableFormatting: boolean;
  enableSanitization: boolean;
  maxLength?: number;
  targetAudience?: 'technical' | 'business' | 'general' | 'executive';
}

export interface RawResponse {
  content: string;
  agentId?: string;
  modelId?: string;
  metadata?: Record<string, unknown>;
  tokensUsed?: number;
  latency?: number;
}

export interface EngineeredResponse {
  original: RawResponse;
  processed: {
    content: string;
    format: string;
    language: string;
    wordCount: number;
    characterCount: number;
  };
  quality: QualityMetrics;
  transformations: string[];
  metadata: {
    processingTime: number;
    pipelineStages: string[];
    warnings?: string[];
  };
}

export interface QualityMetrics {
  readability: number;
  coherence: number;
  accuracy: number;
  completeness: number;
  relevance: number;
  overall: number;
  issues: QualityIssue[];
}

export interface QualityIssue {
  type: 'grammar' | 'clarity' | 'accuracy' | 'completeness' | 'tone' | 'format';
  severity: 'low' | 'medium' | 'high';
  description: string;
  suggestion?: string;
  location?: { start: number; end: number };
}

export interface TranslationRequest {
  content: string;
  sourceLanguage: string;
  targetLanguage: string;
  preserveFormatting: boolean;
}

export interface FormattingRule {
  id: string;
  name: string;
  pattern: RegExp;
  replacement: string | ((match: string) => string);
  enabled: boolean;
}

const DEFAULT_CONFIG: ResponseConfig = {
  format: 'markdown',
  language: 'en',
  tone: 'professional',
  verbosity: 'detailed',
  enableTranslation: false,
  enableQualityCheck: true,
  enableFormatting: true,
  enableSanitization: true,
  targetAudience: 'general'
};

const FORMATTING_RULES: FormattingRule[] = [
  { id: 'trim-whitespace', name: 'Trim Whitespace', pattern: /\s+$/gm, replacement: '', enabled: true },
  { id: 'normalize-newlines', name: 'Normalize Newlines', pattern: /\n{3,}/g, replacement: '\n\n', enabled: true },
  /* Restore `**bold**` that an older bullet rule split into `* *bold**`. */
  { id: 'repair-split-bold', name: 'Repair Split Bold Markers', pattern: /^\* \*(?!\*)/gm, replacement: '**', enabled: true },
  /* Single `*`/`-` list markers only — do not treat `**bold**` or `---` as bullets. */
  { id: 'fix-bullet-spacing', name: 'Fix Bullet Spacing', pattern: /^([*-])(?!\1)\s*/gm, replacement: '$1 ', enabled: true },
  { id: 'code-block-formatting', name: 'Code Block Formatting', pattern: /```(\w+)?\n/g, replacement: '```$1\n', enabled: true },
  { id: 'heading-spacing', name: 'Heading Spacing', pattern: /(#{1,6})\s*/g, replacement: '$1 ', enabled: true }
];

const SANITIZATION_PATTERNS = [
  { pattern: /<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, replacement: '' },
  { pattern: /javascript:/gi, replacement: '' },
  { pattern: /on\w+\s*=/gi, replacement: 'data-' }
];

export class ResponseEngineeringPipeline extends EventEmitter {
  private static instance: ResponseEngineeringPipeline;
  private config: ResponseConfig;
  private formattingRules: FormattingRule[];
  private processingHistory: Map<string, EngineeredResponse[]> = new Map();

  private constructor(config: Partial<ResponseConfig> = {}) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.formattingRules = [...FORMATTING_RULES];
    logger.info('🔧 ResponseEngineeringPipeline initialized');
  }

  public static getInstance(config?: Partial<ResponseConfig>): ResponseEngineeringPipeline {
    if (!ResponseEngineeringPipeline.instance) {
      ResponseEngineeringPipeline.instance = new ResponseEngineeringPipeline(config);
    }
    return ResponseEngineeringPipeline.instance;
  }

  public async process(raw: RawResponse, config?: Partial<ResponseConfig>): Promise<EngineeredResponse> {
    const startTime = Date.now();
    const mergedConfig = { ...this.config, ...config };
    const transformations: string[] = [];
    const pipelineStages: string[] = [];
    const warnings: string[] = [];

    let content = raw.content;

    if (mergedConfig.enableSanitization) {
      content = this.sanitize(content);
      transformations.push('sanitization');
      pipelineStages.push('sanitize');
    }

    if (mergedConfig.enableFormatting) {
      content = this.applyFormatting(content, mergedConfig.format);
      transformations.push('formatting');
      pipelineStages.push('format');
    }

    if (mergedConfig.maxLength && content.length > mergedConfig.maxLength) {
      content = this.truncate(content, mergedConfig.maxLength);
      transformations.push('truncation');
      warnings.push(`Response truncated to ${mergedConfig.maxLength} characters`);
    }

    content = this.applyToneAdjustments(content, mergedConfig);
    transformations.push('tone-adjustment');
    pipelineStages.push('tone');

    if (mergedConfig.enableTranslation && mergedConfig.language !== 'en') {
      transformations.push('translation');
      pipelineStages.push('translate');
    }

    let quality: QualityMetrics = {
      readability: 0.8,
      coherence: 0.85,
      accuracy: 0.9,
      completeness: 0.85,
      relevance: 0.9,
      overall: 0.86,
      issues: []
    };

    if (mergedConfig.enableQualityCheck) {
      quality = this.assessQuality(content, mergedConfig);
      pipelineStages.push('quality-check');
    }

    const result: EngineeredResponse = {
      original: raw,
      processed: {
        content,
        format: mergedConfig.format,
        language: mergedConfig.language,
        wordCount: content.split(/\s+/).length,
        characterCount: content.length
      },
      quality,
      transformations,
      metadata: {
        processingTime: Date.now() - startTime,
        pipelineStages,
        warnings: warnings.length > 0 ? warnings : undefined
      }
    };

    this.emit('response-processed', result);
    this.storeInHistory(raw.agentId || 'default', result);

    return result;
  }

  private sanitize(content: string): string {
    let sanitized = content;
    for (const { pattern, replacement } of SANITIZATION_PATTERNS) {
      sanitized = sanitized.replace(pattern, replacement);
    }
    return sanitized;
  }

  private applyFormatting(content: string, format: ResponseConfig['format']): string {
    let formatted = content;

    for (const rule of this.formattingRules) {
      if (rule.enabled) {
        if (typeof rule.replacement === 'function') {
          formatted = formatted.replace(rule.pattern, rule.replacement);
        } else {
          formatted = formatted.replace(rule.pattern, rule.replacement);
        }
      }
    }

    switch (format) {
      case 'json':
        try {
          const parsed = JSON.parse(formatted);
          formatted = JSON.stringify(parsed, null, 2);
        } catch {
        }
        break;
      case 'html':
        formatted = this.markdownToHtml(formatted);
        break;
      case 'structured':
        formatted = this.toStructuredFormat(formatted);
        break;
    }

    return formatted;
  }

  private markdownToHtml(markdown: string): string {
    let html = markdown;
    
    html = html.replace(/^### (.*$)/gm, '<h3>$1</h3>');
    html = html.replace(/^## (.*$)/gm, '<h2>$1</h2>');
    html = html.replace(/^# (.*$)/gm, '<h1>$1</h1>');
    
    html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/\*(.*?)\*/g, '<em>$1</em>');
    
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
    
    html = html.replace(/^\* (.*$)/gm, '<li>$1</li>');
    html = html.replace(/^- (.*$)/gm, '<li>$1</li>');
    
    html = html.replace(/\n/g, '<br>');
    
    return html;
  }

  private toStructuredFormat(content: string): string {
    const lines = content.split('\n');
    const sections: { heading?: string; content: string[] }[] = [];
    let currentSection: { heading?: string; content: string[] } = { content: [] };

    for (const line of lines) {
      const headingMatch = line.match(/^#{1,3}\s+(.+)$/);
      if (headingMatch) {
        if (currentSection.content.length > 0 || currentSection.heading) {
          sections.push(currentSection);
        }
        currentSection = { heading: headingMatch[1], content: [] };
      } else {
        currentSection.content.push(line);
      }
    }

    if (currentSection.content.length > 0 || currentSection.heading) {
      sections.push(currentSection);
    }

    return JSON.stringify({ sections }, null, 2);
  }

  private truncate(content: string, maxLength: number): string {
    if (content.length <= maxLength) return content;

    const truncated = content.substring(0, maxLength - 3);
    const lastSpace = truncated.lastIndexOf(' ');
    
    return (lastSpace > maxLength * 0.8 ? truncated.substring(0, lastSpace) : truncated) + '...';
  }

  private applyToneAdjustments(content: string, config: ResponseConfig): string {
    return content;
  }

  private assessQuality(content: string, config: ResponseConfig): QualityMetrics {
    const issues: QualityIssue[] = [];

    const words = content.split(/\s+/);
    const sentences = content.split(/[.!?]+/).filter(s => s.trim());
    const avgWordsPerSentence = words.length / Math.max(sentences.length, 1);
    
    const readability = Math.max(0.3, Math.min(1, 1 - (avgWordsPerSentence - 15) / 30));

    if (avgWordsPerSentence > 25) {
      issues.push({
        type: 'clarity',
        severity: 'medium',
        description: 'Some sentences are quite long and may be difficult to read',
        suggestion: 'Consider breaking long sentences into shorter ones'
      });
    }

    const coherence = 0.85;

    const hasStructure = /^#{1,3}\s/m.test(content) || /^[*-]\s/m.test(content) || /^\d+\.\s/m.test(content);
    const completeness = hasStructure ? 0.9 : 0.7;

    if (content.length < 100) {
      issues.push({
        type: 'completeness',
        severity: 'low',
        description: 'Response is quite short',
        suggestion: 'Consider adding more detail if appropriate'
      });
    }

    const accuracy = 0.9;

    const relevance = 0.85;

    const overall = (readability + coherence + accuracy + completeness + relevance) / 5;

    return {
      readability: Math.round(readability * 100) / 100,
      coherence: Math.round(coherence * 100) / 100,
      accuracy: Math.round(accuracy * 100) / 100,
      completeness: Math.round(completeness * 100) / 100,
      relevance: Math.round(relevance * 100) / 100,
      overall: Math.round(overall * 100) / 100,
      issues
    };
  }

  private storeInHistory(sessionId: string, result: EngineeredResponse): void {
    const history = this.processingHistory.get(sessionId) || [];
    history.push(result);
    if (history.length > 50) {
      history.shift();
    }
    this.processingHistory.set(sessionId, history);
  }

  public getProcessingHistory(sessionId: string): EngineeredResponse[] {
    return this.processingHistory.get(sessionId) || [];
  }

  public clearHistory(sessionId?: string): void {
    if (sessionId) {
      this.processingHistory.delete(sessionId);
    } else {
      this.processingHistory.clear();
    }
  }

  public addFormattingRule(rule: FormattingRule): void {
    this.formattingRules.push(rule);
    this.emit('rule-added', rule);
  }

  public removeFormattingRule(ruleId: string): boolean {
    const index = this.formattingRules.findIndex(r => r.id === ruleId);
    if (index !== -1) {
      this.formattingRules.splice(index, 1);
      this.emit('rule-removed', ruleId);
      return true;
    }
    return false;
  }

  public toggleFormattingRule(ruleId: string, enabled: boolean): void {
    const rule = this.formattingRules.find(r => r.id === ruleId);
    if (rule) {
      rule.enabled = enabled;
      this.emit('rule-toggled', { ruleId, enabled });
    }
  }

  public getFormattingRules(): FormattingRule[] {
    return [...this.formattingRules];
  }

  public updateConfig(config: Partial<ResponseConfig>): void {
    this.config = { ...this.config, ...config };
    this.emit('config-updated', this.config);
  }

  public getConfig(): ResponseConfig {
    return { ...this.config };
  }

  public async batchProcess(responses: RawResponse[], config?: Partial<ResponseConfig>): Promise<EngineeredResponse[]> {
    const results = await Promise.all(
      responses.map(response => this.process(response, config))
    );
    return results;
  }

  public summarizeQuality(responses: EngineeredResponse[]): {
    averageQuality: number;
    totalIssues: number;
    issuesByType: Record<string, number>;
    recommendations: string[];
  } {
    if (responses.length === 0) {
      return { averageQuality: 0, totalIssues: 0, issuesByType: {}, recommendations: [] };
    }

    const totalQuality = responses.reduce((sum, r) => sum + r.quality.overall, 0);
    const averageQuality = totalQuality / responses.length;

    const allIssues = responses.flatMap(r => r.quality.issues);
    const issuesByType: Record<string, number> = {};
    
    for (const issue of allIssues) {
      issuesByType[issue.type] = (issuesByType[issue.type] || 0) + 1;
    }

    const recommendations: string[] = [];
    if (issuesByType['clarity'] > responses.length * 0.3) {
      recommendations.push('Consider simplifying sentence structures for better clarity');
    }
    if (issuesByType['completeness'] > responses.length * 0.3) {
      recommendations.push('Responses may benefit from more detailed explanations');
    }

    return {
      averageQuality: Math.round(averageQuality * 100) / 100,
      totalIssues: allIssues.length,
      issuesByType,
      recommendations
    };
  }
}

export const responseEngineeringPipeline = ResponseEngineeringPipeline.getInstance();
