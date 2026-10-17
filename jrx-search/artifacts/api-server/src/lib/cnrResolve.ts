/**
 * CNR corpus resolve — Tier1 RDS → Tier2 Athena/Open Data → Tier3 FTS → Tier4 live (opt-in).
 * Corpus tiers set claimEcourts:false; Tier4 live sets claimEcourts:true when NIC API configured.
 */
import {
  AthenaClient,
  StartQueryExecutionCommand,
  GetQueryExecutionCommand,
  GetQueryResultsCommand,
  StopQueryExecutionCommand,
} from "@aws-sdk/client-athena";
import { or, ilike, sql } from "drizzle-orm";
import { db, caselawDocumentsTable, type CaselawDocument } from "@workspace/db";
import { getRdsPool } from "./rdsPool";
import { rdsBackendEnabled, searchRdsJudgments } from "./rdsCaselaw";
import { isStatementTimeout } from "./caselaw";
import { logger } from "./logger";
import { normalizeCnr, validateCnr } from "./cnrNormalize";
import {
  normalizeDiary,
  validateDiary,
  parseCourtTypeHint,
  normalizeDiaryRaw,
  inferCourtTypeFromDiary,
  type CourtTier,
} from "./diaryNormalize";
import {
  buildCaseCreateProfile,
  buildFieldManifest,
  caseDetailsNeedsColdPath,
  extractPoliceStationFromText,
  hearingsToTimeline,
  type CnrCaseCreateProfile,
} from "./cnrCaseCreate";
import { extractArchiveText } from "./archiveDocs";
import {
  fetchLiveEcourtsByCnr,
  type LiveEcourtsHit,
} from "./nv-ecourts-portal-fetch";

export type CnrFieldValue = {
  value: unknown;
  source: string | null;
  confidence: number;
  note?: string;
};

export type CnrDocument = {
  id: string;
  kind: "judgment" | "order";
  title: string;
  decisionDate: string | null;
  s3Path: string | null;
  pdfUrlKind: "presigned" | "none";
  sourceArchive: "sc" | "hc" | "dc" | "unknown";
  judgmentId?: number;
};

export type CnrCandidate = {
  cnr: string | null;
  title: string;
  courtName: string | null;
  decisionDate: string | null;
  confidence: number;
  source: string;
};

export type { CnrCaseCreateProfile } from "./cnrCaseCreate";

export type CnrExtractPreview = {
  s3Path: string;
  textLength: number;
  truncated: boolean;
  ocrUsed: boolean;
  policeStation: string | null;
  source: "nyv_extract";
};

/** RDS pool contention / statement_timeout — not a corpus miss (NV-CNR-BUSY-001). */
export class CnrUpstreamBusyError extends Error {
  readonly code = "CNR_UPSTREAM_BUSY" as const;
  readonly retryable = true;
  constructor(
    message = "CNR lookup temporarily unavailable — RDS busy; retry shortly",
  ) {
    super(message);
    this.name = "CnrUpstreamBusyError";
  }
}

export type CnrResolveResult = {
  cnr: string;
  /** Present when lookup was by diary number. */
  diaryNumber?: string | null;
  lookupType?: "cnr" | "diary";
  status: "found" | "suggested" | "not_found" | "invalid";
  matchType: "exact" | "fuzzy" | "none" | "invalid";
  source: string | null;
  sourcesTried: string[];
  confidence: number;
  claimEcourts: boolean;
  validation: "ok" | "soft" | "invalid";
  ui: { badge: string; subtitle: string };
  fields: Record<string, CnrFieldValue> | null;
  /** Present when `options.profile === "caseCreate"`. */
  caseCreate?: CnrCaseCreateProfile;
  extractPreview?: CnrExtractPreview | null;
  documents: CnrDocument[];
  candidates: CnrCandidate[];
  meta: {
    attribution: string;
    latencyMs: number;
  };
};

function field(
  value: unknown,
  source: string | null,
  confidence: number,
  note?: string,
): CnrFieldValue {
  return { value, source, confidence, ...(note ? { note } : {}) };
}

function judgesToArray(raw: string | null | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(/[,;|]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function hcS3Path(r: {
  court_type: string;
  pdf_link: string | null;
  court_code: string | null;
  bench: string | null;
  year: number;
}): string | null {
  if (r.court_type !== "hc" || !r.pdf_link || !r.court_code || !r.bench) {
    return null;
  }
  const basename = r.pdf_link.split("/").pop();
  if (!basename || !basename.toLowerCase().endsWith(".pdf")) return null;
  const courtDir = r.court_code.replace(/~/g, "_");
  return `s3://ns-highcourt-data-bucket/data/pdf/year=${r.year}/court=${courtDir}/bench=${r.bench}/${basename}`;
}

async function recordMetric(status: string, source: string): Promise<void> {
  if (!rdsBackendEnabled()) return;
  try {
    const pool = await getRdsPool();
    await pool.query(
      `INSERT INTO cnr_resolve_metrics (day, status, source, hit_count)
       VALUES (CURRENT_DATE, $1, $2, 1)
       ON CONFLICT (day, status, source)
       DO UPDATE SET hit_count = cnr_resolve_metrics.hit_count + 1`,
      [status, source],
    );
  } catch {
    /* metrics table may not exist yet — non-fatal */
  }
}

type JudgmentHit = {
  id: number;
  court_type: string;
  court_code: string | null;
  court: string;
  bench: string | null;
  year: number;
  title: string;
  petitioner: string | null;
  respondent: string | null;
  judges: string | null;
  citation: string | null;
  cnr: string | null;
  case_type: string | null;
  case_no: string | null;
  decision_date: string | null;
  disposal_nature: string | null;
  pet_advocate: string | null;
  res_advocate: string | null;
  fir_no: string | null;
  purpose_name: string | null;
  description: string | null;
  date_of_registration: string | null;
  pdf_link: string | null;
  source: string;
};

type CaseDetailsHit = {
  cnr: string;
  court_code: string | null;
  case_type: string | null;
  case_no: string | null;
  petitioner: string | null;
  respondent: string | null;
  pet_advocate: string | null;
  res_advocate: string | null;
  judges: string | null;
  filing_date: string | null;
  decision_date: string | null;
  disposal_nature: string | null;
  case_status: string | null;
  acts_sections: unknown;
  hearings: unknown;
  source: string;
};

/** Mirrors caselaw search fail-soft — CNR exact lookup must not 500 under load. */
const CNR_RDS_STATEMENT_TIMEOUT_MS = 8_000;
/** Fail fast when embed UPDATE holds row locks — prefer retry over 16s wall. */
const CNR_RDS_LOCK_TIMEOUT_MS = 2_000;

type RdsTierResult<T> = { rows: T[]; degraded: boolean };

function isRdsContention(err: unknown): boolean {
  if (isStatementTimeout(err)) return true;
  const code = (err as { code?: string })?.code;
  return code === "55P03" || code === "57014";
}

function envMs(name: string, fallback: number, min = 1_000, max = 120_000): number {
  const n = Number(process.env[name]);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(max, Math.max(min, Math.floor(n)));
}

/** Per-Athena-query poll budget (was hardcoded 45s — caused NYV 503 under default profile). */
const CNR_ATHENA_BUDGET_MS = envMs("NYS_ATHENA_QUERY_BUDGET_MS", 12_000);
/** Wall-clock budget for partner default resolve (RDS + case_details + optional FTS). */
const CNR_RESOLVE_BUDGET_DEFAULT_MS = envMs("NYS_CNR_RESOLVE_BUDGET_MS", 8_000);
/** Tier-4 live eCourts budget (opt-in via options.live). */
const CNR_LIVE_BUDGET_MS = envMs("NYS_CNR_LIVE_BUDGET_MS", 90_000, 15_000, 120_000);
/** caseCreate cold path may hit Athena parquet case_details. */
const CNR_RESOLVE_BUDGET_CASECREATE_MS = envMs(
  "NYS_CNR_RESOLVE_BUDGET_CASECREATE_MS",
  45_000,
);

function resolveDeadline(profile: "default" | "caseCreate"): number {
  const budget =
    profile === "caseCreate"
      ? CNR_RESOLVE_BUDGET_CASECREATE_MS
      : CNR_RESOLVE_BUDGET_DEFAULT_MS;
  return Date.now() + budget;
}

function budgetRemaining(deadline: number): number {
  return Math.max(0, deadline - Date.now());
}

function budgetExpired(deadline: number): boolean {
  return Date.now() >= deadline;
}

async function findRdsByCnr(cnr: string): Promise<RdsTierResult<JudgmentHit>> {
  const pool = await getRdsPool();
  // Exact equality uses judgments_cnr_idx (~ms). Never OR with upper(btrim(cnr)) —
  // that disables the btree plan and times out on 20M+ rows.
  const runQuery = async (): Promise<JudgmentHit[]> => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN READ ONLY");
      await client.query(
        `SET LOCAL statement_timeout = ${CNR_RDS_STATEMENT_TIMEOUT_MS}`,
      );
      await client.query(`SET LOCAL lock_timeout = ${CNR_RDS_LOCK_TIMEOUT_MS}`);
      const res = await client.query<JudgmentHit>(
        `SELECT id, court_type, court_code, court, bench, year, title, petitioner,
                respondent, judges, citation, cnr, case_type, case_no,
                decision_date::text, disposal_nature, pet_advocate, res_advocate,
                fir_no, purpose_name, description,
                date_of_registration::text, pdf_link, source
         FROM judgments
         WHERE cnr = $1
         ORDER BY decision_date DESC NULLS LAST, id DESC
         LIMIT 25`,
        [cnr],
      );
      await client.query("COMMIT");
      return res.rows;
    } catch (err) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  };

  try {
    const rows = await runQuery();
    return { rows, degraded: false };
  } catch (err) {
    if (!isRdsContention(err)) throw err;
    logger.warn({ cnr }, "CNR RDS lookup hit contention; retrying once");
    try {
      const rows = await runQuery();
      return { rows, degraded: false };
    } catch (retryErr) {
      if (isRdsContention(retryErr)) {
        logger.warn(
          { cnr },
          "CNR RDS lookup timed out again; marking tier degraded (fail-soft)",
        );
        return { rows: [], degraded: true };
      }
      throw retryErr;
    }
  }
}

async function findCaseDetails(cnr: string): Promise<{
  hit: CaseDetailsHit | null;
  degraded: boolean;
}> {
  try {
    const pool = await getRdsPool();
    const client = await pool.connect();
    try {
      await client.query("BEGIN READ ONLY");
      await client.query(
        `SET LOCAL statement_timeout = ${CNR_RDS_STATEMENT_TIMEOUT_MS}`,
      );
      await client.query(`SET LOCAL lock_timeout = ${CNR_RDS_LOCK_TIMEOUT_MS}`);
      const res = await client.query<CaseDetailsHit>(
        `SELECT cnr, court_code, case_type, case_no, petitioner, respondent,
                pet_advocate, res_advocate, judges,
                filing_date::text, decision_date::text, disposal_nature,
                case_status, acts_sections, hearings, source
         FROM cnr_case_details WHERE cnr = $1 LIMIT 1`,
        [cnr],
      );
      await client.query("COMMIT");
      return { hit: res.rows[0] ?? null, degraded: false };
    } catch (err) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    if (isRdsContention(err)) {
      logger.warn({ cnr }, "CNR case_details lookup timed out; marking tier degraded");
      return { hit: null, degraded: true };
    }
    return { hit: null, degraded: false };
  }
}

async function findAppdbByCnr(cnr: string): Promise<JudgmentHit[]> {
  const rows = await db
    .select()
    .from(caselawDocumentsTable)
    .where(sql`upper(btrim(coalesce(${caselawDocumentsTable.cnr}, ''))) = ${cnr}`)
    .limit(25);
  return rows.map((r: CaselawDocument) => ({
    id: r.id,
    court_type: "sc",
    court_code: null,
    court: r.court ?? "Supreme Court of India",
    bench: null,
    year: r.year ?? 0,
    title: r.title,
    petitioner: r.petitioner,
    respondent: r.respondent,
    judges: r.judges,
    citation: r.citation,
    cnr: r.cnr,
    case_type: null,
    case_no: null,
    decision_date: r.decisionDate
      ? new Date(r.decisionDate).toISOString().slice(0, 10)
      : null,
    disposal_nature: r.disposalNature,
    pet_advocate: null,
    res_advocate: null,
    fir_no: null,
    purpose_name: null,
    description: null,
    date_of_registration: null,
    pdf_link: null,
    source: r.source,
  }));
}

function athenaConfig() {
  const database = process.env.ATHENA_DATABASE;
  const table = process.env.ATHENA_TABLE;
  const output = process.env.ATHENA_OUTPUT_S3;
  if (!database || !table || !output) return null;
  return {
    database,
    table,
    hcTable: process.env.ATHENA_TABLE_HC || null,
    hcCaseDetailsTable: process.env.ATHENA_TABLE_HC_CASE_DETAILS || null,
    scCaseDetailsTable: process.env.ATHENA_TABLE_SC_CASE_DETAILS || null,
    dcCaseDetailsTable: process.env.ATHENA_TABLE_DC_CASE_DETAILS || null,
    output,
    workgroup: process.env.ATHENA_WORKGROUP ?? "primary",
    region:
      process.env.ATHENA_REGION ?? process.env.BEDROCK_REGION ?? "ap-south-1",
  };
}

/** Best-effort court tier from CNR prefix for Athena case_details table routing. */
function inferCnrCourtTier(cnr: string): "hc" | "sc" | "dc" | "unknown" {
  const u = cnr.toUpperCase();
  if (/\dHC/.test(u) || u.includes("HC")) return "hc";
  if (/^SC/i.test(u) || u.includes("INSC")) return "sc";
  if (u.length >= 16 && !u.includes("HC")) return "dc";
  return "unknown";
}

function liveHitToCaseDetails(cnr: string, hit: LiveEcourtsHit): CaseDetailsHit {
  return {
    cnr,
    court_code: null,
    case_type: hit.caseType,
    case_no: hit.caseNo,
    petitioner: hit.petitioner,
    respondent: hit.respondent,
    pet_advocate: hit.petAdvocate,
    res_advocate: hit.resAdvocate,
    judges: null,
    filing_date: hit.filingDate,
    decision_date: hit.decisionDate,
    disposal_nature: null,
    case_status: hit.caseStatus,
    acts_sections: hit.actSection ? [{ act: hit.actSection }] : [],
    hearings: hit.hearings.map((h) => ({
      business_on_date: h.date,
      purpose_of_hearing: h.purpose,
      judge: h.judge,
      case_status: h.status,
    })),
    source: "ecourts_live",
  };
}

async function resolveLiveCnrTier(
  cnr: string,
  opts: {
    includeDocuments?: boolean;
    wantCaseCreate: boolean;
  },
  sourcesTried: string[],
  t0: number,
  validation: "ok" | "soft" | "invalid",
  attribution: string,
): Promise<CnrResolveResult> {
  sourcesTried.push("ecourts_live");
  const live = await fetchLiveEcourtsByCnr(cnr, CNR_LIVE_BUDGET_MS);
  if (!live.ok) {
    if (live.code === "NOT_CONFIGURED") {
      await recordMetric("not_found", "ecourts_not_configured");
      return {
        cnr,
        status: "not_found",
        matchType: "none",
        source: null,
        sourcesTried,
        confidence: 0,
        claimEcourts: false,
        validation,
        ui: {
          badge: "Live eCourts unavailable",
          subtitle: live.message,
        },
        fields: null,
        documents: [],
        candidates: [],
        meta: { attribution, latencyMs: Date.now() - t0 },
      };
    }
    if (live.retryable) {
      throw new CnrUpstreamBusyError(live.message);
    }
    await recordMetric("not_found", "ecourts_live_miss");
    return {
      cnr,
      status: "not_found",
      matchType: "none",
      source: null,
      sourcesTried,
      confidence: 0,
      claimEcourts: false,
      validation,
      ui: {
        badge: "Not on live eCourts",
        subtitle: live.message,
      },
      fields: null,
      documents: [],
      candidates: [],
      meta: { attribution, latencyMs: Date.now() - t0 },
    };
  }

  const details = liveHitToCaseDetails(cnr, live.hit);
  void writeThroughCaseDetails(details);

  const syntheticPrimary: JudgmentHit = {
    id: 0,
    court_type: "hc",
    court_code: null,
    court: live.hit.courtName ?? "eCourts",
    bench: null,
    year: new Date().getUTCFullYear(),
    title: [live.hit.petitioner, live.hit.respondent].filter(Boolean).join(" v ") || `CNR ${cnr}`,
    petitioner: live.hit.petitioner,
    respondent: live.hit.respondent,
    judges: null,
    citation: null,
    cnr,
    case_type: live.hit.caseType,
    case_no: live.hit.caseNo,
    decision_date: live.hit.decisionDate,
    disposal_nature: null,
    pet_advocate: live.hit.petAdvocate,
    res_advocate: live.hit.resAdvocate,
    fir_no: null,
    purpose_name: null,
    description: null,
    date_of_registration: live.hit.filingDate,
    pdf_link: null,
    source: "ecourts_live",
  };

  let caseCreate: CnrCaseCreateProfile | undefined;
  if (opts.wantCaseCreate) {
    caseCreate = buildCaseCreateFromHits(
      cnr,
      syntheticPrimary,
      [syntheticPrimary],
      details,
      "ecourts_live",
    );
    if (live.hit.nextHearingDate) {
      caseCreate.header.nextHearingDate = {
        value: live.hit.nextHearingDate,
        source: "ecourts_live",
        confidence: 0.9,
      };
    }
    caseCreate.fieldManifest = buildFieldManifest(caseCreate);
  }

  const fields = buildFields(syntheticPrimary, details, "ecourts_live");
  if (live.hit.nextHearingDate) {
    fields.nextHearingDate = field(live.hit.nextHearingDate, "ecourts_live", 0.9);
  }

  await recordMetric("found", "ecourts_live");
  return {
    cnr,
    status: "found",
    matchType: "exact",
    source: "ecourts_live",
    sourcesTried,
    confidence: 0.88,
    claimEcourts: true,
    validation,
    ui: {
      badge: "Live eCourts",
      subtitle: "Fetched from eCourts — may differ from judgment corpus",
    },
    fields,
    caseCreate,
    documents: opts.includeDocuments === false ? [] : [],
    candidates: [],
    meta: {
      attribution: "Live case status from NIC eCourts API — not CC-BY corpus.",
      latencyMs: Date.now() - t0,
    },
  };
}

function sqlLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

async function athenaByCnr(
  cnr: string,
  budgetMs = CNR_ATHENA_BUDGET_MS,
): Promise<{
  rows: Array<Record<string, string | null>>;
  archive: "sc" | "hc";
} | null> {
  const cfg = athenaConfig();
  if (!cfg || budgetMs <= 0) return null;

  const client = new AthenaClient({ region: cfg.region });
  const lit = sqlLiteral(cnr);
  // Prefer HC (richer CNR coverage) then SC.
  const attempts: Array<{ archive: "sc" | "hc"; table: string }> = [];
  if (cfg.hcTable) attempts.push({ archive: "hc", table: cfg.hcTable });
  attempts.push({ archive: "sc", table: cfg.table });

  for (const attempt of attempts) {
    if (budgetMs <= 0) break;
    const query = `
      SELECT title, court, year, citation, decision_date, s3_path, cnr,
             petitioner, respondent, case_type, case_no, disposal_nature,
             description
      FROM "${cfg.database}"."${attempt.table}"
      WHERE upper(trim(cast(cnr AS varchar))) = ${lit}
      LIMIT 10`;
    try {
      const start = await client.send(
        new StartQueryExecutionCommand({
          QueryString: query,
          QueryExecutionContext: { Database: cfg.database },
          ResultConfiguration: { OutputLocation: cfg.output },
          WorkGroup: cfg.workgroup,
        }),
      );
      const qid = start.QueryExecutionId;
      if (!qid) continue;
      const pollDeadline = Date.now() + budgetMs;
      let state = "RUNNING";
      while (Date.now() < pollDeadline) {
        const exec = await client.send(
          new GetQueryExecutionCommand({ QueryExecutionId: qid }),
        );
        state = exec.QueryExecution?.Status?.State ?? "UNKNOWN";
        if (state === "SUCCEEDED" || state === "FAILED" || state === "CANCELLED")
          break;
        await new Promise((r) => setTimeout(r, 750));
      }
      if (state !== "SUCCEEDED") {
        if (state === "RUNNING" || state === "QUEUED") {
          await client
            .send(new StopQueryExecutionCommand({ QueryExecutionId: qid }))
            .catch(() => undefined);
        }
        continue;
      }
      const results = await client.send(
        new GetQueryResultsCommand({ QueryExecutionId: qid }),
      );
      const resultRows = results.ResultSet?.Rows ?? [];
      if (resultRows.length <= 1) continue;
      const headers = (resultRows[0]?.Data ?? []).map(
        (c) => c.VarCharValue ?? "",
      );
      const mapped = resultRows.slice(1).map((row) => {
        const obj: Record<string, string | null> = {};
        (row.Data ?? []).forEach((cell, i) => {
          obj[headers[i] ?? `c${i}`] = cell.VarCharValue ?? null;
        });
        return obj;
      });
      return { rows: mapped, archive: attempt.archive };
    } catch (err) {
      logger.warn(
        { err: String(err), archive: attempt.archive },
        "cnr athena lookup failed",
      );
    }
  }
  return null;
}

async function runAthenaQuery(
  query: string,
  budgetMs = CNR_ATHENA_BUDGET_MS,
): Promise<Array<Record<string, string | null>>> {
  const cfg = athenaConfig();
  if (!cfg || budgetMs <= 0) return [];
  const client = new AthenaClient({ region: cfg.region });
  try {
    const start = await client.send(
      new StartQueryExecutionCommand({
        QueryString: query,
        QueryExecutionContext: { Database: cfg.database },
        ResultConfiguration: { OutputLocation: cfg.output },
        WorkGroup: cfg.workgroup,
      }),
    );
    const qid = start.QueryExecutionId;
    if (!qid) return [];
    const deadline = Date.now() + budgetMs;
    let state = "RUNNING";
    while (Date.now() < deadline) {
      const exec = await client.send(
        new GetQueryExecutionCommand({ QueryExecutionId: qid }),
      );
      state = exec.QueryExecution?.Status?.State ?? "UNKNOWN";
      if (state === "SUCCEEDED" || state === "FAILED" || state === "CANCELLED")
        break;
      await new Promise((r) => setTimeout(r, 750));
    }
    if (state !== "SUCCEEDED") {
      if (state === "RUNNING" || state === "QUEUED") {
        await client
          .send(new StopQueryExecutionCommand({ QueryExecutionId: qid }))
          .catch(() => undefined);
      }
      return [];
    }
    const results = await client.send(
      new GetQueryResultsCommand({ QueryExecutionId: qid }),
    );
    const resultRows = results.ResultSet?.Rows ?? [];
    if (resultRows.length <= 1) return [];
    const headers = (resultRows[0]?.Data ?? []).map((c) => c.VarCharValue ?? "");
    return resultRows.slice(1).map((row) => {
      const obj: Record<string, string | null> = {};
      (row.Data ?? []).forEach((cell, i) => {
        obj[headers[i] ?? `c${i}`] = cell.VarCharValue ?? null;
      });
      return obj;
    });
  } catch (err) {
    logger.warn({ err: String(err) }, "athena query failed");
    return [];
  }
}

function parseJsonField(raw: string | null): unknown {
  if (!raw) return [];
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return raw;
  }
}

function mapAthenaRowToCaseDetails(
  cnr: string,
  row: Record<string, string | null>,
): CaseDetailsHit {
  return {
    cnr,
    court_code: row.court_code ?? row.court ?? null,
    case_type: row.case_type,
    case_no: row.case_no,
    petitioner: row.petitioner,
    respondent: row.respondent,
    pet_advocate: row.pet_advocate ?? row.pet_advocate_name ?? null,
    res_advocate: row.res_advocate ?? row.res_advocate_name ?? null,
    judges: row.judges ?? row.judge ?? null,
    filing_date: row.filing_date ?? row.date_of_filing ?? null,
    decision_date: row.decision_date ?? null,
    disposal_nature: row.disposal_nature,
    case_status: row.case_status ?? row.status ?? null,
    acts_sections: parseJsonField(row.acts_sections ?? row.acts ?? null),
    hearings: parseJsonField(row.hearings ?? row.hearing_details ?? null),
    source: "opendata_athena_hc_case_details",
  };
}

async function athenaCaseDetailsByCnr(
  cnr: string,
  budgetMs = CNR_ATHENA_BUDGET_MS,
): Promise<CaseDetailsHit | null> {
  const cfg = athenaConfig();
  if (!cfg || budgetMs <= 0) return null;

  const tier = inferCnrCourtTier(cnr);
  const tableAttempts: Array<{ table: string; source: string }> = [];
  const push = (table: string | null | undefined, source: string) => {
    if (table && !tableAttempts.some((t) => t.table === table)) {
      tableAttempts.push({ table, source });
    }
  };
  if (tier === "hc") {
    push(cfg.hcCaseDetailsTable, "opendata_athena_hc_case_details");
    push(cfg.dcCaseDetailsTable, "opendata_athena_dc_case_details");
    push(cfg.scCaseDetailsTable, "opendata_athena_sc_case_details");
  } else if (tier === "dc") {
    push(cfg.dcCaseDetailsTable, "opendata_athena_dc_case_details");
    push(cfg.hcCaseDetailsTable, "opendata_athena_hc_case_details");
  } else if (tier === "sc") {
    push(cfg.scCaseDetailsTable, "opendata_athena_sc_case_details");
    push(cfg.hcCaseDetailsTable, "opendata_athena_hc_case_details");
  } else {
    push(cfg.hcCaseDetailsTable, "opendata_athena_hc_case_details");
    push(cfg.dcCaseDetailsTable, "opendata_athena_dc_case_details");
    push(cfg.scCaseDetailsTable, "opendata_athena_sc_case_details");
  }

  const lit = sqlLiteral(cnr);
  let remaining = budgetMs;
  for (const attempt of tableAttempts) {
    if (remaining <= 0) break;
    const query = `
      SELECT cnr, court_code, court, bench, case_type, case_no,
             petitioner, respondent, pet_advocate, res_advocate, judges,
             filing_date, decision_date, disposal_nature, case_status,
             acts_sections, hearings, hearing_details
      FROM "${cfg.database}"."${attempt.table}"
      WHERE upper(trim(cast(cnr AS varchar))) = ${lit}
      LIMIT 1`;
    const t0 = Date.now();
    const rows = await runAthenaQuery(query, remaining);
    remaining -= Date.now() - t0;
    if (!rows.length) continue;
    const hit = mapAthenaRowToCaseDetails(cnr, rows[0]!);
    hit.source = attempt.source;
    return hit;
  }
  return null;
}

async function writeThroughCaseDetails(details: CaseDetailsHit): Promise<void> {
  if (!rdsBackendEnabled()) return;
  try {
    const pool = await getRdsPool();
    await pool.query(
      `INSERT INTO cnr_case_details (
         cnr, court_code, case_type, case_no, petitioner, respondent,
         pet_advocate, res_advocate, judges, filing_date, decision_date,
         disposal_nature, case_status, acts_sections, hearings, source, synced_at, updated_at
       ) VALUES (
         $1,$2,$3,$4,$5,$6,$7,$8,$9,$10::date,$11::date,$12,$13,
         $14::jsonb,$15::jsonb,$16,now(),now()
       )
       ON CONFLICT (cnr) DO UPDATE SET
         court_code = COALESCE(EXCLUDED.court_code, cnr_case_details.court_code),
         case_type = COALESCE(EXCLUDED.case_type, cnr_case_details.case_type),
         case_no = COALESCE(EXCLUDED.case_no, cnr_case_details.case_no),
         petitioner = COALESCE(EXCLUDED.petitioner, cnr_case_details.petitioner),
         respondent = COALESCE(EXCLUDED.respondent, cnr_case_details.respondent),
         pet_advocate = COALESCE(EXCLUDED.pet_advocate, cnr_case_details.pet_advocate),
         res_advocate = COALESCE(EXCLUDED.res_advocate, cnr_case_details.res_advocate),
         judges = COALESCE(EXCLUDED.judges, cnr_case_details.judges),
         filing_date = COALESCE(EXCLUDED.filing_date, cnr_case_details.filing_date),
         decision_date = COALESCE(EXCLUDED.decision_date, cnr_case_details.decision_date),
         disposal_nature = COALESCE(EXCLUDED.disposal_nature, cnr_case_details.disposal_nature),
         case_status = COALESCE(EXCLUDED.case_status, cnr_case_details.case_status),
         acts_sections = EXCLUDED.acts_sections,
         hearings = EXCLUDED.hearings,
         source = EXCLUDED.source,
         updated_at = now()`,
      [
        details.cnr,
        details.court_code,
        details.case_type,
        details.case_no,
        details.petitioner,
        details.respondent,
        details.pet_advocate,
        details.res_advocate,
        details.judges,
        details.filing_date,
        details.decision_date,
        details.disposal_nature,
        details.case_status,
        JSON.stringify(details.acts_sections ?? []),
        JSON.stringify(details.hearings ?? []),
        details.source,
      ],
    );
  } catch (err) {
    logger.warn(
      { err: String(err), cnr: details.cnr },
      "cnr case_details write-through failed",
    );
  }
}

function mergeCaseDetails(
  base: CaseDetailsHit | null,
  fresh: CaseDetailsHit,
): CaseDetailsHit {
  if (!base) return fresh;
  const baseHearings = hearingsToTimeline(base.hearings, base.source);
  const freshHearings = hearingsToTimeline(fresh.hearings, fresh.source);
  return {
    cnr: base.cnr,
    court_code: base.court_code ?? fresh.court_code,
    case_type: base.case_type ?? fresh.case_type,
    case_no: base.case_no ?? fresh.case_no,
    petitioner: base.petitioner ?? fresh.petitioner,
    respondent: base.respondent ?? fresh.respondent,
    pet_advocate: base.pet_advocate ?? fresh.pet_advocate,
    res_advocate: base.res_advocate ?? fresh.res_advocate,
    judges: base.judges ?? fresh.judges,
    filing_date: base.filing_date ?? fresh.filing_date,
    decision_date: base.decision_date ?? fresh.decision_date,
    disposal_nature: base.disposal_nature ?? fresh.disposal_nature,
    case_status: base.case_status ?? fresh.case_status,
    acts_sections: base.acts_sections ?? fresh.acts_sections,
    hearings:
      freshHearings.length >= baseHearings.length ? fresh.hearings : base.hearings,
    source:
      freshHearings.length >= baseHearings.length ? fresh.source : base.source,
  };
}

async function writeThroughFromAthena(
  cnr: string,
  row: Record<string, string | null>,
  archive: "sc" | "hc",
): Promise<void> {
  if (!rdsBackendEnabled()) return;
  try {
    const pool = await getRdsPool();
    const year = Number(row.year) || new Date().getUTCFullYear();
    const title = row.title || `CNR ${cnr}`;
    const dedupe = `cnr-wt|${cnr}|${row.decision_date ?? ""}|${row.s3_path ?? ""}`;
    await pool.query(
      `INSERT INTO judgments (
         court_type, court, year, title, petitioner, respondent, citation, cnr,
         case_type, case_no, decision_date, disposal_nature, pdf_link, source, dedupe_hash
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::date, $12, $13, $14, md5($15)
       )
       ON CONFLICT (dedupe_hash) DO NOTHING`,
      [
        archive,
        row.court ?? (archive === "sc" ? "Supreme Court of India" : "High Court"),
        year,
        title,
        row.petitioner,
        row.respondent,
        row.citation,
        cnr,
        row.case_type,
        row.case_no,
        row.decision_date,
        row.disposal_nature,
        row.s3_path,
        `opendata_${archive}_write_through`,
        dedupe,
      ],
    );
  } catch (err) {
    logger.warn({ err: String(err), cnr }, "cnr write-through failed");
  }
}

function buildFields(
  primary: JudgmentHit | null,
  details: CaseDetailsHit | null,
  source: string,
): Record<string, CnrFieldValue> {
  const src = source;
  const d = details;
  const p = primary;
  const caseStatus =
    d?.case_status ??
    (p?.disposal_nature || p?.decision_date ? "DISPOSED" : null);
  return {
    courtName: field(p?.court ?? null, p ? src : null, p ? 0.97 : 0),
    courtType: field(p?.court_type ?? null, p ? src : null, p ? 0.97 : 0),
    caseType: field(
      d?.case_type ?? p?.case_type ?? null,
      d?.case_type ? "opendata_hc_case_details" : p ? src : null,
      0.9,
    ),
    caseNo: field(
      d?.case_no ?? p?.case_no ?? null,
      d?.case_no ? "opendata_hc_case_details" : p ? src : null,
      0.9,
    ),
    petitioner: field(
      d?.petitioner ?? p?.petitioner ?? null,
      d?.petitioner ? "opendata_hc_case_details" : p ? src : null,
      0.95,
    ),
    respondent: field(
      d?.respondent ?? p?.respondent ?? null,
      d?.respondent ? "opendata_hc_case_details" : p ? src : null,
      0.95,
    ),
    judges: field(
      judgesToArray(d?.judges ?? p?.judges),
      p || d ? src : null,
      0.85,
    ),
    decisionDate: field(
      d?.decision_date ?? p?.decision_date ?? null,
      p || d ? src : null,
      0.95,
    ),
    disposalNature: field(
      d?.disposal_nature ?? p?.disposal_nature ?? null,
      p || d ? src : null,
      0.8,
    ),
    filingDate: field(
      d?.filing_date ?? p?.date_of_registration ?? null,
      d?.filing_date
        ? "opendata_hc_case_details"
        : p?.date_of_registration
          ? src
          : null,
      d?.filing_date || p?.date_of_registration ? 0.8 : 0,
      d?.filing_date || p?.date_of_registration
        ? undefined
        : "often absent in judgment metadata",
    ),
    nextHearingDate: field(null, null, 0, "requires live docket — not in corpus v1"),
    caseTitle: field(
      buildCaseTitleFromHits(p, d),
      p || d ? src : null,
      p || d ? 0.95 : 0,
    ),
    policeStation: field(
      p?.fir_no ? `FIR ${p.fir_no}` : null,
      p?.fir_no ? src : null,
      p?.fir_no ? 0.6 : 0,
      p?.fir_no ? "FIR reference only — full police station name may require PDF extract" : undefined,
    ),
    hearings: field(
      hearingsToTimeline(d?.hearings, d?.source ?? src),
      d?.hearings ? "opendata_hc_case_details" : null,
      hearingsToTimeline(d?.hearings, d?.source ?? src).length ? 0.85 : 0,
    ),
    caseStatus: field(
      caseStatus,
      caseStatus ? src : null,
      caseStatus ? 0.7 : 0,
      caseStatus === "DISPOSED"
        ? "inferred from disposal / decision date when present"
        : undefined,
    ),
    actsSections: field(
      Array.isArray(d?.acts_sections) ? d!.acts_sections : [],
      d ? "opendata_hc_case_details" : null,
      d ? 0.75 : 0,
    ),
    advocates: field(
      [d?.pet_advocate ?? p?.pet_advocate, d?.res_advocate ?? p?.res_advocate].filter(
        Boolean,
      ),
      p || d ? src : null,
      0.7,
    ),
  };
}

function buildCaseTitleFromHits(
  p: JudgmentHit | null,
  d: CaseDetailsHit | null,
): string | null {
  const title = p?.title;
  if (title && !/^CNR\s/i.test(title)) return title;
  const pet = d?.petitioner ?? p?.petitioner;
  const res = d?.respondent ?? p?.respondent;
  if (pet && res) return `${pet} vs ${res}`;
  return pet ?? res ?? title ?? null;
}

async function maybeExtractPreview(
  documents: CnrDocument[],
  caseCreate: CnrCaseCreateProfile,
): Promise<CnrExtractPreview | null> {
  const doc = documents.find((d) => d.s3Path);
  if (!doc?.s3Path) return null;
  const needsPolice = !caseCreate.header.policeStation.value;
  const needsSummary = !caseCreate.summary.value;
  if (!needsPolice && !needsSummary) return null;
  try {
    const extracted = await extractArchiveText({
      s3Path: doc.s3Path,
      title: doc.title,
    });
    const previewText = extracted.text.slice(0, 12_000);
    const police = extractPoliceStationFromText(previewText);
    if (police && needsPolice) {
      caseCreate.header.policeStation = {
        value: police,
        source: "nyv_extract",
        confidence: 0.75,
      };
    }
    if (needsSummary && previewText.length > 200) {
      const snippet = previewText.replace(/\s+/g, " ").trim().slice(0, 480);
      caseCreate.summary = {
        value: `${snippet}…`,
        source: "nyv_extract",
        confidence: 0.55,
        note: "extract preview — not LLM summary; counsel may edit",
      };
    }
    return {
      s3Path: doc.s3Path,
      textLength: extracted.text.length,
      truncated: extracted.truncated,
      ocrUsed: extracted.ocrUsed,
      policeStation: police,
      source: "nyv_extract",
    };
  } catch (err) {
    logger.warn({ err: String(err) }, "cnr extract preview failed");
    return null;
  }
}

function buildCaseCreateFromHits(
  cnr: string,
  primary: JudgmentHit | null,
  allJudgments: JudgmentHit[],
  details: CaseDetailsHit | null,
  resolvedSource: string,
  policeFromExtract?: string | null,
): CnrCaseCreateProfile {
  const detailsSource = details?.source ?? "opendata_hc_case_details";
  const row = {
    title: primary?.title ?? null,
    petitioner: details?.petitioner ?? primary?.petitioner ?? null,
    respondent: details?.respondent ?? primary?.respondent ?? null,
    pet_advocate: details?.pet_advocate ?? primary?.pet_advocate ?? null,
    res_advocate: details?.res_advocate ?? primary?.res_advocate ?? null,
    filing_date: details?.filing_date ?? primary?.date_of_registration ?? null,
    decision_date: details?.decision_date ?? primary?.decision_date ?? null,
    case_status: details?.case_status ?? null,
    disposal_nature: details?.disposal_nature ?? primary?.disposal_nature ?? null,
    fir_no: primary?.fir_no ?? null,
    description: primary?.description ?? null,
    hearings: details?.hearings,
  };
  const policeStation =
    policeFromExtract ??
    (primary?.fir_no ? `FIR ${primary.fir_no}` : null);
  const profile = buildCaseCreateProfile({
    cnr,
    source: resolvedSource,
    detailsSource,
    row,
    orders: allJudgments.map((j) => ({
      decision_date: j.decision_date,
      purpose_name: j.purpose_name,
      judges: j.judges,
      disposal_nature: j.disposal_nature,
    })),
    policeStation,
    policeSource: policeFromExtract ? "nyv_extract" : resolvedSource,
    summaryOverride: row.description,
    summarySource: row.description ? resolvedSource : undefined,
  });
  return profile;
}

function docsFromJudgments(rows: JudgmentHit[]): CnrDocument[] {
  return rows.map((r) => {
    const owned = r.pdf_link?.startsWith("s3://") ? r.pdf_link : hcS3Path(r);
    return {
      id: `jdg_${r.id}`,
      kind: "judgment" as const,
      title: r.title,
      decisionDate: r.decision_date,
      s3Path: owned,
      pdfUrlKind: owned ? ("presigned" as const) : ("none" as const),
      sourceArchive: (r.court_type === "sc" ||
      r.court_type === "hc" ||
      r.court_type === "dc"
        ? r.court_type
        : "unknown") as "sc" | "hc" | "dc" | "unknown",
      judgmentId: r.id,
    };
  });
}

export async function resolveCnr(opts: {
  cnr?: string;
  cnrNumber?: string;
  includeDocuments?: boolean;
  includeExtractPreview?: boolean;
  profile?: "default" | "caseCreate";
  fuzzyLimit?: number;
  /** Tier-4 live eCourts fallback after corpus miss (opt-in). */
  live?: boolean;
}): Promise<CnrResolveResult> {
  const t0 = Date.now();
  const raw = opts.cnr ?? opts.cnrNumber ?? "";
  const cnr = normalizeCnr(raw);
  const { validation, reason } = validateCnr(cnr);
  const sourcesTried: string[] = [];
  const attribution =
    "Judgment metadata © contributors / AWS Open Data (vanga indian-*-court-judgments), CC-BY-4.0. Not live eCourts status.";

  if (validation === "invalid") {
    await recordMetric("invalid", "validation");
    return {
      cnr,
      status: "invalid",
      matchType: "invalid",
      source: null,
      sourcesTried: ["validation"],
      confidence: 0,
      claimEcourts: false,
      validation,
      ui: {
        badge: "Invalid CNR",
        subtitle: reason ?? "Invalid CNR",
      },
      fields: null,
      documents: [],
      candidates: [],
      meta: { attribution, latencyMs: Date.now() - t0 },
    };
  }

  const profile = opts.profile ?? "default";
  const wantCaseCreate = profile === "caseCreate";
  const wantExtract =
    opts.includeExtractPreview === true ||
    (wantCaseCreate && opts.includeExtractPreview !== false);
  const deadline = resolveDeadline(profile);

  let judgments: JudgmentHit[] = [];
  let source: string | null = null;
  let rdsDegraded = false;

  if (rdsBackendEnabled()) {
    sourcesTried.push("nys_rds");
    const rdsHit = await findRdsByCnr(cnr);
    judgments = rdsHit.rows;
    rdsDegraded = rdsHit.degraded;
    if (judgments.length) source = "nys_rds";
  } else {
    sourcesTried.push("nys_appdb");
    judgments = await findAppdbByCnr(cnr);
    if (judgments.length) source = "nys_appdb";
  }

  let details: CaseDetailsHit | null = null;
  if (rdsBackendEnabled() && !budgetExpired(deadline)) {
    sourcesTried.push("cnr_case_details");
    const detailsHit = await findCaseDetails(cnr);
    details = detailsHit.hit;
    rdsDegraded = rdsDegraded || detailsHit.degraded;
  }

  // Tier 2 — Athena cold path: caseCreate always; default only when RDS tier degraded (contention miss).
  const allowAthena =
    wantCaseCreate || (profile === "default" && rdsDegraded && !judgments.length);

  // Tier 2b — Athena HC parquet_case_details cold path
  if (
    allowAthena &&
    !budgetExpired(deadline) &&
    caseDetailsNeedsColdPath(details)
  ) {
    sourcesTried.push("opendata_athena_case_details");
    const athenaDetails = await athenaCaseDetailsByCnr(
      cnr,
      Math.min(CNR_ATHENA_BUDGET_MS, budgetRemaining(deadline)),
    );
    if (athenaDetails) {
      details = mergeCaseDetails(details, athenaDetails);
      void writeThroughCaseDetails(athenaDetails);
    }
  }

  // Tier 2a — Athena judgment parquet
  if (!judgments.length && allowAthena && !budgetExpired(deadline)) {
    sourcesTried.push("opendata_athena");
    const athena = await athenaByCnr(
      cnr,
      Math.min(CNR_ATHENA_BUDGET_MS, budgetRemaining(deadline)),
    );
    if (athena && athena.rows.length) {
      source = athena.archive === "hc" ? "opendata_hc_parquet" : "opendata_sc_parquet";
      const top = athena.rows[0]!;
      await writeThroughFromAthena(cnr, top, athena.archive);
      // Re-read RDS after write-through when available
      if (rdsBackendEnabled()) {
        const reread = await findRdsByCnr(cnr);
        if (reread.rows.length) {
          judgments = reread.rows;
          source = "nys_rds";
          rdsDegraded = false;
        }
      }
      if (!judgments.length) {
        judgments = [
          {
            id: 0,
            court_type: athena.archive,
            court_code: null,
            court: top.court ?? (athena.archive === "sc" ? "Supreme Court of India" : "High Court"),
            bench: null,
            year: Number(top.year) || 0,
            title: top.title ?? `CNR ${cnr}`,
            petitioner: top.petitioner,
            respondent: top.respondent,
            judges: null,
            citation: top.citation,
            cnr,
            case_type: top.case_type,
            case_no: top.case_no,
            decision_date: top.decision_date,
            disposal_nature: top.disposal_nature,
            pet_advocate: null,
            res_advocate: null,
            fir_no: null,
            purpose_name: null,
            description: top.description ?? null,
            date_of_registration: null,
            pdf_link: top.s3_path,
            source: source!,
          },
        ];
      }
    }
  }

  // Tier 2c — case details only hit (dimension row without judgment yet)
  if (allowAthena && !details && !judgments.length && !budgetExpired(deadline)) {
    sourcesTried.push("opendata_athena_case_details_only");
    const athenaDetails = await athenaCaseDetailsByCnr(
      cnr,
      Math.min(CNR_ATHENA_BUDGET_MS, budgetRemaining(deadline)),
    );
    if (athenaDetails) {
      details = athenaDetails;
      void writeThroughCaseDetails(athenaDetails);
    }
  }

  if (judgments.length || details) {
    const primary = judgments[0] ?? null;
    const resolvedSource = source ?? (details ? "opendata_hc_case_details" : "nys_rds");
    const documents =
      opts.includeDocuments === false ? [] : docsFromJudgments(judgments);
    let caseCreate: CnrCaseCreateProfile | undefined;
    let extractPreview: CnrExtractPreview | null = null;
    if (wantCaseCreate) {
      caseCreate = buildCaseCreateFromHits(
        cnr,
        primary,
        judgments,
        details,
        resolvedSource,
      );
      if (wantExtract && documents.length) {
        extractPreview = await maybeExtractPreview(documents, caseCreate);
        caseCreate.fieldManifest = buildFieldManifest(caseCreate);
      }
    }
    await recordMetric("found", resolvedSource);
    return {
      cnr,
      status: "found",
      matchType: "exact",
      source: resolvedSource,
      sourcesTried,
      confidence: primary ? 0.97 : 0.85,
      claimEcourts: false,
      validation,
      ui: {
        badge: "Suggested · Judgment corpus",
        subtitle:
          "From NyayaSearch / Open Data judgment index — not live eCourts status",
      },
      fields: buildFields(primary, details, resolvedSource),
      caseCreate,
      extractPreview,
      documents,
      candidates: [],
      meta: { attribution, latencyMs: Date.now() - t0 },
    };
  }

  // Tier 3 — fuzzy / FTS suggestions (caseCreate or explicit fuzzy only; default returns not_found fast)
  const fuzzyLimit = Math.min(Math.max(opts.fuzzyLimit ?? 5, 1), 10);
  const runFtsTier = wantCaseCreate || (opts.fuzzyLimit != null && opts.fuzzyLimit > 0);
  const candidates: CnrCandidate[] = [];
  if (runFtsTier && !budgetExpired(deadline)) {
    sourcesTried.push("nys_fts");
    try {
    if (rdsBackendEnabled()) {
      const fts = await searchRdsJudgments({ q: cnr, limit: fuzzyLimit });
      for (const doc of fts.results) {
        candidates.push({
          cnr: doc.cnr,
          title: doc.title,
          courtName: doc.court,
          decisionDate: doc.decisionDate,
          confidence: 0.55,
          source: "nys_fts",
        });
      }
    } else {
      const like = `%${cnr.slice(0, 12)}%`;
      const rows = await db
        .select()
        .from(caselawDocumentsTable)
        .where(
          or(
            ilike(caselawDocumentsTable.cnr, like),
            ilike(caselawDocumentsTable.title, like),
            ilike(caselawDocumentsTable.citation, like),
          ),
        )
        .limit(fuzzyLimit);
      for (const r of rows) {
        candidates.push({
          cnr: r.cnr,
          title: r.title,
          courtName: r.court,
          decisionDate: r.decisionDate
            ? String(r.decisionDate).slice(0, 10)
            : null,
          confidence: 0.5,
          source: "nys_fts",
        });
      }
    }
    } catch (err) {
      logger.warn({ err: String(err) }, "cnr fuzzy search failed");
    }
  }

  if (candidates.length) {
    await recordMetric("suggested", "nys_fts");
    return {
      cnr,
      status: "suggested",
      matchType: "fuzzy",
      source: "nys_fts",
      sourcesTried,
      confidence: candidates[0]!.confidence,
      claimEcourts: false,
      validation,
      ui: {
        badge: "Possible matches · Judgment corpus",
        subtitle: "No exact CNR hit — pick a candidate or continue manually",
      },
      fields: null,
      documents: [],
      candidates,
      meta: { attribution, latencyMs: Date.now() - t0 },
    };
  }

  if (rdsDegraded && !judgments.length && !details && !candidates.length) {
    throw new CnrUpstreamBusyError();
  }

  if (opts.live === true) {
    return resolveLiveCnrTier(
      cnr,
      { includeDocuments: opts.includeDocuments, wantCaseCreate },
      sourcesTried,
      t0,
      validation,
      attribution,
    );
  }

  await recordMetric("not_found", "none");
  return {
    cnr,
    status: "not_found",
    matchType: "none",
    source: null,
    sourcesTried,
    confidence: 0,
    claimEcourts: false,
    validation,
    ui: {
      badge: "Not found in judgment corpus",
      subtitle: "Continue manually — corpus does not include live pending dockets",
    },
    fields: null,
    documents: [],
    candidates: [],
    meta: { attribution, latencyMs: Date.now() - t0 },
  };
}

export async function listCnrDocuments(cnrRaw: string): Promise<{
  cnr: string;
  documents: CnrDocument[];
}> {
  const cnr = normalizeCnr(cnrRaw);
  const rdsHit = rdsBackendEnabled()
    ? await findRdsByCnr(cnr)
    : { rows: await findAppdbByCnr(cnr), degraded: false };
  return { cnr, documents: docsFromJudgments(rdsHit.rows) };
}

const JUDGMENT_SELECT = `SELECT id, court_type, court_code, court, bench, year, title, petitioner,
                respondent, judges, citation, cnr, case_type, case_no,
                decision_date::text, disposal_nature, pet_advocate, res_advocate,
                fir_no, purpose_name, description,
                date_of_registration::text, pdf_link, source
         FROM judgments`;

async function findRdsByDiary(
  variants: string[],
  normalizedNumber: string,
  courtType: CourtTier | null,
  diaryYear: number,
): Promise<RdsTierResult<JudgmentHit>> {
  const pool = await getRdsPool();
  const runQuery = async (): Promise<JudgmentHit[]> => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN READ ONLY");
      await client.query(
        `SET LOCAL statement_timeout = ${CNR_RDS_STATEMENT_TIMEOUT_MS}`,
      );
      await client.query(`SET LOCAL lock_timeout = ${CNR_RDS_LOCK_TIMEOUT_MS}`);
      const res = await client.query<JudgmentHit>(
        `${JUDGMENT_SELECT}
         WHERE case_no = ANY($1::text[])
         AND ($2::text IS NULL OR court_type = $2)
         ORDER BY decision_date DESC NULLS LAST, id DESC
         LIMIT 25`,
        [variants, courtType],
      );
      await client.query("COMMIT");
      return res.rows;
    } catch (err) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  };

  try {
    const rows = await runQuery();
    return { rows, degraded: false };
  } catch (err) {
    if (!isRdsContention(err)) throw err;
    logger.warn({ variants }, "Diary RDS lookup hit contention; retrying once");
    try {
      const rows = await runQuery();
      return { rows, degraded: false };
    } catch (retryErr) {
      if (isRdsContention(retryErr)) {
        logger.warn(
          { variants },
          "Diary RDS lookup timed out again; marking tier degraded",
        );
        return { rows: [], degraded: true };
      }
      throw retryErr;
    }
  }
}

async function findCaseDetailsByDiary(
  variants: string[],
): Promise<{ hit: CaseDetailsHit | null; degraded: boolean }> {
  try {
    const pool = await getRdsPool();
    const client = await pool.connect();
    try {
      await client.query("BEGIN READ ONLY");
      await client.query(
        `SET LOCAL statement_timeout = ${CNR_RDS_STATEMENT_TIMEOUT_MS}`,
      );
      await client.query(`SET LOCAL lock_timeout = ${CNR_RDS_LOCK_TIMEOUT_MS}`);
      const res = await client.query<CaseDetailsHit>(
        `SELECT cnr, court_code, case_type, case_no, petitioner, respondent,
                pet_advocate, res_advocate, judges,
                filing_date::text, decision_date::text, disposal_nature,
                case_status, acts_sections, hearings, source
         FROM cnr_case_details
         WHERE case_no = ANY($1::text[])
         LIMIT 1`,
        [variants],
      );
      await client.query("COMMIT");
      return { hit: res.rows[0] ?? null, degraded: false };
    } catch (err) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    if (isRdsContention(err)) {
      logger.warn({ variants }, "Diary case_details lookup timed out");
      return { hit: null, degraded: true };
    }
    return { hit: null, degraded: false };
  }
}

/** Diary corpus resolve — RDS judgments.case_no (+ cnr_case_details dimension). */
export async function resolveDiary(opts: {
  diaryNumber?: string;
  diary?: string;
  courtType?: CourtTier | string | null;
  includeDocuments?: boolean;
  includeExtractPreview?: boolean;
  profile?: "default" | "caseCreate";
  fuzzyLimit?: number;
  live?: boolean;
}): Promise<CnrResolveResult> {
  const t0 = Date.now();
  const raw = opts.diaryNumber ?? opts.diary ?? "";
  const { validation, normalized, reason } = validateDiary(raw);
  const sourcesTried: string[] = [];
  const attribution =
    "Judgment metadata © contributors / AWS Open Data (vanga indian-*-court-judgments), CC-BY-4.0. Not live eCourts status.";
  const diaryCanonical = normalized?.canonical ?? normalizeDiaryRaw(raw);

  if (validation === "invalid" || !normalized) {
    await recordMetric("invalid", "diary_validation");
    return {
      cnr: "",
      diaryNumber: diaryCanonical,
      lookupType: "diary",
      status: "invalid",
      matchType: "invalid",
      source: null,
      sourcesTried: ["diary_validation"],
      confidence: 0,
      claimEcourts: false,
      validation,
      ui: {
        badge: "Invalid diary number",
        subtitle: reason ?? "Invalid diary number",
      },
      fields: null,
      documents: [],
      candidates: [],
      meta: { attribution, latencyMs: Date.now() - t0 },
    };
  }

  const profile = opts.profile ?? "default";
  const wantCaseCreate = profile === "caseCreate";
  const wantExtract =
    opts.includeExtractPreview === true ||
    (wantCaseCreate && opts.includeExtractPreview !== false);
  const deadline = resolveDeadline(profile);
  const courtHint =
    parseCourtTypeHint(
      typeof opts.courtType === "string" ? opts.courtType : null,
    ) ?? inferCourtTypeFromDiary(normalized);

  let judgments: JudgmentHit[] = [];
  let source: string | null = null;
  let rdsDegraded = false;

  if (rdsBackendEnabled()) {
    sourcesTried.push("nys_rds_diary");
    const rdsHit = await findRdsByDiary(
      normalized.variants,
      normalized.number,
      courtHint,
      normalized.year,
    );
    judgments = rdsHit.rows;
    rdsDegraded = rdsHit.degraded;
    if (judgments.length) source = "nys_rds_diary";
  }

  let details: CaseDetailsHit | null = null;
  if (rdsBackendEnabled() && !budgetExpired(deadline)) {
    sourcesTried.push("cnr_case_details_diary");
    const detailsHit = await findCaseDetailsByDiary(normalized.variants);
    details = detailsHit.hit;
    rdsDegraded = rdsDegraded || detailsHit.degraded;
    // Dimension-only hit: synthesize minimal judgment stub for field builder
    if (!judgments.length && details) {
      judgments = [
        {
          id: 0,
          court_type: courtHint ?? "hc",
          court_code: details.court_code,
          court: details.court_code ?? "High Court",
          bench: null,
          year: normalized.year,
          title: buildCaseTitleFromHits(null, details) ?? `Diary ${normalized.canonical}`,
          petitioner: details.petitioner,
          respondent: details.respondent,
          judges: details.judges,
          citation: null,
          cnr: details.cnr,
          case_type: details.case_type,
          case_no: details.case_no,
          decision_date: details.decision_date,
          disposal_nature: details.disposal_nature,
          pet_advocate: details.pet_advocate,
          res_advocate: details.res_advocate,
          fir_no: null,
          purpose_name: null,
          description: null,
          date_of_registration: details.filing_date,
          pdf_link: null,
          source: details.source,
        },
      ];
      source = source ?? "opendata_hc_case_details_diary";
    }
  }

  const resolvedCnr =
    judgments.find((j) => j.cnr)?.cnr ?? details?.cnr ?? "";

  if (judgments.length || details) {
    const primary = judgments[0] ?? null;
    const resolvedSource = source ?? "nys_rds_diary";
    const documents =
      opts.includeDocuments === false ? [] : docsFromJudgments(judgments);
    let caseCreate: CnrCaseCreateProfile | undefined;
    let extractPreview: CnrExtractPreview | null = null;
    if (wantCaseCreate) {
      caseCreate = buildCaseCreateFromHits(
        resolvedCnr || normalized.canonical,
        primary,
        judgments,
        details,
        resolvedSource,
      );
      if (caseCreate.header.cnr.value == null || caseCreate.header.cnr.value === "") {
        caseCreate.header.cnr = {
          value: resolvedCnr || null,
          source: resolvedCnr ? resolvedSource : null,
          confidence: resolvedCnr ? 0.9 : 0,
          note: resolvedCnr ? undefined : "CNR not in corpus — diary match only",
        };
      }
      if (wantExtract && documents.length) {
        extractPreview = await maybeExtractPreview(documents, caseCreate);
        caseCreate.fieldManifest = buildFieldManifest(caseCreate);
      }
    }
    await recordMetric("found", resolvedSource);
    return {
      cnr: resolvedCnr,
      diaryNumber: normalized.canonical,
      lookupType: "diary",
      status: "found",
      matchType: "exact",
      source: resolvedSource,
      sourcesTried,
      confidence: primary ? 0.95 : 0.85,
      claimEcourts: false,
      validation,
      ui: {
        badge: "Suggested · Judgment corpus",
        subtitle:
          "From NyayaSearch diary / case index — not live eCourts status",
      },
      fields: {
        ...buildFields(primary, details, resolvedSource),
        diaryNumber: field(normalized.canonical, resolvedSource, 0.97),
      },
      caseCreate,
      extractPreview,
      documents,
      candidates: [],
      meta: { attribution, latencyMs: Date.now() - t0 },
    };
  }

  const fuzzyLimit = Math.min(Math.max(opts.fuzzyLimit ?? 5, 1), 10);
  const runFtsTier = wantCaseCreate || (opts.fuzzyLimit != null && opts.fuzzyLimit > 0);
  const candidates: CnrCandidate[] = [];
  if (runFtsTier && !budgetExpired(deadline)) {
    sourcesTried.push("nys_fts_diary");
    try {
      if (rdsBackendEnabled()) {
        const fts = await searchRdsJudgments({
          q: normalized.canonical,
          limit: fuzzyLimit,
          courtType: courtHint ?? undefined,
        });
        for (const doc of fts.results) {
          candidates.push({
            cnr: doc.cnr,
            title: doc.title,
            courtName: doc.court,
            decisionDate: doc.decisionDate,
            confidence: 0.55,
            source: "nys_fts_diary",
          });
        }
      }
    } catch (err) {
      logger.warn({ err: String(err) }, "diary fuzzy search failed");
    }
  }

  if (candidates.length) {
    await recordMetric("suggested", "nys_fts_diary");
    return {
      cnr: candidates[0]?.cnr ?? "",
      diaryNumber: normalized.canonical,
      lookupType: "diary",
      status: "suggested",
      matchType: "fuzzy",
      source: "nys_fts_diary",
      sourcesTried,
      confidence: candidates[0]!.confidence,
      claimEcourts: false,
      validation,
      ui: {
        badge: "Possible matches · Judgment corpus",
        subtitle: "No exact diary hit — pick a candidate or continue manually",
      },
      fields: null,
      documents: [],
      candidates,
      meta: { attribution, latencyMs: Date.now() - t0 },
    };
  }

  if (rdsDegraded) {
    throw new CnrUpstreamBusyError(
      "Diary lookup temporarily unavailable — RDS busy; retry shortly",
    );
  }

  if (opts.live === true) {
    const cnrFromCandidate = candidates.find((c) => c.cnr)?.cnr;
    if (cnrFromCandidate) {
      return resolveLiveCnrTier(
        cnrFromCandidate,
        { includeDocuments: opts.includeDocuments, wantCaseCreate: profile === "caseCreate" },
        sourcesTried,
        t0,
        validation,
        attribution,
      );
    }
    await recordMetric("not_found", "ecourts_diary_requires_cnr");
    return {
      cnr: "",
      diaryNumber: normalized.canonical,
      lookupType: "diary",
      status: "not_found",
      matchType: "none",
      source: null,
      sourcesTried: [...sourcesTried, "ecourts_live"],
      confidence: 0,
      claimEcourts: false,
      validation,
      ui: {
        badge: "Live eCourts requires CNR",
        subtitle:
          "Live lookup needs a CNR — search by CNR or pick a suggested match with CNR attached",
      },
      fields: null,
      documents: [],
      candidates: [],
      meta: { attribution, latencyMs: Date.now() - t0 },
    };
  }

  await recordMetric("not_found", "diary_none");
  return {
    cnr: "",
    diaryNumber: normalized.canonical,
    lookupType: "diary",
    status: "not_found",
    matchType: "none",
    source: null,
    sourcesTried,
    confidence: 0,
    claimEcourts: false,
    validation,
    ui: {
      badge: "Not found in judgment corpus",
      subtitle: "Continue manually — corpus does not include live pending dockets",
    },
    fields: null,
    documents: [],
    candidates: [],
    meta: { attribution, latencyMs: Date.now() - t0 },
  };
}

/** Lawyer enrichment write (tenant-private path may call this later). */
export async function upsertCnrCaseDetailsEnrichment(input: {
  cnr: string;
  petitioner?: string;
  respondent?: string;
  caseType?: string;
  caseNo?: string;
  courtCode?: string;
  filingDate?: string;
  decisionDate?: string;
  caseStatus?: string;
  source?: string;
}): Promise<void> {
  if (!rdsBackendEnabled()) return;
  const cnr = normalizeCnr(input.cnr);
  const { validation } = validateCnr(cnr);
  if (validation === "invalid") return;
  const pool = await getRdsPool();
  await pool.query(
    `INSERT INTO cnr_case_details (
       cnr, court_code, case_type, case_no, petitioner, respondent,
       filing_date, decision_date, case_status, source, synced_at, updated_at
     ) VALUES (
       $1, $2, $3, $4, $5, $6, $7::date, $8::date, $9, $10, now(), now()
     )
     ON CONFLICT (cnr) DO UPDATE SET
       court_code = COALESCE(EXCLUDED.court_code, cnr_case_details.court_code),
       case_type = COALESCE(EXCLUDED.case_type, cnr_case_details.case_type),
       case_no = COALESCE(EXCLUDED.case_no, cnr_case_details.case_no),
       petitioner = COALESCE(EXCLUDED.petitioner, cnr_case_details.petitioner),
       respondent = COALESCE(EXCLUDED.respondent, cnr_case_details.respondent),
       filing_date = COALESCE(EXCLUDED.filing_date, cnr_case_details.filing_date),
       decision_date = COALESCE(EXCLUDED.decision_date, cnr_case_details.decision_date),
       case_status = COALESCE(EXCLUDED.case_status, cnr_case_details.case_status),
       source = EXCLUDED.source,
       updated_at = now()`,
    [
      cnr,
      input.courtCode ?? null,
      input.caseType ?? null,
      input.caseNo ?? null,
      input.petitioner ?? null,
      input.respondent ?? null,
      input.filingDate ?? null,
      input.decisionDate ?? null,
      input.caseStatus ?? null,
      input.source ?? "lawyer_enrichment",
    ],
  );
}
