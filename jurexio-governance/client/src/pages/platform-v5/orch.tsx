import { Brain } from 'lucide-react';
import { Nv5NamespacePage, type NamespaceConfig } from './_shared';

const cfg: NamespaceConfig = {
  slug: 'orch',
  title: 'Platform v5 — Orchestration',
  blurb:
    'Session-10 Batch A surface — wires 7 previously-orphan AI orchestration files (knowledge base, context engineering, advanced multimodal RAG, plugin manager, ROMA L5 engine, BM25 agent selector, protocol registry). All sub-routes are read-only and per-sub-route flag-gated. The canonical LLM-emitting path remains realLLMService.executeRequest per NV-LLM-001.',
  apiPrefix: '/api/nv5/orch',
  flagKeys: [
    'aiOrchKb', 'aiOrchContext', 'aiOrchMultimodalRag', 'aiOrchPlugins',
    'aiOrchRoma', 'aiOrchAgentSelect', 'aiOrchProtocols',
  ],
  subServices: [
    { label: 'Knowledge Base',    path: 'kb',             probe: '/health', flag: 'aiOrchKb' },
    { label: 'Context Engineering', path: 'context',      probe: '/health', flag: 'aiOrchContext' },
    { label: 'Multimodal RAG',    path: 'multimodal-rag', probe: '/health', flag: 'aiOrchMultimodalRag' },
    { label: 'Plugin Manager',    path: 'plugins',        probe: '/health', flag: 'aiOrchPlugins' },
    { label: 'ROMA L5 Engine',    path: 'roma',           probe: '/health', flag: 'aiOrchRoma' },
    { label: 'Agent Selector',    path: 'agent-select',   probe: '/health', flag: 'aiOrchAgentSelect' },
    { label: 'Protocol Registry', path: 'protocols',      probe: '/health', flag: 'aiOrchProtocols' },
  ],
  tryIt: {
    method: 'GET',
    url: '/api/nv5/orch/roma/audit-trail',
    label: 'Fetch ROMA L5 audit trail',
    description: 'Read-only audit-trail snapshot from the ROMA L5 governance engine.',
  },
  batch: 'A',
  icon: Brain,
};

export default function PlatformV5Orch() { return <Nv5NamespacePage cfg={cfg} />; }
