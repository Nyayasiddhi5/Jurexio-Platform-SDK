import type { Request, Response, NextFunction } from 'express';
import { createHmac } from 'node:crypto';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('./jrx-response-signing');

const SECRET_ENV_VARS = [
  'NV_SDK_RESPONSE_SECRET',
  'JRX_SDK_RESPONSE_SECRET',
  'JRX_NSP_RESPONSE_SECRET',
  'NV_NSP_RESPONSE_SECRET',
] as const;

let warnedMissingSecret = false;
let warnedSkipMode = false;

function getResponseSecret(): string | null {
  for (const name of SECRET_ENV_VARS) {
    const v = process.env[name];
    if (v && v.length >= 32) return v;
  }
  return null;
}

function isNspOriginated(req: Request): boolean {
  if (req.headers['x-nsp-client']) return true;
  if (req.headers['x-nsp-tier']) return true;
  if (req.headers['x-nsp-org']) return true;
  const origin = (req.headers.origin || '') as string;
  return /(^|\.)(nyayasiddhi|nyv|jurexio-citizen)\.(online|com|in)/i.test(origin);
}

export function nvResponseSigningMiddleware(req: Request, res: Response, next: NextFunction): void {
  if (process.env.NV_DISABLE_RESPONSE_SIGNING === '1') {
    if (!warnedSkipMode) {
      logger.warn('response_signing_disabled_by_env');
      warnedSkipMode = true;
    }
    return next();
  }

  if (!isNspOriginated(req)) {
    return next();
  }

  const secret = getResponseSecret();
  if (!secret) {
    if (!warnedMissingSecret) {
      logger.warn('response_signing_secret_missing', { acceptedNames: SECRET_ENV_VARS });
      warnedMissingSecret = true;
    }
    return next();
  }

  const originalSend = res.send.bind(res);
  const originalEnd = res.end.bind(res);
  const originalWrite = res.write.bind(res);
  let signed = false;
  let streaming = false;

  const markStreaming = (): void => {
    if (streaming || signed || res.headersSent) return;
    res.setHeader('X-JRX-Streaming', '1');
    res.setHeader('X-JRX-Signature-Algorithm', 'streaming-no-signature');
    streaming = true;
  };

  const computeAndSetHeaders = (bodyString: string): void => {
    if (signed || streaming || res.headersSent) return;
    const ts = new Date().toISOString();
    const sig = 'sha256=' + createHmac('sha256', secret).update(`${ts}.${bodyString}`).digest('hex');
    res.setHeader('X-JRX-Signature', sig);
    res.setHeader('X-JRX-Timestamp', ts);
    res.setHeader('X-JRX-Signature-Algorithm', 'sha256-ts-body');
    signed = true;
  };

  const toBodyString = (body: any): string => {
    if (body == null) return '';
    if (typeof body === 'string') return body;
    if (Buffer.isBuffer(body)) return body.toString('utf-8');
    try {
      return JSON.stringify(body);
    } catch {
      return String(body);
    }
  };

  (res as any).send = function (body: any): Response {
    try {
      if (!streaming) computeAndSetHeaders(toBodyString(body));
    } catch (err) {
      logger.error('response_signing_failed', { error: (err as Error).message });
    }
    return originalSend(body);
  };

  (res as any).end = function (chunk?: any, encoding?: any, cb?: any): Response {
    try {
      if (chunk !== undefined && !signed && !streaming) {
        computeAndSetHeaders(toBodyString(chunk));
      }
    } catch (err) {
      logger.error('response_signing_failed', { error: (err as Error).message });
    }
    return originalEnd(chunk, encoding, cb);
  };

  // Streaming detection: any direct call to res.write() (SSE / NDJSON / chunked
  // transfer) means the full body cannot be HMAC'd without buffering all chunks
  // in memory. Mark the response as deliberately unsigned via X-JRX-Streaming
  // so NSP's guard can branch on intent rather than accidental absence.
  (res as any).write = function (chunk: any, encoding?: any, cb?: any): boolean {
    try {
      markStreaming();
    } catch (err) {
      logger.error('response_signing_streaming_mark_failed', { error: (err as Error).message });
    }
    return originalWrite(chunk, encoding, cb);
  };

  next();
}
