/**
 * Comprehensive Documentation System - Phase 4
 * 
 * Addressing documentation & support gap (20% incomplete):
 * API docs, user guides, developer SDK guides, enterprise deployment
 */

import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { 
  BookOpen, Code, Rocket, Users, Search, Download, ExternalLink,
  FileText, Video, MessageCircle, Wrench, Database, Shield, Globe,
  Lightbulb, CheckCircle, ArrowRight, Star, Heart, Zap, Clock
} from 'lucide-react';

// API Documentation Component
export function APIDocumentation() {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('all');

  const apiEndpoints = [
    {
      category: 'authentication',
      method: 'POST',
      endpoint: '/api/auth/login',
      description: 'Authenticate user and get access token',
      parameters: ['email', 'password'],
      response: 'User object with JWT token',
      example: `{
  "email": "user@example.com",
  "password": "securePassword123"
}`
    },
    {
      category: 'jurexio-orchestration',
      method: 'POST',
      endpoint: '/api/jurexio/generate',
      description: 'Generate content using Jurexio orchestration',
      parameters: ['prompt', 'type', 'options'],
      response: 'Generated content with metadata',
      example: `{
  "prompt": "Create a React component",
  "type": "code",
  "options": { "language": "typescript" }
}`
    },
    {
      category: 'platforms',
      method: 'GET',
      endpoint: '/api/platforms',
      description: 'Get all available platforms',
      parameters: [],
      response: 'Array of platform objects',
      example: 'No body required'
    },
    {
      category: 'content',
      method: 'POST',
      endpoint: '/api/content/create',
      description: 'Create new content using AI',
      parameters: ['type', 'prompt', 'settings'],
      response: 'Created content object',
      example: `{
  "type": "blog_post",
  "prompt": "Write about AI in healthcare",
  "settings": { "tone": "professional", "length": "medium" }
}`
    },
    {
      category: 'assistants',
      method: 'POST',
      endpoint: '/api/assistants/create',
      description: 'Create new AI assistant',
      parameters: ['name', 'type', 'configuration'],
      response: 'Assistant object with deployment URL',
      example: `{
  "name": "Customer Support Bot",
  "type": "chatbot",
  "configuration": { "language": "en", "voice": true }
}`
    },
    {
      category: 'analytics',
      method: 'GET',
      endpoint: '/api/analytics/performance',
      description: 'Get platform performance metrics',
      parameters: ['platform', 'timeRange'],
      response: 'Performance metrics object',
      example: 'Query: ?platform=code-studio&timeRange=7d'
    }
  ];

  const categories = [
    { id: 'all', name: 'All Endpoints', count: apiEndpoints.length },
    { id: 'authentication', name: 'Authentication', count: 1 },
    { id: 'jurexio-orchestration', name: 'Jurexio Orchestration', count: 1 },
    { id: 'platforms', name: 'Platforms', count: 1 },
    { id: 'content', name: 'Content', count: 1 },
    { id: 'assistants', name: 'Assistants', count: 1 },
    { id: 'analytics', name: 'Analytics', count: 1 }
  ];

  const filteredEndpoints = apiEndpoints.filter(endpoint => {
    const matchesSearch = endpoint.endpoint.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         endpoint.description.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesCategory = selectedCategory === 'all' || endpoint.category === selectedCategory;
    return matchesSearch && matchesCategory;
  });

  const getMethodColor = (method: string) => {
    switch (method) {
      case 'GET': return 'bg-green-100 text-green-800';
      case 'POST': return 'bg-blue-100 text-blue-800';
      case 'PUT': return 'bg-yellow-100 text-yellow-800';
      case 'DELETE': return 'bg-red-100 text-red-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row gap-4">
        <div className="flex-1">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
            <Input
              placeholder="Search endpoints..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10"
            />
          </div>
        </div>
        <div className="flex gap-2 flex-wrap">
          {categories.map((category) => (
            <Button
              key={category.id}
              variant={selectedCategory === category.id ? "default" : "outline"}
              size="sm"
              onClick={() => setSelectedCategory(category.id)}
              className="whitespace-nowrap"
            >
              {category.name}
              <Badge variant="secondary" className="ml-2">
                {category.count}
              </Badge>
            </Button>
          ))}
        </div>
      </div>

      <div className="grid gap-4">
        {filteredEndpoints.map((endpoint, index) => (
          <Card key={index} className="border-l-4 border-l-blue-500">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Badge className={getMethodColor(endpoint.method)}>
                    {endpoint.method}
                  </Badge>
                  <code className="text-sm font-mono bg-gray-100 px-2 py-1 rounded">
                    {endpoint.endpoint}
                  </code>
                </div>
                <Button variant="ghost" size="sm">
                  <ExternalLink className="h-4 w-4" />
                </Button>
              </div>
              <CardDescription className="mt-2">
                {endpoint.description}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid md:grid-cols-2 gap-4">
                <div>
                  <h4 className="font-medium text-sm mb-2">Parameters</h4>
                  <div className="space-y-1">
                    {endpoint.parameters.length > 0 ? (
                      endpoint.parameters.map((param) => (
                        <Badge key={param} variant="outline" className="mr-1">
                          {param}
                        </Badge>
                      ))
                    ) : (
                      <span className="text-sm text-gray-500">No parameters required</span>
                    )}
                  </div>
                </div>
                <div>
                  <h4 className="font-medium text-sm mb-2">Response</h4>
                  <p className="text-sm text-gray-600">{endpoint.response}</p>
                </div>
              </div>
              
              <div>
                <h4 className="font-medium text-sm mb-2">Example Request</h4>
                <pre className="bg-gray-50 p-3 rounded text-xs overflow-auto">
                  <code>{endpoint.example}</code>
                </pre>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

// User Guides Component
export function UserGuides() {
  const guides = [
    {
      category: 'Getting Started',
      items: [
        {
          title: 'Platform Overview',
          description: 'Introduction to Jurexio DevStudio\'s 5 integrated platforms',
          duration: '5 min read',
          difficulty: 'Beginner',
          icon: Rocket,
          tags: ['overview', 'introduction']
        },
        {
          title: 'Quick Start Guide',
          description: 'Create your first project in under 10 minutes',
          duration: '10 min tutorial',
          difficulty: 'Beginner',
          icon: Zap,
          tags: ['quickstart', 'tutorial']
        },
        {
          title: 'Account Setup',
          description: 'Complete account configuration and preferences',
          duration: '8 min read',
          difficulty: 'Beginner',
          icon: Users,
          tags: ['setup', 'configuration']
        }
      ]
    },
    {
      category: 'Code Studio',
      items: [
        {
          title: 'Building Your First App',
          description: 'Step-by-step app development with AI assistance',
          duration: '20 min tutorial',
          difficulty: 'Intermediate',
          icon: Code,
          tags: ['development', 'tutorial', 'app']
        },
        {
          title: 'Database Integration',
          description: 'Connect and manage databases in your projects',
          duration: '15 min read',
          difficulty: 'Intermediate',
          icon: Database,
          tags: ['database', 'integration']
        },
        {
          title: 'Deployment Guide',
          description: 'Deploy applications to production environments',
          duration: '12 min tutorial',
          difficulty: 'Advanced',
          icon: Globe,
          tags: ['deployment', 'production']
        }
      ]
    },
    {
      category: 'AI Assistant Builder',
      items: [
        {
          title: 'Creating Intelligent Assistants',
          description: 'Build AI assistants with voice and 3D avatars',
          duration: '25 min tutorial',
          difficulty: 'Intermediate',
          icon: MessageCircle,
          tags: ['ai', 'assistant', 'voice']
        },
        {
          title: 'RAG Implementation',
          description: 'Implement Retrieval Augmented Generation',
          duration: '18 min read',
          difficulty: 'Advanced',
          icon: BookOpen,
          tags: ['rag', 'knowledge', 'advanced']
        },
        {
          title: 'Multi-Language Support',
          description: 'Configure assistants for 62+ languages',
          duration: '10 min read',
          difficulty: 'Intermediate',
          icon: Globe,
          tags: ['multilingual', 'localization']
        }
      ]
    },
    {
      category: 'Content Studio',
      items: [
        {
          title: 'Content Generation Mastery',
          description: 'Create professional content across all formats',
          duration: '22 min tutorial',
          difficulty: 'Intermediate',
          icon: FileText,
          tags: ['content', 'generation', 'formats']
        },
        {
          title: 'Brand Management',
          description: 'Maintain consistent brand voice and style',
          duration: '15 min read',
          difficulty: 'Beginner',
          icon: Star,
          tags: ['branding', 'consistency', 'style']
        },
        {
          title: 'Bulk Processing',
          description: 'Process thousands of content pieces efficiently',
          duration: '12 min tutorial',
          difficulty: 'Advanced',
          icon: Zap,
          tags: ['bulk', 'automation', 'efficiency']
        }
      ]
    }
  ];

  const getDifficultyColor = (difficulty: string) => {
    switch (difficulty) {
      case 'Beginner': return 'bg-green-100 text-green-800';
      case 'Intermediate': return 'bg-yellow-100 text-yellow-800';
      case 'Advanced': return 'bg-red-100 text-red-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  return (
    <div className="space-y-8">
      {guides.map((category) => (
        <div key={category.category}>
          <h3 className="text-xl font-semibold mb-4 flex items-center gap-2">
            <BookOpen className="h-5 w-5 text-blue-600" />
            {category.category}
          </h3>
          
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
            {category.items.map((guide, index) => (
              <Card key={index} className="hover:shadow-lg transition-shadow cursor-pointer group">
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between">
                    <guide.icon className="h-8 w-8 text-blue-600 group-hover:text-blue-700 transition-colors" />
                    <div className="flex items-center gap-2">
                      <Badge className={getDifficultyColor(guide.difficulty)}>
                        {guide.difficulty}
                      </Badge>
                    </div>
                  </div>
                  <CardTitle className="text-lg group-hover:text-blue-600 transition-colors">
                    {guide.title}
                  </CardTitle>
                  <CardDescription>
                    {guide.description}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex items-center gap-2 text-sm text-gray-600">
                    <Clock className="h-3 w-3" />
                    {guide.duration}
                  </div>
                  
                  <div className="flex flex-wrap gap-1">
                    {guide.tags.map((tag) => (
                      <Badge key={tag} variant="secondary" className="text-xs">
                        {tag}
                      </Badge>
                    ))}
                  </div>

                  <Button variant="ghost" className="w-full group-hover:bg-blue-50 transition-colors">
                    Read Guide
                    <ArrowRight className="h-4 w-4 ml-2" />
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// Developer SDK Documentation
export function DeveloperSDK() {
  const sdkLanguages = [
    {
      name: 'JavaScript/TypeScript',
      logo: '📜',
      description: 'Full-featured SDK for web and Node.js applications',
      install: 'npm install @jurexio-devstudio/sdk',
      quickStart: `import { JurexioClient } from '@jurexio-devstudio/sdk';

const client = new JurexioClient({
  apiKey: 'your-api-key',
  baseURL: 'https://api.jurexio-devstudio.com'
});

// Generate content
const content = await client.content.generate({
  type: 'blog_post',
  prompt: 'AI in healthcare',
  options: { tone: 'professional' }
});`,
      features: ['Full TypeScript support', 'Real-time updates', 'Error handling', 'Auto-retry logic']
    },
    {
      name: 'Python',
      logo: '🐍',
      description: 'Pythonic SDK for data science and ML workflows',
      install: 'pip install jurexio-devstudio',
      quickStart: `from jurexio_devstudio import JurexioClient

client = JurexioClient(api_key='your-api-key')

# Create AI assistant
assistant = client.assistants.create(
    name='Data Analyst Bot',
    type='chatbot',
    configuration={'language': 'en', 'voice': True}
)`,
      features: ['Async/await support', 'Pandas integration', 'Jupyter compatibility', 'ML model helpers']
    },
    {
      name: 'REST API',
      logo: '🌐',
      description: 'Direct HTTP API access for any programming language',
      install: 'curl -H "Authorization: Bearer YOUR_API_KEY"',
      quickStart: `curl -X POST https://api.jurexio-devstudio.com/v1/content/generate \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "type": "image",
    "prompt": "Futuristic city skyline",
    "options": {"style": "photorealistic"}
  }'`,
      features: ['OpenAPI 3.0 spec', 'Webhook support', 'Rate limiting', 'Batch operations']
    }
  ];

  const codeExamples = [
    {
      title: 'Content Generation',
      code: `// Generate blog post
const post = await client.content.generate({
  type: 'blog_post',
  prompt: 'Benefits of AI automation',
  options: {
    tone: 'professional',
    length: 'medium',
    seo: true
  }
});

console.log(post.title, post.content);`
    },
    {
      title: 'AI Assistant Creation',
      code: `// Create customer support bot
const assistant = await client.assistants.create({
  name: 'Support Bot',
  type: 'customer_service',
  configuration: {
    voice: {
      enabled: true,
      language: 'en-US',
      gender: 'female'
    },
    knowledge_base: {
      files: ['faq.pdf', 'manual.docx'],
      web_urls: ['https://company.com/support']
    }
  }
});`
    },
    {
      title: 'Bulk Processing',
      code: `// Process multiple items
const results = await client.content.bulk({
  items: [
    { type: 'social_post', prompt: 'Product launch announcement' },
    { type: 'email', prompt: 'Welcome new subscribers' },
    { type: 'ad_copy', prompt: 'Summer sale promotion' }
  ],
  options: { parallel: true, batch_size: 10 }
});`
    }
  ];

  return (
    <div className="space-y-8">
      {/* SDK Languages */}
      <div>
        <h3 className="text-xl font-semibold mb-4 flex items-center gap-2">
          <Code className="h-5 w-5 text-blue-600" />
          Available SDKs
        </h3>
        
        <div className="grid lg:grid-cols-3 gap-6">
          {sdkLanguages.map((sdk) => (
            <Card key={sdk.name} className="border-l-4 border-l-blue-500">
              <CardHeader className="pb-3">
                <div className="flex items-center gap-3">
                  <span className="text-2xl">{sdk.logo}</span>
                  <CardTitle className="text-lg">{sdk.name}</CardTitle>
                </div>
                <CardDescription>{sdk.description}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <h4 className="font-medium text-sm mb-2">Installation</h4>
                  <code className="bg-gray-100 p-2 rounded text-xs block overflow-auto">
                    {sdk.install}
                  </code>
                </div>
                
                <div>
                  <h4 className="font-medium text-sm mb-2">Quick Start</h4>
                  <pre className="bg-gray-50 p-3 rounded text-xs overflow-auto max-h-40">
                    <code>{sdk.quickStart}</code>
                  </pre>
                </div>

                <div>
                  <h4 className="font-medium text-sm mb-2">Features</h4>
                  <div className="space-y-1">
                    {sdk.features.map((feature) => (
                      <div key={feature} className="flex items-center gap-2 text-sm">
                        <CheckCircle className="h-3 w-3 text-green-600" />
                        {feature}
                      </div>
                    ))}
                  </div>
                </div>

                <div className="flex gap-2">
                  <Button size="sm" variant="outline">
                    <Download className="h-3 w-3 mr-1" />
                    Download
                  </Button>
                  <Button size="sm" variant="ghost">
                    <ExternalLink className="h-3 w-3 mr-1" />
                    Docs
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>

      {/* Code Examples */}
      <div>
        <h3 className="text-xl font-semibold mb-4 flex items-center gap-2">
          <Lightbulb className="h-5 w-5 text-blue-600" />
          Code Examples
        </h3>
        
        <div className="grid lg:grid-cols-2 gap-6">
          {codeExamples.map((example, index) => (
            <Card key={index}>
              <CardHeader className="pb-3">
                <CardTitle className="text-lg">{example.title}</CardTitle>
              </CardHeader>
              <CardContent>
                <pre className="bg-gray-50 p-4 rounded text-sm overflow-auto">
                  <code>{example.code}</code>
                </pre>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}

// Enterprise Deployment Guide
export function EnterpriseDeployment() {
  const deploymentSteps = [
    {
      step: 1,
      title: 'Infrastructure Planning',
      description: 'Assess requirements and plan infrastructure architecture',
      tasks: [
        'Define scaling requirements (users, requests/sec)',
        'Choose deployment model (cloud, on-premise, hybrid)',
        'Plan network architecture and security zones',
        'Estimate resource requirements (CPU, memory, storage)'
      ],
      duration: '1-2 weeks',
      complexity: 'Medium'
    },
    {
      step: 2,
      title: 'Environment Setup',
      description: 'Configure production environments and dependencies',
      tasks: [
        'Set up Kubernetes clusters',
        'Configure load balancers and CDN',
        'Provision databases and storage',
        'Set up monitoring and logging infrastructure'
      ],
      duration: '2-3 weeks',
      complexity: 'High'
    },
    {
      step: 3,
      title: 'Security Configuration',
      description: 'Implement enterprise security and compliance',
      tasks: [
        'Configure SSL/TLS certificates',
        'Set up identity and access management',
        'Implement network security policies',
        'Configure backup and disaster recovery'
      ],
      duration: '1-2 weeks',
      complexity: 'High'
    },
    {
      step: 4,
      title: 'Application Deployment',
      description: 'Deploy Jurexio DevStudio platform components',
      tasks: [
        'Deploy core platform services',
        'Configure Jurexio orchestration layer',
        'Set up LLM provider integrations',
        'Configure platform-specific features'
      ],
      duration: '1 week',
      complexity: 'Medium'
    },
    {
      step: 5,
      title: 'Integration & Testing',
      description: 'Integrate with enterprise systems and test',
      tasks: [
        'Configure SSO integration',
        'Set up enterprise system connectors',
        'Run comprehensive testing suite',
        'Perform security and performance testing'
      ],
      duration: '2-3 weeks',
      complexity: 'High'
    },
    {
      step: 6,
      title: 'Go-Live & Support',
      description: 'Launch platform and establish support processes',
      tasks: [
        'Migrate data and configure users',
        'Train administrators and end users',
        'Set up monitoring and alerting',
        'Establish support and maintenance procedures'
      ],
      duration: '1-2 weeks',
      complexity: 'Medium'
    }
  ];

  const architectureComponents = [
    {
      name: 'Load Balancer',
      description: 'Distributes traffic across multiple instances',
      icon: Globe,
      requirements: ['High availability', 'SSL termination', 'Health checks']
    },
    {
      name: 'Application Tier',
      description: 'Jurexio DevStudio platform services',
      icon: Rocket,
      requirements: ['Auto-scaling', 'Session management', 'API gateway']
    },
    {
      name: 'Database Cluster',
      description: 'PostgreSQL with read replicas',
      icon: Database,
      requirements: ['Master-slave setup', 'Automated backups', 'Connection pooling']
    },
    {
      name: 'Cache Layer',
      description: 'Redis for session and application caching',
      icon: Zap,
      requirements: ['High availability', 'Persistence', 'Memory optimization']
    },
    {
      name: 'Security Layer',
      description: 'Authentication and authorization services',
      icon: Shield,
      requirements: ['SSO integration', 'RBAC', 'Audit logging']
    },
    {
      name: 'Monitoring',
      description: 'System and application monitoring',
      icon: Activity,
      requirements: ['Real-time alerts', 'Performance metrics', 'Log aggregation']
    }
  ];

  return (
    <div className="space-y-8">
      {/* Deployment Steps */}
      <div>
        <h3 className="text-xl font-semibold mb-4 flex items-center gap-2">
          <Rocket className="h-5 w-5 text-blue-600" />
          Deployment Timeline
        </h3>
        
        <div className="space-y-4">
          {deploymentSteps.map((step) => (
            <Card key={step.step} className="border-l-4 border-l-blue-500">
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 bg-blue-100 text-blue-700 rounded-full flex items-center justify-center text-sm font-semibold">
                      {step.step}
                    </div>
                    <div>
                      <CardTitle className="text-lg">{step.title}</CardTitle>
                      <CardDescription>{step.description}</CardDescription>
                    </div>
                  </div>
                  <div className="text-right">
                    <Badge variant="outline">{step.duration}</Badge>
                    <div className="text-xs text-gray-500 mt-1">{step.complexity} complexity</div>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="grid md:grid-cols-2 gap-3">
                  {step.tasks.map((task, index) => (
                    <div key={index} className="flex items-start gap-2 text-sm">
                      <CheckCircle className="h-4 w-4 text-green-600 mt-0.5 flex-shrink-0" />
                      <span>{task}</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>

      {/* Architecture Components */}
      <div>
        <h3 className="text-xl font-semibold mb-4 flex items-center gap-2">
          <Wrench className="h-5 w-5 text-blue-600" />
          Architecture Components
        </h3>
        
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
          {architectureComponents.map((component) => (
            <Card key={component.name} className="hover:shadow-lg transition-shadow">
              <CardHeader className="pb-3">
                <div className="flex items-center gap-3">
                  <component.icon className="h-6 w-6 text-blue-600" />
                  <CardTitle className="text-lg">{component.name}</CardTitle>
                </div>
                <CardDescription>{component.description}</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  <h4 className="font-medium text-sm">Requirements:</h4>
                  {component.requirements.map((req, index) => (
                    <div key={index} className="flex items-center gap-2 text-sm">
                      <CheckCircle className="h-3 w-3 text-green-600" />
                      {req}
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}

// Main Documentation Component
export default function ComprehensiveDocumentation() {
  const [activeTab, setActiveTab] = useState('api');

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-gray-100 p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="text-center space-y-4">
          <h1 className="text-4xl font-bold text-gray-900 flex items-center justify-center gap-3">
            <BookOpen className="h-10 w-10 text-blue-600" />
            Jurexio DevStudio Documentation
          </h1>
          <p className="text-xl text-gray-600 max-w-3xl mx-auto">
            Comprehensive guides, API references, and deployment instructions for 
            the world's most advanced AI development platform
          </p>
          <div className="flex justify-center gap-4">
            <Badge className="bg-green-100 text-green-800">
              <CheckCircle className="h-3 w-3 mr-1" />
              100% Production Ready
            </Badge>
            <Badge className="bg-blue-100 text-blue-800">
              <Star className="h-3 w-3 mr-1" />
              Enterprise Grade
            </Badge>
            <Badge className="bg-purple-100 text-purple-800">
              <Heart className="h-3 w-3 mr-1" />
              Developer Friendly
            </Badge>
          </div>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="api" className="flex items-center gap-2">
              <Code className="h-4 w-4" />
              API Reference
            </TabsTrigger>
            <TabsTrigger value="guides" className="flex items-center gap-2">
              <BookOpen className="h-4 w-4" />
              User Guides
            </TabsTrigger>
            <TabsTrigger value="sdk" className="flex items-center gap-2">
              <Wrench className="h-4 w-4" />
              Developer SDK
            </TabsTrigger>
            <TabsTrigger value="enterprise" className="flex items-center gap-2">
              <Shield className="h-4 w-4" />
              Enterprise
            </TabsTrigger>
          </TabsList>

          <TabsContent value="api" className="mt-6">
            <APIDocumentation />
          </TabsContent>

          <TabsContent value="guides" className="mt-6">
            <UserGuides />
          </TabsContent>

          <TabsContent value="sdk" className="mt-6">
            <DeveloperSDK />
          </TabsContent>

          <TabsContent value="enterprise" className="mt-6">
            <EnterpriseDeployment />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}