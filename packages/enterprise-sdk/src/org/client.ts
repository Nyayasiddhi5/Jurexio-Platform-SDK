import type { EnterpriseHttpClient } from '../client.js';
import type { OrgConfig, OrgUser, WhiteLabelConfig, TenantConfig, RbacPolicy } from './types.js';

export class OrgManagementClient {
  constructor(
    private http: EnterpriseHttpClient,
    private orgId: string
  ) {}

  async getOrgConfig(): Promise<OrgConfig> {
    return this.http.get(`/api/jrx/enterprise/orgs/${this.orgId}`);
  }

  async updateOrgConfig(updates: Partial<OrgConfig>): Promise<{ success: boolean }> {
    return this.http.patch(`/api/jrx/enterprise/orgs/${this.orgId}`, updates);
  }

  async createTenant(config: TenantConfig): Promise<{ success: boolean; tenantId: string }> {
    return this.http.post(`/api/jrx/enterprise/orgs/${this.orgId}/tenants`, config);
  }

  async listTenants(): Promise<{ tenants: TenantConfig[]; total: number }> {
    return this.http.get(`/api/jrx/enterprise/orgs/${this.orgId}/tenants`);
  }

  async getTenant(tenantId: string): Promise<TenantConfig> {
    return this.http.get(`/api/jrx/enterprise/orgs/${this.orgId}/tenants/${tenantId}`);
  }

  async listOrgUsers(): Promise<OrgUser[]> {
    return this.http.get(`/api/jrx/enterprise/orgs/${this.orgId}/users`);
  }

  async provisionUser(user: Omit<OrgUser, 'createdAt'>): Promise<{ success: boolean; userId: string }> {
    return this.http.post(`/api/jrx/enterprise/orgs/${this.orgId}/users`, user);
  }

  async deactivateUser(userId: string): Promise<{ success: boolean }> {
    return this.http.post(`/api/jrx/enterprise/orgs/${this.orgId}/users/${userId}/deactivate`, {});
  }

  async setRBAC(policy: RbacPolicy): Promise<{ success: boolean }> {
    return this.http.post(`/api/jrx/enterprise/orgs/${this.orgId}/rbac`, policy);
  }

  async getRBAC(): Promise<RbacPolicy> {
    return this.http.get(`/api/jrx/enterprise/orgs/${this.orgId}/rbac`);
  }

  async manageFlags(flags: Record<string, boolean>): Promise<{ success: boolean; updatedFlags: string[] }> {
    return this.http.post(`/api/jrx/enterprise/orgs/${this.orgId}/flags`, { flags });
  }

  async getFlags(): Promise<Record<string, boolean>> {
    return this.http.get(`/api/jrx/enterprise/orgs/${this.orgId}/flags`);
  }

  async configureWhiteLabel(config: Partial<WhiteLabelConfig>): Promise<{ success: boolean }> {
    return this.http.patch('/api/jrx/enterprise/white-label', config);
  }

  async getWhiteLabel(): Promise<WhiteLabelConfig> {
    return this.http.get('/api/jrx/enterprise/white-label');
  }
}
