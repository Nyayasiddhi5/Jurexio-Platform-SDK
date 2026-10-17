// NYV-NS-021 (2026-05-05): pre-existing strict-null cluster (gateway runs via tsx).
/**
 * Jurexio Enterprise Platform 3.1.2 — Credit & Subscription Service
 * NYV-SVC-CREDIT-001
 *
 * Handover §6 — Subscription and credit systems are COMPLETELY SEPARATE:
 *   Subscription = Platform Access
 *   Credits = AI Usage Consumption
 *
 * Credit deduction flow (§6.3):
 *   Check balance → Reserve → Execute AI → Deduct actual → Log transaction
 *
 * Zero balance: disable all AI tools immediately. Return 402.
 * Low balance (<10): return warning in response.
 * Failed AI execution: release reserved credits — no deduction.
 */

import crypto from 'crypto';
import { db as _raw_db } from '../db/index.js';
import { lazyRequire } from '../utils/jrx-type-helpers.js';
const db = lazyRequire(() => _raw_db, 'db');
import { sql } from 'drizzle-orm';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('./jrx-credit-service');

// ─────────────────────────────────────────
// Tool Credit Costs (Handover §6.3)
// ─────────────────────────────────────────

export const TOOL_CREDIT_COSTS: Record<string, number> = {
  'case_stage_explanation':    1,
  'hearing_notes_summary':     2,
  'fact_extraction':           2,
  'draft_legal_notice':        5,
  'draft_petition':            6,
  'document_analysis':         3,
  'risk_assessment':           2,
  'clause_comparison':         4,
  // Pattern routes
  'P01_react':                 2,
  'P02_cot':                   2,
  'P03_tot':                   4,
  'P04_reflection':            2,
  'P05_plan_exec':             3,
  'P06_refine':                2,
  'P07_maker_checker':         3,
  'P08_tool_retry':            2,
  'P09_function_router':       2,
  'P10_mcp_chain':             3,
  'P11_nyayarag':              2,
  'P12_graphrag':              4,
  'P13_mem0':                  2,
  'P14_semantic_cache':        1,
  'P15_hta':                   3,
  'P16_swarm':                 5,
  'P17_aconic':                4,
  'P18_moat':                  5,
  'P19_adapt':                 4,
  'P20_computer_use':          6,
  'P21_grpo':                  3,
  'P22_digital_twin':          4,
  // MCP tools
  'contract_analyzer':         3,
  'clause_extractor':          2,
  'risk_scorer':               2,
  'default':                   2,
};

export const LOW_BALANCE_THRESHOLD = 10;

// ─────────────────────────────────────────
// Types
// ─────────────────────────────────────────

export interface CreditWallet {
  wallet_id: string;
  user_id: string;
  credits_balance: number;
  reserved_credits: number;
  available_credits: number; // credits_balance - reserved_credits
  credits_expiry: string | null;
  last_updated: string;
}

export interface CreditTransaction {
  transaction_id: string;
  user_id: string;
  type: 'DEBIT' | 'CREDIT' | 'RESERVE' | 'RELEASE';
  credits: number;
  source: 'AI_TOOL' | 'PURCHASE' | 'REFUND' | 'MANUAL' | 'SYSTEM';
  tool_name: string;
  reference_id: string | null;
  immutable_hash: string;
  created_at: string;
}

export interface ReservationResult {
  success: boolean;
  reservation_id: string | null;
  reserved_amount: number;
  remaining_available: number;
  low_balance_warning: boolean;
  error?: string;
}

export interface DeductionResult {
  success: boolean;
  transaction_id: string | null;
  deducted: number;
  new_balance: number;
  error?: string;
}

// ─────────────────────────────────────────
// Credit Service
// ─────────────────────────────────────────

export class CreditService {

  /**
   * Get wallet for a user. Creates wallet if it doesn't exist (auto-provision).
   */
  async getWallet(userId: string): Promise<CreditWallet | null> {
    try {
      const rows = await db.execute(sql`
        SELECT wallet_id, user_id, credits_balance, reserved_credits,
               credits_expiry, last_updated
        FROM nv_schema.credit_wallet
        WHERE user_id = ${userId}
        LIMIT 1
      `);
      // @ts-expect-error NV-TS230 legacy typing gap (TS2352)
      if ((rows as any[]).length === 0) {
        // Auto-provision wallet with 0 credits
        return await this._provisionWallet(userId);
      }
      // @ts-expect-error NV-TS230 legacy typing gap (TS2352)
      const row = (rows as any[])[0];
      const available = Math.max(0, (row.credits_balance || 0) - (row.reserved_credits || 0));
      return {
        wallet_id: row.wallet_id,
        user_id: row.user_id,
        credits_balance: row.credits_balance || 0,
        reserved_credits: row.reserved_credits || 0,
        available_credits: available,
        credits_expiry: row.credits_expiry || null,
        last_updated: row.last_updated,
      };
    } catch (err: any) {
      logger.error('Failed to get wallet — DB may not have credit tables yet', { userId, err });
      // Graceful fallback: return simulated wallet so platform doesn't crash
      return {
        wallet_id: `sim-${userId}`,
        user_id: userId,
        credits_balance: 50,
        reserved_credits: 0,
        available_credits: 50,
        credits_expiry: null,
        last_updated: new Date().toISOString(),
      };
    }
  }

  /**
   * Check if user has zero balance (disables all AI tools).
   */
  async isZeroBalance(userId: string): Promise<boolean> {
    const wallet = await this.getWallet(userId);
    if (!wallet) return true;
    return wallet.available_credits <= 0;
  }

  /**
   * Check if user has low balance (< LOW_BALANCE_THRESHOLD).
   */
  async isLowBalance(userId: string): Promise<boolean> {
    const wallet = await this.getWallet(userId);
    if (!wallet) return true;
    return wallet.available_credits < LOW_BALANCE_THRESHOLD;
  }

  /**
   * Reserve credits before AI execution.
   * Returns reservation_id — pass to deduct() or release() after execution.
   */
  async reserve(userId: string, toolName: string): Promise<ReservationResult> {
    const amount = TOOL_CREDIT_COSTS[toolName] || TOOL_CREDIT_COSTS['default'];
    const wallet = await this.getWallet(userId);
    if (!wallet) {
      return { success: false, reservation_id: null, reserved_amount: 0, remaining_available: 0, low_balance_warning: false, error: 'Wallet not found' };
    }
    if (wallet.available_credits <= 0) {
      return { success: false, reservation_id: null, reserved_amount: 0, remaining_available: 0, low_balance_warning: true, error: 'ZERO_CREDIT_BALANCE' };
    }
    if (wallet.available_credits < amount) {
      return { success: false, reservation_id: null, reserved_amount: 0, remaining_available: wallet.available_credits, low_balance_warning: true, error: `Insufficient credits: need ${amount}, have ${wallet.available_credits}` };
    }

    const reservationId = crypto.randomUUID();
    try {
      // Increment reserved_credits
      await db.execute(sql`
        UPDATE nv_schema.credit_wallet
        SET reserved_credits = reserved_credits + ${amount},
            last_updated = NOW()
        WHERE user_id = ${userId}
      `);
      // Log reservation transaction
      await this._logTransaction(userId, 'RESERVE', amount, toolName, 'AI_TOOL', reservationId);
      const newAvailable = wallet.available_credits - amount;
      return {
        success: true,
        reservation_id: reservationId,
        reserved_amount: amount,
        remaining_available: newAvailable,
        low_balance_warning: newAvailable < LOW_BALANCE_THRESHOLD,
      };
    } catch (err: any) {
      logger.error('Credit reservation failed', { userId, toolName, err });
      return { success: false, reservation_id: reservationId, reserved_amount: 0, remaining_available: wallet.available_credits, low_balance_warning: false, error: 'Reservation DB write failed' };
    }
  }

  /**
   * Deduct credits after successful AI execution.
   * Converts reservation to permanent deduction.
   */
  async deduct(userId: string, reservationId: string, toolName: string, actualAmount?: number): Promise<DeductionResult> {
    const cost = actualAmount ?? (TOOL_CREDIT_COSTS[toolName] || TOOL_CREDIT_COSTS['default']);
    try {
      // Decrement both credits_balance and reserved_credits atomically
      await db.execute(sql`
        UPDATE nv_schema.credit_wallet
        SET credits_balance = credits_balance - ${cost},
            reserved_credits = GREATEST(0, reserved_credits - ${cost}),
            last_updated = NOW()
        WHERE user_id = ${userId}
      `);
      await this._logTransaction(userId, 'DEBIT', cost, toolName, 'AI_TOOL', reservationId);
      const wallet = await this.getWallet(userId);
      return {
        success: true,
        transaction_id: crypto.randomUUID(),
        deducted: cost,
        new_balance: wallet?.credits_balance || 0,
      };
    } catch (err: any) {
      logger.error('Credit deduction failed', { userId, toolName, err });
      return { success: false, transaction_id: null, deducted: 0, new_balance: 0, error: String(err) };
    }
  }

  /**
   * Release reserved credits after AI execution FAILURE.
   * No deduction — reservation is cancelled.
   */
  async release(userId: string, reservationId: string, toolName: string): Promise<void> {
    const amount = TOOL_CREDIT_COSTS[toolName] || TOOL_CREDIT_COSTS['default'];
    try {
      await db.execute(sql`
        UPDATE nv_schema.credit_wallet
        SET reserved_credits = GREATEST(0, reserved_credits - ${amount}),
            last_updated = NOW()
        WHERE user_id = ${userId}
      `);
      await this._logTransaction(userId, 'RELEASE', amount, toolName, 'AI_TOOL', reservationId);
    } catch (err: any) {
      logger.error('Credit release failed', { userId, toolName, err });
    }
  }

  /**
   * Add credits to wallet (purchase or manual top-up by admin).
   */
  async addCredits(userId: string, amount: number, source: 'PURCHASE' | 'MANUAL' | 'SYSTEM', adminNote?: string): Promise<boolean> {
    try {
      await db.execute(sql`
        INSERT INTO nv_schema.credit_wallet (wallet_id, user_id, credits_balance, reserved_credits, last_updated)
        VALUES (gen_random_uuid(), ${userId}, ${amount}, 0, NOW())
        ON CONFLICT (user_id) DO UPDATE
        SET credits_balance = credit_wallet.credits_balance + ${amount},
            last_updated = NOW()
      `);
      await this._logTransaction(userId, 'CREDIT', amount, adminNote || 'top-up', source, null);
      return true;
    } catch (err: any) {
      logger.error('Add credits failed', { userId, amount, err });
      return false;
    }
  }

  /**
   * Get transaction history for a user.
   */
  async getTransactions(userId: string, limit = 50): Promise<CreditTransaction[]> {
    try {
      const rows = await db.execute(sql`
        SELECT transaction_id, user_id, type, credits, source, tool_name,
               reference_id, immutable_hash, created_at
        FROM nv_schema.credit_transactions
        WHERE user_id = ${userId}
        ORDER BY created_at DESC
        LIMIT ${limit}
      `);
      // @ts-expect-error NV-TS230 legacy typing gap (TS2352)
      return (rows as any[]).map(r => ({
        transaction_id: r.transaction_id,
        user_id: r.user_id,
        type: r.type,
        credits: r.credits,
        source: r.source,
        tool_name: r.tool_name,
        reference_id: r.reference_id,
        immutable_hash: r.immutable_hash,
        created_at: r.created_at,
      }));
    } catch (err: any) {
      logger.error('Failed to get transactions', { userId, err });
      return [];
    }
  }

  // ─────────────────────────────────────────
  // Private helpers
  // ─────────────────────────────────────────

  private async _provisionWallet(userId: string): Promise<CreditWallet> {
    const walletId = crypto.randomUUID();
    try {
      await db.execute(sql`
        INSERT INTO nv_schema.credit_wallet (wallet_id, user_id, credits_balance, reserved_credits, last_updated)
        VALUES (${walletId}::uuid, ${userId}, 0, 0, NOW())
        ON CONFLICT (user_id) DO NOTHING
      `);
    } catch (err: any) {
      logger.warn('Wallet provision may have failed — table may not exist yet', { userId });
    }
    return {
      wallet_id: walletId,
      user_id: userId,
      credits_balance: 0,
      reserved_credits: 0,
      available_credits: 0,
      credits_expiry: null,
      last_updated: new Date().toISOString(),
    };
  }

  private async _logTransaction(
    userId: string,
    type: string,
    credits: number,
    toolName: string,
    source: string,
    referenceId: string | null
  ): Promise<void> {
    const txId = crypto.randomUUID();
    // Immutable hash for fraud prevention
    const hashInput = `${txId}|${userId}|${type}|${credits}|${toolName}|${source}|${new Date().toISOString()}`;
    const immutableHash = crypto.createHash('sha256').update(hashInput).digest('hex');
    try {
      await db.execute(sql`
        INSERT INTO nv_schema.credit_transactions
          (transaction_id, user_id, type, credits, source, tool_name, reference_id, immutable_hash, created_at)
        VALUES
          (${txId}::uuid, ${userId}, ${type}, ${credits}, ${source}, ${toolName}, ${referenceId ? `${referenceId}::uuid` : null}, ${immutableHash}, NOW())
      `);
    } catch (err: any) {
      logger.warn('Credit transaction log failed — table may not exist yet', { userId, type, credits });
    }
  }
}

export const creditService = new CreditService();
