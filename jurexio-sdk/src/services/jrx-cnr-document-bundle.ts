/**
 * NV-CNR-DOCUMENT-BUNDLE-001 — single response for judgment PDFs + timeline orders.
 */
import type { CnrDocument, CnrResolveData } from '../../packages/client-sdk/src/api/CnrApi.js';
import {
  lookupCnrViaCaseApi,
  parseCaseApiCourtType,
  fetchLegacyCnrResolve,
  isCaseApiConfigured,
  isCaseApiCnrEnabled,
} from './jrx-case-api-adapter.js';
import { isNysKnowledgeConfigured } from './jrx-nys-knowledge-client.js';

export interface CnrDocumentBundle {
  cnr: string;
  claimEcourts: false;
  judgment: CnrDocument | null;
  orders: CnrDocument[];
  documents: CnrDocument[];
  extractPreview: null;
  meta: {
    refreshedAt: string;
    source: string;
    latencyMs?: number;
    includeTimelineOrders: boolean;
    claimEcourts: false;
  };
}

function splitDocuments(docs: CnrDocument[]): { judgment: CnrDocument | null; orders: CnrDocument[] } {
  let judgment: CnrDocument | null = null;
  const orders: CnrDocument[] = [];
  for (const doc of docs) {
    if (doc.kind === 'order') {
      orders.push(doc);
    } else if (!judgment && (doc.kind === 'judgment' || doc.kind === 'document')) {
      judgment = doc;
    } else if (doc.kind === 'judgment') {
      orders.push(doc);
    } else {
      orders.push(doc);
    }
  }
  return { judgment, orders };
}

function bundleFromResolveData(
  data: CnrResolveData,
  includeTimelineOrders: boolean,
  source: string,
): CnrDocumentBundle {
  const docs = includeTimelineOrders ? data.documents : data.documents.filter((d) => d.kind !== 'order');
  const { judgment, orders } = splitDocuments(docs);
  return {
    cnr: data.cnr,
    claimEcourts: false,
    judgment,
    orders,
    documents: docs,
    extractPreview: null,
    meta: {
      refreshedAt: new Date().toISOString(),
      source,
      latencyMs: data.meta?.latencyMs,
      includeTimelineOrders,
      claimEcourts: false,
    },
  };
}

export type DocumentBundleResult =
  | { kind: 'ok'; bundle: CnrDocumentBundle }
  | { kind: 'upstream_error'; status: number }
  | { kind: 'disabled'; status: 503 };

export async function fetchCnrDocumentBundle(input: {
  cnr: string;
  courtType?: string;
  includeTimelineOrders?: boolean;
  refresh?: boolean;
}): Promise<DocumentBundleResult> {
  const includeTimelineOrders = input.includeTimelineOrders !== false;
  const t0 = Date.now();

  if (isCaseApiCnrEnabled() && isCaseApiConfigured()) {
    const lookup = await lookupCnrViaCaseApi({
      cnr: input.cnr,
      courtType: parseCaseApiCourtType(input.courtType),
      includeDocuments: true,
      includeTimeline: includeTimelineOrders,
    });

    if (lookup.kind === 'resolved' && lookup.data.status === 'found') {
      const bundle = bundleFromResolveData(lookup.data, includeTimelineOrders, 'nys-case-api');
      bundle.meta.latencyMs = Date.now() - t0;
      return { kind: 'ok', bundle };
    }

    if (lookup.kind === 'upstream_error') {
      return { kind: 'upstream_error', status: lookup.status };
    }
  }

  if (isNysKnowledgeConfigured()) {
    const legacy = await fetchLegacyCnrResolve({
      cnr: input.cnr,
      includeDocuments: true,
    });
    if (legacy?.status === 'found') {
      const bundle = bundleFromResolveData(legacy, includeTimelineOrders, 'nys-cnr-corpus');
      bundle.meta.latencyMs = Date.now() - t0;
      return { kind: 'ok', bundle };
    }
  }

  if (!isCaseApiCnrEnabled() && !isNysKnowledgeConfigured()) {
    return { kind: 'disabled', status: 503 };
  }

  const empty: CnrDocumentBundle = {
    cnr: input.cnr,
    claimEcourts: false,
    judgment: null,
    orders: [],
    documents: [],
    extractPreview: null,
    meta: {
      refreshedAt: new Date().toISOString(),
      source: 'nys-case-api',
      latencyMs: Date.now() - t0,
      includeTimelineOrders,
      claimEcourts: false,
    },
  };
  return { kind: 'ok', bundle: empty };
}
