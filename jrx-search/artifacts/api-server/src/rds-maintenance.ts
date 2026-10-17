import { getRdsPool } from "./lib/rdsPool";
import { logger } from "./lib/logger";

async function main() {
  const pool = await getRdsPool();

  logger.info("Running ANALYZE on judgments...");
  const t0 = Date.now();
  await pool.query("ANALYZE judgments");
  logger.info({ ms: Date.now() - t0 }, "ANALYZE complete");

  const counts = await pool.query(
    "SELECT source, count(*)::bigint AS n FROM judgments GROUP BY source ORDER BY n DESC",
  );
  for (const r of counts.rows) logger.info({ source: r.source, count: String(r.n) }, "corpus count");

  const sizes = await pool.query(`
    SELECT relname, pg_size_pretty(pg_total_relation_size(c.oid)) AS total
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND relkind IN ('r','i')
    ORDER BY pg_total_relation_size(c.oid) DESC LIMIT 12`);
  for (const r of sizes.rows) logger.info({ rel: r.relname, size: r.total }, "relation size");

  const queries: Array<[string, string, unknown[]]> = [
    [
      "fts-common",
      "SELECT count(*) FROM (SELECT 1 FROM judgments WHERE search_tsv @@ websearch_to_tsquery('english', $1) LIMIT 200) s",
      ["anticipatory bail"],
    ],
    [
      "fts-ranked",
      "SELECT id FROM judgments WHERE search_tsv @@ websearch_to_tsquery('english', $1) ORDER BY ts_rank(search_tsv, websearch_to_tsquery('english', $1)) DESC LIMIT 20",
      ["fundamental rights article 21"],
    ],
    [
      "fts-filtered",
      "SELECT id FROM judgments WHERE search_tsv @@ websearch_to_tsquery('english', $1) AND court_type = 'hc' AND year = 2015 LIMIT 20",
      ["bail"],
    ],
  ];
  for (const [name, sql, params] of queries) {
    const t = Date.now();
    const res = await pool.query(sql, params);
    logger.info({ query: name, ms: Date.now() - t, rows: res.rowCount }, "query timing");
  }

  const idx = await pool.query(`
    SELECT indexrelname, idx_scan FROM pg_stat_user_indexes WHERE relname = 'judgments' ORDER BY idx_scan DESC`);
  for (const r of idx.rows) logger.info({ index: r.indexrelname, scans: String(r.idx_scan) }, "index usage");

  await pool.end();
}

main().catch((err) => {
  logger.error({ err: String(err) }, "maintenance failed");
  process.exit(1);
});
