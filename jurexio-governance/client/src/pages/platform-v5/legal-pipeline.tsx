import { Database } from 'lucide-react';
import { Nv5NamespacePage, type NamespaceConfig } from './_shared';

const cfg: NamespaceConfig = {
  slug: 'legal-pipeline',
  title: 'Platform v5 — Legal RAG Pipeline',
  blurb:
    'Session-11 Batch E surface — wires 5 previously-orphan RAG services (chunker, embedding, reranker, summarizer, readability scorer). NV-LLM-001 / NV-ARCH-001: provider-emitting paths (embedding API, LLM summarization, cross-encoder rerank) are NOT exposed. Only deterministic methods (chunk preview, RRF fusion, readability score) are reachable here; the production RAG pipeline still flows through realLLMService.executeRequest.',
  apiPrefix: '/api/nv5/legal-pipeline',
  flagKeys: [
    'legalPipelineChunker', 'legalPipelineEmbedding', 'legalPipelineReranker',
    'legalPipelineSummarizer', 'legalPipelineReadability',
  ],
  subServices: [
    { label: 'Chunker',     path: 'chunker',     probe: '/capabilities', flag: 'legalPipelineChunker' },
    { label: 'Embedding',   path: 'embedding',   probe: '/capabilities', flag: 'legalPipelineEmbedding' },
    { label: 'Reranker',    path: 'reranker',    probe: '/capabilities', flag: 'legalPipelineReranker' },
    { label: 'Summarizer',  path: 'summarizer',  probe: '/capabilities', flag: 'legalPipelineSummarizer' },
    { label: 'Readability', path: 'readability', probe: '/capabilities', flag: 'legalPipelineReadability' },
  ],
  tryIt: {
    method: 'POST',
    url: '/api/nv5/legal-pipeline/readability/score',
    label: 'Score readability of sample legal text',
    description: 'Pure deterministic readability score — no LLM emission.',
    defaultBody: JSON.stringify({
      text: 'The respondent shall, within thirty (30) days of receipt of this notice, file a written reply specifying the grounds upon which the petition is contested.',
    }, null, 2),
  },
  batch: 'E',
  icon: Database,
};

export default function PlatformV5LegalPipeline() { return <Nv5NamespacePage cfg={cfg} />; }
