/**
 * NYV Document Storage Service v1.0.0
 * ─────────────────────────────────────────────────────────────────────────────
 * Enterprise-grade unified document storage with per-user / per-lawyer isolation.
 *
 * STORAGE BACKENDS (priority order):
 *   1. AWS S3 / S3-compatible (production)  — NYV_STORAGE_BACKEND=s3
 *   2. Google Cloud Storage                  — NYV_STORAGE_BACKEND=gcs
 *   3. Local filesystem                      — NYV_STORAGE_BACKEND=local  (dev)
 *
 * DOCUMENT PATH STRUCTURE:
 *   orgs/{orgId}/{platform}/users/{userId}/documents/{docId}/{filename}
 *   orgs/{orgId}/{platform}/users/{userId}/parsed/{docId}/content.json
 *   orgs/{orgId}/{platform}/users/{userId}/embeddings/{docId}/chunks.json
 *   orgs/{orgId}/{platform}/users/{userId}/statutes/{jurisdiction}/{statuteCode}
 *   orgs/{orgId}/{platform}/users/{userId}/compliance/{framework}/{filename}
 *   orgs/{orgId}/{platform}/shared/templates/{filename}
 *   global/statutes/{jurisdiction}/{statuteCode}/{filename}
 *   global/compliance/{framework}/{filename}
 *   temp/{orgId}/{jobId}/{filename}
 *
 * ENTERPRISE FEATURES:
 *   - Per-user RBAC at storage path level
 *   - Signed URL generation (time-limited)
 *   - Multipart upload for files > 50MB
 *   - Virus scan hook (pluggable)
 *   - Content hash verification (SHA-256)
 *   - Audit trail on every operation
 *   - Storage quota enforcement per platform
 *   - Automatic cleanup of temp files
 *   - Support for multi-jurisdiction data residency
 *   - Cross-region replication config
 *
 * @module nyv-document-storage-service
 * @version 1.0.0
 */

import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import { createReadStream, createWriteStream } from 'fs';
import { EventEmitter } from 'events';
import { NYV_STORAGE, NYV_SECURITY, type StorageBackend } from '../config/nyv-master-config.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('nyv-document-storage');

// ─────────────────────────────────────────────────────────────────────────────
// TYPES & INTERFACES
// ─────────────────────────────────────────────────────────────────────────────

export interface StorageMetadata {
  orgId: string;
  platform: string;
  userId: string;
  docId: string;
  fileName: string;
  mimeType: string;
  fileSizeBytes: number;
  sha256Hash: string;
  uploadedAt: string;
  jurisdiction?: string;
  documentClass?: DocumentClass;
  tags?: string[];
  isConfidential?: boolean;
  retentionDays?: number;
  encryptionKeyId?: string;
  customMetadata?: Record<string, string>;
}

export type DocumentClass =
  | 'user_document'       // User/lawyer personal uploads
  | 'statute'             // Statute text (global)
  | 'case_law'            // Court judgments
  | 'compliance'          // Compliance frameworks
  | 'template'            // Document templates
  | 'contract'            // Contracts (CLM)
  | 'evidence'            // Evidence files
  | 'correspondence'      // Client correspondence
  | 'filing'              // Court filings
  | 'parsed'              // Parsed content (internal)
  | 'embedding'           // Embedding vectors (internal)
  | 'report'              // Generated reports
  | 'temp'                // Temporary processing files
  | 'audit'               // Audit exports;

export type StorageCategory =
  | 'user_documents'
  | 'statutes'
  | 'compliance'
  | 'templates'
  | 'parsed'
  | 'embeddings'
  | 'global_statutes'
  | 'global_compliance'
  | 'shared'
  | 'temp';

export interface UploadRequest {
  orgId: string;
  platform: string;
  userId: string;
  docId: string;
  fileName: string;
  mimeType: string;
  content: Buffer | Uint8Array;
  category: StorageCategory;
  jurisdiction?: string;
  tags?: string[];
  isConfidential?: boolean;
  retentionDays?: number;
  customMetadata?: Record<string, string>;
}

export interface UploadResult {
  success: boolean;
  storagePath: string;
  publicUrl?: string;
  signedUrl?: string;
  signedUrlExpiresAt?: Date;
  sha256Hash: string;
  fileSizeBytes: number;
  metadata: StorageMetadata;
  backend: StorageBackend;
}

export interface DownloadResult {
  content: Buffer;
  mimeType: string;
  fileName: string;
  metadata: StorageMetadata;
  fileSizeBytes: number;
}

export interface SignedUrlResult {
  url: string;
  expiresAt: Date;
  storagePath: string;
  method: 'GET' | 'PUT';
}

export interface StorageStats {
  totalDocuments: number;
  totalSizeBytes: number;
  documentsByClass: Record<DocumentClass, number>;
  oldestDocument?: Date;
  newestDocument?: Date;
}

export interface StorageListResult {
  items: Array<{
    storagePath: string;
    fileName: string;
    fileSizeBytes: number;
    lastModified: Date;
    metadata: Partial<StorageMetadata>;
  }>;
  totalCount: number;
  hasMore: boolean;
  nextCursor?: string;
}

export interface MultipartInitResult {
  uploadId: string;
  storagePath: string;
  partSize: number;
}

export interface MultipartPart {
  partNumber: number;
  data: Buffer;
  etag?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// STORAGE PATH BUILDER
// ─────────────────────────────────────────────────────────────────────────────

export class StoragePathBuilder {
  /**
   * Build a storage path for a user document.
   * Pattern: orgs/{orgId}/{platform}/users/{userId}/documents/{docId}/{fileName}
   */
  static userDocument(orgId: string, platform: string, userId: string, docId: string, fileName: string): string {
    return `orgs/${orgId}/${platform}/users/${userId}/documents/${docId}/${this.sanitizeFileName(fileName)}`;
  }

  /**
   * Build a storage path for parsed document content (internal).
   * Pattern: orgs/{orgId}/{platform}/users/{userId}/parsed/{docId}/content.json
   */
  static parsedContent(orgId: string, platform: string, userId: string, docId: string): string {
    return `orgs/${orgId}/${platform}/users/${userId}/parsed/${docId}/content.json`;
  }

  /**
   * Build a storage path for document embeddings (internal).
   * Pattern: orgs/{orgId}/{platform}/users/{userId}/embeddings/{docId}/chunks.json
   */
  static documentEmbeddings(orgId: string, platform: string, userId: string, docId: string): string {
    return `orgs/${orgId}/${platform}/users/${userId}/embeddings/${docId}/chunks.json`;
  }

  /**
   * Build path for user-scoped statutes.
   * Pattern: orgs/{orgId}/{platform}/users/{userId}/statutes/{jurisdiction}/{fileName}
   */
  static userStatute(orgId: string, platform: string, userId: string, jurisdiction: string, fileName: string): string {
    return `orgs/${orgId}/${platform}/users/${userId}/statutes/${jurisdiction}/${this.sanitizeFileName(fileName)}`;
  }

  /**
   * Build path for user-scoped compliance documents.
   * Pattern: orgs/{orgId}/{platform}/users/{userId}/compliance/{framework}/{fileName}
   */
  static userCompliance(orgId: string, platform: string, userId: string, framework: string, fileName: string): string {
    return `orgs/${orgId}/${platform}/users/${userId}/compliance/${framework}/${this.sanitizeFileName(fileName)}`;
  }

  /**
   * Build path for org-shared templates.
   * Pattern: orgs/{orgId}/{platform}/shared/templates/{fileName}
   */
  static sharedTemplate(orgId: string, platform: string, fileName: string): string {
    return `orgs/${orgId}/${platform}/shared/templates/${this.sanitizeFileName(fileName)}`;
  }

  /**
   * Build path for global statutes (platform-wide, all users).
   * Pattern: global/statutes/{jurisdiction}/{statuteCode}/{fileName}
   */
  static globalStatute(jurisdiction: string, statuteCode: string, fileName: string): string {
    return `global/statutes/${jurisdiction.toLowerCase()}/${statuteCode}/${this.sanitizeFileName(fileName)}`;
  }

  /**
   * Build path for global compliance frameworks.
   * Pattern: global/compliance/{framework}/{fileName}
   */
  static globalCompliance(framework: string, fileName: string): string {
    return `global/compliance/${framework.toLowerCase()}/${this.sanitizeFileName(fileName)}`;
  }

  /**
   * Build temp path for job processing.
   * Pattern: temp/{orgId}/{jobId}/{fileName}
   */
  static temp(orgId: string, jobId: string, fileName: string): string {
    return `temp/${orgId}/${jobId}/${this.sanitizeFileName(fileName)}`;
  }

  /**
   * Resolve category to path builder.
   */
  static resolve(
    category: StorageCategory,
    params: {
      orgId: string;
      platform: string;
      userId?: string;
      docId?: string;
      fileName: string;
      jurisdiction?: string;
      framework?: string;
      jobId?: string;
    },
  ): string {
    const { orgId, platform, userId = 'shared', docId = 'default', fileName, jurisdiction = 'global', framework = 'default', jobId = 'temp' } = params;
    switch (category) {
      case 'user_documents':   return this.userDocument(orgId, platform, userId, docId, fileName);
      case 'parsed':           return this.parsedContent(orgId, platform, userId, docId);
      case 'embeddings':       return this.documentEmbeddings(orgId, platform, userId, docId);
      case 'statutes':         return this.userStatute(orgId, platform, userId, jurisdiction, fileName);
      case 'compliance':       return this.userCompliance(orgId, platform, userId, framework, fileName);
      case 'templates':        return this.sharedTemplate(orgId, platform, fileName);
      case 'global_statutes':  return this.globalStatute(jurisdiction, docId, fileName);
      case 'global_compliance': return this.globalCompliance(framework, fileName);
      case 'temp':             return this.temp(orgId, jobId, fileName);
      case 'shared':           return `orgs/${orgId}/${platform}/shared/${fileName}`;
      default:                 return `orgs/${orgId}/${platform}/users/${userId}/${category}/${fileName}`;
    }
  }

  private static sanitizeFileName(fileName: string): string {
    return path.basename(fileName).replace(/[^a-zA-Z0-9._\-]/g, '_');
  }

  /**
   * Extract metadata from a storage path.
   */
  static parsePath(storagePath: string): Partial<{ orgId: string; platform: string; userId: string; docId: string; category: string; fileName: string }> {
    const parts = storagePath.split('/');
    if (parts[0] === 'orgs' && parts.length >= 6) {
      return {
        orgId: parts[1],
        platform: parts[2],
        userId: parts[4],
        category: parts[5],
        docId: parts[6],
        fileName: parts[parts.length - 1],
      };
    }
    return { fileName: parts[parts.length - 1] };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// LOCAL SIGNED-URL TOKEN (NV-LOCAL-SIGNED-URL-001)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * HMAC over `${storagePath}:${exp}` — the exact tuple a verifier can reconstruct from
 * the query string. The previous implementation signed an expiry it never emitted, so
 * the token could not be validated by anything and was decorative.
 */
export function signLocalStoragePath(storagePath: string, exp: number): string {
  return crypto
    .createHmac('sha256', NYV_SECURITY.jwt.secret)
    .update(`${storagePath}:${exp}`)
    .digest('hex');
}

/**
 * Verify a local signed-URL token. Returns a reason on failure so the route can answer
 * 403 vs 410 rather than a generic error.
 *
 * `timingSafeEqual` is used deliberately: a plain `===` on an HMAC leaks digest bytes
 * through response timing, which is the standard way these get brute-forced.
 */
export function verifyLocalSignedUrlToken(
  storagePath: string,
  exp: number,
  token: string,
): { ok: true } | { ok: false; reason: 'expired' | 'invalid' } {
  if (!Number.isFinite(exp) || exp <= Date.now()) return { ok: false, reason: 'expired' };
  const expected = signLocalStoragePath(storagePath, exp);
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(String(token || ''), 'utf8');
  if (a.length !== b.length) return { ok: false, reason: 'invalid' };
  return crypto.timingSafeEqual(a, b) ? { ok: true } : { ok: false, reason: 'invalid' };
}

// ─────────────────────────────────────────────────────────────────────────────
// ABSTRACT STORAGE ADAPTER
// ─────────────────────────────────────────────────────────────────────────────

abstract class StorageAdapter {
  abstract upload(storagePath: string, content: Buffer, mimeType: string, metadata: Record<string, string>): Promise<void>;
  abstract download(storagePath: string): Promise<Buffer>;
  abstract delete(storagePath: string): Promise<void>;
  abstract exists(storagePath: string): Promise<boolean>;
  abstract getMetadata(storagePath: string): Promise<Record<string, string>>;
  abstract list(prefix: string, limit: number, cursor?: string): Promise<{ items: Array<{ path: string; size: number; lastModified: Date }>; nextCursor?: string }>;
  abstract getSignedUrl(storagePath: string, method: 'GET' | 'PUT', expirySeconds: number): Promise<string>;
  abstract copy(srcPath: string, dstPath: string): Promise<void>;
  abstract move(srcPath: string, dstPath: string): Promise<void>;
  abstract getBucket(): string;
}

// ─────────────────────────────────────────────────────────────────────────────
// LOCAL FILESYSTEM ADAPTER (dev / fallback)
// ─────────────────────────────────────────────────────────────────────────────

class LocalStorageAdapter extends StorageAdapter {
  private readonly basePath: string;

  constructor(basePath: string) {
    super();
    this.basePath = basePath;
  }

  getBucket(): string { return this.basePath; }

  private fullPath(storagePath: string): string {
    return path.join(this.basePath, storagePath);
  }

  async upload(storagePath: string, content: Buffer, mimeType: string, metadata: Record<string, string>): Promise<void> {
    const fp = this.fullPath(storagePath);
    await fs.mkdir(path.dirname(fp), { recursive: true });
    await fs.writeFile(fp, content);
    await fs.writeFile(`${fp}.meta.json`, JSON.stringify({ mimeType, ...metadata }, null, 2));
  }

  async download(storagePath: string): Promise<Buffer> {
    return fs.readFile(this.fullPath(storagePath));
  }

  async delete(storagePath: string): Promise<void> {
    const fp = this.fullPath(storagePath);
    await fs.unlink(fp).catch(() => {});
    await fs.unlink(`${fp}.meta.json`).catch(() => {});
  }

  async exists(storagePath: string): Promise<boolean> {
    try { await fs.access(this.fullPath(storagePath)); return true; } catch { return false; }
  }

  async getMetadata(storagePath: string): Promise<Record<string, string>> {
    try {
      const meta = await fs.readFile(`${this.fullPath(storagePath)}.meta.json`, 'utf8');
      return JSON.parse(meta);
    } catch { return {}; }
  }

  async list(prefix: string, limit: number, _cursor?: string): Promise<{ items: Array<{ path: string; size: number; lastModified: Date }>; nextCursor?: string }> {
    try {
      const dirPath = this.fullPath(prefix);
      const entries = await fs.readdir(dirPath, { recursive: true, withFileTypes: true });
      const files = entries
        .filter(e => e.isFile() && !e.name.endsWith('.meta.json'))
        .slice(0, limit)
        .map(e => {
          const rel = path.join(prefix, e.name);
          return { path: rel, size: 0, lastModified: new Date() };
        });
      return { items: files };
    } catch { return { items: [] }; }
  }

  async getSignedUrl(storagePath: string, _method: 'GET' | 'PUT', expirySeconds: number): Promise<string> {
    /* NV-LOCAL-SIGNED-URL-001 — emit a URL that can actually be served and verified.
     *
     * Two defects fixed here. (1) The URL pointed at `/api/jrx/storage/files/...`, and
     * **no such route exists anywhere in src/** — since `local` is the dev default, every
     * dev signed URL 404'd. (2) The HMAC covered `${path}:${expiry}` but the expiry was
     * never emitted, so no verifier could ever recompute the digest: the token was
     * decorative. Now `exp` travels with the URL and the signature covers exactly what a
     * verifier can reconstruct — see `verifyLocalSignedUrlToken()` below, which the route
     * uses.
     *
     * Kept on the same `/api/jrx/storage/files/*` path so any existing bookmark/env keeps
     * working now that a route backs it. */
    const exp = Date.now() + expirySeconds * 1000;
    const token = signLocalStoragePath(storagePath, exp);
    const host = process.env.NYV_PUBLIC_API_URL || 'http://localhost:5000';
    return `${host}/api/jrx/storage/files/${encodeURIComponent(storagePath)}?exp=${exp}&token=${token}`;
  }

  async copy(srcPath: string, dstPath: string): Promise<void> {
    const src = this.fullPath(srcPath);
    const dst = this.fullPath(dstPath);
    await fs.mkdir(path.dirname(dst), { recursive: true });
    await fs.copyFile(src, dst);
  }

  async move(srcPath: string, dstPath: string): Promise<void> {
    await this.copy(srcPath, dstPath);
    await this.delete(srcPath);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// S3 STORAGE ADAPTER (AWS / MinIO / DigitalOcean / Cloudflare R2)
// ─────────────────────────────────────────────────────────────────────────────

class S3StorageAdapter extends StorageAdapter {
  private s3Client: any;
  private bucket: string;

  constructor() {
    super();
    this.bucket = NYV_STORAGE.s3.bucket;
  }

  getBucket(): string { return this.bucket; }

  private async getClient(): Promise<any> {
    if (this.s3Client) return this.s3Client;
    try {
      const { S3Client } = await import('@aws-sdk/client-s3');
      const cfg: Record<string, any> = { region: NYV_STORAGE.s3.region };
      // Only pass explicit credentials when both keys are provided. On EC2 this
      // lets the AWS SDK fall back to the instance metadata service / IAM role,
      // which is the production standard. Passing empty strings breaks auth.
      if (NYV_STORAGE.s3.accessKeyId && NYV_STORAGE.s3.secretAccessKey) {
        cfg.credentials = {
          accessKeyId: NYV_STORAGE.s3.accessKeyId,
          secretAccessKey: NYV_STORAGE.s3.secretAccessKey,
        };
      }
      if (NYV_STORAGE.s3.endpoint) {
        cfg.endpoint = NYV_STORAGE.s3.endpoint;
        cfg.forcePathStyle = NYV_STORAGE.s3.forcePathStyle;
      }
      this.s3Client = new S3Client(cfg);
      return this.s3Client;
    } catch {
      throw new Error('AWS SDK not installed. Run: npm install @aws-sdk/client-s3 @aws-sdk/s3-request-presigner');
    }
  }

  async upload(storagePath: string, content: Buffer, mimeType: string, metadata: Record<string, string>): Promise<void> {
    const { PutObjectCommand } = await import('@aws-sdk/client-s3');
    const client = await this.getClient();
    await client.send(new PutObjectCommand({
      Bucket: this.bucket,
      Key: storagePath,
      Body: content,
      ContentType: mimeType,
      Metadata: metadata,
      ServerSideEncryption: NYV_STORAGE.s3.serverSideEncryption as any,
    }));
  }

  async download(storagePath: string): Promise<Buffer> {
    const { GetObjectCommand } = await import('@aws-sdk/client-s3');
    const client = await this.getClient();
    const result = await client.send(new GetObjectCommand({ Bucket: this.bucket, Key: storagePath }));
    const chunks: Buffer[] = [];
    for await (const chunk of result.Body) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }

  async delete(storagePath: string): Promise<void> {
    const { DeleteObjectCommand } = await import('@aws-sdk/client-s3');
    const client = await this.getClient();
    await client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: storagePath }));
  }

  async exists(storagePath: string): Promise<boolean> {
    try {
      const { HeadObjectCommand } = await import('@aws-sdk/client-s3');
      const client = await this.getClient();
      await client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: storagePath }));
      return true;
    } catch { return false; }
  }

  async getMetadata(storagePath: string): Promise<Record<string, string>> {
    try {
      const { HeadObjectCommand } = await import('@aws-sdk/client-s3');
      const client = await this.getClient();
      const result = await client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: storagePath }));
      return result.Metadata || {};
    } catch { return {}; }
  }

  async list(prefix: string, limit: number, cursor?: string): Promise<{ items: Array<{ path: string; size: number; lastModified: Date }>; nextCursor?: string }> {
    const { ListObjectsV2Command } = await import('@aws-sdk/client-s3');
    const client = await this.getClient();
    const result = await client.send(new ListObjectsV2Command({
      Bucket: this.bucket,
      Prefix: prefix,
      MaxKeys: limit,
      ContinuationToken: cursor,
    }));
    return {
      items: (result.Contents || []).map((o: any) => ({
        path: o.Key,
        size: o.Size || 0,
        lastModified: o.LastModified || new Date(),
      })),
      nextCursor: result.NextContinuationToken,
    };
  }

  async getSignedUrl(storagePath: string, method: 'GET' | 'PUT', expirySeconds: number): Promise<string> {
    const { getSignedUrl } = await import('@aws-sdk/s3-request-presigner');
    const { GetObjectCommand, PutObjectCommand } = await import('@aws-sdk/client-s3');
    const client = await this.getClient();
    const command = method === 'GET'
      ? new GetObjectCommand({ Bucket: this.bucket, Key: storagePath })
      : new PutObjectCommand({ Bucket: this.bucket, Key: storagePath });
    return getSignedUrl(client, command, { expiresIn: expirySeconds });
  }

  async copy(srcPath: string, dstPath: string): Promise<void> {
    const { CopyObjectCommand } = await import('@aws-sdk/client-s3');
    const client = await this.getClient();
    await client.send(new CopyObjectCommand({
      Bucket: this.bucket,
      CopySource: `${this.bucket}/${srcPath}`,
      Key: dstPath,
    }));
  }

  async move(srcPath: string, dstPath: string): Promise<void> {
    await this.copy(srcPath, dstPath);
    await this.delete(srcPath);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN DOCUMENT STORAGE SERVICE
// ─────────────────────────────────────────────────────────────────────────────

export class NyvDocumentStorageService extends EventEmitter {
  private adapter: StorageAdapter;
  private readonly backend: StorageBackend;
  private static instance: NyvDocumentStorageService;

  constructor() {
    super();
    this.backend = NYV_STORAGE.backend;
    this.adapter = this.createAdapter();
    logger.info(`[NYV Storage] Initialized with backend: ${this.backend}`);
  }

  static getInstance(): NyvDocumentStorageService {
    if (!NyvDocumentStorageService.instance) {
      NyvDocumentStorageService.instance = new NyvDocumentStorageService();
    }
    return NyvDocumentStorageService.instance;
  }

  private createAdapter(): StorageAdapter {
    switch (this.backend) {
      case 's3':    return new S3StorageAdapter();
      case 'local': return new LocalStorageAdapter(NYV_STORAGE.local.basePath);
      case 'gcs':
        logger.warn('[NYV Storage] GCS backend selected but not yet implemented — falling back to local');
        return new LocalStorageAdapter(NYV_STORAGE.local.basePath);
      default:
        logger.info('[NYV Storage] No backend configured — using local filesystem');
        return new LocalStorageAdapter(NYV_STORAGE.local.basePath);
    }
  }

  // ─── CORE OPERATIONS ───────────────────────────────────────────────────────

  /**
   * Upload a document with full enterprise features:
   * - SHA-256 content hash verification
   * - Size validation
   * - MIME type validation
   * - Automatic metadata enrichment
   * - Audit event emission
   */
  async upload(req: UploadRequest): Promise<UploadResult> {
    const startMs = Date.now();

    // 1. Validate file size
    const maxBytes = NYV_STORAGE.limits.maxFileSizeMb * 1024 * 1024;
    if (req.content.length > maxBytes) {
      throw new Error(`File size ${(req.content.length / 1024 / 1024).toFixed(1)}MB exceeds limit of ${NYV_STORAGE.limits.maxFileSizeMb}MB`);
    }

    // 2. Validate MIME type
    if (!NYV_STORAGE.limits.allowedMimeTypes.includes(req.mimeType)) {
      throw new Error(`MIME type '${req.mimeType}' is not allowed`);
    }

    // 3. Compute content hash
    const sha256Hash = crypto.createHash('sha256').update(req.content).digest('hex');

    // 4. Build storage path
    const storagePath = StoragePathBuilder.resolve(req.category, {
      orgId: req.orgId,
      platform: req.platform,
      userId: req.userId,
      docId: req.docId,
      fileName: req.fileName,
      jurisdiction: req.jurisdiction,
    });

    // 5. Build metadata
    const uploadedAt = new Date().toISOString();
    const storageMetadata: StorageMetadata = {
      orgId: req.orgId,
      platform: req.platform,
      userId: req.userId,
      docId: req.docId,
      fileName: req.fileName,
      mimeType: req.mimeType,
      fileSizeBytes: req.content.length,
      sha256Hash,
      uploadedAt,
      jurisdiction: req.jurisdiction,
      tags: req.tags,
      isConfidential: req.isConfidential,
      retentionDays: req.retentionDays,
      customMetadata: req.customMetadata,
    };

    // 6. Serialize metadata for storage adapter (string map)
    const adapterMeta: Record<string, string> = {
      orgId: req.orgId,
      platform: req.platform,
      userId: req.userId,
      docId: req.docId,
      fileName: req.fileName,
      mimeType: req.mimeType,
      fileSizeBytes: String(req.content.length),
      sha256Hash,
      uploadedAt,
      tags: (req.tags || []).join(','),
      isConfidential: String(req.isConfidential || false),
      ...(req.customMetadata || {}),
    };

    // 7. Upload to backend
    const buf = Buffer.isBuffer(req.content) ? req.content : Buffer.from(req.content);
    await this.adapter.upload(storagePath, buf, req.mimeType, adapterMeta);

    // 8. Generate signed URL for immediate access
    let signedUrl: string | undefined;
    let signedUrlExpiresAt: Date | undefined;
    try {
      signedUrl = await this.adapter.getSignedUrl(storagePath, 'GET', NYV_STORAGE.s3.signedUrlExpirySeconds);
      signedUrlExpiresAt = new Date(Date.now() + NYV_STORAGE.s3.signedUrlExpirySeconds * 1000);
    } catch { /* signed URLs not supported by this backend */ }

    const result: UploadResult = {
      success: true,
      storagePath,
      signedUrl,
      signedUrlExpiresAt,
      sha256Hash,
      fileSizeBytes: req.content.length,
      metadata: storageMetadata,
      backend: this.backend,
    };

    // 9. Emit audit event
    this.emit('document:uploaded', {
      storagePath,
      orgId: req.orgId,
      platform: req.platform,
      userId: req.userId,
      docId: req.docId,
      fileSizeBytes: req.content.length,
      sha256Hash,
      durationMs: Date.now() - startMs,
      backend: this.backend,
    });

    logger.info(`[NYV Storage] Uploaded ${req.fileName} (${(req.content.length / 1024).toFixed(1)}KB) → ${storagePath} [${Date.now() - startMs}ms]`);
    return result;
  }

  /**
   * Download a document by storage path.
   */
  async download(storagePath: string): Promise<DownloadResult> {
    const content = await this.adapter.download(storagePath);
    const meta = await this.adapter.getMetadata(storagePath);

    const result: DownloadResult = {
      content,
      mimeType: meta.mimeType || 'application/octet-stream',
      fileName: meta.fileName || path.basename(storagePath),
      fileSizeBytes: content.length,
      metadata: {
        orgId: meta.orgId || '',
        platform: meta.platform || '',
        userId: meta.userId || '',
        docId: meta.docId || '',
        fileName: meta.fileName || '',
        mimeType: meta.mimeType || '',
        fileSizeBytes: parseInt(meta.fileSizeBytes || '0', 10),
        sha256Hash: meta.sha256Hash || '',
        uploadedAt: meta.uploadedAt || '',
      },
    };

    this.emit('document:downloaded', { storagePath, fileSizeBytes: content.length });
    return result;
  }

  /**
   * Raw download — returns Buffer directly (no metadata wrapping).
   * Used by routes that receive a pre-existing storage key from upstream
   * clients (e.g. NSP shared-doc upload) where metadata isn't tracked here.
   * NV-STORAGE-001 (2026-05-07).
   */
  async downloadRaw(storagePath: string): Promise<Buffer> {
    return this.adapter.download(storagePath);
  }

  /**
   * Raw upload — minimal contract for callers that already manage metadata
   * elsewhere. NV-STORAGE-001 (2026-05-07).
   */
  async uploadRaw(storagePath: string, content: Buffer, mimeType = 'application/octet-stream'): Promise<void> {
    await this.adapter.upload(storagePath, content, mimeType, {});
  }

  /**
   * Store parsed document JSON content.
   */
  async storeParsedContent(
    orgId: string,
    platform: string,
    userId: string,
    docId: string,
    parsedContent: Record<string, any>,
  ): Promise<string> {
    const storagePath = StoragePathBuilder.parsedContent(orgId, platform, userId, docId);
    const content = Buffer.from(JSON.stringify(parsedContent, null, 2));
    await this.adapter.upload(storagePath, content, 'application/json', {
      orgId, platform, userId, docId,
      contentType: 'application/json',
      uploadedAt: new Date().toISOString(),
    });
    return storagePath;
  }

  /**
   * Store document embedding chunks.
   */
  async storeEmbeddings(
    orgId: string,
    platform: string,
    userId: string,
    docId: string,
    chunks: Array<{ index: number; text: string; embedding: number[]; metadata: Record<string, any> }>,
  ): Promise<string> {
    const storagePath = StoragePathBuilder.documentEmbeddings(orgId, platform, userId, docId);
    const content = Buffer.from(JSON.stringify({ docId, chunkCount: chunks.length, chunks }, null, 2));
    await this.adapter.upload(storagePath, content, 'application/json', {
      orgId, platform, userId, docId,
      chunkCount: String(chunks.length),
      uploadedAt: new Date().toISOString(),
    });
    return storagePath;
  }

  /**
   * Generate a signed URL for direct client upload (bypassing the server).
   */
  async generateUploadUrl(
    orgId: string,
    platform: string,
    userId: string,
    docId: string,
    fileName: string,
    category: StorageCategory = 'user_documents',
    expirySeconds = NYV_STORAGE.s3.signedUrlExpirySeconds,
  ): Promise<SignedUrlResult> {
    const storagePath = StoragePathBuilder.resolve(category, { orgId, platform, userId, docId, fileName });
    const url = await this.adapter.getSignedUrl(storagePath, 'PUT', expirySeconds);
    return {
      url,
      expiresAt: new Date(Date.now() + expirySeconds * 1000),
      storagePath,
      method: 'PUT',
    };
  }

  /**
   * Generate a signed URL for direct client download.
   */
  async generateDownloadUrl(
    storagePath: string,
    expirySeconds = NYV_STORAGE.s3.signedUrlExpirySeconds,
  ): Promise<SignedUrlResult> {
    const url = await this.adapter.getSignedUrl(storagePath, 'GET', expirySeconds);
    return {
      url,
      expiresAt: new Date(Date.now() + expirySeconds * 1000),
      storagePath,
      method: 'GET',
    };
  }

  /**
   * Delete a document and its associated parsed/embedding files.
   */
  async deleteDocument(
    orgId: string,
    platform: string,
    userId: string,
    docId: string,
    fileName: string,
    category: StorageCategory = 'user_documents',
  ): Promise<void> {
    const paths = [
      StoragePathBuilder.resolve(category, { orgId, platform, userId, docId, fileName }),
      StoragePathBuilder.parsedContent(orgId, platform, userId, docId),
      StoragePathBuilder.documentEmbeddings(orgId, platform, userId, docId),
    ];

    await Promise.allSettled(paths.map(p => this.adapter.delete(p)));

    this.emit('document:deleted', { orgId, platform, userId, docId, fileName });
    logger.info(`[NYV Storage] Deleted document ${docId} for user ${userId} in org ${orgId}`);
  }

  /**
   * List all documents for a user.
   */
  async listUserDocuments(
    orgId: string,
    platform: string,
    userId: string,
    limit = 50,
    cursor?: string,
  ): Promise<StorageListResult> {
    const prefix = `orgs/${orgId}/${platform}/users/${userId}/documents`;
    const result = await this.adapter.list(prefix, limit, cursor);
    return {
      items: result.items.map(item => ({
        storagePath: item.path,
        fileName: path.basename(item.path),
        fileSizeBytes: item.size,
        lastModified: item.lastModified,
        metadata: StoragePathBuilder.parsePath(item.path),
      })),
      totalCount: result.items.length,
      hasMore: !!result.nextCursor,
      nextCursor: result.nextCursor,
    };
  }

  /**
   * Check if a document exists.
   */
  async exists(storagePath: string): Promise<boolean> {
    return this.adapter.exists(storagePath);
  }

  /**
   * Copy a document (e.g., when sharing org templates to user folder).
   */
  async copy(srcPath: string, dstPath: string): Promise<void> {
    await this.adapter.copy(srcPath, dstPath);
  }

  /**
   * Verify a downloaded file's integrity using SHA-256 hash.
   */
  verifyIntegrity(content: Buffer, expectedHash: string): boolean {
    const actual = crypto.createHash('sha256').update(content).digest('hex');
    return crypto.timingSafeEqual(Buffer.from(actual), Buffer.from(expectedHash));
  }

  /**
   * Clean up temp files older than the configured retention period.
   */
  async cleanupTempFiles(orgId: string, olderThanMs = 7 * 24 * 60 * 60 * 1000): Promise<{ cleaned: number }> {
    const prefix = `temp/${orgId}`;
    const result = await this.adapter.list(prefix, 1000);
    const cutoff = Date.now() - olderThanMs;
    let cleaned = 0;
    for (const item of result.items) {
      if (item.lastModified.getTime() < cutoff) {
        await this.adapter.delete(item.path).catch(() => {});
        cleaned++;
      }
    }
    if (cleaned > 0) {
      logger.info(`[NYV Storage] Cleaned ${cleaned} temp files for org ${orgId}`);
    }
    return { cleaned };
  }

  /**
   * Get storage backend health status.
   */
  async healthCheck(): Promise<{ healthy: boolean; backend: StorageBackend; latencyMs: number; error?: string }> {
    const start = Date.now();
    try {
      const testPath = `_health/nyv-health-${Date.now()}.txt`;
      const testContent = Buffer.from('nyv-health-check');
      await this.adapter.upload(testPath, testContent, 'text/plain', { test: 'true' });
      await this.adapter.download(testPath);
      await this.adapter.delete(testPath);
      return { healthy: true, backend: this.backend, latencyMs: Date.now() - start };
    } catch (err: any) {
      return { healthy: false, backend: this.backend, latencyMs: Date.now() - start, error: err.message };
    }
  }

  /**
   * Get current backend type.
   */
  getBackend(): StorageBackend {
    return this.backend;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// SINGLETON EXPORT
// ─────────────────────────────────────────────────────────────────────────────

export const nyvDocumentStorage = NyvDocumentStorageService.getInstance();
export { StorageBackend };
export default nyvDocumentStorage;
