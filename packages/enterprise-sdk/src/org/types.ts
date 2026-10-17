export interface OrgConfig {
  orgId: string;
  name: string;
  domain: string;
  plan: 'enterprise' | 'government';
  maxUsers: number;
  jurisdictions: string[];
  features: string[];
  createdAt: string;
}

export interface OrgUser {
  userId: string;
  email: string;
  role: string;
  orgId: string;
  isActive: boolean;
  createdAt: string;
}

export interface WhiteLabelConfig {
  orgId: string;
  brandName: string;
  primaryColor: string;
  logoUrl?: string;
  domain?: string;
  supportEmail: string;
  faviconUrl?: string;
  customCss?: string;
}

export interface TenantConfig {
  tenantId: string;
  name: string;
  orgId: string;
  jurisdictions: string[];
  maxUsers: number;
  features: string[];
  status: 'active' | 'suspended' | 'archived';
  createdAt?: string;
}

export interface RbacPolicy {
  roles: {
    name: string;
    permissions: string[];
    description?: string;
  }[];
  defaultRole: string;
}
