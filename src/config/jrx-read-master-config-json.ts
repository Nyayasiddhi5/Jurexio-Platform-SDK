import fs from 'node:fs';
import path from 'node:path';

const PRIMARY = path.join(process.cwd(), 'config', 'jrx-master-config.json');
const LEGACY = path.join(process.cwd(), 'config', 'nyv-master-config.json');

/** Load master JSON; one-time fallback if legacy filename still on disk. */
export function readMasterConfigJson(): Record<string, unknown> {
  const target = fs.existsSync(PRIMARY) ? PRIMARY : LEGACY;
  const raw = fs.readFileSync(target, 'utf8');
  return JSON.parse(raw) as Record<string, unknown>;
}
