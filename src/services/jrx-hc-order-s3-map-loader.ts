/**
 * NV-HC-ORDER-PRESIGN-001 — load `nv_hc_order_s3_map` rows + presign for CNR resolve.
 */
import { pool } from '../db/index.js';
import { createLogger } from '../utils/logger.js';
import type { CnrResolveData } from '../../packages/client-sdk/src/api/CnrApi.js';
import {
  applyHcOrderPresignToResolveData,
  presignHcOrderMapRows,
  type HcOrderS3MapEntry,
  type HcOrderKind,
} from './jrx-hc-order-presign.js';

const logger = createLogger('./jrx-hc-order-s3-map');

function isTestEnv(): boolean {
  return process.env.VITEST === 'true' || process.env.NODE_ENV === 'test';
}

function hcOrderPresignDisabled(): boolean {
  return process.env.JRX_F_HC_ORDER_PRESIGN === '0';
}

function courtLevelToArchive(level: string | null | undefined): string {
  switch (level) {
    case 'HC':
      return 'indian-high-court-judgments';
    case 'SC':
      return 'indian-supreme-court-judgments';
    case 'DC':
      return 'indian-district-court-judgments';
    default:
      return 'indian-high-court-judgments';
  }
}

export async function fetchHcOrderS3MapForCnr(cnr: string): Promise<HcOrderS3MapEntry[]> {
  const normalized = cnr.trim().toUpperCase();
  if (!normalized || !pool) return [];
  try {
    const r = await pool.query(
      `SELECT order_path, s3_bucket, s3_key, order_kind, order_id, order_date
         FROM public.nv_hc_order_s3_map
        WHERE cnr = $1`,
      [normalized],
    );
    return (r.rows ?? []).map((row) => ({
      orderPath: String(row.order_path),
      s3Bucket: String(row.s3_bucket),
      s3Key: String(row.s3_key),
      orderKind: (String(row.order_kind) === 'interim' ? 'interim' : 'final') as HcOrderKind,
      orderId: row.order_id != null ? String(row.order_id) : null,
      orderDate: row.order_date != null ? String(row.order_date) : null,
    }));
  } catch (err) {
    logger.warn('nv_hc_order_s3_map lookup failed (table may not exist yet)', {
      cnrLen: normalized.length,
      error: err instanceof Error ? err.message : String(err),
    });
    return [];
  }
}

/**
 * When court is HC and map rows exist, presign mirrored order PDFs into fields + documents.
 * No-op in tests, when disabled, or when the map is empty (mirror job not run yet).
 */
export async function applyHcOrderPresignFromDb(input: {
  data: CnrResolveData;
  courtLevel?: string | null;
  includeDocuments?: boolean;
}): Promise<CnrResolveData> {
  if (isTestEnv() || hcOrderPresignDisabled()) return input.data;
  if (input.includeDocuments === false) return input.data;
  if (input.data.status !== 'found') return input.data;
  if (input.courtLevel !== 'HC') return input.data;

  const cnr = input.data.cnr.trim();
  if (!cnr) return input.data;

  const mapRows = await fetchHcOrderS3MapForCnr(cnr);
  if (mapRows.length === 0) return input.data;

  const presignedByS3Path = await presignHcOrderMapRows(mapRows);
  if (presignedByS3Path.size === 0) return input.data;

  const sourceArchive = courtLevelToArchive(input.courtLevel);
  return applyHcOrderPresignToResolveData(
    input.data,
    mapRows,
    presignedByS3Path,
    sourceArchive,
  );
}
