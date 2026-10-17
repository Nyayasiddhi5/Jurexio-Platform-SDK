/**
 * Field-level encryption service tests — task #29 deliverable 3.
 *
 * Verifies:
 *   - encryptedExpr / decryptedExpr produce well-formed SQL fragments that
 *     reference pgp_sym_encrypt / pgp_sym_decrypt with the configured key
 *   - decryptedExpr rejects illegal column identifiers (SQL-injection guard)
 *   - in-process AES-256-GCM round-trip works for cached projections
 *   - production refuses to start without a configured key
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

async function loadFresh(envPatch: Record<string, string | undefined>) {
  vi.resetModules();
  for (const [k, v] of Object.entries(envPatch)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  return await import('../../../src/services/field-encryption-service.js');
}

describe('field-encryption-service', () => {
  const origNode = process.env.NODE_ENV;
  const origKey = process.env.NYV_FIELD_ENCRYPTION_KEY;
  const origEnc = process.env.ENCRYPTION_KEY;

  afterEach(() => {
    process.env.NODE_ENV = origNode;
    if (origKey === undefined) delete process.env.NYV_FIELD_ENCRYPTION_KEY;
    else process.env.NYV_FIELD_ENCRYPTION_KEY = origKey;
    if (origEnc === undefined) delete process.env.ENCRYPTION_KEY;
    else process.env.ENCRYPTION_KEY = origEnc;
  });

  it('encryptedExpr returns a SQL fragment that calls pgp_sym_encrypt with the key', async () => {
    const mod = await loadFresh({
      NODE_ENV: 'test',
      NYV_FIELD_ENCRYPTION_KEY: '0123456789abcdef0123456789abcdef',
    });
    const expr = mod.encryptedExpr('hello world');
    const stringified = JSON.stringify(expr);
    expect(stringified).toContain('pgp_sym_encrypt');
    expect(stringified).toContain('hello world');
    expect(stringified).toContain('0123456789abcdef0123456789abcdef');
  });

  it('encryptedExpr returns a NULL fragment for null/undefined input', async () => {
    const mod = await loadFresh({
      NODE_ENV: 'test',
      NYV_FIELD_ENCRYPTION_KEY: 'k'.repeat(32),
    });
    const expr = mod.encryptedExpr(null);
    const s = JSON.stringify(expr);
    expect(s).toContain('NULL');
    expect(s).not.toContain('pgp_sym_encrypt');
  });

  it('decryptedExpr embeds the column verbatim and references pgp_sym_decrypt', async () => {
    const mod = await loadFresh({
      NODE_ENV: 'test',
      NYV_FIELD_ENCRYPTION_KEY: 'k'.repeat(32),
    });
    const expr = mod.decryptedExpr('transcript_text_enc');
    const s = JSON.stringify(expr);
    expect(s).toContain('pgp_sym_decrypt');
    expect(s).toContain('transcript_text_enc');
  });

  it('decryptedExpr rejects illegal column identifiers (SQL-injection guard)', async () => {
    const mod = await loadFresh({
      NODE_ENV: 'test',
      NYV_FIELD_ENCRYPTION_KEY: 'k'.repeat(32),
    });
    expect(() => mod.decryptedExpr("foo; DROP TABLE x; --")).toThrow(/illegal column/);
    expect(() => mod.decryptedExpr('foo bar')).toThrow(/illegal column/);
    expect(() => mod.decryptedExpr('valid_column')).not.toThrow();
    expect(() => mod.decryptedExpr('"qualified"."col"')).not.toThrow();
  });

  it('in-process AES-256-GCM round-trip succeeds', async () => {
    const mod = await loadFresh({
      NODE_ENV: 'test',
      NYV_FIELD_ENCRYPTION_KEY: 'super-secret-test-key-not-for-prod',
    });
    const ct = mod.fieldEncryption.encryptInProcess('PAN: AAAAA1234A');
    expect(ct).toMatch(/^[0-9a-f]+:[0-9a-f]+:[0-9a-f]+$/);
    const pt = mod.fieldEncryption.decryptInProcess(ct);
    expect(pt).toBe('PAN: AAAAA1234A');
  });

  it('selfCheck reports ok when key is configured', async () => {
    const mod = await loadFresh({
      NODE_ENV: 'test',
      NYV_FIELD_ENCRYPTION_KEY: 'k'.repeat(64),
    });
    expect(mod.fieldEncryption.selfCheck().ok).toBe(true);
  });

  it('production refuses to operate without a configured key', async () => {
    const mod = await loadFresh({
      NODE_ENV: 'production',
      NYV_FIELD_ENCRYPTION_KEY: undefined,
      ENCRYPTION_KEY: undefined,
    });
    expect(() => mod.encryptedExpr('anything')).toThrow(/required in production/);
  });

  it('exposes the list of sensitive fields that must be encrypted', async () => {
    const mod = await loadFresh({
      NODE_ENV: 'test',
      NYV_FIELD_ENCRYPTION_KEY: 'k'.repeat(32),
    });
    const fields = mod.fieldEncryption.sensitiveFields();
    const names = fields.map((f) => `${f.table}.${f.column}`);
    expect(names).toEqual(
      expect.arrayContaining([
        'nv_voice_sessions.transcript_text',
        'nv_identity_extractions.extracted_fields',
        'nv_clawd_conversations.messages',
        'document_extracted_content.content',
        // Task #29 explicit scope additions:
        'nv_matter_memory.content',                // mem0 long-term memory entries
        'document_embeddings.text',                // citation / RAG full text
      ]),
    );
  });
});

// ── Field-encryption is wired into actual data paths (Task #29 deliverable #3) ─
import fs from 'node:fs';
import path from 'node:path';

describe('Field encryption is wired into actual write paths', () => {
  const root = process.cwd();

  it('identity-extraction-service writes extracted_fields_enc on insert + on review (fail-closed in transaction)', () => {
    const src = fs.readFileSync(
      path.join(root, 'src/services/identity-extraction-service.ts'),
      'utf8',
    );
    expect(src).toMatch(/from '\.\/field-encryption-service\.js'/);
    expect(src).toMatch(/encryptedExpr\(JSON\.stringify\(extractedFields\)\)/);
    expect(src).toMatch(/encryptedExpr\(JSON\.stringify\(correctedFields\)\)/);
    expect(src).toMatch(/SET extracted_fields_enc =/);
    // Fail-closed: insert + encryption mirror UPDATE must run inside a single
    // db.transaction so encryption failure rolls back the plaintext write.
    expect(src).toMatch(/db\.transaction\(async \(tx\) =>/);
    // The previous best-effort mirror (try/catch around encryptedExpr that
    // logged a warning and continued) must NOT reappear.
    expect(src).not.toMatch(/fieldEncLogger\.warn\(\s*'\[FieldEnc\] failed to mirror/);
  });

  it('document-parsing-service writes content_enc for every chunk (fail-closed in transaction)', () => {
    const src = fs.readFileSync(
      path.join(root, 'src/services/document-pipeline/document-parsing-service.ts'),
      'utf8',
    );
    expect(src).toMatch(/from '\.\.\/field-encryption-service\.js'/);
    expect(src).toMatch(/SET content_enc =\s*\$\{encryptedExpr\(rec\.text\)\}/);
    expect(src).toMatch(/db\.transaction\(async \(tx\) =>/);
    expect(src).not.toMatch(/logger\.warn\(\s*'\[FieldEnc\] failed to mirror chunk/);
  });

  it('phase4 ingestDocument writes citation full text into document_embeddings.text_enc', () => {
    const src = fs.readFileSync(
      path.join(root, 'src/services/jrx-phase4-services.ts'),
      'utf8',
    );
    expect(src).toMatch(/from '\.\/field-encryption-service\.js'/);
    expect(src).toMatch(/text_enc/);
    expect(src).toMatch(/encryptedExpr\(safeText\)/);
  });

  it('5tier memory service writes mem0 content_enc on saveMatterMemory (fail-closed in transaction)', () => {
    const src = fs.readFileSync(
      path.join(root, 'src/services/memory/jrx-5tier-memory-service.ts'),
      'utf8',
    );
    expect(src).toMatch(/from '\.\.\/field-encryption-service\.js'/);
    expect(src).toMatch(/SET content_enc =\s*\$\{encryptedExpr\(memory\.content\)\}/);
    expect(src).toMatch(/UPDATE nv_matter_memory/);
    expect(src).toMatch(/db\.transaction\(async \(tx\) =>/);
    expect(src).not.toMatch(/logger\.warn\(\s*'\[FieldEnc\] failed to mirror matter memory/);
  });

  it('5tier memory service decrypts mem0 content_enc on getMatterMemory (decrypt-on-read)', () => {
    const src = fs.readFileSync(
      path.join(root, 'src/services/memory/jrx-5tier-memory-service.ts'),
      'utf8',
    );
    // decryptedExpr is imported and used by the read path.
    expect(src).toMatch(/decryptedExpr\b/);
    // The read prefers the encrypted bytea column, falling back to plaintext
    // during the dual-write transition.
    expect(src).toMatch(/COALESCE\(\$\{decryptedExpr\('content_enc'\)\}, content\)/);
  });
});

// ── Migration runner wires field-encryption key into the DO block ────────────
describe('Migration runner sets app.field_encryption_key from env', () => {
  it('scripts/jrx-migrate.ts binds NYV_FIELD_ENCRYPTION_KEY before executing 0004', () => {
    const src = fs.readFileSync(
      path.join(process.cwd(), 'scripts/jrx-migrate.ts'),
      'utf8',
    );
    expect(src).toMatch(/applyRlsAndFieldEncryptionMigration/);
    expect(src).toMatch(/process\.env\.NYV_FIELD_ENCRYPTION_KEY/);
    expect(src).toMatch(/set_config\('app\.field_encryption_key'/);
    expect(src).toMatch(/0004_enable_rls_for_tenant_tables\.sql/);
  });
});

// ── Defensive: schema-only sensitive tables have no live plaintext writers ───
//
// `nv_voice_sessions.transcript_text` and `nv_clawd_conversations.messages`
// are listed in SENSITIVE_FIELDS and the 0004 migration adds their `*_enc`
// companion columns + backfill logic. Today, no service in src/ writes to
// those tables — but if a future writer is added it MUST use encryptedExpr
// from the field-encryption-service. This test fails loudly if any code
// path inserts into either table without going through encryption.
describe('Schema-only encryption-target tables — no plaintext writers exist', () => {
  function walk(dir: string, out: string[] = []): string[] {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full, out);
      else if (entry.isFile() && entry.name.endsWith('.ts')) out.push(full);
    }
    return out;
  }
  const root = path.join(process.cwd(), 'src');
  const tsFiles = walk(root);

  it('no INSERT INTO nv_voice_sessions exists in src/ without encryptedExpr on transcript_text', () => {
    const offenders: string[] = [];
    for (const f of tsFiles) {
      const src = fs.readFileSync(f, 'utf8');
      if (/INSERT\s+INTO\s+nv_voice_sessions\b/i.test(src)) {
        // If a writer exists, it MUST also reference encryptedExpr in the
        // same file (column list narrows to transcript_text_enc).
        if (!/encryptedExpr\s*\(/.test(src)) {
          offenders.push(path.relative(process.cwd(), f));
        }
      }
    }
    expect(offenders, `nv_voice_sessions plaintext writers: ${offenders.join(', ')}`).toEqual([]);
  });

  it('no INSERT INTO nv_clawd_conversations exists in src/ without encryptedExpr on messages', () => {
    const offenders: string[] = [];
    for (const f of tsFiles) {
      const src = fs.readFileSync(f, 'utf8');
      if (/INSERT\s+INTO\s+nv_clawd_conversations\b/i.test(src)) {
        if (!/encryptedExpr\s*\(/.test(src)) {
          offenders.push(path.relative(process.cwd(), f));
        }
      }
    }
    expect(offenders, `nv_clawd_conversations plaintext writers: ${offenders.join(', ')}`).toEqual([]);
  });

  it('SENSITIVE_FIELDS still declares both schema-only tables so 0004 keeps the *_enc columns provisioned', async () => {
    const mod = await loadFresh({
      NODE_ENV: 'test',
      NYV_FIELD_ENCRYPTION_KEY: 'k'.repeat(32),
    });
    const tables = mod.SENSITIVE_FIELDS.map((f: { table: string; column: string }) => `${f.table}.${f.column}`);
    expect(tables).toContain('nv_voice_sessions.transcript_text');
    expect(tables).toContain('nv_clawd_conversations.messages');
  });
});
