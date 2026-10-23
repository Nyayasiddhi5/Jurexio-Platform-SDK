/**
 * Jurexio Enterprise Platform 3.1.2 — Credit Gate Middleware
 * JRX-MW-CREDITGATE-001
 *
 * Handover §6.3 — Zero balance IMMEDIATELY disables ALL AI tools.
 * Returns HTTP 402 Payment Required with specific error codes.
 *
 * Usage: apply to any route that consumes AI credits.
 * The middleware reads req.body.toolName (or falls back to route-derived name)
 * to look up the credit cost.
 */

import { Request, Response, NextFunction } from 'express';
import { creditService, TOOL_CREDIT_COSTS } from '../services/jrx-credit-service.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('./jrx-credit-gate');

/**
 * Credit gate factory.
 * @param toolName - The AI tool name. Must match a key in TOOL_CREDIT_COSTS.
 *                   If not provided, reads from req.body.toolName or falls back to 'default'.
 */
export function creditGate(toolName?: string) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const user = req.user;
    if (!user) {
      res.status(401).json({ success: false, error: 'Authentication required for credit gate' });
      return;
    }

    const resolvedTool = toolName || (req.body as any)?.toolName || 'default';
    const cost = TOOL_CREDIT_COSTS[resolvedTool] || TOOL_CREDIT_COSTS['default'];
    const userId = (user.id || user.userId || user.sub) as string | undefined;
    if (!userId) {
      res.status(401).json({ success: false, error: 'Authentication required for credit gate' });
      return;
    }

    try {
      // Check zero balance first (fastest path)
      const wallet = await creditService.getWallet(userId);
      if (!wallet || wallet.available_credits <= 0) {
        logger.warn('Credit gate: zero balance — 402 returned', { userId, tool: resolvedTool });
        res.status(402).json({
          success: false,
          error: 'ZERO_CREDIT_BALANCE',
          message: 'Your credit balance is zero. Top up to continue using AI tools.',
          available_credits: 0,
          cost_required: cost,
          tool: resolvedTool,
          top_up_url: '/subscription/credits',
        });
        return;
      }

      if (wallet.available_credits < cost) {
        logger.warn('Credit gate: insufficient credits', { userId, tool: resolvedTool, need: cost, have: wallet.available_credits });
        res.status(402).json({
          success: false,
          error: 'INSUFFICIENT_CREDITS',
          message: `This tool requires ${cost} credits. You have ${wallet.available_credits} available.`,
          available_credits: wallet.available_credits,
          cost_required: cost,
          tool: resolvedTool,
          top_up_url: '/subscription/credits',
        });
        return;
      }

      // Reserve credits — attach to request for deduction after successful execution
      const reservation = await creditService.reserve(userId, resolvedTool);
      if (!reservation.success) {
        res.status(402).json({
          success: false,
          error: reservation.error || 'CREDIT_RESERVATION_FAILED',
          message: reservation.error || 'Credit reservation failed',
          available_credits: wallet.available_credits,
          cost_required: cost,
          tool: resolvedTool,
        });
        return;
      }

      // Attach reservation to request for deduction in route handler
      req.creditReservation = {
        reservation_id: reservation.reservation_id ?? undefined,
        tool: resolvedTool,
        amount: reservation.reserved_amount,
        userId,
      };

      // Attach low balance warning for response injection
      if (reservation.low_balance_warning) {
        req.creditLowBalanceWarning = {
          warning: true,
          remaining_credits: reservation.remaining_available,
          message: `Low credit balance: ${reservation.remaining_available} credits remaining`,
        };
      }

      logger.debug('Credit reserved', { userId, tool: resolvedTool, amount: cost, reservationId: reservation.reservation_id });
      next();
    } catch (err: any) {
      logger.error('Credit gate error', { userId, tool: resolvedTool, err });
      // Fail open on service error — don't block AI execution due to credit system issues
      logger.warn('Failing open — credit system error did not block request');
      next();
    }
  };
}

/**
 * Complete credit deduction after successful AI execution.
 * Call this in the route handler after getting a successful AI response.
 */
export async function finalizeCredit(req: Request): Promise<void> {
  const reservation = req.creditReservation;
  if (!reservation) return;
  // Fail loud on malformed reservations: a reservation that lacks userId,
  // reservation_id, or amount means the credit gate produced an inconsistent
  // record. Silently no-oping would let users consume AI without being
  // billed. Surface via logger.error and abort so the route handler's
  // error path runs (and the caught exception is recorded).
  if (!reservation.userId || !reservation.reservation_id || reservation.amount == null) {
    logger.error('Credit finalization aborted: reservation missing required fields', {
      hasUserId: Boolean(reservation.userId),
      hasReservationId: Boolean(reservation.reservation_id),
      amount: reservation.amount,
      tool: reservation.tool,
    });
    throw new Error('CREDIT_RESERVATION_INCOMPLETE: cannot finalize without userId, reservation_id, and amount');
  }
  try {
    await creditService.deduct(reservation.userId, reservation.reservation_id, reservation.tool, reservation.amount);
  } catch (err: unknown) {
    logger.error('Credit finalization failed', { reservation, err: err instanceof Error ? err.message : String(err) });
    throw err;
  }
}

/**
 * Release reserved credits after failed AI execution.
 * Call this in catch blocks to prevent credit leakage.
 */
export async function releaseCredit(req: Request): Promise<void> {
  const reservation = req.creditReservation;
  if (!reservation) return;
  if (!reservation.userId || !reservation.reservation_id) {
    // Same fail-loud rationale as finalizeCredit: silently dropping a
    // release would leak reserved credits indefinitely. We log at error
    // and return without throwing here because release runs in catch
    // blocks where re-throwing would mask the original failure.
    logger.error('Credit release aborted: reservation missing required fields', {
      hasUserId: Boolean(reservation.userId),
      hasReservationId: Boolean(reservation.reservation_id),
      tool: reservation.tool,
    });
    return;
  }
  try {
    await creditService.release(reservation.userId, reservation.reservation_id, reservation.tool);
  } catch (err: unknown) {
    logger.error('Credit release failed', { reservation, err: err instanceof Error ? err.message : String(err) });
  }
}
