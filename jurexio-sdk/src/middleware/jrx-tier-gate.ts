import { Request, Response, NextFunction } from 'express';

const TIER_LEVELS: Record<string, number> = {
  alpha: 0,
  solo: 1,
  standard: 2,
  pro: 3,
  elite: 4,
  enterprise: 5,
  government: 6,
};

export function tierGate(allowedTiers: string[]) {
  const minLevel = Math.min(...allowedTiers.map(t => TIER_LEVELS[t] ?? 99));
  return (req: Request, res: Response, next: NextFunction): void => {
    const user = req.user;
    if (!user) {
      res.status(401).json({ success: false, error: 'Authentication required' });
      return;
    }
    const userTier = user.subscriptionTier || user.tier || 'alpha';
    const userLevel = TIER_LEVELS[userTier] ?? 0;
    if (userLevel >= minLevel) {
      next();
      return;
    }
    res.status(403).json({
      success: false,
      error: `This feature requires ${allowedTiers[0]} tier or above`,
      requiredTier: allowedTiers[0],
      currentTier: userTier,
      upgradeUrl: '/upgrade',
    });
  };
}
