import { motion } from 'framer-motion';
import type { ElementType } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { 
  Code, Palette, Bot, Gamepad2, Building, 
  Activity, Zap, Users, TrendingUp, CheckCircle2,
  LayoutDashboard, Wand2
} from 'lucide-react';
import { useLocation } from 'wouter';

interface Platform {
  id: string;
  name: string;
  description: string;
  icon: ElementType;
  route: string;
  gradient: string;
  agentCount: number;
  status: 'ready' | 'active' | 'building';
}

const platforms: Platform[] = [
  // admin-console tile removed 2026-05-06 (Phase A) — admin-console.tsx deleted.
  // The /admin-console route still exists as an alias for /command-centre.
  {
    id: 'studio-console',
    name: 'Builder AI Studio',
    description: 'Creative workflow management with project builder and pipeline editor',
    icon: Wand2,
    route: '/studio-console',
    gradient: 'from-violet-500 to-purple-600',
    agentCount: 45,
    status: 'active'
  },
  {
    id: 'code-studio',
    name: 'Code Studio',
    description: 'AI-powered development with GitHub integration, IDE tools, and project management',
    icon: Code,
    route: '/platforms/code-studio',
    gradient: 'from-blue-500 to-cyan-500',
    agentCount: 25,
    status: 'ready'
  },
  {
    id: 'content-studio', 
    name: 'Content Studio',
    description: 'Create, edit, and publish multimedia content with AI assistance',
    icon: Palette,
    route: '/platforms/content-studio',
    gradient: 'from-purple-500 to-pink-500',
    agentCount: 20,
    status: 'ready'
  },
  {
    id: 'ai-assistant-builder',
    name: 'AI Assistant Studio', 
    description: 'Build custom AI assistants with RAG, voice cloning, and multi-language support',
    icon: Bot,
    route: '/platforms/ai-assistant-builder',
    gradient: 'from-green-500 to-emerald-500',
    agentCount: 15,
    status: 'ready'
  },
  {
    id: 'game-builder',
    name: 'Game Studio',
    description: 'Create games with AI-generated assets, multiplayer networking, and monetization',
    icon: Gamepad2,
    route: '/platforms/game-builder', 
    gradient: 'from-orange-500 to-red-500',
    agentCount: 20,
    status: 'ready'
  },
  {
    id: 'business-studio',
    name: 'Business Studio',
    description: 'Enterprise solutions with CRM/ERP integration, compliance, and analytics',
    icon: Building,
    route: '/platforms/business-studio',
    gradient: 'from-indigo-500 to-purple-500',
    agentCount: 25,
    status: 'ready'
  }
];

export default function HomeHub() {
  const [, setLocation] = useLocation();

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-900 dark:to-gray-800 p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-center mb-12"
        >
          <h1 className="text-4xl font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent mb-4">
            Jurexio Orchestration Layer
          </h1>
          <p className="text-xl text-gray-600 dark:text-gray-300 mb-6">
            Jurexio Legal Platform - Technical Dashboard
          </p>
          
          {/* Jurexio Orchestration Status */}
          <Card className="max-w-md mx-auto mb-8" data-testid="card-jurexio-orchestration-status">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Activity className="h-5 w-5 text-green-500" data-testid="icon-jurexio-status" />
                  <span className="text-sm font-medium" data-testid="text-jurexio-version">v4.1.1 Active</span>
                </div>
                <div className="flex gap-2">
                  <Badge variant="outline" className="text-xs" data-testid="badge-agent-count">267+ Agents</Badge>
                  <Badge variant="outline" className="text-xs" data-testid="badge-llm-count">23+ LLMs</Badge>
                </div>
              </div>
            </CardContent>
          </Card>
        </motion.div>

        {/* Platform Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {platforms.map((platform, index) => {
            const Icon = platform.icon;
            return (
              <motion.div
                key={platform.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.1 }}
              >
                <Card className="cursor-pointer hover:shadow-lg transition-shadow h-full" data-testid={`card-platform-${platform.id}`}>
                  <CardHeader>
                    <div className={`w-12 h-12 rounded-lg bg-gradient-to-r ${platform.gradient} flex items-center justify-center mb-4`} data-testid={`icon-container-${platform.id}`}>
                      <Icon className="h-6 w-6 text-white" data-testid={`icon-${platform.id}`} />
                    </div>
                    <CardTitle className="text-xl" data-testid={`title-${platform.id}`}>{platform.name}</CardTitle>
                    <CardDescription data-testid={`description-${platform.id}`}>{platform.description}</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="flex items-center justify-between mb-4">
                      <div className="flex items-center gap-2">
                        <Users className="h-4 w-4 text-gray-500" data-testid={`icon-agents-${platform.id}`} />
                        <span className="text-sm text-gray-600" data-testid={`text-agent-count-${platform.id}`}>{platform.agentCount} agents</span>
                      </div>
                      <Badge variant={platform.status === 'ready' ? 'default' : 'secondary'} data-testid={`badge-status-${platform.id}`}>
                        <CheckCircle2 className="h-3 w-3 mr-1" />
                        {platform.status}
                      </Badge>
                    </div>
                    <Button 
                      className="w-full" 
                      onClick={() => setLocation(platform.route)}
                      data-testid={`button-launch-${platform.id}`}
                    >
                      Launch Platform
                    </Button>
                  </CardContent>
                </Card>
              </motion.div>
            );
          })}
        </div>
      </div>
    </div>
  );
}