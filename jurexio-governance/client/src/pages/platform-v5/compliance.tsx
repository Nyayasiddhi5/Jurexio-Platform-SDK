import { Scale } from 'lucide-react';
import { Nv5NamespacePage, type NamespaceConfig } from './_shared';

const cfg: NamespaceConfig = {
  slug: 'compliance',
  title: 'Platform v5 — Compliance & Crypto',
  blurb:
    'Session-11 Batch F surface — wires 3 previously-orphan compliance/crypto services (EU AI Act doc generator, post-quantum crypto, federated-privacy session telemetry). EU-AI-Act endpoints are pure data lookup, PQC operations are deterministic crypto, federated-privacy exposes session listings + DP-noise probe only.',
  apiPrefix: '/api/nv5/compliance',
  flagKeys: ['complianceEuAiAct', 'compliancePqc', 'complianceFederatedPrivacy'],
  subServices: [
    { label: 'EU AI Act',          path: 'eu-ai-act',         probe: '/capabilities', flag: 'complianceEuAiAct' },
    { label: 'Post-quantum crypto', path: 'pqc',              probe: '/capabilities', flag: 'compliancePqc' },
    { label: 'Federated privacy',   path: 'federated-privacy', probe: '/capabilities', flag: 'complianceFederatedPrivacy' },
  ],
  tryIt: {
    method: 'GET',
    url: '/api/nv5/compliance/eu-ai-act/report',
    label: 'Generate EU AI Act compliance report',
    description: 'Read-only Article 9–15 compliance report rolled up from in-memory registries.',
  },
  batch: 'F',
  icon: Scale,
};

export default function PlatformV5Compliance() { return <Nv5NamespacePage cfg={cfg} />; }
