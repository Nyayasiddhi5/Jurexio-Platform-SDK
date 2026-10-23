/**
 * Adversarial tests for the Athena document presign allowlist
 * (GET /api/athena/document).
 *
 * These prove the s3Path validator cannot be tricked into presigning an
 * arbitrary bucket/key: path traversal, percent-encoding, s3:// scheme
 * confusion, lookalike bucket names, wildcard/empty/oversized keys are all
 * rejected with a 4xx before the presigner is ever reached. The single
 * positive case mocks the AWS presigner (no AWS creds in dev) and asserts a
 * legitimate allowlisted bucket + .pdf key still works unchanged.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const signMock = vi.fn(async () => "https://signed.example/doc.pdf?sig=abc");
vi.mock("@aws-sdk/s3-request-presigner", () => ({
  getSignedUrl: () => signMock(),
}));

// The document route now HeadObjects the bucket (with HC sibling fallback)
// before presigning; mock S3 so the object always "exists" (no AWS creds in dev).
const s3SendMock = vi.fn(async (_cmd: unknown) => ({ ContentLength: 1024 }));
vi.mock("@aws-sdk/client-s3", () => ({
  S3Client: class {
    send = (cmd: unknown) => s3SendMock(cmd as never);
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

const request = (await import("supertest")).default;
const { default: app } = await import("../app");

const GOOD_BUCKET = "usa-caselaw";
const GOOD_KEY = "judgments/2020/state-v-doe.pdf";
const GOOD_PATH = `s3://${GOOD_BUCKET}/${GOOD_KEY}`;

async function get(s3Path: string) {
  return request(app).get("/api/athena/document").query({ s3Path });
}

describe("GET /athena/document presign allowlist hardening", () => {
  beforeEach(() => {
    signMock.mockClear();
  });

  it("presigns a legitimate allowlisted bucket + .pdf key", async () => {
    const res = await get(GOOD_PATH);
    expect(res.status).toBe(200);
    expect(res.body.url).toContain("https://");
    expect(res.body.bucket).toBe(GOOD_BUCKET);
    expect(res.body.key).toBe(GOOD_KEY);
    expect(signMock).toHaveBeenCalledTimes(1);
  });

  it("presigns a partitioned key containing '=' segments (SC PDF layout)", async () => {
    const res = await get(
      "s3://your-supreme-court-data-bucket/data/tar/year=2024/english/2024_8_1047_1060_EN.pdf",
    );
    expect(res.status).toBe(200);
    expect(res.body.url).toContain("https://");
    expect(signMock).toHaveBeenCalledTimes(1);
  });

  const rejected: Array<[string, string]> = [
    ["missing s3Path", ""],
    ["non-s3 scheme", "https://usa-caselaw/x.pdf"],
    ["scheme confusion (double s3://)", "s3://s3://usa-caselaw/x.pdf"],
    ["file scheme confusion", "s3://usa-caselaw/s3://evil/x.pdf"],
    ["dot-dot traversal", "s3://usa-caselaw/../secret/x.pdf"],
    ["deep traversal", "s3://usa-caselaw/a/b/../../../../etc/passwd.pdf"],
    ["percent-encoded traversal", "s3://usa-caselaw/%2e%2e/secret.pdf"],
    ["percent-encoded slash", "s3://usa-caselaw/a%2Fb.pdf"],
    ["stray percent", "s3://usa-caselaw/100%25.pdf"],
    ["backslash traversal", "s3://usa-caselaw/..\\secret.pdf"],
    ["NUL byte", "s3://usa-caselaw/x\0.pdf"],
    ["whitespace in key", "s3://usa-caselaw/a b.pdf"],
    ["lookalike suffix bucket", "s3://usa-caselaw.evil.com/x.pdf"],
    ["lookalike s3 host", "s3://usa-caselaw.s3.amazonaws.com/x.pdf"],
    ["prefix-only bucket", "s3://evil-usa-caselaw/x.pdf"],
    ["unlisted bucket", "s3://some-other-bucket/x.pdf"],
    ["wildcard key", "s3://usa-caselaw/*.pdf"],
    ["wildcard mid-key", "s3://usa-caselaw/judgments/*/x.pdf"],
    ["empty key", "s3://usa-caselaw/"],
    ["leading slash key", "s3://usa-caselaw//x.pdf"],
    ["double slash in key", "s3://usa-caselaw/a//b.pdf"],
    ["non-pdf key", "s3://usa-caselaw/judgments/notes.txt"],
    ["no extension key", "s3://usa-caselaw/judgments/notes"],
  ];

  it.each(rejected)("rejects %s", async (_label, s3Path) => {
    const res = await get(s3Path);
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
    expect(signMock).not.toHaveBeenCalled();
  });

  it("rejects an oversized key without presigning", async () => {
    const oversized = `s3://${GOOD_BUCKET}/${"a".repeat(1100)}.pdf`;
    const res = await get(oversized);
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
    expect(signMock).not.toHaveBeenCalled();
  });
});
