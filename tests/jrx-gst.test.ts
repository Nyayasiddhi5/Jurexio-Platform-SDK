/**
 * GST Engine Tests — Jurexio Enterprise Platform 3.1.2
 */
import { describe, it, expect } from 'vitest';
import { gstEngine, NYV_GST_DETAILS } from '../src/services/jrx-gst-engine.js';

describe('GST Engine', () => {
  it('computes CGST+SGST for intra-state transactions', () => {
    const result = gstEngine.computeGST(1000, '29', '29'); // Karnataka→Karnataka
    expect(result.gst_type).toBe('CGST+SGST');
    expect(result.cgst).toBeCloseTo(90);
    expect(result.sgst).toBeCloseTo(90);
    expect(result.igst).toBe(0);
    expect(result.total_gst).toBeCloseTo(180);
    expect(result.total_amount).toBeCloseTo(1180);
  });

  it('computes IGST for inter-state transactions', () => {
    const result = gstEngine.computeGST(1000, '29', '27'); // Karnataka→Maharashtra
    expect(result.gst_type).toBe('IGST');
    expect(result.igst).toBeCloseTo(180);
    expect(result.cgst).toBe(0);
    expect(result.sgst).toBe(0);
    expect(result.total_gst).toBeCloseTo(180);
  });

  it('defaults to IGST when state codes differ', () => {
    const r = gstEngine.computeGST(5000, '07', '36'); // Delhi→Telangana
    expect(r.gst_type).toBe('IGST');
    expect(r.igst).toBeCloseTo(900);
  });

  it('GST rate is 18%', () => {
    const r = gstEngine.computeGST(10000, '29', '29');
    expect(r.total_gst / r.base_amount).toBeCloseTo(0.18);
  });

  it('builds invoice with INV prefix', () => {
    const invoice = gstEngine.buildInvoice({
      customer_name: 'Acme Corp', plan_name: 'Pro', period: 'Apr 2026', base_amount: 2500,
    });
    expect(invoice.invoice_number).toMatch(/^INV-\d{4}-\d{6}$/);
    expect(invoice.total_amount).toBeGreaterThan(2500);
    expect(invoice.supplier_name).toBe(NYV_GST_DETAILS.companyName);
  });

  it('validates correct GSTIN format', () => {
    const result = gstEngine.validateGSTIN('29AABCU9603R1ZX');
    expect(result.valid).toBe(true);
  });

  it('rejects invalid GSTIN format', () => {
    const result = gstEngine.validateGSTIN('INVALID');
    expect(result.valid).toBe(false);
  });

  it('generates PAY- format payment IDs', () => {
    const id = gstEngine.generatePaymentId();
    expect(id).toMatch(/^PAY-\d{4}-\d{6}$/);
  });

  it('NYV GST Details are set', () => {
    expect(NYV_GST_DETAILS.gstin).toBeDefined();
    expect(NYV_GST_DETAILS.sacCode).toBe('998399');
    expect(NYV_GST_DETAILS.gstRate).toBe(18);
  });
});
