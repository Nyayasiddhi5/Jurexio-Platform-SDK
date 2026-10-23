import { db, caselawDocumentsTable } from "@workspace/db";
import { sql, eq, isNotNull, ne, and } from "drizzle-orm";
import { rowToDoc, searchIndianCaselaw, type CaselawDocOut } from "./caselaw";
import {
  rdsBackendEnabled,
  getRdsJudgmentById,
  searchRdsJudgments,
  findSimilarRdsByEmbedding,
} from "./rdsCaselaw";
import { embedText, caseEmbeddingText, embeddingProvider } from "./embeddings";
import { logger } from "./logger";

export type SimilarCasesResult = {
  documentId: number;
  method: "vector" | "fts";
  provider: string;
  results: CaselawDocOut[];
};

function titleQuery(doc: CaselawDocOut): string {
  const base = [doc.petitioner, doc.respondent].filter(Boolean).join(" ") || doc.title;
  return base
    .replace(/[^A-Za-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2)
    .slice(0, 8)
    .join(" OR ");
}

async function ftsSimilar(
  doc: CaselawDocOut,
  limit: number,
): Promise<CaselawDocOut[]> {
  const q = titleQuery(doc);
  if (!q) return [];
  const res = rdsBackendEnabled()
    ? await searchRdsJudgments({ q, limit: limit + 1 })
    : await searchIndianCaselaw({ q, limit: limit + 1 });
  return res.results.filter((r) => r.id !== doc.id).slice(0, limit);
}

export async function ensureEmbedding(
  row: typeof caselawDocumentsTable.$inferSelect,
): Promise<number[]> {
  if (row.embedding) return row.embedding;
  const emb = await embedText(caseEmbeddingText(row));
  await db
    .update(caselawDocumentsTable)
    .set({ embedding: emb })
    .where(eq(caselawDocumentsTable.id, row.id));
  return emb;
}

export async function findSimilarCases(
  id: number,
  limit = 5,
): Promise<SimilarCasesResult | null> {
  const provider = embeddingProvider();

  if (rdsBackendEnabled()) {
    // RDS corpus: pgvector cosine KNN when the target has an embedding
    // (populated by the batch embedder); deterministic FTS fallback when
    // the embedding is missing — the fallback is logged, never silent.
    const doc = await getRdsJudgmentById(id);
    if (!doc) return null;
    try {
      const neighbors = await findSimilarRdsByEmbedding(id, limit);
      if (neighbors && neighbors.length > 0) {
        return { documentId: id, method: "vector", provider, results: neighbors };
      }
      logger.warn(
        { id },
        "RDS document has no embedding yet; falling back to FTS similarity",
      );
    } catch (err) {
      logger.warn(
        { err: String(err), id },
        "RDS vector similarity failed; falling back to FTS",
      );
    }
    const results = await ftsSimilar(doc, limit);
    return { documentId: id, method: "fts", provider, results };
  }

  const [row] = await db
    .select()
    .from(caselawDocumentsTable)
    .where(eq(caselawDocumentsTable.id, id))
    .limit(1);
  if (!row) return null;

  try {
    const emb = await ensureEmbedding(row);
    const embLiteral = `[${emb.join(",")}]`;
    const neighbors = await db
      .select()
      .from(caselawDocumentsTable)
      .where(
        and(
          isNotNull(caselawDocumentsTable.embedding),
          ne(caselawDocumentsTable.id, id),
        ),
      )
      .orderBy(
        sql`${caselawDocumentsTable.embedding} <=> ${embLiteral}::vector`,
      )
      .limit(limit);
    if (neighbors.length > 0) {
      return {
        documentId: id,
        method: "vector",
        provider,
        results: neighbors.map(rowToDoc),
      };
    }
  } catch (err) {
    logger.warn(
      { err: String(err), id },
      "vector similarity failed; falling back to FTS",
    );
  }

  const results = await ftsSimilar(rowToDoc(row), limit);
  return { documentId: id, method: "fts", provider, results };
}
