import { Router, type Request, type Response } from 'express';
import crypto from 'crypto';
import { eq } from 'drizzle-orm';
import { createLogger } from '../utils/logger.js';
import { JRX_STORAGE } from '../config/jrx-master-config.js';
import { hashApiKey } from '../config/jrx-sdk-variants.js';
import { db } from '../db/index.js';
import { sdkAppApiKeys } from '@shared/schema.js';

const logger = createLogger('./jrx-sdk-downloads');

// JRX-NS-011 (2026-05-01) — pre-GA fix per SDK-DEV-EC2-ACCESS §11.5.
// All five v5.0.0 SDK tarballs published to s3://jurexio-sdk-devapp/sdk/
// must be reachable via /downloads/sdk/<pkg>/<version>.tgz. Adding types,
// react-hooks, and enterprise-sdk closes the consumer-side 404 gap that
// would otherwise force NSP / NSI / NSA / NSM and Jurexio Citizen integrators
// to pull tarballs directly from S3 with raw AWS credentials.
const ALLOWED_PACKAGES = new Set<string>([
  'client-sdk',
  'client-sdk-react-native',
  'jurexio-citizen-sdk',
  'types',
  'react-hooks',
  'enterprise-sdk',
]);

const VERSION_RE = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;
const PACKAGE_RE = /^[a-z0-9][a-z0-9-]{1,40}$/;

function parseTtlSeconds(raw: string | undefined): number {
  const DEFAULT_TTL = 300;
  const MIN_TTL = 60;
  const MAX_TTL = 900;
  const n = parseInt(raw ?? '', 10);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_TTL;
  return Math.min(MAX_TTL, Math.max(MIN_TTL, n));
}

const SDK_BUCKET = process.env.JRX_SDK_BUCKET || JRX_STORAGE.s3.bucket || 'jrx-sdk-distribution';
const SDK_PREFIX = (process.env.JRX_SDK_BUCKET_PREFIX || 'sdk/').replace(/^\/+/, '').replace(/\/*$/, '/');
const SIGNED_URL_TTL_SECONDS = parseTtlSeconds(process.env.JRX_SDK_DOWNLOAD_TTL_SECONDS);
const PUBLIC_DOWNLOADS = (process.env.JRX_SDK_DOWNLOADS_PUBLIC || 'true').toLowerCase() === 'true';
const STATIC_DOWNLOAD_TOKEN = process.env.JRX_SDK_DOWNLOAD_TOKEN || '';
const HMAC_SECRET = process.env.JRX_SDK_DOWNLOAD_HMAC_SECRET || process.env.JWT_SECRET || '';

const apiKeyAuthCache = new Map<string, { ok: boolean; cachedAt: number }>();
const API_KEY_CACHE_TTL_MS = 60_000;

interface ManifestEntry {
  package: string;
  versions: string[];
  latest: string;
}

interface S3HeadCacheEntry {
  exists: boolean;
  size?: number;
  etag?: string;
  lastModified?: string;
  cachedAt: number;
}

const headCache = new Map<string, S3HeadCacheEntry>();
const HEAD_CACHE_TTL_MS = 60_000;

let manifestCache: { manifest: ManifestEntry[]; cachedAt: number } | null = null;
const MANIFEST_CACHE_TTL_MS = 60_000;

let s3ClientSingleton: any = null;
async function getS3Client(): Promise<any> {
  if (s3ClientSingleton) return s3ClientSingleton;
  const { S3Client } = await import('@aws-sdk/client-s3');
  const cfg: Record<string, any> = {
    region: process.env.JRX_S3_REGION || JRX_STORAGE.s3.region || 'ap-south-1',
  };
  const ak = process.env.JRX_S3_ACCESS_KEY_ID || process.env.AWS_ACCESS_KEY_ID;
  const sk = process.env.JRX_S3_SECRET_ACCESS_KEY || process.env.AWS_SECRET_ACCESS_KEY;
  if (ak && sk) {
    cfg.credentials = { accessKeyId: ak, secretAccessKey: sk };
  }
  if (JRX_STORAGE.s3.endpoint) cfg.endpoint = JRX_STORAGE.s3.endpoint;
  if (JRX_STORAGE.s3.forcePathStyle) cfg.forcePathStyle = true;
  s3ClientSingleton = new S3Client(cfg);
  return s3ClientSingleton;
}

function s3KeyFor(pkg: string, version: string): string {
  return `${SDK_PREFIX}${pkg}/${version}.tgz`;
}

function constantTimeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

function verifyHmacToken(pkg: string, version: string, expiresAt: number, sig: string): boolean {
  if (!HMAC_SECRET) return false;
  if (!Number.isFinite(expiresAt) || expiresAt < Math.floor(Date.now() / 1000)) return false;
  const payload = `${pkg}\n${version}\n${expiresAt}`;
  const expected = crypto.createHmac('sha256', HMAC_SECRET).update(payload).digest('hex');
  return constantTimeEqual(sig, expected);
}

// NV-AUTH-HEADER-001 (2026-05-10): use the canonical extractor from
// src/middleware/jrx-sdk-auth-header.ts. Downloads is the ONE legitimate
// place where a query-param fallback is also accepted (signed one-shot
// URLs for binary downloads where header injection isn't possible). The
// query path is narrowly scoped here; the canonical helper itself
// refuses query params for security reasons. Do NOT generalize this
// pattern to other routes.
import { extractSdkApiKey } from '../middleware/jrx-sdk-auth-header.js';

function extractApiKey(req: Request): string | null {
  const fromHeader = extractSdkApiKey(req);
  if (fromHeader) return fromHeader;
  const q = req.query.api_key;
  if (typeof q === 'string' && q.trim()) return q.trim();
  return null;
}

async function verifySdkApiKey(rawKey: string): Promise<boolean> {
  const keyHash = hashApiKey(rawKey);
  const cached = apiKeyAuthCache.get(keyHash);
  if (cached && Date.now() - cached.cachedAt < API_KEY_CACHE_TTL_MS) {
    return cached.ok;
  }
  if (!db) {
    logger.warn('SDK key verification skipped: db unavailable');
    return false;
  }
  try {
    const rows = await db
      .select({
        isActive: sdkAppApiKeys.isActive,
        expiresAt: sdkAppApiKeys.expiresAt,
      })
      .from(sdkAppApiKeys)
      .where(eq(sdkAppApiKeys.keyHash, keyHash))
      .limit(1);
    const row = rows[0];
    let ok = false;
    if (row && row.isActive) {
      if (!row.expiresAt || new Date(row.expiresAt) > new Date()) {
        ok = true;
      }
    }
    apiKeyAuthCache.set(keyHash, { ok, cachedAt: Date.now() });
    return ok;
  } catch (err: any) {
    logger.error('SDK key verification failed', { err: err?.message });
    return false;
  }
}

async function authorizeDownload(req: Request, pkg: string, version: string): Promise<{ ok: true; via: string } | { ok: false; reason: string; status: number }> {
  if (PUBLIC_DOWNLOADS) return { ok: true, via: 'public' };

  const apiKey = extractApiKey(req);
  if (apiKey) {
    const valid = await verifySdkApiKey(apiKey);
    if (valid) {
      return { ok: true, via: 'sdk_api_key' };
    }
  }

  if (STATIC_DOWNLOAD_TOKEN) {
    const tokenQ = typeof req.query.token === 'string' ? req.query.token : '';
    if (tokenQ && constantTimeEqual(tokenQ, STATIC_DOWNLOAD_TOKEN)) {
      return { ok: true, via: 'static_token' };
    }
  }

  if (HMAC_SECRET && typeof req.query.exp === 'string' && typeof req.query.sig === 'string') {
    const exp = parseInt(req.query.exp, 10);
    if (verifyHmacToken(pkg, version, exp, req.query.sig)) {
      return { ok: true, via: 'hmac_token' };
    }
  }

  return { ok: false, reason: 'authentication_required', status: 401 };
}

async function s3HeadCached(pkg: string, version: string): Promise<S3HeadCacheEntry> {
  const key = s3KeyFor(pkg, version);
  const cached = headCache.get(key);
  if (cached && Date.now() - cached.cachedAt < HEAD_CACHE_TTL_MS) return cached;
  try {
    const { HeadObjectCommand } = await import('@aws-sdk/client-s3');
    const client = await getS3Client();
    const out = await client.send(new HeadObjectCommand({ Bucket: SDK_BUCKET, Key: key }));
    const entry: S3HeadCacheEntry = {
      exists: true,
      size: typeof out.ContentLength === 'number' ? out.ContentLength : undefined,
      etag: typeof out.ETag === 'string' ? out.ETag.replace(/"/g, '') : undefined,
      lastModified: out.LastModified ? new Date(out.LastModified).toISOString() : undefined,
      cachedAt: Date.now(),
    };
    headCache.set(key, entry);
    return entry;
  } catch (err: any) {
    const code = err?.$metadata?.httpStatusCode;
    if (code === 404 || err?.name === 'NotFound' || err?.Code === 'NotFound') {
      const entry: S3HeadCacheEntry = { exists: false, cachedAt: Date.now() };
      headCache.set(key, entry);
      return entry;
    }
    throw err;
  }
}

async function presign(pkg: string, version: string): Promise<string> {
  const { GetObjectCommand } = await import('@aws-sdk/client-s3');
  const { getSignedUrl } = await import('@aws-sdk/s3-request-presigner');
  const client = await getS3Client();
  const cmd = new GetObjectCommand({
    Bucket: SDK_BUCKET,
    Key: s3KeyFor(pkg, version),
    ResponseContentType: 'application/gzip',
    ResponseContentDisposition: `attachment; filename="jurexio-${pkg}-${version}.tgz"`,
  });
  return getSignedUrl(client, cmd, { expiresIn: SIGNED_URL_TTL_SECONDS });
}

async function listManifest(): Promise<ManifestEntry[]> {
  if (manifestCache && Date.now() - manifestCache.cachedAt < MANIFEST_CACHE_TTL_MS) {
    return manifestCache.manifest;
  }
  const { ListObjectsV2Command } = await import('@aws-sdk/client-s3');
  const client = await getS3Client();
  const out: ManifestEntry[] = [];
  for (const pkg of ALLOWED_PACKAGES) {
    const prefix = `${SDK_PREFIX}${pkg}/`;
    let continuationToken: string | undefined;
    const versions: string[] = [];
    do {
      const resp: any = await client.send(new ListObjectsV2Command({
        Bucket: SDK_BUCKET,
        Prefix: prefix,
        ContinuationToken: continuationToken,
        MaxKeys: 1000,
      }));
      for (const obj of (resp.Contents || [])) {
        const key: string = obj.Key || '';
        const m = key.match(/\/([^/]+)\.tgz$/);
        if (m && VERSION_RE.test(m[1])) versions.push(m[1]);
      }
      continuationToken = resp.IsTruncated ? resp.NextContinuationToken : undefined;
    } while (continuationToken);
    if (versions.length > 0) {
      versions.sort((a, b) => {
        const av = a.split(/[-+]/)[0].split('.').map(Number);
        const bv = b.split(/[-+]/)[0].split('.').map(Number);
        for (let i = 0; i < 3; i++) {
          if ((av[i] || 0) !== (bv[i] || 0)) return (bv[i] || 0) - (av[i] || 0);
        }
        return b.localeCompare(a);
      });
      out.push({ package: pkg, versions, latest: versions[0] });
    } else {
      out.push({ package: pkg, versions: [], latest: '' });
    }
  }
  manifestCache = { manifest: out, cachedAt: Date.now() };
  return out;
}

function clientIp(req: Request): string {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string') return fwd.split(',')[0].trim();
  return req.socket.remoteAddress || '';
}

export const sdkDownloadsRouter = Router();

sdkDownloadsRouter.get('/health', (_req, res) => {
  res.json({
    ok: true,
    bucket: SDK_BUCKET,
    prefix: SDK_PREFIX,
    region: process.env.JRX_S3_REGION || JRX_STORAGE.s3.region || 'ap-south-1',
    packages: Array.from(ALLOWED_PACKAGES),
    signed_url_ttl_seconds: SIGNED_URL_TTL_SECONDS,
    public_downloads: PUBLIC_DOWNLOADS,
    auth_modes: [
      'sdk_api_key (Authorization: Bearer nyv_test_sk_…)',
      STATIC_DOWNLOAD_TOKEN ? 'static_token (?token=…)' : null,
      HMAC_SECRET ? 'hmac_token (?exp=…&sig=…)' : null,
      PUBLIC_DOWNLOADS ? 'public' : null,
    ].filter(Boolean),
  });
});

sdkDownloadsRouter.get('/manifest.json', async (_req, res) => {
  try {
    const manifest = await listManifest();
    res.set('Cache-Control', 'public, max-age=60');
    res.json({
      bucket: SDK_BUCKET,
      prefix: SDK_PREFIX,
      generated_at: new Date().toISOString(),
      packages: manifest,
    });
  } catch (err: any) {
    logger.error('Failed to list manifest', { err: err?.message });
    res.status(500).json({ error: 'manifest_unavailable' });
  }
});

sdkDownloadsRouter.get('/:package/:versionFile', async (req: Request, res: Response) => {
  const pkg = String(req.params.package || '');
  const versionFile = String(req.params.versionFile || '');

  if (!PACKAGE_RE.test(pkg) || !ALLOWED_PACKAGES.has(pkg)) {
    res.status(404).json({ error: 'package_not_found', package: pkg, allowed: Array.from(ALLOWED_PACKAGES) });
    return;
  }
  if (!versionFile.endsWith('.tgz')) {
    res.status(400).json({ error: 'invalid_filename', message: 'expected <version>.tgz' });
    return;
  }
  const version = versionFile.slice(0, -'.tgz'.length);
  if (!VERSION_RE.test(version)) {
    res.status(400).json({ error: 'invalid_version', version, expected_format: 'MAJOR.MINOR.PATCH[-prerelease]' });
    return;
  }

  const auth = await authorizeDownload(req, pkg, version);
  if (!auth.ok) {
    res.status(auth.status).json({ error: auth.reason });
    return;
  }

  let head: S3HeadCacheEntry;
  try {
    head = await s3HeadCached(pkg, version);
  } catch (err: any) {
    logger.error('S3 HEAD failed', { pkg, version, err: err?.message });
    res.status(502).json({ error: 's3_unavailable' });
    return;
  }
  if (!head.exists) {
    res.status(404).json({
      error: 'version_not_found',
      package: pkg,
      version,
      hint: `Upload via: npx tsx scripts/jrx-publish-sdk-tarballs.ts --package ${pkg} --version ${version}`,
    });
    return;
  }

  let url: string;
  try {
    url = await presign(pkg, version);
  } catch (err: any) {
    logger.error('Presign failed', { pkg, version, err: err?.message });
    res.status(502).json({ error: 'presign_failed' });
    return;
  }

  logger.info('sdk_download_redirect', {
    pkg,
    version,
    bytes: head.size,
    via: auth.via,
    ip: clientIp(req),
    user_agent: req.headers['user-agent'],
    ttl_seconds: SIGNED_URL_TTL_SECONDS,
  });

  res.set('Cache-Control', 'no-store');
  if (head.etag) res.set('ETag', head.etag);
  if (head.lastModified) res.set('X-Sdk-Last-Modified', head.lastModified);
  if (typeof head.size === 'number') res.set('X-Sdk-Content-Length', String(head.size));
  res.redirect(302, url);
});

sdkDownloadsRouter.head('/:package/:versionFile', async (req: Request, res: Response) => {
  const pkg = String(req.params.package || '');
  const versionFile = String(req.params.versionFile || '');
  if (!ALLOWED_PACKAGES.has(pkg) || !versionFile.endsWith('.tgz')) {
    res.status(404).end();
    return;
  }
  const version = versionFile.slice(0, -'.tgz'.length);
  if (!VERSION_RE.test(version)) {
    res.status(400).end();
    return;
  }
  try {
    const head = await s3HeadCached(pkg, version);
    if (!head.exists) {
      res.status(404).end();
      return;
    }
    if (head.etag) res.set('ETag', head.etag);
    if (typeof head.size === 'number') res.set('Content-Length', String(head.size));
    if (head.lastModified) res.set('Last-Modified', new Date(head.lastModified).toUTCString());
    res.set('Content-Type', 'application/gzip');
    res.status(200).end();
  } catch {
    res.status(502).end();
  }
});

export default sdkDownloadsRouter;
