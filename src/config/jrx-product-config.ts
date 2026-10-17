/**
 * NYV Product Config — centralised product identity, emails, and URLs
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
  support:      process.env.NYV_EMAIL_SUPPORT        || 'support@nyayasiddhi.com',
  legal:        process.env.NYV_EMAIL_LEGAL           || 'legal@nyayavigya.in',
  privacy:      process.env.NYV_EMAIL_PRIVACY         || 'privacy@nyayasiddhi.com',
  dpo:          process.env.NYV_EMAIL_DPO             || 'dpo@nyayasiddhi.com',
  noreply:      process.env.NYV_EMAIL_NOREPLY         || 'noreply@nyayasiddhi.com',
  superadmin:   process.env.NYV_SUPERADMIN_EMAIL      || '[PURGED-NV_UAT_EMAIL]',
  serviceAccount: process.env.NYV_SERVICE_ACCOUNT_EMAIL || 'service@nyayavigya.internal',
} as const;

export const NV_URLS = {
  app:        process.env.NYV_APP_URL       || 'https://app.nyayasiddhi.com',
  www:        process.env.NYV_WWW_URL       || 'https://www.nyayasiddhi.com',
  pricing:    process.env.NYV_PRICING_URL   || 'https://nyayasiddhi.com/pricing',
  docs:       process.env.NYV_DOCS_URL      || 'https://docs.nyayavigya.in',
  institutional: process.env.NYV_INST_URL  || 'https://institutional.nyayasiddhi.com',
  cdn:        process.env.NYV_CDN_URL       || '',
} as const;

export const NV_COMPLIANCE = {
  dataControllerAddress: process.env.DATA_CONTROLLER_ADDRESS || 'Jurexio Technology Pvt Ltd, Bengaluru, India',
  dataControllerEmail:   process.env.DATA_CONTROLLER_EMAIL   || NV_EMAILS.privacy,
  dpoEmail:              process.env.DPO_EMAIL               || NV_EMAILS.dpo,
  soc2Status: 'SOC 2 Ready for Audit',
} as const;
