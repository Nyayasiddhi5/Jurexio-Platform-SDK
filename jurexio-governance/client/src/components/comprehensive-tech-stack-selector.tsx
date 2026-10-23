import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { 
  Code2, 
  Database, 
  Cloud, 
  Globe, 
  Smartphone,
  Server,
  Layers,
  Cpu,
  Brain
} from 'lucide-react';

interface TechStackConfig {
  frontend: string[];
  backend: string[];
  database: string[];
  mobile: string[];
  cloud: string[];
  aiml: string[];
  devops: string[];
  testing: string[];
}

interface ComprehensiveTechStackSelectorProps {
  selectedTechStack: TechStackConfig;
  onTechStackChange: (techStack: TechStackConfig) => void;
  mode: 'automatic' | 'manual';
  onModeChange: (mode: 'automatic' | 'manual') => void;
}

const TECH_STACKS = {
  frontend: [
    { name: 'React', icon: '⚛️', description: 'Modern UI library with hooks and components' },
    { name: 'Vue.js', icon: '🖖', description: 'Progressive framework for building UIs' },
    { name: 'Angular', icon: '🅰️', description: 'Full-featured framework by Google' },
    { name: 'Next.js', icon: '▲', description: 'React framework with SSR and routing' },
    { name: 'Nuxt.js', icon: '💚', description: 'Vue.js framework with SSR' },
    { name: 'Svelte', icon: '🔥', description: 'Compile-time optimized framework' },
    { name: 'Solid.js', icon: '💎', description: 'Fine-grained reactive UI library' },
    { name: 'Qwik', icon: '⚡', description: 'Resumable framework for instant loading' }
  ],
  backend: [
    { name: 'Node.js', icon: '🟢', description: 'JavaScript runtime for server-side development' },
    { name: 'Python', icon: '🐍', description: 'Versatile language for rapid development' },
    { name: 'Django', icon: '🎸', description: 'High-level Python web framework' },
    { name: 'FastAPI', icon: '⚡', description: 'Modern Python API framework' },
    { name: 'Express.js', icon: '🚂', description: 'Minimal Node.js web framework' },
    { name: 'NestJS', icon: '🏠', description: 'Scalable Node.js framework with TypeScript' },
    { name: 'Go', icon: '🐹', description: 'Efficient compiled language by Google' },
    { name: 'Rust', icon: '🦀', description: 'Memory-safe systems programming language' },
    { name: 'Java Spring', icon: '🍃', description: 'Enterprise Java framework' },
    { name: 'C# .NET', icon: '💙', description: 'Microsoft\'s cross-platform framework' },
    { name: 'Ruby on Rails', icon: '💎', description: 'Convention over configuration framework' },
    { name: 'PHP Laravel', icon: '🔴', description: 'Elegant PHP framework' }
  ],
  database: [
    { name: 'PostgreSQL', icon: '🐘', description: 'Advanced open-source relational database' },
    { name: 'MongoDB', icon: '🍃', description: 'Document-oriented NoSQL database' },
    { name: 'MySQL', icon: '🐬', description: 'Popular open-source relational database' },
    { name: 'Redis', icon: '🔴', description: 'In-memory data structure store' },
    { name: 'SQLite', icon: '📦', description: 'Lightweight embedded database' },
    { name: 'Supabase', icon: '⚡', description: 'Open-source Firebase alternative' },
    { name: 'PlanetScale', icon: '🌍', description: 'Serverless MySQL platform' },
    { name: 'Neon', icon: '🟢', description: 'Serverless PostgreSQL' },
    { name: 'Cassandra', icon: '🔵', description: 'Distributed NoSQL database' },
    { name: 'DynamoDB', icon: '🟠', description: 'AWS managed NoSQL database' },
    { name: 'Firebase', icon: '🔥', description: 'Google\'s mobile/web development platform' },
    { name: 'Elasticsearch', icon: '🔍', description: 'Search and analytics engine' }
  ],
  mobile: [
    { name: 'Flutter', icon: '💙', description: 'Google\'s cross-platform mobile framework' },
    { name: 'React Native', icon: '⚛️', description: 'Build native apps with React' },
    { name: 'Swift', icon: '🍎', description: 'Native iOS development language' },
    { name: 'Kotlin', icon: '🤖', description: 'Modern language for Android development' },
    { name: 'Xamarin', icon: '💜', description: 'Microsoft\'s cross-platform framework' },
    { name: 'Ionic', icon: '⚡', description: 'Hybrid mobile app development' },
    { name: 'Cordova', icon: '📱', description: 'Mobile apps with HTML, CSS & JS' },
    { name: 'NativeScript', icon: '🔵', description: 'Native mobile apps with JS/TS' }
  ],
  cloud: [
    { name: 'AWS', icon: '☁️', description: 'Amazon Web Services cloud platform' },
    { name: 'Google Cloud', icon: '🌥️', description: 'Google\'s cloud computing services' },
    { name: 'Azure', icon: '🔷', description: 'Microsoft\'s cloud computing platform' },
    { name: 'Vercel', icon: '▲', description: 'Frontend deployment and hosting' },
    { name: 'Netlify', icon: '🟢', description: 'Modern web development platform' },
    { name: 'Railway', icon: '🚂', description: 'Infrastructure platform for deployment' },
    { name: 'Render', icon: '🎨', description: 'Cloud platform for developers' },
    { name: 'DigitalOcean', icon: '🌊', description: 'Simple cloud computing' },
    { name: 'Heroku', icon: '💜', description: 'Platform as a service' },
    { name: 'Cloudflare', icon: '🟠', description: 'Web infrastructure and security' }
  ],
  aiml: [
    { name: 'TensorFlow', icon: '🧠', description: 'Google\'s machine learning framework' },
    { name: 'PyTorch', icon: '🔥', description: 'Facebook\'s deep learning framework' },
    { name: 'OpenAI API', icon: '🤖', description: 'GPT and other AI model APIs' },
    { name: 'Hugging Face', icon: '🤗', description: 'Transformers and model hub' },
    { name: 'LangChain', icon: '🦜', description: 'Framework for LLM applications' },
    { name: 'Scikit-learn', icon: '📊', description: 'Machine learning library for Python' },
    { name: 'Keras', icon: '🧬', description: 'High-level neural networks API' },
    { name: 'JAX', icon: '⚡', description: 'NumPy-compatible machine learning' }
  ],
  devops: [
    { name: 'Docker', icon: '🐳', description: 'Containerization platform' },
    { name: 'Kubernetes', icon: '☸️', description: 'Container orchestration system' },
    { name: 'GitHub Actions', icon: '⚙️', description: 'CI/CD automation platform' },
    { name: 'Jenkins', icon: '🔨', description: 'Open-source automation server' },
    { name: 'Terraform', icon: '🏗️', description: 'Infrastructure as code tool' },
    { name: 'Ansible', icon: '🔴', description: 'IT automation and configuration management' },
    { name: 'CircleCI', icon: '🔵', description: 'Continuous integration platform' },
    { name: 'GitLab CI', icon: '🦊', description: 'Built-in CI/CD for GitLab' }
  ],
  testing: [
    { name: 'Jest', icon: '🃏', description: 'JavaScript testing framework' },
    { name: 'Cypress', icon: '🌲', description: 'End-to-end testing framework' },
    { name: 'Playwright', icon: '🎭', description: 'Cross-browser automation' },
    { name: 'Vitest', icon: '⚡', description: 'Fast unit testing framework' },
    { name: 'Selenium', icon: '🔍', description: 'Web browser automation' },
    { name: 'PyTest', icon: '🐍', description: 'Python testing framework' },
    { name: 'Mocha', icon: '☕', description: 'JavaScript test framework' },
    { name: 'JUnit', icon: '☕', description: 'Java testing framework' }
  ]
};

export default function ComprehensiveTechStackSelector({ 
  selectedTechStack, 
  onTechStackChange, 
  mode, 
  onModeChange 
}: ComprehensiveTechStackSelectorProps) {
  const [searchTerm, setSearchTerm] = useState('');

  const toggleTech = (category: keyof TechStackConfig, techName: string) => {
    const currentSelection = selectedTechStack[category] || [];
    const isSelected = currentSelection.includes(techName);
    
    const newSelection = isSelected 
      ? currentSelection.filter(t => t !== techName)
      : [...currentSelection, techName];
    
    onTechStackChange({
      ...selectedTechStack,
      [category]: newSelection
    });
  };

  const getFilteredTechs = (category: keyof TechStackConfig) => {
    return TECH_STACKS[category].filter(tech => 
      tech.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      tech.description.toLowerCase().includes(searchTerm.toLowerCase())
    );
  };

  const getCategoryIcon = (category: keyof TechStackConfig) => {
    switch (category) {
      case 'frontend': return Globe;
      case 'backend': return Server;
      case 'database': return Database;
      case 'mobile': return Smartphone;
      case 'cloud': return Cloud;
      case 'aiml': return Brain;
      case 'devops': return Cpu;
      case 'testing': return Layers;
      default: return Code2;
    }
  };

  const getCategoryName = (category: keyof TechStackConfig) => {
    switch (category) {
      case 'frontend': return 'Frontend';
      case 'backend': return 'Backend';
      case 'database': return 'Database';
      case 'mobile': return 'Mobile';
      case 'cloud': return 'Cloud & Hosting';
      case 'aiml': return 'AI/ML';
      case 'devops': return 'DevOps';
      case 'testing': return 'Testing';
      default: return category;
    }
  };

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Code2 className="h-5 w-5" />
          Technology Stack Selection
        </CardTitle>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <Label>Mode:</Label>
            <Button
              variant={mode === 'automatic' ? 'default' : 'outline'}
              size="sm"
              onClick={() => onModeChange('automatic')}
            >
              Automatic
            </Button>
            <Button
              variant={mode === 'manual' ? 'default' : 'outline'}
              size="sm"
              onClick={() => onModeChange('manual')}
            >
              Manual
            </Button>
          </div>
          {mode === 'manual' && (
            <div className="flex-1 max-w-sm">
              <Input
                placeholder="Search technologies..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
          )}
        </div>
      </CardHeader>
      
      {mode === 'automatic' ? (
        <CardContent>
          <div className="text-center py-8">
            <Brain className="h-12 w-12 text-blue-500 mx-auto mb-4" />
            <h3 className="text-lg font-semibold mb-2">AI-Powered Stack Selection</h3>
            <p className="text-gray-600 mb-4">
              Our AI will analyze your project description and automatically select the optimal technology stack
            </p>
            <Badge variant="secondary">57+ AI agents will optimize your tech choices</Badge>
          </div>
        </CardContent>
      ) : (
        <CardContent>
          <Tabs defaultValue="frontend" className="w-full">
            <TabsList className="grid w-full grid-cols-8">
              {Object.keys(TECH_STACKS).map((category) => {
                const Icon = getCategoryIcon(category as keyof TechStackConfig);
                return (
                  <TabsTrigger key={category} value={category} className="flex items-center gap-1">
                    <Icon className="h-3 w-3" />
                    <span className="hidden sm:inline">{getCategoryName(category as keyof TechStackConfig)}</span>
                  </TabsTrigger>
                );
              })}
            </TabsList>
            
            {Object.entries(TECH_STACKS).map(([category, techs]) => (
              <TabsContent key={category} value={category} className="mt-4">
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                  {getFilteredTechs(category as keyof TechStackConfig).map((tech) => {
                    const isSelected = selectedTechStack[category as keyof TechStackConfig]?.includes(tech.name) || false;
                    return (
                      <Card 
                        key={tech.name}
                        className={`cursor-pointer transition-colors hover:shadow-md ${
                          isSelected ? 'bg-blue-50 border-blue-300 dark:bg-blue-900/20' : ''
                        }`}
                        onClick={() => toggleTech(category as keyof TechStackConfig, tech.name)}
                      >
                        <CardContent className="p-3">
                          <div className="flex items-center justify-between mb-2">
                            <div className="flex items-center gap-2">
                              <span className="text-lg">{tech.icon}</span>
                              <span className="font-medium">{tech.name}</span>
                            </div>
                            {isSelected && (
                              <Badge variant="default" size="sm">Selected</Badge>
                            )}
                          </div>
                          <p className="text-xs text-gray-600 dark:text-gray-400">
                            {tech.description}
                          </p>
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              </TabsContent>
            ))}
          </Tabs>
          
          {/* Selected Technologies Summary */}
          <div className="mt-6 p-4 bg-gray-50 dark:bg-gray-800 rounded-lg">
            <h4 className="font-medium mb-3">Selected Technologies:</h4>
            <div className="space-y-2">
              {Object.entries(selectedTechStack).map(([category, techs]) => {
                if (!techs || techs.length === 0) return null;
                return (
                  <div key={category} className="flex items-center gap-2 flex-wrap">
                    <Badge variant="outline" className="capitalize">
                      {getCategoryName(category as keyof TechStackConfig)}:
                    </Badge>
                    {techs.map((tech) => (
                      <Badge key={tech} variant="secondary">
                        {tech}
                      </Badge>
                    ))}
                  </div>
                );
              })}
            </div>
            {Object.values(selectedTechStack).every(arr => !arr || arr.length === 0) && (
              <p className="text-gray-500 text-sm">No technologies selected yet</p>
            )}
          </div>
        </CardContent>
      )}
    </Card>
  );
}