/**
 * Thinking Steps Visualization Component
 * 
 * Displays agent's reasoning and planning steps in real-time from AG-UI stream
 * Shows step-by-step thought process with timing, status, and content
 */

import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Brain, Clock, CheckCircle2, Circle } from 'lucide-react';
import type { AGUIThinkingEvent } from '@shared/agui-event-types';

interface ThinkingStep {
  id: string;
  title: string;
  content: string;
  timestamp: number;
  duration?: number;
  status: 'active' | 'completed';
}

interface ThinkingStepsPanelProps {
  steps: ThinkingStep[];
  className?: string;
}

export function ThinkingStepsPanel({ steps, className = '' }: ThinkingStepsPanelProps) {
  if (steps.length === 0) {
    return (
      <Card className={`p-6 ${className}`} data-testid="panel-thinking-empty">
        <div className="flex flex-col items-center justify-center text-center text-gray-500 dark:text-gray-400">
          <Brain className="h-12 w-12 mb-3 opacity-50" />
          <p className="text-sm">No thinking steps yet</p>
          <p className="text-xs mt-1">Agent reasoning will appear here in real-time</p>
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
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    const minutes = Math.floor(ms / 60000);
    const seconds = Math.floor((ms % 60000) / 1000);
    return `${minutes}m ${seconds}s`;
  };

  return (
    <Card className={`${className}`} data-testid="panel-thinking">
      <div className="border-b border-gray-200 dark:border-gray-700 px-4 py-3">
        <div className="flex items-center gap-2">
          <Brain className="h-5 w-5 text-purple-600" />
          <h3 className="font-semibold">Agent Thinking Steps</h3>
          <Badge variant="outline" className="ml-auto">
            {steps.length} {steps.length === 1 ? 'step' : 'steps'}
          </Badge>
        </div>
      </div>

      <ScrollArea className="h-[400px]">
        <div className="p-4 space-y-3">
          {steps.map((step, index) => (
            <div
              key={step.id}
              data-testid={`thinking-step-${index}`}
              className={`
                flex gap-3 p-3 rounded-lg border transition-all
                ${step.status === 'active' 
                  ? 'border-purple-300 dark:border-purple-700 bg-purple-50 dark:bg-purple-900/20' 
                  : 'border-gray-200 dark:border-gray-700'
                }
              `}
            >
              {/* Step Icon/Number */}
              <div className="flex-shrink-0 pt-1">
                {step.status === 'active' ? (
                  <div className="relative">
                    <Circle className="h-5 w-5 text-purple-600 animate-pulse" />
                    <div className="absolute inset-0 flex items-center justify-center">
                      <span className="text-[10px] font-bold text-purple-600">{index + 1}</span>
                    </div>
                  </div>
                ) : (
                  <div className="relative">
                    <CheckCircle2 className="h-5 w-5 text-green-600" />
                    <div className="absolute inset-0 flex items-center justify-center">
                      <span className="text-[10px] font-bold text-white">{index + 1}</span>
                    </div>
                  </div>
                )}
              </div>

              {/* Step Content */}
              <div className="flex-1 min-w-0">
                <div className="flex items-start justify-between gap-2 mb-1">
                  <h4 className="font-medium text-sm" data-testid={`thinking-step-title-${index}`}>
                    {step.title}
                  </h4>
                  <div className="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400 flex-shrink-0">
                    <Clock className="h-3 w-3" />
                    <span data-testid={`thinking-step-time-${index}`}>
                      {formatTimestamp(step.timestamp)}
                    </span>
                  </div>
                </div>

                <p className="text-sm text-gray-600 dark:text-gray-400 whitespace-pre-wrap" data-testid={`thinking-step-content-${index}`}>
                  {step.content}
                </p>

                {/* Duration Badge (for completed steps) */}
                {step.status === 'completed' && step.duration !== undefined && (
                  <div className="mt-2">
                    <Badge variant="secondary" className="text-xs">
                      Duration: {formatDuration(step.duration)}
                    </Badge>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </ScrollArea>
    </Card>
  );
}

/**
 * Hook to convert AG-UI thinking events to ThinkingStep format
 * Usage in studio:
 * 
 * const [thinkingSteps, setThinkingSteps] = useState<ThinkingStep[]>([]);
 * 
 * useAGUIStream(sessionId, {
 *   onEvent: (event) => {
 *     if (event.type === 'agent:thinking') {
 *       const thinkingEvent = event as AGUIThinkingEvent;
 *       
 *       setThinkingSteps(prev => {
 *         // Mark all previous steps as completed when new thinking arrives
 *         const updatedPrev = prev.map(s => ({
 *           ...s,
 *           status: 'completed' as const,
 *           duration: s.duration || (Date.now() - s.timestamp)
 *         }));
 *         
 *         // Create new active step with unique ID (timestamp + agentId)
 *         const newStep: ThinkingStep = {
 *           id: `${thinkingEvent.agentId}-${thinkingEvent.timestamp}`,
 *           title: thinkingEvent.step || 'Thinking...',
 *           content: thinkingEvent.thought,
 *           timestamp: thinkingEvent.timestamp,
 *           status: 'active'
 *         };
 *         
 *         // Append new step to create chronological list
 *         return [...updatedPrev, newStep];
 *       });
 *     }
 *     
 *     if (event.type === 'agent:complete') {
 *       // Finalize all steps as completed with duration
 *       setThinkingSteps(prev => prev.map(s => ({
 *         ...s,
 *         status: 'completed',
 *         duration: s.duration || (Date.now() - s.timestamp)
 *       })));
 *     }
 *   }
 * });
 */

export type { ThinkingStep };
