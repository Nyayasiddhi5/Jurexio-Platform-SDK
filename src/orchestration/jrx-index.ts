export { QueenOrchestrator, queenOrchestrator } from './jrx-queen-orchestrator.js';
export type { OrchestrationRequest as QueenOrchestrationRequest, Subtask, TaskDecomposition, AgentExecution, OrchestrationResult as QueenOrchestrationResult, CollectiveIntelligenceMode } from './jrx-queen-orchestrator.js';

export { ProductionOrchestrator, createProductionOrchestrator } from './jrx-production-orchestrator.js';
export type { OrchestrationRequest as ProductionOrchestrationRequest, OrchestrationResult as ProductionOrchestrationResult, AgentCoordination, AgentParticipant, ConflictResolution, CommunicationChannel } from './jrx-production-orchestrator.js';

export { PromptEnhancementPipeline, promptEnhancementPipeline } from './jrx-prompt-enhancement-pipeline.js';
export type { PromptEnhancementConfig, EnhancementContext, PromptEnhancementInput, OutputFormat, EnhancedPrompt, PromptQualityMetrics } from './jrx-prompt-enhancement-pipeline.js';

export { ResponseEngineeringPipeline, responseEngineeringPipeline } from './jrx-response-engineering-pipeline.js';
export type { ResponseConfig, RawResponse, EngineeredResponse, QualityMetrics, QualityIssue, TranslationRequest, FormattingRule } from './jrx-response-engineering-pipeline.js';

// Note: OrchestrationFacade legacy facade is superseded by capability-manifest +
// orchestration-middleware + jrx-queen-orchestrator. The old facade is excluded
// from compilation (see tsconfig.json) and is retained only for reference.

export { RuntimeAgentFactory } from './jrx-runtime-agent-factory.js';
export type { AgentCreationRequest, AgentPersonalityDNA, SkillRequirement, AgentConstraints, CollaborationSettings } from './jrx-runtime-agent-factory.js';

export { UnifiedRoutingRegistry, unifiedRoutingRegistry, OrchestrationPhase } from './jrx-unified-routing-registry.js';
export type { PluginConfig, PluginContext, PluginExecutionResult, IRoutingPlugin } from './jrx-unified-routing-registry.js';

export { CognitiveProcessor, createSmartThinkingEngine } from './jrx-smart-thinking-engine.js';
export type { ThinkingContext, ThinkingResult, ThinkingStep, AlternativeApproach, ActionPlan, PlanPhase, PlanAction, RequiredResource, Timeline, Milestone, Risk } from './jrx-smart-thinking-engine.js';

export { SDKAutoInitializationEngine } from './jrx-sdk-auto-initialization.js';
export type { SDKInitializationRequest, SDKRequirements, SDKCustomizations, TenantConfiguration, QuotaLimits, SecuritySettings, FeatureFlags, SDKPackage, CodeExample, DeploymentInstructions } from './jrx-sdk-auto-initialization.js';

export { bootstrapPlugins, shutdownPlugins } from './jrx-plugin-bootstrap.js';
