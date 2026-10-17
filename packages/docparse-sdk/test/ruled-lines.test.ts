import { describe, it, expect } from "vitest";
import { mergeTableDetections } from "../src/layout/ruled-lines.js";
import type { Table } from "../src/types.js";

describe("ruled-lines Phase 1B", () => {
  it("mergeTableDetections dedupes by page y proximity", () => {
    const projection: Table[] = [{
      bbox: { x: 0, y: 10, w: 100, h: 40 },
      rows: 3,
      cols: 3,
      method: "PROJECTION",
      conf: 0.7,
      cells: [],
    }];
    const ruled: Table[] = [{
      bbox: { x: 0, y: 11, w: 100, h: 40 },
      rows: 3,
      cols: 3,
      method: "RULED",
      conf: 0.82,
      cells: [],
    }];
    const merged = mergeTableDetections(projection, ruled);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.method).toBe("RULED");
  });
});
