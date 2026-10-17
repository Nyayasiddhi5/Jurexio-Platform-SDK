#!/usr/bin/env tsx
/**
 * Task #87 — Documentation reorganization & versioning.
 *
 * Idempotent: re-runnable. Skips files already in their target location and
 * skips header stamping when a YAML header already exists.
 *
 * Steps:
 *   1. Move every doc under docs/v3.1.2/<bucket>/ per CLASSIFICATION below.
 *   2. Stamp a 4-line YAML header on every moved file (status, version,
 *      superseded_by, last_verified).
 *   3. Regenerate docs/v3.1.2/INDEX.md from the YAML headers + first H1.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");
const DOCS = path.join(ROOT, "docs");
const V3 = path.join(DOCS, "v3.1.2");
const TODAY = "2026-04-25";

type Bucket = "completed_docs" | "pending_implementation_docs" | "superseded";

interface Entry {
  /** Source path relative to docs/ — what exists today. */
  src: string;
  /** Destination path relative to docs/v3.1.2/ — where it should land. */
  dst: string;
  bucket: Bucket;
  status: "completed" | "pending" | "superseded";
  version: string;
  /** When status === "superseded", the path of the doc that replaces it (relative to docs/). */
  supersededBy?: string;
  /** One-line summary for INDEX.md. Pulled from the doc itself when omitted. */
  summary?: string;
}

/**
 * Classification rules (see plan-file Step 1):
 *   - MERGED-task behaviour            → completed_docs
 *   - planned / partial / deferred     → pending_implementation_docs
 *   - older versions (v5 SDK, etc.)    → superseded
 */
const CLASSIFICATION: Entry[] = [
  // ───── COMPLETED — describes shipped, merged behaviour ─────
  { src: "agents/NYV-AGENT-CATALOG.md", dst: "completed_docs/agents/NYV-AGENT-CATALOG.md", bucket: "completed_docs", status: "completed", version: "3.1.2" },
  { src: "agents/agents-product.md", dst: "completed_docs/agents/agents-product.md", bucket: "completed_docs", status: "completed", version: "3.1.2" },
  { src: "api/NYV-API-REFERENCE.md", dst: "completed_docs/api/NYV-API-REFERENCE.md", bucket: "completed_docs", status: "completed", version: "3.1.2" },
  { src: "api/NYV-SDK-INTEGRATION-GUIDE.md", dst: "completed_docs/api/NYV-SDK-INTEGRATION-GUIDE.md", bucket: "completed_docs", status: "completed", version: "3.1.2" },
  { src: "architecture/NYV-ARCHITECTURE-312.md", dst: "completed_docs/architecture/NYV-ARCHITECTURE-312.md", bucket: "completed_docs", status: "completed", version: "3.1.2" },
  { src: "conventions/NYV-NAMING-CONVENTIONS.md", dst: "completed_docs/conventions/NYV-NAMING-CONVENTIONS.md", bucket: "completed_docs", status: "completed", version: "3.1.2" },
  { src: "setup/NYV-QUICKSTART.md", dst: "completed_docs/setup/NYV-QUICKSTART.md", bucket: "completed_docs", status: "completed", version: "3.1.2" },
  { src: "AWS-DNS-HANDOFF-2026-04-24.md", dst: "completed_docs/AWS-DNS-HANDOFF-2026-04-24.md", bucket: "completed_docs", status: "completed", version: "3.1.2" },
  { src: "AWS-MANAGED-DATASTORES-2026-04-24.md", dst: "completed_docs/AWS-MANAGED-DATASTORES-2026-04-24.md", bucket: "completed_docs", status: "completed", version: "3.1.2" },
  { src: "NYAYAMITRA-SDK-FINAL.md", dst: "completed_docs/NYAYAMITRA-SDK-FINAL.md", bucket: "completed_docs", status: "completed", version: "3.1.2" },
  { src: "NYV-ARCHITECTURE-v6.md", dst: "completed_docs/NYV-ARCHITECTURE-v6.md", bucket: "completed_docs", status: "completed", version: "3.1.2" },
  { src: "NYV-CICD-REPLIT.md", dst: "completed_docs/NYV-CICD-REPLIT.md", bucket: "completed_docs", status: "completed", version: "3.1.2" },
  { src: "NYV-COMPLIANCE-ATTESTATION.md", dst: "completed_docs/NYV-COMPLIANCE-ATTESTATION.md", bucket: "completed_docs", status: "completed", version: "3.1.2" },
  { src: "NYV-DNS-AND-EDGE.md", dst: "completed_docs/NYV-DNS-AND-EDGE.md", bucket: "completed_docs", status: "completed", version: "3.1.2" },
  { src: "NYV-DR-DRILL-RESULTS.md", dst: "completed_docs/NYV-DR-DRILL-RESULTS.md", bucket: "completed_docs", status: "completed", version: "3.1.2" },
  { src: "NYV-INCIDENT-RUNBOOK.md", dst: "completed_docs/NYV-INCIDENT-RUNBOOK.md", bucket: "completed_docs", status: "completed", version: "3.1.2" },
  { src: "NYV-MOBILE-INTEGRATION-GUIDE.md", dst: "completed_docs/NYV-MOBILE-INTEGRATION-GUIDE.md", bucket: "completed_docs", status: "completed", version: "3.1.2" },
  { src: "NYV-MOBILE-STORE-SUBMISSION-CHECKLIST.md", dst: "completed_docs/NYV-MOBILE-STORE-SUBMISSION-CHECKLIST.md", bucket: "completed_docs", status: "completed", version: "3.1.2" },
  { src: "NYV-OBSERVABILITY.md", dst: "completed_docs/NYV-OBSERVABILITY.md", bucket: "completed_docs", status: "completed", version: "3.1.2" },
  { src: "NYV-PARTNER-DEPLOY-GUIDE.md", dst: "completed_docs/NYV-PARTNER-DEPLOY-GUIDE.md", bucket: "completed_docs", status: "completed", version: "3.1.2" },
  { src: "NYV-PLATFORM-GOVERNANCE.md", dst: "completed_docs/NYV-PLATFORM-GOVERNANCE.md", bucket: "completed_docs", status: "completed", version: "3.1.2" },
  { src: "NYV-Production-Use-Cases-India.md", dst: "completed_docs/NYV-Production-Use-Cases-India.md", bucket: "completed_docs", status: "completed", version: "3.1.2" },
  { src: "NYV-PROJECT-STATUS-Apr2026.md", dst: "completed_docs/NYV-PROJECT-STATUS-Apr2026.md", bucket: "completed_docs", status: "completed", version: "3.1.2" },
  { src: "NYV-PRODUCT-NOTE-BUSINESS-v3.1.2.md", dst: "completed_docs/NYV-PRODUCT-NOTE-BUSINESS-v3.1.2.md", bucket: "completed_docs", status: "completed", version: "3.1.2", summary: "Business product note for CEO / investors / enterprise pitches — single source of truth for the Nyayavigya business narrative." },
  { src: "NYV-PRODUCT-NOTE-TECHNICAL-v3.1.2.md", dst: "completed_docs/NYV-PRODUCT-NOTE-TECHNICAL-v3.1.2.md", bucket: "completed_docs", status: "completed", version: "3.1.2", summary: "Technical product note for engineering / SRE / partner-integration teams — companion to the business note covering deployment, DB, Redis, LLM orchestration, Queen internals, RAG, memory, multi-tenant, SDK, security, observability, ops, 10 M MAU roadmap, and pending production-scale work." },
  { src: "NYV-RDS-MIGRATION-RUNBOOK.md", dst: "completed_docs/NYV-RDS-MIGRATION-RUNBOOK.md", bucket: "completed_docs", status: "completed", version: "3.1.2" },
  { src: "NYV-REDIS-MEM0-SETUP.md", dst: "completed_docs/NYV-REDIS-MEM0-SETUP.md", bucket: "completed_docs", status: "completed", version: "3.1.2" },
  { src: "NYV-SDK-PRODUCTION-AUDIT-REPORT-Apr2026.md", dst: "completed_docs/NYV-SDK-PRODUCTION-AUDIT-REPORT-Apr2026.md", bucket: "completed_docs", status: "completed", version: "3.1.2" },
  { src: "NYV-SDK-v6-API-REFERENCE.md", dst: "completed_docs/NYV-SDK-v6-API-REFERENCE.md", bucket: "completed_docs", status: "completed", version: "v6.0.0" },
  { src: "NYV-SDK-v6-INTEGRATION-GUIDE.md", dst: "completed_docs/NYV-SDK-v6-INTEGRATION-GUIDE.md", bucket: "completed_docs", status: "completed", version: "v6.0.0" },
  { src: "NYV-SECRETS-CLEANUP.md", dst: "completed_docs/NYV-SECRETS-CLEANUP.md", bucket: "completed_docs", status: "completed", version: "3.1.2" },
  { src: "NYV-SECRETS-MANAGEMENT.md", dst: "completed_docs/NYV-SECRETS-MANAGEMENT.md", bucket: "completed_docs", status: "completed", version: "3.1.2" },
  { src: "orchestration-map.md", dst: "completed_docs/orchestration-map.md", bucket: "completed_docs", status: "completed", version: "3.1.2" },
  { src: "UAT-REPORT-v3.1.2.md", dst: "completed_docs/uat/UAT-REPORT-v3.1.2.md", bucket: "completed_docs", status: "completed", version: "3.1.2" },

  // ───── PENDING — planned / partial / deferred ─────
  { src: "NYV-IAM-GAPS.md", dst: "pending_implementation_docs/NYV-IAM-GAPS.md", bucket: "pending_implementation_docs", status: "pending", version: "3.1.2" },
  { src: "NYV-PRODUCTION-READINESS-CHECKLIST.md", dst: "pending_implementation_docs/NYV-PRODUCTION-READINESS-CHECKLIST.md", bucket: "pending_implementation_docs", status: "pending", version: "3.1.2" },
  { src: "NYV-AGENT-SUGGESTED-FOLLOWUPS.md", dst: "pending_implementation_docs/NYV-AGENT-SUGGESTED-FOLLOWUPS.md", bucket: "pending_implementation_docs", status: "pending", version: "3.1.2" },
  { src: "NYV-ROADMAP-Q2-Q4-2026.md", dst: "pending_implementation_docs/NYV-ROADMAP-Q2-Q4-2026.md", bucket: "pending_implementation_docs", status: "pending", version: "3.1.2" },
  // UAT v3.2 was deferred to AWS — partial / pending the AWS rerun.
  { src: "uat/NYV-UAT-v3.2-COMPREHENSIVE.md", dst: "pending_implementation_docs/uat/NYV-UAT-v3.2-COMPREHENSIVE.md", bucket: "pending_implementation_docs", status: "pending", version: "3.2" },
  { src: "uat/NYV-UAT-v3.2-SUMMARY.md", dst: "pending_implementation_docs/uat/NYV-UAT-v3.2-SUMMARY.md", bucket: "pending_implementation_docs", status: "pending", version: "3.2" },
  { src: "uat/UAT-DEFERRED-AWS-PUSH.md", dst: "pending_implementation_docs/uat/UAT-DEFERRED-AWS-PUSH.md", bucket: "pending_implementation_docs", status: "pending", version: "3.2" },

  // ───── SUPERSEDED — replaced by newer docs ─────
  { src: "NYV-SDK-v5-API-REFERENCE.md", dst: "superseded/NYV-SDK-v5-API-REFERENCE.md", bucket: "superseded", status: "superseded", version: "v5.0.0", supersededBy: "v3.1.2/completed_docs/NYV-SDK-v6-API-REFERENCE.md" },
  { src: "NYV-SDK-v5-INTEGRATION-GUIDE.md", dst: "superseded/NYV-SDK-v5-INTEGRATION-GUIDE.md", bucket: "superseded", status: "superseded", version: "v5.0.0", supersededBy: "v3.1.2/completed_docs/NYV-SDK-v6-INTEGRATION-GUIDE.md" },
  { src: "NYV-SDK-v5-MASTER-INTEGRATION-GUIDE.md", dst: "superseded/NYV-SDK-v5-MASTER-INTEGRATION-GUIDE.md", bucket: "superseded", status: "superseded", version: "v5.0.0", supersededBy: "v3.1.2/completed_docs/NYV-SDK-v6-INTEGRATION-GUIDE.md" },
  { src: "NYV-SDK-UAT-COMPREHENSIVE.md", dst: "superseded/NYV-SDK-UAT-COMPREHENSIVE.md", bucket: "superseded", status: "superseded", version: "v5.0.0", supersededBy: "v3.1.2/pending_implementation_docs/uat/NYV-UAT-v3.2-COMPREHENSIVE.md" },
  { src: "NYV-SDK-v5-DEPRECATION-POLICY.md", dst: "superseded/NYV-SDK-v5-DEPRECATION-POLICY.md", bucket: "superseded", status: "superseded", version: "v5.0.0", supersededBy: "v3.1.2/completed_docs/NYV-SDK-v6-INTEGRATION-GUIDE.md" },
];

/**
 * Non-markdown UAT artefacts (results.json, resolutions.json) ride along with
 * the UAT docs so the bucket is self-contained, but they don't get YAML
 * headers (not markdown).
 */
const NON_MD_MOVES: Array<{ src: string; dst: string }> = [
  { src: "uat/results.json", dst: "pending_implementation_docs/uat/results.json" },
  { src: "uat/resolutions.json", dst: "pending_implementation_docs/uat/resolutions.json" },
];

function moveFile(srcRel: string, dstRel: string): "moved" | "already-moved" | "missing" {
  const srcAbs = path.join(DOCS, srcRel);
  const dstAbs = path.join(V3, dstRel);
  if (fs.existsSync(dstAbs) && !fs.existsSync(srcAbs)) return "already-moved";
  if (!fs.existsSync(srcAbs)) return "missing";
  fs.mkdirSync(path.dirname(dstAbs), { recursive: true });
  fs.renameSync(srcAbs, dstAbs);
  return "moved";
}

function stampHeader(entry: Entry): "stamped" | "already-stamped" | "missing" {
  const dstAbs = path.join(V3, entry.dst);
  if (!fs.existsSync(dstAbs)) return "missing";
  const body = fs.readFileSync(dstAbs, "utf8");
  if (body.startsWith("---\n")) return "already-stamped";

  const lines = ["---", `status: ${entry.status}`, `version: ${entry.version}`];
  if (entry.supersededBy) lines.push(`superseded_by: docs/${entry.supersededBy}`);
  else lines.push("superseded_by: null");
  lines.push(`last_verified: ${TODAY}`);
  lines.push("---", "");

  fs.writeFileSync(dstAbs, lines.join("\n") + body);
  return "stamped";
}

function firstH1OrSummary(absPath: string): string {
  if (!fs.existsSync(absPath)) return "(missing)";
  const body = fs.readFileSync(absPath, "utf8");
  // Skip YAML header if present.
  const afterHeader = body.startsWith("---\n")
    ? body.slice(body.indexOf("\n---\n") + 5)
    : body;
  for (const raw of afterHeader.split("\n").slice(0, 30)) {
    const line = raw.trim();
    if (line.startsWith("# ")) return line.slice(2).trim();
    if (line && !line.startsWith("#") && !line.startsWith(">") && !line.startsWith("|") && !line.startsWith("-")) {
      return line.length > 140 ? line.slice(0, 137) + "..." : line;
    }
  }
  return "(no summary)";
}

function buildIndex(): void {
  const buckets: Record<Bucket, Entry[]> = {
    completed_docs: [],
    pending_implementation_docs: [],
    superseded: [],
  };
  for (const e of CLASSIFICATION) buckets[e.bucket].push(e);

  const lines: string[] = [];
  lines.push("---");
  lines.push("status: completed");
  lines.push("version: 3.1.2");
  lines.push("superseded_by: null");
  lines.push(`last_verified: ${TODAY}`);
  lines.push("---");
  lines.push("");
  lines.push("# Nyayavigya Platform — Documentation Index (v3.1.2)");
  lines.push("");
  lines.push("Single source of truth for every Nyayavigya markdown doc. Generated by `scripts/jrx-doc-reorganize.ts` from inline classification + each doc's YAML header. Re-run the script to regenerate.");
  lines.push("");
  lines.push("## Buckets");
  lines.push("");
  lines.push("- **`completed_docs/`** — Describes shipped, merged behaviour. Treat as authoritative for current production.");
  lines.push("- **`pending_implementation_docs/`** — Describes planned, partial, or deferred work. Subject to change as tasks land.");
  lines.push("- **`superseded/`** — Older versions kept for historical reference. The `superseded_by:` header points to the current replacement.");
  lines.push("");
  lines.push("## How to add a new doc");
  lines.push("");
  lines.push("1. Pick the right bucket (`completed_docs/`, `pending_implementation_docs/`, or `superseded/`).");
  lines.push("2. Add the doc with this 4-line YAML header at the top:");
  lines.push("");
  lines.push("   ```");
  lines.push("   ---");
  lines.push("   status: completed | pending | superseded");
  lines.push("   version: <e.g. 3.1.2 or v6.0.0>");
  lines.push("   superseded_by: <docs/v3.1.2/.../NEWER.md or null>");
  lines.push("   last_verified: <YYYY-MM-DD>");
  lines.push("   ---");
  lines.push("   ```");
  lines.push("");
  lines.push("3. Add an entry for it in `scripts/jrx-doc-reorganize.ts` (`CLASSIFICATION` array) and re-run the script. It will regenerate this index.");
  lines.push("");

  const renderRow = (e: Entry): string => {
    const abs = path.join(V3, e.dst);
    const summary = e.summary ?? firstH1OrSummary(abs);
    const linkPath = e.dst.replace(/\\/g, "/");
    // supersededBy is stored as "v3.1.2/<bucket>/<file>" (relative to docs/).
    // INDEX.md sits at docs/v3.1.2/INDEX.md, so strip the leading "v3.1.2/"
    // and link as "./<bucket>/<file>" — same-tree, clean relative link.
    const supSuffix = e.supersededBy
      ? (() => {
          const inV3 = e.supersededBy!.replace(/^v3\.1\.2\//, "");
          const fname = e.supersededBy!.split("/").pop()!;
          return `<br/>↳ replaced by [\`${fname}\`](./${inV3})`;
        })()
      : "";
    return `| [\`${linkPath}\`](./${linkPath}) | ${e.version} | ${summary}${supSuffix} |`;
  };

  const sectionFor = (title: string, bucket: Bucket): void => {
    lines.push(`## ${title}`);
    lines.push("");
    lines.push(`Total: ${buckets[bucket].length} documents.`);
    lines.push("");
    lines.push("| Path | Version | Summary |");
    lines.push("|---|---|---|");
    for (const e of buckets[bucket].sort((a, b) => a.dst.localeCompare(b.dst))) {
      lines.push(renderRow(e));
    }
    lines.push("");
  };

  sectionFor("Completed docs", "completed_docs");
  sectionFor("Pending implementation docs", "pending_implementation_docs");
  sectionFor("Superseded docs", "superseded");

  lines.push("## Non-markdown artefacts");
  lines.push("");
  lines.push("UAT machine-readable artefacts ride alongside their markdown summaries:");
  lines.push("");
  for (const m of NON_MD_MOVES) {
    const linkPath = m.dst.replace(/\\/g, "/");
    lines.push(`- [\`${linkPath}\`](./${linkPath})`);
  }
  lines.push("");
  lines.push("---");
  lines.push("");
  lines.push("**Maintenance:** Re-run `npx tsx scripts/jrx-doc-reorganize.ts` after adding or moving any doc. The script is idempotent.");
  lines.push("");

  const indexPath = path.join(V3, "INDEX.md");
  fs.writeFileSync(indexPath, lines.join("\n"));
}

function writeRedirect(): void {
  const redirect = [
    "# Nyayavigya Documentation",
    "",
    "All Nyayavigya markdown docs are organised under [`v3.1.2/`](./v3.1.2/INDEX.md) by status:",
    "",
    "- [`v3.1.2/completed_docs/`](./v3.1.2/completed_docs/) — describes shipped, merged behaviour.",
    "- [`v3.1.2/pending_implementation_docs/`](./v3.1.2/pending_implementation_docs/) — describes planned / partial / deferred work.",
    "- [`v3.1.2/superseded/`](./v3.1.2/superseded/) — older versions kept for history.",
    "",
    "Start at [`v3.1.2/INDEX.md`](./v3.1.2/INDEX.md) for the full document map.",
    "",
    "**New docs:** add them under `v3.1.2/<bucket>/` with the 4-line YAML header described in the index, then re-run `npx tsx scripts/jrx-doc-reorganize.ts` to regenerate this index.",
    "",
  ].join("\n");
  fs.writeFileSync(path.join(DOCS, "README.md"), redirect);
}

function main(): void {
  let moves = 0, alreadyMoved = 0, missing = 0;
  let stamped = 0, alreadyStamped = 0;

  console.log(`==> docs/ → docs/v3.1.2/ reorganization (idempotent)`);

  for (const e of CLASSIFICATION) {
    const r = moveFile(e.src, e.dst);
    if (r === "moved") moves++;
    else if (r === "already-moved") alreadyMoved++;
    else { console.log(`   missing src: docs/${e.src}`); missing++; }

    const s = stampHeader(e);
    if (s === "stamped") stamped++;
    else if (s === "already-stamped") alreadyStamped++;
  }

  for (const m of NON_MD_MOVES) {
    const r = moveFile(m.src, m.dst);
    if (r === "moved") moves++;
    else if (r === "already-moved") alreadyMoved++;
    else missing++;
  }

  console.log(`   moves: ${moves} new, ${alreadyMoved} already in place, ${missing} missing`);
  console.log(`   headers: ${stamped} stamped, ${alreadyStamped} already had a header`);

  buildIndex();
  console.log(`==> wrote docs/v3.1.2/INDEX.md`);

  writeRedirect();
  console.log(`==> wrote docs/README.md (redirect)`);

  console.log(`==> done`);
}

main();
