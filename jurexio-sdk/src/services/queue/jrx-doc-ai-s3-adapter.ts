/**
 * AWS S3 adapter for doc-ai-job-store � drop-in replacement for
 * blob backend for the convert job ledger.
 *
 * Use this on Cursor Cloud / AWS EC2 when JRX_S3_BUCKET / AWS_S3_BUCKET is set.
 * The client uses the AWS SDK default credential chain (instance role / IAM
 * when no explicit keys are provided).
 */

import { createLogger } from '../../utils/logger.js';

const logger = createLogger('doc-ai-s3-adapter');

export type DocAiBlobClient = {
  uploadFromFilename: (key: string, filePath: string) => Promise<{ ok: boolean; error?: { message: string } }>;
  uploadFromBytes: (key: string, buf: Buffer) => Promise<{ ok: boolean; error?: { message: string } }>;
  downloadAsStream: (key: string) => import('node:stream').Readable;
  downloadAsBytes: (key: string) => Promise<{ ok: boolean; value?: Buffer | Buffer[]; error?: { message: string } }>;
  delete: (key: string) => Promise<void>;
  list: (opts: { prefix: string }) => Promise<{
    ok: boolean;
    value?: Array<{ name: string }>;
    error?: { message: string };
  }>;
};

function resolveBucket(): string | null {
  const b = (process.env.JRX_S3_BUCKET || process.env.AWS_S3_BUCKET || '').trim();
  return b || null;
}

function resolveRegion(): string {
  return (
    process.env.JRX_S3_REGION ||
    process.env.AWS_BEDROCK_REGION ||
    process.env.AWS_REGION ||
    'ap-south-1'
  );
}

/** Build S3 client using instance role / default chain, or optional JRX_S3_* keys. */
async function createS3Client(): Promise<any> {
  const { S3Client } = await import('@aws-sdk/client-s3');
  const region = resolveRegion();
  const accessKeyId = (process.env.JRX_S3_ACCESS_KEY_ID || '').trim();
  const secretAccessKey = (process.env.JRX_S3_SECRET_ACCESS_KEY || '').trim();
  if (accessKeyId && secretAccessKey) {
    return new S3Client({
      region,
      credentials: { accessKeyId, secretAccessKey },
    });
  }
  return new S3Client({ region });
}

export async function createAwsS3DocAiBlobClient(): Promise<DocAiBlobClient | null> {
  const bucket = resolveBucket();
  if (!bucket) {
    logger.info('AWS S3 doc-ai adapter skipped � no JRX_S3_BUCKET/AWS_S3_BUCKET');
    return null;
  }

  const s3 = await createS3Client();
  const {
    PutObjectCommand,
    GetObjectCommand,
    DeleteObjectCommand,
    ListObjectsV2Command,
  } = await import('@aws-sdk/client-s3');
  const fs = await import('node:fs');
  const { PassThrough } = await import('node:stream');

  const client: DocAiBlobClient = {
    async uploadFromFilename(key, filePath) {
      try {
        const body = await fs.promises.readFile(filePath);
        await s3.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: body }));
        return { ok: true };
      } catch (e: any) {
        return { ok: false, error: { message: e?.message || String(e) } };
      }
    },

    async uploadFromBytes(key, buf) {
      try {
        await s3.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: buf }));
        return { ok: true };
      } catch (e: any) {
        return { ok: false, error: { message: e?.message || String(e) } };
      }
    },

    downloadAsStream(key) {
      const pass = new PassThrough();
      (async () => {
        try {
          const out = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
          const body = out.Body;
          if (!body) {
            pass.destroy(new Error(`S3 empty body for key ${key}`));
            return;
          }
          if (typeof (body as any).pipe === 'function') {
            (body as NodeJS.ReadableStream).pipe(pass);
          } else if (typeof (body as any).transformToByteArray === 'function') {
            const bytes = await (body as any).transformToByteArray();
            pass.end(Buffer.from(bytes));
          } else {
            pass.destroy(new Error('Unsupported S3 Body type'));
          }
        } catch (e: any) {
          pass.destroy(e instanceof Error ? e : new Error(String(e)));
        }
      })();
      return pass;
    },

    async downloadAsBytes(key) {
      try {
        const out = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
        const body = out.Body;
        if (!body) return { ok: false, error: { message: 'empty body' } };
        let buf: Buffer;
        if (typeof (body as any).transformToByteArray === 'function') {
          buf = Buffer.from(await (body as any).transformToByteArray());
        } else if (typeof (body as any).pipe === 'function') {
          const chunks: Buffer[] = [];
          for await (const chunk of body as AsyncIterable<Buffer>) {
            chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
          }
          buf = Buffer.concat(chunks);
        } else {
          return { ok: false, error: { message: 'unsupported body' } };
        }
        return { ok: true, value: buf };
      } catch (e: any) {
        return { ok: false, error: { message: e?.message || String(e) } };
      }
    },

    async delete(key) {
      await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    },

    async list(opts) {
      try {
        const names: Array<{ name: string }> = [];
        let token: string | undefined;
        do {
          const out = await s3.send(
            new ListObjectsV2Command({
              Bucket: bucket,
              Prefix: opts.prefix,
              ContinuationToken: token,
              MaxKeys: 1000,
            }),
          );
          for (const obj of out.Contents ?? []) {
            if (obj.Key) names.push({ name: obj.Key });
          }
          token = out.IsTruncated ? out.NextContinuationToken : undefined;
        } while (token);
        return { ok: true, value: names };
      } catch (e: any) {
        return { ok: false, error: { message: e?.message || String(e) } };
      }
    },
  };

  logger.info('doc-ai AWS S3 blob client ready', { bucket, region: resolveRegion() });
  return client;
}
