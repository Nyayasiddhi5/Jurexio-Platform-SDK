/**
 * Model Context Protocol (MCP) Types
 * Type definitions for MCP server and client interactions
 */

/**
 * Tool parameter definition
 */
export interface ToolParameter {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'object' | 'array';
  description: string;
  required: boolean;
  default?: any;
  enum?: any[];
}

/**
 * Tool definition
 */
export interface Tool {
  id: string;
  name: string;
  description: string;
  parameters: ToolParameter[];
  returns?: {
    type: string;
    description: string;
  };
  examples?: Array<{
    input: Record<string, any>;
    output: any;
  }>;
}

/**
 * Tool execution result
 */
export interface ToolResult {
  success: boolean;
  data?: any;
  error?: string;
  metadata?: {
    executionTime?: number;
    provider?: string;
    [key: string]: any;
  };
}

/**
 * Resource types
 */
export type ResourceType = 'file' | 'api' | 'database' | 'memory' | 'custom';

/**
 * Resource definition
 */
export interface Resource {
  id: string;
  type: ResourceType;
  name: string;
  description: string;
  uri: string;
  metadata?: Record<string, any>;
}

/**
 * Context provider function
 */
export type ContextProvider = (params: any) => Promise<string>;

/**
 * Prompt variable definition
 */
export interface PromptVariable {
  name: string;
  type?: 'string' | 'number' | 'boolean' | 'object' | 'array';
  description?: string;
  required: boolean;
  default?: any;
}

/**
 * Prompt metadata
 */
export interface PromptMetadata {
  category?: string;
  tags?: string[];
  author?: string;
  version?: string;
  createdAt?: Date;
}

/**
 * Prompt template
 */
export interface PromptTemplate {
  id: string;
  name: string;
  description: string;
  template: string;
  variables: PromptVariable[] | string[]; // Support both for backward compatibility
  metadata?: PromptMetadata; // Optional for backward compatibility
  examples?: Array<{
    variables: Record<string, any>;
    output: string;
  }>;
}

/**
 * Context message
 */
export interface ContextMessage {
  id: string;
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  timestamp: Date;
  tokenCount: number;
  metadata?: Record<string, any>;
  compressed?: boolean;
  summarized?: boolean;
}

/**
 * Context window
 */
export interface ContextWindow {
  id: string;
  messages: ContextMessage[];
  tokenCount: number;
  maxTokens: number;
  compressionEnabled: boolean;
  summarizationThreshold: number;
}

/**
 * MCP message types
 */
export type MCPMessageType = 
  | 'tool_list_request'
  | 'tool_list_response'
  | 'tool_call_request'
  | 'tool_call_response'
  | 'resource_list_request'
  | 'resource_list_response'
  | 'resource_read_request'
  | 'resource_read_response'
  | 'prompt_list_request'
  | 'prompt_list_response'
  | 'prompt_render_request'
  | 'prompt_render_response'
  | 'context_request' // Legacy, kept for backward compatibility
  | 'context_response' // Legacy, kept for backward compatibility
  | 'context_save_request'
  | 'context_save_response'
  | 'context_update_request'
  | 'context_update_response'
  | 'context_list_request'
  | 'context_list_response'
  | 'context_snapshot_request'
  | 'context_snapshot_response'
  | 'error';

/**
 * MCP message payload types
 */
export interface ToolListPayload {
  tools: Tool[];
}

export interface ToolCallPayload {
  toolId: string;
  parameters: Record<string, any>;
  context?: ToolExecutionContext;
}

export interface ResourceListPayload {
  resources: Resource[];
}

export interface PromptListRequestPayload {
  legacy?: boolean; // If true, return prompts with string[] variables instead of PromptVariable[]
}

export interface PromptListPayload {
  prompts: PromptTemplate[];
}

export interface PromptRenderPayload {
  promptId: string;
  variables: Record<string, any>;
}

export interface ContextSavePayload {
  windowId: string;
  message: Omit<ContextMessage, 'id' | 'timestamp' | 'tokenCount'>;
}

export interface ContextUpdatePayload {
  windowId: string;
  messageId: string;
  updates: Partial<ContextMessage>;
}

export interface ContextListPayload {
  windows: ContextWindow[];
}

export interface ContextSnapshotPayload {
  windowId: string;
  snapshot: {
    messages: ContextMessage[];
    tokenCount: number;
    timestamp: Date;
  };
}

export interface ErrorPayload {
  error: string;
  code?: string;
  details?: any;
}

/**
 * MCP message
 */
export interface MCPMessage<T = any> {
  type: MCPMessageType;
  id: string;
  timestamp: string; // ISO 8601 format for JSON compatibility
  payload: T;
}

/**
 * MCP server configuration
 */
export interface MCPServerConfig {
  name: string;
  version: string;
  capabilities: {
    tools: boolean;
    resources: boolean;
    context: boolean;
    prompts: boolean;
    streaming: boolean;
  };
  maxToolExecutionTime?: number;
  maxConcurrentTools?: number;
}

/**
 * Tool execution context
 */
export interface ToolExecutionContext {
  toolId: string;
  parameters: Record<string, any>;
  requestId: string;
  userId?: string;
  sessionId?: string;
  metadata?: Record<string, any>;
}
