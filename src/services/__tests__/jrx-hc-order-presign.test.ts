/**
 * NV-HC-ORDER-PRESIGN-001 — HC order presign seam (no fake URLs).
 */
import { describe, it, expect } from 'vitest';
import {
  normalizeEcourtsOrderPath,
  deriveHcOrderS3Key,
  buildHcOrderMapIndex,
  enrichHcOrderFieldValue,
  applyHcOrderPresignToResolveData,
  isAllowedHcOrderBucket,
} from '../jrx-hc-order-presign.js';
import type { CnrResolveData } from '../../../packages/client-sdk/src/api/CnrApi.js';

describe('NV-HC-ORDER-PRESIGN-001', () => {
  it('normalizeEcourtsOrderPath strips leading slashes', () => {
    expect(normalizeEcourtsOrderPath('/orders/2023/foo_12.pdf')).toBe('orders/2023/foo_12.pdf');
  });

  it('deriveHcOrderS3Key is deterministic under data/orders/cnr=', () => {
    expect(
      deriveHcOrderS3Key({
        cnr: 'APHC010000832023',
        orderPath: '/orders/2023/APHC010000832023_12.pdf',
      }),
    ).toBe('data/orders/cnr=APHC010000832023/APHC010000832023_12.pdf');
  });

  it('isAllowedHcOrderBucket rejects public judgment buckets', () => {
    expect(isAllowedHcOrderBucket('indian-high-court-judgments')).toBe(false);
    expect(isAllowedHcOrderBucket('ns-highcourt-data-bucket')).toBe(true);
  });

  it('enrich adds presignedUrl only when map + presign URL exist', () => {
    const mapIndex = buildHcOrderMapIndex([
      {
        orderPath: 'orders/2023/APHC010000832023_12.pdf',
        s3Bucket: 'ns-highcourt-data-bucket',
        s3Key: 'data/orders/cnr=APHC010000832023/APHC010000832023_12.pdf',
        orderKind: 'final',
      },
    ]);
    const presigned = new Map([
      [
        's3://ns-highcourt-data-bucket/data/orders/cnr=APHC010000832023/APHC010000832023_12.pdf',
        'https://signed.example/o.pdf',
      ],
    ]);
    const { field, documents } = enrichHcOrderFieldValue(
      {
        value: [
          {
            order_id: '12',
            order_date: '2023-01-04',
            order_details: 'Final Order',
            filename: '/orders/2023/APHC010000832023_12.pdf',
          },
        ],
        source: 'nys_case_api',
        confidence: 0.9,
      },
      'final',
      'APHC010000832023',
      mapIndex,
      presigned,
      'indian-high-court-judgments',
    );
    const rec = (field?.value as Record<string, unknown>[])[0];
    expect(rec?.presignedUrl).toBe('https://signed.example/o.pdf');
    expect(rec?.pdfUrlKind).toBe('presigned');
    expect(documents).toHaveLength(1);
    expect(documents[0]?.kind).toBe('order');
  });

  it('enrich leaves filename raw when no map row (no fake URL)', () => {
    const { field, documents } = enrichHcOrderFieldValue(
      {
        value: [{ filename: '/orders/2023/missing.pdf' }],
        source: 'nys_case_api',
        confidence: 0.9,
      },
      'interim',
      'APHC010000832023',
      new Map(),
      new Map(),
      'indian-high-court-judgments',
    );
    const rec = (field?.value as Record<string, unknown>[])[0];
    expect(rec?.presignedUrl).toBeUndefined();
    expect(documents).toHaveLength(0);
  });

  it('applyHcOrderPresignToResolveData merges order documents', () => {
    const base: CnrResolveData = {
      cnr: 'APHC010000832023',
      status: 'found',
      matchType: 'exact',
      source: 'nys_case_api',
      sourcesTried: ['nys_case_api'],
      confidence: 0.95,
      claimEcourts: false,
      validation: 'ok',
      ui: { badge: 'x', subtitle: 'y' },
      fields: {
        finalOrders: {
          value: [{ filename: '/orders/2023/APHC010000832023_12.pdf', order_details: 'Final' }],
          source: 'nys_case_api',
          confidence: 0.9,
        },
      },
      documents: [],
      candidates: [],
      meta: { latencyMs: 1, source: 'nys-case-api' },
    };
    const mapRows = [
      {
        orderPath: 'orders/2023/APHC010000832023_12.pdf',
        s3Bucket: 'ns-highcourt-data-bucket',
        s3Key: 'data/orders/cnr=APHC010000832023/APHC010000832023_12.pdf',
        orderKind: 'final' as const,
      },
    ];
    const presigned = new Map([
      [
        's3://ns-highcourt-data-bucket/data/orders/cnr=APHC010000832023/APHC010000832023_12.pdf',
        'https://signed.example/o.pdf',
      ],
    ]);
    const out = applyHcOrderPresignToResolveData(
      base,
      mapRows,
      presigned,
      'indian-high-court-judgments',
    );
    expect(out.documents).toHaveLength(1);
    expect(out.documents[0]?.url).toBe('https://signed.example/o.pdf');
  });
});
