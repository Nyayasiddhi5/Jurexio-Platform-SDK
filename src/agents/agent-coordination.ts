import EventEmitter from 'events';
export type BaseAgent = { id: string; name: string; tier: string };
export type AgentTask = { taskId: string; agentId: string; payload: Record<string, unknown> };
export class AgentEventBus extends EventEmitter {
  publish(event: string, data: unknown): void {
    this.emit(event, data);
  }
}
