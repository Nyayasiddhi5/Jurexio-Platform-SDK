/**
 * Brand Management System - Phase 3 Enterprise Feature
 * 
 * Centralized brand asset management with compliance enforcement,
 * logo/palette versioning, and multi-brand support for enterprises
 */

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Switch } from '@/components/ui/switch';
import { Progress } from '@/components/ui/progress';
import { 
  Palette, Image, Upload, Download, Edit3, Trash2, Eye,
  Shield, CheckCircle, AlertTriangle, Copy, Link, Tag,
  Folder, FolderOpen, Search, Filter, Grid, List,
  Star, Clock, Users, Share2, Lock, Unlock, Settings,
  Plus, Minus, MoreHorizontal, Archive, RefreshCw
} from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import { useToast } from '@/hooks/use-toast';

interface BrandAsset {
  id: string;
  name: string;
  type: 'logo' | 'color-palette' | 'typography' | 'template' | 'image' | 'icon';
  category: string;
  description: string;
  url: string;
  thumbnailUrl: string;
  size: string;
  format: string;
  dimensions?: { width: number; height: number };
  colorPalette?: string[];
  tags: string[];
  brand: string;
  version: string;
  status: 'approved' | 'pending' | 'rejected' | 'archived';
  compliance: ComplianceStatus;
  usage: AssetUsage;
  metadata: AssetMetadata;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
}

interface ComplianceStatus {
  isCompliant: boolean;
  checkedRules: string[];
  violations: ComplianceViolation[];
  lastChecked: string;
  score: number;
}

interface ComplianceViolation {
  rule: string;
  severity: 'high' | 'medium' | 'low';
  description: string;
  recommendation: string;
}

interface AssetUsage {
  totalDownloads: number;
  recentUsage: number;
  popularProjects: string[];
  lastUsed: string;
}

interface AssetMetadata {
  author: string;
  keywords: string[];
  license: string;
  rights: string;
  source: string;
  guidelines?: string;
}

interface Brand {
  id: string;
  name: string;
  description: string;
  logo: string;
  primaryColor: string;
  secondaryColors: string[];
  fonts: BrandFont[];
  guidelines: BrandGuidelines;
  assets: number;
  compliance: number;
  status: 'active' | 'inactive' | 'draft';
  createdAt: string;
}

interface BrandFont {
  name: string;
  type: 'primary' | 'secondary' | 'accent';
  weights: string[];
  url?: string;
}

interface BrandGuidelines {
  logoUsage: string;
  colorUsage: string;
  typographyRules: string;
  spacing: string;
  doNotUse: string[];
  approvedCombinations: string[];
}

interface BrandMetrics {
  totalAssets: number;
  totalBrands: number;
  complianceScore: number;
  activeUsers: number;
  recentUploads: number;
  popularAssets: BrandAsset[];
  brandBreakdown: Record<string, number>;
  usageAnalytics: Array<{ date: string; downloads: number; uploads: number }>;
}

export default function BrandManagementSystem() {
  const [activeTab, setActiveTab] = useState('overview');
  const [selectedBrand, setSelectedBrand] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [isUploading, setIsUploading] = useState(false);
  const [selectedAssets, setSelectedAssets] = useState<string[]>([]);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  // Fetch brand metrics using Jurexio orchestration
  const { data: metrics, isLoading: metricsLoading } = useQuery({
    queryKey: ['/api/nyayavigya/brand/metrics'],
    queryFn: () => apiRequest('/api/nyayavigya/brand/metrics')
  });

  // Fetch brands using Jurexio orchestration
  const { data: brands = [], isLoading: brandsLoading } = useQuery({
    queryKey: ['/api/nyayavigya/brand/brands'],
    queryFn: () => apiRequest('/api/nyayavigya/brand/brands')
  });

  // Fetch brand assets using Jurexio orchestration
  const { data: assets = [], isLoading: assetsLoading } = useQuery({
    queryKey: ['/api/nyayavigya/brand/assets', selectedBrand, selectedCategory, searchQuery],
    queryFn: () => apiRequest(`/api/nyayavigya/brand/assets?brand=${selectedBrand || 'all'}&category=${selectedCategory}&search=${searchQuery}`)
  });

  // Upload asset mutation
  const uploadAsset = useMutation({
    mutationFn: (asset: any) => apiRequest('/api/nyayavigya/brand/assets', {
      method: 'POST',
      body: JSON.stringify(asset)
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/nyayavigya/brand'] });
      setIsUploading(false);
      toast({
        title: "Asset Uploaded",
        description: "Brand asset has been uploaded and is pending compliance review"
      });
    }
  });

  // Check compliance mutation
  const checkCompliance = useMutation({
    mutationFn: (assetId: string) => apiRequest(`/api/nyayavigya/brand/assets/${assetId}/compliance`, {
      method: 'POST'
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/nyayavigya/brand/assets'] });
      toast({
        title: "Compliance Check Complete",
        description: "Asset compliance has been verified"
      });
    }
  });

  const mockMetrics: BrandMetrics = {
    totalAssets: 1247,
    totalBrands: 8,
    complianceScore: 94.2,
    activeUsers: 156,
    recentUploads: 23,
    popularAssets: [],
    brandBreakdown: {
      'Main Brand': 45,
      'Product Line A': 28,
      'Product Line B': 15,
      'Event Branding': 12
    },
    usageAnalytics: [
      { date: '2025-08-10', downloads: 234, uploads: 12 },
      { date: '2025-08-11', downloads: 189, uploads: 8 },
      { date: '2025-08-12', downloads: 267, uploads: 15 },
      { date: '2025-08-13', downloads: 298, uploads: 11 },
      { date: '2025-08-14', downloads: 245, uploads: 9 },
      { date: '2025-08-15', downloads: 312, uploads: 18 },
      { date: '2025-08-16', downloads: 289, uploads: 14 }
    ]
  };

  const mockBrands: Brand[] = [
    {
      id: '1',
      name: 'Jurexio DevStudio',
      description: 'Primary brand for the development platform',
      logo: 'https://via.placeholder.com/150x60/3B82F6/FFFFFF?text=Jurexio',
      primaryColor: '#3B82F6',
      secondaryColors: ['#1E40AF', '#60A5FA', '#93C5FD'],
      fonts: [
        { name: 'Inter', type: 'primary', weights: ['400', '500', '600', '700'] },
        { name: 'JetBrains Mono', type: 'secondary', weights: ['400', '500'] }
      ],
      guidelines: {
        logoUsage: 'Maintain minimum 24px clear space around logo',
        colorUsage: 'Use primary blue for main CTAs, secondary for highlights',
        typographyRules: 'Inter for UI, JetBrains Mono for code',
        spacing: '8px base spacing system',
        doNotUse: ['Stretch logo', 'Change colors', 'Add drop shadows'],
        approvedCombinations: ['Blue + White', 'Blue + Gray', 'White + Blue']
      },
      assets: 456,
      compliance: 96.5,
      status: 'active',
      createdAt: '2025-01-01T00:00:00Z'
    },
    {
      id: '2',
      name: 'Enterprise Solutions',
      description: 'Enterprise product line branding',
      logo: 'https://via.placeholder.com/150x60/1F2937/FFFFFF?text=ENT',
      primaryColor: '#1F2937',
      secondaryColors: ['#374151', '#6B7280', '#9CA3AF'],
      fonts: [
        { name: 'Roboto', type: 'primary', weights: ['400', '500', '700'] }
      ],
      guidelines: {
        logoUsage: 'Professional contexts only, minimum 32px height',
        colorUsage: 'Dark gray for corporate communications',
        typographyRules: 'Roboto for all enterprise materials',
        spacing: '12px base spacing for enterprise layouts',
        doNotUse: ['Bright colors', 'Casual fonts', 'Rounded corners'],
        approvedCombinations: ['Gray + White', 'Gray + Blue accent']
      },
      assets: 234,
      compliance: 92.1,
      status: 'active',
      createdAt: '2025-02-15T00:00:00Z'
    }
  ];

  const mockAssets: BrandAsset[] = [
    {
      id: '1',
      name: 'Jurexio Primary Logo',
      type: 'logo',
      category: 'logos',
      description: 'Main company logo in full color',
      url: 'https://via.placeholder.com/400x160/3B82F6/FFFFFF?text=Jurexio+LOGO',
      thumbnailUrl: 'https://via.placeholder.com/150x60/3B82F6/FFFFFF?text=Jurexio',
      size: '24 KB',
      format: 'SVG',
      dimensions: { width: 400, height: 160 },
      tags: ['primary', 'logo', 'brand', 'blue'],
      brand: 'Jurexio DevStudio',
      version: '2.1',
      status: 'approved',
      compliance: {
        isCompliant: true,
        checkedRules: ['logo-guidelines', 'color-accuracy', 'format-standards'],
        violations: [],
        lastChecked: '2025-08-17T10:00:00Z',
        score: 100
      },
      usage: {
        totalDownloads: 1256,
        recentUsage: 45,
        popularProjects: ['Website', 'Marketing Materials', 'App Interface'],
        lastUsed: '2025-08-17T09:30:00Z'
      },
      metadata: {
        author: 'Design Team',
        keywords: ['logo', 'brand', 'primary', 'official'],
        license: 'Internal Use Only',
        rights: 'Jurexio DevStudio',
        source: 'Design System',
        guidelines: 'Use with minimum 24px clear space'
      },
      createdAt: '2025-01-01T00:00:00Z',
      updatedAt: '2025-08-15T00:00:00Z',
      createdBy: 'design-team'
    },
    {
      id: '2',
      name: 'Primary Color Palette',
      type: 'color-palette',
      category: 'colors',
      description: 'Official brand color palette with primary and secondary colors',
      url: 'https://via.placeholder.com/400x200/3B82F6/FFFFFF?text=COLOR+PALETTE',
      thumbnailUrl: 'https://via.placeholder.com/150x75/3B82F6/FFFFFF?text=COLORS',
      size: '2 KB',
      format: 'ASE',
      colorPalette: ['#3B82F6', '#1E40AF', '#60A5FA', '#93C5FD', '#DBEAFE'],
      tags: ['colors', 'palette', 'primary', 'blue'],
      brand: 'Jurexio DevStudio',
      version: '1.0',
      status: 'approved',
      compliance: {
        isCompliant: true,
        checkedRules: ['color-accessibility', 'contrast-ratios', 'brand-consistency'],
        violations: [],
        lastChecked: '2025-08-17T09:00:00Z',
        score: 98
      },
      usage: {
        totalDownloads: 789,
        recentUsage: 23,
        popularProjects: ['UI Design', 'Marketing', 'Presentations'],
        lastUsed: '2025-08-17T08:45:00Z'
      },
      metadata: {
        author: 'Brand Team',
        keywords: ['colors', 'palette', 'accessibility', 'wcag'],
        license: 'Internal Use Only',
        rights: 'Jurexio DevStudio',
        source: 'Brand Guidelines',
        guidelines: 'Ensure WCAG AA contrast ratios'
      },
      createdAt: '2025-01-15T00:00:00Z',
      updatedAt: '2025-08-10T00:00:00Z',
      createdBy: 'brand-team'
    },
    {
      id: '3',
      name: 'Enterprise Template Set',
      type: 'template',
      category: 'templates',
      description: 'Professional presentation templates for enterprise use',
      url: 'https://via.placeholder.com/400x300/1F2937/FFFFFF?text=TEMPLATE',
      thumbnailUrl: 'https://via.placeholder.com/150x100/1F2937/FFFFFF?text=TEMP',
      size: '1.2 MB',
      format: 'PPTX',
      tags: ['template', 'presentation', 'enterprise', 'professional'],
      brand: 'Enterprise Solutions',
      version: '1.5',
      status: 'pending',
      compliance: {
        isCompliant: false,
        checkedRules: ['template-standards', 'font-usage', 'layout-consistency'],
        violations: [
          {
            rule: 'font-usage',
            severity: 'medium',
            description: 'Non-standard font detected in slide 5',
            recommendation: 'Replace with approved Roboto font family'
          }
        ],
        lastChecked: '2025-08-17T11:00:00Z',
        score: 85
      },
      usage: {
        totalDownloads: 234,
        recentUsage: 12,
        popularProjects: ['Sales Presentations', 'Client Meetings'],
        lastUsed: '2025-08-16T14:20:00Z'
      },
      metadata: {
        author: 'Enterprise Team',
        keywords: ['template', 'enterprise', 'presentation', 'corporate'],
        license: 'Internal Use Only',
        rights: 'Jurexio DevStudio',
        source: 'Enterprise Division',
        guidelines: 'Follow enterprise brand guidelines strictly'
      },
      createdAt: '2025-08-01T00:00:00Z',
      updatedAt: '2025-08-16T00:00:00Z',
      createdBy: 'enterprise-team'
    }
  ];

  const categories = [
    { id: 'all', name: 'All Assets', icon: Grid },
    { id: 'logos', name: 'Logos', icon: Star },
    { id: 'colors', name: 'Colors', icon: Palette },
    { id: 'typography', name: 'Typography', icon: Edit3 },
    { id: 'templates', name: 'Templates', icon: Folder },
    { id: 'images', name: 'Images', icon: Image },
    { id: 'icons', name: 'Icons', icon: Star }
  ];

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'approved': return 'text-green-600';
      case 'pending': return 'text-yellow-600';
      case 'rejected': return 'text-red-600';
      case 'archived': return 'text-gray-600';
      default: return 'text-gray-600';
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'approved': return 'default';
      case 'pending': return 'secondary';
      case 'rejected': return 'destructive';
      case 'archived': return 'outline';
      default: return 'outline';
    }
  };

  const getComplianceColor = (score: number) => {
    if (score >= 95) return 'text-green-600';
    if (score >= 85) return 'text-yellow-600';
    return 'text-red-600';
  };

  const toggleAssetSelection = (assetId: string) => {
    setSelectedAssets(prev => 
      prev.includes(assetId) 
        ? prev.filter(id => id !== assetId)
        : [...prev, assetId]
    );
  };

  const handleBulkAction = (action: string) => {
    toast({
      title: "Bulk Action",
      description: `${action} applied to ${selectedAssets.length} assets`
    });
    setSelectedAssets([]);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Brand Management System</h2>
          <p className="text-muted-foreground">
            Centralized brand asset management with compliance enforcement
          </p>
        </div>
        <div className="flex items-center gap-4">
          <Button variant="outline" size="sm">
            <Download className="h-4 w-4 mr-2" />
            Export Assets
          </Button>
          <Button
            onClick={() => setIsUploading(true)}
            disabled={uploadAsset.isPending}
          >
            <Upload className="h-4 w-4 mr-2" />
            Upload Asset
          </Button>
        </div>
      </div>

      {/* Main Content */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
        <TabsList className="grid w-full grid-cols-5">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="assets">Assets</TabsTrigger>
          <TabsTrigger value="brands">Brands</TabsTrigger>
          <TabsTrigger value="compliance">Compliance</TabsTrigger>
          <TabsTrigger value="guidelines">Guidelines</TabsTrigger>
        </TabsList>

        {/* Overview Tab */}
        <TabsContent value="overview" className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
            <Card>
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">Total Assets</p>
                    <p className="text-2xl font-bold">{mockMetrics.totalAssets}</p>
                  </div>
                  <Image className="h-8 w-8 text-muted-foreground" />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">Active Brands</p>
                    <p className="text-2xl font-bold">{mockMetrics.totalBrands}</p>
                  </div>
                  <Palette className="h-8 w-8 text-muted-foreground" />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">Compliance Score</p>
                    <p className="text-2xl font-bold">{mockMetrics.complianceScore}%</p>
                  </div>
                  <Shield className="h-8 w-8 text-muted-foreground" />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">Active Users</p>
                    <p className="text-2xl font-bold">{mockMetrics.activeUsers}</p>
                  </div>
                  <Users className="h-8 w-8 text-muted-foreground" />
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Palette className="h-5 w-5" />
                  Brand Distribution
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {Object.entries(mockMetrics.brandBreakdown).map(([brand, percentage]) => (
                  <div key={brand} className="space-y-2">
                    <div className="flex justify-between text-sm">
                      <span>{brand}</span>
                      <span>{percentage}%</span>
                    </div>
                    <Progress value={percentage} className="h-2" />
                  </div>
                ))}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Download className="h-5 w-5" />
                  Usage Analytics
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-[200px] flex items-center justify-center text-muted-foreground">
                  <div className="text-center">
                    <Download className="h-12 w-12 mx-auto mb-4 opacity-50" />
                    <p>Usage trends visualization</p>
                    <p className="text-sm">Downloads and uploads over time</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Assets Tab */}
        <TabsContent value="assets" className="space-y-6">
          {/* Filters and Controls */}
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-4">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      placeholder="Search assets..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="pl-10 w-64"
                    />
                  </div>
                  <select
                    value={selectedBrand || 'all'}
                    onChange={(e) => setSelectedBrand(e.target.value === 'all' ? null : e.target.value)}
                    className="px-3 py-2 rounded-md border bg-background"
                  >
                    <option value="all">All Brands</option>
                    {mockBrands.map((brand) => (
                      <option key={brand.id} value={brand.id}>
                        {brand.name}
                      </option>
                    ))}
                  </select>
                  <select
                    value={selectedCategory}
                    onChange={(e) => setSelectedCategory(e.target.value)}
                    className="px-3 py-2 rounded-md border bg-background"
                  >
                    {categories.map((category) => (
                      <option key={category.id} value={category.id}>
                        {category.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="flex items-center gap-2">
                  {selectedAssets.length > 0 && (
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-muted-foreground">
                        {selectedAssets.length} selected
                      </span>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleBulkAction('Archive')}
                      >
                        <Archive className="h-4 w-4 mr-2" />
                        Archive
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleBulkAction('Download')}
                      >
                        <Download className="h-4 w-4 mr-2" />
                        Download
                      </Button>
                    </div>
                  )}
                  <div className="flex border rounded-lg">
                    <Button
                      variant={viewMode === 'grid' ? 'default' : 'ghost'}
                      size="sm"
                      onClick={() => setViewMode('grid')}
                    >
                      <Grid className="h-4 w-4" />
                    </Button>
                    <Button
                      variant={viewMode === 'list' ? 'default' : 'ghost'}
                      size="sm"
                      onClick={() => setViewMode('list')}
                    >
                      <List className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Assets Grid/List */}
          <div className={viewMode === 'grid' ? 'grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6' : 'space-y-4'}>
            {mockAssets.map((asset) => (
              <motion.div
                key={asset.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="group"
              >
                {viewMode === 'grid' ? (
                  <Card className="h-full transition-all group-hover:shadow-lg">
                    <CardContent className="p-4 space-y-4">
                      <div className="relative">
                        <img
                          src={asset.thumbnailUrl}
                          alt={asset.name}
                          className="w-full h-32 object-cover rounded-lg bg-muted"
                        />
                        <div className="absolute top-2 left-2">
                          <input
                            type="checkbox"
                            checked={selectedAssets.includes(asset.id)}
                            onChange={() => toggleAssetSelection(asset.id)}
                            className="rounded"
                          />
                        </div>
                        <div className="absolute top-2 right-2">
                          <Badge variant={getStatusBadge(asset.status)} className="text-xs">
                            {asset.status}
                          </Badge>
                        </div>
                        <div className="absolute bottom-2 right-2">
                          <Badge variant="outline" className="text-xs">
                            {asset.format}
                          </Badge>
                        </div>
                      </div>

                      <div className="space-y-2">
                        <h3 className="font-semibold text-sm truncate">{asset.name}</h3>
                        <p className="text-xs text-muted-foreground">
                          {asset.brand} • {asset.size}
                        </p>
                        <div className="flex items-center justify-between">
                          <span className="text-xs text-muted-foreground">
                            v{asset.version}
                          </span>
                          <div className="flex items-center gap-1">
                            {asset.compliance.isCompliant ? (
                              <CheckCircle className="h-3 w-3 text-green-600" />
                            ) : (
                              <AlertTriangle className="h-3 w-3 text-yellow-600" />
                            )}
                            <span className={`text-xs ${getComplianceColor(asset.compliance.score)}`}>
                              {asset.compliance.score}%
                            </span>
                          </div>
                        </div>
                      </div>

                      <div className="flex gap-2">
                        <Button variant="outline" size="sm" className="flex-1">
                          <Eye className="h-3 w-3 mr-1" />
                          View
                        </Button>
                        <Button variant="outline" size="sm" className="flex-1">
                          <Download className="h-3 w-3 mr-1" />
                          Download
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                ) : (
                  <Card>
                    <CardContent className="p-4">
                      <div className="flex items-center gap-4">
                        <input
                          type="checkbox"
                          checked={selectedAssets.includes(asset.id)}
                          onChange={() => toggleAssetSelection(asset.id)}
                          className="rounded"
                        />
                        <img
                          src={asset.thumbnailUrl}
                          alt={asset.name}
                          className="w-16 h-16 object-cover rounded-lg bg-muted"
                        />
                        <div className="flex-1 space-y-1">
                          <div className="flex items-center justify-between">
                            <h3 className="font-semibold">{asset.name}</h3>
                            <Badge variant={getStatusBadge(asset.status)} className="text-xs">
                              {asset.status}
                            </Badge>
                          </div>
                          <p className="text-sm text-muted-foreground">
                            {asset.description}
                          </p>
                          <div className="flex items-center gap-4 text-xs text-muted-foreground">
                            <span>{asset.brand}</span>
                            <span>•</span>
                            <span>{asset.format}</span>
                            <span>•</span>
                            <span>{asset.size}</span>
                            <span>•</span>
                            <span>v{asset.version}</span>
                            <span>•</span>
                            <div className="flex items-center gap-1">
                              {asset.compliance.isCompliant ? (
                                <CheckCircle className="h-3 w-3 text-green-600" />
                              ) : (
                                <AlertTriangle className="h-3 w-3 text-yellow-600" />
                              )}
                              <span className={getComplianceColor(asset.compliance.score)}>
                                {asset.compliance.score}% compliant
                              </span>
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <Button variant="outline" size="sm">
                            <Eye className="h-4 w-4 mr-2" />
                            View
                          </Button>
                          <Button variant="outline" size="sm">
                            <Download className="h-4 w-4 mr-2" />
                            Download
                          </Button>
                          <Button variant="ghost" size="sm">
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                )}
              </motion.div>
            ))}
          </div>
        </TabsContent>

        {/* Brands Tab */}
        <TabsContent value="brands" className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {mockBrands.map((brand) => (
              <motion.div
                key={brand.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
              >
                <Card className="h-full">
                  <CardHeader className="pb-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <img
                          src={brand.logo}
                          alt={brand.name}
                          className="w-12 h-12 object-contain bg-muted rounded-lg p-2"
                        />
                        <div>
                          <CardTitle className="text-base">{brand.name}</CardTitle>
                          <Badge variant={brand.status === 'active' ? 'default' : 'outline'} className="text-xs">
                            {brand.status}
                          </Badge>
                        </div>
                      </div>
                      <Button variant="outline" size="sm">
                        <Settings className="h-4 w-4" />
                      </Button>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <p className="text-sm text-muted-foreground">
                      {brand.description}
                    </p>

                    <div className="space-y-3">
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-muted-foreground">Assets</span>
                        <span className="font-medium">{brand.assets}</span>
                      </div>
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-muted-foreground">Compliance</span>
                        <span className={`font-medium ${getComplianceColor(brand.compliance)}`}>
                          {brand.compliance}%
                        </span>
                      </div>
                    </div>

                    <div className="space-y-2">
                      <span className="text-sm text-muted-foreground">Brand Colors</span>
                      <div className="flex gap-2">
                        <div
                          className="w-8 h-8 rounded-lg border-2 border-white shadow-sm"
                          style={{ backgroundColor: brand.primaryColor }}
                          title="Primary Color"
                        />
                        {brand.secondaryColors.slice(0, 4).map((color, index) => (
                          <div
                            key={index}
                            className="w-6 h-6 rounded border border-white shadow-sm"
                            style={{ backgroundColor: color }}
                            title={`Secondary Color ${index + 1}`}
                          />
                        ))}
                      </div>
                    </div>

                    <div className="space-y-2">
                      <span className="text-sm text-muted-foreground">Primary Fonts</span>
                      <div className="flex flex-wrap gap-1">
                        {brand.fonts.map((font) => (
                          <Badge key={font.name} variant="outline" className="text-xs">
                            {font.name}
                          </Badge>
                        ))}
                      </div>
                    </div>

                    <div className="flex gap-2 pt-2">
                      <Button size="sm" variant="outline" className="flex-1">
                        <Eye className="h-3 w-3 mr-1" />
                        Guidelines
                      </Button>
                      <Button size="sm" variant="outline" className="flex-1">
                        <Folder className="h-3 w-3 mr-1" />
                        Assets
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
            ))}
          </div>
        </TabsContent>

        {/* Compliance Tab */}
        <TabsContent value="compliance" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Shield className="h-5 w-5" />
                Compliance Dashboard
              </CardTitle>
              <CardDescription>
                Monitor brand compliance across all assets and identify violations
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-6">
                {mockAssets.map((asset) => (
                  <motion.div
                    key={asset.id}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="border rounded-lg p-6 space-y-4"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <img
                          src={asset.thumbnailUrl}
                          alt={asset.name}
                          className="w-12 h-12 object-cover rounded-lg bg-muted"
                        />
                        <div>
                          <h3 className="font-semibold">{asset.name}</h3>
                          <p className="text-sm text-muted-foreground">
                            {asset.brand} • Last checked: {new Date(asset.compliance.lastChecked).toLocaleString()}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="text-right">
                          <div className={`font-semibold ${getComplianceColor(asset.compliance.score)}`}>
                            {asset.compliance.score}%
                          </div>
                          <div className="text-xs text-muted-foreground">compliance</div>
                        </div>
                        {asset.compliance.isCompliant ? (
                          <CheckCircle className="h-5 w-5 text-green-600" />
                        ) : (
                          <AlertTriangle className="h-5 w-5 text-yellow-600" />
                        )}
                      </div>
                    </div>

                    <div className="space-y-3">
                      <div>
                        <span className="text-sm font-medium">Checked Rules</span>
                        <div className="flex flex-wrap gap-1 mt-1">
                          {asset.compliance.checkedRules.map((rule) => (
                            <Badge key={rule} variant="outline" className="text-xs">
                              {rule}
                            </Badge>
                          ))}
                        </div>
                      </div>

                      {asset.compliance.violations.length > 0 && (
                        <div>
                          <span className="text-sm font-medium text-red-600">Violations</span>
                          <div className="space-y-2 mt-2">
                            {asset.compliance.violations.map((violation, index) => (
                              <div key={index} className="border border-red-200 rounded-lg p-3 bg-red-50 dark:bg-red-900/20">
                                <div className="flex items-center gap-2">
                                  <Badge variant="destructive" className="text-xs">
                                    {violation.severity}
                                  </Badge>
                                  <span className="font-medium text-sm">{violation.rule}</span>
                                </div>
                                <p className="text-sm text-muted-foreground mt-1">
                                  {violation.description}
                                </p>
                                <p className="text-sm text-blue-600 mt-1">
                                  <strong>Recommendation:</strong> {violation.recommendation}
                                </p>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>

                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => checkCompliance.mutate(asset.id)}
                        disabled={checkCompliance.isPending}
                      >
                        <RefreshCw className="h-4 w-4 mr-2" />
                        Recheck
                      </Button>
                      {!asset.compliance.isCompliant && (
                        <Button variant="outline" size="sm">
                          <Edit3 className="h-4 w-4 mr-2" />
                          Fix Issues
                        </Button>
                      )}
                    </div>
                  </motion.div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Guidelines Tab */}
        <TabsContent value="guidelines" className="space-y-6">
          <div className="space-y-6">
            {mockBrands.map((brand) => (
              <Card key={brand.id}>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <img
                      src={brand.logo}
                      alt={brand.name}
                      className="w-6 h-6 object-contain"
                    />
                    {brand.name} Guidelines
                  </CardTitle>
                  <CardDescription>
                    Brand usage guidelines and best practices
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="space-y-4">
                      <div>
                        <h4 className="font-semibold mb-2">Logo Usage</h4>
                        <p className="text-sm text-muted-foreground">
                          {brand.guidelines.logoUsage}
                        </p>
                      </div>
                      <div>
                        <h4 className="font-semibold mb-2">Color Usage</h4>
                        <p className="text-sm text-muted-foreground">
                          {brand.guidelines.colorUsage}
                        </p>
                      </div>
                      <div>
                        <h4 className="font-semibold mb-2">Typography</h4>
                        <p className="text-sm text-muted-foreground">
                          {brand.guidelines.typographyRules}
                        </p>
                      </div>
                    </div>

                    <div className="space-y-4">
                      <div>
                        <h4 className="font-semibold mb-2">Do Not Use</h4>
                        <div className="space-y-1">
                          {brand.guidelines.doNotUse.map((item, index) => (
                            <div key={index} className="flex items-center gap-2 text-sm">
                              <X className="h-3 w-3 text-red-600" />
                              <span className="text-muted-foreground">{item}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                      <div>
                        <h4 className="font-semibold mb-2">Approved Combinations</h4>
                        <div className="space-y-1">
                          {brand.guidelines.approvedCombinations.map((item, index) => (
                            <div key={index} className="flex items-center gap-2 text-sm">
                              <CheckCircle className="h-3 w-3 text-green-600" />
                              <span className="text-muted-foreground">{item}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}