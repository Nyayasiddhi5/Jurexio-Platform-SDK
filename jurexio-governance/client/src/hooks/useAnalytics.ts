import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";

export type EventType =
  | 'user_signup'
  | 'onboarding_started'
  | 'onboarding_completed'
  | 'studio_launched'
  | 'artifact_generated'
  | 'milestone_completed'
  | 'credit_purchased'
  | 'journey_completed'
  | 'error_encountered'
  | 'session_started'
  | 'session_ended';

interface TrackEventParams {
  eventType: EventType;
  properties?: Record<string, any>;
  startupId?: number;
}

export function useAnalytics() {
  const trackEventMutation = useMutation({
    mutationFn: async ({ eventType, properties, startupId }: TrackEventParams) => {
      return await apiRequest('/api/tracking/track', {
        method: 'POST',
        body: JSON.stringify({ eventType, properties, startupId }),
      });
    },
    onError: (error) => {
      // Silent failure for analytics - don't interrupt user experience
      console.warn('Analytics tracking failed:', error);
    },
  });

  const trackEvent = (eventType: EventType, properties?: Record<string, any>, startupId?: number) => {
    trackEventMutation.mutate({ eventType, properties, startupId });
  };

  return {
    trackEvent,
    isTracking: trackEventMutation.isPending,
  };
}
