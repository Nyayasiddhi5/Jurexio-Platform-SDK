/**
 * k6 load test — 100 concurrent users hitting the NSP-Web SDK surface
 * JRX-T013 (Stream D, 2026-05-06).
 *
 * Run (full):
 *   k6 run --vus 100 --duration 60s tests/load/k6-100-concurrent-nsp.js
 *
 * Run (smoke / CI):
 *   k6 run --vus 1 --duration 5s tests/load/k6-100-concurrent-nsp.js
 *
 * Required env:
 *   JRX_BASE_URL          (default: https://api.jurexio.com)
 *   JRX_API_KEY           NSP-Web sdk_api_key
 *   JRX_PUBLISHABLE_KEY   (optional — used by completions sub-scenario)
 *
 * Acceptance thresholds:
 *   • http_req_failed         < 5%
 *   • http_req_duration p(95) < 2000 ms
 *   • checks                  > 95%
 *
 * Mix (per VU iteration):
 *   25% — POST /api/jrx/documents/analyse  (upload-then-analyse path, mocked file)
 *   50% — POST /api/jrx/research/search    (RAG retrieval)
 *   25% — POST /api/jrx/orchestrate        (NyayaRAG quick orchestration)
 */

import http from 'k6/http';
import { check, group, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';

const BASE        = __ENV.JRX_BASE_URL || 'https://api.jurexio.com';
const API_KEY     = __ENV.JRX_API_KEY  || 'nyv_test_sk_nsp_placeholder';
const PUB_KEY     = __ENV.JRX_PUBLISHABLE_KEY || '';

const successRate = new Rate('nyv_success_rate');
const orchLatency = new Trend('nyv_orchestrate_latency_ms', true);
const ragLatency  = new Trend('nyv_research_latency_ms',    true);
const docLatency  = new Trend('nyv_documents_latency_ms',   true);

export const options = {
  scenarios: {
    nsp_mixed: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '10s', target: 100 },
        { duration: '40s', target: 100 },
        { duration: '10s', target: 0   },
      ],
      gracefulRampDown: '5s',
    },
  },
  thresholds: {
    http_req_failed:   ['rate<0.05'],
    http_req_duration: ['p(95)<2000'],
    checks:            ['rate>0.95'],
    nyv_success_rate:  ['rate>0.95'],
  },
};

const headers = () => ({
  'Content-Type': 'application/json',
  'X-API-Key':    API_KEY,
});

function pickBucket() {
  const r = Math.random();
  if (r < 0.25) return 'documents';
  if (r < 0.75) return 'research';
  return 'orchestrate';
}

export default function () {
  const bucket = pickBucket();

  if (bucket === 'documents') {
    group('POST /api/jrx/documents/analyse', () => {
      const body = JSON.stringify({
        title: 'k6-load-doc',
        contentBase64: 'JVBERi0xLjQKJeLjz9MKCg==',
        jurisdiction: 'IN',
        analysis: ['classify', 'summary'],
      });
      const res = http.post(`${BASE}/api/jrx/documents/analyse`, body, { headers: headers(), tags: { name: 'documents.analyse' } });
      docLatency.add(res.timings.duration);
      const ok = check(res, {
        'documents.analyse status 2xx/4xx (no 5xx)': (r) => r.status >= 200 && r.status < 500,
      });
      successRate.add(ok);
    });
  } else if (bucket === 'research') {
    group('POST /api/jrx/research/search', () => {
      const body = JSON.stringify({
        query: 'Section 138 Negotiable Instruments Act recent precedent',
        jurisdiction: 'IN',
        limit: 10,
      });
      const res = http.post(`${BASE}/api/jrx/research/search`, body, { headers: headers(), tags: { name: 'research.search' } });
      ragLatency.add(res.timings.duration);
      const ok = check(res, {
        'research.search status 2xx/4xx (no 5xx)': (r) => r.status >= 200 && r.status < 500,
      });
      successRate.add(ok);
    });
  } else {
    group('POST /api/jrx/orchestrate', () => {
      const body = JSON.stringify({
        query: 'Summarise the law on anticipatory bail in India',
        jurisdiction: 'IN',
        tier: 'pro',
        orchestration_pattern: 'NyayaRAG',
        agents: ['legal-research', 'case-analysis'],
      });
      const res = http.post(`${BASE}/api/jrx/orchestrate`, body, { headers: headers(), tags: { name: 'orchestrate' } });
      orchLatency.add(res.timings.duration);
      const ok = check(res, {
        'orchestrate status 2xx/4xx (no 5xx)':       (r) => r.status >= 200 && r.status < 500,
        'orchestrate p95 budget held':               (r) => r.timings.duration < 2000,
      });
      successRate.add(ok);
    });
  }

  sleep(Math.random() * 0.5);
}

export function handleSummary(data) {
  return {
    stdout: JSON.stringify(
      {
        scenario:        'k6-100-concurrent-nsp',
        vus:             data.metrics.vus_max?.values?.max,
        iterations:      data.metrics.iterations?.values?.count,
        success_rate:    data.metrics.nyv_success_rate?.values?.rate,
        http_req_failed: data.metrics.http_req_failed?.values?.rate,
        p95_ms:          data.metrics.http_req_duration?.values?.['p(95)'],
        thresholds_passed:
          (data.metrics.http_req_failed?.thresholds?.['rate<0.05']?.ok ?? false) &&
          (data.metrics.http_req_duration?.thresholds?.['p(95)<2000']?.ok ?? false) &&
          (data.metrics.checks?.thresholds?.['rate>0.95']?.ok ?? false),
      },
      null,
      2,
    ) + '\n',
  };
}
