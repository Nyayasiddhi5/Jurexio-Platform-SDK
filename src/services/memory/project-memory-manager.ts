import { EventEmitter } from 'events';
import WebSocket from 'ws';
import { createLogger } from '../../utils/logger.js';


const logger = createLogger('project-memory-manager');

export interface ProjectMemoryContext {
  projectId: number;
  projectName: string;
  createdAt: Date;
  lastAccessed: Date;
  memoryStore: ProjectMemoryStore;
  agentContexts: Map<string, AgentMemoryContext>;
  sharedContext: SharedProjectContext;
  conversationHistory: ConversationEntry[];
  codebaseMemory: CodebaseMemory;
  documentMemory: DocumentMemory;
  persistenceSettings: MemoryPersistenceSettings;
}

export interface ProjectMemoryStore {
  shortTermMemory: Map<string, MemoryEntry>;
  longTermMemory: Map<string, MemoryEntry>;
  workingMemory: Map<string, any>;
  semanticMemory: Map<string, SemanticMemoryEntry>;
  episodicMemory: MemoryEntry[];
}

export interface AgentMemoryContext {
  agentId: string;
  agentType: string;
  projectId: number;
  personalMemory: Map<string, any>;
  taskHistory: TaskMemoryEntry[];
  learnedPatterns: LearnedPattern[];
  preferences: AgentPreferences;
  workingContext: WorkingContext;
  collaborationMemory: CollaborationMemory;
  lastActivity: Date;
}

export interface SharedProjectContext {
  requirements: RequirementsMemory;
  architecture: ArchitectureMemory;
  decisions: DecisionMemory[];
  constraints: ConstraintMemory[];
  stakeholders: StakeholderMemory[];
  timeline: TimelineMemory;
  resources: ResourceMemory;
}

export interface MemoryEntry {
  id: string;
  content: any;
  type: 'fact' | 'instruction' | 'constraint' | 'preference' | 'context' | 'decision';
  importance: number;
  confidence: number;
  source: string;
  createdAt: Date;
  lastAccessed: Date;
  expiryDate?: Date;
  tags: string[];
  relationships: string[];
}

export interface SemanticMemoryEntry {
  concept: string;
  description: string;
  examples: string[];
  relationships: string[];
  confidence: number;
  usageCount: number;
  lastUsed: Date;
}

export interface TaskMemoryEntry {
  taskId: string;
  agentId: string;
  startTime: Date;
  endTime?: Date;
  status: 'active' | 'completed' | 'failed' | 'paused';
  actions: ActionMemory[];
  learnings: string[];
  challenges: string[];
  solutions: string[];
  codeChanges: CodeChangeMemory[];
  collaborations: CollaborationEntry[];
}

export interface ActionMemory {
  action: string;
  timestamp: Date;
  context: any;
  result: any;
  success: boolean;
  duration: number;
}

export interface LearnedPattern {
  pattern: string;
  context: string;
  frequency: number;
  effectiveness: number;
  lastUsed: Date;
  examples: string[];
}

export interface AgentPreferences {
  codingStyle: Record<string, any>;
  communicationStyle: string;
  workflowPreferences: string[];
  toolPreferences: string[];
  collaborationStyle: string;
}

export interface WorkingContext {
  currentTask?: string;
  activeFiles: string[];
  recentActions: string[];
  currentThought: string;
  nextSteps: string[];
  blockers: string[];
  dependencies: string[];
}

export interface CollaborationMemory {
  partnerships: Map<string, PartnershipMemory>;
  sharedKnowledge: Map<string, any>;
  communicationPatterns: CommunicationPattern[];
  conflictResolutions: ConflictResolution[];
}

export interface PartnershipMemory {
  partnerAgentId: string;
  collaborationHistory: CollaborationEntry[];
  effectiveness: number;
  preferredMethods: string[];
  commonTasks: string[];
}

export interface CollaborationEntry {
  timestamp: Date;
  participants: string[];
  task: string;
  outcome: string;
  effectiveness: number;
  method: string;
}

export interface CommunicationPattern {
  pattern: string;
  effectiveness: number;
  context: string;
  frequency: number;
}

export interface ConflictResolution {
  conflictType: string;
  resolution: string;
  effectiveness: number;
  timestamp: Date;
  participants: string[];
}

export interface RequirementsMemory {
  functional: string[];
  nonFunctional: string[];
  constraints: string[];
  assumptions: string[];
  risks: string[];
  changes: RequirementChange[];
}

export interface RequirementChange {
  change: string;
  reason: string;
  impact: string;
  timestamp: Date;
  approvedBy: string;
}

export interface ArchitectureMemory {
  patterns: string[];
  technologies: string[];
  decisions: ArchitecturalDecision[];
  diagrams: string[];
  dependencies: string[];
  integrations: string[];
}

export interface ArchitecturalDecision {
  decision: string;
  rationale: string;
  alternatives: string[];
  consequences: string[];
  timestamp: Date;
  decidedBy: string;
}

export interface DecisionMemory {
  decision: string;
  context: string;
  rationale: string;
  alternatives: string[];
  impact: string;
  timestamp: Date;
  decidedBy: string;
  status: 'active' | 'deprecated' | 'changed';
}

export interface ConstraintMemory {
  type: 'technical' | 'business' | 'resource' | 'time' | 'regulatory';
  constraint: string;
  impact: string;
  workarounds: string[];
  timestamp: Date;
  source: string;
}

export interface StakeholderMemory {
  name: string;
  role: string;
  interests: string[];
  concerns: string[];
  preferences: string[];
  communicationStyle: string;
  influence: number;
}

export interface TimelineMemory {
  milestones: Milestone[];
  deadlines: Deadline[];
  estimates: EstimateMemory[];
  actualProgress: ProgressMemory[];
}

export interface Milestone {
  name: string;
  date: Date;
  status: 'pending' | 'completed' | 'delayed' | 'cancelled';
  deliverables: string[];
  dependencies: string[];
}

export interface Deadline {
  task: string;
  dueDate: Date;
  priority: 'low' | 'medium' | 'high' | 'critical';
  buffer: number;
  status: 'on_track' | 'at_risk' | 'overdue' | 'completed';
}

export interface EstimateMemory {
  task: string;
  originalEstimate: number;
  revisedEstimate?: number;
  actualTime?: number;
  accuracy: number;
  estimatedBy: string;
}

export interface ProgressMemory {
  date: Date;
  completedTasks: string[];
  blockers: string[];
  velocity: number;
  burndownData: number;
}

export interface ResourceMemory {
  agents: AgentResourceMemory[];
  tools: ToolResourceMemory[];
  services: ServiceResourceMemory[];
  budgets: BudgetMemory[];
}

export interface AgentResourceMemory {
  agentId: string;
  availability: number;
  skills: string[];
  currentLoad: number;
  efficiency: number;
  specializations: string[];
}

export interface ToolResourceMemory {
  toolName: string;
  usage: number;
  effectiveness: number;
  cost: number;
  limitations: string[];
}

export interface ServiceResourceMemory {
  serviceName: string;
  usage: number;
  cost: number;
  reliability: number;
  limitations: string[];
}

export interface BudgetMemory {
  category: string;
  allocated: number;
  spent: number;
  projected: number;
  alerts: string[];
}

export interface CodebaseMemory {
  files: Map<string, FileMemory>;
  modules: Map<string, ModuleMemory>;
  patterns: CodePatternMemory[];
  refactorings: RefactoringMemory[];
  testCoverage: TestCoverageMemory;
  dependencies: DependencyMemory[];
}

export interface FileMemory {
  path: string;
  lastModified: Date;
  modifiedBy: string[];
  complexity: number;
  testCoverage: number;
  dependencies: string[];
  purpose: string;
  keyFunctions: string[];
}

export interface ModuleMemory {
  name: string;
  purpose: string;
  interfaces: string[];
  dependencies: string[];
  stability: number;
  complexity: number;
}

export interface CodePatternMemory {
  pattern: string;
  frequency: number;
  effectiveness: number;
  context: string;
  examples: string[];
}

export interface RefactoringMemory {
  description: string;
  reason: string;
  impact: string;
  timestamp: Date;
  performedBy: string;
  filesAffected: string[];
}

export interface TestCoverageMemory {
  overall: number;
  byModule: Map<string, number>;
  gaps: string[];
  trends: CoverageTrend[];
}

export interface CoverageTrend {
  date: Date;
  coverage: number;
  delta: number;
}

export interface DependencyMemory {
  name: string;
  version: string;
  purpose: string;
  risk: number;
  alternatives: string[];
  updateHistory: DependencyUpdate[];
}

export interface DependencyUpdate {
  fromVersion: string;
  toVersion: string;
  date: Date;
  reason: string;
  impact: string;
}

export interface DocumentMemory {
  documents: Map<string, DocumentEntry>;
  knowledge: Map<string, KnowledgeEntry>;
  references: Map<string, ReferenceEntry>;
  glossary: Map<string, GlossaryEntry>;
}

export interface DocumentEntry {
  id: string;
  title: string;
  type: 'requirement' | 'design' | 'api' | 'user_guide' | 'technical' | 'meeting_notes';
  content: string;
  lastUpdated: Date;
  updatedBy: string;
  version: number;
  tags: string[];
  references: string[];
}

export interface KnowledgeEntry {
  topic: string;
  summary: string;
  details: string;
  sources: string[];
  confidence: number;
  lastValidated: Date;
  relatedTopics: string[];
}

export interface ReferenceEntry {
  title: string;
  url: string;
  type: 'article' | 'documentation' | 'tutorial' | 'example' | 'specification';
  relevance: number;
  lastAccessed: Date;
  summary: string;
}

export interface GlossaryEntry {
  term: string;
  definition: string;
  context: string;
  examples: string[];
  relatedTerms: string[];
}

export interface CodeChangeMemory {
  file: string;
  changeType: 'create' | 'modify' | 'delete' | 'rename';
  description: string;
  linesAdded: number;
  linesRemoved: number;
  timestamp: Date;
  reason: string;
  impact: string;
}

export interface MemoryPersistenceSettings {
  autoSave: boolean;
  saveInterval: number;
  compressionEnabled: boolean;
  retentionPolicy: RetentionPolicy;
  backupSettings: BackupSettings;
}

export interface RetentionPolicy {
  shortTermDays: number;
  longTermDays: number;
  importanceThreshold: number;
  accessFrequencyThreshold: number;
}

export interface BackupSettings {
  enabled: boolean;
  frequency: 'daily' | 'weekly' | 'monthly';
  maxBackups: number;
  cloudBackup: boolean;
}

interface ConversationEntry {
  id: string;
  timestamp: Date;
  role: string;
  content: string;
  metadata?: Record<string, any>;
}

export class ProjectMemoryManager extends EventEmitter {
  private projectMemories: Map<number, ProjectMemoryContext> = new Map();
  private websocketConnections: Map<number, WebSocket[]> = new Map();
  private saveTimer?: NodeJS.Timeout;
  private memoryOptimizer?: NodeJS.Timeout;

  constructor() {
    super();
    this.startPeriodicSave();
    this.startMemoryOptimization();
    logger.info('🧠 Jurexio Project Memory Manager initialized');
  }

  async createProjectMemory(projectId: number, projectName: string): Promise<ProjectMemoryContext> {
    logger.info(`🧠 Creating memory context for project: ${projectName} (ID: ${projectId})`);

    const memoryContext: ProjectMemoryContext = {
      projectId,
      projectName,
      createdAt: new Date(),
      lastAccessed: new Date(),
      memoryStore: {
        shortTermMemory: new Map(),
        longTermMemory: new Map(),
        workingMemory: new Map(),
        semanticMemory: new Map(),
        episodicMemory: []
      },
      agentContexts: new Map(),
      sharedContext: this.initializeSharedContext(),
      conversationHistory: [],
      codebaseMemory: this.initializeCodebaseMemory(),
      documentMemory: this.initializeDocumentMemory(),
      persistenceSettings: this.getDefaultPersistenceSettings()
    };

    this.projectMemories.set(projectId, memoryContext);

    await this.storeMemory(projectId, {
      id: `project_creation_${Date.now()}`,
      content: {
        action: 'project_created',
        projectName,
        timestamp: new Date()
      },
      type: 'fact',
      importance: 10,
      confidence: 1.0,
      source: 'system',
      createdAt: new Date(),
      lastAccessed: new Date(),
      tags: ['project_lifecycle', 'creation'],
      relationships: []
    });

    this.emit('project_memory_created', {
      projectId,
      projectName,
      timestamp: new Date()
    });

    return memoryContext;
  }

  async registerAgentForProject(projectId: number, agentId: string, agentType: string): Promise<void> {
    const projectMemory = this.projectMemories.get(projectId);
    if (!projectMemory) {
      throw new Error(`Project memory not found for project ${projectId}`);
    }

    const agentContext: AgentMemoryContext = {
      agentId,
      agentType,
      projectId,
      personalMemory: new Map(),
      taskHistory: [],
      learnedPatterns: [],
      preferences: this.getDefaultAgentPreferences(),
      workingContext: {
        activeFiles: [],
        recentActions: [],
        currentThought: '',
        nextSteps: [],
        blockers: [],
        dependencies: []
      },
      collaborationMemory: {
        partnerships: new Map(),
        sharedKnowledge: new Map(),
        communicationPatterns: [],
        conflictResolutions: []
      },
      lastActivity: new Date()
    };

    projectMemory.agentContexts.set(agentId, agentContext);

    await this.storeMemory(projectId, {
      id: `agent_registration_${agentId}_${Date.now()}`,
      content: {
        action: 'agent_registered',
        agentId,
        agentType,
        timestamp: new Date()
      },
      type: 'fact',
      importance: 8,
      confidence: 1.0,
      source: 'system',
      createdAt: new Date(),
      lastAccessed: new Date(),
      tags: ['agent_lifecycle', 'registration'],
      relationships: []
    });

    logger.info(`🤖 Registered agent ${agentId} (${agentType}) for project ${projectId}`);
  }

  async storeMemory(projectId: number, memory: MemoryEntry, memoryType: 'short' | 'long' | 'working' = 'long'): Promise<void> {
    const projectMemory = this.projectMemories.get(projectId);
    if (!projectMemory) return;

    const targetStore = this.getMemoryStore(projectMemory.memoryStore, memoryType);
    targetStore.set(memory.id, memory);

    if (memory.type === 'fact' && memory.content.action) {
      projectMemory.memoryStore.episodicMemory.push(memory);
    }

    projectMemory.lastAccessed = new Date();

    this.emit('memory_stored', {
      projectId,
      memoryId: memory.id,
      memoryType,
      importance: memory.importance
    });
  }

  async retrieveMemory(projectId: number, memoryId: string): Promise<MemoryEntry | undefined> {
    const projectMemory = this.projectMemories.get(projectId);
    if (!projectMemory) return undefined;

    const stores = [
      projectMemory.memoryStore.shortTermMemory,
      projectMemory.memoryStore.longTermMemory,
      projectMemory.memoryStore.workingMemory
    ];

    for (const store of stores) {
      const memory = store.get(memoryId);
      if (memory) {
        memory.lastAccessed = new Date();
        return memory;
      }
    }

    return undefined;
  }

  async searchMemories(projectId: number, query: string, options: {
    memoryTypes?: string[];
    tags?: string[];
    importance?: number;
    limit?: number;
  } = {}): Promise<MemoryEntry[]> {
    const projectMemory = this.projectMemories.get(projectId);
    if (!projectMemory) return [];

    const allMemories: MemoryEntry[] = [];
    
    const stores = [
      projectMemory.memoryStore.shortTermMemory,
      projectMemory.memoryStore.longTermMemory,
      projectMemory.memoryStore.workingMemory
    ];

    stores.forEach(store => {
      allMemories.push(...Array.from(store.values()));
    });

    let results = allMemories.filter(memory => {
      if (options.memoryTypes && !options.memoryTypes.includes(memory.type)) {
        return false;
      }

      if (options.tags && !options.tags.some(tag => memory.tags.includes(tag))) {
        return false;
      }

      if (options.importance && memory.importance < options.importance) {
        return false;
      }

      const searchText = JSON.stringify(memory.content).toLowerCase();
      return searchText.includes(query.toLowerCase());
    });

    results.sort((a, b) => {
      const scoreA = a.importance + (Date.now() - a.lastAccessed.getTime()) / (1000 * 60 * 60 * 24);
      const scoreB = b.importance + (Date.now() - b.lastAccessed.getTime()) / (1000 * 60 * 60 * 24);
      return scoreB - scoreA;
    });

    if (options.limit) {
      results = results.slice(0, options.limit);
    }

    return results;
  }

  async recordAgentActivity(projectId: number, agentId: string, activity: {
    action: string;
    context: any;
    result?: any;
    duration?: number;
    success?: boolean;
  }): Promise<void> {
    const projectMemory = this.projectMemories.get(projectId);
    const agentContext = projectMemory?.agentContexts.get(agentId);
    
    if (!projectMemory || !agentContext) return;

    agentContext.workingContext.recentActions.unshift(activity.action);
    if (agentContext.workingContext.recentActions.length > 10) {
      agentContext.workingContext.recentActions.pop();
    }
    agentContext.lastActivity = new Date();

    await this.storeMemory(projectId, {
      id: `activity_${agentId}_${Date.now()}`,
      content: {
        agentId,
        activity,
        timestamp: new Date()
      },
      type: 'fact',
      importance: 5,
      confidence: 1.0,
      source: agentId,
      createdAt: new Date(),
      lastAccessed: new Date(),
      tags: ['agent_activity', agentContext.agentType],
      relationships: []
    }, 'short');

    await this.learnPattern(agentContext, activity);
  }

  async recordTaskCompletion(projectId: number, agentId: string, taskId: string, details: {
    startTime: Date;
    endTime: Date;
    status: 'completed' | 'failed';
    actions: ActionMemory[];
    learnings: string[];
    challenges: string[];
    solutions: string[];
    codeChanges: CodeChangeMemory[];
  }): Promise<void> {
    const projectMemory = this.projectMemories.get(projectId);
    const agentContext = projectMemory?.agentContexts.get(agentId);
    
    if (!projectMemory || !agentContext) return;

    const taskMemory: TaskMemoryEntry = {
      taskId,
      agentId,
      startTime: details.startTime,
      endTime: details.endTime,
      status: details.status,
      actions: details.actions,
      learnings: details.learnings,
      challenges: details.challenges,
      solutions: details.solutions,
      codeChanges: details.codeChanges,
      collaborations: []
    };

    agentContext.taskHistory.push(taskMemory);

    await this.storeMemory(projectId, {
      id: `task_completion_${taskId}_${Date.now()}`,
      content: taskMemory,
      type: 'fact',
      importance: 8,
      confidence: 1.0,
      source: agentId,
      createdAt: new Date(),
      lastAccessed: new Date(),
      tags: ['task_completion', 'productivity'],
      relationships: []
    });

    await this.updateCodebaseMemory(projectId, details.codeChanges);

    logger.info(`📝 Recorded task completion: ${taskId} by ${agentId}`);
  }

  private async learnPattern(agentContext: AgentMemoryContext, activity: any): Promise<void> {
    const pattern = activity.action;
    const context = JSON.stringify(activity.context);

    const existingPattern = agentContext.learnedPatterns.find(p => p.pattern === pattern && p.context === context);

    if (existingPattern) {
      existingPattern.frequency++;
      existingPattern.lastUsed = new Date();
      if (activity.success !== false) {
        existingPattern.effectiveness = Math.min(1.0, existingPattern.effectiveness + 0.1);
      }
    } else {
      agentContext.learnedPatterns.push({
        pattern,
        context,
        frequency: 1,
        effectiveness: activity.success !== false ? 0.7 : 0.3,
        lastUsed: new Date(),
        examples: [JSON.stringify(activity)]
      });
    }
  }

  private async updateCodebaseMemory(projectId: number, codeChanges: CodeChangeMemory[]): Promise<void> {
    const projectMemory = this.projectMemories.get(projectId);
    if (!projectMemory) return;

    codeChanges.forEach(change => {
      const fileMemory = projectMemory.codebaseMemory.files.get(change.file);
      
      if (fileMemory) {
        fileMemory.lastModified = change.timestamp;
        if (!fileMemory.modifiedBy.includes(change.reason)) {
          fileMemory.modifiedBy.push(change.reason);
        }
      } else {
        projectMemory.codebaseMemory.files.set(change.file, {
          path: change.file,
          lastModified: change.timestamp,
          modifiedBy: [change.reason],
          complexity: 1,
          testCoverage: 0,
          dependencies: [],
          purpose: '',
          keyFunctions: []
        });
      }
    });
  }

  getAgentContext(projectId: number, agentId: string): AgentMemoryContext | undefined {
    const projectMemory = this.projectMemories.get(projectId);
    return projectMemory?.agentContexts.get(agentId);
  }

  getProjectMemorySummary(projectId: number): any {
    const projectMemory = this.projectMemories.get(projectId);
    if (!projectMemory) return null;

    return {
      projectId,
      projectName: projectMemory.projectName,
      createdAt: projectMemory.createdAt,
      lastAccessed: projectMemory.lastAccessed,
      totalMemories: projectMemory.memoryStore.longTermMemory.size + 
                    projectMemory.memoryStore.shortTermMemory.size + 
                    projectMemory.memoryStore.workingMemory.size,
      activeAgents: projectMemory.agentContexts.size,
      conversationEntries: projectMemory.conversationHistory.length,
      codeFiles: projectMemory.codebaseMemory.files.size,
      documents: projectMemory.documentMemory.documents.size
    };
  }

  private getMemoryStore(memoryStore: ProjectMemoryStore, type: string): Map<string, MemoryEntry> {
    switch (type) {
      case 'short': return memoryStore.shortTermMemory;
      case 'working': return memoryStore.workingMemory;
      default: return memoryStore.longTermMemory;
    }
  }

  private initializeSharedContext(): SharedProjectContext {
    return {
      requirements: {
        functional: [],
        nonFunctional: [],
        constraints: [],
        assumptions: [],
        risks: [],
        changes: []
      },
      architecture: {
        patterns: [],
        technologies: [],
        decisions: [],
        diagrams: [],
        dependencies: [],
        integrations: []
      },
      decisions: [],
      constraints: [],
      stakeholders: [],
      timeline: {
        milestones: [],
        deadlines: [],
        estimates: [],
        actualProgress: []
      },
      resources: {
        agents: [],
        tools: [],
        services: [],
        budgets: []
      }
    };
  }

  private initializeCodebaseMemory(): CodebaseMemory {
    return {
      files: new Map(),
      modules: new Map(),
      patterns: [],
      refactorings: [],
      testCoverage: {
        overall: 0,
        byModule: new Map(),
        gaps: [],
        trends: []
      },
      dependencies: []
    };
  }

  private initializeDocumentMemory(): DocumentMemory {
    return {
      documents: new Map(),
      knowledge: new Map(),
      references: new Map(),
      glossary: new Map()
    };
  }

  private getDefaultAgentPreferences(): AgentPreferences {
    return {
      codingStyle: {},
      communicationStyle: 'collaborative',
      workflowPreferences: [],
      toolPreferences: [],
      collaborationStyle: 'supportive'
    };
  }

  private getDefaultPersistenceSettings(): MemoryPersistenceSettings {
    return {
      autoSave: true,
      saveInterval: 5,
      compressionEnabled: true,
      retentionPolicy: {
        shortTermDays: 7,
        longTermDays: 365,
        importanceThreshold: 5,
        accessFrequencyThreshold: 3
      },
      backupSettings: {
        enabled: true,
        frequency: 'daily',
        maxBackups: 30,
        cloudBackup: false
      }
    };
  }

  private startPeriodicSave(): void {
    this.saveTimer = setInterval(async () => {
      await this.saveAllMemories();
    }, 5 * 60 * 1000);
  }

  private startMemoryOptimization(): void {
    this.memoryOptimizer = setInterval(async () => {
      await this.optimizeMemories();
    }, 60 * 60 * 1000);
  }

  private async saveAllMemories(): Promise<void> {
    logger.info('💾 Saving Jurexio project memories...');
  }

  private async optimizeMemories(): Promise<void> {
    logger.info('🧹 Optimizing Jurexio project memories...');
  }

  subscribeToProject(projectId: number, ws: WebSocket): void {
    if (!this.websocketConnections.has(projectId)) {
      this.websocketConnections.set(projectId, []);
    }
    this.websocketConnections.get(projectId)!.push(ws);
    
    ws.on('close', () => {
      const connections = this.websocketConnections.get(projectId) || [];
      const index = connections.indexOf(ws);
      if (index > -1) {
        connections.splice(index, 1);
      }
    });
  }

  private broadcastToProject(projectId: number, message: any): void {
    const connections = this.websocketConnections.get(projectId) || [];
    connections.forEach(ws => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(message));
      }
    });
  }

  async cleanup(): Promise<void> {
    if (this.saveTimer) {
      clearInterval(this.saveTimer);
    }
    if (this.memoryOptimizer) {
      clearInterval(this.memoryOptimizer);
    }
    await this.saveAllMemories();
  }
}

export const projectMemoryManager = new ProjectMemoryManager();
