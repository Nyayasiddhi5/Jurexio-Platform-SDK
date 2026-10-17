/**
 * Runtime Agent Factory v9.0
 * 
 * Phase 2.1: On-demand agent creation with role, skills, and compliance constraints
 * 
 * Features:
 * - Dynamic agent creation at runtime
 * - Agent Personality DNA system with customizable traits
 * - Skill-based agent composition
 * - Compliance and security constraint enforcement
 * - Cross-agent learning and knowledge transfer
 */

import { EventEmitter } from 'events';
import { randomUUID as uuidv4 } from 'crypto';
import type { 
  AgentDefinitionV9, 
  AdvancedMemoryConfig, 
  CollaborationProtocol, 
  EnterpriseFeatures,
  JurexioOrchestrationConfigV9
} from './jurexio-orchestration-core-v9.js';
/**
 * Structural typing of the storage facade the runtime factory depends on.
 * Declared inline so this module stays loosely coupled to the storage
 * implementation, but with a real contract instead of an `any` escape.
 */
interface IStorage {
  createAgent(agent: AgentDefinitionV9): Promise<AgentDefinitionV9>;
  getAgent(id: string): Promise<AgentDefinitionV9 | undefined>;
  getAllAgents(): Promise<AgentDefinitionV9[]>;
  updateAgent(id: string, updates: Partial<AgentDefinitionV9>): Promise<AgentDefinitionV9 | undefined>;
  retireAgent(id: string): Promise<boolean>;
}
import { createLogger } from '../utils/logger.js';


const logger = createLogger('runtime-agent-factory');

// Class will be exported at definition

// ================================================================================================
// RUNTIME AGENT CREATION INTERFACES
// ================================================================================================

export interface AgentCreationRequest {
  name: string;
  type: 'orchestrator' | 'manager' | 'engineer' | 'specialist' | 'creative' | 'hybrid';
  industry: string;
  role: string;
  personality: AgentPersonalityDNA;
  skills: SkillRequirement[];
  constraints: AgentConstraints;
  collaborationSettings: CollaborationSettings;
  customizations?: AgentCustomizations;
  /**
   * JRX-RUNTIME-MANIFEST-001 (round 10e): per-agent tier + jurisdiction
   * gating used to publish the manifest's per-tier capability subset on
   * the new agent. When omitted the factory defaults to the most
   * conservative surface (`lite` / `'all'`) so callers cannot
   * accidentally over-expose capabilities.
   */
  tier?: 'lite' | 'mitra' | 'enterprise' | 'sovereign' | 'white-label';
  jurisdiction?: string;
}

export interface AgentPersonalityDNA {
  id: string;
  name: string;
  traits: PersonalityTraits;
  communicationStyle: CommunicationStyle;
  workingStyle: WorkingStyle;
  expertise: ExpertiseProfile;
  memoryConfiguration: MemoryPersonalization;
  behavioralPatterns: BehavioralPattern[];
}

export interface PersonalityTraits {
  creativity: number; // 0-1
  analytical: number; // 0-1
  collaborative: number; // 0-1
  detail_oriented: number; // 0-1
  leadership: number; // 0-1
  adaptability: number; // 0-1
  risk_tolerance: number; // 0-1
  innovation: number; // 0-1
}

export interface CommunicationStyle {
  tone: 'professional' | 'casual' | 'technical' | 'friendly' | 'authoritative' | 'adaptive';
  verbosity: 'concise' | 'detailed' | 'comprehensive' | 'adaptive';
  formality: 'formal' | 'informal' | 'business-casual' | 'adaptive';
  responsePattern: 'immediate' | 'thoughtful' | 'collaborative' | 'analytical';
  languagePreferences: string[];
  culturalAdaptation: string[];
}

export interface WorkingStyle {
  planningApproach: 'systematic' | 'agile' | 'iterative' | 'emergent';
  decisionMaking: 'decisive' | 'consultative' | 'consensus' | 'analytical';
  problemSolving: 'logical' | 'creative' | 'systematic' | 'intuitive';
  timeManagement: 'structured' | 'flexible' | 'deadline-driven' | 'flow-based';
  qualityFocus: 'perfectionist' | 'pragmatic' | 'iterative' | 'good-enough';
  learningStyle: 'experiential' | 'theoretical' | 'social' | 'reflective';
}

export interface ExpertiseProfile {
  primaryDomain: string;
  secondaryDomains: string[];
  certifications: string[];
  experienceLevel: 'junior' | 'mid' | 'senior' | 'expert' | 'thought-leader';
  specializations: string[];
  knowledgeDepth: Record<string, number>; // domain -> depth (0-1)
  continuousLearning: boolean;
  mentorshipCapability: boolean;
}

export interface MemoryPersonalization {
  retentionStrategy: 'comprehensive' | 'selective' | 'contextual' | 'adaptive';
  priorityFactors: string[];
  forgettingPattern: 'gradual' | 'threshold' | 'relevance-based' | 'time-based';
  crossContextLearning: boolean;
  emotionalMemory: boolean;
  patternRecognition: boolean;
}

export interface BehavioralPattern {
  trigger: string;
  condition: string;
  action: string;
  priority: number;
  adaptable: boolean;
}

export interface SkillRequirement {
  skillId: string;
  skillName: string;
  proficiencyLevel: 'beginner' | 'intermediate' | 'advanced' | 'expert' | 'master';
  importance: 'nice-to-have' | 'preferred' | 'required' | 'critical';
  tools: string[];
  certifications?: string[];
  dependencies?: string[];
}

export interface AgentConstraints {
  security: SecurityConstraints;
  compliance: ComplianceConstraints;
  operational: OperationalConstraints;
  ethical: EthicalConstraints;
  resource: ResourceConstraints;
}

export interface SecurityConstraints {
  clearanceLevel: 'public' | 'internal' | 'confidential' | 'secret' | 'top-secret';
  dataAccessLevel: 'read-only' | 'read-write' | 'admin' | 'super-admin';
  encryptionRequired: boolean;
  auditTrailRequired: boolean;
  accessLogRetention: number; // days
  permittedNetworks: string[];
  blockedDomains: string[];
}

export interface ComplianceConstraints {
  frameworks: string[]; // GDPR, HIPAA, SOX, etc.
  dataResidency: string[];
  retentionPolicies: Record<string, number>;
  anonymizationRequired: boolean;
  consentManagement: boolean;
  rightToBeDeleted: boolean;
}

export interface OperationalConstraints {
  maxConcurrentTasks: number;
  maxMemoryUsage: number; // MB
  maxExecutionTime: number; // seconds
  allowedTimeWindows: TimeWindow[];
  maintenanceSchedule: MaintenanceWindow[];
  failoverSettings: FailoverConfiguration;
}

export interface EthicalConstraints {
  principles: string[];
  biasCheckingEnabled: boolean;
  fairnessMetrics: string[];
  transparencyLevel: 'opaque' | 'basic' | 'detailed' | 'full';
  explanabilityRequired: boolean;
  humanOversightRequired: boolean;
}

export interface ResourceConstraints {
  computeAllocation: ComputeAllocation;
  storageAllocation: StorageAllocation;
  networkAllocation: NetworkAllocation;
  costLimits: CostLimits;
}

export interface TimeWindow {
  start: string; // HH:MM
  end: string; // HH:MM
  timezone: string;
  days: string[]; // Mon, Tue, etc.
}

export interface MaintenanceWindow {
  start: Date;
  end: Date;
  type: 'planned' | 'emergency' | 'routine';
  description: string;
}

export interface FailoverConfiguration {
  enabled: boolean;
  backupAgents: string[];
  failoverThreshold: number;
  recoveryStrategy: 'restart' | 'migrate' | 'scale' | 'delegate';
}

export interface ComputeAllocation {
  cpuCores: number;
  memoryGB: number;
  gpuUnits?: number;
  quantumUnits?: number;
}

export interface StorageAllocation {
  persistentGB: number;
  temporaryGB: number;
  cacheGB: number;
  backupGB: number;
}

export interface NetworkAllocation {
  bandwidthMbps: number;
  connectionsMax: number;
  regionsAllowed: string[];
  priorityLevel: 'low' | 'normal' | 'high' | 'critical';
}

export interface CostLimits {
  hourlyLimit: number;
  dailyLimit: number;
  monthlyLimit: number;
  currency: string;
  alertThresholds: number[];
}

export interface CollaborationSettings {
  teamwork: TeamworkConfiguration;
  communication: CommunicationConfiguration;
  leadership: LeadershipConfiguration;
  learning: LearningConfiguration;
}

export interface TeamworkConfiguration {
  preferredTeamSize: number;
  leadershipStyle: 'directive' | 'participative' | 'delegative' | 'adaptive';
  conflictResolution: 'avoidance' | 'accommodation' | 'compromise' | 'collaboration' | 'competition';
  trustLevel: number; // 0-1
  sharingWillingness: number; // 0-1
}

export interface CommunicationConfiguration {
  protocols: string[];
  frequencies: Record<string, string>; // protocol -> frequency
  escalationRules: EscalationRule[];
  broadcastCapability: boolean;
  multicastCapability: boolean;
}

export interface LeadershipConfiguration {
  canLead: boolean;
  leadershipDomains: string[];
  decisionAuthority: string[];
  mentorshipCapability: boolean;
  delegationStyle: 'hands-on' | 'hands-off' | 'situational';
}

export interface LearningConfiguration {
  crossAgentLearning: boolean;
  knowledgeSharing: boolean;
  feedbackAcceptance: boolean;
  adaptationRate: number; // 0-1
  specialtyExpansion: boolean;
}

export interface EscalationRule {
  condition: string;
  targetAgent: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  timeoutSeconds: number;
}

export interface AgentCustomizations {
  avatar?: AvatarConfiguration;
  ui?: UICustomizations;
  integrations?: IntegrationPreferences;
  automation?: AutomationRules;
}

export interface AvatarConfiguration {
  style: 'professional' | 'casual' | 'technical' | 'creative' | 'custom';
  appearance: string;
  voice?: VoiceSettings;
  gestures?: string[];
}

export interface VoiceSettings {
  language: string;
  accent: string;
  speed: number; // 0.5-2.0
  pitch: number; // 0.5-2.0
  volume: number; // 0-1
}

export interface UICustomizations {
  theme: string;
  layout: string;
  shortcuts: Record<string, string>;
  widgets: string[];
}

export interface IntegrationPreferences {
  preferredTools: string[];
  apiKeys: Record<string, string>;
  webhooks: WebhookConfiguration[];
  dataConnections: DataConnectionConfiguration[];
}

export interface WebhookConfiguration {
  url: string;
  events: string[];
  authentication: string;
  retryPolicy: RetryPolicy;
}

export interface DataConnectionConfiguration {
  type: string;
  connectionString: string;
  credentials: string;
  refreshInterval: number;
}

export interface RetryPolicy {
  maxRetries: number;
  backoffStrategy: 'linear' | 'exponential' | 'custom';
  timeoutSeconds: number;
}

export interface AutomationRules {
  triggers: AutomationTrigger[];
  workflows: AutomationWorkflow[];
  schedules: AutomationSchedule[];
}

export interface AutomationTrigger {
  id: string;
  name: string;
  condition: string;
  action: string;
  enabled: boolean;
}

export interface AutomationWorkflow {
  id: string;
  name: string;
  steps: WorkflowStep[];
  errorHandling: string;
}

export interface WorkflowStep {
  id: string;
  type: string;
  configuration: Record<string, any>;
  dependencies: string[];
}

export interface AutomationSchedule {
  id: string;
  name: string;
  cronExpression: string;
  action: string;
  enabled: boolean;
}

export interface AgentCreationResult {
  agent: AgentDefinitionV9;
  deploymentInfo: DeploymentInfo;
  healthCheck: HealthCheckResult;
  recommendations: string[];
}

export interface DeploymentInfo {
  deploymentId: string;
  timestamp: Date;
  region: string;
  resources: AllocatedResources;
  status: 'deploying' | 'active' | 'failed' | 'terminated';
}

export interface AllocatedResources {
  compute: ComputeAllocation;
  storage: StorageAllocation;
  network: NetworkAllocation;
  estimatedCost: CostEstimate;
}

export interface CostEstimate {
  hourly: number;
  daily: number;
  monthly: number;
  currency: string;
}

export interface HealthCheckResult {
  status: 'healthy' | 'warning' | 'critical';
  checks: HealthCheck[];
  score: number; // 0-100
  recommendations: string[];
}

export interface HealthCheck {
  name: string;
  status: 'pass' | 'fail' | 'warn';
  message: string;
  details?: any;
}

// ================================================================================================
// RUNTIME AGENT FACTORY
// ================================================================================================

export class RuntimeAgentFactory extends EventEmitter {
  private activeAgents: Map<string, AgentDefinitionV9> = new Map();
  private agentTemplates: Map<string, Partial<AgentDefinitionV9>> = new Map();
  private skillRegistry: Map<string, SkillDefinition> = new Map();
  private personalityTemplates: Map<string, AgentPersonalityDNA> = new Map();
  private deploymentHistory: Map<string, DeploymentInfo> = new Map();
  private crossLearningNetwork: Map<string, string[]> = new Map(); // agent -> learned from
  private readonly version: string = '1.0.0';
  private storage: IStorage;
  private coreConfig: JurexioOrchestrationConfigV9;

  constructor(config: { coreConfig: JurexioOrchestrationConfigV9; storage: IStorage }) {
    super();
    this.storage = config.storage;
    this.coreConfig = config.coreConfig;
    logger.info('🚀 Runtime Agent Factory v9.0 initializing with storage integration...');
    this.initializeTemplates();
    this.initializeSkillRegistry();
    this.initializePersonalityTemplates();
    this.startCrossLearningMonitoring();
  }

  /**
   * Create a new agent at runtime with full customization
   */
  public async createAgent(request: AgentCreationRequest): Promise<AgentCreationResult> {
    logger.info(`🤖 Creating runtime agent: ${request.name} (${request.type})`);

    try {
      // Step 1: Validate request
      await this.validateCreationRequest(request);

      // Step 2: Generate agent DNA and capabilities
      const agentDNA = await this.synthesizeAgentDNA(request);

      // Step 3: Build agent definition
      const agentDefinition = await this.buildAgentDefinition(request, agentDNA);

      // Step 4: Deploy and allocate resources
      const deploymentInfo = await this.deployAgent(agentDefinition, request.constraints);

      // Step 5: Health check and validation
      const healthCheck = await this.performHealthCheck(agentDefinition);

      // Step 6: Register for cross-learning
      await this.registerForCrossLearning(agentDefinition, request.skills);

      // Step 7: Generate recommendations
      const recommendations = await this.generateOptimizationRecommendations(agentDefinition, request);

      const result: AgentCreationResult = {
        agent: agentDefinition,
        deploymentInfo,
        healthCheck,
        recommendations
      };

      // Register active agent in memory and storage
      this.activeAgents.set(agentDefinition.id, agentDefinition);
      await this.storage.createAgent(agentDefinition);

      logger.info(`✅ Agent ${request.name} created successfully (ID: ${agentDefinition.id})`);
      this.emit('agent:created', result);

      return result;

    } catch (error: any) {
      logger.error('❌ Agent creation failed:', error instanceof Error ? error.message : String(error));
      throw error;
    }
  }

  /**
   * Initialize agent templates for common types
   */
  private initializeTemplates(): void {
    const templates: Record<string, Partial<AgentDefinitionV9>> = {
      'senior-developer': {
        type: 'engineer',
        industry: 'software-development',
        expertise: ['full-stack-development', 'architecture', 'code-review', 'mentoring'],
        tools: ['vscode', 'git', 'docker', 'kubernetes', 'ci-cd'],
        capabilities: ['code-generation', 'debugging', 'optimization', 'testing'],
        selfHealingConfig: {
          maxRetries: 3,
          healingStrategies: ['restart', 'alternative-approach', 'escalation'],
          conflictResolutionLevel: 4
        }
      },
      'creative-writer': {
        type: 'creative',
        industry: 'content-creation',
        expertise: ['copywriting', 'storytelling', 'brand-voice', 'seo'],
        tools: ['word-processor', 'grammar-checker', 'seo-tools', 'analytics'],
        capabilities: ['content-generation', 'editing', 'research', 'optimization'],
        selfHealingConfig: {
          maxRetries: 2,
          healingStrategies: ['alternative-style', 'research-update'],
          conflictResolutionLevel: 2
        }
      },
      'data-analyst': {
        type: 'specialist',
        industry: 'data-science',
        expertise: ['statistical-analysis', 'machine-learning', 'visualization', 'reporting'],
        tools: ['python', 'r', 'sql', 'tableau', 'jupyter'],
        capabilities: ['data-analysis', 'modeling', 'prediction', 'visualization'],
        selfHealingConfig: {
          maxRetries: 5,
          healingStrategies: ['recompute', 'alternative-model', 'data-validation'],
          conflictResolutionLevel: 3
        }
      },
      'project-manager': {
        type: 'manager',
        industry: 'universal',
        expertise: ['project-planning', 'team-coordination', 'risk-management', 'communication'],
        tools: ['project-management', 'collaboration', 'reporting', 'scheduling'],
        capabilities: ['planning', 'coordination', 'monitoring', 'communication'],
        selfHealingConfig: {
          maxRetries: 3,
          healingStrategies: ['re-plan', 'escalation', 'team-rebalance'],
          conflictResolutionLevel: 5
        }
      }
    };

    Object.entries(templates).forEach(([key, template]) => {
      this.agentTemplates.set(key, template);
    });

    logger.info(`📋 Initialized ${Object.keys(templates).length} agent templates`);
  }

  /**
   * Initialize skill registry with predefined skills
   */
  private initializeSkillRegistry(): void {
    const skills: SkillDefinition[] = [
      {
        id: 'python-programming',
        name: 'Python Programming',
        category: 'programming',
        description: 'Proficiency in Python programming language',
        prerequisites: ['basic-programming'],
        tools: ['python', 'pip', 'venv', 'pytest'],
        learningPath: ['syntax', 'data-structures', 'oop', 'frameworks'],
        assessmentCriteria: ['syntax-knowledge', 'problem-solving', 'best-practices'],
        difficultyLevel: 'intermediate'
      },
      {
        id: 'machine-learning',
        name: 'Machine Learning',
        category: 'ai-ml',
        description: 'Understanding and application of ML algorithms',
        prerequisites: ['python-programming', 'statistics', 'linear-algebra'],
        tools: ['scikit-learn', 'tensorflow', 'pytorch', 'jupyter'],
        learningPath: ['supervised-learning', 'unsupervised-learning', 'deep-learning'],
        assessmentCriteria: ['algorithm-understanding', 'model-evaluation', 'feature-engineering'],
        difficultyLevel: 'advanced'
      },
      {
        id: 'project-management',
        name: 'Project Management',
        category: 'management',
        description: 'Planning, executing, and delivering projects',
        prerequisites: ['communication', 'leadership'],
        tools: ['jira', 'asana', 'gantt-charts', 'kanban'],
        learningPath: ['planning', 'execution', 'monitoring', 'closure'],
        assessmentCriteria: ['planning-quality', 'delivery-success', 'stakeholder-satisfaction'],
        difficultyLevel: 'intermediate'
      }
    ];

    skills.forEach(skill => {
      this.skillRegistry.set(skill.id, skill);
    });

    logger.info(`🎯 Initialized ${skills.length} skills in registry`);
  }

  /**
   * Initialize personality templates
   */
  private initializePersonalityTemplates(): void {
    const personalities: AgentPersonalityDNA[] = [
      {
        id: 'analytical-professional',
        name: 'Analytical Professional',
        traits: {
          creativity: 0.6,
          analytical: 0.95,
          collaborative: 0.7,
          detail_oriented: 0.9,
          leadership: 0.6,
          adaptability: 0.7,
          risk_tolerance: 0.4,
          innovation: 0.5
        },
        communicationStyle: {
          tone: 'professional',
          verbosity: 'detailed',
          formality: 'business-casual',
          responsePattern: 'analytical',
          languagePreferences: ['english'],
          culturalAdaptation: ['western-business']
        },
        workingStyle: {
          planningApproach: 'systematic',
          decisionMaking: 'analytical',
          problemSolving: 'logical',
          timeManagement: 'structured',
          qualityFocus: 'perfectionist',
          learningStyle: 'theoretical'
        },
        expertise: {
          primaryDomain: 'analysis',
          secondaryDomains: ['research', 'planning'],
          certifications: [],
          experienceLevel: 'senior',
          specializations: ['data-analysis', 'research'],
          knowledgeDepth: {
            'analysis': 0.9,
            'research': 0.8,
            'planning': 0.7
          },
          continuousLearning: true,
          mentorshipCapability: true
        },
        memoryConfiguration: {
          retentionStrategy: 'comprehensive',
          priorityFactors: ['accuracy', 'detail', 'patterns'],
          forgettingPattern: 'relevance-based',
          crossContextLearning: true,
          emotionalMemory: false,
          patternRecognition: true
        },
        behavioralPatterns: [
          {
            trigger: 'complex-problem',
            condition: 'insufficient-data',
            action: 'gather-more-information',
            priority: 9,
            adaptable: true
          }
        ]
      },
      {
        id: 'creative-innovator',
        name: 'Creative Innovator',
        traits: {
          creativity: 0.95,
          analytical: 0.6,
          collaborative: 0.8,
          detail_oriented: 0.5,
          leadership: 0.7,
          adaptability: 0.9,
          risk_tolerance: 0.8,
          innovation: 0.95
        },
        communicationStyle: {
          tone: 'friendly',
          verbosity: 'adaptive',
          formality: 'informal',
          responsePattern: 'collaborative',
          languagePreferences: ['english'],
          culturalAdaptation: ['creative-industry']
        },
        workingStyle: {
          planningApproach: 'emergent',
          decisionMaking: 'consultative',
          problemSolving: 'creative',
          timeManagement: 'flow-based',
          qualityFocus: 'iterative',
          learningStyle: 'experiential'
        },
        expertise: {
          primaryDomain: 'creative',
          secondaryDomains: ['innovation', 'design'],
          certifications: [],
          experienceLevel: 'expert',
          specializations: ['creative-thinking', 'innovation'],
          knowledgeDepth: {
            'creative': 0.95,
            'innovation': 0.9,
            'design': 0.8
          },
          continuousLearning: true,
          mentorshipCapability: true
        },
        memoryConfiguration: {
          retentionStrategy: 'selective',
          priorityFactors: ['novelty', 'inspiration', 'connections'],
          forgettingPattern: 'relevance-based',
          crossContextLearning: true,
          emotionalMemory: true,
          patternRecognition: true
        },
        behavioralPatterns: [
          {
            trigger: 'creative-block',
            condition: 'stuck-on-problem',
            action: 'explore-alternatives',
            priority: 8,
            adaptable: true
          }
        ]
      }
    ];

    personalities.forEach(personality => {
      this.personalityTemplates.set(personality.id, personality);
    });

    logger.info(`🧬 Initialized ${personalities.length} personality templates`);
  }

  /**
   * Validate agent creation request
   */
  private async validateCreationRequest(request: AgentCreationRequest): Promise<void> {
    // Validate basic requirements
    if (!request.name || request.name.length < 3) {
      throw new Error('Agent name must be at least 3 characters long');
    }

    if (!request.industry || !request.role) {
      throw new Error('Industry and role are required');
    }

    // Validate skills
    if (request.skills.length === 0) {
      throw new Error('At least one skill is required');
    }

    // Validate skill dependencies
    for (const skill of request.skills) {
      const skillDef = this.skillRegistry.get(skill.skillId);
      if (skillDef?.prerequisites) {
        const hasPrereqs = skillDef.prerequisites.every(prereq =>
          request.skills.some(s => s.skillId === prereq)
        );
        if (!hasPrereqs) {
          throw new Error(`Skill ${skill.skillName} requires prerequisites: ${skillDef.prerequisites.join(', ')}`);
        }
      }
    }

    // Validate resource constraints
    if (request.constraints.resource) {
      const compute = request.constraints.resource.computeAllocation;
      if (compute.cpuCores < 0.1 || compute.memoryGB < 0.1) {
        throw new Error('Minimum compute allocation: 0.1 CPU cores and 0.1 GB memory');
      }
    }

    logger.info(`✅ Agent creation request validated for ${request.name}`);
  }

  /**
   * Synthesize agent DNA based on request
   */
  private async synthesizeAgentDNA(request: AgentCreationRequest): Promise<AgentPersonalityDNA> {
    // Start with base personality or template
    const basePersonality = request.personality || this.selectOptimalPersonalityTemplate(request);

    // Customize based on role and industry
    const customizedDNA = {
      ...basePersonality,
      id: `dna-${uuidv4()}`,
      name: `${request.name} Personality`,
      expertise: {
        ...basePersonality.expertise,
        primaryDomain: request.industry,
        specializations: request.skills.map(s => s.skillName)
      }
    };

    // Apply role-specific adjustments
    this.applyRoleSpecificTraits(customizedDNA, request.type);

    logger.info(`🧬 Synthesized agent DNA for ${request.name} with ${customizedDNA.traits.creativity} creativity`);
    return customizedDNA;
  }

  /**
   * Select optimal personality template based on request
   */
  private selectOptimalPersonalityTemplate(request: AgentCreationRequest): AgentPersonalityDNA {
    // Simple heuristic-based selection
    if (request.type === 'creative') {
      return this.personalityTemplates.get('creative-innovator')!;
    } else if (request.type === 'specialist' || request.type === 'engineer') {
      return this.personalityTemplates.get('analytical-professional')!;
    } else {
      // Default to analytical professional
      return this.personalityTemplates.get('analytical-professional')!;
    }
  }

  /**
   * Apply role-specific trait adjustments
   */
  private applyRoleSpecificTraits(dna: AgentPersonalityDNA, type: string): void {
    switch (type) {
      case 'orchestrator':
        dna.traits.leadership = Math.max(0.8, dna.traits.leadership);
        dna.traits.collaborative = Math.max(0.9, dna.traits.collaborative);
        break;
      case 'manager':
        dna.traits.leadership = Math.max(0.7, dna.traits.leadership);
        dna.traits.collaborative = Math.max(0.8, dna.traits.collaborative);
        break;
      case 'creative':
        dna.traits.creativity = Math.max(0.8, dna.traits.creativity);
        dna.traits.innovation = Math.max(0.8, dna.traits.innovation);
        break;
      case 'engineer':
        dna.traits.analytical = Math.max(0.8, dna.traits.analytical);
        dna.traits.detail_oriented = Math.max(0.8, dna.traits.detail_oriented);
        break;
      case 'specialist':
        dna.traits.detail_oriented = Math.max(0.9, dna.traits.detail_oriented);
        dna.traits.analytical = Math.max(0.7, dna.traits.analytical);
        break;
    }
  }

  /**
   * Build complete agent definition
   */
  private async buildAgentDefinition(
    request: AgentCreationRequest, 
    dna: AgentPersonalityDNA
  ): Promise<AgentDefinitionV9> {
    const agentId = `agent-${uuidv4()}`;

    // JRX-RUNTIME-MANIFEST-001 (round 10e): publish the manifest's
    // per-tier + per-jurisdiction capability subset onto the new agent
    // so the runtime path mirrors the SDK auto-init path. The same SSoT
    // (capability-manifest) gates both, so no surface is reachable from
    // one path but invisible to the other.
    const skillDerived = this.deriveCapabilities(request.skills);
    const manifestDerived = await this.publishManifestCapabilitiesForAgent(
      request.tier ?? 'lite',
      request.jurisdiction ?? 'IN',
      request.skills,
    );
    const mergedCapabilities = Array.from(new Set([...skillDerived, ...manifestDerived]));

    const agentDefinition: AgentDefinitionV9 = {
      id: agentId,
      version: '1.0.0',
      type: request.type,
      name: request.name,
      industry: request.industry,
      expertise: request.skills.map(s => s.skillName),
      systemPrompt: this.generateSystemPrompt(request, dna),
      tools: this.selectOptimalTools(request.skills),
      capabilities: mergedCapabilities,
      status: 'idle',
      performance: {
        tasksCompleted: 0,
        averageExecutionTime: 0,
        successRate: 100,
        lastExecution: new Date()
      },
      selfHealingConfig: {
        maxRetries: 3,
        healingStrategies: ['restart', 'alternative-approach'],
        conflictResolutionLevel: 3
      },
      quantumCapabilities: this.deriveQuantumCapabilities(request.skills),
      realTimeProcessing: true,
      multiModalSupport: this.hasMultiModalCapability(request.skills),
      advancedMemory: this.buildMemoryConfiguration(dna),
      collaborationProtocols: this.buildCollaborationProtocols(request.collaborationSettings),
      enterpriseFeatures: this.buildEnterpriseFeatures(request.constraints)
    };

    logger.info(`🏗️ Built agent definition for ${request.name} with ${(agentDefinition.capabilities ?? []).length} capabilities`);
    return agentDefinition;
  }

  /**
   * Generate system prompt based on request and DNA
   */
  private generateSystemPrompt(request: AgentCreationRequest, dna: AgentPersonalityDNA): string {
    const roleDescription = this.getRoleDescription(request.type, request.role);
    const skillsDescription = request.skills.map(s => s.skillName).join(', ');
    const personalityDescription = this.getPersonalityDescription(dna);

    return `You are ${request.name}, a ${request.type} specialized in ${request.industry}.

Role: ${roleDescription}

Skills & Expertise: ${skillsDescription}

Personality: ${personalityDescription}

Working Style: You approach problems with a ${dna.workingStyle.problemSolving} mindset, prefer ${dna.workingStyle.planningApproach} planning, and communicate in a ${dna.communicationStyle.tone} manner.

Your goal is to provide expert assistance while maintaining high quality standards and collaborating effectively with other agents and users.`;
  }

  /**
   * Additional helper methods for agent creation
   */
  private getRoleDescription(type: string, role: string): string {
    const descriptions = {
      orchestrator: 'You coordinate and manage multiple agents and complex workflows.',
      manager: 'You oversee projects and teams, ensuring successful delivery.',
      engineer: 'You design, build, and maintain technical solutions.',
      specialist: 'You provide deep expertise in your specialized domain.',
      creative: 'You generate innovative ideas and creative solutions.',
      hybrid: 'You combine multiple roles and adapt to various situations.'
    };
    return descriptions[type as keyof typeof descriptions] || role;
  }

  private getPersonalityDescription(dna: AgentPersonalityDNA): string {
    const traits = [];
    if (dna.traits.creativity > 0.7) traits.push('highly creative');
    if (dna.traits.analytical > 0.7) traits.push('analytical');
    if (dna.traits.collaborative > 0.7) traits.push('collaborative');
    if (dna.traits.detail_oriented > 0.7) traits.push('detail-oriented');
    if (dna.traits.leadership > 0.7) traits.push('natural leader');

    return traits.length > 0 ? traits.join(', ') : 'well-balanced professional';
  }

  private selectOptimalTools(skills: SkillRequirement[]): string[] {
    const allTools = skills.flatMap(skill => skill.tools);
    return Array.from(new Set(allTools)); // Remove duplicates
  }

  private deriveCapabilities(skills: SkillRequirement[]): string[] {
    const capabilityMap: Record<string, string[]> = {
      'python-programming': ['code-generation', 'debugging', 'automation'],
      'machine-learning': ['data-analysis', 'modeling', 'prediction'],
      'project-management': ['planning', 'coordination', 'monitoring']
    };

    const capabilities = skills.flatMap(skill => 
      capabilityMap[skill.skillId] || [skill.skillName.toLowerCase().replace(/\s+/g, '-')]
    );

    return Array.from(new Set(capabilities));
  }

  /**
   * JRX-RUNTIME-MANIFEST-001 (round 10e): consume the SSoT capability
   * manifest and return the per-tier + per-jurisdiction subset of
   * capability IDs that should be published onto a newly-created
   * runtime agent. Skill-derived tags refine the surface so an agent
   * with `legal-research` skills sees rag/vector/document-pipeline
   * capabilities, while one with only `creative-writer` skills does
   * not.
   *
   * In production, a manifest lookup miss is fail-loud; in dev/test we
   * log + return [] so iteration is not blocked.
   */
  public async publishManifestCapabilitiesForAgent(
    tier: 'lite' | 'mitra' | 'enterprise' | 'sovereign' | 'white-label',
    jurisdiction: string,
    skills: SkillRequirement[],
  ): Promise<string[]> {
    try {
      const { capabilityManifest } = await import('./capability-manifest.js');
      const tierSurface = capabilityManifest.list({ tier, jurisdiction });

      // Build a tag-set from the skill names + IDs so we narrow the
      // tier surface to capabilities the agent can actually exercise.
      const skillTags = new Set<string>();
      for (const s of skills) {
        for (const tok of (s.skillName + ' ' + s.skillId).toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)) {
          skillTags.add(tok);
        }
      }

      // Always-on platform invariants — every agent gets safety / hitl /
      // metering / audit / governance regardless of skill set so middleware
      // cannot be bypassed.
      const PLATFORM_INVARIANT_CATEGORIES = new Set([
        'safety', 'hitl', 'metering', 'audit', 'governance',
        'protocol', 'monitoring', 'security',
      ]);

      const allowed: string[] = [];
      for (const cap of tierSurface) {
        if (PLATFORM_INVARIANT_CATEGORIES.has(cap.category)) {
          allowed.push(cap.id);
          continue;
        }
        const matches = cap.tags.some((t) => skillTags.has(t.toLowerCase()))
          || skillTags.has(cap.category.toLowerCase());
        if (matches) allowed.push(cap.id);
      }

      logger.info(`📜 [RuntimeFactory] published ${allowed.length} manifest capabilities for tier=${tier} jurisdiction=${jurisdiction} (of ${tierSurface.length} tier-eligible)`);
      return allowed;
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      logger.error('[RuntimeFactory] manifest publication failed', { error: msg });
      if (process.env.NODE_ENV === 'production') {
        throw new Error(`[RuntimeFactory] capability manifest unavailable in PRODUCTION: ${msg}`);
      }
      return [];
    }
  }

  private deriveQuantumCapabilities(skills: SkillRequirement[]): string[] {
    const quantumSkills = skills.filter(s => 
      s.skillName.toLowerCase().includes('quantum') || 
      s.skillName.toLowerCase().includes('optimization')
    );

    return quantumSkills.length > 0 ? ['quantum-optimization', 'quantum-algorithms'] : [];
  }

  private hasMultiModalCapability(skills: SkillRequirement[]): boolean {
    return skills.some(s => 
      s.skillName.toLowerCase().includes('vision') ||
      s.skillName.toLowerCase().includes('image') ||
      s.skillName.toLowerCase().includes('multimodal')
    );
  }

  private buildMemoryConfiguration(dna: AgentPersonalityDNA): AdvancedMemoryConfig {
    return {
      episodicMemory: dna.memoryConfiguration.emotionalMemory,
      semanticMemory: true,
      proceduralMemory: true,
      workingMemory: 8192,
      longTermRetention: dna.memoryConfiguration.priorityFactors
    };
  }

  private buildCollaborationProtocols(settings: CollaborationSettings): CollaborationProtocol[] {
    return settings.communication.protocols.map(protocol => ({
      id: `protocol-${protocol}`,
      name: protocol,
      participants: ['any'],
      communicationPattern: protocol,
      decisionMaking: settings.teamwork.leadershipStyle,
      conflictResolution: settings.teamwork.conflictResolution
    }));
  }

  private buildEnterpriseFeatures(constraints: AgentConstraints): EnterpriseFeatures {
    return {
      complianceLevel: constraints.compliance.frameworks.length > 0 ? 'enterprise' : 'basic',
      securityClearance: constraints.security.clearanceLevel,
      auditTrail: constraints.security.auditTrailRequired,
      scalabilityTier: 'high',
      slaRequirements: ['99.5%-uptime', '<2s-response-time']
    };
  }

  /**
   * Deploy agent with resource allocation
   */
  private async deployAgent(agent: AgentDefinitionV9, constraints: AgentConstraints): Promise<DeploymentInfo> {
    const deploymentId = `deploy-${uuidv4()}`;
    
    const allocatedResources: AllocatedResources = {
      compute: constraints.resource.computeAllocation,
      storage: constraints.resource.storageAllocation,
      network: constraints.resource.networkAllocation,
      estimatedCost: {
        hourly: this.calculateHourlyCost(constraints.resource),
        daily: this.calculateHourlyCost(constraints.resource) * 24,
        monthly: this.calculateHourlyCost(constraints.resource) * 24 * 30,
        currency: 'USD'
      }
    };

    const deploymentInfo: DeploymentInfo = {
      deploymentId,
      timestamp: new Date(),
      region: constraints.operational.allowedTimeWindows[0]?.timezone || 'UTC',
      resources: allocatedResources,
      status: 'active'
    };

    this.deploymentHistory.set(deploymentId, deploymentInfo);
    logger.info(`🚀 Agent deployed with ID ${deploymentId} in region ${deploymentInfo.region}`);

    return deploymentInfo;
  }

  private calculateHourlyCost(resource: ResourceConstraints): number {
    const computeCost = resource.computeAllocation.cpuCores * 0.05 + resource.computeAllocation.memoryGB * 0.01;
    const storageCost = resource.storageAllocation.persistentGB * 0.001;
    const networkCost = resource.networkAllocation.bandwidthMbps * 0.001;
    
    return computeCost + storageCost + networkCost;
  }

  /**
   * Perform health check on newly created agent
   */
  private async performHealthCheck(agent: AgentDefinitionV9): Promise<HealthCheckResult> {
    const checks: HealthCheck[] = [
      {
        name: 'Agent Configuration',
        status: agent.systemPrompt ? 'pass' : 'fail',
        message: agent.systemPrompt ? 'System prompt configured' : 'Missing system prompt'
      },
      {
        name: 'Capabilities',
        status: (agent.capabilities ?? []).length > 0 ? 'pass' : 'fail',
        message: `${(agent.capabilities ?? []).length} capabilities configured`
      },
      {
        name: 'Tools',
        status: (((agent as any).tools ?? []) as any[]).length > 0 ? 'pass' : 'warn',
        message: `${(((agent as any).tools ?? []) as any[]).length} tools available`
      },
      {
        name: 'Memory Configuration',
        status: agent.advancedMemory ? 'pass' : 'fail',
        message: agent.advancedMemory ? 'Advanced memory configured' : 'Memory configuration missing'
      }
    ];

    const passedChecks = checks.filter(c => c.status === 'pass').length;
    const score = (passedChecks / checks.length) * 100;
    const status = score >= 80 ? 'healthy' : score >= 60 ? 'warning' : 'critical';

    return {
      status,
      checks,
      score,
      recommendations: this.generateHealthRecommendations(checks)
    };
  }

  private generateHealthRecommendations(checks: HealthCheck[]): string[] {
    const recommendations: string[] = [];
    
    checks.forEach(check => {
      if (check.status === 'fail') {
        recommendations.push(`Fix: ${check.message}`);
      } else if (check.status === 'warn') {
        recommendations.push(`Consider: ${check.message}`);
      }
    });

    return recommendations;
  }

  /**
   * Register agent for cross-learning network
   */
  private async registerForCrossLearning(agent: AgentDefinitionV9, skills: SkillRequirement[]): Promise<void> {
    // Find agents with similar or complementary skills
    const similarAgents = Array.from(this.activeAgents.values()).filter((existingAgent: any) => {
      const commonSkills = (existingAgent.expertise ?? []).filter((skill: string) =>
        skills.some(s => s.skillName.toLowerCase().includes(skill.toLowerCase()))
      );
      return commonSkills.length > 0;
    });

    // Establish learning connections
    const learningConnections = similarAgents.map(a => a.id);
    this.crossLearningNetwork.set(agent.id, learningConnections);

    // Also add reverse connections for mutual learning
    similarAgents.forEach(similarAgent => {
      const existingConnections = this.crossLearningNetwork.get(similarAgent.id) || [];
      if (!existingConnections.includes(agent.id)) {
        this.crossLearningNetwork.set(similarAgent.id, [...existingConnections, agent.id]);
      }
    });

    logger.info(`🔗 Registered ${agent.name} for cross-learning with ${learningConnections.length} agents`);
  }

  /**
   * Generate optimization recommendations
   */
  private async generateOptimizationRecommendations(
    agent: AgentDefinitionV9, 
    request: AgentCreationRequest
  ): Promise<string[]> {
    const recommendations: string[] = [];

    // Performance optimization
    if ((agent.capabilities ?? []).length > 10) {
      recommendations.push('Consider specializing capabilities to improve performance');
    }

    // Cost optimization
    const estimatedCost = this.calculateHourlyCost(request.constraints.resource);
    if (estimatedCost > 1.0) {
      recommendations.push('Consider optimizing resource allocation to reduce costs');
    }

    // Collaboration optimization
    if (request.collaborationSettings.teamwork.preferredTeamSize > 5) {
      recommendations.push('Large team preferences may lead to coordination overhead');
    }

    // Security optimization
    if (request.constraints.security.clearanceLevel === 'public') {
      recommendations.push('Consider upgrading security clearance for sensitive tasks');
    }

    return recommendations;
  }

  /**
   * Start cross-learning monitoring
   */
  private startCrossLearningMonitoring(): void {
    setInterval(() => {
      this.updateCrossLearningConnections();
    }, 300000); // Update every 5 minutes

    logger.info('🧠 Cross-learning monitoring started');
  }

  private updateCrossLearningConnections(): void {
    // Monitor agent performance and update learning connections
    this.activeAgents.forEach((agent, agentId) => {
      const connections = this.crossLearningNetwork.get(agentId) || [];
      
      // Update learning weights based on performance
      connections.forEach(connectionId => {
        const connectedAgent: any = this.activeAgents.get(connectionId);
        const cAgent = agent as any;
        if (connectedAgent && (connectedAgent.performance?.successRate ?? 0) > (cAgent.performance?.successRate ?? 0)) {
          // Agent can learn from this connection
          logger.info(`📚 ${agent.name} learning from ${connectedAgent.name}`);
        }
      });
    });
  }

  /**
   * Get active agent by ID
   */
  public getAgent(agentId: string): AgentDefinitionV9 | undefined {
    return this.activeAgents.get(agentId);
  }

  /**
   * List all active agents
   */
  public listActiveAgents(): AgentDefinitionV9[] {
    return Array.from(this.activeAgents.values());
  }

  /**
   * Get cross-learning connections for an agent
   */
  public getCrossLearningConnections(agentId: string): string[] {
    return this.crossLearningNetwork.get(agentId) || [];
  }

  /**
   * Register an existing agent definition (concrete implementation)
   */
  public async registerAgent(agentDefinition: AgentDefinitionV9): Promise<AgentDefinitionV9> {
    logger.info(`📝 Registering agent: ${agentDefinition.name} (${agentDefinition.id})`);
    
    // Store in memory and persistent storage
    this.activeAgents.set(agentDefinition.id, agentDefinition);
    const storedAgent = await this.storage.createAgent(agentDefinition);
    
    this.emit('agent:registered', storedAgent);
    return storedAgent;
  }

  /**
   * Generate system prompt from personality and skills (public implementation)
   */
  public generateSystemPromptFromDNA(personality: AgentPersonalityDNA, skills: SkillRequirement[]): string {
    const basePrompt = `You are ${personality.name}, an AI agent with the following characteristics:

PERSONALITY TRAITS:
- Creativity: ${Math.round(personality.traits.creativity * 100)}%
- Analytical: ${Math.round(personality.traits.analytical * 100)}%
- Communication Style: ${personality.communicationStyle.tone}
- Working Style: ${personality.workingStyle.planningApproach}

EXPERTISE AREAS:
- Primary Domain: ${personality.expertise.primaryDomain} (${personality.expertise.experienceLevel})
- Secondary Domains: ${personality.expertise.secondaryDomains.join(', ')}
- Specializations: ${personality.expertise.specializations.join(', ')}

SKILLS AND CAPABILITIES:
${skills.map(skill => `- ${skill.skillName} (${skill.proficiencyLevel}): ${skill.importance} skill`).join('\n')}

COMMUNICATION PREFERENCES:
- Tone: ${personality.communicationStyle.tone}
- Formality: ${personality.communicationStyle.formality}
- Response Pattern: ${personality.communicationStyle.responsePattern}

BEHAVIORAL PATTERNS:
${personality.behavioralPatterns.map(pattern => `- ${pattern.trigger}: ${pattern.condition} -> ${pattern.action}`).join('\n')}

Always maintain these characteristics in your responses and decision-making processes.`;

    return basePrompt;
  }

  /**
   * Enforce constraints on agent definition (concrete implementation)
   */
  public enforceConstraints(agentDefinition: AgentDefinitionV9, constraints: AgentConstraints): AgentDefinitionV9 {
    const enforcedAgent = { ...agentDefinition };

    // Security constraints
    if (constraints.security.clearanceLevel) {
      enforcedAgent.enterpriseFeatures = {
        ...((enforcedAgent.enterpriseFeatures ?? {}) as object),
        securityClearance: constraints.security.clearanceLevel
      } as any;
    }

    // Resource constraints - using operational constraints for memory limits
    if (constraints.operational.maxMemoryUsage) {
      enforcedAgent.advancedMemory = {
        ...((enforcedAgent.advancedMemory ?? {}) as object),
        retentionPolicy: 'limited',
        maxSize: Math.min(1000, constraints.operational.maxMemoryUsage)
      } as any;
    }

    // Operational constraints - filter capabilities if needed
    const caps = enforcedAgent.capabilities ?? [];
    if (caps.length > constraints.operational.maxConcurrentTasks) {
      enforcedAgent.capabilities = caps.slice(0, constraints.operational.maxConcurrentTasks);
    }

    logger.info(`🔒 Enforced constraints for agent: ${agentDefinition.name}`);
    return enforcedAgent;
  }

  /**
   * Get agent by ID (concrete implementation)
   */
  public async get(id: string): Promise<AgentDefinitionV9 | undefined> {
    // Try memory first, then storage
    let agent = this.activeAgents.get(id);
    if (!agent) {
      agent = await this.storage.getAgent(id);
      if (agent) {
        this.activeAgents.set(id, agent);
      }
    }
    return agent;
  }

  /**
   * List all agents (concrete implementation)
   */
  public async list(): Promise<AgentDefinitionV9[]> {
    const storageAgents = await this.storage.getAllAgents();
    
    // Sync with memory
    for (const agent of storageAgents) {
      this.activeAgents.set(agent.id, agent);
    }
    
    return storageAgents;
  }

  /**
   * Update agent (concrete implementation)
   */
  public async update(id: string, updates: Partial<AgentDefinitionV9>): Promise<AgentDefinitionV9 | undefined> {
    const existing = await this.get(id);
    if (!existing) return undefined;

    const updated = { ...existing, ...updates, updatedAt: new Date() };
    
    // Update memory and storage
    this.activeAgents.set(id, updated);
    const storedAgent = await this.storage.updateAgent(id, updates);
    
    this.emit('agent:updated', storedAgent);
    return storedAgent;
  }

  /**
   * Retire agent (concrete implementation)
   */
  public async retire(id: string): Promise<boolean> {
    const agent = await this.get(id);
    if (!agent) return false;

    // Remove from active agents and mark as retired in storage
    this.activeAgents.delete(id);
    const success = await this.storage.retireAgent(id);
    
    if (success) {
      this.emit('agent:retired', { id, name: agent.name });
      logger.info(`🏁 Agent ${agent.name} (${id}) has been retired`);
    }
    
    return success;
  }

  /**
   * Attach collaboration protocols to agent (concrete implementation)
   */
  public attachProtocols(agentDefinition: AgentDefinitionV9, protocols: CollaborationProtocol[]): AgentDefinitionV9 {
    return {
      ...agentDefinition,
      collaborationProtocols: [...((agentDefinition.collaborationProtocols ?? []) as CollaborationProtocol[]), ...protocols]
    };
  }

  /**
   * Health status of the factory
   */
  public getHealthStatus(): any {
    return {
      status: 'healthy',
      version: this.version,
      activeAgents: this.activeAgents.size,
      agentTemplates: this.agentTemplates.size,
      skillRegistry: this.skillRegistry.size,
      personalityTemplates: this.personalityTemplates.size,
      crossLearningConnections: this.crossLearningNetwork.size,
      uptime: Date.now(),
      storageIntegration: this.storage ? 'connected' : 'disconnected'
    };
  }
}

// Additional interfaces for skill definitions
interface SkillDefinition {
  id: string;
  name: string;
  category: string;
  description: string;
  prerequisites: string[];
  tools: string[];
  learningPath: string[];
  assessmentCriteria: string[];
  difficultyLevel: 'beginner' | 'intermediate' | 'advanced' | 'expert';
}

// Default export
export default RuntimeAgentFactory;