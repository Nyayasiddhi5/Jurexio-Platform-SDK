import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import IpcBnsCompare from "./IpcBnsCompare";
import { JurisdictionProvider } from "@/lib/jurisdiction";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const ipc302 = {
  id: 10,
  code: "IPC",
  jurisdiction: "IN",
  section: "302",
  heading: "Punishment for murder",
  chapter: null,
  text: "Whoever commits murder shall be punished with death, or imprisonment for life...",
  mappedCode: "BNS",
  mappedSections: ["103"],
  changeNotes: null,
};

const bns103 = {
  id: 11,
  code: "BNS",
  jurisdiction: "IN",
  section: "103",
  heading: "Punishment for murder",
  chapter: "Chapter VI",
  text: "Whoever commits murder shall be punished with death or imprisonment for life...",
  mappedCode: "IPC",
  mappedSections: ["302"],
  changeNotes: "Renumbered from IPC 302; substance unchanged.",
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
    if (url.includes("/api/statutes/compare/ipc-bns")) {
      return jsonResponse({
        ipcSection: "302",
        found: true,
        ipc: ipc302,
        bnsMatches: [bns103],
        changeNotes: "Renumbered from IPC 302; substance unchanged.",
      });
    }
    if (url.includes("/api/statutes/compare/old-new")) {
      return jsonResponse({
        oldCode: "CrPC",
        newCode: "BNSS",
        oldSection: "438",
        found: true,
        matches: [
          {
            id: 20,
            code: "BNSS",
            jurisdiction: "IN",
            section: "482",
            heading: "Direction for grant of bail to person apprehending arrest",
            chapter: null,
            text: "When any person has reason to believe that he may be arrested...",
            mappedCode: "CrPC",
            mappedSections: ["438"],
            changeNotes: null,
          },
        ],
      });
    }
    if (url.includes("/api/statutes/compare/new-old")) {
      return jsonResponse({
        newCode: "BNS",
        oldCode: "IPC",
        newSection: "103",
        found: true,
        statute: bns103,
        oldSections: ["302"],
        matches: [ipc302],
      });
    }
    throw new Error(`Unexpected fetch in test: ${url}`);
  });
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  window.history.replaceState(null, "", "/statutes/compare");
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
        <IpcBnsCompare />
      </JurisdictionProvider>
    </QueryClientProvider>,
  );
}

describe("Comparator IPC → BNS lookup", () => {
  it("renders the mapped BNS provision side-by-side with change notes", async () => {
    renderPage();

    expect(screen.getByText(/Old → New Code Comparator/)).toBeTruthy();

    const input = screen.getByPlaceholderText(/IPC section number/i);
    fireEvent.change(input, { target: { value: "302" } });
    fireEvent.click(screen.getByRole("button", { name: /Compare/i }));

    await waitFor(() => {
      expect(screen.getByText(/IPC § 302 — Punishment for murder/)).toBeTruthy();
    });
    expect(screen.getByText(/BNS § 103 — Punishment for murder/)).toBeTruthy();
    expect(screen.getByText(/Renumbered from IPC 302/)).toBeTruthy();

    const call = fetchMock.mock.calls.map((c) => urlOf(c[0])).find((u) => u.includes("ipc-bns"));
    expect(call).toContain("section=302");
  });
});

describe("Comparator direction swap", () => {
  it("swaps to the New → Old comparator and clears prior input", async () => {
    renderPage();

    const input = screen.getByPlaceholderText(/IPC section number/i) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "302" } });

    fireEvent.click(screen.getByTestId("button-swap-direction"));

    expect(screen.getByText(/New → Old Code Comparator/)).toBeTruthy();
    // Reverse mode tabs are shown
    expect(screen.getByRole("button", { name: /BNS → IPC/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /BNSS → CrPC/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /BSA → Evidence Act/ })).toBeTruthy();
    // Input cleared and placeholder now asks for a BNS section
    const newInput = screen.getByPlaceholderText(/BNS section number/i) as HTMLInputElement;
    expect(newInput.value).toBe("");
    // No comparison request was fired by the swap itself
    expect(fetchMock.mock.calls.length).toBe(0);

    // Swap back returns to IPC → BNS
    fireEvent.click(screen.getByTestId("button-swap-direction"));
    expect(screen.getByText(/Old → New Code Comparator/)).toBeTruthy();
    expect(screen.getByPlaceholderText(/IPC section number/i)).toBeTruthy();
  });

  it("runs the reverse lookup after swapping (BNS → IPC)", async () => {
    renderPage();

    fireEvent.click(screen.getByTestId("button-swap-direction"));
    const input = screen.getByPlaceholderText(/BNS section number/i);
    fireEvent.change(input, { target: { value: "103" } });
    fireEvent.click(screen.getByRole("button", { name: /Compare/i }));

    await waitFor(() => {
      expect(screen.getByText(/IPC § 302 — Punishment for murder/)).toBeTruthy();
    });
    const call = fetchMock.mock.calls.map((c) => urlOf(c[0])).find((u) => u.includes("new-old"));
    expect(call).toContain("from=BNS");
    expect(call).toContain("section=103");
  });
});

describe("Comparator deep-link (?from=&section=)", () => {
  it("prefills and auto-runs a CrPC → BNSS lookup from the URL", async () => {
    window.history.replaceState(null, "", "/statutes/compare?from=CrPC&section=438");
    renderPage();

    expect(screen.getByText(/CrPC → BNSS/)).toBeTruthy();
    const input = screen.getByPlaceholderText(/CrPC section number/i) as HTMLInputElement;
    expect(input.value).toBe("438");

    await waitFor(() => {
      expect(screen.getByText(/BNSS § 482 — Direction for grant of bail/)).toBeTruthy();
    });
    expect(screen.getByText(/CrPC § 438/)).toBeTruthy();
    const call = fetchMock.mock.calls.map((c) => urlOf(c[0])).find((u) => u.includes("old-new"));
    expect(call).toContain("from=CrPC");
    expect(call).toContain("section=438");
  });

  it("falls back to IPC mode when ?from= is not a known code", async () => {
    window.history.replaceState(null, "", "/statutes/compare?from=BOGUS&section=302");
    renderPage();

    expect(screen.getByText(/Old → New Code Comparator/)).toBeTruthy();
    await waitFor(() => {
      expect(screen.getByText(/IPC § 302 — Punishment for murder/)).toBeTruthy();
    });
  });
});

describe("Comparator not-found handling", () => {
  it("shows the Not found card with the server message on a 404", async () => {
    fetchMock.mockImplementation(async () =>
      jsonResponse({ message: "IPC § 9999 is not in the official mapping." }, 404),
    );
    renderPage();

    const input = screen.getByPlaceholderText(/IPC section number/i);
    fireEvent.change(input, { target: { value: "9999" } });
    fireEvent.click(screen.getByRole("button", { name: /Compare/i }));

    await waitFor(() => {
      expect(screen.getByText(/Not found/)).toBeTruthy();
    });
    expect(screen.getByText(/IPC § 9999 is not in the official mapping/)).toBeTruthy();
  });
});
