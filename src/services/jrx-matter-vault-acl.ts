/**
 * Matter-vault tenant check.
 *
 * Login and SDK auth put organizationId on the caller as a number
 * (nv_users.org_id is an integer). nv_schema.nv_matter_vaults.organization_id
 * is varchar, so Postgres returns it as a string. A strict === comparison
 * then hides a caller's own vault after the row is read back, and the old
 * "missing org means allow" branch listed every unscoped vault to every tenant.
 */

export function normalizeMatterVaultOrgId(
  value: string | number | null | undefined,
): string | undefined {
  if (value == null) return undefined;
  const orgId = String(value).trim();
  return orgId.length > 0 ? orgId : undefined;
}

export function matterVaultVisibleToCaller(
  vaultOrgId: string | number | null | undefined,
  callerOrgId: string | number | null | undefined,
): boolean {
  const vaultOrg = normalizeMatterVaultOrgId(vaultOrgId);
  const callerOrg = normalizeMatterVaultOrgId(callerOrgId);
  if (!vaultOrg || !callerOrg) return false;
  return vaultOrg === callerOrg;
}
