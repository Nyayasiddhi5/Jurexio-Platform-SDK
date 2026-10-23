import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { readFile, access } from "node:fs/promises";
import { createHash } from "node:crypto";
import { run } from "./ssm-run.mjs";

const BUCKET = "nyv-sdk-distribution";
const PREFIX = "caselaw-worker/api";
const s3 = new S3Client({ region: "ap-south-1" });

const API_FILES = [
  ["../artifacts/api-server/dist/index.mjs", "index.mjs"],
  ["../artifacts/api-server/dist/embed-corpus.mjs", "embed-corpus.mjs"],
  ["../artifacts/api-server/dist/embed-statutes.mjs", "embed-statutes.mjs"],
  ["../artifacts/api-server/dist/ingest-rds.mjs", "ingest-rds.mjs"],
  ["../artifacts/api-server/dist/ingest-cnr-case-details.mjs", "ingest-cnr-case-details.mjs"],
  ["../artifacts/api-server/dist/audit-coverage.mjs", "audit-coverage.mjs"],
  ["../scripts/athena-hc-case-details-ctas.mjs", "athena-hc-case-details-ctas.mjs"],
  ["../scripts/athena-sc-case-details-ctas.mjs", "athena-sc-case-details-ctas.mjs"],
  ["../scripts/athena-dc-case-details-ctas.mjs", "athena-dc-case-details-ctas.mjs"],
  ["../scripts/nys-cnr-index-sync.mjs", "nys-cnr-index-sync.mjs"],
  ["../scripts/apply-cnr-ddl.mjs", "apply-cnr-ddl.mjs"],
  ["../scripts/apply-sc-body-fts-ddl.mjs", "apply-sc-body-fts-ddl.mjs"],
  ["../scripts/backfill-sc-body-fts.mjs", "backfill-sc-body-fts.mjs"],
  ["../scripts/nys-treatment-graph-extract.mjs", "nys-treatment-graph-extract.mjs"],
  ["../scripts/nys-treatment-graph-edges.mjs", "nys-treatment-graph-edges.mjs"],
  ["../scripts/_reverse-cursor.mjs", "_reverse-cursor.mjs"],
  ["../scripts/_extract-auth.mjs", "_extract-auth.mjs"],
  ["../scripts/weekly-india-refresh.mjs", "weekly-india-refresh.mjs"],
];

// Worker-side script installs: manifest name -> destination path on the worker.
const SCRIPT_DESTS = {
  "ingest-rds.mjs": "/opt/nyv/api/ingest-rds.mjs",
  "ingest-cnr-case-details.mjs": "/opt/nyv/api/ingest-cnr-case-details.mjs",
  "nys-cnr-index-sync.mjs": "/opt/nyv/api/nys-cnr-index-sync.mjs",
  "athena-hc-case-details-ctas.mjs": "/opt/nyv/api/athena-hc-case-details-ctas.mjs",
  "athena-sc-case-details-ctas.mjs": "/opt/nyv/api/athena-sc-case-details-ctas.mjs",
  "athena-dc-case-details-ctas.mjs": "/opt/nyv/api/athena-dc-case-details-ctas.mjs",
  "apply-cnr-ddl.mjs": "/opt/nyv/api/apply-cnr-ddl.mjs",
  "apply-sc-body-fts-ddl.mjs": "/opt/nyv/api/apply-sc-body-fts-ddl.mjs",
  "backfill-sc-body-fts.mjs": "/opt/nyv/api/backfill-sc-body-fts.mjs",
  "nys-treatment-graph-extract.mjs": "/opt/nyv/api/nys-treatment-graph-extract.mjs",
  "nys-treatment-graph-edges.mjs": "/opt/nyv/api/nys-treatment-graph-edges.mjs",
  "_reverse-cursor.mjs": "/opt/nyv/api/_reverse-cursor.mjs",
  "_extract-auth.mjs": "/opt/nyv/api/_extract-auth.mjs",
  "weekly-india-refresh.mjs": "/opt/nyv/api/weekly-india-refresh.mjs",
  "embed-corpus.mjs": "/opt/nyv/api/embed-corpus.mjs",
  "embed-statutes.mjs": "/opt/nyv/api/embed-statutes.mjs",
  "audit-coverage.mjs": "/opt/nyv/api/audit-coverage.mjs",
};

const md5 = (buf) => createHash("md5").update(buf).digest("hex");
const releaseKey = (name, hash) => {
  const dot = name.lastIndexOf(".");
  return `${PREFIX}/releases/${name.slice(0, dot)}-${hash}${name.slice(dot)}`;
};

async function fetchRemoteManifest() {
  try {
    const got = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: `${PREFIX}/manifest.json` }));
    return JSON.parse(await got.Body.transformToString());
  } catch (e) {
    if (e?.name === "NoSuchKey" || e?.$metadata?.httpStatusCode === 404) return null;
    throw e;
  }
}

async function uploadOne(manifest, localPath, name) {
  const Body = await readFile(localPath);
  const hash = md5(Body);
  const key = releaseKey(name, hash);
  await s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: key, Body, ContentMD5: Buffer.from(hash, "hex").toString("base64") }));
  manifest.files[name] = { key, md5: hash, size: Body.length };
  console.log("uploaded", key, Body.length);
}

async function upload({ withApi, frontendTarball }) {
  // Merge with the existing remote manifest so a frontend-only (or api-only)
  // upload never drops the other entries.
  const existing = await fetchRemoteManifest();
  const manifest = { createdAt: new Date().toISOString(), files: { ...(existing?.files ?? {}) } };
  const uploadedNames = [];

  if (withApi) {
    for (const [local, name] of API_FILES) {
      await uploadOne(manifest, local, name);
      uploadedNames.push(name);
    }
  }
  if (frontendTarball) {
    await uploadOne(manifest, frontendTarball, "public.tgz");
    uploadedNames.push("public.tgz");
  }
  if (uploadedNames.length === 0) {
    if (!existing) throw new Error("nothing to upload and no remote manifest exists");
    console.log("no uploads requested; using existing remote manifest");
    return existing;
  }

  const manifestBody = Buffer.from(JSON.stringify(manifest, null, 2));
  await s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: `${PREFIX}/manifest.json`, Body: manifestBody, ContentType: "application/json" }));
  console.log("uploaded", `${PREFIX}/manifest.json`);

  // Read-back verification: the manifest we just wrote must match what we uploaded.
  const remote = await fetchRemoteManifest();
  for (const name of uploadedNames) {
    const f = manifest.files[name];
    if (!remote?.files?.[name] || remote.files[name].md5 !== f.md5) {
      throw new Error(`manifest read-back mismatch for ${name}: another release overwrote the manifest between upload and verification`);
    }
  }
  console.log("manifest read-back verified");
  return manifest;
}

// Shared shell fragment: download a hashed key, md5-verify, leave file at $TMP.
// Every branch that fails exits non-zero (fail loudly, never install unverified bytes).
function fetchVerified(f, label, tmpTemplate) {
  return [
    `TMP=$(mktemp ${tmpTemplate})`,
    `aws s3 cp s3://${BUCKET}/${f.key} "$TMP" --quiet`,
    `GOT=$(md5sum "$TMP" | cut -d" " -f1)`,
    `if [ "$GOT" != "${f.md5}" ]; then echo "DEPLOY FAILED: md5 mismatch for ${label} (expected ${f.md5}, got $GOT)"; rm -f "$TMP"; exit 1; fi`,
  ];
}

function deployApiCommand(manifest) {
  const f = manifest.files["index.mjs"];
  if (!f) throw new Error("manifest has no index.mjs entry");
  // Content-addressed download + md5 verification + atomic mv, then restart + health check.
  // No heredocs (SSM gotcha); fail loudly on any mismatch.
  return [
    `set -e`,
    ...fetchVerified(f, "index.mjs", "/tmp/index-deploy-XXXXXX.mjs"),
    `mv "$TMP" /opt/nyv/api/index.mjs`,
    `systemctl restart nyv-api`,
    `sleep 3`,
    `systemctl is-active nyv-api`,
    `curl -sf -o /dev/null -w "health %{http_code}\\n" localhost:8080/api/healthz || curl -s -o /dev/null -w "health %{http_code}\\n" localhost:8080/api/caselaw/stats`,
    `echo "DEPLOYED index.mjs md5=${f.md5}"`,
  ].join(" && ");
}

function deployFrontendCommand(manifest) {
  const f = manifest.files["public.tgz"];
  if (!f) throw new Error("manifest has no public.tgz entry — upload with --frontend first");
  // Verified download, extract to a staging dir, then atomic-ish directory swap.
  return [
    `set -e`,
    ...fetchVerified(f, "public.tgz", "/tmp/public-deploy-XXXXXX.tgz"),
    `rm -rf /opt/nyv/api/public.new.*`,
    `STAGE=$(mktemp -d /opt/nyv/api/public.new.XXXXXX)`,
    `tar xzf "$TMP" -C "$STAGE"`,
    `if [ ! -f "$STAGE/index.html" ]; then echo "DEPLOY FAILED: extracted tarball has no index.html (tar the CONTENTS of dist/public/)"; rm -rf "$STAGE" "$TMP"; exit 1; fi`,
    `rm -rf /opt/nyv/api/public.old`,
    `if [ -d /opt/nyv/api/public ]; then mv /opt/nyv/api/public /opt/nyv/api/public.old; fi`,
    `mv "$STAGE" /opt/nyv/api/public`,
    `rm -f "$TMP"`,
    `curl -sf -o /dev/null -w "frontend %{http_code}\\n" localhost:8080/`,
    `echo "DEPLOYED public.tgz md5=${f.md5}"`,
  ].join(" && ");
}

function deployScriptsCommand(manifest) {
  const parts = [`set -e`];
  for (const [name, dest] of Object.entries(SCRIPT_DESTS)) {
    const f = manifest.files[name];
    if (!f) throw new Error(`manifest has no ${name} entry — run an api upload first`);
    parts.push(
      ...fetchVerified(f, name, `/tmp/script-deploy-XXXXXX`),
      `mv "$TMP" ${dest}`,
      `echo "INSTALLED ${dest} md5=${f.md5}"`,
    );
  }
  return parts.join(" && ");
}

function parseArgs(argv) {
  const args = {
    deploy: argv.includes("--deploy"),
    scripts: argv.includes("--scripts"),
    frontend: null,
    apiOnlyFlags: argv.includes("--no-api"),
  };
  for (const a of argv) {
    if (a === "--frontend") args.frontend = "/tmp/public.tgz";
    else if (a.startsWith("--frontend=")) args.frontend = a.slice("--frontend=".length);
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
const withApi = !args.apiOnlyFlags;
if (args.frontend) {
  await access(args.frontend).catch(() => {
    console.error(`frontend tarball not found at ${args.frontend} (build the frontend, then: cd dist/public && tar czf /tmp/public.tgz .)`);
    process.exit(1);
  });
}

const manifest = await upload({ withApi, frontendTarball: args.frontend });

if (args.deploy || args.scripts) {
  const steps = [];
  if (args.deploy && withApi) steps.push(["API bundle", deployApiCommand(manifest)]);
  if (args.deploy && args.frontend) steps.push(["frontend static", deployFrontendCommand(manifest)]);
  if (args.scripts) steps.push(["worker scripts", deployScriptsCommand(manifest)]);
  for (const [label, cmd] of steps) {
    console.log(`deploying ${label} to worker via SSM (md5-verified)`);
    const status = await run([cmd], 300);
    if (status !== "Success") {
      console.error(`DEPLOY FAILED (${label}) with status`, status);
      process.exit(1);
    }
  }
} else {
  console.log("upload only. Flags: --deploy (api + frontend if uploaded), --frontend[=path], --scripts (install ingest/embed/audit from manifest), --no-api");
}
