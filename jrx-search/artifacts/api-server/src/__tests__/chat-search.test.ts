import { describe, it, expect } from "vitest";
import { buildSnippet } from "../routes/chat";

describe("buildSnippet — chat content search excerpts", () => {
  it("centers the excerpt on the matched term with ellipses", () => {
    const content =
      "This detailed commercial lease agreement executed between the landlord party of the first part and the tenant party of the second part expressly includes an indemnity clause covering all direct and indirect damages arising from negligence or the wilful default of either party and their respective agents.";
    const snippet = buildSnippet(content, "indemnity");
    expect(snippet.toLowerCase()).toContain("indemnity");
    expect(snippet.startsWith("…")).toBe(true);
    expect(snippet.endsWith("…")).toBe(true);
  });

  it("is case-insensitive", () => {
    const snippet = buildSnippet("Discussing the ARBITRATION award here.", "arbitration");
    expect(snippet).toContain("ARBITRATION");
  });

  it("does not prepend an ellipsis when the match is at the start", () => {
    const snippet = buildSnippet("Habeas corpus petition filed today.", "Habeas");
    expect(snippet.startsWith("…")).toBe(false);
  });

  it("does not append an ellipsis when the match reaches the end", () => {
    const snippet = buildSnippet("Short text ending in bail", "bail");
    expect(snippet.endsWith("…")).toBe(false);
    expect(snippet).toContain("bail");
  });

  it("falls back to a leading slice when the term is absent", () => {
    const content = "a".repeat(500);
    const snippet = buildSnippet(content, "zzz", 50);
    expect(snippet.length).toBe(100);
  });
});
