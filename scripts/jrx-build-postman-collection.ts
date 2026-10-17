/**
 * scripts/jrx-build-postman-collection.ts — Phase 6 deliverable A
 * ─────────────────────────────────────────────────────────────────────────────
 * Transforms the canonical OpenAPI snapshot at
 *   docs/openapi/jurexio-v5.openapi.json
 * into a Postman v2.1 collection at
 *   docs/postman/jurexio-v5.postman_collection.json
 *
 * Design:
 *   - SINGLE unified collection covering the full /api/jrx/* + /api/nv5/*
 *     surface — same approach as the SDK: ONE JRX API for every platform
 *     (NSP, NSPM, NYM, NSI, NSA, NSM, JRX), differentiated only by the SDK
 *     key supplied via the `{{JRX_API_KEY}}` variable. No per-platform forks.
 *   - Folder hierarchy matches the OpenAPI tag of the operation; falls back
 *     to the URL's first path segment if untagged.
 *   - Auth = X-API-Key header (canonical per NV-AUTH-HEADER-001) populated
 *     from the collection variable `{{JRX_API_KEY}}`.
 *   - Idempotent — output is sorted, so re-runs produce stable diffs.
 *
 * Usage:
 *   npx tsx scripts/jrx-build-postman-collection.ts            # writes to default path
 *   NV_POSTMAN_OUT=/tmp/x.json npx tsx scripts/jrx-build-postman-collection.ts
 *
 * Guardrails:
 *   - NV-NAMING-001: grep `postman` showed no existing builder.
 *   - NV-DOC-001: writes under `docs/postman/`, an asset bucket — not active markdown.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO = path.resolve(__dirname, '..');
const SPEC_PATH = path.join(REPO, 'docs/openapi/jurexio-v5.openapi.json');
const OUT_PATH = process.env.NV_POSTMAN_OUT || path.join(REPO, 'docs/postman/jurexio-v5.postman_collection.json');

interface OASOperation {
  summary?: string;
  description?: string;
  tags?: string[];
  operationId?: string;
  parameters?: Array<{ name: string; in: string; required?: boolean; schema?: unknown }>;
  requestBody?: { content?: Record<string, { schema?: unknown; example?: unknown }> };
}
interface OASSpec {
  openapi: string;
  info: { title: string; version: string };
  paths: Record<string, Record<string, OASOperation>>;
}

interface PostmanItem {
  name: string;
  request: {
    method: string;
    header: Array<{ key: string; value: string; type?: string; description?: string }>;
    url: { raw: string; host: string[]; path: string[]; query?: Array<{ key: string; value: string; description?: string; disabled?: boolean }> };
    body?: { mode: 'raw'; raw: string; options: { raw: { language: string } } };
    description?: string;
  };
  response: unknown[];
}
interface PostmanFolder { name: string; item: Array<PostmanItem | PostmanFolder>; description?: string; }

const METHODS = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options'];

function loadSpec(): OASSpec {
  if (!fs.existsSync(SPEC_PATH)) {
    throw new Error(`OpenAPI spec missing at ${SPEC_PATH} — run \`npm run openapi:generate\` first.`);
  }
  return JSON.parse(fs.readFileSync(SPEC_PATH, 'utf-8')) as OASSpec;
}

function pathToPostman(p: string): { raw: string; host: string[]; path: string[]; query?: Array<{ key: string; value: string }> } {
  const segments = p.replace(/^\//, '').split('/').map(seg =>
    seg.startsWith('{') && seg.endsWith('}') ? `:${seg.slice(1, -1)}` : seg,
  );
  return { raw: `{{JRX_BASE_URL}}/${segments.join('/')}`, host: ['{{JRX_BASE_URL}}'], path: segments };
}

function operationToItem(method: string, route: string, op: OASOperation): PostmanItem {
  const headers: PostmanItem['request']['header'] = [
    { key: 'X-API-Key', value: '{{JRX_API_KEY}}', type: 'text', description: 'Canonical SDK auth header (NV-AUTH-HEADER-001).' },
    { key: 'X-API-Version', value: '{{JRX_API_VERSION}}', type: 'text', description: 'Default v1; bump per docs/openapi.' },
  ];
  let body: PostmanItem['request']['body'] | undefined;
  if (op.requestBody?.content?.['application/json']) {
    const ex = op.requestBody.content['application/json'].example ?? op.requestBody.content['application/json'].schema ?? {};
    headers.push({ key: 'Content-Type', value: 'application/json', type: 'text' });
    body = { mode: 'raw', raw: JSON.stringify(ex, null, 2), options: { raw: { language: 'json' } } };
  }
  const url = pathToPostman(route);
  const queryParams = (op.parameters ?? []).filter(p => p.in === 'query').map(p => ({
    key: p.name, value: '', description: p.required ? '(required)' : '(optional)', disabled: !p.required,
  }));
  if (queryParams.length) url.query = queryParams;

  return {
    name: op.summary || op.operationId || `${method.toUpperCase()} ${route}`,
    request: {
      method: method.toUpperCase(),
      header: headers,
      url,
      body,
      description: op.description || op.summary || '',
    },
    response: [],
  };
}

function build(): { generated: number; folders: number; outBytes: number } {
  const spec = loadSpec();
  const folders = new Map<string, PostmanFolder>();
  let count = 0;

  const sortedPaths = Object.keys(spec.paths).sort();
  for (const route of sortedPaths) {
    const ops = spec.paths[route];
    for (const method of METHODS) {
      const op = ops[method as keyof typeof ops] as OASOperation | undefined;
      if (!op) continue;
      const tag = (op.tags && op.tags[0]) || (route.split('/').filter(Boolean)[0] ?? 'misc');
      let folder = folders.get(tag);
      if (!folder) { folder = { name: tag, item: [], description: `Operations tagged "${tag}"` }; folders.set(tag, folder); }
      folder.item.push(operationToItem(method, route, op));
      count++;
    }
  }

  const collection = {
    info: {
      _postman_id: 'jurexio-v5-collection',
      name: `${spec.info.title} v${spec.info.version}`,
      description:
        '# Jurexio Unified API Collection\n\n' +
        'ONE collection covers the entire JRX API surface for every platform ' +
        '(NSP, NSPM, NYM, NSI, NSA, NSM, JRX). Differentiation is by SDK key, ' +
        'never by URL prefix.\n\n' +
        '## Variables to set\n' +
        '- `JRX_BASE_URL` — e.g. `http://localhost:5000` or `https://api.jurexio.com`\n' +
        '- `JRX_API_KEY`  — your platform SDK key (e.g. `$JRX_SDK_KEY_NSP`)\n' +
        '- `JRX_API_VERSION` — defaults to `v1`\n\n' +
        '## Auth\n' +
        'Sent as `X-API-Key` per NV-AUTH-HEADER-001.\n\n' +
        `## Stats\n${count} operations across ${folders.size} folders. Auto-generated from \`docs/openapi/jurexio-v5.openapi.json\`.`,
      schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
    },
    variable: [
      { key: 'JRX_BASE_URL', value: 'http://localhost:5000', type: 'string' },
      { key: 'JRX_API_KEY', value: '', type: 'string', description: 'Set to one of JRX_SDK_KEY_{NSP,NSPM,NYM,NSI,NSA,NSM,JRX}' },
      { key: 'JRX_API_VERSION', value: 'v1', type: 'string' },
    ],
    item: Array.from(folders.values()).sort((a, b) => a.name.localeCompare(b.name)),
  };

  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  const out = JSON.stringify(collection, null, 2);
  fs.writeFileSync(OUT_PATH, out);
  return { generated: count, folders: folders.size, outBytes: out.length };
}

const stats = build();
// eslint-disable-next-line no-console
console.log(`✓ Postman collection built: ${stats.generated} operations / ${stats.folders} folders / ${(stats.outBytes / 1024).toFixed(1)} KB`);
// eslint-disable-next-line no-console
console.log(`  → ${OUT_PATH}`);
