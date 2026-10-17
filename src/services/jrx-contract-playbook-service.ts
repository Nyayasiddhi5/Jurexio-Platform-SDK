/**
 * Contract playbook analysis — extracted from nv-orchestration-services
 * so capability-manifest leaf factories can bind without loading the full
 * orchestration monolith (avoids circular init with nv-client).
 */
import { db as rawDb } from '../db/index.js';
import { sql } from 'drizzle-orm';
import { requireDb } from '../utils/jrx-type-helpers.js';

const db: NonNullable<typeof rawDb> = new Proxy({} as NonNullable<typeof rawDb>, {
  get(_t, prop, receiver) {
    const real = requireDb(rawDb) as unknown as Record<string | symbol, unknown>;
    const v = Reflect.get(real, prop, receiver);
    return typeof v === 'function' ? (v as (...args: unknown[]) => unknown).bind(real) : v;
  },
}) as NonNullable<typeof rawDb>;

export class NvContractPlaybookService {
  async createPlaybook(params: {
    tenantId: string;
    name: string;
    description?: string;
    contractType?: string;
    jurisdiction?: string;
    requiredClauses?: string[];
    prohibitedTerms?: string[];
    createdBy?: string;
  }): Promise<{ id: string }> {
    const result = await db.execute(sql`
      INSERT INTO nv_schema.contract_playbooks (tenant_id, name, description, contract_type, jurisdiction, required_clauses, prohibited_terms, created_by)
      VALUES (${params.tenantId}, ${params.name}, ${params.description || null}, ${params.contractType || null}, ${params.jurisdiction || null}, ${JSON.stringify(params.requiredClauses || [])}, ${JSON.stringify(params.prohibitedTerms || [])}, ${params.createdBy || null})
      RETURNING id
    `);
    return { id: (result.rows?.[0] as { id?: string } | undefined)?.id || '' };
  }

  async checkAgainstPlaybook(params: {
    playbookId: string;
    documentText: string;
    tenantId: string;
  }): Promise<{ overallScore: number; deviations: Array<Record<string, unknown>>; riskLevel: string }> {
    const playbook = await db.execute(sql`SELECT * FROM nv_schema.contract_playbooks WHERE id = ${params.playbookId}`);
    const pb = playbook.rows?.[0] as {
      required_clauses?: string[];
      prohibited_terms?: string[];
    } | undefined;
    if (!pb) throw new Error('Playbook not found');

    const deviations: Array<Record<string, unknown>> = [];
    const requiredClauses = (pb.required_clauses || []) as string[];
    const prohibitedTerms = (pb.prohibited_terms || []) as string[];
    const docLower = params.documentText.toLowerCase();

    for (const clause of requiredClauses) {
      if (!docLower.includes(clause.toLowerCase())) {
        deviations.push({ type: 'missing_clause', clause, severity: 'high' });
      }
    }

    for (const term of prohibitedTerms) {
      if (docLower.includes(term.toLowerCase())) {
        deviations.push({ type: 'prohibited_term', term, severity: 'critical' });
      }
    }

    const overallScore = Math.max(0, 1 - deviations.length * 0.15);
    const riskLevel = overallScore >= 0.8 ? 'low' : overallScore >= 0.5 ? 'medium' : 'high';

    await db.execute(sql`
      INSERT INTO nv_schema.playbook_checks (playbook_id, tenant_id, overall_score, deviations, risk_level)
      VALUES (${params.playbookId}, ${params.tenantId}, ${overallScore}, ${JSON.stringify(deviations)}, ${riskLevel})
    `);

    return { overallScore, deviations, riskLevel };
  }

  async getPlaybooks(tenantId?: string): Promise<unknown[]> {
    const result = tenantId
      ? await db.execute(sql`SELECT * FROM nv_schema.contract_playbooks WHERE tenant_id = ${tenantId} AND is_active = true ORDER BY created_at DESC`)
      : await db.execute(sql`SELECT * FROM nv_schema.contract_playbooks WHERE is_active = true ORDER BY created_at DESC`);
    return result.rows || [];
  }
}

export const nvContractPlaybookService = new NvContractPlaybookService();
