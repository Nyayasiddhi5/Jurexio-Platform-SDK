#!/usr/bin/env node
/**
 * NV-TREATMENT-GRAPH-001 Phase 4 — derive CITES edges from cached archive_extracts.
 * Newest SC judgments first; skips rows with no cached text (extract job fills cache).
 *
 * Writes JSONL batches to S3 for NYV ingest (worker has no NYV DATABASE_URL).
 * Run on worker (background):
 *   nohup node /opt/nyv/api/nys-treatment-graph-edges.mjs >> /opt/nyv/logs/treatment-graph-edges.log 2>&1 &
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, appendFileSync } from "node:fs";
import { dirname } from "node:path";
import { createHash } from "node:crypto";
import pg from "pg";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from "@aws-sdk/client-secrets-manager";
import {
  RDSClient,
  DescribeDBInstancesCommand,
} from "@aws-sdk/client-rds";
import {
  REVERSE_CURSOR_INIT,
  REVERSE_ORDER_SQL,
  REVERSE_WHERE_AFTER_CURSOR,
  advanceReverseCursor,
} from "./_reverse-cursor.mjs";

const REGION = "ap-south-1";
const DB_INSTANCE_ID = "nyv-caselaw-pg";
const S3_BUCKET = process.env.NYV_DEPLOY_BUCKET ?? "nyayavigya-sdk-devapp";
const S3_PREFIX = "caselaw-worker/graph-edges";
const CHECKPOINT =
  process.env.TREATMENT_GRAPH_EDGES_CHECKPOINT ??
  "/opt/nyv/api/.treatment-graph-edges-checkpoint.json";
const JSONL_LOCAL =
  process.env.TREATMENT_GRAPH_EDGES_JSONL ??
  "/opt/nyv/api/graph-edges-pending.jsonl";
const BATCH = Number(process.env.TREATMENT_GRAPH_EDGES_BATCH ?? "30");

const CITATION_RE =
  /(?:\(\d{4}\)\s*\d+\s*SCC\s*(?:OnLine\s*(?:SC\s*)?)?\d+|\[\d{4}\]\s*(?:\(?\d+\)?\s*)?(?:SUPP\.?|Suppl\.?)?\s*\d*\s*S\.?\s?C\.?\s?R\.?\s*\d+|\bAIR\s*\d{4}\s*[A-Z]{2,4}\s*\d+\b|\b\d{4}\s*SCC\s*OnLine\s*(?:SC\s*)?\d+\b)/gi;

function loadEnv() {
  const p = process.env.NYS_ENV_FILE || "/opt/nyv/api/.env";
  if (!existsSync(p)) return;
  for (const ln of readFileSync(p, "utf8").split(/\n/)) {
    if (!ln.trim() || ln.startsWith("#") || !ln.includes("=")) continue;
    const i = ln.indexOf("=");
    const k = ln.slice(0, i).trim();
    let v = ln.slice(i + 1).trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    if (!(k in process.env)) process.env[k] = v;
  }
}

function sslConfig() {
  const caPath = process.env.RDS_CA_BUNDLE;
  if (caPath && existsSync(caPath)) {
    return { rejectUnauthorized: true, ca: readFileSync(caPath, "utf8") };
  }
  return { rejectUnauthorized: false };
}

async function buildCaselawPool() {
  const rds = new RDSClient({ region: REGION });
  const desc = await rds.send(
    new DescribeDBInstancesCommand({ DBInstanceIdentifier: DB_INSTANCE_ID }),
  );
  const inst = desc.DBInstances?.[0];
  if (!inst?.Endpoint?.Address) throw new Error(`RDS ${DB_INSTANCE_ID} not available`);
  const secretArn = inst.MasterUserSecret?.SecretArn;
  if (!secretArn) throw new Error("no MasterUserSecret");
  const sm = new SecretsManagerClient({ region: REGION });
  const secret = await sm.send(new GetSecretValueCommand({ SecretId: secretArn }));
  const creds = JSON.parse(secret.SecretString);
  return new pg.Pool({
    host: inst.Endpoint.Address,
    port: inst.Endpoint.Port ?? 5432,
    database: inst.DBName ?? "nyv_caselaw",
    user: creds.username,
    password: creds.password,
    ssl: sslConfig(),
    max: 3,
    connectionTimeoutMillis: 15_000,
  });
}

function buildAppPool() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL required for archive_extracts");
  return new pg.Pool({ connectionString: url, max: 3 });
}

function normCitation(c) {
  return c.replace(/\s+/g, " ").trim().toLowerCase();
}

function entityId(kind, key) {
  return createHash("sha256").update(`${kind}:${key}`).digest("hex").slice(0, 32);
}

function extractCitations(text) {
  const out = new Set();
  const g = new RegExp(CITATION_RE.source, CITATION_RE.flags);
  for (let m = g.exec(text); m; m = g.exec(text)) {
    out.add(m[0].replace(/\s+/g, " ").trim());
  }
  return [...out];
}

function readCheckpoint() {
  if (!existsSync(CHECKPOINT)) {
    return { ...REVERSE_CURSOR_INIT, edgesWritten: 0, startedAt: new Date().toISOString() };
  }
  return JSON.parse(readFileSync(CHECKPOINT, "utf8"));
}

function writeCheckpoint(state) {
  mkdirSync(dirname(CHECKPOINT), { recursive: true });
  writeFileSync(CHECKPOINT, JSON.stringify(state, null, 2));
}

async function flushJsonlToS3(s3, lines) {
  if (lines.length === 0) return;
  const body = lines.join("\n") + "\n";
  appendFileSync(JSONL_LOCAL, body);
  try {
    const key = `${S3_PREFIX}/batch-${Date.now()}.jsonl`;
    await s3.send(
      new PutObjectCommand({ Bucket: S3_BUCKET, Key: key, Body: body, ContentType: "application/x-ndjson" }),
    );
    console.log("GRAPH_EDGES_S3_FLUSH", { key, lines: lines.length });
  } catch (err) {
    console.error("GRAPH_EDGES_S3_SKIP", String(err), "local-only", JSONL_LOCAL);
  }
}

async function main() {
  loadEnv();
  const caselaw = await buildCaselawPool();
  const app = buildAppPool();
  const s3 = new S3Client({
    region: REGION,
    ...(process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY
      ? {
          credentials: {
            accessKeyId: process.env.AWS_ACCESS_KEY_ID,
            secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
          },
        }
      : {}),
  });
  const state = readCheckpoint();
  const pendingLines = [];

  console.log("TREATMENT_GRAPH_EDGES_START", { order: "newest-first", checkpoint: state });

  for (;;) {
    const batch = await caselaw.query(
      `SELECT id, title, citation, year, pdf_link, decision_date FROM judgments
       WHERE court_type = 'sc'
         AND pdf_link LIKE 's3://%'
         AND ${REVERSE_WHERE_AFTER_CURSOR}
       ORDER BY ${REVERSE_ORDER_SQL}
       LIMIT $3`,
      [state.cursorDate, state.cursorId, BATCH],
    );
    if (batch.rowCount === 0) {
      await flushJsonlToS3(s3, pendingLines.splice(0));
      console.log("TREATMENT_GRAPH_EDGES_COMPLETE", state);
      break;
    }

    for (const row of batch.rows) {
      const cached = await app.query(
        `SELECT text_content FROM archive_extracts
         WHERE s3_path = $1 OR requested_path = $1
         ORDER BY created_at DESC LIMIT 1`,
        [row.pdf_link],
      );
      const text = cached.rows[0]?.text_content;
      if (!text) {
        advanceReverseCursor(state, row);
        continue;
      }

      const sourceEntity = {
        op: "entity",
        id: entityId("judgment", String(row.id)),
        type: "case",
        value: row.title,
        normalizedValue: row.title.toLowerCase(),
        jurisdiction: "IN",
        year: row.year,
        metadata: { judgmentId: row.id, citation: row.citation, court: "Supreme Court of India" },
      };
      pendingLines.push(JSON.stringify(sourceEntity));

      for (const cite of extractCitations(text)) {
        const targetId = entityId("citation", normCitation(cite));
        pendingLines.push(
          JSON.stringify({
            op: "entity",
            id: targetId,
            type: "case",
            value: cite,
            normalizedValue: normCitation(cite),
            jurisdiction: "IN",
          }),
        );
        pendingLines.push(
          JSON.stringify({
            op: "edge",
            id: entityId("edge", `${row.id}:${cite}`),
            sourceId: sourceEntity.id,
            targetId,
            edgeType: "CITES",
            confidence: 0.85,
            docId: String(row.id),
          }),
        );
        state.edgesWritten += 1;
      }

      state.done += 1;
      advanceReverseCursor(state, row);
    }

    if (pendingLines.length >= 200) {
      await flushJsonlToS3(s3, pendingLines.splice(0, pendingLines.length));
    }
    writeCheckpoint(state);
    console.log("TREATMENT_GRAPH_EDGES_PROGRESS", state);
  }

  await caselaw.end();
  await app.end();
}

main().catch((e) => {
  console.error("TREATMENT_GRAPH_EDGES_FAIL", e);
  process.exit(1);
});
