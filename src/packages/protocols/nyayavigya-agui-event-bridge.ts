// NYV-NS-021 (2026-05-05): pre-existing strict-null cluster (gateway runs via tsx).
import { createLogger } from '../../utils/logger.js';

const logger = createLogger('nyayavigya-agui-event-bridge');

/**
 * Jurexio-to-AGUI Event Bridge
 * 
 * Purpose: Bridges Jurexio orchestration events to AG-UI protocol events
 * Architecture: Listens to Jurexio orchestration core events and emits corresponding AG-UI events
 * 
 * This service ensures real-time agent activity is streamed to the frontend via AG-UI protocol.
 */

interface JurexioOrchestrationCoreV9 { execute(req: any): Promise<any>; on(event: string, cb: Function): void; }
interface AGUIJurexioIntegrationService { streamEvent(event: any): void; isConnected(): boolean; }

// ================================================================================================
// Jurexio-AGUI EVENT BRIDGE
// ================================================================================================

export class JurexioAGUIEventBridge {
  private nyayavigyaCore: JurexioOrchestrationCoreV9;
  private aguiService: AGUIJurexioIntegrationService;
  private sessionIdMap: Map<string, string>; // Maps Jurexio execution IDs to AGUI session IDs
  
  constructor(nyayavigyaCore: JurexioOrchestrationCoreV9, aguiService: AGUIJurexioIntegrationService) {
    this.nyayavigyaCore = nyayavigyaCore;
    this.aguiService = aguiService;
    this.sessionIdMap = new Map();
    
    this.setupEventListeners();
    
    logger.info('✅ Jurexio-AGUI Event Bridge initialized');
  }

  /**
   * Register AG-UI session for Jurexio execution
   */
  registerSession(nyayavigyaExecutionId: string, aguiSessionId: string): void {
    this.sessionIdMap.set(nyayavigyaExecutionId, aguiSessionId);
    logger.info(`🔗 Jurexio execution ${nyayavigyaExecutionId} → AG-UI session ${aguiSessionId}`);
  }

  /**
   * Unregister AG-UI session
   */
  unregisterSession(nyayavigyaExecutionId: string): void {
    this.sessionIdMap.delete(nyayavigyaExecutionId);
  }

  /**
   * Get AG-UI session ID for Jurexio execution
   */
  private getAGUISessionId(nyayavigyaExecutionId?: string): string | undefined {
    if (!nyayavigyaExecutionId) return undefined;
    return this.sessionIdMap.get(nyayavigyaExecutionId);
  }

  /**
   * Setup event listeners for Jurexio orchestration events
   */
  private setupEventListeners(): void {
    // Jurexio Core initialization events
    this.nyayavigyaCore.on('initialized', () => {
      logger.info('🎯 Jurexio Core initialized - bridge active');
    });

    this.nyayavigyaCore.on('initialization-failed', (error: Error) => {
      logger.error('❌ Jurexio Core initialization failed:', error.message);
    });

    // Agent execution events (would need to be added to Jurexio core)
    this.nyayavigyaCore.on('agent:start', (data: any) => {
      const sessionId = this.getAGUISessionId(data.executionId);
      if (sessionId) {
        // @ts-expect-error NV-TS230 legacy typing gap (TS2339)
        this.aguiService.emitStatusChange(
          sessionId,
          'running',
          'idle',
          `Starting agent: ${data.agentId}`
        );
        
        // @ts-expect-error NV-TS230 legacy typing gap (TS2339)
        this.aguiService.emitMessage(
          sessionId,
          `🤖 **Agent Started**: ${data.agentId}`,
          'system',
          data.agentId
        );
      }
    });

    this.nyayavigyaCore.on('agent:thinking', (data: any) => {
      const sessionId = this.getAGUISessionId(data.executionId);
      if (sessionId) {
        // @ts-expect-error NV-TS230 legacy typing gap (TS2339)
        this.aguiService.emitThinking(
          sessionId,
          data.step || 'analyzing',
          data.description || 'Agent is thinking...',
          data.agentId,
          data.confidence,
          data.reasoning
        );
      }
    });

    this.nyayavigyaCore.on('agent:message', (data: any) => {
      const sessionId = this.getAGUISessionId(data.executionId);
      if (sessionId) {
        // @ts-expect-error NV-TS230 legacy typing gap (TS2339)
        this.aguiService.emitMessage(
          sessionId,
          data.content,
          data.role || 'agent',
          data.agentId,
          data.metadata
        );
      }
    });

    this.nyayavigyaCore.on('agent:tool_call', (data: any) => {
      const sessionId = this.getAGUISessionId(data.executionId);
      if (sessionId) {
        // @ts-expect-error NV-TS230 legacy typing gap (TS2339)
        this.aguiService.emitToolCall(
          sessionId,
          data.toolName,
          data.input,
          data.agentId,
          data.executionType || 'backend'
        );
      }
    });

    this.nyayavigyaCore.on('agent:tool_result', (data: any) => {
      const sessionId = this.getAGUISessionId(data.executionId);
      if (sessionId) {
        // @ts-expect-error NV-TS230 legacy typing gap (TS2339)
        this.aguiService.emitToolResult(
          sessionId,
          data.toolCallId,
          data.toolName,
          data.result,
          data.success !== false,
          data.duration,
          data.error
        );
      }
    });

    this.nyayavigyaCore.on('agent:complete', (data: any) => {
      const sessionId = this.getAGUISessionId(data.executionId);
      if (sessionId) {
        // @ts-expect-error NV-TS230 legacy typing gap (TS2339)
        this.aguiService.emitStatusChange(
          sessionId,
          'completed',
          'running',
          `Agent completed: ${data.agentId}`
        );
        
        // @ts-expect-error NV-TS230 legacy typing gap (TS2339)
        this.aguiService.emitMessage(
          sessionId,
          `✅ **Agent Completed**: ${data.agentId}${data.result ? `\n\nResult: ${data.result}` : ''}`,
          'system',
          data.agentId
        );
      }
    });

    this.nyayavigyaCore.on('agent:error', (data: any) => {
      const sessionId = this.getAGUISessionId(data.executionId);
      if (sessionId) {
        // @ts-expect-error NV-TS230 legacy typing gap (TS2339)
        this.aguiService.emitError(
          sessionId,
          data.error?.message || 'Agent execution error',
          data.agentId,
          data.error?.stack,
          data.recoverable !== false
        );
        
        // @ts-expect-error NV-TS230 legacy typing gap (TS2339)
        this.aguiService.emitStatusChange(
          sessionId,
          'error',
          'running',
          `Error in agent: ${data.agentId}`
        );
      }
    });

    // Sub-agent events
    this.nyayavigyaCore.on('subagent:start', (data: any) => {
      const sessionId = this.getAGUISessionId(data.executionId);
      if (sessionId) {
        // @ts-expect-error NV-TS230 legacy typing gap (TS2339)
        this.aguiService.emitSubAgentStart(
          sessionId,
          data.subAgentId,
          data.subAgentName || data.subAgentId,
          data.task,
          data.parentAgentId,
          data.scopedState
        );
      }
    });

    this.nyayavigyaCore.on('subagent:complete', (data: any) => {
      const sessionId = this.getAGUISessionId(data.executionId);
      if (sessionId) {
        // @ts-expect-error NV-TS230 legacy typing gap (TS2339)
        this.aguiService.emitSubAgentComplete(
          sessionId,
          data.subAgentId,
          data.subAgentName || data.subAgentId,
          data.result,
          data.parentAgentId,
          data.resultState
        );
      }
    });

    // Progress events
    this.nyayavigyaCore.on('progress', (data: any) => {
      const sessionId = this.getAGUISessionId(data.executionId);
      if (sessionId) {
        // @ts-expect-error NV-TS230 legacy typing gap (TS2339)
        this.aguiService.emitProgress(
          sessionId,
          data.percentage,
          data.message,
          data.currentStep,
          data.totalSteps,
          data.agentId
        );
      }
    });

    // BMAD, GRPO, Production orchestrator events
    this.nyayavigyaCore.on('bmad-registered', () => {
      logger.info('✅ BMAD-CAM Framework registered');
    });

    this.nyayavigyaCore.on('grpo-registered', () => {
      logger.info('✅ GRPO Reinforcement Trainer registered');
    });

    this.nyayavigyaCore.on('production-registered', () => {
      logger.info('✅ Production Orchestrator registered');
    });
  }

  /**
   * Wrapper method for Jurexio agent execution with AG-UI streaming
   */
  async executeAgentWithStreaming(
    aguiSessionId: string,
    agentId: string,
    input: any,
    options?: any
  ): Promise<any> {
    const executionId = `nyv_exec_${Date.now()}_${crypto.randomUUID().substring(0, 9)}`;
    
    // Register session mapping
    this.registerSession(executionId, aguiSessionId);
    
    try {
      // Execute agent through Jurexio core
      // @ts-expect-error NV-TS230 legacy typing gap (TS2339)
      const result = await this.nyayavigyaCore.executeAgent(agentId, {
        ...input,
        executionId, // Pass execution ID so Jurexio can emit events with it
      }, options);
      
      return result;
    } finally {
      // Cleanup session mapping
      this.unregisterSession(executionId);
    }
  }

  /**
   * Wrapper method for Jurexio task execution with AG-UI streaming
   */
  async executeTaskWithStreaming(
    aguiSessionId: string,
    task: any
  ): Promise<any> {
    const executionId = `nyv_task_${Date.now()}_${crypto.randomUUID().substring(0, 9)}`;
    
    // Register session mapping
    this.registerSession(executionId, aguiSessionId);
    
    try {
      // Execute task through Jurexio core
      // @ts-expect-error NV-TS230 legacy typing gap (TS2339)
      const result = await this.nyayavigyaCore.executeTask({
        ...task,
        executionId, // Pass execution ID so Jurexio can emit events with it
      });
      
      return result;
    } finally {
      // Cleanup session mapping
      this.unregisterSession(executionId);
    }
  }
}

export default JurexioAGUIEventBridge;
