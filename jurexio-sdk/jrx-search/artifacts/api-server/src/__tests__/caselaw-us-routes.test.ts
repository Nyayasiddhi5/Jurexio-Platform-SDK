/**
 * Route-level tests for the US caselaw path (live CourtListener v4 via
 * searchUsCaselaw), pinning the honest-error contract:
 *   - successful upstream search → results mapped correctly (200)
 *   - upstream 5xx → HTTP 502 with an explicit error message
 *   - network failure / timeout → HTTP 502 with an explicit error message
 *   - verify-citation with jurisdiction=ALL while the US source is down →
 *     status "uncertain" (never a silent "not_found")
 *
 * The CourtListener HTTP call is mocked at the global fetch level so
 * searchUsCaselaw's real parsing + error-mapping code runs end to end
 * through the Express routes (pattern of caselaw-search-routes.test.ts).
 */
import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import request from "supertest";

const { default: app } = await import("../app");

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

afterAll(() => {
  vi.unstubAllGlobals();
});

beforeEach(() => {
  fetchMock.mockReset();
});

const CL_RESULT = {
  count: 2,
  results: [
    {
      caseName: "Miranda v. Arizona",
      court: "Supreme Court of the United States",
      dateFiled: "1966-06-13",
      citation: ["384 U.S. 436", "86 S. Ct. 1602"],
      judge: "Warren",
      absolute_url: "/opinion/107252/miranda-v-arizona/",
      snippet: "custodial <mark>interrogation</mark> warnings",
    },
    {
      caseName: "Terry v. Ohio",
      court: "Supreme Court of the United States",
      dateFiled: "1968-06-10",
      citation: [],
      judge: null,
      absolute_url: null,
      snippet: null,
    },
  ],
};

function okResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

describe("GET /api/caselaw/search (US)", () => {
  it("maps a successful CourtListener response correctly", async () => {
    fetchMock.mockResolvedValueOnce(okResponse(CL_RESULT));

    const res = await request(app).get(
      "/api/caselaw/search?jurisdiction=US&q=miranda",
    );
    expect(res.status).toBe(200);
    expect(res.body.jurisdiction).toBe("US");
    expect(res.body.total).toBe(2);
    expect(res.body.results).toHaveLength(2);

    const [first, second] = res.body.results;
    expect(first.title).toBe("Miranda v. Arizona");
    expect(first.jurisdiction).toBe("US");
    expect(first.source).toBe("courtlistener");
    expect(first.citation).toBe("384 U.S. 436; 86 S. Ct. 1602");
    expect(first.judges).toBe("Warren");
    expect(first.decisionDate).toBe("1966-06-13");
    expect(first.year).toBe(1966);
    expect(first.url).toBe(
      "https://www.courtlistener.com/opinion/107252/miranda-v-arizona/",
    );
    // HTML tags stripped from the snippet
    expect(first.description).toBe("custodial interrogation warnings");

    expect(second.title).toBe("Terry v. Ohio");
    expect(second.citation).toBeNull();
    expect(second.url).toBeNull();

    // The upstream request actually went to CourtListener v4 search
    const calledUrl = String(fetchMock.mock.calls[0][0]);
    expect(calledUrl).toContain(
      "https://www.courtlistener.com/api/rest/v4/search/",
    );
    expect(calledUrl).toContain("q=miranda");
  });

  it("returns 502 with an explicit error when CourtListener responds 5xx", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response("upstream exploded", { status: 503 }),
    );

    const res = await request(app).get(
      "/api/caselaw/search?jurisdiction=US&q=miranda",
    );
    expect(res.status).toBe(502);
    expect(res.body.error).toBe(
      "CourtListener search failed with status 503.",
    );
    // Never a silent empty result
    expect(res.body).not.toHaveProperty("results");
  });

  it("returns 502 with an explicit error on a network failure", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("fetch failed"));

    const res = await request(app).get(
      "/api/caselaw/search?jurisdiction=US&q=miranda",
    );
    expect(res.status).toBe(502);
    expect(res.body.error).toBe(
      "Could not reach CourtListener. Try again shortly.",
    );
    expect(res.body).not.toHaveProperty("results");
  });

  it("returns 502 with a timeout-specific message when the request times out", async () => {
    const timeoutErr = new Error("The operation was aborted due to timeout");
    timeoutErr.name = "TimeoutError";
    fetchMock.mockRejectedValueOnce(timeoutErr);

    const res = await request(app).get(
      "/api/caselaw/search?jurisdiction=US&q=miranda",
    );
    expect(res.status).toBe(502);
    expect(res.body.error).toBe("CourtListener timed out. Try again shortly.");
  });

  it("returns 502 with a token hint when CourtListener responds 401/403", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response("forbidden", { status: 403 }),
    );

    const res = await request(app).get(
      "/api/caselaw/search?jurisdiction=US&q=miranda",
    );
    expect(res.status).toBe(502);
    expect(res.body.error).toContain("COURTLISTENER_API_TOKEN");
  });
});

describe("POST /api/caselaw/verify-citation with the US source down", () => {
  it("returns status 'uncertain' (not 'not_found') for jurisdiction=ALL when CourtListener is unreachable", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("fetch failed"));

    const res = await request(app)
      .post("/api/caselaw/verify-citation")
      .send({
        citation: "zzqx unmatchable fixture citation 999",
        jurisdiction: "ALL",
      });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("uncertain");
    expect(res.body.matches).toEqual([]);
    expect(res.body.note).toContain("US live source was unavailable");
  });

  it("returns status 'uncertain' for jurisdiction=US when CourtListener responds 5xx", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response("upstream exploded", { status: 500 }),
    );

    const res = await request(app)
      .post("/api/caselaw/verify-citation")
      .send({
        citation: "zzqx unmatchable fixture citation 999",
        jurisdiction: "US",
      });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("uncertain");
    expect(res.body.matches).toEqual([]);
  });

  it("returns 'verified' when the US source is up and matches the citation", async () => {
    fetchMock.mockResolvedValueOnce(okResponse(CL_RESULT));

    const res = await request(app)
      .post("/api/caselaw/verify-citation")
      .send({ citation: "384 U.S. 436", jurisdiction: "US" });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("verified");
    expect(res.body.matches.length).toBeGreaterThan(0);
  });
});
