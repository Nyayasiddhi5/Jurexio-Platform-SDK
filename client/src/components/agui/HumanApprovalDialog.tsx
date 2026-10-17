/**
 * Human-in-the-Loop Approval Dialog Component
 * 
 * Displays approval requests from agents and allows users to:
 * - Approve and continue execution
 * - Request modifications
 * - Reject and abort execution
 */

import { useState, useEffect, useRef } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { CheckCircle2, Edit3, XCircle, Clock, AlertTriangle } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import type { AGUIInterruptEvent, AGUIInterruptResponse } from '@shared/agui-event-types';

interface HumanApprovalDialogProps {
  interrupt: AGUIInterruptEvent | null;
  open: boolean;
  onResponse: (response: AGUIInterruptResponse) => void;
  onClose: () => void;
}

export function HumanApprovalDialog({
  interrupt,
  open,
  onResponse,
  onClose
}: HumanApprovalDialogProps) {
  const { toast } = useToast();
  const [selectedAction, setSelectedAction] = useState<string | null>(null);
  const [feedback, setFeedback] = useState('');
  const [timeRemaining, setTimeRemaining] = useState<number | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const timerIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const hasAutoSubmittedRef = useRef(false);

  // Calculate time remaining
  useEffect(() => {
    if (!interrupt || !interrupt.timeout) return;

    hasAutoSubmittedRef.current = false;

    const updateTimer = () => {
      const remaining = Math.max(0, interrupt.timeout! - Date.now());
      setTimeRemaining(remaining);

      if (remaining === 0 && !hasAutoSubmittedRef.current) {
        // Auto-submit default action on timeout
        hasAutoSubmittedRef.current = true;
        
        // Clear interval immediately to prevent duplicate submissions
        if (timerIntervalRef.current) {
          clearInterval(timerIntervalRef.current);
          timerIntervalRef.current = null;
        }

        if (interrupt.defaultAction) {
          handleSubmit(interrupt.defaultAction);
        } else {
          // No default action defined - notify user
          toast({
            title: "Approval Timeout",
            description: "Time expired but no default action is configured. Please respond manually.",
            variant: "destructive"
          });
        }
      }
    };

    updateTimer();
    timerIntervalRef.current = setInterval(updateTimer, 1000);
    
    return () => {
      if (timerIntervalRef.current) {
        clearInterval(timerIntervalRef.current);
        timerIntervalRef.current = null;
      }
    };
  }, [interrupt, toast]);

  // Reset state when dialog opens/closes
  useEffect(() => {
    if (open && interrupt) {
      setSelectedAction(null);
      setFeedback('');
    }
  }, [open, interrupt]);

  const handleSubmit = async (action?: string) => {
    if (!interrupt) return;

    const actionToSubmit = action || selectedAction;
    if (!actionToSubmit) return;

    // Prevent duplicate submissions (race condition guard)
    if (isSubmitting) {
      console.warn('Submission already in progress, ignoring duplicate request');
      return;
    }

    setIsSubmitting(true);

    try {
      const response: AGUIInterruptResponse = {
        interruptId: interrupt.interruptId,
        action: actionToSubmit,
        feedback: feedback.trim() || undefined,
        timestamp: Date.now()
      };

      await onResponse(response);
      
      toast({
        title: "Response Submitted",
        description: `Your ${actionToSubmit} response has been sent to the agent.`,
      });
      
      onClose();
    } catch (error) {
      console.error('Failed to submit approval response:', error);
      
      // Surface error to user for recovery
      toast({
        title: "Submission Failed",
        description: error instanceof Error ? error.message : "Failed to submit response. Please try again.",
        variant: "destructive"
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!interrupt) return null;

  const formatTimeRemaining = (ms: number | null): string => {
    if (!ms) return '';
    const seconds = Math.floor(ms / 1000);
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}m ${remainingSeconds}s`;
  };

  const getActionIcon = (action: string) => {
    switch (action) {
      case 'approve': return <CheckCircle2 className="h-4 w-4" />;
      case 'modify': return <Edit3 className="h-4 w-4" />;
      case 'reject': return <XCircle className="h-4 w-4" />;
      default: return null;
    }
  };

  const getActionVariant = (action: string): "default" | "destructive" | "outline" | "secondary" => {
    switch (action) {
      case 'approve': return 'default';
      case 'reject': return 'destructive';
      default: return 'outline';
    }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[600px]" data-testid="dialog-approval">
        <DialogHeader>
          <div className="flex items-center justify-between">
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-yellow-600" />
              Approval Required
            </DialogTitle>
            {timeRemaining !== null && (
              <Badge variant="outline" className="flex items-center gap-1">
                <Clock className="h-3 w-3" />
                {formatTimeRemaining(timeRemaining)}
              </Badge>
            )}
          </div>
          <DialogDescription>
            {interrupt.message}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Interrupt Context */}
          {interrupt.context && Object.keys(interrupt.context).length > 0 && (
            <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-3 bg-gray-50 dark:bg-gray-800/50">
              <h4 className="text-sm font-medium mb-2">Context</h4>
              <div className="text-sm text-gray-600 dark:text-gray-400 space-y-1">
                {Object.entries(interrupt.context).map(([key, value]) => (
                  <div key={key} className="flex gap-2">
                    <span className="font-medium">{key}:</span>
                    <span>{String(value)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Action Options */}
          <div className="space-y-2">
            <Label>Choose an action:</Label>
            <div className="grid gap-2">
              {interrupt.options.map((option) => (
                <button
                  key={option.id}
                  onClick={() => setSelectedAction(option.action)}
                  disabled={isSubmitting}
                  data-testid={`button-action-${option.action}`}
                  className={`
                    flex items-start gap-3 p-3 rounded-lg border-2 transition-all text-left
                    ${selectedAction === option.action
                      ? 'border-purple-600 bg-purple-50 dark:bg-purple-900/20'
                      : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
                    }
                    ${isSubmitting ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
                  `}
                >
                  <div className="mt-0.5">
                    {getActionIcon(option.action)}
                  </div>
                  <div className="flex-1">
                    <div className="font-medium">{option.label}</div>
                    {option.description && (
                      <div className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                        {option.description}
                      </div>
                    )}
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Optional Feedback */}
          {selectedAction === 'modify' && (
            <div className="space-y-2">
              <Label htmlFor="feedback">Modification Request (optional)</Label>
              <Textarea
                id="feedback"
                data-testid="textarea-feedback"
                placeholder="Describe what changes you'd like the agent to make..."
                value={feedback}
                onChange={(e) => setFeedback(e.target.value)}
                rows={3}
                disabled={isSubmitting}
              />
            </div>
          )}

          {/* Default Action Notice */}
          {interrupt.defaultAction && timeRemaining !== null && (
            <p className="text-xs text-gray-500 dark:text-gray-400">
              If no action is taken, "{interrupt.options.find(o => o.action === interrupt.defaultAction)?.label}" will be automatically selected.
            </p>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={onClose}
            disabled={isSubmitting}
            data-testid="button-cancel"
          >
            Cancel
          </Button>
          <Button
            onClick={() => handleSubmit()}
            disabled={!selectedAction || isSubmitting}
            data-testid="button-submit"
            variant={selectedAction ? getActionVariant(selectedAction) : 'default'}
          >
            {isSubmitting ? 'Submitting...' : 'Submit Response'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}