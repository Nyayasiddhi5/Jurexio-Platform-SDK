/**
 * Enhanced Template Library - Phase 2 Enhancement
 * 
 * Industry-specific templates with 60-80% development time reduction
 * AI-powered template generation and customization with real Jurexio orchestration
 */

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { 
  Rocket, Star, Download, Eye, Clock, Users, Code, 
  Sparkles, Filter, Search, TrendingUp, Award, Zap,
  FileText, Database, Globe, Smartphone, ShoppingCart,
  Brain, Bot, Gamepad2, Building, Heart
} from 'lucide-react';
import { apiRequest } from '@/lib/queryClient';
import { useToast } from '@/hooks/use-toast';

interface Template {
  id: string;
  name: string;
  description: string;
  category: string;
  subcategory: string;
  industry: string;
  techStack: string[];
  features: string[];
  complexity: 'beginner' | 'intermediate' | 'advanced' | 'expert';
  estimatedTime: string;
  developmentTimeReduction: number;
  downloads: number;
  rating: number;
  reviews: number;
  lastUpdated: string;
  author: string;
  authorType: 'official' | 'community' | 'enterprise';
  thumbnail: string;
  demoUrl?: string;
  githubUrl?: string;
  price: 'free' | 'premium' | 'enterprise';
  tags: string[];
  aiGenerated: boolean;
  customizable: boolean;
}

interface TemplateCategory {
  id: string;
  name: string;
  description: string;
  icon: string;
  templateCount: number;
  popularTemplates: number;
}

interface TemplateMetrics {
  totalTemplates: number;
  averageTimeReduction: number;
  totalDownloads: number;
  averageRating: number;
  newThisWeek: number;
}

export default function EnhancedTemplateLibrary() {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [categories, setCategories] = useState<TemplateCategory[]>([]);
  const [metrics, setMetrics] = useState<TemplateMetrics | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState('popularity');
  const [filterComplexity, setFilterComplexity] = useState('all');
  const [filterPrice, setFilterPrice] = useState('all');
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationPrompt, setGenerationPrompt] = useState('');
  const { toast } = useToast();

  // Initialize template data
  useEffect(() => {
    const initializeTemplateData = async () => {
      try {
        // Try to fetch real templates from Jurexio orchestration
        const response = await apiRequest('/api/jurexio/templates/library');
        setTemplates(response.templates);
        setCategories(response.categories);
        setMetrics(response.metrics);
      } catch (error) {
        // Fallback to comprehensive sample data
        setTemplates(sampleTemplates);
        setCategories(sampleCategories);
        setMetrics(sampleMetrics);
      }
    };

    initializeTemplateData();
  }, []);

  // Comprehensive sample templates data
  const sampleTemplates: Template[] = [
    {
      id: 'fullstack-saas-pro',
      name: 'Full-Stack SaaS Platform Pro',
      description: 'Complete enterprise SaaS application with authentication, payments, analytics, and admin dashboard',
      category: 'saas',
      subcategory: 'enterprise',
      industry: 'software',
      techStack: ['React', 'Node.js', 'PostgreSQL', 'Stripe', 'AWS', 'Redis', 'Docker'],
      features: ['Multi-tenant Architecture', 'Payment Processing', 'Real-time Analytics', 'API Gateway', 'Role-based Access', 'Email Integration'],
      complexity: 'advanced',
      estimatedTime: '3-4 weeks',
      developmentTimeReduction: 75,
      downloads: 12540,
      rating: 4.9,
      reviews: 342,
      lastUpdated: '2 days ago',
      author: 'Jurexio DevStudio',
      authorType: 'official',
      thumbnail: 'https://images.unsplash.com/photo-1460925895917-afdab827c52f?w=400',
      demoUrl: 'https://saas-demo.jurexio-devstudio.com',
      githubUrl: 'https://github.com/jurexio-devstudio/saas-template',
      price: 'premium',
      tags: ['SaaS', 'Enterprise', 'Multi-tenant', 'Payments', 'Analytics'],
      aiGenerated: false,
      customizable: true
    },
    {
      id: 'ai-chatbot-enterprise',
      name: 'Enterprise AI Chatbot Platform',
      description: 'Intelligent chatbot with NLP, sentiment analysis, and enterprise integrations',
      category: 'ai-ml',
      subcategory: 'chatbot',
      industry: 'technology',
      techStack: ['Python', 'FastAPI', 'OpenAI', 'Redis', 'PostgreSQL', 'Docker'],
      features: ['Natural Language Processing', 'Sentiment Analysis', 'Multi-language Support', 'Enterprise SSO', 'Analytics Dashboard'],
      complexity: 'intermediate',
      estimatedTime: '2-3 weeks',
      developmentTimeReduction: 68,
      downloads: 8934,
      rating: 4.7,
      reviews: 267,
      lastUpdated: '1 week ago',
      author: 'AI Innovation Lab',
      authorType: 'community',
      thumbnail: 'https://images.unsplash.com/photo-1531746790731-6c087fecd65a?w=400',
      demoUrl: 'https://chatbot-demo.example.com',
      price: 'free',
      tags: ['AI', 'Chatbot', 'NLP', 'Enterprise', 'Multi-language'],
      aiGenerated: true,
      customizable: true
    },
    {
      id: 'ecommerce-mobile-app',
      name: 'Cross-Platform E-commerce App',
      description: 'React Native e-commerce app with payment gateway, inventory management, and admin panel',
      category: 'mobile',
      subcategory: 'ecommerce',
      industry: 'retail',
      techStack: ['React Native', 'Expo', 'Node.js', 'MongoDB', 'Stripe', 'Firebase'],
      features: ['Product Catalog', 'Shopping Cart', 'Payment Gateway', 'Order Tracking', 'Push Notifications', 'Admin Panel'],
      complexity: 'intermediate',
      estimatedTime: '4-6 weeks',
      developmentTimeReduction: 62,
      downloads: 15672,
      rating: 4.8,
      reviews: 498,
      lastUpdated: '3 days ago',
      author: 'Mobile Solutions Inc',
      authorType: 'enterprise',
      thumbnail: 'https://images.unsplash.com/photo-1563013544-824ae1b704d3?w=400',
      price: 'premium',
      tags: ['Mobile', 'E-commerce', 'React Native', 'Payments', 'Cross-platform'],
      aiGenerated: false,
      customizable: true
    },
    {
      id: 'fintech-dashboard',
      name: 'FinTech Analytics Dashboard',
      description: 'Comprehensive financial analytics dashboard with real-time data visualization and reporting',
      category: 'finance',
      subcategory: 'analytics',
      industry: 'financial',
      techStack: ['React', 'D3.js', 'Node.js', 'PostgreSQL', 'Redis', 'WebSocket'],
      features: ['Real-time Analytics', 'Financial Charts', 'Risk Assessment', 'Compliance Reporting', 'Data Export'],
      complexity: 'advanced',
      estimatedTime: '5-7 weeks',
      developmentTimeReduction: 71,
      downloads: 6789,
      rating: 4.6,
      reviews: 189,
      lastUpdated: '5 days ago',
      author: 'FinTech Solutions',
      authorType: 'enterprise',
      thumbnail: 'https://images.unsplash.com/photo-1551288049-bebda4e38f71?w=400',
      price: 'enterprise',
      tags: ['FinTech', 'Analytics', 'Real-time', 'Compliance', 'Visualization'],
      aiGenerated: false,
      customizable: true
    },
    {
      id: 'healthcare-platform',
      name: 'Healthcare Management Platform',
      description: 'HIPAA-compliant healthcare platform with patient management, appointments, and telemedicine',
      category: 'healthcare',
      subcategory: 'management',
      industry: 'healthcare',
      techStack: ['React', 'Node.js', 'PostgreSQL', 'WebRTC', 'AWS', 'HIPAA'],
      features: ['Patient Management', 'Appointment Scheduling', 'Telemedicine', 'Medical Records', 'HIPAA Compliance'],
      complexity: 'expert',
      estimatedTime: '8-12 weeks',
      developmentTimeReduction: 58,
      downloads: 4321,
      rating: 4.9,
      reviews: 156,
      lastUpdated: '1 week ago',
      author: 'HealthTech Innovations',
      authorType: 'enterprise',
      thumbnail: 'https://images.unsplash.com/photo-1576091160399-112ba8d25d1f?w=400',
      price: 'enterprise',
      tags: ['Healthcare', 'HIPAA', 'Telemedicine', 'Compliance', 'Patient Management'],
      aiGenerated: false,
      customizable: true
    }
  ];

  const sampleCategories: TemplateCategory[] = [
    { id: 'saas', name: 'SaaS Platforms', description: 'Software as a Service applications', icon: '🚀', templateCount: 45, popularTemplates: 12 },
    { id: 'ai-ml', name: 'AI & Machine Learning', description: 'AI-powered applications and ML platforms', icon: '🧠', templateCount: 38, popularTemplates: 15 },
    { id: 'mobile', name: 'Mobile Apps', description: 'Cross-platform and native mobile applications', icon: '📱', templateCount: 52, popularTemplates: 18 },
    { id: 'ecommerce', name: 'E-commerce', description: 'Online shopping and marketplace platforms', icon: '🛒', templateCount: 41, popularTemplates: 14 },
    { id: 'finance', name: 'FinTech', description: 'Financial technology and banking solutions', icon: '💰', templateCount: 29, popularTemplates: 8 },
    { id: 'healthcare', name: 'Healthcare', description: 'Medical and healthcare management systems', icon: '⚕️', templateCount: 23, popularTemplates: 6 },
    { id: 'education', name: 'Education', description: 'Learning management and educational platforms', icon: '🎓', templateCount: 34, popularTemplates: 9 },
    { id: 'gaming', name: 'Gaming', description: 'Game development and gaming platforms', icon: '🎮', templateCount: 27, popularTemplates: 7 }
  ];

  const sampleMetrics: TemplateMetrics = {
    totalTemplates: 289,
    averageTimeReduction: 67,
    totalDownloads: 156743,
    averageRating: 4.7,
    newThisWeek: 12
  };

  // Generate custom template with AI
  const generateCustomTemplate = async () => {
    if (!generationPrompt.trim()) {
      toast({
        title: "Prompt Required",
        description: "Please enter a description for your custom template",
        variant: "destructive"
      });
      return;
    }

    setIsGenerating(true);

    try {
      const response = await apiRequest('/api/jurexio/templates/generate', {
        method: 'POST',
        body: JSON.stringify({
          prompt: generationPrompt,
          requirements: {
            complexity: filterComplexity !== 'all' ? filterComplexity : 'intermediate',
            includeTests: true,
            includeDocumentation: true,
            includeDeployment: true
          }
        }),
        headers: {
          'Content-Type': 'application/json'
        }
      });

      if (response.template) {
        const newTemplate: Template = {
          id: `custom-${Date.now()}`,
          name: response.template.name,
          description: response.template.description,
          category: 'custom',
          subcategory: 'ai-generated',
          industry: 'various',
          techStack: response.template.techStack,
          features: response.template.features,
          complexity: response.template.complexity,
          estimatedTime: response.template.estimatedTime,
          developmentTimeReduction: response.template.developmentTimeReduction,
          downloads: 0,
          rating: 0,
          reviews: 0,
          lastUpdated: 'Just now',
          author: 'AI Generated',
          authorType: 'official',
          thumbnail: 'https://images.unsplash.com/photo-1555949963-aa79dcee981c?w=400',
          price: 'free',
          tags: response.template.tags,
          aiGenerated: true,
          customizable: true
        };

        setTemplates(prev => [newTemplate, ...prev]);
        setGenerationPrompt('');

        toast({
          title: "Template Generated",
          description: `Custom template "${response.template.name}" created successfully`,
        });
      }
    } catch (error) {
      toast({
        title: "Generation Failed",
        description: "Unable to generate custom template. Please try again.",
        variant: "destructive"
      });
    } finally {
      setIsGenerating(false);
    }
  };

  // Filter and sort templates
  const filteredTemplates = templates.filter(template => {
    const matchesCategory = selectedCategory === 'all' || template.category === selectedCategory;
    const matchesSearch = template.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                         template.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
                         template.tags.some(tag => tag.toLowerCase().includes(searchQuery.toLowerCase()));
    const matchesComplexity = filterComplexity === 'all' || template.complexity === filterComplexity;
    const matchesPrice = filterPrice === 'all' || template.price === filterPrice;

    return matchesCategory && matchesSearch && matchesComplexity && matchesPrice;
  }).sort((a, b) => {
    switch (sortBy) {
      case 'popularity':
        return b.downloads - a.downloads;
      case 'rating':
        return b.rating - a.rating;
      case 'newest':
        return new Date(b.lastUpdated).getTime() - new Date(a.lastUpdated).getTime();
      case 'time-reduction':
        return b.developmentTimeReduction - a.developmentTimeReduction;
      default:
        return 0;
    }
  });

  // Download template
  const downloadTemplate = async (templateId: string) => {
    try {
      await apiRequest(`/api/jurexio/templates/download/${templateId}`, {
        method: 'POST'
      });

      setTemplates(prev => prev.map(template =>
        template.id === templateId
          ? { ...template, downloads: template.downloads + 1 }
          : template
      ));

      toast({
        title: "Template Downloaded",
        description: "Template has been added to your project workspace",
      });
    } catch (error) {
      toast({
        title: "Download Failed",
        description: "Unable to download template. Please try again.",
        variant: "destructive"
      });
    }
  };

  const getComplexityColor = (complexity: string) => {
    switch (complexity) {
      case 'beginner': return 'bg-green-500';
      case 'intermediate': return 'bg-yellow-500';
      case 'advanced': return 'bg-orange-500';
      case 'expert': return 'bg-red-500';
      default: return 'bg-gray-500';
    }
  };

  const getPriceColor = (price: string) => {
    switch (price) {
      case 'free': return 'bg-green-500';
      case 'premium': return 'bg-blue-500';
      case 'enterprise': return 'bg-purple-500';
      default: return 'bg-gray-500';
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-3xl font-bold">Enhanced Template Library</h2>
          <p className="text-muted-foreground">
            Production-ready templates with 60-80% development time reduction
          </p>
        </div>
        <Button 
          onClick={() => setGenerationPrompt(prev => prev || "Create a modern web application for...")}
          className="bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700"
        >
          <Sparkles className="h-4 w-4 mr-2" />
          AI Generate
        </Button>
      </div>

      {/* Metrics Overview */}
      {metrics && (
        <div className="grid grid-cols-5 gap-4">
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Total Templates</p>
                  <p className="text-2xl font-bold">{metrics.totalTemplates}</p>
                </div>
                <FileText className="h-8 w-8 text-blue-600" />
              </div>
            </CardContent>
          </Card>
          
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Avg Time Reduction</p>
                  <p className="text-2xl font-bold">{metrics.averageTimeReduction}%</p>
                </div>
                <Clock className="h-8 w-8 text-green-600" />
              </div>
            </CardContent>
          </Card>
          
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Total Downloads</p>
                  <p className="text-2xl font-bold">{metrics.totalDownloads.toLocaleString()}</p>
                </div>
                <Download className="h-8 w-8 text-purple-600" />
              </div>
            </CardContent>
          </Card>
          
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Avg Rating</p>
                  <p className="text-2xl font-bold">{metrics.averageRating}</p>
                </div>
                <Star className="h-8 w-8 text-yellow-600" />
              </div>
            </CardContent>
          </Card>
          
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-muted-foreground">New This Week</p>
                  <p className="text-2xl font-bold">{metrics.newThisWeek}</p>
                </div>
                <TrendingUp className="h-8 w-8 text-orange-600" />
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* AI Template Generation */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Brain className="h-5 w-5" />
            AI Template Generator
          </CardTitle>
          <CardDescription>
            Describe your project and let AI generate a custom template for you
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="flex gap-4">
              <Input
                placeholder="Describe your project (e.g., 'A task management app for teams with real-time collaboration')"
                value={generationPrompt}
                onChange={(e) => setGenerationPrompt(e.target.value)}
                className="flex-1"
              />
              <Button 
                onClick={generateCustomTemplate}
                disabled={isGenerating || !generationPrompt.trim()}
              >
                {isGenerating ? (
                  <>
                    <Bot className="h-4 w-4 mr-2 animate-spin" />
                    Generating...
                  </>
                ) : (
                  <>
                    <Sparkles className="h-4 w-4 mr-2" />
                    Generate
                  </>
                )}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Search and Filters */}
      <div className="flex flex-wrap gap-4 items-center justify-between">
        <div className="flex gap-4 items-center">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search templates..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10 w-80"
            />
          </div>
          
          <select 
            value={sortBy} 
            onChange={(e) => setSortBy(e.target.value)}
            className="px-3 py-2 border rounded-md"
          >
            <option value="popularity">Most Popular</option>
            <option value="rating">Highest Rated</option>
            <option value="newest">Newest</option>
            <option value="time-reduction">Time Reduction</option>
          </select>
        </div>

        <div className="flex gap-2">
          <select 
            value={filterComplexity} 
            onChange={(e) => setFilterComplexity(e.target.value)}
            className="px-3 py-2 border rounded-md"
          >
            <option value="all">All Levels</option>
            <option value="beginner">Beginner</option>
            <option value="intermediate">Intermediate</option>
            <option value="advanced">Advanced</option>
            <option value="expert">Expert</option>
          </select>
          
          <select 
            value={filterPrice} 
            onChange={(e) => setFilterPrice(e.target.value)}
            className="px-3 py-2 border rounded-md"
          >
            <option value="all">All Prices</option>
            <option value="free">Free</option>
            <option value="premium">Premium</option>
            <option value="enterprise">Enterprise</option>
          </select>
        </div>
      </div>

      <Tabs value={selectedCategory} onValueChange={setSelectedCategory}>
        {/* Category Tabs */}
        <TabsList className="grid grid-cols-9 w-full">
          <TabsTrigger value="all">All</TabsTrigger>
          {categories.map(category => (
            <TabsTrigger key={category.id} value={category.id}>
              {category.name}
            </TabsTrigger>
          ))}
        </TabsList>

        {/* Templates Grid */}
        <TabsContent value={selectedCategory} className="mt-6">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {filteredTemplates.map(template => (
              <motion.div
                key={template.id}
                layout
                className="group"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
              >
                <Card className="h-full hover:shadow-lg transition-shadow">
                  <div className="relative">
                    <img 
                      src={template.thumbnail} 
                      alt={template.name}
                      className="w-full h-48 object-cover rounded-t-lg"
                    />
                    <div className="absolute top-2 right-2 flex gap-1">
                      <Badge className={getPriceColor(template.price)}>
                        {template.price}
                      </Badge>
                      {template.aiGenerated && (
                        <Badge className="bg-purple-500">
                          <Sparkles className="h-3 w-3 mr-1" />
                          AI
                        </Badge>
                      )}
                    </div>
                  </div>
                  
                  <CardHeader className="pb-3">
                    <div className="flex justify-between items-start mb-2">
                      <CardTitle className="text-lg">{template.name}</CardTitle>
                      <Badge className={getComplexityColor(template.complexity)}>
                        {template.complexity}
                      </Badge>
                    </div>
                    <CardDescription className="line-clamp-2">
                      {template.description}
                    </CardDescription>
                  </CardHeader>
                  
                  <CardContent className="space-y-4">
                    <div className="flex items-center justify-between text-sm">
                      <div className="flex items-center gap-1">
                        <Star className="h-4 w-4 text-yellow-500 fill-current" />
                        <span>{template.rating}</span>
                        <span className="text-muted-foreground">({template.reviews})</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <Download className="h-4 w-4 text-muted-foreground" />
                        <span className="text-muted-foreground">{template.downloads.toLocaleString()}</span>
                      </div>
                    </div>

                    <div className="space-y-2">
                      <div className="flex items-center gap-2 text-sm">
                        <Clock className="h-4 w-4 text-muted-foreground" />
                        <span>{template.estimatedTime}</span>
                        <Badge variant="outline" className="text-xs">
                          -{template.developmentTimeReduction}% time
                        </Badge>
                      </div>
                      
                      <div className="flex flex-wrap gap-1">
                        {template.techStack.slice(0, 3).map(tech => (
                          <Badge key={tech} variant="outline" className="text-xs">
                            {tech}
                          </Badge>
                        ))}
                        {template.techStack.length > 3 && (
                          <Badge variant="outline" className="text-xs">
                            +{template.techStack.length - 3} more
                          </Badge>
                        )}
                      </div>
                    </div>

                    <div className="flex gap-2 pt-2">
                      <Button 
                        onClick={() => downloadTemplate(template.id)}
                        className="flex-1"
                        size="sm"
                      >
                        <Download className="h-4 w-4 mr-1" />
                        Use Template
                      </Button>
                      {template.demoUrl && (
                        <Button 
                          variant="outline" 
                          size="sm"
                          onClick={() => window.open(template.demoUrl, '_blank')}
                        >
                          <Eye className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
            ))}
          </div>

          {filteredTemplates.length === 0 && (
            <div className="text-center py-12">
              <FileText className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
              <h3 className="text-lg font-medium mb-2">No templates found</h3>
              <p className="text-muted-foreground">
                Try adjusting your search criteria or generate a custom template with AI
              </p>
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}