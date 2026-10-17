export type AGUIEventType =
  | 'task_start'
  | 'task_progress'
  | 'task_complete'
  | 'task_error'
  | 'agent_message'
  | 'tool_call'
  | 'tool_result'
  | 'message'
  | 'thinking'
  | 'tool_call_start'
  | 'tool_call_complete'
  | 'frontend_tool'
  | 'state_update'
  | 'generative_ui'
  | 'interrupt'
  | 'subagent_start'
  | 'subagent_complete'
  | 'status_change'
  | 'error'
  | 'progress'
  | 'artifact_created';

export interface AGUIEvent {
  type: AGUIEventType;
  agentId?: string;
  taskId?: string;
  sessionId?: string;
  payload?: Record<string, any>;
  timestamp?: number;
  metadata?: Record<string, any>;
}

export interface AGUIMessageEvent extends AGUIEvent { type: 'message' | 'agent_message'; content?: string; role?: 'user' | 'assistant' | 'system'; }
export interface AGUIThinkingEvent extends AGUIEvent { type: 'thinking'; thoughts?: string; }
export interface AGUIToolCallEvent extends AGUIEvent { type: 'tool_call' | 'tool_call_start'; toolName?: string; arguments?: any; }
export interface AGUIToolResultEvent extends AGUIEvent { type: 'tool_result' | 'tool_call_complete'; result?: any; success?: boolean; }
export interface AGUIFrontendToolEvent extends AGUIEvent { type: 'frontend_tool'; toolName?: string; arguments?: any; }
export interface AGUIStateUpdateEvent extends AGUIEvent { type: 'state_update'; state?: Record<string, any>; }
export interface AGUIGenerativeUIEvent extends AGUIEvent { type: 'generative_ui'; component?: string; props?: any; }
export interface AGUIInterruptEvent extends AGUIEvent { type: 'interrupt'; reason?: string; resumable?: boolean; }
export interface AGUISubAgentStartEvent extends AGUIEvent { type: 'subagent_start'; subAgentId?: string; parentAgentId?: string; }
export interface AGUISubAgentCompleteEvent extends AGUIEvent { type: 'subagent_complete'; subAgentId?: string; result?: any; }
export interface AGUIStatusChangeEvent extends AGUIEvent { type: 'status_change'; status?: string; previousStatus?: string; }
export interface AGUIErrorEvent extends AGUIEvent { type: 'error' | 'task_error'; error?: string; code?: string; recoverable?: boolean; }
export interface AGUIProgressEvent extends AGUIEvent { type: 'progress' | 'task_progress'; percent?: number; stage?: string; }
export interface AGUIArtifactCreatedEvent extends AGUIEvent { type: 'artifact_created'; artifactId?: string; artifactType?: string; uri?: string; }

export interface AGUIInterruptResponse {
  resume: boolean;
  modifiedInput?: any;
  reason?: string;
}

export interface AGUIStreamOptions {
  bufferSize?: number;
  heartbeatMs?: number;
  closeOnError?: boolean;
  filterTypes?: AGUIEventType[];
}

export interface AGUIStreamSession {
  id: string;
  startupId?: number | string;
  studioId?: string;
  userId?: string | number;
  createdAt: Date;
  closedAt?: Date;
  options?: AGUIStreamOptions;
  metadata?: Record<string, any>;
}

export interface AGUIJurexioConfig {
  enableStreaming?: boolean;
  enableInterrupts?: boolean;
  enableGenerativeUI?: boolean;
  defaultStreamOptions?: AGUIStreamOptions;
  jurisdiction?: string;
  tier?: string;
}
