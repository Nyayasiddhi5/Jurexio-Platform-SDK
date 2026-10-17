import { FileSearch } from 'lucide-react';
import { Nv5NamespacePage, type NamespaceConfig } from './_shared';

const cfg: NamespaceConfig = {
  slug: 'doc-ai',
  title: 'Platform v5 — Document AI',
  blurb:
    'Session-10 Batch C document-AI surface — wires the previously-orphan nv-document-converter-service. Conversion-only; NV-LLM-001 does not apply because the converter is pure (no LLM/provider).',
  apiPrefix: '/api/nv5/doc-ai',
  flagKeys: ['docAiConvert'],
  subServices: [
    { label: 'Converter (jobs)', path: 'convert', probe: '/health',    flag: 'docAiConvert' },
    { label: 'Supported formats', path: 'convert', probe: '/supported', flag: 'docAiConvert' },
  ],
  tryIt: {
    method: 'GET',
    url: '/api/nv5/doc-ai/convert/supported',
    label: 'Fetch supported conversion formats',
    description: 'Read-only listing of supported source/target formats. The action endpoint POST /api/nv5/doc-ai/convert/jobs accepts multipart/form-data file uploads only and is therefore not browser-JSON-invokable from this Console try-it form — exercise it via SDK or the Smoke Harness Console instead.',
  },
  batch: 'C',
  icon: FileSearch,
};

export default function PlatformV5DocAi() { return <Nv5NamespacePage cfg={cfg} />; }
