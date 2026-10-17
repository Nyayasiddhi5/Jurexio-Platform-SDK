/**
 * NV-MULTITENANT-STORAGE-001 — Logical tenant paths on shared EC2/S3.
 * Physical bucket may be shared until production isolation; keys always
 * include platform + org (+ user/doc) so RLS/app filters stay correct.
 */

import { StoragePathBuilder } from '../services/jrx-document-storage-service.js';

export interface TenantStorageIdentity {
  orgId: string | number;
  platform: string;
  userId?: string | number;
}

export function normalizePlatformCode(platform: string | undefined | null): string {
  const p = String(platform || 'nyv').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '');
  return p || 'nyv';
}

export function normalizeOrgId(orgId: string | number | undefined | null): string {
  const o = String(orgId ?? '').trim();
  if (!o || o === 'undefined' || o === 'null') {
    throw new Error('[JRX-MT-001] orgId is required for tenant storage paths');
  }
  return o.replace(/[^a-zA-Z0-9_-]/g, '_');
}

function sanitizeFileName(fileName: string): string {
  return String(fileName || 'file')
    .replace(/[/\\?%*:|"<>]/g, '_')
    .replace(/\s+/g, '_')
    .slice(0, 200) || 'file';
}

export function tenantDocumentKey(
  identity: TenantStorageIdentity,
  docId: string,
  fileName: string,
): string {
  const orgId = normalizeOrgId(identity.orgId);
  const platform = normalizePlatformCode(identity.platform);
  const userId = String(identity.userId ?? 'system');
  return StoragePathBuilder.userDocument(orgId, platform, userId, docId, sanitizeFileName(fileName));
}

export function tenantEdjKey(
  identity: TenantStorageIdentity,
  docId: string,
  fileName: string,
): string {
  const orgId = normalizeOrgId(identity.orgId);
  const platform = normalizePlatformCode(identity.platform);
  return `ecosystem-edj/${platform}/${orgId}/${docId}/${sanitizeFileName(fileName)}`;
}

/** Reject keys that escape tenant prefix (path traversal / cross-tenant). */
export function assertKeyWithinTenant(
  key: string,
  identity: TenantStorageIdentity,
): void {
  const orgId = normalizeOrgId(identity.orgId);
  const platform = normalizePlatformCode(identity.platform);
  const allowed = [
    `orgs/${orgId}/${platform}/`,
    `ecosystem-edj/${platform}/${orgId}/`,
  ];
  const normalized = key.replace(/^\/+/, '');
  if (!allowed.some((p) => normalized.startsWith(p))) {
    throw new Error(`[JRX-MT-002] storage key escapes tenant scope (platform=${platform}, org=${orgId})`);
  }
  if (normalized.includes('..')) {
    throw new Error('[JRX-MT-003] storage key must not contain path traversal');
  }
}
