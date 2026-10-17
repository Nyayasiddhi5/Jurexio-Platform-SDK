/**
 * WorkflowsApi — Typed wrappers for the Batch C `/api/nv5/workflows/*`
 * autonomous + continuous workflow engines (Session-10, 2026-05-10).
 * Strict-SDK-only auth (`requireSdkKeyStrict`); default OFF
 * (`JRX_F_WORKFLOW_AUTONOMOUS`, `JRX_F_WORKFLOW_CONTINUOUS`).
 *
 * Reference: docs/canonical/04-sdk-and-api-canonical-2026-05-07.md § 13a
 * Server: src/routes/nv5/workflows/{index,autonomous-routes,continuous-routes}.ts
 *
 * NOTE on the canonical lifecycle (`POST /start`, `GET /:id`, `POST /:id/cancel`):
 * the namespace root is task-id-centric (continuous engine owns task-id space).
 * Engine-specific lifecycle (start/stop the engines themselves, list agents,
 * submit tasks) lives under `.autonomous` / `.continuous`.
 */

import type { NyvHttpClient } from '../NyvClient.js';

/* ─── Canonical lifecycle (namespace root) ─── */

export interface WorkflowsHealthResponse {
  ok: boolean;
  namespace: 'workflows';
  version: string;
  uptimeSec: number;
  flags: { autonomous: boolean; continuous: boolean };
  engines: { autonomousRunning: boolean; continuousRunning: boolean };
}

export interface WorkflowsStartResponse {
  success: boolean;
  /** Per-engine boot result. Keys appear only for engines whose flag is ON. */
  started: { autonomous?: boolean; continuous?: boolean };
}

/** Per-task record returned by the continuous engine's task-id surface. */
export interface WorkflowTask {
  id: string;
  projectId: string;
  agentId: string;
  taskType: string;
  priority?: string | number;
  status: string;
  retryCount?: number;
  maxRetries?: number;
  createdAt?: string | Date;
  startedAt?: string | Date;
  completedAt?: string | Date;
  actualDuration?: number;
  checkpointCount?: number;
}

export interface WorkflowTaskResponse {
  success: boolean;
  task: WorkflowTask;
}

export interface WorkflowCancelResponse {
  success: boolean;
  taskId: string;
  cancelled: boolean;
  [k: string]: unknown;
}

/* ─── Continuous engine ─── */

export interface ContinuousStatusResponse {
  success: boolean;
  [k: string]: unknown;
}

export interface ContinuousMetricsResponse {
  success: boolean;
  metrics: {
    totalTasks: number;
    completedTasks: number;
    failedTasks: number;
    averageExecutionTime: number;
    throughput: number;
    uptime: number;
    errorRate: number;
    agentUtilization: Record<string, unknown>;
  };
}

export interface ContinuousRunStateResponse {
  success: boolean;
  running: boolean;
}

export type ContinuousTaskType =
  | 'code_generation' | 'testing' | 'review' | 'deployment' | 'analysis' | 'design';

export interface ContinuousSubmitTaskRequest {
  projectId: string;
  agentId: string;
  taskType: ContinuousTaskType;
  priority?: string | number;
  payload?: Record<string, unknown>;
  context?: Record<string, unknown>;
  dependencies?: string[];
  maxRetries?: number;
  estimatedDuration?: number;
}

/* ─── Autonomous engine ─── */

export interface AutonomousStatusResponse {
  success: boolean;
  running: boolean;
  agentCount: number;
  conflictCount: number;
  healingActionCount: number;
}

class ContinuousSubApi {
  constructor(private http: NyvHttpClient) {}
  health(): Promise<{ success: boolean; service: string; running: boolean }> {
    return this.http.get('/api/nv5/workflows/continuous/health');
  }
  status(): Promise<ContinuousStatusResponse> {
    return this.http.get('/api/nv5/workflows/continuous/status');
  }
  metrics(): Promise<ContinuousMetricsResponse> {
    return this.http.get('/api/nv5/workflows/continuous/metrics');
  }
  start(): Promise<ContinuousRunStateResponse> {
    return this.http.post('/api/nv5/workflows/continuous/start', {});
  }
  stop(): Promise<ContinuousRunStateResponse> {
    return this.http.post('/api/nv5/workflows/continuous/stop', {});
  }
  submitTask(req: ContinuousSubmitTaskRequest): Promise<{ success: boolean; taskId: string }> {
    return this.http.post('/api/nv5/workflows/continuous/tasks', req);
  }
  getTask(taskId: string): Promise<WorkflowTaskResponse> {
    return this.http.get(`/api/nv5/workflows/continuous/tasks/${encodeURIComponent(taskId)}`);
  }
  cancelTask(taskId: string): Promise<WorkflowCancelResponse> {
    return this.http.post(`/api/nv5/workflows/continuous/tasks/${encodeURIComponent(taskId)}/cancel`, {});
  }
}

class AutonomousSubApi {
  constructor(private http: NyvHttpClient) {}
  health(): Promise<{ success: boolean; service: string; running: boolean }> {
    return this.http.get('/api/nv5/workflows/autonomous/health');
  }
  status(): Promise<AutonomousStatusResponse> {
    return this.http.get('/api/nv5/workflows/autonomous/status');
  }
  start(): Promise<{ success: boolean; running: boolean }> {
    return this.http.post('/api/nv5/workflows/autonomous/start', {});
  }
  stop(): Promise<{ success: boolean; running: boolean }> {
    return this.http.post('/api/nv5/workflows/autonomous/stop', {});
  }
  agents(): Promise<{ success: boolean; agents?: unknown; [k: string]: unknown }> {
    return this.http.get('/api/nv5/workflows/autonomous/agents');
  }
  conflicts(): Promise<{ success: boolean; [k: string]: unknown }> {
    return this.http.get('/api/nv5/workflows/autonomous/conflicts');
  }
  healing(): Promise<{ success: boolean; [k: string]: unknown }> {
    return this.http.get('/api/nv5/workflows/autonomous/healing');
  }
  submitTask(req: Record<string, unknown>): Promise<{ success: boolean; [k: string]: unknown }> {
    return this.http.post('/api/nv5/workflows/autonomous/tasks', req);
  }
  pauseAgent(agentId: string): Promise<{ success: boolean; [k: string]: unknown }> {
    return this.http.post(`/api/nv5/workflows/autonomous/agents/${encodeURIComponent(agentId)}/pause`, {});
  }
  resumeAgent(agentId: string): Promise<{ success: boolean; [k: string]: unknown }> {
    return this.http.post(`/api/nv5/workflows/autonomous/agents/${encodeURIComponent(agentId)}/resume`, {});
  }
}

export class WorkflowsApi {
  public readonly autonomous: AutonomousSubApi;
  public readonly continuous: ContinuousSubApi;

  constructor(private http: NyvHttpClient) {
    this.autonomous = new AutonomousSubApi(http);
    this.continuous = new ContinuousSubApi(http);
  }

  /** Always-on liveness for the workflows namespace (no flag gate). */
  health(): Promise<WorkflowsHealthResponse> {
    return this.http.get('/api/nv5/workflows/health');
  }

  /**
   * Start whichever engines have their flag ON. The server returns a
   * `started` map containing only the engines it actually attempted to
   * boot. Idempotent — calling on an already-running engine is a no-op.
   */
  start(): Promise<WorkflowsStartResponse> {
    return this.http.post('/api/nv5/workflows/start', {});
  }

  /**
   * Look up a task by id. The continuous engine owns the task-id space;
   * autonomous-engine tasks have no per-task retrieval API and are
   * inspected via `nyv.workflows.autonomous.status()` etc.
   */
  get(taskId: string): Promise<WorkflowTaskResponse> {
    return this.http.get(`/api/nv5/workflows/${encodeURIComponent(taskId)}`);
  }

  /** Cancel a task by id (continuous engine). */
  cancel(taskId: string): Promise<WorkflowCancelResponse> {
    return this.http.post(`/api/nv5/workflows/${encodeURIComponent(taskId)}/cancel`, {});
  }
}
