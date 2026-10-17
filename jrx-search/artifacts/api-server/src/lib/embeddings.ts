import { createHash } from "node:crypto";
import { logger } from "./logger";

export const EMBEDDING_DIM = 1024;

/**
 * Embedding provider:
 * - Production (AI_PROVIDER=bedrock): Amazon Titan Text Embeddings v2 (1024 dims).
 * - Dev fallback: deterministic feature-hash embedding (no network, no LLM) —
 *   token + bigram hashing, L2-normalized. Good enough for dev-corpus
 *   similarity over titles/parties/descriptions.
 */
export function embeddingProvider(): "bedrock" | "hash" {
  return process.env.AI_PROVIDER === "bedrock" ? "bedrock" : "hash";
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1);
}

export function hashEmbed(text: string): number[] {
  const vec = new Float64Array(EMBEDDING_DIM);
  const tokens = tokenize(text);
  const feats: string[] = [...tokens];
  for (let i = 0; i < tokens.length - 1; i++) {
    feats.push(`${tokens[i]}_${tokens[i + 1]}`);
  }
  for (const f of feats) {
    const h = createHash("md5").update(f).digest();
    const idx = h.readUInt32BE(0) % EMBEDDING_DIM;
    const sign = h[4]! % 2 === 0 ? 1 : -1;
    vec[idx] += sign;
  }
  let norm = 0;
  for (let i = 0; i < EMBEDDING_DIM; i++) norm += vec[i]! * vec[i]!;
  norm = Math.sqrt(norm) || 1;
  return Array.from(vec, (v) => v / norm);
}

let bedrockClient: import("@aws-sdk/client-bedrock-runtime").BedrockRuntimeClient | null =
  null;

async function getBedrockClient() {
  if (bedrockClient) return bedrockClient;
  const { BedrockRuntimeClient } = await import(
    "@aws-sdk/client-bedrock-runtime"
  );
  bedrockClient = new BedrockRuntimeClient({
    region: process.env.BEDROCK_REGION ?? "us-east-1",
    maxAttempts: 5,
    requestHandler: {
      connectionTimeout: 5_000,
      requestTimeout: 30_000,
    },
  });
  return bedrockClient;
}

/**
 * Titan Text Embeddings V2 accepts up to ~8k chars for this path.
 * Default 8000 (quality). Optional EMBED_TRUNCATE_CHARS=4000–6000 reduces
 * tokens/cost and latency with a quality tradeoff on long descriptions —
 * only use after measuring retrieve quality; never raise above 8000 here.
 */
function embedTruncateChars(): number {
  const n = Number(process.env.EMBED_TRUNCATE_CHARS ?? 8000);
  if (!Number.isFinite(n) || n < 512) return 8000;
  return Math.min(8000, Math.floor(n));
}

async function bedrockEmbed(text: string): Promise<number[]> {
  const { InvokeModelCommand } = await import(
    "@aws-sdk/client-bedrock-runtime"
  );
  const client = await getBedrockClient();
  // Low-cost bulk path only — do not switch corpus backfill to Cohere Embed or chat LLMs.
  const modelId =
    process.env.BEDROCK_EMBED_MODEL ?? "amazon.titan-embed-text-v2:0";
  const res = await client.send(
    new InvokeModelCommand({
      modelId,
      contentType: "application/json",
      accept: "application/json",
      body: JSON.stringify({
        inputText: text.slice(0, embedTruncateChars()),
        dimensions: EMBEDDING_DIM,
        normalize: true,
      }),
    }),
  );
  const body = JSON.parse(new TextDecoder().decode(res.body)) as {
    embedding?: number[];
  };
  if (!body.embedding || body.embedding.length !== EMBEDDING_DIM) {
    throw new Error("Bedrock embedding response missing/invalid embedding");
  }
  return body.embedding;
}

export async function embedText(text: string): Promise<number[]> {
  if (embeddingProvider() === "bedrock") {
    try {
      return await bedrockEmbed(text);
    } catch (err) {
      logger.error({ err: String(err) }, "Bedrock embedding failed");
      throw err;
    }
  }
  return hashEmbed(text);
}

/** Canonical embedding input for a caselaw document. */
export function caseEmbeddingText(doc: {
  title: string;
  petitioner?: string | null;
  respondent?: string | null;
  court?: string | null;
  description?: string | null;
  disposalNature?: string | null;
}): string {
  return [
    doc.title,
    doc.petitioner,
    doc.respondent,
    doc.court,
    doc.disposalNature,
    doc.description,
  ]
    .filter(Boolean)
    .join(". ");
}

/** Canonical embedding input for a statute provision. */
export function statuteEmbeddingText(row: {
  code: string;
  section: string;
  heading: string;
  text: string;
  actName?: string | null;
  chapter?: string | null;
  practiceArea?: string | null;
}): string {
  return [
    `${row.actName ?? row.code} Section ${row.section}`,
    row.heading,
    row.chapter,
    row.practiceArea,
    row.text.slice(0, 6000),
  ]
    .filter(Boolean)
    .join(". ");
}
