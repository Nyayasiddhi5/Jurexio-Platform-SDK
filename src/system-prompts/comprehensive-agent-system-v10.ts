/**
 * Jurexio Comprehensive Agent System v10.0
 * 
 * Complete integration of all system prompt and workflow components for 267 agents:
 * - System prompts engine v10 (enhanced with 6 AI tool patterns)
 * - Agent workflow definitions
 * - Workflow generator
 * - Communication protocols
 * - Capability matrices  
 * - Agent selection logic
 * - Performance monitoring
 * 
 * This is the SINGLE SOURCE OF TRUTH for all agent operations in Jurexio Enterprise Platform SDK.
 * 
 * @version 10.0.0
 * @date November 22, 2025
 */

import { EventEmitter } from 'events';
import { JurexioSystemPromptsEngineV10, PromptContext } from './jurexio-system-prompts-engine-v10.js';
import { AgentWorkflowDefinition } from './agent-workflow-definitions-v10.js';
import { AgentWorkflowGenerator } from './agent-workflow-generator-v10.js';
import { createLogger } from '../utils/logger.js';


const logger = createLogger('comprehensive-agent-system-v10');

// ================================================================================================
// TYPE DEFINITIONS
// ================================================================================================

export interface ComprehensiveAgent {
  // Identity
  id: string;
  name: string;
  displayName: string;
  description: string;
  
  // Classification
  tier: 'executive' | 'development' | 'creative' | 'qa' | 'devops' | 'domain';
  romaLevel: 'L1' | 'L2' | 'L3' | 'L4';
  category: string;
  
  // Capabilities
  capabilities: string[];
  specialization: string;
  
  // Models & Performance
  preferredModels: string[];
  fallbackModels: string[];
  costOptimization: boolean;
  
  // System Prompts & Workflows
  systemPrompt: string;
  workflow: AgentWorkflowDefinition;
  
  // Status & Metrics
  status: 'active' | 'ready' | 'idle' | 'executing' | 'failed';
  version: string;
  lastUpdated: Date;
  performanceMetrics: AgentPerformanceMetrics;
}

export interface AgentPerformanceMetrics {
  totalExecutions: number;
  successfulExecutions: number;
  failedExecutions: number;
  avgExecutionTime: number;
  avgCost: number;
  qualityScore: number;
  userSatisfaction: number;
}

export interface CapabilityMatrix {
  capability: string;
  agentIds: string[];
  tools: string[];
  complexity: 'simple' | 'moderate' | 'complex' | 'expert';
  estimatedDuration: string;
  successRate: number;
}

export interface AgentSelectionCriteria {
  taskType: string;
  domain: string;
  complexity: 'simple' | 'moderate' | 'complex' | 'expert';
  requiredCapabilities: string[];
  preferredTier?: string;
  maxCost?: number;
  maxDuration?: number;
  qualityThreshold?: number;
}

export interface AgentSelectionResult {
  selectedAgent: ComprehensiveAgent;
  confidence: number;
  reasoning: string;
  alternatives: ComprehensiveAgent[];
  estimatedCost: number;
  estimatedDuration: number;
}

// ================================================================================================
// COMPREHENSIVE AGENT SYSTEM
// ================================================================================================

export class ComprehensiveAgentSystemV10 extends EventEmitter {
  private agents: Map<string, ComprehensiveAgent> = new Map();
  private capabilityMatrix: Map<string, CapabilityMatrix> = new Map();
  private systemPromptsEngine: JurexioSystemPromptsEngineV10;
  private workflowGenerator: AgentWorkflowGenerator;
  private initialized: boolean = false;

  constructor() {
    super();
    this.systemPromptsEngine = new JurexioSystemPromptsEngineV10();
    this.workflowGenerator = new AgentWorkflowGenerator();
    logger.info('🚀 Comprehensive Agent System v10.0 initialized');
  }

  /**
   * Initialize system with all 267 agents
   */
  public async initialize(agentProfiles: any[]): Promise<void> {
    logger.info(`\n${'='.repeat(80)}`);
    logger.info('🚀 INITIALIZING Jurexio COMPREHENSIVE AGENT SYSTEM V10.0');
    logger.info(`${'='.repeat(80)}\n`);
    
    logger.info(`📊 Loading ${agentProfiles.length} agent profiles...`);
    
    const startTime = Date.now();
    let loaded = 0;
    let failed = 0;

    // Process all agents
    for (const profile of agentProfiles) {
      try {
        const agent = await this.createComprehensiveAgent(profile);
        this.agents.set(agent.id, agent);
        loaded++;
        
        if (loaded % 50 === 0) {
          logger.info(`   ✅ Processed ${loaded}/${agentProfiles.length} agents...`);
        }
      } catch (error: any) {
        logger.error(`   ❌ Failed to load agent ${profile.id}:`, error);
        failed++;
      }
    }

    // Build capability matrix
    logger.info('\n📋 Building capability matrix...');
    this.buildCapabilityMatrix();

    const duration = Date.now() - startTime;
    this.initialized = true;

    logger.info(`\n${'='.repeat(80)}`);
    logger.info('✅ Jurexio COMPREHENSIVE AGENT SYSTEM INITIALIZATION COMPLETE');
    logger.info(`${'='.repeat(80)}`);
    logger.info(`\n📈 STATISTICS:`);
    logger.info(`   ✅ Successfully loaded: ${loaded} agents`);
    logger.info(`   ❌ Failed to load: ${failed} agents`);
    logger.info(`   ⏱️  Initialization time: ${duration}ms`);
    logger.info(`   🎯 Capability matrix: ${this.capabilityMatrix.size} capabilities`);
    logger.info(`   📊 System status: ${this.initialized ? 'READY' : 'ERROR'}\n`);

    // Emit initialization event
    this.emit('initialized', {
      totalAgents: loaded,
      failedAgents: failed,
      capabilities: this.capabilityMatrix.size,
      duration
    });
  }

  /**
   * Create comprehensive agent with full system prompt and workflow
   */
  private async createComprehensiveAgent(profile: any): Promise<ComprehensiveAgent> {
    // Generate system prompt
    const promptContext: PromptContext = {
      agentId: profile.id,
      taskType: this.inferTaskType(profile),
      domain: profile.category || 'general',
      complexity: this.inferComplexity(profile.romaLevel),
      language: 'en',
      tier: profile.tier,
      romaLevel: profile.romaLevel,
      tools: this.getAvailableTools(profile.tier, profile.capabilities)
    };

    const generatedPrompt = await this.systemPromptsEngine.generatePrompt(promptContext);

    // Generate workflow
    const workflow = this.workflowGenerator.generateWorkflow({
      id: profile.id,
      name: profile.name,
      tier: profile.tier,
      romaLevel: profile.romaLevel,
      category: profile.category,
      capabilities: profile.capabilities || [],
      model: profile.model,
      description: profile.description
    });

    // Create comprehensive agent
    return {
      id: profile.id,
      name: profile.name,
      displayName: profile.displayName || profile.name,
      description: profile.description || `${profile.name} agent`,
      tier: profile.tier,
      romaLevel: profile.romaLevel,
      category: profile.category || 'general',
      capabilities: profile.capabilities || [],
      specialization: profile.specialization || this.inferSpecialization(profile),
      preferredModels: profile.preferredModels || [profile.model || 'claude-3-5-sonnet-20241022'],
      fallbackModels: profile.fallbackModels || ['gpt-4o', 'gemini-2.0-flash-exp'],
      costOptimization: profile.costOptimization ?? true,
      systemPrompt: generatedPrompt.content,
      workflow,
      status: profile.status || 'ready',
      version: profile.version || '1.0.0',
      lastUpdated: new Date(),
      performanceMetrics: {
        totalExecutions: 0,
        successfulExecutions: 0,
        failedExecutions: 0,
        avgExecutionTime: 0,
        avgCost: 0,
        qualityScore: 0.9,
        userSatisfaction: 0.9
      }
    };
  }

  /**
   * Build capability matrix for intelligent agent selection
   */
  private buildCapabilityMatrix(): void {
    const capabilityMap = new Map<string, Set<string>>();

    // Collect all capabilities and their agents
    this.agents.forEach(agent => {
      // Add explicit capabilities from agent definition
      agent.capabilities.forEach(capability => {
        if (!capabilityMap.has(capability)) {
          capabilityMap.set(capability, new Set());
        }
        capabilityMap.get(capability)!.add(agent.id);
      });

      // Also add tool-based capabilities (baseline capabilities)
      const toolBasedCapabilities = this.inferCapabilitiesFromTools(agent.workflow.tools);
      toolBasedCapabilities.forEach(capability => {
        if (!capabilityMap.has(capability)) {
          capabilityMap.set(capability, new Set());
        }
        capabilityMap.get(capability)!.add(agent.id);
        
        // Ensure agent also has this capability in their list
        if (!agent.capabilities.includes(capability)) {
          agent.capabilities.push(capability);
        }
      });
    });

    // Build capability matrix
    capabilityMap.forEach((agentIds, capability) => {
      const agentsWithCapability = Array.from(agentIds).map(id => this.agents.get(id)!);
      const tools = this.getToolsForCapability(capability);
      const complexity = this.inferCapabilityComplexity(capability);
      
      this.capabilityMatrix.set(capability, {
        capability,
        agentIds: Array.from(agentIds),
        tools,
        complexity,
        estimatedDuration: this.estimateDurationForComplexity(complexity),
        successRate: this.calculateAverageSuccessRate(agentsWithCapability)
      });
    });

    logger.info(`   ✅ Built capability matrix with ${this.capabilityMatrix.size} unique capabilities`);
  }

  /**
   * Infer capabilities from available tools
   */
  private inferCapabilitiesFromTools(tools: string[] | any[]): string[] {
    const capabilities: string[] = [];
    
    // If tools array is empty or undefined, return empty capabilities
    if (!tools || tools.length === 0) {
      return capabilities;
    }
    
    // Extract tool names from objects or strings
    // Tools are objects with a 'toolName' property
    const toolNames = tools.map(t => {
      if (typeof t === 'string') return t;
      // Extract toolName property from tool objects
      return t.toolName || t.name || t.tool || t.id || String(t);
    });
    
    // Map tools to baseline capabilities
    if (toolNames.some(t => ['read', 'codebase-search', 'grep-search', 'ls', 'glob'].includes(t))) {
      capabilities.push('read');
    }
    if (toolNames.some(t => ['write', 'edit'].includes(t))) {
      capabilities.push('write');
    }
    if (toolNames.some(t => ['bash'].includes(t))) {
      capabilities.push('execute');
    }
    if (toolNames.some(t => ['architect'].includes(t))) {
      capabilities.push('review');
    }
    if (toolNames.some(t => ['web_search', 'web_fetch'].includes(t))) {
      capabilities.push('research');
    }
    
    return capabilities;
  }

  /**
   * Select optimal agent for a task
   */
  public selectAgent(criteria: AgentSelectionCriteria): AgentSelectionResult | null {
    if (!this.initialized) {
      logger.error('❌ System not initialized. Call initialize() first.');
      return null;
    }

    logger.info(`\n🔍 Selecting optimal agent for task: ${criteria.taskType}`);
    logger.info(`   📋 Required capabilities: ${criteria.requiredCapabilities.join(', ')}`);
    logger.info(`   ⚡ Complexity: ${criteria.complexity}`);

    // Filter agents by required capabilities
    let candidates = Array.from(this.agents.values()).filter(agent => {
      return criteria.requiredCapabilities.every(cap => 
        agent.capabilities.includes(cap)
      );
    });

    logger.info(`   ✅ Found ${candidates.length} candidates with required capabilities`);

    if (candidates.length === 0) {
      // Fallback: find agents with partial capability match
      candidates = Array.from(this.agents.values()).filter(agent => {
        const matchCount = criteria.requiredCapabilities.filter(cap =>
          agent.capabilities.includes(cap)
        ).length;
        return matchCount > 0;
      });
      
      logger.info(`   ⚠️  Fallback: Found ${candidates.length} agents with partial capability match`);
    }

    if (candidates.length === 0) {
      logger.error('   ❌ No suitable agents found');
      return null;
    }

    // Score agents
    const scoredAgents = candidates.map(agent => ({
      agent,
      score: this.scoreAgent(agent, criteria)
    })).sort((a, b) => b.score - a.score);

    const best = scoredAgents[0];
    const alternatives = scoredAgents.slice(1, 4).map(s => s.agent);

    logger.info(`\n   🎯 Selected: ${best.agent.name} (${best.agent.tier}, ${best.agent.romaLevel})`);
    logger.info(`   📊 Confidence: ${(best.score * 100).toFixed(1)}%`);
    logger.info(`   💰 Estimated cost: $${this.estimateCost(best.agent, criteria).toFixed(2)}`);
    logger.info(`   ⏱️  Estimated duration: ${this.estimateDuration(best.agent, criteria)}\n`);

    return {
      selectedAgent: best.agent,
      confidence: best.score,
      reasoning: this.generateSelectionReasoning(best.agent, criteria, best.score),
      alternatives,
      estimatedCost: this.estimateCost(best.agent, criteria),
      estimatedDuration: this.parseDuration(this.estimateDuration(best.agent, criteria))
    };
  }

  /**
   * Score agent for task suitability
   */
  private scoreAgent(agent: ComprehensiveAgent, criteria: AgentSelectionCriteria): number {
    let score = 0;
    let maxScore = 0;

    // Capability match (40% weight)
    const capabilityScore = criteria.requiredCapabilities.filter(cap =>
      agent.capabilities.includes(cap)
    ).length / criteria.requiredCapabilities.length;
    score += capabilityScore * 0.4;
    maxScore += 0.4;

    // Complexity match (20% weight)
    const complexityScore = this.getComplexityMatchScore(agent.romaLevel, criteria.complexity);
    score += complexityScore * 0.2;
    maxScore += 0.2;

    // Tier match (15% weight)
    if (criteria.preferredTier && agent.tier === criteria.preferredTier) {
      score += 0.15;
    } else if (!criteria.preferredTier) {
      score += 0.15; // No preference, full score
    }
    maxScore += 0.15;

    // Performance metrics (15% weight)
    const performanceScore = (agent.performanceMetrics.qualityScore * 0.5 +
                              agent.performanceMetrics.userSatisfaction * 0.5);
    score += performanceScore * 0.15;
    maxScore += 0.15;

    // Cost optimization (10% weight)
    if (criteria.maxCost) {
      const estimatedCost = this.estimateCost(agent, criteria);
      if (estimatedCost <= criteria.maxCost) {
        score += 0.1;
      }
    } else {
      score += 0.1; // No cost constraint, full score
    }
    maxScore += 0.1;

    return score / maxScore;
  }

  /**
   * Get complexity match score
   */
  private getComplexityMatchScore(romaLevel: string, complexity: string): number {
    const romaComplexityMap: Record<string, string> = {
      'L1': 'simple',
      'L2': 'moderate',
      'L3': 'complex',
      'L4': 'expert'
    };

    const agentComplexity = romaComplexityMap[romaLevel];
    
    if (agentComplexity === complexity) return 1.0;
    
    // Partial match
    const complexityLevels = ['simple', 'moderate', 'complex', 'expert'];
    const agentLevel = complexityLevels.indexOf(agentComplexity);
    const requiredLevel = complexityLevels.indexOf(complexity);
    const diff = Math.abs(agentLevel - requiredLevel);
    
    return Math.max(0, 1 - (diff * 0.25));
  }

  /**
   * Estimate cost for task
   */
  private estimateCost(agent: ComprehensiveAgent, criteria: AgentSelectionCriteria): number {
    const baseRates: Record<string, number> = {
      'L1': 0.3,
      'L2': 1.0,
      'L3': 3.0,
      'L4': 7.0
    };

    const complexityMultiplier: Record<string, number> = {
      'simple': 0.5,
      'moderate': 1.0,
      'complex': 2.0,
      'expert': 3.5
    };

    const baseCost = baseRates[agent.romaLevel] || 1.0;
    const multiplier = complexityMultiplier[criteria.complexity] || 1.0;

    return baseCost * multiplier;
  }

  /**
   * Estimate duration for task
   */
  private estimateDuration(agent: ComprehensiveAgent, criteria: AgentSelectionCriteria): string {
    const durationMap: Record<string, Record<string, string>> = {
      'L1': { simple: '5-10 min', moderate: '10-20 min', complex: '20-40 min', expert: '40-90 min' },
      'L2': { simple: '10-20 min', moderate: '20-45 min', complex: '45-90 min', expert: '90-180 min' },
      'L3': { simple: '15-30 min', moderate: '30-60 min', complex: '60-120 min', expert: '120-240 min' },
      'L4': { simple: '20-40 min', moderate: '40-90 min', complex: '90-180 min', expert: '180-360 min' }
    };

    return durationMap[agent.romaLevel]?.[criteria.complexity] || '30-60 min';
  }

  /**
   * Parse duration string to minutes
   */
  private parseDuration(duration: string): number {
    const match = duration.match(/(\d+)-(\d+)/);
    if (match) {
      const min = parseInt(match[1]);
      const max = parseInt(match[2]);
      return (min + max) / 2;
    }
    return 60; // Default 60 minutes
  }

  /**
   * Generate selection reasoning
   */
  private generateSelectionReasoning(
    agent: ComprehensiveAgent,
    criteria: AgentSelectionCriteria,
    score: number
  ): string {
    const reasons: string[] = [];

    // Capability match
    const capMatch = criteria.requiredCapabilities.filter(cap =>
      agent.capabilities.includes(cap)
    );
    reasons.push(`Matches ${capMatch.length}/${criteria.requiredCapabilities.length} required capabilities`);

    // Tier appropriateness
    reasons.push(`${agent.tier} tier appropriate for ${criteria.domain} domain`);

    // ROMA level
    reasons.push(`${agent.romaLevel} autonomy level suitable for ${criteria.complexity} complexity`);

    // Performance
    if (agent.performanceMetrics.qualityScore >= 0.9) {
      reasons.push(`High quality score: ${(agent.performanceMetrics.qualityScore * 100).toFixed(0)}%`);
    }

    // Cost optimization
    if (agent.costOptimization) {
      reasons.push('Cost-optimized with model fallbacks');
    }

    return reasons.join('; ');
  }

  // ================================================================================================
  // HELPER METHODS
  // ================================================================================================

  private inferTaskType(profile: any): string {
    if (profile.tier === 'executive') return 'strategic-planning';
    if (profile.tier === 'development') return 'development';
    if (profile.tier === 'creative') return 'content-creation';
    if (profile.tier === 'qa') return 'quality-assurance';
    if (profile.tier === 'devops') return 'infrastructure';
    return 'general-task';
  }

  private inferComplexity(romaLevel: string): 'simple' | 'moderate' | 'complex' | 'expert' {
    const map: Record<string, 'simple' | 'moderate' | 'complex' | 'expert'> = {
      'L1': 'simple',
      'L2': 'moderate',
      'L3': 'complex',
      'L4': 'expert'
    };
    return map[romaLevel] || 'moderate';
  }

  private inferSpecialization(profile: any): string {
    if (profile.category) return profile.category;
    if (profile.capabilities && profile.capabilities.length > 0) {
      return profile.capabilities[0];
    }
    return profile.tier;
  }

  private getAvailableTools(tier: string, capabilities: string[]): string[] {
    const baseTools: string[] = ['codebase-search', 'grep-search', 'read', 'ls', 'glob'];
    
    const tierTools: Record<string, string[]> = {
      'executive': ['web_search', 'web_fetch', 'write', 'architect'],
      'development': ['edit', 'write', 'bash', 'packager_tool', 'get_latest_lsp_diagnostics', 'architect'],
      'creative': ['write', 'stock_image_tool', 'generate_design_guidelines'],
      'qa': ['bash', 'refresh_all_logs', 'mark_completed_and_get_feedback'],
      'devops': ['bash', 'restart_workflow', 'set_env_vars', 'view_env_vars'],
      'domain': ['web_search', 'read', 'architect']
    };

    return [...baseTools, ...(tierTools[tier] || [])];
  }

  private getToolsForCapability(capability: string): string[] {
    const capabilityToolMap: Record<string, string[]> = {
      'api-design': ['read', 'edit', 'write', 'codebase-search'],
      'database-schema': ['read', 'edit', 'execute_sql_tool'],
      'testing': ['bash', 'write', 'refresh_all_logs'],
      'ui-design': ['generate_design_guidelines', 'stock_image_tool', 'write'],
      'kubernetes': ['bash', 'read', 'write']
    };

    return capabilityToolMap[capability] || ['read', 'write'];
  }

  private inferCapabilityComplexity(capability: string): 'simple' | 'moderate' | 'complex' | 'expert' {
    const complexityMap: Record<string, 'simple' | 'moderate' | 'complex' | 'expert'> = {
      'read': 'simple',
      'write': 'simple',
      'api-design': 'moderate',
      'database-schema': 'complex',
      'testing': 'moderate',
      'kubernetes': 'expert',
      'architecture': 'expert'
    };

    return complexityMap[capability] || 'moderate';
  }

  private estimateDurationForComplexity(complexity: string): string {
    const durationMap: Record<string, string> = {
      'simple': '5-15 min',
      'moderate': '15-45 min',
      'complex': '45-120 min',
      'expert': '120-240 min'
    };

    return durationMap[complexity] || '30-60 min';
  }

  private calculateAverageSuccessRate(agents: ComprehensiveAgent[]): number {
    if (agents.length === 0) return 0.9;
    
    const totalRate = agents.reduce((sum, agent) => {
      const total = agent.performanceMetrics.totalExecutions;
      if (total === 0) return sum + 0.9; // Default for new agents
      return sum + (agent.performanceMetrics.successfulExecutions / total);
    }, 0);

    return totalRate / agents.length;
  }

  // ================================================================================================
  // PUBLIC API
  // ================================================================================================

  public getAgent(agentId: string): ComprehensiveAgent | undefined {
    return this.agents.get(agentId);
  }

  public getAllAgents(): ComprehensiveAgent[] {
    return Array.from(this.agents.values());
  }

  public getAgentsByTier(tier: string): ComprehensiveAgent[] {
    return this.getAllAgents().filter(a => a.tier === tier);
  }

  public getAgentsByROMALevel(romaLevel: string): ComprehensiveAgent[] {
    return this.getAllAgents().filter(a => a.romaLevel === romaLevel);
  }

  public getAgentsByCapability(capability: string): ComprehensiveAgent[] {
    return this.getAllAgents().filter(a => a.capabilities.includes(capability));
  }

  public getCapabilityMatrix(): Map<string, CapabilityMatrix> {
    return this.capabilityMatrix;
  }

  public getSystemStats(): {
    totalAgents: number;
    byTier: Record<string, number>;
    byROMALevel: Record<string, number>;
    totalCapabilities: number;
    avgQualityScore: number;
  } {
    const agents = this.getAllAgents();
    const byTier: Record<string, number> = {};
    const byROMALevel: Record<string, number> = {};
    let totalQuality = 0;

    agents.forEach(agent => {
      byTier[agent.tier] = (byTier[agent.tier] || 0) + 1;
      byROMALevel[agent.romaLevel] = (byROMALevel[agent.romaLevel] || 0) + 1;
      totalQuality += agent.performanceMetrics.qualityScore;
    });

    return {
      totalAgents: agents.length,
      byTier,
      byROMALevel,
      totalCapabilities: this.capabilityMatrix.size,
      avgQualityScore: totalQuality / agents.length
    };
  }

  public isInitialized(): boolean {
    return this.initialized;
  }
}

// Export singleton instance
export const comprehensiveAgentSystem = new ComprehensiveAgentSystemV10();
