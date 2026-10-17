import { describe, expect, it } from "vitest";
import {
  buildCaseCreateProfile,
  buildFieldManifest,
  extractPoliceStationFromText,
  hearingsToTimeline,
  caseDetailsNeedsColdPath,
} from "../lib/cnrCaseCreate";

describe("cnrCaseCreate", () => {
  it("maps HC hearing JSON to timeline rows", () => {
    const timeline = hearingsToTimeline(
      [
        {
          hearing_date: "15-01-2024",
          purpose: "Arguments",
          judge: "Hon'ble Justice A. B. Singh",
          status: "Heard",
        },
      ],
      "opendata_hc_case_details",
    );
    expect(timeline).toHaveLength(1);
    expect(timeline[0]?.date).toBe("2024-01-15");
    expect(timeline[0]?.purpose).toBe("Arguments");
  });

  it("builds case create profile with clients and manifest", () => {
    const profile = buildCaseCreateProfile({
      cnr: "RJHC010324382023",
      source: "nys_rds",
      detailsSource: "opendata_hc_case_details",
      row: {
        title: "X vs State",
        petitioner: "X",
        respondent: "State of Rajasthan",
        pet_advocate: "Adv. A",
        res_advocate: "Adv. B",
        filing_date: "2023-04-12",
        case_status: "DISPOSED",
        hearings: [
          { hearing_date: "2024-01-15", purpose: "Arguments", judge: "J1" },
        ],
      },
    });
    expect(profile.header.caseTitle.value).toBe("X vs State");
    expect(profile.clients[0]?.name).toBe("X");
    expect(profile.opposingParties[0]?.name).toBe("State of Rajasthan");
    expect(profile.timeline.length).toBeGreaterThan(0);
    expect(profile.fieldManifest.complete).toContain("cnr");
    expect(profile.fieldManifest.manualRecommended).toContain("nextHearingDate");
  });

  it("detects cold path when hearings absent", () => {
    expect(caseDetailsNeedsColdPath(null)).toBe(true);
    expect(caseDetailsNeedsColdPath({ hearings: [], filing_date: "2023-01-01" })).toBe(true);
    expect(
      caseDetailsNeedsColdPath({
        hearings: [{ hearing_date: "2024-01-01", purpose: "Listed" }],
        filing_date: "2023-01-01",
        case_status: "PENDING",
      }),
    ).toBe(false);
  });

  it("extracts police station from order text", () => {
    const ps = extractPoliceStationFromText(
      "FIR registered at Banjara Hills Police Station on 12 March 2024.",
    );
    expect(ps).toMatch(/Banjara Hills Police Station/i);
  });

  it("field manifest marks missing PII as manualRecommended not complete", () => {
    const profile = buildCaseCreateProfile({
      cnr: "TESTCNR1234567890",
      source: "nys_rds",
      detailsSource: "nys_rds",
      row: { petitioner: "P", respondent: "R" },
    });
    const m = buildFieldManifest(profile);
    expect(m.manualRecommended).toContain("clientPhone");
    expect(m.missing).toContain("nextHearingDate");
  });
});
