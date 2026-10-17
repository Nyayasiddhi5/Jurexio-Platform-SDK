/**
 * nv-openapi-routes.ts — serves the auto-generated OpenAPI 3.1 spec
 * (produced by `scripts/generate-openapi-spec.ts`) plus a Swagger UI
 * shell that loads it.
 *
 * Endpoints:
 *   GET /api/jrx/openapi.json        → raw OpenAPI JSON
 *   GET /api/jrx/docs/swagger        → Swagger UI HTML (CDN-loaded)
 *
 * The route handler reads the JSON lazily on each request so a re-run of
 * the generator is picked up without a server restart. Falls back to a
 * stub spec when the file is missing (CI / fresh checkout).
 */

import { Router, Request, Response } from 'express';
import * as fs from 'node:fs';
import * as path from 'node:path';

const router = Router();

const SPEC_PATH = path.resolve(process.cwd(), 'docs', 'openapi', 'nyayavigya-v5.openapi.json');

function loadSpec(): unknown {
  try {
    if (fs.existsSync(SPEC_PATH)) {
      return JSON.parse(fs.readFileSync(SPEC_PATH, 'utf8'));
    }
  } catch {
    /* fall through */
  }
  return {
    openapi: '3.1.0',
    info: {
      title: 'Jurexio Enterprise Platform API',
      version: '5.0.1',
      description:
        'OpenAPI spec not yet generated. Run `npx tsx scripts/generate-openapi-spec.ts` to produce it.',
    },
    paths: {},
  };
}

router.get('/openapi.json', (_req: Request, res: Response) => {
  res.type('application/json').send(loadSpec());
});

router.get('/docs/swagger', (_req: Request, res: Response) => {
  res.type('html').send(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Jurexio API — Swagger UI</title>
  <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css" />
  <style>body{margin:0;background:#fafafa}</style>
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js" crossorigin></script>
  <script>
    window.addEventListener('load', () => {
      window.ui = SwaggerUIBundle({
        url: '/api/jrx/openapi.json',
        dom_id: '#swagger-ui',
        deepLinking: true,
        presets: [SwaggerUIBundle.presets.apis],
        layout: 'BaseLayout',
      });
    });
  </script>
</body>
</html>`);
});

export default router;
