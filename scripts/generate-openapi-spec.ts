/**
 * generate-openapi-spec.ts
 *
 * Static walker — reads `src/index.ts` to discover every Express router
 * mount (`app.use('/api/...', <router>)`), follows each router var back to
 * its source file in `src/routes/`, and scans that file for `router.METHOD(
 * '<subpath>', …)` calls. Emits a minimal but valid OpenAPI 3.1 document
 * to `docs/openapi/nyayavigya-v5.openapi.json`.
 *
 * NOT a runtime introspector — does not import the app — so it is safe to
 * run in CI without a database, Redis, or any side-effects.
 *
 * Run:  npx tsx scripts/generate-openapi-spec.ts
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const INDEX_TS = path.join(ROOT, 'src', 'index.ts');
const ROUTES_DIR = path.join(ROOT, 'src', 'routes');
const OUT_DIR = path.join(ROOT, 'docs', 'openapi');
const OUT_FILE = path.join(OUT_DIR, 'nyayavigya-v5.openapi.json');

const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete', 'options', 'head'] as const;
type HttpMethod = (typeof HTTP_METHODS)[number];

interface RouteEntry {
  method: HttpMethod;
  path: string;
  source: string;
}

function readFile(p: string): string {
  return fs.readFileSync(p, 'utf8');
}

/** Parse all `import X from './routes/foo.js'` (and similar) → map var → file. */
function parseRouterImports(indexSrc: string): Map<string, string> {
  const map = new Map<string, string>();
  // import <name> from './routes/<file>.js'
  // import { <name> } from './routes/<file>.js'
  const reDefault = /import\s+(\w+)\s+from\s+['"]\.\/routes\/([\w-]+)\.js['"]/g;
  const reNamed = /import\s+\{\s*([\w\s,]+)\s*\}\s+from\s+['"]\.\/routes\/([\w-]+)\.js['"]/g;
  let m: RegExpExecArray | null;
  while ((m = reDefault.exec(indexSrc))) {
    map.set(m[1], m[2]);
  }
  while ((m = reNamed.exec(indexSrc))) {
    const names = m[1].split(',').map((s) => s.trim()).filter(Boolean);
    for (const n of names) map.set(localName(n), m[2]);
  }
  return map;
}

/**
 * Resolve the *local* binding name from a destructuring/import specifier.
 * Handles `orig`, `orig: alias`, `orig as alias`, `default: alias`.
 * The local binding (alias when present) is what `app.use(...)` references.
 */
function localName(spec: string): string {
  const s = spec.trim();
  const colon = s.split(':');
  if (colon.length === 2) return colon[1].trim();
  const asMatch = s.match(/\bas\s+(\w+)\b/);
  if (asMatch) return asMatch[1];
  return s;
}

/**
 * Parse dynamic `await import('./routes/<file>.js')` mounts (the generator's
 * historical blind spot). Covers:
 *   const nvX = await import('./routes/f.js')
 *   const { default: nvX } = await import('./routes/f.js')
 *   const { promptsRouter: nvPromptsRouter, ragCollectionsRouter: nvRag } = await import('./routes/f.js')
 *   const {\n  nvA,\n  nvB,\n} = await import('./routes/f.js')   // multi-line
 * Merges every resolved local binding → file into `map`.
 */
function parseDynamicRouterImports(indexSrc: string, map: Map<string, string>): void {
  // Destructured form (single or multi-line). Non-greedy brace body.
  const reDestructured = /const\s*\{([\s\S]*?)\}\s*=\s*await\s+import\(\s*['"]\.\/routes\/([\w-]+)\.js['"]\s*\)/g;
  // Whole-module form: const nsVar = await import('./routes/f.js')
  const rePlain = /const\s+(\w+)\s*=\s*await\s+import\(\s*['"]\.\/routes\/([\w-]+)\.js['"]\s*\)/g;
  let m: RegExpExecArray | null;
  while ((m = reDestructured.exec(indexSrc))) {
    const file = m[2];
    for (const raw of m[1].split(',')) {
      const name = localName(raw);
      if (name && /^\w+$/.test(name)) map.set(name, file);
    }
  }
  while ((m = rePlain.exec(indexSrc))) {
    map.set(m[1], m[2]);
  }
}

/** Find every `app.use('<base>', …, <routerVar>)` mount. */
function parseMounts(indexSrc: string, routerVars: Set<string>): Array<{ base: string; routerVar: string }> {
  const mounts: Array<{ base: string; routerVar: string }> = [];
  // app.use('/api/...', ..., routerVar)
  const re = /app\.use\(\s*['"]([^'"]+)['"]\s*,([^)]*)\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(indexSrc))) {
    const base = m[1];
    const args = m[2];
    // Find the LAST identifier in args that is in routerVars.
    const ids = Array.from(args.matchAll(/\b(\w+)\b/g)).map((x) => x[1]);
    for (let i = ids.length - 1; i >= 0; i--) {
      if (routerVars.has(ids[i])) {
        mounts.push({ base, routerVar: ids[i] });
        break;
      }
    }
  }
  return mounts;
}

/** Scan a router file for `router.METHOD('<sub>', …)`. Best-effort; ignores
 *  anything that doesn't string-literal its first arg. */
function parseRouterFile(file: string): Array<{ method: HttpMethod; sub: string }> {
  const src = readFile(file);
  const out: Array<{ method: HttpMethod; sub: string }> = [];
  // matches:
  //   router.get('/foo', ...)
  //   <anyVar>.post("/bar", ...)
  for (const method of HTTP_METHODS) {
    const re = new RegExp(`\\.${method}\\(\\s*['"\`]([^'"\`]+)['"\`]`, 'g');
    let m: RegExpExecArray | null;
    while ((m = re.exec(src))) {
      out.push({ method, sub: m[1] });
    }
  }
  return out;
}

function joinPath(base: string, sub: string): string {
  const b = base.endsWith('/') ? base.slice(0, -1) : base;
  const s = sub.startsWith('/') ? sub : '/' + sub;
  // Convert express :param -> {param} for OpenAPI.
  const joined = (b + s).replace(/:([A-Za-z_][\w]*)/g, '{$1}');
  // Collapse trailing slash duplicates.
  return joined.replace(/\/+$/, '') || '/';
}

function extractParams(p: string): Array<{ name: string; in: 'path'; required: true; schema: { type: 'string' } }> {
  const params: Array<{ name: string; in: 'path'; required: true; schema: { type: 'string' } }> = [];
  for (const m of p.matchAll(/\{(\w+)\}/g)) {
    params.push({ name: m[1], in: 'path', required: true, schema: { type: 'string' } });
  }
  return params;
}

function main() {
  const indexSrc = readFile(INDEX_TS);
  const importMap = parseRouterImports(indexSrc);
  // Also resolve routers mounted via dynamic `await import('./routes/…')`.
  parseDynamicRouterImports(indexSrc, importMap);
  const mounts = parseMounts(indexSrc, new Set(importMap.keys()));

  const routes: RouteEntry[] = [];
  const seen = new Set<string>();
  let mountedCount = 0;
  for (const { base, routerVar } of mounts) {
    const file = importMap.get(routerVar);
    if (!file) continue;
    const fullPath = path.join(ROUTES_DIR, file + '.ts');
    if (!fs.existsSync(fullPath)) continue;
    mountedCount++;
    for (const { method, sub } of parseRouterFile(fullPath)) {
      const full = joinPath(base, sub);
      const key = `${method}:${full}`;
      if (seen.has(key)) continue;
      seen.add(key);
      routes.push({ method, path: full, source: file });
    }
  }

  // Group into OpenAPI paths object.
  const paths: Record<string, Record<string, unknown>> = {};
  for (const r of routes) {
    if (!paths[r.path]) paths[r.path] = {};
    /* NV-COMPLETION-DRIVEN-001 — partners integrating the AI surfaces need the
     * lifecycle state enum in the machine-readable spec, not only in prose: it is
     * what distinguishes "still working" from "failed", and NSP asked for it
     * explicitly after a client abort was being read as a draft failure. The
     * generator is otherwise path-only, so the schema is attached to the
     * orchestrate operations rather than inventing bodies for all ~700 routes. */
    const isOrchestrate = /\/orchestrate(\/stream)?$/.test(r.path) && r.method === 'post';
    paths[r.path][r.method] = {
      tags: [r.source],
      summary: `${r.method.toUpperCase()} ${r.path}`,
      operationId: `${r.source}_${r.method}_${r.path.replace(/[^A-Za-z0-9]+/g, '_')}`.slice(0, 120),
      parameters: extractParams(r.path),
      responses: isOrchestrate
        ? {
            '200': {
              description:
                'Outcome envelope. `requestPhase` is always present; `ready` and `degraded` are both SUCCESS ' +
                '(`degraded` = answer complete, an optional enrichment was dropped to progress). Only ' +
                '`failed_infra`, or an empty body after the worker deadline, is a failure.',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/OrchestrateOutcome' },
                },
              },
            },
            '4XX': { description: 'Client error' },
            '5XX': { description: 'Server error' },
          }
        : {
            '200': { description: 'OK' },
            '4XX': { description: 'Client error' },
            '5XX': { description: 'Server error' },
          },
    };
  }

  const spec = {
    openapi: '3.1.0',
    info: {
      title: 'Nyayavigya Platform API',
      // Tracks the live platform/registry line (nv-registry-stats.ts → 5.1.0).
      version: '5.1.0',
      description: 'Auto-generated from Express router stack via scripts/generate-openapi-spec.ts',
      contact: { name: 'Nyayavigya Engineering', email: 'engineering@nyayavigya.com' },
      license: { name: 'Enterprise Commercial License - Legal Edition' },
    },
    servers: [
      { url: '/', description: 'Same-origin gateway' },
    ],
    components: {
      schemas: {
        RequestPhase: {
          type: 'string',
          enum: [
            'accepted',
            'grounding',
            'generating',
            'enriching',
            'ready',
            'degraded',
            'failed_infra',
          ],
          description:
            'Lifecycle phase of an AI request (NV-COMPLETION-DRIVEN-001). ' +
            'accepted → grounding → generating → enriching → ready | degraded | failed_infra. ' +
            'ready = complete. degraded = complete, but an optional enrichment (extra chain-of-thought, ' +
            'a hung memory source) was dropped so the request could progress — treat as SUCCESS and render ' +
            'the content. failed_infra = no usable outcome. A client-side abort is NOT a phase: NYV keeps ' +
            'working, so poll rather than mapping the abort to a timeout error.',
        },
        OrchestrateOutcome: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: {
              type: 'object',
              properties: {
                content: { type: 'string', description: 'The answer / draft text.' },
                requestPhase: { $ref: '#/components/schemas/RequestPhase' },
                optionalDegraded: {
                  type: 'boolean',
                  description:
                    'True when an optional enrichment was dropped to progress. Content is present and the ' +
                    'safety gates ran — a success signal, not an error.',
                },
                requestId: {
                  type: 'string',
                  description: 'Per-HTTP-call id; also returned in the x-request-id header.',
                },
                orchestrationId: {
                  type: 'string',
                  description:
                    'Stable id for a whole multi-leaf Queen run, survives retries. Absent on the ' +
                    'specialist path, which is a single call with nothing to correlate.',
                },
                sessionId: {
                  type: 'string',
                  description:
                    'Session this turn belongs to. Minted by NYV for NSP/NYM when the caller sends none — ' +
                    'echo it on the next turn to continue the same session and reuse its memory.',
                },
                riskBadge: { type: 'string', enum: ['GREEN', 'YELLOW', 'RED'] },
                auditHash: { type: 'string' },
                routing: {
                  type: 'object',
                  properties: {
                    path: { type: 'string', enum: ['specialist', 'queen', 'doc-pipeline'] },
                  },
                },
                qualityEnvelope: {
                  type: 'object',
                  description:
                    'Which mandatory steps ran. `missingMandatory` empty = all gates satisfied; ' +
                    '`scaledOptional` lists stages intentionally skipped.',
                },
                cost: {
                  type: 'object',
                  properties: {
                    completions: {
                      type: 'integer',
                      description: 'Billed provider completions for this request.',
                    },
                  },
                },
              },
              required: ['content', 'requestPhase', 'requestId'],
            },
          },
          required: ['success', 'data'],
        },
      },
      securitySchemes: {
        bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
        sdkApiKey: { type: 'apiKey', in: 'header', name: 'X-NYV-API-Key' },
      },
    },
    paths,
    'x-generated-at': new Date().toISOString(),
    'x-coverage': {
      mounts_total: mounts.length,
      mounts_resolved: mountedCount,
      paths: Object.keys(paths).length,
      operations: routes.length,
    },
  };

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(OUT_FILE, JSON.stringify(spec, null, 2));
  // eslint-disable-next-line no-console
  console.log(
    `[openapi] wrote ${OUT_FILE} — ${Object.keys(paths).length} paths, ` +
      `${routes.length} operations, ${mountedCount}/${mounts.length} mounts resolved`,
  );
}

main();
