/**
 * SSoT partner smoke probes for Console dashboard + SDK testing (NSP · NYM · JRX · CNR · docparse).
 */
import { nv } from '@/lib/jrx-api-paths';

export type PartnerSmokeProbe = {
  id: string;
  label: string;
  platform: 'core' | 'nsp' | 'nym' | 'jrx' | 'cnr' | 'docparse';
  path: string;
  method: 'GET' | 'POST';
  sampleBody?: string;
};

export const NV_PARTNER_SMOKE_PROBES: PartnerSmokeProbe[] = [
  { id: 'health', label: 'Gateway health', platform: 'core', path: nv('health'), method: 'GET' },
  { id: 'cnr-health', label: 'CNR subsystem', platform: 'cnr', path: nv('v1/sdk/cnr/health'), method: 'GET' },
  { id: 'llm-health', label: 'LLM router', platform: 'nsp', path: nv('v1/sdk/llm/router/health'), method: 'GET' },
  { id: 'gw-models', label: 'Gateway models', platform: 'nsp', path: nv('gateway/models'), method: 'GET' },
  { id: 'legal-feed', label: 'Legal intelligence feed', platform: 'nsp', path: nv('v1/sdk/legal-intelligence/feed?jurisdiction=IN'), method: 'GET' },
  { id: 'patra-health', label: 'Patra Mitra', platform: 'nym', path: nv('v1/sdk/patra-mitra/health'), method: 'GET' },
  { id: 'docparse-health', label: 'Docparse SDK mount', platform: 'docparse', path: nv('v1/sdk/docparse/health'), method: 'GET' },
  { id: 'jrx-docparse-health', label: 'JRX docparse alias', platform: 'jrx', path: nv('v1/sdk/jrx/docparse/health'), method: 'GET' },
  {
    id: 'cnr-resolve-post',
    label: 'CNR resolve (POST)',
    platform: 'cnr',
    path: nv('v1/sdk/cnr/resolve'),
    method: 'POST',
    sampleBody: JSON.stringify({ identifier: 'TSWL000000742024', options: { profile: 'default', courtType: 'dc' } }, null, 2),
  },
];

export const PLATFORM_LABELS: Record<PartnerSmokeProbe['platform'], string> = {
  core: 'JRX Core',
  nsp: 'NSP',
  nym: 'NYM',
  jrx: 'JRX',
  cnr: 'Case search',
  docparse: 'Docparse',
};
