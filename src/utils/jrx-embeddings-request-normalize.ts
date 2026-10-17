/**
 * NV-NSP-EMBED-INPUT-001 — normalize partner embeddings payloads on gateway routes.
 *
 * Canonical: `{ texts: string[] }`. Also accepts documented `{ content }` and
 * docs-pipeline `{ documents: [{ id, content }] }` so NSP callers are not 400'd
 * for shape drift between integration docs and live handlers.
 */
export function normalizeGatewayEmbeddingsTexts(body: unknown): string[] | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as Record<string, unknown>;

  if (Array.isArray(b.texts)) {
    const texts = b.texts.filter((t): t is string => typeof t === 'string' && t.trim().length > 0);
    return texts.length > 0 ? texts : null;
  }

  if (typeof b.content === 'string' && b.content.trim().length > 0) {
    return [b.content.trim()];
  }
  if (Array.isArray(b.content)) {
    const texts = b.content.filter((t): t is string => typeof t === 'string' && t.trim().length > 0);
    return texts.length > 0 ? texts : null;
  }

  if (Array.isArray(b.documents)) {
    const texts = b.documents
      .map((doc) => {
        if (!doc || typeof doc !== 'object') return null;
        const content = (doc as { content?: unknown }).content;
        return typeof content === 'string' && content.trim().length > 0 ? content.trim() : null;
      })
      .filter((t): t is string => t !== null);
    return texts.length > 0 ? texts : null;
  }

  return null;
}
