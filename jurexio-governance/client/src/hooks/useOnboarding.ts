import { useQuery, useMutation } from '@tanstack/react-query';
import { apiRequest, queryClient } from '@/lib/queryClient';
import type { UserOnboardingProgress } from '@shared/schema';

export function useOnboardingProgress() {
  return useQuery<{ success: boolean; data: UserOnboardingProgress }>({
    queryKey: ['/api/onboarding/progress'],
    retry: 1,
  });
}

export function useStartOnboarding() {
  return useMutation({
    mutationFn: async () => {
      return apiRequest('/api/onboarding/start', {
        method: 'POST',
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/onboarding/progress'] });
    },
  });
}

export function useUpdateOnboardingStep() {
  return useMutation({
    mutationFn: async (data: {
      stepName: 'stepWelcome' | 'stepGoalCapture' | 'stepWorkspaceTour' | 'stepFirstStudioLaunch';
      founderGoal?: string;
      industryFocus?: string;
      technicalLevel?: string;
    }) => {
      return apiRequest('/api/onboarding/step', {
        method: 'PATCH',
        body: JSON.stringify(data),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/onboarding/progress'] });
    },
  });
}

export function useSkipOnboarding() {
  return useMutation({
    mutationFn: async () => {
      return apiRequest('/api/onboarding/skip', {
        method: 'POST',
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/onboarding/progress'] });
    },
  });
}
