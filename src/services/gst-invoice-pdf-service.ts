// JRX-NS-021 (2026-05-05): pre-existing TS errors (gateway runs via tsx).
/**
 * GST Invoice PDF Generation Service
 * Generates legally compliant GST tax invoices as PDF using HTML + Puppeteer.
 * @version 3.1.2
 */
import { createLogger } from '../utils/logger.js';
import { gstEngine, JRX_GST_DETAILS } from './jrx-gst-engine.js';

const logger = createLogger('gst-pdf');

export interface InvoiceData {
  invoiceNumber: string;
  invoiceDate: string;
  customerName: string;
  customerAddress?: string;
  customerGstin?: string;
  customerStateCode?: string;
  planName: string;
  period: string;
  baseAmount: number;
  isB2b?: boolean;
  notes?: string;
}

export interface InvoicePDFResult {
  invoiceNumber: string;
  pdfBuffer: Buffer;
  gstBreakdown: {
    baseAmount: number;
    cgst?: number;
    sgst?: number;
    igst?: number;
    totalGst: number;
    totalAmount: number;
    gstType: 'IGST' | 'CGST+SGST';
  };
}

function buildInvoiceHTML(data: InvoiceData, gst: any): string {
  const isIGST = gst.gst_type === 'IGST';
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
  body { font-family: Arial, sans-serif; font-size: 12px; margin: 0; padding: 20px; color: #333; }
  .header { display: flex; justify-content: space-between; border-bottom: 2px solid #1a1a2e; padding-bottom: 15px; margin-bottom: 20px; }
  .company-name { font-size: 20px; font-weight: bold; color: #1a1a2e; }
  .company-details { font-size: 10px; color: #666; }
  .invoice-title { font-size: 22px; font-weight: bold; color: #1a1a2e; text-align: right; }
  .invoice-meta { text-align: right; font-size: 11px; }
  .section { margin-bottom: 20px; }
  .section-title { font-weight: bold; background: #f0f4ff; padding: 6px 10px; border-left: 3px solid #1a1a2e; margin-bottom: 8px; }
  table { width: 100%; border-collapse: collapse; }
  th { background: #1a1a2e; color: white; padding: 8px; text-align: left; }
  td { padding: 8px; border-bottom: 1px solid #eee; }
  .amount-table td { border: 1px solid #ddd; }
  .total-row { font-weight: bold; background: #f0f4ff; }
  .grand-total { font-size: 14px; font-weight: bold; color: #1a1a2e; background: #e8eeff; }
  .footer { margin-top: 30px; border-top: 1px solid #ddd; padding-top: 15px; font-size: 10px; color: #666; }
  .badge { display: inline-block; background: #1a1a2e; color: white; padding: 3px 8px; border-radius: 3px; font-size: 10px; }
</style>
</head>
<body>
  <div class="header">
    <div>
      <div class="company-name">Jurexio Legal AI Pvt. Ltd.</div>
      <div class="company-details">
        ${JRX_GST_DETAILS.address}<br>
        GSTIN: ${JRX_GST_DETAILS.gstin}<br>
        PAN: ${JRX_GST_DETAILS.pan}<br>
        SAC: ${JRX_GST_DETAILS.sacCode} | HSN: ${(JRX_GST_DETAILS as any).hsnCode ?? ''}
      </div>
    </div>
    <div>
      <div class="invoice-title">TAX INVOICE</div>
      <div class="invoice-meta">
        <strong>Invoice No:</strong> ${data.invoiceNumber}<br>
        <strong>Date:</strong> ${data.invoiceDate}<br>
        <strong>Period:</strong> ${data.period}<br>
        <span class="badge">${gst.gst_type}</span>
      </div>
    </div>
  </div>

  <div class="section">
    <div class="section-title">Bill To</div>
    <strong>${data.customerName}</strong><br>
    ${data.customerAddress ? data.customerAddress + '<br>' : ''}
    ${data.customerGstin ? `GSTIN: <strong>${data.customerGstin}</strong><br>` : ''}
    ${data.customerStateCode ? `State Code: ${data.customerStateCode}` : ''}
  </div>

  <div class="section">
    <div class="section-title">Service Details</div>
    <table>
      <tr><th>Description</th><th>SAC Code</th><th>Period</th><th>Amount (₹)</th></tr>
      <tr>
        <td>${data.planName} — Jurexio Legal AI Platform</td>
        <td>${JRX_GST_DETAILS.sacCode}</td>
        <td>${data.period}</td>
        <td style="text-align:right">₹${data.baseAmount.toFixed(2)}</td>
      </tr>
    </table>
  </div>

  <div class="section">
    <div class="section-title">Amount Summary</div>
    <table class="amount-table" style="width:50%; margin-left:50%">
      <tr><td>Base Amount</td><td style="text-align:right">₹${data.baseAmount.toFixed(2)}</td></tr>
      ${isIGST
        ? `<tr><td>IGST @ 18%</td><td style="text-align:right">₹${gst.igst.toFixed(2)}</td></tr>`
        : `<tr><td>CGST @ 9%</td><td style="text-align:right">₹${gst.cgst.toFixed(2)}</td></tr>
           <tr><td>SGST @ 9%</td><td style="text-align:right">₹${gst.sgst.toFixed(2)}</td></tr>`
      }
      <tr class="grand-total"><td><strong>Total Amount</strong></td><td style="text-align:right"><strong>₹${gst.total_amount.toFixed(2)}</strong></td></tr>
    </table>
  </div>

  <div class="section">
    <strong>Amount in Words:</strong> ${numberToWords(Math.round(gst.total_amount))} Rupees Only
  </div>

  ${data.notes ? `<div class="section"><div class="section-title">Notes</div>${data.notes}</div>` : ''}

  <div class="footer">
    <strong>Payment:</strong> This invoice is due upon receipt. GST charged as applicable under CGST/SGST/IGST Act, 2017.<br>
    <strong>Disclaimer:</strong> Jurexio platform provides AI-assisted legal research. Not a substitute for professional legal advice.<br>
    <strong>Support:</strong> support@jurexio.com | This is a computer-generated invoice and does not require a signature.
  </div>
</body>
</html>`;
}

function numberToWords(n: number): string {
  const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine',
    'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
  const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
  if (n === 0) return 'Zero';
  if (n < 20) return ones[n];
  if (n < 100) return tens[Math.floor(n / 10)] + (n % 10 ? ' ' + ones[n % 10] : '');
  if (n < 1000) return ones[Math.floor(n / 100)] + ' Hundred' + (n % 100 ? ' ' + numberToWords(n % 100) : '');
  if (n < 100000) return numberToWords(Math.floor(n / 1000)) + ' Thousand' + (n % 1000 ? ' ' + numberToWords(n % 1000) : '');
  if (n < 10000000) return numberToWords(Math.floor(n / 100000)) + ' Lakh' + (n % 100000 ? ' ' + numberToWords(n % 100000) : '');
  return numberToWords(Math.floor(n / 10000000)) + ' Crore' + (n % 10000000 ? ' ' + numberToWords(n % 10000000) : '');
}

class GstInvoicePdfService {
  async generatePDF(data: InvoiceData): Promise<InvoicePDFResult> {
    const gst = gstEngine.computeGST(
      data.baseAmount,
      // @ts-expect-error NV-TS230 legacy typing gap (TS2551)
      JRX_GST_DETAILS.stateCode,
      // @ts-expect-error NV-TS230 legacy typing gap (TS2551)
      data.customerStateCode || JRX_GST_DETAILS.stateCode,
    );

    const html = buildInvoiceHTML(data, gst);

    let pdfBuffer: Buffer;
    try {
      const puppeteer = await import('puppeteer');
      const browser = await puppeteer.default.launch({
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
        headless: true,
      });
      const page = await browser.newPage();
      await page.setContent(html, { waitUntil: 'networkidle0' });
      const pdfUint8 = await page.pdf({ format: 'A4', printBackground: true, margin: { top: '15mm', bottom: '15mm', left: '15mm', right: '15mm' } });
      await browser.close();
      pdfBuffer = Buffer.from(pdfUint8);
      logger.info('gst_pdf_generated', { invoiceNumber: data.invoiceNumber, size: pdfBuffer.length });
    } catch (puppeteerErr: any) {
      logger.warn('puppeteer_unavailable_fallback_html', { err: puppeteerErr.message });
      // Fallback: return HTML as buffer for display if puppeteer fails
      pdfBuffer = Buffer.from(html, 'utf8');
    }

    return {
      invoiceNumber: data.invoiceNumber,
      pdfBuffer,
      gstBreakdown: {
        baseAmount: gst.base_amount,
        cgst: gst.cgst,
        sgst: gst.sgst,
        igst: gst.igst,
        totalGst: gst.total_gst,
        totalAmount: gst.total_amount,
        gstType: gst.gst_type as 'IGST' | 'CGST+SGST',
      },
    };
  }
}

export const gstInvoicePdfService = new GstInvoicePdfService();
export default gstInvoicePdfService;
