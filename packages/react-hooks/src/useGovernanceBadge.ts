/**
 * useGovernanceBadge — React hook for AI governance badge data
 * Computes risk badge, color, and description from a risk score (0–1).
 * @version 3.1.2
 */
import { useMemo } from 'react';

export type RiskBadge = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export interface GovernanceBadgeData {
  riskScore: number;
  badge: RiskBadge;
  label: string;
  color: string;
  bgColor: string;
  description: string;
  auditHash: string;
  warnings: string[];
  isVerified: boolean;
}

export interface UseGovernanceBadgeOptions {
  riskScore: number;
  auditHash?: string;
  warnings?: string[];
}

function computeBadge(score: number): { badge: RiskBadge; label: string; color: string; bgColor: string; description: string } {
  if (score < 0.25) {
    return {
      badge: 'LOW',
      label: 'Low Risk',
      color: '#16a34a',
      bgColor: '#dcfce7',
      description: 'AI output verified with high confidence. Suitable for direct use.',
    };
  }
  if (score < 0.55) {
    return {
      badge: 'MEDIUM',
      label: 'Medium Risk',
      color: '#d97706',
      bgColor: '#fef9c3',
      description: 'AI output requires human review before use in formal proceedings.',
    };
  }
  if (score < 0.8) {
    return {
      badge: 'HIGH',
      label: 'High Risk',
      color: '#dc2626',
      bgColor: '#fee2e2',
      description: 'AI output has significant uncertainty. Mandatory advocate review required.',
    };
  }
  return {
    badge: 'CRITICAL',
    label: 'Critical Risk',
    color: '#7c3aed',
    bgColor: '#ede9fe',
    description: 'AI output flagged for immediate human intervention. Do not use without review.',
  };
}

export function useGovernanceBadge(options: UseGovernanceBadgeOptions): GovernanceBadgeData {
  const { riskScore, auditHash = '', warnings = [] } = options;

  return useMemo(() => {
    const clampedScore = Math.max(0, Math.min(1, riskScore));
    const badgeData = computeBadge(clampedScore);
    return {
      riskScore: clampedScore,
      ...badgeData,
      auditHash,
      warnings,
      isVerified: !!auditHash && auditHash.length === 64,
    };
  }, [riskScore, auditHash, warnings]);
}
