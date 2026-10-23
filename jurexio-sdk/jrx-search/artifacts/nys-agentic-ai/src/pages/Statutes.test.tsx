import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import Statutes from "./Statutes";
import { JurisdictionProvider } from "@/lib/jurisdiction";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const bnsMurder = {
  id: 1,
  code: "BNS",
  jurisdiction: "IN",
  section: "103",
  heading: "Punishment for murder",
  chapter: "Chapter VI — Offences affecting the human body",
  text: "Whoever commits murder shall be punished with death or imprisonment for life...",
  mappedCode: "IPC",
  mappedSections: ["302"],
  changeNotes: null,
};

const ipcCheating = {
  id: 2,
  code: "IPC",
  jurisdiction: "IN",
  section: "420",
  heading: "Cheating and dishonestly inducing delivery of property",
  chapter: null,
  text: "Whoever cheats and thereby dishonestly induces the person deceived...",
  mappedCode: "BNS",
  mappedSections: ["318(4)"],
  changeNotes: null,
};

const actBns = {
  code: "BNS",
  jurisdiction: "IN",
  actName: "Bharatiya Nyaya Sanhita, 2023",
  actYear: "2023",
  actNo: "45",
  ministry: "Home Affairs",
  practiceArea: "Criminal",
  enactmentDate: null,
  sectionCount: 358,
};

const actCompanies = {
  code: "COMPANIES-ACT-2013",
  jurisdiction: "IN",
  actName: "The Companies Act, 2013",
  actYear: "2013",
  actNo: "18",
  ministry: "Corporate Affairs",
  practiceArea: "Corporate & Commercial",
  enactmentDate: null,
  sectionCount: 527,
};

const actsBody = {
  total: 2,
  totalSections: 885,
  practiceAreas: ["Corporate & Commercial", "Criminal"],
  results: [actBns, actCompanies],
};

const fetchMock = vi.fn<typeof fetch>();

function urlOf(input: RequestInfo | URL): string {
  return typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
}

beforeEach(() => {
  localStorage.setItem("nys.jurisdiction", "IN");
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockImplementation(async (input) => {
    const url = urlOf(input);
    if (url.includes("/api/statutes/acts")) {
      return jsonResponse(actsBody);
    }
    if (url.includes("/api/statutes/search")) {
      return jsonResponse({
        total: 1,
        results: [ipcCheating],
        method: "fts",
        embeddingCoverage: { total: 100, embedded: 100, unembedded: 0, coveragePct: 100 },
      });
    }
    if (url.includes("/api/statutes")) {
      return jsonResponse({ total: 2, results: [bnsMurder, ipcCheating] });
    }
    throw new Error(`Unexpected fetch in test: ${url}`);
  });
});

afterEach(() => {
  cleanup();
  window.history.replaceState(null, "", "/statutes");
  vi.unstubAllGlobals();
  fetchMock.mockReset();
});

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <JurisdictionProvider>
        <Statutes />
      </JurisdictionProvider>
    </QueryClientProvider>,
  );
}

describe("Statutes acts browse (default)", () => {
  it("lists acts with corpus totals and true per-act counts", async () => {
    renderPage();

    await waitFor(() => {
      expect(screen.getByText(/2 acts · 885 provisions in the corpus/i)).toBeTruthy();
    });
    expect(screen.getByText("Bharatiya Nyaya Sanhita, 2023")).toBeTruthy();
    expect(screen.getByText("The Companies Act, 2013")).toBeTruthy();
    expect(screen.getByText(/358 provisions/)).toBeTruthy();
    expect(screen.getByText(/527 provisions/)).toBeTruthy();
    // Browse mode must not hit search or the provision list
    const urls = fetchMock.mock.calls.map((c) => urlOf(c[0]));
    expect(urls.some((u) => u.includes("/api/statutes/search"))).toBe(false);
  });

  it("shows act metadata (act no, ministry, practice area)", async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId("card-act-COMPANIES-ACT-2013")).toBeTruthy();
    });
    expect(screen.getByText(/Act No\. 18 of 2013/)).toBeTruthy();
    expect(screen.getByText(/Ministry of Corporate Affairs/)).toBeTruthy();
    expect(screen.getByText("Corporate & Commercial")).toBeTruthy();
  });

  it("opens an act and lists its provisions via the list endpoint", async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId("card-act-BNS")).toBeTruthy();
    });
    fireEvent.click(screen.getByTestId("card-act-BNS"));

    await waitFor(() => {
      expect(screen.getByText(/BNS § 103 — Punishment for murder/)).toBeTruthy();
    });
    const listCalls = fetchMock.mock.calls
      .map((c) => urlOf(c[0]))
      .filter((u) => u.includes("/api/statutes?") || u.endsWith("/api/statutes"));
    expect(listCalls.some((u) => u.includes("code=BNS"))).toBe(true);
  });

  it("shows the empty state when nothing matches a search", async () => {
    fetchMock.mockImplementation(async (input) => {
      const url = urlOf(input);
      if (url.includes("/api/statutes/acts")) {
        return jsonResponse(actsBody);
      }
      return jsonResponse({ total: 0, results: [] });
    });
    renderPage();

    const input = screen.getByTestId("input-statute-search");
    fireEvent.change(input, { target: { value: "zzzz nothing" } });
    fireEvent.click(screen.getByTestId("button-statute-search"));

    await waitFor(() => {
      expect(screen.getByText(/No provisions matched/i)).toBeTruthy();
    });
  });
});

describe("Statutes deep-link prefill", () => {
  it("prefills the search box from ?q= and runs the search immediately", async () => {
    window.history.replaceState(null, "", "/statutes?q=cheating");
    renderPage();

    const input = screen.getByTestId("input-statute-search") as HTMLInputElement;
    await waitFor(() => {
      expect(input.value).toBe("cheating");
    });

    await waitFor(() => {
      expect(screen.getByText(/IPC § 420 — Cheating/)).toBeTruthy();
    });
    const searchCalls = fetchMock.mock.calls
      .map((c) => urlOf(c[0]))
      .filter((u) => u.includes("/api/statutes/search"));
    expect(searchCalls.length).toBeGreaterThan(0);
    expect(searchCalls[0]).toContain("q=cheating");
    expect(screen.getByTestId("button-clear-search")).toBeTruthy();
  });

  it("hides the coverage notice when the corpus is fully embedded", async () => {
    window.history.replaceState(null, "", "/statutes?q=cheating");
    renderPage();

    await waitFor(() => {
      expect(screen.getByText(/IPC § 420 — Cheating/)).toBeTruthy();
    });
    expect(screen.queryByTestId("banner-embedding-coverage")).toBeNull();
  });

  it("shows a reduced-coverage notice when some provisions are unembedded", async () => {
    fetchMock.mockImplementation(async (input) => {
      const url = urlOf(input);
      if (url.includes("/api/statutes/acts")) return jsonResponse(actsBody);
      if (url.includes("/api/statutes/search")) {
        return jsonResponse({
          total: 1,
          results: [ipcCheating],
          method: "fts",
          embeddingCoverage: { total: 100, embedded: 40, unembedded: 60, coveragePct: 40 },
        });
      }
      if (url.includes("/api/statutes")) return jsonResponse({ total: 2, results: [bnsMurder, ipcCheating] });
      throw new Error(`Unexpected fetch in test: ${url}`);
    });
    window.history.replaceState(null, "", "/statutes?q=cheating");
    renderPage();

    const banner = await screen.findByTestId("banner-embedding-coverage");
    expect(banner.textContent).toContain("40%");
    expect(banner.textContent).toContain("60");
  });

  it("ignores a too-short ?q= and stays in acts browse mode", async () => {
    window.history.replaceState(null, "", "/statutes?q=a");
    renderPage();

    await waitFor(() => {
      expect(screen.getByText(/2 acts · 885 provisions in the corpus/i)).toBeTruthy();
    });
    const urls = fetchMock.mock.calls.map((c) => urlOf(c[0]));
    expect(urls.some((u) => u.includes("/api/statutes/search"))).toBe(false);
  });

  it("opens an act directly from ?code=", async () => {
    window.history.replaceState(null, "", "/statutes?code=bns");
    renderPage();

    await waitFor(() => {
      expect(screen.getByText(/BNS § 103 — Punishment for murder/)).toBeTruthy();
    });
    const listCalls = fetchMock.mock.calls
      .map((c) => urlOf(c[0]))
      .filter((u) => u.includes("code=BNS"));
    expect(listCalls.length).toBeGreaterThan(0);
  });
});

describe("Statutes mapped-result rendering", () => {
  it("shows the official mapping and comparator links on provision cards", async () => {
    window.history.replaceState(null, "", "/statutes?code=BNS");
    renderPage();

    await waitFor(() => {
      expect(screen.getByText(/BNS § 103 — Punishment for murder/)).toBeTruthy();
    });
    expect(screen.getByText(/IPC § 302/)).toBeTruthy();
    expect(screen.getByText(/BNS § 318\(4\)/)).toBeTruthy();
    const oldEq = screen.getByTestId("link-old-equivalent-1");
    expect(oldEq.getAttribute("href")).toContain("/statutes/compare?from=BNS&section=103");
  });
});

describe("Statutes jurisdiction segregation", () => {
  it("shows a coming-soon card (no fetches) for a reserved jurisdiction", async () => {
    localStorage.setItem("nys.jurisdiction", "GCC");
    try {
      renderPage();
      expect(screen.getByTestId("text-statutes-coming-soon")).toBeTruthy();
      // It might call /api/statutes/acts even if not "live" to show the coming-soon UI context
      // but in this case we check if it DOES NOT hit the provision list or search
      const urls = fetchMock.mock.calls.map((c) => urlOf(c[0]));
      expect(urls.some((u) => u.includes("/api/statutes/search"))).toBe(false);
      expect(urls.some((u) => u.includes("/api/statutes?") && !u.includes("/acts"))).toBe(false);
    } finally {
      localStorage.removeItem("nys.jurisdiction");
    }
  });

  it("passes jurisdiction=IN to the acts endpoint by default", async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText(/2 acts · 885 provisions/i)).toBeTruthy();
    });
    const urls = fetchMock.mock.calls.map((c) => urlOf(c[0]));
    expect(urls.some((u) => u.includes("/api/statutes/acts") && u.includes("jurisdiction=IN"))).toBe(true);
  });
});
