/**
 * Studio Readiness Hook
 * Checks if a studio can be accessed based on dependency completion
 */

import { useQuery } from '@tanstack/react-query';
import { useToast } from '@/hooks/use-toast';

export interface StudioReadinessResponse {
  success: boolean;
  ready: boolean;
  missingDependencies: string[];
  message: string;
}

export function useStudioReadiness(
  studioId: string,
  startupId: number | null | undefined,
  options?: {
    enabled?: boolean;
  }
) {
  const { toast } = useToast();

  return useQuery<StudioReadinessResponse>({
    queryKey: ['/api/jurexio/studios', studioId, 'readiness', startupId],
    queryFn: async () => {
      const response = await fetch(
        `/api/jurexio/studios/${studioId}/readiness?startupId=${startupId}`,
        {
          credentials: 'include',
        }
      );

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to check studio readiness');
      }

      return response.json();
    },
    enabled: options?.enabled !== false && !!startupId && !!studioId,
    retry: 2,
    staleTime: 30000, // Cache for 30 seconds
    refetchOnWindowFocus: false,
    onError: (error: Error) => {
      // Only toast on critical errors, not on expected dependency blocks
      if (!error.message.includes('dependency') && !error.message.includes('prerequisite')) {
        toast({
          title: 'Readiness Check Failed',
          description: error.message || 'Could not verify studio readiness. Please try again.',
          variant: 'destructive',
        });
      }
    },
  });
}
