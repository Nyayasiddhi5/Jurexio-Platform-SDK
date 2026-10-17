import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { 
  Search, 
  Star, 
  Download, 
  Heart,
  TrendingUp,
  Filter,
  Bot,
  Zap,
  Users,
  RefreshCw,
  Eye,
  ShoppingCart
} from 'lucide-react';
import { motion } from 'framer-motion';
import { useToast } from '@/hooks/use-toast';
import { apiRequest } from '@/lib/queryClient';

interface AssistantTemplate {
  id: string;
  name: string;
  description: string;
  category: string;
  industry: string;
  use_cases: string[];
  pricing: {
    type: 'free' | 'premium' | 'enterprise';
    price: number;
    currency: string;
    billing_period: string;
  };
  author: {
    name: string;
    verified: boolean;
    reputation_score: number;
  };
  ratings: {
    average: number;
    total_reviews: number;
  };
  download_count: number;
  last_updated: string;
}

interface MarketplaceCategory {
  id: string;
  name: string;
  description: string;
  icon: string;
  template_count: number;
}

export function AIAssistantMarketplace() {
  const { toast } = useToast();
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [activeTab, setActiveTab] = useState('browse');
  const [selectedTemplate, setSelectedTemplate] = useState<AssistantTemplate | null>(null);
  const queryClient = useQueryClient();

  // Fetch marketplace templates
  const { data: templates = [], isLoading: templatesLoading } = useQuery({
    queryKey: ['/api/assistants/marketplace/templates', selectedCategory],
    retry: false
  });

  // Fetch marketplace categories
  const { data: categories = [], isLoading: categoriesLoading } = useQuery({
    queryKey: ['/api/assistants/marketplace/categories'],
    retry: false
  });

  // Create assistant from template
  const createFromTemplate = useMutation({
    mutationFn: async ({ templateId, customizations }: { templateId: string, customizations: any }) => {
      return await apiRequest('/api/assistants/marketplace/create-from-template', {
        method: 'POST',
        body: JSON.stringify({ templateId, customizations })
      });
    },
    onSuccess: () => {
      toast({
        title: "Assistant Created",
        description: "Your AI assistant has been created successfully.",
      });
      queryClient.invalidateQueries({ queryKey: ['/api/assistants'] });
    },
    onError: () => {
      toast({
        title: "Creation Failed",
        description: "Failed to create assistant from template.",
        variant: "destructive"
      });
    }
  });

  const filteredTemplates = templates.filter((template: AssistantTemplate) => {
    const matchesSearch = searchQuery === '' || 
      template.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      template.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
      template.use_cases.some(useCase => useCase.toLowerCase().includes(searchQuery.toLowerCase()));
    
    const matchesCategory = selectedCategory === 'all' || template.category === selectedCategory;
    
    return matchesSearch && matchesCategory;
  });

  const handleCreateAssistant = (template: AssistantTemplate) => {
    createFromTemplate.mutate({
      templateId: template.id,
      customizations: {
        name: `${template.name} Assistant`,
        userId: 1,
        projectId: 1
      }
    });
  };

  const getPricingColor = (type: string) => {
    switch (type) {
      case 'free': return 'text-green-600 bg-green-100 dark:bg-green-900/20';
      case 'premium': return 'text-blue-600 bg-blue-100 dark:bg-blue-900/20';
      case 'enterprise': return 'text-purple-600 bg-purple-100 dark:bg-purple-900/20';
      default: return 'text-slate-600 bg-slate-100 dark:bg-slate-900/20';
    }
  };

  const renderStars = (rating: number) => {
    return Array.from({ length: 5 }, (_, i) => (
      <Star
        key={i}
        className={`h-4 w-4 ${
          i < Math.floor(rating)
            ? 'text-yellow-500 fill-current'
            : 'text-slate-300 dark:text-slate-600'
        }`}
      />
    ));
  };

  if (templatesLoading || categoriesLoading) {
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
      {/* Marketplace Header */}
      <Card className="bg-gradient-to-r from-indigo-50 to-blue-50 dark:from-indigo-950/20 dark:to-blue-950/20 border-indigo-200 dark:border-indigo-800">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Bot className="h-6 w-6 text-indigo-600" />
            AI Assistant Marketplace
          </CardTitle>
          <CardDescription>
            Discover pre-built AI assistants or create custom ones from templates
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="text-center">
              <div className="text-2xl font-bold text-indigo-600">{templates.length}</div>
              <div className="text-sm text-slate-600 dark:text-slate-400">Available Templates</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-blue-600">{categories.length}</div>
              <div className="text-sm text-slate-600 dark:text-slate-400">Categories</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-green-600">
                {templates.filter((t: AssistantTemplate) => t.pricing.type === 'free').length}
              </div>
              <div className="text-sm text-slate-600 dark:text-slate-400">Free Templates</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-purple-600">
                {templates.reduce((acc: number, t: AssistantTemplate) => acc + t.download_count, 0)}
              </div>
              <div className="text-sm text-slate-600 dark:text-slate-400">Total Downloads</div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
        <TabsList className="grid w-full grid-cols-3 bg-white/80 dark:bg-slate-800/80 backdrop-blur-sm">
          <TabsTrigger value="browse">Browse Templates</TabsTrigger>
          <TabsTrigger value="categories">Categories</TabsTrigger>
          <TabsTrigger value="trending">Trending</TabsTrigger>
        </TabsList>

        <TabsContent value="browse" className="space-y-6">
          {/* Search and Filters */}
          <Card>
            <CardContent className="p-4">
              <div className="flex flex-col md:flex-row gap-4">
                <div className="flex-1 relative">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-slate-400 h-4 w-4" />
                  <Input
                    placeholder="Search templates, use cases, or keywords..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-10"
                  />
                </div>
                <Select value={selectedCategory} onValueChange={setSelectedCategory}>
                  <SelectTrigger className="w-full md:w-48">
                    <SelectValue placeholder="All Categories" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Categories</SelectItem>
                    {categories.map((category: MarketplaceCategory) => (
                      <SelectItem key={category.id} value={category.id}>
                        {category.name} ({category.template_count})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>

          {/* Templates Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {filteredTemplates.map((template: AssistantTemplate, index: number) => (
              <motion.div
                key={template.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3, delay: index * 0.1 }}
              >
                <Card className="h-full hover:shadow-lg transition-all duration-200 cursor-pointer group">
                  <CardHeader className="pb-3">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <CardTitle className="text-lg group-hover:text-blue-600 transition-colors">
                          {template.name}
                        </CardTitle>
                        <CardDescription className="mt-1">
                          {template.description}
                        </CardDescription>
                      </div>
                      <Badge variant="secondary" className={getPricingColor(template.pricing.type)}>
                        {template.pricing.type === 'free' ? 'Free' : `$${template.pricing.price}`}
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {/* Use Cases */}
                    <div>
                      <h4 className="font-medium text-sm mb-2">Use Cases</h4>
                      <div className="flex flex-wrap gap-1">
                        {template.use_cases.slice(0, 3).map((useCase) => (
                          <Badge key={useCase} variant="outline" className="text-xs">
                            {useCase}
                          </Badge>
                        ))}
                        {template.use_cases.length > 3 && (
                          <Badge variant="outline" className="text-xs">
                            +{template.use_cases.length - 3} more
                          </Badge>
                        )}
                      </div>
                    </div>

                    {/* Ratings and Downloads */}
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1">
                        {renderStars(template.ratings.average)}
                        <span className="text-sm text-slate-600 dark:text-slate-400 ml-1">
                          ({template.ratings.total_reviews})
                        </span>
                      </div>
                      <div className="flex items-center gap-1 text-sm text-slate-600 dark:text-slate-400">
                        <Download className="h-4 w-4" />
                        {template.download_count}
                      </div>
                    </div>

                    {/* Author */}
                    <div className="flex items-center gap-2">
                      <Users className="h-4 w-4 text-slate-400" />
                      <span className="text-sm text-slate-600 dark:text-slate-400">
                        by {template.author.name}
                      </span>
                      {template.author.verified && (
                        <Badge variant="outline" className="text-xs">
                          Verified
                        </Badge>
                      )}
                    </div>

                    {/* Actions */}
                    <div className="flex gap-2 pt-2">
                      <Button
                        size="sm"
                        variant="outline"
                        className="flex-1"
                        onClick={() => setSelectedTemplate(template)}
                      >
                        <Eye className="h-4 w-4 mr-1" />
                        Preview
                      </Button>
                      <Button
                        size="sm"
                        className="flex-1 bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700"
                        onClick={() => handleCreateAssistant(template)}
                        disabled={createFromTemplate.isPending}
                      >
                        {createFromTemplate.isPending ? (
                          <RefreshCw className="h-4 w-4 animate-spin mr-1" />
                        ) : (
                          <ShoppingCart className="h-4 w-4 mr-1" />
                        )}
                        Use Template
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
            ))}
          </div>

          {filteredTemplates.length === 0 && (
            <Card>
              <CardContent className="text-center py-12">
                <Bot className="h-12 w-12 text-slate-400 mx-auto mb-4" />
                <h3 className="text-lg font-medium mb-2">No templates found</h3>
                <p className="text-slate-600 dark:text-slate-400">
                  Try adjusting your search criteria or browse all categories
                </p>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="categories" className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {categories.map((category: MarketplaceCategory) => (
              <Card key={category.id} className="hover:shadow-lg transition-all duration-200 cursor-pointer group">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 group-hover:text-blue-600 transition-colors">
                    <div className="text-2xl">{category.icon}</div>
                    {category.name}
                  </CardTitle>
                  <CardDescription>{category.description}</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-slate-600 dark:text-slate-400">
                      {category.template_count} templates
                    </span>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setSelectedCategory(category.id);
                        setActiveTab('browse');
                      }}
                    >
                      Browse
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="trending" className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {templates
              .sort((a: AssistantTemplate, b: AssistantTemplate) => b.download_count - a.download_count)
              .slice(0, 6)
              .map((template: AssistantTemplate, index: number) => (
                <motion.div
                  key={template.id}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.3, delay: index * 0.1 }}
                >
                  <Card className="h-full hover:shadow-lg transition-all duration-200 relative">
                    <div className="absolute top-4 right-4">
                      <Badge className="bg-gradient-to-r from-orange-500 to-red-500 text-white">
                        <TrendingUp className="h-3 w-3 mr-1" />
                        #{index + 1}
                      </Badge>
                    </div>
                    <CardHeader className="pb-3">
                      <CardTitle className="text-lg pr-12">{template.name}</CardTitle>
                      <CardDescription>{template.description}</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-1">
                          {renderStars(template.ratings.average)}
                          <span className="text-sm text-slate-600 dark:text-slate-400 ml-1">
                            ({template.ratings.total_reviews})
                          </span>
                        </div>
                        <div className="flex items-center gap-1 text-sm text-slate-600 dark:text-slate-400">
                          <Download className="h-4 w-4" />
                          {template.download_count}
                        </div>
                      </div>

                      <div className="flex gap-2">
                        <Button size="sm" variant="outline" className="flex-1">
                          <Eye className="h-4 w-4 mr-1" />
                          Preview
                        </Button>
                        <Button
                          size="sm"
                          className="flex-1 bg-gradient-to-r from-orange-500 to-red-500 hover:from-orange-600 hover:to-red-600"
                          onClick={() => handleCreateAssistant(template)}
                        >
                          <ShoppingCart className="h-4 w-4 mr-1" />
                          Use
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                </motion.div>
              ))}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}