/**
 * React Hook for AG-UI Human-in-the-Loop Approval
 * 
 * Manages approval dialog state and integrates with AG-UI streaming
 * Usage:
 * const { ApprovalDialog, currentInterrupt, respondToInterrupt } = useAGUIApproval(sessionId);
 */

import { useState, useEffect } from 'react';
import { useAGUIStream } from './use-agui-stream';
import type { AGUIInterruptEvent, AGUIInterruptResponse } from '@shared/agui-event-types';

export interface UseAGUIApprovalResult {
  currentInterrupt: AGUIInterruptEvent | null;
  approvalDialogOpen: boolean;
  respondToInterrupt: (response: AGUIInterruptResponse) => Promise<void>;
  openApprovalDialog: () => void;
  closeApprovalDialog: () => void;
}

export function useAGUIApproval(sessionId: string | null): UseAGUIApprovalResult {
  const [currentInterrupt, setCurrentInterrupt] = useState<AGUIInterruptEvent | null>(null);
  const [approvalDialogOpen, setApprovalDialogOpen] = useState(false);

  // SESSION LIFECYCLE: Clear interrupt state when sessionId changes (new conversation)
  useEffect(() => {
    if (sessionId) {
      console.log(`🔄 Session changed to ${sessionId.slice(0, 16)}... - clearing approval state`);
      setCurrentInterrupt(null);
      setApprovalDialogOpen(false);
    }
  }, [sessionId]);

  // Listen to AG-UI stream events
  const { events } = useAGUIStream(sessionId, {
    includeHistory: true,
    reconnect: true,
    onEvent: (event) => {
      // Check for interrupt events
      if (event.type === 'agent:interrupt') {
        const interruptEvent = event as AGUIInterruptEvent;
        setCurrentInterrupt(interruptEvent);
        setApprovalDialogOpen(true);
      }
    }
  });

  // Respond to interrupt/approval request
  const respondToInterrupt = async (response: AGUIInterruptResponse): Promise<void> => {
    if (!sessionId || !currentInterrupt) {
      throw new Error('No active interrupt to respond to');
    }

    // SESSION CONTRACT VERIFICATION: Log approval response target
    console.log(`✅ Approval response: POST /api/agui/sessions/${sessionId.slice(0, 16)}.../interrupts/respond`);

    try {
      const res = await fetch(`/api/agui/sessions/${sessionId}/interrupts/respond`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(response),
      });

      if (!res.ok) {
        console.error(`❌ Approval response failed: ${res.status} ${res.statusText}`);
        throw new Error('Failed to submit approval response');
      }

      console.log(`✅ Approval response accepted for session ${sessionId.slice(0, 16)}...`);

      // Clear current interrupt after successful response
      setCurrentInterrupt(null);
      setApprovalDialogOpen(false);
    } catch (error) {
      console.error('Error responding to interrupt:', error);
      throw error;
    }
  };

  const openApprovalDialog = () => setApprovalDialogOpen(true);
  const closeApprovalDialog = () => setApprovalDialogOpen(false);

  return {
    currentInterrupt,
    approvalDialogOpen,
    respondToInterrupt,
    openApprovalDialog,
    closeApprovalDialog,
  };
}
