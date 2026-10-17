/**
 * useAuditLog — React hook for accessing NYV audit trail
 * @version 3.1.2
 */
import { useState, useCallback, useEffect } from 'react';

export interface AuditEntry {
  id: string;
  userId: string;
  action: string;
  resourceType: string;
  resourceId: string;
  auditHash: string;
  prevHash: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface UseAuditLogOptions {
  baseUrl?: string;
  apiKey: string;
  userId?: string;
  resourceType?: string;
  limit?: number;
  autoRefetch?: boolean;
}

export interface UseAuditLogReturn {
  entries: AuditEntry[];
  isLoading: boolean;
  error: Error | null;
  refetch: () => Promise<void>;
  verifyChain: () => boolean;
}

export function useAuditLog(options: UseAuditLogOptions): UseAuditLogReturn {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const baseUrl = options.baseUrl || '';
  const limit = options.limit || 50;

  const refetch = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ limit: String(limit) });
      if (options.userId) params.set('userId', options.userId);
      if (options.resourceType) params.set('resourceType', options.resourceType);

      const res = await fetch(`${baseUrl}/api/jrx/audit?${params}`, {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${options.apiKey}`,
        },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setEntries(data.entries || data || []);
    } catch (e: any) {
      setError(e instanceof Error ? e : new Error(String(e)));
    } finally {
      setIsLoading(false);
    }
  }, [baseUrl, options.userId, options.resourceType, options.apiKey, limit]);

  const verifyChain = useCallback((): boolean => {
    for (let i = 1; i < entries.length; i++) {
      if (entries[i].prevHash !== entries[i - 1].auditHash) return false;
    }
    return true;
  }, [entries]);

  useEffect(() => {
    refetch();
  }, [refetch]);

  return { entries, isLoading, error, refetch, verifyChain };
}
