/**
 * NV-NYS-DC-NATIONAL-001 — focused rebuild of just `ingest-rds.mjs`.
 *
 * The full `build.mjs` needs the `esbuild-plugin-pino` transport plugin (not
 * resolvable in this workspace layout). For the DC-national scope change we only
 * need the one CLI entry, so bundle it directly and externalise pino (it resolves
 * from the host's /opt/nyv/api/node_modules at runtime, same as every other
 * external). Output matches the deployed artifact name.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { build as esbuild } from "esbuild";

globalThis.require = createRequire(import.meta.url);
const artifactDir = path.dirname(fileURLToPath(import.meta.url));

await esbuild({
  entryPoints: [path.resolve(artifactDir, "src/ingest-rds.ts")],
  platform: "node",
  bundle: true,
  format: "esm",
  outfile: path.resolve(artifactDir, "dist/ingest-rds.mjs"),
  logLevel: "info",
  sourcemap: "linked",
  external: [
    "*.node",
    "pg",
    "pg-native",
    "@aws-sdk/*",
    "aws-sdk",
    "hyparquet",
    // NB: pino is NOT externalised — the host has no top-level `pino` (the full
    // build bundles it via a transport plugin). We bundle plain pino here; the
    // pino-pretty transport branch only runs when NODE_ENV!=='production', and
    // the caselaw-worker runs production, so no worker transport is needed.
  ],
  banner: {
    js: `import { createRequire as __bannerCrReq } from 'node:module';
import __bannerPath from 'node:path';
import __bannerUrl from 'node:url';
globalThis.require = __bannerCrReq(import.meta.url);
globalThis.__filename = __bannerUrl.fileURLToPath(import.meta.url);
globalThis.__dirname = __bannerPath.dirname(globalThis.__filename);
`,
  },
});
console.log("built dist/ingest-rds.mjs (DC national scope)");
