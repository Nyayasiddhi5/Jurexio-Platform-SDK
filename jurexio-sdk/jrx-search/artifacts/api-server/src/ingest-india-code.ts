/**
 * Resumable ingest of India Code central Acts (indiacode.nic.in) into the
 * statutes corpus.
 *
 * Pipeline per act:
 *   1. Enumerate all central Acts from the browse-by-short-title listing.
 *   2. Fetch act metadata (?mode=full): title, year, act no, ministry,
 *      enforcement date.
 *   3. Fetch the act page (?view_type=browse) and parse the section list
 *      from the show-data anchors (actid, sectionId, sectionno, heading).
 *   4. Fetch each section's text via /SectionPageContent (JSON
 *      {content, footnote}); footnote = amendment history -> change_notes.
 *   5. Upsert rows ON CONFLICT (code, section); code = slug of the act title
 *      (e.g. COMPANIES-ACT-2013).
 *
 * Progress is tracked per act handle in statute_ingest_progress, so the run
 * is resumable (Ctrl-C safe, idempotent). Acts that duplicate corpora we
 * already carry verbatim (BNS/BNSS/BSA/IPC/CrPC/IEA/COI) are skipped.
 *
 * Usage:
 *   pnpm --filter @workspace/api-server run ingest:indiacode -- [--limit N]
 *     [--priority-only] [--only <handle>] [--retry-failed]
 *
 * Refresh mode (delta re-run to pick up newly passed Acts):
 *   pnpm --filter @workspace/api-server run ingest:indiacode:refresh
 *
 * --refresh re-enumerates India Code, registers any acts absent from
 * statute_ingest_progress, and ingests only new + previously failed acts —
 * acts already marked done/skipped/no-sections are NOT re-fetched. To force
 * re-ingest of a known-amended act, pass --only <handle> (upserts make it
 * safe). Use --force-stale-days N with --refresh to re-open `done` acts whose
 * progress row is older than N days (amendment reconcile). At the end of a
 * refresh run it prints the exact delta-export command (cut at the run's
 * start timestamp) for syncing prod.
 */
import { pool } from "@workspace/db";
import { logger } from "./lib/logger";
import { STATUTES_DDL, STATUTES_FTS_DDL, INGEST_PROGRESS_DDL } from "./lib/statutesDdl";
import { warnIfUnembeddedStatutes } from "./lib/statutesCoverage";
import {
  INDIA_CODE_BASE as BASE,
  decodeEntities,
  stripHtml,
  slugCode,
  practiceArea,
  fetchText,
  sleep,
  fetchActMeta,
  type ActMeta,
} from "./lib/indiaCode";

const BROWSE_HANDLE = "123456789/1362";
// Known-good act with server-rendered section anchors (Competition Act 2002),
// used as a health probe to distinguish degraded pages from PDF-only acts.
const HEALTH_PROBE_HANDLE = "123456789/2010";
const SECTION_CONCURRENCY = 2;
const POLITENESS_MS = 500;

// Acts whose full text we already carry under dedicated codes.
const SKIP_TITLE_PATTERNS: RegExp[] = [
  /bharatiya nyaya sanhita/i,
  /bharatiya nagarik suraksha sanhita/i,
  /bharatiya sakshya adhiniyam/i,
  /^the indian penal code/i,
  /^the code of criminal procedure/i,
  /^the indian evidence act/i,
  /^the constitution of india/i,
];

// Priority practice-area Acts (matched against the act title) — ingested
// first so the most-used corpora land before the long tail.
const PRIORITY_PATTERNS: RegExp[] = [
  /companies act/i,
  /indian contract act/i,
  /specific relief/i,
  /arbitration and conciliation/i,
  /transfer of property/i,
  /registration act/i,
  /information technology act/i,
  /consumer protection act/i,
  /negotiable instruments/i,
  /income[- ]tax act/i,
  /central goods and services tax/i,
  /insolvency and bankruptcy/i,
  /limitation act/i,
  /code of civil procedure/i,
  /hindu marriage/i,
  /hindu succession/i,
  /special marriage/i,
  /indian divorce/i,
  /muslim personal law/i,
  /guardians and wards/i,
  /motor vehicles act/i,
  /industrial disputes/i,
  /code on wages/i,
  /industrial relations code/i,
  /occupational safety/i,
  /code on social security/i,
  /employees.{0,3}provident fund/i,
  /payment of gratuity/i,
  /sexual harassment of women at workplace/i,
  /right to information/i,
  /prevention of corruption/i,
  /prevention of money[- ]laundering/i,
  /foreign exchange management/i,
  /securities and exchange board/i,
  /securities contracts/i,
  /reserve bank of india act/i,
  /banking regulation/i,
  /competition act/i,
  /patents act/i,
  /trade marks act/i,
  /copyright act/i,
  /designs act/i,
  /environment \(protection\)/i,
  /water \(prevention/i,
  /air \(prevention/i,
  /forest \(conservation/i,
  /wild ?life \(protection\)/i,
  /narcotic drugs/i,
  /protection of children from sexual offences/i,
  /juvenile justice/i,
  /protection of women from domestic violence/i,
  /dowry prohibition/i,
  /scheduled castes and the scheduled tribes \(prevention of atrocities\)/i,
  /unlawful activities \(prevention\)/i,
  /arms act/i,
  /passports act/i,
  /citizenship act/i,
  /foreigners act/i,
  /representation of the people act/i,
  /real estate \(regulation/i,
  /land acquisition/i,
  /right to fair compensation/i,
  /easements/i,
  /partnership act/i,
  /limited liability partnership/i,
  /sale of goods/i,
  /indian trusts act/i,
  /societies registration/i,
  /indian stamp act/i,
  /court[- ]fees act/i,
  /advocates act/i,
  /legal services authorities/i,
  /commercial courts/i,
  /family courts/i,
  /indian succession act/i,
  /insurance act/i,
  /food safety and standards/i,
  /drugs and cosmetics/i,
  /electricity act/i,
  /aadhaar/i,
  /digital personal data protection/i,
];

interface ActListing {
  handle: string; // e.g. "123456789/2114"
  title: string;
}
interface SectionRef {
  actid: string;
  sectionId: string;
  sectionno: string;
  heading: string;
  orderno: number;
}

async function enumerateActs(): Promise<ActListing[]> {
  const acts: ActListing[] = [];
  const rpp = 100;
  for (let offset = 0; ; offset += rpp) {
    const html = await fetchText(
      `${BASE}/handle/${BROWSE_HANDLE}/browse?type=shorttitle&rpp=${rpp}&offset=${offset}`,
    );
    const re =
      /headers="t3"[^>]*>\s*<strong>([\s\S]*?)<\/strong>[\s\S]*?headers="t4"[^>]*><a href="\/handle\/(123456789\/\d+)\?view_type=browse"/g;
    let m: RegExpExecArray | null;
    let found = 0;
    while ((m = re.exec(html)) !== null) {
      const title = decodeEntities(m[1]).replace(/\s+/g, " ").trim().replace(/\.+$/, "");
      acts.push({ handle: m[2], title });
      found++;
    }
    logger.info({ offset, found }, "india-code: enumerated browse page");
    if (found < rpp) break;
    await sleep(POLITENESS_MS);
  }
  // dedupe by handle (browse listing can repeat across pagination edges)
  const seen = new Set<string>();
  return acts.filter((a) => (seen.has(a.handle) ? false : (seen.add(a.handle), true)));
}

async function fetchSectionList(handle: string): Promise<SectionRef[]> {
  const html = await fetchText(`${BASE}/handle/${handle}?view_type=browse`);
  // Guard against rate-limit/WAF block pages AND throttled partial renders:
  // when India Code is under load it serves a degraded JS-only page variant
  // with no server-rendered show-data section anchors. But genuine PDF-only
  // acts (e.g. old estate acts) also legitimately render without section
  // anchors. Disambiguate with a health probe against a known-good act
  // (Competition Act 2002): if the probe page has section anchors the site
  // is healthy, so this act genuinely has no sections; otherwise the site
  // is degraded and this act must fail (retryable).
  if (!html.includes("show-data")) {
    const probe = await fetchText(
      `${BASE}/handle/${HEALTH_PROBE_HANDLE}?view_type=browse`,
    ).catch(() => "");
    if (!probe.includes("show-data")) {
      throw new Error(
        `no server-rendered section list (blocked/degraded page, ${html.length} bytes)`,
      );
    }
  }
  const sections: SectionRef[] = [];
  const re =
    /href=\/show-data\?[^>]*?actid=([^&>]+)&sectionId=(\d+)&sectionno=([^&>]*)&orderno=(\d+)[^>]*>\s*<span[^>]*>([\s\S]*?)<\/span>([\s\S]*?)<\/a>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const sectionno = decodeEntities(m[3]).trim();
    const heading = stripHtml(m[6]).replace(/\s+/g, " ").trim().replace(/\.$/, "");
    if (!sectionno) continue;
    sections.push({
      actid: m[1],
      sectionId: m[2],
      sectionno,
      heading: heading || `Section ${sectionno}`,
      orderno: parseInt(m[4], 10),
    });
  }
  // dedupe by sectionno keeping the first (lowest orderno)
  sections.sort((a, b) => a.orderno - b.orderno);
  const seen = new Set<string>();
  return sections.filter((s) =>
    seen.has(s.sectionno) ? false : (seen.add(s.sectionno), true),
  );
}

async function fetchSectionContent(
  actid: string,
  sectionId: string,
): Promise<{ text: string; changeNotes: string | null }> {
  const raw = await fetchText(
    `${BASE}/SectionPageContent?actid=${encodeURIComponent(actid)}&sectionID=${sectionId}`,
  );
  let parsed: { content?: string; footnote?: string };
  try {
    parsed = JSON.parse(raw) as { content?: string; footnote?: string };
  } catch {
    // Some sections return bare HTML instead of JSON
    parsed = { content: raw };
  }
  const text = stripHtml(parsed.content ?? "");
  const notes = stripHtml(parsed.footnote ?? "");
  return { text, changeNotes: notes.length > 3 ? notes.slice(0, 8000) : null };
}

async function upsertRows(
  rows: Array<Record<string, unknown>>,
): Promise<void> {
  for (const r of rows) {
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
         source_act_id = EXCLUDED.source_act_id,
         updated_at = now()`,
      [
        r.code, r.jurisdiction, r.section, r.heading, r.chapter, r.text,
        r.changeNotes, r.actName, r.actYear, r.actNo, r.ministry, r.department,
        r.practiceArea, r.provisionType, r.enactmentDate, r.sourceActId,
      ],
    );
  }
}

async function ingestAct(listing: ActListing): Promise<void> {
  const { handle, title } = listing;
  const [meta, sections] = await Promise.all([
    fetchActMeta(handle),
    fetchSectionList(handle),
  ]);
  const actTitle = meta.title || title;
  const code = slugCode(actTitle + (meta.actYear && !/\d{4}/.test(actTitle) ? `-${meta.actYear}` : ""));
  if (!code) throw new Error("empty code slug");
  if (sections.length === 0) {
    await pool.query(
      `UPDATE statute_ingest_progress SET status='no-sections', code=$2, detail=$3, updated_at=now() WHERE handle=$1`,
      [handle, code, "no parseable sections (PDF-only act)"],
    );
    logger.warn({ handle, title: actTitle }, "india-code: no sections found, skipping");
    return;
  }
  const area = practiceArea(actTitle, meta.ministry);
  const actName = /^the /i.test(actTitle) ? actTitle : `The ${actTitle}`;
  let loaded = 0;
  for (let i = 0; i < sections.length; i += SECTION_CONCURRENCY) {
    const batch = sections.slice(i, i + SECTION_CONCURRENCY);
    const contents = await Promise.all(
      batch.map((s) => fetchSectionContent(s.actid, s.sectionId)),
    );
    const rows = batch
      .map((s, j) => ({
        code,
        jurisdiction: "IN",
        section: s.sectionno,
        heading: s.heading.slice(0, 500),
        chapter: null,
        text: contents[j].text || s.heading,
        changeNotes: contents[j].changeNotes,
        actName,
        actYear: meta.actYear,
        actNo: meta.actNo,
        ministry: meta.ministry,
        department: meta.department,
        practiceArea: area,
        provisionType: "section",
        enactmentDate: meta.enactmentDate,
        sourceActId: s.actid,
      }))
      .filter((r) => r.text.trim().length > 0);
    await upsertRows(rows);
    loaded += rows.length;
    await sleep(POLITENESS_MS);
  }
  await pool.query(
    `UPDATE statute_ingest_progress SET status='done', code=$2, sections_loaded=$3, detail=NULL, updated_at=now() WHERE handle=$1`,
    [handle, code, loaded],
  );
  logger.info(
    { handle, code, sections: loaded, ministry: meta.ministry, practiceArea: area },
    "india-code: act ingested",
  );
}

async function main() {
  const args = process.argv.slice(2);
  const getArg = (name: string) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const limit = getArg("--limit") ? parseInt(getArg("--limit")!, 10) : Infinity;
  const priorityOnly = args.includes("--priority-only");
  const refresh = args.includes("--refresh");
  const retryFailed = args.includes("--retry-failed") || refresh;
  const only = getArg("--only");
  const forceStaleDays = Number(getArg("--force-stale-days") ?? "0");

  await pool.query(STATUTES_DDL);
  await pool.query(INGEST_PROGRESS_DDL);

  if (refresh && forceStaleDays > 0) {
    const { rowCount } = await pool.query(
      `UPDATE statute_ingest_progress
       SET status='pending', detail=COALESCE(detail,'') || ' [stale-reopen]', updated_at=now()
       WHERE status='done'
         AND updated_at < now() - ($1::text || ' days')::interval`,
      [String(forceStaleDays)],
    );
    logger.info(
      { forceStaleDays, reopened: rowCount ?? 0 },
      "india-code: reopened stale done acts for amendment reconcile",
    );
  }

  // Capture the DB clock at run start so refresh runs can print the exact
  // delta-export cutoff for syncing prod afterwards.
  const { rows: clock } = await pool.query<{ now: Date }>(`SELECT now() AS now`);
  const runStartedAt = clock[0].now.toISOString();

  // Wait until India Code is healthy before enumerating: the site cycles
  // through 500s / degraded pages when it throttles our IP, and a hard
  // failure at startup would kill the whole (workflow-managed) run.
  for (let attempt = 1; ; attempt++) {
    const probe = await fetchText(
      `${BASE}/handle/${HEALTH_PROBE_HANDLE}?view_type=browse`,
    ).catch(() => "");
    if (probe.includes("show-data")) break;
    logger.warn(
      { attempt, waitMinutes: 5 },
      "india-code: site unhealthy at startup — waiting before enumeration",
    );
    await sleep(5 * 60 * 1000);
  }

  logger.info("india-code: enumerating central Acts…");
  let acts: ActListing[] = [];
  for (let attempt = 1; ; attempt++) {
    try {
      acts = await enumerateActs();
      break;
    } catch (err) {
      if (attempt >= 5) throw err;
      logger.warn(
        { attempt, err: String(err) },
        "india-code: enumeration failed — retrying in 5 minutes",
      );
      await sleep(5 * 60 * 1000);
    }
  }
  logger.info({ total: acts.length }, "india-code: acts enumerated");

  // register all acts in the progress table
  let newlyRegistered = 0;
  for (const a of acts) {
    const res = await pool.query(
      `INSERT INTO statute_ingest_progress (handle, act_title) VALUES ($1,$2)
       ON CONFLICT (handle) DO UPDATE SET act_title = EXCLUDED.act_title
       RETURNING (xmax = 0) AS inserted`,
      [a.handle, a.title],
    );
    if (res.rows[0]?.inserted) newlyRegistered++;
  }
  if (refresh) {
    logger.info(
      { newActs: newlyRegistered, totalEnumerated: acts.length },
      "india-code: refresh — new acts registered since last run",
    );
  }
  // mark skips
  for (const a of acts) {
    if (SKIP_TITLE_PATTERNS.some((re) => re.test(a.title))) {
      await pool.query(
        `UPDATE statute_ingest_progress SET status='skipped', detail='already carried under dedicated code', updated_at=now()
         WHERE handle=$1 AND status IN ('pending','failed')`,
        [a.handle],
      );
    }
  }

  const statuses = retryFailed ? ["pending", "failed", "in-progress"] : ["pending"];
  const { rows: pendingRows } = await pool.query<{ handle: string }>(
    `SELECT handle FROM statute_ingest_progress WHERE status = ANY($1)`,
    [statuses],
  );
  const pendingSet = new Set(pendingRows.map((r) => r.handle));

  let queue = acts.filter((a) => pendingSet.has(a.handle));
  if (only) queue = acts.filter((a) => a.handle === only);
  const isPriority = (a: ActListing) => PRIORITY_PATTERNS.some((re) => re.test(a.title));
  queue.sort((a, b) => Number(isPriority(b)) - Number(isPriority(a)));
  if (priorityOnly) queue = queue.filter(isPriority);
  if (queue.length > limit) queue = queue.slice(0, limit);

  logger.info(
    { queued: queue.length, priority: queue.filter(isPriority).length },
    "india-code: ingest queue ready",
  );

  let done = 0;
  let failed = 0;
  let consecutiveFailures = 0;
  const CIRCUIT_THRESHOLD = 3;
  const COOLDOWN_MS = 5 * 60 * 1000;
  for (const act of queue) {
    // Circuit breaker: when India Code starts serving degraded pages or 500s,
    // consecutive acts fail. Pause instead of burning through the queue.
    if (consecutiveFailures >= CIRCUIT_THRESHOLD) {
      logger.warn(
        { consecutiveFailures, cooldownMinutes: COOLDOWN_MS / 60000 },
        "india-code: site degraded — cooling down before continuing",
      );
      await sleep(COOLDOWN_MS);
      consecutiveFailures = 0;
    }
    // Atomic claim so multiple workers can run in parallel without overlap.
    const claim = await pool.query(
      `UPDATE statute_ingest_progress SET status='in-progress', updated_at=now()
       WHERE handle=$1 AND status = ANY($2) RETURNING handle`,
      [act.handle, statuses],
    );
    if (claim.rowCount === 0) continue;
    try {
      await ingestAct(act);
      done++;
      consecutiveFailures = 0;
    } catch (err) {
      failed++;
      consecutiveFailures++;
      await pool.query(
        `UPDATE statute_ingest_progress SET status='failed', detail=$2, updated_at=now() WHERE handle=$1`,
        [act.handle, String(err).slice(0, 500)],
      );
      logger.error({ handle: act.handle, title: act.title, err: String(err) }, "india-code: act failed");
    }
    if ((done + failed) % 25 === 0) {
      logger.info({ done, failed, remaining: queue.length - done - failed }, "india-code: progress");
    }
  }

  logger.info("india-code: rebuilding FTS index…");
  await pool.query(STATUTES_FTS_DDL);

  const { rows: summary } = await pool.query(
    `SELECT status, count(*)::int AS n FROM statute_ingest_progress GROUP BY status ORDER BY status`,
  );
  logger.info({ done, failed, summary }, "india-code: ingest run complete");
  await warnIfUnembeddedStatutes(pool);

  if (refresh) {
    const { rows: delta } = await pool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM statutes WHERE updated_at >= $1`,
      [runStartedAt],
    );
    logger.info(
      {
        runStartedAt,
        rowsTouched: delta[0].n,
        nextStep:
          delta[0].n > 0
            ? `pnpm --filter @workspace/api-server run export:statutes-delta -- --since ${runStartedAt} && cd scripts && node sync-statutes-delta.mjs /tmp/statutes-delta.jsonl`
            : "no rows changed — nothing to sync to prod",
      },
      "india-code: refresh complete — prod delta sync command",
    );
  }
  await pool.end();
}

main().catch((err) => {
  logger.error({ err: String(err) }, "ingest-india-code failed");
  process.exit(1);
});
