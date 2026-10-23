#!/usr/bin/env node
/**
 * NV-HC-MIRROR-P1-001 — mirror HC order PDFs into owned S3 + nv_hc_order_s3_map (gateway DB).
 * Never uploads non-PDF bodies (portal HTML / error pages). NV-SECRETS-001: no secret echo.
 *
 * Env:
 *   NYSAPI_URL          default http://127.0.0.1:8090
 *   NYSAPI_API_KEY      case-api key (length logged only)
 *   NV_HC_MIRROR_BUCKET default ns-indian-highcourt-judgements-2
 *   GATEWAY_DATABASE_URL  postgres URL for jurexio.nv_hc_order_s3_map (apply mode)
 *   NV_HC_ORDER_AUTH_BASE  optional case_api / Tier-3 base (tried before anonymous portal)
 *   NV_HC_ORDER_AUTH_API_KEY  key for auth tier (length logged only)
 *
 * Args: --cnr CNR [--cnr CNR2 ...] | --batch-final-orders N
 *       --apply (upload + insert) | default dry-run
 */
import { createHash } from 'node:crypto';

const DEFAULT_BUCKET = process.env.NV_HC_MIRROR_BUCKET || 'ns-indian-highcourt-judgements-2';
const BUCKET_REGION = {
  'ns-indian-highcourt-judgements-2': 'ap-south-1',
  'ns-highcourt-data-bucket': 'us-east-1',
};

function normalizeEcourtsOrderPath(raw) {
  return String(raw || '')
    .trim()
    .replace(/^\/+/, '');
}

function deriveHcOrderS3Key(cnr, orderPath) {
  const norm = normalizeEcourtsOrderPath(orderPath);
  const base = norm.split('/').filter(Boolean).pop() ?? 'order.pdf';
  return `data/orders/cnr=${cnr.trim().toUpperCase()}/${base}`;
}

function parseArgs(argv) {
  const cnrs = [];
  let batchFinal = 0;
  let apply = false;
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--apply') apply = true;
    else if (a === '--cnr') cnrs.push(String(argv[++i] || '').toUpperCase());
    else if (a === '--batch-final-orders') batchFinal = Number(argv[++i] || 0);
  }
  return { cnrs, batchFinal, apply };
}

function portalFetchUrls(relPath) {
  const rel = normalizeEcourtsOrderPath(relPath);
  return [
    `https://hcservices.ecourts.gov.in/hcservices/cases/display_pdf.php?filename=${encodeURIComponent(rel)}`,
    `https://hcservices.ecourts.gov.in/hcservices/main.php?filename=${encodeURIComponent(rel)}`,
    `https://hcservices.ecourts.gov.in/hcservices/${rel}`,
  ];
}

async function fetchPdfBytes(url, extraHeaders = {}) {
  const res = await fetch(url, {
    redirect: 'follow',
    signal: AbortSignal.timeout(45_000),
    headers: { 'User-Agent': 'jrx-hc-order-mirror-p1/1.0', ...extraHeaders },
  });
  const buf = Buffer.from(await res.arrayBuffer());
  const isPdf = buf.length > 4 && buf.subarray(0, 4).toString('ascii') === '%PDF';
  return { http: res.status, bytes: buf.length, isPdf, buf, contentType: res.headers.get('content-type') };
}

/** Tier-3 / case_api authenticated fetch (Session-82 hook). No-op when env unset. */
async function fetchPdfViaAuthTier(cnr, orderPath) {
  const base = (process.env.NV_HC_ORDER_AUTH_BASE || '').trim().replace(/\/$/, '');
  if (!base) return null;
  const authKey = (process.env.NV_HC_ORDER_AUTH_API_KEY || process.env.CASE_API_INTERNAL_KEY || '').trim();
  const rel = normalizeEcourtsOrderPath(orderPath);
  const url = `${base}/v1/hc/orders/pdf?cnr=${encodeURIComponent(cnr)}&filename=${encodeURIComponent(rel)}`;
  const headers = { Accept: 'application/pdf' };
  if (authKey) headers['X-API-Key'] = authKey;
  try {
    const attempt = await fetchPdfBytes(url, headers);
    if (attempt.isPdf && attempt.bytes > 500) return { ...attempt, url, tier: 'auth' };
  } catch {
    /* fall through to portal */
  }
  return null;
}

async function loadCase(cnr, baseUrl, apiKey) {
  const url = `${baseUrl.replace(/\/$/, '')}/v1/cases/${encodeURIComponent(cnr)}`;
  const res = await fetch(url, {
    headers: { 'X-API-Key': apiKey },
    signal: AbortSignal.timeout(90_000),
  });
  if (!res.ok) throw new Error(`nysapi_http_${res.status}`);
  const body = await res.json();
  return body.case || body.data?.case || body;
}

function ordersFromCase(caseRow) {
  const out = [];
  for (const [kind, key] of [
    ['final', 'final_orders'],
    ['interim', 'interim_orders'],
  ]) {
    const arr = caseRow[key];
    if (!Array.isArray(arr)) continue;
    for (const rec of arr) {
      if (!rec || typeof rec !== 'object') continue;
      const filename = rec.filename || rec.file_name;
      if (!filename) continue;
      out.push({
        kind,
        orderPath: normalizeEcourtsOrderPath(filename),
        orderId: rec.order_id ?? null,
        orderDate: rec.order_date ?? null,
      });
    }
  }
  return out;
}

async function batchCnrsFromRds(limit) {
  const url = process.env.JRX_ECOSYSTEM_CASEAPI_DATABASE_URL || process.env.CASE_API_DATABASE_URL;
  if (!url) throw new Error('batch_requires_JRX_ECOSYSTEM_CASEAPI_DATABASE_URL');
  const pg = (await import('pg')).default;
  const pool = new pg.Pool({ connectionString: url, max: 2, statement_timeout: 120_000 });
  try {
    const r = await pool.query(
      `SELECT cnr FROM cases_search_staging
       WHERE extra IS NOT NULL AND extra::text LIKE '%final%order%'
       ORDER BY updated_at DESC NULLS LAST
       LIMIT $1`,
      [limit],
    );
    return r.rows.map((row) => String(row.cnr).toUpperCase());
  } finally {
    await pool.end();
  }
}

async function upsertMapRow(client, row) {
  await client.query(
    `INSERT INTO public.nv_hc_order_s3_map
       (cnr, order_path, s3_bucket, s3_key, order_kind, order_id, order_date, ssot_source, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7::date, 'nv_hc_order_mirror', NOW())
     ON CONFLICT (cnr, order_path) DO UPDATE SET
       s3_bucket = EXCLUDED.s3_bucket,
       s3_key = EXCLUDED.s3_key,
       order_kind = EXCLUDED.order_kind,
       order_id = EXCLUDED.order_id,
       order_date = EXCLUDED.order_date,
       updated_at = NOW()`,
    [row.cnr, row.orderPath, row.bucket, row.s3Key, row.kind, row.orderId, row.orderDate],
  );
}

async function main() {
  const { cnrs: cliCnrs, batchFinal, apply } = parseArgs(process.argv);
  const baseUrl = process.env.NYSAPI_URL || 'http://127.0.0.1:8090';
  const apiKey = (process.env.NYSAPI_API_KEY || '').trim();
  const bucket = DEFAULT_BUCKET;
  const region = BUCKET_REGION[bucket];
  if (!region) throw new Error(`bucket_not_allowlisted:${bucket}`);
  console.log(
    JSON.stringify({
      event: 'nv_hc_order_mirror_p1_start',
      apply,
      bucket,
      nysapi_url: baseUrl,
      api_key_len: apiKey.length,
      auth_base_set: Boolean((process.env.NV_HC_ORDER_AUTH_BASE || '').trim()),
      auth_key_len: (process.env.NV_HC_ORDER_AUTH_API_KEY || process.env.CASE_API_INTERNAL_KEY || '').trim()
        .length,
      cli_cnr_count: cliCnrs.length,
      batch_final: batchFinal,
    }),
  );

  let cnrs = [...cliCnrs];
  if (batchFinal > 0) {
    const batch = await batchCnrsFromRds(batchFinal);
    cnrs = [...new Set([...cnrs, ...batch])];
  }
  if (cnrs.length === 0) cnrs = ['APHC010000832023'];

  let s3 = null;
  let S3PutObjectCommand;
  let S3HeadObjectCommand;
  if (apply) {
    const s3mod = await import('@aws-sdk/client-s3');
    s3 = new s3mod.S3Client({ region });
    S3PutObjectCommand = s3mod.PutObjectCommand;
    S3HeadObjectCommand = s3mod.HeadObjectCommand;
  }
  let gatewayPool;
  if (apply) {
    const gw = process.env.GATEWAY_DATABASE_URL;
    if (!gw) throw new Error('apply_requires_GATEWAY_DATABASE_URL');
    const pg = (await import('pg')).default;
    gatewayPool = new pg.Pool({ connectionString: gw, max: 2 });
  }

  const summary = {
    cnrs: cnrs.length,
    orders_seen: 0,
    fetch_attempted: 0,
    pdf_ok: 0,
    uploaded: 0,
    map_rows: 0,
    blocked: [],
  };

  for (const cnr of cnrs) {
    if (!apiKey) {
      summary.blocked.push({ cnr, reason: 'missing_NYSAPI_API_KEY' });
      continue;
    }
    let caseRow;
    try {
      caseRow = await loadCase(cnr, baseUrl, apiKey);
    } catch (e) {
      summary.blocked.push({ cnr, reason: String(e.message || e) });
      continue;
    }
    const orders = ordersFromCase(caseRow);
    summary.orders_seen += orders.length;

    for (const ord of orders) {
      let fetched = await fetchPdfViaAuthTier(cnr, ord.orderPath);
      if (fetched) summary.fetch_attempted++;
      for (const url of portalFetchUrls(ord.orderPath)) {
        if (fetched) break;
        summary.fetch_attempted++;
        try {
          const attempt = await fetchPdfBytes(url);
          if (attempt.isPdf && attempt.bytes > 500) {
            fetched = { ...attempt, url };
            break;
          }
        } catch {
          /* try next URL */
        }
      }
      if (!fetched) {
        summary.blocked.push({
          cnr,
          order_path: ord.orderPath,
          reason: 'no_fetchable_pdf_auth_and_portal_failed',
        });
        continue;
      }
      summary.pdf_ok++;
      const s3Key = deriveHcOrderS3Key(cnr, ord.orderPath);
      const sha = createHash('sha256').update(fetched.buf).digest('hex').slice(0, 16);
      console.log(
        JSON.stringify({
          event: 'order_pdf_ready',
          cnr,
          order_path: ord.orderPath,
          s3_key_tail: s3Key.slice(-48),
          bytes: fetched.bytes,
          sha16: sha,
          apply,
        }),
      );

      if (!apply) continue;

      const head = await s3.send(new S3HeadObjectCommand({ Bucket: bucket, Key: s3Key })).catch(() => null);
      if (!head) {
        await s3.send(
          new S3PutObjectCommand({
            Bucket: bucket,
            Key: s3Key,
            Body: fetched.buf,
            ContentType: 'application/pdf',
          }),
        );
        summary.uploaded++;
      }
      const client = await gatewayPool.connect();
      try {
        await upsertMapRow(client, {
          cnr,
          orderPath: ord.orderPath,
          bucket,
          s3Key,
          kind: ord.kind,
          orderId: ord.orderId,
          orderDate: ord.orderDate,
        });
        summary.map_rows++;
      } finally {
        client.release();
      }
    }
  }

  if (gatewayPool) await gatewayPool.end();
  console.log(JSON.stringify({ event: 'nv_hc_order_mirror_p1_done', summary }));
  if (!apply) process.exit(0);
  process.exit(summary.pdf_ok > 0 ? 0 : 2);
}

main().catch((e) => {
  console.error(JSON.stringify({ event: 'nv_hc_order_mirror_p1_fatal', error: String(e.message || e) }));
  process.exit(1);
});
