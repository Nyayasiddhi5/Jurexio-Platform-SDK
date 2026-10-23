import { apiUsageTable, legalTasksTable, runsTable, templatesTable } from "@workspace/db";
import { eq, inArray, isNull, or, type SQL } from "drizzle-orm";

export const LIVE_JURISDICTIONS = ["IN", "US"] as const;
export const RESERVED_JURISDICTIONS = ["GCC", "UK", "EU", "SG"] as const;

export const VALID_JURISDICTIONS = new Set([
  "IN",
  "US",
  "GCC",
  "UK",
  "EU",
  "SG",
  "GLOBAL",
]);

export const VALID_QUERY_JURISDICTIONS = new Set([
  ...VALID_JURISDICTIONS,
  "ALL",
]);

export class InvalidJurisdictionError extends Error {
  constructor(value: string) {
    super(`Unknown jurisdiction: ${value}`);
    this.name = "InvalidJurisdictionError";
  }
}

/** Parse an optional query `jurisdiction` param (supports ALL). */
export function parseQueryJurisdiction(value: unknown): string | undefined {
  if (typeof value !== "string" || !value) return undefined;
  const upper = value.toUpperCase();
  if (!VALID_QUERY_JURISDICTIONS.has(upper)) {
    throw new InvalidJurisdictionError(value);
  }
  return upper;
}

/**
 * Task library rule: selected jurisdiction + GLOBAL. ALL = union of live
 * jurisdictions plus GLOBAL (i.e. no filter). Reserved → GLOBAL-only.
 */
export function taskJurisdictionFilter(
  jurisdiction?: string,
): SQL | undefined {
  if (!jurisdiction || jurisdiction === "ALL") return undefined;
  if (!VALID_JURISDICTIONS.has(jurisdiction)) {
    throw new InvalidJurisdictionError(jurisdiction);
  }
  if (jurisdiction === "GLOBAL") {
    return eq(legalTasksTable.jurisdiction, "GLOBAL");
  }
  if ((RESERVED_JURISDICTIONS as readonly string[]).includes(jurisdiction)) {
    return eq(legalTasksTable.jurisdiction, "GLOBAL");
  }
  return inArray(legalTasksTable.jurisdiction, [jurisdiction, "GLOBAL"]);
}

/** Runs: IN/US exact match; ALL = live jurisdictions + legacy null; omitted = no filter. */
export function runJurisdictionFilter(
  jurisdiction?: string,
): SQL | undefined {
  if (!jurisdiction) return undefined;
  if (jurisdiction === "ALL") {
    return or(
      inArray(runsTable.jurisdiction, [...LIVE_JURISDICTIONS]),
      isNull(runsTable.jurisdiction),
    );
  }
  if (!VALID_JURISDICTIONS.has(jurisdiction)) {
    throw new InvalidJurisdictionError(jurisdiction);
  }
  return eq(runsTable.jurisdiction, jurisdiction);
}

/** Templates: ALL = IN ∪ US (no filter on jurisdiction column). */
export function templateJurisdictionFilter(
  jurisdiction?: string,
): SQL | undefined {
  if (!jurisdiction || jurisdiction === "ALL") return undefined;
  if (jurisdiction === "IN" || jurisdiction === "US") {
    return eq(templatesTable.jurisdiction, jurisdiction);
  }
  throw new InvalidJurisdictionError(jurisdiction);
}

/** Usage analytics: ALL/omitted = no filter; IN/US = exact match on logged jurisdiction. */
export function usageJurisdictionFilter(
  jurisdiction?: string,
): SQL | undefined {
  if (!jurisdiction || jurisdiction === "ALL") return undefined;
  if (jurisdiction === "IN" || jurisdiction === "US") {
    return eq(apiUsageTable.jurisdiction, jurisdiction);
  }
  throw new InvalidJurisdictionError(jurisdiction);
}
