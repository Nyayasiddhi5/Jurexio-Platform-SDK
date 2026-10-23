/**
 * Console fallback constants — mirror `src/constants/jrx-registry-stats.ts`.
 * Prefer live `/api/jrx/health` or `/api/jrx/health/full` when available.
 */
export const JRX_REGISTRY_RUNTIME = {
  registryVersion: '5.1.0',
  totalAgents: 164,
  practiceAreas: 9,
  mcpTools: 502,
  mcpCategories: 26,
  topologyCatalog: 107,
  archivedBackupAgents: 1042,
} as const;

export const JRX_PLATFORM_SDK_LABEL =
  `Jurexio Legal SDK v${JRX_REGISTRY_RUNTIME.registryVersion}`;

export const JRX_PLATFORM_LABEL =
  `Jurexio Enterprise Platform v${JRX_REGISTRY_RUNTIME.registryVersion}`;
