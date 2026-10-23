import { Activity } from 'lucide-react';
import { Nv5NamespacePage, type NamespaceConfig } from './_shared';

import { NV_BASE, nv } from '../../lib/jrx-api-paths';
const cfg: NamespaceConfig = {
  slug: 'voice',
  title: 'Platform v5 — Voice',
  blurb:
    `Session-10 Batch B voice surface — wires 3 previously-orphan voice files (real-time streaming, voice synthesis engine, enhanced voice). Provider-emitting paths (TTS / STT) delegate to canonical ${NV_BASE}voice/* per NV-ARCH-001 / NV-LLM-001.`,
  apiPrefix: '/api/nv5/voice',
  flagKeys: ['voiceStreamRt', 'voiceSynth', 'voiceEnhanced'],
  subServices: [
    { label: 'Streaming (RT)',  path: 'streaming', probe: '/health', flag: 'voiceStreamRt' },
    { label: 'Synthesis (TTS)', path: 'synthesis', probe: '/health', flag: 'voiceSynth' },
    { label: 'Enhanced',        path: 'enhanced',  probe: '/health', flag: 'voiceEnhanced' },
  ],
  tryIt: {
    method: 'GET',
    url: '/api/nv5/voice/streaming/metrics',
    label: 'Fetch real-time streaming metrics',
    description: 'Read-only metrics snapshot from the real-time voice streaming service.',
  },
  batch: 'B',
  icon: Activity,
};

export default function PlatformV5Voice() { return <Nv5NamespacePage cfg={cfg} />; }
