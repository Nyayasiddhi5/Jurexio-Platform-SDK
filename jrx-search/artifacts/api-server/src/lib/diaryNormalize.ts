/**
 * Diary number normalize + validate (corpus resolve — SC/HC/DC).
 * SC Open Data stores `case_id` as `YYYY INSC NNNN` in judgments.case_no.
 * HC/DC often use long numeric case_no (filing reference).
 * Classic SC diary `12345/2024` is matched when present in corpus case_no.
 */

export type DiaryValidation = "ok" | "soft" | "invalid";

export type NormalizedDiary = {
  /** Primary lookup key sent back to partners. */
  canonical: string;
  number: string;
  year: number;
  /** All equality keys for RDS case_no / FTS. */
  variants: string[];
  format: "slash" | "insc" | "numeric" | "raw";
};

const DIARY_SLASH =
  /^(?:DIARY\s*(?:NO\.?|NUMBER)?\s*)?(\d{1,7})\s*(?:\/|\-|\s+OF\s+|\s+of\s+|\s+)\s*((?:19|20)\d{2}|\d{2})$/i;

const DIARY_INSC =
  /^((?:19|20)\d{2})\s*INSC\s*(\d{1,6})$/i;

function expandYear(y: string): number {
  const n = parseInt(y, 10);
  if (y.length === 2) return n >= 70 ? 1900 + n : 2000 + n;
  return n;
}

/** Strip decorative prefix; collapse whitespace. */
export function normalizeDiaryRaw(raw: string | null | undefined): string {
  return String(raw ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .replace(/^diary\s*(?:no\.?|number)?\s*[:\-]?\s*/i, "")
    .trim();
}

function parseSlash(cleaned: string): NormalizedDiary | null {
  const compact = cleaned.replace(/\s+/g, " ");
  const m = DIARY_SLASH.exec(compact);
  if (!m) {
    const slash = /^(\d{1,7})\/((?:19|20)\d{2}|\d{2})$/.exec(cleaned.replace(/\s/g, ""));
    if (!slash) return null;
    const number = slash[1]!.replace(/^0+/, "") || slash[1]!;
    const year = expandYear(slash[2]!);
    const canonical = `${number}/${year}`;
    const variants = [canonical, cleaned.replace(/\s/g, "")];
    if (slash[2]!.length === 2) variants.push(`${number}/${slash[2]}`);
    return { canonical, number, year, variants: [...new Set(variants)], format: "slash" };
  }
  const number = m[1]!.replace(/^0+/, "") || m[1]!;
  const year = expandYear(m[2]!);
  const canonical = `${number}/${year}`;
  const variants = [canonical, compact];
  if (m[2]!.length === 2) variants.push(`${number}/${m[2]}`);
  return { canonical, number, year, variants: [...new Set(variants)], format: "slash" };
}

function parseInsc(cleaned: string): NormalizedDiary | null {
  const m = DIARY_INSC.exec(cleaned);
  if (!m) return null;
  const year = parseInt(m[1]!, 10);
  const num = m[2]!.replace(/^0+/, "") || m[2]!;
  const canonical = `${year} INSC ${num}`;
  const variants = [canonical, `${year} INSC ${m[2]}`, `${year}INSC${num}`, cleaned];
  return {
    canonical,
    number: num,
    year,
    variants: [...new Set(variants)],
    format: "insc",
  };
}

function parseNumeric(cleaned: string): NormalizedDiary | null {
  const digits = cleaned.replace(/\s/g, "");
  if (!/^\d{6,16}$/.test(digits)) return null;
  const year =
    digits.length >= 4
      ? parseInt(digits.slice(-4), 10)
      : new Date().getUTCFullYear();
  return {
    canonical: digits,
    number: digits,
    year: Number.isFinite(year) && year >= 1950 && year <= 2100 ? year : new Date().getUTCFullYear(),
    variants: [digits, cleaned],
    format: "numeric",
  };
}

export function normalizeDiary(
  raw: string | null | undefined,
): NormalizedDiary | null {
  const cleaned = normalizeDiaryRaw(raw);
  if (!cleaned) return null;
  return (
    parseSlash(cleaned) ??
    parseInsc(cleaned) ??
    parseNumeric(cleaned) ??
    null
  );
}

export function validateDiary(
  raw: string | null | undefined,
): { validation: DiaryValidation; normalized: NormalizedDiary | null; reason?: string } {
  const cleaned = normalizeDiaryRaw(raw);
  if (!cleaned) {
    return { validation: "invalid", normalized: null, reason: "Diary number is required" };
  }
  const normalized = normalizeDiary(raw);
  if (!normalized) {
    return {
      validation: "invalid",
      normalized: null,
      reason: "Diary must be NNNN/YYYY, YYYY INSC NNNN, or numeric filing reference",
    };
  }
  if (normalized.format === "slash" && normalized.number.length > 7) {
    return { validation: "invalid", normalized: null, reason: "Diary number must be 1–7 digits" };
  }
  if (normalized.year < 1950 || normalized.year > 2100) {
    return { validation: "soft", normalized, reason: "Year outside typical range" };
  }
  return { validation: "ok", normalized };
}

export type CourtTier = "sc" | "hc" | "dc";

export function parseCourtTypeHint(
  raw: string | null | undefined,
): CourtTier | null {
  const s = String(raw ?? "").trim().toLowerCase();
  if (!s) return null;
  if (s === "sc" || s.includes("supreme")) return "sc";
  if (s === "hc" || s.includes("high")) return "hc";
  if (s === "dc" || s.includes("district")) return "dc";
  return null;
}

export function inferCourtTypeFromDiary(n: NormalizedDiary): CourtTier | null {
  if (n.format === "insc") return "sc";
  if (n.format === "numeric") return "hc";
  return null;
}
