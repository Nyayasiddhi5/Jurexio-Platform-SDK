/**
 * Vector Database — REAL DELEGATION SEAM
 * JRX-ORCH-SEAM-005 (Task #32)
 *
 * Re-exports the canonical NyayavignyaVectorDatabase. Aliases the class as
 * `VectorDatabase` so legacy consumers (knowledge-base-system) compile
 * without change. Also re-exports the request/result types and the
 * default vector config helper from the canonical module.
 *
 * NOTE: The canonical module exports `VectorEmbeddingRequest`. We additionally
 * re-export it as `EmbeddingRequest` for legacy callers that import that name
 * from this module (knowledge-base-system imports `EmbeddingRequest` here).
 */

export {
  NyayavignyaVectorDatabase,
  NyayavignyaVectorDatabase as VectorDatabase,
  createNyayavignyaVectorDatabase,
  defaultVectorConfig,
  type VectorBackend,
  type EmbeddingModel,
  type DistanceMetric,
  type VectorDatabaseConfig,
  type Vector,
  type VectorSearchRequest,
  type VectorSearchResult,
  type VectorCollection,
  type VectorEmbeddingRequest,
  type VectorEmbeddingRequest as EmbeddingRequest,
  type VectorEmbeddingResponse,
  type VectorIndexStats,
} from './document-pipeline/vector-database.js';

import { NyayavignyaVectorDatabase, defaultVectorConfig } from './document-pipeline/vector-database.js';
import { databaseSystem } from './database-system.js';

/**
 * Default singleton — wired to the canonical `databaseSystem` (drizzle +
 * pg/neon) so that any caller importing `vectorDatabase` from this seam
 * gets a fully production-ready, persistence-backed instance.
 *
 * Callers that need a different config (alternate backend, custom
 * dimension, multi-tenant pool) can still construct their own
 * `new NyayavignyaVectorDatabase(customConfig, customDbSystem)`.
 */
export const vectorDatabase = new NyayavignyaVectorDatabase(defaultVectorConfig, databaseSystem);
export default vectorDatabase;
