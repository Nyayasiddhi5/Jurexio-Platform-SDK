import fs from 'node:fs';
import path from 'node:path';

export interface JrxRegistryEventRow {
  name: string;
  domain: string;
  critical: boolean;
  source?: string;
  maps_to?: string | null;
  alias_sunset?: string;
}

export interface JrxRegistryMeta {
  version: string;
  adopted_on?: string;
  alias_policy?: {
    legacy_alias_accept_until?: string;
    reject_non_canonical_after?: string;
  };
  flag_012_core_events?: string[];
}

interface EventsDoc {
  _meta: JrxRegistryMeta;
  events: JrxRegistryEventRow[];
}

let cached: { mtimeMs: number; doc: EventsDoc; byName: Map<string, JrxRegistryEventRow> } | null =
  null;

function registryPath(): string {
  return path.resolve(process.cwd(), 'jurexio-specs/registry/events.json');
}

function loadEventsDoc(): { doc: EventsDoc; byName: Map<string, JrxRegistryEventRow> } {
  const file = registryPath();
  const stat = fs.statSync(file);
  if (cached && cached.mtimeMs === stat.mtimeMs) {
    return { doc: cached.doc, byName: cached.byName };
  }
  const doc = JSON.parse(fs.readFileSync(file, 'utf8')) as EventsDoc;
  const byName = new Map(doc.events.map((e) => [e.name, e]));
  cached = { mtimeMs: stat.mtimeMs, doc, byName };
  return { doc, byName };
}

export function getJrxEventRegistryMeta(): JrxRegistryMeta {
  return loadEventsDoc().doc._meta;
}

export function lookupJrxRegistryEvent(name: string): JrxRegistryEventRow | undefined {
  const key = String(name || '').trim().toUpperCase();
  return loadEventsDoc().byName.get(key);
}

export function validateJrxCanonicalEventName(name: string): {
  valid: boolean;
  code: string;
  event?: JrxRegistryEventRow;
  canonical?: string;
} {
  const trimmed = String(name || '').trim().toUpperCase();
  if (!trimmed) {
    return { valid: false, code: 'EVENT_NAME_REQUIRED' };
  }
  const row = lookupJrxRegistryEvent(trimmed);
  if (!row) {
    return { valid: false, code: 'EVENT_NOT_IN_REGISTRY' };
  }
  if (row.source === 'legacy-alias' && row.maps_to) {
    const meta = getJrxEventRegistryMeta();
    const until = meta.alias_policy?.reject_non_canonical_after;
    if (until && new Date(until) <= new Date()) {
      return {
        valid: false,
        code: 'LEGACY_ALIAS_EXPIRED',
        canonical: row.maps_to,
        event: row,
      };
    }
    return { valid: true, code: 'LEGACY_ALIAS_ACCEPTED', canonical: row.maps_to, event: row };
  }
  return { valid: true, code: 'CANONICAL_EVENT', event: row };
}
