import { motion } from 'framer-motion';
import { Trophy, Rocket, Users, Sparkles, Share2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Card, CardContent } from '@/components/ui/card';
import confetti from 'canvas-confetti';
import { useEffect, useState } from 'react';

interface JourneyCompletionModalProps {
  isOpen: boolean;
  onClose: () => void;
  startupName: string;
  stats: {
    studiosCompleted: number;
    artifactsGenerated: number;
    daysElapsed: number;
  };
}

export default function JourneyCompletionModal({
  isOpen,
  onClose,
  startupName,
  stats
}: JourneyCompletionModalProps) {
  const [confettiFired, setConfettiFired] = useState(false);

  useEffect(() => {
    if (isOpen && !confettiFired) {
      setConfettiFired(true);
      
      // Epic confetti celebration
      const duration = 5000;
      const end = Date.now() + duration;
      const colors = ['#7c3aed', '#a78bfa', '#c4b5fd', '#fbbf24', '#f59e0b'];

      const frame = () => {
        confetti({
          particleCount: 5,
          angle: 60,
          spread: 55,
          origin: { x: 0 },
          colors
        });
        confetti({
          particleCount: 5,
          angle: 120,
          spread: 55,
          origin: { x: 1 },
          colors
        });

        if (Date.now() < end) {
          requestAnimationFrame(frame);
        } else {
          // Final burst
          confetti({
            particleCount: 100,
            spread: 70,
            origin: { y: 0.6 },
            colors
          });
        }
      };

      frame();
    }
  }, [isOpen, confettiFired]);

  const handleShare = async () => {
    const shareMessage = `🎉 I just completed my 14-day startup journey with Jurexio! Transformed my idea for ${startupName} into a production-ready MVP with ${stats.artifactsGenerated} artifacts across ${stats.studiosCompleted} studios. #Jurexio #StartupJourney`;
    
    if (navigator.share) {
      try {
        await navigator.share({
          title: 'Journey Complete!',
          text: shareMessage,
          url: window.location.href
        });
      } catch (error) {
        console.log('Error sharing:', error);
      }
    } else {
      navigator.clipboard.writeText(shareMessage);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader className="text-center space-y-6">
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1, rotate: [0, -10, 10, -10, 0] }}
            transition={{ type: 'spring', stiffness: 260, damping: 20 }}
            className="mx-auto"
          >
            <Trophy className="w-20 h-20 text-yellow-500" />
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
          >
            <DialogTitle className="text-3xl font-bold bg-gradient-to-r from-purple-600 to-pink-600 bg-clip-text text-transparent">
              🎉 Journey Complete!
            </DialogTitle>
            <DialogDescription className="text-lg mt-2">
              Congratulations on completing your 14-day startup journey with <strong>{startupName}</strong>!
            </DialogDescription>
          </motion.div>
        </DialogHeader>

        <div className="grid grid-cols-3 gap-4 mt-6">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
          >
            <Card className="bg-gradient-to-br from-purple-50 to-purple-100 dark:from-purple-900/20 dark:to-purple-800/20 border-purple-200 dark:border-purple-700">
              <CardContent className="pt-6 text-center">
                <Sparkles className="w-8 h-8 mx-auto mb-2 text-purple-600" />
                <div className="text-2xl font-bold text-purple-900 dark:text-purple-100">
                  {stats.studiosCompleted}
                </div>
                <div className="text-sm text-purple-700 dark:text-purple-300">
                  Studios Completed
                </div>
              </CardContent>
            </Card>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4 }}
          >
            <Card className="bg-gradient-to-br from-blue-50 to-blue-100 dark:from-blue-900/20 dark:to-blue-800/20 border-blue-200 dark:border-blue-700">
              <CardContent className="pt-6 text-center">
                <Rocket className="w-8 h-8 mx-auto mb-2 text-blue-600" />
                <div className="text-2xl font-bold text-blue-900 dark:text-blue-100">
                  {stats.artifactsGenerated}
                </div>
                <div className="text-sm text-blue-700 dark:text-blue-300">
                  Artifacts Generated
                </div>
              </CardContent>
            </Card>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.5 }}
          >
            <Card className="bg-gradient-to-br from-green-50 to-green-100 dark:from-green-900/20 dark:to-green-800/20 border-green-200 dark:border-green-700">
              <CardContent className="pt-6 text-center">
                <Users className="w-8 h-8 mx-auto mb-2 text-green-600" />
                <div className="text-2xl font-bold text-green-900 dark:text-green-100">
                  {stats.daysElapsed}
                </div>
                <div className="text-sm text-green-700 dark:text-green-300">
                  Days to MVP
                </div>
              </CardContent>
            </Card>
          </motion.div>
        </div>

        <div className="bg-gradient-to-r from-purple-50 to-pink-50 dark:from-purple-900/20 dark:to-pink-900/20 border border-purple-200 dark:border-purple-700 rounded-lg p-6 mt-6">
          <h3 className="font-semibold text-lg mb-3 text-purple-900 dark:text-purple-100">
            What's Next?
          </h3>
          <ul className="space-y-2 text-sm text-purple-800 dark:text-purple-200">
            <li className="flex items-start gap-2">
              <span className="text-purple-600 font-bold">•</span>
              <span>Review your artifacts and finalize your MVP</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-purple-600 font-bold">•</span>
              <span>Connect with matched investors to pitch your startup</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-purple-600 font-bold">•</span>
              <span>Deploy your MVP and start acquiring users</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-purple-600 font-bold">•</span>
              <span>Share your success story with the Jurexio community</span>
            </li>
          </ul>
        </div>

        <div className="flex gap-3 mt-6">
          <Button
            onClick={handleShare}
            variant="outline"
            className="flex-1 flex items-center gap-2"
            data-testid="button-share-journey"
          >
            <Share2 className="w-4 h-4" />
            Share Your Success
          </Button>
          <Button
            onClick={onClose}
            className="flex-1"
            data-testid="button-continue-journey"
          >
            Continue to Dashboard
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
