/** Auth headers for localhost /athena/extract when AUTH_REQUIRED=1 on worker. */
export function extractAuthHeaders() {
  const key =
    process.env.NYS_BACKFILL_API_KEY ||
    process.env.NYS_SDK_API_KEYS?.split(",")[0]?.trim() ||
    process.env.NYS_KNOWLEDGE_API_KEY ||
    process.env.MCP_TOKEN;
  const headers = { "content-type": "application/json" };
  if (key) headers["x-api-key"] = key;
  return headers;
}
