import { useState, useCallback } from 'react';
import { retryOperation, handleError } from '@/lib/errorHandler';
import { useToast } from '@/hooks/use-toast';
import { useAnalytics } from '@/hooks/useAnalytics';

interface UseErrorRecoveryOptions {
  maxRetries?: number;
  retryDelay?: number;
  onSuccess?: () => void;
  onFailure?: (error: Error) => void;
  context?: string;
  startupId?: string;
}

interface ErrorRecoveryState {
  isRetrying: boolean;
  retryCount: number;
  lastError: Error | null;
}

export function useErrorRecovery(options: UseErrorRecoveryOptions = {}) {
  const {
    maxRetries = 3,
    retryDelay = 1000,
    onSuccess,
    onFailure,
    context,
    startupId
  } = options;

  const { toast } = useToast();
  const { trackEvent } = useAnalytics();
  const [state, setState] = useState<ErrorRecoveryState>({
    isRetrying: false,
    retryCount: 0,
    lastError: null
  });

  const executeWithRetry = useCallback(
    async <T>(operation: () => Promise<T>): Promise<T> => {
      setState({ isRetrying: true, retryCount: 0, lastError: null });

      let attempts = 0;
      let lastError: any;

      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          setState(prev => ({ ...prev, retryCount: attempt }));
          const result = await operation();
          
          setState({ isRetrying: false, retryCount: 0, lastError: null });
          
          // Track successful recovery
          if (attempt > 1) {
            trackEvent('error_recovered', {
              retryCount: attempt,
              context
            }, startupId);
          }

          onSuccess?.();
          return result;

        } catch (error) {
          attempts = attempt;
          lastError = error;
          const errorInfo = handleError(error, context);
          
          setState({
            isRetrying: attempt < maxRetries,
            retryCount: attempt,
            lastError: error as Error
          });

          if (attempt === maxRetries) {
            // Track failed recovery
            trackEvent('error_recovery_failed', {
              errorCode: errorInfo.code,
              maxRetries,
              context
            }, startupId);

            // Show error toast
            toast({
              title: 'Operation Failed',
              description: errorInfo.message,
              variant: 'destructive'
            });

            onFailure?.(error as Error);
            throw error;
          }

          // Exponential backoff
          await new Promise(resolve => setTimeout(resolve, retryDelay * Math.pow(2, attempt - 1)));
        }
      }

      throw lastError;
    },
    [maxRetries, retryDelay, onSuccess, onFailure, context, startupId, toast, trackEvent]
  );

  const retry = useCallback(
    async <T>(operation: () => Promise<T>): Promise<T> => {
      return executeWithRetry(operation);
    },
    [executeWithRetry]
  );

  const reset = useCallback(() => {
    setState({ isRetrying: false, retryCount: 0, lastError: null });
  }, []);

  return {
    retry,
    reset,
    isRetrying: state.isRetrying,
    retryCount: state.retryCount,
    lastError: state.lastError,
    executeWithRetry
  };
}
