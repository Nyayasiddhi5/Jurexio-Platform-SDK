import { readFileSync } from "node:fs";
import { Pool } from "pg";
import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from "@aws-sdk/client-secrets-manager";
import {
  RDSClient,
  DescribeDBInstancesCommand,
} from "@aws-sdk/client-rds";
import { logger } from "./logger";

const REGION = "ap-south-1";
const DB_INSTANCE_ID = "nyv-caselaw-pg";

let poolPromise: Promise<Pool> | null = null;

function buildSslConfig(): { rejectUnauthorized: boolean; ca?: string } {
  const caPath = process.env.RDS_CA_BUNDLE;
  if (caPath) {
    return { rejectUnauthorized: true, ca: readFileSync(caPath, "utf8") };
  }
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "RDS_CA_BUNDLE is required in production for verified TLS to RDS",
    );
  }
  logger.warn(
    "RDS_CA_BUNDLE not set; connecting to RDS without certificate verification (non-production only)",
  );
  return { rejectUnauthorized: false };
}

async function buildPool(): Promise<Pool> {
  const rds = new RDSClient({ region: REGION });
  const desc = await rds.send(
    new DescribeDBInstancesCommand({ DBInstanceIdentifier: DB_INSTANCE_ID }),
  );
  const inst = desc.DBInstances?.[0];
  const CONNECTABLE = new Set(["available", "backing-up", "storage-optimization", "modifying"]);
  if (!inst || !CONNECTABLE.has(inst.DBInstanceStatus ?? "") || !inst.Endpoint?.Address) {
    throw new Error(
      `RDS instance ${DB_INSTANCE_ID} not available (status: ${inst?.DBInstanceStatus ?? "missing"})`,
    );
  }
  const secretArn = inst.MasterUserSecret?.SecretArn;
  if (!secretArn) {
    throw new Error(`RDS instance ${DB_INSTANCE_ID} has no managed master secret`);
  }
  const sm = new SecretsManagerClient({ region: REGION });
  const secret = await sm.send(
    new GetSecretValueCommand({ SecretId: secretArn }),
  );
  if (!secret.SecretString) {
    throw new Error("RDS master secret has no string value");
  }
  const creds = JSON.parse(secret.SecretString) as {
    username: string;
    password: string;
  };
  const pool = new Pool({
    host: inst.Endpoint.Address,
    port: inst.Endpoint.Port ?? 5432,
    database: inst.DBName ?? "nyv_caselaw",
    user: creds.username,
    password: creds.password,
    ssl: buildSslConfig(),
    // Embed shards hold up to ~9 connections; reserve headroom for CNR/search API reads.
    max: 25,
    connectionTimeoutMillis: 5_000,
    /*
     * NYS-EMBED-KEEPALIVE-001 (2026-08-18) — detect a dead peer.
     *
     * HC embed shard 2 hung for ~40 HOURS holding a connection whose server-side backend
     * `pg_stat_activity` reported as `idle`: the query had COMPLETED and the reply was lost
     * on a half-open socket. `statement_timeout` cannot bound that, because it only limits a
     * *running* query — an idle backend is, to Postgres, perfectly healthy. The host's
     * `net.ipv4.tcp_keepalive_time` is 7200 (2 hours), and node-postgres does not enable
     * socket keepalive by default, so nothing on either side noticed for two days.
     *
     * `keepAlive` turns on TCP keepalive probes and `keepAliveInitialDelayMillis` starts them
     * after 10s of idleness instead of 2 hours, so a dead peer surfaces as a socket error
     * (which the loop's `Restart=always` already handles) rather than an infinite wait.
     */
    keepAlive: true,
    keepAliveInitialDelayMillis: 10_000,
    // Batch jobs (ingest, embed, audit) need much longer statements than the
    // API's 25s ceiling — they override via RDS_STATEMENT_TIMEOUT_MS.
    statement_timeout: process.env.RDS_STATEMENT_TIMEOUT_MS
      ? parseInt(process.env.RDS_STATEMENT_TIMEOUT_MS, 10)
      : 25_000,
  });
  await pool.query("SELECT 1");
  logger.info(
    { host: inst.Endpoint.Address, db: inst.DBName },
    "Connected to caselaw RDS",
  );
  return pool;
}

export function getRdsPool(): Promise<Pool> {
  if (!poolPromise) {
    poolPromise = buildPool().catch((err) => {
      poolPromise = null;
      throw err;
    });
  }
  return poolPromise;
}
