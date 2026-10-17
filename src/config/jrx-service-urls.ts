/**
 * JRX Service URLs — centralised internal service URL registry
 * ALL internal service URLs live here. NEVER use localhost hardcoded elsewhere.
 *
 * GUARDRAIL: Any new service URL MUST be added here and read from env.
 * Pattern: process.env.SERVICE_URL || fallback_only_for_local_dev
 *
 * @file src/config/jrx-service-urls.ts
 */

const isDev = process.env.NODE_ENV !== 'production';

export const NV_SERVICE_URLS = {
  gateway: process.env.JRX_GATEWAY_URL || (isDev ? 'http://localhost:5000' : ''),

  jurexio-citizen: process.env.JRX_NYAYAMITRA_URL || process.env.NM_API_URL || (isDev ? 'http://localhost:3001' : ''),

  nyayasiddhiProfessional: process.env.JRX_NSP_URL || process.env.NSP_API_URL || (isDev ? 'http://localhost:4000' : ''),

  nyayasiddhiInstitutional: process.env.JRX_NSI_URL || process.env.NSI_API_URL || (isDev ? 'http://localhost:4001' : ''),

  nyayasiddhiMinistry: process.env.JRX_NSG_URL || process.env.NSG_API_URL || (isDev ? 'http://localhost:4002' : ''),

  nyayasiddhiAcademy: process.env.JRX_NSA_URL || process.env.NSA_API_URL || (isDev ? 'http://localhost:4003' : ''),

  redisUrl: process.env.REDIS_URL || process.env.JRX_REDIS_URL || '',

  s3Bucket: process.env.AWS_S3_BUCKET || process.env.JRX_S3_BUCKET || '',

  s3Region: process.env.AWS_REGION || 'ap-south-1',

  sqsQueueUrl: process.env.AWS_SQS_BATCH_QUEUE_URL || '',
} as const;

export type NvServiceUrl = keyof typeof NV_SERVICE_URLS;

export function getServiceUrl(service: NvServiceUrl): string {
  const url = NV_SERVICE_URLS[service];
  if (!url && process.env.NODE_ENV === 'production') {
    throw new Error(`[NvServiceUrls] Missing required env var for service: ${service}. Set the corresponding environment variable.`);
  }
  return url;
}
