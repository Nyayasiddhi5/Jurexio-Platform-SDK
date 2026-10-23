/**
 * Context Engineer - Real Implementation
 * Advanced context engineering for optimal LLM performance
 */

import { EventEmitter } from 'events';
import { createLogger } from '../utils/logger.js';


const logger = createLogger('context-engineer');

export interface ContextLayer {
  id: string;
  name: string;
  type: 'project' | 'user' | 'session' | 'global' | 'domain';
  priority: number;
  content: Record<string, any>;
  metadata: {
    created: Date;
    lastUpdated: Date;
    accessCount: number;
    relevanceScore: number;
    expirationDate?: Date;
  };
}

export interface ContextRequest {
  id: string;
  agentId: string;
  taskType: string;
  query: string;
  requiredLayers: string[];
  optionalLayers: string[];
  constraints: {
    maxTokens: number;
    relevanceThreshold: number;
    includeDomainKnowledge: boolean;
    prioritizeRecent: boolean;
  };
  metadata: {
    timestamp: Date;
    sessionId: string;
    userId?: string;
    projectId?: string;
  };
}

export interface EngineeredContext {
  id: string;
  requestId: string;
  layers: ContextLayer[];
  mergedContent: string;
  statistics: {
    totalLayers: number;
    tokenCount: number;
    compressionRatio: number;
    relevanceScore: number;
    processingTime: number;
  };
  optimization: {
    applied: string[];
    tokensReduced: number;
    qualityImpact: number;
  };
}

export interface ContextTemplate {
  id: string;
  name: string;
  agentType: string;
  taskType: string;
  structure: {
    introduction: string;
    contextSections: Array<{
      name: string;
      weight: number;
      required: boolean;
    }>;
    conclusion: string;
  };
}

/**
 * Context Engineer - Production Implementation
 */
export class ContextEngineer extends EventEmitter {
  private contextLayers: Map<string, ContextLayer> = new Map();
  private templates: Map<string, ContextTemplate> = new Map();
  private compressionStrategies: Map<string, Function> = new Map();
  private isInitialized = false;

  constructor() {
    super();
    this.initializeStrategies();
  }

  /**
   * Initialize context engineering strategies
   */
  private initializeStrategies(): void {
    // Token compression strategies
    this.compressionStrategies.set('redundancy-removal', this.removeRedundancy.bind(this));
    this.compressionStrategies.set('summarization', this.applySummarization.bind(this));
    this.compressionStrategies.set('keyword-extraction', this.extractKeywords.bind(this));
    this.compressionStrategies.set('semantic-clustering', this.applySemantic.bind(this));

    // Initialize default context layers
    this.initializeDefaultLayers();

    // Initialize templates
    this.initializeTemplates();
  }

  /**
   * Initialize default context layers
   */
  private initializeDefaultLayers(): void {
    const defaultLayers: ContextLayer[] = [
      {
        id: 'global-system',
        name: 'Global System Context',
        type: 'global',
        priority: 10,
        content: {
          platform: 'Jurexio Enterprise Platform SDK v5.0.0',
          capabilities: ['orchestration', 'agents', 'llm-routing', 'context-engineering'],
          version: '9.0.0',
          timestamp: new Date()
        },
        metadata: {
          created: new Date(),
          lastUpdated: new Date(),
          accessCount: 0,
          relevanceScore: 1.0
        }
      },
      {
        id: 'domain-knowledge',
        name: 'Domain Knowledge Base',
        type: 'domain',
        priority: 8,
        content: {
          domains: ['software-development', 'ai-orchestration', 'content-creation', 'business-analysis'],
          patterns: ['microservices', 'event-driven', 'agile', 'devops'],
          technologies: ['typescript', 'react', 'nodejs', 'postgresql', 'docker'],
          methodologies: ['bmad', 'roma', 'claude-flow', 'context-engineering']
        },
        metadata: {
          created: new Date(),
          lastUpdated: new Date(),
          accessCount: 0,
          relevanceScore: 0.9
        }
      },
      {
        id: 'quality-standards',
        name: 'Quality and Best Practices',
        type: 'global',
        priority: 7,
        content: {
          codeQuality: ['clean-code', 'solid-principles', 'testing', 'documentation'],
          security: ['authentication', 'authorization', 'encryption', 'audit-trails'],
          performance: ['optimization', 'caching', 'monitoring', 'scaling'],
          reliability: ['error-handling', 'fallbacks', 'circuit-breakers', 'health-checks']
        },
        metadata: {
          created: new Date(),
          lastUpdated: new Date(),
          accessCount: 0,
          relevanceScore: 0.85
        }
      }
    ];

    defaultLayers.forEach(layer => {
      this.contextLayers.set(layer.id, layer);
    });
  }

  /**
   * Initialize context templates
   */
  private initializeTemplates(): void {
    const templates: ContextTemplate[] = [
      {
        id: 'development-template',
        name: 'Software Development Context',
        agentType: 'development',
        taskType: 'coding',
        structure: {
          introduction: 'You are a senior software developer working on enterprise applications.',
          contextSections: [
            { name: 'project-context', weight: 0.3, required: true },
            { name: 'technical-requirements', weight: 0.25, required: true },
            { name: 'quality-standards', weight: 0.2, required: true },
            { name: 'domain-knowledge', weight: 0.15, required: false },
            { name: 'user-preferences', weight: 0.1, required: false }
          ],
          conclusion: 'Provide production-ready code that follows best practices and meets all requirements.'
        }
      },
      {
        id: 'creative-template',
        name: 'Creative Content Context',
        agentType: 'creative',
        taskType: 'content',
        structure: {
          introduction: 'You are a creative professional specializing in content strategy and brand development.',
          contextSections: [
            { name: 'brand-context', weight: 0.3, required: true },
            { name: 'audience-profile', weight: 0.25, required: true },
            { name: 'content-goals', weight: 0.2, required: true },
            { name: 'market-trends', weight: 0.15, required: false },
            { name: 'creative-guidelines', weight: 0.1, required: false }
          ],
          conclusion: 'Create engaging content that aligns with brand values and resonates with the target audience.'
        }
      },
      {
        id: 'analysis-template',
        name: 'Business Analysis Context',
        agentType: 'business',
        taskType: 'analysis',
        structure: {
          introduction: 'You are a senior business analyst with expertise in strategic planning and data analysis.',
          contextSections: [
            { name: 'business-context', weight: 0.3, required: true },
            { name: 'market-data', weight: 0.25, required: true },
            { name: 'strategic-objectives', weight: 0.2, required: true },
            { name: 'industry-trends', weight: 0.15, required: false },
            { name: 'risk-factors', weight: 0.1, required: false }
          ],
          conclusion: 'Provide actionable insights and recommendations based on comprehensive analysis.'
        }
      }
    ];

    templates.forEach(template => {
      this.templates.set(template.id, template);
    });
  }

  /**
   * Initialize context engineer
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      return;
    }

    logger.info('🧠 Initializing Context Engineer...');

    // Load additional context layers from storage if available
    await this.loadContextLayers();

    this.isInitialized = true;
    logger.info('✅ Context Engineer initialized successfully');
  }

  /**
   * Load context layers from persistent storage
   */
  private async loadContextLayers(): Promise<void> {
    // In a real implementation, this would load from database
    // For now, we'll add some additional layers programmatically
    
    const additionalLayers: ContextLayer[] = [
      {
        id: 'session-default',
        name: 'Default Session Context',
        type: 'session',
        priority: 5,
        content: {
          sessionStart: new Date(),
          interactions: 0,
          preferences: {
            verbosity: 'detailed',
            format: 'structured',
            examples: true
          }
        },
        metadata: {
          created: new Date(),
          lastUpdated: new Date(),
          accessCount: 0,
          relevanceScore: 0.7
        }
      }
    ];

    additionalLayers.forEach(layer => {
      this.contextLayers.set(layer.id, layer);
    });
  }

  /**
   * Engineer context for a specific request
   */
  async engineerContext(request: ContextRequest): Promise<EngineeredContext> {
    const startTime = Date.now();
    logger.info(`🔄 Engineering context for: ${request.taskType} - ${request.query.substring(0, 100)}...`);

    try {
      // Select relevant layers
      const selectedLayers = await this.selectLayers(request);

      // Apply template if available
      const template = this.findTemplate(request.agentId, request.taskType);

      // Merge layers into cohesive context
      const mergedContent = await this.mergeLayers(selectedLayers, template, request);

      // Apply optimization strategies
      const optimized = await this.optimizeContext(mergedContent, request.constraints);

      // Calculate statistics
      const statistics = this.calculateStatistics(selectedLayers, optimized, startTime);

      const engineeredContext: EngineeredContext = {
        id: `ctx_${Date.now()}_${crypto.randomUUID().substring(0, 9)}`,
        requestId: request.id,
        layers: selectedLayers,
        mergedContent: optimized.content,
        statistics,
        optimization: optimized.optimization
      };

      // Update layer access counts
      this.updateLayerMetrics(selectedLayers);

      logger.info(`✅ Context engineered: ${statistics.tokenCount} tokens, ${statistics.totalLayers} layers`);
      this.emit('context-engineered', engineeredContext);

      return engineeredContext;

    } catch (error: any) {
      const errorContext: EngineeredContext = {
        id: `error_${Date.now()}`,
        requestId: request.id,
        layers: [],
        mergedContent: `Error engineering context: ${error instanceof Error ? error.message : String(error)}`,
        statistics: {
          totalLayers: 0,
          tokenCount: 0,
          compressionRatio: 0,
          relevanceScore: 0,
          processingTime: Date.now() - startTime
        },
        optimization: {
          applied: [],
          tokensReduced: 0,
          qualityImpact: 0
        }
      };

      logger.error(`❌ Context engineering failed: ${error}`);
      this.emit('context-error', { request, error });

      return errorContext;
    }
  }

  /**
   * Select relevant context layers for the request
   */
  private async selectLayers(request: ContextRequest): Promise<ContextLayer[]> {
    const allLayers = Array.from(this.contextLayers.values());
    const selectedLayers: ContextLayer[] = [];

    // Add required layers
    for (const layerType of request.requiredLayers) {
      const layer = allLayers.find(l => l.type === layerType || l.id === layerType);
      if (layer) {
        selectedLayers.push(layer);
      }
    }

    // Add optional layers based on relevance
    for (const layerType of request.optionalLayers) {
      const layer = allLayers.find(l => l.type === layerType || l.id === layerType);
      if (layer && layer.metadata.relevanceScore >= request.constraints.relevanceThreshold) {
        selectedLayers.push(layer);
      }
    }

    // Add domain-specific layers
    const domainLayers = allLayers.filter(l => 
      l.type === 'domain' && 
      this.isRelevantToDomain(l, request.taskType)
    );
    selectedLayers.push(...domainLayers);

    // Sort by priority and relevance
    return selectedLayers
      .filter((layer, index, self) => self.findIndex(l => l.id === layer.id) === index) // Remove duplicates
      .sort((a, b) => (b.priority + b.metadata.relevanceScore) - (a.priority + a.metadata.relevanceScore));
  }

  /**
   * Check if layer is relevant to domain
   */
  private isRelevantToDomain(layer: ContextLayer, taskType: string): boolean {
    if (!layer.content.domains) return false;
    
    const taskKeywords = taskType.toLowerCase().split(/[-_\s]/);
    return layer.content.domains.some((domain: string) =>
      taskKeywords.some(keyword => domain.includes(keyword) || keyword.includes(domain))
    );
  }

  /**
   * Find appropriate template for request
   */
  private findTemplate(agentId: string, taskType: string): ContextTemplate | null {
    const agentType = agentId.split('-')[0]; // Extract agent type from ID
    
    for (const template of this.templates.values()) {
      if (template.agentType === agentType || template.taskType === taskType) {
        return template;
      }
    }

    return null;
  }

  /**
   * Merge context layers into cohesive content
   */
  private async mergeLayers(layers: ContextLayer[], template: ContextTemplate | null, request: ContextRequest): Promise<string> {
    let content = '';

    if (template) {
      // Use template structure
      content += template.structure.introduction + '\n\n';

      for (const section of template.structure.contextSections) {
        const relevantLayers = layers.filter(l => 
          l.type === section.name || 
          l.name.toLowerCase().includes(section.name.replace('-', ' '))
        );

        if (relevantLayers.length > 0 || section.required) {
          content += `## ${this.formatSectionName(section.name)}\n`;
          
          if (relevantLayers.length > 0) {
            content += relevantLayers.map(layer => this.formatLayerContent(layer)).join('\n') + '\n\n';
          } else if (section.required) {
            content += `${section.name} information not available\n\n`;
          }
        }
      }

      content += template.structure.conclusion + '\n\n';

    } else {
      // Simple concatenation without template
      content += 'System Context:\n\n';
      content += layers.map(layer => this.formatLayerContent(layer)).join('\n\n');
      content += '\n\nTask: ' + request.query + '\n';
    }

    return content;
  }

  /**
   * Format section name for readability
   */
  private formatSectionName(name: string): string {
    return name.split('-').map(word => 
      word.charAt(0).toUpperCase() + word.slice(1)
    ).join(' ');
  }

  /**
   * Format layer content for inclusion
   */
  private formatLayerContent(layer: ContextLayer): string {
    let content = `### ${layer.name}\n`;
    
    if (typeof layer.content === 'string') {
      content += layer.content;
    } else {
      content += Object.entries(layer.content)
        .map(([key, value]) => `**${key}**: ${this.formatValue(value)}`)
        .join('\n');
    }
    
    return content;
  }

  /**
   * Format value for display
   */
  private formatValue(value: any): string {
    if (Array.isArray(value)) {
      return value.join(', ');
    } else if (typeof value === 'object' && value !== null) {
      return JSON.stringify(value, null, 2);
    } else {
      return String(value);
    }
  }

  /**
   * Optimize context for token constraints
   */
  private async optimizeContext(content: string, constraints: any): Promise<{ content: string; optimization: any }> {
    let optimizedContent = content;
    const originalTokens = this.estimateTokens(content);
    const applied: string[] = [];
    let tokensReduced = 0;

    if (originalTokens > constraints.maxTokens) {
      // Apply compression strategies in order
      for (const [strategyName, strategy] of this.compressionStrategies) {
        const result = await strategy(optimizedContent, constraints);
        if (result.tokens < this.estimateTokens(optimizedContent)) {
          optimizedContent = result.content;
          applied.push(strategyName);
          tokensReduced += this.estimateTokens(optimizedContent) - result.tokens;
          
          if (result.tokens <= constraints.maxTokens) {
            break;
          }
        }
      }
    }

    return {
      content: optimizedContent,
      optimization: {
        applied,
        tokensReduced,
        qualityImpact: Math.max(0, 1 - (tokensReduced / originalTokens))
      }
    };
  }

  /**
   * Remove redundant information
   */
  private async removeRedundancy(content: string, constraints: any): Promise<{ content: string; tokens: number }> {
    // Simple redundancy removal - remove duplicate lines
    const lines = content.split('\n');
    const uniqueLines = Array.from(new Set(lines));
    const cleaned = uniqueLines.join('\n');
    
    return {
      content: cleaned,
      tokens: this.estimateTokens(cleaned)
    };
  }

  /**
   * Apply summarization
   */
  private async applySummarization(content: string, constraints: any): Promise<{ content: string; tokens: number }> {
    // Simple summarization - take first few sentences of each paragraph
    const paragraphs = content.split('\n\n');
    const summarized = paragraphs.map(para => {
      const sentences = para.split('. ');
      return sentences.slice(0, 2).join('. ') + (sentences.length > 2 ? '...' : '');
    }).join('\n\n');
    
    return {
      content: summarized,
      tokens: this.estimateTokens(summarized)
    };
  }

  /**
   * Extract keywords
   */
  private async extractKeywords(content: string, constraints: any): Promise<{ content: string; tokens: number }> {
    // Simple keyword extraction - keep headers and key phrases
    const lines = content.split('\n');
    const keywords = lines.filter(line => 
      line.startsWith('#') || 
      line.includes('**') || 
      line.length < 100
    );
    const extracted = keywords.join('\n');
    
    return {
      content: extracted,
      tokens: this.estimateTokens(extracted)
    };
  }

  /**
   * Apply semantic clustering
   */
  private async applySemantic(content: string, constraints: any): Promise<{ content: string; tokens: number }> {
    // Simple semantic grouping - group related sections
    // This is a simplified version; real implementation would use embeddings
    const sections = content.split('##');
    const grouped = sections.slice(0, Math.ceil(sections.length / 2)).join('##');
    
    return {
      content: grouped,
      tokens: this.estimateTokens(grouped)
    };
  }

  /**
   * Estimate token count
   */
  private estimateTokens(text: string): number {
    // Rough estimation: 1 token ≈ 4 characters
    return Math.ceil(text.length / 4);
  }

  /**
   * Calculate context statistics
   */
  private calculateStatistics(layers: ContextLayer[], optimized: any, startTime: number): any {
    return {
      totalLayers: layers.length,
      tokenCount: this.estimateTokens(optimized.content),
      compressionRatio: optimized.optimization.tokensReduced > 0 ? 
        optimized.optimization.tokensReduced / (this.estimateTokens(optimized.content) + optimized.optimization.tokensReduced) : 0,
      relevanceScore: layers.reduce((sum, layer) => sum + layer.metadata.relevanceScore, 0) / layers.length,
      processingTime: Date.now() - startTime
    };
  }

  /**
   * Update layer access metrics
   */
  private updateLayerMetrics(layers: ContextLayer[]): void {
    layers.forEach(layer => {
      layer.metadata.accessCount++;
      layer.metadata.lastUpdated = new Date();
      this.contextLayers.set(layer.id, layer);
    });
  }

  /**
   * Add new context layer
   */
  addContextLayer(layer: ContextLayer): void {
    this.contextLayers.set(layer.id, layer);
    logger.info(`✅ Added context layer: ${layer.name}`);
  }

  /**
   * Update existing context layer
   */
  updateContextLayer(layerId: string, updates: Partial<ContextLayer>): void {
    const existing = this.contextLayers.get(layerId);
    if (existing) {
      const updated = { ...existing, ...updates };
      updated.metadata.lastUpdated = new Date();
      this.contextLayers.set(layerId, updated);
      logger.info(`✅ Updated context layer: ${layerId}`);
    }
  }

  /**
   * Get context layer
   */
  getContextLayer(layerId: string): ContextLayer | undefined {
    return this.contextLayers.get(layerId);
  }

  /**
   * Shutdown context engineer
   */
  async shutdown(): Promise<void> {
    logger.info('✅ Context Engineer shutdown complete');
  }
}