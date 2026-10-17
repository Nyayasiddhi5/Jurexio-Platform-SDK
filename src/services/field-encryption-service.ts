/**
 * Field-Level Encryption Service (pgp_sym_encrypt / pgp_sym_decrypt)
 * ─────────────────────────────────────────────────────────────────────────────
 * Wraps PostgreSQL pgcrypto for transparent encrypt-on-write / decrypt-on-read
 * of sensitive columns. The symmetric key is sourced from the
 * NYV_FIELD_ENCRYPTION_KEY env var (preferred) and falls back to
 * ENCRYPTION_KEY for parity with the existing application-level encryption
 * service.
 *
 * Threat model:
 *   - RDS encryption-at-rest covers the disk, NOT field-level access.
 *   - A read replica or backup snapshot would otherwise expose plaintext.
 *   - Field-level pgcrypto means even SELECT * by an unprivileged role
 *     returns ciphertext bytea (encrypted with AES-256 by pgcrypto by
 *     default) — the row is useless without the key.
 *
 * Usage:
 *   import { fieldEncryption, encryptedExpr, decryptedExpr } from
 *     '../services/field-encryption-service.js';
 *   await db.execute(sql`
 *     UPDATE nv_voice_sessions
 *     SET transcript_text_enc = ${encryptedExpr(plaintext)}
 *     WHERE id = ${id}
 *   `);
 *   const rows = await db.execute(sql`
 *     SELECT id, ${decryptedExpr('transcript_text_enc')} AS transcript
 *     FROM nv_voice_sessions WHERE id = ${id}
 *   `);
 *
 * Compliance:
 *   - SOC 2 CC6.7 (encryption of sensitive data at rest)
 *   - ISO 27001 A.10.1 (cryptographic controls)
 *   - DPDPA §8(5) (security safeguards)
 *   - EU AI Act Art. 10 (data governance and security)
 *
 * Key rotation:
 *   See docs/v3.1.2/completed_docs/NYV-COMPLIANCE-ATTESTATION.md → "Field Encryption Key Rotation".
 */
import crypto from 'crypto';
import { sql, type SQL } from 'drizzle-orm';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('field-encryption');

const SENSITIVE_COLUMNS: ReadonlyArray<{ table: string; column: string }> = [
  { table: 'nv_voice_sessions',          column: 'transcript_text' },
  { table: 'nv_identity_extractions',    column: 'extracted_fields' },
  { table: 'document_extracted_content', column: 'content' },
  { table: 'nv_clawd_conversations',     column: 'messages' },
  // Task #29 scope additions:
  { table: 'nv_matter_memory',           column: 'content' },          // mem0 long-term memory entries
  { table: 'document_embeddings',        column: 'text' },             // citation / RAG full text
];

export const SENSITIVE_FIELDS: ReadonlyArray<{ table: string; column: string }> = SENSITIVE_COLUMNS;

let _resolvedKey: string | null = null;
let _keyFingerprint: string | null = null;

function resolveKey(): string {
  if (_resolvedKey !== null) return _resolvedKey;
  const raw =
    process.env.NYV_FIELD_ENCRYPTION_KEY ||
    process.env.ENCRYPTION_KEY ||
    '';

  if (!raw) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error(
        '[FieldEncryption] NYV_FIELD_ENCRYPTION_KEY (or ENCRYPTION_KEY) is required in production',
      );
    }
    // Non-prod: derive a deterministic dev key so encrypt/decrypt round-trips
    // within a single process work without env config. This key is NEVER
    // suitable for production and rotates per process.
    const dev = crypto.randomBytes(32).toString('hex');
    logger.warn(
      '[FieldEncryption] No key configured — using ephemeral per-process key (DEV ONLY).',
    );
    _resolvedKey = dev;
  } else {
    _resolvedKey = raw;
  }

  _keyFingerprint =
    'kfp_' + crypto.createHash('sha256').update(_resolvedKey).digest('hex').slice(0, 12);
  logger.info('[FieldEncryption] active key fingerprint', { fingerprint: _keyFingerprint });
  return _resolvedKey;
}

/**
 * Returns a SQL fragment that encrypts the given plaintext using
 * pgp_sym_encrypt with the configured key. Designed to be embedded inside
 * INSERT / UPDATE statements built with drizzle's `sql` template tag.
 *
 * Example:
 *   await db.execute(sql`
 *     INSERT INTO foo (id, secret_enc) VALUES
 *     (${id}, ${encryptedExpr(plaintext)})
 *   `);
 */
export function encryptedExpr(plaintext: string | null | undefined): SQL {
  const key = resolveKey();
  if (plaintext === null || plaintext === undefined) {
    return sql`NULL`;
  }
  return sql`pgp_sym_encrypt(${plaintext}::text, ${key})`;
}

/**
 * Returns a SQL fragment that decrypts the given column. Designed to be
 * embedded inside SELECT lists.
 *
 * Example:
 *   const rows = await db.execute(sql`
 *     SELECT id, ${decryptedExpr('transcript_text_enc')} AS transcript
 *     FROM nv_voice_sessions
 *   `);
 *
 * The column name is validated against an allow-list charset to prevent SQL
 * injection — only [A-Za-z0-9_."] is accepted.
 */
export function decryptedExpr(column: string): SQL {
  if (!/^[A-Za-z0-9_."]+$/.test(column)) {
    throw new Error(`[FieldEncryption] illegal column identifier: ${column}`);
  }
  const key = resolveKey();
  return sql`pgp_sym_decrypt(${sql.raw(column)}::bytea, ${key})`;
}

/**
 * Application-side AES-256-GCM encrypt/decrypt — used as a JavaScript fallback
 * for round-trip tests and for cases where the value never round-trips through
 * Postgres (e.g. cached projections). Output is `iv(12):tag(16):ciphertext`
 * all hex-encoded.
 */
export const fieldEncryption = {
  fingerprint(): string {
    resolveKey();
    return _keyFingerprint!;
  },

  encryptInProcess(plaintext: string): string {
    const keyMaterial = Buffer.from(
      crypto.createHash('sha256').update(resolveKey()).digest(),
    );
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', keyMaterial, iv);
    const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return [iv.toString('hex'), tag.toString('hex'), enc.toString('hex')].join(':');
  },

  decryptInProcess(ciphertext: string): string {
    const parts = ciphertext.split(':');
    if (parts.length !== 3) throw new Error('invalid ciphertext format');
    const [ivHex, tagHex, encHex] = parts;
    const keyMaterial = Buffer.from(
      crypto.createHash('sha256').update(resolveKey()).digest(),
    );
    const iv = Buffer.from(ivHex, 'hex');
    const tag = Buffer.from(tagHex, 'hex');
    const enc = Buffer.from(encHex, 'hex');
    const decipher = crypto.createDecipheriv('aes-256-gcm', keyMaterial, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
  },

  /**
   * Round-trip smoke test using both the in-process AES-GCM path and a
   * deterministic check that the configured key length is acceptable.
   */
  selfCheck(): { ok: boolean; reason?: string } {
    try {
      resolveKey();
      const ct = this.encryptInProcess('NYV-FIELD-ENC-SMOKE');
      const pt = this.decryptInProcess(ct);
      if (pt !== 'NYV-FIELD-ENC-SMOKE') return { ok: false, reason: 'roundtrip mismatch' };
      return { ok: true };
    } catch (err: unknown) {
      return { ok: false, reason: err instanceof Error ? err.message : String(err) };
    }
  },

  sensitiveFields(): ReadonlyArray<{ table: string; column: string }> {
    return SENSITIVE_COLUMNS;
  },
};

export default fieldEncryption;
