/**
 * Million-Scale Content Management System
 * Folder organization, version history, publishing workflows
 */

import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Progress } from '@/components/ui/progress';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Folder,
  FolderOpen,
  File,
  FileText,
  FileImage,
  FileVideo,
  FileAudio,
  FileCode,
  Search,
  Filter,
  Grid3x3,
  List,
  Download,
  Upload,
  Share2,
  Trash2,
  Edit,
  Clock,
  GitBranch,
  CheckCircle,
  AlertCircle,
  Play,
  Pause,
  RefreshCw,
  MoreVertical,
  ChevronRight,
  ChevronDown,
  Star,
  Copy,
  Move,
  Archive,
  Tags,
  Calendar,
  Users,
  Globe,
  Lock,
  Sparkles,
  TrendingUp,
  BarChart3,
  PieChart,
  Database
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface ContentItem {
  id: string;
  name: string;
  type: 'text' | 'image' | 'video' | 'audio' | 'presentation' | 'code' | 'folder';
  size?: number;
  created: Date;
  modified: Date;
  status: 'draft' | 'processing' | 'published' | 'archived';
  author: string;
  tags: string[];
  versions: number;
  views?: number;
  quality?: number;
  children?: ContentItem[];
  parentId?: string;
}

interface FolderStructure {
  id: string;
  name: string;
  isOpen: boolean;
  items: ContentItem[];
}

const generateMockContent = (count: number): ContentItem[] => {
  const types = ['text', 'image', 'video', 'audio', 'presentation', 'code'];
  const statuses = ['draft', 'processing', 'published', 'archived'];
  const items: ContentItem[] = [];
  
  for (let i = 0; i < count; i++) {
    const type = types[Math.floor(Math.random() * types.length)] as ContentItem['type'];
    items.push({
      id: `content-${i}`,
      name: `${type.charAt(0).toUpperCase()}${type.slice(1)} Content ${i + 1}`,
      type,
      size: Math.floor(Math.random() * 10000000),
      created: new Date(Date.now() - Math.random() * 30 * 24 * 60 * 60 * 1000),
      modified: new Date(Date.now() - Math.random() * 7 * 24 * 60 * 60 * 1000),
      status: statuses[Math.floor(Math.random() * statuses.length)] as ContentItem['status'],
      author: ['John Doe', 'Jane Smith', 'AI Agent'][Math.floor(Math.random() * 3)],
      tags: ['marketing', 'blog', 'social', 'campaign'].slice(0, Math.floor(Math.random() * 3) + 1),
      versions: Math.floor(Math.random() * 10) + 1,
      views: Math.floor(Math.random() * 10000),
      quality: Math.floor(Math.random() * 40) + 60
    });
  }
  
  return items;
};

export default function ContentManagementSystem() {
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [selectedItems, setSelectedItems] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterType, setFilterType] = useState('all');
  const [filterStatus, setFilterStatus] = useState('all');
  const [sortBy, setSortBy] = useState('modified');
  const [activeTab, setActiveTab] = useState('all');
  
  // Generate mock data for million-scale demonstration
  const [allContent] = useState<ContentItem[]>(generateMockContent(50));
  const [folders, setFolders] = useState<FolderStructure[]>([
    {
      id: 'marketing',
      name: 'Marketing Campaigns',
      isOpen: true,
      items: allContent.slice(0, 10)
    },
    {
      id: 'blog',
      name: 'Blog Posts',
      isOpen: false,
      items: allContent.slice(10, 20)
    },
    {
      id: 'social',
      name: 'Social Media',
      isOpen: false,
      items: allContent.slice(20, 30)
    },
    {
      id: 'videos',
      name: 'Video Productions',
      isOpen: false,
      items: allContent.slice(30, 40)
    },
    {
      id: 'archive',
      name: 'Archive',
      isOpen: false,
      items: allContent.slice(40, 50)
    }
  ]);

  const stats = {
    total: 1234567,
    published: 856432,
    draft: 234123,
    processing: 144012,
    storage: '2.3 TB',
    quality: 87
  };

  const getFileIcon = (type: ContentItem['type']) => {
    switch (type) {
      case 'text': return <FileText className="w-4 h-4" />;
      case 'image': return <FileImage className="w-4 h-4" />;
      case 'video': return <FileVideo className="w-4 h-4" />;
      case 'audio': return <FileAudio className="w-4 h-4" />;
      case 'code': return <FileCode className="w-4 h-4" />;
      case 'folder': return <Folder className="w-4 h-4" />;
      default: return <File className="w-4 h-4" />;
    }
  };

  const formatFileSize = (bytes?: number) => {
    if (!bytes) return '0 B';
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${sizes[i]}`;
  };

  const formatDate = (date: Date) => {
    return new Intl.RelativeTimeFormat('en', { numeric: 'auto' }).format(
      Math.ceil((date.getTime() - Date.now()) / (1000 * 60 * 60 * 24)),
      'day'
    );
  };

  const toggleFolder = (folderId: string) => {
    setFolders(prev => prev.map(folder => 
      folder.id === folderId ? { ...folder, isOpen: !folder.isOpen } : folder
    ));
  };

  const ContentGridItem = ({ item }: { item: ContentItem }) => (
    <motion.div
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      whileHover={{ scale: 1.02 }}
      className="relative group"
    >
      <Card className="h-full hover:shadow-lg transition-all cursor-pointer">
        <CardContent className="p-4">
          <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
            <Checkbox
              checked={selectedItems.includes(item.id)}
              onCheckedChange={(checked) => {
                if (checked) {
                  setSelectedItems([...selectedItems, item.id]);
                } else {
                  setSelectedItems(selectedItems.filter(id => id !== item.id));
                }
              }}
            />
          </div>
          
          <div className="flex flex-col items-center space-y-3">
            <div className={`w-16 h-16 rounded-lg flex items-center justify-center ${
              item.type === 'text' ? 'bg-blue-100 text-blue-600' :
              item.type === 'image' ? 'bg-green-100 text-green-600' :
              item.type === 'video' ? 'bg-purple-100 text-purple-600' :
              item.type === 'audio' ? 'bg-orange-100 text-orange-600' :
              'bg-gray-100 text-gray-600'
            }`}>
              {getFileIcon(item.type)}
            </div>
            
            <div className="text-center w-full">
              <p className="font-medium text-sm truncate">{item.name}</p>
              <p className="text-xs text-muted-foreground">{formatFileSize(item.size)}</p>
            </div>
            
            <div className="flex items-center justify-between w-full">
              <Badge variant={
                item.status === 'published' ? 'default' :
                item.status === 'processing' ? 'secondary' :
                item.status === 'draft' ? 'outline' :
                'destructive'
              } className="text-xs">
                {item.status}
              </Badge>
              
              {item.quality && (
                <div className="flex items-center space-x-1">
                  <div className={`w-2 h-2 rounded-full ${
                    item.quality >= 80 ? 'bg-green-500' :
                    item.quality >= 60 ? 'bg-yellow-500' :
                    'bg-red-500'
                  }`} />
                  <span className="text-xs">{item.quality}%</span>
                </div>
              )}
            </div>
            
            <div className="flex items-center space-x-2 text-xs text-muted-foreground">
              <Clock className="w-3 h-3" />
              <span>{formatDate(item.modified)}</span>
              <GitBranch className="w-3 h-3" />
              <span>v{item.versions}</span>
            </div>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );

  const ContentListItem = ({ item }: { item: ContentItem }) => (
    <motion.div
      initial={{ opacity: 0, x: -20 }}
      animate={{ opacity: 1, x: 0 }}
      className="group"
    >
      <Card className="hover:shadow-md transition-shadow">
        <CardContent className="p-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <Checkbox
                checked={selectedItems.includes(item.id)}
                onCheckedChange={(checked) => {
                  if (checked) {
                    setSelectedItems([...selectedItems, item.id]);
                  } else {
                    setSelectedItems(selectedItems.filter(id => id !== item.id));
                  }
                }}
              />
              
              <div className={`w-8 h-8 rounded flex items-center justify-center ${
                item.type === 'text' ? 'bg-blue-100 text-blue-600' :
                item.type === 'image' ? 'bg-green-100 text-green-600' :
                item.type === 'video' ? 'bg-purple-100 text-purple-600' :
                item.type === 'audio' ? 'bg-orange-100 text-orange-600' :
                'bg-gray-100 text-gray-600'
              }`}>
                {getFileIcon(item.type)}
              </div>
              
              <div className="flex-1">
                <p className="font-medium text-sm">{item.name}</p>
                <div className="flex items-center space-x-4 text-xs text-muted-foreground">
                  <span>{item.author}</span>
                  <span>{formatFileSize(item.size)}</span>
                  <span>{formatDate(item.modified)}</span>
                  <span>v{item.versions}</span>
                </div>
              </div>
            </div>
            
            <div className="flex items-center space-x-3">
              <div className="flex items-center space-x-2">
                {item.tags.map((tag, idx) => (
                  <Badge key={idx} variant="outline" className="text-xs">
                    {tag}
                  </Badge>
                ))}
              </div>
              
              <Badge variant={
                item.status === 'published' ? 'default' :
                item.status === 'processing' ? 'secondary' :
                item.status === 'draft' ? 'outline' :
                'destructive'
              }>
                {item.status}
              </Badge>
              
              {item.quality && (
                <div className="flex items-center space-x-1">
                  <Progress value={item.quality} className="w-12" />
                  <span className="text-xs">{item.quality}%</span>
                </div>
              )}
              
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon">
                    <MoreVertical className="w-4 h-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem>
                    <Edit className="w-4 h-4 mr-2" />
                    Edit
                  </DropdownMenuItem>
                  <DropdownMenuItem>
                    <Copy className="w-4 h-4 mr-2" />
                    Duplicate
                  </DropdownMenuItem>
                  <DropdownMenuItem>
                    <GitBranch className="w-4 h-4 mr-2" />
                    Version History
                  </DropdownMenuItem>
                  <DropdownMenuItem>
                    <Share2 className="w-4 h-4 mr-2" />
                    Share
                  </DropdownMenuItem>
                  <DropdownMenuItem>
                    <Archive className="w-4 h-4 mr-2" />
                    Archive
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem className="text-destructive">
                    <Trash2 className="w-4 h-4 mr-2" />
                    Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );

  return (
    <div className="w-full space-y-6">
      {/* Header Stats */}
      <div className="grid grid-cols-6 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-muted-foreground">Total Content</p>
                <p className="text-xl font-bold">{(stats.total / 1000000).toFixed(1)}M</p>
              </div>
              <Database className="w-6 h-6 text-primary/20" />
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-muted-foreground">Published</p>
                <p className="text-xl font-bold">{(stats.published / 1000).toFixed(0)}K</p>
              </div>
              <CheckCircle className="w-6 h-6 text-green-500/20" />
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-muted-foreground">Draft</p>
                <p className="text-xl font-bold">{(stats.draft / 1000).toFixed(0)}K</p>
              </div>
              <Edit className="w-6 h-6 text-yellow-500/20" />
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-muted-foreground">Processing</p>
                <p className="text-xl font-bold">{(stats.processing / 1000).toFixed(0)}K</p>
              </div>
              <RefreshCw className="w-6 h-6 text-blue-500/20 animate-spin" />
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-muted-foreground">Storage</p>
                <p className="text-xl font-bold">{stats.storage}</p>
              </div>
              <PieChart className="w-6 h-6 text-purple-500/20" />
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-muted-foreground">Avg Quality</p>
                <p className="text-xl font-bold">{stats.quality}%</p>
              </div>
              <TrendingUp className="w-6 h-6 text-green-500/20" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Controls Bar */}
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search content..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9 w-64"
            />
          </div>
          
          <Select value={filterType} onValueChange={setFilterType}>
            <SelectTrigger className="w-32">
              <SelectValue placeholder="Type" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Types</SelectItem>
              <SelectItem value="text">Text</SelectItem>
              <SelectItem value="image">Image</SelectItem>
              <SelectItem value="video">Video</SelectItem>
              <SelectItem value="audio">Audio</SelectItem>
              <SelectItem value="code">Code</SelectItem>
            </SelectContent>
          </Select>
          
          <Select value={filterStatus} onValueChange={setFilterStatus}>
            <SelectTrigger className="w-32">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Status</SelectItem>
              <SelectItem value="published">Published</SelectItem>
              <SelectItem value="draft">Draft</SelectItem>
              <SelectItem value="processing">Processing</SelectItem>
              <SelectItem value="archived">Archived</SelectItem>
            </SelectContent>
          </Select>
          
          <Select value={sortBy} onValueChange={setSortBy}>
            <SelectTrigger className="w-32">
              <SelectValue placeholder="Sort by" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="modified">Modified</SelectItem>
              <SelectItem value="created">Created</SelectItem>
              <SelectItem value="name">Name</SelectItem>
              <SelectItem value="size">Size</SelectItem>
              <SelectItem value="quality">Quality</SelectItem>
            </SelectContent>
          </Select>
        </div>
        
        <div className="flex items-center space-x-3">
          {selectedItems.length > 0 && (
            <div className="flex items-center space-x-2">
              <span className="text-sm text-muted-foreground">
                {selectedItems.length} selected
              </span>
              <Button variant="outline" size="sm">
                <Download className="w-4 h-4 mr-2" />
                Export
              </Button>
              <Button variant="outline" size="sm">
                <Archive className="w-4 h-4 mr-2" />
                Archive
              </Button>
              <Button variant="destructive" size="sm">
                <Trash2 className="w-4 h-4 mr-2" />
                Delete
              </Button>
            </div>
          )}
          
          <Button
            variant="outline"
            size="icon"
            onClick={() => setViewMode(viewMode === 'grid' ? 'list' : 'grid')}
          >
            {viewMode === 'grid' ? <List className="w-4 h-4" /> : <Grid3x3 className="w-4 h-4" />}
          </Button>
          
          <Button>
            <Upload className="w-4 h-4 mr-2" />
            Bulk Upload
          </Button>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex space-x-4">
        {/* Folder Tree */}
        <Card className="w-64">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Folders</CardTitle>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-[500px]">
              <div className="space-y-1">
                {folders.map(folder => (
                  <div key={folder.id}>
                    <Button
                      variant="ghost"
                      className="w-full justify-start"
                      onClick={() => toggleFolder(folder.id)}
                    >
                      {folder.isOpen ? (
                        <ChevronDown className="w-4 h-4 mr-2" />
                      ) : (
                        <ChevronRight className="w-4 h-4 mr-2" />
                      )}
                      {folder.isOpen ? (
                        <FolderOpen className="w-4 h-4 mr-2" />
                      ) : (
                        <Folder className="w-4 h-4 mr-2" />
                      )}
                      <span className="flex-1 text-left">{folder.name}</span>
                      <Badge variant="outline" className="text-xs">
                        {folder.items.length}
                      </Badge>
                    </Button>
                    
                    {folder.isOpen && (
                      <div className="ml-6 mt-1 space-y-1">
                        {folder.items.slice(0, 5).map(item => (
                          <Button
                            key={item.id}
                            variant="ghost"
                            className="w-full justify-start text-xs h-8"
                          >
                            {getFileIcon(item.type)}
                            <span className="ml-2 truncate">{item.name}</span>
                          </Button>
                        ))}
                        {folder.items.length > 5 && (
                          <p className="text-xs text-muted-foreground pl-3">
                            +{folder.items.length - 5} more
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>

        {/* Content Grid/List */}
        <div className="flex-1">
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList>
              <TabsTrigger value="all">All Content</TabsTrigger>
              <TabsTrigger value="recent">Recent</TabsTrigger>
              <TabsTrigger value="published">Published</TabsTrigger>
              <TabsTrigger value="drafts">Drafts</TabsTrigger>
              <TabsTrigger value="processing">Processing</TabsTrigger>
            </TabsList>
            
            <TabsContent value={activeTab} className="mt-4">
              <AnimatePresence mode="wait">
                {viewMode === 'grid' ? (
                  <motion.div
                    key="grid"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4"
                  >
                    {allContent.map(item => (
                      <ContentGridItem key={item.id} item={item} />
                    ))}
                  </motion.div>
                ) : (
                  <motion.div
                    key="list"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="space-y-2"
                  >
                    {allContent.map(item => (
                      <ContentListItem key={item.id} item={item} />
                    ))}
                  </motion.div>
                )}
              </AnimatePresence>
            </TabsContent>
          </Tabs>
        </div>
      </div>

      {/* Publishing Workflow Bar */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Publishing Workflow</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-6">
              <div className="flex items-center space-x-2">
                <div className="w-8 h-8 rounded-full bg-yellow-100 text-yellow-600 flex items-center justify-center">
                  <Edit className="w-4 h-4" />
                </div>
                <div>
                  <p className="text-sm font-medium">Draft</p>
                  <p className="text-xs text-muted-foreground">234,123 items</p>
                </div>
              </div>
              
              <ChevronRight className="w-4 h-4 text-muted-foreground" />
              
              <div className="flex items-center space-x-2">
                <div className="w-8 h-8 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center">
                  <RefreshCw className="w-4 h-4 animate-spin" />
                </div>
                <div>
                  <p className="text-sm font-medium">Processing</p>
                  <p className="text-xs text-muted-foreground">144,012 items</p>
                </div>
              </div>
              
              <ChevronRight className="w-4 h-4 text-muted-foreground" />
              
              <div className="flex items-center space-x-2">
                <div className="w-8 h-8 rounded-full bg-green-100 text-green-600 flex items-center justify-center">
                  <CheckCircle className="w-4 h-4" />
                </div>
                <div>
                  <p className="text-sm font-medium">Published</p>
                  <p className="text-xs text-muted-foreground">856,432 items</p>
                </div>
              </div>
            </div>
            
            <Button>
              <Sparkles className="w-4 h-4 mr-2" />
              Bulk Publish
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}