// Phase 2 - AI Design Generation Enhancement
// Principal Engineer & Release Captain Implementation
// Integrates with existing Jurexio Orchestration for real AI-powered design

import React, { useState, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { 
  Sparkles, 
  Wand2, 
  Eye, 
  Download, 
  Copy, 
  RefreshCw,
  Palette,
  Layout,
  Type,
  Image as ImageIcon,
  Zap
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { apiRequest } from '@/lib/queryClient';

interface DesignPrompt {
  description: string;
  style: string;
  platform: string;
  components: string[];
  brandColors?: string[];
  inspiration?: string;
}

interface GeneratedDesign {
  id: string;
  prompt: DesignPrompt;
  variations: Array<{
    id: string;
    preview: string;
    code: string;
    assets: string[];
    score: number;
    tags: string[];
  }>;
  status: 'generating' | 'complete' | 'error';
  timestamp: string;
}

interface AIDesignGeneratorProps {
  onDesignGenerated?: (design: GeneratedDesign) => void;
  className?: string;
}

export const AIDesignGenerator: React.FC<AIDesignGeneratorProps> = ({
  onDesignGenerated,
  className
}) => {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  
  const [prompt, setPrompt] = useState<DesignPrompt>({
    description: '',
    style: 'modern',
    platform: 'web',
    components: [],
    brandColors: [],
    inspiration: ''
  });

  const [selectedTemplate, setSelectedTemplate] = useState<string | null>(null);
  const [generationProgress, setGenerationProgress] = useState(0);

  // Fetch available design templates and inspiration
  const { data: templatesData } = useQuery({
    queryKey: ['/api/sketchflow-design/templates'],
    select: (data) => data?.templates || []
  });

  const { data: inspirationData } = useQuery({
    queryKey: ['/api/ai/design-inspiration'],
    select: (data) => data?.inspiration || []
  });

  // AI Design Generation Mutation
  const generateDesignMutation = useMutation({
    mutationFn: async (designPrompt: DesignPrompt) => {
      // Progress simulation for better UX
      setGenerationProgress(0);
      const progressInterval = setInterval(() => {
        setGenerationProgress(prev => Math.min(prev + 10, 90));
      }, 500);

      try {
        const response = await apiRequest('/api/ai/design-generation', {
          method: 'POST',
          body: JSON.stringify({
            ...designPrompt,
            // Enhanced prompt engineering for better results
            enhancedPrompt: `Generate a ${designPrompt.style} ${designPrompt.platform} design for: ${designPrompt.description}. 
            Include components: ${designPrompt.components.join(', ')}. 
            Brand colors: ${designPrompt.brandColors?.join(', ') || 'modern palette'}. 
            Inspiration: ${designPrompt.inspiration || 'contemporary design trends'}.
            Output high-quality code with responsive design and accessibility.`,
            provider: 'openai-dall-e-3', // Use real OpenAI DALL-E for image generation
            codeProvider: 'anthropic-claude-4', // Use Claude for code generation
            qualityLevel: 'high',
            variations: 3
          })
        });

        clearInterval(progressInterval);
        setGenerationProgress(100);
        
        return response;
      } catch (error) {
        clearInterval(progressInterval);
        setGenerationProgress(0);
        throw error;
      }
    },
    onSuccess: (data) => {
      toast({
        title: 'Design Generated!',
        description: `Generated ${data.variations?.length || 1} design variations`
      });
      onDesignGenerated?.(data);
      queryClient.invalidateQueries({ queryKey: ['/api/user/generated-designs'] });
    },
    onError: (error: any) => {
      toast({
        title: 'Generation Failed',
        description: error.message || 'Please try again with a different prompt',
        variant: 'destructive'
      });
      setGenerationProgress(0);
    }
  });

  // Smart Component Suggestions
  const { data: componentSuggestions } = useQuery({
    queryKey: ['/api/ai/component-suggestions', prompt.description],
    enabled: prompt.description.length > 10,
    queryFn: async () => {
      return await apiRequest('/api/ai/component-suggestions', {
        method: 'POST',
        body: JSON.stringify({
          description: prompt.description,
          platform: prompt.platform
        })
      });
    }
  });

  // Brand Color Analysis
  const analyzeBrandColorsMutation = useMutation({
    mutationFn: async (inspiration: string) => {
      return await apiRequest('/api/ai/brand-colors', {
        method: 'POST',
        body: JSON.stringify({
          inspiration,
          analysisType: 'comprehensive'
        })
      });
    },
    onSuccess: (data) => {
      if (data.colors) {
        setPrompt(prev => ({
          ...prev,
          brandColors: data.colors
        }));
        toast({
          title: 'Brand Colors Analyzed',
          description: `Found ${data.colors.length} colors from inspiration`
        });
      }
    }
  });

  const handleGenerateDesign = useCallback(() => {
    if (!prompt.description.trim()) {
      toast({
        title: 'Description Required',
        description: 'Please describe what you want to create',
        variant: 'destructive'
      });
      return;
    }

    generateDesignMutation.mutate(prompt);
  }, [prompt, generateDesignMutation]);

  const handleComponentToggle = (component: string) => {
    setPrompt(prev => ({
      ...prev,
      components: prev.components.includes(component)
        ? prev.components.filter(c => c !== component)
        : [...prev.components, component]
    }));
  };

  const handleAnalyzeInspiration = () => {
    if (prompt.inspiration) {
      analyzeBrandColorsMutation.mutate(prompt.inspiration);
    }
  };

  const commonComponents = [
    'Header/Navigation', 'Hero Section', 'Feature Cards', 'Testimonials', 
    'Footer', 'Contact Form', 'Image Gallery', 'Pricing Table', 
    'Dashboard Widgets', 'Data Visualization', 'User Profile', 'Search Interface'
  ];

  const designStyles = [
    { value: 'modern', label: '✨ Modern', description: 'Clean lines, gradients, shadows' },
    { value: 'minimal', label: '⚪ Minimal', description: 'Simple, focused, lots of whitespace' },
    { value: 'bold', label: '🔥 Bold', description: 'Strong colors, high contrast' },
    { value: 'elegant', label: '👑 Elegant', description: 'Sophisticated, premium feel' },
    { value: 'playful', label: '🎨 Playful', description: 'Fun, colorful, creative' },
    { value: 'corporate', label: '🏢 Corporate', description: 'Professional, trustworthy' }
  ];

  return (
    <div className={className}>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Wand2 className="h-5 w-5" />
            AI Design Generator
          </CardTitle>
          <CardDescription>
            Describe your vision and our AI will create complete designs with code
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Description Input */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Design Description</label>
            <Textarea
              placeholder="e.g., 'A modern SaaS landing page for a project management tool with hero section, features, and pricing'"
              value={prompt.description}
              onChange={(e) => setPrompt(prev => ({ ...prev, description: e.target.value }))}
              rows={3}
              className="min-h-20"
            />
            <p className="text-xs text-muted-foreground">
              Be specific about functionality, target audience, and key features
            </p>
          </div>

          {/* Style and Platform Selection */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Design Style</label>
              <Select 
                value={prompt.style} 
                onValueChange={(value) => setPrompt(prev => ({ ...prev, style: value }))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {designStyles.map(style => (
                    <SelectItem key={style.value} value={style.value}>
                      <div>
                        <div>{style.label}</div>
                        <div className="text-xs text-muted-foreground">{style.description}</div>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Target Platform</label>
              <Select 
                value={prompt.platform} 
                onValueChange={(value) => setPrompt(prev => ({ ...prev, platform: value }))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="web">🌐 Web Application</SelectItem>
                  <SelectItem value="mobile">📱 Mobile App</SelectItem>
                  <SelectItem value="tablet">📲 Tablet Interface</SelectItem>
                  <SelectItem value="desktop">💻 Desktop Software</SelectItem>
                  <SelectItem value="responsive">📐 Responsive Website</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Component Suggestions */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Components to Include</label>
            <div className="flex flex-wrap gap-2">
              {commonComponents.map(component => (
                <Badge
                  key={component}
                  variant={prompt.components.includes(component) ? 'default' : 'outline'}
                  className="cursor-pointer"
                  onClick={() => handleComponentToggle(component)}
                >
                  {component}
                </Badge>
              ))}
            </div>
            {componentSuggestions?.suggestions && (
              <div className="mt-2">
                <p className="text-xs text-muted-foreground mb-2">AI Suggestions:</p>
                <div className="flex flex-wrap gap-2">
                  {componentSuggestions.suggestions.map((suggestion: string, index: number) => (
                    <Badge
                      key={index}
                      variant="secondary"
                      className="cursor-pointer"
                      onClick={() => handleComponentToggle(suggestion)}
                    >
                      <Sparkles className="w-3 h-3 mr-1" />
                      {suggestion}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Brand Colors & Inspiration */}
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Brand Inspiration (Optional)</label>
              <div className="flex gap-2">
                <Textarea
                  placeholder="Reference websites, brands, or describe your brand personality"
                  value={prompt.inspiration || ''}
                  onChange={(e) => setPrompt(prev => ({ ...prev, inspiration: e.target.value }))}
                  rows={2}
                  className="flex-1"
                />
                <Button
                  variant="outline"
                  onClick={handleAnalyzeInspiration}
                  disabled={!prompt.inspiration || analyzeBrandColorsMutation.isPending}
                >
                  <Palette className="w-4 h-4" />
                </Button>
              </div>
            </div>

            {prompt.brandColors && prompt.brandColors.length > 0 && (
              <div className="space-y-2">
                <label className="text-sm font-medium">Brand Colors</label>
                <div className="flex gap-2 flex-wrap">
                  {prompt.brandColors.map((color, index) => (
                    <div
                      key={index}
                      className="flex items-center gap-2 bg-gray-50 dark:bg-gray-800 px-3 py-1 rounded"
                    >
                      <div
                        className="w-4 h-4 rounded border"
                        style={{ backgroundColor: color }}
                      />
                      <span className="text-sm font-mono">{color}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Generation Progress */}
          {generateDesignMutation.isPending && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">Generating Design...</span>
                <span className="text-sm text-muted-foreground">{generationProgress}%</span>
              </div>
              <Progress value={generationProgress} className="h-2" />
              <p className="text-xs text-muted-foreground">
                AI is creating your design with real components and styling
              </p>
            </div>
          )}

          {/* Generate Button */}
          <Button
            onClick={handleGenerateDesign}
            disabled={generateDesignMutation.isPending || !prompt.description.trim()}
            className="w-full"
            size="lg"
          >
            {generateDesignMutation.isPending ? (
              <>
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                Generating with AI...
              </>
            ) : (
              <>
                <Zap className="mr-2 h-4 w-4" />
                Generate AI Design
              </>
            )}
          </Button>

          {/* Generation Result */}
          {generateDesignMutation.data && (
            <Alert>
              <Sparkles className="h-4 w-4" />
              <AlertDescription>
                <div className="space-y-2">
                  <p className="font-medium">Design generated successfully!</p>
                  <p className="text-sm">
                    Created {generateDesignMutation.data.variations?.length || 1} variations 
                    with complete code and assets.
                  </p>
                  <div className="flex gap-2 mt-3">
                    <Button size="sm" variant="outline">
                      <Eye className="w-4 h-4 mr-2" />
                      Preview
                    </Button>
                    <Button size="sm" variant="outline">
                      <Download className="w-4 h-4 mr-2" />
                      Export Code
                    </Button>
                    <Button size="sm" variant="outline">
                      <Copy className="w-4 h-4 mr-2" />
                      Copy to Canvas
                    </Button>
                  </div>
                </div>
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default AIDesignGenerator;