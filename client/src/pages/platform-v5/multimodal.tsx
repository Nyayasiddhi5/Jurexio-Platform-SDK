import { Sparkles } from 'lucide-react';
import { Nv5NamespacePage, type NamespaceConfig } from './_shared';

import { NV_BASE, nv } from '../../lib/jrx-api-paths';
const cfg: NamespaceConfig = {
  slug: 'multimodal',
  title: 'Platform v5 — Multimodal',
  blurb:
    `Session-10 Batch B multimodal surface — wires 5 previously-orphan multimodal files (Unity / ChatdollKit avatars, advanced multimodal RAG, 3D immersive, generic 3D avatar). Provider-emitting paths (avatar render, vision/RAG inference) delegate to canonical ${NV_BASE}sdk/multimodal/* per NV-ARCH-001 and NV-LLM-001.`,
  apiPrefix: '/api/nv5/multimodal',
  flagKeys: [
    'multimodalAvatarUnity', 'multimodalAvatarChatdoll', 'multimodalRagAdv',
    'multimodal3dImmersive', 'multimodalAvatar3d',
  ],
  subServices: [
    { label: 'Avatar (Unity)',     path: 'avatar-unity',    probe: '/health', flag: 'multimodalAvatarUnity' },
    { label: 'Avatar (Chatdoll)',  path: 'avatar-chatdoll', probe: '/health', flag: 'multimodalAvatarChatdoll' },
    { label: 'Enhanced RAG',       path: 'rag-adv',         probe: '/health', flag: 'multimodalRagAdv' },
    { label: '3D Immersive',       path: '3d-immersive',    probe: '/health', flag: 'multimodal3dImmersive' },
    { label: 'Avatar (3D)',        path: 'avatar-3d',       probe: '/health', flag: 'multimodalAvatar3d' },
  ],
  tryIt: {
    method: 'POST',
    url: '/api/nv5/multimodal/rag-adv/rag/query',
    label: 'Run multimodal RAG query',
    description: `Happy-path action: delegates to the canonical ${NV_BASE}sdk/multimodal/rag/query pipeline (NV-LLM-001 — provider-emitting path goes through realLLMService.executeRequest).`,
    defaultBody: JSON.stringify({
      query: 'Summarise the procedural posture of the matter described in the indexed corpus.',
      top_k: 5,
    }, null, 2),
  },
  batch: 'B',
  icon: Sparkles,
};

export default function PlatformV5Multimodal() { return <Nv5NamespacePage cfg={cfg} />; }
