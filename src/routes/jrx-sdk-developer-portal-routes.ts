import { Router, Request, Response } from 'express';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('./jrx-sdk-developer-portal');
const router = Router();

const SDK_VERSION = '5.0.0';
const PLATFORM_VERSION = '3.1.2';

const GETTING_STARTED = {
  title: 'Jurexio Enterprise Platform SDK v5.0.0 — Getting Started',
  version: SDK_VERSION,
  platformVersion: PLATFORM_VERSION,
  overview: 'The Jurexio Enterprise Platform SDK provides programmatic access to India\'s Sovereign Legal AI Operating System. All 5 Jurexio platforms use this SDK as their AI, automation, and intelligence backbone.',
  installation: {
    npm: 'npm install @jurexio/client-sdk @jurexio/types',
    enterprise: 'npm install @jurexio/enterprise-sdk',
    react: 'npm install @jurexio/react-hooks',
  },
  quickstart: {
    step1: 'Register your platform at POST /api/jrx/platforms',
    step2: 'Generate API keys at POST /api/jrx/sdk/keys/{appId}/generate',
    step3: 'Initialize SDK: new JrxClient({ apiKey: "nyv_live_sk_...", baseUrl: "https://api.jurexio.com" })',
    step4: 'Execute patterns: await client.patterns.execute("nyayarag", { task: "...", jurisdiction: "IN" })',
    step5: 'Stream responses: client.stream.pattern("cot", { task: "...", jurisdiction: "IN" })',
  },
  authentication: {
    apiKey: {
      description: 'SDK API Key authentication for platform-to-platform calls',
      header: 'Authorization: Bearer nyv_live_sk_...',
      keyTypes: ['sdk_api_key (nyv_live_sk_*)', 'test_key (nyv_test_sk_*)', 'webhook_secret (nyv_wh_*)', 'publishable_key (nyv_pk_*)'],
    },
    jwt: {
      description: 'JWT authentication for console/dashboard access',
      header: 'Authorization: Bearer <jwt_token>',
      accessTokenExpiry: '15 minutes',
      refreshTokenExpiry: '7 days',
    },
  },
};

const API_REFERENCE = {
  title: 'API Reference — Jurexio Enterprise Platform 3.1.2',
  baseUrl: '/api/jrx',
  categories: [
    {
      name: 'Authentication',
      prefix: '/api/jrx/auth',
      endpoints: [
        { method: 'POST', path: '/login', description: 'User login — returns JWT tokens', auth: 'none' },
        { method: 'POST', path: '/register', description: 'User registration', auth: 'none' },
        { method: 'POST', path: '/refresh-token', description: 'Refresh JWT access token', auth: 'refresh_token' },
        { method: 'POST', path: '/logout', description: 'Invalidate session', auth: 'jwt' },
      ],
    },
    {
      name: 'SDK Gateway',
      prefix: '/api/jrx/gateway',
      endpoints: [
        { method: 'GET', path: '/agents', description: 'List available agents', auth: 'api_key' },
        { method: 'GET', path: '/agents/:id', description: 'Get agent details', auth: 'api_key' },
        { method: 'POST', path: '/research', description: 'Legal research query', auth: 'api_key' },
        { method: 'POST', path: '/translate', description: 'Legal translation (47 languages)', auth: 'api_key' },
        { method: 'POST', path: '/ocr', description: 'Document OCR (22 Indian languages)', auth: 'api_key' },
        { method: 'GET', path: '/practice-areas', description: 'List practice areas', auth: 'api_key' },
        { method: 'POST', path: '/cache/get', description: 'Semantic cache lookup', auth: 'api_key' },
        { method: 'POST', path: '/cache/set', description: 'Semantic cache store', auth: 'api_key' },
        { method: 'POST', path: '/memory/recall', description: 'Memory retrieval', auth: 'api_key' },
        { method: 'POST', path: '/grpo/feedback', description: 'GRPO feedback signal', auth: 'api_key' },
      ],
    },
    {
      name: 'AI Patterns (22 Patterns)',
      prefix: '/api/jrx/patterns',
      endpoints: [
        { method: 'POST', path: '/react', description: 'P01 ReAct — Reason + Act loop', auth: 'jwt', requestBody: '{ task: string, jurisdiction: string }' },
        { method: 'POST', path: '/cot', description: 'P02 Chain-of-Thought — Step-by-step reasoning', auth: 'jwt', requestBody: '{ task: string, jurisdiction: string }' },
        { method: 'POST', path: '/tot', description: 'P03 Tree-of-Thought — Branching reasoning', auth: 'jwt', requestBody: '{ task: string, jurisdiction: string }' },
        { method: 'POST', path: '/reflect', description: 'P04 Reflection — Self-critique + refinement', auth: 'jwt', requestBody: '{ task: string, jurisdiction: string }' },
        { method: 'POST', path: '/plan-exec', description: 'P05 Plan+Execute — Plan then execute', auth: 'jwt', requestBody: '{ task: string, jurisdiction: string }' },
        { method: 'POST', path: '/refine', description: 'P06 Refine — Iterative refinement', auth: 'jwt', requestBody: '{ task: string, jurisdiction: string }' },
        { method: 'POST', path: '/maker-checker', description: 'P07 Maker-Checker — Generate + verify', auth: 'jwt', requestBody: '{ task: string, jurisdiction: string }' },
        { method: 'POST', path: '/tool-retry', description: 'P08 Tool-Retry — Tool call with retry', auth: 'jwt', requestBody: '{ task: string, jurisdiction: string }' },
        { method: 'POST', path: '/function-router', description: 'P09 Function-Router — Route to specialist', auth: 'jwt', requestBody: '{ task: string, jurisdiction: string }' },
        { method: 'POST', path: '/mcp-chain', description: 'P10 MCP-Chain — Multi-tool chain', auth: 'jwt', requestBody: '{ task: string, jurisdiction: string }' },
        { method: 'POST', path: '/nyayarag', description: 'P11 NyayaRAG — Legal RAG with BNS/BNSS/BSA', auth: 'jwt', requestBody: '{ task: string, jurisdiction: string }' },
        { method: 'POST', path: '/graphrag', description: 'P12 GraphRAG — Knowledge graph retrieval', auth: 'jwt', requestBody: '{ task: string, jurisdiction: string }' },
        { method: 'POST', path: '/mem0', description: 'P13 Mem0 — Long-term memory', auth: 'jwt', requestBody: '{ task: string, jurisdiction: string }' },
        { method: 'POST', path: '/semantic-cache', description: 'P14 Semantic-Cache — Cached responses', auth: 'jwt', requestBody: '{ task: string, jurisdiction: string }' },
        { method: 'POST', path: '/hta', description: 'P15 HTA — Hierarchical task analysis', auth: 'jwt', requestBody: '{ task: string, jurisdiction: string }' },
        { method: 'POST', path: '/swarm', description: 'P16 Swarm — Multi-agent swarm', auth: 'jwt', requestBody: '{ task: string, jurisdiction: string }' },
        { method: 'POST', path: '/aconic', description: 'P17 ACONIC — Constraint optimization', auth: 'jwt', requestBody: '{ task: string, jurisdiction: string }' },
        { method: 'POST', path: '/moat', description: 'P18 MOAt — Multi-objective thinking', auth: 'jwt', requestBody: '{ task: string, jurisdiction: string }' },
        { method: 'POST', path: '/adapt', description: 'P19 ADaPT — Adaptive dynamic planning', auth: 'jwt', requestBody: '{ task: string, jurisdiction: string }' },
        { method: 'POST', path: '/computer-use', description: 'P20 Computer-Use — Browser automation', auth: 'jwt', requestBody: '{ task: string, jurisdiction: string }' },
        { method: 'POST', path: '/grpo', description: 'P21 GRPO — Policy optimization', auth: 'jwt', requestBody: '{ task: string, jurisdiction: string }' },
        { method: 'POST', path: '/digital-twin', description: 'P22 Digital-Twin — Persona simulation', auth: 'jwt', requestBody: '{ task: string, jurisdiction: string }' },
        { method: 'GET', path: '/list', description: 'List all 22 patterns with metadata', auth: 'none' },
      ],
    },
    {
      name: 'AG-UI Streaming',
      prefix: '/api/jrx/stream',
      endpoints: [
        { method: 'POST', path: '/:patternId', description: 'Stream AI response (SSE events)', auth: 'jwt' },
      ],
    },
    {
      name: 'Documents',
      prefix: '/api/jrx/documents',
      endpoints: [
        { method: 'POST', path: '/upload', description: 'Upload document', auth: 'jwt' },
        { method: 'POST', path: '/search', description: 'Semantic document search', auth: 'jwt' },
        { method: 'GET', path: '/:docId/status', description: 'Document processing status', auth: 'jwt' },
      ],
    },
    {
      name: 'SDK Document Pipeline',
      prefix: '/api/jrx/sdk/docs-pipeline',
      endpoints: [
        { method: 'POST', path: '/documents/parse', description: 'Parse document', auth: 'jwt' },
        { method: 'POST', path: '/documents/intelligence', description: 'AI document analysis', auth: 'jwt' },
        { method: 'POST', path: '/documents/embeddings', description: 'Generate embeddings', auth: 'jwt' },
        { method: 'POST', path: '/documents/compare', description: 'Compare documents', auth: 'jwt' },
        { method: 'POST', path: '/documents/summarize', description: 'AI summarization', auth: 'jwt' },
        { method: 'POST', path: '/documents/compliance-check', description: 'Compliance analysis', auth: 'jwt' },
      ],
    },
    {
      name: 'Credits & Billing',
      prefix: '/api/jrx/credits',
      endpoints: [
        { method: 'GET', path: '/wallet', description: 'Get credit balance', auth: 'jwt' },
        { method: 'GET', path: '/transactions', description: 'Transaction history', auth: 'jwt' },
        { method: 'POST', path: '/topup', description: 'Top up credits', auth: 'jwt' },
        { method: 'GET', path: '/costs', description: 'Per-tool credit costs', auth: 'jwt' },
      ],
    },
    {
      name: 'Jurisdiction',
      prefix: '/api/jrx/jurisdiction',
      endpoints: [
        { method: 'GET', path: '/stats', description: 'Jurisdiction statistics (public)', auth: 'none' },
        { method: 'GET', path: '/:code/agents', description: 'Agents for jurisdiction', auth: 'jwt' },
        { method: 'GET', path: '/registries', description: 'All jurisdiction registries', auth: 'jwt' },
      ],
    },
    {
      name: 'Compliance',
      prefix: '/api/jrx/compliance',
      endpoints: [
        { method: 'GET', path: '/status', description: 'Compliance framework status', auth: 'jwt' },
        { method: 'GET', path: '/aims/risk-register', description: 'ISO 42001 AI risk register', auth: 'jwt' },
        { method: 'GET', path: '/soc2/evidence', description: 'SOC 2 evidence collection', auth: 'jwt' },
        { method: 'POST', path: '/eu-ai-act/assess', description: 'EU AI Act risk assessment', auth: 'jwt' },
      ],
    },
    {
      name: 'Consent (DPDPA 2023)',
      prefix: '/api/jrx/consent',
      endpoints: [
        { method: 'GET', path: '/purposes', description: 'List consent purposes (public)', auth: 'none' },
        { method: 'POST', path: '/record', description: 'Record user consent', auth: 'jwt' },
        { method: 'GET', path: '/status', description: 'Current consent status', auth: 'jwt' },
      ],
    },
  ],
};

const PLATFORM_QUICKSTARTS = {
  title: 'Platform Integration Quickstart Guides',
  platforms: [
    {
      id: 'jurexio-citizen',
      name: 'Jurexio Citizen — Citizens Legal AI',
      code: 'NYM',
      targetUsers: 'Citizens, Rural India',
      integration: {
        primaryPatterns: ['P01 (ReAct)', 'P11 (NyayaRAG)', 'P02 (CoT)'],
        primaryAgents: ['citizen-legal-advisor', 'rights-awareness-agent', 'legal-aid-navigator'],
        channels: ['WhatsApp (via ClaWdBot)', 'Web Chat', 'Voice (22 Indian languages)'],
        keyFeatures: ['Legal Q&A in 22 languages', 'Rights awareness', 'E-filing assistance', 'Nearest legal aid'],
        sampleCode: `import { JrxClient } from '@jurexio/client-sdk';
const client = new JrxClient({ apiKey: 'nyv_live_sk_...', jurisdiction: 'IN' });
const response = await client.patterns.execute('nyayarag', {
  task: 'What are my rights if I am arrested?',
  language: 'hi',
  jurisdiction: 'IN',
});`,
      },
    },
    {
      id: 'nyayasiddhi-professional',
      name: 'Jurexio Professional™ — Lawyers & Firms',
      code: 'JRX-PRO',
      targetUsers: 'Lawyers, Law Firms',
      integration: {
        primaryPatterns: ['P11 (NyayaRAG)', 'P07 (Maker-Checker)', 'P12 (GraphRAG)', 'P06 (Refine)'],
        primaryAgents: ['senior-litigation-counsel', 'contract-reviewer', 'legal-researcher', 'drafting-specialist'],
        keyFeatures: ['Deep legal research', 'Contract drafting', 'Compliance automation', 'CLM', 'Billing'],
        sampleCode: `const research = await client.patterns.execute('nyayarag', {
  task: 'Find all Supreme Court judgments on Section 138 of NI Act in last 2 years',
  jurisdiction: 'IN',
  depth: 'comprehensive',
});`,
      },
    },
    {
      id: 'nyayasiddhi-institutional',
      name: 'Jurexio Institutional™ — Enterprises',
      code: 'JRX-INS',
      targetUsers: 'Enterprises, Large Firms',
      integration: {
        primaryPatterns: ['P16 (Swarm)', 'P15 (HTA)', 'P18 (MOAt)'],
        primaryAgents: ['chief-legal-officer', 'compliance-specialist', 'risk-assessor'],
        keyFeatures: ['Matter management', 'Firm analytics', 'Multi-tenant billing', 'Regulatory compliance'],
        sampleCode: `import { NyayavignyaEnterpriseClient } from '@jurexio/enterprise-sdk';
const enterprise = new NyayavignyaEnterpriseClient({ apiKey: 'nyv_live_sk_...', orgId: 'org_...' });
const compliance = await enterprise.compliance.getIso42001Summary();`,
      },
    },
    {
      id: 'nyayasiddhi-academy',
      name: 'Jurexio Academy™ — Legal Education',
      code: 'JRX-ACE',
      targetUsers: 'Law Students, CPD',
      integration: {
        primaryPatterns: ['P04 (Reflection)', 'P02 (CoT)', 'P13 (Mem0)'],
        primaryAgents: ['legal-mentor', 'case-summarizer', 'legal-analyst'],
        keyFeatures: ['AI-graded practice exams', 'Mock trials', 'AI tutor', 'Case study analysis'],
      },
    },
    {
      id: 'nyayasiddhi-ministry',
      name: 'Jurexio Ministry™ — Government',
      code: 'JRX-MIN',
      targetUsers: 'Government, Ministries',
      integration: {
        primaryPatterns: ['P19 (ADaPT)', 'P17 (ACONIC)', 'P05 (Plan+Execute)'],
        primaryAgents: ['regulatory-compliance-monitor', 'compliance-specialist'],
        keyFeatures: ['Regulatory monitoring', 'Policy drafting', 'Gazette tracking', 'Parliamentary research'],
      },
    },
  ],
};

const WEBHOOK_SPEC = {
  title: 'Webhook Delivery System',
  version: SDK_VERSION,
  description: 'Receive real-time notifications for async events via HTTPS POST webhooks.',
  configuration: {
    setupEndpoint: 'POST /api/jrx/sdk/keys/{appId}/generate with key_type: "webhook_secret"',
    webhookUrlSetting: 'Set webhook_url in your platform configuration at POST /api/jrx/platforms',
    signatureHeader: 'X-JRX-Signature: HMAC-SHA256 of payload using webhook secret (nyv_wh_*)',
    retryPolicy: '3 attempts with exponential backoff (1s, 5s, 30s)',
    timeout: '10 seconds per delivery attempt',
  },
  events: [
    { event: 'pattern.completed', description: 'AI pattern execution completed', payload: '{ patternId, requestId, status, tokensUsed, cost }' },
    { event: 'document.parsed', description: 'Document parsing completed', payload: '{ documentId, pageCount, format, status }' },
    { event: 'document.embedded', description: 'Document embeddings generated', payload: '{ documentId, chunkCount, vectorDimensions }' },
    { event: 'case.updated', description: 'Case update recorded', payload: '{ caseId, updateType, updatedBy }' },
    { event: 'credit.low', description: 'Credit balance below threshold', payload: '{ walletId, balance, threshold }' },
    { event: 'credit.depleted', description: 'Credit balance zero', payload: '{ walletId }' },
    { event: 'agent.escalated', description: 'Agent escalated to HITL', payload: '{ agentId, reason, sessionId }' },
    { event: 'compliance.alert', description: 'Compliance framework alert', payload: '{ framework, alertType, severity }' },
    { event: 'grpo.policy_updated', description: 'GRPO policy snapshot updated', payload: '{ patternId, snapshotId, rewardScore }' },
    { event: 'workflow.completed', description: 'AutomateAI workflow execution completed', payload: '{ workflowId, executionId, status }' },
  ],
  samplePayload: {
    event: 'pattern.completed',
    timestamp: '2026-04-11T10:30:00Z',
    data: {
      patternId: 'P11',
      requestId: 'req-1234567890-abcdef12',
      status: 'completed',
      tokensUsed: { input: 1200, output: 3500 },
      cost: 0.0042,
      jurisdiction: 'IN',
      model: 'openai/gpt-4.1',
    },
  },
  verificationCode: `import crypto from 'crypto';
function verifyWebhook(payload: string, signature: string, secret: string): boolean {
  const expected = crypto.createHmac('sha256', secret).update(payload).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}`,
};

router.get('/', (_req: Request, res: Response) => {
  res.json({
    title: 'Jurexio Enterprise Platform SDK Developer Portal',
    version: SDK_VERSION,
    platformVersion: PLATFORM_VERSION,
    sections: [
      { name: 'Getting Started', path: '/api/jrx/sdk/developer-portal/getting-started' },
      { name: 'API Reference', path: '/api/jrx/sdk/developer-portal/api-reference' },
      { name: 'Platform Quickstarts', path: '/api/jrx/sdk/developer-portal/quickstarts' },
      { name: 'Webhooks', path: '/api/jrx/sdk/developer-portal/webhooks' },
      { name: 'SDK Packages', path: '/api/jrx/sdk/developer-portal/packages' },
      { name: 'Jurisdictions', path: '/api/jrx/sdk/developer-portal/jurisdictions' },
      { name: 'Patterns', path: '/api/jrx/sdk/developer-portal/patterns' },
      { name: 'Error Codes', path: '/api/jrx/sdk/developer-portal/errors' },
    ],
    contact: {
      email: 'sdk@jurexio.com',
      docs: 'https://docs.jurexio.com',
    },
  });
});

router.get('/getting-started', (_req: Request, res: Response) => {
  res.json(GETTING_STARTED);
});

router.get('/api-reference', (_req: Request, res: Response) => {
  res.json(API_REFERENCE);
});

router.get('/quickstarts', (_req: Request, res: Response) => {
  res.json(PLATFORM_QUICKSTARTS);
});

router.get('/quickstarts/:platformId', (req: Request, res: Response) => {
  const platform = PLATFORM_QUICKSTARTS.platforms.find(p => p.id === req.params.platformId);
  if (!platform) {
    res.status(404).json({ error: `Platform '${req.params.platformId}' not found` });
    return;
  }
  res.json(platform);
});

router.get('/webhooks', (_req: Request, res: Response) => {
  res.json(WEBHOOK_SPEC);
});

router.get('/packages', (_req: Request, res: Response) => {
  res.json({
    title: 'SDK Packages',
    packages: [
      {
        name: '@jurexio/client-sdk',
        version: '3.1.2',
        description: 'Core TypeScript SDK for all platform integrations',
        install: 'npm install @jurexio/client-sdk',
        exports: ['JrxClient', 'JrxStreamReader', 'PatternsAPI', 'DocumentsAPI', 'AgentsAPI', 'TwinsAPI', 'IntelligenceAPI', 'MemoryAPI', 'CacheAPI'],
        size: '~45KB minified',
      },
      {
        name: '@jurexio/enterprise-sdk',
        version: '3.1.2',
        description: 'Enterprise features — compliance, billing, org management, white-label',
        install: 'npm install @jurexio/enterprise-sdk',
        exports: ['NyayavignyaEnterpriseClient', 'ComplianceClient', 'BillingClient', 'OrgManagementClient'],
        peerDependency: '@jurexio/client-sdk ^3.1.2',
      },
      {
        name: '@jurexio/react-hooks',
        version: '3.1.2',
        description: 'React hooks for legal AI UI components',
        install: 'npm install @jurexio/react-hooks',
        exports: ['useJrxClient', 'usePatternStream', 'useCredits', 'useGovernanceBadge', 'useJurisdiction', 'useAuditLog'],
        peerDependency: 'react >=18.0.0',
      },
      {
        name: '@jurexio/types',
        version: '3.1.2',
        description: 'Shared TypeScript types for all SDKs and platforms',
        install: 'npm install @jurexio/types',
        exports: ['JrxJurisdiction', 'JrxSubscriptionTier', 'JrxPatternKey', 'JrxTemplateMode', 'JrxCreditTransaction', 'JrxAiMetadata'],
      },
    ],
  });
});

router.get('/jurisdictions', (_req: Request, res: Response) => {
  res.json({
    title: 'Supported Jurisdictions',
    jurisdictions: [
      { code: 'IN', name: 'India', currency: 'INR', agents: 148, statutes: 'BNS 2023, BNSS 2023, BSA 2023, Companies Act 2013, GST Act 2017' },
      { code: 'UK', name: 'United Kingdom', currency: 'GBP', agents: 148, statutes: 'GDPR/UK GDPR, Companies Act 2006, FCA regulations' },
      { code: 'US', name: 'United States', currency: 'USD', agents: 148, statutes: 'Federal Constitution, UCC, ERISA, Sherman Act, CCPA' },
      { code: 'EU', name: 'European Union', currency: 'EUR', agents: 148, statutes: 'GDPR, AI Act 2024, Digital Markets Act, CSRD' },
      { code: 'GC', name: 'Gulf Cooperation Council', currency: 'AED/SAR', agents: 148, statutes: 'UAE Commercial, Saudi Labour, Islamic Finance' },
      { code: 'SG', name: 'Singapore', currency: 'SGD', agents: 148, statutes: 'PDPA 2012, Companies Act, SIAC Arbitration' },
    ],
    total: { agents: 888, jurisdictions: 6 },
  });
});

router.get('/patterns', (_req: Request, res: Response) => {
  res.json({
    title: '22 Agentic Patterns',
    endpoint: 'POST /api/jrx/patterns/{patternId}',
    streamEndpoint: 'POST /api/jrx/stream/{patternId}',
    patterns: [
      { id: 'P01', name: 'ReAct', description: 'Reason + Act loop', complexity: 'medium' },
      { id: 'P02', name: 'Chain-of-Thought', description: 'Step-by-step reasoning', complexity: 'medium' },
      { id: 'P03', name: 'Tree-of-Thought', description: 'Branching reasoning tree', complexity: 'high' },
      { id: 'P04', name: 'Reflection', description: 'Self-critique + refinement', complexity: 'high' },
      { id: 'P05', name: 'Plan+Execute', description: 'Plan then execute', complexity: 'high' },
      { id: 'P06', name: 'Refine', description: 'Iterative refinement', complexity: 'medium' },
      { id: 'P07', name: 'Maker-Checker', description: 'Generate + verify', complexity: 'medium' },
      { id: 'P08', name: 'Tool-Retry', description: 'Tool call with retry', complexity: 'low' },
      { id: 'P09', name: 'Function-Router', description: 'Route to specialist', complexity: 'medium' },
      { id: 'P10', name: 'MCP-Chain', description: 'Multi-tool chain', complexity: 'high' },
      { id: 'P11', name: 'NyayaRAG', description: 'Legal RAG with BNS/BNSS/BSA', complexity: 'high' },
      { id: 'P12', name: 'GraphRAG', description: 'Knowledge graph retrieval', complexity: 'high' },
      { id: 'P13', name: 'Mem0', description: 'Long-term memory', complexity: 'medium' },
      { id: 'P14', name: 'Semantic-Cache', description: 'Cached responses', complexity: 'low' },
      { id: 'P15', name: 'HTA', description: 'Hierarchical task analysis', complexity: 'high' },
      { id: 'P16', name: 'Swarm', description: 'Multi-agent swarm', complexity: 'high' },
      { id: 'P17', name: 'ACONIC', description: 'Constraint optimization', complexity: 'high' },
      { id: 'P18', name: 'MOAt', description: 'Multi-objective thinking', complexity: 'high' },
      { id: 'P19', name: 'ADaPT', description: 'Adaptive planning', complexity: 'high' },
      { id: 'P20', name: 'Computer-Use', description: 'Browser automation', complexity: 'high' },
      { id: 'P21', name: 'GRPO', description: 'Policy optimization', complexity: 'high' },
      { id: 'P22', name: 'Digital-Twin', description: 'Persona simulation', complexity: 'high' },
    ],
    requestSchema: {
      task: 'string (required) — The legal query or task',
      jurisdiction: 'string (required) — IN, UK, US, EU, GC, SG',
      templateMode: 'string (optional) — STRICT, GUIDED, MENTOR',
      maxTokens: 'number (optional) — Max output tokens (default: 4096)',
      stream: 'boolean (optional) — Enable SSE streaming',
    },
  });
});

router.get('/errors', (_req: Request, res: Response) => {
  res.json({
    title: 'Error Codes',
    errors: [
      { code: 400, name: 'Bad Request', description: 'Invalid request body or parameters' },
      { code: 401, name: 'Unauthorized', description: 'Missing or invalid authentication' },
      { code: 402, name: 'Payment Required', description: 'Insufficient credits — top up wallet' },
      { code: 403, name: 'Forbidden', description: 'Insufficient permissions for this resource' },
      { code: 404, name: 'Not Found', description: 'Resource does not exist' },
      { code: 429, name: 'Too Many Requests', description: 'Rate limit exceeded — check X-RateLimit headers' },
      { code: 500, name: 'Internal Server Error', description: 'Platform error — contact support' },
      { code: 503, name: 'Service Unavailable', description: 'LLM provider temporarily unavailable — retry' },
    ],
    format: {
      error: 'string — Error message',
      code: 'string — JRX error code (e.g., JRX-401, JRX-402)',
      details: 'object (optional) — Additional error context',
    },
  });
});

logger.info('[SDK-DevPortal] Developer portal routes initialized');

export default router;
