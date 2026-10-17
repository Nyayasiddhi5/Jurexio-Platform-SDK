// NYV-NS-021 (2026-05-05): pre-existing strict-null cluster (gateway runs via tsx).
import crypto from 'crypto';
import { db as _db } from '../../db/index.js';
import { sdkClauseLibrary, sdkComplianceControls, sdkDocumentTemplates } from '@shared/schema.js';
import { eq } from 'drizzle-orm';
import { nyayavignyaEmbeddingService } from '../document-pipeline/embedding-service.js';
import { agentKeyForDocTask } from './jrx-doc-pipeline-agents.js';
import { extractDocumentText, type ExtractDocInput } from './jrx-doc-content-extractor.js';
import { extractCourtDocumentFields, buildCourtDocFieldBlock } from '../jrx-court-document-fields.js';
import type { CourtDocExtractOptions } from '../jrx-court-document-fields.js';
import {
  heuristicDocumentIntelligence,
  mergeEntityArrays,
  parseIntelligenceJson,
} from './jrx-doc-intel-heuristic.js';
import { type LLMRequest } from '../real-llm-service.js';
import { executeWithFullSafetyRing } from '../../orchestration/jrx-sdk-orchestration-wrapper.js';
import { sdkUsageMeteringService } from './sdk-usage-metering-service.js';

function getDb() {
  if (!_db) throw new Error('Database not initialized');
  return _db;
}

function generateId(prefix: string): string {
  return `${prefix}_${Date.now()}_${crypto.randomUUID().substring(0, 8)}`;
}

/** Dev/UAT keyword-hash vectors when OpenAI embed quota is unavailable. */
function keywordSyntheticEmbedding(text: string, dims = 384): number[] {
  const hash = crypto.createHash('sha256').update(text).digest();
  const vec: number[] = [];
  for (let i = 0; i < dims; i++) {
    vec.push((hash[i % hash.length] / 255) * 2 - 1);
  }
  return vec;
}

function allowKeywordEmbedFallback(): boolean {
  // UAT hardening: allow deterministic keyword-hash embedding fallback when:
  // 1) local dev, 2) explicit fallback toggle, or 3) platform UAT bypass mode.
  return (
    process.env.NODE_ENV === 'development' ||
    process.env.NYV_EMBED_KEYWORD_FALLBACK === '1' ||
    process.env.NV_PLATFORM_UAT_BYPASS === '1'
  );
}

function buildLLMRequest(prompt: string, systemPrompt: string, userId: string = 'sdk'): LLMRequest {
  return {
    id: generateId('llm_req'),
    userId,
    prompt,
    systemPrompt,
    maxTokens: 4096,
    temperature: 0.3,
    requirements: { complexity: 'complex', domain: 'analytical', priority: 'high', costBudget: 'balanced', responseTime: 'balanced', qualityLevel: 'professional' },
    fallbackLevels: 3,
    timestamp: new Date(),
  };
}

export class SdkDocumentPipelineService {
  async extractContent(input: ExtractDocInput): Promise<any> {
    const extracted = await extractDocumentText(input);
    return {
      ...extracted,
      characterCount: extracted.text.length,
      wordCount: extracted.text.split(/\s+/).filter(Boolean).length,
      timestamp: new Date().toISOString(),
    };
  }

  async runFullPipeline(
    input: ExtractDocInput & { jurisdiction?: string; language?: string; includeDraft?: boolean; documents?: Array<{ base64: string; fileName?: string; mimeType?: string }> },
    ctx: any,
    courtExtractOpts?: CourtDocExtractOptions,
  ): Promise<any> {
    const jurisdiction = input.jurisdiction || ctx?.jurisdiction || 'IN';
    const language = input.language || 'en';
    const pipelineId = generateId('pipe');
    const steps: Array<{ step: string; ok: boolean; error?: string; ms?: number }> = [];
    const started = Date.now();

    const mark = (step: string, ok: boolean, error?: string, t0?: number) => {
      steps.push({ step, ok, error, ms: t0 != null ? Date.now() - t0 : undefined });
      if (!ok && error) throw new Error(`Pipeline step "${step}" failed: ${error}`);
    };

    let t0 = Date.now();
    let extracted;
    try {
      extracted = await extractDocumentText(input);
      mark('extract', true, undefined, t0);
    } catch (e: any) {
      mark('extract', false, e?.message || 'extract failed', t0);
      throw e;
    }

    const content = extracted.text;
    const format = extracted.format || 'text';

    t0 = Date.now();
    let parsed;
    try {
      parsed = await this.parseDocument(content, format, jurisdiction, language, ctx);
      mark('parse', true, undefined, t0);
    } catch (e: any) {
      mark('parse', false, e?.message, t0);
      throw e;
    }

    t0 = Date.now();
    let summary;
    try {
      summary = await this.summarizeDocument(content, jurisdiction, 'medium', ctx);
      mark('summarize', true, undefined, t0);
    } catch (e: any) {
      mark('summarize', false, e?.message, t0);
      throw e;
    }

    let draft: any = null;
    if (input.includeDraft) {
      t0 = Date.now();
      try {
        draft = await this.suggestClauses(content.substring(0, 4000), jurisdiction, 'general', ctx);
        mark('draft', true, undefined, t0);
      } catch (e: any) {
        mark('draft', false, e?.message, t0);
        throw e;
      }
    }

    t0 = Date.now();
    let embeddings;
    try {
      embeddings = await this.generateEmbeddings(
        [{ id: parsed.documentId || pipelineId, content: content.substring(0, 8000) }],
        'text-embedding-3-small',
        ctx,
      );
      mark('embed', true, undefined, t0);
    } catch (e: any) {
      mark('embed', false, e?.message, t0);
      throw e;
    }

    t0 = Date.now();
    let intelligence;
    try {
      intelligence = await this.analyzeDocument(
        content,
        jurisdiction,
        ['obligations', 'risks', 'deadlines', 'entities'],
        ctx,
      );
      mark('intelligence', true, undefined, t0);
    } catch (e: any) {
      mark('intelligence', false, e?.message, t0);
      throw e;
    }

    let courtFields: Record<string, unknown> = {};
    if (courtExtractOpts?.bytes?.length) {
      t0 = Date.now();
      try {
        const extraction = await extractCourtDocumentFields(content, jurisdiction, courtExtractOpts);
        courtFields = buildCourtDocFieldBlock(extraction, null, null);
        mark('court_fields', true, undefined, t0);
      } catch (e: any) {
        mark('court_fields', false, e?.message, t0);
      }
    }

    return {
      pipelineId,
      jurisdiction,
      extraction: extracted,
      parse: parsed,
      summarize: summary,
      draft,
      embeddings,
      intelligence,
      courtFields,
      steps,
      totalMs: Date.now() - started,
      timestamp: new Date().toISOString(),
    };
  }

  async parseDocument(content: string, format: string, jurisdiction: string, language: string, ctx: any): Promise<any> {
    const startTime = Date.now();
    const documentId = generateId('doc');
    const wordCount = content.split(/\s+/).length;
    const pageCount = Math.ceil(content.length / 3000);

    let sections: any[] = [];
    let metadata: any = {};

    try {
      const req = buildLLMRequest(
        `Parse and structure this ${format} legal document from ${jurisdiction} jurisdiction (language: ${language}). Extract: document title, author, type, sections with titles and content. Document text:\n\n${content.substring(0, 6000)}`,
        'You are an expert legal document parser. Return a JSON object with fields: title, author, documentType, confidence, sections (array of {title, content}). Return ONLY valid JSON.'
      );
      const llmResponse = await executeWithFullSafetyRing(req, {
        ctx, sdkPlatform: 'doc-pipeline', agentKey: agentKeyForDocTask('document_parse'),
        jurisdiction, taskType: 'document_parse',
        domainContext: `${jurisdiction} ${format} legal document parsing`,
        enableMemory: true,
      });
      const latency = Date.now() - startTime;

      try {
        const jsonMatch = llmResponse.content.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          metadata = { title: parsed.title || 'Parsed Legal Document', author: parsed.author || null, documentType: parsed.documentType || 'legal', confidence: parsed.confidence || 0.85 };
          sections = (parsed.sections || []).map((s: any, i: number) => ({
            id: `sec_${i + 1}`, title: s.title || `Section ${i + 1}`, startPage: Math.max(1, Math.ceil((i * content.length / (parsed.sections?.length || 1)) / 3000)),
            endPage: Math.max(1, Math.ceil(((i + 1) * content.length / (parsed.sections?.length || 1)) / 3000)), content: s.content || ''
          }));
        }
      } catch {
        throw new Error('Document parse: LLM returned non-JSON; cannot structure document');
      }

      if (sections.length === 0) {
        sections = [{
          id: 'sec_1',
          title: metadata.title || 'Document',
          startPage: 1,
          endPage: pageCount,
          content: content.substring(0, 8000),
        }];
      }

      await this.recordUsage(ctx, '/documents/parse', 200, latency, llmResponse.tokens.total, llmResponse.cost, llmResponse.provider, llmResponse.model);

      return {
        documentId, format, jurisdiction, language, pageCount,
        metadata: { ...metadata, createdAt: new Date().toISOString(), detectedLanguage: language, characterCount: content.length, wordCount },
        sections,
        agentId: agentKeyForDocTask('document_parse'),
        llm: { provider: llmResponse.provider, model: llmResponse.model, tokens: llmResponse.tokens, cost: llmResponse.cost, responseTime: llmResponse.responseTime },
        timestamp: new Date().toISOString(),
      };
    } catch (error: any) {
      const latency = Date.now() - startTime;
      await this.recordUsage(ctx, '/documents/parse', 500, latency, 0, 0);
      throw error;
    }
  }

  async analyzeDocument(documentText: string, jurisdiction: string, analysisTypes: string[], ctx: any): Promise<any> {
    const startTime = Date.now();
    const analysisId = generateId('intel');
    const types = analysisTypes?.length
      ? analysisTypes
      : ['obligations', 'risks', 'deadlines', 'entities'];
    const heuristics = heuristicDocumentIntelligence(documentText);

    try {
      const schemaHint = `{
  "obligations":[{"text":"...","type":"obligation"}],
  "risks":[{"text":"...","severity":"high|medium|low"}],
  "deadlines":[{"text":"...","type":"duration|date"}],
  "entities":[{"name":"...","role":"party|organization|governing_law"}],
  "summary":{"overallRiskLevel":"high|medium|low","confidence":0.0}
}`;
      const req = buildLLMRequest(
        `Extract structured legal intelligence for jurisdiction ${jurisdiction}.
Return ONLY valid JSON (no markdown) with keys: ${types.join(', ')}, summary.
Each requested key MUST be a non-empty array of objects when the document supports it.
Schema example:
${schemaHint}

Document:
${documentText.substring(0, 12000)}`,
        `You are a ${jurisdiction} legal document intelligence extractor. Output machine-parseable JSON only. Never wrap in markdown fences. Prefer concrete parties, obligations, risks, and deadlines from the document text.`,
      );
      // Keep JSON extraction lean — RAG/memory often forces prose and empty arrays.
      const llmResponse = await executeWithFullSafetyRing(req, {
        ctx, sdkPlatform: 'doc-pipeline', agentKey: agentKeyForDocTask('document_intelligence'),
        jurisdiction, taskType: 'document_intelligence',
        domainContext: `${jurisdiction} document intelligence JSON: ${types.join(',')}`,
        enableHallucinationCheck: false, enableCitationVerification: false, enableMemory: false, enableRAG: false,
      });
      const latency = Date.now() - startTime;

      let entities: Record<string, any> = {};
      let summary: any = { overallRiskLevel: 'medium', confidence: 0.85 };
      let degraded = false;
      let degradeReason: string | undefined;
      let source: 'llm' | 'heuristic' | 'llm+heuristic' = 'llm';

      const parsed = parseIntelligenceJson(llmResponse.content);
      if (parsed) {
        for (const type of types) {
          if (parsed[type]) entities[type] = parsed[type];
        }
        if (parsed.summary) summary = { ...summary, ...parsed.summary };
      } else {
        degraded = true;
        degradeReason = 'LLM returned non-JSON analysis';
      }

      const missingTypes = types.filter((type) => !entities[type]?.length);
      if (missingTypes.length) {
        entities = mergeEntityArrays(entities, heuristics.entities, types);
        source = parsed ? 'llm+heuristic' : 'heuristic';
        if (missingTypes.length === types.length) {
          summary = { ...heuristics.summary, ...summary };
        }
        // Usable heuristic entities ⇒ NSP can cache; clear hard-fail degrade.
        const usable = types.some((t) => Array.isArray(entities[t]) && entities[t].length > 0);
        if (usable) {
          degraded = false;
          degradeReason = undefined;
        } else {
          degraded = true;
          degradeReason = degradeReason || 'no analysis entities returned';
          for (const type of types) {
            if (!entities[type]) entities[type] = [];
          }
          const prose = String(llmResponse.content || '').trim().slice(0, 4000);
          if (prose) {
            summary = {
              ...summary,
              confidence: Math.min(Number(summary.confidence) || 0.5, 0.55),
              narrative: prose,
              note: 'Structured entity extraction was incomplete; narrative summary provided.',
            };
          }
        }
      }

      await this.recordUsage(ctx, '/documents/intelligence', 200, latency, llmResponse.tokens.total, llmResponse.cost, llmResponse.provider, llmResponse.model);

      return {
        analysisId, jurisdiction, analysisTypes: types, entities,
        agentId: agentKeyForDocTask('document_intelligence'),
        source,
        degraded: degraded || undefined,
        degradeReason: degradeReason || undefined,
        summary: {
          totalObligations: entities.obligations?.length || 0, totalRisks: entities.risks?.length || 0,
          totalDeadlines: entities.deadlines?.length || 0, totalEntities: entities.entities?.length || 0,
          ...summary,
        },
        llm: { provider: llmResponse.provider, model: llmResponse.model, tokens: llmResponse.tokens, cost: llmResponse.cost },
        timestamp: new Date().toISOString(),
      };
    } catch (error: any) {
      // Last-resort: still return heuristic entities (200 path via route fail-soft).
      const latency = Date.now() - startTime;
      await this.recordUsage(ctx, '/documents/intelligence', 200, latency, 0, 0);
      return {
        analysisId,
        jurisdiction,
        analysisTypes: types,
        entities: heuristics.entities,
        agentId: agentKeyForDocTask('document_intelligence'),
        source: 'heuristic',
        summary: {
          totalObligations: heuristics.entities.obligations.length,
          totalRisks: heuristics.entities.risks.length,
          totalDeadlines: heuristics.entities.deadlines.length,
          totalEntities: heuristics.entities.entities.length,
          ...heuristics.summary,
          errorNote: error?.message || 'LLM path failed; heuristic entities returned',
        },
        timestamp: new Date().toISOString(),
      };
    }
  }

  async generateEmbeddings(documents: Array<{ id: string; content: string }>, model: string, ctx: any): Promise<any> {
    const startTime = Date.now();
    const effectiveModel = model || 'text-embedding-3-small';
    const hasOpenAiKey = Boolean(process.env.OPENAI_API_KEY?.trim());
    let totalTokens = 0;
    let totalCost = 0;
    const embeddings: Array<{ id: string; embedding: number[]; dimensions: number; tokenCount: number; provider: string }> = [];
    let usedSynthetic = false;

    for (const doc of documents) {
      if (!doc.content?.trim()) {
        throw new Error(`Embeddings: empty content for document ${doc.id}`);
      }
      if (hasOpenAiKey) {
        try {
          const batch = await nyayavignyaEmbeddingService.generateBatchEmbeddings({
            texts: [doc.content],
            model: effectiveModel,
            provider: 'openai',
          });
          if (batch.errorCount > 0 || batch.embeddings.length === 0) {
            const err = batch.errors[0]?.error || 'OpenAI embedding failed';
            if (!allowKeywordEmbedFallback() || !/429|quota|rate/i.test(err)) {
              throw new Error(`Embeddings: ${err}`);
            }
            usedSynthetic = true;
            const vec = keywordSyntheticEmbedding(doc.content);
            embeddings.push({
              id: doc.id,
              embedding: vec,
              dimensions: vec.length,
              tokenCount: doc.content.split(/\s+/).length,
              provider: 'keyword-hash',
            });
            continue;
          }
          const emb = batch.embeddings[0];
          totalTokens += emb.tokenCount;
          totalCost += emb.cost || 0;
          embeddings.push({
            id: doc.id,
            embedding: emb.embedding,
            dimensions: emb.embedding.length,
            tokenCount: emb.tokenCount,
            provider: emb.provider,
          });
        } catch (error: any) {
          const msg = error?.message || String(error);
          if (allowKeywordEmbedFallback() && /429|quota|rate/i.test(msg)) {
            usedSynthetic = true;
            const vec = keywordSyntheticEmbedding(doc.content);
            embeddings.push({
              id: doc.id,
              embedding: vec,
              dimensions: vec.length,
              tokenCount: doc.content.split(/\s+/).length,
              provider: 'keyword-hash',
            });
            continue;
          }
          throw error;
        }
      } else if (allowKeywordEmbedFallback()) {
        usedSynthetic = true;
        const vec = keywordSyntheticEmbedding(doc.content);
        embeddings.push({
          id: doc.id,
          embedding: vec,
          dimensions: vec.length,
          tokenCount: doc.content.split(/\s+/).length,
          provider: 'keyword-hash',
        });
      } else {
        throw new Error('Embeddings: OPENAI_API_KEY not configured — cannot generate real vectors');
      }
    }

    const latency = Date.now() - startTime;
    await this.recordUsage(ctx, '/documents/embeddings', 200, latency, totalTokens, totalCost, usedSynthetic ? 'keyword-hash' : 'openai', effectiveModel);

    return {
      model: effectiveModel,
      dimensions: embeddings[0]?.dimensions ?? 0,
      provider: usedSynthetic ? 'keyword-hash' : 'openai',
      synthetic: usedSynthetic,
      embeddings,
      usage: { totalTokens, documentsProcessed: documents.length, estimatedCost: totalCost },
      timestamp: new Date().toISOString(),
    };
  }

  async compareDocuments(documentA: string, documentB: string, compareTypes: string[], ctx: any): Promise<any> {
    const startTime = Date.now();
    const comparisonId = generateId('cmp');

    try {
      const req = buildLLMRequest(
        `Compare these two legal documents and identify differences.\nCompare types: ${compareTypes.join(', ')}\n\nDocument A (first 3000 chars):\n${documentA.substring(0, 3000)}\n\nDocument B (first 3000 chars):\n${documentB.substring(0, 3000)}`,
        'You are a legal document comparison engine. Return JSON with: similarityScore (0-1), differences (array of {type: addition|modification|deletion, section, description, severity: high|medium|low}). Return ONLY valid JSON.'
      );
      const llmResponse = await executeWithFullSafetyRing(req, {
        ctx, sdkPlatform: 'doc-pipeline', agentKey: agentKeyForDocTask('document_compare'),
        taskType: 'document_compare',
        domainContext: `Legal document comparison: ${compareTypes.join(',')}`,
        enableHallucinationCheck: true, enableMemory: true,
      });
      const latency = Date.now() - startTime;

      let result: any = { similarityScore: 0.75, differences: [] };
      try {
        const jsonMatch = llmResponse.content.match(/\{[\s\S]*\}/);
        if (jsonMatch) result = { ...result, ...JSON.parse(jsonMatch[0]) };
      } catch {
        throw new Error('Document compare: LLM returned non-JSON comparison');
      }

      await this.recordUsage(ctx, '/documents/compare', 200, latency, llmResponse.tokens.total, llmResponse.cost, llmResponse.provider, llmResponse.model);

      return {
        comparisonId, compareTypes, ...result,
        agentId: agentKeyForDocTask('document_compare'),
        summary: {
          totalDifferences: result.differences.length,
          additions: result.differences.filter((d: any) => d.type === 'addition').length,
          modifications: result.differences.filter((d: any) => d.type === 'modification').length,
          deletions: result.differences.filter((d: any) => d.type === 'deletion').length,
          documentALength: documentA.length, documentBLength: documentB.length,
        },
        llm: { provider: llmResponse.provider, model: llmResponse.model, tokens: llmResponse.tokens },
        timestamp: new Date().toISOString(),
      };
    } catch (error: any) {
      await this.recordUsage(ctx, '/documents/compare', 500, Date.now() - startTime, 0, 0);
      throw error;
    }
  }

  async summarizeDocument(documentText: string, jurisdiction: string, length: string, ctx: any): Promise<any> {
    const startTime = Date.now();
    const summaryId = generateId('sum');
    const targetWords: Record<string, number> = { short: 150, medium: 400, long: 800 };

    try {
      const req = buildLLMRequest(
        `Summarize this ${jurisdiction} legal document in ${length} format (~${targetWords[length] || 400} words). Extract key points.\n\nDocument:\n${documentText.substring(0, 8000)}`,
        `You are a legal document summarizer for ${jurisdiction} jurisdiction. Return JSON with: summary (string), keyPoints (array of strings, 3-7 items). Return ONLY valid JSON.`
      );
      const llmResponse = await executeWithFullSafetyRing(req, {
        ctx, sdkPlatform: 'doc-pipeline', agentKey: agentKeyForDocTask('document_summarize'),
        jurisdiction, taskType: 'document_summarize',
        domainContext: `${jurisdiction} legal document summarization (${length})`,
        enableMemory: true,
      });
      const latency = Date.now() - startTime;

      let summary = '';
      let keyPoints: string[] = [];
      /* NV-DOC-SUMMARY-ENVELOPE-001 — strip a fenced wrapper before parsing.
       *
       * The previous `match(/\{[\s\S]*\}/)` matched the JSON *inside* a
       * ```json fence, but when the model returned an orchestration-style
       * envelope (`{"agentId":"A-129","agentName":"Document Assembly Agent",...}`)
       * instead of `{summary,keyPoints}`, `parsed.summary` was undefined and the
       * `||` fallback assigned the **entire raw envelope** to `summary`. Measured
       * live: a partner summarize call returned a user-visible summary beginning
       * "```json {\"agentId\": \"A-129\" …" — internal agent ids leaked into
       * customer-facing text. Reuses the fence-strip already used by
       * `nv-ecosystem-document-job-service.ts` (NV-NO-DUPLICATE-001). */
      const cleaned = String(llmResponse.content || '').replace(/```json\s*|```/gi, '').trim();
      try {
        const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          /* Only accept a STRING summary. An envelope has no `summary`, and
           * falling back to raw content here is what leaked the envelope. */
          if (typeof parsed.summary === 'string' && parsed.summary.trim()) {
            summary = parsed.summary;
          }
          if (Array.isArray(parsed.keyPoints)) {
            keyPoints = parsed.keyPoints.filter((k: unknown) => typeof k === 'string');
          }
        }
      } catch {
        /* not JSON — handled below */
      }

      /* Prose (not JSON) is a perfectly good summary; an envelope is not. Accept
       * the raw text only when it does not look like a machine envelope. */
      if (!summary.trim() && cleaned && !/^\s*[{[]/.test(cleaned) && !/"agent(Id|Name)"/.test(cleaned)) {
        summary = cleaned;
      }

      /* NV-DOC-SUMMARY-ENVELOPE-001 — last-resort truncation must be DECLARED.
       *
       * This branch returns the document's own opening words, which is an extract,
       * not a summary. Previously it was returned as `summary` with
       * `confidence: 0.91` and no marker, so a caller could not tell a real summary
       * from a truncation — and `keyPoints` was `words.filter(w => w.length > 4)`,
       * i.e. a list of long words presented as legal key points. Both are corrected:
       * the degradation is flagged so NSP can decide whether to show or retry. */
      let degraded = false;
      if (!summary?.trim()) {
        const words = documentText.trim().split(/\s+/).filter(Boolean);
        const limit = targetWords[length] || 150;
        summary = words.slice(0, limit).join(' ');
        if (words.length > limit) summary += ' […]';
        keyPoints = [];
        degraded = true;
      }

      if (!summary?.trim()) {
        throw new Error('Document summarize: empty summary from LLM');
      }

      await this.recordUsage(ctx, '/documents/summarize', 200, latency, llmResponse.tokens.total, llmResponse.cost, llmResponse.provider, llmResponse.model);

      return {
        summaryId, jurisdiction, length, summary, keyPoints,
        agentId: agentKeyForDocTask('document_summarize'),
        ...(degraded ? { degraded: true, degradedReason: 'model_returned_unusable_summary_extract_only' } : {}),
        metadata: {
          originalLength: documentText.length, summaryLength: summary.split(/\s+/).length,
          compressionRatio: parseFloat((summary.split(/\s+/).length / documentText.split(/\s+/).length).toFixed(2)),
          /* Do not claim 0.91 for a truncation. */
          confidence: degraded ? 0.2 : 0.91,
        },
        llm: { provider: llmResponse.provider, model: llmResponse.model, tokens: llmResponse.tokens },
        timestamp: new Date().toISOString(),
      };
    } catch (error: any) {
      await this.recordUsage(ctx, '/documents/summarize', 500, Date.now() - startTime, 0, 0);
      throw error;
    }
  }

  async getTemplates(jurisdiction: string, ctx: any): Promise<any> {
    const latency = Date.now();
    // NYV-AUDIT-F10 (2026-05-05): same bug as F7 — sdkDocumentTemplates has no
    // `status` column (only is_system). Drizzle's eq(undefined, 'active')
    // produced `WHERE = 'active'` → 500 syntax error. No soft-delete on this
    // table, so an unfiltered select returns the canonical template set.
    const templates = await getDb().select().from(sdkDocumentTemplates);

    await this.recordUsage(ctx, '/documents/templates', 200, Date.now() - latency, 0, 0);

    return {
      jurisdiction, total: templates.length,
      templates: templates.map(t => ({ id: t.templateId, name: t.name, category: t.category, jurisdiction: t.jurisdiction, languages: t.languages, version: t.version, lastUpdated: t.updatedAt })),
      timestamp: new Date().toISOString(),
    };
  }

  async getClauseLibrary(jurisdiction: string, category: string | undefined, page: number, limit: number, ctx: any): Promise<any> {
    const latencyStart = Date.now();
    // NYV-AUDIT-F7 (2026-05-05): sdkClauseLibrary has no `status` column in the
    // canonical schema (only is_system). Previous .where(eq(...status, 'active'))
    // generated `WHERE  = 'active'` (Drizzle interpolates undefined columns as
    // empty) → 500 SQL syntax error. Selecting all rows is correct here — there
    // is no soft-delete on the clause library.
    const allClauses = await getDb().select().from(sdkClauseLibrary);
    const filtered = category ? allClauses.filter(c => c.category === category) : allClauses;
    const start = (page - 1) * limit;
    const paginated = filtered.slice(start, start + limit);

    await this.recordUsage(ctx, '/clauses/library', 200, Date.now() - latencyStart, 0, 0);

    return {
      jurisdiction, category: category || 'all', page, limit,
      total: filtered.length, totalPages: Math.ceil(filtered.length / limit),
      clauses: paginated.map(c => ({ id: c.clauseId, title: c.title, category: c.category, jurisdiction, risk: c.risk, popularity: c.popularity })),
      timestamp: new Date().toISOString(),
    };
  }

  async getClauseDetail(clauseId: string, ctx: any): Promise<any> {
    const latencyStart = Date.now();
    const clauses = await getDb().select().from(sdkClauseLibrary).where(eq(sdkClauseLibrary.clauseId, clauseId));
    await this.recordUsage(ctx, `/clauses/${clauseId}`, 200, Date.now() - latencyStart, 0, 0);

    if (clauses.length === 0) return null;
    const c = clauses[0];
    return {
      id: c.clauseId, title: c.title, category: c.category, description: c.description,
      defaultText: c.defaultText, jurisdictionVariants: c.jurisdictionVariants,
      tags: c.tags, lastUpdated: c.updatedAt, version: c.version,
    };
  }

  async suggestClauses(documentContext: string, jurisdiction: string, contractType: string, ctx: any): Promise<any> {
    const startTime = Date.now();
    const suggestionId = generateId('sug');

    try {
      // NYV-AUDIT-F7-EXT (2026-05-07): same fix as line 282 — sdkClauseLibrary
      // has no `status` column; selecting all rows is correct (no soft-delete).
      const clauses = await getDb().select().from(sdkClauseLibrary);

      const req = buildLLMRequest(
        `Given this ${contractType} contract context from ${jurisdiction} jurisdiction, rank the most relevant clauses from the library and explain why each is important.\n\nContext:\n${documentContext.substring(0, 3000)}\n\nAvailable clauses: ${clauses.map(c => `${c.clauseId}: ${c.title} (${c.category})`).join(', ')}`,
        `You are a legal clause recommendation engine for ${jurisdiction}. Return JSON with: suggestions (array of {clauseId, relevance (0-1), reason}). Order by relevance descending. Return ONLY valid JSON.`
      );
      const llmResponse = await executeWithFullSafetyRing(req, {
        ctx, sdkPlatform: 'doc-pipeline', agentKey: agentKeyForDocTask('clause_recommend'),
        jurisdiction, taskType: 'clause_recommend',
        domainContext: `${jurisdiction} ${contractType} clause recommendation`,
        enableRAG: true, enableMemory: true,
      });
      const latency = Date.now() - startTime;

      let suggestions: any[] = [];
      try {
        const jsonMatch = llmResponse.content.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          suggestions = (parsed.suggestions || []).map((s: any) => {
            const clause = clauses.find(c => c.clauseId === s.clauseId);
            return { clauseId: s.clauseId, title: clause?.title || s.clauseId, relevance: s.relevance || 0.8, reason: s.reason || '' };
          });
        }
      } catch {
        throw new Error('Clause suggest: LLM returned non-JSON suggestions');
      }

      if (suggestions.length === 0) {
        throw new Error('Clause suggest: no clause suggestions returned');
      }

      await this.recordUsage(ctx, '/clauses/suggest', 200, latency, llmResponse.tokens.total, llmResponse.cost, llmResponse.provider, llmResponse.model);

      return {
        suggestionId, contractType, jurisdiction, suggestions,
        agentId: agentKeyForDocTask('clause_recommend'),
        metadata: { contextLength: documentContext.length, modelConfidence: 0.91, totalClausesEvaluated: clauses.length },
        llm: { provider: llmResponse.provider, model: llmResponse.model, tokens: llmResponse.tokens },
        timestamp: new Date().toISOString(),
      };
    } catch (error: any) {
      await this.recordUsage(ctx, '/clauses/suggest', 500, Date.now() - startTime, 0, 0);
      throw error;
    }
  }

  async complianceCheck(documentText: string, jurisdiction: string, frameworks: string[], ctx: any): Promise<any> {
    const startTime = Date.now();
    const checkId = generateId('comp');

    try {
      // NYV-AUDIT-F7-EXT (2026-05-07): sdkComplianceControls schema has no
      // `isActive` column (canonical schema in shared/schema.ts:177-189 has
      // controlId/framework/jurisdiction/title/category/severity/requirements/
      // automationLevel + timestamps only). Drizzle interpolates the missing
      // column as empty → `WHERE  = $1` → 500 SQL syntax error. Selecting all
      // controls is correct — there is no soft-delete on this table.
      const controls = await getDb().select().from(sdkComplianceControls);

      const relevantControls = controls.filter(c =>
        frameworks.some(f => (c.framework ?? '').toLowerCase() === (f ?? '').toLowerCase()) ||
        c.jurisdiction === jurisdiction || c.jurisdiction === 'GLOBAL'
      );

      const req = buildLLMRequest(
        `Check this legal document for compliance with these frameworks: ${frameworks.join(', ')} under ${jurisdiction} jurisdiction.\n\nDocument (first 5000 chars):\n${documentText.substring(0, 5000)}\n\nRelevant controls: ${relevantControls.map(c => `${c.controlId}: ${c.title}`).join(', ')}`,
        `You are a legal compliance checker. Return JSON with: findings (array of {framework, status: compliant|partially_compliant|non_compliant, score (0-1), issues (array of {severity: high|medium|low, description, recommendation})}). Return ONLY valid JSON.`
      );
      const llmResponse = await executeWithFullSafetyRing(req, {
        ctx, sdkPlatform: 'doc-pipeline', agentKey: agentKeyForDocTask('compliance_check'),
        jurisdiction, taskType: 'compliance_check',
        domainContext: `${jurisdiction} compliance: ${frameworks.join(',')}`,
        enableHITL: true, enableHallucinationCheck: true,
        enableCitationVerification: true, enableRAG: true,
      });
      const latency = Date.now() - startTime;

      let findings: any[] = [];
      try {
        const jsonMatch = llmResponse.content.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          findings = parsed.findings || [];
        }
      } catch {
        throw new Error('Compliance check: LLM returned non-JSON findings');
      }

      if (findings.length === 0) {
        throw new Error('Compliance check: no findings returned from LLM');
      }

      const overallScore = parseFloat((findings.reduce((sum: number, f: any) => sum + (f.score || 0.7), 0) / findings.length).toFixed(2));

      await this.recordUsage(ctx, '/documents/compliance-check', 200, latency, llmResponse.tokens.total, llmResponse.cost, llmResponse.provider, llmResponse.model);

      return {
        checkId, jurisdiction, frameworks, overallScore,
        agentId: agentKeyForDocTask('compliance_check'),
        overallStatus: overallScore >= 0.9 ? 'compliant' : overallScore >= 0.7 ? 'partially_compliant' : 'non_compliant',
        findings,
        summary: {
          totalIssues: findings.reduce((sum: number, f: any) => sum + (f.issues?.length || 0), 0),
          highSeverity: findings.reduce((sum: number, f: any) => sum + (f.issues?.filter((i: any) => i.severity === 'high')?.length || 0), 0),
          mediumSeverity: findings.reduce((sum: number, f: any) => sum + (f.issues?.filter((i: any) => i.severity === 'medium')?.length || 0), 0),
          lowSeverity: findings.reduce((sum: number, f: any) => sum + (f.issues?.filter((i: any) => i.severity === 'low')?.length || 0), 0),
          frameworksChecked: frameworks.length,
          controlsEvaluated: relevantControls.length,
        },
        llm: { provider: llmResponse.provider, model: llmResponse.model, tokens: llmResponse.tokens },
        timestamp: new Date().toISOString(),
      };
    } catch (error: any) {
      await this.recordUsage(ctx, '/documents/compliance-check', 500, Date.now() - startTime, 0, 0);
      throw error;
    }
  }

  private async recordUsage(ctx: any, endpoint: string, statusCode: number, latencyMs: number, tokensUsed: number, cost: number, provider?: string, model?: string): Promise<void> {
    if (!ctx) return;
    try {
      await sdkUsageMeteringService.recordRequest({
        applicationId: ctx.applicationId, organizationId: ctx.organizationId, apiKeyId: ctx.apiKeyId,
        endpoint, method: 'POST', statusCode, latencyMs, tokensUsed, inputTokens: Math.ceil(tokensUsed * 0.7),
        outputTokens: Math.ceil(tokensUsed * 0.3), estimatedCost: cost, llmProvider: provider, llmModel: model,
        requestId: ctx.requestId || generateId('req'),
      });
    } catch { /* non-blocking */ }
  }
}

export const sdkDocumentPipelineService = new SdkDocumentPipelineService();
