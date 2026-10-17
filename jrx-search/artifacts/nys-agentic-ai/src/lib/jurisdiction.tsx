import { createContext, useContext, useEffect, useState } from "react";
import type { JurisdictionFilter } from "@workspace/api-client-react";

export type Jurisdiction = "ALL" | "IN" | "US" | "GCC" | "UK" | "EU" | "SG";

export type LiveJurisdiction = "IN" | "US";

export const LIVE_JURISDICTIONS: LiveJurisdiction[] = ["IN", "US"];

export const JURISDICTIONS: {
  code: Jurisdiction;
  label: string;
  flag: string;
  live: boolean;
}[] = [
  { code: "ALL", label: "Any / All jurisdictions", flag: "🌐", live: true },
  { code: "IN", label: "India", flag: "🇮🇳", live: true },
  { code: "US", label: "United States", flag: "🇺🇸", live: true },
  { code: "GCC", label: "GCC", flag: "🇦🇪", live: false },
  { code: "UK", label: "United Kingdom", flag: "🇬🇧", live: false },
  { code: "EU", label: "European Union", flag: "🇪🇺", live: false },
  { code: "SG", label: "Singapore", flag: "🇸🇬", live: false },
];

export function isLive(j: Jurisdiction): j is LiveJurisdiction | "ALL" {
  return j === "ALL" || LIVE_JURISDICTIONS.includes(j as LiveJurisdiction);
}

export function isAll(j: Jurisdiction): boolean {
  return isAllJurisdictions(j);
}

export function isAllJurisdictions(j: Jurisdiction): boolean {
  return j === "ALL";
}

export function isReserved(j: Jurisdiction): boolean {
  return j !== "ALL" && !LIVE_JURISDICTIONS.includes(j as LiveJurisdiction);
}

/** Statutes, caselaw browse, archive — need a single live corpus, not ALL. */
export function needsSingleLiveJurisdiction(j: Jurisdiction): boolean {
  return isAllJurisdictions(j) || isReserved(j);
}

/** API query param for the active sidebar selection. */
export function jurisdictionQueryParam(j: Jurisdiction): JurisdictionFilter {
  return j as JurisdictionFilter;
}

/** Pick a concrete IN/US corpus when the sidebar is ALL or reserved. */
export function concreteJurisdiction(
  j: Jurisdiction,
  prefer: LiveJurisdiction = "IN",
): LiveJurisdiction {
  if (isAllJurisdictions(j) || isReserved(j)) return prefer;
  return j as LiveJurisdiction;
}

/** Whether a catalog/run row matches the sidebar jurisdiction filter. */
export function matchesJurisdictionSelection(
  selected: Jurisdiction,
  item: { jurisdiction?: string | null },
): boolean {
  const row = item.jurisdiction ?? null;
  if (isAllJurisdictions(selected)) {
    return row === null || row === "GLOBAL" || row === "IN" || row === "US";
  }
  if (isReserved(selected)) {
    return row === "GLOBAL" || row === null;
  }
  return row === selected || row === "GLOBAL";
}

export function jurisdictionLabel(j: Jurisdiction): string {
  return JURISDICTIONS.find((x) => x.code === j)?.label ?? j;
}

export function jurisdictionBadgeLabel(code: string | null | undefined): string {
  if (!code) return "Legacy";
  if (code === "GLOBAL") return "Global";
  return code;
}

export function jurisdictionDisplayName(code: string): string {
  const info = JURISDICTIONS.find((j) => j.code === code);
  return info ? `${info.flag} ${info.label}` : code;
}

const STORAGE_KEY = "nys.jurisdiction";

type Ctx = {
  jurisdiction: Jurisdiction;
  setJurisdiction: (j: Jurisdiction) => void;
};

const JurisdictionContext = createContext<Ctx | null>(null);

function readStored(): Jurisdiction {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v && JURISDICTIONS.some((j) => j.code === v)) return v as Jurisdiction;
  } catch {
    // localStorage unavailable
  }
  return "ALL";
}

export function JurisdictionProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [jurisdiction, setJurisdictionState] = useState<Jurisdiction>(readStored);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, jurisdiction);
    } catch {
      // ignore
    }
  }, [jurisdiction]);

  return (
    <JurisdictionContext.Provider
      value={{ jurisdiction, setJurisdiction: setJurisdictionState }}
    >
      {children}
    </JurisdictionContext.Provider>
  );
}

export function useJurisdiction(): Ctx {
  const ctx = useContext(JurisdictionContext);
  if (!ctx) {
    throw new Error("useJurisdiction must be used within JurisdictionProvider");
  }
  return ctx;
}
