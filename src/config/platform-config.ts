export const PLATFORM_VERSION = '5.0.0';

export const PLATFORM_NAME = 'Jurexio Legal SDK';
export const PLATFORM_TAGLINE = 'Justice. Powered by Precision.';

export const SERVER_CONFIG = {
  backendPort: parseInt(process.env.PORT || '5000', 10),
  frontendPort: parseInt(process.env.FRONTEND_PORT || '5000', 10),
  get backendUrl(): string {
    return process.env.BACKEND_URL || `http://localhost:${this.backendPort}`;
  },
  get frontendUrl(): string {
    return process.env.FRONTEND_URL || `http://localhost:${this.frontendPort}`;
  },
  get wsUrl(): string {
    return process.env.WS_URL || `ws://localhost:${this.backendPort}`;
  },
  get jurexioApiBase(): string {
    return `${this.backendUrl}/api/jurexio`;
  },
  get callbackUrl(): string {
    return process.env.CALLBACK_URL || this.frontendUrl;
  },
} as const;

export const SECURITY_CONFIG = {
  rateLimits: {
    general: { windowMs: 60000, maxRequests: 100 },
    llm: { windowMs: 60000, maxRequests: 20 },
    auth: { windowMs: 60000, maxRequests: 10 },
    upload: { windowMs: 60000, maxRequests: 5 },
  },
  session: {
    // NV-AUTH-LIFETIME-2026-05-10: extended for dev/UAT — keep admin sessions alive
    // through long e2e/UAT runs. Tighten back to 4h/30d before broader prod rollout.
    expiryHours: 24,
    otpExpiryMinutes: 10,
    maxOtpAttempts: 3,
    jwtExpiryHours: 24,
    refreshTokenExpiryDays: 90,
    refreshTokenRotation: true,
  },
  pii: {
    patterns: {
      aadhaar: /\b\d{4}\s?\d{4}\s?\d{4}\b/g,
      pan: /\b[A-Z]{5}\d{4}[A-Z]\b/g,
      phone: /\b(?:\+91[\s-]?)?[6-9]\d{9}\b/g,
      email: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z]{2,}\b/gi,
      ssn: /\b\d{3}-\d{2}-\d{4}\b/g,
      passport: /\b[A-Z]\d{7}\b/g,
      creditCard: /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/g,
      ukNino: /\b[A-CEGHJ-PR-TW-Z]{2}\d{6}[A-D]\b/g,
      singaporeNric: /\b[STFG]\d{7}[A-Z]\b/g,
    },
    redactionChar: '█',
    enabledByDefault: true,
  },
  bannedKeywords: [
    'kill', 'murder', 'suicide', 'bomb', 'terror',
    'hack', 'exploit', 'illegal drugs', 'child abuse',
  ],
  corsOrigins: process.env.CORS_ORIGINS?.split(',') || ['*'],
} as const;

export const JURISDICTION_CONFIG = {
  india: {
    code: 'IN',
    name: 'India',
    dataResidency: 'India',
    complianceFrameworks: ['DPDP Act 2023', 'IT Act 2000', 'RBI Guidelines', 'SEBI Regulations'],
    piiFields: ['aadhaar', 'pan', 'phone', 'email', 'passport'],
    languages: ['hi', 'en', 'ta', 'te', 'bn', 'mr', 'gu', 'kn', 'ml', 'pa', 'or', 'as', 'ur', 'mai', 'sat', 'ks', 'ne', 'sd', 'kok', 'doi', 'mni', 'bo'],
    courts: ['Supreme Court of India', 'High Courts', 'District Courts', 'Tribunals', 'Consumer Forums'],
    statutes: ['BNS 2023', 'BNSS 2023', 'BSA 2023', 'CPC', 'Constitution of India', 'IT Act', 'Companies Act'],
    currency: 'INR',
    timezone: 'Asia/Kolkata',
    dataRetentionDays: 2555,
    consentRequired: true,
    rightToErasure: true,
    breachNotificationHours: 72,
    slmBinding: 'JRX-SLM-IND',
  },
  uk: {
    code: 'GB',
    name: 'United Kingdom',
    dataResidency: 'United Kingdom',
    complianceFrameworks: ['UK GDPR', 'Data Protection Act 2018', 'FCA Regulations', 'Companies Act 2006'],
    piiFields: ['ukNino', 'phone', 'email', 'passport', 'creditCard'],
    languages: ['en', 'cy', 'gd'],
    courts: ['UK Supreme Court', 'Court of Appeal', 'High Court of Justice', 'Crown Court', 'Magistrates Court', 'Employment Tribunal'],
    statutes: ['Companies Act 2006', 'UK GDPR', 'Employment Rights Act 1996', 'Equality Act 2010', 'Financial Services Act'],
    currency: 'GBP',
    timezone: 'Europe/London',
    dataRetentionDays: 2555,
    consentRequired: true,
    rightToErasure: true,
    breachNotificationHours: 72,
    slmBinding: 'JRX-SLM-UK',
  },
  gcc: {
    code: 'GCC',
    name: 'GCC (Gulf Cooperation Council)',
    dataResidency: 'GCC Region',
    complianceFrameworks: [
      'UAE PDPL 2021', 'DIFC Data Protection Law', 'ADGM Data Protection Regulations',
      'Saudi PDPL 2022', 'NCA Cybersecurity Controls', 'SAMA Regulations',
      'Qatar PDPP', 'Bahrain PDPL', 'Kuwait CSA', 'Oman ITA'
    ],
    piiFields: ['phone', 'email', 'passport'],
    languages: ['ar', 'en'],
    courts: [
      'UAE Federal Supreme Court', 'DIFC Courts', 'ADGM Courts',
      'Saudi Board of Grievances', 'Saudi Commercial Courts',
      'Qatar International Court', 'DIAC', 'ADCCAC'
    ],
    statutes: [
      'UAE Civil Code', 'UAE Commercial Companies Law', 'DIFC Laws', 'ADGM Regulations',
      'Saudi Basic Law', 'Saudi Companies Law', 'Saudi Labor Law',
      'GCC Commercial Law', 'Islamic Finance Principles'
    ],
    currency: 'AED',
    timezone: 'Asia/Dubai',
    dataRetentionDays: 1825,
    consentRequired: true,
    rightToErasure: true,
    breachNotificationHours: 72,
    slmBinding: 'JRX-SLM-GCC',
  },
  europe: {
    code: 'EU',
    name: 'Europe',
    dataResidency: 'EU/EEA',
    complianceFrameworks: ['GDPR', 'ePrivacy Directive', 'Digital Services Act', 'AI Act', 'NIS2 Directive'],
    piiFields: ['phone', 'email', 'passport', 'creditCard'],
    languages: ['en', 'de', 'fr', 'es', 'it', 'pt', 'nl', 'pl', 'sv'],
    courts: ['CJEU', 'ECHR', 'National Courts', 'Arbitration Tribunals'],
    statutes: ['GDPR', 'EU Treaties', 'National Codes', 'EU Directives', 'EU Regulations'],
    currency: 'EUR',
    timezone: 'Europe/Brussels',
    dataRetentionDays: 1825,
    consentRequired: true,
    rightToErasure: true,
    breachNotificationHours: 72,
    slmBinding: 'JRX-SLM-EUR',
  },
  usa: {
    code: 'US',
    name: 'United States',
    dataResidency: 'United States',
    complianceFrameworks: ['CCPA/CPRA', 'HIPAA', 'SOX', 'GLBA', 'FCPA', 'ADA', 'State Privacy Laws'],
    piiFields: ['ssn', 'phone', 'email', 'creditCard', 'passport'],
    languages: ['en', 'es'],
    courts: ['Supreme Court', 'Federal Circuit Courts', 'District Courts', 'State Courts', 'Bankruptcy Courts'],
    statutes: ['US Constitution', 'USC Titles', 'CFR', 'State Codes', 'UCC'],
    currency: 'USD',
    timezone: 'America/New_York',
    dataRetentionDays: 2555,
    consentRequired: true,
    rightToErasure: false,
    breachNotificationHours: 72,
    slmBinding: 'JRX-SLM-USA',
  },
  singapore: {
    code: 'SG',
    name: 'Singapore',
    dataResidency: 'Singapore',
    complianceFrameworks: ['PDPA 2012', 'Cybersecurity Act 2018', 'Computer Misuse Act'],
    piiFields: ['singaporeNric', 'phone', 'email', 'passport'],
    languages: ['en', 'zh', 'ms', 'ta'],
    courts: ['Supreme Court', 'State Courts', 'Family Justice Courts', 'SICC'],
    statutes: ['PDPA', 'Companies Act', 'Employment Act', 'Penal Code'],
    currency: 'SGD',
    timezone: 'Asia/Singapore',
    dataRetentionDays: 1825,
    consentRequired: true,
    rightToErasure: true,
    breachNotificationHours: 72,
    slmBinding: 'JRX-SLM-SGP',
  },
} as const;

export type JurisdictionCode = keyof typeof JURISDICTION_CONFIG;

export const SUPPORTED_JURISDICTIONS = Object.keys(JURISDICTION_CONFIG) as JurisdictionCode[];

export const JURISDICTION_DISPLAY_NAMES: Record<string, string> = {
  india: 'India',
  uk: 'United Kingdom',
  gcc: 'GCC (Gulf Cooperation Council)',
  europe: 'Europe',
  usa: 'United States',
  singapore: 'Singapore',
};

export const SLM_BINDINGS = {
  india: 'JRX-SLM-IND',
  uk: 'JRX-SLM-UK',
  gcc: 'JRX-SLM-GCC',
  europe: 'JRX-SLM-EUR',
  usa: 'JRX-SLM-USA',
  singapore: 'JRX-SLM-SGP',
} as const;

export const PRODUCT_NAMES = {
  jurexio-citizen: 'Jurexio Citizen',
  nyayasiddhiProfessional: 'Jurexio Professional™',
  nyayasiddhiInstitutional: 'Jurexio Institutional™',
  nyayasiddhiMinistry: 'Jurexio Ministry™',
  nyayasiddhiAcademy: 'Jurexio Academy™',
  jurexio: 'Jurexio',
} as const;

export const PRODUCT_TIERS = {
  nyayasiddhiProfessional: {
    solo: { name: 'Professional Solo', maxUsers: 1, maxMatters: 25, maxClients: 20, storageGb: 20 },
    plus: { name: 'Professional Plus', maxUsers: 20, maxMatters: 100, maxClients: 50, storageGb: 50 },
    pro: { name: 'Professional Pro', maxUsers: 50, maxMatters: 200, maxClients: 100, storageGb: 150 },
  },
  nyayasiddhiInstitutional: {
    standard: { name: 'Institutional Standard', maxUsers: 500, maxMatters: 2000, complianceAutomation: true },
    elite: { name: 'Institutional Elite', maxUsers: 1000, maxMatters: 5000, whiteLabel: true, sovereignCloud: true },
    government: { name: 'Institutional Government', maxUsers: -1, maxMatters: -1, courtMode: true, wormHardening: true },
  },
  nyayasiddhiAcademy: {
    scholar: { name: 'Academy Scholar', target: 'Students', aiCredits: 'low', storageGb: 5 },
    professional: { name: 'Academy Professional', target: 'Practicing Lawyers', aiCredits: 'moderate', storageGb: 10 },
    elite: { name: 'Academy Elite', target: 'Senior/Govt/PSU', aiCredits: 'high', storageGb: 50 },
    institutional: { name: 'Academy Institutional', target: 'Universities/Ministries', aiCredits: 'enterprise', storageGb: -1 },
  },
} as const;

export const PRODUCT_ROUTES = {
  jurexio-citizen: '/api/jrx/nym',
  nyayasiddhiProfessional: '/api/jrx/pro',
  nyayasiddhiInstitutional: '/api/jrx/ins',
  nyayasiddhiMinistry: '/api/jrx/gov',
  nyayasiddhiAcademy: '/api/jrx/ace',
  jurexio: '/api/nyv',
} as const;

export const PRODUCT_DB_PREFIXES = {
  jurexio-citizen: 'nym_',
  nyayasiddhiProfessional: 'nys_pro_',
  nyayasiddhiInstitutional: 'nys_ins_',
  nyayasiddhiMinistry: 'nys_min_',
  nyayasiddhiAcademy: 'nys_ace_',
  jurexio: 'nyv_',
} as const;

export const LLM_CONFIG = {
  defaultProvider: 'openrouter',
  primaryProviders: ['openai', 'openrouter'],
  fallbackChain: ['openai', 'openrouter', 'anthropic', 'google', 'deepseek', 'groq'],
  maxRetries: 3,
  timeoutMs: 30000,
  maxTokens: {
    chat: 4096,
    analysis: 8192,
    caseBrief: 16384,
    documentReview: 32768,
  },
  temperatureDefaults: {
    legal: 0.2,
    creative: 0.7,
    analysis: 0.3,
    chat: 0.5,
  },
  costBudgets: {
    perRequestMaxUsd: 0.10,
    dailyMaxUsd: 50.00,
    monthlyMaxUsd: 1000.00,
  },
} as const;

export const AGENT_CONFIG = {
  totalAgents: 149,
  practiceAreas: 29,
  jurisdictions: 6,
  jurisdictionNames: ['India', 'UK', 'GCC', 'Europe', 'USA', 'Singapore'],
  systemPromptVersion: 'v10.0',
  sdkVersion: '5.0.0',
  romaLevel: 'L5',
  confidenceThresholds: {
    autoApprove: 0.95,
    review: 0.70,
    escalate: 0.50,
  },
  v3RegistryPath: 'config/agent-registries/Jurexio-Legal-registry-Default.json',
} as const;

export const NYAYAMITRA_CONFIG = {
  version: PLATFORM_VERSION,
  serviceName: 'Jurexio Citizen',
  tagline: 'Justice. Powered by Precision.',
  brand: {
    colors: {
      royalBlue: '#152448',
      gold: '#C7B15B',
      deepIndigo: '#152448',
      sidebarDark: '#2B384C',
      emeraldGreen: '#158E54',
      cream: '#F7F3EA',
    },
    fonts: {
      heading: 'Merriweather, serif',
      body: 'Inter, sans-serif',
    },
    logo: '/nyayasiddhi-icon.png',
    logoLockup: '/nyayasiddhi-logo.png',
  },
  intakeConfig: {
    maxSessionDurationMinutes: 60,
    maxMessagesPerSession: 50,
    maxFileUploadSizeMb: 25,
    allowedFileTypes: ['pdf', 'jpg', 'jpeg', 'png', 'doc', 'docx'],
  },
  ctoExclusions: {
    noAiLegalAdvice: true,
    noVisibleLawyerRatings: true,
    noNoticeDrafting: true,
    noBailAdvice: true,
    noMarketplaceBrowsing: true,
  },
  schemas: ['iam_schema', 'intake_schema', 'lawyer_schema', 'consult_schema', 'document_schema', 'audit_schema'],
} as const;

export const COMPLIANCE_CONFIG = {
  globalRules: {
    piiRedactionRequired: true,
    auditLoggingRequired: true,
    consentBeforeProcessing: true,
    encryptionAtRest: true,
    encryptionInTransit: true,
    dataMinimization: true,
    accessControlRequired: true,
    incidentResponsePlan: true,
  },
  dataRetention: {
    activeCaseDays: 365,
    closedCaseDays: 2555,
    auditLogDays: 2555,
    sessionLogDays: 90,
    deletedUserDataDays: 30,
  },
  rbacRoles: [
    'super_admin',
    'org_admin',
    'platform_admin',
    'enterprise_admin',
    'senior_lawyer',
    'lawyer',
    'junior_lawyer',
    'cse',
    'citizen',
    'guest',
  ] as const,
  requiredConsents: [
    'data_processing',
    'ai_disclaimer',
    'terms_of_service',
    'privacy_policy',
    'cookie_policy',
  ],
} as const;

// v5.0.0: SDK seeding defaults to the Jurexio™ enterprise org for all
// nyayasiddhi* ecosystem platforms (Professional, Institutional, Ministry, Academy)
// and Jurexio Citizen.
//
// The canonical lookup is by SLUG ('nyayasiddhi') — call resolveDefaultOrgId(db)
// at startup/seed time so the platform survives PK changes (renumber, restore-from-
// backup, fresh DB). The synchronous NYAYASIDDHI_ORG_ID constant exists ONLY for
// legacy callsites that cannot be made async; it must be treated as a hint, not a
// hard guarantee.
export const NYAYASIDDHI_ORG_SLUG = 'nyayasiddhi';
export const NYAYASIDDHI_ORG_ID = parseInt(process.env.NYAYASIDDHI_ORG_ID || '2767', 10);

/**
 * Resolve the Jurexio org id by slug at runtime. Falls back to the env-derived
 * NYAYASIDDHI_ORG_ID only if the slug lookup fails (e.g. bootstrap before seed).
 * Throws an explicit, loud error if neither path yields an org so deploys fail-fast
 * instead of silently attaching SDK seeds to a nonexistent or wrong org.
 */
export async function resolveDefaultOrgId(db: { execute: (q: any) => Promise<any> } | null | undefined, sql: any): Promise<number> {
  if (!db) return NYAYASIDDHI_ORG_ID;
  try {
    const r = await db.execute(sql`SELECT id FROM nv_organizations WHERE slug = ${NYAYASIDDHI_ORG_SLUG} LIMIT 1`);
    const row = (r.rows || r as any[])[0];
    if (row?.id) return Number(row.id);
  } catch (e) {
    console.warn(`[platform-config] slug lookup for '${NYAYASIDDHI_ORG_SLUG}' failed:`, (e as any)?.message || e);
  }
  // Verify the env fallback exists; if not, fail loudly.
  try {
    const r2 = await db.execute(sql`SELECT id FROM nv_organizations WHERE id = ${NYAYASIDDHI_ORG_ID} LIMIT 1`);
    const row = (r2.rows || r2 as any[])[0];
    if (row?.id) return Number(row.id);
  } catch {}
  throw new Error(
    `[platform-config] FATAL: default Jurexio org not found by slug='${NYAYASIDDHI_ORG_SLUG}' or id=${NYAYASIDDHI_ORG_ID}. ` +
    `Run scripts/jrx-seed-orgs.ts or insert the org manually before SDK seed.`
  );
}

export const SDK_CONFIG = {
  seed: {
    defaultOrganizationId: NYAYASIDDHI_ORG_ID,
    metadataTier: 'internal' as const,
    jurexio-citizen: {
      clientId: 'nyv_app_jurexio-citizen_consumer_intake_v1',
      appName: 'Jurexio Citizen',
      appType: 'consumer_intake' as const,
      description: 'Consumer legal intake platform for citizens seeking legal assistance',
      rateLimitPerMinute: 100,
      dailyTokenBudget: 500000,
      monthlyTokenBudget: 15000000,
      defaultAgentTokenLimit: 50000,
      maxTokensPerRequest: 2048,
      temperature: 0.5,
      jurisdiction: 'IN',
      metadataPlatform: 'jurexio-citizen',
    },
    nyayasiddhiProfessional: {
      clientId: 'nyv_app_nyayasiddhi_professional_v1',
      appName: 'Jurexio Professional™',
      appType: 'lawyer_platform' as const,
      description: 'Practice management OS for solo lawyers and small firms (Solo/Plus/Pro tiers)',
      rateLimitPerMinute: 60,
      dailyTokenBudget: 200000,
      monthlyTokenBudget: 6000000,
      defaultAgentTokenLimit: 25000,
      jurisdiction: 'IN',
      metadataPlatform: 'nyayasiddhi-professional',
    },
    nyayasiddhiInstitutional: {
      clientId: 'nyv_app_nyayasiddhi_institutional_v1',
      appName: 'Jurexio Institutional™',
      appType: 'institutional' as const,
      description: 'Legal governance platform for large law firms and multinational organizations (Standard/Elite/Government tiers)',
      rateLimitPerMinute: 120,
      dailyTokenBudget: 1000000,
      monthlyTokenBudget: 30000000,
      defaultAgentTokenLimit: 100000,
      jurisdiction: 'IN',
      metadataPlatform: 'nyayasiddhi-institutional',
    },
    nyayasiddhiMinistry: {
      clientId: 'nyv_app_nyayasiddhi_governance_v1',
      appName: 'Jurexio Ministry™',
      appType: 'government' as const,
      description: 'Sovereign regulatory governance infrastructure platform for government ministries and regulatory bodies',
      rateLimitPerMinute: 200,
      dailyTokenBudget: 2000000,
      monthlyTokenBudget: 60000000,
      defaultAgentTokenLimit: 200000,
      jurisdiction: 'IN',
      metadataPlatform: 'nyayasiddhi-ministry',
    },
    nyayasiddhiAcademy: {
      clientId: 'nyv_app_nyayasiddhi_academy_v1',
      appName: 'Jurexio Academy™',
      appType: 'education' as const,
      description: 'Legal intelligence training infrastructure platform (Scholar/Professional/Elite/Institutional tiers)',
      rateLimitPerMinute: 80,
      dailyTokenBudget: 300000,
      monthlyTokenBudget: 9000000,
      defaultAgentTokenLimit: 30000,
      jurisdiction: 'IN',
      metadataPlatform: 'nyayasiddhi-academy',
    },
  },
  defaults: {
    rateLimitPerMinute: 60,
    dailyTokenBudget: 100000,
    monthlyTokenBudget: 3000000,
    maxTokensPerRequest: 4096,
    temperature: 0.7,
    provider: 'openrouter',
    allowedOrigins: ['*'] as string[],
  },
  credentials: {
    clientIdPrefix: 'nyv_app_',
    clientSecretPrefix: 'nyv_sk_',
    apiKeyPrefix: 'nyv_key_',
  },
  // 6 canonical jurisdictions. Both 'UK' (canonical platform-wide, matches
  // docs + jrx-registry-stats + registry-paths + jrx-sdk-variants) and 'GB'
  // (ISO-3166 alpha-2) are accepted — middleware normalizes UK ↔ GB.
  supportedJurisdictions: ['IN', 'UK', 'GB', 'GCC', 'EU', 'US', 'SG'] as const,
  supportedAppTypes: ['consumer_intake', 'lawyer_platform', 'institutional', 'government', 'education', 'custom'] as const,
  scopes: ['agents:read', 'agents:execute', 'documents:read', 'documents:write', 'research:read', 'usage:read', '*'] as const,
} as const;

export const CORS_CONFIG = {
  get origins(): string[] {
    if (process.env.TESTING_MODE !== 'false') return ['*'];
    if (process.env.CORS_ORIGINS) {
      return process.env.CORS_ORIGINS.split(',').map(o => o.trim());
    }
    if (process.env.JRX_DEV_DOMAIN) {
      const d = process.env.JRX_DEV_DOMAIN;
      return [
        `https://${d}`,
        `https://${d}:3000`,
        `https://${d}:3001`,
        `https://${d}:3002`,
        `https://${d}:3003`,
        `https://${d}:4200`,
      ];
    }
    if (process.env.NODE_ENV === 'production') {
      return process.env.ALLOWED_ORIGINS?.split(',').map(o => o.trim()) || [];
    }
    return ['*'];
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'] as const,
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-ID', 'X-Organization-ID', 'X-Jurisdiction'] as const,
  maxAge: parseInt(process.env.CORS_MAX_AGE || '86400', 10),
};

export const SMTP_CONFIG = {
  host: process.env.SMTP_HOST || '',
  port: parseInt(process.env.SMTP_PORT || '587', 10),
  secure: process.env.SMTP_SECURE === 'true',
  auth: {
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
  },
  from: {
    name: process.env.SMTP_FROM_NAME || 'Jurexio Professional™',
    email: process.env.SMTP_FROM_EMAIL || '',
  },
  get isConfigured(): boolean {
    return !!(this.host && this.auth.user && this.auth.pass && this.from.email);
  },
  templates: {
    welcomeSubject: 'Welcome to Jurexio Professional™',
    otpSubject: 'Your Verification Code - Jurexio',
    resetPasswordSubject: 'Password Reset Request - Jurexio',
    notificationSubject: 'Notification from Jurexio Professional™',
  },
};

export const PAYMENT_CONFIG = {
  razorpay: {
    keyId: process.env.RAZORPAY_KEY_ID || '',
    keySecret: process.env.RAZORPAY_KEY_SECRET || '',
    webhookSecret: process.env.RAZORPAY_WEBHOOK_SECRET || '',
    get isConfigured(): boolean {
      return !!(this.keyId && this.keySecret);
    },
    baseUrl: 'https://api.razorpay.com/v1',
    maxRetries: parseInt(process.env.RAZORPAY_MAX_RETRIES || '3', 10),
    retryDelayMs: parseInt(process.env.RAZORPAY_RETRY_DELAY_MS || '1000', 10),
    callbackUrl: process.env.RAZORPAY_CALLBACK_URL || process.env.FRONTEND_URL || '',
    supportedCurrencies: ['INR', 'USD', 'AED', 'GBP', 'SGD', 'EUR'] as const,
    tiers: {
      solo: { name: 'Professional Solo', amount: 99900, currency: 'INR' as const, period: 'monthly' },
      plus: { name: 'Professional Plus', amount: 299900, currency: 'INR' as const, period: 'monthly' },
      pro: { name: 'Professional Pro', amount: 999900, currency: 'INR' as const, period: 'monthly' },
      government: { name: 'Government Plan', amount: 4999900, currency: 'INR' as const, period: 'yearly' },
    },
  },
};

export const SSL_CONFIG = {
  enabled: process.env.SSL_ENABLED === 'true' || process.env.NODE_ENV === 'production',
  certPath: process.env.SSL_CERT_PATH || '',
  keyPath: process.env.SSL_KEY_PATH || '',
  caPath: process.env.SSL_CA_PATH || '',
  minVersion: process.env.SSL_MIN_VERSION || 'TLSv1.2',
  hsts: {
    enabled: process.env.HSTS_ENABLED !== 'false',
    maxAge: parseInt(process.env.HSTS_MAX_AGE || '31536000', 10),
    includeSubDomains: process.env.HSTS_INCLUDE_SUBDOMAINS !== 'false',
    preload: process.env.HSTS_PRELOAD === 'true',
  },
};

export const FEATURE_FLAGS = {
  enableVoiceInterface: process.env.FEATURE_VOICE === 'true',
  enableVideoConsultation: process.env.FEATURE_VIDEO !== 'false',
  enableDocumentOcr: process.env.FEATURE_OCR !== 'false',
  enableMultiLanguage: process.env.FEATURE_I18N !== 'false',
  enableSwarmOrchestration: process.env.FEATURE_SWARM !== 'false',
  enablePredictiveAnalytics: process.env.FEATURE_ANALYTICS !== 'false',
  enableQuantumSecurity: process.env.FEATURE_QUANTUM === 'true',
  enableWhiteLabel: process.env.FEATURE_WHITELABEL !== 'false',
  enableEFiling: process.env.FEATURE_EFILING === 'true',
  enablePaymentProcessing: process.env.FEATURE_PAYMENTS === 'true' || !!(process.env.RAZORPAY_KEY_ID),
  enableRomaL5: process.env.FEATURE_ROMA_L5 !== 'false',
  enableDigitalTwin: process.env.FEATURE_DIGITAL_TWIN === 'true',
  enableSkillsSystem: process.env.FEATURE_SKILLS !== 'false',
};

export const AI_KILL_SWITCH = {
  globalEnabled: process.env.AI_GLOBAL_ENABLED !== 'false',
  agentOverrides: (() => {
    try {
      return JSON.parse(process.env.AI_AGENT_OVERRIDES || '{}');
    } catch { return {}; }
  })() as Record<string, boolean>,
  isAgentEnabled(agentKey: string): boolean {
    if (!this.globalEnabled) return false;
    if (agentKey in this.agentOverrides) return this.agentOverrides[agentKey];
    return true;
  },
  maxConcurrentAgents: parseInt(process.env.AI_MAX_CONCURRENT || '10', 10),
  emergencyShutdownCode: process.env.AI_EMERGENCY_CODE || '',
};

export const DATA_GOVERNANCE = {
  retention: {
    enabled: process.env.DATA_RETENTION_ENABLED !== 'false',
    runScheduleHours: parseInt(process.env.DATA_RETENTION_SCHEDULE_HOURS || '24', 10),
    policies: {
      activeCaseDays: parseInt(process.env.RETENTION_ACTIVE_CASE_DAYS || '365', 10),
      closedCaseDays: parseInt(process.env.RETENTION_CLOSED_CASE_DAYS || '2555', 10),
      auditLogDays: parseInt(process.env.RETENTION_AUDIT_LOG_DAYS || '2555', 10),
      sessionLogDays: parseInt(process.env.RETENTION_SESSION_LOG_DAYS || '90', 10),
      deletedUserDataDays: parseInt(process.env.RETENTION_DELETED_USER_DAYS || '30', 10),
      tempFilesDays: parseInt(process.env.RETENTION_TEMP_FILES_DAYS || '7', 10),
    },
  },
  erasure: {
    cascadeDelete: true,
    anonymizeInstead: process.env.DATA_ERASURE_ANONYMIZE === 'true',
    retainAuditTrail: true,
    cooldownHours: parseInt(process.env.DATA_ERASURE_COOLDOWN_HOURS || '48', 10),
  },
  breach: {
    notificationWindowHours: 72,
    autoDetectEnabled: process.env.BREACH_AUTO_DETECT !== 'false',
    notifyDPB: true,
    notifyAffectedUsers: true,
    certInReportingHours: 6,
    templates: {
      dpbNotification: 'breach_dpb_notification',
      userNotification: 'breach_user_notification',
      certInReport: 'breach_certin_report',
      internalEscalation: 'breach_internal_escalation',
    },
  },
  export: {
    supportedFormats: ['json', 'csv'] as readonly string[],
    maxExportSizeMb: parseInt(process.env.DATA_EXPORT_MAX_SIZE_MB || '100', 10),
    includeMetadata: true,
  },
  privacyNotice: {
    version: '1.0.0',
    lastUpdated: '2026-04-03',
    availableLanguages: ['en', 'hi', 'ta', 'te', 'ar', 'zh', 'fr', 'de'] as readonly string[],
    dataController: {
      name: process.env.DATA_CONTROLLER_NAME || 'Jurexio Professional™',
      email: process.env.DATA_CONTROLLER_EMAIL || 'privacy@nyayasiddhi.com',
      address: process.env.DATA_CONTROLLER_ADDRESS || '',
    },
    dpo: {
      name: process.env.DPO_NAME || '',
      email: process.env.DPO_EMAIL || 'dpo@nyayasiddhi.com',
      appointed: !!process.env.DPO_NAME,
    },
    purposes: [
      'Legal practice management and case handling',
      'AI-assisted legal research and document drafting',
      'Scheduling and calendar management',
      'Billing and financial record keeping',
      'Compliance monitoring and audit trail',
      'Communication between legal professionals',
    ],
    legalBases: ['Consent (GDPR Art.6(1)(a), DPDPA §4)', 'Contract performance (GDPR Art.6(1)(b))', 'Legal obligation (GDPR Art.6(1)(c))', 'Legitimate interest (GDPR Art.6(1)(f))'],
    thirdPartyProcessors: [
      { name: 'OpenAI', purpose: 'AI language model processing', dpaStatus: 'published' },
      { name: 'OpenRouter', purpose: 'AI model routing', dpaStatus: 'published' },
      { name: 'Neon', purpose: 'Database hosting', dpaStatus: 'signed' },
      { name: 'Razorpay', purpose: 'Payment processing', dpaStatus: 'published' },
    ],
    dataSubjectRights: ['Access (Art.15/§11)', 'Rectification (Art.16/§12)', 'Erasure (Art.17/§12)', 'Restriction (Art.18)', 'Portability (Art.20)', 'Object (Art.21)', 'Withdraw consent (Art.7(3)/§6(6))'],
    retentionPeriods: {
      activeCases: '1 year from last activity',
      closedCases: '7 years (legal retention requirement)',
      auditLogs: '7 years (compliance requirement)',
      deletedAccounts: '30 days then permanent erasure',
    },
    crossBorderTransfers: {
      enabled: true,
      mechanisms: ['SCCs', 'Adequacy Decision', 'BCRs'],
      jurisdictions: ['India', 'UK', 'GCC', 'Europe', 'USA', 'Singapore'],
    },
  },
};

export const QUANTUM_CONFIG = {
  enabled: process.env.FEATURE_QUANTUM === 'true',
  mlKemLevel: '512',
  mlDsaLevel: '44',
  zkpCircuit: 'PLONK',
  sphincsPlusVariant: 'shake-256f',
  keyRotationDays: 90,
  auditLogged: true,
};

export const ROMA_L5_CONFIG = {
  enabled: process.env.FEATURE_ROMA_L5 !== 'false',
  maxAgents: 150,
  similarityThreshold: 0.7,
  performanceTrackingEnabled: true,
  selfHealingEnabled: true,
  policyEnforcementEnabled: true,
  adaptiveLearningEnabled: true,
  metricsPath: 'src/data/performance-metrics.json',
  fullRegistryPath: 'src/data/jurexio-full-registry-v3.json',
  deprecationDays: 30,
  hallucinationQuarantineThreshold: 5,
};
