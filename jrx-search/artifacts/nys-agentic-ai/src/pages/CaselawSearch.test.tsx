import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import CaselawSearch from "./CaselawSearch";
import { JurisdictionProvider, type Jurisdiction } from "@/lib/jurisdiction";

const RESERVED: Jurisdiction[] = ["GCC", "UK", "EU", "SG"];

function renderWithJurisdiction(jurisdiction: Jurisdiction) {
  localStorage.setItem("nys.jurisdiction", jurisdiction);
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, enabled: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <JurisdictionProvider>
        <CaselawSearch />
      </JurisdictionProvider>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe("CaselawSearch with reserved jurisdictions", () => {
  for (const j of RESERVED) {
    it(`shows the coming-soon panel for ${j} instead of the search UI`, () => {
      renderWithJurisdiction(j);
      expect(screen.getByText(/Coming soon/i)).toBeTruthy();
      expect(
        screen.getByText(/is on our roadmap/i),
      ).toBeTruthy();
      expect(screen.queryByPlaceholderText(/anticipatory bail/i)).toBeNull();
      expect(screen.getByText(/Switch to India/i)).toBeTruthy();
      expect(screen.getByText(/Switch to United States/i)).toBeTruthy();
    });
  }

  it("recovers to the live search UI when switching back to India", () => {
    renderWithJurisdiction("UK");
    fireEvent.click(screen.getByText(/Switch to India/i));
    expect(screen.queryByText(/Coming soon/i)).toBeNull();
    expect(
      screen.getByPlaceholderText(/anticipatory bail/i),
    ).toBeTruthy();
  });

  it("shows the normal search UI for live jurisdiction IN", () => {
    renderWithJurisdiction("IN");
    expect(screen.queryByText(/Coming soon/i)).toBeNull();
    expect(
      screen.getByPlaceholderText(/anticipatory bail/i),
    ).toBeTruthy();
  });
});
