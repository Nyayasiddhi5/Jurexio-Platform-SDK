import type { Request, Response, NextFunction } from "express";
import { db, apiUsageTable } from "@workspace/db";
import { logger } from "../lib/logger";

const SKIP = [/^\/healthz/, /^\/auth\//, /^\/analytics/, /^\/openapi\.json/];

function featureOf(path: string): string {
  if (path.startsWith("/runs") || path.startsWith("/tasks") || path.startsWith("/categories"))
    return "agentic-work";
  if (path.startsWith("/chat")) return "chat";
  if (path.startsWith("/caselaw")) return "caselaw";
  if (path.startsWith("/citations")) return "citations";
  if (path.startsWith("/statutes")) return "statutes";
  if (path.startsWith("/retrieve")) return "retrieval";
  if (path.startsWith("/advise")) return "advise";
  if (path.startsWith("/templates")) return "templates";
  if (path.startsWith("/athena")) return "athena";
  if (path.startsWith("/mcp")) return "mcp";
  if (path.startsWith("/dashboard")) return "dashboard";
  return "other";
}

const DEFAULT_MODEL = process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-6";

/**
 * Mark a request as having invoked an AI model so the usage log records it.
 * Call from any route handler that performs an LLM call.
 */
export function recordModelUsage(res: Response, model?: string): void {
  res.locals.aiModel = model ?? DEFAULT_MODEL;
}

/** Fire-and-forget API usage logger. Never blocks or fails the request. */
export function usageLogger(req: Request, res: Response, next: NextFunction): void {
  const start = Date.now();
  const path = req.path;
  if (SKIP.some((re) => re.test(path))) return next();

  res.on("finish", () => {
    const jurisdiction =
      (typeof req.query.jurisdiction === "string" && req.query.jurisdiction) ||
      (typeof (req.body as Record<string, unknown> | undefined)?.jurisdiction === "string"
        ? ((req.body as Record<string, string>).jurisdiction)
        : null);
    db.insert(apiUsageTable)
      .values({
        method: req.method,
        path,
        feature: featureOf(path),
        jurisdiction,
        model: typeof res.locals.aiModel === "string" ? res.locals.aiModel : null,
        statusCode: res.statusCode,
        latencyMs: Date.now() - start,
      })
      .catch((err) => logger.warn({ err: String(err) }, "usage logging failed"));
  });
  next();
}
