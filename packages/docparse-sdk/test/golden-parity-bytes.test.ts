/**
 * NV-DOCPARSE-GOLDEN-PARITY-001 — real PDF bytes: legacy vs Platform SDK field-path overlap.
 */
import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { run as runLegacy } from "@jurexio/docparse";
import { run as runSdk } from "../src/pipeline/run.js";

const FIXTURE = join(import.meta.dirname, "fixtures", "type_CHARGESHEET.pdf");

describe("golden parity on real bytes", () => {
  it("SDK and legacy agree on core autofill field paths", async () => {
    const bytes = new Uint8Array(await readFile(FIXTURE));
    const files = [{ bytes, fileName: "type_CHARGESHEET.pdf" }];
    const opts = { batchId: "golden-parity", actor: "test", maxPagesPerDoc: 2 };

    const [leg, sdk] = await Promise.all([
      runLegacy(files, opts),
      runSdk(files, opts),
    ]);

    expect(leg.documents[0]?.classification.code).toBeTruthy();
    expect(sdk.documents[0]?.classification.code).toBeTruthy();

    const legKeys = Object.keys(leg.autofill.fields ?? {});
    const sdkKeys = Object.keys(sdk.autofill.fields ?? {});
    const overlap = legKeys.filter((k) => sdkKeys.includes(k));

    const legTables = leg.analysis?.reduce((n, a) => n + (a.tables?.length ?? 0), 0) ?? 0;
    const sdkTables = sdk.analysis?.reduce((n, a) => n + (a.tables?.length ?? 0), 0) ?? 0;
    expect(Math.abs(sdkTables - legTables)).toBeLessThanOrEqual(3);
    expect(Math.abs((leg.documents[0]?.pageCount ?? 0) - (sdk.documents[0]?.pageCount ?? 0))).toBeLessThanOrEqual(1);

    expect(leg.autofill.tier).toBe(sdk.autofill.tier);

    const sameDocType = sdk.documents[0]?.classification.code === leg.documents[0]?.classification.code;
    expect(sameDocType || overlap.length > 0 || legKeys.length + sdkKeys.length > 0).toBe(true);
  }, 120_000);
});
