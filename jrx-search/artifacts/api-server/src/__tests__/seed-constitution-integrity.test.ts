/**
 * Data-integrity checks for data/seed-constitution.json (Constitution of
 * India, code COI). The seed is generated from official-text sources
 * (civictech-India transcription + DoLA 2020 edition PDF for Schedules).
 * A future regeneration could silently drop articles or schedules; these
 * checks fail loudly before bad data ever reaches the database.
 *
 * Validation logic lives in src/lib/statutesIntegrity.ts and is shared with
 * the seeder pre-flight (src/seed-constitution.ts) so they can't drift.
 *
 * Run standalone via: pnpm --filter @workspace/api-server run check:constitution
 */
import { describe, it, expect } from "vitest";
import seedCoi from "../../data/seed-constitution.json";
import {
  type CoiSeedRow,
  checkCoiTotalCount,
  checkCoiCode,
  checkCoiSchedules,
  checkKeyCoiArticles,
  checkCoiShortText,
  checkDuplicates,
  checkEmptyHeadings,
  checkPlaceholderText,
  validateConstitutionSeed,
} from "../lib/statutesIntegrity";

const rows = seedCoi as unknown as CoiSeedRow[];

function expectClean(result: { name: string; errors: string[] }) {
  expect(result.errors, `${result.name}: ${result.errors.join(", ")}`).toEqual([]);
}

describe("seed-constitution.json integrity", () => {
  it("has exactly the expected total row count", () => {
    expectClean(checkCoiTotalCount(rows));
  });

  it("tags every row code=COI jurisdiction=IN", () => {
    expectClean(checkCoiCode(rows));
  });

  it("contains all 12 Schedules with substantive text", () => {
    expectClean(checkCoiSchedules(rows));
  });

  it("includes key articles (14, 21, 21A, 32, 226, 368, 370, ...)", () => {
    expectClean(checkKeyCoiArticles(rows));
  });

  it("has no empty or very short article text", () => {
    expectClean(checkCoiShortText(rows));
  });

  it("has no duplicate (code, section) pairs", () => {
    expectClean(checkDuplicates(rows));
  });

  it("has no empty headings", () => {
    expectClean(checkEmptyHeadings(rows));
  });

  it("contains no placeholder text", () => {
    expectClean(checkPlaceholderText(rows));
  });

  it("includes the Preamble and the Seventh Schedule lists", () => {
    const preamble = rows.find((r) => r.section === "PREAMBLE");
    expect(preamble?.text).toContain("SOVEREIGN SOCIALIST SECULAR DEMOCRATIC REPUBLIC");
    const sch7 = rows.find((r) => r.section === "SCH-7");
    expect(sch7?.text).toContain("List I");
    expect(sch7?.text).toContain("List III");
  });

  it("passes the full validateConstitutionSeed pre-flight used by the seeder", () => {
    const failures = validateConstitutionSeed(rows);
    expect(
      failures,
      failures.map((f) => `${f.name}: ${f.errors.join(", ")}`).join("; "),
    ).toEqual([]);
  });
});
