import type { ErrorRequestHandler, RequestHandler } from "express";
import { ZodError } from "zod";
import { classifyInfraError, sanitizeClientErrorMessage } from "../lib/sanitizeInfraError";

/** Dual error envelope: legacy `error` string + NYV `{error:{code,message}}`. */
function envelope(code: string, message: string, extra?: Record<string, unknown>) {
  return {
    error: message,
    ...extra,
    // Nyayavigya SDK / gateway compatible nested form (additive)
    errorDetail: { code, message },
  };
}

export const notFoundHandler: RequestHandler = (_req, res) => {
  res.status(404).json(envelope("NOT_FOUND", "Not found"));
};

export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  if (res.headersSent) {
    return;
  }

  if (err instanceof ZodError) {
    req.log?.warn({ err }, "validation error");
    res.status(400).json(envelope("INVALID_REQUEST", "Invalid request", { details: err.issues }));
    return;
  }

  const infra = classifyInfraError(err);
  if (infra) {
    req.log?.error({ err, code: infra.code }, "infrastructure error (sanitized for client)");
    res.status(infra.status).json(
      envelope(infra.code, infra.message, { retryable: infra.retryable }),
    );
    return;
  }

  req.log?.error({ err }, "unhandled error");
  const message = sanitizeClientErrorMessage(err, "Internal server error");
  res.status(500).json(envelope("INTERNAL_ERROR", message));
};
