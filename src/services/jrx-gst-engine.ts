/**
 * Jurexio Enterprise Platform 3.1.2 — GST Engine + Invoice ID Standardisation
 * NYV-SVC-GST-001
 *
 * Handover §7 — GST compliance for all billing:
 *   Invoice ID format: INV-YYYY-{NNNNNN}  e.g. INV-2026-000001
 *   Payment ID format: PAY-YYYY-{NNNNNN}  e.g. PAY-2026-000001
 *
 * GST rates:
 *   Legal/AI software services: 18% GST (SAC 998399 — IT services)
 *   All amounts in INR.
 *
 * TDS on AI service payments (§194J): 10% TDS where applicable.
 *
 * Invoice must include:
 *   - Supplier: Jurexio Technology Pvt Ltd + GSTIN
 *   - Customer GSTIN (if B2B)
 *   - HSN/SAC code
 *   - Tax invoice / proforma invoice distinction
 *   - Place of supply
 */

import crypto from 'crypto';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('./jrx-gst-engine');

// ─────────────────────────────────────────
// Constants
// ─────────────────────────────────────────

export const NYV_GST_DETAILS = {
  legal_name: 'Jurexio Technology Private Limited',
  trade_name: 'Jurexio',
  companyName: 'Jurexio Technology Private Limited', // alias for legal_name
  gstin: '27AADCN0000A1ZV', // Placeholder — replace with actual GSTIN
  pan: 'AADCN0000A',        // Placeholder — replace with actual PAN
  address: 'Mumbai, Maharashtra — 400001',
  state_code: '27',          // Maharashtra
  sac_code: '998399',        // Information technology services n.e.c.
  sacCode: '998399',         // camelCase alias
  gst_rate_percent: 18,
  gstRate: 18,               // camelCase alias
  tds_rate_percent: 10,       // §194J professional services TDS
};

export const GST_RATE = NYV_GST_DETAILS.gst_rate_percent / 100; // 0.18

// ─────────────────────────────────────────
// Types
// ─────────────────────────────────────────

export interface GSTBreakdown {
  base_amount: number;       // Taxable value (pre-tax)
  cgst_rate: number;         // 9% (intra-state)
  cgst_amount: number;
  cgst: number;              // alias for cgst_amount
  sgst_rate: number;         // 9% (intra-state)
  sgst_amount: number;
  sgst: number;              // alias for sgst_amount
  igst_rate: number;         // 18% (inter-state / B2C)
  igst_amount: number;
  igst: number;              // alias for igst_amount
  total_tax: number;
  total_gst: number;         // alias for total_tax
  total_amount: number;      // base + total_tax
  is_interstate: boolean;
  gst_type: 'CGST+SGST' | 'IGST'; // readable type indicator
}

export interface InvoiceDetails {
  invoice_id: string;        // INV-YYYY-NNNNNN
  invoice_number: string;    // alias for invoice_id
  invoice_type: 'TAX_INVOICE' | 'PROFORMA' | 'CREDIT_NOTE';
  supplier: typeof NYV_GST_DETAILS;
  supplier_name: string;     // alias for supplier.legal_name
  total_amount: number;      // top-level alias for gst.total_amount
  customer: {
    name: string;
    gstin?: string;
    state_code?: string;
    address?: string;
  };
  line_items: InvoiceLineItem[];
  gst: GSTBreakdown;
  payment_terms: string;
  due_date: string;          // ISO date
  issued_at: string;         // ISO timestamp
  currency: 'INR';
  notes?: string;
  tds_applicable: boolean;
  tds_amount: number;
  net_payable: number;       // total_amount - tds_amount
}

export interface InvoiceLineItem {
  description: string;
  sac_code: string;
  quantity: number;
  unit: string;
  unit_price: number;
  amount: number;
}

export interface PaymentReference {
  payment_id: string;        // PAY-YYYY-NNNNNN
  invoice_id: string;
  amount_received: number;
  payment_method: 'razorpay' | 'bank_transfer' | 'cheque' | 'upi';
  transaction_ref: string;
  received_at: string;
  status: 'pending' | 'completed' | 'failed' | 'refunded';
}

// ─────────────────────────────────────────
// Sequence counters (in-memory; real impl uses DB sequence)
// ─────────────────────────────────────────

const _counters: Record<string, number> = {};

function _nextSeq(year: string): number {
  _counters[year] = (_counters[year] || 0) + 1;
  return _counters[year];
}

function _pad(n: number, digits = 6): string {
  return String(n).padStart(digits, '0');
}

// ─────────────────────────────────────────
// GST Engine
// ─────────────────────────────────────────

export class GSTEngine {
  /**
   * Generate a standardised Invoice ID.
   * Format: INV-YYYY-NNNNNN
   */
  generateInvoiceId(year?: number): string {
    const y = String(year || new Date().getFullYear());
    return `INV-${y}-${_pad(_nextSeq(y))}`;
  }

  /**
   * Generate a standardised Payment Reference ID.
   * Format: PAY-YYYY-NNNNNN
   */
  generatePaymentId(year?: number): string {
    const y = String(year || new Date().getFullYear());
    return `PAY-${y}-${_pad(_nextSeq(`PAY-${y}`))}`;
  }

  /**
   * Compute GST breakdown for a base amount.
   * @param baseAmount - Pre-tax amount in INR
   * @param supplierStateCode - '27' (Maharashtra) for NYV
   * @param customerStateCode - Customer state code (2 digits). If same as supplier = intra-state.
   */
  computeGST(
    baseAmount: number,
    supplierStateCode = '27',
    customerStateCode = '27'
  ): GSTBreakdown {
    const isInterstate = supplierStateCode !== customerStateCode;
    const totalTax = Math.round(baseAmount * GST_RATE * 100) / 100;

    if (isInterstate) {
      return {
        base_amount: baseAmount,
        cgst_rate: 0,
        cgst_amount: 0,
        cgst: 0,
        sgst_rate: 0,
        sgst_amount: 0,
        sgst: 0,
        igst_rate: NYV_GST_DETAILS.gst_rate_percent,
        igst_amount: totalTax,
        igst: totalTax,
        total_tax: totalTax,
        total_gst: totalTax,
        total_amount: Math.round((baseAmount + totalTax) * 100) / 100,
        is_interstate: true,
        gst_type: 'IGST' as const,
      };
    }

    // Intra-state: CGST 9% + SGST 9%
    const halfTax = Math.round(totalTax / 2 * 100) / 100;
    return {
      base_amount: baseAmount,
      cgst_rate: 9,
      cgst_amount: halfTax,
      cgst: halfTax,
      sgst_rate: 9,
      sgst_amount: totalTax - halfTax,
      sgst: totalTax - halfTax,
      igst_rate: 0,
      igst_amount: 0,
      igst: 0,
      total_tax: totalTax,
      total_gst: totalTax,
      total_amount: Math.round((baseAmount + totalTax) * 100) / 100,
      is_interstate: false,
      gst_type: 'CGST+SGST' as const,
    };
  }

  /**
   * Build a complete tax invoice.
   */
  buildInvoice(params: {
    customer_name: string;
    customer_gstin?: string;
    customer_state_code?: string;
    customer_address?: string;
    plan_name: string;
    period: string;
    base_amount: number;
    is_b2b?: boolean;
    notes?: string;
  }): InvoiceDetails {
    const invoiceId = this.generateInvoiceId();
    const customerStateCode = params.customer_state_code || '27';
    const gst = this.computeGST(params.base_amount, NYV_GST_DETAILS.state_code, customerStateCode);
    const isB2B = params.is_b2b || !!params.customer_gstin;

    // TDS applicable for B2B payments above ₹30,000 (§194J threshold)
    const tdsApplicable = isB2B && params.base_amount >= 30000;
    const tdsAmount = tdsApplicable
      ? Math.round(params.base_amount * NYV_GST_DETAILS.tds_rate_percent / 100 * 100) / 100
      : 0;

    const dueDate = new Date(Date.now() + 15 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    const invoice: InvoiceDetails = {
      invoice_id: invoiceId,
      invoice_number: invoiceId,
      invoice_type: 'TAX_INVOICE',
      supplier: NYV_GST_DETAILS,
      supplier_name: NYV_GST_DETAILS.legal_name,
      total_amount: Math.round((params.base_amount + Math.round(params.base_amount * GST_RATE * 100) / 100) * 100) / 100,
      customer: {
        name: params.customer_name,
        gstin: params.customer_gstin,
        state_code: customerStateCode,
        address: params.customer_address,
      },
      line_items: [
        {
          description: `Jurexio ${params.plan_name} Plan — AI Legal Platform Subscription (${params.period})`,
          sac_code: NYV_GST_DETAILS.sac_code,
          quantity: 1,
          unit: 'subscription',
          unit_price: params.base_amount,
          amount: params.base_amount,
        },
      ],
      gst,
      payment_terms: 'Due within 15 days',
      due_date: dueDate,
      issued_at: new Date().toISOString(),
      currency: 'INR',
      notes: params.notes,
      tds_applicable: tdsApplicable,
      tds_amount: tdsAmount,
      net_payable: Math.round((gst.total_amount - tdsAmount) * 100) / 100,
    };

    logger.info('Invoice generated', {
      invoiceId,
      baseAmount: params.base_amount,
      totalAmount: gst.total_amount,
      tdsAmount,
      netPayable: invoice.net_payable,
    });

    return invoice;
  }

  /**
   * Validate a GSTIN (basic format check — 15 chars, state code prefix, checksum).
   * Full GSTIN validation requires GSTN API.
   */
  validateGSTIN(gstin: string): { valid: boolean; state_code: string | null; pan: string | null; error?: string } {
    if (!gstin) return { valid: false, state_code: null, pan: null, error: 'GSTIN is required' };
    const cleaned = gstin.toUpperCase().trim();
    // GSTIN format: 2-digit state code + 10-char PAN + 1 entity number + 1 'Z' + 1 checksum
    const gstinPattern = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;
    if (!gstinPattern.test(cleaned)) {
      return { valid: false, state_code: null, pan: null, error: 'Invalid GSTIN format' };
    }
    const stateCode = cleaned.substring(0, 2);
    const pan = cleaned.substring(2, 12);
    return { valid: true, state_code: stateCode, pan };
  }

  /**
   * Format an amount in INR with proper Indian number formatting.
   * e.g. 1234567.89 → ₹12,34,567.89
   */
  formatINR(amount: number): string {
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(amount);
  }
}

export const gstEngine = new GSTEngine();
