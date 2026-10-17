/**
 * JRX Product Config — centralised product identity, emails, and URLs
 * ALL product-specific values live here. NEVER hardcode in route/service files.
 *
 * GUARDRAIL: Any new product email, URL, or identity value MUST be added here
 * and sourced from environment variables with safe dev-only fallbacks.
 *
 * @file src/config/jrx-product-config.ts
 */

export const NV_PRODUCT = {
  name: 'Jurexio Enterprise Platform',
  version: '3.1.2',
  sdkVersion: '5.0.0',
  tagline: 'Justice. Powered by Precision.',
  brandColorPrimary: '#0A2A66',
  brandColorAccent: '#D4A017',
} as const;

export const NV_EMAILS = {
  support:      process.env.JRX_EMAIL_SUPPORT        || 'support@nyayasiddhi.com',
  legal:        process.env.JRX_EMAIL_LEGAL           || 'legal@jurexio.com',
  privacy:      process.env.JRX_EMAIL_PRIVACY         || 'privacy@nyayasiddhi.com',
  dpo:          process.env.JRX_EMAIL_DPO             || 'dpo@nyayasiddhi.com',
  noreply:      process.env.JRX_EMAIL_NOREPLY         || 'noreply@nyayasiddhi.com',
  superadmin:   process.env.JRX_SUPERADMIN_EMAIL      || '[PURGED-NV_UAT_EMAIL]',
  serviceAccount: process.env.JRX_SERVICE_ACCOUNT_EMAIL || 'service@jurexio.comternal',
} as const;

export const NV_URLS = {
  app:        process.env.JRX_APP_URL       || 'https://app.nyayasiddhi.com',
  www:        process.env.JRX_WWW_URL       || 'https://www.nyayasiddhi.com',
  pricing:    process.env.JRX_PRICING_URL   || 'https://nyayasiddhi.com/pricing',
  docs:       process.env.JRX_DOCS_URL      || 'https://docs.jurexio.com',
  institutional: process.env.JRX_INST_URL  || 'https://institutional.nyayasiddhi.com',
  cdn:        process.env.JRX_CDN_URL       || '',
} as const;

export const NV_COMPLIANCE = {
  dataControllerAddress: process.env.DATA_CONTROLLER_ADDRESS || 'Jurexio Technology Pvt Ltd, Bengaluru, India',
  dataControllerEmail:   process.env.DATA_CONTROLLER_EMAIL   || NV_EMAILS.privacy,
  dpoEmail:              process.env.DPO_EMAIL               || NV_EMAILS.dpo,
  soc2Status: 'SOC 2 Ready for Audit',
} as const;
