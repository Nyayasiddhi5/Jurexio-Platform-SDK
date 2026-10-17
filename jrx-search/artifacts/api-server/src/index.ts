import app from "./app";
import { logger } from "./lib/logger";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");

  void warnIfStatutesEmpty();
  void warnIfCaselawEmpty();
  void warmupRdsCaselawPool();
});

async function warmupRdsCaselawPool() {
  if (process.env.CASELAW_BACKEND !== "rds") return;
  try {
    const { getRdsPool } = await import("./lib/rdsPool");
    const pool = await getRdsPool();
    await pool.query("SELECT 1");
    logger.info("RDS caselaw pool warmed on boot");
  } catch (err) {
    logger.warn({ err: String(err) }, "RDS caselaw pool warmup failed (non-fatal)");
  }
}

async function warnIfStatutesEmpty() {
  try {
    const { pool } = await import("@workspace/db");
    const res = await pool.query("SELECT count(*)::int AS n FROM statutes");
    const n = (res.rows[0] as { n: number }).n;
    if (n === 0) {
      logger.error(
        "STATUTES CORPUS IS EMPTY — comparator and statute endpoints will 404. " +
          "Run: pnpm --filter @workspace/api-server run seed:statutes " +
          "(or seed:ensure to seed all empty corpora)",
      );
    }
  } catch {
    logger.error(
      "STATUTES TABLE MISSING — comparator and statute endpoints will 404. " +
        "Run: pnpm --filter @workspace/api-server run seed:statutes " +
        "(or seed:ensure to seed all empty corpora)",
    );
  }
}

async function warnIfCaselawEmpty() {
  if (process.env["CASELAW_BACKEND"] === "rds") return;
  try {
    const { pool } = await import("@workspace/db");
    const res = await pool.query("SELECT 1 FROM caselaw_documents LIMIT 1");
    if (res.rowCount === 0) {
      logger.error(
        "CASELAW CORPUS IS EMPTY — Indian caselaw search will return 0 results. " +
          "Run: pnpm --filter @workspace/api-server run seed:caselaw " +
          "(downloads SC judgment metadata from AWS Open Data; takes a few minutes)",
      );
    }
  } catch {
    logger.error(
      "CASELAW TABLE MISSING — Indian caselaw search will return 0 results. " +
        "Run: pnpm --filter @workspace/api-server run seed:caselaw " +
        "(downloads SC judgment metadata from AWS Open Data; takes a few minutes)",
    );
  }
}
