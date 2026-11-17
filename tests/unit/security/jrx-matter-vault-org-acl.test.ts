/**
 * Matter vault org check: numeric JWT org ids must match varchar rows,
 * and a missing org must not open every vault.
 */
import { describe, expect, it } from 'vitest';
import {
  matterVaultVisibleToCaller,
  normalizeMatterVaultOrgId,
} from '../../../src/services/jrx-matter-vault-acl.js';

describe('matter vault org visibility', () => {
  it('treats a numeric caller org and a varchar row as the same tenant', () => {
    expect(matterVaultVisibleToCaller('42', 42)).toBe(true);
    expect(matterVaultVisibleToCaller(42, '42')).toBe(true);
    expect(normalizeMatterVaultOrgId(42)).toBe('42');
  });

  it('hides another tenant even when one side is numeric', () => {
    expect(matterVaultVisibleToCaller('42', 7)).toBe(false);
    expect(matterVaultVisibleToCaller(42, '7')).toBe(false);
  });

  it('fails closed when the vault or the caller has no org', () => {
    expect(matterVaultVisibleToCaller(null, 42)).toBe(false);
    expect(matterVaultVisibleToCaller('42', null)).toBe(false);
    expect(matterVaultVisibleToCaller(undefined, undefined)).toBe(false);
    expect(matterVaultVisibleToCaller('', '42')).toBe(false);
    expect(matterVaultVisibleToCaller('  ', 42)).toBe(false);
  });
});
