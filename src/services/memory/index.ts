/**
 * Jurexio Legal SDK v5.0.0 - Memory System
 * 
 * Graph-based relational memory, tiered storage, and project memory management.
 */

export {
  graphMemoryService,
  type MemoryNode,
  type MemoryEdge,
  type MemoryQuery,
  type MemoryResult,
  type MemoryRecall,
  type MemoryScope,
  type GraphTraversalResult,
  type MemoryCategory
} from './graph-memory-service.js';

export {
  buildMemoryInjectionBlock,
  buildGraphInjectionBlock,
  clipToBudget,
  type MemoryInjectionBudget,
  type MemoryInjectionResult
} from './jrx-memory-injection-budget.js';

export {
  nv5TierMemoryService,
  Nv5TierMemoryService,
  type MatterMemoryInput,
  type EpisodicEvent
} from './jrx-5tier-memory-service.js';

export {
  TieredMemoryStorageService,
  tieredMemoryStorage,
  type TieredMemory,
  type MemoryContext,
  type TierConfig,
  type MemorySearchResult,
  type TieredStorageStats,
  type MemoryTier
} from './tiered-memory-storage.js';

export {
  ProjectMemoryManager,
  projectMemoryManager,
  type ProjectMemoryContext,
  type ProjectMemoryStore,
  type AgentMemoryContext,
  type SharedProjectContext,
  type MemoryEntry,
  type SemanticMemoryEntry,
  type TaskMemoryEntry,
  type ActionMemory,
  type LearnedPattern,
  type AgentPreferences,
  type WorkingContext,
  type CollaborationMemory,
  type PartnershipMemory,
  type CollaborationEntry,
  type CommunicationPattern,
  type ConflictResolution,
  type RequirementsMemory,
  type RequirementChange,
  type ArchitectureMemory,
  type ArchitecturalDecision,
  type DecisionMemory,
  type ConstraintMemory,
  type StakeholderMemory,
  type TimelineMemory,
  type Milestone,
  type Deadline,
  type EstimateMemory,
  type ProgressMemory,
  type ResourceMemory,
  type AgentResourceMemory,
  type ToolResourceMemory,
  type ServiceResourceMemory,
  type BudgetMemory,
  type CodebaseMemory,
  type FileMemory,
  type ModuleMemory,
  type CodePatternMemory,
  type RefactoringMemory,
  type TestCoverageMemory,
  type CoverageTrend,
  type DependencyMemory,
  type DependencyUpdate,
  type DocumentMemory,
  type DocumentEntry,
  type KnowledgeEntry,
  type ReferenceEntry,
  type GlossaryEntry,
  type CodeChangeMemory,
  type MemoryPersistenceSettings,
  type RetentionPolicy,
  type BackupSettings
} from './project-memory-manager.js';
