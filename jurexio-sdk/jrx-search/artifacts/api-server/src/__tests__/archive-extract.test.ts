/**
 * Tests for the archive extraction plane:
 *  - parseAllowedS3Path region mapping for every allowlisted bucket;
 *  - resolveArchiveObject sibling-bucket fallback (the HC estate is split
 *    across two identically-keyed buckets, so a 404 in the metadata-named
 *    bucket must retry the sibling before giving up);
 *  - POST /athena/extract input validation (rejects bad paths before any
 *    AWS call is made).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const sendMock = vi.fn();
vi.mock("@aws-sdk/client-s3", () => ({
  S3Client: class {
    send = (cmd: unknown) => sendMock(cmd);
  },
  HeadObjectCommand: class {
    input: unknown;
    constructor(input: unknown) {
      this.input = input;
    }
  },
  GetObjectCommand: class {
    input: unknown;
    constructor(input: unknown) {
      this.input = input;
    }
  },
}));

const {
  parseAllowedS3Path,
  resolveArchiveObject,
  DOCUMENT_BUCKET_REGIONS,
  HC_SIBLING_BUCKET,
  ArchiveDocNotFoundError,
  MAX_ARCHIVE_PDF_BYTES,
} = await import("../lib/archiveDocs");

const request = (await import("supertest")).default;
const { default: app } = await import("../app");

const HC_KEY = "data/pdf/year=2021/court=17_21/bench=pat/JUDG.pdf";

describe("parseAllowedS3Path region mapping", () => {
  it.each(Object.entries(DOCUMENT_BUCKET_REGIONS))(
    "maps %s to its configured region",
    (bucket, region) => {
      const parsed = parseAllowedS3Path(`s3://${bucket}/${HC_KEY}`);
      expect(parsed).toEqual({ bucket, key: HC_KEY, region });
    },
  );

  it("HC sibling map is symmetric and allowlisted", () => {
    for (const [a, b] of Object.entries(HC_SIBLING_BUCKET)) {
      expect(HC_SIBLING_BUCKET[b]).toBe(a);
      expect(DOCUMENT_BUCKET_REGIONS[a]).toBeDefined();
      expect(DOCUMENT_BUCKET_REGIONS[b]).toBeDefined();
    }
  });
});

describe("resolveArchiveObject sibling fallback", () => {
  beforeEach(() => sendMock.mockReset());

  const parsedHc = {
    bucket: "ns-highcourt-data-bucket",
    key: HC_KEY,
    region: DOCUMENT_BUCKET_REGIONS["ns-highcourt-data-bucket"]!,
  };

  it("returns the primary bucket when the object exists there", async () => {
    sendMock.mockResolvedValueOnce({ ContentLength: 12345 });
    const resolved = await resolveArchiveObject(parsedHc);
    expect(resolved).toMatchObject({
      bucket: "ns-highcourt-data-bucket",
      byteSize: 12345,
      fallbackUsed: false,
    });
    expect(sendMock).toHaveBeenCalledTimes(1);
  });

  it("falls back to the sibling HC bucket on a 404", async () => {
    sendMock
      .mockRejectedValueOnce(Object.assign(new Error("nope"), { name: "NotFound" }))
      .mockResolvedValueOnce({ ContentLength: 777 });
    const resolved = await resolveArchiveObject(parsedHc);
    expect(resolved).toMatchObject({
      bucket: "ns-indian-highcourt-judgements-2",
      region: DOCUMENT_BUCKET_REGIONS["ns-indian-highcourt-judgements-2"],
      byteSize: 777,
      fallbackUsed: true,
    });
    expect(sendMock).toHaveBeenCalledTimes(2);
  });

  it("throws not-found when both HC buckets 404", async () => {
    sendMock
      .mockRejectedValueOnce(Object.assign(new Error("nope"), { name: "NotFound" }))
      .mockRejectedValueOnce(Object.assign(new Error("nope"), { name: "NotFound" }));
    await expect(resolveArchiveObject(parsedHc)).rejects.toBeInstanceOf(
      ArchiveDocNotFoundError,
    );
    expect(sendMock).toHaveBeenCalledTimes(2);
  });

  it("does not fall back for non-HC buckets", async () => {
    sendMock.mockRejectedValueOnce(
      Object.assign(new Error("nope"), { name: "NotFound" }),
    );
    await expect(
      resolveArchiveObject({
        bucket: "usa-caselaw",
        key: "judgments/x.pdf",
        region: "ap-south-1",
      }),
    ).rejects.toBeInstanceOf(ArchiveDocNotFoundError);
    expect(sendMock).toHaveBeenCalledTimes(1);
  });
});

describe("POST /athena/extract input validation", () => {
  beforeEach(() => sendMock.mockReset());

  const badPaths = [
    "",
    "https://usa-caselaw/x.pdf",
    "s3://not-an-allowed-bucket/x.pdf",
    "s3://usa-caselaw/../secret.pdf",
    "s3://usa-caselaw/notes.txt",
    "s3://usa-caselaw/%2e%2e/x.pdf",
  ];

  it.each(badPaths)("rejects %j with 400 before any AWS call", async (s3Path) => {
    const res = await request(app)
      .post("/api/athena/extract")
      .send({ s3Path })
      .set("content-type", "application/json");
    expect(res.status).toBe(400);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("maps an archive 404 (both buckets missing) to HTTP 404", async () => {
    sendMock
      .mockRejectedValueOnce(Object.assign(new Error("nope"), { name: "NotFound" }))
      .mockRejectedValueOnce(Object.assign(new Error("nope"), { name: "NotFound" }));
    const res = await request(app)
      .post("/api/athena/extract")
      .send({ s3Path: `s3://ns-highcourt-data-bucket/${HC_KEY}` })
      .set("content-type", "application/json");
    expect(res.status).toBe(404);
  });

  it("maps an oversized PDF to HTTP 413 without downloading it", async () => {
    sendMock.mockResolvedValueOnce({
      ContentLength: MAX_ARCHIVE_PDF_BYTES + 1024,
    });
    const res = await request(app)
      .post("/api/athena/extract")
      .send({ s3Path: "s3://usa-caselaw/judgments/huge.pdf" })
      .set("content-type", "application/json");
    expect(res.status).toBe(413);
    expect(sendMock).toHaveBeenCalledTimes(1);
  });
});

/**
 * NYS-ARCHIVE-LARGE-PDF-001. Supreme Court PDFs are whole SCR reporter-volume
 * extracts, so the landmark authorities are the LARGEST objects in the estate —
 * Kesavananda Bharati is 35.8 MB / 1,006 pages and Maneka Gandhi 60.9 MB. The
 * old 20 MB cap therefore excluded exactly the most-cited judgments in Indian
 * constitutional law. These assert the cap admits the measured corpus maximum
 * (68.79 MB across all 176,997 SC PDFs) so a future "tidy up" cannot silently
 * reintroduce the hole.
 */
describe("archive extraction size cap covers landmark reporter volumes", () => {
  const MB = 1024 * 1024;

  it.each([
    ["Kesavananda Bharati (S_1973_1_1_1002_EN.pdf)", 37_514_544],
    ["Maneka Gandhi (1978_2_621_776_EN.pdf)", 63_851_267],
    ["largest object measured in the SC estate", Math.ceil(68.79 * MB)],
  ])("admits %s", (_label, byteSize) => {
    expect(byteSize).toBeLessThanOrEqual(MAX_ARCHIVE_PDF_BYTES);
  });

  it("still refuses an anomalously large object", () => {
    expect(MAX_ARCHIVE_PDF_BYTES).toBeLessThan(256 * MB);
  });
});
