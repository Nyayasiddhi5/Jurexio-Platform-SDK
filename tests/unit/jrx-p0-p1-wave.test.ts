/**
 * P0 + P1 implementation wave (2026-08-18).
 *
 * NV-DOC-ERASURE-001        — document delete must remove the stored object
 * NV-LOCAL-SIGNED-URL-001   — local signed URLs must be servable AND verifiable
 * NV-PROMPT-CACHE-001       — cacheable system prefix on the Anthropic paths
 * NV-CASCADE-DEAD-RUNG-001  — no cascade id that cannot resolve
 * NV-LADDER-COST-EFFECTIVE-001 — value rungs above the deep tier for non-drafting
 * NV-DB-INDEX-OPTIMIZE-001  — index corrections
 * NV-DUAL-RAG-TABLE-001     — the name collision is documented, not silently merged
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  signLocalStoragePath,
  verifyLocalSignedUrlToken,
} from '../../src/services/jrx-document-storage-service.js';
import { buildBedrockRequest } from '../../src/services/intelligent-router/bedrock-request-builder.js';

const SRC = join(process.cwd(), 'src');
const read = (p: string) => readFileSync(join(SRC, p), 'utf8');

// ───────────────── NV-LOCAL-SIGNED-URL-001 ─────────────────

describe('NV-LOCAL-SIGNED-URL-001 — signed URLs are servable and verifiable', () => {
  const P = 'orgs/3/nsp/users/315/documents/doc1/file.pdf';

  it('a fresh token verifies', () => {
    const exp = Date.now() + 60_000;
    expect(verifyLocalSignedUrlToken(P, exp, signLocalStoragePath(P, exp))).toEqual({ ok: true });
  });

  it('an expired token is reported as expired, not merely invalid', () => {
    const exp = Date.now() - 1_000;
    // The route maps this to 410 so the caller re-requests rather than re-authenticating.
    expect(verifyLocalSignedUrlToken(P, exp, signLocalStoragePath(P, exp)))
      .toEqual({ ok: false, reason: 'expired' });
  });

  it('a token for a DIFFERENT path does not verify (no path substitution)', () => {
    const exp = Date.now() + 60_000;
    const other = signLocalStoragePath('orgs/3/nsp/users/999/documents/doc9/secret.pdf', exp);
    expect(verifyLocalSignedUrlToken(P, exp, other)).toEqual({ ok: false, reason: 'invalid' });
  });

  it('a token for a DIFFERENT expiry does not verify (no expiry extension)', () => {
    const exp = Date.now() + 60_000;
    const t = signLocalStoragePath(P, exp);
    expect(verifyLocalSignedUrlToken(P, exp + 60_000, t)).toEqual({ ok: false, reason: 'invalid' });
  });

  it('garbage and empty tokens are rejected without throwing', () => {
    const exp = Date.now() + 60_000;
    expect(verifyLocalSignedUrlToken(P, exp, '').ok).toBe(false);
    expect(verifyLocalSignedUrlToken(P, exp, 'deadbeef').ok).toBe(false);
    expect(verifyLocalSignedUrlToken(P, NaN, 'x').ok).toBe(false);
  });

  it('the URL now carries exp so a verifier can recompute the digest', () => {
    // The old implementation signed an expiry it never emitted — unverifiable by design.
    const svc = read('services/jrx-document-storage-service.ts');
    expect(svc).toContain('?exp=${exp}&token=${token}');
    expect(svc).toContain('timingSafeEqual');
  });

  it('a route exists for the path the adapter emits, and it is inert on S3', () => {
    const route = read('routes/jrx-storage-file-routes.ts');
    const index = read('index.ts');
    expect(index).toContain("app.use('/api/jrx/storage', nvStorageFileRouter)");
    /* Mount ORDER matters: several broad `app.use('/api/jrx', …)` routers apply
     * authenticateToken internally, and the first match swallowed the path with 401
     * before this router ran. Caught live by the acceptance probe. */
    const storageIdx = index.indexOf("app.use('/api/jrx/storage', nvStorageFileRouter)");
    const broadIdx = index.indexOf("app.use('/api/jrx', nvOpenApiRouter)");
    expect(storageIdx).toBeGreaterThan(-1);
    expect(broadIdx).toBeGreaterThan(-1);
    expect(storageIdx).toBeLessThan(broadIdx);
    expect(route).toContain("router.get('/files/*'");
    expect(route).toContain("JRX_STORAGE.backend === 's3'");
    // Traversal must be rejected by resolved-path comparison, not a regex.
    expect(route).toContain('resolveWithinRoot');
    expect(route).toContain('attachment;');
  });
});

// ───────────────── NV-DOC-ERASURE-001 ─────────────────

describe('NV-DOC-ERASURE-001 — delete removes the object, or fails loudly', () => {
  const routes = read('routes/jrx-document-orchestrator-routes.ts');

  it('calls deleteDocument() — it previously had zero callers', () => {
    expect(routes).toContain('nyvDocumentStorage.deleteDocument(');
  });

  it('reads the storage coordinates BEFORE mutating the row', () => {
    const readIdx = routes.indexOf('SELECT org_id, platform, file_name, storage_path');
    const updIdx = routes.indexOf("SET status = 'deleted'");
    expect(readIdx).toBeGreaterThan(-1);
    expect(updIdx).toBeGreaterThan(readIdx);
  });

  it('returns 500 and deletes NOTHING when the object delete fails', () => {
    // Reporting success on a failed erasure is what makes a DPDP claim false.
    const i = routes.indexOf('document_erasure_storage_failed');
    expect(i).toBeGreaterThan(-1);
    const slice = routes.slice(i, i + 700);
    expect(slice).toContain('res.status(500)');
    expect(slice).toContain('still present');
  });

  it("marks the row 'deleted', not 'failed', and clears retrievable", () => {
    expect(routes).toContain("SET status = 'deleted', retrievable = false");
    expect(routes).not.toContain("SET status = 'failed', error_message = 'Deleted by user'");
  });

  it('reports objectDeleted so a caller can audit the erasure', () => {
    expect(routes).toContain('objectDeleted');
  });
});

// ───────────────── NV-PROMPT-CACHE-001 ─────────────────

describe('NV-PROMPT-CACHE-001 — cacheable system prefix', () => {
  const longSystem = 'S'.repeat(5000);
  const shortSystem = 'too short to be worth a cache write';
  const msgs = [{ role: 'user', content: 'hello' }];

  it('marks a long system prompt as an ephemeral cache breakpoint', () => {
    const built = buildBedrockRequest('global.anthropic.claude-sonnet-5', longSystem, msgs, 1000, 0.3);
    const sys = (built.body as Record<string, unknown>).system as Array<Record<string, unknown>>;
    expect(Array.isArray(sys)).toBe(true);
    expect(sys[0].cache_control).toEqual({ type: 'ephemeral' });
    expect(sys[0].text).toBe(longSystem);
  });

  it('does NOT mark a short prompt — a cache write costs 1.25x and would never be read', () => {
    const built = buildBedrockRequest('global.anthropic.claude-sonnet-5', shortSystem, msgs, 1000, 0.3);
    expect((built.body as Record<string, unknown>).system).toBe(shortSystem);
  });

  it('never marks the user turn (it differs every request, so a write would always miss)', () => {
    const built = buildBedrockRequest('global.anthropic.claude-sonnet-5', longSystem, msgs, 1000, 0.3);
    const m = (built.body as Record<string, unknown>).messages as Array<Record<string, unknown>>;
    expect(JSON.stringify(m)).not.toContain('cache_control');
  });

  it('splits cache read/write from non-cache input for metering', () => {
    const built = buildBedrockRequest('global.anthropic.claude-sonnet-5', longSystem, msgs, 1000, 0.3);
    const parsed = built.parseResponse({
      content: [{ type: 'text', text: 'ok' }],
      usage: {
        input_tokens: 10,
        output_tokens: 5,
        cache_read_input_tokens: 900,
        cache_creation_input_tokens: 0,
      },
      stop_reason: 'end_turn',
    } as never);
    expect(parsed.tokensIn).toBe(10);
    expect(parsed.tokensCacheRead).toBe(900);
    expect(parsed.tokensOut).toBe(5);
  });

  it('is applied on the Anthropic DIRECT path too, not only Bedrock', () => {
    const orch = read('services/intelligent-router/llm-orchestrator.ts');
    expect(orch).toContain("cache_control: { type: 'ephemeral' }");
    expect(orch).toContain('cache_read_input_tokens');
  });

  it('non-Anthropic families are untouched (no cache_control leaks into Nova/OpenAI bodies)', () => {
    const nova = buildBedrockRequest('us.amazon.nova-pro-v1:0', longSystem, msgs, 1000, 0.3);
    expect(JSON.stringify(nova.body)).not.toContain('cache_control');
  });
});

// ───────────────── NV-LADDER-COST-EFFECTIVE-001 ─────────────────

describe('NV-LADDER-COST-EFFECTIVE-001 + dead rungs', () => {
  const policy = readFileSync(join(SRC, 'config/jrx-llm-routing-policy.ts'), 'utf8');
  const seqs = readFileSync(join(SRC, 'services/intelligent-router/default-sequences.ts'), 'utf8');

  it('the two dead rungs are gone from every ladder', () => {
    expect(policy).not.toContain("'anthropic/claude-sonnet-4-6'");
    expect(seqs).not.toContain("'anthropic/claude-sonnet-4-6'");
    expect(policy).not.toContain("'omniroute/auto',");
  });

  it('uses the OpenRouter Anthropic route that actually exists in the catalog', () => {
    expect(policy).toContain("'anthropic/claude-opus-4-7'");
  });

  it('value rungs sit between FAST and DEEP for non-drafting legal work', () => {
    expect(policy).toContain('JRX_LADDER_COST_FIRST');
    expect(policy).toContain('...BEDROCK_CLAUDE_FAST, ...value, ...BEDROCK_CLAUDE_DEEP');
  });

  it('drafting and litigation strategy keep Opus-first (quality trade preserved)', () => {
    expect(policy).toContain('costFirst && !deepFirst');
  });

  it('JRX_LLM_COST_PROFILE enables Nova/Haiku-first tier leads (NV-LLM-COST-PROFILE-001)', () => {
    expect(policy).toContain('isLlmCostProfileActive');
    expect(policy).toContain('apac.amazon.nova-micro-v1:0');
    expect(readFileSync(join(SRC, 'config/jrx-llm-cascade-config.ts'), 'utf8')).toContain(
      'isLlmCostProfileActive',
    );
  });

  it('the guardrail script exists and is in the aggregate chain', () => {
    const pkg = readFileSync(join(process.cwd(), 'package.json'), 'utf8');
    expect(pkg).toContain('"guardrail:cascade-ids"');
    expect(pkg).toContain('npm run guardrail:cascade-ids &&');
  });
});

// ───────────────── NV-DB-INDEX-OPTIMIZE-001 / NV-DUAL-RAG-TABLE-001 ─────────────────

describe('NV-DB-INDEX-OPTIMIZE-001 — migration safety', () => {
  const mig = readFileSync(
    join(process.cwd(), 'migrations/2026-08-18-db-index-optimize.sql'),
    'utf8',
  );

  it('every index op is CONCURRENTLY and re-appliable', () => {
    const ops = mig.split('\n').filter((l) => /^(CREATE|DROP) INDEX/i.test(l.trim()));
    expect(ops.length).toBeGreaterThan(10);
    for (const op of ops) {
      expect(op).toMatch(/CONCURRENTLY/);
      expect(op).toMatch(/IF (NOT )?EXISTS/);
    }
  });

  it('adds the missing HNSW index on the legal graph with the sibling parameters', () => {
    expect(mig).toContain('idx_nv_legal_graph_entities_embedding_hnsw');
    expect(mig).toContain('vector_cosine_ops');
    expect(mig).toContain("m = 16, ef_construction = 200");
  });

  it('does NOT drop the indexes created hours earlier (0 scans == no traffic yet)', () => {
    expect(mig).not.toMatch(/DROP INDEX.*idx_memory_value_tsv/);
    expect(mig).not.toMatch(/DROP INDEX.*idx_memory_user_evict/);
  });

  it('does NOT touch RLS — blanket-enabling it would return zero rows', () => {
    expect(mig).not.toMatch(/ENABLE ROW LEVEL SECURITY/i);
    expect(mig).not.toMatch(/CREATE POLICY/i);
  });

  it('has no BEGIN (CONCURRENTLY cannot run in a transaction)', () => {
    const executable = mig.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
    expect(executable).not.toMatch(/\bBEGIN\b/i);
  });
});

describe('NV-DUAL-RAG-TABLE-001 — the collision is documented, not silently merged', () => {
  it('records which table actually holds the data and stays schema-qualified', () => {
    const svc = read('services/jrx-orchestration-services.ts');
    expect(svc).toContain('NV-DUAL-RAG-TABLE-001');
    expect(svc).toContain('757 rows');
    expect(svc).toContain('INSERT INTO nv_schema.rag_documents');
  });
});
