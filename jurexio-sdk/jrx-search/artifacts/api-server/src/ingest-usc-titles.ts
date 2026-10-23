/**
 * Ingest selected United States Code titles from govinfo HTML packages
 * into nyvapp.statutes (jurisdiction=US, code=USC{N}).
 *
 * Source (public domain):
 *   https://www.govinfo.gov/content/pkg/USCODE-{YEAR}-title{N}/html/USCODE-{YEAR}-title{N}.htm
 *
 * Usage:
 *   node ingest-usc-titles.mjs [--year 2023] [--titles 8,12,26,31] [--max-sections 0]
 *   node ingest-usc-titles.mjs --titles priority
 *
 * Upserts ON CONFLICT (code, section). Rebuilds FTS. Does NOT embed —
 * run embed-statutes.mjs afterwards for NULL embeddings only.
 */
import { pool } from "@workspace/db";
import { logger } from "./lib/logger";
import { STATUTES_DDL, STATUTES_FTS_DDL } from "./lib/statutesDdl";
import { warnIfUnembeddedStatutes } from "./lib/statutesCoverage";

const DEFAULT_YEAR = "2023";

/** High-value titles not already dense in prod (we already carry 11/15/17/18/28/29/35/42). */
const PRIORITY_TITLES = [5, 8, 9, 10, 12, 19, 20, 21, 22, 26, 31, 38, 41, 49, 50];

const TITLE_META: Record<number, { name: string; practice: string }> = {
  5: { name: "U.S. Code Title 5 — Government Organization and Employees", practice: "Administrative & Public" },
  8: { name: "U.S. Code Title 8 — Aliens and Nationality", practice: "Immigration" },
  9: { name: "U.S. Code Title 9 — Arbitration", practice: "Arbitration" },
  10: { name: "U.S. Code Title 10 — Armed Forces", practice: "Defence & Security" },
  12: { name: "U.S. Code Title 12 — Banks and Banking", practice: "Banking & Finance" },
  19: { name: "U.S. Code Title 19 — Customs Duties", practice: "Trade & Industry" },
  20: { name: "U.S. Code Title 20 — Education", practice: "Education" },
  21: { name: "U.S. Code Title 21 — Food and Drugs", practice: "Health & Pharma" },
  22: { name: "U.S. Code Title 22 — Foreign Relations and Intercourse", practice: "International" },
  26: { name: "U.S. Code Title 26 — Internal Revenue Code", practice: "Tax & Finance" },
  31: { name: "U.S. Code Title 31 — Money and Finance", practice: "Tax & Finance" },
  38: { name: "U.S. Code Title 38 — Veterans' Benefits", practice: "Family & Social Welfare" },
  41: { name: "U.S. Code Title 41 — Public Contracts", practice: "Corporate & Commercial" },
  49: { name: "U.S. Code Title 49 — Transportation", practice: "Transport" },
  50: { name: "U.S. Code Title 50 — War and National Defense", practice: "Defence & Security" },
};

function parseArgs(argv: string[]) {
  let year = DEFAULT_YEAR;
  let titles: number[] = [...PRIORITY_TITLES];
  let maxSections = 0;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--year" && argv[i + 1]) year = argv[++i];
    else if (a === "--titles" && argv[i + 1]) {
      const v = argv[++i];
      if (v === "priority") titles = [...PRIORITY_TITLES];
      else titles = v.split(",").map((x) => parseInt(x.trim(), 10)).filter((n) => n > 0);
    } else if (a === "--max-sections" && argv[i + 1]) maxSections = parseInt(argv[++i], 10) || 0;
  }
  return { year, titles, maxSections };
}

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&sect;/g, "§")
    .replace(/&ndash;/g, "–")
    .replace(/&mdash;/g, "—")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
}

function stripTags(s: string): string {
  return decodeEntities(s.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

type ParsedSection = { section: string; heading: string; text: string };

function parseUscHtml(html: string): ParsedSection[] {
  const out: ParsedSection[] = [];
  const re = /<h3 class="section-head">([\s\S]*?)<\/h3>/gi;
  const matches = [...html.matchAll(re)];
  for (let i = 0; i < matches.length; i++) {
    const m = matches[i];
    const headRaw = stripTags(m[1] ?? "");
    // Skip multi-section range heads (§§ 1 to 18)
    if (/^§§/.test(headRaw) || /^§\s*§/.test(headRaw)) continue;
    const secMatch = headRaw.match(/^§\s*([0-9A-Za-z\-–—\.]+)\.?\s*(.*)$/);
    if (!secMatch) continue;
    const section = secMatch[1].replace(/[–—]/g, "-");
    const heading = (secMatch[2] || headRaw).trim() || `Section ${section}`;
    // Skip empty repealed stubs with no body value — still keep if body present
    const start = (m.index ?? 0) + m[0].length;
    const next = matches[i + 1]?.index ?? html.length;
    const bodyHtml = html.slice(start, next);
    const text = stripTags(bodyHtml);
    if (text.length < 20 && /repealed|omitted|transferred/i.test(heading)) continue;
    if (text.length < 8) continue;
    out.push({ section, heading: heading.slice(0, 500), text: text.slice(0, 200_000) });
  }
  return out;
}

async function fetchTitleHtml(year: string, title: number): Promise<string> {
  const url = `https://www.govinfo.gov/content/pkg/USCODE-${year}-title${title}/html/USCODE-${year}-title${title}.htm`;
  const res = await fetch(url, {
    headers: {
      "User-Agent": "Nyayasiddhi-KnowledgePlane/5.0 (statute-ingest; contact=ops@nyayasiddhi.online)",
      Accept: "text/html,*/*",
    },
  });
  if (!res.ok) throw new Error(`govinfo ${title}: HTTP ${res.status}`);
  return await res.text();
}

async function upsertTitle(
  title: number,
  year: string,
  sections: ParsedSection[],
  maxSections: number,
): Promise<number> {
  const meta = TITLE_META[title] ?? {
    name: `U.S. Code Title ${title}`,
    practice: "General",
  };
  const code = `USC${title}`;
  const rows = maxSections > 0 ? sections.slice(0, maxSections) : sections;
  let n = 0;
  // Batch upserts in chunks of 50
  for (let i = 0; i < rows.length; i += 50) {
    const chunk = rows.slice(i, i + 50);
    for (const s of chunk) {
      await pool.query(
        `INSERT INTO statutes (
           code, jurisdiction, section, usc_title, heading, text,
           act_name, act_year, practice_area, provision_type, updated_at
         ) VALUES ($1,'US',$2,$3,$4,$5,$6,$7,$8,'section', now())
         ON CONFLICT (code, section) DO UPDATE SET
           heading = EXCLUDED.heading,
           text = EXCLUDED.text,
           act_name = EXCLUDED.act_name,
           act_year = EXCLUDED.act_year,
           practice_area = EXCLUDED.practice_area,
           usc_title = EXCLUDED.usc_title,
           updated_at = now()`,
        [
          code,
          s.section,
          String(title),
          s.heading,
          s.text,
          meta.name,
          year,
          meta.practice,
        ],
      );
      n++;
    }
    if ((i + chunk.length) % 200 === 0 || i + chunk.length >= rows.length) {
      logger.info({ code, loaded: n, total: rows.length }, "usc: progress");
    }
  }
  return n;
}

async function main() {
  const { year, titles, maxSections } = parseArgs(process.argv.slice(2));
  logger.info({ year, titles, maxSections }, "usc: starting title ingest");
  await pool.query(STATUTES_DDL);

  let total = 0;
  for (const title of titles) {
    try {
      logger.info({ title }, "usc: fetching");
      const html = await fetchTitleHtml(year, title);
      const parsed = parseUscHtml(html);
      logger.info({ title, sections: parsed.length, bytes: html.length }, "usc: parsed");
      const n = await upsertTitle(title, year, parsed, maxSections);
      total += n;
      logger.info({ title, upserted: n }, "usc: title complete");
      // politeness between titles
      await new Promise((r) => setTimeout(r, 1500));
    } catch (err) {
      logger.error({ title, err: String(err) }, "usc: title failed");
    }
  }

  logger.info("usc: rebuilding FTS index…");
  await pool.query(STATUTES_FTS_DDL);
  await pool.query("ANALYZE statutes");
  await warnIfUnembeddedStatutes(pool);
  logger.info({ total }, "usc: ingest run complete");
  await pool.end();
}

main().catch((err) => {
  logger.error({ err: String(err) }, "ingest-usc-titles failed");
  process.exit(1);
});
