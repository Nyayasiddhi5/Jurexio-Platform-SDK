# @jurexio/enterprise-sdk

Enterprise-grade TypeScript SDK for Jurexio Legal AI Platform v3.1.2.

For multi-tenant organizations, government deployments, and large law firms requiring DPDPA 2023, GDPR, EU AI Act, ISO 42001, and SOC 2 compliance.

## Installation

```bash
npm install @jurexio/enterprise-sdk
```

## Quick Start

```typescript
import { NyayavignyaEnterpriseClient } from '@jurexio/enterprise-sdk';

const enterprise = new NyayavignyaEnterpriseClient({
  baseUrl: 'https://app.nyayavigya.in',
  apiKey: 'nyv_live_sk_your_enterprise_key',
  orgId: 'org-your-org-id',
});

const health = await enterprise.healthCheck();
```

## Organization Management

```typescript
// Get org configuration
const config = await enterprise.org.getOrgConfig();

// Multi-tenant management
const { tenantId } = await enterprise.org.createTenant({
  tenantId: '',
  name: 'Delhi Office',
  orgId: 'org-001',
  jurisdictions: ['IN'],
  maxUsers: 50,
  features: ['nyaya-rag', 'digital-twins'],
  status: 'active',
});
const { tenants } = await enterprise.org.listTenants();

// User provisioning
const users = await enterprise.org.listOrgUsers();
await enterprise.org.provisionUser({
  userId: '',
  email: 'advocate@firm.in',
  role: 'senior-associate',
  orgId: 'org-001',
  isActive: true,
});

// RBAC policy management
await enterprise.org.setRBAC({
  roles: [
    { name: 'partner', permissions: ['*'] },
    { name: 'associate', permissions: ['read', 'execute-pattern', 'upload-doc'] },
    { name: 'paralegal', permissions: ['read', 'search'] },
  ],
  defaultRole: 'associate',
});

// Feature flags
await enterprise.org.manageFlags({
  'digital-twins': true,
  'grpo-training': false,
  'cross-jurisdiction': true,
});

// White-label configuration
await enterprise.org.configureWhiteLabel({
  brandName: 'LegalAI by YourFirm',
  primaryColor: '#1a365d',
  logoUrl: 'https://firm.in/logo.svg',
  supportEmail: 'support@firm.in',
});
```

## Compliance

```typescript
// DPDPA 2023 consent management
const consentStatus = await enterprise.compliance.checkDPDPA('user-123');
await enterprise.compliance.grantConsent('user-123', {
  purposes: ['ai_processing', 'legal_research'],
  consentMethod: 'explicit',
});
await enterprise.compliance.withdrawConsent('user-123', ['marketing']);

// GDPR compliance check
const gdpr = await enterprise.compliance.checkGDPR('user-123');

// EU AI Act classification
const classifications = await enterprise.compliance.checkEuAiAct();

// ISO 42001 AIMS
const aimsInventory = await enterprise.compliance.getAimsInventory();
const riskRegister = await enterprise.compliance.getRiskRegister();
const summary = await enterprise.compliance.getIso42001Summary();

// SOC 2 evidence
const evidence = await enterprise.compliance.getSoc2Evidence();

// Bias audit
const biasReport = await enterprise.compliance.runBiasAudit('agent-001');
const allReports = await enterprise.compliance.getBiasReports();

// Immutable hash chain verification
const chainValid = await enterprise.compliance.verifyHashChain('2024-01-01', '2024-12-31');

// Compliance dashboard
const dashboard = await enterprise.compliance.getComplianceDashboard();
```

## Billing & Credits

```typescript
// Credit wallet
const wallet = await enterprise.billing.getWallet();

// Credit operations
await enterprise.billing.deduct(100, 'pattern-execution', 'trace-001');
await enterprise.billing.addCredits(5000, 'monthly-allocation');

// Subscription management
const sub = await enterprise.billing.createSubscription('enterprise-annual', 'annual');

// Usage analytics
const usage = await enterprise.billing.getUsage({
  from: '2024-01-01',
  to: '2024-12-31',
  granularity: 'monthly',
});

// GST invoice generation (India)
const invoice = await enterprise.billing.generateInvoice({
  customer_name: 'Sharma & Associates',
  customer_gstin: '27AABCS1429B1ZB',
  plan_name: 'Enterprise Annual',
  period: 'FY 2024-25',
  base_amount: 500000,
});

// GST computation
const gst = await enterprise.billing.computeGst(100000, '27', '29');
```

## Auth Model

The enterprise SDK uses `Authorization: Bearer <apiKey>` headers with an `X-NYV-Org-ID` header for organization-scoped requests. API keys follow the format `nyv_live_sk_*` for production and `nyv_test_sk_*` for sandbox.

## Version

SDK v5.0.0 | Platform v3.1.2 | API prefix: `/api/jrx/`

---

## Live API base URL

```
https://api.jurexio.example
```

Authenticate with `Authorization: Bearer <NV_API_KEY_xxx>` and a matching
`Origin` header (e.g. `https://pro.jurexio.example` for the NSP key).
For inter-service callers, also set `X-NSP-Inter-Secret` (or alias
`X-Inter-Service-Secret`) to `NV_INTER_SERVICE_SECRET`.

## Project tracker

Every SDK release is logged in:
- the per-package `CHANGELOG.md` (this directory)
- the root [`CHANGELOG.md`](../../../CHANGELOG.md)
- the root [`Project-Tracker.md`](../../../Project-Tracker.md) (audit row)

See [`AGENTS.md`](../../../AGENTS.md) at the repo root for the mandatory
update protocol.
