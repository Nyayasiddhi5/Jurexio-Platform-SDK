import { useState, useCallback } from 'react';
import { type CelebrationConfig } from '@/components/celebrations/SuccessModal';

export function useCelebration() {
  const [isOpen, setIsOpen] = useState(false);
  const [config, setConfig] = useState<CelebrationConfig | null>(null);

  const celebrate = useCallback((celebrationConfig: CelebrationConfig) => {
    setConfig(celebrationConfig);
    setIsOpen(true);
  }, []);

  const close = useCallback(() => {
    setIsOpen(false);
  }, []);

  const celebrateWorkflowSuccess = useCallback((
    workflowName: string,
    studioName: string,
    nextAction?: { label: string; onClick: () => void }
  ) => {
    celebrate({
      title: `${workflowName} Complete! 🎉`,
      message: `Your ${studioName} workflow has successfully generated insights and artifacts for your startup.`,
      icon: 'success',
      confettiEnabled: true,
      nextAction,
      shareEnabled: true,
      shareMessage: `Just completed ${workflowName} in the ${studioName} with Jurexio! 🚀 #Jurexio`
    });
  }, [celebrate]);

  const celebrateMilestone = useCallback((
    milestoneName: string,
    description: string,
    nextAction?: { label: string; onClick: () => void }
  ) => {
    celebrate({
      title: milestoneName,
      message: description,
      icon: 'milestone',
      confettiEnabled: true,
      nextAction,
      shareEnabled: true,
      shareMessage: `Reached a major milestone: ${milestoneName}! Building my startup with Jurexio. #StartupJourney`
    });
  }, [celebrate]);

  const celebrateOnboarding = useCallback((
    startupName: string,
    nextAction?: { label: string; onClick: () => void }
  ) => {
    celebrate({
      title: 'Welcome to Jurexio! 🎉',
      message: `${startupName} is now ready to begin your 14-day journey to a production-ready MVP!`,
      icon: 'sparkles',
      confettiEnabled: true,
      nextAction,
      shareEnabled: false
    });
  }, [celebrate]);

  return {
    isOpen,
    config,
    celebrate,
    close,
    celebrateWorkflowSuccess,
    celebrateMilestone,
    celebrateOnboarding
  };
}
