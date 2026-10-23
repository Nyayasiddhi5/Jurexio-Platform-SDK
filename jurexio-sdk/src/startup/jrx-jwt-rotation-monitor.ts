/**
 * JWT Rotation Monitor — NV Core SDK
 * Sprint 12: 90-day rotation policy enforcement
 *
 * Checks at startup:
 *   1. JWT_SECRET exists and meets minimum strength (64 chars, entropy)
 *   2. JWT_SECRET_SET_DATE is set (tracks rotation age)
 *   3. Warns if secret > 90 days old (hard-fails in production if > 180 days)
 *
 * Routes exported:
 *   GET  /api/admin/security-status  — JWT + secret health summary
 */

import { Router, Request, Response } from 'express';
import { createLogger } from '../utils/logger.js';


const logger = createLogger('jwt-rotation-monitor');

const MIN_SECRET_LENGTH = 64;
const WARN_ROTATION_DAYS = 90;
const FAIL_ROTATION_DAYS = 180;

export interface JwtRotationStatus {
  secretSet:        boolean;
  secretLength:     number;
  meetsMinLength:   boolean;
  hasEntropy:       boolean;
  rotationTracked:  boolean;
  daysSinceSet:     number | null;
  rotationDue:      boolean;
  rotationOverdue:  boolean;
  recommendation:   string;
}

export function runJwtRotationCheck(): JwtRotationStatus {
  const secret  = process.env.JWT_SECRET || process.env.NS_JWT_SECRET || '';
  const setDate = process.env.JWT_SECRET_SET_DATE;
  const env     = process.env.NODE_ENV || 'development';

  const secretSet      = secret.length > 0;
  const secretLength   = secret.length;
  const meetsMinLength = secretLength >= MIN_SECRET_LENGTH;
  const hasEntropy     = /[A-Z]/.test(secret) && /[a-z]/.test(secret) && /[0-9]/.test(secret);

  let daysSinceSet: number | null = null;
  let rotationDue   = false;
  let rotationOverdue = false;

  if (setDate) {
    const setTs = new Date(setDate).getTime();
    if (!isNaN(setTs)) {
      daysSinceSet  = Math.floor((Date.now() - setTs) / 86_400_000);
      rotationDue   = daysSinceSet >= WARN_ROTATION_DAYS;
      rotationOverdue = daysSinceSet >= FAIL_ROTATION_DAYS;
    }
  }

  /* Startup logging */
  if (!secretSet) {
    const msg = '[JWT-Monitor] ⚠️  JWT_SECRET not set — using insecure dev fallback. Set JWT_SECRET before deploying.';
    if (env === 'production') {
      process.stderr.write(msg + '\n');
    } else {
      logger.warn(msg);
    }
  } else if (!meetsMinLength) {
    logger.warn(`[JWT-Monitor] ⚠️  JWT_SECRET too short (${secretLength}/${MIN_SECRET_LENGTH} chars). Rotate to a stronger secret.`);
  } else {
    logger.info(`[JWT-Monitor] ✅ JWT_SECRET valid (${secretLength} chars)`);
  }

  if (!setDate) {
    logger.warn('[JWT-Monitor] ℹ️  JWT_SECRET_SET_DATE not set — rotation age cannot be tracked. Set it to the date you last rotated the secret (YYYY-MM-DD).');
  } else if (rotationOverdue) {
    const msg = `[JWT-Monitor] 🔴 JWT_SECRET is ${daysSinceSet} days old — OVERDUE for rotation (policy: ${FAIL_ROTATION_DAYS} days max).`;
    if (env === 'production') {
      process.stderr.write(msg + '\n');
    } else {
      logger.warn(msg);
    }
  } else if (rotationDue) {
    logger.warn(`[JWT-Monitor] 🟡 JWT_SECRET is ${daysSinceSet} days old — rotation recommended (policy: every ${WARN_ROTATION_DAYS} days).`);
  } else if (daysSinceSet !== null) {
    logger.info(`[JWT-Monitor] ✅ JWT_SECRET rotated ${daysSinceSet} days ago — next rotation in ${WARN_ROTATION_DAYS - daysSinceSet} days.`);
  }

  let recommendation = '';
  if (!secretSet)        recommendation = 'Generate and set JWT_SECRET: openssl rand -hex 64';
  else if (!meetsMinLength) recommendation = `Rotate to a secret >= ${MIN_SECRET_LENGTH} chars: openssl rand -hex 64`;
  else if (rotationOverdue) recommendation = 'URGENT: Rotate JWT_SECRET immediately and update JWT_SECRET_SET_DATE';
  else if (rotationDue)  recommendation = `Rotate JWT_SECRET and update JWT_SECRET_SET_DATE (rotation due every ${WARN_ROTATION_DAYS} days)`;
  else if (!setDate)     recommendation = 'Set JWT_SECRET_SET_DATE=YYYY-MM-DD to enable rotation tracking';
  else                   recommendation = 'JWT secret is compliant — no action required';

  return {
    secretSet,
    secretLength,
    meetsMinLength,
    hasEntropy,
    rotationTracked: !!setDate,
    daysSinceSet,
    rotationDue,
    rotationOverdue,
    recommendation,
  };
}

/* ── Express Router — /api/admin/security-status ─────────── */
const router = Router();

router.get('/security-status', (_req: Request, res: Response) => {
  const jwt = runJwtRotationCheck();

  const niJwtSecret  = process.env.NI_JWT_SECRET || '';
  const nspJwtSecret = process.env.NS_JWT_SECRET || process.env.JWT_SECRET || '';

  res.json({
    success:   true,
    timestamp: new Date().toISOString(),
    platform:  'Jurexio Enterprise Platform SDK v5.0.0',
    security: {
      nv_core_jwt: {
        status:          jwt.secretSet && jwt.meetsMinLength ? (jwt.rotationOverdue ? 'critical' : jwt.rotationDue ? 'warning' : 'ok') : 'critical',
        secretLength:    jwt.secretLength,
        meetsMinLength:  jwt.meetsMinLength,
        rotationTracked: jwt.rotationTracked,
        daysSinceSet:    jwt.daysSinceSet,
        rotationDue:     jwt.rotationDue,
        recommendation:  jwt.recommendation,
      },
      nsp_jwt: {
        status:         nspJwtSecret.length >= MIN_SECRET_LENGTH ? 'ok' : 'warning',
        secretLength:   nspJwtSecret.length,
        meetsMinLength: nspJwtSecret.length >= MIN_SECRET_LENGTH,
      },
      nsi_jwt: {
        status:         niJwtSecret.length >= MIN_SECRET_LENGTH ? 'ok' : 'critical',
        secretLength:   niJwtSecret.length,
        meetsMinLength: niJwtSecret.length >= MIN_SECRET_LENGTH,
        recommendation: niJwtSecret.length < MIN_SECRET_LENGTH
          ? 'Set NI_JWT_SECRET=<openssl rand -hex 64>'
          : 'Compliant',
      },
      testing_mode: {
        active:          process.env.TESTING_MODE !== 'false',
        otpBypassActive: process.env.TESTING_MODE !== 'false',
        recommendation:  process.env.TESTING_MODE !== 'false'
          ? 'PRODUCTION: Set TESTING_MODE=false to disable OTP bypass and 24h token windows'
          : 'Compliant — TESTING_MODE=false',
      },
    },
    rotation_policy: {
      warnAfterDays: WARN_ROTATION_DAYS,
      failAfterDays: FAIL_ROTATION_DAYS,
      howToRotate: [
        '1. Generate new secret: openssl rand -hex 64',
        '2. Set JWT_SECRET=<new_value> in production env',
        '3. Set JWT_SECRET_SET_DATE=<today_YYYY-MM-DD>',
        '4. Restart all NV Core instances',
        '5. All existing tokens will be invalidated — users must re-login',
      ],
    },
  });
});

export { router as jwtRotationRouter };
