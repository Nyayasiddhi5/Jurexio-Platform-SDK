import { useState, useCallback, useMemo } from 'react';
import { getAuthToken } from '@/lib/jrx-auth-token';
import {
  Send, Copy, ChevronDown, ChevronRight, Eye, EyeOff, Search,
  Code, Globe, Shield, FileText, Bot, DollarSign, Languages, Scan,
  BarChart3, Zap, Clock, CheckCircle, XCircle, Loader2, Key, Play,
  RefreshCw, Terminal, History, Trash2, Plus, Minus, ClipboardCopy
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/hooks/use-toast';

import { nv } from '@/lib/jrx-api-paths';
import { ExecutionTraceRail } from '@/components/execution/ExecutionTraceRail';
import { rememberLegalRun } from '@/services/jrx-legal-last-runs';
interface EndpointDef {
  method: string;
  path: string;
  name: string;
  pathParams?: string[];
  sampleBody?: Record<string, any>;
}

interface EndpointCategory {
  name: string;
  icon: React.ReactNode;
  endpoints: EndpointDef[];
}

interface ResponseData {
  status: number;
  statusText: string;
  body: any;
  headers: Record<string, string>;
  time: number;
  size: number;
}

interface HeaderEntry {
  key: string;
  value: string;
  enabled: boolean;
}

interface HistoryEntry {
  id: string;
  method: string;
  path: string;
  name: string;
  status: number;
  time: number;
  timestamp: Date;
}

const ENDPOINT_CATALOG: EndpointCategory[] = [
  {
    name: 'Core',
    icon: <Terminal className="h-4 w-4" />,
    endpoints: [
      { method: 'GET', path: nv('gateway/info'), name: 'Platform info' },
      { method: 'GET', path: nv('health'), name: 'Health check' },
      { method: 'GET', path: nv('agents'), name: 'List agents (1037 total)', sampleBody: { jurisdiction: 'India', practiceArea: 'civil', limit: 10, offset: 0 } },
      { method: 'GET', path: nv('agents/:agentId'), name: 'Get agent details', pathParams: ['agentId'] },
      { method: 'GET', path: nv('jurisdiction'), name: 'List jurisdictions (6)' },
      { method: 'GET', path: nv('jurisdiction/registries/stats'), name: 'Jurisdiction registry stats (888 agents)' },
      { method: 'GET', path: nv('jurisdiction/registries/agents'), name: 'All jurisdiction agents' },
      { method: 'GET', path: nv('jurisdiction/:code/agents'), name: 'Agents by jurisdiction (148 each)', pathParams: ['code'] },
      { method: 'GET', path: nv('jurisdiction/:code/agents/:agentId'), name: 'Jurisdiction agent detail', pathParams: ['code', 'agentId'] },
      { method: 'POST', path: nv('jurisdiction/resolve-agent'), name: 'Resolve agent by capability', sampleBody: { agentId: 'contract-specialist', jurisdictionCode: 'IN', capability: 'contract-analysis' } },
      { method: 'GET', path: nv('gateway/practice-areas'), name: 'List practice areas' },
    ],
  },
  {
    name: 'Legal Research',
    icon: <FileText className="h-4 w-4" />,
    endpoints: [
      { method: 'POST', path: nv('gateway/research/query'), name: 'Legal research query', sampleBody: { query: 'What are the grounds for divorce under Hindu Marriage Act?', jurisdiction: 'India', options: {} } },
      { method: 'POST', path: nv('gateway/research/precedent'), name: 'Precedent search', sampleBody: { caseReference: 'Vishaka v State of Rajasthan', jurisdiction: 'India' } },
      { method: 'POST', path: nv('gateway/research/statute'), name: 'Statute lookup', sampleBody: { statute: 'Indian Penal Code', section: '302', jurisdiction: 'India' } },
    ],
  },
  {
    name: 'Instant Search & Legal Feed',
    icon: <Search className="h-4 w-4" />,
    endpoints: [
      { method: 'GET', path: nv('knowledge/statutes/search') + '?q=BNS%20103&jurisdiction=IN&limit=8', name: 'Instant Search — statutes (SDK instantSearch.statutes)' },
      { method: 'GET', path: nv('knowledge/caselaw/search') + '?q=bail&jurisdiction=IN&limit=8&mode=fts', name: 'Instant Search — caselaw FTS (SDK instantSearch.caselaw)' },
      { method: 'GET', path: nv('knowledge/caselaw/search') + '?q=anticipatory+bail&jurisdiction=IN&limit=5&mode=fts&courtType=hc&yearFrom=2023&yearTo=2026', name: 'Caselaw — HC FTS recent (2023–2026)' },
      { method: 'POST', path: nv('knowledge/search'), name: 'Auto-RAG federated search (legal_intel_feed layer)', sampleBody: { query: 'anticipatory bail leading authorities', jurisdiction: 'IN', taskType: 'research', limit: 8 } },
      { method: 'GET', path: nv('knowledge/statutes/acts') + '?jurisdiction=IN', name: 'Statute acts catalog' },
      { method: 'POST', path: nv('knowledge/retrieve'), name: 'Knowledge retrieve', sampleBody: { query: 'anticipatory bail under BNSS', jurisdiction: 'IN', limit: 5 } },
      { method: 'GET', path: nv('v1/sdk/legal-intelligence/feed') + '?jurisdiction=IN', name: 'Live Legal Feed digest (getLegalFeed)' },
      { method: 'GET', path: nv('v1/sdk/legal-intelligence/feed/history') + '?jurisdiction=IN&limit=10', name: 'Legal Feed history' },
      { method: 'POST', path: nv('v1/sdk/legal-intelligence/feed/generate'), name: 'Generate Legal Feed digest', sampleBody: { jurisdiction: 'IN', topN: 10 } },
      { method: 'GET', path: nv('intelligence/regulatory-feed') + '?jurisdiction=IN&limit=20', name: 'Own regulatory feed (getRegulatoryFeed)' },
    ],
  },
  {
    name: 'Documents',
    icon: <FileText className="h-4 w-4" />,
    endpoints: [
      { method: 'POST', path: nv('sdk/docs-pipeline/documents/parse'), name: 'Parse document', sampleBody: { content: 'This agreement is entered into by and between...', format: 'text' } },
      { method: 'POST', path: nv('sdk/docs-pipeline/documents/intelligence'), name: 'Document intelligence', sampleBody: { content: 'This agreement is entered into by and between...', analysisType: 'risk', jurisdiction: 'India' } },
      { method: 'POST', path: nv('sdk/docs-pipeline/documents/summarize'), name: 'Summarize', sampleBody: { content: 'This agreement is entered into by and between...', style: 'brief' } },
      { method: 'POST', path: nv('sdk/docs-pipeline/documents/embeddings'), name: 'Generate embeddings', sampleBody: { content: 'Legal text to embed...', model: 'text-embedding-3-small' } },
      { method: 'POST', path: nv('sdk/docs-pipeline/documents/compare'), name: 'Compare docs', sampleBody: { document1: 'First document content...', document2: 'Second document content...' } },
      { method: 'POST', path: nv('sdk/docs-pipeline/documents/compliance-check'), name: 'Compliance check', sampleBody: { content: 'Document text...', frameworks: ['GDPR', 'DPDP'], jurisdiction: 'IN' } },
      { method: 'GET', path: nv('sdk/docs-pipeline/documents/templates'), name: 'List templates' },
      { method: 'GET', path: nv('sdk/docs-pipeline/clauses/library'), name: 'Clause library' },
      { method: 'GET', path: nv('sdk/docs-pipeline/clauses/:clauseId'), name: 'Get clause detail', pathParams: ['clauseId'] },
      { method: 'POST', path: nv('sdk/docs-pipeline/clauses/suggest'), name: 'Clause suggestions', sampleBody: { context: 'employment agreement', jurisdiction: 'IN', clauseType: 'termination' } },
    ],
  },
  {
    name: 'Agent Execution',
    icon: <Bot className="h-4 w-4" />,
    endpoints: [
      { method: 'POST', path: nv('gateway/agents/:agentId/execute'), name: 'Execute agent', pathParams: ['agentId'], sampleBody: { input: 'Analyze this legal scenario...', context: {}, options: {} } },
      { method: 'GET', path: nv('gateway/agents/:agentId/compliance'), name: 'Get agent compliance status', pathParams: ['agentId'] },
    ],
  },
  {
    name: 'Translation',
    icon: <Languages className="h-4 w-4" />,
    endpoints: [
      { method: 'POST', path: nv('gateway/translate'), name: 'Translate text', sampleBody: { text: 'The court has ruled in favor of the plaintiff.', sourceLang: 'en', targetLang: 'hi' } },
      { method: 'POST', path: nv('gateway/translate/batch'), name: 'Batch translate', sampleBody: { texts: ['Hello', 'How are you?'], sourceLang: 'en', targetLang: 'hi' } },
      { method: 'POST', path: nv('gateway/translate/detect-language'), name: 'Detect language', sampleBody: { text: 'यह एक हिंदी वाक्य है' } },
      { method: 'POST', path: nv('gateway/translate/transliterate'), name: 'Transliterate', sampleBody: { text: 'namaste', sourceLang: 'en', targetLang: 'hi' } },
      { method: 'GET', path: nv('gateway/translate/languages'), name: 'List languages' },
      { method: 'GET', path: nv('gateway/translate/stats'), name: 'Translation stats' },
    ],
  },
  {
    name: 'OCR & Vision',
    icon: <Scan className="h-4 w-4" />,
    endpoints: [
      { method: 'POST', path: nv('gateway/ocr/process'), name: 'Process document OCR', sampleBody: { imageUrl: 'https://example.com/document.png', language: 'en' } },
      { method: 'POST', path: nv('gateway/ocr/jobs'), name: 'Create OCR job', sampleBody: { imageUrl: 'https://example.com/document.png', language: 'en' } },
      { method: 'GET', path: nv('gateway/ocr/jobs/:jobId'), name: 'Get OCR job status', pathParams: ['jobId'] },
      { method: 'GET', path: nv('gateway/ocr/stats'), name: 'OCR stats' },
    ],
  },
  {
    name: 'Payments',
    icon: <DollarSign className="h-4 w-4" />,
    endpoints: [
      { method: 'POST', path: nv('payments/orders'), name: 'Create order', sampleBody: { amount: 1000, currency: 'INR', description: 'API usage credits' } },
      { method: 'GET', path: nv('payments/orders/:orderId'), name: 'Get order', pathParams: ['orderId'] },
      { method: 'POST', path: nv('payments/capture'), name: 'Capture payment', sampleBody: { paymentId: 'pay_xxx', amount: 1000 } },
      { method: 'POST', path: nv('payments/refund'), name: 'Refund payment', sampleBody: { paymentId: 'pay_xxx', amount: 500, reason: 'Customer request' } },
      { method: 'POST', path: nv('payments/customers'), name: 'Create customer', sampleBody: { name: 'John Doe', email: 'john@example.com', contact: '+919876543210' } },
      { method: 'POST', path: nv('payments/invoices'), name: 'Create invoice', sampleBody: { customerId: 'cust_xxx', amount: 5000, description: 'Monthly subscription' } },
      { method: 'POST', path: nv('payments/payment-links'), name: 'Create payment link', sampleBody: { amount: 2000, currency: 'INR', description: 'Service payment' } },
      { method: 'POST', path: nv('payments/subscriptions/plans'), name: 'Create plan', sampleBody: { name: 'Pro Plan', amount: 999, currency: 'INR', interval: 'monthly' } },
      { method: 'POST', path: nv('payments/subscriptions'), name: 'Create subscription', sampleBody: { planId: 'plan_xxx', customerId: 'cust_xxx' } },
      { method: 'GET', path: nv('payments/subscriptions/:subscriptionId'), name: 'Get subscription', pathParams: ['subscriptionId'] },
      { method: 'DELETE', path: nv('payments/subscriptions/:subscriptionId'), name: 'Cancel subscription', pathParams: ['subscriptionId'] },
      { method: 'POST', path: nv('payments/webhooks/verify'), name: 'Verify webhook', sampleBody: { payload: '{}', signature: 'xxx' } },
      { method: 'GET', path: nv('payments/tiers'), name: 'Get pricing tiers' },
      { method: 'GET', path: nv('payments/stats'), name: 'Payment stats' },
    ],
  },
  {
    name: 'Memory (Mem0)',
    icon: <Globe className="h-4 w-4" />,
    endpoints: [
      { method: 'POST', path: nv('gateway/memory/store'), name: 'Store memory', sampleBody: { agentId: 'agent_001', key: 'context', value: 'User prefers formal language', namespace: 'preferences' } },
      { method: 'POST', path: nv('gateway/memory/recall'), name: 'Recall memory', sampleBody: { agentId: 'agent_001', query: 'user preferences', namespace: 'preferences' } },
      { method: 'POST', path: nv('gateway/memory/consolidate'), name: 'Consolidate memory', sampleBody: { agentId: 'agent_001' } },
      { method: 'POST', path: nv('gateway/memory/reinforce'), name: 'Reinforce memory', sampleBody: { agentId: 'agent_001', memoryId: 'mem_001' } },
      { method: 'POST', path: nv('gateway/memory/session'), name: 'Create session', sampleBody: { agentId: 'agent_001', sessionId: 'session_001' } },
      { method: 'GET', path: nv('gateway/memory/context/:agentId'), name: 'Get context', pathParams: ['agentId'] },
      { method: 'GET', path: nv('gateway/memory/stats'), name: 'Memory stats' },
      { method: 'DELETE', path: nv('gateway/memory/agent/:agentId'), name: 'Clear agent memory', pathParams: ['agentId'] },
    ],
  },
  {
    name: 'Cache (LMCache)',
    icon: <Zap className="h-4 w-4" />,
    endpoints: [
      { method: 'POST', path: nv('gateway/cache/lookup'), name: 'Cache lookup', sampleBody: { query: 'What is IPC Section 302?', jurisdiction: 'India' } },
      { method: 'POST', path: nv('gateway/cache/store'), name: 'Cache store', sampleBody: { query: 'What is IPC Section 302?', response: 'Section 302 deals with...', ttl: 3600 } },
      { method: 'POST', path: nv('gateway/cache/invalidate'), name: 'Invalidate cache', sampleBody: { pattern: 'IPC*' } },
      { method: 'POST', path: nv('gateway/cache/warm'), name: 'Warm cache', sampleBody: { queries: ['IPC 302', 'CrPC 144'] } },
      { method: 'POST', path: nv('gateway/cache/flush'), name: 'Flush cache', sampleBody: { tier: 'hot' } },
      { method: 'GET', path: nv('gateway/cache/stats'), name: 'Cache stats' },
    ],
  },
  {
    name: 'GRPO Optimization',
    icon: <Zap className="h-4 w-4" />,
    endpoints: [
      { method: 'POST', path: nv('gateway/optimization/grpo/evaluate'), name: 'Evaluate responses', sampleBody: { responses: ['Response A', 'Response B'], query: 'Legal analysis of...' } },
      { method: 'POST', path: nv('gateway/optimization/grpo/generate-evaluate'), name: 'Generate & evaluate', sampleBody: { prompt: 'Analyze this legal scenario...', groupSize: 4 } },
      { method: 'POST', path: nv('gateway/optimization/grpo/optimize'), name: 'Optimize policy', sampleBody: { agentId: 'agent_001' } },
      { method: 'POST', path: nv('gateway/optimization/grpo/preferences'), name: 'Record preferences', sampleBody: { preferred: 'Response A', rejected: 'Response B', query: 'test' } },
      { method: 'GET', path: nv('gateway/optimization/grpo/stats'), name: 'GRPO stats' },
      { method: 'GET', path: nv('gateway/optimization/grpo/policy'), name: 'Current policy' },
      { method: 'GET', path: nv('gateway/optimization/grpo/dimensions'), name: 'Reward dimensions' },
    ],
  },
  {
    name: 'Verbalized Sampling',
    icon: <Code className="h-4 w-4" />,
    endpoints: [
      { method: 'POST', path: nv('gateway/sampling/verbalize'), name: 'Verbalize sampling', sampleBody: { query: 'What are the penalties under Section 138 NI Act?', options: 5 } },
      { method: 'POST', path: nv('gateway/sampling/analyze'), name: 'Analyze samples', sampleBody: { samples: ['Sample 1', 'Sample 2'] } },
      { method: 'POST', path: nv('gateway/sampling/calibrate'), name: 'Calibrate', sampleBody: { feedback: [{ sampleId: '1', score: 0.9 }] } },
      { method: 'POST', path: nv('gateway/sampling/chain-of-thought'), name: 'Chain of thought', sampleBody: { query: 'Step by step analysis of contract breach', steps: 5 } },
      { method: 'GET', path: nv('gateway/sampling/stats'), name: 'Sampling stats' },
      { method: 'GET', path: nv('gateway/sampling/vocabulary'), name: 'Vocabulary' },
    ],
  },
  {
    name: 'Self-Healing ML',
    icon: <Shield className="h-4 w-4" />,
    endpoints: [
      { method: 'POST', path: nv('gateway/healing/register'), name: 'Register service', sampleBody: { serviceId: 'svc_001', name: 'Legal Research', healthEndpoint: '/health' } },
      { method: 'POST', path: nv('gateway/healing/report-failure'), name: 'Report failure', sampleBody: { serviceId: 'svc_001', error: 'Timeout', context: {} } },
      { method: 'POST', path: nv('gateway/healing/report-success'), name: 'Report success', sampleBody: { serviceId: 'svc_001', latency: 150 } },
      { method: 'POST', path: nv('gateway/healing/reset-breaker'), name: 'Reset circuit breaker', sampleBody: { serviceId: 'svc_001' } },
      { method: 'GET', path: nv('gateway/healing/health'), name: 'Healing health' },
      { method: 'GET', path: nv('gateway/healing/stats'), name: 'Healing stats' },
      { method: 'GET', path: nv('gateway/healing/failures'), name: 'Recent failures' },
      { method: 'GET', path: nv('gateway/healing/circuit-breakers'), name: 'Circuit breakers' },
    ],
  },
  {
    name: 'Usage & Analytics',
    icon: <BarChart3 className="h-4 w-4" />,
    endpoints: [
      { method: 'GET', path: nv('sdk/analytics/usage'), name: 'Usage statistics' },
      { method: 'GET', path: nv('sdk/analytics/usage/tokens'), name: 'Token usage' },
      { method: 'GET', path: nv('sdk/analytics/usage/costs'), name: 'Cost breakdown' },
      { method: 'GET', path: nv('gateway/guardrails/stats'), name: 'Guardrail stats' },
    ],
  },
  {
    name: 'Financial Data',
    icon: <DollarSign className="h-4 w-4" />,
    endpoints: [
      { method: 'GET', path: nv('sdk/enterprise/financial/quote/:symbol'), name: 'Stock quote', pathParams: ['symbol'] },
      { method: 'GET', path: nv('sdk/enterprise/financial/historical/:symbol'), name: 'Historical data', pathParams: ['symbol'] },
      { method: 'GET', path: nv('sdk/enterprise/financial/fundamentals/:symbol'), name: 'Fundamentals', pathParams: ['symbol'] },
      { method: 'GET', path: nv('sdk/enterprise/financial/search'), name: 'Search stocks' },
      { method: 'GET', path: nv('sdk/enterprise/financial/stats'), name: 'Financial stats' },
    ],
  },
  {
    name: 'Code Review',
    icon: <Code className="h-4 w-4" />,
    endpoints: [
      { method: 'POST', path: nv('sdk/enterprise/code-review/analyze'), name: 'Analyze code', sampleBody: { code: 'function add(a, b) { return a + b; }', language: 'javascript' } },
      { method: 'GET', path: nv('sdk/enterprise/code-review/stats'), name: 'Code review stats' },
    ],
  },
  {
    name: 'Domain Research',
    icon: <Globe className="h-4 w-4" />,
    endpoints: [
      { method: 'POST', path: nv('sdk/enterprise/research/domain/legal'), name: 'Legal research', sampleBody: { query: 'recent Supreme Court judgments on privacy', jurisdiction: 'India' } },
      { method: 'POST', path: nv('sdk/enterprise/research/domain/academic'), name: 'Academic research', sampleBody: { query: 'AI in legal reasoning', limit: 10 } },
      { method: 'POST', path: nv('sdk/enterprise/research/domain/patents'), name: 'Patent search', sampleBody: { query: 'natural language processing legal', jurisdiction: 'US' } },
      { method: 'POST', path: nv('sdk/enterprise/research/domain/medical'), name: 'Medical research', sampleBody: { query: 'medical malpractice evidence standards' } },
      { method: 'POST', path: nv('sdk/enterprise/research/domain/synthesize'), name: 'Research synthesis', sampleBody: { query: 'comparative analysis of data privacy laws', domains: ['legal', 'academic'] } },
    ],
  },
  {
    name: 'Investment Research',
    icon: <BarChart3 className="h-4 w-4" />,
    endpoints: [
      { method: 'POST', path: nv('sdk/enterprise/research/investment/analyze'), name: 'Investment analysis', sampleBody: { company: 'Reliance Industries', analysisType: 'fundamental' } },
      { method: 'POST', path: nv('sdk/enterprise/research/investment/filings'), name: 'SEC filings', sampleBody: { company: 'Apple Inc', filingType: '10-K' } },
      { method: 'POST', path: nv('sdk/enterprise/research/investment/market-trends'), name: 'Market trends', sampleBody: { sector: 'technology', region: 'India' } },
    ],
  },
  {
    name: 'Visual Analytics',
    icon: <BarChart3 className="h-4 w-4" />,
    endpoints: [
      { method: 'POST', path: nv('sdk/enterprise/analytics/visual/chart'), name: 'Create chart', sampleBody: { type: 'bar', title: 'Revenue', data: { labels: ['Q1', 'Q2'], values: [100, 200] } } },
      { method: 'POST', path: nv('sdk/enterprise/analytics/visual/dashboard'), name: 'Create dashboard', sampleBody: { name: 'Legal Ops', widgets: [{ type: 'kpi', metric: 'cases_resolved' }] } },
      { method: 'GET', path: nv('sdk/enterprise/analytics/visual/stats'), name: 'Visual analytics stats' },
    ],
  },
  {
    name: 'Content Assets',
    icon: <FileText className="h-4 w-4" />,
    endpoints: [
      { method: 'POST', path: nv('sdk/enterprise/assets/upload'), name: 'Upload asset', sampleBody: { name: 'contract.pdf', type: 'document', content: 'base64...' } },
      { method: 'GET', path: nv('sdk/enterprise/assets'), name: 'List assets' },
      { method: 'GET', path: nv('sdk/enterprise/assets/:assetId'), name: 'Get asset', pathParams: ['assetId'] },
      { method: 'DELETE', path: nv('sdk/enterprise/assets/:assetId'), name: 'Delete asset', pathParams: ['assetId'] },
      { method: 'GET', path: nv('sdk/enterprise/assets/stats'), name: 'Asset stats' },
    ],
  },
  {
    name: 'Web Search',
    icon: <Search className="h-4 w-4" />,
    endpoints: [
      { method: 'POST', path: nv('sdk/enterprise/search/web'), name: 'Web search', sampleBody: { query: 'latest legal tech trends 2026' } },
      { method: 'GET', path: nv('sdk/enterprise/search/stats'), name: 'Search stats' },
    ],
  },
  {
    name: 'Protocols (A2A)',
    icon: <Globe className="h-4 w-4" />,
    endpoints: [
      { method: 'POST', path: nv('sdk/workflows/protocols/a2a/task'), name: 'Create A2A task', sampleBody: { taskType: 'legal_research', payload: { query: 'Contract law analysis' }, targetAgent: 'agent_001' } },
      { method: 'GET', path: nv('sdk/workflows/protocols/a2a/task/:taskId'), name: 'Get A2A task', pathParams: ['taskId'] },
      { method: 'GET', path: nv('sdk/workflows/protocols/a2a/stats'), name: 'A2A stats' },
    ],
  },
  {
    name: 'Workflows',
    icon: <Zap className="h-4 w-4" />,
    endpoints: [
      { method: 'POST', path: nv('sdk/workflows/schedule'), name: 'Schedule workflow', sampleBody: { name: 'Daily Report', cron: '0 9 * * *', action: 'generate_report', params: {} } },
      { method: 'GET', path: nv('sdk/workflows/:workflowId'), name: 'Get workflow', pathParams: ['workflowId'] },
      { method: 'DELETE', path: nv('sdk/workflows/:workflowId'), name: 'Delete workflow', pathParams: ['workflowId'] },
      { method: 'GET', path: nv('sdk/workflows/stats'), name: 'Workflow stats' },
    ],
  },
  {
    name: 'Advanced Analytics',
    icon: <BarChart3 className="h-4 w-4" />,
    endpoints: [
      { method: 'POST', path: nv('sdk/analytics/predict'), name: 'Predictive analytics', sampleBody: { metric: 'case_outcome', features: { caseType: 'civil', jurisdiction: 'India' } } },
      { method: 'POST', path: nv('sdk/analytics/cost/estimate'), name: 'Cost estimation', sampleBody: { model: 'gpt-4o', inputTokens: 1000, outputTokens: 500 } },
      { method: 'GET', path: nv('sdk/analytics/cost/stats'), name: 'Cost stats' },
      { method: 'POST', path: nv('sdk/analytics/advanced/query'), name: 'Advanced query', sampleBody: { metric: 'agent_performance', filters: { timeRange: '30d' } } },
      { method: 'GET', path: nv('sdk/analytics/advanced/dashboard'), name: 'Analytics dashboard' },
      { method: 'POST', path: nv('sdk/analytics/optimize'), name: 'Cost optimization', sampleBody: { targetBudget: 1000, optimizationGoal: 'cost_reduction' } },
      { method: 'GET', path: nv('sdk/analytics/optimize/stats'), name: 'Optimization stats' },
    ],
  },
  {
    name: 'Multimodal & Voice',
    icon: <Globe className="h-4 w-4" />,
    endpoints: [
      { method: 'POST', path: nv('sdk/multimodal/vision'), name: 'Vision analysis', sampleBody: { imageUrl: 'https://example.com/document.png', prompt: 'Extract text and structure' } },
      { method: 'POST', path: nv('sdk/multimodal/video-script'), name: 'Video script', sampleBody: { topic: 'Contract law basics', duration: 120, style: 'educational' } },
      { method: 'POST', path: nv('sdk/multimodal/3d-visualization'), name: '3D visualization', sampleBody: { dataType: 'case_network', caseIds: ['case_001', 'case_002'] } },
      { method: 'POST', path: nv('sdk/multimodal/avatar-session'), name: 'Avatar session', sampleBody: { agentId: 'agent_001', mode: 'interactive' } },
      { method: 'POST', path: nv('sdk/multimodal/rag'), name: 'Multimodal RAG', sampleBody: { query: 'Find relevant precedents', sources: ['text', 'image'], jurisdiction: 'IN' } },
      { method: 'GET', path: nv('sdk/multimodal/capabilities'), name: 'List capabilities' },
      { method: 'POST', path: nv('sdk/multimodal/voice/tts'), name: 'Text to speech', sampleBody: { text: 'The court hereby orders...', language: 'en', voice: 'professional' } },
      { method: 'POST', path: nv('sdk/multimodal/voice/stt'), name: 'Speech to text', sampleBody: { audioUrl: 'https://example.com/audio.wav', language: 'en' } },
      { method: 'POST', path: nv('sdk/multimodal/voice/stream'), name: 'Voice streaming', sampleBody: { sessionId: 'vs_001', mode: 'bidirectional' } },
      { method: 'POST', path: nv('sdk/multimodal/voice/voiceover'), name: 'Voiceover', sampleBody: { script: 'Legal summary text...', voice: 'professional', language: 'en' } },
      { method: 'GET', path: nv('sdk/multimodal/voice/voices'), name: 'List voices' },
    ],
  },
  {
    name: 'Workflows & Protocols',
    icon: <Zap className="h-4 w-4" />,
    endpoints: [
      { method: 'POST', path: nv('sdk/workflows'), name: 'Create workflow', sampleBody: { name: 'Contract Review', steps: [{ type: 'parse', config: {} }, { type: 'analyze', config: {} }] } },
      { method: 'POST', path: nv('sdk/workflows/:workflowId/execute'), name: 'Execute workflow', pathParams: ['workflowId'], sampleBody: { input: { document: 'Contract text...' } } },
      { method: 'GET', path: nv('sdk/workflows'), name: 'List workflows' },
      { method: 'POST', path: nv('sdk/workflows/:workflowId/schedule'), name: 'Schedule workflow', pathParams: ['workflowId'], sampleBody: { cron: '0 9 * * 1', timezone: 'Asia/Kolkata' } },
      { method: 'DELETE', path: nv('sdk/workflows/:workflowId'), name: 'Delete workflow', pathParams: ['workflowId'] },
      { method: 'POST', path: nv('sdk/workflows/autonomous'), name: 'Autonomous execution', sampleBody: { goal: 'Review all pending contracts', constraints: { maxSteps: 10 } } },
      { method: 'GET', path: nv('sdk/workflows/protocols/ag-ui/events'), name: 'AG-UI events' },
      { method: 'GET', path: nv('sdk/workflows/protocols/ag-ui/state'), name: 'AG-UI state' },
      { method: 'POST', path: nv('sdk/workflows/protocols/roma/evaluate'), name: 'ROMA evaluation', sampleBody: { agentId: 'agent_001', task: 'legal analysis', metrics: ['accuracy', 'relevance'] } },
      { method: 'POST', path: nv('sdk/workflows/protocols/bmad/analyze'), name: 'BMAD analysis', sampleBody: { workflow: 'contract_review', depth: 'comprehensive' } },
      { method: 'POST', path: nv('sdk/workflows/protocols/parlant/interact'), name: 'Parlant interaction', sampleBody: { message: 'Analyze this clause...', context: { jurisdiction: 'IN' } } },
      { method: 'POST', path: nv('sdk/workflows/context/optimize'), name: 'Context optimization', sampleBody: { context: 'Long context text...', maxTokens: 4096 } },
      { method: 'GET', path: nv('sdk/workflows/context/strategies'), name: 'Context strategies' },
      { method: 'POST', path: nv('sdk/workflows/mcp/invoke'), name: 'MCP tool invocation', sampleBody: { tool: 'legal_search', params: { query: 'recent supreme court judgments' } } },
      { method: 'GET', path: nv('sdk/workflows/mcp/tools'), name: 'List MCP tools' },
      { method: 'GET', path: nv('sdk/analytics/usage/summary'), name: 'Usage summary' },
    ],
  },
];

const TOTAL_ENDPOINTS = ENDPOINT_CATALOG.reduce((sum, cat) => sum + cat.endpoints.length, 0);

function getMethodStyle(method: string): React.CSSProperties {
  switch (method) {
    case 'GET': return { backgroundColor: 'rgba(28, 122, 79, 0.2)', color: '#1C7A4F', borderColor: 'rgba(28, 122, 79, 0.3)' };
    case 'POST': return { backgroundColor: 'rgba(10, 42, 102, 0.15)', color: 'rgba(10, 42, 102, 0.7)', borderColor: 'rgba(10, 42, 102, 0.3)' };
    case 'DELETE': return { backgroundColor: 'rgba(212, 160, 23, 0.15)', color: '#C7B15B', borderColor: 'rgba(212, 160, 23, 0.3)' };
    case 'PUT': return { backgroundColor: 'rgba(26, 20, 70, 0.15)', color: 'rgba(26, 20, 70, 0.7)', borderColor: 'rgba(26, 20, 70, 0.3)' };
    case 'PATCH': return { backgroundColor: 'rgba(28, 122, 79, 0.15)', color: '#1C7A4F', borderColor: 'rgba(28, 122, 79, 0.3)' };
    default: return { backgroundColor: 'rgba(10, 42, 102, 0.1)', color: 'rgba(10, 42, 102, 0.5)', borderColor: 'rgba(10, 42, 102, 0.3)' };
  }
}

function getStatusStyle(status: number): React.CSSProperties {
  if (status >= 200 && status < 300) return { backgroundColor: '#1C7A4F', color: '#FFFFFF' };
  if (status >= 400 && status < 500) return { backgroundColor: '#C7B15B', color: '#FFFFFF' };
  if (status >= 500) return { backgroundColor: '#152448', color: '#FFFFFF' };
  return { backgroundColor: 'rgba(10, 42, 102, 0.5)', color: '#FFFFFF' };
}

function getStatusBorderStyle(status: number): React.CSSProperties {
  if (status >= 200 && status < 300) return { borderLeftColor: '#1C7A4F' };
  if (status >= 400 && status < 500) return { borderLeftColor: '#C7B15B' };
  if (status >= 500) return { borderLeftColor: '#152448' };
  return { borderLeftColor: 'rgba(10, 42, 102, 0.5)' };
}

function extractPathParams(path: string): string[] {
  const matches = path.match(/:(\w+)/g);
  return matches ? matches.map(m => m.slice(1)) : [];
}

function buildUrl(path: string, paramValues: Record<string, string>, queryParams?: Record<string, any>): string {
  let url = path;
  for (const [key, value] of Object.entries(paramValues)) {
    url = url.replace(`:${key}`, encodeURIComponent(value));
  }
  if (queryParams && Object.keys(queryParams).length > 0) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(queryParams)) {
      if (value !== undefined && value !== '') {
        params.append(key, String(value));
      }
    }
    const qs = params.toString();
    if (qs) url += `?${qs}`;
  }
  return url;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function SDKApiPlayground() {
  const { toast } = useToast();
  const [apiKey, setApiKey] = useState('');
  const [showApiKey, setShowApiKey] = useState(false);
  const [selectedEndpoint, setSelectedEndpoint] = useState<EndpointDef | null>(null);
  const [requestBody, setRequestBody] = useState('');
  const [pathParamValues, setPathParamValues] = useState<Record<string, string>>({});
  const [response, setResponse] = useState<ResponseData | null>(null);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedCategories, setExpandedCategories] = useState<Record<string, boolean>>(
    Object.fromEntries(ENDPOINT_CATALOG.map(c => [c.name, true]))
  );
  const [requestTab, setRequestTab] = useState('body');
  const [responseTab, setResponseTab] = useState('body');
  const [customHeaders, setCustomHeaders] = useState<HeaderEntry[]>([
    { key: 'Content-Type', value: 'application/json', enabled: true },
  ]);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [sidebarTab, setSidebarTab] = useState<'collections' | 'history'>('collections');
  const [bodyError, setBodyError] = useState<string | null>(null);

  const filteredCatalog = useMemo(() => {
    if (!searchQuery.trim()) return ENDPOINT_CATALOG;
    const q = searchQuery.toLowerCase();
    return ENDPOINT_CATALOG.map(cat => ({
      ...cat,
      endpoints: cat.endpoints.filter(
        ep => ep.name.toLowerCase().includes(q) || ep.path.toLowerCase().includes(q) || ep.method.toLowerCase().includes(q)
      ),
    })).filter(cat => cat.endpoints.length > 0);
  }, [searchQuery]);

  const selectEndpoint = useCallback((ep: EndpointDef) => {
    setSelectedEndpoint(ep);
    setResponse(null);
    setBodyError(null);
    const params = extractPathParams(ep.path);
    const paramObj: Record<string, string> = {};
    params.forEach(p => { paramObj[p] = ''; });
    setPathParamValues(paramObj);
    if (ep.sampleBody) {
      setRequestBody(JSON.stringify(ep.sampleBody, null, 2));
    } else {
      setRequestBody('');
    }
    setRequestTab(ep.method === 'GET' ? 'params' : 'body');
  }, []);

  const toggleCategory = useCallback((name: string) => {
    setExpandedCategories(prev => ({ ...prev, [name]: !prev[name] }));
  }, []);

  const addHeader = useCallback(() => {
    setCustomHeaders(prev => [...prev, { key: '', value: '', enabled: true }]);
  }, []);

  const removeHeader = useCallback((idx: number) => {
    setCustomHeaders(prev => prev.filter((_, i) => i !== idx));
  }, []);

  const updateHeader = useCallback((idx: number, field: 'key' | 'value' | 'enabled', val: string | boolean) => {
    setCustomHeaders(prev => prev.map((h, i) => i === idx ? { ...h, [field]: val } : h));
  }, []);

  const validateBody = useCallback((text: string) => {
    if (!text.trim()) {
      setBodyError(null);
      return;
    }
    try {
      JSON.parse(text);
      setBodyError(null);
    } catch (e: any) {
      setBodyError(e.message);
    }
  }, []);

  const formatBody = useCallback(() => {
    try {
      const parsed = JSON.parse(requestBody);
      setRequestBody(JSON.stringify(parsed, null, 2));
      setBodyError(null);
    } catch {}
  }, [requestBody]);

  const generateCurl = useCallback(() => {
    if (!selectedEndpoint) return '';
    let url: string;
    if (selectedEndpoint.method === 'GET' && requestBody.trim()) {
      try {
        const queryParams = JSON.parse(requestBody);
        url = buildUrl(selectedEndpoint.path, pathParamValues, queryParams);
      } catch {
        url = buildUrl(selectedEndpoint.path, pathParamValues);
      }
    } else {
      url = buildUrl(selectedEndpoint.path, pathParamValues);
    }

    const fullUrl = `${window.location.origin}${url}`;
    let curl = `curl -X ${selectedEndpoint.method} '${fullUrl}'`;
    curl += ` \\\n  -H 'Content-Type: application/json'`;
    if (apiKey) curl += ` \\\n  -H 'X-API-Key: ${apiKey}'`;
    customHeaders.filter(h => h.enabled && h.key && h.key !== 'Content-Type').forEach(h => {
      curl += ` \\\n  -H '${h.key}: ${h.value}'`;
    });
    if (selectedEndpoint.method !== 'GET' && requestBody.trim()) {
      curl += ` \\\n  -d '${requestBody.replace(/\n/g, '').replace(/\s+/g, ' ')}'`;
    }
    return curl;
  }, [selectedEndpoint, apiKey, requestBody, pathParamValues, customHeaders]);

  const copyCurl = useCallback(() => {
    const curl = generateCurl();
    navigator.clipboard.writeText(curl);
    toast({ title: 'Copied', description: 'cURL command copied to clipboard.' });
  }, [generateCurl, toast]);

  const sendRequest = useCallback(async () => {
    if (!selectedEndpoint) return;
    const sessionToken = getAuthToken();
    if (!apiKey.trim() && !sessionToken) {
      toast({ title: 'Auth Required', description: 'Enter your SDK API key in the Authorization tab, or log in to use session auth.', variant: 'destructive' });
      setRequestTab('auth');
      return;
    }

    setLoading(true);
    setResponse(null);

    try {
      let url: string;
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (apiKey.trim()) {
        headers['X-API-Key'] = apiKey;
      }
      if (sessionToken) {
        headers['Authorization'] = `Bearer ${sessionToken}`;
      }

      customHeaders.filter(h => h.enabled && h.key).forEach(h => {
        headers[h.key] = h.value;
      });

      if (selectedEndpoint.method === 'GET' && requestBody.trim()) {
        let queryParams: Record<string, any> = {};
        try { queryParams = JSON.parse(requestBody); } catch {}
        url = buildUrl(selectedEndpoint.path, pathParamValues, queryParams);
      } else {
        url = buildUrl(selectedEndpoint.path, pathParamValues);
      }

      const fetchOptions: RequestInit = {
        method: selectedEndpoint.method,
        headers,
      };

      if (selectedEndpoint.method !== 'GET' && requestBody.trim()) {
        fetchOptions.body = requestBody;
      }

      const startTime = performance.now();
      const res = await fetch(url, fetchOptions);
      const elapsed = Math.round(performance.now() - startTime);

      const resHeaders: Record<string, string> = {};
      res.headers.forEach((value, key) => { resHeaders[key] = value; });

      let body: any;
      const rawText = await res.text();
      const responseSize = new Blob([rawText]).size;

      try {
        body = JSON.parse(rawText);
      } catch {
        body = rawText;
      }

      const responseData: ResponseData = {
        status: res.status,
        statusText: res.statusText,
        body,
        headers: resHeaders,
        time: elapsed,
        size: responseSize,
      };

      setResponse(responseData);
      const orchId = responseData.body?.orchestrationId || responseData.body?.requestId;
      if (typeof orchId === 'string') rememberLegalRun(orchId, 'sdk-playground');

      setHistory(prev => [{
        id: Date.now().toString(),
        method: selectedEndpoint.method,
        path: selectedEndpoint.path,
        name: selectedEndpoint.name,
        status: res.status,
        time: elapsed,
        timestamp: new Date(),
      }, ...prev].slice(0, 50));

    } catch (err: any) {
      setResponse({
        status: 0,
        statusText: 'Network Error',
        body: { error: err.message || 'Failed to connect' },
        headers: {},
        time: 0,
        size: 0,
      });
      toast({ title: 'Request Failed', description: err.message || 'Network error', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }, [selectedEndpoint, apiKey, requestBody, pathParamValues, customHeaders, toast]);

  const copyResponse = useCallback(() => {
    if (response) {
      const text = typeof response.body === 'string' ? response.body : JSON.stringify(response.body, null, 2);
      navigator.clipboard.writeText(text);
      toast({ title: 'Copied', description: 'Response copied to clipboard.' });
    }
  }, [response, toast]);

  const pathParams = selectedEndpoint ? extractPathParams(selectedEndpoint.path) : [];
  const resolvedUrl = selectedEndpoint ? buildUrl(selectedEndpoint.path, pathParamValues) : '';

  return (
    <div className="min-h-screen bg-white flex flex-col">
      <header className="border-b bg-white sticky top-0 z-50 shadow-sm" style={{ borderColor: 'rgba(10, 42, 102, 0.15)' }} role="banner" aria-label="Page header">
        <div className="flex items-center justify-between px-4 py-3">
          <div className="flex items-center gap-3">
            <img
              src="/images/nyayasiddhi-logo.jpeg"
              alt="Jurexio"
              className="w-9 h-9 rounded-lg"
            />
            <div>
              <h1 className="text-lg font-bold tracking-tight font-heading" style={{ color: '#152448' }}>Jurexio Enterprise Platform SDK Playground</h1>
              <p className="text-xs" style={{ color: 'rgba(10, 42, 102, 0.6)' }}>{TOTAL_ENDPOINTS} endpoints across {ENDPOINT_CATALOG.length} categories</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {apiKey ? (
              <Badge className="border" style={{ backgroundColor: 'rgba(28, 122, 79, 0.15)', color: '#1C7A4F', borderColor: 'rgba(28, 122, 79, 0.25)' }}>
                <CheckCircle className="h-3 w-3 mr-1" /> Authenticated
              </Badge>
            ) : (
              <Badge className="border" style={{ backgroundColor: 'rgba(10, 42, 102, 0.05)', color: 'rgba(10, 42, 102, 0.6)', borderColor: 'rgba(10, 42, 102, 0.2)' }}>
                <Key className="h-3 w-3 mr-1" /> No API Key
              </Badge>
            )}
            <Badge variant="outline" className="text-xs" style={{ borderColor: 'rgba(10, 42, 102, 0.2)', color: '#152448' }} role="status">v1.0</Badge>
          </div>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        <div className="w-[300px] border-r flex flex-col" style={{ borderColor: 'rgba(10, 42, 102, 0.15)', backgroundColor: 'rgba(10, 42, 102, 0.03)' }}>
          <div className="p-3 space-y-2 border-b" style={{ borderColor: 'rgba(10, 42, 102, 0.15)' }}>
            <div className="flex gap-1 rounded-lg p-0.5" style={{ backgroundColor: 'rgba(10, 42, 102, 0.08)' }}>
              <button
                onClick={() => setSidebarTab('collections')}
                className="flex-1 text-xs font-medium py-1.5 px-2 rounded-md transition-colors"
                style={sidebarTab === 'collections'
                  ? { backgroundColor: '#FFFFFF', color: '#152448', boxShadow: '0 1px 2px rgba(0,0,0,0.05)' }
                  : { color: 'rgba(10, 42, 102, 0.6)' }
                }
              >
                <Code className="h-3 w-3 inline mr-1" />
                Collections
              </button>
              <button
                onClick={() => setSidebarTab('history')}
                className="flex-1 text-xs font-medium py-1.5 px-2 rounded-md transition-colors"
                style={sidebarTab === 'history'
                  ? { backgroundColor: '#FFFFFF', color: '#152448', boxShadow: '0 1px 2px rgba(0,0,0,0.05)' }
                  : { color: 'rgba(10, 42, 102, 0.6)' }
                }
              >
                <History className="h-3 w-3 inline mr-1" />
                History ({history.length})
              </button>
            </div>
            {sidebarTab === 'collections' && (
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5" style={{ color: 'rgba(10, 42, 102, 0.4)' }} />
                <Input
                  placeholder="Search endpoints..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="bg-white pl-8 text-xs h-8"
                  style={{ borderColor: 'rgba(10, 42, 102, 0.2)', color: '#152448' }}
                />
              </div>
            )}
          </div>

          <ScrollArea className="flex-1" aria-label="Scrollable content">
            {sidebarTab === 'collections' ? (
              <div className="p-1.5">
                {filteredCatalog.map(cat => (
                  <div key={cat.name} className="mb-0.5">
                    <button
                      onClick={() => toggleCategory(cat.name)}
                      className="w-full flex items-center gap-2 px-2.5 py-1.5 text-xs font-semibold rounded-md transition-colors"
                      style={{ color: '#152448' }}
                    >
                      {expandedCategories[cat.name] ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                      <span style={{ color: 'rgba(10, 42, 102, 0.6)' }}>{cat.icon}</span>
                      <span className="flex-1 text-left">{cat.name}</span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ color: 'rgba(10, 42, 102, 0.4)', backgroundColor: 'rgba(10, 42, 102, 0.08)' }}>
                        {cat.endpoints.length}
                      </span>
                    </button>
                    {expandedCategories[cat.name] && (
                      <div className="ml-2 space-y-px">
                        {cat.endpoints.map(ep => (
                          <button
                            key={`${ep.method}-${ep.path}`}
                            onClick={() => selectEndpoint(ep)}
                            className="w-full flex items-center gap-1.5 px-2 py-1 text-[11px] rounded transition-colors"
                            style={selectedEndpoint?.path === ep.path && selectedEndpoint?.method === ep.method
                              ? { backgroundColor: '#152448', color: '#FFFFFF' }
                              : { color: '#152448' }
                            }
                          >
                            <span
                              className="text-[9px] font-bold px-1 py-0.5 rounded font-mono min-w-[32px] text-center"
                              style={selectedEndpoint?.path === ep.path && selectedEndpoint?.method === ep.method
                                ? { backgroundColor: 'rgba(255,255,255,0.2)', color: '#FFFFFF' }
                                : getMethodStyle(ep.method)
                              }
                            >
                              {ep.method}
                            </span>
                            <span className="truncate font-mono">{ep.path.replace('/api/v1/sdk', '')}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div className="p-2 space-y-1">
                {history.length === 0 ? (
                  <div className="text-center py-8 text-xs" style={{ color: 'rgba(10, 42, 102, 0.4)' }}>
                    <History className="h-8 w-8 mx-auto mb-2 opacity-30" />
                    No request history yet
                  </div>
                ) : (
                  history.map(entry => (
                    <button
                      key={entry.id}
                      onClick={() => {
                        const cat = ENDPOINT_CATALOG.find(c => c.endpoints.some(e => e.path === entry.path && e.method === entry.method));
                        const ep = cat?.endpoints.find(e => e.path === entry.path && e.method === entry.method);
                        if (ep) selectEndpoint(ep);
                        setSidebarTab('collections');
                      }}
                      className="w-full flex items-center gap-2 px-2 py-1.5 text-[11px] rounded transition-colors"
                    >
                      <span className="text-[9px] font-bold px-1 py-0.5 rounded font-mono" style={getMethodStyle(entry.method)}>
                        {entry.method}
                      </span>
                      <span className="truncate font-mono flex-1 text-left" style={{ color: '#152448' }}>{entry.path.replace('/api/v1/sdk', '')}</span>
                      <span
                        className="text-[10px] px-1.5 py-0.5 rounded font-mono"
                        style={entry.status >= 200 && entry.status < 300
                          ? { color: '#1C7A4F', backgroundColor: 'rgba(28, 122, 79, 0.08)' }
                          : { color: '#C7B15B', backgroundColor: 'rgba(212, 160, 23, 0.08)' }
                        }
                      >
                        {entry.status}
                      </span>
                    </button>
                  ))
                )}
                {history.length > 0 && (
                  <button
                    onClick={() => setHistory([])}
                    className="w-full text-[11px] py-2 transition-colors"
                    style={{ color: 'rgba(10, 42, 102, 0.4)' }}
                  >
                    <Trash2 className="h-3 w-3 inline mr-1" />
                    Clear History
                  </button>
                )}
              </div>
            )}
          </ScrollArea>
        </div>

        <div className="flex-1 flex flex-col overflow-hidden">
          {!selectedEndpoint ? (
            <div className="flex-1 flex items-center justify-center" style={{ backgroundColor: 'rgba(10, 42, 102, 0.02)' }}>
              <div className="text-center space-y-4 max-w-md">
                <div className="w-20 h-20 rounded-2xl flex items-center justify-center mx-auto" style={{ backgroundColor: 'rgba(10, 42, 102, 0.08)' }}>
                  <Terminal className="h-10 w-10" style={{ color: 'rgba(10, 42, 102, 0.4)' }} />
                </div>
                <h2 className="text-xl font-semibold font-heading" style={{ color: '#152448' }}>Select an Endpoint</h2>
                <p className="text-sm" style={{ color: 'rgba(10, 42, 102, 0.6)' }}>
                  Choose an API endpoint from the collections sidebar to start testing.
                  Enter your API key in the Authorization tab to authenticate requests.
                </p>
                <div className="grid grid-cols-3 gap-3 mt-6">
                  <div className="text-center p-3 bg-white rounded-lg border" style={{ borderColor: 'rgba(10, 42, 102, 0.15)' }}>
                    <p className="text-2xl font-bold" style={{ color: '#152448' }}>{TOTAL_ENDPOINTS}</p>
                    <p className="text-[11px]" style={{ color: 'rgba(10, 42, 102, 0.6)' }}>Endpoints</p>
                  </div>
                  <div className="text-center p-3 bg-white rounded-lg border" style={{ borderColor: 'rgba(10, 42, 102, 0.15)' }}>
                    <p className="text-2xl font-bold" style={{ color: '#C7B15B' }}>{ENDPOINT_CATALOG.length}</p>
                    <p className="text-[11px]" style={{ color: 'rgba(10, 42, 102, 0.6)' }}>Categories</p>
                  </div>
                  <div className="text-center p-3 bg-white rounded-lg border" style={{ borderColor: 'rgba(10, 42, 102, 0.15)' }}>
                    <p className="text-2xl font-bold" style={{ color: '#1C7A4F' }}>5</p>
                    <p className="text-[11px]" style={{ color: 'rgba(10, 42, 102, 0.6)' }}>Methods</p>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="flex-1 flex flex-col overflow-hidden">
              <div className="px-4 py-3 border-b bg-white" style={{ borderColor: 'rgba(10, 42, 102, 0.15)' }}>
                <div className="flex items-center gap-3">
                  <Badge className="text-xs px-2 py-1 font-mono font-bold" style={getMethodStyle(selectedEndpoint.method)}>
                    {selectedEndpoint.method}
                  </Badge>
                  <div className="flex-1 border rounded-lg px-3 py-2 font-mono text-sm" style={{ backgroundColor: 'rgba(10, 42, 102, 0.05)', borderColor: 'rgba(10, 42, 102, 0.2)', color: '#152448' }}>
                    {resolvedUrl || selectedEndpoint.path}
                  </div>
                  <Button
                    onClick={sendRequest}
                    disabled={loading}
                    className="text-white font-semibold px-6"
                    style={{ backgroundColor: '#152448' }}
                  >
                    {loading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Send className="h-4 w-4 mr-2" />}
                    Send
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={copyCurl}
                    title="Copy cURL"
                    style={{ borderColor: 'rgba(10, 42, 102, 0.2)', color: '#152448' }}
                  >
                    <ClipboardCopy className="h-4 w-4" />
                  </Button>
                </div>
                <div className="flex items-center gap-2 mt-2">
                  <span className="text-xs" style={{ color: 'rgba(10, 42, 102, 0.6)' }}>{selectedEndpoint.name}</span>
                </div>
              </div>

              <div className="flex-1 flex flex-col lg:flex-row overflow-hidden">
                <div className="flex-1 flex flex-col border-r overflow-hidden" style={{ borderColor: 'rgba(10, 42, 102, 0.15)' }}>
                  <Tabs value={requestTab} onValueChange={setRequestTab} className="flex flex-col flex-1 overflow-hidden">
                    <div className="border-b" style={{ borderColor: 'rgba(10, 42, 102, 0.15)', backgroundColor: 'rgba(10, 42, 102, 0.03)' }}>
                      <TabsList className="bg-transparent border-0 h-auto p-0 gap-0" aria-label="Navigation tabs">
                        <TabsTrigger value="params" className="text-xs rounded-none border-b-2 border-transparent px-4 py-2" style={{ '--tw-border-opacity': 1 } as React.CSSProperties} data-brand-active-color="#152448" aria-label="params tab">
                          Params {pathParams.length > 0 && <span className="ml-1 text-[10px] px-1.5 rounded-full" style={{ backgroundColor: 'rgba(10, 42, 102, 0.1)', color: '#152448' }}>{pathParams.length}</span>}
                        </TabsTrigger>
                        <TabsTrigger value="headers" className="text-xs rounded-none border-b-2 border-transparent px-4 py-2" aria-label="headers tab">
                          Headers <span className="ml-1 text-[10px] px-1.5 rounded-full" style={{ backgroundColor: 'rgba(10, 42, 102, 0.1)', color: '#152448' }}>{customHeaders.filter(h => h.enabled).length}</span>
                        </TabsTrigger>
                        <TabsTrigger value="body" className="text-xs rounded-none border-b-2 border-transparent px-4 py-2" aria-label="body tab">
                          Body {bodyError && <span className="ml-1" style={{ color: '#C7B15B' }}>!</span>}
                        </TabsTrigger>
                        <TabsTrigger value="auth" className="text-xs rounded-none border-b-2 border-transparent px-4 py-2" aria-label="auth tab">
                          Authorization {apiKey && <CheckCircle className="h-3 w-3 ml-1 inline" style={{ color: '#1C7A4F' }} />}
                        </TabsTrigger>
                      </TabsList>
                    </div>

                    <div className="flex-1 overflow-auto">
                      <TabsContent value="params" className="m-0 p-4 space-y-3">
                        {pathParams.length > 0 ? (
                          <div className="space-y-3">
                            <Label className="text-xs font-semibold uppercase tracking-wider" style={{ color: '#152448' }}>Path Parameters</Label>
                            {pathParams.map(param => (
                              <div key={param} className="flex items-center gap-2">
                                <div className="w-32 text-xs font-mono px-2 py-2 rounded border" style={{ color: '#152448', backgroundColor: 'rgba(10, 42, 102, 0.05)', borderColor: 'rgba(10, 42, 102, 0.2)' }}>
                                  :{param}
                                </div>
                                <Input
                                  placeholder={`Enter ${param}...`}
                                  value={pathParamValues[param] || ''}
                                  onChange={(e) => setPathParamValues(prev => ({ ...prev, [param]: e.target.value }))}
                                  className="flex-1 bg-white text-xs h-8"
                                  style={{ borderColor: 'rgba(10, 42, 102, 0.2)', color: '#152448' }}
                                />
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="text-center py-8 text-xs" style={{ color: 'rgba(10, 42, 102, 0.4)' }}>
                            No path parameters for this endpoint.
                            {selectedEndpoint.method === 'GET' && selectedEndpoint.sampleBody && (
                              <p className="mt-2">Query parameters can be set in the Body tab as JSON.</p>
                            )}
                          </div>
                        )}
                      </TabsContent>

                      <TabsContent value="headers" className="m-0 p-4 space-y-3">
                        <div className="flex items-center justify-between">
                          <Label className="text-xs font-semibold uppercase tracking-wider" style={{ color: '#152448' }}>Request Headers</Label>
                          <Button size="sm" variant="outline" onClick={addHeader} className="text-xs h-7" style={{ borderColor: 'rgba(10, 42, 102, 0.2)', color: '#152448' }}>
                            <Plus className="h-3 w-3 mr-1" /> Add Header
                          </Button>
                        </div>
                        <div className="space-y-2">
                          <div className="flex items-center gap-2 text-[10px] font-semibold uppercase px-1" style={{ color: 'rgba(10, 42, 102, 0.6)' }}>
                            <div className="w-6"></div>
                            <div className="flex-1">Key</div>
                            <div className="flex-1">Value</div>
                            <div className="w-8"></div>
                          </div>
                          <div className="rounded-lg px-2 py-1.5 flex items-center gap-2 text-xs" style={{ backgroundColor: 'rgba(10, 42, 102, 0.04)' }}>
                            <input type="checkbox" checked disabled className="w-4 h-4" style={{ accentColor: '#152448' }} />
                            <div className="flex-1 font-mono" style={{ color: 'rgba(10, 42, 102, 0.6)' }}>X-API-Key</div>
                            <div className="flex-1 font-mono" style={{ color: 'rgba(10, 42, 102, 0.6)' }}>{apiKey ? '••••••••' : '(not set)'}</div>
                            <div className="w-8"></div>
                          </div>
                          {customHeaders.map((header, idx) => (
                            <div key={idx} className="flex items-center gap-2">
                              <input
                                type="checkbox"
                                checked={header.enabled}
                                onChange={(e) => updateHeader(idx, 'enabled', e.target.checked)}
                                className="w-4 h-4"
                                style={{ accentColor: '#152448' }}
                              />
                              <Input
                                placeholder="Header name"
                                value={header.key}
                                onChange={(e) => updateHeader(idx, 'key', e.target.value)}
                                className="flex-1 bg-white text-xs h-7 font-mono"
                                style={{ borderColor: 'rgba(10, 42, 102, 0.2)' }}
                              />
                              <Input
                                placeholder="Value"
                                value={header.value}
                                onChange={(e) => updateHeader(idx, 'value', e.target.value)}
                                className="flex-1 bg-white text-xs h-7 font-mono"
                                style={{ borderColor: 'rgba(10, 42, 102, 0.2)' }}
                              />
                              <button
                                onClick={() => removeHeader(idx)}
                                className="transition-colors"
                                style={{ color: 'rgba(10, 42, 102, 0.4)' }}
                              >
                                <Minus className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          ))}
                        </div>
                      </TabsContent>

                      <TabsContent value="body" className="m-0 p-4 space-y-2">
                        <div className="flex items-center justify-between">
                          <Label className="text-xs font-semibold uppercase tracking-wider" style={{ color: '#152448' }}>
                            {selectedEndpoint.method === 'GET' ? 'Query Parameters (JSON)' : 'Request Body (JSON)'}
                          </Label>
                          <div className="flex gap-1">
                            <Button size="sm" variant="outline" onClick={formatBody} className="text-[10px] h-6 px-2" style={{ borderColor: 'rgba(10, 42, 102, 0.2)', color: '#152448' }}>
                              Beautify
                            </Button>
                          </div>
                        </div>
                        <div className="relative">
                          <Textarea
                            value={requestBody}
                            onChange={(e) => {
                              setRequestBody(e.target.value);
                              validateBody(e.target.value);
                            }}
                            placeholder={selectedEndpoint.method === 'GET' ? '{\n  "key": "value"\n}' : '{\n  "key": "value"\n}'}
                            className="font-mono text-xs bg-white min-h-[200px] resize-none"
                            style={{ borderColor: bodyError ? '#C7B15B' : 'rgba(10, 42, 102, 0.2)', color: '#152448' }}
                            spellCheck={false}
                          />
                          {bodyError && (
                            <p className="text-[10px] mt-1 flex items-center gap-1" style={{ color: '#C7B15B' }}>
                              <XCircle className="h-3 w-3" /> {bodyError}
                            </p>
                          )}
                        </div>
                      </TabsContent>

                      <TabsContent value="auth" className="m-0 p-4 space-y-4">
                        <Label className="text-xs font-semibold uppercase tracking-wider" style={{ color: '#152448' }}>API Key Authentication</Label>
                        <div className="rounded-lg p-4 space-y-3 border" style={{ backgroundColor: 'rgba(10, 42, 102, 0.04)', borderColor: 'rgba(10, 42, 102, 0.15)' }}>
                          <div className="flex items-center gap-2 text-xs" style={{ color: '#152448' }}>
                            <Key className="h-4 w-4" />
                            <span className="font-medium">X-API-Key Header</span>
                          </div>
                          <div className="relative">
                            <Input
                              type={showApiKey ? 'text' : 'password'}
                              placeholder="nvg_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                              value={apiKey}
                              onChange={(e) => setApiKey(e.target.value)}
                              className="bg-white pr-10 text-sm font-mono"
                              style={{ borderColor: 'rgba(10, 42, 102, 0.2)', color: '#152448' }}
                            />
                            <button
                              onClick={() => setShowApiKey(!showApiKey)}
                              className="absolute right-2.5 top-1/2 -translate-y-1/2 transition-colors"
                              style={{ color: 'rgba(10, 42, 102, 0.4)' }}
                            >
                              {showApiKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                            </button>
                          </div>
                          <p className="text-[11px]" style={{ color: 'rgba(10, 42, 102, 0.6)' }}>
                            Your API key is sent as the X-API-Key header with every request. Generate keys from the SDK Console.
                          </p>
                        </div>
                      </TabsContent>
                    </div>
                  </Tabs>
                </div>

                <div className="flex-1 flex flex-col overflow-hidden" style={{ backgroundColor: 'rgba(10, 42, 102, 0.02)' }}>
                  <div className="border-b bg-white px-4 py-2 flex items-center justify-between" style={{ borderColor: 'rgba(10, 42, 102, 0.15)' }}>
                    <div className="flex items-center gap-3">
                      <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: '#152448' }}>Response</span>
                      {response && (
                        <>
                          <Badge className="text-xs font-mono px-2 py-0.5" style={getStatusStyle(response.status)}>
                            {response.status} {response.statusText}
                          </Badge>
                          <span className="text-[11px] flex items-center gap-1" style={{ color: 'rgba(10, 42, 102, 0.6)' }}>
                            <Clock className="h-3 w-3" /> {response.time} ms
                          </span>
                          <span className="text-[11px]" style={{ color: 'rgba(10, 42, 102, 0.6)' }}>
                            {formatBytes(response.size)}
                          </span>
                        </>
                      )}
                    </div>
                    {response && (
                      <Button size="sm" variant="outline" onClick={copyResponse} className="text-xs h-7" style={{ borderColor: 'rgba(10, 42, 102, 0.2)', color: '#152448' }}>
                        <Copy className="h-3 w-3 mr-1" /> Copy
                      </Button>
                    )}
                  </div>

                  {response ? (
                    <div className="flex-1 flex flex-col overflow-hidden">
                      <Tabs value={responseTab} onValueChange={setResponseTab} className="flex flex-col flex-1 overflow-hidden">
                        <div className="border-b bg-white" style={{ borderColor: 'rgba(10, 42, 102, 0.15)' }}>
                          <TabsList className="bg-transparent border-0 h-auto p-0 gap-0" aria-label="Navigation tabs">
                            <TabsTrigger value="body" className="text-xs rounded-none border-b-2 border-transparent px-4 py-2" aria-label="body tab">
                              Body
                            </TabsTrigger>
                            <TabsTrigger value="headers" className="text-xs rounded-none border-b-2 border-transparent px-4 py-2" aria-label="headers tab">
                              Headers ({Object.keys(response.headers).length})
                            </TabsTrigger>
                          </TabsList>
                        </div>

                        <div className="flex-1 overflow-auto">
                          <TabsContent value="body" className="m-0 h-full">
                            <ScrollArea className="h-full" aria-label="Scrollable content">
                              <pre className="p-4 text-xs font-mono whitespace-pre-wrap break-all border-l-4" style={getStatusBorderStyle(response.status)}>
                                <code style={{ color: '#152448' }}>
                                  {typeof response.body === 'string' ? response.body : JSON.stringify(response.body, null, 2)}
                                </code>
                              </pre>
                            </ScrollArea>
                          </TabsContent>
                          <TabsContent value="headers" className="m-0 p-4">
                            <div className="space-y-1">
                              {Object.entries(response.headers).map(([key, value]) => (
                                <div key={key} className="flex gap-3 text-xs py-1 border-b" style={{ borderColor: 'rgba(10, 42, 102, 0.05)' }}>
                                  <span className="font-mono font-semibold min-w-[180px]" style={{ color: '#152448' }}>{key}</span>
                                  <span className="font-mono break-all" style={{ color: 'rgba(10, 42, 102, 0.6)' }}>{value}</span>
                                </div>
                              ))}
                            </div>
                          </TabsContent>
                        </div>
                      </Tabs>
                      {typeof response.body?.orchestrationId === 'string' || typeof response.body?.requestId === 'string' ? (
                        <div className="border-t p-2" style={{ borderColor: 'rgba(10, 42, 102, 0.15)' }}>
                          <ExecutionTraceRail
                            compact
                            title="Run id"
                            orchestrationId={String(response.body.orchestrationId || response.body.requestId)}
                            events={[{
                              step: 'request_received',
                              status: 'ok',
                              ts: Date.now(),
                              orchestrationId: String(response.body.orchestrationId || response.body.requestId),
                              data: { source: 'sdk-playground' },
                            }]}
                          />
                        </div>
                      ) : null}
                    </div>
                  ) : (
                    <div className="flex-1 flex items-center justify-center">
                      <div className="text-center space-y-3">
                        {loading ? (
                          <>
                            <Loader2 className="h-10 w-10 animate-spin mx-auto" style={{ color: 'rgba(10, 42, 102, 0.4)' }} />
                            <p className="text-sm" style={{ color: 'rgba(10, 42, 102, 0.6)' }}>Sending request...</p>
                          </>
                        ) : (
                          <>
                            <div className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto" style={{ backgroundColor: 'rgba(10, 42, 102, 0.06)' }}>
                              <Send className="h-8 w-8" style={{ color: 'rgba(10, 42, 102, 0.25)' }} />
                            </div>
                            <p className="text-sm" style={{ color: 'rgba(10, 42, 102, 0.6)' }}>Hit Send to get a response</p>
                            <p className="text-xs" style={{ color: 'rgba(10, 42, 102, 0.4)' }}>Response will appear here</p>
                          </>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
