import { ShieldCheck } from 'lucide-react';
import { Nv5NamespacePage, type NamespaceConfig } from './_shared';

/**
 * Platform-v5 condensed governance entry. The full operator dashboard
 * (with maker-checker queue, security thresholds, concurrency snapshot,
 * org rate-limit cache invalidate) lives at /superadmin/governance —
 * this page is a per-namespace consistency surface so all 9 nv5 namespaces
 * are visible from the same /platform-v5/* family.
 */
const cfg: NamespaceConfig = {
  slug: 'gov',
  title: 'Platform v5 — Governance',
  blurb:
    'Session-10 Batch D cross-cutting governance surface — wires 5 previously-orphan governance services (maker-checker HITL queue, security monitor, cost-optimization suite, concurrency governor, per-org rate limiter). For the full operator dashboard with mutation surfaces (cache invalidate, threshold tuning), see the dedicated page at /superadmin/governance.',
  apiPrefix: '/api/nv5/gov',
  flagKeys: [
    'govMakerChecker', 'govSecurityMon', 'govCostOpt',
    'govConcurrency', 'govOrgRatelimit',
  ],
  subServices: [
    { label: 'Maker-checker queue',  path: 'maker-checker',    probe: '/queue',                  flag: 'govMakerChecker' },
    { label: 'Security monitor',     path: 'security-monitor', probe: '/status',                 flag: 'govSecurityMon' },
    { label: 'Cost optimizer',       path: 'cost-optimizer',   probe: '/status',                 flag: 'govCostOpt' },
    { label: 'Concurrency governor', path: 'concurrency',      probe: '/snapshot',               flag: 'govConcurrency' },
    { label: 'Org rate-limiter',     path: 'org-ratelimit',    probe: '/check/_probe/_probe',    flag: 'govOrgRatelimit' },
  ],
  tryIt: {
    method: 'GET',
    url: '/api/nv5/gov/concurrency/snapshot',
    label: 'Fetch concurrency snapshot',
    description: 'Read-only snapshot of in-flight + queued requests per tenant / provider.',
  },
  batch: 'D',
  icon: ShieldCheck,
};

export default function PlatformV5Gov() { return <Nv5NamespacePage cfg={cfg} />; }
