/**
 * Nyayavigya Platform 3.1.2 — RAG namespaces + Document/Chunk + Audit seed
 * NYV-SCRIPT-SEED-RAG-AUDIT-001  ·  NYV-NS-004  ·  2026-05-01
 *
 * Idempotent demo-data seed for the four tables that block fresh-environment
 * smoke tests:
 *   1. rag_namespaces       — needed by RAG retrieval routes
 *   2. nv_rag_documents     — sample legal docs (statutes, case briefs)
 *   3. nv_rag_chunks        — chunked text for embedding tests
 *   4. nv_audit_logs        — bootstraps the hash-chain so the boot-time
 *                             self-test (NYV-NS-010 / phase C4) has a head.
 *
 * Run:  npx tsx scripts/jrx-seed-rag-and-audit.ts
 *
 * SAFETY:
 *   - Re-runnable: every INSERT uses ON CONFLICT DO NOTHING / NOT EXISTS.
 *   - No secrets in code: any sensitive payload is read from env vars and
 *     throws if missing (per NYV-SECURITY-DOC-CREDS-001).
 *   - Never touches production tables outside its scope.
 */

import { makePgSql } from './_pg-pool.js';
import { assertColumns } from './_assert-columns.js';
import * as crypto from 'crypto';
import * as dotenv from 'dotenv';

dotenv.config();
const sql = makePgSql();

// task #347: schema-drift guard — fail loud before any INSERT.
// rag_documents/rag_chunks are checked separately because the seeder
// short-circuits when the tables aren't present.
const REQUIRED_COLUMNS_BASE = {
  'public.rag_namespaces': [
    'id', 'org_id', 'name', 'description', 'embedding_model', 'dimensions',
    'is_default', 'is_active', 'metadata', 'created_at', 'updated_at',
  ],
  'public.nv_audit_logs': [
    'id', 'trace_id', 'app_id', 'org_id', 'user_id', 'route', 'method',
    'status_code', 'latency_ms', 'tokens_used', 'error_message', 'event_type',
    'record_hash', 'previous_hash', 'metadata', 'created_at',
  ],
} as const;
const REQUIRED_COLUMNS_RAG_DOCS = {
  'public.nv_rag_documents': [
    'id', 'title', 'content', 'doc_type', 'jurisdiction', 'statute',
    'indexed_at', 'is_active',
  ],
  'public.nv_rag_chunks': [
    'doc_id', 'chunk_text', 'chunk_index', 'embedding_model', 'created_at',
  ],
} as const;

// ── Demo organisation lookup (created by nv-seed-organizations.ts) ─────────
// 2026-05-01: real RDS dev showed neither canonical slug present — only
// `demo-tenant`. Added that as a third fallback so this seed is idempotent
// against the actual provisioned environment without needing an extra
// rename migration. Order is preference: canonical names win when present.
async function findDemoOrgId(): Promise<string | null> {
  const rows = await sql`
    SELECT id::text AS id FROM nv_organizations
     WHERE slug IN ('nyayavigya-tech', 'demo-law-firm-pro', 'demo-tenant')
     ORDER BY (slug = 'nyayavigya-tech') DESC,
              (slug = 'demo-law-firm-pro') DESC,
              created_at ASC
     LIMIT 1
  `;
  return (rows[0] as { id: string } | undefined)?.id ?? null;
}

// ── Optional table check: nv_rag_documents / nv_rag_chunks ─────────────────
// 2026-05-01: these two tables are referenced by the seed but are NOT created
// by any current drizzle migration (verified against live RDS dev). Until a
// migration adds them, seedDocumentsAndChunks() short-circuits with a clear
// notice instead of crashing. Tracked under NYV-NS-004-FOLLOWUP.
async function tablesExist(...names: string[]): Promise<boolean> {
  const rows = await sql`
    SELECT count(*)::int AS c FROM information_schema.tables
     WHERE table_name = ANY(${names as any})
  `;
  return (rows[0] as { c: number }).c === names.length;
}

// ── 1. rag_namespaces ──────────────────────────────────────────────────────
async function seedNamespaces(orgId: string) {
  const NAMESPACES = [
    { name: 'in-bare-acts',     description: 'Indian bare acts (BNS, BSA, BNSS, IT Act)', is_default: true },
    { name: 'in-case-law',      description: 'Indian Supreme Court + High Court rulings', is_default: false },
    { name: 'uk-statutes',      description: 'UK Public General Acts (post-2000)',         is_default: false },
    { name: 'us-federal',       description: 'US federal statutes (USC, CFR)',             is_default: false },
    { name: 'eu-regulations',   description: 'EU regulations + directives (GDPR, AI Act)', is_default: false },
    { name: 'gc-legislation',   description: 'GCC commercial law (UAE, KSA)',              is_default: false },
    { name: 'sg-statutes',      description: 'Singapore statutes',                          is_default: false },
  ];

  let inserted = 0;
  for (const ns of NAMESPACES) {
    const id = crypto.randomUUID();
    const result = await sql`
      INSERT INTO rag_namespaces (
        id, org_id, name, description, embedding_model, dimensions,
        is_default, is_active, metadata, created_at, updated_at
      ) VALUES (
        ${id}, ${orgId}, ${ns.name}, ${ns.description},
        'text-embedding-3-small', 1536,
        ${ns.is_default}, true, ${'{}'}::jsonb, NOW(), NOW()
      )
      ON CONFLICT DO NOTHING
      RETURNING id
    `;
    if (result.length > 0) inserted++;
  }
  console.log(`[rag_namespaces] inserted ${inserted}/${NAMESPACES.length} (rest already present)`);
}

// ── 2. nv_rag_documents + 3. nv_rag_chunks ─────────────────────────────────
async function seedDocumentsAndChunks() {
  if (!(await tablesExist('nv_rag_documents', 'nv_rag_chunks'))) {
    console.warn(
      '[nv_rag_documents/nv_rag_chunks] SKIPPED — tables not present. ' +
      'Add a drizzle migration that creates them, then re-run this seed. ' +
      'See NYV-NS-004-FOLLOWUP in PROJECT-TRACKER.md.',
    );
    return;
  }
  const DOCS = [
    {
      title: 'Bharatiya Nyaya Sanhita, 2023 — Section 103 (Murder)',
      doc_type: 'statute',
      jurisdiction: 'IN',
      statute: 'BNS',
      content: 'Whoever commits murder shall be punished with death or imprisonment for life, and shall also be liable to fine. (Replaces IPC s.302 effective 2024-07-01.)',
    },
    {
      title: 'Bharatiya Sakshya Adhiniyam, 2023 — Section 63 (Electronic records)',
      doc_type: 'statute',
      jurisdiction: 'IN',
      statute: 'BSA',
      content: 'Electronic records are admissible as evidence subject to a Section 63 certificate signed by a person occupying a responsible official position in relation to the operation of the relevant device.',
    },
    {
      title: 'Information Technology Act, 2000 — Section 66A status',
      doc_type: 'case-brief',
      jurisdiction: 'IN',
      statute: 'IT-Act',
      content: 'Section 66A was struck down as unconstitutional in Shreya Singhal v. Union of India (2015). Any FIR currently invoking 66A must be quashed; investigators must instead consider Sections 67/67A or BNS provisions.',
    },
  ];

  let docCount = 0;
  let chunkCount = 0;
  for (const doc of DOCS) {
    const docId = crypto.randomUUID();
    const inserted = await sql`
      INSERT INTO nv_rag_documents (
        id, title, content, doc_type, jurisdiction, statute, indexed_at, is_active
      ) VALUES (
        ${docId}, ${doc.title}, ${doc.content}, ${doc.doc_type},
        ${doc.jurisdiction}, ${doc.statute}, NOW(), true
      )
      ON CONFLICT DO NOTHING
      RETURNING id
    `;
    if (inserted.length === 0) continue;
    docCount++;

    // Chunk the content into ~400-char windows for embedding tests.
    const chunkSize = 400;
    let idx = 0;
    for (let offset = 0; offset < doc.content.length; offset += chunkSize) {
      const chunk = doc.content.slice(offset, offset + chunkSize);
      await sql`
        INSERT INTO nv_rag_chunks (
          doc_id, chunk_text, chunk_index, embedding_model, created_at
        ) VALUES (
          ${docId}, ${chunk}, ${idx}, 'text-embedding-3-small', NOW()
        )
        ON CONFLICT DO NOTHING
      `;
      idx++;
      chunkCount++;
    }
  }
  console.log(`[nv_rag_documents] inserted ${docCount}/${DOCS.length}`);
  console.log(`[nv_rag_chunks]    inserted ${chunkCount}`);
}

// ── 4. nv_audit_logs hash-chain head ───────────────────────────────────────
async function seedAuditChainHead(orgId: string) {
  const existing = await sql`SELECT count(*)::int AS c FROM nv_audit_logs`;
  const count = (existing[0] as { c: number }).c;
  if (count > 0) {
    console.log(`[nv_audit_logs] chain already has ${count} entries — skipping head insert`);
    return;
  }

  const id = crypto.randomUUID();
  const traceId = crypto.randomUUID();
  const route = '/__nyv/seed/genesis';
  const method = 'INTERNAL';
  const eventType = 'system.bootstrap';
  const previousHash = '0'.repeat(64);
  const payload = `${id}|${traceId}|${route}|${method}|${eventType}|${previousHash}`;
  const recordHash = crypto.createHash('sha256').update(payload).digest('hex');

  await sql`
    INSERT INTO nv_audit_logs (
      id, trace_id, app_id, org_id, user_id, route, method,
      status_code, latency_ms, tokens_used, error_message, event_type,
      record_hash, previous_hash, metadata, created_at
    ) VALUES (
      ${id}, ${traceId}, NULL, ${orgId}, NULL, ${route}, ${method},
      200, 0, 0, NULL, ${eventType},
      ${recordHash}, ${previousHash},
      ${'{"seed":"NYV-NS-004","note":"genesis block for hash-chain self-test"}'}::jsonb,
      NOW()
    )
  `;
  console.log(`[nv_audit_logs] inserted genesis block ${id} (record_hash=${recordHash.slice(0, 12)}…)`);
}

async function main() {
  console.log('NYV-NS-004 RAG + Audit seed starting…');

  const orgId = await findDemoOrgId();
  if (!orgId) {
    console.error('No demo organization found. Run: npx tsx scripts/jrx-seed-organizations.ts first.');
    process.exit(1);
  }
  console.log(`Using demo org_id=${orgId}`);

  await assertColumns(sql, './jrx-seed-rag-and-audit', REQUIRED_COLUMNS_BASE);
  if (await tablesExist('nv_rag_documents', 'nv_rag_chunks')) {
    await assertColumns(sql, './jrx-seed-rag-and-audit', REQUIRED_COLUMNS_RAG_DOCS);
  }

  await seedNamespaces(orgId);
  await seedDocumentsAndChunks();
  await seedAuditChainHead(orgId);

  console.log('NYV-NS-004 seed complete.');
  await sql.end?.();
}

main().catch((err) => {
  console.error('NYV-NS-004 seed failed:', err);
  process.exit(1);
});
