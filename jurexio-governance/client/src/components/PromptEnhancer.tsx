/**
 * AI-Powered Prompt Enhancement Component
 * Intelligent prompt analysis and optimization interface
 */
import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { 
  Sparkles, 
  RefreshCw, 
  CheckCircle, 
  AlertCircle, 
  Clock,
  Users,
  Target,
  Shield,
  X,
  History,
  Trash2
} from 'lucide-react';
import { useToast, toast } from '@/hooks/use-toast';

interface PromptEnhancerProps {
  open: boolean;
  onClose: () => void;
  onEnhanced: (data: any) => void;
  initialPrompt: string;
}

export function PromptEnhancer({ open, onClose, onEnhanced, initialPrompt }: PromptEnhancerProps) {
  const { toast } = useToast();
  const [prompt, setPrompt] = useState(initialPrompt);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isEnhancing, setIsEnhancing] = useState(false);
  const [quickAnalysis, setQuickAnalysis] = useState<any>(null);
  const [enhancement, setEnhancement] = useState<any>(null);
  const [currentStep, setCurrentStep] = useState(0);
  const [chatHistory, setChatHistory] = useState<string[]>([]);

  // Load chat history from localStorage on component mount
  useEffect(() => {
    const savedHistory = localStorage.getItem('promptEnhancerHistory');
    if (savedHistory) {
      try {
        const history = JSON.parse(savedHistory);
        setChatHistory(history);
      } catch (error) {
        console.error('Failed to load chat history:', error);
      }
    }
  }, []);

  // Save chat history to localStorage whenever it changes
  useEffect(() => {
    if (chatHistory.length > 0) {
      localStorage.setItem('promptEnhancerHistory', JSON.stringify(chatHistory));
    }
  }, [chatHistory]);

  useEffect(() => {
    setPrompt(initialPrompt);
    // Reset enhancement state when opening with new prompt
    if (open) {
      setEnhancement(null);
      setCurrentStep(0);
      setIsEnhancing(false);
      setIsAnalyzing(false);
    }
  }, [initialPrompt, open]);

  // Quick analysis for real-time feedback
  useEffect(() => {
    if (prompt && prompt.length > 10) {
      const debounceTimer = setTimeout(async () => {
        try {
          const response = await fetch('/api/prompt/quick-analyze', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ prompt })
          });

          if (response.ok) {
            const data = await response.json();
            setQuickAnalysis(data);
          }
        } catch (error) {
          console.error('Quick analysis failed:', error);
        }
      }, 500);

      return () => clearTimeout(debounceTimer);
    }
  }, [prompt]);

  const handleEnhancement = async () => {
    if (!prompt.trim()) {
      toast({
        title: "Empty Prompt",
        description: "Please enter a project description to enhance.",
        variant: "destructive"
      });
      return;
    }

    // Save prompt to history (avoid duplicates)
    setChatHistory(prev => {
      const newHistory = [prompt, ...prev.filter(p => p !== prompt)].slice(0, 10); // Keep only last 10
      return newHistory;
    });

    setIsEnhancing(true);
    setCurrentStep(0);

    const steps = [
      'Analyzing prompt clarity and completeness...',
      'Generating comprehensive project requirements...',
      'Creating detailed project plan with phases...',
      'Performing risk assessment and mitigation...',
      'Defining success metrics and acceptance criteria...'
    ];

    try {
      // Simulate progress through steps
      for (let i = 0; i < steps.length; i++) {
        setCurrentStep(i);
        await new Promise(resolve => setTimeout(resolve, 1000));
      }

      const response = await fetch('/api/prompt/enhance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt })
      });

      if (response.ok) {
        const data = await response.json();
        setEnhancement(data.enhancement);
        setCurrentStep(steps.length);
        
        toast({
          title: "Enhancement Complete",
          description: "Your prompt has been enhanced with comprehensive project planning.",
        });
      } else {
        throw new Error('Enhancement failed');
      }
    } catch (error) {
      toast({
        title: "Enhancement Failed",
        description: "Failed to enhance the prompt. Please try again.",
        variant: "destructive"
      });
    } finally {
      setIsEnhancing(false);
    }
  };

  const selectFromHistory = (historicalPrompt: string) => {
    setPrompt(historicalPrompt);
  };

  const clearHistory = () => {
    setChatHistory([]);
    localStorage.removeItem('promptEnhancerHistory');
    toast({
      title: "History Cleared",
      description: "Your prompt history has been cleared.",
    });
  };

  const handleApprove = () => {
    if (enhancement) {
      onEnhanced({
        original: prompt,
        enhanced: enhancement.enhanced,
        projectPlan: enhancement.projectPlan,
        analysis: enhancement.analysis,
        riskAssessment: enhancement.riskAssessment,
        successMetrics: enhancement.successMetrics
      });
      handleClose();
    }
  };

  const handleClose = () => {
    // Reset all enhancement state when closing
    setEnhancement(null);
    setCurrentStep(0);
    setIsEnhancing(false);
    setIsAnalyzing(false);
    setQuickAnalysis(null);
    onClose();
  };

  if (!open) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
        onClick={handleClose}
      >
        <motion.div
          initial={{ scale: 0.95, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.95, opacity: 0 }}
          className="bg-white dark:bg-slate-900 rounded-lg max-w-6xl w-full max-h-[90vh] overflow-hidden"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="p-6 border-b border-slate-200 dark:border-slate-700">
            <div className="flex justify-between items-center">
              <div className="flex items-center gap-2">
                <Sparkles className="h-6 w-6 text-blue-600" />
                <h2 className="text-2xl font-bold">AI Prompt Enhancer</h2>
              </div>
              <Button variant="ghost" onClick={handleClose}>
                <X className="h-4 w-4" />
              </Button>
            </div>
            <p className="text-slate-600 dark:text-slate-300 mt-2">
              Transform your idea into a comprehensive project specification with AI-powered analysis
            </p>
          </div>

          <div className="flex-1 overflow-y-auto p-6">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Left Column - Input and Quick Analysis */}
              <div className="space-y-6">
                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg">Your Project Idea</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <Textarea
                      value={prompt}
                      onChange={(e) => setPrompt(e.target.value)}
                      placeholder="Describe what you want to build..."
                      className="min-h-[200px] resize-none"
                    />
                    
                    {/* Chat History */}
                    {chatHistory.length > 0 && (
                      <div className="mt-4 p-3 bg-slate-50 dark:bg-slate-800 rounded-lg">
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-2">
                            <History className="h-4 w-4 text-slate-500" />
                            <p className="text-sm font-medium text-slate-700 dark:text-slate-300">
                              Previous Prompts:
                            </p>
                          </div>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={clearHistory}
                            className="h-6 px-2 text-xs hover:bg-slate-200 dark:hover:bg-slate-700"
                          >
                            <Trash2 className="h-3 w-3 mr-1" />
                            Clear
                          </Button>
                        </div>
                        <div className="space-y-2 max-h-32 overflow-y-auto">
                          {chatHistory.map((historicalPrompt, index) => (
                            <button
                              key={index}
                              onClick={() => selectFromHistory(historicalPrompt)}
                              className="w-full text-left p-2 text-xs bg-white dark:bg-slate-700 rounded border border-slate-200 dark:border-slate-600 hover:bg-slate-100 dark:hover:bg-slate-600 transition-colors"
                            >
                              {historicalPrompt.length > 100 
                                ? `${historicalPrompt.substring(0, 100)}...` 
                                : historicalPrompt}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                    
                    {/* Quick Analysis Feedback */}
                    {quickAnalysis && (
                      <div className="mt-4 space-y-3">
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-medium">Prompt Quality Score</span>
                          <Badge variant={quickAnalysis.score >= 70 ? 'default' : 'secondary'}>
                            {quickAnalysis.score}/100
                          </Badge>
                        </div>
                        <Progress value={quickAnalysis.score} className="h-2" />
                        
                        {quickAnalysis.suggestions?.length > 0 && (
                          <div className="space-y-2">
                            <p className="text-sm font-medium text-amber-600 dark:text-amber-400">
                              Suggestions for improvement:
                            </p>
                            <ul className="space-y-1">
                              {quickAnalysis.suggestions.map((suggestion: string, index: number) => (
                                <li key={index} className="text-xs text-slate-600 dark:text-slate-400 flex items-start gap-2">
                                  <AlertCircle className="h-3 w-3 mt-0.5 text-amber-500 flex-shrink-0" />
                                  {suggestion}
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </div>
                    )}
                  </CardContent>
                </Card>

                <div className="flex gap-3">
                  <Button 
                    onClick={handleEnhancement}
                    disabled={isEnhancing || !prompt.trim()}
                    className="flex-1"
                  >
                    {isEnhancing ? (
                      <>
                        <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                        Enhancing...
                      </>
                    ) : (
                      <>
                        <Sparkles className="h-4 w-4 mr-2" />
                        Enhance Prompt
                      </>
                    )}
                  </Button>
                  {enhancement && (
                    <Button onClick={handleApprove} variant="default">
                      <CheckCircle className="h-4 w-4 mr-2" />
                      Start Project
                    </Button>
                  )}
                </div>
              </div>

              {/* Right Column - Enhancement Results */}
              <div className="space-y-6">
                {isEnhancing && (
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-lg">Enhancement Progress</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-4">
                        {[
                          'Analyzing prompt clarity and completeness',
                          'Generating comprehensive requirements',
                          'Creating detailed project plan',
                          'Performing risk assessment',
                          'Defining success metrics'
                        ].map((step, index) => (
                          <div key={index} className="flex items-center gap-3">
                            {index < currentStep ? (
                              <CheckCircle className="h-5 w-5 text-green-500" />
                            ) : index === currentStep ? (
                              <RefreshCw className="h-5 w-5 text-blue-500 animate-spin" />
                            ) : (
                              <div className="h-5 w-5 rounded-full border-2 border-slate-300" />
                            )}
                            <span className={`text-sm ${
                              index <= currentStep 
                                ? 'text-slate-900 dark:text-slate-100' 
                                : 'text-slate-500 dark:text-slate-400'
                            }`}>
                              {step}
                            </span>
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                )}

                {enhancement && (
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-lg">Enhancement Results</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <Tabs defaultValue="enhanced" className="w-full">
                        <TabsList className="grid w-full grid-cols-4">
                          <TabsTrigger value="enhanced">Enhanced</TabsTrigger>
                          <TabsTrigger value="plan">Plan</TabsTrigger>
                          <TabsTrigger value="risks">Risks</TabsTrigger>
                          <TabsTrigger value="metrics">Metrics</TabsTrigger>
                        </TabsList>
                        
                        <TabsContent value="enhanced" className="mt-4">
                          <div className="space-y-3">
                            <div className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-400">
                              <CheckCircle className="h-4 w-4 text-green-500" />
                              Enhanced with comprehensive requirements
                            </div>
                            <div className="bg-slate-50 dark:bg-slate-800 rounded-lg p-4">
                              <p className="text-sm whitespace-pre-wrap">
                                {enhancement.enhanced.substring(0, 300)}...
                              </p>
                            </div>
                          </div>
                        </TabsContent>
                        
                        <TabsContent value="plan" className="mt-4">
                          <div className="space-y-3">
                            <div className="flex items-center gap-4 text-sm">
                              <div className="flex items-center gap-1">
                                <Clock className="h-4 w-4" />
                                {enhancement.projectPlan?.totalEstimatedHours || 0}h
                              </div>
                              <div className="flex items-center gap-1">
                                <Users className="h-4 w-4" />
                                {enhancement.projectPlan?.recommendedTeamSize || 1} people
                              </div>
                            </div>
                            <div className="space-y-2">
                              {enhancement.projectPlan?.phases?.slice(0, 3).map((phase: any, index: number) => (
                                <div key={index} className="flex justify-between items-center p-2 bg-slate-50 dark:bg-slate-800 rounded">
                                  <span className="text-sm font-medium">{phase.name}</span>
                                  <span className="text-xs text-slate-500">{phase.duration}h</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        </TabsContent>
                        
                        <TabsContent value="risks" className="mt-4">
                          <div className="space-y-3">
                            <div className="flex items-center gap-2">
                              <Shield className="h-4 w-4" />
                              <span className="text-sm font-medium">
                                Risk Level: {enhancement.riskAssessment?.overallRiskLevel || 'Medium'}
                              </span>
                            </div>
                            <div className="space-y-2">
                              {enhancement.riskAssessment?.risks?.slice(0, 3).map((risk: any, index: number) => (
                                <div key={index} className="p-2 bg-slate-50 dark:bg-slate-800 rounded">
                                  <div className="text-sm font-medium">{risk.category}</div>
                                  <div className="text-xs text-slate-600 dark:text-slate-400">
                                    {risk.description}
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        </TabsContent>
                        
                        <TabsContent value="metrics" className="mt-4">
                          <div className="space-y-3">
                            <div className="flex items-center gap-2">
                              <Target className="h-4 w-4" />
                              <span className="text-sm font-medium">Success Metrics</span>
                            </div>
                            <div className="space-y-1">
                              {enhancement.successMetrics?.slice(0, 4).map((metric: string, index: number) => (
                                <div key={index} className="text-sm text-slate-600 dark:text-slate-400 flex items-start gap-2">
                                  <CheckCircle className="h-3 w-3 mt-1 text-green-500 flex-shrink-0" />
                                  {metric}
                                </div>
                              ))}
                            </div>
                          </div>
                        </TabsContent>
                      </Tabs>
                    </CardContent>
                  </Card>
                )}
              </div>
            </div>
          </div>

          {/* Footer with Action Buttons */}
          <div className="border-t border-slate-200 dark:border-slate-700 p-6">
            <div className="flex justify-between items-center">
              <div className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-400">
                {prompt.length}/1000 characters
              </div>
              
              <div className="flex gap-3">
                <Button 
                  variant="outline" 
                  onClick={handleClose}
                  disabled={isEnhancing}
                >
                  Cancel
                </Button>
                
                {!enhancement ? (
                  <Button 
                    onClick={handleEnhancement}
                    disabled={isEnhancing || !prompt.trim()}
                    className="min-w-[120px]"
                  >
                    {isEnhancing ? (
                      <>
                        <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                        Enhancing...
                      </>
                    ) : (
                      <>
                        <Sparkles className="mr-2 h-4 w-4" />
                        Enhance Prompt
                      </>
                    )}
                  </Button>
                ) : (
                  <Button 
                    onClick={handleApprove}
                    className="min-w-[120px]"
                  >
                    <CheckCircle className="mr-2 h-4 w-4" />
                    Use Enhanced Prompt
                  </Button>
                )}
              </div>
            </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}