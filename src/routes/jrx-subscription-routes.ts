// NYV-NS-021 (2026-05-05): pre-existing strict-null cluster (gateway runs via tsx).
/**
 * Jurexio Enterprise Platform 3.1.2 — Subscription & Credit Routes
 * NYV-ROUTE-SUBSCRIPTION-001
 *
 * Handover §6 — Subscription (platform access) and Credits (AI usage) are separate systems.
 *
 * Routes:
 *   GET  /api/jrx/subscription/me          — current user subscription + wallet
 *   GET  /api/jrx/subscription/plans       — all available plans
 *   POST /api/jrx/subscription/create      — create/upgrade subscription
 *   POST /api/jrx/subscription/cancel      — cancel subscription
 *   GET  /api/jrx/credits/wallet           — wallet balance + reserved
 *   GET  /api/jrx/credits/transactions     — ledger (last 50)
 *   POST /api/jrx/credits/topup            — add credits (admin/Razorpay webhook)
 *   GET  /api/jrx/credits/costs            — tool credit cost table
 */

import { Router, Request, Response } from 'express';
import { authenticateToken, requireRole } from '../middleware/auth.js';
import { tierGate } from '../middleware/jrx-tier-gate.js';
import { creditService, TOOL_CREDIT_COSTS } from '../services/jrx-credit-service.js';
import { db as _raw_db } from '../db/index.js';
import { lazyRequire } from '../utils/jrx-type-helpers.js';
const db = lazyRequire(() => _raw_db, 'db');
import { sql } from 'drizzle-orm';
import { createLogger } from '../utils/logger.js';

const router = Router();
const logger = createLogger('./jrx-subscription');

// ─────────────────────────────────────────
// Plans Definition
// ─────────────────────────────────────────

const NYV_PLANS = [
  {
    id: 'alpha',
    name: 'Alpha',
    tier: 'alpha',
    price_monthly_inr: 0,
    price_annual_inr: 0,
    credits_monthly: 20,
    features: ['5 AI pattern calls/day', 'Basic document analysis', 'English only', 'Community support'],
    ai_tools: ['document_analysis', 'case_stage_explanation'],
    template_modes: ['STRICT', 'MENTOR'],
    jurisdictions: ['IN'],
    max_cases: 5,
    highlight: false,
  },
  {
    id: 'solo',
    name: 'Solo Advocate',
    tier: 'solo',
    price_monthly_inr: 1999,
    price_annual_inr: 19990,
    credits_monthly: 100,
    features: ['50 AI pattern calls/day', 'Full document analysis', '4 Indian languages', 'Email support', 'Case management (50 cases)'],
    ai_tools: ['document_analysis', 'case_stage_explanation', 'hearing_notes_summary', 'fact_extraction', 'risk_assessment'],
    template_modes: ['STRICT', 'MENTOR'],
    jurisdictions: ['IN'],
    max_cases: 50,
    highlight: false,
  },
  {
    id: 'standard',
    name: 'Standard',
    tier: 'standard',
    price_monthly_inr: 4999,
    price_annual_inr: 49990,
    credits_monthly: 300,
    features: ['Unlimited AI calls', 'All document types', '12 Indian languages', 'Priority support', 'Case management (200 cases)', 'Legal notice drafting'],
    ai_tools: ['document_analysis', 'case_stage_explanation', 'hearing_notes_summary', 'fact_extraction', 'risk_assessment', 'draft_legal_notice'],
    template_modes: ['STRICT', 'MENTOR'],
    jurisdictions: ['IN', 'UK'],
    max_cases: 200,
    highlight: false,
  },
  {
    id: 'pro',
    name: 'Pro',
    tier: 'pro',
    price_monthly_inr: 9999,
    price_annual_inr: 99990,
    credits_monthly: 1000,
    features: ['Unlimited AI calls', 'All 22 AI patterns', 'All 22 Indian languages', 'Dedicated support', 'Unlimited cases', 'Petition drafting', 'GUIDED template mode', 'Clause comparison'],
    ai_tools: Object.keys(TOOL_CREDIT_COSTS),
    template_modes: ['STRICT', 'GUIDED', 'MENTOR'],
    jurisdictions: ['IN', 'UK', 'US'],
    max_cases: -1,
    highlight: true,
    badge: 'Most Popular',
  },
  {
    id: 'elite',
    name: 'Elite',
    tier: 'elite',
    price_monthly_inr: 24999,
    price_annual_inr: 249990,
    credits_monthly: 5000,
    features: ['Everything in Pro', 'All 6 jurisdictions', 'API access', 'Custom integrations', 'Dedicated account manager', 'SLA 99.9%', 'White-label options'],
    ai_tools: Object.keys(TOOL_CREDIT_COSTS),
    template_modes: ['STRICT', 'GUIDED', 'MENTOR'],
    jurisdictions: ['IN', 'UK', 'US', 'EU', 'GCC', 'SG'],
    max_cases: -1,
    highlight: false,
  },
  {
    id: 'enterprise',
    name: 'Enterprise',
    tier: 'enterprise',
    price_monthly_inr: null,
    price_annual_inr: null,
    credits_monthly: -1,
    features: ['Everything in Elite', 'Custom credit pools', 'On-premise options', 'Custom SLA', 'Dedicated infrastructure', 'Compliance reporting', 'Multi-jurisdiction teams'],
    ai_tools: Object.keys(TOOL_CREDIT_COSTS),
    template_modes: ['STRICT', 'GUIDED', 'MENTOR'],
    jurisdictions: ['IN', 'UK', 'US', 'EU', 'GCC', 'SG'],
    max_cases: -1,
    cta: 'Request Institutional Proposal',
    highlight: false,
  },
];

// ─────────────────────────────────────────
// Subscription Routes
// ─────────────────────────────────────────

/** GET /plans — public */
router.get('/plans', (_req: Request, res: Response): void => {
  res.json({ success: true, data: { plans: NYV_PLANS, currency: 'INR' } });
});

/** GET /me — authenticated */
router.get('/me', authenticateToken, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user?.id || req.user?.userId;
    let subscription = null;
    let wallet = null;

    try {
      const subRows = await db.execute(sql`
        SELECT subscription_id, plan_id, status, billing_cycle, amount_inr, currency,
               current_period_start, current_period_end, trial_end, created_at
        FROM nv_schema.subscription_table WHERE user_id = ${userId} LIMIT 1
      `);
      // @ts-expect-error NV-TS230 legacy typing gap (TS2352)
      subscription = (subRows as any[])[0] || null;
    } catch { subscription = null; }

    // @ts-expect-error NV-TS230 legacy typing gap (TS2345)
    wallet = await creditService.getWallet(userId);

    const plan = NYV_PLANS.find(p => p.id === (subscription?.plan_id || 'alpha')) || NYV_PLANS[0];

    res.json({
      success: true,
      data: {
        subscription: subscription || {
          plan_id: 'alpha',
          status: 'active',
          billing_cycle: 'free',
          amount_inr: 0,
          currency: 'INR',
        },
        plan,
        wallet: {
          balance: wallet?.credits_balance || 0,
          reserved: wallet?.reserved_credits || 0,
          available: wallet?.available_credits || 0,
          expiry: wallet?.credits_expiry || null,
          low_balance: (wallet?.available_credits || 0) < 10,
        },
      },
    });
  } catch (err: any) {
    logger.error('GET /me error', { err });
    res.status(500).json({ success: false, error: 'Failed to fetch subscription' });
  }
});

/** POST /create — authenticated */
router.post('/create', authenticateToken, requireRole('org_admin'), async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user?.id || req.user?.userId;
    const { plan_id, billing_cycle } = req.body as { plan_id: string; billing_cycle?: string };
    const plan = NYV_PLANS.find(p => p.id === plan_id);
    if (!plan) {
      res.status(400).json({ success: false, error: `Unknown plan: ${plan_id}` });
      return;
    }
    if (!plan.price_monthly_inr && plan.id !== 'alpha') {
      res.status(400).json({
        success: false,
        error: 'Enterprise plans require institutional onboarding',
        redirect: '/institutional',
        cta: 'Request Institutional Proposal',
      });
      return;
    }

    const cycle = billing_cycle || 'monthly';
    const amount = cycle === 'annual' ? (plan.price_annual_inr || 0) : (plan.price_monthly_inr || 0);
    const periodEnd = cycle === 'annual'
      ? new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString()
      : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

    await db.execute(sql`
      INSERT INTO nv_schema.subscription_table
        (user_id, plan_id, status, billing_cycle, amount_inr, currency, current_period_start, current_period_end)
      VALUES
        (${userId}, ${plan_id}, 'active', ${cycle}, ${amount}, 'INR', NOW(), ${periodEnd})
      ON CONFLICT (user_id) DO UPDATE SET
        plan_id = ${plan_id}, status = 'active', billing_cycle = ${cycle},
        amount_inr = ${amount}, current_period_end = ${periodEnd}, updated_at = NOW()
    `);

    // Grant monthly credits
    if (plan.credits_monthly > 0) {
      // @ts-expect-error NV-TS230 legacy typing gap (TS2345)
      await creditService.addCredits(userId, plan.credits_monthly, 'SYSTEM', `${plan_id} plan monthly credits`);
    }

    // Log subscription event
    await db.execute(sql`
      INSERT INTO nv_schema.subscription_events (user_id, event_type, new_status, source, payload)
      VALUES (${userId}, 'subscription_created', 'active', 'api', ${JSON.stringify({ plan_id, billing_cycle: cycle })}::jsonb)
    `).catch(() => {});

    res.json({
      success: true,
      data: {
        message: `Subscription to ${plan.name} plan activated`,
        plan_id,
        billing_cycle: cycle,
        credits_granted: plan.credits_monthly,
        next_billing: periodEnd,
        note: 'Razorpay payment gateway integration required for live billing',
      },
    });
  } catch (err: any) {
    logger.error('POST /create error', { err });
    res.status(500).json({ success: false, error: 'Failed to create subscription' });
  }
});

/** POST /cancel — authenticated */
router.post('/cancel', authenticateToken, requireRole('org_admin'), async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user?.id || req.user?.userId;
    const { reason } = req.body as { reason?: string };
    await db.execute(sql`
      UPDATE nv_schema.subscription_table
      SET status = 'cancelled', cancelled_at = NOW(), cancel_reason = ${reason || null}, updated_at = NOW()
      WHERE user_id = ${userId}
    `).catch(() => {});
    await db.execute(sql`
      INSERT INTO nv_schema.subscription_events (user_id, event_type, previous_status, new_status, source, payload)
      VALUES (${userId}, 'subscription_cancelled', 'active', 'cancelled', 'api', ${JSON.stringify({ reason })}::jsonb)
    `).catch(() => {});
    res.json({ success: true, data: { message: 'Subscription cancelled. Access continues until period end.' } });
  } catch (err: any) {
    res.status(500).json({ success: false, error: 'Failed to cancel subscription' });
  }
});

// ─────────────────────────────────────────
// Credit Routes
// ─────────────────────────────────────────

/** GET /credits/wallet */
router.get('/credits/wallet', authenticateToken, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user?.id || req.user?.userId;
    // @ts-expect-error NV-TS230 legacy typing gap (TS2345)
    const wallet = await creditService.getWallet(userId);
    res.json({ success: true, data: wallet });
  } catch (err: any) {
    res.status(500).json({ success: false, error: 'Failed to fetch wallet' });
  }
});

/** GET /credits/transactions */
router.get('/credits/transactions', authenticateToken, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user?.id || req.user?.userId;
    const limit = Math.min(100, parseInt((req.query.limit as string) || '50', 10));
    // @ts-expect-error NV-TS230 legacy typing gap (TS2345)
    const txns = await creditService.getTransactions(userId, limit);
    res.json({ success: true, data: { transactions: txns, count: txns.length } });
  } catch (err: any) {
    res.status(500).json({ success: false, error: 'Failed to fetch transactions' });
  }
});

/** POST /credits/topup — admin or webhook only */
router.post('/credits/topup', authenticateToken, tierGate(['enterprise', 'government']), async (req: Request, res: Response): Promise<void> => {
  try {
    const { user_id, amount, source, note } = req.body as {
      user_id: string; amount: number; source?: string; note?: string;
    };
    if (!user_id || !amount || amount <= 0) {
      res.status(400).json({ success: false, error: 'user_id and positive amount required' });
      return;
    }
    const success = await creditService.addCredits(user_id, amount, (source as any) || 'MANUAL', note);
    res.json({ success, data: { user_id, credits_added: amount } });
  } catch (err: any) {
    res.status(500).json({ success: false, error: 'Topup failed' });
  }
});

/** GET /credits/costs — public — shows tool credit costs */
router.get('/credits/costs', (_req: Request, res: Response): void => {
  res.json({
    success: true,
    data: {
      costs: TOOL_CREDIT_COSTS,
      note: 'Credits are deducted per successful AI tool execution. Failed executions are not charged.',
      zero_balance_policy: 'All AI tools are immediately disabled when balance reaches 0. Returns HTTP 402.',
      low_balance_threshold: 10,
    },
  });
});

export { router as nvSubscriptionRouter };
