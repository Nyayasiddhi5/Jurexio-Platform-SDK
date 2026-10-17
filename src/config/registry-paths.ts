/**
 * Jurexio v5.1.0 — single source of truth for registry paths.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const REGISTRY_VERSION = process.env.NV_REGISTRY_VERSION || '5.1.0';
export const ALLOWED_JURISDICTIONS = ['IN', 'UK', 'EU', 'US', 'GC', 'SG', 'Default'] as const;
export type JurisdictionCode = typeof ALLOWED_JURISDICTIONS[number];

export const REGISTRY_FILE_RE = /^Jurexio-Legal-registry-(IN|UK|EU|US|GC|SG|Default)\.json$/;
export const DEFAULT_REGISTRY_FILENAME = 'Jurexio-Legal-registry-Default.json';
export const ALIAS_MAP_FILENAME = 'agent-id-aliases-v5.1.0.json';

function resolveRegistryDir(): string {
  const candidates = [
    path.join(process.cwd(), 'nyayavigya-platform-312', 'config', 'agent-registries'),
    path.join(process.cwd(), 'config', 'agent-registries'),
    path.join(__dirname, '..', '..', 'config', 'agent-registries'),
    path.join(__dirname, '..', '..', '..', 'nyayavigya-platform-312', 'config', 'agent-registries'),
  ];

  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate) && fs.readdirSync(candidate).some(f => REGISTRY_FILE_RE.test(f))) {
        return candidate;
      }
    } catch {
      // Ignore invalid candidates.
    }
  }

  throw new Error(
    `Registry directory not found. Tried: ${candidates.join(', ')}. ` +
      'Expected location: nyayavigya-platform-312/config/agent-registries/'
  );
}

let cachedRegistryDir: string | null = null;

export function getRegistryDir(): string {
  if (!cachedRegistryDir) cachedRegistryDir = resolveRegistryDir();
  return cachedRegistryDir;
}

export function getRegistryPath(jurisdiction: JurisdictionCode | string): string {
  return path.join(getRegistryDir(), `Jurexio-Legal-registry-${jurisdiction}.json`);
}

export function getDefaultRegistryPath(): string {
  return path.join(getRegistryDir(), DEFAULT_REGISTRY_FILENAME);
}

export function getAliasMapPath(): string {
  return path.join(getRegistryDir(), ALIAS_MAP_FILENAME);
}

export function listRegistryFiles(): string[] {
  return fs
    .readdirSync(getRegistryDir())
    .filter(f => REGISTRY_FILE_RE.test(f))
    .map(f => path.join(getRegistryDir(), f));
}

export function isAllowedRegistryFilename(filename: string): boolean {
  return REGISTRY_FILE_RE.test(path.basename(filename));
}
