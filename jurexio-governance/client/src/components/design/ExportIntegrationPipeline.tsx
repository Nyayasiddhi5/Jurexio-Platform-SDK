// Phase 2 - Export & Integration Pipeline
// Principal Engineer & Release Captain Implementation
// Multi-format export with social platform integration

import React, { useState, useCallback } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { 
  Download, 
  Share2, 
  Image, 
  FileText, 
  Video, 
  Calendar,
  Twitter,
  Instagram,
  Linkedin,
  Facebook,
  Youtube,
  Settings,
  Zap,
  CheckCircle,
  Clock,
  AlertCircle
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { apiRequest } from '@/lib/queryClient';

interface ExportFormat {
  format: 'png' | 'svg' | 'pdf' | 'video' | 'gif' | 'jpg' | 'webp';
  quality: 'low' | 'medium' | 'high' | 'ultra';
  dimensions?: { width: number; height: number };
  optimization: boolean;
}

interface SocialPlatform {
  id: 'twitter' | 'instagram' | 'linkedin' | 'facebook' | 'youtube';
  name: string;
  icon: React.ComponentType<any>;
  connected: boolean;
  formats: string[];
  maxDimensions: { width: number; height: number };
}

interface ExportJob {
  id: string;
  format: ExportFormat;
  status: 'queued' | 'processing' | 'completed' | 'error';
  progress: number;
  downloadUrl?: string;
  error?: string;
  estimatedTime?: number;
}

interface SocialPost {
  platform: string;
  title: string;
  description: string;
  scheduledTime?: string;
  hashtags: string[];
  status: 'draft' | 'scheduled' | 'posted';
}

interface ExportIntegrationPipelineProps {
  designId: string;
  designData?: any;
  className?: string;
}

export const ExportIntegrationPipeline: React.FC<ExportIntegrationPipelineProps> = ({
  designId,
  designData,
  className
}) => {
  const { toast } = useToast();
  
  const [activeTab, setActiveTab] = useState('export');
  const [exportJobs, setExportJobs] = useState<ExportJob[]>([]);
  const [selectedFormat, setSelectedFormat] = useState<ExportFormat>({
    format: 'png',
    quality: 'high',
    optimization: true
  });
  const [socialPost, setSocialPost] = useState<SocialPost>({
    platform: '',
    title: '',
    description: '',
    hashtags: [],
    status: 'draft'
  });

  // Social platform configurations
  const socialPlatforms: SocialPlatform[] = [
    {
      id: 'twitter',
      name: 'Twitter/X',
      icon: Twitter,
      connected: false,
      formats: ['png', 'jpg', 'gif', 'video'],
      maxDimensions: { width: 1200, height: 675 }
    },
    {
      id: 'instagram',
      name: 'Instagram',
      icon: Instagram,
      connected: false,
      formats: ['jpg', 'png', 'video'],
      maxDimensions: { width: 1080, height: 1080 }
    },
    {
      id: 'linkedin',
      name: 'LinkedIn',
      icon: Linkedin,
      connected: false,
      formats: ['png', 'jpg', 'pdf'],
      maxDimensions: { width: 1200, height: 627 }
    },
    {
      id: 'facebook',
      name: 'Facebook',
      icon: Facebook,
      connected: false,
      formats: ['png', 'jpg', 'video'],
      maxDimensions: { width: 1200, height: 630 }
    },
    {
      id: 'youtube',
      name: 'YouTube',
      icon: Youtube,
      connected: false,
      formats: ['jpg', 'png'],
      maxDimensions: { width: 1280, height: 720 }
    }
  ];

  // Export mutation
  const exportMutation = useMutation({
    mutationFn: async (exportRequest: { designId: string; format: ExportFormat }) => {
      const jobId = `job-${Date.now()}`;
      
      // Add job to queue
      const newJob: ExportJob = {
        id: jobId,
        format: exportRequest.format,
        status: 'queued',
        progress: 0,
        estimatedTime: getEstimatedTime(exportRequest.format.format)
      };
      
      setExportJobs(prev => [...prev, newJob]);

      // Start export process
      return await apiRequest('/api/design/export', {
        method: 'POST',
        body: JSON.stringify({
          designId: exportRequest.designId,
          format: exportRequest.format,
          jobId,
          optimization: {
            webOptimized: exportRequest.format.optimization,
            compressionLevel: exportRequest.format.quality === 'high' ? 85 : 
                            exportRequest.format.quality === 'medium' ? 70 : 50
          }
        })
      });
    },
    onSuccess: (data, variables) => {
      // Update job status
      setExportJobs(prev => prev.map(job => 
        job.id === data.jobId ? {
          ...job,
          status: 'completed',
          progress: 100,
          downloadUrl: data.downloadUrl
        } : job
      ));
      
      toast({
        title: 'Export Complete',
        description: `Design exported as ${variables.format.format.toUpperCase()}`
      });
    },
    onError: (error: any, variables) => {
      setExportJobs(prev => prev.map(job => 
        job.format === variables.format && job.status === 'processing' ? {
          ...job,
          status: 'error',
          error: error.message
        } : job
      ));
      
      toast({
        title: 'Export Failed',
        description: error.message || 'Please try again',
        variant: 'destructive'
      });
    }
  });

  // Social publishing mutation
  const publishToSocialMutation = useMutation({
    mutationFn: async (socialData: {
      platform: string;
      post: SocialPost;
      designId: string;
      imageFormat: string;
    }) => {
      return await apiRequest('/api/social/publish', {
        method: 'POST',
        body: JSON.stringify({
          platform: socialData.platform,
          content: {
            title: socialData.post.title,
            description: socialData.post.description,
            hashtags: socialData.post.hashtags
          },
          media: {
            designId: socialData.designId,
            format: socialData.imageFormat
          },
          scheduling: socialData.post.scheduledTime ? {
            publishAt: socialData.post.scheduledTime
          } : undefined
        })
      });
    },
    onSuccess: (data) => {
      toast({
        title: 'Posted Successfully',
        description: `Content published to ${data.platform}`
      });
    },
    onError: (error: any) => {
      toast({
        title: 'Publishing Failed',
        description: error.message || 'Please check your social media connections',
        variant: 'destructive'
      });
    }
  });

  // Social connection mutation
  const connectSocialMutation = useMutation({
    mutationFn: async (platform: string) => {
      return await apiRequest('/api/social/connect', {
        method: 'POST',
        body: JSON.stringify({ platform })
      });
    },
    onSuccess: (data) => {
      // Update platform connection status
      toast({
        title: 'Connected',
        description: `Successfully connected to ${data.platform}`
      });
    }
  });

  const getEstimatedTime = (format: string): number => {
    switch (format) {
      case 'png':
      case 'jpg': return 5;
      case 'svg': return 3;
      case 'pdf': return 8;
      case 'video': return 30;
      case 'gif': return 15;
      default: return 5;
    }
  };

  const handleExport = useCallback(() => {
    exportMutation.mutate({ designId, format: selectedFormat });
  }, [designId, selectedFormat, exportMutation]);

  const handlePublishToSocial = useCallback((platform: string) => {
    if (!socialPost.title.trim()) {
      toast({
        title: 'Title Required',
        description: 'Please add a title for your social media post',
        variant: 'destructive'
      });
      return;
    }

    publishToSocialMutation.mutate({
      platform,
      post: socialPost,
      designId,
      imageFormat: selectedFormat.format
    });
  }, [socialPost, designId, selectedFormat, publishToSocialMutation]);

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'completed': return <CheckCircle className="w-4 h-4 text-green-500" />;
      case 'processing': return <Clock className="w-4 h-4 text-blue-500" />;
      case 'error': return <AlertCircle className="w-4 h-4 text-red-500" />;
      default: return <Clock className="w-4 h-4 text-gray-500" />;
    }
  };

  const formatOptions = [
    { value: 'png', label: 'PNG', description: 'High quality with transparency' },
    { value: 'jpg', label: 'JPEG', description: 'Optimized for web and sharing' },
    { value: 'svg', label: 'SVG', description: 'Vector format, infinitely scalable' },
    { value: 'pdf', label: 'PDF', description: 'Document format for printing' },
    { value: 'webp', label: 'WebP', description: 'Modern web format, smaller files' },
    { value: 'gif', label: 'GIF', description: 'Animated format for social media' },
    { value: 'video', label: 'MP4 Video', description: 'Video format for presentations' }
  ];

  const qualityOptions = [
    { value: 'low', label: 'Low', description: 'Smallest file size' },
    { value: 'medium', label: 'Medium', description: 'Balanced quality and size' },
    { value: 'high', label: 'High', description: 'Best quality, larger files' },
    { value: 'ultra', label: 'Ultra', description: 'Maximum quality for print' }
  ];

  return (
    <div className={className}>
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="export">Export</TabsTrigger>
          <TabsTrigger value="social">Social Publishing</TabsTrigger>
          <TabsTrigger value="jobs">Export Jobs</TabsTrigger>
        </TabsList>

        {/* Export Tab */}
        <TabsContent value="export" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Download className="h-5 w-5" />
                Export Configuration
              </CardTitle>
              <CardDescription>
                Choose format, quality, and optimization settings
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-4">
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Format</label>
                    <Select 
                      value={selectedFormat.format} 
                      onValueChange={(value: any) => 
                        setSelectedFormat(prev => ({ ...prev, format: value }))
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {formatOptions.map(option => (
                          <SelectItem key={option.value} value={option.value}>
                            <div>
                              <div className="font-medium">{option.label}</div>
                              <div className="text-xs text-muted-foreground">
                                {option.description}
                              </div>
                            </div>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <label className="text-sm font-medium">Quality</label>
                    <Select 
                      value={selectedFormat.quality} 
                      onValueChange={(value: any) => 
                        setSelectedFormat(prev => ({ ...prev, quality: value }))
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {qualityOptions.map(option => (
                          <SelectItem key={option.value} value={option.value}>
                            <div>
                              <div className="font-medium">{option.label}</div>
                              <div className="text-xs text-muted-foreground">
                                {option.description}
                              </div>
                            </div>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="space-y-4">
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Dimensions</label>
                    <div className="grid grid-cols-2 gap-2">
                      <Input
                        type="number"
                        placeholder="Width"
                        value={selectedFormat.dimensions?.width || ''}
                        onChange={(e) => setSelectedFormat(prev => ({
                          ...prev,
                          dimensions: {
                            ...prev.dimensions,
                            width: parseInt(e.target.value) || 0,
                            height: prev.dimensions?.height || 0
                          }
                        }))}
                      />
                      <Input
                        type="number"
                        placeholder="Height"
                        value={selectedFormat.dimensions?.height || ''}
                        onChange={(e) => setSelectedFormat(prev => ({
                          ...prev,
                          dimensions: {
                            width: prev.dimensions?.width || 0,
                            height: parseInt(e.target.value) || 0
                          }
                        }))}
                      />
                    </div>
                  </div>

                  <div className="flex items-center space-x-2">
                    <input
                      type="checkbox"
                      id="optimization"
                      checked={selectedFormat.optimization}
                      onChange={(e) => setSelectedFormat(prev => ({
                        ...prev,
                        optimization: e.target.checked
                      }))}
                    />
                    <label htmlFor="optimization" className="text-sm">
                      Web optimization (smaller file size)
                    </label>
                  </div>
                </div>
              </div>

              <Button
                onClick={handleExport}
                disabled={exportMutation.isPending}
                className="w-full"
                size="lg"
              >
                {exportMutation.isPending ? (
                  <>
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                    Exporting...
                  </>
                ) : (
                  <>
                    <Download className="mr-2 h-4 w-4" />
                    Export Design
                  </>
                )}
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Social Publishing Tab */}
        <TabsContent value="social" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Share2 className="h-5 w-5" />
                Social Media Publishing
              </CardTitle>
              <CardDescription>
                Share your design directly to social platforms
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Platform Connections */}
              <div className="space-y-4">
                <label className="text-sm font-medium">Connected Platforms</label>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                  {socialPlatforms.map(platform => {
                    const Icon = platform.icon;
                    return (
                      <div
                        key={platform.id}
                        className="flex items-center justify-between p-3 border rounded"
                      >
                        <div className="flex items-center gap-2">
                          <Icon className="w-5 h-5" />
                          <span className="text-sm">{platform.name}</span>
                        </div>
                        <Button
                          size="sm"
                          variant={platform.connected ? "secondary" : "outline"}
                          onClick={() => !platform.connected && connectSocialMutation.mutate(platform.id)}
                          disabled={connectSocialMutation.isPending}
                        >
                          {platform.connected ? "Connected" : "Connect"}
                        </Button>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Post Configuration */}
              <div className="space-y-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium">Post Title</label>
                  <Input
                    placeholder="Enter your post title..."
                    value={socialPost.title}
                    onChange={(e) => setSocialPost(prev => ({ ...prev, title: e.target.value }))}
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium">Description</label>
                  <Textarea
                    placeholder="Describe your design..."
                    value={socialPost.description}
                    onChange={(e) => setSocialPost(prev => ({ ...prev, description: e.target.value }))}
                    rows={3}
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium">Hashtags</label>
                  <Input
                    placeholder="#design #creative #ui"
                    value={socialPost.hashtags.join(' ')}
                    onChange={(e) => setSocialPost(prev => ({
                      ...prev,
                      hashtags: e.target.value.split(' ').filter(tag => tag.startsWith('#'))
                    }))}
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium">Schedule (Optional)</label>
                  <Input
                    type="datetime-local"
                    value={socialPost.scheduledTime || ''}
                    onChange={(e) => setSocialPost(prev => ({
                      ...prev,
                      scheduledTime: e.target.value
                    }))}
                  />
                </div>
              </div>

              {/* Publishing Actions */}
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                {socialPlatforms.map(platform => (
                  <Button
                    key={platform.id}
                    variant="outline"
                    className="flex items-center gap-2"
                    onClick={() => handlePublishToSocial(platform.id)}
                    disabled={!platform.connected || publishToSocialMutation.isPending}
                  >
                    <platform.icon className="w-4 h-4" />
                    {socialPost.scheduledTime ? 'Schedule' : 'Publish'}
                  </Button>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Export Jobs Tab */}
        <TabsContent value="jobs" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Settings className="h-5 w-5" />
                Export Jobs
              </CardTitle>
              <CardDescription>
                Monitor your export progress and download files
              </CardDescription>
            </CardHeader>
            <CardContent>
              {exportJobs.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  No export jobs yet. Start an export to see progress here.
                </div>
              ) : (
                <div className="space-y-4">
                  {exportJobs.map(job => (
                    <div
                      key={job.id}
                      className="flex items-center justify-between p-4 border rounded"
                    >
                      <div className="flex items-center gap-4">
                        {getStatusIcon(job.status)}
                        <div>
                          <div className="font-medium">
                            {job.format.format.toUpperCase()} Export
                          </div>
                          <div className="text-sm text-muted-foreground">
                            Quality: {job.format.quality} • 
                            {job.status === 'processing' && job.estimatedTime && 
                              ` ~${job.estimatedTime}s remaining`
                            }
                            {job.status === 'error' && job.error}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-4">
                        {job.status === 'processing' && (
                          <Progress value={job.progress} className="w-20" />
                        )}
                        {job.status === 'completed' && job.downloadUrl && (
                          <Button size="sm" asChild>
                            <a href={job.downloadUrl} download>
                              <Download className="w-4 h-4 mr-2" />
                              Download
                            </a>
                          </Button>
                        )}
                        <Badge variant={
                          job.status === 'completed' ? 'default' :
                          job.status === 'error' ? 'destructive' : 'secondary'
                        }>
                          {job.status}
                        </Badge>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default ExportIntegrationPipeline;