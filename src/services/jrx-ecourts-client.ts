/**
 * NV eCourts API Client v3.1.2
 * ─────────────────────────────────────────────────────────────────────────────
 * Integration with NIC eCourts Services India.
 * API Base: https://services.ecourts.gov.in/ecourtindiaapi/
 *
 * Supported queries:
 *   - Case status by CNR number
 *   - Case history / orders
 *   - Hearing dates
 *   - Cause list
 *   - Judgment downloads
 *
 * Gracefully returns structured error when eCourts API key not set.
 */

import { createLogger } from '../utils/logger.js';

const logger = createLogger('./jrx-ecourts');

const ECOURTS_BASE = 'https://services.ecourts.gov.in/ecourtindiaapi/api';

export interface eCourtsConfig {
  apiKey: string;
  baseUrl?: string;
}

export interface CaseStatus {
  cnrNumber: string;
  caseType: string;
  filingNumber: string;
  filingDate: string;
  registrationNumber: string;
  registrationDate: string;
  caseStatus: 'Pending' | 'Disposed' | 'Transferred';
  petitionerName: string;
  respondentName: string;
  petitionerAdvocate: string;
  respondentAdvocate: string;
  courtName: string;
  courtEstCode: string;
  districtCode: string;
  stateCode: string;
  nextHearingDate: string | null;
  actSection: string;
  hearingHistory: HearingEntry[];
}

export interface HearingEntry {
  hearingDate: string;
  purpose: string;
  businessOnDate: string;
  nextDate: string;
}

export interface CaseOrder {
  orderDate: string;
  orderDetails: string;
  judgeFullName: string;
  orderPdfUrl?: string;
}

export interface CausListEntry {
  serialNo: number;
  cnrNumber: string;
  caseTitle: string;
  hearingPurpose: string;
  advocateName: string;
}

// ─── Get case status by CNR number ───────────────────────────────────────────
export async function getCaseStatus(cnrNumber: string): Promise<CaseStatus | { error: string }> {
  const config = getConfig();
  if (!config) return notConfigured();

  try {
    const res = await fetch(`${config.baseUrl}/case_status_search`, {
      method: 'POST',
      headers: buildHeaders(config),
      body: JSON.stringify({ cnr_number: cnrNumber }),
    });

    if (!res.ok) {
      const text = await res.text();
      logger.warn('[eCourts] getCaseStatus failed', { status: res.status, cnrNumber });
      return { error: `eCourts API error: ${res.status} — ${text}` };
    }

    const data: any = await res.json();
    return parseCaseStatus(data, cnrNumber);
  } catch (err: any) {
    logger.warn('[eCourts] getCaseStatus network error', { error: err.message });
    return { error: `Network error: ${err.message}` };
  }
}

// ─── Get case orders ──────────────────────────────────────────────────────────
export async function getCaseOrders(cnrNumber: string): Promise<CaseOrder[] | { error: string }> {
  const config = getConfig();
  if (!config) return notConfigured();

  try {
    const res = await fetch(`${config.baseUrl}/case_hearings`, {
      method: 'POST',
      headers: buildHeaders(config),
      body: JSON.stringify({ cnr_number: cnrNumber }),
    });

    if (!res.ok) return { error: `HTTP ${res.status}` };
    const data: any = await res.json();
    return (data.orders || []).map((o: any) => ({
      orderDate: o.order_date || '',
      orderDetails: o.order_details || '',
      judgeFullName: o.judge_full_name || '',
      orderPdfUrl: o.pdf_download_url,
    }));
  } catch (err: any) {
    return { error: err.message };
  }
}

// ─── Get cause list for a court and date ─────────────────────────────────────
export async function getCauseList(
  courtCode: string,
  date: string
): Promise<CausListEntry[] | { error: string }> {
  const config = getConfig();
  if (!config) return notConfigured();

  try {
    const res = await fetch(`${config.baseUrl}/cause_list`, {
      method: 'POST',
      headers: buildHeaders(config),
      body: JSON.stringify({ court_code: courtCode, date }),
    });

    if (!res.ok) return { error: `HTTP ${res.status}` };
    const data: any = await res.json();
    return (data.cause_list || []).map((e: any, i: number) => ({
      serialNo: i + 1,
      cnrNumber: e.cnr_number || '',
      caseTitle: e.case_title || '',
      hearingPurpose: e.hearing_purpose || '',
      advocateName: e.advocate_name || '',
    }));
  } catch (err: any) {
    return { error: err.message };
  }
}

// ─── Health check ─────────────────────────────────────────────────────────────
export async function geteCourtsHealth(): Promise<{
  configured: boolean;
  status: 'live' | 'not_configured' | 'error';
}> {
  const config = getConfig();
  if (!config) return { configured: false, status: 'not_configured' };
  try {
    const res = await fetch(`${config.baseUrl}/ping`, { headers: buildHeaders(config) });
    return { configured: true, status: res.ok ? 'live' : 'error' };
  } catch {
    return { configured: true, status: 'error' };
  }
}

// ─── Internals ────────────────────────────────────────────────────────────────
function getConfig(): eCourtsConfig | null {
  const apiKey = process.env.JRX_ECOURTS_API_KEY;
  if (!apiKey) return null;
  return {
    apiKey,
    baseUrl: process.env.JRX_ECOURTS_BASE_URL || ECOURTS_BASE,
  };
}

function buildHeaders(config: eCourtsConfig): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'x-api-key': config.apiKey,
    'User-Agent': 'Jurexio/3.1.2',
  };
}

function notConfigured(): { error: string } {
  return { error: 'JRX_ECOURTS_API_KEY not configured. Contact eCourts NIC for API access.' };
}

function parseCaseStatus(data: any, cnrNumber: string): CaseStatus {
  return {
    cnrNumber: data.cnr_number || cnrNumber,
    caseType: data.case_type || '',
    filingNumber: data.filing_number || '',
    filingDate: data.filing_date || '',
    registrationNumber: data.registration_number || '',
    registrationDate: data.registration_date || '',
    caseStatus: data.case_status || 'Pending',
    petitionerName: data.petitioner_name || '',
    respondentName: data.respondent_name || '',
    petitionerAdvocate: data.petitioner_advocate || '',
    respondentAdvocate: data.respondent_advocate || '',
    courtName: data.court_name || '',
    courtEstCode: data.court_est_code || '',
    districtCode: data.district_code || '',
    stateCode: data.state_code || '',
    nextHearingDate: data.next_hearing_date || null,
    actSection: data.act_section || '',
    hearingHistory: (data.hearing_history || []).map((h: any) => ({
      hearingDate: h.hearing_date || '',
      purpose: h.purpose || '',
      businessOnDate: h.business_on_date || '',
      nextDate: h.next_date || '',
    })),
  };
}
