/**
 * CNR normalize + validate (corpus resolve v1 — no eCourts checksum).
 */

export type CnrValidation = "ok" | "soft" | "invalid";

export function normalizeCnr(raw: string | null | undefined): string {
  return String(raw ?? "")
    .trim()
    .toUpperCase()
    .replace(/[\s\-_.]/g, "");
}

export function validateCnr(cnr: string): {
  validation: CnrValidation;
  reason?: string;
} {
  if (!cnr) {
    return { validation: "invalid", reason: "CNR is required" };
  }
  if (!/^[A-Z0-9]+$/.test(cnr)) {
    return { validation: "invalid", reason: "CNR must be alphanumeric" };
  }
  if (cnr.length < 10 || cnr.length > 20) {
    return { validation: "invalid", reason: "CNR length must be 10–20 characters" };
  }
  if (/^[A-Z0-9]{16}$/.test(cnr)) {
    return { validation: "ok" };
  }
  return { validation: "soft" };
}
