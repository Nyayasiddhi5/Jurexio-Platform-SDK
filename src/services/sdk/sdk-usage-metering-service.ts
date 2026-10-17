// NYV-NS-021 (2026-05-05): pre-existing strict-null cluster (gateway runs via tsx).
import { db as _db } from '../../db/index.js';
import { sdkUsageMetering, sdkApiRequestLogs } from '@shared/schema.js';
import { eq, and, sql, gte, lte } from 'drizzle-orm';
import { createLogger } from '../../utils/logger.js';


const logger = createLogger('sdk-usage-metering-service');

function getDb() {
  if (!_db) throw new Error('Database not initialized');
  return _db;
}

interface MeterEvent {
  applicationId: number;
  organizationId: number;
  apiKeyId?: number;
  endpoint: string;
  method: string;
  statusCode: number;
  latencyMs: number;
  tokensUsed: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  estimatedCost: number;
  agentId?: string;
  llmProvider?: string;
  llmModel?: string;
  requestId: string;
  ipAddress?: string;
  userAgent?: string;
  errorMessage?: string;
  metadata?: Record<string, any>;
}

class SdkUsageMeteringService {
  private batchBuffer: MeterEvent[] = [];
  private flushInterval: NodeJS.Timeout | null = null;
  private readonly BATCH_SIZE = 50;
  private readonly FLUSH_INTERVAL_MS = 10_000;

  constructor() {
    this.flushInterval = setInterval(() => this.flush(), this.FLUSH_INTERVAL_MS);
    this.flushInterval.unref();
  }

  async recordRequest(event: MeterEvent): Promise<void> {
    try {
      // @ts-expect-error NV-TS230 legacy typing gap (TS2769)
      await getDb().insert(sdkApiRequestLogs).values({
        applicationId: event.applicationId,
        organizationId: event.organizationId,
        apiKeyId: event.apiKeyId ?? null,
        requestId: event.requestId,
        endpoint: event.endpoint,
        method: event.method,
        statusCode: event.statusCode,
        latencyMs: event.latencyMs,
        tokensUsed: event.tokensUsed,
        estimatedCost: String(event.estimatedCost),
        agentId: event.agentId ?? null,
        llmProvider: event.llmProvider ?? null,
        llmModel: event.llmModel ?? null,
        ipAddress: event.ipAddress ?? null,
        userAgent: event.userAgent ?? null,
        errorMessage: event.errorMessage ?? null,
        metadata: event.metadata ?? {},
      });
    } catch (err: any) {
      if (!err?.message?.includes('duplicate key')) {
        logger.error('[UsageMetering] Failed to log request:', err?.message);
      }
    }

    this.batchBuffer.push(event);
    if (this.batchBuffer.length >= this.BATCH_SIZE) {
      await this.flush();
    }
  }

  private async flush(): Promise<void> {
    if (this.batchBuffer.length === 0) return;
    const events = [...this.batchBuffer];
    this.batchBuffer = [];

    const grouped = new Map<string, MeterEvent[]>();
    for (const event of events) {
      const now = new Date();
      const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      // Pipe delimiter — ISO timestamps contain colons; naive `:` split corrupts period_start.
      const key = `${event.applicationId}|${dayStart.toISOString()}|daily`;
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key)!.push(event);
    }

    for (const [key, groupEvents] of grouped) {
      const [appIdStr, periodStartStr] = key.split('|');
      const applicationId = parseInt(appIdStr);
      const periodStart = new Date(periodStartStr);
      const periodEnd = new Date(periodStart);
      periodEnd.setDate(periodEnd.getDate() + 1);

      const totalRequests = groupEvents.length;
      const successfulRequests = groupEvents.filter(e => e.statusCode < 400).length;
      const failedRequests = totalRequests - successfulRequests;
      const totalTokens = groupEvents.reduce((s, e) => s + e.tokensUsed, 0);
      const totalInput = groupEvents.reduce((s, e) => s + e.inputTokens, 0);
      const totalOutput = groupEvents.reduce((s, e) => s + e.outputTokens, 0);
      const totalCacheRead = groupEvents.reduce((s, e) => s + (e.cacheReadTokens ?? 0), 0);
      const totalCacheWrite = groupEvents.reduce((s, e) => s + (e.cacheWriteTokens ?? 0), 0);
      const totalCost = groupEvents.reduce((s, e) => s + e.estimatedCost, 0);
      const avgLatency = Math.round(groupEvents.reduce((s, e) => s + e.latencyMs, 0) / totalRequests);
      const sortedLatencies = groupEvents.map(e => e.latencyMs).sort((a, b) => a - b);
      const p99Latency = sortedLatencies[Math.floor(sortedLatencies.length * 0.99)] || avgLatency;

      const endpointBreakdown: Record<string, number> = {};
      const providerBreakdown: Record<string, number> = {};
      const agentBreakdown: Record<string, number> = {};
      for (const e of groupEvents) {
        endpointBreakdown[e.endpoint] = (endpointBreakdown[e.endpoint] || 0) + 1;
        if (e.llmProvider) providerBreakdown[e.llmProvider] = (providerBreakdown[e.llmProvider] || 0) + 1;
        if (e.agentId) agentBreakdown[e.agentId] = (agentBreakdown[e.agentId] || 0) + 1;
      }

      const orgId = groupEvents[0].organizationId;

      try {
        await getDb().execute(sql`
          INSERT INTO sdk_usage_metering (application_id, organization_id, period_start, period_end, period_type,
            total_requests, successful_requests, failed_requests, total_tokens_used, total_input_tokens,
            total_output_tokens, total_cost, endpoint_breakdown, provider_breakdown, agent_breakdown,
            peak_requests_per_minute, avg_latency_ms, p99_latency_ms, updated_at)
          VALUES (${applicationId}, ${orgId}, ${periodStart.toISOString()}, ${periodEnd.toISOString()}, 'daily',
            ${totalRequests}, ${successfulRequests}, ${failedRequests}, ${totalTokens}, ${totalInput},
            ${totalOutput}, ${totalCost}, ${JSON.stringify(endpointBreakdown)}::jsonb, ${JSON.stringify(providerBreakdown)}::jsonb, ${JSON.stringify(agentBreakdown)}::jsonb,
            ${totalRequests}, ${avgLatency}, ${p99Latency}, now())
          ON CONFLICT (application_id, period_start, period_type)
          DO UPDATE SET
            total_requests = sdk_usage_metering.total_requests + EXCLUDED.total_requests,
            successful_requests = sdk_usage_metering.successful_requests + EXCLUDED.successful_requests,
            failed_requests = sdk_usage_metering.failed_requests + EXCLUDED.failed_requests,
            total_tokens_used = sdk_usage_metering.total_tokens_used + EXCLUDED.total_tokens_used,
            total_input_tokens = sdk_usage_metering.total_input_tokens + EXCLUDED.total_input_tokens,
            total_output_tokens = sdk_usage_metering.total_output_tokens + EXCLUDED.total_output_tokens,
            total_cost = sdk_usage_metering.total_cost + EXCLUDED.total_cost,
            avg_latency_ms = (sdk_usage_metering.avg_latency_ms + EXCLUDED.avg_latency_ms) / 2,
            p99_latency_ms = GREATEST(sdk_usage_metering.p99_latency_ms, EXCLUDED.p99_latency_ms),
            updated_at = now()
        `);
      } catch (err: any) {
        logger.error('[UsageMetering] Aggregation flush error:', err?.message);
      }
    }
  }

  async getUsageSummary(applicationId: number, periodType: string = 'daily', days: number = 30): Promise<any> {
    const since = new Date();
    since.setDate(since.getDate() - days);
    const records = await getDb().select().from(sdkUsageMetering)
      .where(and(
        eq(sdkUsageMetering.applicationId, applicationId),
        // @ts-expect-error NV-TS230 legacy typing gap (TS2339)
        eq(sdkUsageMetering.periodType, periodType),
        // @ts-expect-error NV-TS230 legacy typing gap (TS2339)
        gte(sdkUsageMetering.periodStart, since)
      ))
      // @ts-expect-error NV-TS230 legacy typing gap (TS2339)
      .orderBy(sdkUsageMetering.periodStart);
    return records;
  }

  async getOrganizationUsage(organizationId: number, days: number = 30): Promise<any> {
    const since = new Date();
    since.setDate(since.getDate() - days);
    const records = await getDb().select().from(sdkUsageMetering)
      .where(and(
        // @ts-expect-error NV-TS230 legacy typing gap (TS2339)
        eq(sdkUsageMetering.organizationId, organizationId),
        // @ts-expect-error NV-TS230 legacy typing gap (TS2339)
        gte(sdkUsageMetering.periodStart, since)
      ))
      // @ts-expect-error NV-TS230 legacy typing gap (TS2339)
      .orderBy(sdkUsageMetering.periodStart);
    return records;
  }

  destroy(): void {
    if (this.flushInterval) clearInterval(this.flushInterval);
  }
}

export const sdkUsageMeteringService = new SdkUsageMeteringService();
