// NYV-NS-021 (2026-05-05): pre-existing strict-null violations cluster in this
// file. Runtime is unaffected (gateway runs via tsx). Opt out of strict-null
// for the v5.0.0 deploy gate; track follow-up cleanup in INV-CLEANUP-001.
/**
 * Security Audit Persistence Service
 *
 * Production service for persisting security audit data to database
 * Provides full audit trail, compliance reporting, and vulnerability tracking
 *
 * Task #262 (2026-05-13): Replaced the in-memory `db` no-op stub and the
 * `Tbl = {} as ...` table-shape stubs with the canonical Drizzle bindings
 * from `src/db/index.ts` + the six new nv_schema tables defined in
 * `shared/schema.ts` (migration drizzle/0011_security_audit_persistence.sql).
 * Until that change every call here appeared to succeed while silently
 * dropping the row.
 */

import { eq, desc, and, gte, lte } from 'drizzle-orm';
import { db as rawDb } from '../../db/index.js';
import { lazyRequire } from '../../utils/jrx-type-helpers.js';
import {
  nvSecurityAuditLogs,
  nvPiiDetections,
  nvComplianceReports,
  nvAttackSimulations,
  nvVulnerabilityHistory,
  nvSecurityMetrics,
  type NewNvSecurityAuditLog,
  type NewNvPiiDetection,
  type NewNvComplianceReport,
  type NewNvAttackSimulation,
  type NewNvVulnerabilityHistory,
  type NewNvSecurityMetric,
  type NvSecurityAuditLog,
  type NvComplianceReport,
} from '../../../shared/schema.js';
import type { SecurityVulnerability, PIIDetection as PIIDetectionType, AttackResult } from './security-audit-service.js';
import { createLogger } from '../../utils/logger.js';

const logger = createLogger('security-audit-persistence-servi');

// task-251 / task-262: lazy non-null binding. Throws clearly with
// `NyvMissingDependencyError('db')` at first use if the gateway booted
// without a database (instead of silently swallowing writes like the
// previous stub did).
const db = lazyRequire(() => rawDb, 'db');

interface ComplianceReportInput {
  standard: string;
  coveragePeriod: { start: Date; end: Date };
  compliant: boolean;
  findings: Array<{ severity: string }>;
  recommendations: unknown;
}

type DailyMetricsInput = Omit<NewNvSecurityMetric, 'id' | 'createdAt' | 'metricDate'>;

export class SecurityAuditPersistenceService {
  /**
   * Persist security audit log to database
   * FIX: Now uses canonical targetType, null-safe evidence, and persists CVSS data
   */
  async logSecurityAudit(vulnerability: SecurityVulnerability, userId?: string, projectId?: string, agentId?: string): Promise<number> {
    // FIX: Normalize targetType to canonical values
    const targetType = this.normalizeTargetType(vulnerability.location);

    // FIX: Null-safe evidence truncation
    const evidence = vulnerability.evidence ? vulnerability.evidence.substring(0, 500) : '';

    const auditLog: NewNvSecurityAuditLog = {
      scanType: this.extractScanType(vulnerability.type),
      targetType, // FIX: Use canonical targetType
      severity: vulnerability.severity,
      vulnerabilityType: vulnerability.type,
      owaspId: vulnerability.owaspId,
      cweId: vulnerability.cweId ?? null,
      title: vulnerability.title,
      description: vulnerability.description,
      location: vulnerability.location,
      evidence, // FIX: Null-safe truncation
      recommendation: vulnerability.recommendation,
      rawData: {
        vulnerability,
        cvssScore: vulnerability.cvssScore, // FIX: Include CVSS data
        cvssVector: vulnerability.cvssVector,
      },
      agentId: agentId ?? null,
      userId: userId ?? null,
      projectId: projectId ?? null,
      resolved: false,
    };

    const [result] = await db.insert(nvSecurityAuditLogs).values(auditLog).returning({ id: nvSecurityAuditLogs.id });
    logger.info(`[Security Audit] Logged vulnerability ${vulnerability.type} with ID ${result.id} (CVSS: ${vulnerability.cvssScore || 'N/A'})`);

    return result.id;
  }

  /**
   * FIX: Normalize location string to canonical targetType
   */
  private normalizeTargetType(location: string): string {
    const locationMap: { [key: string]: string } = {
      'user_input': 'prompt',
      'output_text': 'output',
      'api_endpoint': 'code',
      'training_data': 'data',
      'llm_processing': 'model',
      'package.json': 'dependencies',
      'Line': 'code', // For "Line X, Column Y" locations
    };

    // Find matching canonical type
    for (const [pattern, canonical] of Object.entries(locationMap)) {
      if (location.includes(pattern)) {
        return canonical;
      }
    }

    // Default to 'code' if no match
    return 'code';
  }

  /**
   * Persist multiple PII detections
   * FIX: Now null-safe for context truncation
   */
  async logPiiDetections(auditLogId: number, detections: PIIDetectionType[]): Promise<void> {
    if (detections.length === 0) return;

    const piiRecords: NewNvPiiDetection[] = detections.map(detection => ({
      auditLogId,
      piiType: detection.type,
      confidence: Math.round(detection.confidence * 100), // Convert 0-1 to 0-100
      locationStart: detection.location.start,
      locationEnd: detection.location.end,
      redactedValue: detection.redacted,
      context: detection.value ? detection.value.substring(0, 100) : '', // FIX: Null-safe truncation
    }));

    await db.insert(nvPiiDetections).values(piiRecords);
    logger.info(`[Security Audit] Logged ${piiRecords.length} PII detections for audit ${auditLogId}`);
  }

  /**
   * Persist compliance report
   */
  async saveComplianceReport(report: ComplianceReportInput, generatedBy?: string): Promise<number> {
    const reportData: NewNvComplianceReport = {
      standard: report.standard,
      reportType: 'full_audit',
      dateRangeStart: report.coveragePeriod.start,
      dateRangeEnd: report.coveragePeriod.end,
      compliant: report.compliant,
      criticalFindings: report.findings.filter((f) => f.severity === 'CRITICAL').length,
      highFindings: report.findings.filter((f) => f.severity === 'HIGH').length,
      mediumFindings: report.findings.filter((f) => f.severity === 'MEDIUM').length,
      lowFindings: report.findings.filter((f) => f.severity === 'LOW').length,
      infoFindings: report.findings.filter((f) => f.severity === 'INFO').length,
      totalFindings: report.findings.length,
      findings: report.findings,
      recommendations: report.recommendations,
      evidenceSources: {}, // Populated with log IDs by upstream caller
      generatedBy: generatedBy ?? null,
    };

    const [result] = await db.insert(nvComplianceReports).values(reportData).returning({ id: nvComplianceReports.id });
    logger.info(`[Security Audit] Saved ${report.standard} compliance report with ID ${result.id}`);

    return result.id;
  }

  /**
   * Persist attack simulation result
   */
  async logAttackSimulation(attack: AttackResult, targetAgent: string): Promise<number> {
    const simulationData: NewNvAttackSimulation = {
      attackType: attack.attackType,
      targetAgent,
      payload: attack.payload,
      response: attack.response,
      successful: attack.successful,
      severity: attack.severity,
      blocked: false, // Determined by detection
      mitigation: attack.mitigation,
      techniques: [], // Extracted from attack
      metadata: { attack } as Record<string, unknown>,
    };

    const [result] = await db.insert(nvAttackSimulations).values(simulationData).returning({ id: nvAttackSimulations.id });
    logger.info(`[Security Audit] Logged ${attack.attackType} attack simulation with ID ${result.id}`);

    return result.id;
  }

  /**
   * Create or update vulnerability in history tracker
   */
  async trackVulnerability(vulnerabilityId: string, auditLogId: number, priority: string, cvssScore?: number): Promise<void> {
    const historyData: NewNvVulnerabilityHistory = {
      vulnerabilityId,
      auditLogId,
      status: 'discovered',
      priority,
      cvssScore: cvssScore ?? null,
      affectedSystems: [],
    };

    await db.insert(nvVulnerabilityHistory).values(historyData);
    logger.info(`[Security Audit] Tracking vulnerability ${vulnerabilityId} with priority ${priority}`);
  }

  /**
   * Update vulnerability status
   */
  async updateVulnerabilityStatus(vulnerabilityId: string, status: string, assignedTo?: string, notes?: string): Promise<void> {
    await db.update(nvVulnerabilityHistory)
      .set({
        status,
        assignedTo: assignedTo ?? null,
        notes: notes ?? null,
        updatedAt: new Date(),
      })
      .where(eq(nvVulnerabilityHistory.vulnerabilityId, vulnerabilityId));

    logger.info(`[Security Audit] Updated vulnerability ${vulnerabilityId} status to ${status}`);
  }

  /**
   * Mark vulnerability as resolved
   */
  async resolveVulnerability(id: number, resolvedBy: string): Promise<void> {
    await db.update(nvSecurityAuditLogs)
      .set({
        resolved: true,
        resolvedAt: new Date(),
        resolvedBy,
        updatedAt: new Date(),
      })
      .where(eq(nvSecurityAuditLogs.id, id));

    logger.info(`[Security Audit] Resolved vulnerability ${id} by ${resolvedBy}`);
  }

  /**
   * Get audit logs for date range
   * FIX: Simplified query builder to avoid duplicate where clauses
   */
  async getAuditLogs(startDate: Date, endDate: Date, severity?: string): Promise<NvSecurityAuditLog[]> {
    const conditions = [
      gte(nvSecurityAuditLogs.createdAt, startDate),
      lte(nvSecurityAuditLogs.createdAt, endDate),
    ];

    // FIX: Add severity filter to conditions array
    if (severity) {
      conditions.push(eq(nvSecurityAuditLogs.severity, severity));
    }

    const logs = await db.select()
      .from(nvSecurityAuditLogs)
      .where(and(...conditions))
      .orderBy(desc(nvSecurityAuditLogs.createdAt));

    logger.info(`[Security Audit] Retrieved ${logs.length} audit logs from ${startDate.toISOString()} to ${endDate.toISOString()}`);

    return logs as NvSecurityAuditLog[];
  }

  /**
   * Get compliance reports for standard
   */
  async getComplianceReports(standard: string, limit: number = 10): Promise<NvComplianceReport[]> {
    const reports = await db.select()
      .from(nvComplianceReports)
      .where(eq(nvComplianceReports.standard, standard))
      .orderBy(desc(nvComplianceReports.createdAt))
      .limit(limit);

    return reports as NvComplianceReport[];
  }

  /**
   * Record daily security metrics
   */
  async recordDailyMetrics(date: Date, metrics: Partial<DailyMetricsInput>): Promise<void> {
    const metricsData: NewNvSecurityMetric = {
      metricDate: date,
      totalScans: metrics.totalScans || 0,
      promptInjectionAttempts: metrics.promptInjectionAttempts || 0,
      piiLeaks: metrics.piiLeaks || 0,
      maliciousCodeDetected: metrics.maliciousCodeDetected || 0,
      jailbreakAttempts: metrics.jailbreakAttempts || 0,
      dataExtractionAttempts: metrics.dataExtractionAttempts || 0,
      criticalVulnerabilities: metrics.criticalVulnerabilities || 0,
      highVulnerabilities: metrics.highVulnerabilities || 0,
      mediumVulnerabilities: metrics.mediumVulnerabilities || 0,
      lowVulnerabilities: metrics.lowVulnerabilities || 0,
      meanTimeToDetect: metrics.meanTimeToDetect ?? null,
      meanTimeToResolve: metrics.meanTimeToResolve ?? null,
      complianceScore: metrics.complianceScore ?? null,
      metadata: metrics.metadata || {},
    };

    await db.insert(nvSecurityMetrics).values(metricsData);
    logger.info(`[Security Audit] Recorded security metrics for ${date.toISOString()}`);
  }

  /**
   * Get security dashboard metrics
   */
  async getDashboardMetrics(days: number = 30): Promise<{
    totalVulnerabilities: number;
    criticalCount: number;
    highCount: number;
    resolvedCount: number;
    unresolvedCount: number;
    averageResolutionTime: number;
  }> {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const logs = await this.getAuditLogs(startDate, new Date());

    const criticalCount = logs.filter(l => l.severity === 'CRITICAL').length;
    const highCount = logs.filter(l => l.severity === 'HIGH').length;
    const resolvedCount = logs.filter(l => l.resolved).length;
    const unresolvedCount = logs.length - resolvedCount;

    // Calculate average resolution time
    const resolved = logs.filter(l => l.resolved && l.resolvedAt);
    const avgResolutionTime = resolved.length > 0
      ? resolved.reduce((sum, log) => {
          const createdTime = new Date(log.createdAt).getTime();
          const resolvedTime = log.resolvedAt ? new Date(log.resolvedAt).getTime() : createdTime;
          return sum + (resolvedTime - createdTime);
        }, 0) / resolved.length
      : 0;

    return {
      totalVulnerabilities: logs.length,
      criticalCount,
      highCount,
      resolvedCount,
      unresolvedCount,
      averageResolutionTime: Math.round(avgResolutionTime / 1000 / 60), // Convert to minutes
    };
  }

  /**
   * Helper: Extract scan type from vulnerability type
   */
  private extractScanType(vulnerabilityType: string): string {
    const typeMap: { [key: string]: string } = {
      'LLM01_PROMPT_INJECTION': 'prompt_injection',
      'LLM02_INSECURE_OUTPUT': 'malicious_code',
      'LLM03_DATA_POISONING': 'data_poisoning',
      'LLM04_DOS': 'dos_attack',
      'LLM05_SUPPLY_CHAIN': 'supply_chain',
      'LLM06_PII_DISCLOSURE': 'pii_detection',
      'LLM07_INSECURE_PLUGIN': 'plugin_security',
      'LLM08_EXCESSIVE_AGENCY': 'excessive_agency',
      'LLM09_OVERRELIANCE': 'overreliance',
      'LLM10_MODEL_THEFT': 'model_theft',
    };

    return typeMap[vulnerabilityType] || 'unknown';
  }
}

/**
 * Singleton instance
 */
export const securityPersistence = new SecurityAuditPersistenceService();
