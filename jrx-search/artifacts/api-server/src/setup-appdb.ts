/**
 * One-shot provisioning of the application database (legal_tasks + runs)
 * on the RDS instance. Run ON THE WORKER with:
 *   NODE_ENV=production APP_DB_PASSWORD=<pw> node setup-appdb.js
 *
 * Creates role `nyvapp`, database `nyvapp`, tables, and seeds the
 * benchmark task catalog (bundled seed-tasks.json). Idempotent.
 */
import { readFileSync } from "node:fs";
import { Client } from "pg";
import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from "@aws-sdk/client-secrets-manager";
import { RDSClient, DescribeDBInstancesCommand } from "@aws-sdk/client-rds";
import { categoryName } from "./lib/categories";
import seedTasks from "../data/seed-tasks.json";

type SeedTask = {
  category: string;
  slug: string;
  title: string;
  work_type: string;
  tags: string[];
  instructions: string;
  deliverables: Record<string, unknown> | string[];
  documents: string[];
  criteria: { id: string; title: string; match_criteria: string }[];
};

const REGION = "ap-south-1";
const DB_INSTANCE_ID = "nyv-caselaw-pg";
const APP_DB = "nyvapp";
const APP_ROLE = "nyvapp";

function log(msg: string, extra?: unknown) {
  process.stdout.write(
    `${msg}${extra !== undefined ? " " + JSON.stringify(extra) : ""}\n`,
  );
}

function ssl() {
  const caPath = process.env.RDS_CA_BUNDLE;
  if (!caPath) throw new Error("RDS_CA_BUNDLE required");
  return { rejectUnauthorized: true, ca: readFileSync(caPath, "utf8") };
}

async function masterConn(): Promise<{ host: string; port: number; user: string; password: string }> {
  const rds = new RDSClient({ region: REGION });
  const desc = await rds.send(
    new DescribeDBInstancesCommand({ DBInstanceIdentifier: DB_INSTANCE_ID }),
  );
  const inst = desc.DBInstances?.[0];
  if (!inst?.Endpoint?.Address) throw new Error("RDS endpoint not found");
  const secretArn = inst.MasterUserSecret?.SecretArn;
  if (!secretArn) throw new Error("no managed master secret");
  const sm = new SecretsManagerClient({ region: REGION });
  const secret = await sm.send(new GetSecretValueCommand({ SecretId: secretArn }));
  const creds = JSON.parse(secret.SecretString ?? "{}") as { username: string; password: string };
  return {
    host: inst.Endpoint.Address,
    port: inst.Endpoint.Port ?? 5432,
    user: creds.username,
    password: creds.password,
  };
}

// NOTE: this DDL mirrors lib/db/src/schema/{legalTasks,runs}.ts by hand.
// If the Drizzle schema changes, update this DDL in lockstep (no migrations
// infra exists for the external RDS app DB yet).
const DDL = `
CREATE TABLE IF NOT EXISTS legal_tasks (
  id serial PRIMARY KEY,
  category text NOT NULL,
  category_name text NOT NULL,
  slug text NOT NULL,
  title text NOT NULL,
  work_type text NOT NULL,
  tags jsonb NOT NULL DEFAULT '[]',
  instructions text NOT NULL,
  deliverables jsonb NOT NULL DEFAULT '[]',
  documents jsonb NOT NULL DEFAULT '[]',
  criteria jsonb NOT NULL DEFAULT '[]',
  jurisdiction text NOT NULL DEFAULT 'GLOBAL'
);
ALTER TABLE legal_tasks ADD COLUMN IF NOT EXISTS jurisdiction text NOT NULL DEFAULT 'GLOBAL';
CREATE TABLE IF NOT EXISTS runs (
  id serial PRIMARY KEY,
  task_id integer,
  title text NOT NULL,
  category text NOT NULL,
  category_name text NOT NULL,
  work_type text NOT NULL,
  instruction text NOT NULL,
  context text,
  status text NOT NULL DEFAULT 'completed',
  output text,
  score real,
  criteria jsonb NOT NULL DEFAULT '[]',
  evaluation jsonb,
  authorities jsonb NOT NULL DEFAULT '[]',
  jurisdiction text,
  created_at timestamp NOT NULL DEFAULT now()
);
ALTER TABLE runs ADD COLUMN IF NOT EXISTS jurisdiction text;
CREATE TABLE IF NOT EXISTS chat_conversations (
  id serial PRIMARY KEY,
  title text NOT NULL,
  output_format text NOT NULL DEFAULT 'detailed',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS chat_messages (
  id serial PRIMARY KEY,
  conversation_id integer NOT NULL,
  role text NOT NULL,
  action text NOT NULL DEFAULT 'chat',
  content text NOT NULL,
  structured jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS chat_documents (
  id serial PRIMARY KEY,
  conversation_id integer NOT NULL,
  filename text NOT NULL,
  mime_type text NOT NULL,
  byte_size integer NOT NULL,
  text_content text NOT NULL,
  original bytea,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS chat_messages_conversation_id_idx ON chat_messages (conversation_id);
CREATE INDEX IF NOT EXISTS chat_documents_conversation_id_idx ON chat_documents (conversation_id);
ALTER TABLE chat_documents ADD COLUMN IF NOT EXISTS source_ref text;
CREATE TABLE IF NOT EXISTS archive_extracts (
  id serial PRIMARY KEY,
  s3_path text NOT NULL,
  requested_path text NOT NULL,
  title text,
  byte_size integer NOT NULL,
  text_content text NOT NULL,
  ocr_used boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS archive_extracts_requested_path_idx ON archive_extracts (requested_path);
CREATE TABLE IF NOT EXISTS templates (
  id serial PRIMARY KEY,
  kind text NOT NULL,
  slug text NOT NULL UNIQUE,
  title text NOT NULL,
  category text NOT NULL,
  jurisdiction text NOT NULL DEFAULT 'IN',
  description text NOT NULL,
  body text NOT NULL,
  tags jsonb NOT NULL DEFAULT '[]',
  created_at timestamp NOT NULL DEFAULT now()
);
ALTER TABLE templates ADD COLUMN IF NOT EXISTS is_custom boolean NOT NULL DEFAULT false;
ALTER TABLE templates ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'seeded';
ALTER TABLE templates ADD COLUMN IF NOT EXISTS source_filename text;
ALTER TABLE templates ADD COLUMN IF NOT EXISTS updated_at timestamp NOT NULL DEFAULT now();
CREATE TABLE IF NOT EXISTS api_usage (
  id serial PRIMARY KEY,
  method text NOT NULL,
  path text NOT NULL,
  feature text NOT NULL,
  jurisdiction text,
  model text,
  status_code integer NOT NULL,
  latency_ms integer NOT NULL,
  created_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS api_usage_created_at_idx ON api_usage (created_at);
CREATE INDEX IF NOT EXISTS api_usage_feature_idx ON api_usage (feature);
`;

async function main() {
  const appPassword = process.env.APP_DB_PASSWORD;
  if (!appPassword) throw new Error("APP_DB_PASSWORD required");
  const m = await masterConn();

  const admin = new Client({
    host: m.host,
    port: m.port,
    user: m.user,
    password: m.password,
    database: "postgres",
    ssl: ssl(),
  });
  await admin.connect();
  const roleExists = await admin.query("SELECT 1 FROM pg_roles WHERE rolname = $1", [APP_ROLE]);
  if (roleExists.rowCount === 0) {
    await admin.query(`CREATE ROLE ${APP_ROLE} WITH LOGIN PASSWORD '${appPassword.replace(/'/g, "''")}'`);
    log("role created");
  } else {
    await admin.query(`ALTER ROLE ${APP_ROLE} WITH LOGIN PASSWORD '${appPassword.replace(/'/g, "''")}'`);
    log("role password updated");
  }
  const dbExists = await admin.query("SELECT 1 FROM pg_database WHERE datname = $1", [APP_DB]);
  if (dbExists.rowCount === 0) {
    await admin.query(`CREATE DATABASE ${APP_DB} OWNER ${APP_ROLE}`);
    log("database created");
  }
  await admin.end();

  const app = new Client({
    host: m.host,
    port: m.port,
    user: APP_ROLE,
    password: appPassword,
    database: APP_DB,
    ssl: ssl(),
  });
  await app.connect();
  await app.query(DDL);
  log("tables ensured");

  const count = await app.query("SELECT count(*)::int AS n FROM legal_tasks");
  if (count.rows[0].n === 0) {
    const tasks = seedTasks as unknown as SeedTask[];
    for (const t of tasks) {
      const deliverables = Array.isArray(t.deliverables)
        ? t.deliverables
        : Object.keys(t.deliverables ?? {});
      const criteria = (t.criteria ?? []).map((c) => ({
        id: c.id,
        title: c.title,
        matchCriteria: c.match_criteria,
      }));
      await app.query(
        `INSERT INTO legal_tasks (category, category_name, slug, title, work_type, tags, instructions, deliverables, documents, criteria)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [
          t.category, categoryName(t.category), t.slug, t.title, t.work_type,
          JSON.stringify(t.tags ?? []), t.instructions,
          JSON.stringify(deliverables), JSON.stringify(t.documents ?? []),
          JSON.stringify(criteria),
        ],
      );
    }
    log("seeded tasks", { count: tasks.length });
  } else {
    log("tasks already seeded", { count: count.rows[0].n });
  }
  const final = await app.query("SELECT count(*)::int AS n FROM legal_tasks");
  log("done", { legalTasks: final.rows[0].n, host: m.host });
  await app.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
