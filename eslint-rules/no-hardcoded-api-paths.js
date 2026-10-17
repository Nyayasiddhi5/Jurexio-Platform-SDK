/**
 * eslint-rules/no-hardcoded-api-paths.js
 *
 * Custom ESLint rule that bans hardcoded `/api/jrx/...` literal strings in
 * client/src/** outside the canonical registry (`client/src/lib/jrx-api-paths.ts`).
 *
 * Why:
 *   The 2026-05-12 audit found ~30 sidebar pages calling /api/jrx/* paths that
 *   drifted from the real backend mounts, breaking ~70 pages. The new
 *   `nv-api-paths.ts` registry is the single source of truth — any new code
 *   that hardcodes a `/api/jrx/...` path will reintroduce the same drift.
 *
 *   Catches:
 *     fetch('/api/jrx/agents')
 *     useQuery({ queryKey: ['/api/jrx/admin/stats'] })
 *     const url = `/api/jrx/${id}`;
 *     <Link to="/api/jrx/foo" />
 *
 *   Allowed:
 *     - The registry file itself (`client/src/lib/jrx-api-paths.ts`)
 *     - Test files (*.test.ts, *.spec.ts)
 *     - Any path imported from the registry via `p('KEY')` or `NV_API.KEY.path`
 *
 * Wiring (canonical):
 *   - This file is loaded by ESLint via the `--rulesdir eslint-rules` CLI flag,
 *     so the rule id matches the file basename: `no-hardcoded-api-paths`.
 *   - `client/.eslintrc.json` enables it as `error` for `src/**` (excluding the
 *     registry file and `*.{test,spec}.{ts,tsx}`).
 *   - Run from `client/`: `npm run lint`  (uses `--rulesdir ../eslint-rules`).
 *   - Run from repo root: `npm run lint:client`.
 *
 * See also `eslint-rules/no-mock-data.js` (sibling rule, same author conventions).
 */

'use strict';

const HARDCODED = /\/api\/nv\//;

module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow hardcoded /api/jrx/* string literals outside client/src/lib/jrx-api-paths.ts. Import paths from the NV_API registry instead.',
      recommended: false,
    },
    schema: [],
    messages: {
      hardcoded:
        "Hardcoded API path '{{value}}' is banned. Import from 'client/src/lib/jrx-api-paths.ts' (e.g. `p('AGENTS')` or `NV_API.AGENTS.path`) so backend drift is caught at compile time.",
    },
  },
  create(context) {
    return {
      Literal(node) {
        if (typeof node.value !== 'string') return;
        if (HARDCODED.test(node.value)) {
          context.report({
            node,
            messageId: 'hardcoded',
            data: { value: node.value },
          });
        }
      },
      TemplateElement(node) {
        const raw = node.value && node.value.cooked;
        if (typeof raw !== 'string') return;
        if (HARDCODED.test(raw)) {
          context.report({
            node,
            messageId: 'hardcoded',
            data: { value: raw },
          });
        }
      },
    };
  },
};
