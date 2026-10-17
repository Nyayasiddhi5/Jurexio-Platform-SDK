/**
 * NV-GRPO-NIGHTLY-001 — schedule nightly preference-pair export inside the gateway.
 * Default: run once at startup (catch-up) + every 24h when NYV_GRPO_NIGHTLY_EXPORT != off.
 */
import { createLogger } from '../utils/logger.js';
import { spawn } from 'node:child_process';
import * as path from 'node:path';

const logger = createLogger('grpo-nightly-export');

function enabled(): boolean {
  const v = String(process.env.NYV_GRPO_NIGHTLY_EXPORT ?? 'on').toLowerCase();
  return v !== 'off' && v !== '0' && v !== 'false';
}

function runExportOnce(): void {
  const script = path.join(process.cwd(), 'scripts', './jrx-grpo-nightly-export.ts');
  const child = spawn('npx', ['tsx', script], {
    cwd: process.cwd(),
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: false,
  });
  let stderr = '';
  child.stderr?.on('data', (d) => { stderr += String(d); });
  child.on('close', (code) => {
    if (code === 0) {
      logger.info('grpo_nightly_export_ok');
    } else {
      logger.warn('grpo_nightly_export_failed', { code, stderr: stderr.slice(0, 400) });
    }
  });
}

export function startGrpoNightlyExport(): { stop: () => void } {
  if (!enabled()) {
    logger.info('grpo_nightly_export_disabled');
    return { stop: () => undefined };
  }
  // Catch-up shortly after boot (avoid racing DB migrations)
  const bootTimer = setTimeout(() => runExportOnce(), 60_000);
  const dayMs = Math.max(3_600_000, Number(process.env.NYV_GRPO_EXPORT_INTERVAL_MS) || 86_400_000);
  const interval = setInterval(() => runExportOnce(), dayMs);
  logger.info('grpo_nightly_export_scheduled', { intervalMs: dayMs });
  return {
    stop: () => {
      clearTimeout(bootTimer);
      clearInterval(interval);
    },
  };
}
