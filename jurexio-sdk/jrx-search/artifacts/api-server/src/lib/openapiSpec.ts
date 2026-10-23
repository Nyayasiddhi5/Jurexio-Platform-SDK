import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { logger } from "./logger";

let cached: Record<string, unknown> | null | undefined;

/**
 * Load and parse the OpenAPI spec (source of truth: lib/api-spec/openapi.yaml).
 * Checks the workspace location in dev and a colocated copy in production
 * bundles (openapi.yaml next to the bundled entrypoint or in OPENAPI_SPEC_PATH).
 */
export function getOpenApiSpec(): Record<string, unknown> | null {
  if (cached !== undefined) return cached;
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    process.env.OPENAPI_SPEC_PATH,
    // dev (tsx): artifacts/api-server/src/lib → workspace root
    path.resolve(here, "../../../../lib/api-spec/openapi.yaml"),
    // dev (bundled dist): artifacts/api-server/dist → workspace root
    path.resolve(here, "../../../lib/api-spec/openapi.yaml"),
    // production bundle: dist/openapi.yaml
    path.resolve(here, "openapi.yaml"),
    path.resolve(process.cwd(), "openapi.yaml"),
  ].filter((p): p is string => Boolean(p));
  for (const candidate of candidates) {
    try {
      if (!existsSync(candidate)) continue;
      cached = parse(readFileSync(candidate, "utf8")) as Record<string, unknown>;
      logger.info({ path: candidate }, "OpenAPI spec loaded");
      return cached;
    } catch (err) {
      logger.warn({ err: String(err), candidate }, "failed to load OpenAPI spec");
    }
  }
  cached = null;
  return cached;
}
