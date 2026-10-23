import { Layers } from 'lucide-react';
import { Nv5NamespacePage, type NamespaceConfig } from './_shared';

const cfg: NamespaceConfig = {
  slug: 'internal',
  title: 'Platform v5 — Internal Services',
  blurb:
    'Session-11 Batches G + H + I + J consolidated surface — single namespace flag (JRX_F_INTERNAL_SURFACE) wires 14 previously-orphan internal services (model-cascade, SLM router, cost-aware router, e-sign / OCR / PDF/A / watermark adapters, hallucination checker, escalation, event sourcing, jurisdiction overlay, audit-chain verifier, case-update, AzentZero / AgentZero adapters, feature-flags service, orchestration facade). Read-only / capability-only — no LLM emission.',
  apiPrefix: '/api/nv5/internal',
  flagKeys: ['internalSurface'],
  subServices: [
    { label: 'Namespace capabilities', path: '',                       probe: '/capabilities', flag: 'internalSurface' },
    { label: 'Model cascade',          path: 'model-cascade',          probe: '/capabilities', flag: 'internalSurface' },
    { label: 'Cost-aware router',      path: 'cost-aware-router',      probe: '/capabilities', flag: 'internalSurface' },
    { label: 'E-sign adapter (stub — not sold)', path: 'esign',                  probe: '/capabilities', flag: 'internalSurface' },
    { label: 'OCR adapter',            path: 'ocr',                    probe: '/capabilities', flag: 'internalSurface' },
    { label: 'PDF/A generator',        path: 'pdfa',                   probe: '/capabilities', flag: 'internalSurface' },
    { label: 'Watermark service',      path: 'watermark',              probe: '/capabilities', flag: 'internalSurface' },
    { label: 'Hallucination checker',  path: 'hallucination',          probe: '/capabilities', flag: 'internalSurface' },
    { label: 'Escalation service',     path: 'escalation',             probe: '/capabilities', flag: 'internalSurface' },
    { label: 'Event sourcing',         path: 'event-sourcing',         probe: '/capabilities', flag: 'internalSurface' },
    { label: 'Jurisdiction overlay',   path: 'jurisdiction-overlay',   probe: '/capabilities', flag: 'internalSurface' },
    { label: 'Audit-chain verifier',   path: 'audit-chain',            probe: '/capabilities', flag: 'internalSurface' },
    { label: 'Case-update service',    path: 'case-update',            probe: '/capabilities', flag: 'internalSurface' },
    { label: 'AgentZero adapter',      path: 'agentzero',              probe: '/capabilities', flag: 'internalSurface' },
    { label: 'Feature flags service',  path: 'feature-flags',          probe: '/capabilities', flag: 'internalSurface' },
    { label: 'Orchestration facade',   path: 'orchestration-facade',   probe: '/capabilities', flag: 'internalSurface' },
  ],
  tryIt: {
    method: 'GET',
    url: '/api/nv5/internal/slm-router/availability/IN',
    label: 'Probe SLM-router availability for IN jurisdiction',
    description: 'Happy-path action: parametrised live lookup against the jurisdiction-specific Small Legal Model router (no LLM emission — availability flag only).',
  },
  batch: 'G+H+I+J',
  icon: Layers,
};

export default function PlatformV5Internal() { return <Nv5NamespacePage cfg={cfg} />; }
