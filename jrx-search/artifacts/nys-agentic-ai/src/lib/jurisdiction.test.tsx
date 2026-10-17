import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, act } from "@testing-library/react";
import {
  JurisdictionProvider,
  useJurisdiction,
  isAllJurisdictions,
  isReserved,
  isLive,
  needsSingleLiveJurisdiction,
  JURISDICTIONS,
} from "@/lib/jurisdiction";

const STORAGE_KEY = "nys.jurisdiction";

function Probe() {
  const { jurisdiction, setJurisdiction } = useJurisdiction();
  return (
    <div>
      <span data-testid="jurisdiction">{jurisdiction}</span>
      <button type="button" onClick={() => setJurisdiction("US")}>
        set-us
      </button>
    </div>
  );
}

describe("JurisdictionProvider", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    localStorage.clear();
  });

  it("defaults to ALL when nothing is stored", () => {
    render(
      <JurisdictionProvider>
        <Probe />
      </JurisdictionProvider>,
    );
    expect(screen.getByTestId("jurisdiction").textContent).toBe("ALL");
  });

  it("restores a stored selection including ALL", () => {
    localStorage.setItem(STORAGE_KEY, "ALL");
    render(
      <JurisdictionProvider>
        <Probe />
      </JurisdictionProvider>,
    );
    expect(screen.getByTestId("jurisdiction").textContent).toBe("ALL");
  });

  it("persists selection changes to localStorage", () => {
    render(
      <JurisdictionProvider>
        <Probe />
      </JurisdictionProvider>,
    );
    act(() => {
      screen.getByRole("button", { name: "set-us" }).click();
    });
    expect(localStorage.getItem(STORAGE_KEY)).toBe("US");
    expect(screen.getByTestId("jurisdiction").textContent).toBe("US");
  });

  it("lists Any / All jurisdictions first in the catalog", () => {
    expect(JURISDICTIONS[0].code).toBe("ALL");
    expect(JURISDICTIONS[0].label).toMatch(/Any \/ All/i);
  });

  it("classifies ALL as union mode, not reserved", () => {
    expect(isAllJurisdictions("ALL")).toBe(true);
    expect(isLive("ALL")).toBe(true);
    expect(isReserved("ALL")).toBe(false);
    expect(isReserved("GCC")).toBe(true);
    expect(isLive("IN")).toBe(true);
    expect(needsSingleLiveJurisdiction("ALL")).toBe(true);
  });
});
