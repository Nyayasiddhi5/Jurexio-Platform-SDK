#!/usr/bin/env node
/** NV-DOCPARSE-SDK-BENCH-SMOKE — positive control for Platform SDK package presence. */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "packages", "docparse-sdk");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
if (pkg.name !== "@nyv/docparse-sdk") {
  console.error("FAIL: expected @nyv/docparse-sdk");
  process.exit(1);
}
console.log("PASS docparse-sdk package", pkg.version);
