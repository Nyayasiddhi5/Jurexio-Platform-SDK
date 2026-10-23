/**
 * NV-DC-STATUS-DECODE-001 — load numeric rows from nv_dc_case_status_codes at boot.
 * No fabrication: only rows with numeric_code IS NOT NULL are registered.
 */
import { pool } from '../db/index.js';
import { createLogger } from '../utils/logger.js';
import {
  buildDcNumericStatusMaster,
  setDcNumericStatusMaster,
} from '../services/jrx-dc-status-codes.js';

const logger = createLogger('./jrx-dc-status-master-boot');

export async function loadDcNumericStatusMasterFromDb(): Promise<void> {
  if (!pool) {
    setDcNumericStatusMaster(null);
    return;
  }
  try {
    const r = await pool.query(
      `SELECT numeric_code, label, category
         FROM public.nv_dc_case_status_codes
        WHERE numeric_code IS NOT NULL AND TRIM(numeric_code) <> ''`,
    );
    const rows = (r.rows ?? []) as Array<{
      numeric_code?: string | null;
      label: string;
      category: string;
    }>;
    const master = buildDcNumericStatusMaster(rows);
    if (master.size === 0) {
      setDcNumericStatusMaster(null);
      logger.info('DC numeric status master: no numeric rows (NJDG pending — expected)');
      return;
    }
    setDcNumericStatusMaster(master);
    logger.info('DC numeric status master loaded', { rowCount: master.size });
  } catch (err) {
    logger.warn('DC numeric status master load skipped', {
      error: err instanceof Error ? err.message : String(err),
    });
    setDcNumericStatusMaster(null);
  }
}
