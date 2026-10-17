/**
 * Deterministic legal citation extraction & normalization.
 * No LLM involved — pure parsing for Indian and US citation formats.
 */

export type ExtractedCitation = {
  raw: string;
  normalized: string;
  jurisdiction: "IN" | "US";
  reporter: string;
  volume: string | null;
  year: number | null;
  page: string | null;
  court: string | null;
};

type Pattern = {
  regex: RegExp;
  build: (m: RegExpMatchArray) => Omit<ExtractedCitation, "raw">;
};

const IN_PATTERNS: Pattern[] = [
  {
    // AIR 1973 SC 1461 / AIR 2001 Bom 123
    regex: /\bAIR\s+(\d{4})\s+([A-Z][A-Za-z]{1,10})\s+(\d{1,6})\b/g,
    build: (m) => ({
      normalized: `AIR ${m[1]} ${m[2]} ${m[3]}`,
      jurisdiction: "IN",
      reporter: "AIR",
      volume: null,
      year: Number(m[1]),
      page: m[3],
      court: m[2] === "SC" ? "Supreme Court of India" : m[2],
    }),
  },
  {
    // (1973) 4 SCC 225
    regex: /\((\d{4})\)\s+(\d{1,3})\s+SCC\s+(\d{1,6})\b/g,
    build: (m) => ({
      normalized: `(${m[1]}) ${m[2]} SCC ${m[3]}`,
      jurisdiction: "IN",
      reporter: "SCC",
      volume: m[2],
      year: Number(m[1]),
      page: m[3],
      court: "Supreme Court of India",
    }),
  },
  {
    // 2024 SCC OnLine SC 123 / 2024 SCC OnLine Del 456
    regex: /\b(\d{4})\s+SCC\s+OnLine\s+([A-Z][A-Za-z]{1,10})\s+(\d{1,6})\b/g,
    build: (m) => ({
      normalized: `${m[1]} SCC OnLine ${m[2]} ${m[3]}`,
      jurisdiction: "IN",
      reporter: "SCC OnLine",
      volume: null,
      year: Number(m[1]),
      page: m[3],
      court: m[2] === "SC" ? "Supreme Court of India" : m[2],
    }),
  },
  {
    // [1950] SCR 88 / (1950) 1 SCR 88 / 1950 SCR 88
    regex: /[[(]?(\d{4})[\])]?\s+(?:(\d{1,2})\s+)?SCR\s+(\d{1,6})\b/g,
    build: (m) => ({
      normalized: m[2]
        ? `(${m[1]}) ${m[2]} SCR ${m[3]}`
        : `[${m[1]}] SCR ${m[3]}`,
      jurisdiction: "IN",
      reporter: "SCR",
      volume: m[2] ?? null,
      year: Number(m[1]),
      page: m[3],
      court: "Supreme Court of India",
    }),
  },
  {
    // Neutral: 2023 INSC 123
    regex: /\b(\d{4})\s+INSC\s+(\d{1,6})\b/g,
    build: (m) => ({
      normalized: `${m[1]} INSC ${m[2]}`,
      jurisdiction: "IN",
      reporter: "INSC",
      volume: null,
      year: Number(m[1]),
      page: m[2],
      court: "Supreme Court of India",
    }),
  },
];

// Common US reporters (longest-first so e.g. "F. Supp. 3d" wins over "F.")
const US_REPORTERS = [
  "U\\.\\s?S\\.",
  "S\\.\\s?Ct\\.",
  "L\\.\\s?Ed\\.\\s?2d",
  "L\\.\\s?Ed\\.",
  "F\\.\\s?Supp\\.\\s?3d",
  "F\\.\\s?Supp\\.\\s?2d",
  "F\\.\\s?Supp\\.",
  "F\\.4th",
  "F\\.3d",
  "F\\.2d",
  "F\\.",
  "A\\.3d",
  "A\\.2d",
  "N\\.E\\.3d",
  "N\\.E\\.2d",
  "N\\.W\\.2d",
  "S\\.E\\.2d",
  "S\\.W\\.3d",
  "P\\.3d",
  "P\\.2d",
  "Cal\\.\\s?Rptr\\.\\s?3d",
  "N\\.Y\\.S\\.3d",
  "N\\.Y\\.S\\.2d",
  "N\\.Y\\.3d",
  "N\\.Y\\.2d",
  "A\\.D\\.3d",
  "Misc\\.\\s?3d",
  "B\\.R\\.",
  "Wn\\.2d",
];

const US_REGEX = new RegExp(
  `\\b(\\d{1,4})\\s+(${US_REPORTERS.join("|")})\\s+(\\d{1,5})(?:\\s*\\(([^)]{0,40}?)\\s*(\\d{4})\\))?`,
  "g",
);

function normalizeUsReporter(rep: string): string {
  return rep.replace(/\s+/g, " ").replace(/\.\s?/g, ". ").trim().replace(/\.\s$/, ".");
}

export function extractCitations(text: string): ExtractedCitation[] {
  const found: ExtractedCitation[] = [];
  const seen = new Set<string>();

  for (const p of IN_PATTERNS) {
    for (const m of text.matchAll(p.regex)) {
      const built = p.build(m);
      const key = built.normalized;
      if (seen.has(key)) continue;
      seen.add(key);
      found.push({ raw: m[0], ...built });
    }
  }

  for (const m of text.matchAll(US_REGEX)) {
    const reporter = normalizeUsReporter(m[2]);
    const normalized = `${m[1]} ${reporter} ${m[3]}`;
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    found.push({
      raw: m[0],
      normalized,
      jurisdiction: "US",
      reporter,
      volume: m[1],
      year: m[5] ? Number(m[5]) : null,
      page: m[3],
      court:
        reporter === "U. S." || reporter === "U.S." || reporter === "S. Ct."
          ? "Supreme Court of the United States"
          : (m[4]?.trim() || null),
    });
  }

  return found;
}
