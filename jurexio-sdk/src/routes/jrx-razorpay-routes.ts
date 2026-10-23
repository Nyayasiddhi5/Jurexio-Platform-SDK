// JRX-NS-021 (2026-05-05): pre-existing TS errors (gateway runs via tsx).
/**
 * JRX Razorpay Payment Routes
 * Dedicated payment processing routes — MUST integration for India market
 * Base path: /api/jrx/payments
 *
 * Supports: Orders · Capture · Refunds · Subscriptions · Plans · Customers · Invoices · Payment Links · Webhooks
 * Currencies: INR (primary), USD, AED, SAR, SGD, EUR
 * Live mode: Set RAZORPAY_KEY_ID + RAZORPAY_KEY_SECRET in environment
 * Test mode: Set RAZORPAY_KEY_ID=rzp_test_... for Razorpay test environment
 * Mock mode: Active when keys absent — safe to develop without keys
 */

import { Router, Request, Response } from 'express';
import { razorpayPaymentService } from '../services/razorpay-payment-service.js';
import { PAYMENT_CONFIG } from '../config/platform-config.js';
import { authenticateToken, requireRole } from '../middleware/jrx-auth.js';
import { createLogger } from '../utils/logger.js';


const logger = createLogger('razorpay-routes');

const router = Router();

// NV-RBAC-GAP-001: every payment MUTATION (orders/capture/refund/subscriptions/
// customers/invoices/links) was mounted with NO auth — any caller could create
// orders, capture/refund money or mint subscriptions. Gate billing writes with
// auth + org_admin (the buyer/account-owner role); plan catalog is super_admin.
// `/webhook` + `/verify` keep their Razorpay SIGNATURE verification (machine
// callbacks, no JWT); `/health` and GET-by-id reads stay as-is.
const billingAdmin = [authenticateToken, requireRole('org_admin')];
const platformAdmin = [authenticateToken, requireRole('super_admin')];

// ─── Health / Status ──────────────────────────────────────────────────────────

/**
 * GET /api/jrx/payments/health
 * Returns Razorpay service mode: live | test | mock
 * Public endpoint — no auth required (safe — no data exposed)
 */
router.get('/health', (_req: Request, res: Response): void => {
  const isConfigured = PAYMENT_CONFIG.razorpay.isConfigured;
  const keyId = PAYMENT_CONFIG.razorpay.keyId;
  const isTest = keyId.startsWith('rzp_test_');
  const isLive = isConfigured && !isTest;

  res.json({
    success: true,
    data: {
      service: 'razorpay',
      mode: isLive ? 'live' : isTest ? 'test' : 'mock',
      configured: isConfigured,
      webhookConfigured: !!PAYMENT_CONFIG.razorpay.webhookSecret,
      supportedCurrencies: ['INR', 'USD', 'AED', 'SAR', 'SGD', 'EUR'],
      supportedMethods: ['upi', 'card', 'netbanking', 'wallet', 'emi', 'pay_later'],
      features: {
        orders: true,
        subscriptions: true,
        customers: true,
        invoices: true,
        paymentLinks: true,
        refunds: true,
        webhooks: isConfigured,
      },
      keyPrefix: isConfigured ? keyId.substring(0, 12) + '...' : null,
      note: isLive
        ? 'Live payments active'
        : isTest
          ? 'Test mode — no real charges'
          : 'Mock mode — set RAZORPAY_KEY_ID + RAZORPAY_KEY_SECRET to activate',
    },
    meta: { timestamp: new Date().toISOString() },
  });
});

// ─── Webhook (raw body required — before json middleware for this route) ──────

/**
 * POST /api/jrx/payments/webhook
 * Receives Razorpay webhook events. Verifies HMAC signature.
 * Register this URL in Razorpay Dashboard → Webhooks
 * Events handled: payment.captured, payment.failed, subscription.activated,
 *                 subscription.charged, subscription.cancelled, refund.processed
 */
router.post('/webhook', (req: Request, res: Response): void => {
  const webhookSecret = PAYMENT_CONFIG.razorpay.webhookSecret;

  if (!webhookSecret) {
    logger.warn('[Razorpay Webhook] RAZORPAY_WEBHOOK_SECRET not set — webhook verification skipped');
    res.json({ success: true, message: 'Webhook received (unverified — set RAZORPAY_WEBHOOK_SECRET)' });
    return;
  }

  const signature = req.headers['x-razorpay-signature'] as string;
  const rawBody = JSON.stringify(req.body);

  const isValid = razorpayPaymentService.verifyWebhookSignature(rawBody, signature, webhookSecret);

  if (!isValid) {
    logger.error('[Razorpay Webhook] Invalid signature — rejected');
    res.status(400).json({ success: false, error: 'Invalid webhook signature' });
    return;
  }

  const event = req.body;
  logger.info(`[Razorpay Webhook] Event received: ${event?.event || 'unknown'}`);

  // Handle specific events
  switch (event?.event) {
    case 'payment.captured':
      logger.info(`[Razorpay] Payment captured: ${event.payload?.payment?.entity?.id}`);
      break;
    case 'payment.failed':
      logger.warn(`[Razorpay] Payment failed: ${event.payload?.payment?.entity?.id}`);
      break;
    case 'subscription.activated':
      logger.info(`[Razorpay] Subscription activated: ${event.payload?.subscription?.entity?.id}`);
      break;
    case 'subscription.charged':
      logger.info(`[Razorpay] Subscription charged: ${event.payload?.subscription?.entity?.id}`);
      break;
    case 'subscription.cancelled':
      logger.info(`[Razorpay] Subscription cancelled: ${event.payload?.subscription?.entity?.id}`);
      break;
    case 'refund.processed':
      logger.info(`[Razorpay] Refund processed: ${event.payload?.refund?.entity?.id}`);
      break;
    default:
      logger.info(`[Razorpay] Unhandled event type: ${event?.event}`);
  }

  res.json({ success: true, message: 'Webhook processed' });
});

// ─── Orders ───────────────────────────────────────────────────────────────────

/**
 * POST /api/jrx/payments/orders
 * Create a Razorpay order (required before any payment)
 * Body: { amount: number (paise), currency?: string, receipt?: string, notes?: object }
 */
router.post('/orders', billingAdmin, async (req: Request, res: Response): Promise<void> => {
  const { amount, currency, receipt, notes } = req.body;

  if (!amount || typeof amount !== 'number') {
    res.status(400).json({ success: false, error: 'Missing required field: amount (number in smallest unit — paise for INR)' });
    return;
  }

  try {
    const order = await razorpayPaymentService.createOrder(amount, currency || 'INR', receipt, notes);
    res.status(201).json({
      success: true,
      data: order,
      meta: { mode: PAYMENT_CONFIG.razorpay.isConfigured ? 'live' : 'mock' },
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: `Order creation failed: ${error?.message}` });
  }
});

/**
 * GET /api/jrx/payments/orders/:orderId
 */
router.get('/orders/:orderId', async (req: Request, res: Response): Promise<void> => {
  try {
    const order = await razorpayPaymentService.getOrder(String(req.params.orderId));
    res.json({ success: true, data: order });
  } catch (error: any) {
    res.status(500).json({ success: false, error: `Order fetch failed: ${error?.message}` });
  }
});

// ─── Payments ─────────────────────────────────────────────────────────────────

/**
 * POST /api/jrx/payments/capture
 * Capture an authorized payment
 * Body: { paymentId, amount, currency? }
 */
router.post('/capture', billingAdmin, async (req: Request, res: Response): Promise<void> => {
  const { paymentId, amount, currency } = req.body;

  if (!paymentId || !amount) {
    res.status(400).json({ success: false, error: 'Missing required fields: paymentId, amount' });
    return;
  }

  try {
    const payment = await razorpayPaymentService.capturePayment(paymentId, amount, currency || 'INR');
    res.json({ success: true, data: payment });
  } catch (error: any) {
    res.status(500).json({ success: false, error: `Payment capture failed: ${error?.message}` });
  }
});

/**
 * POST /api/jrx/payments/refund
 * Refund a captured payment
 * Body: { paymentId, amount?, notes? }
 */
router.post('/refund', billingAdmin, async (req: Request, res: Response): Promise<void> => {
  const { paymentId, amount, notes } = req.body;

  if (!paymentId) {
    res.status(400).json({ success: false, error: 'Missing required field: paymentId' });
    return;
  }

  try {
    const refund = await razorpayPaymentService.refundPayment(paymentId, amount, notes);
    res.json({ success: true, data: refund });
  } catch (error: any) {
    res.status(500).json({ success: false, error: `Refund failed: ${error?.message}` });
  }
});

/**
 * POST /api/jrx/payments/verify
 * Verify payment signature (call from frontend after payment completion)
 * Body: { orderId, paymentId, signature }
 */
router.post('/verify', (req: Request, res: Response): void => {
  const { orderId, paymentId, signature } = req.body;

  if (!orderId || !paymentId || !signature) {
    res.status(400).json({ success: false, error: 'Missing required fields: orderId, paymentId, signature' });
    return;
  }

  const body = `${orderId}|${paymentId}`;
  const webhookSecret = PAYMENT_CONFIG.razorpay.keySecret;
  const isValid = razorpayPaymentService.verifyWebhookSignature(body, signature, webhookSecret);

  res.json({
    success: true,
    data: { verified: isValid, orderId, paymentId },
  });
});

// ─── Subscriptions ────────────────────────────────────────────────────────────

/**
 * POST /api/jrx/payments/plans
 * Create a subscription plan (e.g., Jurexio Citizen Plus ₹299/month)
 * Body: { name, period, interval, amount, currency?, description? }
 */
router.post('/plans', platformAdmin, async (req: Request, res: Response): Promise<void> => {
  const { name, period, interval, amount, currency, description } = req.body;

  if (!name || !period || !interval || !amount) {
    res.status(400).json({ success: false, error: 'Missing required fields: name, period, interval, amount' });
    return;
  }

  try {
    const plan = await razorpayPaymentService.createPlan(name, period, interval, amount, currency || 'INR', description);
    res.status(201).json({ success: true, data: plan });
  } catch (error: any) {
    res.status(500).json({ success: false, error: `Plan creation failed: ${error?.message}` });
  }
});

/**
 * POST /api/jrx/payments/subscriptions
 * Create a subscription for a customer on a plan
 * Body: { planId, customerId, totalCount, notes? }
 */
router.post('/subscriptions', billingAdmin, async (req: Request, res: Response): Promise<void> => {
  const { planId, customerId, totalCount, notes } = req.body;

  if (!planId || !totalCount) {
    res.status(400).json({ success: false, error: 'Missing required fields: planId, totalCount' });
    return;
  }

  try {
    const subscription = await razorpayPaymentService.createSubscription(planId, customerId, totalCount, notes);
    res.status(201).json({ success: true, data: subscription });
  } catch (error: any) {
    res.status(500).json({ success: false, error: `Subscription creation failed: ${error?.message}` });
  }
});

/**
 * GET /api/jrx/payments/subscriptions/:subscriptionId
 */
router.get('/subscriptions/:subscriptionId', async (req: Request, res: Response): Promise<void> => {
  try {
    const sub = await razorpayPaymentService.getSubscription(String(req.params.subscriptionId));
    res.json({ success: true, data: sub });
  } catch (error: any) {
    res.status(500).json({ success: false, error: `Subscription fetch failed: ${error?.message}` });
  }
});

/**
 * POST /api/jrx/payments/subscriptions/:subscriptionId/cancel
 * Body: { cancelAtEnd?: boolean }
 */
router.post('/subscriptions/:subscriptionId/cancel', billingAdmin, async (req: Request, res: Response): Promise<void> => {
  const cancelAtEnd = req.body.cancelAtEnd !== false;

  try {
    const result = await razorpayPaymentService.cancelSubscription(String(req.params.subscriptionId), cancelAtEnd);
    res.json({ success: true, data: result });
  } catch (error: any) {
    res.status(500).json({ success: false, error: `Subscription cancellation failed: ${error?.message}` });
  }
});

// ─── Customers ────────────────────────────────────────────────────────────────

/**
 * POST /api/jrx/payments/customers
 * Create or find a Razorpay customer
 * Body: { name, email, contact, notes? }
 */
router.post('/customers', billingAdmin, async (req: Request, res: Response): Promise<void> => {
  const { name, email, contact, notes } = req.body;

  if (!name || !email) {
    res.status(400).json({ success: false, error: 'Missing required fields: name, email' });
    return;
  }

  try {
    const customer = await razorpayPaymentService.createCustomer(name, email, contact, notes);
    res.status(201).json({ success: true, data: customer });
  } catch (error: any) {
    res.status(500).json({ success: false, error: `Customer creation failed: ${error?.message}` });
  }
});

// ─── Invoices ─────────────────────────────────────────────────────────────────

/**
 * POST /api/jrx/payments/invoices
 * Create a Razorpay invoice (for retainer billing, one-time fees)
 * Body: { type, description, customer: {id|email|name}, line_items, ... }
 */
router.post('/invoices', billingAdmin, async (req: Request, res: Response): Promise<void> => {
  if (!req.body || !req.body.type) {
    res.status(400).json({ success: false, error: 'Missing required field: type' });
    return;
  }

  try {
    const invoice = await razorpayPaymentService.createInvoice(req.body);
    res.status(201).json({ success: true, data: invoice });
  } catch (error: any) {
    res.status(500).json({ success: false, error: `Invoice creation failed: ${error?.message}` });
  }
});

// ─── Payment Links ────────────────────────────────────────────────────────────

/**
 * POST /api/jrx/payments/links
 * Create a shareable payment link (for WhatsApp, SMS, email collection)
 * Body: { amount, currency?, description, customer?: {name, email, contact}, notifyPhone?, notifyEmail? }
 */
router.post('/links', billingAdmin, async (req: Request, res: Response): Promise<void> => {
  const { amount, currency, description, customer, notifyPhone, notifyEmail } = req.body;

  if (!amount) {
    res.status(400).json({ success: false, error: 'Missing required field: amount' });
    return;
  }

  try {
    const link = await razorpayPaymentService.createPaymentLink(
      amount,
      currency || 'INR',
      description || 'JRX Legal Services Payment',
      customer,
      notifyPhone,
      // @ts-expect-error NV-TS230 legacy typing gap (TS2554)
      notifyEmail,
    );
    res.status(201).json({
      success: true,
      data: link,
      meta: { shareUrl: (link as any).short_url || null },
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: `Payment link creation failed: ${error?.message}` });
  }
});

export default router;
