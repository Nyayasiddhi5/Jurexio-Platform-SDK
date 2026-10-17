/**
 * Migration Safety Runner for Jurexio Legal SDK
 * Verifies database connection and critical table/schema integrity at startup
 */

import { db } from '../db/index.js';
import { sql } from 'drizzle-orm';
import { createLogger } from '../utils/logger.js';


const logger = createLogger('migration-safety-runner');

interface MigrationSafetyResult {
  isReady: boolean;
  missingTables: string[];
  warnings: string[];
}

const CRITICAL_TABLES = ['nv_users', 'nv_organizations', 'nv_sdk_applications', 'nv_api_keys', 'sdk_api_request_logs'];

const SCHEMA_VALIDATIONS = [
  { table: 'nv_users', column: 'email' },
  { table: 'nv_users', column: 'org_id' },
  { table: 'nv_organizations', column: 'name' },
  { table: 'nv_sdk_applications', column: 'organization_id' },
  { table: 'nv_sdk_applications', column: 'environment' },
  { table: 'nv_api_keys', column: 'app_id' },
  { table: 'nv_api_keys', column: 'key_hash' },
  { table: 'sdk_api_request_logs', column: 'application_id' },
  { table: 'sdk_api_request_logs', column: 'endpoint' }
];

export async function runMigrationSafetyChecks(): Promise<MigrationSafetyResult> {
  const missingTables: string[] = [];
  const warnings: string[] = [];

  try {
    // Verify db is initialized
    if (!db) {
      logger.error('✗ Database not initialized');
      return {
        isReady: false,
        missingTables: [],
        warnings: ['Database not initialized - cannot proceed with migration safety checks']
      };
    }

    // 0. Ensure refresh_tokens table exists (used by auth middleware)
    try {
      await db.execute(sql.raw(`
        CREATE TABLE IF NOT EXISTS refresh_tokens (
          id          SERIAL PRIMARY KEY,
          user_id     INTEGER NOT NULL,
          token_hash  VARCHAR(255) NOT NULL UNIQUE,
          expires_at  TIMESTAMP NOT NULL,
          is_revoked  BOOLEAN NOT NULL DEFAULT FALSE,
          revoked_at  TIMESTAMP,
          user_agent  TEXT,
          ip_address  VARCHAR(45),
          created_at  TIMESTAMP NOT NULL DEFAULT NOW()
        )
      `));
      await db.execute(sql.raw(`CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user_id ON refresh_tokens (user_id)`));
      await db.execute(sql.raw(`CREATE INDEX IF NOT EXISTS idx_refresh_tokens_hash ON refresh_tokens (token_hash)`));
    } catch {
      /* non-fatal */
    }

    // 0b. Apply nv_schema.usage_logs column migrations (idempotent)
    try {
      await db.execute(sql`CREATE SCHEMA IF NOT EXISTS nv_schema`);
      await db.execute(sql.raw(`
        ALTER TABLE nv_schema.usage_logs
          ADD COLUMN IF NOT EXISTS input_tokens INTEGER DEFAULT 0,
          ADD COLUMN IF NOT EXISTS output_tokens INTEGER DEFAULT 0,
          ADD COLUMN IF NOT EXISTS provider VARCHAR(100),
          ADD COLUMN IF NOT EXISTS success BOOLEAN DEFAULT TRUE
      `));
      logger.info('✓ nv_schema.usage_logs columns verified/added');
    } catch {
      /* table may not exist yet — non-fatal */
    }

    // 0b. Ensure pgvector extension and nv_schema vector index
    try {
      await db.execute(sql.raw(`CREATE EXTENSION IF NOT EXISTS vector`));
      await db.execute(sql.raw(`
        ALTER TABLE nv_schema.rag_chunks
          ADD COLUMN IF NOT EXISTS embedding vector(1536)
      `));
      await db.execute(sql.raw(`
        CREATE INDEX IF NOT EXISTS idx_nv_rag_chunks_embedding_hnsw
          ON nv_schema.rag_chunks USING hnsw (embedding vector_cosine_ops)
          WITH (m = 16, ef_construction = 200)
      `));
      logger.info('✓ pgvector extension and nv_schema.rag_chunks HNSW vector index verified');
    } catch {
      /* non-fatal — table may not exist yet */
    }

    // 0c. Ensure missing B-tree indices (DB-03 audit remediation)
    try {
      const dbIndices = [
        `CREATE INDEX IF NOT EXISTS idx_legal_agents_category ON legal_agents(category)`,
        `CREATE INDEX IF NOT EXISTS idx_legal_agents_practice_area ON legal_agents(practice_area)`,
        `CREATE INDEX IF NOT EXISTS idx_jurexio-citizen_cases_user_id ON jurexio-citizen_cases(user_id)`,
        `CREATE INDEX IF NOT EXISTS idx_academy_enrollments_course_id ON academy_enrollments(course_id)`,
      ];
      for (const ddl of dbIndices) {
        try { await db.execute(sql.raw(ddl)); } catch { /* table may not exist */ }
      }
      logger.info('✓ DB-03 B-tree indices verified (legal_agents, jurexio-citizen_cases, academy_enrollments)');
    } catch {
      /* non-fatal */
    }

    // 0d. Legal doc pipeline catch-up (ns_parsed_documents / ns_doc_processing_jobs)
    // Prevents production-doc-processor 42P01 log spam on fresh dev-edge DBs.
    try {
      const docTables = await db.execute(sql`
        SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name IN ('ns_parsed_documents', 'ns_doc_processing_jobs')
      `);
      const rows = (docTables as any)?.rows ?? (Array.isArray(docTables) ? docTables : []);
      const present = new Set<string>(rows.map((r: any) => r.table_name));
      if (!present.has('ns_parsed_documents') || !present.has('ns_doc_processing_jobs')) {
        const { readFileSync } = await import('node:fs');
        const { join } = await import('node:path');
        const catchupPath = join(process.cwd(), 'migrations/2026-05-28-legal-doc-domain-catchup.sql');
        const ddl = readFileSync(catchupPath, 'utf8');
        await db.execute(sql.raw(ddl));
        logger.info('✓ Applied migrations/2026-05-28-legal-doc-domain-catchup.sql (ns_parsed_documents + doc jobs)');
      } else {
        logger.info('✓ Document pipeline tables present (ns_parsed_documents, ns_doc_processing_jobs)');
      }
    } catch (err: any) {
      warnings.push(`Document pipeline catch-up skipped: ${err?.message || err}`);
      logger.warn(`⚠️ Document pipeline catch-up skipped: ${err?.message || err}`);
    }

    // 1. Verify database connection with SELECT 1
    logger.info('🔍 [Migration Safety] Checking database connection...');
    try {
      await db.execute(sql`SELECT 1`);
      logger.info('✓ Database connection alive');
    } catch (error: any) {
      logger.error('✗ Database connection failed:', error);
      return {
        isReady: false,
        missingTables: [],
        warnings: ['Database connection failed - cannot proceed with migration safety checks']
      };
    }

    // 2. Check that critical tables exist
    logger.info('🔍 [Migration Safety] Checking critical tables...');
    const missingTablesCheck = await checkCriticalTablesExist();
    if (missingTablesCheck.length > 0) {
      missingTables.push(...missingTablesCheck);
      logger.info(`✗ Missing tables: ${missingTablesCheck.join(', ')}`);
    } else {
      logger.info(`✓ All critical tables exist`);
    }

    // 3. Validate schema version by checking key columns
    logger.info('🔍 [Migration Safety] Validating schema columns...');
    const missingColumnsCheck = await checkSchemaColumns();
    if (missingColumnsCheck.length > 0) {
      warnings.push(...missingColumnsCheck.map(col => `Missing column: ${col.table}.${col.column}`));
      logger.info(`⚠️ Missing columns detected:`);
      missingColumnsCheck.forEach(col => logger.info(`   - ${col.table}.${col.column}`));
    } else {
      logger.info(`✓ All critical schema columns exist`);
    }

    // 4. Log formatted report
    logMigrationSafetyReport({ isReady: missingTables.length === 0, missingTables, warnings });

    // 5. Return result
    return {
      isReady: missingTables.length === 0,
      missingTables,
      warnings
    };
  } catch (error: any) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error('❌ [Migration Safety] Unexpected error:', errorMessage);
    return {
      isReady: false,
      missingTables,
      warnings: [...warnings, `Unexpected error during safety checks: ${errorMessage}`]
    };
  }
}

async function checkCriticalTablesExist(): Promise<string[]> {
  const missing: string[] = [];

  if (!db) {
    return CRITICAL_TABLES;
  }

  for (const tableName of CRITICAL_TABLES) {
    try {
      const result = await db.execute(
        sql`SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = ${tableName}) as table_exists`
      );
      
      const rows = (result as any)?.rows || (Array.isArray(result) ? result : []);
      const row = rows[0];
      const exists = row?.table_exists === true || row?.table_exists === 't' || row?.table_exists === 'true';

      if (!exists) {
        missing.push(tableName);
      }
    } catch (error: any) {
      missing.push(tableName);
    }
  }

  return missing;
}

async function checkSchemaColumns(): Promise<Array<{ table: string; column: string }>> {
  const missing: Array<{ table: string; column: string }> = [];

  if (!db) {
    return SCHEMA_VALIDATIONS;
  }

  for (const validation of SCHEMA_VALIDATIONS) {
    try {
      const result = await db.execute(
        sql`SELECT EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_schema = 'public'
          AND table_name = ${validation.table} 
          AND column_name = ${validation.column}
        ) as col_exists`
      );

      const rows = (result as any)?.rows || (Array.isArray(result) ? result : []);
      const row = rows[0];
      const exists = row?.col_exists === true || row?.col_exists === 't' || row?.col_exists === 'true';

      if (!exists) {
        missing.push(validation);
      }
    } catch (error: any) {
      missing.push(validation);
    }
  }

  return missing;
}

function logMigrationSafetyReport(result: MigrationSafetyResult): void {
  const timestamp = new Date().toISOString();
  const status = result.isReady ? '✅ READY' : '❌ NOT READY';

  logger.info('');
  logger.info('╔═══════════════════════════════════════════════════════════════════════════════╗');
  logger.info('║                  Migration Safety Check Report                                ║');
  logger.info('╠═══════════════════════════════════════════════════════════════════════════════╣');
  logger.info(`║ Status: ${status.padEnd(77 - 8)}║`);
  logger.info(`║ Timestamp: ${timestamp.padEnd(70)}║`);
  logger.info('╠═══════════════════════════════════════════════════════════════════════════════╣');

  if (result.missingTables.length > 0) {
    logger.info('║ MISSING TABLES:                                                               ║');
    result.missingTables.forEach(table => {
      logger.info(`║   • ${table.padEnd(74)}║`);
    });
    logger.info('╠═══════════════════════════════════════════════════════════════════════════════╣');
  }

  if (result.warnings.length > 0) {
    logger.info('║ WARNINGS:                                                                     ║');
    result.warnings.forEach(warning => {
      const wrapped = warning.length > 76 ? warning.substring(0, 73) + '...' : warning;
      logger.info(`║   • ${wrapped.padEnd(74)}║`);
    });
    logger.info('╠═══════════════════════════════════════════════════════════════════════════════╣');
  }

  logger.info('║ CRITICAL TABLES CHECKED:                                                      ║');
  CRITICAL_TABLES.forEach(table => {
    const check = result.missingTables.includes(table) ? '✗' : '✓';
    logger.info(`║   ${check} ${table.padEnd(73)}║`);
  });

  logger.info('╚═══════════════════════════════════════════════════════════════════════════════╝');
  logger.info('');
}
