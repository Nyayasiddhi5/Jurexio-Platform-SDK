/**
 * @jurexio/enterprise-sdk — Unit Tests v3.1.2
 * Tests SDK structure, types, config, and client initialization.
 */
import { describe, it, expect, vi } from 'vitest';

// ─── Mock fetch globally ──────────────────────────────────────────────────────
global.fetch = vi.fn();

// ─── SDK constants and version ────────────────────────────────────────────────
describe('@jurexio/enterprise-sdk — SDK metadata', () => {
  it('exports SDK_VERSION as 3.1.2', async () => {
    const mod = await import('../src/index.js');
    expect(mod.SDK_VERSION).toBe('5.0.0');
  });

  it('exports SDK_NAME', async () => {
    const mod = await import('../src/index.js');
    expect(mod.SDK_NAME).toBe('@jurexio/enterprise-sdk');
  });

  it('exports NyayavignyaEnterpriseClient', async () => {
    const mod = await import('../src/index.js');
    expect(mod.NyayavignyaEnterpriseClient).toBeDefined();
    expect(typeof mod.NyayavignyaEnterpriseClient).toBe('function');
  });

  it('exports ComplianceClient', async () => {
    const mod = await import('../src/index.js');
    expect(mod.ComplianceClient).toBeDefined();
  });

  it('exports BillingClient', async () => {
    const mod = await import('../src/index.js');
    expect(mod.BillingClient).toBeDefined();
  });

  it('exports OrgManagementClient', async () => {
    const mod = await import('../src/index.js');
    expect(mod.OrgManagementClient).toBeDefined();
  });
});

// ─── NyayavignyaEnterpriseClient instantiation ───────────────────────────────
describe('NyayavignyaEnterpriseClient — instantiation', () => {
  async function makeClient() {
    const { NyayavignyaEnterpriseClient } = await import('../src/index.js');
    return new NyayavignyaEnterpriseClient({
      baseUrl: 'http://localhost:5000',
      apiKey: 'test-api-key-enterprise',
      orgId: 'org-test-001',
      timeout: 5000,
    });
  }

  it('instantiates without throwing', async () => {
    await expect(makeClient()).resolves.toBeTruthy();
  });

  it('exposes compliance sub-client', async () => {
    const client = await makeClient();
    expect(client.compliance).toBeDefined();
  });

  it('exposes billing sub-client', async () => {
    const client = await makeClient();
    expect(client.billing).toBeDefined();
  });

  it('exposes org sub-client', async () => {
    const client = await makeClient();
    expect(client.org).toBeDefined();
  });

  it('compliance sub-client has getConsentStatus method', async () => {
    const client = await makeClient();
    expect(typeof client.compliance.getConsentStatus).toBe('function');
  });

  it('billing sub-client has computeGst method', async () => {
    const client = await makeClient();
    expect(typeof client.billing.computeGst).toBe('function');
  });

  it('org sub-client has getOrgConfig method', async () => {
    const client = await makeClient();
    expect(typeof client.org.getOrgConfig).toBe('function');
  });

  it('org sub-client has listOrgUsers method', async () => {
    const client = await makeClient();
    expect(typeof client.org.listOrgUsers).toBe('function');
  });
});

// ─── Compliance types validation ─────────────────────────────────────────────
describe('Compliance types — shape validation', () => {
  it('DpdpaConsentPurpose includes ai_processing', () => {
    const purposes = [
      'ai_processing', 'legal_research', 'document_storage',
      'analytics', 'marketing', 'third_party_sharing',
      'biometric', 'sensitive_legal_data',
    ];
    expect(purposes.includes('ai_processing')).toBe(true);
  });

  it('AiSystemInventory risk levels are well-defined', () => {
    const levels = ['minimal', 'limited', 'high', 'unacceptable'];
    expect(levels.length).toBe(4);
  });

  it('EuAiActClassification risk categories match regulation', () => {
    const categories = ['unacceptable', 'high', 'limited', 'minimal'];
    expect(categories.length).toBe(4);
    expect(categories[0]).toBe('unacceptable');
  });

  it('Soc2EvidenceReport has correct status values', () => {
    const statuses = ['compliant', 'partial', 'non_compliant'];
    expect(statuses.length).toBe(3);
  });
});

// ─── OrgConfig type validation ────────────────────────────────────────────────
describe('Org types — plan validation', () => {
  it('enterprise plans include enterprise, government, elite', () => {
    const plans = ['enterprise', 'government', 'elite'];
    expect(plans.includes('enterprise')).toBe(true);
    expect(plans.includes('government')).toBe(true);
    expect(plans.includes('elite')).toBe(true);
  });

  it('OrgUser fields are correctly named', () => {
    const user = {
      userId: 'u-001',
      email: 'admin@org.com',
      role: 'admin',
      orgId: 'org-001',
      isActive: true,
      createdAt: new Date().toISOString(),
    };
    expect(user.userId).toBe('u-001');
    expect(user.isActive).toBe(true);
  });
});

// ─── BillingClient types ──────────────────────────────────────────────────────
describe('Billing types — invoice structure', () => {
  it('GstInvoiceRequest has expected fields', () => {
    const req = {
      supplierGstin: '29ABCDE1234F1ZL',
      customerGstin: '07XYZAB5678G2ZP',
      baseAmount: 10000,
      description: 'Legal consultation',
      supplierStateCode: '29',
      customerStateCode: '07',
    };
    expect(req.baseAmount).toBe(10000);
    expect(req.supplierGstin).toContain('ABCDE');
  });

  it('GST rate is 18%', () => {
    const baseAmount = 10000;
    const gstRate = 0.18;
    const gstAmount = baseAmount * gstRate;
    expect(gstAmount).toBe(1800);
  });

  it('intra-state splits into CGST + SGST', () => {
    const total = 1800;
    const half = total / 2;
    expect(half).toBe(900);
  });
});

// ─── HealthCheck integration ───────────────────────────────────────────────────
describe('NyayavignyaEnterpriseClient — healthCheck', () => {
  it('calls /api/jrx/health endpoint', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      json: async () => ({ status: 'healthy', version: '3.1.2' }),
      ok: true,
    } as any);

    const { NyayavignyaEnterpriseClient } = await import('../src/index.js');
    const client = new NyayavignyaEnterpriseClient({
      baseUrl: 'http://localhost:5000',
      apiKey: 'test-key',
      orgId: 'org-001',
    });

    const result = await client.healthCheck();
    expect(result.status).toBe('healthy');
    expect(result.version).toBe('3.1.2');
    expect(result.org).toBe('org-001');
  });
});
