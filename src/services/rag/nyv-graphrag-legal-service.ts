// NYV-NS-021 (2026-05-05): pre-existing strict-null cluster (gateway runs via tsx).
/**
 * NYV Legal GraphRAG Service v1.0.0
 * ─────────────────────────────────────────────────────────────────────────────
 * Knowledge graph extraction and traversal over legal documents.
 *
 * ENTITY TYPES:
 *   - Statute        (e.g., "Indian Penal Code 1860")
 *   - Section        (e.g., "Section 420 IPC")
 *   - Party          (e.g., "State of Maharashtra", "XYZ Corporation")
 *   - Court          (e.g., "Supreme Court of India")
 *   - Judgment       (e.g., "AIR 2023 SC 1234")
 *   - Obligation     (e.g., "must file return within 30 days")
 *   - Right          (e.g., "right to bail under Section 437")
 *   - Penalty        (e.g., "fine up to ₹50,000")
 *   - Concept        (e.g., "mens rea", "force majeure", "good faith")
 *   - Jurisdiction   (e.g., "IN", "UK", "EU")
 *
 * EDGE TYPES:
 *   - cites         (Judgment → Statute / Judgment → Judgment)
 *   - amends        (Act → Act / Section → Section)
 *   - supersedes    (Regulation → Regulation)
 *   - defines       (Section → Concept)
 *   - conflicts_with (Provision → Provision)
 *   - derives_from  (Rule → Act)
 *   - interpreted_by (Section → Judgment)
 *   - applies_to    (Provision → Party type)
 *   - governed_by   (Matter → Jurisdiction)
 *   - part_of       (Section → Act)
 *
 * MULTI-HOP TRAVERSAL:
 *   Query: "force majeure in construction contracts"
 *   → Entity "force majeure" (Concept)
 *   → Edge: defined_by → "Section 32 Indian Contract Act" (Section)
 *   → Edge: part_of → "Indian Contract Act 1872" (Statute)
 *   → Edge: interpreted_by → [Supreme Court judgments] (Judgment[])
 *   → Edge: cited_in → [High Court orders] (Judgment[])
 *
 * STORAGE: PostgreSQL (nv_schema) with JSONB for adjacency list.
 *          Optional pgvector for entity similarity search.
 *
 * INTEGRATION: Called by NyvDocumentIntelligenceOrchestrator during indexing.
 *              Called by NyvEnhancedRAGPipeline during query time.
 *
 * @module nyv-graphrag-legal-service
 * @version 1.0.0
 */

import crypto from 'crypto';
import { EventEmitter } from 'events';
import { db as _raw_db } from '../../db/index.js';
import { lazyRequire } from '../../utils/jrx-type-helpers.js';
const db = lazyRequire(() => _raw_db, 'db');
import { sql } from 'drizzle-orm';
import { createLogger } from '../../utils/logger.js';
import { getEntityMerger } from './nyv-entity-merger.js';

const logger = createLogger('nyv-graphrag-legal');

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

export type LegalEntityType =
  | 'statute' | 'section' | 'party' | 'court' | 'judgment'
  | 'obligation' | 'right' | 'penalty' | 'concept' | 'jurisdiction'
  | 'definition' | 'regulation' | 'treaty' | 'directive' | 'article';

export type LegalEdgeType =
  | 'cites' | 'amends' | 'supersedes' | 'defines' | 'conflicts_with'
  | 'derives_from' | 'interpreted_by' | 'applies_to' | 'governed_by'
  | 'part_of' | 'related_to' | 'overrules' | 'upholds' | 'modifies';

export interface LegalEntity {
  id: string;                    // SHA-256 of normalizedValue + type
  type: LegalEntityType;
  value: string;                 // e.g., "Section 420 IPC"
  normalizedValue: string;       // lowercase, punctuation-free
  jurisdiction?: string;
  statute?: string;
  section?: string;
  year?: number;
  aliases?: string[];
  docIds: string[];              // Documents where this entity appears
  metadata?: Record<string, any>;
}

export interface LegalEdge {
  id: string;
  sourceId: string;
  targetId: string;
  edgeType: LegalEdgeType;
  weight: number;               // 0–1, strength of relationship
  docId?: string;               // Source document for this edge
  confidence: number;           // 0–1, extraction confidence
  createdAt: string;
}

export interface GraphSearchResult {
  entityId: string;
  entityType: LegalEntityType;
  entityValue: string;
  relatedStatutes: string[];
  relatedSections: string[];
  connectedDocIds: string[];
  hopCount: number;
  score: number;
}

export interface IndexDocumentResult {
  docId: string;
  nodesAdded: number;
  edgesAdded: number;
  entitiesExtracted: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// SCHEMA
// ─────────────────────────────────────────────────────────────────────────────

async function ensureGraphSchema(): Promise<void> {
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS nv_schema.nv_legal_graph_entities (
        id              TEXT PRIMARY KEY,
        org_id          TEXT,
        type            TEXT NOT NULL,
        value           TEXT NOT NULL,
        normalized_value TEXT NOT NULL,
        jurisdiction    TEXT,
        statute         TEXT,
        section         TEXT,
        year            INTEGER,
        aliases         JSONB DEFAULT '[]'::jsonb,
        doc_ids         JSONB DEFAULT '[]'::jsonb,
        metadata        JSONB DEFAULT '{}'::jsonb,
        embedding       vector(1536),
        created_at      TIMESTAMPTZ DEFAULT NOW(),
        updated_at      TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS nv_schema.nv_legal_graph_edges (
        id            TEXT PRIMARY KEY,
        org_id        TEXT,
        source_id     TEXT NOT NULL REFERENCES nv_schema.nv_legal_graph_entities(id) ON DELETE CASCADE,
        target_id     TEXT NOT NULL REFERENCES nv_schema.nv_legal_graph_entities(id) ON DELETE CASCADE,
        edge_type     TEXT NOT NULL,
        weight        FLOAT DEFAULT 1.0,
        doc_id        TEXT,
        confidence    FLOAT DEFAULT 0.8,
        created_at    TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    try {
      await db.execute(sql`ALTER TABLE nv_schema.nv_legal_graph_entities ADD COLUMN IF NOT EXISTS org_id TEXT`);
      await db.execute(sql`ALTER TABLE nv_schema.nv_legal_graph_edges ADD COLUMN IF NOT EXISTS org_id TEXT`);
    } catch (alterErr: any) {
      logger.debug('graph_schema_alter_skipped', { error: alterErr.message });
    }
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_graph_entities_type ON nv_schema.nv_legal_graph_entities (type);
      CREATE INDEX IF NOT EXISTS idx_graph_entities_norm ON nv_schema.nv_legal_graph_entities (normalized_value);
      CREATE INDEX IF NOT EXISTS idx_graph_entities_jur ON nv_schema.nv_legal_graph_entities (jurisdiction);
      CREATE INDEX IF NOT EXISTS idx_graph_entities_org ON nv_schema.nv_legal_graph_entities (org_id);
      CREATE INDEX IF NOT EXISTS idx_graph_edges_source ON nv_schema.nv_legal_graph_edges (source_id);
      CREATE INDEX IF NOT EXISTS idx_graph_edges_target ON nv_schema.nv_legal_graph_edges (target_id);
      CREATE INDEX IF NOT EXISTS idx_graph_edges_type ON nv_schema.nv_legal_graph_edges (edge_type);
      CREATE INDEX IF NOT EXISTS idx_graph_edges_org ON nv_schema.nv_legal_graph_edges (org_id);
    `).catch((err: any) => {
      logger.debug('graph_index_creation_partial', { error: err.message });
    });
  } catch (err: any) {
    logger.warn('graph_schema_init_warning', { error: err.message });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// ENTITY EXTRACTION PATTERNS
// ─────────────────────────────────────────────────────────────────────────────

const STATUTE_PATTERNS = [
  // Indian statutes (BNS 2023 / BNSS 2023 / BSA 2023 — current law)
  /\b(Bharatiya Nyaya Sanhita|BNS)\s*[,\s]*(?:2023|Section\s*\d+)?/gi,
  /\b(Bharatiya Nagarik Suraksha Sanhita|BNSS)\s*[,\s]*(?:2023|Section\s*\d+)?/gi,
  /\b(Bharatiya Sakshya Adhiniyam|BSA)\s*[,\s]*(?:2023|Section\s*\d+)?/gi,
  // Indian statutes (legacy — will be mapped to current via EntityMerger)
  /\b(Indian Penal Code|IPC)\s*[,\s]*(?:1860|Section\s*\d+)?/gi,
  /\b(Code of Criminal Procedure|CrPC|CPC)\s*[,\s]*(?:1973|1908)?/gi,
  /\b(Indian Contract Act)\s*[,\s]*(?:1872)?/gi,
  /\b(Companies Act)\s*[,\s]*(?:2013|1956)?/gi,
  /\b(SEBI Act|Securities Exchange Board of India Act)\s*[,\s]*(?:1992)?/gi,
  /\b(Information Technology Act|IT Act)\s*[,\s]*(?:2000)?/gi,
  /\b(GST|CGST|IGST|SGST)\s*Act\s*[,\s]*(?:2017)?/gi,
  /\b(DPDP Act|Digital Personal Data Protection Act)\s*[,\s]*(?:2023)?/gi,
  // UK statutes
  /\b(Contracts \(Rights of Third Parties\) Act)\s*(?:1999)?/gi,
  /\b(Sale of Goods Act)\s*(?:1979)?/gi,
  /\b(UK GDPR|Data Protection Act)\s*(?:2018)?/gi,
  // EU
  /\b(GDPR|General Data Protection Regulation)\b/gi,
  /\b(EU AI Act)\b/gi,
  // US
  /\b(Sherman Act|Clayton Act|Dodd-Frank Act|Sarbanes-Oxley Act|SOX)\b/gi,
];

const SECTION_PATTERNS = [
  /\b[Ss]ection\s+(\d+[A-Z]?(?:\(\w+\))?(?:\s+of\s+[\w\s]+)?)/g,
  /\b[Aa]rticle\s+(\d+(?:\(\d+\))?)/g,
  /\b[Rr]ule\s+(\d+(?:\(\d+\))?)/g,
  /\b[Cc]lause\s+(\d+(?:\.\d+)*)/g,
  /\bS\.?\s*(\d+[A-Z]?)\b/g,   // S.420, S.302 etc.
];

const CITATION_PATTERNS = [
  /\((\d{4})\)\s+(?:SCC|SCR|AIR|Cri\s*LJ|MLJ|All\s*ER|QB|AC|WLR)\s+[\w\s]+/gi,
  /AIR\s+(\d{4})\s+(SC|HC|Bom|Del|Mad|Cal|All|Pat|Raj|Ker|AP|MP)\s+\d+/gi,
  /\[(\d{4})\]\s+(?:EWCA|EWHC|UKSC|UKHL)\s+[\w\s]+/gi,
];

const CONCEPT_PATTERNS = [
  /\b(force majeure|mens rea|actus reus|res judicata|stare decisis|ultra vires|bona fide|mala fide|ex parte|in limine)\b/gi,
  /\b(good faith|due diligence|reasonable care|standard of care|breach of contract|tortious liability)\b/gi,
  /\b(liquidated damages|indemnification|limitation of liability|intellectual property|trade secret|copyright|trademark|patent)\b/gi,
  /\b(habeas corpus|mandamus|certiorari|prohibition|quo warranto)\b/gi,
];

// ─────────────────────────────────────────────────────────────────────────────
// MAIN SERVICE
// ─────────────────────────────────────────────────────────────────────────────

export class NyvGraphRAGLegalService extends EventEmitter {
  private static instance: NyvGraphRAGLegalService;
  private schemaReady = false;

  static getInstance(): NyvGraphRAGLegalService {
    if (!this.instance) this.instance = new NyvGraphRAGLegalService();
    return this.instance;
  }

  async init(): Promise<void> {
    if (this.schemaReady) return;
    await ensureGraphSchema();
    this.schemaReady = true;
    logger.info('graphrag_ready');
  }

  // ── INDEX DOCUMENT ────────────────────────────────────────────────────────

  async indexDocument(params: {
    docId: string;
    text: string;
    fileName: string;
    jurisdiction: string;
    documentClass?: string;
    orgId?: string;
  }): Promise<IndexDocumentResult> {
    await this.init();
    const { docId, text, fileName, jurisdiction, documentClass, orgId } = params;

    const regexEntities = this.extractEntities(text, jurisdiction, docId);
    const llmEntities = await this.extractEntitiesViaLLM(text, jurisdiction, docId);
    const entityMap = new Map<string, LegalEntity>();
    for (const e of regexEntities) entityMap.set(e.id, e);
    for (const e of llmEntities) { if (!entityMap.has(e.id)) entityMap.set(e.id, e); }

    const entityMerger = getEntityMerger();
    const mergeableEntities = Array.from(entityMap.values()).map(e => ({
      id: e.id,
      type: e.type,
      value: e.value,
      normalizedValue: e.normalizedValue,
      aliases: e.aliases || [],
      jurisdiction: e.jurisdiction,
      docIds: e.docIds,
      importance: 0.7,
      metadata: e.metadata || {},
    }));
    const mergeResult = entityMerger.merge(mergeableEntities);
    if (mergeResult.mergedCount > 0 || mergeResult.statueRemappings > 0) {
      logger.info(`[GraphRAG] EntityMerger: merged ${mergeResult.mergedCount} entities (${mergeResult.statueRemappings} statute remappings)`);
    }
    for (const group of mergeResult.mergeGroups) {
      for (const mergedId of group.mergedIds) {
        entityMap.delete(mergedId);
      }
      const canonical = entityMap.get(group.canonicalId);
      if (canonical) {
        const merged = mergeableEntities.find(e => e.id === group.canonicalId);
        if (merged) {
          canonical.value = merged.value;
          canonical.normalizedValue = merged.normalizedValue;
          canonical.aliases = merged.aliases;
          for (const docId2 of merged.docIds) {
            if (!canonical.docIds.includes(docId2)) canonical.docIds.push(docId2);
          }
        }
      }
    }

    const entities = Array.from(entityMap.values());
    const edges = this.inferEdges(entities, docId);

    let nodesAdded = 0;
    let edgesAdded = 0;

    // Upsert entities
    for (const entity of entities) {
      try {
        await db.execute(sql`
          INSERT INTO nv_schema.nv_legal_graph_entities
            (id, org_id, type, value, normalized_value, jurisdiction, statute, section, year, aliases, doc_ids, metadata)
          VALUES (
            ${entity.id}, ${orgId ?? null}, ${entity.type}, ${entity.value}, ${entity.normalizedValue},
            ${entity.jurisdiction ?? null}, ${entity.statute ?? null}, ${entity.section ?? null},
            ${entity.year ?? null}, ${JSON.stringify(entity.aliases ?? [])},
            ${JSON.stringify([docId])}, ${JSON.stringify(entity.metadata ?? {})}
          )
          ON CONFLICT (id) DO UPDATE SET
            doc_ids = (
              SELECT jsonb_agg(DISTINCT v) FROM jsonb_array_elements_text(
                nv_schema.nv_legal_graph_entities.doc_ids || ${JSON.stringify([docId])}::jsonb
              ) AS v
            ),
            updated_at = NOW()
        `);
        nodesAdded++;
      } catch (err: any) {
        logger.debug('graph_entity_upsert_failed', { entityId: entity.id, error: err.message });
      }
    }

    // Upsert edges
    for (const edge of edges) {
      try {
        await db.execute(sql`
          INSERT INTO nv_schema.nv_legal_graph_edges (id, org_id, source_id, target_id, edge_type, weight, doc_id, confidence)
          VALUES (${edge.id}, ${orgId ?? null}, ${edge.sourceId}, ${edge.targetId}, ${edge.edgeType}, ${edge.weight}, ${docId}, ${edge.confidence})
          ON CONFLICT (id) DO NOTHING
        `);
        edgesAdded++;
      } catch (err: any) {
        logger.debug('graph_edge_upsert_failed', { edgeId: edge.id, error: err.message });
      }
    }

    logger.info('document_graph_indexed', { docId, nodesAdded, edgesAdded });
    return { docId, nodesAdded, edgesAdded, entitiesExtracted: entities.length };
  }

  // ── SEARCH ────────────────────────────────────────────────────────────────

  async search(query: string, orgId: string, userId: string, maxResults = 5): Promise<GraphSearchResult[]> {
    await this.init();

    // Extract entities from the query
    const queryEntities = this.extractEntities(query, 'global', 'query');
    if (!queryEntities.length) return [];

    const results: GraphSearchResult[] = [];

    for (const queryEntity of queryEntities.slice(0, 3)) {
      try {
        const matches = await db.execute(sql`
          SELECT id, type, value, jurisdiction, statute, section, doc_ids
          FROM nv_schema.nv_legal_graph_entities
          WHERE normalized_value ILIKE ${'%' + queryEntity.normalizedValue.slice(0, 30) + '%'}
            AND (org_id = ${orgId} OR org_id IS NULL)
          LIMIT 5
        `);
        const matchRows = ((matches as any).rows ?? matches ?? []);

        for (const match of matchRows) {
          const neighbors = await this.traverse(match.id, 2, orgId);

          let docIds: string[] = [];
          try { docIds = typeof match.doc_ids === 'string' ? JSON.parse(match.doc_ids) : (match.doc_ids ?? []); } catch { docIds = []; }

          results.push({
            entityId: match.id,
            entityType: match.type as LegalEntityType,
            entityValue: match.value,
            relatedStatutes: neighbors.filter(n => n.type === 'statute').map(n => n.value),
            relatedSections: neighbors.filter(n => n.type === 'section').map(n => n.value),
            connectedDocIds: docIds,
            hopCount: 2,
            score: 0.85,
          });
        }
      } catch (err: any) {
        logger.warn('graph_search_entity_failed', { entity: queryEntity.normalizedValue, error: err.message });
      }
    }

    return results.slice(0, maxResults);
  }

  // ── TRAVERSE GRAPH ────────────────────────────────────────────────────────

  async traverse(entityId: string, maxHops = 3, orgId?: string): Promise<LegalEntity[]> {
    const visited = new Set<string>([entityId]);
    const queue: Array<{ id: string; hop: number }> = [{ id: entityId, hop: 0 }];
    const result: LegalEntity[] = [];

    while (queue.length > 0) {
      const { id, hop } = queue.shift()!;
      if (hop >= maxHops) continue;

      try {
        const neighbors = await db.execute(sql`
          SELECT e.id, e.type, e.value, e.normalized_value, e.jurisdiction, e.statute, e.section, e.doc_ids
          FROM nv_schema.nv_legal_graph_edges edge
          JOIN nv_schema.nv_legal_graph_entities e ON e.id = edge.target_id OR e.id = edge.source_id
          WHERE (edge.source_id = ${id} OR edge.target_id = ${id}) AND e.id != ${id}
            AND (e.org_id = ${orgId ?? null} OR e.org_id IS NULL)
            AND (edge.org_id = ${orgId ?? null} OR edge.org_id IS NULL)
          LIMIT 10
        `);
        const rows = ((neighbors as any).rows ?? neighbors ?? []);
        for (const row of rows) {
          if (!visited.has(row.id)) {
            visited.add(row.id);
            let docIds: string[] = [];
            try { docIds = typeof row.doc_ids === 'string' ? JSON.parse(row.doc_ids) : (row.doc_ids ?? []); } catch { docIds = []; }
            result.push({
              id: row.id, type: row.type as LegalEntityType, value: row.value,
              normalizedValue: row.normalized_value, jurisdiction: row.jurisdiction,
              statute: row.statute, section: row.section,
              docIds,
            });
            queue.push({ id: row.id, hop: hop + 1 });
          }
        }
      } catch (err: any) {
        logger.debug('graph_traverse_hop_failed', { entityId: id, hop, error: err.message });
      }
    }

    return result;
  }

  // ── LLM-BASED ENTITY EXTRACTION ──────────────────────────────────────────

  private async extractEntitiesViaLLM(text: string, jurisdiction: string, docId: string): Promise<LegalEntity[]> {
    const entities: LegalEntity[] = [];
    try {
      // NV-LLM-001 (R3): wrap through safety ring.
      const { executeWithFullSafetyRing } = await import('../../orchestration/jrx-sdk-orchestration-wrapper.js');
      const truncated = text.substring(0, 3000);
      const response = await executeWithFullSafetyRing({
        id: crypto.randomUUID(),
        userId: 'graphrag-indexer',
        prompt: `Extract legal entities from this document text. Return a JSON array of objects with fields: type (one of: statute, section, party, court, judgment, obligation, right, penalty, concept, jurisdiction), value (the entity text), jurisdiction (ISO code if applicable), year (if applicable).\n\nDocument (${jurisdiction} jurisdiction):\n${truncated}`,
        systemPrompt: 'You are a legal entity extraction expert. Extract all legal entities from the given text. Return ONLY a valid JSON array. Each object must have "type" and "value" fields. Be thorough — extract statutes, sections, parties, courts, judgments, obligations, rights, penalties, and legal concepts.',
        maxTokens: 2048,
        temperature: 0.2,
        requirements: { complexity: 'medium', domain: 'analytical', priority: 'medium', costBudget: 'balanced', responseTime: 'balanced', qualityLevel: 'professional' },
        fallbackLevels: 2,
        timestamp: new Date(),
      } as any, { sdkPlatform: 'graphrag', agentKey: 'auto', jurisdiction, taskType: 'entity_extraction' });

      if (response.content && !response.content.includes('simulation')) {
        const match = response.content.match(/\[[\s\S]*\]/);
        if (match) {
          const parsed = JSON.parse(match[0]);
          if (Array.isArray(parsed)) {
            for (const item of parsed) {
              if (item.type && item.value && typeof item.value === 'string' && item.value.length >= 3) {
                const type = item.type.toLowerCase() as LegalEntityType;
                const validTypes: LegalEntityType[] = ['statute', 'section', 'party', 'court', 'judgment', 'obligation', 'right', 'penalty', 'concept', 'jurisdiction'];
                if (!validTypes.includes(type)) continue;
                const normalized = item.value.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim().slice(0, 200);
                if (normalized.length < 3) continue;
                const id = crypto.createHash('sha256').update(`${type}:${normalized}`).digest('hex').slice(0, 32);
                entities.push({
                  id, type, value: item.value.trim(), normalizedValue: normalized,
                  jurisdiction: item.jurisdiction || jurisdiction,
                  year: item.year ? parseInt(String(item.year), 10) : undefined,
                  docIds: [docId],
                  metadata: { source: 'llm', model: response.model || 'gpt-4.1-mini' },
                });
              }
            }
            logger.info(`[GraphRAG] LLM extracted ${entities.length} entities for doc ${docId}`);
          }
        }
      }
    } catch (err: any) {
      logger.debug(`[GraphRAG] LLM extraction skipped — ${err.message}`);
    }
    return entities;
  }

  // ── REGEX ENTITY EXTRACTION ─────────────────────────────────────────────

  private extractEntities(text: string, jurisdiction: string, docId: string): LegalEntity[] {
    const entities: Map<string, LegalEntity> = new Map();

    const addEntity = (type: LegalEntityType, value: string, extra: Partial<LegalEntity> = {}) => {
      const normalized = value.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim().slice(0, 200);
      if (normalized.length < 3) return;
      const id = crypto.createHash('sha256').update(`${type}:${normalized}`).digest('hex').slice(0, 32);
      if (!entities.has(id)) {
        entities.set(id, { id, type, value: value.trim(), normalizedValue: normalized, jurisdiction, docIds: [docId], ...extra });
      }
    };

    // Extract statutes
    for (const pattern of STATUTE_PATTERNS) {
      for (const m of text.matchAll(pattern)) {
        addEntity('statute', m[0].trim(), { jurisdiction });
      }
    }

    // Extract sections
    for (const pattern of SECTION_PATTERNS) {
      for (const m of text.matchAll(pattern)) {
        const sectionText = m[0].trim();
        const sectionNum = m[1];
        addEntity('section', sectionText, { section: sectionNum, jurisdiction });
      }
    }

    // Extract citations
    for (const pattern of CITATION_PATTERNS) {
      for (const m of text.matchAll(pattern)) {
        addEntity('judgment', m[0].trim(), { year: parseInt(m[1], 10), jurisdiction });
      }
    }

    // Extract legal concepts
    for (const pattern of CONCEPT_PATTERNS) {
      for (const m of text.matchAll(pattern)) {
        addEntity('concept', m[0].trim());
      }
    }

    // Extract parties (organizations / persons after "between", "petitioner", "respondent")
    const partyPattern = /(?:between|petitioner|respondent|plaintiff|defendant|appellant|versus|vs\.?|v\.)\s+([A-Z][A-Za-z\s&.,]+?)(?:\s+(?:and|&|vs\.?|v\.|,)|\.|$)/g;
    for (const m of text.matchAll(partyPattern)) {
      const party = m[1]?.trim();
      if (party && party.length > 2 && party.length < 100) {
        addEntity('party', party, { jurisdiction });
      }
    }

    return Array.from(entities.values());
  }

  private inferEdges(entities: LegalEntity[], docId: string): LegalEdge[] {
    const edges: LegalEdge[] = [];

    const sections = entities.filter(e => e.type === 'section');
    const statutes = entities.filter(e => e.type === 'statute');
    const judgments = entities.filter(e => e.type === 'judgment');
    const concepts = entities.filter(e => e.type === 'concept');

    // Section → Statute (part_of)
    for (const section of sections) {
      for (const statute of statutes) {
        // Check if section text mentions the statute
        if (section.value.toLowerCase().includes(statute.normalizedValue.slice(0, 10))) {
          edges.push(this.makeEdge(section.id, statute.id, 'part_of', 0.95, docId));
        }
      }
    }

    // Judgment → Statute (cites)
    for (const judgment of judgments) {
      for (const statute of statutes) {
        edges.push(this.makeEdge(judgment.id, statute.id, 'cites', 0.8, docId));
      }
    }

    // Judgment → Section (interpreted_by → reverse: section interpreted_by judgment)
    for (const section of sections) {
      for (const judgment of judgments) {
        edges.push(this.makeEdge(section.id, judgment.id, 'interpreted_by', 0.75, docId));
      }
    }

    // Concept → Section (defines)
    for (const section of sections) {
      for (const concept of concepts) {
        if (section.value.toLowerCase().includes(concept.normalizedValue.slice(0, 8))) {
          edges.push(this.makeEdge(section.id, concept.id, 'defines', 0.7, docId));
        }
      }
    }

    return edges;
  }

  private makeEdge(sourceId: string, targetId: string, edgeType: LegalEdgeType, weight: number, docId: string): LegalEdge {
    const id = crypto.createHash('sha256').update(`${sourceId}:${targetId}:${edgeType}`).digest('hex').slice(0, 32);
    return { id, sourceId, targetId, edgeType, weight, docId, confidence: weight, createdAt: new Date().toISOString() };
  }

  // ── STATS ─────────────────────────────────────────────────────────────────

  async getStats(): Promise<{ totalEntities: number; totalEdges: number; byType: Record<string, number> }> {
    try {
      const entityCount = await db.execute(sql`SELECT COUNT(*) as cnt FROM nv_schema.nv_legal_graph_entities`);
      const edgeCount = await db.execute(sql`SELECT COUNT(*) as cnt FROM nv_schema.nv_legal_graph_edges`);
      const byType = await db.execute(sql`SELECT type, COUNT(*) as cnt FROM nv_schema.nv_legal_graph_entities GROUP BY type`);
      const total = parseInt(((entityCount as any).rows ?? entityCount)?.[0]?.cnt ?? '0', 10);
      const edges = parseInt(((edgeCount as any).rows ?? edgeCount)?.[0]?.cnt ?? '0', 10);
      const typeMap: Record<string, number> = {};
      for (const row of ((byType as any).rows ?? byType ?? [])) {
        typeMap[row.type] = parseInt(row.cnt, 10);
      }
      return { totalEntities: total, totalEdges: edges, byType: typeMap };
    } catch (err: any) {
      logger.debug('graph_stats_query_failed', { error: err.message });
      return { totalEntities: 0, totalEdges: 0, byType: {} };
    }
  }
}

export const nyvGraphRAGLegal = NyvGraphRAGLegalService.getInstance();
export default nyvGraphRAGLegal;
