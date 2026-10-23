// JRX-NS-021 (2026-05-05): pre-existing TS errors (gateway runs via tsx).
/**
 * MCP Prompt Server
 * Manages prompt templates, optimization, and versioning
 */

import { PromptTemplate, PromptVariable, PromptMetadata } from './types.js';

export interface PromptVersion {
  version: string;
  template: string;
  variables: PromptVariable[];
  metadata: PromptMetadata;
  createdAt: Date;
  performance?: {
    averageTokens: number;
    averageLatency: number;
    successRate: number;
    usageCount: number;
  };
}

export interface PromptOptimizationResult {
  original: string;
  optimized: string;
  tokenReduction: number;
  improvements: string[];
}

/**
 * MCP Prompt Server
 * Production-ready prompt management system
 */
export class MCPPromptServer {
  private templates = new Map<string, PromptTemplate>();
  private versions = new Map<string, PromptVersion[]>(); // prompt_id -> versions
  private activeVersions = new Map<string, string>(); // prompt_id -> version
  
  /**
   * Register a new prompt template
   */
  register(template: PromptTemplate): void {
    // Validate template
    this.validateTemplate(template);
    
    // Normalize variables to PromptVariable[] if they're strings
    const normalizedVariables: PromptVariable[] = Array.isArray(template.variables)
      ? template.variables.map((v) =>
          typeof v === 'string'
            ? { name: v, required: false }
            : v
        )
      : [];
    
    // Store template with normalized variables
    this.templates.set(template.id, {
      ...template,
      variables: normalizedVariables,
      metadata: template.metadata || {},
    });
    
    // Create initial version
    const version: PromptVersion = {
      version: '1.0.0',
      template: template.template,
      variables: normalizedVariables,
      metadata: template.metadata || {},
      createdAt: new Date(),
    };
    
    // Store version
    const existingVersions = this.versions.get(template.id) || [];
    existingVersions.push(version);
    this.versions.set(template.id, existingVersions);
    
    // Set as active version
    this.activeVersions.set(template.id, '1.0.0');
  }
  
  /**
   * Get prompt template by ID
   */
  get(id: string): PromptTemplate | undefined {
    return this.templates.get(id);
  }
  
  /**
   * List all prompt templates
   */
  list(): PromptTemplate[] {
    return Array.from(this.templates.values());
  }
  
  /**
   * List all prompt templates in legacy format (with string[] variables)
   * Used for backward compatibility with older clients
   */
  listLegacy(): PromptTemplate[] {
    const templates = Array.from(this.templates.values());
    
    return templates.map(template => ({
      ...template,
      variables: (template.variables as Array<{ name: string }>).map(v => v.name), // Convert PromptVariable[] to string[]
    }));
  }
  
  /**
   * Render prompt with variables
   */
  render(id: string, variables: Record<string, any>): string {
    const template = this.templates.get(id);
    if (!template) {
      throw new Error(`Prompt template not found: ${id}`);
    }
    
    // Get active version
    const activeVersion = this.activeVersions.get(id) || '1.0.0';
    const versions = this.versions.get(id) || [];
    const version = versions.find(v => v.version === activeVersion);
    
    if (!version) {
      throw new Error(`Active version not found: ${activeVersion}`);
    }
    
    // Validate required variables
    for (const varDef of version.variables) {
      if (varDef.required && !(varDef.name in variables)) {
        throw new Error(`Required variable missing: ${varDef.name}`);
      }
    }
    
    // Render template
    let rendered = version.template;
    
    // Replace variables with simple interpolation
    for (const [key, value] of Object.entries(variables)) {
      const placeholder = new RegExp(`{{\\s*${key}\\s*}}`, 'g');
      rendered = rendered.replace(placeholder, String(value));
    }
    
    // Track usage
    this.trackUsage(id, activeVersion, rendered);
    
    return rendered;
  }
  
  /**
   * Create new version of prompt template
   */
  createVersion(
    id: string,
    template: string,
    variables: PromptVariable[],
    version: string
  ): void {
    const existingTemplate = this.templates.get(id);
    if (!existingTemplate) {
      throw new Error(`Prompt template not found: ${id}`);
    }
    
    // Create new version
    const newVersion: PromptVersion = {
      version,
      template,
      variables,
      metadata: existingTemplate.metadata || {},
      createdAt: new Date(),
    };
    
    // Store version
    const existingVersions = this.versions.get(id) || [];
    existingVersions.push(newVersion);
    this.versions.set(id, existingVersions);
    
    // Update template
    this.templates.set(id, {
      ...existingTemplate,
      template,
      variables,
    });
  }
  
  /**
   * Set active version for a prompt
   */
  setActiveVersion(id: string, version: string): void {
    const versions = this.versions.get(id) || [];
    const versionExists = versions.some(v => v.version === version);
    
    if (!versionExists) {
      throw new Error(`Version not found: ${version}`);
    }
    
    this.activeVersions.set(id, version);
  }
  
  /**
   * Get all versions of a prompt
   */
  getVersions(id: string): PromptVersion[] {
    return this.versions.get(id) || [];
  }
  
  /**
   * Optimize prompt for token efficiency
   */
  optimize(prompt: string): PromptOptimizationResult {
    const improvements: string[] = [];
    let optimized = prompt;
    
    // 1. Remove excessive whitespace
    const beforeWhitespace = optimized.length;
    optimized = optimized.replace(/\s+/g, ' ').trim();
    if (optimized.length < beforeWhitespace) {
      improvements.push('Removed excessive whitespace');
    }
    
    // 2. Remove redundant phrases
    const redundantPhrases = [
      'please ', 'kindly ', 'would you ', 'could you ',
      'I would like you to ', 'I need you to ', 'Can you ',
    ];
    
    for (const phrase of redundantPhrases) {
      const beforeRedundant = optimized.length;
      optimized = optimized.replace(new RegExp(phrase, 'gi'), '');
      if (optimized.length < beforeRedundant) {
        improvements.push(`Removed redundant phrase: "${phrase}"`);
      }
    }
    
    // 3. Simplify common patterns
    const simplifications = [
      { from: /in order to/gi, to: 'to' },
      { from: /due to the fact that/gi, to: 'because' },
      { from: /at this point in time/gi, to: 'now' },
      { from: /in the event that/gi, to: 'if' },
      { from: /make a decision/gi, to: 'decide' },
    ];
    
    for (const { from, to } of simplifications) {
      const beforeSimplify = optimized.length;
      optimized = optimized.replace(from, to);
      if (optimized.length < beforeSimplify) {
        improvements.push(`Simplified: "${from.source}" → "${to}"`);
      }
    }
    
    // 4. Calculate token reduction (rough estimate: 1 token ≈ 4 characters)
    const originalTokens = Math.ceil(prompt.length / 4);
    const optimizedTokens = Math.ceil(optimized.length / 4);
    const tokenReduction = ((originalTokens - optimizedTokens) / originalTokens) * 100;
    
    return {
      original: prompt,
      optimized: optimized.trim(),
      tokenReduction: Math.round(tokenReduction),
      improvements,
    };
  }
  
  /**
   * A/B test two prompt versions
   */
  startABTest(
    id: string,
    versionA: string,
    versionB: string,
    trafficSplit: number = 0.5
  ): void {
    // In production, this would route traffic between versions
    // For now, we'll just track which version is active
    const versions = this.versions.get(id) || [];
    const hasVersionA = versions.some(v => v.version === versionA);
    const hasVersionB = versions.some(v => v.version === versionB);
    
    if (!hasVersionA || !hasVersionB) {
      throw new Error('One or both versions not found for A/B testing');
    }
    
    // Set version A as active (in production, would use traffic split)
    this.setActiveVersion(id, versionA);
  }
  
  /**
   * Get prompt performance metrics
   */
  getPerformanceMetrics(id: string, version?: string): PromptVersion['performance'] {
    const versions = this.versions.get(id) || [];
    const targetVersion = version || this.activeVersions.get(id) || '1.0.0';
    const versionData = versions.find(v => v.version === targetVersion);
    
    return versionData?.performance;
  }
  
  /**
   * Validate prompt template
   */
  private validateTemplate(template: PromptTemplate): void {
    if (!template.id) {
      throw new Error('Prompt template must have an id');
    }
    
    if (!template.template) {
      throw new Error('Prompt template must have a template string');
    }
    
    // Extract variables from template
    const variablePattern = /{{\\s*([\\w]+)\\s*}}/g;
    const matches = Array.from(template.template.matchAll(variablePattern));
    const templateVars = new Set(matches.map(m => m[1]));
    
    // Check all variables are defined
    const definedVars = new Set((template.variables as Array<{ name: string }>).map(v => v.name));
    
    for (const templateVar of templateVars) {
      if (!definedVars.has(templateVar)) {
        throw new Error(`Variable used in template but not defined: ${templateVar}`);
      }
    }
  }
  
  /**
   * Track prompt usage for performance metrics
   */
  private trackUsage(id: string, version: string, rendered: string): void {
    const versions = this.versions.get(id) || [];
    const versionData = versions.find(v => v.version === version);
    
    if (!versionData) return;
    
    // Initialize performance if not exists
    if (!versionData.performance) {
      versionData.performance = {
        averageTokens: 0,
        averageLatency: 0,
        successRate: 100,
        usageCount: 0,
      };
    }
    
    // Update usage count
    versionData.performance.usageCount++;
    
    // Update average tokens (rough estimate)
    const tokens = Math.ceil(rendered.length / 4);
    versionData.performance.averageTokens =
      (versionData.performance.averageTokens * (versionData.performance.usageCount - 1) + tokens) /
      versionData.performance.usageCount;
  }
}
