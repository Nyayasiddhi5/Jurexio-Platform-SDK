// Phase 2 - Enterprise Template & Asset Management
// Principal Engineer & Release Captain Implementation
// Builds on existing template system with approval workflows

import React, { useState, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { 
  Search, 
  Filter, 
  Star, 
  Download, 
  Share2, 
  Eye, 
  Edit, 
  Trash2,
  Plus,
  CheckCircle,
  Clock,
  XCircle,
  Users,
  Building,
  Palette,
  Layout,
  BarChart3
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { apiRequest } from '@/lib/queryClient';

interface Template {
  id: string;
  name: string;
  description: string;
  category: string;
  style: string;
  platform: string;
  author: string;
  status: 'draft' | 'pending' | 'approved' | 'rejected';
  isPublic: boolean;
  downloads: number;
  rating: number;
  tags: string[];
  preview: string;
  assets: Array<{
    type: 'image' | 'icon' | 'font' | 'component';
    url: string;
    name: string;
  }>;
  brandKit?: {
    colors: string[];
    fonts: string[];
    logos: string[];
  };
  usageAnalytics?: {
    views: number;
    uses: number;
    conversions: number;
  };
  createdAt: string;
  updatedAt: string;
}

interface BrandKit {
  id: string;
  name: string;
  colors: { name: string; hex: string; usage: string }[];
  fonts: { name: string; family: string; weights: string[] }[];
  logos: { variant: string; url: string; format: string }[];
  guidelines: string;
  complianceScore: number;
}

interface EnterpriseTemplateManagerProps {
  userRole?: 'admin' | 'designer' | 'user';
  organizationId?: string;
  className?: string;
}

export const EnterpriseTemplateManager: React.FC<EnterpriseTemplateManagerProps> = ({
  userRole = 'user',
  organizationId,
  className
}) => {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [selectedTemplate, setSelectedTemplate] = useState<Template | null>(null);
  const [activeTab, setActiveTab] = useState('templates');

  // Fetch templates with filters
  const { data: templatesData, isLoading } = useQuery({
    queryKey: ['/api/enterprise/templates', searchQuery, selectedCategory, organizationId],
    queryFn: async () => {
      return await apiRequest('/api/enterprise/templates', {
        method: 'POST',
        body: JSON.stringify({
          search: searchQuery,
          category: selectedCategory !== 'all' ? selectedCategory : undefined,
          organizationId,
          includeAnalytics: true
        })
      });
    }
  });

  // Fetch brand kits
  const { data: brandKitsData } = useQuery({
    queryKey: ['/api/enterprise/brand-kits', organizationId],
    queryFn: async () => {
      return await apiRequest('/api/enterprise/brand-kits', {
        method: 'GET',
        organizationId
      });
    }
  });

  // Template approval mutation (admin only)
  const approveTemplateMutation = useMutation({
    mutationFn: async ({ templateId, action }: { templateId: string; action: 'approve' | 'reject' }) => {
      return await apiRequest('/api/enterprise/templates/approve', {
        method: 'PATCH',
        body: JSON.stringify({
          templateId,
          action,
          organizationId
        })
      });
    },
    onSuccess: (data, variables) => {
      toast({
        title: `Template ${variables.action}d`,
        description: `Template has been ${variables.action}d successfully`
      });
      queryClient.invalidateQueries({ queryKey: ['/api/enterprise/templates'] });
    }
  });

  // Brand compliance check
  const checkBrandComplianceMutation = useMutation({
    mutationFn: async ({ templateId, brandKitId }: { templateId: string; brandKitId: string }) => {
      return await apiRequest('/api/enterprise/brand-compliance', {
        method: 'POST',
        body: JSON.stringify({
          templateId,
          brandKitId,
          checkLevel: 'comprehensive'
        })
      });
    },
    onSuccess: (data) => {
      toast({
        title: 'Brand Compliance Check',
        description: `Compliance score: ${data.score}%`
      });
    }
  });

  const templates = templatesData?.templates || [];
  const brandKits = brandKitsData?.brandKits || [];
  const pendingApprovals = templates.filter((t: Template) => t.status === 'pending');

  const handleTemplateAction = useCallback((templateId: string, action: string) => {
    const template = templates.find((t: Template) => t.id === templateId);
    if (!template) return;

    switch (action) {
      case 'preview':
        setSelectedTemplate(template);
        break;
      case 'approve':
        approveTemplateMutation.mutate({ templateId, action: 'approve' });
        break;
      case 'reject':
        approveTemplateMutation.mutate({ templateId, action: 'reject' });
        break;
      case 'download':
        // Trigger download logic
        toast({ title: 'Download Started', description: 'Template is being downloaded' });
        break;
    }
  }, [templates, approveTemplateMutation]);

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'approved': return <CheckCircle className="w-4 h-4 text-green-500" />;
      case 'pending': return <Clock className="w-4 h-4 text-yellow-500" />;
      case 'rejected': return <XCircle className="w-4 h-4 text-red-500" />;
      default: return <Clock className="w-4 h-4 text-gray-500" />;
    }
  };

  const categories = [
    'all', 'landing-pages', 'dashboards', 'e-commerce', 
    'portfolios', 'corporate', 'marketing', 'apps'
  ];

  return (
    <div className={className}>
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
        <div>
          <h2 className="text-2xl font-bold">Enterprise Template Library</h2>
          <p className="text-muted-foreground">
            Professional templates with brand compliance and approval workflows
          </p>
        </div>
        
        {userRole === 'admin' && pendingApprovals.length > 0 && (
          <Badge variant="secondary" className="flex items-center gap-2">
            <Clock className="w-4 h-4" />
            {pendingApprovals.length} Pending Approvals
          </Badge>
        )}
      </div>

      {/* Search and Filters */}
      <div className="flex flex-col md:flex-row gap-4 mb-6">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground w-4 h-4" />
          <Input
            placeholder="Search templates..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10"
          />
        </div>
        
        <Select value={selectedCategory} onValueChange={setSelectedCategory}>
          <SelectTrigger className="w-48">
            <Filter className="w-4 h-4 mr-2" />
            <SelectValue placeholder="Category" />
          </SelectTrigger>
          <SelectContent>
            {categories.map(category => (
              <SelectItem key={category} value={category}>
                {category === 'all' ? 'All Categories' : category.split('-').map(w => 
                  w.charAt(0).toUpperCase() + w.slice(1)
                ).join(' ')}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Main Content */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="templates">Templates</TabsTrigger>
          <TabsTrigger value="brand-kits">Brand Kits</TabsTrigger>
          {userRole === 'admin' && (
            <TabsTrigger value="approvals">
              Approvals {pendingApprovals.length > 0 && `(${pendingApprovals.length})`}
            </TabsTrigger>
          )}
          <TabsTrigger value="analytics">Analytics</TabsTrigger>
        </TabsList>

        {/* Templates Tab */}
        <TabsContent value="templates" className="space-y-6">
          {isLoading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {[...Array(6)].map((_, i) => (
                <Card key={i} className="animate-pulse">
                  <div className="h-48 bg-gray-200 dark:bg-gray-700"></div>
                  <CardContent className="p-4">
                    <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded mb-2"></div>
                    <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded"></div>
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {templates.map((template: Template) => (
                <Card key={template.id} className="group hover:shadow-lg transition-shadow">
                  <div className="relative">
                    <div 
                      className="h-48 bg-cover bg-center rounded-t-lg"
                      style={{ backgroundImage: `url(${template.preview})` }}
                    >
                      <div className="absolute inset-0 bg-black bg-opacity-0 group-hover:bg-opacity-20 transition-all rounded-t-lg flex items-center justify-center">
                        <div className="opacity-0 group-hover:opacity-100 transition-opacity space-x-2">
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => handleTemplateAction(template.id, 'preview')}
                          >
                            <Eye className="w-4 h-4" />
                          </Button>
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => handleTemplateAction(template.id, 'download')}
                          >
                            <Download className="w-4 h-4" />
                          </Button>
                        </div>
                      </div>
                    </div>
                    
                    <div className="absolute top-2 right-2 flex gap-2">
                      {getStatusIcon(template.status)}
                      {template.isPublic && (
                        <Badge variant="secondary" className="text-xs">
                          Public
                        </Badge>
                      )}
                    </div>
                  </div>
                  
                  <CardContent className="p-4">
                    <div className="space-y-2">
                      <div className="flex items-start justify-between">
                        <h3 className="font-semibold line-clamp-1">{template.name}</h3>
                        <div className="flex items-center gap-1">
                          <Star className="w-3 h-3 text-yellow-500 fill-current" />
                          <span className="text-xs">{template.rating}</span>
                        </div>
                      </div>
                      
                      <p className="text-sm text-muted-foreground line-clamp-2">
                        {template.description}
                      </p>
                      
                      <div className="flex flex-wrap gap-1">
                        <Badge variant="outline" className="text-xs">
                          {template.category}
                        </Badge>
                        <Badge variant="outline" className="text-xs">
                          {template.platform}
                        </Badge>
                        {template.style && (
                          <Badge variant="outline" className="text-xs">
                            {template.style}
                          </Badge>
                        )}
                      </div>
                      
                      <div className="flex items-center justify-between text-xs text-muted-foreground">
                        <span>by {template.author}</span>
                        <span>{template.downloads} downloads</span>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        {/* Brand Kits Tab */}
        <TabsContent value="brand-kits" className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {brandKits.map((brandKit: BrandKit) => (
              <Card key={brandKit.id}>
                <CardHeader>
                  <CardTitle className="flex items-center justify-between">
                    <span>{brandKit.name}</span>
                    <Badge 
                      variant={brandKit.complianceScore >= 90 ? 'default' : 
                               brandKit.complianceScore >= 70 ? 'secondary' : 'destructive'}
                    >
                      {brandKit.complianceScore}% Compliant
                    </Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Brand Colors</label>
                    <div className="flex gap-2">
                      {brandKit.colors.slice(0, 5).map((color, index) => (
                        <div
                          key={index}
                          className="w-8 h-8 rounded border"
                          style={{ backgroundColor: color.hex }}
                          title={`${color.name}: ${color.hex}`}
                        />
                      ))}
                      {brandKit.colors.length > 5 && (
                        <div className="w-8 h-8 rounded border bg-gray-100 dark:bg-gray-800 flex items-center justify-center text-xs">
                          +{brandKit.colors.length - 5}
                        </div>
                      )}
                    </div>
                  </div>
                  
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Typography</label>
                    <div className="text-sm text-muted-foreground">
                      {brandKit.fonts.map(font => font.name).join(', ')}
                    </div>
                  </div>
                  
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Logo Variants</label>
                    <div className="text-sm text-muted-foreground">
                      {brandKit.logos.length} variants available
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        {/* Admin Approvals Tab */}
        {userRole === 'admin' && (
          <TabsContent value="approvals" className="space-y-6">
            <div className="space-y-4">
              {pendingApprovals.map((template: Template) => (
                <Card key={template.id}>
                  <CardContent className="p-6">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <h3 className="font-semibold">{template.name}</h3>
                        <p className="text-sm text-muted-foreground mb-2">
                          {template.description}
                        </p>
                        <div className="flex gap-2">
                          <Badge variant="outline">{template.category}</Badge>
                          <Badge variant="outline">{template.platform}</Badge>
                        </div>
                      </div>
                      
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleTemplateAction(template.id, 'preview')}
                        >
                          <Eye className="w-4 h-4 mr-2" />
                          Preview
                        </Button>
                        <Button
                          size="sm"
                          onClick={() => handleTemplateAction(template.id, 'approve')}
                          disabled={approveTemplateMutation.isPending}
                        >
                          <CheckCircle className="w-4 h-4 mr-2" />
                          Approve
                        </Button>
                        <Button
                          size="sm"
                          variant="destructive"
                          onClick={() => handleTemplateAction(template.id, 'reject')}
                          disabled={approveTemplateMutation.isPending}
                        >
                          <XCircle className="w-4 h-4 mr-2" />
                          Reject
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </TabsContent>
        )}

        {/* Analytics Tab */}
        <TabsContent value="analytics" className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <Card>
              <CardContent className="p-6 text-center">
                <Layout className="w-8 h-8 mx-auto mb-2 text-primary" />
                <div className="text-2xl font-bold">{templates.length}</div>
                <div className="text-sm text-muted-foreground">Total Templates</div>
              </CardContent>
            </Card>
            
            <Card>
              <CardContent className="p-6 text-center">
                <Users className="w-8 h-8 mx-auto mb-2 text-primary" />
                <div className="text-2xl font-bold">
                  {templates.reduce((sum: number, t: Template) => sum + (t.downloads || 0), 0)}
                </div>
                <div className="text-sm text-muted-foreground">Total Downloads</div>
              </CardContent>
            </Card>
            
            <Card>
              <CardContent className="p-6 text-center">
                <BarChart3 className="w-8 h-8 mx-auto mb-2 text-primary" />
                <div className="text-2xl font-bold">
                  {templates.filter((t: Template) => t.status === 'approved').length}
                </div>
                <div className="text-sm text-muted-foreground">Approved Templates</div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>

      {/* Template Preview Dialog */}
      {selectedTemplate && (
        <Dialog open={!!selectedTemplate} onOpenChange={() => setSelectedTemplate(null)}>
          <DialogContent className="max-w-4xl max-h-[80vh]">
            <DialogHeader>
              <DialogTitle>{selectedTemplate.name}</DialogTitle>
              <DialogDescription>{selectedTemplate.description}</DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div 
                className="w-full h-64 bg-cover bg-center rounded border"
                style={{ backgroundImage: `url(${selectedTemplate.preview})` }}
              />
              <div className="flex gap-4">
                <Button className="flex-1">
                  <Download className="w-4 h-4 mr-2" />
                  Download Template
                </Button>
                <Button variant="outline">
                  <Share2 className="w-4 h-4 mr-2" />
                  Share
                </Button>
                {brandKits.length > 0 && (
                  <Button 
                    variant="outline"
                    onClick={() => checkBrandComplianceMutation.mutate({
                      templateId: selectedTemplate.id,
                      brandKitId: brandKits[0].id
                    })}
                  >
                    <Palette className="w-4 h-4 mr-2" />
                    Check Brand Compliance
                  </Button>
                )}
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
};

export default EnterpriseTemplateManager;