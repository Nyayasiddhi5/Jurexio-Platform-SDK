/**
 * Ingest PDF-only India Code central Acts into the statutes corpus.
 *
 * The main HTML ingest (ingest-india-code.ts) marks acts that have no
 * server-rendered section list as status 'no-sections' in
 * statute_ingest_progress — indiacode.nic.in only publishes those acts as
 * PDFs (e.g. the Income-tax Act 1961, Wealth-tax Act 1957, Gift-tax Act
 * 1958). This script downloads each act's English PDF bitstream, extracts
 * its text (unpdf; OCR fallback for image-only scans), splits it into
 * sections with the arrangement-of-sections parser, and upserts rows with
 * the same act-metadata columns the HTML ingest writes.
 *
 * Targets are taken from statute_ingest_progress WHERE status='no-sections';
 * when the table has no such rows (fresh environment), the known PDF-only
 * act list (KNOWN_PDF_ONLY_ACTS, discovered 2026-07) is registered first.
 *
 * Usage:
 *   pnpm --filter @workspace/api-server run ingest:indiacode-pdf -- [--only <handle>] [--limit N]
 *
 * Idempotent: upserts ON CONFLICT (code, section); progress rows move to
 * 'done-pdf' with sections_loaded. Re-runnable at any time.
 */
import { pool } from "@workspace/db";
import { logger } from "./lib/logger";
import { STATUTES_DDL, STATUTES_FTS_DDL, INGEST_PROGRESS_DDL } from "./lib/statutesDdl";
import { warnIfUnembeddedStatutes } from "./lib/statutesCoverage";
import {
  INDIA_CODE_BASE,
  fetchText,
  fetchBinary,
  fetchActMeta,
  slugCode,
  practiceArea,
  sleep,
} from "./lib/indiaCode";
import { parsePdfActText, pickPdfPath } from "./lib/pdfActParser";
import { ocrPdf } from "./lib/extractDocText";

const POLITENESS_MS = 1000;
/** Below this many chars/page the PDF is treated as scanned -> OCR. */
const MIN_CHARS_PER_PAGE = 40;

/**
 * PDF-only central Acts (status 'no-sections' in the source dev DB),
 * re-verified against indiacode.nic.in on 2026-07-09: every one of these
 * handles renders without server-side section anchors while the health-probe
 * act renders with them.
 */
const KNOWN_PDF_ONLY_ACTS: Array<{ handle: string; title: string }> = [
  { handle: "123456789/2435", title: "The Income-tax Act, 1961" },
  { handle: "123456789/3123", title: "The Wealth-tax Act, 1957" },
  { handle: "123456789/2483", title: "The Gift-tax Act, 1958" },
  { handle: "123456789/19036", title: "The Bengal Bonded Warehouse Association Act, 1854" },
  { handle: "123456789/19037", title: "The Bengal Embankment Act, 1855" },
  { handle: "123456789/18935", title: "The Bengal Indigo Contracts Act, 1836" },
  { handle: "123456789/18942", title: "The Bengal Land Holder's Attendance Act, 1848" },
  { handle: "123456789/19027", title: "The Bombay Rent-free Estates Act, 1851" },
  { handle: "123456789/18943", title: "The Boundary-Marks, Bombay 1846" },
  { handle: "123456789/19546", title: "The City of Bombay Municipal (Supplementary) Act, 1888" },
  { handle: "123456789/19547", title: "The Deo Estate Act" },
  { handle: "123456789/19543", title: "The Extending certain Acts to Straits Settlement , 1852" },
  { handle: "123456789/19031", title: "The Improvements in Towns Act, 1850" },
  { handle: "123456789/19544", title: "The Madras Board of Revenue,1849" },
  { handle: "123456789/19032", title: "The Madras City Land Revenue Act, 1851" },
  { handle: "123456789/19039", title: "The Rent Recovery Act, 1853" },
  { handle: "123456789/18946", title: "The Revenue Commissioners, Bombay Act, 1842" },
  { handle: "123456789/18945", title: "The Revenue, Bombay, 1842" },
  { handle: "123456789/19040", title: "The Shore Nuisances (Bombay and Kotaba) Act, 1853" },
];

async function extractPdfText(bytes: Buffer): Promise<{ text: string; ocrUsed: boolean }> {
  const { extractText, getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(new Uint8Array(bytes));
  const numPages = pdf.numPages || 1;
  const { text } = await extractText(pdf, { mergePages: true });
  if (text.trim().length >= MIN_CHARS_PER_PAGE * numPages) {
    return { text, ocrUsed: false };
  }
  logger.info({ numPages, embeddedChars: text.trim().length }, "india-code-pdf: image-only PDF, running OCR");
  const ocr = await ocrPdf(bytes, numPages);
  return { text: ocr.text, ocrUsed: true };
}

async function ingestPdfAct(handle: string, listedTitle: string): Promise<number> {
  const [meta, browseHtml] = await Promise.all([
    fetchActMeta(handle),
    fetchText(`${INDIA_CODE_BASE}/handle/${handle}?view_type=browse`),
  ]);
  const actTitle = meta.title || listedTitle;
  const code = slugCode(
    actTitle + (meta.actYear && !/\d{4}/.test(actTitle) ? `-${meta.actYear}` : ""),
  );
  if (!code) throw new Error("empty code slug");

  const pdfPath = pickPdfPath(browseHtml, handle);
  if (!pdfPath) throw new Error("no PDF bitstream found on act page");

  const bytes = await fetchBinary(`${INDIA_CODE_BASE}${pdfPath}`);
  logger.info({ handle, pdfPath, kb: Math.round(bytes.length / 1024) }, "india-code-pdf: PDF downloaded");

  const { text, ocrUsed } = await extractPdfText(bytes);
  const parsed = parsePdfActText(text);
  const area = practiceArea(actTitle, meta.ministry);
  const actName = /^the /i.test(actTitle) ? actTitle : `The ${actTitle}`;
  let sections = parsed.sections;
  if (sections.length === 0) {
    // Very old acts (mostly pre-1900) use abstract-style prose with no
    // numbered section boundaries. For short acts, store the whole act as a
    // single searchable full-text provision instead of dropping it. Large
    // unparseable acts still fail loudly (a single row would be unusable).
    const cleaned = text.replace(/\s+/g, " ").trim();
    if (cleaned.length === 0 || cleaned.length > 40_000) {
      throw new Error(
        `no sections parsed from PDF (${text.length} chars extracted, ocr=${ocrUsed})`,
      );
    }
    sections = [
      { section: "Full Act", heading: actName, text: cleaned, headingOnly: false },
    ];
    logger.warn(
      { handle, code, chars: cleaned.length },
      "india-code-pdf: no section boundaries found — storing as single full-act provision",
    );
  }

  let loaded = 0;
  for (const s of sections) {
    if (!s.text.trim()) continue;
    await pool.query(
      `INSERT INTO statutes (code, jurisdiction, section, heading, chapter, text,
         change_notes, act_name, act_year, act_no, ministry, department,
         practice_area, provision_type, enactment_date, source_act_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
       ON CONFLICT (code, section) DO UPDATE SET
         heading = EXCLUDED.heading, text = EXCLUDED.text,
         change_notes = EXCLUDED.change_notes, act_name = EXCLUDED.act_name,
         act_year = EXCLUDED.act_year, act_no = EXCLUDED.act_no,
         ministry = EXCLUDED.ministry, department = EXCLUDED.department,
         practice_area = EXCLUDED.practice_area,
         provision_type = EXCLUDED.provision_type,
         enactment_date = EXCLUDED.enactment_date,
         source_act_id = EXCLUDED.source_act_id`,
      [
        code, "IN", s.section, s.heading.slice(0, 500), null, s.text,
        null, actName, meta.actYear, meta.actNo, meta.ministry, meta.department,
        area, s.section === "Full Act" ? "act" : "section", meta.enactmentDate, handle,
      ],
    );
    loaded++;
  }

  await pool.query(
    `UPDATE statute_ingest_progress
       SET status='done-pdf', code=$2, sections_loaded=$3, detail=$4, updated_at=now()
     WHERE handle=$1`,
    [
      handle, code, loaded,
      `pdf ingest: ${parsed.stats.mode}, ${parsed.stats.matchedInBody}/${parsed.stats.arrangementEntries || loaded} matched, ${parsed.stats.headingOnly} heading-only${ocrUsed ? ", OCR" : ""}`,
    ],
  );
  logger.info(
    { handle, code, sections: loaded, stats: parsed.stats, ocrUsed, practiceArea: area },
    "india-code-pdf: act ingested",
  );
  return loaded;
}

async function main() {
  const args = process.argv.slice(2);
  const getArg = (name: string) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const only = getArg("--only");
  const limit = getArg("--limit") ? parseInt(getArg("--limit")!, 10) : Infinity;

  await pool.query(STATUTES_DDL);
  await pool.query(INGEST_PROGRESS_DDL);

  // Register the known PDF-only acts so fresh environments (no prior HTML
  // ingest run) still have progress rows to claim. Never downgrades rows the
  // HTML ingest already resolved.
  for (const a of KNOWN_PDF_ONLY_ACTS) {
    await pool.query(
      `INSERT INTO statute_ingest_progress (handle, act_title, status, detail)
       VALUES ($1,$2,'no-sections','known PDF-only act (registered by pdf ingest)')
       ON CONFLICT (handle) DO UPDATE SET status='no-sections', detail=EXCLUDED.detail, updated_at=now()
       WHERE statute_ingest_progress.status IN ('pending','failed')`,
      [a.handle, a.title],
    );
  }

  const { rows } = await pool.query<{ handle: string; act_title: string }>(
    `SELECT handle, act_title FROM statute_ingest_progress
     WHERE status='no-sections' ${only ? "AND handle=$1" : ""}
     ORDER BY act_title`,
    only ? [only] : [],
  );
  let queue = rows;
  if (queue.length > limit) queue = queue.slice(0, limit);
  logger.info({ queued: queue.length }, "india-code-pdf: queue ready");

  let done = 0;
  let failed = 0;
  for (const act of queue) {
    // Claim so a concurrently running HTML ingest never touches these rows.
    const claim = await pool.query(
      `UPDATE statute_ingest_progress SET status='in-progress-pdf', updated_at=now()
       WHERE handle=$1 AND status='no-sections' RETURNING handle`,
      [act.handle],
    );
    if (claim.rowCount === 0) continue;
    try {
      await ingestPdfAct(act.handle, act.act_title);
      done++;
    } catch (err) {
      failed++;
      await pool.query(
        `UPDATE statute_ingest_progress SET status='no-sections', detail=$2, updated_at=now() WHERE handle=$1`,
        [act.handle, `pdf ingest failed: ${String(err).slice(0, 450)}`],
      );
      logger.error({ handle: act.handle, title: act.act_title, err: String(err) }, "india-code-pdf: act failed");
    }
    await sleep(POLITENESS_MS);
  }

  logger.info("india-code-pdf: rebuilding FTS index…");
  await pool.query(STATUTES_FTS_DDL);

  logger.info({ done, failed }, "india-code-pdf: run complete");
  await warnIfUnembeddedStatutes(pool);
  await pool.end();
  if (failed > 0) process.exitCode = 1;
}

main().catch((err) => {
  logger.error({ err: String(err) }, "ingest-india-code-pdf failed");
  process.exit(1);
});
