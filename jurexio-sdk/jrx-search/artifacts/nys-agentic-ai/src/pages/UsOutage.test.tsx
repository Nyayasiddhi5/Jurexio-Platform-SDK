import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import CaselawSearch from "./CaselawSearch";
import CitationCheck from "./CitationCheck";
import { JurisdictionProvider } from "@/lib/jurisdiction";

const OUTAGE_MESSAGE = "CourtListener timed out. Try again shortly.";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockImplementation(async (input) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (url.includes("/caselaw/stats")) {
      return jsonResponse({ sources: [] });
    }
    if (url.includes("/caselaw/search")) {
      return jsonResponse({ error: OUTAGE_MESSAGE }, 502);
    }
    if (url.includes("/caselaw/verify-citation")) {
      return jsonResponse({
        status: "uncertain",
        matches: [],
        note: "The US live source was unavailable — could not confirm or rule out this citation.",
      });
    }
    throw new Error(`Unexpected fetch in test: ${url}`);
  });
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.unstubAllGlobals();
  fetchMock.mockReset();
});

function renderPage(ui: React.ReactElement) {
  localStorage.setItem("nys.jurisdiction", "US");
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <JurisdictionProvider>{ui}</JurisdictionProvider>
    </QueryClientProvider>,
  );
}

describe("CaselawSearch with the US source down (API returns 502)", () => {
  it("shows the server's outage message prominently instead of an empty result list", async () => {
    renderPage(<CaselawSearch />);

    const input = screen.getByPlaceholderText(/adverse possession/i);
    fireEvent.change(input, { target: { value: "miranda rights" } });
    fireEvent.click(screen.getByRole("button", { name: /^Search$/i }));

    await waitFor(() => {
      expect(screen.getByText(OUTAGE_MESSAGE)).toBeTruthy();
    });
    expect(screen.getByText(/Live source unavailable/i)).toBeTruthy();
    // Must NOT render as an empty/zero result list
    expect(screen.queryByText(/0 matching documents/i)).toBeNull();
    expect(screen.queryByText(/No matching judgments found/i)).toBeNull();
  });
});

describe("CitationCheck with the US source down", () => {
  it("shows the 'uncertain' status and its note clearly", async () => {
    renderPage(<CitationCheck />);

    const input = screen.getByPlaceholderText(/Kesavananda/i);
    fireEvent.change(input, { target: { value: "384 U.S. 436" } });
    fireEvent.click(screen.getByRole("button", { name: /Verify/i }));

    await waitFor(() => {
      expect(screen.getByText(/^uncertain$/i)).toBeTruthy();
    });
    expect(
      screen.getByText(/US live source was unavailable/i),
    ).toBeTruthy();
  });

  it("surfaces the server error message when verification itself fails with 502", async () => {
    fetchMock.mockImplementation(async (input) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url.includes("/caselaw/verify-citation")) {
        return jsonResponse({ error: OUTAGE_MESSAGE }, 502);
      }
      return jsonResponse({ sources: [] });
    });

    renderPage(<CitationCheck />);

    const input = screen.getByPlaceholderText(/Kesavananda/i);
    fireEvent.change(input, { target: { value: "384 U.S. 436" } });
    fireEvent.click(screen.getByRole("button", { name: /Verify/i }));

    await waitFor(() => {
      expect(screen.getByText(/Verification failed/i)).toBeTruthy();
    });
    expect(screen.getByText(OUTAGE_MESSAGE)).toBeTruthy();
  });
});
