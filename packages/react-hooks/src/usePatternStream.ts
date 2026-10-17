/**
 * usePatternStream — React hook for streaming AI pattern responses via SSE
 * @version 3.1.2
 */
import { useState, useCallback, useRef } from 'react';

export type JrxPatternKey =
  | 'P01' | 'P02' | 'P03' | 'P04' | 'P05' | 'P06' | 'P07' | 'P08'
  | 'P09' | 'P10' | 'P11' | 'P12' | 'P13' | 'P14' | 'P15' | 'P16'
  | 'P17' | 'P18' | 'P19' | 'P20' | 'P21' | 'P22';

export interface PatternStreamOptions {
  baseUrl?: string;
  apiKey: string;
  pattern: JrxPatternKey;
  jurisdiction?: string;
  onToken?: (token: string) => void;
  onComplete?: (fullText: string) => void;
  onError?: (error: Error) => void;
  onGovernance?: (data: GovernanceData) => void;
}

export interface GovernanceData {
  risk_score: number;
  risk_badge: string;
  audit_hash: string;
  warnings: string[];
}

export interface UsePatternStreamReturn {
  isStreaming: boolean;
  tokens: string;
  fullResponse: string;
  governance: GovernanceData | null;
  error: Error | null;
  stream: (userMessage: string, systemPrompt?: string) => Promise<void>;
  abort: () => void;
  reset: () => void;
}

export function usePatternStream(options: PatternStreamOptions): UsePatternStreamReturn {
  const [isStreaming, setIsStreaming] = useState(false);
  const [tokens, setTokens] = useState('');
  const [fullResponse, setFullResponse] = useState('');
  const [governance, setGovernance] = useState<GovernanceData | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const abort = useCallback(() => {
    abortRef.current?.abort();
    setIsStreaming(false);
  }, []);

  const reset = useCallback(() => {
    abort();
    setTokens('');
    setFullResponse('');
    setGovernance(null);
    setError(null);
  }, [abort]);

  const stream = useCallback(async (userMessage: string, systemPrompt?: string) => {
    const baseUrl = options.baseUrl || '';
    abortRef.current = new AbortController();
    setIsStreaming(true);
    setTokens('');
    setError(null);

    let accumulated = '';

    try {
      const res = await fetch(`${baseUrl}/api/jrx/agui/stream`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${options.apiKey}`,
        },
        body: JSON.stringify({
          pattern: options.pattern,
          userMessage,
          systemPrompt,
          jurisdiction: options.jurisdiction || 'IN',
        }),
        signal: abortRef.current.signal,
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      if (!res.body) throw new Error('No response body');

      const reader = res.body.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split('\n');
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6).trim();
            if (data === '[DONE]') continue;
            try {
              const parsed = JSON.parse(data);
              if (parsed.type === 'token' && parsed.content) {
                accumulated += parsed.content;
                setTokens(t => t + parsed.content);
                options.onToken?.(parsed.content);
              } else if (parsed.type === 'governance') {
                setGovernance(parsed.data);
                options.onGovernance?.(parsed.data);
              }
            } catch {
              // non-JSON SSE line — skip
            }
          }
        }
      }

      setFullResponse(accumulated);
      options.onComplete?.(accumulated);
    } catch (e: any) {
      if (e.name !== 'AbortError') {
        const err = e instanceof Error ? e : new Error(String(e));
        setError(err);
        options.onError?.(err);
      }
    } finally {
      setIsStreaming(false);
    }
  }, [options]);

  return { isStreaming, tokens, fullResponse, governance, error, stream, abort, reset };
}
