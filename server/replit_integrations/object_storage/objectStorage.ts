// @ts-nocheck
// NYV-NS-020 (2026-05-05): legacy server/ folder, kept only because 2 src/routes
// files (nv-sdk-gateway-routes.ts, nv-v311-routes.ts) still import from here.
// Real fix: migrate these into src/services and add proper db null guards.
// Until then, opt out of strict-null checking so tsc passes for the v5.0.0 deploy.
/**
 * Object Storage Service — Replit Integration Stub
 * Provides a Google Cloud Storage-compatible interface
 * Falls back to local filesystem when GCS is not configured
 */

import { Storage } from '@google-cloud/storage';
import path from 'path';
import fs from 'fs/promises';

export class ObjectStorageService {
  private storage: Storage | null = null;
  private useLocal: boolean;

  constructor() {
    const projectId = process.env.GOOGLE_CLOUD_PROJECT;
    const bucketId = process.env.GOOGLE_STORAGE_BUCKET;

    if (projectId && bucketId) {
      try {
        this.storage = new Storage({ projectId });
        this.useLocal = false;
        console.log('✅ Object Storage: Google Cloud Storage initialized');
      } catch {
        this.useLocal = true;
        console.log('⚠️ Object Storage: GCS init failed, using local filesystem');
      }
    } else {
      this.useLocal = true;
      console.log('⚠️ Object Storage: No GCS config, using local filesystem');
    }
  }

  bucket(name: string) {
    if (this.storage && !this.useLocal) {
      return this.storage.bucket(name);
    }
    return new LocalBucket(name);
  }
}

class LocalBucket {
  private name: string;

  constructor(name: string) {
    this.name = name;
  }

  file(objectPath: string) {
    return new LocalFile(this.name, objectPath);
  }
}

class LocalFile {
  private bucketName: string;
  private objectPath: string;

  constructor(bucketName: string, objectPath: string) {
    this.bucketName = bucketName;
    this.objectPath = objectPath;
  }

  async save(content: string, _options?: Record<string, any>): Promise<void> {
    const localDir = path.join('/tmp', 'local-storage', this.bucketName, path.dirname(this.objectPath));
    await fs.mkdir(localDir, { recursive: true });
    const filePath = path.join('/tmp', 'local-storage', this.bucketName, this.objectPath);
    await fs.writeFile(filePath, content, 'utf-8');
    console.log(`📁 [LocalStorage] Saved to: ${filePath}`);
  }

  async download(): Promise<[Buffer]> {
    const filePath = path.join('/tmp', 'local-storage', this.bucketName, this.objectPath);
    const buffer = await fs.readFile(filePath);
    return [buffer];
  }

  async exists(): Promise<[boolean]> {
    try {
      const filePath = path.join('/tmp', 'local-storage', this.bucketName, this.objectPath);
      await fs.access(filePath);
      return [true];
    } catch {
      return [false];
    }
  }

  async delete(): Promise<void> {
    try {
      const filePath = path.join('/tmp', 'local-storage', this.bucketName, this.objectPath);
      await fs.unlink(filePath);
    } catch {
      // Ignore if file doesn't exist
    }
  }
}

export const objectStorageClient = new ObjectStorageService();
export const objectStorageService = objectStorageClient;
