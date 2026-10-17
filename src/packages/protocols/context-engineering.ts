// JRX-NS-021 (2026-05-05): pre-existing TS errors (gateway runs via tsx).
/**
 * Context Engineering System
 * 
 * Implements advanced context engineering methods for optimal LLM request execution
 * with multi-layer context management, intelligent merging, and dynamic optimization.
 */

import { EventEmitter } from 'events';

export interface ContextLayer {
  id: string;
  name: string;
  type: 'project' | 'user' | 'session' | 'global' | 'domain';
  priority: number; // 1-10, higher = more important
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
      template: string;
    }>;
    constraints: string;
    examples?: string;
  };
  performance: {
    usage: number;
    avgQuality: number;
    avgTokens: number;
  };
}

export class ContextLayerManager extends EventEmitter {
  private layers: Map<string, ContextLayer> = new Map();
  private layerRelationships: Map<string, string[]> = new Map();

  constructor() {
    super();
    this.initializeDefaultLayers();
  }

  /**
   * Initialize default context layers
   */
  private initializeDefaultLayers(): void {
    const defaultLayers: ContextLayer[] = [
      {
        id: 'global-jurexio-system',
        name: 'Jurexio System Global Context',
        type: 'global',
        priority: 8,
        content: {
          systemVersion: 'Jurexio v9.0 Ultimate',
          capabilities: ['105+ agents', '19 LLM providers', 'Multi-agent coordination'],
          architecture: 'Distributed orchestration with intelligent routing',
          guidelines: [
            'Prioritize quality and accuracy in all outputs',
            'Coordinate with other agents when beneficial',
            'Apply security best practices consistently',
            'Optimize for both performance and user experience'
          ]
        },
        metadata: {
          created: new Date(),
          lastUpdated: new Date(),
          accessCount: 0,
          relevanceScore: 0.9
        }
      },
      {
        id: 'development-domain',
        name: 'Software Development Domain Knowledge',
        type: 'domain',
        priority: 7,
        content: {
          bestPractices: [
            'Follow SOLID principles',
            'Implement comprehensive testing',
            'Use version control effectively',
            'Apply security by design',
            'Document code and APIs thoroughly'
          ],
          frameworks: {
            web: ['React', 'Vue', 'Angular', 'Svelte'],
            backend: ['Node.js', 'Python', 'Java', 'Go'],
            mobile: ['React Native', 'Flutter', 'Swift', 'Kotlin']
          },
          patterns: ['MVC', 'Observer', 'Factory', 'Strategy', 'Dependency Injection'],
          currentTrends: ['AI integration', 'Edge computing', 'Serverless', 'Microservices']
        },
        metadata: {
          created: new Date(),
          lastUpdated: new Date(),
          accessCount: 0,
          relevanceScore: 0.8
        }
      },
      {
        id: 'creative-domain',
        name: 'Creative Content Domain Knowledge',
        type: 'domain',
        priority: 7,
        content: {
          principles: [
            'Understand target audience thoroughly',
            'Maintain brand consistency',
            'Focus on engagement and value',
            'Optimize for platform-specific requirements',
            'Measure and iterate based on performance'
          ],
          contentTypes: {
            written: ['Blog posts', 'Articles', 'Social media', 'Email campaigns'],
            visual: ['Infographics', 'Images', 'Videos', 'Presentations'],
            interactive: ['Quizzes', 'Polls', 'Games', 'Tools']
          },
          platforms: ['Website', 'Social media', 'Email', 'Print', 'Video platforms'],
          trends: ['Personalization', 'AI-generated content', 'Interactive media', 'Short-form video']
        },
        metadata: {
          created: new Date(),
          lastUpdated: new Date(),
          accessCount: 0,
          relevanceScore: 0.8
        }
      }
    ];

    defaultLayers.forEach(layer => {
      this.layers.set(layer.id, layer);
    });
  }

  /**
   * Add or update context layer
   */
  addLayer(layer: ContextLayer): void {
    this.layers.set(layer.id, layer);
    
    this.emit('layer-added', {
      layerId: layer.id,
      type: layer.type,
      priority: layer.priority,
      timestamp: new Date()
    });
  }

  /**
   * Get context layer by ID
   */
  getLayer(id: string): ContextLayer | undefined {
    const layer = this.layers.get(id);
    if (layer) {
      layer.metadata.accessCount++;
      layer.metadata.lastUpdated = new Date();
    }
    return layer;
  }

  /**
   * Get layers by type and priority
   */
  getLayersByType(type: ContextLayer['type'], minPriority: number = 1): ContextLayer[] {
    return Array.from(this.layers.values())
      .filter(layer => layer.type === type && layer.priority >= minPriority)
      .sort((a, b) => b.priority - a.priority);
  }

  /**
   * Update layer content
   */
  updateLayer(id: string, updates: Partial<ContextLayer['content']>): void {
    const layer = this.layers.get(id);
    if (layer) {
      layer.content = { ...layer.content, ...updates };
      layer.metadata.lastUpdated = new Date();
      
      this.emit('layer-updated', {
        layerId: id,
        updates: Object.keys(updates),
        timestamp: new Date()
      });
    }
  }

  /**
   * Create user-specific context layer
   */
  createUserLayer(userId: string, preferences: Record<string, any>): ContextLayer {
    const layer: ContextLayer = {
      id: `user-${userId}`,
      name: `User Context - ${userId}`,
      type: 'user',
      priority: 6,
      content: {
        preferences,
        history: [],
        expertise: [],
        communicationStyle: 'professional'
      },
      metadata: {
        created: new Date(),
        lastUpdated: new Date(),
        accessCount: 0,
        relevanceScore: 0.7
      }
    };

    this.addLayer(layer);
    return layer;
  }

  /**
   * Create project-specific context layer
   */
  createProjectLayer(projectId: string, projectInfo: Record<string, any>): ContextLayer {
    const layer: ContextLayer = {
      id: `project-${projectId}`,
      name: `Project Context - ${projectId}`,
      type: 'project',
      priority: 9,
      content: {
        ...projectInfo,
        decisions: [],
        architecture: {},
        dependencies: [],
        timeline: {}
      },
      metadata: {
        created: new Date(),
        lastUpdated: new Date(),
        accessCount: 0,
        relevanceScore: 0.95
      }
    };

    this.addLayer(layer);
    return layer;
  }

  /**
   * Create session-specific context layer
   */
  createSessionLayer(sessionId: string, sessionData: Record<string, any>): ContextLayer {
    const layer: ContextLayer = {
      id: `session-${sessionId}`,
      name: `Session Context - ${sessionId}`,
      type: 'session',
      priority: 5,
      content: {
        ...sessionData,
        interactions: [],
        context: {},
        state: 'active'
      },
      metadata: {
        created: new Date(),
        lastUpdated: new Date(),
        accessCount: 0,
        relevanceScore: 0.6,
        expirationDate: new Date(Date.now() + 24 * 60 * 60 * 1000) // 24 hours
      }
    };

    this.addLayer(layer);
    return layer;
  }

  /**
   * Clean expired layers
   */
  cleanExpiredLayers(): number {
    const now = new Date();
    let cleaned = 0;

    for (const [id, layer] of this.layers) {
      if (layer.metadata.expirationDate && layer.metadata.expirationDate < now) {
        this.layers.delete(id);
        cleaned++;
        
        this.emit('layer-expired', {
          layerId: id,
          type: layer.type,
          timestamp: new Date()
        });
      }
    }

    return cleaned;
  }

  /**
   * Get all layers matching criteria
   */
  getAllLayers(): ContextLayer[] {
    return Array.from(this.layers.values());
  }
}

export class ContextMerger extends EventEmitter {
  private templates: Map<string, ContextTemplate> = new Map();

  constructor() {
    super();
    this.initializeTemplates();
  }

  /**
   * Initialize context templates for different agent types
   */
  private initializeTemplates(): void {
    const templates: ContextTemplate[] = [
      {
        id: 'development-agent-template',
        name: 'Development Agent Context Template',
        agentType: 'development',
        taskType: 'coding',
        structure: {
          introduction: 'You are a senior software development agent working within the Jurexio orchestration system.',
          contextSections: [
            {
              name: 'project_context',
              weight: 0.4,
              required: true,
              template: 'Project: {project_name}\nArchitecture: {architecture}\nTech Stack: {tech_stack}'
            },
            {
              name: 'user_preferences',
              weight: 0.2,
              required: false,
              template: 'User Preferences: {coding_style}, {framework_preference}, {quality_focus}'
            },
            {
              name: 'domain_knowledge',
              weight: 0.3,
              required: true,
              template: 'Best Practices: {best_practices}\nCurrent Trends: {trends}'
            },
            {
              name: 'session_context',
              weight: 0.1,
              required: false,
              template: 'Session History: {previous_interactions}'
            }
          ],
          constraints: 'Follow security best practices, optimize for performance, ensure maintainability.',
          examples: 'When implementing authentication, use industry-standard libraries and patterns.'
        },
        performance: {
          usage: 0,
          avgQuality: 0,
          avgTokens: 0
        }
      },
      {
        id: 'creative-agent-template',
        name: 'Creative Agent Context Template',
        agentType: 'creative',
        taskType: 'content-creation',
        structure: {
          introduction: 'You are a creative content specialist focused on engaging, high-quality content creation.',
          contextSections: [
            {
              name: 'brand_context',
              weight: 0.4,
              required: true,
              template: 'Brand: {brand_name}\nVoice: {brand_voice}\nAudience: {target_audience}'
            },
            {
              name: 'content_requirements',
              weight: 0.3,
              required: true,
              template: 'Content Type: {content_type}\nPlatform: {platform}\nGoals: {objectives}'
            },
            {
              name: 'creative_guidelines',
              weight: 0.2,
              required: true,
              template: 'Style Guidelines: {style_guide}\nTrends: {current_trends}'
            },
            {
              name: 'performance_data',
              weight: 0.1,
              required: false,
              template: 'Previous Performance: {engagement_metrics}\nSuccessful Formats: {winning_formats}'
            }
          ],
          constraints: 'Maintain brand consistency, ensure accessibility, optimize for engagement.',
          examples: 'For social media posts, use compelling hooks and clear calls-to-action.'
        },
        performance: {
          usage: 0,
          avgQuality: 0,
          avgTokens: 0
        }
      }
    ];

    templates.forEach(template => {
      this.templates.set(template.id, template);
    });
  }

  /**
   * Merge context layers into optimized context string
   */
  async mergeContext(
    layers: ContextLayer[],
    template: ContextTemplate,
    constraints: {
      maxTokens: number;
      relevanceThreshold: number;
    }
  ): Promise<EngineeredContext> {
    try {
      const startTime = Date.now();
      
      this.emit('merge-started', {
        layerCount: layers.length,
        maxTokens: constraints.maxTokens,
        timestamp: new Date()
      });

      // Sort layers by priority and relevance
      const sortedLayers = this.prioritizeLayers(layers, constraints.relevanceThreshold);
      
      // Apply intelligent merging strategy
      const mergedContent = await this.intelligentMerge(sortedLayers, template, constraints);
      
      // Apply optimization techniques
      const optimization = await this.optimizeContext(mergedContent, constraints);
      
      const processingTime = Date.now() - startTime;
      
      const result: EngineeredContext = {
        id: `context-${Date.now()}`,
        requestId: '', // Will be set by caller
        layers: sortedLayers,
        mergedContent: optimization.optimizedContent,
        statistics: {
          totalLayers: layers.length,
          tokenCount: this.estimateTokenCount(optimization.optimizedContent),
          compressionRatio: optimization.compressionRatio,
          relevanceScore: this.calculateOverallRelevance(sortedLayers),
          processingTime
        },
        optimization: {
          applied: optimization.techniques,
          tokensReduced: optimization.tokensReduced,
          qualityImpact: optimization.qualityImpact
        }
      };

      this.emit('merge-completed', {
        contextId: result.id,
        tokenCount: result.statistics.tokenCount,
        compressionRatio: result.statistics.compressionRatio,
        timestamp: new Date()
      });

      return result;
    } catch (error: any) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.emit('error', { stage: 'context-merge', error: errorMessage });
      throw error;
    }
  }

  /**
   * Prioritize layers based on relevance and priority
   */
  private prioritizeLayers(layers: ContextLayer[], relevanceThreshold: number): ContextLayer[] {
    return layers
      .filter(layer => layer.metadata.relevanceScore >= relevanceThreshold)
      .sort((a, b) => {
        // Primary sort: priority
        if (a.priority !== b.priority) {
          return b.priority - a.priority;
        }
        // Secondary sort: relevance score
        return b.metadata.relevanceScore - a.metadata.relevanceScore;
      });
  }

  /**
   * Intelligent context merging with template application
   */
  private async intelligentMerge(
    layers: ContextLayer[],
    template: ContextTemplate,
    constraints: any
  ): Promise<string> {
    let mergedContent = template.structure.introduction + '\n\n';

    // Process each template section
    for (const section of template.structure.contextSections) {
      const sectionContent = this.buildSection(section, layers);
      if (sectionContent || section.required) {
        mergedContent += `## ${section.name.replace('_', ' ').toUpperCase()}\n`;
        mergedContent += sectionContent || '[No relevant context available]';
        mergedContent += '\n\n';
      }
    }

    // Add constraints
    if (template.structure.constraints) {
      mergedContent += `## CONSTRAINTS\n${template.structure.constraints}\n\n`;
    }

    // Add examples if available
    if (template.structure.examples) {
      mergedContent += `## EXAMPLES\n${template.structure.examples}\n\n`;
    }

    return mergedContent;
  }

  /**
   * Build section content from relevant layers
   */
  private buildSection(section: any, layers: ContextLayer[]): string {
    let sectionContent = '';
    
    // Find relevant layers for this section
    const relevantLayers = this.findRelevantLayersForSection(section, layers);
    
    for (const layer of relevantLayers) {
      const layerContent = this.extractRelevantContent(layer, section.name);
      if (layerContent) {
        sectionContent += layerContent + '\n';
      }
    }

    return sectionContent.trim();
  }

  /**
   * Find layers relevant to a specific section
   */
  private findRelevantLayersForSection(section: any, layers: ContextLayer[]): ContextLayer[] {
    const sectionKeywords = section.name.toLowerCase().split('_');
    
    return layers.filter(layer => {
      // Check if layer type matches section needs
      if (section.name.includes('project') && layer.type === 'project') return true;
      if (section.name.includes('user') && layer.type === 'user') return true;
      if (section.name.includes('session') && layer.type === 'session') return true;
      if (section.name.includes('domain') && layer.type === 'domain') return true;
      
      // Check content keywords
      const contentStr = JSON.stringify(layer.content).toLowerCase();
      // @ts-expect-error NV-TS230 legacy typing gap (TS7006)
      return sectionKeywords.some(keyword => contentStr.includes(keyword));
    });
  }

  /**
   * Extract relevant content from layer for section
   */
  private extractRelevantContent(layer: ContextLayer, sectionName: string): string {
    const content = layer.content;
    
    switch (sectionName) {
      case 'project_context':
        return `Project: ${content.name || 'Unnamed'}\n` +
               `Architecture: ${content.architecture || 'Standard'}\n` +
               `Tech Stack: ${Array.isArray(content.techStack) ? content.techStack.join(', ') : 'Mixed'}`;
      
      case 'user_preferences':
        return `Preferences: ${JSON.stringify(content.preferences || {})}`;
      
      case 'domain_knowledge':
        const practices = Array.isArray(content.bestPractices) 
          ? content.bestPractices.join(', ') 
          : 'Standard practices';
        return `Best Practices: ${practices}`;
      
      case 'session_context':
        const interactions = Array.isArray(content.interactions) 
          ? content.interactions.length 
          : 0;
        return `Previous Interactions: ${interactions}`;
      
      default:
        return JSON.stringify(content).substring(0, 200) + '...';
    }
  }

  /**
   * Optimize context for token efficiency
   */
  private async optimizeContext(content: string, constraints: any): Promise<any> {
    const originalTokens = this.estimateTokenCount(content);
    let optimizedContent = content;
    const techniques: string[] = [];
    
    if (originalTokens > constraints.maxTokens) {
      // Apply compression techniques
      const compressionResult = await this.applyCompression(optimizedContent, constraints.maxTokens);
      optimizedContent = compressionResult.content;
      techniques.push(...compressionResult.techniques);
    }

    const finalTokens = this.estimateTokenCount(optimizedContent);
    const tokensReduced = originalTokens - finalTokens;
    const compressionRatio = finalTokens / originalTokens;
    const qualityImpact = this.estimateQualityImpact(techniques);

    return {
      optimizedContent,
      techniques,
      tokensReduced,
      compressionRatio,
      qualityImpact
    };
  }

  /**
   * Apply compression techniques to reduce token count
   */
  private async applyCompression(content: string, maxTokens: number): Promise<any> {
    let compressed = content;
    const techniques: string[] = [];

    // 1. Remove excessive whitespace
    compressed = compressed.replace(/\n\s*\n\s*\n/g, '\n\n');
    compressed = compressed.replace(/\s+/g, ' ');
    techniques.push('whitespace-normalization');

    // 2. Abbreviate common terms
    const abbreviations: Record<string, string> = {
      'application': 'app',
      'configuration': 'config',
      'development': 'dev',
      'environment': 'env',
      'implementation': 'impl',
      'performance': 'perf',
      'requirements': 'reqs'
    };

    for (const [full, abbrev] of Object.entries(abbreviations)) {
      compressed = compressed.replace(new RegExp(`\\b${full}\\b`, 'gi'), abbrev);
    }
    techniques.push('abbreviation');

    // 3. Truncate if still too long
    const currentTokens = this.estimateTokenCount(compressed);
    if (currentTokens > maxTokens) {
      const ratio = maxTokens / currentTokens;
      const targetLength = Math.floor(compressed.length * ratio * 0.9); // 10% buffer
      compressed = compressed.substring(0, targetLength) + '...';
      techniques.push('truncation');
    }

    return { content: compressed, techniques };
  }

  /**
   * Estimate token count (rough approximation)
   */
  private estimateTokenCount(text: string): number {
    // Rough approximation: 1 token ≈ 4 characters
    return Math.ceil(text.length / 4);
  }

  /**
   * Calculate overall relevance score
   */
  private calculateOverallRelevance(layers: ContextLayer[]): number {
    if (layers.length === 0) return 0;
    
    const weightedSum = layers.reduce((sum, layer) => {
      return sum + (layer.metadata.relevanceScore * layer.priority);
    }, 0);
    
    const totalWeight = layers.reduce((sum, layer) => sum + layer.priority, 0);
    
    return weightedSum / totalWeight;
  }

  /**
   * Estimate quality impact of optimization techniques
   */
  private estimateQualityImpact(techniques: string[]): number {
    const impacts: Record<string, number> = {
      'whitespace-normalization': 0.01,
      'abbreviation': 0.05,
      'truncation': 0.15
    };

    return techniques.reduce((total, technique) => {
      return total + (impacts[technique] || 0);
    }, 0);
  }

  // Public interface methods
  getTemplate(id: string): ContextTemplate | undefined {
    return this.templates.get(id);
  }

  getTemplatesByAgentType(agentType: string): ContextTemplate[] {
    return Array.from(this.templates.values())
      .filter(template => template.agentType === agentType);
  }

  addTemplate(template: ContextTemplate): void {
    this.templates.set(template.id, template);
    
    this.emit('template-added', {
      templateId: template.id,
      agentType: template.agentType,
      timestamp: new Date()
    });
  }
}

export class ContextEngineeringMaster extends EventEmitter {
  private layerManager: ContextLayerManager;
  private merger: ContextMerger;
  private requestHistory: Map<string, EngineeredContext[]> = new Map();

  constructor() {
    super();
    this.layerManager = new ContextLayerManager();
    this.merger = new ContextMerger();
    this.setupEventHandlers();
  }

  /**
   * Engineer optimal context for LLM request
   */
  async engineerContext(request: ContextRequest): Promise<EngineeredContext> {
    try {
      this.emit('engineering-started', {
        requestId: request.id,
        agentId: request.agentId,
        taskType: request.taskType,
        timestamp: new Date()
      });

      // Gather relevant context layers
      const layers = await this.gatherRelevantLayers(request);
      
      // Select appropriate template
      const template = await this.selectTemplate(request, layers);
      
      // Merge and optimize context
      const engineeredContext = await this.merger.mergeContext(layers, template, request.constraints);
      engineeredContext.requestId = request.id;
      
      // Store in history
      this.storeContextHistory(request.agentId, engineeredContext);
      
      this.emit('engineering-completed', {
        requestId: request.id,
        contextId: engineeredContext.id,
        tokenCount: engineeredContext.statistics.tokenCount,
        layersUsed: engineeredContext.layers.length,
        timestamp: new Date()
      });

      return engineeredContext;
    } catch (error: any) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.emit('error', { stage: 'context-engineering', error: errorMessage, requestId: request.id });
      throw error;
    }
  }

  /**
   * Gather relevant context layers for request
   */
  private async gatherRelevantLayers(request: ContextRequest): Promise<ContextLayer[]> {
    const layers: ContextLayer[] = [];

    // Required layers
    for (const layerId of request.requiredLayers) {
      const layer = this.layerManager.getLayer(layerId);
      if (layer) {
        layers.push(layer);
      }
    }

    // Optional layers
    for (const layerId of request.optionalLayers) {
      const layer = this.layerManager.getLayer(layerId);
      if (layer && layer.metadata.relevanceScore >= request.constraints.relevanceThreshold) {
        layers.push(layer);
      }
    }

    // Auto-detect relevant layers
    const autoLayers = await this.autoDetectRelevantLayers(request);
    layers.push(...autoLayers);

    // Remove duplicates
    const uniqueLayers = layers.filter((layer, index, self) => 
      index === self.findIndex(l => l.id === layer.id)
    );

    return uniqueLayers;
  }

  /**
   * Auto-detect relevant layers based on request content
   */
  private async autoDetectRelevantLayers(request: ContextRequest): Promise<ContextLayer[]> {
    const allLayers = this.layerManager.getAllLayers();
    const relevant: ContextLayer[] = [];

    for (const layer of allLayers) {
      const relevance = await this.calculateLayerRelevance(layer, request);
      if (relevance >= request.constraints.relevanceThreshold) {
        layer.metadata.relevanceScore = relevance;
        relevant.push(layer);
      }
    }

    return relevant;
  }

  /**
   * Calculate layer relevance to request
   */
  private async calculateLayerRelevance(layer: ContextLayer, request: ContextRequest): Promise<number> {
    let relevance = 0;

    // Type-based relevance
    if (request.metadata.projectId && layer.id.includes(request.metadata.projectId)) {
      relevance += 0.4;
    }
    
    if (request.metadata.userId && layer.id.includes(request.metadata.userId)) {
      relevance += 0.3;
    }

    if (request.metadata.sessionId && layer.id.includes(request.metadata.sessionId)) {
      relevance += 0.2;
    }

    // Content-based relevance
    const queryWords = request.query.toLowerCase().split(' ');
    const layerContent = JSON.stringify(layer.content).toLowerCase();
    
    const matches = queryWords.filter(word => layerContent.includes(word)).length;
    const contentRelevance = matches / queryWords.length;
    relevance += contentRelevance * 0.3;

    // Task type relevance
    if (layer.type === 'domain' && this.isTaskTypeDomainMatch(request.taskType, layer)) {
      relevance += 0.4;
    }

    // Priority bonus
    relevance += (layer.priority / 10) * 0.1;

    return Math.min(1, relevance);
  }

  /**
   * Check if task type matches domain layer
   */
  private isTaskTypeDomainMatch(taskType: string, layer: ContextLayer): boolean {
    const domainMappings: Record<string, string[]> = {
      'development': ['development-domain', 'coding-domain', 'software-domain'],
      'creative': ['creative-domain', 'content-domain', 'design-domain'],
      'business': ['business-domain', 'analytics-domain', 'strategy-domain']
    };

    const relevantDomains = domainMappings[taskType] || [];
    return relevantDomains.some(domain => layer.id.includes(domain));
  }

  /**
   * Select appropriate context template
   */
  private async selectTemplate(request: ContextRequest, layers: ContextLayer[]): Promise<ContextTemplate> {
    // Try to find specific template for agent type and task type
    const templates = this.merger.getTemplatesByAgentType(request.agentId.split('-')[1] || 'general');
    
    let selectedTemplate = templates.find(t => t.taskType === request.taskType);
    
    if (!selectedTemplate && templates.length > 0) {
      selectedTemplate = templates[0]; // Use first available template for agent type
    }

    if (!selectedTemplate) {
      // Create default template
      selectedTemplate = this.createDefaultTemplate(request);
    }

    return selectedTemplate;
  }

  /**
   * Create default template when no specific template exists
   */
  private createDefaultTemplate(request: ContextRequest): ContextTemplate {
    return {
      id: `default-${request.taskType}`,
      name: `Default ${request.taskType} Template`,
      agentType: 'general',
      taskType: request.taskType,
      structure: {
        introduction: `You are an AI agent specialized in ${request.taskType} tasks within the Jurexio orchestration system.`,
        contextSections: [
          {
            name: 'task_context',
            weight: 0.5,
            required: true,
            template: 'Task: {task_description}\nRequirements: {requirements}'
          },
          {
            name: 'system_context',
            weight: 0.3,
            required: true,
            template: 'System: {system_info}\nCapabilities: {capabilities}'
          },
          {
            name: 'user_context',
            weight: 0.2,
            required: false,
            template: 'User Preferences: {preferences}\nHistory: {history}'
          }
        ],
        constraints: 'Follow best practices and ensure quality output.',
        examples: 'Provide clear, accurate, and helpful responses.'
      },
      performance: {
        usage: 0,
        avgQuality: 0,
        avgTokens: 0
      }
    };
  }

  /**
   * Store context engineering history
   */
  private storeContextHistory(agentId: string, context: EngineeredContext): void {
    if (!this.requestHistory.has(agentId)) {
      this.requestHistory.set(agentId, []);
    }

    const history = this.requestHistory.get(agentId)!;
    history.push(context);

    // Keep only last 20 contexts per agent
    if (history.length > 20) {
      history.splice(0, history.length - 20);
    }
  }

  private setupEventHandlers(): void {
    // Forward events from child components
    [this.layerManager, this.merger].forEach(component => {
      component.on('error', (error) => this.emit('error', error));
    });

    // Context engineering logging with Jurexio logger
    this.on('engineering-completed', async (data) => {
      const { logger } = await import('../../utils/logger.js');
      // @ts-expect-error NV-TS230 legacy typing gap (TS2554)
      logger.info('context-engineering', 'Context engineered successfully', { 
        contextId: data.contextId,
        requestId: data.requestId,
        tokenCount: data.tokenCount,
        layersUsed: data.layersUsed
      });
    });

    this.on('error', async (error) => {
      const { logger } = await import('../../utils/logger.js');
      // @ts-expect-error NV-TS230 legacy typing gap (TS2554)
      logger.error('context-engineering', `Context engineering error in ${error.stage}`, { 
        error: error.error,
        stage: error.stage,
        requestId: error.requestId
      });
    });
  }

  // Public interface methods
  getLayerManager(): ContextLayerManager {
    return this.layerManager;
  }

  getMerger(): ContextMerger {
    return this.merger;
  }

  getContextHistory(agentId: string): EngineeredContext[] {
    return this.requestHistory.get(agentId) || [];
  }

  getEngineeringMetrics(): any {
    const allHistory = Array.from(this.requestHistory.values()).flat();
    const allLayers = this.layerManager.getAllLayers();

    return {
      totalContextsEngineered: allHistory.length,
      averageTokenCount: allHistory.reduce((sum, c) => sum + c.statistics.tokenCount, 0) / allHistory.length,
      averageCompressionRatio: allHistory.reduce((sum, c) => sum + c.statistics.compressionRatio, 0) / allHistory.length,
      averageRelevanceScore: allHistory.reduce((sum, c) => sum + c.statistics.relevanceScore, 0) / allHistory.length,
      averageProcessingTime: allHistory.reduce((sum, c) => sum + c.statistics.processingTime, 0) / allHistory.length,
      layers: {
        total: allLayers.length,
        byType: {
          project: allLayers.filter(l => l.type === 'project').length,
          user: allLayers.filter(l => l.type === 'user').length,
          session: allLayers.filter(l => l.type === 'session').length,
          global: allLayers.filter(l => l.type === 'global').length,
          domain: allLayers.filter(l => l.type === 'domain').length
        },
        averageRelevance: allLayers.reduce((sum, l) => sum + l.metadata.relevanceScore, 0) / allLayers.length
      },
      optimization: {
        averageTokensReduced: allHistory.reduce((sum, c) => sum + c.optimization.tokensReduced, 0) / allHistory.length,
        averageQualityImpact: allHistory.reduce((sum, c) => sum + c.optimization.qualityImpact, 0) / allHistory.length
      }
    };
  }
}

// Factory function for integration with Jurexio orchestration
export function createContextEngineer(): ContextEngineeringMaster {
  return new ContextEngineeringMaster();
}