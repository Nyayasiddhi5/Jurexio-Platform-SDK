/**
 * NV-AUDIT-HASH-SSoT — canonical audit log hash chain primitives.
 *
 * Writer (appendAuditRecord) and all verifiers MUST use these helpers so
 * record_hash recomputation is byte-identical across processes.
 *
 * Formula: SHA-256(id || NUL || previous_hash || NUL || event_type || NUL ||
 *          canonical_payload || NUL || created_at_iso)
 */
import { createHash } from 'crypto';

/** Genesis previous_hash for the first row in a chain. */
export const AUDIT_GENESIS_HASH =
  '0000000000000000000000000000000000000000000000000000000000000000';

/**
 * NYV-AUDIT-HASH-002 — deep stable JSON so pg jsonb round-trips match.
 */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(stableStringify).join(',') + ']';
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return '{' + keys.map(k => JSON.stringify(k) + ':' + stableStringify(obj[k])).join(',') + '}';
}

export function canonicalizePayload(payload: string | object): string {
  try {
    const parsed = typeof payload === 'string' ? JSON.parse(payload) : payload;
    return stableStringify(parsed);
  } catch {
    return typeof payload === 'string' ? payload : JSON.stringify(payload);
  }
}

/** NYV-AUDIT-HASH-003 — pg timestamptz strings → ISO UTC for hashing. */
export function normalizeAuditCreatedAt(createdAt: string | Date): string {
  return createdAt instanceof Date
    ? createdAt.toISOString()
    : new Date(String(createdAt)).toISOString();
}

export function computeAuditHash(
  id: string,
  previousHash: string,
  eventType: string,
  payload: string | object,
  createdAt: string | Date,
): string {
  const canonicalPayload = canonicalizePayload(payload);
  const createdAtIso = normalizeAuditCreatedAt(createdAt);
  return createHash('sha256')
    .update(`${id}\x00${previousHash}\x00${eventType}\x00${canonicalPayload}\x00${createdAtIso}`)
    .digest('hex');
}

export interface AuditHashRow {
  id: string;
  event_type: string;
  payload: string | object;
  previous_hash: string;
  record_hash: string;
  created_at: string | Date;
}

export function verifyAuditRecordHash(record: AuditHashRow): boolean {
  if (!record.record_hash) return true; // legacy rows without stored hash
  const expected = computeAuditHash(
    String(record.id),
    record.previous_hash,
    record.event_type,
    record.payload,
    record.created_at,
  );
  return expected === record.record_hash;
}
