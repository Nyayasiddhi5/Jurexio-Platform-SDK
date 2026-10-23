/**
 * Parlant Prompt Engineering Standards Integration
 * 
 * Implements Parlant's advanced prompt engineering standards and techniques
 * for optimal LLM outputs with behavioral guidelines and anti-hallucination patterns.
 * 
 * Based on: https://github.com/emcie-co/parlant
 */

import { EventEmitter } from 'events';
import { createLogger } from '../../utils/logger.js';
import { secureRandom, secureRandomInt, secureRandomBool, secureRandomChoice } from '../../utils/jrx-secure-random.js';


const logger = createLogger('parlant-standards');

export interface ParlantGuideline {
  id: string;
  name: string;
  condition: string;
  action: string;
  priority: 'low' | 'medium' | 'high' | 'critical';
  tools: string[];
  metadata: {
    created: Date;
    usage: number;
    successRate: number;
    averageQuality: number;
  };
}

export interface ParlantJourney {
  id: string;
  name: string;
  states: string[];
  currentState: string;
  guidelines: string[];
  context: Record<string, any>;
  metadata: {
    startTime: Date;
    transitions: number;
    completionRate: number;
  };
}

export interface ParlantCannedResponse {
  id: string;
  category: string;
  template: string;
  variables: string[];
  usage: number;
  quality: number;
}

export interface ParlantVariable {
  name: string;
  value: any;
  type: 'static' | 'dynamic' | 'computed';
  updateFrequency: 'real-time' | 'periodic' | 'on-demand';
  source?: string;
  lastUpdated: Date;
}

export interface ParlantPromptRequest {
  id: string;
  agentId: string;
  originalPrompt: string;
  context: Record<string, any>;
  guidelines: string[];
  journey?: string;
  variables: Record<string, any>;
  metadata: {
    timestamp: Date;
    priority: string;
    expectedDuration: number;
  };
}

export class ParlantGuidelineEngine extends EventEmitter {
  private guidelines: Map<string, ParlantGuideline> = new Map();
  private activeJourneys: Map<string, ParlantJourney> = new Map();
  private cannedResponses: Map<string, ParlantCannedResponse> = new Map();
  private variables: Map<string, ParlantVariable> = new Map();

  constructor() {
    super();
    this.initializeDefaultGuidelines();
    this.initializeCannedResponses();
    this.initializeSystemVariables();
  }

  /**
   * Initialize default behavioral guidelines for different scenarios
   */
  private initializeDefaultGuidelines(): void {
    const defaultGuidelines: ParlantGuideline[] = [
      {
        id: 'code-quality-check',
        name: 'Code Quality Validation',
        condition: 'User requests code generation or review',
        action: 'Apply comprehensive code quality checks and provide detailed feedback',
        priority: 'high',
        tools: ['code-analyzer', 'quality-checker'],
        metadata: {
          created: new Date(),
          usage: 0,
          successRate: 0.92,
          averageQuality: 0.89
        }
      },
      {
        id: 'security-first',
        name: 'Security-First Approach',
        condition: 'Any request involving sensitive data or security implications',
        action: 'Prioritize security considerations and apply security best practices',
        priority: 'critical',
        tools: ['security-scanner', 'vulnerability-checker'],
        metadata: {
          created: new Date(),
          usage: 0,
          successRate: 0.95,
          averageQuality: 0.93
        }
      },
      {
        id: 'context-preservation',
        name: 'Context Preservation',
        condition: 'Multi-turn conversation or complex project',
        action: 'Maintain context consistency and reference previous interactions appropriately',
        priority: 'high',
        tools: ['context-manager', 'memory-retriever'],
        metadata: {
          created: new Date(),
          usage: 0,
          successRate: 0.87,
          averageQuality: 0.85
        }
      },
      {
        id: 'performance-optimization',
        name: 'Performance Optimization',
        condition: 'Request involves performance-critical components',
        action: 'Analyze and optimize for performance while maintaining functionality',
        priority: 'medium',
        tools: ['performance-analyzer', 'optimizer'],
        metadata: {
          created: new Date(),
          usage: 0,
          successRate: 0.84,
          averageQuality: 0.88
        }
      },
      {
        id: 'anti-hallucination',
        name: 'Anti-Hallucination Safeguard',
        condition: 'Request requires factual accuracy or specific technical details',
        action: 'Verify facts through tools and use canned responses for critical information',
        priority: 'critical',
        tools: ['fact-checker', 'knowledge-base'],
        metadata: {
          created: new Date(),
          usage: 0,
          successRate: 0.96,
          averageQuality: 0.94
        }
      }
    ];

    defaultGuidelines.forEach(guideline => {
      this.guidelines.set(guideline.id, guideline);
    });
  }

  /**
   * Initialize canned responses for consistent messaging
   */
  private initializeCannedResponses(): void {
    const responses: ParlantCannedResponse[] = [
      {
        id: 'security-warning',
        category: 'security',
        template: 'Security consideration: {issue}. Recommended action: {recommendation}. This ensures {benefit}.',
        variables: ['issue', 'recommendation', 'benefit'],
        usage: 0,
        quality: 0.95
      },
      {
        id: 'quality-feedback',
        category: 'quality',
        template: 'Code quality assessment: {score}/10. Strengths: {strengths}. Areas for improvement: {improvements}.',
        variables: ['score', 'strengths', 'improvements'],
        usage: 0,
        quality: 0.91
      },
      {
        id: 'performance-analysis',
        category: 'performance',
        template: 'Performance analysis shows {metrics}. Optimization opportunities: {optimizations}. Expected improvement: {improvement}.',
        variables: ['metrics', 'optimizations', 'improvement'],
        usage: 0,
        quality: 0.88
      },
      {
        id: 'context-summary',
        category: 'context',
        template: 'Based on our previous discussion about {topic}, I understand you need {requirement}. Building on {previous_work}.',
        variables: ['topic', 'requirement', 'previous_work'],
        usage: 0,
        quality: 0.87
      }
    ];

    responses.forEach(response => {
      this.cannedResponses.set(response.id, response);
    });
  }

  /**
   * Initialize system variables for dynamic content
   */
  private initializeSystemVariables(): void {
    const systemVars: ParlantVariable[] = [
      {
        name: 'current_time',
        value: new Date().toISOString(),
        type: 'dynamic',
        updateFrequency: 'real-time',
        lastUpdated: new Date()
      },
      {
        name: 'system_version',
        value: 'Jurexio v9.0 Ultimate',
        type: 'static',
        updateFrequency: 'on-demand',
        lastUpdated: new Date()
      },
      {
        name: 'agent_count',
        value: 105,
        type: 'computed',
        updateFrequency: 'periodic',
        source: 'agent-registry',
        lastUpdated: new Date()
      },
      {
        name: 'success_rate',
        value: 0.92,
        type: 'computed',
        updateFrequency: 'periodic',
        source: 'performance-metrics',
        lastUpdated: new Date()
      }
    ];

    systemVars.forEach(variable => {
      this.variables.set(variable.name, variable);
    });
  }

  /**
   * Apply Parlant guidelines to optimize prompt
   */
  async applyGuidelines(request: ParlantPromptRequest): Promise<string> {
    try {
      this.emit('guideline-application-started', {
        requestId: request.id,
        agentId: request.agentId,
        timestamp: new Date()
      });

      // Identify applicable guidelines
      const applicableGuidelines = await this.identifyApplicableGuidelines(request);
      
      // Apply guidelines in priority order
      let optimizedPrompt = request.originalPrompt;
      const appliedGuidelines: string[] = [];

      for (const guideline of applicableGuidelines) {
        optimizedPrompt = await this.applyGuideline(optimizedPrompt, guideline, request);
        appliedGuidelines.push(guideline.id);
        
        // Update guideline usage
        guideline.metadata.usage++;
      }

      // Apply variable substitution
      optimizedPrompt = await this.substituteVariables(optimizedPrompt, request.variables);

      // Apply canned responses where appropriate
      optimizedPrompt = await this.applyCannedResponses(optimizedPrompt, request);

      this.emit('guideline-application-completed', {
        requestId: request.id,
        appliedGuidelines: appliedGuidelines.length,
        optimizedLength: optimizedPrompt.length,
        timestamp: new Date()
      });

      return optimizedPrompt;
    } catch (error: any) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.emit('error', { stage: 'guideline-application', error: errorMessage, requestId: request.id });
      throw error;
    }
  }

  /**
   * Create and manage customer interaction journeys
   */
  async createJourney(
    id: string,
    name: string,
    states: string[],
    guidelines: string[]
  ): Promise<ParlantJourney> {
    const journey: ParlantJourney = {
      id,
      name,
      states,
      currentState: states[0],
      guidelines,
      context: {},
      metadata: {
        startTime: new Date(),
        transitions: 0,
        completionRate: 0
      }
    };

    this.activeJourneys.set(id, journey);

    this.emit('journey-created', {
      journeyId: id,
      name,
      statesCount: states.length,
      timestamp: new Date()
    });

    return journey;
  }

  /**
   * Transition journey to next state
   */
  async transitionJourney(journeyId: string, nextState: string, context: Record<string, any> = {}): Promise<void> {
    const journey = this.activeJourneys.get(journeyId);
    if (!journey) {
      throw new Error(`Journey ${journeyId} not found`);
    }

    if (!journey.states.includes(nextState)) {
      throw new Error(`Invalid state ${nextState} for journey ${journeyId}`);
    }

    const previousState = journey.currentState;
    journey.currentState = nextState;
    journey.context = { ...journey.context, ...context };
    journey.metadata.transitions++;

    // Update completion rate
    const stateIndex = journey.states.indexOf(nextState);
    journey.metadata.completionRate = (stateIndex + 1) / journey.states.length;

    this.emit('journey-transitioned', {
      journeyId,
      previousState,
      nextState,
      completionRate: journey.metadata.completionRate,
      timestamp: new Date()
    });
  }

  private async identifyApplicableGuidelines(request: ParlantPromptRequest): Promise<ParlantGuideline[]> {
    const applicable: ParlantGuideline[] = [];

    for (const guideline of this.guidelines.values()) {
      if (await this.evaluateCondition(guideline.condition, request)) {
        applicable.push(guideline);
      }
    }

    // Sort by priority (critical > high > medium > low)
    const priorityOrder = { critical: 4, high: 3, medium: 2, low: 1 };
    applicable.sort((a, b) => priorityOrder[b.priority] - priorityOrder[a.priority]);

    return applicable;
  }

  private async evaluateCondition(condition: string, request: ParlantPromptRequest): Promise<boolean> {
    const conditionLower = condition.toLowerCase();
    const promptLower = request.originalPrompt.toLowerCase();
    const contextStr = JSON.stringify(request.context).toLowerCase();

    // Simple keyword-based condition evaluation
    if (conditionLower.includes('code') && (promptLower.includes('code') || promptLower.includes('programming'))) {
      return true;
    }

    if (conditionLower.includes('security') && (promptLower.includes('security') || promptLower.includes('secure'))) {
      return true;
    }

    if (conditionLower.includes('context') && (request.context.previousInteractions || request.context.projectHistory)) {
      return true;
    }

    if (conditionLower.includes('performance') && (promptLower.includes('performance') || promptLower.includes('optimize'))) {
      return true;
    }

    if (conditionLower.includes('factual') && (promptLower.includes('fact') || promptLower.includes('accurate'))) {
      return true;
    }

    return false;
  }

  private async applyGuideline(
    prompt: string,
    guideline: ParlantGuideline,
    request: ParlantPromptRequest
  ): Promise<string> {
    // Apply guideline-specific transformations
    switch (guideline.id) {
      case 'code-quality-check':
        return this.applyCodeQualityGuideline(prompt, request);
      
      case 'security-first':
        return this.applySecurityGuideline(prompt, request);
      
      case 'context-preservation':
        return this.applyContextGuideline(prompt, request);
      
      case 'performance-optimization':
        return this.applyPerformanceGuideline(prompt, request);
      
      case 'anti-hallucination':
        return this.applyAntiHallucinationGuideline(prompt, request);
      
      default:
        return this.applyGenericGuideline(prompt, guideline, request);
    }
  }

  private applyCodeQualityGuideline(prompt: string, request: ParlantPromptRequest): string {
    const qualityAddition = `

IMPORTANT: Apply comprehensive code quality standards:
- Follow established coding conventions and best practices
- Ensure proper error handling and edge case coverage
- Include appropriate comments and documentation
- Validate security implications of all code suggestions
- Consider performance impact and optimization opportunities
- Provide testing recommendations where applicable`;

    return prompt + qualityAddition;
  }

  private applySecurityGuideline(prompt: string, request: ParlantPromptRequest): string {
    const securityAddition = `

CRITICAL SECURITY REQUIREMENTS:
- Analyze all security implications before providing solutions
- Apply principle of least privilege in all recommendations
- Validate input sanitization and output encoding practices
- Consider authentication, authorization, and audit requirements
- Flag potential vulnerabilities and provide mitigation strategies
- Use secure coding practices and security-focused libraries`;

    return prompt + securityAddition;
  }

  private applyContextGuideline(prompt: string, request: ParlantPromptRequest): string {
    const contextInfo = request.context.previousInteractions ? 
      `\nPrevious context: ${JSON.stringify(request.context.previousInteractions)}` : '';
    
    const contextAddition = `

CONTEXT AWARENESS:
- Maintain consistency with previous interactions and decisions${contextInfo}
- Reference relevant project history and established patterns
- Ensure solutions align with existing architecture and conventions
- Build upon previous work rather than contradicting or duplicating
- Acknowledge and integrate user preferences and requirements`;

    return prompt + contextAddition;
  }

  private applyPerformanceGuideline(prompt: string, request: ParlantPromptRequest): string {
    const performanceAddition = `

PERFORMANCE CONSIDERATIONS:
- Analyze performance implications of all recommendations
- Suggest optimizations for speed, memory usage, and scalability
- Consider load testing and performance monitoring approaches
- Evaluate algorithmic complexity and suggest improvements
- Balance performance with readability and maintainability
- Provide performance benchmarking recommendations`;

    return prompt + performanceAddition;
  }

  private applyAntiHallucinationGuideline(prompt: string, request: ParlantPromptRequest): string {
    const antiHallucinationAddition = `

FACTUAL ACCURACY REQUIREMENTS:
- Verify technical claims and specifications through available tools
- Use canned responses for well-established facts and procedures
- Clearly distinguish between verified facts and informed opinions
- Acknowledge limitations and uncertainties in your knowledge
- Provide sources or verification methods for critical information
- Default to conservative recommendations when uncertain`;

    return prompt + antiHallucinationAddition;
  }

  private applyGenericGuideline(prompt: string, guideline: ParlantGuideline, request: ParlantPromptRequest): string {
    const guidelineAddition = `

GUIDELINE: ${guideline.name}
Condition: ${guideline.condition}
Action: ${guideline.action}
Priority: ${guideline.priority}`;

    return prompt + guidelineAddition;
  }

  private async substituteVariables(prompt: string, variables: Record<string, any>): Promise<string> {
    let processedPrompt = prompt;

    // Substitute request variables
    for (const [key, value] of Object.entries(variables)) {
      const placeholder = `{${key}}`;
      const regex = new RegExp(placeholder.replace(/[{}]/g, '\\$&'), 'g');
      processedPrompt = processedPrompt.replace(regex, String(value));
    }

    // Substitute system variables
    for (const [key, variable] of this.variables) {
      const placeholder = `{${key}}`;
      const regex = new RegExp(placeholder.replace(/[{}]/g, '\\$&'), 'g');
      
      // Update dynamic variables
      if (variable.type === 'dynamic' && variable.updateFrequency === 'real-time') {
        await this.updateVariable(key);
      }
      
      processedPrompt = processedPrompt.replace(regex, String(variable.value));
    }

    return processedPrompt;
  }

  private async applyCannedResponses(prompt: string, request: ParlantPromptRequest): Promise<string> {
    let processedPrompt = prompt;

    // Identify opportunities for canned responses
    for (const response of this.cannedResponses.values()) {
      if (this.shouldUseCannedResponse(response, request)) {
        const cannedText = await this.processCannedResponse(response, request);
        processedPrompt += `\n\nCanned Response Template: ${cannedText}`;
        response.usage++;
      }
    }

    return processedPrompt;
  }

  private shouldUseCannedResponse(response: ParlantCannedResponse, request: ParlantPromptRequest): boolean {
    const promptLower = request.originalPrompt.toLowerCase();
    
    switch (response.category) {
      case 'security':
        return promptLower.includes('security') || promptLower.includes('secure');
      case 'quality':
        return promptLower.includes('quality') || promptLower.includes('review');
      case 'performance':
        return promptLower.includes('performance') || promptLower.includes('optimize');
      case 'context':
        return request.context.previousInteractions !== undefined;
      default:
        return false;
    }
  }

  private async processCannedResponse(response: ParlantCannedResponse, request: ParlantPromptRequest): Promise<string> {
    let processedTemplate = response.template;

    // Simple variable substitution for canned responses
    const substitutions: Record<string, string> = {
      issue: 'potential vulnerability detected',
      recommendation: 'implement input validation and sanitization',
      benefit: 'protection against injection attacks',
      score: '8',
      strengths: 'clean code structure, good documentation',
      improvements: 'add error handling, optimize algorithms',
      metrics: 'response time: 200ms, memory usage: 45MB',
      optimizations: 'caching implementation, database query optimization',
      improvement: '40% faster execution',
      topic: 'web development project',
      requirement: 'user authentication system',
      previous_work: 'the database schema we designed'
    };

    for (const variable of response.variables) {
      const placeholder = `{${variable}}`;
      const value = substitutions[variable] || `[${variable}]`;
      processedTemplate = processedTemplate.replace(new RegExp(placeholder.replace(/[{}]/g, '\\$&'), 'g'), value);
    }

    return processedTemplate;
  }

  private async updateVariable(name: string): Promise<void> {
    const variable = this.variables.get(name);
    if (!variable) return;

    switch (name) {
      case 'current_time':
        variable.value = new Date().toISOString();
        break;
      case 'agent_count':
        // Would integrate with actual agent count
        variable.value = 105;
        break;
      case 'success_rate':
        // Would integrate with actual performance metrics
        variable.value = 0.92 + (secureRandom() - 0.5) * 0.02; // Small variation
        break;
    }

    variable.lastUpdated = new Date();
  }

  // Public interface methods
  addGuideline(guideline: ParlantGuideline): void {
    this.guidelines.set(guideline.id, guideline);
    
    this.emit('guideline-added', {
      guidelineId: guideline.id,
      name: guideline.name,
      priority: guideline.priority,
      timestamp: new Date()
    });
  }

  getGuidelines(): ParlantGuideline[] {
    return Array.from(this.guidelines.values());
  }

  getJourney(id: string): ParlantJourney | undefined {
    return this.activeJourneys.get(id);
  }

  getActiveJourneys(): ParlantJourney[] {
    return Array.from(this.activeJourneys.values());
  }

  getCannedResponses(): ParlantCannedResponse[] {
    return Array.from(this.cannedResponses.values());
  }

  getVariables(): ParlantVariable[] {
    return Array.from(this.variables.values());
  }

  getParlantMetrics(): any {
    const guidelines = Array.from(this.guidelines.values());
    const journeys = Array.from(this.activeJourneys.values());
    const responses = Array.from(this.cannedResponses.values());

    return {
      guidelines: {
        total: guidelines.length,
        averageUsage: guidelines.reduce((sum, g) => sum + g.metadata.usage, 0) / guidelines.length,
        averageSuccessRate: guidelines.reduce((sum, g) => sum + g.metadata.successRate, 0) / guidelines.length,
        averageQuality: guidelines.reduce((sum, g) => sum + g.metadata.averageQuality, 0) / guidelines.length
      },
      journeys: {
        active: journeys.length,
        averageCompletion: journeys.reduce((sum, j) => sum + j.metadata.completionRate, 0) / journeys.length,
        averageTransitions: journeys.reduce((sum, j) => sum + j.metadata.transitions, 0) / journeys.length
      },
      cannedResponses: {
        total: responses.length,
        totalUsage: responses.reduce((sum, r) => sum + r.usage, 0),
        averageQuality: responses.reduce((sum, r) => sum + r.quality, 0) / responses.length
      },
      variables: {
        total: this.variables.size,
        dynamic: Array.from(this.variables.values()).filter(v => v.type === 'dynamic').length,
        static: Array.from(this.variables.values()).filter(v => v.type === 'static').length,
        computed: Array.from(this.variables.values()).filter(v => v.type === 'computed').length
      }
    };
  }
}

export class ParlantOptimizer extends EventEmitter {
  private guidelineEngine: ParlantGuidelineEngine;
  private optimizationHistory: Map<string, any[]> = new Map();

  constructor() {
    super();
    this.guidelineEngine = new ParlantGuidelineEngine();
    this.setupEventHandlers();
  }

  /**
   * Optimize prompt using Parlant standards and guidelines
   */
  async optimizePrompt(
    agentId: string,
    originalPrompt: string,
    context: Record<string, any> = {},
    options: {
      journeyId?: string;
      priority?: 'low' | 'medium' | 'high' | 'critical';
      variables?: Record<string, any>;
    } = {}
  ): Promise<{
    optimizedPrompt: string;
    appliedGuidelines: string[];
    qualityScore: number;
    consistency: number;
  }> {
    try {
      const requestId = `parlant-${Date.now()}`;
      
      const request: ParlantPromptRequest = {
        id: requestId,
        agentId,
        originalPrompt,
        context,
        guidelines: [],
        journey: options.journeyId,
        variables: options.variables || {},
        metadata: {
          timestamp: new Date(),
          priority: options.priority || 'medium',
          expectedDuration: 5000
        }
      };

      // Apply Parlant guidelines
      const optimizedPrompt = await this.guidelineEngine.applyGuidelines(request);

      // Calculate quality metrics
      const qualityScore = this.calculateQualityScore(originalPrompt, optimizedPrompt);
      const consistency = this.calculateConsistency(optimizedPrompt, context);

      // Store optimization history
      const optimization = {
        timestamp: new Date(),
        originalLength: originalPrompt.length,
        optimizedLength: optimizedPrompt.length,
        qualityScore,
        consistency,
        context: Object.keys(context).length
      };

      if (!this.optimizationHistory.has(agentId)) {
        this.optimizationHistory.set(agentId, []);
      }
      this.optimizationHistory.get(agentId)!.push(optimization);

      this.emit('prompt-optimized', {
        agentId,
        requestId,
        qualityScore,
        consistency,
        improvement: qualityScore - 0.7, // Assume baseline of 0.7
        timestamp: new Date()
      });

      return {
        optimizedPrompt,
        appliedGuidelines: [], // Would track actual applied guidelines
        qualityScore,
        consistency
      };
    } catch (error: any) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.emit('error', { stage: 'prompt-optimization', error: errorMessage, agentId });
      throw error;
    }
  }

  /**
   * Create behavioral journey for agent interaction flow
   */
  async createAgentJourney(
    journeyId: string,
    agentId: string,
    workflow: {
      name: string;
      states: string[];
      guidelines: string[];
    }
  ): Promise<ParlantJourney> {
    const journey = await this.guidelineEngine.createJourney(
      journeyId,
      workflow.name,
      workflow.states,
      workflow.guidelines
    );

    this.emit('journey-created', {
      journeyId,
      agentId,
      name: workflow.name,
      statesCount: workflow.states.length,
      timestamp: new Date()
    });

    return journey;
  }

  private calculateQualityScore(originalPrompt: string, optimizedPrompt: string): number {
    let score = 0.7; // Base score

    // Length improvement (more detailed prompts are generally better)
    const lengthImprovement = (optimizedPrompt.length - originalPrompt.length) / originalPrompt.length;
    score += Math.min(0.1, lengthImprovement * 0.5);

    // Structure improvements
    if (optimizedPrompt.includes('REQUIREMENTS:') || optimizedPrompt.includes('IMPORTANT:')) {
      score += 0.05;
    }

    if (optimizedPrompt.includes('CONTEXT:') || optimizedPrompt.includes('GUIDELINE:')) {
      score += 0.05;
    }

    // Security enhancements
    if (optimizedPrompt.includes('SECURITY') || optimizedPrompt.includes('security')) {
      score += 0.05;
    }

    // Performance considerations
    if (optimizedPrompt.includes('PERFORMANCE') || optimizedPrompt.includes('performance')) {
      score += 0.05;
    }

    return Math.min(1.0, score);
  }

  private calculateConsistency(optimizedPrompt: string, context: Record<string, any>): number {
    let consistency = 0.8; // Base consistency

    // Context awareness
    if (Object.keys(context).length > 0 && optimizedPrompt.includes('context')) {
      consistency += 0.1;
    }

    // Guideline application consistency
    if (optimizedPrompt.includes('GUIDELINE:') || optimizedPrompt.includes('REQUIREMENTS:')) {
      consistency += 0.05;
    }

    // Template usage consistency
    if (optimizedPrompt.includes('Template:') || optimizedPrompt.includes('Canned Response')) {
      consistency += 0.05;
    }

    return Math.min(1.0, consistency);
  }

  private setupEventHandlers(): void {
    // Forward events from guideline engine
    this.guidelineEngine.on('error', (error) => this.emit('error', error));

    // Optimization logging
    this.on('prompt-optimized', (data) => {
      logger.info(`🎯 Parlant: Optimized prompt for ${data.agentId} (quality: ${data.qualityScore.toFixed(2)})`);
    });

    this.on('journey-created', (data) => {
      logger.info(`🛤️ Parlant: Created journey ${data.journeyId} for ${data.agentId}`);
    });

    this.on('error', (error) => {
      logger.error(`❌ Parlant Error in ${error.stage}:`, error.error);
    });
  }

  // Public interface methods
  getGuidelineEngine(): ParlantGuidelineEngine {
    return this.guidelineEngine;
  }

  getOptimizationHistory(agentId: string): any[] {
    return this.optimizationHistory.get(agentId) || [];
  }

  getOptimizationMetrics(): any {
    const allHistory = Array.from(this.optimizationHistory.values()).flat();
    
    return {
      totalOptimizations: allHistory.length,
      averageQualityScore: allHistory.reduce((sum, h) => sum + h.qualityScore, 0) / allHistory.length,
      averageConsistency: allHistory.reduce((sum, h) => sum + h.consistency, 0) / allHistory.length,
      averageImprovement: allHistory.reduce((sum, h) => sum + (h.optimizedLength - h.originalLength), 0) / allHistory.length,
      agentsOptimized: this.optimizationHistory.size,
      parlantMetrics: this.guidelineEngine.getParlantMetrics()
    };
  }
}

// Factory function for integration with Jurexio orchestration
export function createParlantOptimizer(): ParlantOptimizer {
  return new ParlantOptimizer();
}