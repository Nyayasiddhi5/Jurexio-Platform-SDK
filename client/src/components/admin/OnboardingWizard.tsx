import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { Progress } from '@/components/ui/progress';
import { useToast } from '@/hooks/use-toast';
import {
  Building2, Users, Bot, Settings, Zap, CheckCircle, ChevronRight,
  ChevronLeft, Rocket, Shield, Globe, Briefcase, ArrowRight
} from 'lucide-react';

interface OnboardingStep {
  id: string;
  title: string;
  description: string;
  icon: any;
}

const steps: OnboardingStep[] = [
  { id: 'organization', title: 'Organization Profile', description: 'Set up your organization details', icon: Building2 },
  { id: 'llm-providers', title: 'LLM Configuration', description: 'Select and configure AI providers', icon: Zap },
  { id: 'teams', title: 'Team Selection', description: 'Choose starter team templates', icon: Users },
  { id: 'features', title: 'Feature Setup', description: 'Enable platform features', icon: Settings },
  { id: 'review', title: 'Review & Launch', description: 'Review configuration and go live', icon: Rocket },
];

const starterTeams = [
  { id: 'development', name: 'Development Team', agents: 6, recommended: true },
  { id: 'finance', name: 'Finance Team', agents: 5, recommended: true },
  { id: 'marketing', name: 'Marketing Team', agents: 5, recommended: false },
  { id: 'hr', name: 'HR Team', agents: 5, recommended: false },
  { id: 'sales', name: 'Sales Team', agents: 5, recommended: false },
  { id: 'research', name: 'Research Team', agents: 5, recommended: false },
];

const llmProviders = [
  { id: 'openai', name: 'OpenAI', models: ['GPT-4', 'GPT-4 Turbo', 'GPT-3.5'], recommended: true },
  { id: 'anthropic', name: 'Anthropic', models: ['Claude 3 Opus', 'Claude 3 Sonnet', 'Claude 3 Haiku'], recommended: true },
  { id: 'google', name: 'Google AI', models: ['Gemini Pro', 'Gemini Ultra'], recommended: false },
  { id: 'groq', name: 'Groq', models: ['LLaMA 3', 'Mixtral'], recommended: false },
];

export default function OnboardingWizard() {
  const { toast } = useToast();
  const [currentStep, setCurrentStep] = useState(0);
  const [formData, setFormData] = useState({
    orgName: '',
    industry: '',
    size: '',
    country: '',
    description: '',
    selectedProviders: ['openai', 'anthropic'] as string[],
    defaultProvider: 'openai',
    selectedTeams: ['development', 'finance'] as string[],
    features: {
      hitlWorkflows: true,
      autonomousMode: false,
      digitalTwins: true,
      analytics: true,
      customAgents: false,
    }
  });

  const progress = ((currentStep + 1) / steps.length) * 100;

  const handleNext = () => {
    if (currentStep < steps.length - 1) {
      setCurrentStep(currentStep + 1);
    }
  };

  const handlePrevious = () => {
    if (currentStep > 0) {
      setCurrentStep(currentStep - 1);
    }
  };

  const handleComplete = () => {
    toast({
      title: 'Onboarding Complete!',
      description: 'Your organization is now set up and ready to use.'
    });
  };

  const toggleProvider = (providerId: string) => {
    setFormData(prev => ({
      ...prev,
      selectedProviders: prev.selectedProviders.includes(providerId)
        ? prev.selectedProviders.filter(p => p !== providerId)
        : [...prev.selectedProviders, providerId]
    }));
  };

  const toggleTeam = (teamId: string) => {
    setFormData(prev => ({
      ...prev,
      selectedTeams: prev.selectedTeams.includes(teamId)
        ? prev.selectedTeams.filter(t => t !== teamId)
        : [...prev.selectedTeams, teamId]
    }));
  };

  const renderStepContent = () => {
    switch (steps[currentStep].id) {
      case 'organization':
        return (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="org-name">Organization Name *</Label>
                <Input
                  id="org-name"
                  value={formData.orgName}
                  onChange={(e) => setFormData({ ...formData, orgName: e.target.value })}
                  placeholder="Enter organization name"
                  data-testid="input-onboard-org-name"
                />
              </div>
              <div>
                <Label htmlFor="industry">Industry *</Label>
                <Select value={formData.industry} onValueChange={(v) => setFormData({ ...formData, industry: v })}>
                  <SelectTrigger data-testid="select-onboard-industry">
                    <SelectValue placeholder="Select industry" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="technology" data-testid="option-onboard-tech">Technology</SelectItem>
                    <SelectItem value="finance" data-testid="option-onboard-finance">Finance</SelectItem>
                    <SelectItem value="healthcare" data-testid="option-onboard-healthcare">Healthcare</SelectItem>
                    <SelectItem value="retail" data-testid="option-onboard-retail">Retail</SelectItem>
                    <SelectItem value="manufacturing" data-testid="option-onboard-manufacturing">Manufacturing</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="size">Organization Size</Label>
                <Select value={formData.size} onValueChange={(v) => setFormData({ ...formData, size: v })}>
                  <SelectTrigger data-testid="select-onboard-size">
                    <SelectValue placeholder="Select size" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="small" data-testid="option-onboard-small">Small (1-50)</SelectItem>
                    <SelectItem value="medium" data-testid="option-onboard-medium">Medium (51-500)</SelectItem>
                    <SelectItem value="large" data-testid="option-onboard-large">Large (500+)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="country">Country</Label>
                <Select value={formData.country} onValueChange={(v) => setFormData({ ...formData, country: v })}>
                  <SelectTrigger data-testid="select-onboard-country">
                    <SelectValue placeholder="Select country" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="us" data-testid="option-onboard-us">United States</SelectItem>
                    <SelectItem value="uk" data-testid="option-onboard-uk">United Kingdom</SelectItem>
                    <SelectItem value="de" data-testid="option-onboard-de">Germany</SelectItem>
                    <SelectItem value="in" data-testid="option-onboard-in">India</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label htmlFor="description">Description</Label>
              <Textarea
                id="description"
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                placeholder="Brief description of your organization..."
                data-testid="textarea-onboard-description"
              />
            </div>
          </div>
        );

      case 'llm-providers':
        return (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">Select the AI providers you want to use. You can configure API keys later in Settings.</p>
            <div className="grid grid-cols-2 gap-4">
              {llmProviders.map(provider => (
                <Card
                  key={provider.id}
                  className={`cursor-pointer transition-all ${
                    formData.selectedProviders.includes(provider.id)
                      ? 'border-primary ring-2 ring-primary/20'
                      : 'hover:border-primary/50'
                  }`}
                  onClick={() => toggleProvider(provider.id)}
                  data-testid={`card-provider-${provider.id}`}
                >
                  <CardContent className="pt-4">
                    <div className="flex items-center justify-between mb-2">
                      <span className="font-medium">{provider.name}</span>
                      <div className="flex items-center gap-2">
                        {provider.recommended && <Badge variant="secondary">Recommended</Badge>}
                        {formData.selectedProviders.includes(provider.id) && (
                          <CheckCircle className="w-5 h-5 text-primary" />
                        )}
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Models: {provider.models.join(', ')}
                    </p>
                  </CardContent>
                </Card>
              ))}
            </div>
            <div>
              <Label>Default Provider</Label>
              <Select value={formData.defaultProvider} onValueChange={(v) => setFormData({ ...formData, defaultProvider: v })}>
                <SelectTrigger data-testid="select-default-provider">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {formData.selectedProviders.map(p => (
                    <SelectItem key={p} value={p} data-testid={`option-default-${p}`}>
                      {llmProviders.find(lp => lp.id === p)?.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        );

      case 'teams':
        return (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">Select the agent teams to deploy to your organization. You can add more teams later.</p>
            <div className="grid grid-cols-2 gap-4">
              {starterTeams.map(team => (
                <Card
                  key={team.id}
                  className={`cursor-pointer transition-all ${
                    formData.selectedTeams.includes(team.id)
                      ? 'border-primary ring-2 ring-primary/20'
                      : 'hover:border-primary/50'
                  }`}
                  onClick={() => toggleTeam(team.id)}
                  data-testid={`card-team-${team.id}`}
                >
                  <CardContent className="pt-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Briefcase className="w-5 h-5 text-muted-foreground" />
                        <span className="font-medium">{team.name}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        {team.recommended && <Badge variant="secondary">Recommended</Badge>}
                        {formData.selectedTeams.includes(team.id) && (
                          <CheckCircle className="w-5 h-5 text-primary" />
                        )}
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground mt-2">
                      {team.agents} agents included
                    </p>
                  </CardContent>
                </Card>
              ))}
            </div>
            <div className="p-3 bg-muted rounded-lg">
              <p className="text-sm font-medium">Selected: {formData.selectedTeams.length} teams</p>
              <p className="text-xs text-muted-foreground">
                Total agents: {formData.selectedTeams.reduce((sum, id) => sum + (starterTeams.find(t => t.id === id)?.agents || 0), 0)}
              </p>
            </div>
          </div>
        );

      case 'features':
        return (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">Configure which platform features to enable for your organization.</p>
            <div className="space-y-3">
              {[
                { key: 'hitlWorkflows', label: 'Human-in-the-Loop Workflows', desc: 'Require human approval for critical decisions' },
                { key: 'autonomousMode', label: 'Autonomous Agent Mode', desc: 'Allow agents to operate independently' },
                { key: 'digitalTwins', label: 'Digital Twin System', desc: 'Create digital representations of processes' },
                { key: 'analytics', label: 'Advanced Analytics', desc: 'Access detailed performance analytics' },
                { key: 'customAgents', label: 'Custom Agent Creation', desc: 'Create custom specialized agents' },
              ].map(feature => (
                <div key={feature.key} className="flex items-center justify-between p-3 bg-muted rounded-lg" data-testid={`row-feature-${feature.key}`}>
                  <div className="flex items-center gap-3">
                    <Checkbox
                      id={feature.key}
                      checked={formData.features[feature.key as keyof typeof formData.features]}
                      onCheckedChange={(checked) => setFormData({
                        ...formData,
                        features: { ...formData.features, [feature.key]: checked }
                      })}
                      data-testid={`checkbox-feature-${feature.key}`}
                    />
                    <div>
                      <Label htmlFor={feature.key} className="cursor-pointer">{feature.label}</Label>
                      <p className="text-xs text-muted-foreground">{feature.desc}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        );

      case 'review':
        return (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Building2 className="w-4 h-4" />
                    Organization
                  </CardTitle>
                </CardHeader>
                <CardContent className="text-sm">
                  <p className="font-medium">{formData.orgName || 'Not set'}</p>
                  <p className="text-muted-foreground">{formData.industry || 'Industry not selected'}</p>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Zap className="w-4 h-4" />
                    LLM Providers
                  </CardTitle>
                </CardHeader>
                <CardContent className="text-sm">
                  <p className="font-medium">{formData.selectedProviders.length} providers selected</p>
                  <p className="text-muted-foreground">Default: {formData.defaultProvider}</p>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Users className="w-4 h-4" />
                    Teams
                  </CardTitle>
                </CardHeader>
                <CardContent className="text-sm">
                  <p className="font-medium">{formData.selectedTeams.length} teams selected</p>
                  <p className="text-muted-foreground">
                    {formData.selectedTeams.reduce((sum, id) => sum + (starterTeams.find(t => t.id === id)?.agents || 0), 0)} total agents
                  </p>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Settings className="w-4 h-4" />
                    Features
                  </CardTitle>
                </CardHeader>
                <CardContent className="text-sm">
                  <p className="font-medium">
                    {Object.values(formData.features).filter(Boolean).length} features enabled
                  </p>
                  <p className="text-muted-foreground">Ready to configure</p>
                </CardContent>
              </Card>
            </div>
            <div className="p-4 bg-green-50 border border-green-200 rounded-lg">
              <div className="flex items-center gap-2">
                <CheckCircle className="w-5 h-5 text-green-600" />
                <span className="font-medium text-green-800">Ready to Launch</span>
              </div>
              <p className="text-sm text-green-700 mt-1">
                Your organization configuration is complete. Click "Complete Setup" to go live.
              </p>
            </div>
          </div>
        );
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6" data-testid="onboarding-wizard">
      <div className="text-center">
        <h1 className="text-3xl font-bold" data-testid="text-onboard-title">Welcome to Jurexio Legal SDK</h1>
        <p className="text-muted-foreground mt-2">Let's set up your organization in a few simple steps</p>
      </div>

      <div className="flex items-center justify-between mb-8">
        {steps.map((step, index) => (
          <div key={step.id} className="flex items-center">
            <div className={`flex items-center gap-2 ${index <= currentStep ? 'text-primary' : 'text-muted-foreground'}`}>
              <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
                index < currentStep ? 'bg-primary text-white' :
                index === currentStep ? 'bg-primary/20 text-primary border-2 border-primary' :
                'bg-muted'
              }`} data-testid={`step-indicator-${step.id}`}>
                {index < currentStep ? <CheckCircle className="w-5 h-5" /> : <step.icon className="w-5 h-5" />}
              </div>
              <div className="hidden md:block">
                <p className="text-sm font-medium">{step.title}</p>
                <p className="text-xs text-muted-foreground">{step.description}</p>
              </div>
            </div>
            {index < steps.length - 1 && (
              <ChevronRight className="w-5 h-5 mx-4 text-muted-foreground" />
            )}
          </div>
        ))}
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>{steps[currentStep].title}</CardTitle>
              <CardDescription>{steps[currentStep].description}</CardDescription>
            </div>
            <Badge variant="outline">Step {currentStep + 1} of {steps.length}</Badge>
          </div>
          <Progress value={progress} className="h-2" />
        </CardHeader>
        <CardContent>
          {renderStepContent()}
        </CardContent>
        <CardFooter className="flex justify-between">
          <Button
            variant="outline"
            onClick={handlePrevious}
            disabled={currentStep === 0}
            data-testid="button-previous-step"
          >
            <ChevronLeft className="w-4 h-4 mr-2" />
            Previous
          </Button>
          {currentStep === steps.length - 1 ? (
            <Button onClick={handleComplete} data-testid="button-complete-setup">
              Complete Setup
              <Rocket className="w-4 h-4 ml-2" />
            </Button>
          ) : (
            <Button onClick={handleNext} data-testid="button-next-step">
              Next Step
              <ChevronRight className="w-4 h-4 ml-2" />
            </Button>
          )}
        </CardFooter>
      </Card>
    </div>
  );
}
