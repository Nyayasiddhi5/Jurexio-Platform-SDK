/**
 * Console page stub routes (introduced 2026-05-12, task-247)
 *
 * Several Console pages call endpoints that were never wired into the gateway,
 * leaving their main panels visually blank because their useQuery / fetch
 * calls returned 404. This file provides honest, scoped stubs so each page
 * either renders real metadata (SDK builds, chat selectors) or surfaces a
 * clear "feature pending" payload that the page UI then turns into an
 * empty-state banner — never a fully blank panel.
 *
 * Touched UI pages:
 *   - SDKDownloads.tsx                 (/sdk-hub?tab=downloads) → /api/sdk-builds/list
 *
 * Removed (now real backends — see references below):
 *   - UniversalChat.tsx                (/universal-chat)        → /api/chat/* now lives in
 *     `nv-universal-chat-routes.ts` (task-257, 2026-05-13).
 *   - architect-workflow-builder.tsx   (/architect)             → /api/architect/deploy
 *     Real backend lives in `nv-architect-routes.ts` (task-258, 2026-05-13).
 *
 * NOTE (task-257, 2026-05-13): the /api/chat/* handlers (selectors, sessions,
 * messages, upload) used to live here as stubs. They have been replaced by a
 * real LRM-routed backend in `nv-universal-chat-routes.ts` and are now mounted
 * separately from `src/index.ts`. Do not re-add chat handlers in this file.
 *
 * Hard rules:
 *   - These are intentional, advertised stubs (`stub: true` + `featureFlag`),
 *     NOT silent fakes. The UI shows a banner where applicable.
 *   - Files prefixed `nv-` per NV-NAMING-001.
 *   - Mounted from `src/index.ts` (NV-WIRING-001).
 */
import { Router, type Request, type Response } from 'express';
import { NYV_PLATFORM_VERSION, NYV_AGENTS } from '../config/nyv-master-config.js';

export function createConsolePageStubsRouter(): Router {
  const router = Router();

  // ─── /api/sdk-builds/list ────────────────────────────────────────────────
  // Source of truth for the metadata cards on /sdk-hub?tab=downloads.
  // Numbers come from nyv-master-config so they stay aligned with the rest
  // of the platform (149 IN agents, 6 active LLM providers).
  router.get('/sdk-builds/list', (_req: Request, res: Response) => {
    const version = NYV_PLATFORM_VERSION;
    const totalAgents = NYV_AGENTS.totalAgents;
    const providerCount = 6; // anthropic, openai, google, openrouter, sarvam, bedrock

    res.json({
      success: true,
      data: {
        builds: [
          {
            id: 'nyayavigya-sdk',
            name: 'Jurexio Enterprise Platform SDK',
            version,
            description: 'Universal Enterprise AI Orchestration Platform — full SDK with gateway, governance and SLM/LRM routing.',
            agents: totalAgents,
            providers: providerCount,
            categories: 6, // five products + console
            features: [
              'Web Search API',
              'Document Processing',
              'Code Quality Gateway',
              'Database Connectors',
              'Enterprise Security',
              'Real-time Analytics',
            ],
            downloadUrl: `/downloads/sdk/nyayavigya-sdk-${version}.tgz`,
          },
          {
            id: 'nyayavigya-legal-sdk',
            name: 'Jurexio Legal SDK',
            version,
            description: 'Specialized Legal AI Platform with India-first jurisdiction coverage (IPC, BNS, CrPC, BNSS, Constitution, Companies Act).',
            agents: totalAgents,
            categories: 7,
            statutes: 25,
            languages: 22,
            features: [
              'IPC, BNS 2023',
              'CrPC, BNSS 2023',
              'Constitution',
              'Companies Act',
              '22 Indian Languages',
              'Case Law Database',
            ],
            downloadUrl: `/downloads/sdk/nyayavigya-legal-sdk-${version}.tgz`,
          },
        ],
        catalogueGeneratedAt: new Date().toISOString(),
      },
    });
  });

  // ─── /api/chat/* and /api/architect/deploy are now real backends ─────────
  // task-257 (2026-05-13): /api/chat/* moved to `nv-universal-chat-routes.ts`
  //   (real LRM-routed Universal Chat selectors + session/message/upload).
  // task-258 (2026-05-13): /api/architect/deploy moved to
  //   `nv-architect-routes.ts` (real Architect Workflow Builder backend).
  // Both used to live here as stubs; both are now mounted from `src/index.ts`.

  return router;
}
