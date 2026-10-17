import { describe, it, expect } from "vitest";
import { resolveLocale, localeSystemHint } from "../lib/localeHint";

describe("localeHint", () => {
  it("prefers locale over language alias", () => {
    expect(resolveLocale({ locale: "hi-IN", language: "en-US" })).toBe("hi-IN");
  });

  it("accepts language when locale omitted", () => {
    expect(resolveLocale({ language: "en-IN" })).toBe("en-IN");
  });

  it("returns undefined for empty values", () => {
    expect(resolveLocale({ locale: "  ", language: "" })).toBeUndefined();
  });

  it("appends a pass-through hint without claiming a translation engine", () => {
    const hint = localeSystemHint("hi-IN");
    expect(hint).toContain("hi-IN");
    expect(hint.toLowerCase()).toContain("no separate translation engine");
  });

  it("returns empty string when locale unset", () => {
    expect(localeSystemHint(undefined)).toBe("");
  });
});
