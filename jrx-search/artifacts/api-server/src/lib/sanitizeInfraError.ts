/**
 * Scrub infrastructure / credential errors before they reach API clients or UI.
 * Never return Postgres auth, AWS tokens, or secret-manager text to end users.
 */

export type SafeInfraError = {
  status: number;
  code: string;
  message: string;
  retryable: boolean;
};

const INFRA_PATTERNS: Array<{
  re: RegExp;
  status: number;
  code: string;
  message: string;
  retryable: boolean;
}> = [
  {
    re: /28P01|password authentication failed|authentication failed for user|FATAL:\s*password/i,
    status: 503,
    code: "CASELAW_STORE_UNAVAILABLE",
    message: "Caselaw store temporarily unavailable. Please try again shortly.",
    retryable: true,
  },
  {
    re: /ECONNREFUSED|ETIMEDOUT|ENOTFOUND|connection terminated|Connection refused|timeout expired|remaining connection slots/i,
    status: 503,
    code: "DATABASE_UNAVAILABLE",
    message: "Database temporarily unavailable. Please try again shortly.",
    retryable: true,
  },
  {
    re: /InvalidClientTokenId|ExpiredToken|UnrecognizedClient|AccessDenied|AccessDeniedException|SignatureDoesNotMatch|InvalidAccessKeyId|credentials|secret(s)?\s*manager|aws.?secret/i,
    status: 502,
    code: "DOCUMENT_STORE_UNAVAILABLE",
    message: "Document store temporarily unavailable. Please try again shortly.",
    retryable: true,
  },
  {
    re: /NoSuchBucket|NoSuchKey|AllAccessDisabled|PermanentRedirect/i,
    status: 502,
    code: "OBJECT_STORE_UNAVAILABLE",
    message: "Document storage temporarily unavailable. Please try again shortly.",
    retryable: true,
  },
  {
    re: /Bedrock|ThrottlingException|ModelTimeout|embedding.*fail/i,
    status: 503,
    code: "EMBEDDING_UNAVAILABLE",
    message: "Search intelligence temporarily unavailable; retry shortly.",
    retryable: true,
  },
];

export function classifyInfraError(err: unknown): SafeInfraError | null {
  const raw =
    err instanceof Error
      ? `${err.name} ${err.message} ${(err as { code?: string }).code ?? ""}`
      : String(err ?? "");
  for (const p of INFRA_PATTERNS) {
    if (p.re.test(raw)) {
      return {
        status: p.status,
        code: p.code,
        message: p.message,
        retryable: p.retryable,
      };
    }
  }
  return null;
}

/** Client-safe message: scrub infra text, else return original (for non-infra). */
export function sanitizeClientErrorMessage(
  err: unknown,
  fallback = "Something went wrong. Please try again shortly.",
): string {
  const classified = classifyInfraError(err);
  if (classified) return classified.message;
  if (err instanceof Error && err.message.trim()) {
    // Belt: never leak remaining credential-ish fragments
    if (/password|secret|token|credential|AKIA[0-9A-Z]{16}/i.test(err.message)) {
      return fallback;
    }
    return err.message;
  }
  return fallback;
}
