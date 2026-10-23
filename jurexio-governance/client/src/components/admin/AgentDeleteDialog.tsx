import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { 
  AlertDialog, 
  AlertDialogAction, 
  AlertDialogCancel, 
  AlertDialogContent, 
  AlertDialogDescription, 
  AlertDialogFooter, 
  AlertDialogHeader, 
  AlertDialogTitle 
} from '@/components/ui/alert-dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { apiRequest } from '@/lib/queryClient';
import { AlertTriangle } from 'lucide-react';

interface AgentDeleteDialogProps {
  agentId: string | null;
  agentName?: string;
  isOpen: boolean;
  onClose: () => void;
}

export default function AgentDeleteDialog({ 
  agentId, 
  agentName, 
  isOpen, 
  onClose 
}: AgentDeleteDialogProps) {
  const [confirmationText, setConfirmationText] = useState('');
  const expectedText = 'DELETE';
  
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const deleteAgentMutation = useMutation({
    mutationFn: async () => {
      if (!agentId) throw new Error('No agent ID provided');
      // Admin delete endpoint not yet exposed under /api/jrx/*; fail with clear message.
      throw new Error(`Agent delete is read-only in this build (agent=${agentId}, admin write endpoint pending).`);
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['agents'] });
      toast({
        title: 'Agent Deleted',
        description: data.message,
      });
      setConfirmationText('');
      onClose();
    },
    onError: (error: Error) => {
      toast({
        title: 'Read-only mode',
        description: error?.message || 'Failed to delete agent',
        variant: 'destructive',
      });
    },
  });

  const handleDelete = () => {
    if (confirmationText === expectedText) {
      deleteAgentMutation.mutate();
    }
  };

  const handleClose = () => {
    setConfirmationText('');
    onClose();
  };

  return (
    <AlertDialog open={isOpen} onOpenChange={handleClose}>
      <AlertDialogContent data-testid="dialog-agent-delete">
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2 text-red-600">
            <AlertTriangle className="w-5 h-5" />
            Delete Agent
          </AlertDialogTitle>
          <AlertDialogDescription className="space-y-4">
            <p>
              You are about to permanently delete the agent:{' '}
              <span className="font-semibold">{agentName}</span>
            </p>
            <p className="text-red-600 font-medium">
              This action cannot be undone. The agent will be permanently removed 
              from the system along with all its configurations and history.
            </p>
            <div className="space-y-2">
              <Label htmlFor="confirmation">
                Type <span className="font-mono font-bold">{expectedText}</span> to confirm:
              </Label>
              <Input
                id="confirmation"
                value={confirmationText}
                onChange={(e) => setConfirmationText(e.target.value)}
                placeholder={expectedText}
                className="font-mono"
                data-testid="input-delete-confirmation"
              />
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={handleClose} data-testid="button-cancel-delete">
            Cancel
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={handleDelete}
            disabled={confirmationText !== expectedText || deleteAgentMutation.isPending}
            className="bg-red-600 hover:bg-red-700 focus:ring-red-600"
            data-testid="button-confirm-delete"
          >
            {deleteAgentMutation.isPending ? (
              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
            ) : null}
            Delete Agent
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}