/**
 * Tool Calls Display Component
 * 
 * Shows agent tool invocations and results in real-time from AG-UI stream
 * Displays tool name, parameters, results, timing, and success/error status
 */

import { useState } from 'react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { 
  Wrench, 
  Clock, 
  CheckCircle2, 
  XCircle, 
  ChevronDown, 
  ChevronRight,
  Loader2 
} from 'lucide-react';
import type { AGUIToolCallEvent, AGUIToolResultEvent } from '@shared/agui-event-types';

interface ToolCall {
  id: string;
  toolName: string;
  parameters: Record<string, any>;
  timestamp: number;
  status: 'pending' | 'success' | 'error';
  result?: any;
  error?: string;
  duration?: number;
}

interface ToolCallsPanelProps {
  toolCalls: ToolCall[];
  className?: string;
}

export function ToolCallsPanel({ toolCalls, className = '' }: ToolCallsPanelProps) {
  const [expandedCalls, setExpandedCalls] = useState<Set<string>>(new Set());

  const toggleExpanded = (id: string) => {
    setExpandedCalls(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  if (toolCalls.length === 0) {
    return (
      <Card className={`p-6 ${className}`} data-testid="panel-tools-empty">
        <div className="flex flex-col items-center justify-center text-center text-gray-500 dark:text-gray-400">
          <Wrench className="h-12 w-12 mb-3 opacity-50" />
          <p className="text-sm">No tool calls yet</p>
          <p className="text-xs mt-1">Agent tool invocations will appear here</p>
        </div>
      </Card>
    );
  }

  const formatTimestamp = (timestamp: number): string => {
    return new Date(timestamp).toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    });
  };

  const formatDuration = (ms: number): string => {
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(2)}s`;
  };

  const formatJSON = (obj: any): string => {
    try {
      return JSON.stringify(obj, null, 2);
    } catch {
      return String(obj);
    }
  };

  const getStatusIcon = (status: ToolCall['status']) => {
    switch (status) {
      case 'pending':
        return <Loader2 className="h-4 w-4 text-blue-600 animate-spin" />;
      case 'success':
        return <CheckCircle2 className="h-4 w-4 text-green-600" />;
      case 'error':
        return <XCircle className="h-4 w-4 text-red-600" />;
    }
  };

  const getStatusBadgeVariant = (status: ToolCall['status']): "default" | "secondary" | "destructive" => {
    switch (status) {
      case 'pending': return 'default';
      case 'success': return 'secondary';
      case 'error': return 'destructive';
    }
  };

  return (
    <Card className={`${className}`} data-testid="panel-tools">
      <div className="border-b border-gray-200 dark:border-gray-700 px-4 py-3">
        <div className="flex items-center gap-2">
          <Wrench className="h-5 w-5 text-blue-600" />
          <h3 className="font-semibold">Tool Calls</h3>
          <Badge variant="outline" className="ml-auto">
            {toolCalls.length} {toolCalls.length === 1 ? 'call' : 'calls'}
          </Badge>
        </div>
      </div>

      <ScrollArea className="h-[400px]">
        <div className="p-4 space-y-3">
          {toolCalls.map((call, index) => {
            const isExpanded = expandedCalls.has(call.id);
            
            return (
              <Collapsible
                key={call.id}
                open={isExpanded}
                onOpenChange={() => toggleExpanded(call.id)}
              >
                <div
                  data-testid={`tool-call-${index}`}
                  className={`
                    rounded-lg border transition-all
                    ${call.status === 'error' 
                      ? 'border-red-300 dark:border-red-700 bg-red-50 dark:bg-red-900/20' 
                      : call.status === 'success'
                      ? 'border-green-300 dark:border-green-700 bg-green-50 dark:bg-green-900/20'
                      : 'border-blue-300 dark:border-blue-700 bg-blue-50 dark:bg-blue-900/20'
                    }
                  `}
                >
                  <CollapsibleTrigger 
                  className="w-full p-3"
                  data-testid={`button-toggle-tool-${index}`}
                >
                    <div className="flex items-start gap-3">
                      {/* Status Icon */}
                      <div className="flex-shrink-0 pt-0.5">
                        {getStatusIcon(call.status)}
                      </div>

                      {/* Tool Info */}
                      <div className="flex-1 min-w-0 text-left">
                        <div className="flex items-center gap-2 mb-1">
                          <code 
                            className="font-mono font-medium text-sm" 
                            data-testid={`tool-call-name-${index}`}
                          >
                            {call.toolName}
                          </code>
                          <Badge 
                            variant={getStatusBadgeVariant(call.status)}
                            className="text-xs"
                          >
                            {call.status}
                          </Badge>
                        </div>

                        <div className="flex items-center gap-3 text-xs text-gray-600 dark:text-gray-400">
                          <div className="flex items-center gap-1">
                            <Clock className="h-3 w-3" />
                            <span data-testid={`tool-call-time-${index}`}>
                              {formatTimestamp(call.timestamp)}
                            </span>
                          </div>
                          {call.duration !== undefined && (
                            <span>Duration: {formatDuration(call.duration)}</span>
                          )}
                        </div>
                      </div>

                      {/* Expand Icon */}
                      <div className="flex-shrink-0 pt-0.5">
                        {isExpanded ? (
                          <ChevronDown className="h-4 w-4 text-gray-500" />
                        ) : (
                          <ChevronRight className="h-4 w-4 text-gray-500" />
                        )}
                      </div>
                    </div>
                  </CollapsibleTrigger>

                  <CollapsibleContent>
                    <div className="px-3 pb-3 space-y-3 border-t border-gray-200 dark:border-gray-700 pt-3 mt-2">
                      {/* Parameters */}
                      <div>
                        <h5 className="text-xs font-semibold mb-1 text-gray-700 dark:text-gray-300">
                          Parameters:
                        </h5>
                        <pre 
                          className="text-xs bg-gray-100 dark:bg-gray-800 p-2 rounded overflow-x-auto"
                          data-testid={`tool-call-params-${index}`}
                        >
                          {formatJSON(call.parameters)}
                        </pre>
                      </div>

                      {/* Result or Error */}
                      {call.status === 'success' && call.result !== undefined && (
                        <div>
                          <h5 className="text-xs font-semibold mb-1 text-gray-700 dark:text-gray-300">
                            Result:
                          </h5>
                          <pre 
                            className="text-xs bg-green-100 dark:bg-green-900/30 p-2 rounded overflow-x-auto"
                            data-testid={`tool-call-result-${index}`}
                          >
                            {formatJSON(call.result)}
                          </pre>
                        </div>
                      )}

                      {call.status === 'error' && call.error && (
                        <div>
                          <h5 className="text-xs font-semibold mb-1 text-gray-700 dark:text-gray-300">
                            Error:
                          </h5>
                          <div 
                            className="text-xs bg-red-100 dark:bg-red-900/30 p-2 rounded text-red-700 dark:text-red-300"
                            data-testid={`tool-call-error-${index}`}
                          >
                            {call.error}
                          </div>
                        </div>
                      )}
                    </div>
                  </CollapsibleContent>
                </div>
              </Collapsible>
            );
          })}
        </div>
      </ScrollArea>
    </Card>
  );
}

/**
 * Integration pattern for AG-UI tool events
 * Usage in studio:
 * 
 * const [toolCalls, setToolCalls] = useState<ToolCall[]>([]);
 * 
 * useAGUIStream(sessionId, {
 *   onEvent: (event) => {
 *     if (event.type === 'tool:call') {
 *       const toolCallEvent = event as AGUIToolCallEvent;
 *       const newCall: ToolCall = {
 *         id: toolCallEvent.toolCallId,
 *         toolName: toolCallEvent.tool,
 *         parameters: toolCallEvent.parameters,
 *         timestamp: toolCallEvent.timestamp,
 *         status: 'pending'
 *       };
 *       setToolCalls(prev => [...prev, newCall]);
 *     }
 *     
 *     if (event.type === 'tool:result') {
 *       const toolResultEvent = event as AGUIToolResultEvent;
 *       setToolCalls(prev => prev.map(call => 
 *         call.id === toolResultEvent.toolCallId
 *           ? {
 *               ...call,
 *               status: toolResultEvent.success ? 'success' : 'error',
 *               result: toolResultEvent.success ? toolResultEvent.result : undefined,
 *               error: !toolResultEvent.success ? toolResultEvent.error : undefined,
 *               duration: toolResultEvent.timestamp - call.timestamp
 *             }
 *           : call
 *       ));
 *     }
 *   }
 * });
 */

export type { ToolCall };
