/**
 * Enhanced User Experience Components - Phase 4
 * 
 * Addressing UI/UX audit findings: navigation simplification, 
 * progress indicators, improved onboarding, and mobile responsiveness
 */

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { 
  ChevronRight, CheckCircle, Play, ArrowLeft, ArrowRight,
  Lightbulb, Target, Zap, Rocket, Star, BookOpen, Users,
  Smartphone, Tablet, Monitor, Globe, Clock, TrendingUp
} from 'lucide-react';

// Navigation Simplification Component
export function SimplifiedNavigation({ currentStep, totalSteps, onStepChange }: {
  currentStep: number;
  totalSteps: number;
  onStepChange: (step: number) => void;
}) {
  const steps = [
    { id: 1, name: 'Create', icon: Lightbulb, description: 'Start your project' },
    { id: 2, name: 'Configure', icon: Target, description: 'Set up requirements' },
    { id: 3, name: 'Generate', icon: Zap, description: 'AI-powered creation' },
    { id: 4, name: 'Review', icon: CheckCircle, description: 'Quality check' },
    { id: 5, name: 'Deploy', icon: Rocket, description: 'Go live' }
  ];

  return (
    <div className="w-full bg-white border-b shadow-sm">
      <div className="max-w-6xl mx-auto px-6 py-4">
        <div className="flex items-center justify-between">
          {/* Progress Bar */}
          <div className="flex-1 max-w-lg">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-sm font-medium text-gray-700">
                Step {currentStep} of {totalSteps}
              </span>
              <Progress value={(currentStep / totalSteps) * 100} className="flex-1" />
            </div>
            <div className="text-xs text-gray-500">
              {steps[currentStep - 1]?.description}
            </div>
          </div>

          {/* Step Navigation */}
          <div className="flex items-center gap-2">
            {steps.slice(0, totalSteps).map((step, index) => {
              const isActive = step.id === currentStep;
              const isCompleted = step.id < currentStep;
              const Icon = step.icon;

              return (
                <button
                  key={step.id}
                  onClick={() => onStepChange(step.id)}
                  className={`flex items-center gap-2 px-3 py-2 rounded-lg transition-all ${
                    isActive 
                      ? 'bg-blue-100 text-blue-700 border border-blue-200' 
                      : isCompleted
                      ? 'bg-green-100 text-green-700 hover:bg-green-150'
                      : 'text-gray-500 hover:bg-gray-100'
                  }`}
                >
                  <Icon className="h-4 w-4" />
                  <span className="hidden sm:block text-sm font-medium">{step.name}</span>
                  {isCompleted && <CheckCircle className="h-3 w-3" />}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

// Progressive Disclosure Component
export function ProgressiveDisclosure({ children, title, level = 1 }: {
  children: React.ReactNode;
  title: string;
  level?: number;
}) {
  const [isExpanded, setIsExpanded] = useState(level === 1);

  return (
    <div className="border rounded-lg overflow-hidden">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center justify-between p-4 bg-gray-50 hover:bg-gray-100 transition-colors"
      >
        <div className="flex items-center gap-3">
          <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-medium ${
            level === 1 ? 'bg-blue-100 text-blue-700' :
            level === 2 ? 'bg-green-100 text-green-700' :
            'bg-purple-100 text-purple-700'
          }`}>
            {level}
          </div>
          <span className="font-medium">{title}</span>
        </div>
        <ChevronRight className={`h-4 w-4 transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
      </button>
      
      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.3 }}
            className="overflow-hidden"
          >
            <div className="p-4 bg-white">
              {children}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// Quick Start Templates Component
export function QuickStartTemplates({ onSelectTemplate }: {
  onSelectTemplate: (template: any) => void;
}) {
  const templates = [
    {
      id: 'ai-chatbot',
      name: 'AI Chatbot',
      description: 'Customer service assistant with RAG',
      time: '5 minutes',
      complexity: 'Beginner',
      features: ['Voice support', 'Knowledge base', 'Multi-language'],
      icon: '🤖',
      category: 'AI Assistant'
    },
    {
      id: 'content-campaign',
      name: 'Marketing Campaign',
      description: 'Complete social media campaign',
      time: '10 minutes',
      complexity: 'Intermediate',
      features: ['Multi-platform', 'Analytics', 'A/B testing'],
      icon: '📢',
      category: 'Content'
    },
    {
      id: 'web-app',
      name: 'Web Application',
      description: 'Full-stack React application',
      time: '15 minutes',
      complexity: 'Advanced',
      features: ['Database', 'Authentication', 'API'],
      icon: '⚡',
      category: 'Development'
    },
    {
      id: 'mobile-game',
      name: 'Mobile Game',
      description: ' 2D puzzle game with physics',
      time: '20 minutes',
      complexity: 'Advanced',
      features: ['Multiplayer', 'Leaderboards', 'IAP'],
      icon: '🎮',
      category: 'Game'
    }
  ];

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
      {templates.map((template) => (
        <motion.div
          key={template.id}
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
        >
          <Card className="cursor-pointer hover:shadow-lg transition-all border-2 hover:border-blue-200">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div className="text-2xl">{template.icon}</div>
                <Badge variant="outline">{template.category}</Badge>
              </div>
              <CardTitle className="text-lg">{template.name}</CardTitle>
              <CardDescription className="text-sm">
                {template.description}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between text-sm">
                <span className="flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  {template.time}
                </span>
                <Badge className={
                  template.complexity === 'Beginner' ? 'bg-green-100 text-green-700' :
                  template.complexity === 'Intermediate' ? 'bg-yellow-100 text-yellow-700' :
                  'bg-red-100 text-red-700'
                }>
                  {template.complexity}
                </Badge>
              </div>
              
              <div className="space-y-2">
                <div className="text-xs font-medium text-gray-600">Features:</div>
                <div className="flex flex-wrap gap-1">
                  {template.features.map((feature) => (
                    <Badge key={feature} variant="secondary" className="text-xs">
                      {feature}
                    </Badge>
                  ))}
                </div>
              </div>

              <Button 
                className="w-full"
                onClick={() => onSelectTemplate(template)}
              >
                <Play className="h-4 w-4 mr-2" />
                Start Building
              </Button>
            </CardContent>
          </Card>
        </motion.div>
      ))}
    </div>
  );
}

// Mobile Responsiveness Indicator
export function ResponsivenessIndicator({ currentBreakpoint }: {
  currentBreakpoint: 'mobile' | 'tablet' | 'desktop';
}) {
  const breakpoints = [
    { id: 'mobile', name: 'Mobile', icon: Smartphone, color: 'text-blue-600' },
    { id: 'tablet', name: 'Tablet', icon: Tablet, color: 'text-green-600' },
    { id: 'desktop', name: 'Desktop', icon: Monitor, color: 'text-purple-600' }
  ];

  return (
    <div className="fixed bottom-4 right-4 bg-white border shadow-lg rounded-lg p-3 z-50">
      <div className="flex items-center gap-2">
        <Globe className="h-4 w-4 text-gray-600" />
        <span className="text-sm font-medium">View:</span>
        <div className="flex gap-1">
          {breakpoints.map((bp) => {
            const Icon = bp.icon;
            const isActive = bp.id === currentBreakpoint;
            
            return (
              <div
                key={bp.id}
                className={`p-1 rounded ${isActive ? 'bg-blue-100' : 'hover:bg-gray-100'}`}
              >
                <Icon className={`h-4 w-4 ${isActive ? bp.color : 'text-gray-400'}`} />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// Enhanced Loading States
export function EnhancedLoadingState({ 
  type = 'default',
  message = 'Loading...',
  progress,
  steps,
  currentStep
}: {
  type?: 'default' | 'generation' | 'deployment' | 'analysis';
  message?: string;
  progress?: number;
  steps?: string[];
  currentStep?: number;
}) {
  const loadingMessages = {
    default: ['Initializing...', 'Processing...', 'Almost ready...'],
    generation: ['Analyzing requirements...', 'Generating code...', 'Optimizing output...', 'Finalizing...'],
    deployment: ['Building application...', 'Configuring services...', 'Deploying to cloud...', 'Running health checks...'],
    analysis: ['Scanning code...', 'Running tests...', 'Checking performance...', 'Generating report...']
  };

  const [currentMessage, setCurrentMessage] = useState(0);
  const messages = steps || loadingMessages[type];

  useEffect(() => {
    if (!steps) {
      const interval = setInterval(() => {
        setCurrentMessage((prev) => (prev + 1) % messages.length);
      }, 2000);
      return () => clearInterval(interval);
    }
  }, [messages.length, steps]);

  return (
    <div className="flex flex-col items-center justify-center p-8 space-y-6">
      {/* Loading Animation */}
      <div className="relative">
        <div className="w-16 h-16 border-4 border-blue-200 rounded-full animate-pulse"></div>
        <div className="absolute inset-0 w-16 h-16 border-4 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
      </div>

      {/* Progress Bar */}
      {progress !== undefined && (
        <div className="w-full max-w-md space-y-2">
          <Progress value={progress} className="h-2" />
          <div className="text-sm text-center text-gray-600">{progress.toFixed(0)}% complete</div>
        </div>
      )}

      {/* Current Step */}
      <div className="text-center space-y-2">
        <div className="text-lg font-medium text-gray-900">
          {steps ? steps[currentStep || 0] : messages[currentMessage]}
        </div>
        <div className="text-sm text-gray-600">{message}</div>
      </div>

      {/* Step Indicators */}
      {steps && (
        <div className="flex space-x-2">
          {steps.map((_, index) => (
            <div
              key={index}
              className={`w-2 h-2 rounded-full ${
                index <= (currentStep || 0) ? 'bg-blue-600' : 'bg-gray-300'
              }`}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// Success Celebration Component
export function SuccessCelebration({ 
  title,
  description,
  onContinue,
  metrics
}: {
  title: string;
  description: string;
  onContinue: () => void;
  metrics?: { label: string; value: string; improvement?: string }[];
}) {
  return (
    <motion.div
      initial={{ scale: 0.9, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      className="text-center space-y-6 p-8"
    >
      <motion.div
        initial={{ scale: 0 }}
        animate={{ scale: 1 }}
        transition={{ delay: 0.2, type: "spring", stiffness: 200 }}
      >
        <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
          <CheckCircle className="h-10 w-10 text-green-600" />
        </div>
      </motion.div>

      <div>
        <h2 className="text-2xl font-bold text-gray-900 mb-2">{title}</h2>
        <p className="text-gray-600 max-w-md mx-auto">{description}</p>
      </div>

      {metrics && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 max-w-lg mx-auto">
          {metrics.map((metric, index) => (
            <motion.div
              key={index}
              initial={{ y: 20, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ delay: 0.4 + index * 0.1 }}
              className="bg-gray-50 rounded-lg p-4"
            >
              <div className="text-2xl font-bold text-blue-600">{metric.value}</div>
              <div className="text-sm text-gray-600">{metric.label}</div>
              {metric.improvement && (
                <div className="text-xs text-green-600 flex items-center justify-center gap-1 mt-1">
                  <TrendingUp className="h-3 w-3" />
                  {metric.improvement}
                </div>
              )}
            </motion.div>
          ))}
        </div>
      )}

      <div className="flex justify-center gap-4">
        <Button onClick={onContinue} size="lg" className="px-8">
          <Rocket className="h-4 w-4 mr-2" />
          Continue Building
        </Button>
      </div>
    </motion.div>
  );
}

// Guided Tutorial Component
export function GuidedTutorial({ 
  steps,
  currentStep,
  onNext,
  onPrevious,
  onSkip
}: {
  steps: Array<{
    title: string;
    content: string;
    element?: string;
    action?: string;
  }>;
  currentStep: number;
  onNext: () => void;
  onPrevious: () => void;
  onSkip: () => void;
}) {
  const step = steps[currentStep];

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4">
        <div className="p-6">
          <div className="flex items-center justify-between mb-4">
            <Badge variant="outline">
              Step {currentStep + 1} of {steps.length}
            </Badge>
            <Button variant="ghost" size="sm" onClick={onSkip}>
              Skip Tutorial
            </Button>
          </div>

          <h3 className="text-lg font-semibold mb-3">{step.title}</h3>
          <p className="text-gray-600 mb-6">{step.content}</p>

          {step.action && (
            <Alert className="mb-4">
              <Lightbulb className="h-4 w-4" />
              <AlertDescription>
                <strong>Try this:</strong> {step.action}
              </AlertDescription>
            </Alert>
          )}

          <div className="flex justify-between">
            <Button
              variant="outline"
              onClick={onPrevious}
              disabled={currentStep === 0}
            >
              <ArrowLeft className="h-4 w-4 mr-2" />
              Previous
            </Button>
            
            <Button onClick={onNext}>
              {currentStep === steps.length - 1 ? 'Finish' : 'Next'}
              {currentStep !== steps.length - 1 && <ArrowRight className="h-4 w-4 ml-2" />}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}