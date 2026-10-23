/**
 * @jurexio/enterprise-sdk v5.0.0
 * Enterprise-grade TypeScript SDK for Jurexio Legal AI Platform.
 *
 * Capabilities:
 *   - Multi-organization management (Row-Level Security)
 *   - DPDPA 2023 + GDPR consent management
 *   - ISO 42001 AIMS integration
 *   - SOC 2 evidence collection
 *   - EU AI Act compliance reporting
 *   - GST invoice generation
 *   - White-label configuration
 *   - Enterprise SSO + RBAC
 *   - Multi-tenant isolation
 *   - Feature flag management
 *
 * @version 5.0.0
 * @license UNLICENSED
 */

export { NyayavignyaEnterpriseClient } from './client.js';
export type { EnterpriseClientConfig, EnterpriseHttpClient } from './client.js';

export type {
  DpdpaConsentGrant,
  DpdpaConsentStatus,
  DpdpaConsentPurpose,
  Iso42001Summary,
  AiSystemInventory,
  AiRiskRegisterEntry,
  Soc2EvidenceReport,
  EuAiActClassification,
  BiasAssessmentReport,
} from './compliance/types.js';
export { ComplianceClient } from './compliance/client.js';

export type { GstInvoiceRequest, GstInvoiceResult, CreditWallet } from './billing/types.js';
export { BillingClient } from './billing/client.js';

export type { OrgConfig, OrgUser, WhiteLabelConfig, TenantConfig, RbacPolicy } from './org/types.js';
export { OrgManagementClient } from './org/client.js';

export const SDK_VERSION = '5.0.0';
export const SDK_NAME = '@jurexio/enterprise-sdk';
