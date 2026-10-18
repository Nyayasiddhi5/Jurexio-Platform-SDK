// JRX-NS-021 (2026-05-05): pre-existing TS errors (gateway runs via tsx).
/**
 * Jurexio Enterprise Platform 3.1.2 — GST Engine Routes
 * JRX-ROUTE-GST-001
 *
 * Routes:
 *   POST /api/jrx/gst/compute          — compute GST for an amount
 *   POST /api/jrx/gst/invoice          — generate a tax invoice
 *   POST /api/jrx/gst/payment-ref      — generate a payment reference ID
 *   POST /api/jrx/gst/validate-gstin   — validate GSTIN format
 *   GET  /api/jrx/gst/rates            — GST rates and SAC codes
 */

import { Router, Request, Response } from 'express';
import { z, ZodError } from 'zod';
import { authenticateToken } from '../middleware/auth.js';
import { gstEngine, JRX_GST_DETAILS } from '../services/jrx-gst-engine.js';
import { gstInvoicePdfService } from '../services/gst-invoice-pdf-service.js';

const router = Router();

// ─────────────────────────────────────────
// Schemas
// ─────────────────────────────────────────

const computeSchema = z.object({
  base_amount: z.number().positive(),
  supplier_state_code: z.string().length(2).optional(),
  customer_state_code: z.string().length(2).optional(),
});

const invoiceSchema = z.object({
  customer_name: z.string().min(1),
  customer_gstin: z.string().optional(),
  customer_state_code: z.string().length(2).optional(),
  customer_address: z.string().optional(),
  plan_name: z.string().min(1),
  period: z.string().min(1),
  base_amount: z.number().positive(),
  is_b2b: z.boolean().optional(),
  notes: z.string().optional(),
});

// ─────────────────────────────────────────
// Routes
// ─────────────────────────────────────────

/** GET /rates */
router.get('/rates', (_req: Request, res: Response): void => {
  res.json({
    success: true,
    data: {
      supplier: JRX_GST_DETAILS,
      gst_rate: JRX_GST_DETAILS.gst_rate_percent,
      tds_rate: JRX_GST_DETAILS.tds_rate_percent,
      tds_threshold_inr: 30000,
      sac_code: JRX_GST_DETAILS.sac_code,
      invoice_format: 'INV-YYYY-NNNNNN',
      payment_format: 'PAY-YYYY-NNNNNN',
      intra_state: { cgst: 9, sgst: 9, igst: 0 },
      inter_state: { cgst: 0, sgst: 0, igst: 18 },
    },
  });
});

/** POST /compute */
router.post('/compute', authenticateToken, (req: Request, res: Response): void => {
  try {
    const parsed = computeSchema.parse(req.body);
    const gst = gstEngine.computeGST(
      parsed.base_amount,
      parsed.supplier_state_code || '27',
      parsed.customer_state_code || '27',
    );
    res.json({ success: true, data: gst });
  } catch (err: any) {
    if (err instanceof ZodError) {
      res.status(400).json({ success: false, error: 'Validation failed', issues: err.issues });
      return;
    }
    res.status(500).json({ success: false, error: String(err) });
  }
});

/** POST /invoice */
router.post('/invoice', authenticateToken, (req: Request, res: Response): void => {
  try {
    const parsed = invoiceSchema.parse(req.body);
    const invoice = gstEngine.buildInvoice({
      customer_name: String(parsed.customer_name),
      customer_gstin: parsed.customer_gstin,
      customer_state_code: parsed.customer_state_code,
      customer_address: parsed.customer_address,
      plan_name: String(parsed.plan_name),
      period: String(parsed.period),
      base_amount: Number(parsed.base_amount),
      is_b2b: parsed.is_b2b,
      notes: parsed.notes,
    });
    res.json({ success: true, data: invoice });
  } catch (err: any) {
    if (err instanceof ZodError) {
      res.status(400).json({ success: false, error: 'Validation failed', issues: err.issues });
      return;
    }
    res.status(500).json({ success: false, error: String(err) });
  }
});

/** POST /payment-ref */
router.post('/payment-ref', authenticateToken, (_req: Request, res: Response): void => {
  const paymentId = gstEngine.generatePaymentId();
  res.json({ success: true, data: { payment_id: paymentId, format: 'PAY-YYYY-NNNNNN' } });
});

/** POST /validate-gstin */
router.post('/validate-gstin', (req: Request, res: Response): void => {
  const { gstin } = req.body as { gstin: string };
  if (!gstin) {
    res.status(400).json({ success: false, error: 'gstin is required' });
    return;
  }
  const result = gstEngine.validateGSTIN(gstin);
  res.json({ success: true, data: result });
});

/** POST /invoice/pdf — Generate GST Tax Invoice as PDF */
router.post('/invoice/pdf', authenticateToken, async (req: Request, res: Response): Promise<void> => {
  try {
    const parsed = invoiceSchema.parse(req.body);
    const invoice = gstEngine.buildInvoice({
      customer_name: String(parsed.customer_name),
      customer_gstin: parsed.customer_gstin,
      customer_state_code: parsed.customer_state_code,
      customer_address: parsed.customer_address,
      plan_name: String(parsed.plan_name),
      period: String(parsed.period),
      base_amount: Number(parsed.base_amount),
      is_b2b: parsed.is_b2b,
      notes: parsed.notes,
    });

    const pdfResult = await gstInvoicePdfService.generatePDF({
      invoiceNumber: invoice.invoice_number,
      // @ts-expect-error NV-TS230 legacy typing gap (TS2551)
      invoiceDate: invoice.invoice_date,
      customerName: parsed.customer_name,
      customerAddress: parsed.customer_address,
      customerGstin: parsed.customer_gstin,
      customerStateCode: parsed.customer_state_code,
      planName: parsed.plan_name,
      period: parsed.period,
      baseAmount: parsed.base_amount,
      isB2b: parsed.is_b2b,
      notes: parsed.notes,
    });

    const isPdf = pdfResult.pdfBuffer[0] === 0x25 && pdfResult.pdfBuffer[1] === 0x50; // %P → PDF header
    res.setHeader('Content-Type', isPdf ? 'application/pdf' : 'text/html');
    res.setHeader('Content-Disposition', `attachment; filename="${pdfResult.invoiceNumber}.pdf"`);
    res.setHeader('X-Invoice-Number', pdfResult.invoiceNumber);
    res.setHeader('X-GST-Type', pdfResult.gstBreakdown.gstType);
    res.setHeader('X-Total-Amount', pdfResult.gstBreakdown.totalAmount.toFixed(2));
    res.send(pdfResult.pdfBuffer);
  } catch (err: any) {
    if (err instanceof ZodError) {
      res.status(400).json({ success: false, error: 'Validation failed', issues: err.issues });
      return;
    }
    res.status(500).json({ success: false, error: String(err) });
  }
});

export { router as nvGSTRouter };
