import crypto from 'crypto';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('./jrx-event-sourcing-adapter');

interface DomainEvent {
  id: string;
  type: string;
  aggregateId: string;
  aggregateType: string;
  payload: Record<string, unknown>;
  metadata: {
    traceId: string;
    userId?: string;
    timestamp: Date;
    version: string;
  };
  sequenceNumber: number;
}

type EventHandler = (event: DomainEvent) => Promise<void>;

interface NvEventBusInterface {
  publish(event: DomainEvent): Promise<void>;
  subscribe(topic: string, handler: EventHandler): Promise<void>;
  publishBatch(events: DomainEvent[]): Promise<void>;
}

const EVENT_TYPES = [
  'statute.amended',
  'matter.memory.updated',
  'agent.quality.evaluated',
  'document.forensic.completed',
  'citation.unverified.detected',
  'document.uploaded',
  'agent.executed',
  'template.generated',
  'conflict.detected',
  'amendment.processed',
] as const;

class NvPgJobQueueEventBus implements NvEventBusInterface {
  private subscribers = new Map<string, EventHandler[]>();
  private eventLog: DomainEvent[] = [];
  private sequenceCounter = 0;

  async publish(event: DomainEvent): Promise<void> {
    event.sequenceNumber = ++this.sequenceCounter;
    event.metadata.timestamp = new Date();
    if (!event.id) event.id = crypto.randomUUID();

    this.eventLog.push(event);
    logger.info({ method: 'publish', eventType: event.type, aggregateId: event.aggregateId, seq: event.sequenceNumber });

    const handlers = this.subscribers.get(event.type) || [];
    for (const handler of handlers) {
      try {
        await handler(event);
      } catch (error: any) {
        logger.error({ method: 'publish', eventType: event.type, error: (error as Error).message });
      }
    }
  }

  async subscribe(topic: string, handler: EventHandler): Promise<void> {
    const existing = this.subscribers.get(topic) || [];
    existing.push(handler);
    this.subscribers.set(topic, existing);
    logger.info({ method: 'subscribe', topic, handlerCount: existing.length });
  }

  async publishBatch(events: DomainEvent[]): Promise<void> {
    logger.info({ method: 'publishBatch', count: events.length });
    for (const event of events) {
      await this.publish(event);
    }
  }

  getEventLog(): DomainEvent[] {
    return [...this.eventLog];
  }

  getEventsByType(type: string): DomainEvent[] {
    return this.eventLog.filter(e => e.type === type);
  }

  getEventsByAggregate(aggregateId: string): DomainEvent[] {
    return this.eventLog.filter(e => e.aggregateId === aggregateId);
  }
}

class NvEventSourcingAdapter {
  private bus: NvEventBusInterface;
  private mode: 'pg-queue' | 'kafka';

  constructor() {
    this.mode = process.env.JRX_EVENT_BUS_MODE === 'kafka' ? 'kafka' : 'pg-queue';
    this.bus = new NvPgJobQueueEventBus();
    logger.info({ service: 'NvEventSourcingAdapter', mode: this.mode });

    if (this.mode === 'kafka') {
      logger.warn({ note: 'Kafka mode configured but using PgJobQueue fallback — Kafka integration is post-sprint' });
    }
  }

  async publish(event: Partial<DomainEvent> & { type: string; aggregateId: string; aggregateType: string; payload: Record<string, unknown> }): Promise<void> {
    const fullEvent: DomainEvent = {
      id: event.id || crypto.randomUUID(),
      type: event.type,
      aggregateId: event.aggregateId,
      aggregateType: event.aggregateType,
      payload: event.payload,
      metadata: event.metadata || {
        traceId: `trace-${crypto.randomBytes(8).toString('hex')}`,
        timestamp: new Date(),
        version: '3.1.2',
      },
      sequenceNumber: 0,
    };

    await this.bus.publish(fullEvent);
  }

  async subscribe(topic: string, handler: EventHandler): Promise<void> {
    await this.bus.subscribe(topic, handler);
  }

  async publishBatch(events: DomainEvent[]): Promise<void> {
    await this.bus.publishBatch(events);
  }

  async publishStatuteAmended(sectionId: string, jurisdiction: string, gazetteRef: string): Promise<void> {
    await this.publish({
      type: 'statute.amended',
      aggregateId: sectionId,
      aggregateType: 'statute',
      payload: { sectionId, jurisdiction, gazetteRef },
    });
  }

  async publishMatterMemoryUpdated(matterId: string, memoryType: string): Promise<void> {
    await this.publish({
      type: 'matter.memory.updated',
      aggregateId: matterId,
      aggregateType: 'matter',
      payload: { matterId, memoryType },
    });
  }

  async publishAgentQualityEvaluated(agentId: string, score: number): Promise<void> {
    await this.publish({
      type: 'agent.quality.evaluated',
      aggregateId: agentId,
      aggregateType: 'agent',
      payload: { agentId, score },
    });
  }

  async publishDocumentForensicCompleted(documentHash: string, verdict: string): Promise<void> {
    await this.publish({
      type: 'document.forensic.completed',
      aggregateId: documentHash,
      aggregateType: 'document',
      payload: { documentHash, verdict },
    });
  }

  async publishCitationUnverified(citationId: string, reason: string): Promise<void> {
    await this.publish({
      type: 'citation.unverified.detected',
      aggregateId: citationId,
      aggregateType: 'citation',
      payload: { citationId, reason },
    });
  }

  getMode(): string {
    return this.mode;
  }
}

export const nvEventSourcingAdapter = new NvEventSourcingAdapter();
