/**
 * Prompt Enhancement Pipeline
 * Unified prompt enhancer with context injection, role specification, and output format optimization
 */

import { EventEmitter } from 'events';
import { createLogger } from '../utils/logger.js';


const logger = createLogger('prompt-enhancement-pipeline');

export interface PromptEnhancementConfig {
  enableContextInjection: boolean;
  enableRoleSpecification: boolean;
  enableOutputOptimization: boolean;
  enableChainOfThought: boolean;
  enableExamples: boolean;
  maxContextLength: number;
  language: string;
  tone: 'professional' | 'casual' | 'technical' | 'friendly' | 'authoritative';
  verbosity: 'concise' | 'detailed' | 'comprehensive';
}

export interface EnhancementContext {
  sessionId?: string;
  userId?: string;
  agentId?: string;
  teamId?: string;
  previousMessages?: { role: string; content: string }[];
  domainContext?: string;
  userPreferences?: Record<string, unknown>;
  taskHistory?: { task: string; outcome: string }[];
  knowledgeBase?: string[];
  constraints?: string[];
}

export interface PromptEnhancementInput {
  originalPrompt: string;
  role?: string;
  task?: string;
  context?: EnhancementContext;
  outputFormat?: OutputFormat;
  examples?: Example[];
  config?: Partial<PromptEnhancementConfig>;
}

export interface OutputFormat {
  type: 'json' | 'markdown' | 'text' | 'code' | 'structured' | 'custom';
  schema?: Record<string, unknown>;
  template?: string;
  sections?: string[];
}

export interface Example {
  input: string;
  output: string;
  explanation?: string;
}

export interface EnhancedPrompt {
  prompt: string;
  systemPrompt: string;
  metadata: {
    originalLength: number;
    enhancedLength: number;
    enhancements: string[];
    estimatedTokens: number;
    complexity: number;
    qualityScore: number;
  };
}

export interface PromptQualityMetrics {
  clarity: number;
  specificity: number;
  completeness: number;
  coherence: number;
  actionability: number;
  overall: number;
}

const DEFAULT_CONFIG: PromptEnhancementConfig = {
  enableContextInjection: true,
  enableRoleSpecification: true,
  enableOutputOptimization: true,
  enableChainOfThought: false,
  enableExamples: true,
  maxContextLength: 4000,
  language: 'en',
  tone: 'professional',
  verbosity: 'detailed'
};

export class PromptEnhancementPipeline extends EventEmitter {
  private static instance: PromptEnhancementPipeline;
  private config: PromptEnhancementConfig;
  private enhancementHistory: Map<string, EnhancedPrompt[]> = new Map();

  private constructor(config: Partial<PromptEnhancementConfig> = {}) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
    logger.info('✨ PromptEnhancementPipeline initialized');
  }

  public static getInstance(config?: Partial<PromptEnhancementConfig>): PromptEnhancementPipeline {
    if (!PromptEnhancementPipeline.instance) {
      PromptEnhancementPipeline.instance = new PromptEnhancementPipeline(config);
    }
    return PromptEnhancementPipeline.instance;
  }

  public async enhance(input: PromptEnhancementInput): Promise<EnhancedPrompt> {
    const mergedConfig = { ...this.config, ...input.config };
    const enhancements: string[] = [];
    let enhancedPrompt = input.originalPrompt;
    let systemPrompt = '';

    if (mergedConfig.enableRoleSpecification && input.role) {
      systemPrompt = this.buildRoleSpecification(input.role, mergedConfig);
      enhancements.push('role-specification');
    }

    if (mergedConfig.enableContextInjection && input.context) {
      const contextBlock = this.buildContextBlock(input.context, mergedConfig);
      enhancedPrompt = this.injectContext(enhancedPrompt, contextBlock);
      enhancements.push('context-injection');
    }

    if (mergedConfig.enableOutputOptimization && input.outputFormat) {
      enhancedPrompt = this.addOutputFormatting(enhancedPrompt, input.outputFormat);
      enhancements.push('output-optimization');
    }

    if (mergedConfig.enableChainOfThought) {
      enhancedPrompt = this.addChainOfThought(enhancedPrompt);
      enhancements.push('chain-of-thought');
    }

    if (mergedConfig.enableExamples && input.examples && input.examples.length > 0) {
      enhancedPrompt = this.addExamples(enhancedPrompt, input.examples);
      enhancements.push('examples');
    }

    enhancedPrompt = this.applyToneAndVerbosity(enhancedPrompt, mergedConfig);
    enhancements.push('tone-verbosity');

    const result: EnhancedPrompt = {
      prompt: enhancedPrompt,
      systemPrompt,
      metadata: {
        originalLength: input.originalPrompt.length,
        enhancedLength: enhancedPrompt.length + systemPrompt.length,
        enhancements,
        estimatedTokens: this.estimateTokens(enhancedPrompt + systemPrompt),
        complexity: this.calculateComplexity(input),
        qualityScore: this.assessQuality(enhancedPrompt, systemPrompt)
      }
    };

    this.emit('prompt-enhanced', result);
    
    if (input.context?.sessionId) {
      const history = this.enhancementHistory.get(input.context.sessionId) || [];
      history.push(result);
      this.enhancementHistory.set(input.context.sessionId, history);
    }

    return result;
  }

  private buildRoleSpecification(role: string, config: PromptEnhancementConfig): string {
    const rolePrompts: Record<string, string> = {
      'developer': `You are an expert software developer with deep knowledge of modern programming languages, frameworks, and best practices. You write clean, maintainable, and well-documented code.`,
      'architect': `You are a senior software architect specializing in system design, scalability, and enterprise patterns. You provide strategic technical guidance and design robust solutions.`,
      'analyst': `You are a data analyst with expertise in data processing, visualization, and statistical analysis. You extract insights and present findings clearly.`,
      'writer': `You are a professional content writer skilled in creating engaging, clear, and impactful content across various formats and styles.`,
      'researcher': `You are a thorough researcher with expertise in information gathering, synthesis, and analysis. You verify sources and present findings objectively.`,
      'manager': `You are an experienced project manager skilled in planning, coordination, and delivery. You communicate clearly and track progress effectively.`,
      'designer': `You are a creative designer with expertise in user experience, visual design, and brand consistency. You create intuitive and aesthetically pleasing solutions.`,
      'security': `You are a security specialist with expertise in vulnerability assessment, encryption, and compliance. You identify risks and recommend mitigations.`
    };

    let systemPrompt = rolePrompts[role.toLowerCase()] || `You are a skilled ${role} with expertise in your domain.`;

    const toneDescriptions: Record<string, string> = {
      'professional': 'Maintain a professional and business-appropriate tone.',
      'casual': 'Use a friendly, conversational tone while remaining helpful.',
      'technical': 'Be precise and technically detailed in your explanations.',
      'friendly': 'Be warm, approachable, and encouraging in your responses.',
      'authoritative': 'Be confident and decisive in your guidance.'
    };

    const verbosityDescriptions: Record<string, string> = {
      'concise': 'Be brief and to the point.',
      'detailed': 'Provide thorough explanations with relevant details.',
      'comprehensive': 'Give exhaustive coverage with all relevant information.'
    };

    systemPrompt += `\n\n${toneDescriptions[config.tone]}`;
    systemPrompt += `\n${verbosityDescriptions[config.verbosity]}`;

    return systemPrompt;
  }

  private buildContextBlock(context: EnhancementContext, config: PromptEnhancementConfig): string {
    const parts: string[] = [];

    if (context.domainContext) {
      parts.push(`Domain Context: ${context.domainContext}`);
    }

    if (context.previousMessages && context.previousMessages.length > 0) {
      const recentMessages = context.previousMessages.slice(-5);
      parts.push('Recent Conversation:');
      for (const msg of recentMessages) {
        parts.push(`${msg.role}: ${msg.content.substring(0, 200)}${msg.content.length > 200 ? '...' : ''}`);
      }
    }

    if (context.taskHistory && context.taskHistory.length > 0) {
      const recentTasks = context.taskHistory.slice(-3);
      parts.push('Previous Tasks:');
      for (const task of recentTasks) {
        parts.push(`- ${task.task}: ${task.outcome}`);
      }
    }

    if (context.knowledgeBase && context.knowledgeBase.length > 0) {
      parts.push('Relevant Knowledge:');
      for (const knowledge of context.knowledgeBase.slice(0, 5)) {
        parts.push(`- ${knowledge}`);
      }
    }

    if (context.constraints && context.constraints.length > 0) {
      parts.push('Constraints:');
      for (const constraint of context.constraints) {
        parts.push(`- ${constraint}`);
      }
    }

    if (context.userPreferences && Object.keys(context.userPreferences).length > 0) {
      parts.push('User Preferences:');
      for (const [key, value] of Object.entries(context.userPreferences)) {
        parts.push(`- ${key}: ${JSON.stringify(value)}`);
      }
    }

    let contextBlock = parts.join('\n');
    
    if (contextBlock.length > config.maxContextLength) {
      contextBlock = contextBlock.substring(0, config.maxContextLength) + '\n[Context truncated]';
    }

    return contextBlock;
  }

  private injectContext(prompt: string, contextBlock: string): string {
    if (!contextBlock) return prompt;
    return `Context:\n${contextBlock}\n\nRequest:\n${prompt}`;
  }

  private addOutputFormatting(prompt: string, format: OutputFormat): string {
    let formatInstruction = '';

    switch (format.type) {
      case 'json':
        formatInstruction = 'Please provide your response as valid JSON.';
        if (format.schema) {
          formatInstruction += `\nExpected schema: ${JSON.stringify(format.schema)}`;
        }
        break;
      case 'markdown':
        formatInstruction = 'Format your response in Markdown with appropriate headers, lists, and code blocks.';
        break;
      case 'code':
        formatInstruction = 'Provide your response as code with appropriate comments and documentation.';
        break;
      case 'structured':
        formatInstruction = 'Organize your response with clear sections and bullet points.';
        if (format.sections && format.sections.length > 0) {
          formatInstruction += `\nInclude these sections: ${format.sections.join(', ')}`;
        }
        break;
      case 'custom':
        if (format.template) {
          formatInstruction = `Follow this output template:\n${format.template}`;
        }
        break;
      default:
        formatInstruction = 'Provide a clear, well-organized response.';
    }

    return `${prompt}\n\n${formatInstruction}`;
  }

  private addChainOfThought(prompt: string): string {
    return `${prompt}\n\nPlease think through this step by step:\n1. First, understand what is being asked\n2. Break down the problem into smaller parts\n3. Address each part systematically\n4. Synthesize your findings\n5. Provide your final answer`;
  }

  private addExamples(prompt: string, examples: Example[]): string {
    let exampleBlock = '\nExamples:\n';
    
    for (let i = 0; i < examples.length; i++) {
      const ex = examples[i];
      exampleBlock += `\nExample ${i + 1}:\nInput: ${ex.input}\nOutput: ${ex.output}`;
      if (ex.explanation) {
        exampleBlock += `\nExplanation: ${ex.explanation}`;
      }
    }

    return `${prompt}${exampleBlock}\n\nNow, please handle the following:`;
  }

  private applyToneAndVerbosity(prompt: string, config: PromptEnhancementConfig): string {
    return prompt;
  }

  private estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }

  private calculateComplexity(input: PromptEnhancementInput): number {
    let complexity = 0.3;

    if (input.context?.previousMessages && input.context.previousMessages.length > 3) {
      complexity += 0.1;
    }

    if (input.examples && input.examples.length > 0) {
      complexity += 0.1;
    }

    if (input.outputFormat && input.outputFormat.type !== 'text') {
      complexity += 0.1;
    }

    if (input.originalPrompt.length > 500) {
      complexity += 0.1;
    }

    if (input.context?.constraints && input.context.constraints.length > 3) {
      complexity += 0.1;
    }

    return Math.min(complexity, 1);
  }

  private assessQuality(prompt: string, systemPrompt: string): number {
    let score = 0.5;

    if (prompt.length > 100) score += 0.1;
    if (prompt.includes('step') || prompt.includes('1.')) score += 0.1;
    if (systemPrompt.length > 50) score += 0.1;
    if (prompt.includes('please') || prompt.includes('Please')) score += 0.05;
    if (prompt.length < 2000) score += 0.1;

    return Math.min(score, 1);
  }

  public analyzePromptQuality(prompt: string): PromptQualityMetrics {
    const wordCount = prompt.split(/\s+/).length;
    const sentenceCount = prompt.split(/[.!?]+/).filter(s => s.trim()).length;
    const hasStructure = /\d\.|[-•]/.test(prompt);
    const hasSpecificTerms = /please|must|should|will|specific|exactly/i.test(prompt);
    const hasActionVerbs = /create|build|analyze|write|develop|design|implement/i.test(prompt);

    return {
      clarity: Math.min((sentenceCount / wordCount) * 50 + 0.3, 1),
      specificity: hasSpecificTerms ? 0.8 : 0.5,
      completeness: Math.min(wordCount / 100, 1),
      coherence: hasStructure ? 0.8 : 0.6,
      actionability: hasActionVerbs ? 0.9 : 0.5,
      overall: 0
    };
  }

  public getEnhancementHistory(sessionId: string): EnhancedPrompt[] {
    return this.enhancementHistory.get(sessionId) || [];
  }

  public clearHistory(sessionId?: string): void {
    if (sessionId) {
      this.enhancementHistory.delete(sessionId);
    } else {
      this.enhancementHistory.clear();
    }
  }

  public updateConfig(config: Partial<PromptEnhancementConfig>): void {
    this.config = { ...this.config, ...config };
    this.emit('config-updated', this.config);
  }

  public getConfig(): PromptEnhancementConfig {
    return { ...this.config };
  }
}

export const promptEnhancementPipeline = PromptEnhancementPipeline.getInstance();
