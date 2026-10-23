import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import Runs from "@/pages/Runs";
import { JurisdictionProvider } from "@/lib/jurisdiction";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  localStorage.setItem("nys.jurisdiction", "ALL");
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockImplementation(async (input) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (url.includes("/api/runs?jurisdiction=ALL")) {
      return jsonResponse([
        {
          id: 1,
          title: "India memo",
          category: "criminal",
          categoryName: "Criminal",
          workType: "draft",
          jurisdiction: "IN",
          status: "completed",
          createdAt: "2026-07-01T10:00:00.000Z",
        },
        {
          id: 2,
          title: "US brief",
          category: "litigation",
          categoryName: "Litigation",
          workType: "research",
          jurisdiction: "US",
          status: "completed",
          createdAt: "2026-07-02T10:00:00.000Z",
        },
      ]);
    }
    throw new Error(`Unexpected fetch: ${url}`);
  });
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.unstubAllGlobals();
  fetchMock.mockReset();
});

function renderRuns() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <JurisdictionProvider>
        <Runs />
      </JurisdictionProvider>
    </QueryClientProvider>,
  );
}

describe("Runs page jurisdiction filter", () => {
  it("requests ALL-scoped runs and shows jurisdiction badges", async () => {
    renderRuns();

    await waitFor(() => {
      expect(screen.getByText("India memo")).toBeTruthy();
    });

    expect(fetchMock.mock.calls.some(([input]) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      return url.includes("/api/runs?jurisdiction=ALL");
    })).toBe(true);

    expect(screen.getByText("IN")).toBeTruthy();
    expect(screen.getByText("US")).toBeTruthy();
  });
});
