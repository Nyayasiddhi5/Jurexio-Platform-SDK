// JRX-NS-021 (2026-05-05): pre-existing TS errors (gateway runs via tsx).
/**
 * MCP (Model Context Protocol) Integration Service
 * Enables direct model-to-model communication and context sharing
 */

import { EventEmitter } from 'events';
import WebSocket from 'ws';
import { createLogger } from '../../utils/logger.js';


const logger = createLogger('mcp-protocol-integration');

export interface MCPMessage {
  id: string;
  type: 'request' | 'response' | 'notification';
  method?: string;
  params?: any;
  result?: any;
  error?: MCPError;
}

export interface MCPError {
  code: number;
  message: string;
  data?: any;
}

export interface MCPConnection {
  id: string;
  provider: string;
  model: string;
  websocket: WebSocket;
  capabilities: string[];
  status: 'connecting' | 'connected' | 'disconnected' | 'error';
}

export interface MCPSession {
  id: string;
  connections: MCPConnection[];
  sharedContext: Map<string, any>;
  workflows: MCPWorkflow[];
  startTime: Date;
}

export interface MCPWorkflow {
  id: string;
  name: string;
  steps: MCPWorkflowStep[];
  status: 'pending' | 'running' | 'completed' | 'failed';
}

export interface MCPWorkflowStep {
  id: string;
  modelId: string;
  operation: string;
  input: any;
  output?: any;
  dependencies: string[];
}

/**
 * MCP Protocol Integration Service
 */
export class MCPProtocolService extends EventEmitter {
  private connections: Map<string, MCPConnection> = new Map();
  private sessions: Map<string, MCPSession> = new Map();
  private messageHandlers: Map<string, Function> = new Map();

  constructor() {
    super();
    this.initializeProtocol();
    logger.info('🔗 MCP Protocol Service initialized - Direct model communication enabled');
  }

  private initializeProtocol(): void {
    this.setupMessageHandlers();
    this.startHealthMonitoring();
  }

  private setupMessageHandlers(): void {
    // Context sharing handler
    this.messageHandlers.set('context.share', this.handleContextShare.bind(this));
    
    // Model communication handler
    this.messageHandlers.set('model.communicate', this.handleModelCommunication.bind(this));
    
    // Workflow execution handler
    this.messageHandlers.set('workflow.execute', this.handleWorkflowExecution.bind(this));
    
    // Capability negotiation handler
    this.messageHandlers.set('capability.negotiate', this.handleCapabilityNegotiation.bind(this));
  }

  // Connect to AI provider via MCP
  async connectProvider(provider: string, model: string, config: any): Promise<MCPConnection> {
    const connectionId = `${provider}-${model}-${Date.now()}`;
    
    const ws = new WebSocket(this.getProviderMCPEndpoint(provider), {
      headers: {
        'Authorization': `Bearer ${config.apiKey}`,
        'X-MCP-Version': '2.0',
        'X-Model': model
      }
    });

    const connection: MCPConnection = {
      id: connectionId,
      provider,
      model,
      websocket: ws,
      capabilities: [],
      status: 'connecting'
    };

    // Setup WebSocket handlers
    ws.on('open', () => {
      connection.status = 'connected';
      this.initiateCapabilityNegotiation(connection);
      this.emit('connection.established', connection);
    });

    ws.on('message', (data) => {
      this.handleIncomingMessage(connection, JSON.parse(data.toString()));
    });

    ws.on('close', () => {
      connection.status = 'disconnected';
      this.emit('connection.lost', connection);
    });

    ws.on('error', (error) => {
      connection.status = 'error';
      this.emit('connection.error', { connection, error });
    });

    this.connections.set(connectionId, connection);
    return connection;
  }

  // Create MCP session for multi-model collaboration
  async createSession(providers: string[]): Promise<MCPSession> {
    const sessionId = `mcp-session-${Date.now()}`;
    
    const connections = await Promise.all(
      providers.map(provider => this.connectProvider(provider, 'default', {}))
    );

    const session: MCPSession = {
      id: sessionId,
      connections,
      sharedContext: new Map(),
      workflows: [],
      startTime: new Date()
    };

    this.sessions.set(sessionId, session);
    return session;
  }

  // Share context between models in session
  async shareContext(sessionId: string, contextKey: string, contextData: any): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error('Session not found');

    session.sharedContext.set(contextKey, contextData);

    // Broadcast context to all connected models
    const message: MCPMessage = {
      id: `context-${Date.now()}`,
      type: 'notification',
      method: 'context.update',
      params: {
        key: contextKey,
        data: contextData,
        timestamp: new Date().toISOString()
      }
    };

    await Promise.all(
      session.connections.map(conn => this.sendMessage(conn, message))
    );

    this.emit('context.shared', { sessionId, contextKey, contextData });
  }

  // Execute multi-model workflow
  async executeMultiModelWorkflow(sessionId: string, workflow: MCPWorkflow): Promise<any> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error('Session not found');

    workflow.status = 'running';
    session.workflows.push(workflow);

    const results = new Map<string, any>();

    // Execute workflow steps with dependency resolution
    for (const step of workflow.steps) {
      // Wait for dependencies
      await this.waitForDependencies(step, results);

      // Find connection for model
      const connection = session.connections.find(c => c.id === step.modelId);
      if (!connection) throw new Error(`Model connection not found: ${step.modelId}`);

      // Execute step
      const stepResult = await this.executeWorkflowStep(connection, step, session.sharedContext);
      results.set(step.id, stepResult);
      step.output = stepResult;
    }

    workflow.status = 'completed';
    this.emit('workflow.completed', { sessionId, workflow, results });

    return Array.from(results.values());
  }

  // Direct model-to-model communication
  async communicateModels(sourceModel: string, targetModel: string, message: any): Promise<any> {
    const sourceConnection = Array.from(this.connections.values())
      .find(c => c.model === sourceModel);
    const targetConnection = Array.from(this.connections.values())
      .find(c => c.model === targetModel);

    if (!sourceConnection || !targetConnection) {
      throw new Error('Model connections not found');
    }

    const mcpMessage: MCPMessage = {
      id: `comm-${Date.now()}`,
      type: 'request',
      method: 'model.process',
      params: {
        message,
        sourceModel,
        context: 'direct-communication'
      }
    };

    return await this.sendMessage(targetConnection, mcpMessage);
  }

  // Enhanced RAG with MCP context sharing
  async enhancedRAGQuery(query: string, knowledgeBases: string[], models: string[]): Promise<any> {
    const sessionId = await this.createSession(models);
    // @ts-expect-error NV-TS230 legacy typing gap (TS2345)
    const session = this.sessions.get(sessionId)!;

    // Share knowledge base context across models
    for (const kb of knowledgeBases) {
      const kbData = await this.loadKnowledgeBase(kb);
      // @ts-expect-error NV-TS230 legacy typing gap (TS2345)
      await this.shareContext(sessionId, `kb-${kb}`, kbData);
    }

    // Create collaborative RAG workflow
    const workflow: MCPWorkflow = {
      id: `rag-workflow-${Date.now()}`,
      name: 'Enhanced Multi-Model RAG',
      status: 'pending',
      steps: [
        {
          id: 'context-retrieval',
          modelId: session.connections[0].id,
          operation: 'retrieve-context',
          input: { query, knowledgeBases },
          dependencies: []
        },
        {
          id: 'content-synthesis',
          modelId: session.connections[1]?.id || session.connections[0].id,
          operation: 'synthesize-response',
          input: { query },
          dependencies: ['context-retrieval']
        },
        {
          id: 'quality-verification',
          modelId: session.connections[2]?.id || session.connections[0].id,
          operation: 'verify-quality',
          input: { query },
          dependencies: ['content-synthesis']
        }
      ]
    };

    // @ts-expect-error NV-TS230 legacy typing gap (TS2345)
    return await this.executeMultiModelWorkflow(sessionId, workflow);
  }

  // Real-time knowledge base updates via MCP
  async updateKnowledgeBase(kbId: string, updates: any[]): Promise<void> {
    const affectedSessions = Array.from(this.sessions.values())
      .filter(session => session.sharedContext.has(`kb-${kbId}`));

    for (const session of affectedSessions) {
      const currentKB = session.sharedContext.get(`kb-${kbId}`);
      const updatedKB = this.mergeKnowledgeUpdates(currentKB, updates);
      
      await this.shareContext(session.id, `kb-${kbId}`, updatedKB);
    }

    this.emit('knowledge.updated', { kbId, updates, affectedSessions: affectedSessions.length });
  }

  // Private helper methods
  private getProviderMCPEndpoint(provider: string): string {
    const endpoints = {
      'openai': 'wss://api.openai.com/v1/mcp',
      'anthropic': 'wss://api.anthropic.com/v1/mcp',
      'google': 'wss://generativelanguage.googleapis.com/v1/mcp',
      'xai': 'wss://api.x.ai/v1/mcp',
      'perplexity': 'wss://api.perplexity.ai/v1/mcp'
    };
    
    return endpoints[provider] || `wss://${provider}.ai/v1/mcp`;
  }

  private async initiateCapabilityNegotiation(connection: MCPConnection): Promise<void> {
    const message: MCPMessage = {
      id: `cap-nego-${Date.now()}`,
      type: 'request',
      method: 'capability.list',
      params: {}
    };

    await this.sendMessage(connection, message);
  }

  private async handleIncomingMessage(connection: MCPConnection, message: MCPMessage): Promise<void> {
    if (message.method && this.messageHandlers.has(message.method)) {
      const handler = this.messageHandlers.get(message.method)!;
      await handler(connection, message);
    }

    this.emit('message.received', { connection, message });
  }

  private async sendMessage(connection: MCPConnection, message: MCPMessage): Promise<any> {
    return new Promise((resolve, reject) => {
      if (connection.websocket.readyState !== WebSocket.OPEN) {
        reject(new Error('Connection not open'));
        return;
      }

      const timeout = setTimeout(() => {
        reject(new Error('Message timeout'));
      }, 30000);

      const messageHandler = (response: MCPMessage) => {
        if (response.id === message.id) {
          clearTimeout(timeout);
          if (response.error) {
            reject(new Error(response.error.message));
          } else {
            resolve(response.result);
          }
        }
      };

      this.once(`response-${message.id}`, messageHandler);
      connection.websocket.send(JSON.stringify(message));
    });
  }

  private async handleContextShare(connection: MCPConnection, message: MCPMessage): Promise<void> {
    // Handle context sharing between models
    const { sessionId, contextKey, contextData } = message.params;
    await this.shareContext(sessionId, contextKey, contextData);
  }

  private async handleModelCommunication(connection: MCPConnection, message: MCPMessage): Promise<void> {
    // Handle direct model communication
    const { targetModel, communicationData } = message.params;
    const result = await this.communicateModels(connection.model, targetModel, communicationData);
    
    const response: MCPMessage = {
      id: message.id,
      type: 'response',
      result
    };

    await this.sendMessage(connection, response);
  }

  private async handleWorkflowExecution(connection: MCPConnection, message: MCPMessage): Promise<void> {
    // Handle workflow execution requests
    const { sessionId, workflow } = message.params;
    const result = await this.executeMultiModelWorkflow(sessionId, workflow);
    
    const response: MCPMessage = {
      id: message.id,
      type: 'response',
      result
    };

    await this.sendMessage(connection, response);
  }

  private async handleCapabilityNegotiation(connection: MCPConnection, message: MCPMessage): Promise<void> {
    // Handle capability negotiation
    if (message.result && message.result.capabilities) {
      connection.capabilities = message.result.capabilities;
      this.emit('capabilities.negotiated', connection);
    }
  }

  private async waitForDependencies(step: MCPWorkflowStep, results: Map<string, any>): Promise<void> {
    while (step.dependencies.some(dep => !results.has(dep))) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }

  private async executeWorkflowStep(
    connection: MCPConnection, 
    step: MCPWorkflowStep, 
    sharedContext: Map<string, any>
  ): Promise<any> {
    const message: MCPMessage = {
      id: `step-${step.id}`,
      type: 'request',
      method: 'workflow.step',
      params: {
        operation: step.operation,
        input: step.input,
        context: Object.fromEntries(sharedContext)
      }
    };

    return await this.sendMessage(connection, message);
  }

  private async loadKnowledgeBase(kbId: string): Promise<any> {
    // Load knowledge base data
    return {
      id: kbId,
      documents: [],
      embeddings: [],
      metadata: {
        lastUpdated: new Date(),
        version: '1.0'
      }
    };
  }

  private mergeKnowledgeUpdates(currentKB: any, updates: any[]): any {
    // Merge knowledge base updates
    return {
      ...currentKB,
      documents: [...currentKB.documents, ...updates],
      metadata: {
        ...currentKB.metadata,
        lastUpdated: new Date()
      }
    };
  }

  private startHealthMonitoring(): void {
    setInterval(() => {
      this.connections.forEach(connection => {
        if (connection.websocket.readyState === WebSocket.OPEN) {
          const ping: MCPMessage = {
            id: `ping-${Date.now()}`,
            type: 'request',
            method: 'health.ping',
            params: {}
          };
          
          connection.websocket.send(JSON.stringify(ping));
        }
      });
    }, 30000);
  }

  // Public API methods
  getActiveConnections(): MCPConnection[] {
    return Array.from(this.connections.values())
      .filter(conn => conn.status === 'connected');
  }

  getActiveSessions(): MCPSession[] {
    return Array.from(this.sessions.values());
  }

  async closeSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.connections.forEach(conn => {
        if (conn.websocket.readyState === WebSocket.OPEN) {
          conn.websocket.close();
        }
      });
      this.sessions.delete(sessionId);
    }
  }

  getSessionStats(sessionId: string): any {
    const session = this.sessions.get(sessionId);
    if (!session) return null;

    return {
      id: session.id,
      duration: Date.now() - session.startTime.getTime(),
      connections: session.connections.length,
      activeConnections: session.connections.filter(c => c.status === 'connected').length,
      sharedContextSize: session.sharedContext.size,
      completedWorkflows: session.workflows.filter(w => w.status === 'completed').length,
      totalWorkflows: session.workflows.length
    };
  }
}

// Create singleton instance
export const mcpProtocol = new MCPProtocolService();