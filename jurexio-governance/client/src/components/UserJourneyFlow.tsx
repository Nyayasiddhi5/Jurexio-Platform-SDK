import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { 
  Users, 
  ArrowRight, 
  CheckCircle, 
  Target,
  Brain,
  Palette,
  RefreshCw,
  Play,
  Eye
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

interface UserJourney {
  id: string;
  name: string;
  description: string;
  steps: JourneyStep[];
  user_personas: string[];
  success_criteria: string[];
  pain_points_addressed: string[];
}

interface JourneyStep {
  id: string;
  name: string;
  description: string;
  user_action: string;
  system_response: string;
  ui_components: string[];
  ai_interactions: string[];
  success_criteria: string[];
}

interface UserJourneyFlowProps {
  journeys: UserJourney[];
  loading: boolean;
}

export function UserJourneyFlow({ journeys, loading }: UserJourneyFlowProps) {
  const [selectedJourney, setSelectedJourney] = useState<string | null>(null);
  const [activeStep, setActiveStep] = useState<number>(0);

  const selectedJourneyData = journeys.find(j => j.id === selectedJourney);

  if (loading) {
    return (
      <Card className="bg-white/80 dark:bg-slate-800/80 backdrop-blur-sm border-0 shadow-lg">
        <CardContent className="flex items-center justify-center h-64">
          <RefreshCw className="h-8 w-8 animate-spin text-blue-600" />
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Journey Overview */}
      <Card className="bg-gradient-to-r from-purple-50 to-pink-50 dark:from-purple-950/20 dark:to-pink-950/20 border-purple-200 dark:border-purple-800">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="h-6 w-6 text-purple-600" />
            User Journey Optimization
          </CardTitle>
          <CardDescription>
            Seamless user experiences designed for maximum productivity and satisfaction
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="text-center">
              <div className="text-2xl font-bold text-purple-600">{journeys.length}</div>
              <div className="text-sm text-slate-600 dark:text-slate-400">Optimized Journeys</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-blue-600">
                {journeys.reduce((acc, journey) => acc + journey.steps.length, 0)}
              </div>
              <div className="text-sm text-slate-600 dark:text-slate-400">Total Steps</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-green-600">
                {journeys.reduce((acc, journey) => acc + journey.user_personas.length, 0)}
              </div>
              <div className="text-sm text-slate-600 dark:text-slate-400">User Personas</div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Journey Selection */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {journeys.map((journey) => (
          <motion.div
            key={journey.id}
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.3 }}
          >
            <Card 
              className={`cursor-pointer transition-all duration-200 hover:shadow-lg ${
                selectedJourney === journey.id 
                  ? 'ring-2 ring-blue-500 bg-blue-50 dark:bg-blue-950/20' 
                  : 'hover:bg-slate-50 dark:hover:bg-slate-800'
              }`}
              onClick={() => setSelectedJourney(journey.id)}
            >
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <Target className="h-5 w-5 text-blue-600" />
                  {journey.name}
                </CardTitle>
                <CardDescription>{journey.description}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <h4 className="font-medium text-sm mb-2">User Personas</h4>
                  <div className="flex flex-wrap gap-1">
                    {journey.user_personas.map((persona) => (
                      <Badge key={persona} variant="secondary" className="text-xs">
                        <Users className="h-3 w-3 mr-1" />
                        {persona}
                      </Badge>
                    ))}
                  </div>
                </div>

                <div>
                  <h4 className="font-medium text-sm mb-2">Pain Points Addressed</h4>
                  <ul className="space-y-1">
                    {journey.pain_points_addressed.slice(0, 2).map((point, index) => (
                      <li key={index} className="text-xs text-slate-600 dark:text-slate-400 flex items-start gap-1">
                        <CheckCircle className="h-3 w-3 text-green-600 mt-0.5 flex-shrink-0" />
                        {point}
                      </li>
                    ))}
                    {journey.pain_points_addressed.length > 2 && (
                      <li className="text-xs text-slate-500">
                        +{journey.pain_points_addressed.length - 2} more
                      </li>
                    )}
                  </ul>
                </div>

                <div className="flex items-center justify-between pt-2">
                  <span className="text-sm text-slate-600 dark:text-slate-400">
                    {journey.steps.length} steps
                  </span>
                  <Button size="sm" variant="outline">
                    <Eye className="h-4 w-4 mr-1" />
                    View Journey
                  </Button>
                </div>
              </CardContent>
            </Card>
          </motion.div>
        ))}
      </div>

      {/* Journey Detail Flow */}
      <AnimatePresence>
        {selectedJourney && selectedJourneyData && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            transition={{ duration: 0.5 }}
          >
            <Card className="bg-white/80 dark:bg-slate-800/80 backdrop-blur-sm border-0 shadow-lg">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="flex items-center gap-2">
                      <Target className="h-5 w-5 text-blue-600" />
                      {selectedJourneyData.name}
                    </CardTitle>
                    <CardDescription className="mt-1">
                      {selectedJourneyData.description}
                    </CardDescription>
                  </div>
                  <Button 
                    variant="outline" 
                    size="sm"
                    onClick={() => setSelectedJourney(null)}
                  >
                    Close
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-6">
                {/* Success Criteria */}
                <div>
                  <h4 className="font-medium mb-3 flex items-center gap-2">
                    <CheckCircle className="h-4 w-4 text-green-600" />
                    Success Criteria
                  </h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    {selectedJourneyData.success_criteria.map((criteria, index) => (
                      <div key={index} className="p-2 bg-green-50 dark:bg-green-950/20 border border-green-200 dark:border-green-800 rounded text-sm">
                        {criteria}
                      </div>
                    ))}
                  </div>
                </div>

                <Separator />

                {/* Journey Steps */}
                <div>
                  <h4 className="font-medium mb-4 flex items-center gap-2">
                    <Play className="h-4 w-4 text-blue-600" />
                    Journey Flow ({selectedJourneyData.steps.length} steps)
                  </h4>

                  {/* Step Navigation */}
                  <div className="flex items-center gap-2 mb-6 overflow-x-auto pb-2">
                    {selectedJourneyData.steps.map((step, index) => (
                      <div key={step.id} className="flex items-center gap-2">
                        <Button
                          variant={activeStep === index ? "default" : "outline"}
                          size="sm"
                          onClick={() => setActiveStep(index)}
                          className="whitespace-nowrap"
                        >
                          {index + 1}. {step.name}
                        </Button>
                        {index < selectedJourneyData.steps.length - 1 && (
                          <ArrowRight className="h-4 w-4 text-slate-400 flex-shrink-0" />
                        )}
                      </div>
                    ))}
                  </div>

                  {/* Active Step Detail */}
                  <AnimatePresence mode="wait">
                    <motion.div
                      key={activeStep}
                      initial={{ opacity: 0, x: 20 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: -20 }}
                      transition={{ duration: 0.3 }}
                    >
                      <Card className="bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-blue-950/20 dark:to-indigo-950/20 border-blue-200 dark:border-blue-800">
                        <CardHeader>
                          <CardTitle className="text-lg">
                            Step {activeStep + 1}: {selectedJourneyData.steps[activeStep].name}
                          </CardTitle>
                          <CardDescription>
                            {selectedJourneyData.steps[activeStep].description}
                          </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                            {/* User Action */}
                            <div>
                              <h5 className="font-medium mb-2 flex items-center gap-2">
                                <Users className="h-4 w-4 text-blue-600" />
                                User Action
                              </h5>
                              <div className="p-3 bg-white dark:bg-slate-800 rounded border">
                                {selectedJourneyData.steps[activeStep].user_action}
                              </div>
                            </div>

                            {/* System Response */}
                            <div>
                              <h5 className="font-medium mb-2 flex items-center gap-2">
                                <Brain className="h-4 w-4 text-purple-600" />
                                System Response
                              </h5>
                              <div className="p-3 bg-white dark:bg-slate-800 rounded border">
                                {selectedJourneyData.steps[activeStep].system_response}
                              </div>
                            </div>
                          </div>

                          {/* UI Components */}
                          {selectedJourneyData.steps[activeStep].ui_components.length > 0 && (
                            <div>
                              <h5 className="font-medium mb-2 flex items-center gap-2">
                                <Palette className="h-4 w-4 text-green-600" />
                                UI Components
                              </h5>
                              <div className="flex flex-wrap gap-2">
                                {selectedJourneyData.steps[activeStep].ui_components.map((component) => (
                                  <Badge key={component} variant="outline" className="bg-green-50 dark:bg-green-950/20 border-green-200 dark:border-green-800">
                                    {component}
                                  </Badge>
                                ))}
                              </div>
                            </div>
                          )}

                          {/* AI Interactions */}
                          {selectedJourneyData.steps[activeStep].ai_interactions.length > 0 && (
                            <div>
                              <h5 className="font-medium mb-2 flex items-center gap-2">
                                <Brain className="h-4 w-4 text-purple-600" />
                                AI Interactions
                              </h5>
                              <div className="flex flex-wrap gap-2">
                                {selectedJourneyData.steps[activeStep].ai_interactions.map((interaction) => (
                                  <Badge key={interaction} variant="outline" className="bg-purple-50 dark:bg-purple-950/20 border-purple-200 dark:border-purple-800">
                                    {interaction}
                                  </Badge>
                                ))}
                              </div>
                            </div>
                          )}

                          {/* Step Success Criteria */}
                          {selectedJourneyData.steps[activeStep].success_criteria.length > 0 && (
                            <div>
                              <h5 className="font-medium mb-2 flex items-center gap-2">
                                <Target className="h-4 w-4 text-orange-600" />
                                Step Success Criteria
                              </h5>
                              <ul className="space-y-1">
                                {selectedJourneyData.steps[activeStep].success_criteria.map((criteria, index) => (
                                  <li key={index} className="flex items-start gap-2 text-sm">
                                    <CheckCircle className="h-4 w-4 text-green-600 mt-0.5 flex-shrink-0" />
                                    {criteria}
                                  </li>
                                ))}
                              </ul>
                            </div>
                          )}
                        </CardContent>
                      </Card>
                    </motion.div>
                  </AnimatePresence>

                  {/* Navigation */}
                  <div className="flex justify-between pt-4">
                    <Button
                      variant="outline"
                      onClick={() => setActiveStep(Math.max(0, activeStep - 1))}
                      disabled={activeStep === 0}
                    >
                      Previous Step
                    </Button>
                    <Button
                      onClick={() => setActiveStep(Math.min(selectedJourneyData.steps.length - 1, activeStep + 1))}
                      disabled={activeStep === selectedJourneyData.steps.length - 1}
                    >
                      Next Step
                      <ArrowRight className="h-4 w-4 ml-2" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}