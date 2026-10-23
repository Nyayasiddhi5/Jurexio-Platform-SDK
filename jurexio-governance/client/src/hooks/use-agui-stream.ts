/**
 * React Hook for AG-UI SSE Streaming
 * Replaces polling with real-time server-sent events
 * 
 * Usage:
 * const { events, sendInterruptResponse, steerAgent, status } = useAGUIStream(sessionId);
 */

import { useEffect, useState, useCallback, useRef } from 'react';
import type {
  AGUIEvent,
  AGUIDataEvent,
  AGUIControlEvent,
  AGUIInterruptResponse,
  AGUIStreamSession,
} from '@shared/agui-event-types';

export interface AGUIStreamHookResult {
  events: AGUIEvent[];
  lastEvent: AGUIEvent | null;
  status: 'connecting' | 'connected' | 'disconnected' | 'error';
  error: Error | null;
  sendInterruptResponse: (response: AGUIInterruptResponse) => Promise<void>;
  steerAgent: (direction: string, guidance: string, priority?: 'low' | 'medium' | 'high') => Promise<void>;
  closeSession: () => Promise<void>;
  pauseSession: () => Promise<void>;
  resumeSession: () => Promise<void>;
}

interface UseAGUIStreamOptions {
  includeHistory?: boolean;
  reconnect?: boolean;
  maxReconnectAttempts?: number;
  onEvent?: (event: AGUIEvent) => void;
  onError?: (error: Error) => void;
}

/**
 * Hook for AG-UI SSE streaming
 */
export function useAGUIStream(
  sessionId: string | null,
  options: UseAGUIStreamOptions = {}
): AGUIStreamHookResult {
  const [events, setEvents] = useState<AGUIEvent[]>([]);
  const [lastEvent, setLastEvent] = useState<AGUIEvent | null>(null);
  const [status, setStatus] = useState<'connecting' | 'connected' | 'disconnected' | 'error'>('disconnected');
  const [error, setError] = useState<Error | null>(null);
  
  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const maxReconnectAttempts = options.maxReconnectAttempts || 3;

  // Connect to SSE stream
  useEffect(() => {
    if (!sessionId) {
      setStatus('disconnected');
      return;
    }

    const connectToStream = () => {
      setStatus('connecting');
      setError(null);

      const url = new URL(`/api/agui/stream/${sessionId}`, window.location.origin);
      if (options.includeHistory) {
        url.searchParams.set('includeHistory', 'true');
      }

      const eventSource = new EventSource(url.toString(), {
        withCredentials: true,
      });

      eventSourceRef.current = eventSource;

      eventSource.onopen = () => {
        console.log('✅ AG-UI stream connected:', sessionId.slice(0, 8) + '...');
        setStatus('connected');
        reconnectAttemptsRef.current = 0;
      };

      eventSource.onmessage = (e) => {
        try {
          const event: AGUIEvent = JSON.parse(e.data);
          
          // Handle control events (SSE stream management)
          if (event.type === 'connection') {
            console.log('✅ AG-UI connection confirmed');
            return; // Don't store control event
          }
          
          if (event.type === 'session_closed') {
            console.log('📡 AG-UI session closed by server');
            eventSource.close();
            setStatus('disconnected');
            return; // Don't store control event
          }
          
          if (event.type === 'heartbeat') {
            // Heartbeat received, connection is alive
            return; // Don't store control event
          }

          // Store only data events (orchestration events)
          const dataEvent = event as AGUIDataEvent;
          setEvents(prev => [...prev, dataEvent]);
          setLastEvent(dataEvent);
          
          if (options.onEvent) {
            options.onEvent(dataEvent);
          }

          console.log(`📡 AG-UI Event [${dataEvent.type}]:`, dataEvent);
        } catch (err) {
          console.error('Failed to parse AG-UI event:', err);
        }
      };

      eventSource.onerror = (err) => {
        console.error('❌ AG-UI stream error:', err);
        eventSource.close();
        
        const error = new Error('AG-UI stream connection failed');
        setError(error);
        setStatus('error');
        
        if (options.onError) {
          options.onError(error);
        }

        // Attempt reconnect if enabled
        if (options.reconnect && reconnectAttemptsRef.current < maxReconnectAttempts) {
          reconnectAttemptsRef.current++;
          const delay = Math.min(1000 * Math.pow(2, reconnectAttemptsRef.current - 1), 10000);
          console.log(`🔄 Reconnecting AG-UI stream in ${delay}ms (attempt ${reconnectAttemptsRef.current}/${maxReconnectAttempts})`);
          
          setTimeout(() => {
            if (eventSourceRef.current?.readyState === EventSource.CLOSED) {
              connectToStream();
            }
          }, delay);
        } else {
          setStatus('disconnected');
        }
      };
    };

    connectToStream();

    // Cleanup on unmount
    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
    };
  }, [sessionId, options.includeHistory, options.reconnect, maxReconnectAttempts]);

  // Send interrupt response (human-in-the-loop)
  const sendInterruptResponse = useCallback(async (response: AGUIInterruptResponse) => {
    if (!sessionId) throw new Error('No session ID');

    const res = await fetch(`/api/agui/sessions/${sessionId}/interrupts/respond`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(response),
    });

    if (!res.ok) {
      throw new Error('Failed to send interrupt response');
    }

    return res.json();
  }, [sessionId]);

  // Steer agent direction
  const steerAgent = useCallback(async (
    direction: string,
    guidance: string,
    priority: 'low' | 'medium' | 'high' = 'medium'
  ) => {
    if (!sessionId) throw new Error('No session ID');

    const res = await fetch(`/api/agui/sessions/${sessionId}/steer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ direction, guidance, priority }),
    });

    if (!res.ok) {
      throw new Error('Failed to steer agent');
    }

    return res.json();
  }, [sessionId]);

  // Close session
  const closeSession = useCallback(async () => {
    if (!sessionId) throw new Error('No session ID');

    const res = await fetch(`/api/agui/sessions/${sessionId}`, {
      method: 'DELETE',
      credentials: 'include',
    });

    if (!res.ok) {
      throw new Error('Failed to close session');
    }

    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }

    setStatus('disconnected');
    return res.json();
  }, [sessionId]);

  // Pause session
  const pauseSession = useCallback(async () => {
    if (!sessionId) throw new Error('No session ID');

    const res = await fetch(`/api/agui/sessions/${sessionId}/pause`, {
      method: 'POST',
      credentials: 'include',
    });

    if (!res.ok) {
      throw new Error('Failed to pause session');
    }

    return res.json();
  }, [sessionId]);

  // Resume session
  const resumeSession = useCallback(async () => {
    if (!sessionId) throw new Error('No session ID');

    const res = await fetch(`/api/agui/sessions/${sessionId}/resume`, {
      method: 'POST',
      credentials: 'include',
    });

    if (!res.ok) {
      throw new Error('Failed to resume session');
    }

    return res.json();
  }, [sessionId]);

  return {
    events,
    lastEvent,
    status,
    error,
    sendInterruptResponse,
    steerAgent,
    closeSession,
    pauseSession,
    resumeSession,
  };
}

/**
 * Hook to create AG-UI session
 */
export function useCreateAGUISession() {
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const createSession = useCallback(async (
    startupId: number,
    sessionId?: number,
    studioId?: string
  ): Promise<AGUIStreamSession> => {
    setIsCreating(true);
    setError(null);

    try {
      const res = await fetch('/api/agui/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ startupId, sessionId, studioId }),
      });

      if (!res.ok) {
        throw new Error('Failed to create AG-UI session');
      }

      const data = await res.json();
      return data.session;
    } catch (err: any) {
      setError(err);
      throw err;
    } finally {
      setIsCreating(false);
    }
  }, []);

  return {
    createSession,
    isCreating,
    error,
  };
}

/**
 * Hook to filter specific event types
 */
export function useAGUIEventFilter<T extends AGUIEvent>(
  events: AGUIEvent[],
  eventType: T['type']
): T[] {
  return events.filter(e => e.type === eventType) as T[];
}

/**
 * Hook to get latest event of specific type
 */
export function useLatestAGUIEvent<T extends AGUIEvent>(
  events: AGUIEvent[],
  eventType: T['type']
): T | null {
  const filtered = events.filter(e => e.type === eventType) as T[];
  return filtered.length > 0 ? filtered[filtered.length - 1] : null;
}
