/**
 * NV SDK — Swagger / OpenAPI Documentation
 * Serves interactive API documentation at /api/docs
 * Auto-generated from route annotations + manual spec for key endpoints.
 */

import { Router, Request, Response } from 'express';
import * as fs from 'node:fs';
import * as path from 'node:path';

const router = Router();

// Full auto-generated spec (all ~1.3k routes) produced by
// scripts/generate-openapi-spec.ts. We serve this as the BASE so partners see
// the complete path set, then overlay the hand-curated rich schemas below for
// the key endpoints. See buildPublishedSpec().
const GENERATED_SPEC_PATH = path.resolve(process.cwd(), 'docs', 'openapi', 'jurexio-v5.openapi.json');

const curatedSpec = {
  openapi: '3.0.3',
  info: {
    title: 'Jurexio Enterprise Platform SDK — Legal AI API',
    description: `
# Jurexio Enterprise Platform SDK v5.1.1 — Platform 5.1.0

The Jurexio Enterprise Platform SDK is the AI backbone for the entire Jurexio ecosystem.
It provides 164 active legal agents per jurisdiction across 6 jurisdictions (IN, UK, US, GC, EU, SG), 107 orchestration topologies, and 502 MCP tools.

## Authentication
Most endpoints require a Bearer JWT token in the Authorization header.
Internal service calls from NSP/NSI use the \`X-NSP-Inter-Secret\` header.
SDK API keys use prefix \`nyv_live_sk_\` (production) or \`nyv_test_sk_\` (sandbox).

## Rate Limiting (by Tier)
- Free: 10 rpm / 500 rpd
- Solo: 20 rpm / 2,000 rpd
- Plus: 40 rpm / 5,000 rpd
- Pro: 60 rpm / 20,000 rpd
- Enterprise: 600 rpm / 200,000 rpd

## Platforms
jurexio-citizen | nys-professional | nys-institutional | nys-academy | nys-ministry
    `,
    version: '5.1.0',
    contact: {
      name: 'Jurexio Engineering',
      email: 'engineering@jurexio.com',
      url: 'https://jurexio.com',
    },
    license: { name: 'Proprietary' },
  },
  servers: [
    { url: '/api', description: 'NV Core SDK API' },
  ],
  components: {
    securitySchemes: {
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'JWT token from /auth/login',
      },
      interServiceAuth: {
        type: 'apiKey',
        in: 'header',
        name: 'X-NSP-Inter-Secret',
        description: 'Inter-service secret for platform-to-platform calls',
      },
    },
    schemas: {
      OrchestrateRequest: {
        type: 'object',
        required: ['agentKey', 'prompt'],
        properties: {
          agentKey: {
            type: 'string',
            description: 'Agent identifier from the registry',
            example: 'contract-review-specialist',
          },
          prompt: {
            type: 'string',
            description: 'The legal question or document to process',
            example: 'Review this NDA for risks: [paste document text]',
          },
          userPrompt: {
            type: 'string',
            description: 'Alias for prompt (both fields accepted)',
          },
          systemPrompt: {
            type: 'string',
            description: 'Override system prompt for the agent',
          },
          tier: {
            type: 'string',
            enum: ['free', 'solo', 'plus', 'pro', 'enterprise', 'government', 'internal'],
            default: 'pro',
          },
          jurisdiction: {
            type: 'string',
            example: 'IN',
            description: 'ISO jurisdiction code',
          },
          matterId: {
            type: 'number',
            description: 'NSP Matter ID for memory context',
          },
          orgId: {
            type: 'number',
            description: 'Organisation ID for scoped memory',
          },
          useRAG: {
            type: 'boolean',
            description: 'Enable RAG retrieval from legal corpus',
            default: false,
          },
          stream: {
            type: 'boolean',
            description: 'Stream response via SSE',
            default: false,
          },
        },
      },
      OrchestrateResponse: {
        type: 'object',
        properties: {
          success: { type: 'boolean' },
          data: {
            type: 'object',
            properties: {
              content: {
                type: 'string',
                description: 'AI-generated JSON string (parse with JSON.parse)',
              },
              agentKey: { type: 'string' },
              model: { type: 'string', example: 'gpt-4.1' },
              tokensUsed: { type: 'number' },
              processingTimeMs: { type: 'number' },
              tier: { type: 'string' },
            },
          },
        },
      },
      ApiKeyResponse: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
          key: { type: 'string', description: 'Only shown once on creation' },
          platform: { type: 'string', enum: ['jurexio-citizen', 'nys-professional', 'nys-institutional', 'nys-academy', 'nys-ministry'] },
          tier: { type: 'string' },
          requestsThisMonth: { type: 'number' },
          lastUsedAt: { type: 'string', format: 'date-time' },
          createdAt: { type: 'string', format: 'date-time' },
        },
      },
      HealthResponse: {
        type: 'object',
        properties: {
          status: { type: 'string', enum: ['healthy', 'degraded', 'unhealthy'] },
          timestamp: { type: 'string', format: 'date-time' },
          version: { type: 'string' },
          uptime: { type: 'number', description: 'Uptime in seconds' },
          services: {
            type: 'object',
            properties: {
              database: { type: 'object', properties: { status: { type: 'string' }, latencyMs: { type: 'number' } } },
              redis: { type: 'object', properties: { status: { type: 'string' }, latencyMs: { type: 'number' } } },
              llm: { type: 'object', properties: { status: { type: 'string' }, provider: { type: 'string' } } },
              nspPlatform: { type: 'object', properties: { status: { type: 'string' } } },
            },
          },
        },
      },
      ErrorResponse: {
        type: 'object',
        properties: {
          success: { type: 'boolean', example: false },
          error: { type: 'string' },
          code: { type: 'string' },
        },
      },
    },
  },
  security: [{ bearerAuth: [] }],
  paths: {
    '/nv/orchestrate': {
      post: {
        summary: 'Orchestrate an AI legal agent',
        description: 'Core endpoint — runs any of the 164 active legal agents through the full 10-step safety pipeline.',
        tags: ['AI Orchestration'],
        security: [{ bearerAuth: [] }, { interServiceAuth: [] }],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/OrchestrateRequest' } } },
        },
        responses: {
          200: { description: 'AI response', content: { 'application/json': { schema: { $ref: '#/components/schemas/OrchestrateResponse' } } } },
          400: { description: 'Bad request', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
          429: { description: 'Rate limit exceeded' },
          500: { description: 'Server error' },
        },
      },
    },
    '/nv/stream': {
      post: {
        summary: 'Stream AI agent response via SSE',
        description: 'Same as /orchestrate but streams tokens via Server-Sent Events.',
        tags: ['AI Orchestration'],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/OrchestrateRequest' } } },
        },
        responses: {
          200: {
            description: 'SSE stream of tokens',
            content: { 'text/event-stream': { schema: { type: 'string', description: 'data: {token: "..."}\n\ndata: [DONE]' } } },
          },
        },
      },
    },
    '/nv/api-keys': {
      get: {
        summary: 'List SDK API keys for the authenticated organisation',
        tags: ['API Keys'],
        responses: {
          200: {
            description: 'List of API keys',
            content: { 'application/json': { schema: { type: 'object', properties: { success: { type: 'boolean' }, data: { type: 'array', items: { $ref: '#/components/schemas/ApiKeyResponse' } } } } } },
          },
        },
      },
      post: {
        summary: 'Create a new SDK API key',
        tags: ['API Keys'],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['name', 'platform'],
                properties: {
                  name: { type: 'string', example: 'NSP Production Key' },
                  platform: { type: 'string', enum: ['jurexio-citizen', 'nys-professional', 'nys-institutional', 'nys-academy', 'nys-ministry'] },
                  tier: { type: 'string', enum: ['free', 'solo', 'plus', 'pro', 'enterprise', 'government', 'internal'], default: 'pro' },
                  rateLimitPerMinute: { type: 'number', default: 200 },
                },
              },
            },
          },
        },
        responses: {
          201: {
            description: 'API key created — key field only shown once',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ApiKeyResponse' } } },
          },
        },
      },
    },
    '/nv/api-keys/{id}': {
      delete: {
        summary: 'Revoke an API key',
        tags: ['API Keys'],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          200: { description: 'Key revoked' },
          404: { description: 'Key not found' },
        },
      },
    },
    '/health': {
      get: {
        summary: 'Basic health check',
        tags: ['System'],
        security: [],
        responses: {
          200: { description: 'System healthy', content: { 'application/json': { schema: { $ref: '#/components/schemas/HealthResponse' } } } },
          503: { description: 'System unhealthy' },
        },
      },
    },
    '/health/full': {
      get: {
        summary: 'Full health check including all sub-services',
        description: 'Checks NV Core, NSP API, NSI API, database, Redis, and LLM providers.',
        tags: ['System'],
        security: [],
        responses: {
          200: { description: 'All services healthy' },
          503: { description: 'One or more services degraded' },
        },
      },
    },
    '/nv/agents': {
      get: {
        summary: 'List all available legal agents',
        description: 'Returns the 164 active legal agents (per jurisdiction) across 9 practice areas.',
        tags: ['Agents'],
        parameters: [
          { name: 'practice_area', in: 'query', schema: { type: 'string' }, description: 'Filter by practice area' },
          { name: 'jurisdiction', in: 'query', schema: { type: 'string' }, description: 'Filter by jurisdiction (IN, UAE, SG)' },
          { name: 'tier', in: 'query', schema: { type: 'string' }, description: 'Filter by minimum tier required' },
        ],
        responses: {
          200: {
            description: 'Agent registry',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean' },
                    data: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: {
                          key: { type: 'string' },
                          name: { type: 'string' },
                          description: { type: 'string' },
                          practiceAreas: { type: 'array', items: { type: 'string' } },
                          jurisdiction: { type: 'string' },
                          tier: { type: 'string' },
                          inputSchema: { type: 'object' },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  },
  tags: [
    { name: 'AI Orchestration', description: 'Core AI orchestration and streaming endpoints' },
    { name: 'Agents', description: 'Legal agent registry and management' },
    { name: 'API Keys', description: 'SDK API key management for platform clients' },
    { name: 'System', description: 'Health checks and system monitoring' },
  ],
};

// ─── Published spec = full generated path set + curated rich overlay ─────────
//
// The release-readiness assessment (2026-06) flagged that the docs surface
// published only the 7 hand-curated paths while the platform exposes 100+.
// Root cause: this router served the hand-rolled `curatedSpec` directly, and
// /api/jrx/openapi.json 308-redirects here, so the comprehensive generated spec
// (docs/openapi/jurexio-v5.openapi.json, ~1.3k paths) was shadowed.
//
// Fix: serve the generated spec as the BASE (complete coverage) and deep-merge
// the curated paths/components ON TOP so the key endpoints keep their rich
// request/response schemas. Cached with an mtime check so a regenerated spec is
// picked up without a restart; falls back to the curated spec when the
// generated file is absent (fresh checkout / CI).
let _cache: { spec: unknown; mtimeMs: number } | null = null;

function loadGeneratedSpec(): any | null {
  try {
    if (fs.existsSync(GENERATED_SPEC_PATH)) {
      return JSON.parse(fs.readFileSync(GENERATED_SPEC_PATH, 'utf8'));
    }
  } catch {
    /* fall through to curated-only */
  }
  return null;
}

function buildPublishedSpec(): unknown {
  let mtimeMs = 0;
  try {
    mtimeMs = fs.existsSync(GENERATED_SPEC_PATH) ? fs.statSync(GENERATED_SPEC_PATH).mtimeMs : 0;
  } catch {
    mtimeMs = 0;
  }
  if (_cache && _cache.mtimeMs === mtimeMs) return _cache.spec;

  const generated = loadGeneratedSpec();
  let spec: unknown;
  if (!generated || !generated.paths) {
    // No generated spec available — serve the curated 7-path spec as-is.
    spec = curatedSpec;
  } else {
    const mergedPaths: Record<string, any> = { ...generated.paths };
    // Curated paths win (richer schemas), merged per-method onto generated stubs.
    for (const [p, ops] of Object.entries(curatedSpec.paths as Record<string, any>)) {
      mergedPaths[p] = { ...(mergedPaths[p] || {}), ...ops };
    }
    spec = {
      ...generated,
      // Curated info/branding (corrected 5.1.x facts) is the source of truth.
      info: curatedSpec.info,
      tags: curatedSpec.tags,
      security: curatedSpec.security,
      components: {
        ...(generated.components || {}),
        ...curatedSpec.components,
        securitySchemes: {
          ...((generated.components && generated.components.securitySchemes) || {}),
          ...curatedSpec.components.securitySchemes,
        },
        schemas: {
          ...((generated.components && generated.components.schemas) || {}),
          ...curatedSpec.components.schemas,
        },
      },
      paths: mergedPaths,
      'x-curated-paths': Object.keys(curatedSpec.paths),
    };
  }
  _cache = { spec, mtimeMs };
  return spec;
}

router.get('/swagger.json', (_req: Request, res: Response) => {
  res.setHeader('Content-Type', 'application/json');
  res.json(buildPublishedSpec());
});

// ─── JRX-NS-008 (2026-05-01) — canonical OpenAPI publish endpoint ───────────
//
// Partner SDKs and external code-gen tools (openapi-typescript, prism,
// stoplight studio, …) expect the spec at /openapi.json or /openapi.yaml.
// This alias serves the existing hand-rolled spec at the canonical path
// without any new dependencies.
//
// MIGRATION PLAN to a fully zod-derived spec (queued post-GA, JRX-NS-008):
//   1. Install @asteasolutions/zod-to-openapi (deferred — touches lockfile
//      and SDK lockdown is in effect until 2026-05-15).
//   2. Re-export each existing zod schema (src/schemas/*.ts) wrapped in
//      OpenAPIRegistry.register*().
//   3. Generate the spec at boot via OpenApiGeneratorV3 and replace
//      `swaggerSpec` above with the generated object.
//   4. Stand up a vitest contract suite that asserts every route in the
//      Express router has a matching openapi path.
//
// Until then, this endpoint serves the manually-curated spec which is the
// single source of truth — keep it updated when adding/removing routes.
router.get('/openapi.json', (_req: Request, res: Response) => {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'public, max-age=300');
  res.json(buildPublishedSpec());
});

router.get('/openapi.yaml', (_req: Request, res: Response) => {
  // Minimal YAML serializer for top-level fields. Clients that need full
  // YAML fidelity should fetch openapi.json and convert client-side.
  res.setHeader('Content-Type', 'application/yaml');
  res.setHeader('Cache-Control', 'public, max-age=300');
  res.send(`# Jurexio Enterprise Platform SDK OpenAPI spec (full path set + curated overlay)\n# JSON form: /api/jrx/docs/openapi.json\n${JSON.stringify(buildPublishedSpec(), null, 2)}\n`);
});

router.get('/', (_req: Request, res: Response) => {
  res.setHeader('Content-Type', 'text/html');
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Jurexio Enterprise Platform SDK — API Documentation</title>
  <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5.11.0/swagger-ui.css">
  <style>
    body { margin: 0; background: #0b3159; }
    .swagger-ui .topbar { background: #0b3159 !important; padding: 12px 20px; }
    .swagger-ui .topbar .download-url-wrapper { display: none; }
    .swagger-ui .topbar-wrapper a .link { display: none; }
    .swagger-ui .topbar-wrapper::before {
      content: "Jurexio Enterprise Platform SDK — Legal AI Documentation";
      color: #e5cb63; font-size: 20px; font-weight: 700; font-family: Georgia, serif;
    }
    .swagger-ui .info .title { color: #0b3159; }
    .swagger-ui .btn.authorize { background: #0b3159; border-color: #0b3159; color: white; }
    .swagger-ui .opblock.opblock-post .opblock-summary { background: rgba(11,49,89,0.07); }
    .swagger-ui .opblock.opblock-get .opblock-summary { background: rgba(39,174,96,0.07); }
  </style>
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://unpkg.com/swagger-ui-dist@5.11.0/swagger-ui-bundle.js"></script>
  <script>
    SwaggerUIBundle({
      url: '/api/jrx/docs/swagger.json',
      dom_id: '#swagger-ui',
      deepLinking: true,
      presets: [SwaggerUIBundle.presets.apis, SwaggerUIBundle.SwaggerUIStandalonePreset],
      layout: 'BaseLayout',
      persistAuthorization: true,
      displayRequestDuration: true,
      tryItOutEnabled: true,
      requestSnippetsEnabled: true,
      defaultModelsExpandDepth: 2,
      defaultModelExpandDepth: 2,
    });
  </script>
</body>
</html>`);
});

export default router;
