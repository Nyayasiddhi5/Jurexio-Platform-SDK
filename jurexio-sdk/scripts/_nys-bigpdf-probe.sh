#!/usr/bin/env bash
# Read-only measurement on the NYS caselaw worker: what a large SCR-volume PDF
# actually costs THIS host (cross-region S3 GET + pdf.js text extraction),
# so the extraction cap is chosen from host numbers, not laptop numbers.
# Touches nothing the service depends on; the probe file is removed at the end.
set -uo pipefail
cd /opt/nyv/api || { echo "PROBE FAIL: /opt/nyv/api missing"; exit 1; }
echo "probe-positive-control 5150"
echo "node=$(node -v)"
for m in @aws-sdk/client-s3 pdfjs-dist unpdf; do
  if [ -f "node_modules/$m/package.json" ]; then
    echo "dep $m -> present"
  else
    echo "dep $m -> ABSENT"
  fi
done
ls node_modules/pdfjs-dist/build/*.mjs 2>/dev/null | head -5

cat > _probe_bigpdf.mjs <<'JS'
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";

const targets = [
  ["control", "data/tar/year=1973/english/1973_1_40_52_EN.pdf"],
  ["kesavananda", "data/tar/year=1973/english/S_1973_1_1_1002_EN.pdf"],
  ["maneka", "data/tar/year=1978/english/1978_2_621_776_EN.pdf"],
];
const client = new S3Client({ region: "us-east-1" });
const mb = (n) => (n / 1024 ** 2).toFixed(1);

for (const [label, key] of targets) {
  let peakRss = 0;
  const sampler = setInterval(() => {
    const r = process.memoryUsage().rss;
    if (r > peakRss) peakRss = r;
  }, 25);
  const base = process.memoryUsage().rss;
  const t0 = Date.now();
  const out = await client.send(
    new GetObjectCommand({ Bucket: "your-supreme-court-data-bucket", Key: key }),
  );
  const bytes = Buffer.from(await out.Body.transformToByteArray());
  const downloadMs = Date.now() - t0;

  const t1 = Date.now();
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(bytes),
    isEvalSupported: false,
    useSystemFonts: false,
  }).promise;
  const openMs = Date.now() - t1;

  const t2 = Date.now();
  let chars = 0;
  const parts = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    const s = content.items.map((i) => i.str ?? "").join(" ");
    chars += s.length;
    parts.push(s);
    page.cleanup();
  }
  const extractMs = Date.now() - t2;
  clearInterval(sampler);
  const text = parts.join("\n\n");
  console.log(
    JSON.stringify({
      label,
      bytes: bytes.length,
      numPages: doc.numPages,
      chars: text.length,
      downloadMs,
      openMs,
      extractMs,
      totalMs: downloadMs + openMs + extractMs,
      downloadMBps: Number((bytes.length / 1024 ** 2 / (downloadMs / 1000)).toFixed(1)),
      baseRssMB: mb(base),
      peakRssMB: mb(peakRss),
      deltaRssMB: mb(peakRss - base),
      head: text.slice(0, 90).replace(/\s+/g, " "),
    }),
  );
  await doc.destroy();
  if (global.gc) global.gc();
}
JS

node _probe_bigpdf.mjs
rc=$?
rm -f _probe_bigpdf.mjs
echo "probe-exit=$rc"
echo "=== api service still running? ==="
systemctl is-active jrx-api.service
free -m | head -2
echo "probe-done 5150"
