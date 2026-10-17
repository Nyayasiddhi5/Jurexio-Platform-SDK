import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { Markdown } from "@/components/Markdown";

afterEach(() => cleanup());

describe("Markdown internal links (chat → comparator deep links)", () => {
  it("turns internal markdown links into clickable internal anchors", () => {
    render(
      <Markdown content="BNSS 482 replaced CrPC 438.\n\n**Compare side-by-side:** [BNSS § 482 ↔ CrPC § 438](/statutes/compare?from=BNSS&section=482)" />,
    );
    const link = screen.getByText("BNSS § 482 ↔ CrPC § 438");
    expect(link.tagName).toBe("A");
    expect(link.getAttribute("data-internal-link")).toBe("true");
    expect(link.getAttribute("href")).toBe(
      "/statutes/compare?from=BNSS&section=482",
    );
  });

  it("leaves plain text and external links untouched", () => {
    const { container } = render(
      <Markdown content="See [external](https://example.com) and plain text." />,
    );
    expect(container.querySelectorAll("a").length).toBe(0);
    expect(container.textContent).toContain(
      "[external](https://example.com)",
    );
  });

  it("renders multiple internal links in order", () => {
    const { container } = render(
      <Markdown content="[A](/statutes/compare?from=BNS&section=103) then [B](/statutes/compare?from=BSA&section=63)" />,
    );
    const anchors = container.querySelectorAll("a[data-internal-link]");
    expect(anchors.length).toBe(2);
    expect(anchors[0].getAttribute("href")).toContain("from=BNS&section=103");
    expect(anchors[1].getAttribute("href")).toContain("from=BSA&section=63");
  });
});
