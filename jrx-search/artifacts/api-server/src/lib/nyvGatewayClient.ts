/**
 * Shared NYV gateway client for caselaw-worker BFF routes (Patra Mitra, CNR SSOT, etc.).
 * Keys never leave the worker — browser calls same-origin /api only.
 */
export function nyvGatewayConfigured(): { base: string; key: string } | null {
  const base = (
    process.env.NYV_API_BASE_URL ||
    process.env.NYV_GATEWAY_URL ||
    ""
  )
    .trim()
    .replace(/\/$/, "");
  const key = (
    process.env.NYV_SDK_KEY ||
    process.env.NYV_MODEL_CALL_API_KEY ||
    process.env.NYV_SDK_KEY_NYS ||
    ""
  ).trim();
  if (!base || key.length < 8) return null;
  return { base, key };
}

export async function nyvGatewayFetch(
  path: string,
  init: RequestInit & { base: string; key: string; timeoutMs?: number },
): Promise<{ res: Response; body: unknown }> {
  const timeoutMs = init.timeoutMs ?? Number(process.env.NYV_GATEWAY_TIMEOUT_MS ?? "120000");
  const res = await fetch(`${init.base}${path}`, {
    ...init,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "X-API-Key": init.key,
      Authorization: `Bearer ${init.key}`,
      "X-NYV-Platform": "nys",
      "X-NYV-Consent": "granted",
      ...(init.headers || {}),
    },
    signal: AbortSignal.timeout(timeoutMs),
  });
  const body = await res.json().catch(() => ({}));
  return { res, body };
}
