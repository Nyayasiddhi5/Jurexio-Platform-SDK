/**
 * useCredits — React hook for JRX credit wallet management
 * @version 3.1.2
 */
import { useState, useCallback, useEffect } from 'react';

export interface CreditWallet {
  userId: string;
  balance: number;
  tier: string;
  currency: string;
  lastRechargeAt: string | null;
  expiresAt: string | null;
}

export interface CreditTransaction {
  id: string;
  type: 'debit' | 'credit' | 'refund';
  amount: number;
  description: string;
  balanceAfter: number;
  createdAt: string;
}

export interface UseCreditsOptions {
  baseUrl?: string;
  apiKey: string;
  userId: string;
  autoRefetch?: boolean;
  refetchIntervalMs?: number;
}

export interface UseCreditsReturn {
  wallet: CreditWallet | null;
  transactions: CreditTransaction[];
  isLoading: boolean;
  error: Error | null;
  refetch: () => Promise<void>;
  deduct: (amount: number, description: string) => Promise<boolean>;
  recharge: (amount: number) => Promise<boolean>;
  hasEnough: (amount: number) => boolean;
}

export function useCredits(options: UseCreditsOptions): UseCreditsReturn {
  const [wallet, setWallet] = useState<CreditWallet | null>(null);
  const [transactions, setTransactions] = useState<CreditTransaction[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const baseUrl = options.baseUrl || '';
  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${options.apiKey}`,
  };

  const refetch = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const [walletRes, txRes] = await Promise.all([
        fetch(`${baseUrl}/api/jrx/credits/wallet`, { headers }),
        fetch(`${baseUrl}/api/jrx/credits/transactions?limit=20`, { headers }),
      ]);
      if (walletRes.ok) {
        const data = await walletRes.json();
        setWallet(data.wallet || data);
      }
      if (txRes.ok) {
        const data = await txRes.json();
        setTransactions(data.transactions || data || []);
      }
    } catch (e: any) {
      setError(e instanceof Error ? e : new Error(String(e)));
    } finally {
      setIsLoading(false);
    }
  }, [baseUrl, options.userId, options.apiKey]);

  const deduct = useCallback(async (amount: number, description: string): Promise<boolean> => {
    try {
      const res = await fetch(`${baseUrl}/api/jrx/credits/deduct`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ userId: options.userId, amount, description }),
      });
      if (res.ok) {
        await refetch();
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }, [baseUrl, options.userId, options.apiKey, refetch]);

  const recharge = useCallback(async (amount: number): Promise<boolean> => {
    try {
      const res = await fetch(`${baseUrl}/api/jrx/credits/recharge`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ userId: options.userId, amount }),
      });
      if (res.ok) {
        await refetch();
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }, [baseUrl, options.userId, options.apiKey, refetch]);

  const hasEnough = useCallback((amount: number): boolean => {
    return (wallet?.balance ?? 0) >= amount;
  }, [wallet]);

  useEffect(() => {
    refetch();
  }, [refetch]);

  useEffect(() => {
    if (!options.autoRefetch || !options.refetchIntervalMs) return;
    const interval = setInterval(refetch, options.refetchIntervalMs);
    return () => clearInterval(interval);
  }, [refetch, options.autoRefetch, options.refetchIntervalMs]);

  return { wallet, transactions, isLoading, error, refetch, deduct, recharge, hasEnough };
}
