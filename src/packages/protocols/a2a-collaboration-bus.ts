// JRX-NS-021 (2026-05-05): pre-existing strict-null cluster (gateway runs via tsx).
/**
 * A2A (Agent-to-Agent) Collaboration Bus v9.0
 * 
 * Phase 3.1: Agent negotiation, escalation, task handoffs, dependency resolution
 * 
 * Features:
 * - Real-time agent-to-agent communication and negotiation
 * - Intelligent task handoff and delegation mechanisms
 * - Dependency resolution and conflict management
 * - Escalation protocols and mediation services
 * - Performance monitoring and optimization
 */

import { EventEmitter } from 'events';
import { randomUUID as uuidv4 } from 'crypto';
import { createLogger } from '../../utils/logger.js';

const logger = createLogger('a2a-collaboration-bus');

interface AgentDefinitionV9 { id: string; name: string; type: string; capabilities: string[]; }
interface JurexioOrchestrationConfigV9 { agents: AgentDefinitionV9[]; maxConcurrency?: number; }
interface IStorage { get(key: string): Promise<any>; set(key: string, value: any): Promise<void>; delete(key: string): Promise<void>; }

// ================================================================================================
// A2A COLLABORATION INTERFACES
// ================================================================================================

export interface A2AMessage {
  id: string;
  type: 'request' | 'response' | 'notification' | 'negotiation' | 'handoff' | 'escalation';
  fromAgent: string;
  toAgent: string | string[]; // Single agent or broadcast
  payload: A2APayload;
  metadata: MessageMetadata;
  routing: RoutingInfo;
  security: SecurityContext;
  timestamp: Date;
  ttl?: number; // Time to live in milliseconds
}

export interface A2APayload {
  action: string;
  data: Record<string, any>;
  requirements?: TaskRequirement[];
  constraints?: TaskConstraint[];
  preferences?: AgentPreference[];
  context?: ExecutionContext;
}

export interface MessageMetadata {
  priority: 'low' | 'normal' | 'high' | 'urgent' | 'critical';
  category: string;
  tags: string[];
  correlationId?: string;
  conversationId?: string;
  requestId?: string;
  replyTo?: string;
  expectedResponseTime?: number;
}

export interface RoutingInfo {
  path: string[];
  hops: number;
  maxHops: number;
  broadcast: boolean;
  multicast: boolean;
  failover: boolean;
  retryPolicy: RetryPolicy;
}

export interface SecurityContext {
  authenticated: boolean;
  authorized: boolean;
  encryptionLevel: 'none' | 'basic' | 'enhanced' | 'quantum';
  signature?: string;
  certificate?: string;
  accessLevel: 'public' | 'internal' | 'confidential' | 'secret';
}

export interface RetryPolicy {
  maxRetries: number;
  baseDelay: number;
  maxDelay: number;
  backoffStrategy: 'linear' | 'exponential' | 'fibonacci' | 'custom';
  jitter: boolean;
  circuitBreaker: boolean;
}

export interface TaskRequirement {
  id: string;
  type: 'capability' | 'resource' | 'performance' | 'availability' | 'security';
  specification: string;
  mandatory: boolean;
  weight: number;
  validation: ValidationRule[];
}

export interface TaskConstraint {
  id: string;
  type: 'time' | 'resource' | 'quality' | 'cost' | 'compliance' | 'dependency';
  constraint: string;
  severity: 'soft' | 'hard';
  penalty?: number;
  fallback?: string;
}

export interface AgentPreference {
  id: string;
  type: 'communication' | 'collaboration' | 'workflow' | 'performance';
  preference: string;
  weight: number;
  negotiable: boolean;
}

export interface ExecutionContext {
  environment: string;
  resources: ResourceContext;
  dependencies: string[];
  deadline?: Date;
  budget?: number;
  qualityMetrics: QualityMetric[];
}

export interface ResourceContext {
  compute: ComputeResource;
  storage: StorageResource;
  network: NetworkResource;
  external: ExternalResource[];
}

export interface ComputeResource {
  cpu: number;
  memory: number;
  gpu?: number;
  duration: number;
}

export interface StorageResource {
  temporary: number;
  persistent: number;
  backup: number;
}

export interface NetworkResource {
  bandwidth: number;
  latency: number;
  reliability: number;
}

export interface ExternalResource {
  type: string;
  identifier: string;
  quota: number;
  cost: number;
}

export interface QualityMetric {
  name: string;
  target: number;
  threshold: number;
  weight: number;
}

export interface ValidationRule {
  type: 'format' | 'range' | 'dependency' | 'custom';
  rule: string;
  parameters: Record<string, any>;
}

// ================================================================================================
// NEGOTIATION INTERFACES
// ================================================================================================

export interface NegotiationSession {
  id: string;
  type: 'bilateral' | 'multilateral' | 'auction' | 'mediated';
  participants: NegotiationParticipant[];
  subject: NegotiationSubject;
  protocol: NegotiationProtocol;
  state: NegotiationState;
  history: NegotiationEvent[];
  mediator?: string;
  deadline?: Date;
  outcome?: NegotiationOutcome;
}

export interface NegotiationParticipant {
  agentId: string;
  role: 'initiator' | 'responder' | 'mediator' | 'observer';
  capabilities: string[];
  constraints: string[];
  preferences: string[];
  strategy: NegotiationStrategy;
  reputation: number;
  trustLevel: number;
}

export interface NegotiationSubject {
  type: 'task_assignment' | 'resource_allocation' | 'priority_resolution' | 'capability_exchange';
  description: string;
  requirements: TaskRequirement[];
  constraints: TaskConstraint[];
  alternatives: Alternative[];
  evaluation: EvaluationCriteria;
}

export interface Alternative {
  id: string;
  description: string;
  cost: number;
  benefit: number;
  risk: number;
  feasibility: number;
  timeline: number;
}

export interface EvaluationCriteria {
  factors: EvaluationFactor[];
  weights: Record<string, number>;
  method: 'weighted_sum' | 'pareto' | 'topsis' | 'ahp' | 'custom';
  threshold: number;
}

export interface EvaluationFactor {
  name: string;
  type: 'benefit' | 'cost' | 'risk' | 'constraint';
  measurement: string;
  scale: string;
  importance: number;
}

export interface NegotiationProtocol {
  type: 'alternating_offers' | 'sealed_bid' | 'combinatorial' | 'iterative' | 'multi_issue';
  rules: ProtocolRule[];
  rounds: number;
  timeouts: TimeoutConfig;
  termination: TerminationCondition[];
  fairness: FairnessRule[];
}

export interface ProtocolRule {
  id: string;
  condition: string;
  action: string;
  priority: number;
  enforcement: 'strict' | 'flexible' | 'advisory';
}

export interface TimeoutConfig {
  roundTimeout: number;
  totalTimeout: number;
  responseTimeout: number;
  warningThreshold: number;
}

export interface TerminationCondition {
  type: 'consensus' | 'timeout' | 'deadlock' | 'quality_threshold' | 'resource_exhaustion';
  condition: string;
  action: 'accept_best' | 'escalate' | 'postpone' | 'cancel';
}

export interface FairnessRule {
  type: 'equal_opportunity' | 'proportional_benefit' | 'need_based' | 'contribution_based';
  enforcement: string;
  measurement: string;
  tolerance: number;
}

export interface NegotiationStrategy {
  type: 'cooperative' | 'competitive' | 'accommodating' | 'avoiding' | 'compromising' | 'adaptive';
  parameters: StrategyParameter[];
  tactics: NegotiationTactic[];
  adaptability: number;
  learning: boolean;
}

export interface StrategyParameter {
  name: string;
  value: number;
  range: { min: number; max: number };
  adaptable: boolean;
}

export interface NegotiationTactic {
  name: string;
  type: 'opening' | 'concession' | 'pressure' | 'information' | 'coalition' | 'timing';
  trigger: string;
  effectiveness: number;
  risk: number;
}

export interface NegotiationState {
  phase: 'initialization' | 'bidding' | 'bargaining' | 'finalizing' | 'completed' | 'failed';
  round: number;
  currentOffer: Offer;
  bestOffer: Offer;
  proposals: Proposal[];
  agreements: Agreement[];
  conflicts: Conflict[];
  progress: number; // 0-1
}

export interface Offer {
  id: string;
  fromAgent: string;
  proposal: Proposal;
  validity: number; // seconds
  conditions: string[];
  alternatives: Alternative[];
  timestamp: Date;
}

export interface Proposal {
  id: string;
  items: ProposalItem[];
  totalValue: number;
  confidence: number;
  rationale: string;
  tradeoffs: Tradeoff[];
}

export interface ProposalItem {
  id: string;
  type: 'resource' | 'capability' | 'service' | 'constraint';
  specification: string;
  quantity: number;
  quality: number;
  cost: number;
  timeline: number;
}

export interface Tradeoff {
  give: string;
  get: string;
  ratio: number;
  acceptability: number;
}

export interface Agreement {
  id: string;
  parties: string[];
  terms: AgreementTerm[];
  conditions: string[];
  enforcement: EnforcementMechanism;
  validity: number;
  signature: string;
}

export interface AgreementTerm {
  id: string;
  type: 'obligation' | 'right' | 'constraint' | 'benefit';
  subject: string;
  specification: string;
  measurable: boolean;
  verifiable: boolean;
}

export interface EnforcementMechanism {
  type: 'automatic' | 'mediated' | 'reputation' | 'penalty' | 'exclusion';
  monitors: string[];
  penalties: Penalty[];
  appeals: string[];
}

export interface Penalty {
  violation: string;
  severity: 'minor' | 'moderate' | 'major' | 'severe';
  type: 'warning' | 'fine' | 'suspension' | 'termination';
  amount?: number;
  duration?: number;
}

export interface Conflict {
  id: string;
  type: 'resource' | 'priority' | 'capability' | 'timeline' | 'quality' | 'cost';
  parties: string[];
  description: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  impact: string[];
  resolution: ConflictResolution;
}

export interface ConflictResolution {
  status: 'pending' | 'in_progress' | 'resolved' | 'escalated';
  method: 'negotiation' | 'mediation' | 'arbitration' | 'voting' | 'authority';
  resolver: string;
  timeline: number;
  outcome?: string;
}

export interface NegotiationEvent {
  id: string;
  type: 'offer' | 'counter_offer' | 'acceptance' | 'rejection' | 'concession' | 'escalation';
  timestamp: Date;
  agent: string;
  action: string;
  data: Record<string, any>;
  impact: string;
}

export interface NegotiationOutcome {
  result: 'success' | 'failure' | 'partial' | 'escalated' | 'timeout';
  agreements: Agreement[];
  satisfaction: Record<string, number>; // agent -> satisfaction score
  efficiency: number;
  fairness: number;
  stability: number;
  lessons: string[];
}

// ================================================================================================
// HANDOFF INTERFACES
// ================================================================================================

export interface TaskHandoff {
  id: string;
  type: 'delegation' | 'transfer' | 'collaboration' | 'escalation' | 'specialization';
  fromAgent: string;
  toAgent: string;
  task: HandoffTask;
  context: HandoffContext;
  requirements: HandoffRequirement[];
  agreements: HandoffAgreement[];
  monitoring: HandoffMonitoring;
  status: HandoffStatus;
}

export interface HandoffTask {
  id: string;
  name: string;
  description: string;
  type: string;
  complexity: number;
  priority: 'low' | 'normal' | 'high' | 'urgent' | 'critical';
  dependencies: TaskDependency[];
  deliverables: Deliverable[];
  timeline: TaskTimeline;
  resources: TaskResource[];
}

export interface TaskDependency {
  id: string;
  type: 'prerequisite' | 'concurrent' | 'successor' | 'resource' | 'knowledge';
  target: string;
  relationship: string;
  criticality: 'low' | 'medium' | 'high' | 'critical';
  impact: string;
}

export interface Deliverable {
  id: string;
  name: string;
  type: string;
  format: string;
  quality: QualityStandard[];
  deadline: Date;
  dependencies: string[];
}

export interface QualityStandard {
  metric: string;
  target: number;
  threshold: number;
  measurement: string;
  verification: string;
}

export interface TaskTimeline {
  start: Date;
  end: Date;
  milestones: Milestone[];
  checkpoints: Checkpoint[];
  buffers: TimeBuffer[];
}

export interface Milestone {
  id: string;
  name: string;
  date: Date;
  deliverables: string[];
  criteria: string[];
  importance: number;
}

export interface Checkpoint {
  id: string;
  date: Date;
  type: 'progress' | 'quality' | 'resource' | 'risk';
  assessment: string[];
  actions: string[];
}

export interface TimeBuffer {
  id: string;
  purpose: string;
  duration: number;
  flexibility: number;
  conditions: string[];
}

export interface TaskResource {
  id: string;
  type: 'compute' | 'storage' | 'network' | 'human' | 'tool' | 'data';
  specification: string;
  quantity: number;
  allocation: ResourceAllocation;
  availability: ResourceAvailability;
}

export interface ResourceAllocation {
  method: 'dedicated' | 'shared' | 'on_demand' | 'pooled';
  priority: number;
  constraints: string[];
  overrides: string[];
}

export interface ResourceAvailability {
  schedule: AvailabilityWindow[];
  reliability: number;
  performance: number;
  cost: number;
}

export interface AvailabilityWindow {
  start: Date;
  end: Date;
  capacity: number;
  quality: number;
  restrictions: string[];
}

export interface HandoffContext {
  reason: string;
  urgency: 'low' | 'normal' | 'high' | 'critical';
  background: string;
  constraints: string[];
  assumptions: string[];
  risks: Risk[];
  opportunities: Opportunity[];
  stakeholders: Stakeholder[];
}

export interface Risk {
  id: string;
  type: 'technical' | 'resource' | 'timeline' | 'quality' | 'external';
  description: string;
  probability: number;
  impact: number;
  mitigation: string[];
  contingency: string[];
}

export interface Opportunity {
  id: string;
  type: 'efficiency' | 'quality' | 'innovation' | 'learning' | 'relationship';
  description: string;
  potential: number;
  effort: number;
  realization: string[];
}

export interface Stakeholder {
  id: string;
  type: 'internal' | 'external' | 'user' | 'sponsor' | 'partner';
  name: string;
  role: string;
  influence: number;
  interest: number;
  communication: string[];
}

export interface HandoffRequirement {
  id: string;
  type: 'capability' | 'performance' | 'security' | 'compliance' | 'communication';
  specification: string;
  verification: string;
  mandatory: boolean;
  weight: number;
}

export interface HandoffAgreement {
  id: string;
  type: 'sla' | 'responsibility' | 'communication' | 'reporting' | 'escalation';
  terms: string[];
  metrics: AgreementMetric[];
  penalties: string[];
  reviews: string[];
}

export interface AgreementMetric {
  name: string;
  target: number;
  threshold: number;
  measurement: string;
  frequency: string;
}

export interface HandoffMonitoring {
  enabled: boolean;
  frequency: number;
  metrics: MonitoringMetric[];
  alerts: AlertConfiguration[];
  reporting: ReportingConfiguration;
  feedback: FeedbackConfiguration;
}

export interface MonitoringMetric {
  name: string;
  type: 'performance' | 'quality' | 'resource' | 'progress' | 'satisfaction';
  formula: string;
  target: number;
  threshold: number;
  trend: 'higher_better' | 'lower_better' | 'stable_better';
}

export interface AlertConfiguration {
  condition: string;
  severity: 'info' | 'warning' | 'error' | 'critical';
  recipients: string[];
  channels: string[];
  frequency: string;
  escalation: EscalationRule[];
}

export interface EscalationRule {
  condition: string;
  delay: number;
  action: string;
  target: string;
  severity: string;
}

export interface ReportingConfiguration {
  frequency: 'real_time' | 'hourly' | 'daily' | 'weekly' | 'milestone';
  recipients: string[];
  format: 'summary' | 'detailed' | 'dashboard' | 'custom';
  automation: boolean;
}

export interface FeedbackConfiguration {
  collection: 'automatic' | 'prompted' | 'scheduled' | 'event_driven';
  processing: 'immediate' | 'batch' | 'periodic';
  analysis: 'basic' | 'advanced' | 'ai_powered';
  action: 'notification' | 'adjustment' | 'escalation' | 'learning';
}

export interface HandoffStatus {
  phase: 'initiated' | 'negotiating' | 'transferring' | 'executing' | 'monitoring' | 'completed' | 'failed';
  progress: number; // 0-1
  health: 'healthy' | 'warning' | 'critical' | 'failed';
  metrics: StatusMetric[];
  issues: Issue[];
  notifications: Notification[];
}

export interface StatusMetric {
  name: string;
  value: number;
  status: 'good' | 'warning' | 'critical';
  trend: 'improving' | 'stable' | 'degrading';
  lastUpdate: Date;
}

export interface Issue {
  id: string;
  type: 'blocking' | 'warning' | 'informational';
  description: string;
  impact: string;
  resolution: string;
  assignee: string;
  deadline: Date;
}

export interface Notification {
  id: string;
  type: 'update' | 'alert' | 'request' | 'completion';
  message: string;
  recipients: string[];
  channel: string;
  timestamp: Date;
  read: boolean;
}

// ================================================================================================
// A2A COLLABORATION BUS
// ================================================================================================

export class A2ACollaborationBus extends EventEmitter {
  private messageQueue: Map<string, A2AMessage[]> = new Map();
  private activeNegotiations: Map<string, NegotiationSession> = new Map();
  private activeHandoffs: Map<string, TaskHandoff> = new Map();
  private agentRegistry: Map<string, AgentRegistration> = new Map();
  private routingTable: Map<string, RoutingEntry> = new Map();
  private collaborationHistory: Map<string, CollaborationRecord[]> = new Map();
  private performanceMetrics: Map<string, PerformanceData> = new Map();
  private conflictResolver: ConflictResolver;
  private negotiationEngine: NegotiationEngine;
  private handoffManager: HandoffManager;
  private readonly version: '1.0.0' = '1.0.0';
  private storage: IStorage;
  private coreConfig: JurexioOrchestrationConfigV9;
  private subscribers: Map<string, Function[]> = new Map();
  private correlationMap: Map<string, any> = new Map();

  constructor(config: { coreConfig: JurexioOrchestrationConfigV9; storage: IStorage }) {
    super();
    this.storage = config.storage;
    this.coreConfig = config.coreConfig;
    logger.info('🚀 A2A Collaboration Bus v9.0 initializing with storage integration...');
    this.conflictResolver = new ConflictResolver();
    this.negotiationEngine = new NegotiationEngine();
    this.handoffManager = new HandoffManager();
    this.initializeCollaborationBus();
    this.startMessageProcessing();
    this.startPerformanceMonitoring();
  }

  /**
   * Register an agent for A2A collaboration
   */
  public async registerAgent(agent: AgentDefinitionV9, capabilities?: CollaborationCapabilities): Promise<AgentRegistration> {
    logger.info(`🤝 Registering agent ${agent.name} for A2A collaboration...`);

    const registration: AgentRegistration = {
      agentId: agent.id,
      name: agent.name,
      type: agent.type,
      capabilities: capabilities || this.deriveCollaborationCapabilities(agent),
      preferences: this.deriveCollaborationPreferences(agent),
      reputation: this.initializeReputation(),
      availability: this.initializeAvailability(),
      communication: this.initializeCommunicationSettings(),
      performance: this.initializePerformanceTracking(),
      registrationTime: new Date(),
      lastActivity: new Date()
    };

    this.agentRegistry.set(agent.id, registration);
    this.messageQueue.set(agent.id, []);
    this.collaborationHistory.set(agent.id, []);
    this.performanceMetrics.set(agent.id, this.initializePerformanceData());

    // Create routing entry
    this.routingTable.set(agent.id, {
      agentId: agent.id,
      address: `agent://${agent.id}`,
      capabilities: registration.capabilities.supported,
      priority: this.calculateRoutingPriority(registration),
      availability: registration.availability.status,
      lastUpdate: new Date()
    });

    logger.info(`✅ Agent ${agent.name} registered for A2A collaboration`);
    this.emit('agent-registered', registration);

    return registration;
  }

  /**
   * Send message between agents
   */
  public async sendMessage(message: A2AMessage): Promise<MessageResult> {
    logger.info(`📨 Sending A2A message from ${message.fromAgent} to ${message.toAgent}`);

    try {
      // Validate message
      await this.validateMessage(message);

      // Route message
      const routingResult = await this.routeMessage(message);

      // Process message based on type
      let processingResult: ProcessingResult;
      
      switch (message.type) {
        case 'negotiation':
          processingResult = await this.processNegotiationMessage(message);
          break;
        case 'handoff':
          processingResult = await this.processHandoffMessage(message);
          break;
        case 'escalation':
          processingResult = await this.processEscalationMessage(message);
          break;
        default:
          processingResult = await this.processStandardMessage(message);
      }

      // Update performance metrics
      this.updateMessagePerformance(message, processingResult);

      // Record collaboration history
      this.recordCollaboration(message, processingResult);

      const result: MessageResult = {
        messageId: message.id,
        status: 'delivered',
        routing: routingResult,
        processing: processingResult,
        timestamp: new Date(),
        metrics: this.calculateMessageMetrics(message, processingResult)
      };

      logger.info(`✅ A2A message ${message.id} processed successfully`);
      this.emit('message-processed', result);

      return result;

    } catch (error: any) {
      logger.error('❌ A2A message processing failed:', error instanceof Error ? error.message : String(error));
      throw error;
    }
  }

  /**
   * Start negotiation between agents
   */
  public async startNegotiation(request: NegotiationRequest): Promise<NegotiationSession> {
    logger.info(`🤝 Starting negotiation: ${request.subject.description}`);

    try {
      // Create negotiation session
      const session = await this.negotiationEngine.createSession(request);

      // Register active negotiation
      this.activeNegotiations.set(session.id, session);

      // Notify participants
      await this.notifyNegotiationParticipants(session);

      // Start negotiation process
      await this.negotiationEngine.startNegotiation(session);

      logger.info(`✅ Negotiation ${session.id} started with ${session.participants.length} participants`);
      this.emit('negotiation-started', session);

      return session;

    } catch (error: any) {
      logger.error('❌ Negotiation start failed:', error instanceof Error ? error.message : String(error));
      throw error;
    }
  }

  /**
   * Initiate task handoff between agents
   */
  public async initiateHandoff(request: HandoffRequest): Promise<TaskHandoff> {
    logger.info(`🔄 Initiating task handoff from ${request.fromAgent} to ${request.toAgent}`);

    try {
      // Create handoff
      const handoff = await this.handoffManager.createHandoff(request);

      // Register active handoff
      this.activeHandoffs.set(handoff.id, handoff);

      // Start handoff process
      await this.handoffManager.executeHandoff(handoff);

      logger.info(`✅ Task handoff ${handoff.id} initiated successfully`);
      this.emit('handoff-initiated', handoff);

      return handoff;

    } catch (error: any) {
      logger.error('❌ Task handoff initiation failed:', error instanceof Error ? error.message : String(error));
      throw error;
    }
  }

  /**
   * Resolve conflicts between agents
   */
  public async resolveConflict(conflict: Conflict): Promise<ConflictResolution> {
    logger.info(`⚡ Resolving conflict: ${conflict.description}`);

    try {
      const resolution = await this.conflictResolver.resolve(conflict);
      
      // Update conflict status
      conflict.resolution = resolution;

      // Notify involved parties
      await this.notifyConflictResolution(conflict, resolution);

      // Update agent relationships
      this.updateAgentRelationships(conflict, resolution);

      logger.info(`✅ Conflict ${conflict.id} resolved using ${resolution.method}`);
      this.emit('conflict-resolved', { conflict, resolution });

      return resolution;

    } catch (error: any) {
      logger.error('❌ Conflict resolution failed:', error instanceof Error ? error.message : String(error));
      throw error;
    }
  }

  /**
   * Initialize collaboration bus
   */
  private initializeCollaborationBus(): void {
    logger.info('🌐 A2A Collaboration Bus initialized');
  }

  /**
   * Start message processing loop
   */
  private startMessageProcessing(): void {
    setInterval(() => {
      this.processMessageQueues();
    }, 1000); // Process every second

    logger.info('📨 Message processing started');
  }

  /**
   * Start performance monitoring
   */
  private startPerformanceMonitoring(): void {
    setInterval(() => {
      this.updatePerformanceMetrics();
    }, 30000); // Monitor every 30 seconds

    logger.info('📊 Performance monitoring started');
  }

  /**
   * Process message queues for all agents
   */
  private processMessageQueues(): void {
    this.messageQueue.forEach((queue, agentId) => {
      if (queue.length > 0) {
        const messages = queue.splice(0, 10); // Process up to 10 messages per agent
        messages.forEach(message => {
          this.deliverMessage(message, agentId);
        });
      }
    });
  }

  /**
   * Update performance metrics for all agents
   */
  private updatePerformanceMetrics(): void {
    this.performanceMetrics.forEach((metrics, agentId) => {
      const registration = this.agentRegistry.get(agentId);
      if (registration) {
        this.calculateAgentPerformance(registration, metrics);
      }
    });
  }

  /**
   * Helper methods for A2A operations
   */
  private deriveCollaborationCapabilities(agent: AgentDefinitionV9): CollaborationCapabilities {
    return {
      supported: [
        'messaging',
        'negotiation',
        'task_handoff',
        'resource_sharing',
        'knowledge_transfer'
      ],
      preferences: {
        communication: agent.type === 'orchestrator' ? 'broadcast' : 'direct',
        negotiation: agent.type === 'manager' ? 'mediated' : 'direct',
        handoff: 'formal',
        conflict_resolution: 'collaborative'
      },
      constraints: {
        max_concurrent_negotiations: 5,
        max_handoffs_per_hour: 10,
        response_time_sla: 30000, // 30 seconds
        availability_hours: '24/7'
      },
      specializations: (agent as any).expertise
    };
  }

  private deriveCollaborationPreferences(agent: AgentDefinitionV9): CollaborationPreferences {
    return {
      communication: {
        frequency: 'as_needed',
        channels: ['direct', 'broadcast'],
        formality: 'business',
        language: 'english',
        timezone: 'UTC'
      },
      negotiation: {
        style: 'collaborative',
        patience: 0.7,
        risk_tolerance: 0.5,
        concession_rate: 0.1,
        deadline_flexibility: 0.3
      },
      handoff: {
        documentation_level: 'detailed',
        monitoring_frequency: 'daily',
        feedback_preference: 'real_time',
        quality_standards: 'high'
      },
      conflict: {
        approach: 'problem_solving',
        escalation_threshold: 0.8,
        mediation_acceptance: true,
        learning_from_conflicts: true
      }
    };
  }

  private initializeReputation(): AgentReputation {
    return {
      overall: 0.8, // Default reputation
      components: {
        reliability: 0.8,
        quality: 0.8,
        cooperation: 0.8,
        communication: 0.8,
        innovation: 0.6
      },
      history: [],
      lastUpdate: new Date(),
      trending: 'stable'
    };
  }

  private initializeAvailability(): AgentAvailability {
    return {
      status: 'available',
      capacity: 0.8,
      schedule: [],
      maintenance: [],
      overrides: [],
      lastUpdate: new Date()
    };
  }

  private initializeCommunicationSettings(): CommunicationSettings {
    return {
      protocols: ['http', 'websocket', 'message_queue'],
      encryption: 'tls',
      authentication: 'bearer_token',
      compression: true,
      serialization: 'json',
      timeout: 30000,
      retries: 3
    };
  }

  private initializePerformanceTracking(): PerformanceTracking {
    return {
      metrics: ['response_time', 'success_rate', 'collaboration_score'],
      thresholds: {
        response_time: 5000,
        success_rate: 0.95,
        collaboration_score: 0.8
      },
      alerts: true,
      reporting: 'daily',
      retention: 90 // days
    };
  }

  private initializePerformanceData(): PerformanceData {
    return {
      messages: {
        sent: 0,
        received: 0,
        successful: 0,
        failed: 0,
        average_response_time: 0
      },
      negotiations: {
        initiated: 0,
        completed: 0,
        successful: 0,
        average_duration: 0,
        satisfaction_score: 0
      },
      handoffs: {
        initiated: 0,
        completed: 0,
        successful: 0,
        average_duration: 0,
        quality_score: 0
      },
      conflicts: {
        involved: 0,
        resolved: 0,
        escalated: 0,
        resolution_time: 0
      },
      collaboration: {
        sessions: 0,
        partners: new Set(),
        success_rate: 0,
        reputation_change: 0
      }
    };
  }

  private calculateRoutingPriority(registration: AgentRegistration): number {
    let priority = 0.5; // Base priority
    
    // Adjust based on reputation
    priority += registration.reputation.overall * 0.3;
    
    // Adjust based on availability
    if (registration.availability.status === 'available') priority += 0.2;
    
    // Adjust based on capabilities
    priority += registration.capabilities.supported.length * 0.01;
    
    return Math.min(1.0, priority);
  }

  /**
   * Additional implementation methods (simplified)
   */
  /** Runtime handoffs (e.g. specialist A-061) may fire before explicit bus registration. */
  private async ensureRuntimeAgent(agentId: string): Promise<void> {
    if (!agentId || this.agentRegistry.has(agentId)) return;
    await this.registerAgent({
      id: agentId,
      name: agentId,
      type: 'runtime',
      capabilities: [],
    });
  }

  private async validateMessage(message: A2AMessage): Promise<void> {
    if (!message.fromAgent || !message.toAgent) {
      throw new Error('Message must have valid sender and recipient');
    }

    await this.ensureRuntimeAgent(message.fromAgent);
    const targets = Array.isArray(message.toAgent) ? message.toAgent : [message.toAgent];
    for (const target of targets) {
      await this.ensureRuntimeAgent(target);
    }

    // Additional validation logic...
  }

  private async routeMessage(message: A2AMessage): Promise<RoutingResult> {
    const targetAgents = Array.isArray(message.toAgent) ? message.toAgent : [message.toAgent];
    const routes: string[] = [];
    
    for (const targetAgent of targetAgents) {
      if (this.agentRegistry.has(targetAgent)) {
        routes.push(targetAgent);
        const queue = this.messageQueue.get(targetAgent) || [];
        queue.push(message);
        this.messageQueue.set(targetAgent, queue);
      }
    }
    
    return {
      messageId: message.id,
      routes,
      deliveryTime: new Date(),
      hops: 1,
      success: routes.length > 0
    };
  }

  private async processNegotiationMessage(message: A2AMessage): Promise<ProcessingResult> {
    // Process negotiation-specific message
    return {
      messageId: message.id,
      processingTime: Date.now(),
      result: 'processed',
      actions: ['forwarded_to_negotiation_engine'],
      side_effects: []
    };
  }

  private async processHandoffMessage(message: A2AMessage): Promise<ProcessingResult> {
    // Process handoff-specific message
    return {
      messageId: message.id,
      processingTime: Date.now(),
      result: 'processed',
      actions: ['forwarded_to_handoff_manager'],
      side_effects: []
    };
  }

  private async processEscalationMessage(message: A2AMessage): Promise<ProcessingResult> {
    // Process escalation-specific message
    return {
      messageId: message.id,
      processingTime: Date.now(),
      result: 'escalated',
      actions: ['forwarded_to_conflict_resolver'],
      side_effects: ['priority_increased']
    };
  }

  private async processStandardMessage(message: A2AMessage): Promise<ProcessingResult> {
    // Process standard message
    return {
      messageId: message.id,
      processingTime: Date.now(),
      result: 'delivered',
      actions: ['queued_for_delivery'],
      side_effects: []
    };
  }

  private updateMessagePerformance(message: A2AMessage, result: ProcessingResult): void {
    const senderMetrics = this.performanceMetrics.get(message.fromAgent);
    if (senderMetrics) {
      senderMetrics.messages.sent++;
      if (result.result === 'delivered' || result.result === 'processed') {
        senderMetrics.messages.successful++;
      } else {
        senderMetrics.messages.failed++;
      }
    }
  }

  private recordCollaboration(message: A2AMessage, result: ProcessingResult): void {
    const record: CollaborationRecord = {
      id: uuidv4(),
      type: 'message',
      participants: [message.fromAgent, ...(Array.isArray(message.toAgent) ? message.toAgent : [message.toAgent])],
      timestamp: new Date(),
      outcome: result.result,
      metrics: {
        processing_time: result.processingTime,
        success: result.result === 'delivered' || result.result === 'processed'
      }
    };

    const history = this.collaborationHistory.get(message.fromAgent) || [];
    history.push(record);
    this.collaborationHistory.set(message.fromAgent, history);
  }

  private calculateMessageMetrics(message: A2AMessage, result: ProcessingResult): MessageMetrics {
    return {
      latency: result.processingTime,
      hops: message.routing.hops,
      success: result.result === 'delivered' || result.result === 'processed',
      retries: 0,
      bandwidth: JSON.stringify(message).length
    };
  }

  private async deliverMessage(message: A2AMessage, targetAgentId: string): Promise<void> {
    logger.info(`📬 Delivering message ${message.id} to agent ${targetAgentId}`);
    
    try {
      // TTL check
      if (message.ttl && message.timestamp) {
        const elapsed = Date.now() - message.timestamp.getTime();
        if (elapsed > message.ttl) {
          logger.warn(`⏰ Message ${message.id} expired (TTL: ${message.ttl}ms)`);
          return;
        }
      }

      // Authorization check
      if (!this.isAuthorized(message, targetAgentId)) {
        logger.warn(`🔒 Message ${message.id} unauthorized for agent ${targetAgentId}`);
        return;
      }

      // Hops limit check
      if (message.routing.hops >= message.routing.maxHops) {
        logger.warn(`🔄 Message ${message.id} exceeded max hops (${message.routing.maxHops})`);
        return;
      }

      // Deliver to subscribers
      const handlers = this.subscribers.get(targetAgentId) || [];
      for (const handler of handlers) {
        try {
          await handler(message);
        } catch (error: any) {
          logger.error(`❌ Handler error for agent ${targetAgentId}:`, error);
        }
      }

      // Handle correlated responses for request/response pattern
      this.handleCorrelatedResponse(message);

      // Mark as delivered in storage
      await (this.storage as any).markA2AMessageDelivered(message.id);
      
      this.emit('message:delivered', { message, targetAgentId });
    } catch (error: any) {
      logger.error('❌ Message delivery failed:', error instanceof Error ? error.message : String(error));
    }
  }

  private calculateAgentPerformance(registration: AgentRegistration, metrics: PerformanceData): void {
    // Calculate and update agent performance metrics
    const totalMessages = metrics.messages.sent + metrics.messages.received;
    const successRate = totalMessages > 0 ? metrics.messages.successful / totalMessages : 1.0;
    
    // Update reputation based on performance
    registration.reputation.components.reliability = successRate;
    registration.reputation.overall = Object.values(registration.reputation.components)
      .reduce((sum, value) => sum + value, 0) / Object.keys(registration.reputation.components).length;
  }

  // Additional placeholder methods
  private async notifyNegotiationParticipants(session: NegotiationSession): Promise<void> {
    // Notify all participants about negotiation start
  }

  private async notifyConflictResolution(conflict: Conflict, resolution: ConflictResolution): Promise<void> {
    // Notify involved parties about conflict resolution
  }

  private updateAgentRelationships(conflict: Conflict, resolution: ConflictResolution): void {
    // Update trust scores and relationships based on conflict resolution
  }

  /**
   * Public interface methods
   */
  public getHealthStatusLegacy(): any {
    return {
      status: 'healthy',
      version: this.version,
      registeredAgents: this.agentRegistry.size,
      activeNegotiations: this.activeNegotiations.size,
      activeHandoffs: this.activeHandoffs.size,
      messageQueues: Array.from(this.messageQueue.values()).reduce((sum, queue) => sum + queue.length, 0),
      totalMessages: Array.from(this.performanceMetrics.values())
        .reduce((sum, metrics) => sum + metrics.messages.sent + metrics.messages.received, 0)
    };
  }

  public getAgentRegistration(agentId: string): AgentRegistration | undefined {
    return this.agentRegistry.get(agentId);
  }

  public getNegotiationSession(sessionId: string): NegotiationSession | undefined {
    return this.activeNegotiations.get(sessionId);
  }

  public getTaskHandoff(handoffId: string): TaskHandoff | undefined {
    return this.activeHandoffs.get(handoffId);
  }

  // ================================================================================================
  // CONCRETE IMPLEMENTATION METHODS (Storage Integrated)
  // ================================================================================================

  /**
   * Send message with storage persistence (concrete implementation)
   * Unified entry point that uses existing validation/routing pipeline
   */
  public async send(message: A2AMessage): Promise<any> {
    logger.info(`📤 Sending A2A message from ${message.fromAgent} to ${message.toAgent}`);
    
    try {
      // Provide routing defaults to prevent runtime errors
      const defaultRouting: RoutingInfo = {
        path: [],
        hops: 0,
        maxHops: 5,
        broadcast: false,
        multicast: false,
        failover: false,
        retryPolicy: {
          maxRetries: 3,
          baseDelay: 1000,
          maxDelay: 5000,
          backoffStrategy: 'exponential',
          jitter: true,
          circuitBreaker: false
        }
      };

      // Provide security defaults
      const defaultSecurity: SecurityContext = {
        authenticated: true,
        authorized: true,
        encryptionLevel: 'basic',
        accessLevel: 'internal'
      };

      // Enhance message with safe defaults and required fields
      const enhancedMessage: A2AMessage = {
        ...message,
        id: message.id || uuidv4(),
        timestamp: new Date(),
        ttl: message.ttl || 300000, // 5 minutes default
        routing: { ...defaultRouting, ...message.routing },
        security: { ...defaultSecurity, ...message.security }
      };

      // Security check at entry point
      if (!this.isAuthorized(enhancedMessage, enhancedMessage.fromAgent)) {
        throw new Error(`Message unauthorized for sender ${enhancedMessage.fromAgent}`);
      }

      // Use existing validation pipeline
      await this.validateMessage(enhancedMessage);

      // Use existing routing pipeline  
      const routingResult = await this.routeMessage(enhancedMessage);

      // Persist to storage after validation
      const storedMessage = await (this.storage as any).createA2AMessage(enhancedMessage);

      this.emit('message:sent', storedMessage);
      return { message: storedMessage, routing: routingResult };
    } catch (error: any) {
      logger.error('❌ A2A send failed:', error instanceof Error ? error.message : String(error));
      throw error;
    }
  }

  /**
   * Request with correlation and timeout (concrete implementation)
   * Complete correlation handling with proper cleanup
   */
  public async request(message: A2AMessage, options: { timeout?: number } = {}): Promise<any> {
    const correlationId = uuidv4();
    const timeout = options.timeout || 30000; // 30 seconds default

    const requestMessage = {
      ...message,
      id: uuidv4(),
      type: 'request' as const,
      metadata: {
        ...message.metadata,
        correlationId,
        expectedResponseTime: timeout,
        replyTo: message.fromAgent
      }
    };

    // Store Promise resolver in correlation map for proper cleanup
    return new Promise((resolve, reject) => {
      const timeoutHandle = setTimeout(() => {
        this.correlationMap.delete(correlationId);
        reject(new Error(`Request timeout after ${timeout}ms`));
      }, timeout);

      // Store resolver for response handling
      this.correlationMap.set(correlationId, {
        resolve,
        reject,
        timeoutHandle,
        fromAgent: requestMessage.fromAgent
      });

      // Send the request
      this.send(requestMessage).catch((error) => {
        clearTimeout(timeoutHandle);
        this.correlationMap.delete(correlationId);
        reject(error);
      });
    });
  }

  /**
   * Handle response messages with correlation
   */
  private handleCorrelatedResponse(message: A2AMessage): void {
    if (message.type === 'response' && message.metadata.correlationId) {
      const correlation = this.correlationMap.get(message.metadata.correlationId);
      if (correlation && typeof correlation === 'object') {
        clearTimeout(correlation.timeoutHandle);
        this.correlationMap.delete(message.metadata.correlationId);
        correlation.resolve(message);
      }
    }
  }

  /**
   * Subscribe to messages (concrete implementation)
   */
  public subscribe(agentId: string, handler: Function): void {
    logger.info(`📡 Agent ${agentId} subscribing to messages`);
    
    const handlers = this.subscribers.get(agentId) || [];
    handlers.push(handler);
    this.subscribers.set(agentId, handlers);

    // Process any queued messages
    this.processQueuedMessages(agentId);
  }

  /**
   * Broadcast to multiple agents (concrete implementation)
   * Fixed fan-out with per-recipient cloning to avoid shared state
   */
  public async broadcast(message: A2AMessage, filter?: (agentId: string) => boolean): Promise<any[]> {
    const allAgents = Array.from(this.agentRegistry.keys());
    const targetAgents = filter ? allAgents.filter(filter) : allAgents;

    const results = [];
    
    // Create individual message per recipient to avoid shared state
    for (const agentId of targetAgents) {
      const recipientMessage: A2AMessage = {
        ...message,
        id: uuidv4(), // Unique ID per recipient
        toAgent: agentId, // Single recipient
        routing: {
          ...message.routing,
          broadcast: true,
          path: [...(message.routing.path || []), agentId], // Individual path tracking
          hops: 0 // Reset hops for each recipient
        },
        metadata: {
          ...message.metadata,
          replyTo: message.fromAgent // Ensure proper reply routing
        }
      };

      try {
        const result = await this.send(recipientMessage);
        results.push(result);
      } catch (error: any) {
        logger.error(`❌ Broadcast failed for agent ${agentId}:`, error);
        results.push({ error: error.message, agentId });
      }
    }

    return results;
  }


  /**
   * Negotiate between agents (concrete implementation)
   */
  public async negotiate(sessionSpec: any): Promise<any> {
    const negotiationId = uuidv4();
    logger.info(`🤝 Starting negotiation session: ${negotiationId}`);

    const negotiation = {
      id: negotiationId,
      participants: sessionSpec.participants || [],
      subject: sessionSpec.subject,
      status: 'active',
      createdAt: new Date(),
      exchanges: []
    };

    // Store in memory and persistent storage
    this.activeNegotiations.set(negotiationId, negotiation as any);
    const storedNegotiation = await (this.storage as any).createNegotiation(negotiation as any);

    this.emit('negotiation:started', storedNegotiation);
    return storedNegotiation;
  }

  /**
   * Process queued messages for an agent
   */
  private async processQueuedMessages(agentId: string): Promise<void> {
    const queue = this.messageQueue.get(agentId) || [];
    for (const message of queue) {
      await (this as any).deliver(message, agentId);
    }
    // Clear processed messages
    this.messageQueue.set(agentId, []);
  }

  /**
   * Check if message is authorized for agent
   */
  private isAuthorized(message: A2AMessage, agentId: string): boolean {
    // Simple authorization check - can be enhanced
    const agentRegistration = this.agentRegistry.get(agentId);
    if (!agentRegistration) return false;
    
    // Check access levels
    const messageAccessLevel = message.security.accessLevel;
    const agentClearance = (agentRegistration.capabilities as any).security_clearance || 'public';
    
    const accessLevels = ['public', 'internal', 'confidential', 'secret'];
    const messageLevel = accessLevels.indexOf(messageAccessLevel);
    const agentLevel = accessLevels.indexOf(agentClearance);
    
    return agentLevel >= messageLevel;
  }

  /**
   * Health status with storage integration
   */
  public getHealthStatus(): any {
    return {
      status: 'healthy',
      version: this.version,
      registeredAgents: this.agentRegistry.size,
      activeNegotiations: this.activeNegotiations.size,
      activeHandoffs: this.activeHandoffs.size,
      messageQueueSize: Array.from(this.messageQueue.values()).reduce((total, queue) => total + queue.length, 0),
      subscribers: this.subscribers.size,
      correlationMap: this.correlationMap.size,
      storageIntegration: this.storage ? 'connected' : 'disconnected',
      uptime: Date.now()
    };
  }
}

// Supporting classes (simplified implementations)
class ConflictResolver {
  async resolve(conflict: Conflict): Promise<ConflictResolution> {
    return {
      status: 'resolved',
      method: 'negotiation',
      resolver: 'system',
      timeline: 300000, // 5 minutes
      outcome: 'mutually_acceptable_solution'
    };
  }
}

class NegotiationEngine {
  async createSession(request: NegotiationRequest): Promise<NegotiationSession> {
    return {
      id: `negotiation-${uuidv4()}`,
      type: 'bilateral',
      participants: [],
      subject: request.subject,
      protocol: request.protocol,
      state: {
        phase: 'initialization',
        round: 0,
        currentOffer: {} as Offer,
        bestOffer: {} as Offer,
        proposals: [],
        agreements: [],
        conflicts: [],
        progress: 0
      },
      history: []
    };
  }

  async startNegotiation(session: NegotiationSession): Promise<void> {
    session.state.phase = 'bidding';
  }
}

class HandoffManager {
  async createHandoff(request: HandoffRequest): Promise<TaskHandoff> {
    return {
      id: `handoff-${uuidv4()}`,
      type: 'delegation',
      fromAgent: request.fromAgent,
      toAgent: request.toAgent,
      task: request.task,
      context: request.context,
      requirements: request.requirements || [],
      agreements: [],
      monitoring: {
        enabled: true,
        frequency: 60000,
        metrics: [],
        alerts: [],
        reporting: {
          frequency: 'daily',
          recipients: [request.fromAgent, request.toAgent],
          format: 'summary',
          automation: true
        },
        feedback: {
          collection: 'automatic',
          processing: 'immediate',
          analysis: 'basic',
          action: 'notification'
        }
      },
      status: {
        phase: 'initiated',
        progress: 0,
        health: 'healthy',
        metrics: [],
        issues: [],
        notifications: []
      }
    };
  }

  async executeHandoff(handoff: TaskHandoff): Promise<void> {
    handoff.status.phase = 'transferring';
  }
}

// Additional interfaces
interface AgentRegistration {
  agentId: string;
  name: string;
  type: string;
  capabilities: CollaborationCapabilities;
  preferences: CollaborationPreferences;
  reputation: AgentReputation;
  availability: AgentAvailability;
  communication: CommunicationSettings;
  performance: PerformanceTracking;
  registrationTime: Date;
  lastActivity: Date;
}

interface CollaborationCapabilities {
  supported: string[];
  preferences: Record<string, string>;
  constraints: Record<string, any>;
  specializations: string[];
}

interface CollaborationPreferences {
  communication: any;
  negotiation: any;
  handoff: any;
  conflict: any;
}

interface AgentReputation {
  overall: number;
  components: Record<string, number>;
  history: any[];
  lastUpdate: Date;
  trending: string;
}

interface AgentAvailability {
  status: string;
  capacity: number;
  schedule: any[];
  maintenance: any[];
  overrides: any[];
  lastUpdate: Date;
}

interface CommunicationSettings {
  protocols: string[];
  encryption: string;
  authentication: string;
  compression: boolean;
  serialization: string;
  timeout: number;
  retries: number;
}

interface PerformanceTracking {
  metrics: string[];
  thresholds: Record<string, number>;
  alerts: boolean;
  reporting: string;
  retention: number;
}

interface PerformanceData {
  messages: any;
  negotiations: any;
  handoffs: any;
  conflicts: any;
  collaboration: any;
}

interface RoutingEntry {
  agentId: string;
  address: string;
  capabilities: string[];
  priority: number;
  availability: string;
  lastUpdate: Date;
}

interface CollaborationRecord {
  id: string;
  type: string;
  participants: string[];
  timestamp: Date;
  outcome: string;
  metrics: any;
}

interface MessageResult {
  messageId: string;
  status: string;
  routing: RoutingResult;
  processing: ProcessingResult;
  timestamp: Date;
  metrics: MessageMetrics;
}

interface RoutingResult {
  messageId: string;
  routes: string[];
  deliveryTime: Date;
  hops: number;
  success: boolean;
}

interface ProcessingResult {
  messageId: string;
  processingTime: number;
  result: string;
  actions: string[];
  side_effects: string[];
}

interface MessageMetrics {
  latency: number;
  hops: number;
  success: boolean;
  retries: number;
  bandwidth: number;
}

interface NegotiationRequest {
  subject: NegotiationSubject;
  protocol: NegotiationProtocol;
  participants: string[];
  deadline?: Date;
  mediator?: string;
}

interface HandoffRequest {
  fromAgent: string;
  toAgent: string;
  task: HandoffTask;
  context: HandoffContext;
  requirements?: HandoffRequirement[];
}

export default A2ACollaborationBus;

/** Process-wide bus for Queen INTENT + specialist handoff (same in-memory store). */
let _sharedA2aBus: A2ACollaborationBus | null = null;

export function getSharedA2ABus(): A2ACollaborationBus {
  if (!_sharedA2aBus) {
    _sharedA2aBus = new A2ACollaborationBus({
      coreConfig: { agents: [], maxConcurrency: 20 },
      storage: { get: async () => null, set: async () => {}, delete: async () => {} },
    });
  }
  return _sharedA2aBus;
}