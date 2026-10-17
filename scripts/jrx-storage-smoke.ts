/**
 * nv-storage-smoke.ts — Object storage roundtrip smoke
 * NV-OPT+UAT-2026-05-09 P2 #10
 *
 * 4 file sizes (1 KB, 1 MB, 10 MB, 50 MB — NOT 999 MB to keep CI fast).
 * For each: upload → download → assert SHA-256 byte-equality → delete.
 * PASS if 4/4 roundtrip-clean.
 *
 * Usage: npx tsx scripts/jrx-storage-smoke.ts
 */
// @ts-nocheck
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { nyvDocumentStorage } from '../src/services/nyv-document-storage-service.js';

const SIZES = [
  { label: '1KB',  bytes: 1024 },
  { label: '1MB',  bytes: 1024 * 1024 },
  { label: '10MB', bytes: 10 * 1024 * 1024 },
  { label: '50MB', bytes: 50 * 1024 * 1024 },
];

function makeBuf(n: number): Buffer {
  return crypto.randomBytes(n);
}

function sha256(buf: Buffer): string {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

interface R { label: string; bytes: number; uploadMs: number; downloadMs: number; sha256Match: boolean; error?: string; }

async function main() {
  const startedAt = new Date().toISOString();
  const results: R[] = [];
  console.log(`[storage-smoke] started ${startedAt} backend=${nyvDocumentStorage.getBackend?.() || 'unknown'}`);

  for (const s of SIZES) {
    const buf = makeBuf(s.bytes);
    const expected = sha256(buf);
    const startUp = Date.now();
    let uploadResult: any;
    try {
      uploadResult = await nyvDocumentStorage.upload({
        orgId: 'smoke-org',
        userId: 'smoke-user',
        fileName: `smoke-${s.label}-${Date.now()}.pdf`,
        mimeType: 'application/pdf',
        content: buf,
        metadata: { test: 'storage-smoke', label: s.label },
      });
    } catch (e: any) {
      results.push({ label: s.label, bytes: s.bytes, uploadMs: Date.now() - startUp, downloadMs: 0, sha256Match: false, error: 'upload: ' + (e?.message ?? e) });
      continue;
    }
    const uploadMs = Date.now() - startUp;

    const storagePath = uploadResult.storagePath ?? uploadResult.key ?? uploadResult.path;
    const startDn = Date.now();
    try {
      // Download API: download(storagePath) → DownloadResult { content: Buffer, ... }
      const dl: any = await nyvDocumentStorage.download(storagePath);
      const downloadMs = Date.now() - startDn;
      const got: Buffer = Buffer.isBuffer(dl) ? dl : (dl?.content ?? dl?.body ?? dl);
      const actual = sha256(got);
      const match = actual === expected;
      results.push({ label: s.label, bytes: s.bytes, uploadMs, downloadMs, sha256Match: match, error: match ? undefined : `sha256 mismatch ${expected.slice(0,12)} vs ${actual.slice(0,12)}` });
    } catch (e: any) {
      results.push({ label: s.label, bytes: s.bytes, uploadMs, downloadMs: Date.now() - startDn, sha256Match: false, error: 'download: ' + (e?.message ?? e) });
    } finally {
      try { await (nyvDocumentStorage as any).deleteDocument?.(storagePath); } catch {}
    }
  }

  const passed = results.filter(r => r.sha256Match).length;
  const verdict = passed === SIZES.length ? 'PASS' : 'FAIL';
  const summary = { suite: './jrx-storage-smoke', startedAt, finishedAt: new Date().toISOString(), total: SIZES.length, passed, verdict, results };

  const auditDir = path.join(process.cwd(), 'audit');
  if (!fs.existsSync(auditDir)) fs.mkdirSync(auditDir, { recursive: true });
  const outPath = path.join(auditDir, `storage-smoke-${startedAt.replace(/[:.]/g, '-')}.json`);
  const tmp = outPath + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(summary, null, 2));
  fs.renameSync(tmp, outPath);

  console.log(`[storage-smoke] verdict=${verdict} ${passed}/${SIZES.length} ledger=${outPath}`);
  process.exit(verdict === 'PASS' ? 0 : 1);
}

main().catch(e => { console.error('[storage-smoke] FATAL', e); process.exit(2); });
