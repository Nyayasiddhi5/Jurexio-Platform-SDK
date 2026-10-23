/**
 * NV-HC-ORDER-PRESIGN-001 — HC final/interim order PDF presign seam.
 *
 * HC `finalOrders[]` / `interimOrders[]` carry eCourts-portal-relative `filename`
 * paths with NO object in the public judgment buckets (live probe: no `orders/` prefix
 * on indian-high-court-judgments). Presign ONLY when `nv_hc_order_s3_map` has a row
 * AND the bucket is on the owned allowlist — never fabricate a key (NV-SECRETS-001).
 *
 * Mirror job (caselaw-worker, ops GO) copies PDFs under `deriveHcOrderS3Key()` and
 * inserts map rows; until then behaviour is unchanged (raw filename, no URL).
 */
import type { CnrDocument, CnrFieldValue, CnrResolveData } from '../../packages/client-sdk/src/api/CnrApi.js';

/** Owned HC buckets that may hold mirrored order PDFs (parity with NYS archiveDocs). */
export const HC_ORDER_MIRROR_BUCKET_REGIONS: Readonly<Record<string, string>> = {
  'ns-highcourt-data-bucket': 'us-east-1',
  'ns-indian-highcourt-judgements-2': 'ap-south-1',
};

export const HC_ORDER_PRESIGN_TTL_SECONDS = 900;

export type HcOrderKind = 'final' | 'interim';

export interface HcOrderS3MapEntry {
  orderPath: string;
  s3Bucket: string;
  s3Key: string;
  orderKind: HcOrderKind;
  orderId?: string | null;
  orderDate?: string | null;
}

export interface HcOrderRecord {
  order_id?: string;
  order_date?: string;
  order_details?: string;
  filename?: string;
  case_no?: string;
  presignedUrl?: string;
  pdfUrlKind?: 'presigned' | 'none';
  expiresIn?: number;
  s3Path?: string;
  [key: string]: unknown;
}

/** Normalize portal-relative order paths for map lookup (strip leading slashes). */
export function normalizeEcourtsOrderPath(raw: string): string {
  return raw.trim().replace(/^\/+/, '');
}

/**
 * Deterministic owned-S3 key for the HC order mirror job (P1 ops).
 * Basename preserved; scoped under `data/orders/cnr=<CNR>/`.
 */
export function deriveHcOrderS3Key(input: { cnr: string; orderPath: string }): string {
  const norm = normalizeEcourtsOrderPath(input.orderPath);
  const base = norm.split('/').filter(Boolean).pop() ?? 'order.pdf';
  const safeCnr = input.cnr.trim().toUpperCase();
  return `data/orders/cnr=${safeCnr}/${base}`;
}

export function isAllowedHcOrderBucket(bucket: string): boolean {
  return Object.prototype.hasOwnProperty.call(HC_ORDER_MIRROR_BUCKET_REGIONS, bucket);
}

export function buildHcOrderMapIndex(
  rows: ReadonlyArray<HcOrderS3MapEntry>,
): Map<string, HcOrderS3MapEntry> {
  const index = new Map<string, HcOrderS3MapEntry>();
  for (const row of rows) {
    index.set(normalizeEcourtsOrderPath(row.orderPath), row);
  }
  return index;
}

function orderRecordsFromField(field: CnrFieldValue | undefined): HcOrderRecord[] {
  const value = field?.value;
  if (!Array.isArray(value)) return [];
  return value.filter((r): r is HcOrderRecord => r != null && typeof r === 'object');
}

function hcOrderToDocument(
  record: HcOrderRecord,
  kind: HcOrderKind,
  cnr: string,
  idx: number,
  sourceArchive: string,
): CnrDocument | null {
  const url = record.presignedUrl;
  if (!url) return null;
  const title =
    (typeof record.order_details === 'string' && record.order_details) ||
    (kind === 'final' ? 'Final order' : 'Interim order');
  return {
    id: `hc_${kind}_order_${cnr}_${idx}`,
    kind: 'order',
    title,
    decisionDate: typeof record.order_date === 'string' ? record.order_date.slice(0, 10) : null,
    s3Path: record.s3Path ?? null,
    pdfUrlKind: 'presigned',
    url,
    expiresIn: record.expiresIn ?? HC_ORDER_PRESIGN_TTL_SECONDS,
    sourceArchive,
  };
}

/**
 * Pure enrichment: attach presigned URLs to HC order records when map + presign URLs exist.
 * Records without a verified map row keep raw `filename` only (no fake URL).
 */
export function enrichHcOrderFieldValue(
  field: CnrFieldValue | undefined,
  kind: HcOrderKind,
  cnr: string,
  mapIndex: ReadonlyMap<string, HcOrderS3MapEntry>,
  presignedByS3Path: ReadonlyMap<string, string>,
  sourceArchive: string,
): { field: CnrFieldValue | undefined; documents: CnrDocument[] } {
  if (!field) return { field, documents: [] };
  const records = orderRecordsFromField(field);
  if (records.length === 0) return { field, documents: [] };

  const enriched: HcOrderRecord[] = [];
  const documents: CnrDocument[] = [];

  for (const [idx, raw] of records.entries()) {
    const rec: HcOrderRecord = { ...raw };
    const filename = typeof rec.filename === 'string' ? rec.filename : '';
    if (filename) {
      const mapRow = mapIndex.get(normalizeEcourtsOrderPath(filename));
      if (mapRow && isAllowedHcOrderBucket(mapRow.s3Bucket)) {
        const s3Path = `s3://${mapRow.s3Bucket}/${mapRow.s3Key}`;
        const url = presignedByS3Path.get(s3Path);
        if (url) {
          rec.presignedUrl = url;
          rec.pdfUrlKind = 'presigned';
          rec.expiresIn = HC_ORDER_PRESIGN_TTL_SECONDS;
          rec.s3Path = s3Path;
          const doc = hcOrderToDocument(rec, kind, cnr, idx, sourceArchive);
          if (doc) documents.push(doc);
        }
      }
    }
    enriched.push(rec);
  }

  return {
    field: { ...field, value: enriched },
    documents,
  };
}

export function mergeHcOrderDocuments(
  existing: CnrDocument[],
  fromOrders: CnrDocument[],
): CnrDocument[] {
  if (fromOrders.length === 0) return existing;
  const seen = new Set(existing.map((d) => d.url).filter(Boolean));
  const merged = [...existing];
  for (const doc of fromOrders) {
    if (doc.url && seen.has(doc.url)) continue;
    if (doc.url) seen.add(doc.url);
    merged.push(doc);
  }
  return merged;
}

/** Apply HC order presign enrichment to a resolve envelope (pure; presign URLs precomputed). */
export function applyHcOrderPresignToResolveData(
  data: CnrResolveData,
  mapRows: ReadonlyArray<HcOrderS3MapEntry>,
  presignedByS3Path: ReadonlyMap<string, string>,
  sourceArchive: string,
): CnrResolveData {
  if (data.status !== 'found' || !data.fields) return data;
  const mapIndex = buildHcOrderMapIndex(mapRows);
  if (mapIndex.size === 0 || presignedByS3Path.size === 0) return data;

  const cnr = data.cnr.trim();
  const fields = { ...data.fields };

  const final = enrichHcOrderFieldValue(
    fields.finalOrders,
    'final',
    cnr,
    mapIndex,
    presignedByS3Path,
    sourceArchive,
  );
  fields.finalOrders = final.field;

  const interim = enrichHcOrderFieldValue(
    fields.interimOrders,
    'interim',
    cnr,
    mapIndex,
    presignedByS3Path,
    sourceArchive,
  );
  fields.interimOrders = interim.field;

  const orderDocs = [...final.documents, ...interim.documents];
  const documents = mergeHcOrderDocuments(data.documents, orderDocs);

  return { ...data, fields, documents };
}

const s3Clients = new Map<string, import('@aws-sdk/client-s3').S3Client>();

async function s3ClientForRegion(region: string): Promise<import('@aws-sdk/client-s3').S3Client> {
  let client = s3Clients.get(region);
  if (!client) {
    const { S3Client } = await import('@aws-sdk/client-s3');
    client = new S3Client({ region });
    s3Clients.set(region, client);
  }
  return client;
}

/** Presign one allowlisted owned-bucket object; returns null when bucket is not allowlisted. */
export async function presignHcOrderS3Object(
  bucket: string,
  key: string,
  ttlSeconds = HC_ORDER_PRESIGN_TTL_SECONDS,
): Promise<string | null> {
  const region = HC_ORDER_MIRROR_BUCKET_REGIONS[bucket];
  if (!region) return null;
  const { GetObjectCommand } = await import('@aws-sdk/client-s3');
  const { getSignedUrl } = await import('@aws-sdk/s3-request-presigner');
  const client = await s3ClientForRegion(region);
  return getSignedUrl(client, new GetObjectCommand({ Bucket: bucket, Key: key }), {
    expiresIn: ttlSeconds,
  });
}

/** Batch-presign map rows (skips disallowed buckets). */
export async function presignHcOrderMapRows(
  rows: ReadonlyArray<HcOrderS3MapEntry>,
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const row of rows) {
    if (!isAllowedHcOrderBucket(row.s3Bucket)) continue;
    const s3Path = `s3://${row.s3Bucket}/${row.s3Key}`;
    if (out.has(s3Path)) continue;
    const url = await presignHcOrderS3Object(row.s3Bucket, row.s3Key);
    if (url) out.set(s3Path, url);
  }
  return out;
}
