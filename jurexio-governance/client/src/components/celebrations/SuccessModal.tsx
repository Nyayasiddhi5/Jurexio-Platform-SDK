import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { CheckCircle2, Sparkles, Share2, X, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import confetti from 'canvas-confetti';

export interface CelebrationConfig {
  title: string;
  message: string;
  icon?: 'success' | 'milestone' | 'sparkles';
  confettiEnabled?: boolean;
  nextAction?: {
    label: string;
    onClick: () => void;
  };
  shareEnabled?: boolean;
  shareMessage?: string;
}

interface SuccessModalProps {
  isOpen: boolean;
  onClose: () => void;
  config: CelebrationConfig;
}

export default function SuccessModal({ isOpen, onClose, config }: SuccessModalProps) {
  const [showConfetti, setShowConfetti] = useState(false);

  useEffect(() => {
    if (isOpen && config.confettiEnabled && !showConfetti) {
      setShowConfetti(true);
      
      // Trigger confetti animation
      const duration = 3000;
      const end = Date.now() + duration;

      const frame = () => {
        confetti({
          particleCount: 2,
          angle: 60,
          spread: 55,
          origin: { x: 0 },
          colors: ['#7c3aed', '#a78bfa', '#c4b5fd']
        });
        confetti({
          particleCount: 2,
          angle: 120,
          spread: 55,
          origin: { x: 1 },
          colors: ['#7c3aed', '#a78bfa', '#c4b5fd']
        });

        if (Date.now() < end) {
          requestAnimationFrame(frame);
        }
      };

      frame();
    }
    
    // Reset confetti flag when modal closes
    if (!isOpen && showConfetti) {
      setShowConfetti(false);
    }
  }, [isOpen, config.confettiEnabled, showConfetti]);

  const handleShare = async () => {
    if (navigator.share && config.shareMessage) {
      try {
        await navigator.share({
          title: config.title,
          text: config.shareMessage,
          url: window.location.href
        });
      } catch (error) {
        console.log('Error sharing:', error);
      }
    } else {
      // Fallback: copy to clipboard
      if (config.shareMessage) {
        navigator.clipboard.writeText(config.shareMessage);
      }
    }
  };

  const getIcon = () => {
    switch (config.icon) {
      case 'milestone':
        return <CheckCircle2 className="w-16 h-16 text-primary" />;
      case 'sparkles':
        return <Sparkles className="w-16 h-16 text-primary" />;
      default:
        return <CheckCircle2 className="w-16 h-16 text-green-500" />;
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md">
        <button
          onClick={onClose}
          className="absolute right-4 top-4 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100"
          data-testid="button-close-celebration"
        >
          <X className="h-4 w-4" />
        </button>

        <DialogHeader className="text-center space-y-4">
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ type: 'spring', stiffness: 260, damping: 20 }}
            className="mx-auto"
          >
            {getIcon()}
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
          >
            <DialogTitle className="text-2xl font-bold">
              {config.title}
            </DialogTitle>
            <DialogDescription className="text-base mt-2">
              {config.message}
            </DialogDescription>
          </motion.div>
        </DialogHeader>

        <DialogFooter className="flex-col sm:flex-row gap-2 mt-4">
          {config.shareEnabled && (
            <Button
              variant="outline"
              onClick={handleShare}
              className="flex items-center gap-2"
              data-testid="button-share-success"
            >
              <Share2 className="w-4 h-4" />
              Share Progress
            </Button>
          )}

          {config.nextAction && (
            <Button
              onClick={config.nextAction.onClick}
              className="flex items-center gap-2"
              data-testid="button-next-action"
            >
              {config.nextAction.label}
              <ArrowRight className="w-4 h-4" />
            </Button>
          )}

          {!config.nextAction && (
            <Button
              onClick={onClose}
              className="w-full"
              data-testid="button-continue"
            >
              Continue
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
