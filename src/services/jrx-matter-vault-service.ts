/**
 * NV-MATTER-VAULT-001 — Harvey-style matter vault with Postgres write-through.
 * Hot Map cache + nv_schema.nv_matter_vaults (fallback: async_job_queue mirror).
 */
import { randomUUID } from 'node:crypto';
import { createLogger } from '../utils/logger.js';
import { createEcosystemDocumentJob } from './jrx-ecosystem-document-job-service.js';
import { autoRagRetrieve } from './jrx-auto-rag-router.js';
import { nvContractPlaybookService } from './jrx-orchestration-services.js';
import { nyvDocumentStorage } from './jrx-document-storage-service.js';
import type { CreateEdjRequest, EdjOutputProfile } from './jrx-ecosystem-document-job-contract.js';
import {
  parseIntelligenceDepth,
  type NvIntelligenceDepth,
} from '../config/jrx-intelligence-depth.js';

const logger = createLogger('./jrx-matter-vault');

export type MatterVaultStatus =
  | 'draft'
  | 'ingesting'
  | 'ready'
  | 'reviewing'
  | 'archived';

export interface MatterVaultDocument {
  docId: string;
  fileName: string;
  edjJobId?: string;
  status: 'queued' | 'processing' | 'ready' | 'failed';
  mimeType?: string;
  depth?: NvIntelligenceDepth;
  uploadedAt: string;
  error?: string;
}

export interface MatterVaultPlaybookRun {
  runId: string;
  playbookId: string;
  status: 'queued' | 'completed' | 'failed';
  startedAt: string;
  completedAt?: string;
  result?: unknown;
  error?: string;
}

export interface MatterVault {
  vaultId: string;
  name: string;
  matterRef?: string;
  description?: string;
  jurisdiction: string;
  orgId?: string;
  userId?: string;
  status: MatterVaultStatus;
  defaultDepth: NvIntelligenceDepth;
  documents: MatterVaultDocument[];
  edjJobIds: string[];
  playbookRuns: MatterVaultPlaybookRun[];
  ragSummary?: {
    chunkCount: number;
    confidence?: number;
    layersUsed?: string[];
    lastQuery?: string;
    probedAt?: string;
  };
  createdAt: string;
  updatedAt: string;
}

export interface CreateMatterVaultInput {
  name: string;
  matterRef?: string;
  description?: string;
  jurisdiction?: string;
  orgId?: string;
  userId?: string;
  defaultDepth?: string;
}

export interface BatchUploadItem {
  fileName: string;
  contentBase64: string;
  mimeType?: string;
  outputProfile?: EdjOutputProfile;
  depth?: string;
}

export interface RunPlaybookInput {
  playbookId: string;
  documentText?: string;
  tenantId?: string;
  probeRag?: boolean;
  ragQuery?: string;
  depth?: string;
}

const vaults = new Map<string, MatterVault>();

function aclOk(vault: MatterVault, orgId?: string): boolean {
  if (!orgId || !vault.orgId) return true;
  return vault.orgId === orgId;
}

function rowToVault(row: {
  vaultId: string;
  organizationId?: string | null;
  userId?: string | null;
  name: string;
  matterRef?: string | null;
  description?: string | null;
  jurisdiction: string;
  status: string;
  defaultDepth?: string | null;
  payload: Record<string, unknown> | null;
  createdAt?: Date | string | null;
  updatedAt?: Date | string | null;
}): MatterVault {
  const p = (row.payload ?? {}) as Partial<MatterVault>;
  return {
    vaultId: row.vaultId,
    name: row.name,
    matterRef: row.matterRef ?? undefined,
    description: row.description ?? undefined,
    jurisdiction: row.jurisdiction,
    orgId: row.organizationId ?? undefined,
    userId: row.userId ?? undefined,
    status: (row.status as MatterVaultStatus) || 'draft',
    defaultDepth: parseIntelligenceDepth(row.defaultDepth ?? p.defaultDepth, 'detailed'),
    documents: Array.isArray(p.documents) ? (p.documents as MatterVaultDocument[]) : [],
    edjJobIds: Array.isArray(p.edjJobIds) ? (p.edjJobIds as string[]) : [],
    playbookRuns: Array.isArray(p.playbookRuns) ? (p.playbookRuns as MatterVaultPlaybookRun[]) : [],
    ragSummary: p.ragSummary as MatterVault['ragSummary'],
    createdAt:
      typeof row.createdAt === 'string'
        ? row.createdAt
        : row.createdAt?.toISOString?.() ?? new Date().toISOString(),
    updatedAt:
      typeof row.updatedAt === 'string'
        ? row.updatedAt
        : row.updatedAt?.toISOString?.() ?? new Date().toISOString(),
  };
}

async function persistVault(vault: MatterVault): Promise<void> {
  try {
    const { db } = await import('../db/index.js');
    if (!db) return;
    const { sql } = await import('drizzle-orm');
    const payload = {
      documents: vault.documents,
      edjJobIds: vault.edjJobIds,
      playbookRuns: vault.playbookRuns,
      ragSummary: vault.ragSummary,
      defaultDepth: vault.defaultDepth,
    };
    await db.execute(sql`
      INSERT INTO nv_schema.nv_matter_vaults (
        vault_id, organization_id, user_id, name, matter_ref, description,
        jurisdiction, status, default_depth, payload, created_at, updated_at
      ) VALUES (
        ${vault.vaultId},
        ${vault.orgId ?? null},
        ${vault.userId ?? null},
        ${vault.name},
        ${vault.matterRef ?? null},
        ${vault.description ?? null},
        ${vault.jurisdiction},
        ${vault.status},
        ${vault.defaultDepth},
        ${JSON.stringify(payload)}::jsonb,
        ${vault.createdAt}::timestamptz,
        NOW()
      )
      ON CONFLICT (vault_id) DO UPDATE SET
        organization_id = EXCLUDED.organization_id,
        user_id = EXCLUDED.user_id,
        name = EXCLUDED.name,
        matter_ref = EXCLUDED.matter_ref,
        description = EXCLUDED.description,
        jurisdiction = EXCLUDED.jurisdiction,
        status = EXCLUDED.status,
        default_depth = EXCLUDED.default_depth,
        payload = EXCLUDED.payload,
        updated_at = NOW()
    `);
  } catch (e) {
    // Fallback mirror for environments without migration yet.
    try {
      const { db } = await import('../db/index.js');
      if (!db) return;
      const { sql } = await import('drizzle-orm');
      await db.execute(sql`
        INSERT INTO nv_schema.async_job_queue (
          job_id, job_type, status, input, output, created_at, updated_at
        ) VALUES (
          ${`mv-${vault.vaultId}`},
          ${'matter_vault_meta'},
          ${'completed'},
          ${JSON.stringify({ vaultId: vault.vaultId, orgId: vault.orgId })},
          ${JSON.stringify(vault)},
          NOW(),
          NOW()
        )
        ON CONFLICT (job_id) DO UPDATE SET
          output = EXCLUDED.output,
          updated_at = NOW()
      `);
    } catch (e2) {
      logger.warn('matter-vault persist failed (non-fatal)', {
        vaultId: vault.vaultId,
        error: (e as Error).message,
        fallbackError: (e2 as Error).message,
      });
    }
  }
}

async function loadVaultFromDb(vaultId: string): Promise<MatterVault | undefined> {
  try {
    const { db } = await import('../db/index.js');
    if (!db) return undefined;
    const { sql } = await import('drizzle-orm');
    const result = await db.execute(sql`
      SELECT vault_id, organization_id, user_id, name, matter_ref, description,
             jurisdiction, status, default_depth, payload, created_at, updated_at
      FROM nv_schema.nv_matter_vaults
      WHERE vault_id = ${vaultId}
      LIMIT 1
    `);
    const rows = (result as { rows?: Record<string, unknown>[] }).rows ?? [];
    if (!rows.length) {
      // Legacy mirror
      const legacy = await db.execute(sql`
        SELECT output FROM nv_schema.async_job_queue
        WHERE job_id = ${`mv-${vaultId}`} AND job_type = 'matter_vault_meta'
        LIMIT 1
      `);
      const legRows = (legacy as { rows?: { output?: MatterVault }[] }).rows ?? [];
      if (legRows[0]?.output) {
        const v = legRows[0].output as MatterVault;
        if (!v.defaultDepth) v.defaultDepth = 'detailed';
        vaults.set(v.vaultId, v);
        return v;
      }
      return undefined;
    }
    const r = rows[0];
    const vault = rowToVault({
      vaultId: String(r.vault_id),
      organizationId: r.organization_id as string | null,
      userId: r.user_id as string | null,
      name: String(r.name),
      matterRef: r.matter_ref as string | null,
      description: r.description as string | null,
      jurisdiction: String(r.jurisdiction ?? 'IN'),
      status: String(r.status ?? 'draft'),
      defaultDepth: r.default_depth as string | null,
      payload: (r.payload as Record<string, unknown>) ?? {},
      createdAt: r.created_at as string | Date | null,
      updatedAt: r.updated_at as string | Date | null,
    });
    vaults.set(vault.vaultId, vault);
    return vault;
  } catch (e) {
    logger.warn('matter-vault load failed', { vaultId, error: (e as Error).message });
    return undefined;
  }
}

async function listVaultsFromDb(orgId?: string): Promise<MatterVault[]> {
  try {
    const { db } = await import('../db/index.js');
    if (!db) return [];
    const { sql } = await import('drizzle-orm');
    const result = orgId
      ? await db.execute(sql`
          SELECT vault_id, organization_id, user_id, name, matter_ref, description,
                 jurisdiction, status, default_depth, payload, created_at, updated_at
          FROM nv_schema.nv_matter_vaults
          WHERE organization_id IS NULL OR organization_id = ${orgId}
          ORDER BY updated_at DESC
          LIMIT 200
        `)
      : await db.execute(sql`
          SELECT vault_id, organization_id, user_id, name, matter_ref, description,
                 jurisdiction, status, default_depth, payload, created_at, updated_at
          FROM nv_schema.nv_matter_vaults
          ORDER BY updated_at DESC
          LIMIT 200
        `);
    const rows = (result as { rows?: Record<string, unknown>[] }).rows ?? [];
    return rows.map((r) =>
      rowToVault({
        vaultId: String(r.vault_id),
        organizationId: r.organization_id as string | null,
        userId: r.user_id as string | null,
        name: String(r.name),
        matterRef: r.matter_ref as string | null,
        description: r.description as string | null,
        jurisdiction: String(r.jurisdiction ?? 'IN'),
        status: String(r.status ?? 'draft'),
        defaultDepth: r.default_depth as string | null,
        payload: (r.payload as Record<string, unknown>) ?? {},
        createdAt: r.created_at as string | Date | null,
        updatedAt: r.updated_at as string | Date | null,
      }),
    );
  } catch {
    return [];
  }
}

function touch(v: MatterVault, patch: Partial<MatterVault>): MatterVault {
  const next: MatterVault = {
    ...v,
    ...patch,
    updatedAt: new Date().toISOString(),
  };
  vaults.set(v.vaultId, next);
  void persistVault(next);
  return next;
}

export async function listMatterVaults(orgId?: string): Promise<MatterVault[]> {
  const fromDb = await listVaultsFromDb(orgId);
  for (const v of fromDb) vaults.set(v.vaultId, v);
  const all = [...vaults.values()]
    .filter((v) => aclOk(v, orgId))
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  return all;
}

export async function getMatterVault(
  vaultId: string,
  orgId?: string,
): Promise<MatterVault | undefined> {
  let vault = vaults.get(vaultId);
  if (!vault) vault = await loadVaultFromDb(vaultId);
  if (!vault) return undefined;
  if (!aclOk(vault, orgId)) return undefined;
  return vault;
}

export async function createMatterVault(input: CreateMatterVaultInput): Promise<MatterVault> {
  const name = String(input.name ?? '').trim();
  if (name.length < 2) throw new Error('name (min 2 chars) is required');

  const vaultId = `mv_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
  const now = new Date().toISOString();
  const vault: MatterVault = {
    vaultId,
    name,
    matterRef: input.matterRef?.trim() || undefined,
    description: input.description?.trim() || undefined,
    jurisdiction: (input.jurisdiction ?? 'IN').toUpperCase(),
    orgId: input.orgId,
    userId: input.userId,
    status: 'draft',
    defaultDepth: parseIntelligenceDepth(input.defaultDepth, 'detailed'),
    documents: [],
    edjJobIds: [],
    playbookRuns: [],
    createdAt: now,
    updatedAt: now,
  };
  vaults.set(vaultId, vault);
  await persistVault(vault);
  return vault;
}

export async function uploadMatterVaultBatch(
  vaultId: string,
  items: BatchUploadItem[],
  ctx: { userId?: string; applicationId?: number; appType?: string; orgId?: string },
): Promise<MatterVault> {
  const vault = await getMatterVault(vaultId, ctx.orgId);
  if (!vault) throw new Error('Matter vault not found');
  if (!items?.length) throw new Error('At least one document is required');

  const orgId = ctx.orgId ?? vault.orgId ?? 'matter-vault';
  let current = touch(vault, { status: 'ingesting' });

  for (const item of items) {
    const docId = `doc_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
    const depth = parseIntelligenceDepth(item.depth, vault.defaultDepth);
    const doc: MatterVaultDocument = {
      docId,
      fileName: item.fileName,
      status: 'queued',
      mimeType: item.mimeType,
      depth,
      uploadedAt: new Date().toISOString(),
    };
    current.documents.push(doc);

    try {
      const buffer = Buffer.from(item.contentBase64, 'base64');
      const storageKey = `matter-vault/${vaultId}/${docId}/${item.fileName}`;
      await nyvDocumentStorage.uploadRaw(storageKey, buffer, item.mimeType ?? 'application/octet-stream');

      const edjRequest: CreateEdjRequest = {
        correlationId: docId,
        orgId: String(orgId),
        userId: ctx.userId,
        jurisdiction: vault.jurisdiction,
        documentType: 'matter_vault_document',
        platformCode: 'JRX',
        storageRef: {
          type: 'nyv_shared_key',
          storageKey,
          fileName: item.fileName,
          mimeType: item.mimeType ?? 'application/octet-stream',
          sizeBytes: buffer.length,
        },
        outputProfile: item.outputProfile ?? 'extraction',
        outputOptions: {
          enableRagIndex: true,
          enableGraphRag: false,
          depth,
        },
        delivery: { mode: 'poll', callbackMetadata: { matterVaultId: vaultId, docId } },
      };

      const created = await createEcosystemDocumentJob(edjRequest, {
        userId: ctx.userId ?? 'matter-vault',
        applicationId: ctx.applicationId,
        appType: ctx.appType,
      });
      doc.edjJobId = created.jobId;
      doc.status = 'processing';
      current.edjJobIds.push(created.jobId);
    } catch (e) {
      doc.status = 'failed';
      doc.error = (e as Error).message;
    }
  }

  const allFailed = current.documents.every((d) => d.status === 'failed');
  current = touch(current, {
    status: allFailed ? 'draft' : 'ingesting',
  });
  return current;
}

export async function runMatterVaultPlaybook(
  vaultId: string,
  input: RunPlaybookInput,
  orgId?: string,
): Promise<MatterVault> {
  const vault = await getMatterVault(vaultId, orgId);
  if (!vault) throw new Error('Matter vault not found');
  const playbookId = String(input.playbookId ?? '').trim();
  if (!playbookId) throw new Error('playbookId is required');

  const runId = `pbr_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
  const run: MatterVaultPlaybookRun = {
    runId,
    playbookId,
    status: 'queued',
    startedAt: new Date().toISOString(),
  };
  let current = touch(vault, {
    status: 'reviewing',
    playbookRuns: [...vault.playbookRuns, run],
  });

  try {
    const documentText =
      input.documentText?.trim() ||
      `Matter vault ${vault.name} (${vault.matterRef ?? vault.vaultId}) — batch review across ${current.documents.length} documents.`;

    const check = await nvContractPlaybookService.checkAgainstPlaybook({
      playbookId,
      documentText,
      tenantId: input.tenantId ?? vault.orgId ?? 'platform',
    });

    if (input.probeRag !== false) {
      const rag = await autoRagRetrieve({
        query: input.ragQuery ?? `Contract deviations for matter ${vault.name}`,
        jurisdiction: vault.jurisdiction,
        tenantId: vault.orgId,
        userId: vault.userId,
        topK: 8,
      });
      current = touch(current, {
        ragSummary: {
          chunkCount: rag.chunks?.length ?? 0,
          confidence: rag.confidence,
          layersUsed: rag.layersUsed,
          lastQuery: input.ragQuery ?? `Contract deviations for matter ${vault.name}`,
          probedAt: new Date().toISOString(),
        },
      });
    }

    run.status = 'completed';
    run.completedAt = new Date().toISOString();
    run.result = check;

    const runs = current.playbookRuns.map((r) => (r.runId === runId ? { ...run } : r));
    current = touch(current, { status: 'ready', playbookRuns: runs });
    return current;
  } catch (e) {
    run.status = 'failed';
    run.error = (e as Error).message;
    run.completedAt = new Date().toISOString();
    const runs = current.playbookRuns.map((r) => (r.runId === runId ? { ...run } : r));
    return touch(current, { playbookRuns: runs });
  }
}
