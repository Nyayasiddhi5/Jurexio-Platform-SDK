#!/usr/bin/env node
/**
 * NV-DOCPARSE-WORKER-SIDECAR-001 — minimal HTTP job worker for large PDFs (dev).
 * POST /v1/parse with { base64, fileName, domainPackId? } → 202 + poll GET /v1/jobs/:id
 */
import http from "node:http";
import { InMemoryDocparseJobQueue } from "@nyv/docparse-sdk";

const PORT = Number(process.env.NYV_DOCPARSE_WORKER_PORT || 5012);
const queue = new InMemoryDocparseJobQueue();

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

const server = http.createServer(async (req, res) => {
  res.setHeader("content-type", "application/json");
  try {
    if (req.method === "POST" && req.url === "/v1/parse") {
      const raw = JSON.parse(await readBody(req));
      const bytes = Buffer.from(String(raw.base64 || ""), "base64");
      if (!bytes.length) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: "base64 required" }));
        return;
      }
      const jobId = queue.submit({
        files: [{ bytes: new Uint8Array(bytes), fileName: raw.fileName || "upload.pdf" }],
        run: {
          batchId: `sidecar_${Date.now()}`,
          actor: "nyv:docparse-sidecar",
          domainPackId: raw.domainPackId || "legal-in",
        },
        domainPackId: raw.domainPackId,
      });
      res.writeHead(202);
      res.end(JSON.stringify({ jobId, status: "queued" }));
      return;
    }
    const jobMatch = req.method === "GET" && req.url?.startsWith("/v1/jobs/");
    if (jobMatch) {
      const jobId = req.url.split("/").pop();
      const rec = queue.get(jobId);
      if (!rec) {
        res.writeHead(404);
        res.end(JSON.stringify({ error: "not found" }));
        return;
      }
      res.writeHead(200);
      res.end(JSON.stringify(rec));
      return;
    }
    if (req.method === "GET" && req.url === "/health") {
      res.writeHead(200);
      res.end(JSON.stringify({ ok: true, port: PORT }));
      return;
    }
    res.writeHead(404);
    res.end(JSON.stringify({ error: "not found" }));
  } catch (e) {
    res.writeHead(500);
    res.end(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }));
  }
});

server.listen(PORT, () => {
  console.log(`docparse worker sidecar listening on ${PORT}`);
});
