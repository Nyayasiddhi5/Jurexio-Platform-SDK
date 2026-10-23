/**
 * Continuous Chat Enhancement Component - Cursor-style
 * Context-aware code modifications with real-time preview
 */

import React, { useState, useRef, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import {
  Send,
  Bot,
  User,
  Code,
  FileText,
  GitBranch,
  Sparkles,
  Zap,
  Edit3,
  Eye,
  Check,
  X,
  RefreshCw,
  Terminal,
  Bug,
  Lightbulb,
  Wand2,
  ArrowRight,
  Copy,
  Play,
  Pause,
  Settings,
  MessageSquare,
  FileCode,
  Database,
  Server,
  Layout
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';

interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: Date;
  codeChanges?: CodeChange[];
  context?: {
    file?: string;
    lines?: { start: number; end: number };
    language?: string;
  };
  suggestions?: Suggestion[];
  status?: 'thinking' | 'applying' | 'complete' | 'error';
}

interface CodeChange {
  file: string;
  type: 'add' | 'modify' | 'delete';
  before?: string;
  after?: string;
  lines?: { start: number; end: number };
  description: string;
}

interface Suggestion {
  id: string;
  type: 'optimization' | 'bug-fix' | 'refactor' | 'feature';
  title: string;
  description: string;
  priority: 'low' | 'medium' | 'high';
  estimatedTime: string;
}

interface ContinuousChatProps {
  projectId: string;
  currentFile?: string;
  currentCode?: string;
  onCodeUpdate: (file: string, code: string) => void;
  onFileCreate: (file: string, code: string) => void;
}

export default function ContinuousChatEnhancement({
  projectId,
  currentFile,
  currentCode,
  onCodeUpdate,
  onFileCreate
}: ContinuousChatProps) {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: '1',
      role: 'system',
      content: 'I\'m your AI coding assistant powered by Jurexio Orchestration with 14+ LLMs and 100+ specialized agents. I can help you modify code, fix bugs, add features, and optimize performance in real-time.',
      timestamp: new Date(),
      status: 'complete'
    }
  ]);
  const [input, setInput] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [activeTab, setActiveTab] = useState('chat');
  const [contextMode, setContextMode] = useState<'file' | 'project' | 'smart'>('smart');
  const [autoApply, setAutoApply] = useState(true);
  const [showPreview, setShowPreview] = useState(true);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleSendMessage = async () => {
    if (!input.trim() || isProcessing) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: input,
      timestamp: new Date(),
      context: currentFile ? {
        file: currentFile,
        language: currentFile.split('.').pop()
      } : undefined
    };

    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setIsProcessing(true);

    // Simulate AI processing
    const assistantMessage: Message = {
      id: (Date.now() + 1).toString(),
      role: 'assistant',
      content: '',
      timestamp: new Date(),
      status: 'thinking'
    };

    setMessages(prev => [...prev, assistantMessage]);

    // Simulate response generation
    setTimeout(() => {
      const response = generateAIResponse(userMessage.content);
      setMessages(prev => prev.map(msg => 
        msg.id === assistantMessage.id 
          ? { ...msg, ...response, status: 'complete' }
          : msg
      ));
      
      // Auto-apply changes if enabled
      if (autoApply && response.codeChanges) {
        applyCodeChanges(response.codeChanges);
      }
      
      setIsProcessing(false);
    }, 2000);
  };

  const generateAIResponse = (query: string): Partial<Message> => {
    // Simulate intelligent response based on query
    if (query.toLowerCase().includes('optimize')) {
      return {
        content: 'I\'ve analyzed your code and identified several optimization opportunities. Here are the changes I recommend:',
        codeChanges: [
          {
            file: currentFile || 'app.tsx',
            type: 'modify',
            before: 'const data = items.filter(item => item.active).map(item => item.value);',
            after: 'const data = items.reduce((acc, item) => item.active ? [...acc, item.value] : acc, []);',
            description: 'Optimized array operations to reduce iterations',
            lines: { start: 45, end: 45 }
          }
        ],
        suggestions: [
          {
            id: '1',
            type: 'optimization',
            title: 'Use React.memo for expensive components',
            description: 'Wrap frequently re-rendered components with React.memo to prevent unnecessary renders',
            priority: 'medium',
            estimatedTime: '5 mins'
          },
          {
            id: '2',
            type: 'optimization',
            title: 'Implement virtual scrolling',
            description: 'For large lists, implement virtual scrolling to improve performance',
            priority: 'high',
            estimatedTime: '15 mins'
          }
        ]
      };
    } else if (query.toLowerCase().includes('fix') || query.toLowerCase().includes('bug')) {
      return {
        content: 'I\'ve identified and fixed the bug in your code. The issue was with the async state update:',
        codeChanges: [
          {
            file: currentFile || 'app.tsx',
            type: 'modify',
            before: 'setState(state + 1);',
            after: 'setState(prevState => prevState + 1);',
            description: 'Fixed race condition in state update',
            lines: { start: 23, end: 23 }
          }
        ]
      };
    } else if (query.toLowerCase().includes('add') || query.toLowerCase().includes('feature')) {
      return {
        content: 'I\'ll add the requested feature. Here\'s the implementation:',
        codeChanges: [
          {
            file: currentFile || 'app.tsx',
            type: 'add',
            after: `// New feature: Copy-to-clipboard helper
const [copied, setCopied] = useState(false);

const copyToClipboard = async (text: string) => {
  await navigator.clipboard.writeText(text);
  setCopied(true);
  setTimeout(() => setCopied(false), 1500);
};`,
            description: 'Added copy-to-clipboard helper with transient confirmation state',
            lines: { start: 10, end: 16 }
          }
        ]
      };
    } else {
      return {
        content: 'I understand your request. Let me analyze the code and provide suggestions based on the context.',
        suggestions: [
          {
            id: '1',
            type: 'refactor',
            title: 'Extract reusable components',
            description: 'Consider extracting repeated UI patterns into reusable components',
            priority: 'low',
            estimatedTime: '10 mins'
          }
        ]
      };
    }
  };

  const applyCodeChanges = (changes: CodeChange[]) => {
    changes.forEach(change => {
      if (change.type === 'modify' && change.after) {
        onCodeUpdate(change.file, change.after);
      } else if (change.type === 'add' && change.after) {
        onFileCreate(change.file, change.after);
      }
    });
  };

  const MessageComponent = ({ message }: { message: Message }) => (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'} mb-4`}
    >
      <div className={`flex space-x-3 max-w-[80%] ${message.role === 'user' ? 'flex-row-reverse space-x-reverse' : ''}`}>
        <Avatar className="w-8 h-8">
          <AvatarFallback>
            {message.role === 'user' ? <User className="w-4 h-4" /> : <Bot className="w-4 h-4" />}
          </AvatarFallback>
        </Avatar>
        
        <div className="flex-1">
          <Card className={message.role === 'user' ? 'bg-primary/10' : ''}>
            <CardContent className="p-3">
              {message.status === 'thinking' ? (
                <div className="flex items-center space-x-2">
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  <span className="text-sm text-muted-foreground">Analyzing code...</span>
                </div>
              ) : (
                <>
                  <p className="text-sm">{message.content}</p>
                  
                  {message.context && (
                    <div className="flex items-center space-x-2 mt-2">
                      <FileCode className="w-3 h-3 text-muted-foreground" />
                      <span className="text-xs text-muted-foreground">
                        {message.context.file} {message.context.lines && `(lines ${message.context.lines.start}-${message.context.lines.end})`}
                      </span>
                    </div>
                  )}
                  
                  {message.codeChanges && message.codeChanges.length > 0 && (
                    <div className="mt-3 space-y-2">
                      {message.codeChanges.map((change, idx) => (
                        <Card key={idx} className="bg-secondary/50">
                          <CardContent className="p-3">
                            <div className="flex items-center justify-between mb-2">
                              <div className="flex items-center space-x-2">
                                <Badge variant={
                                  change.type === 'add' ? 'default' :
                                  change.type === 'modify' ? 'secondary' :
                                  'destructive'
                                }>
                                  {change.type}
                                </Badge>
                                <span className="text-xs font-mono">{change.file}</span>
                              </div>
                              <div className="flex items-center space-x-1">
                                {autoApply ? (
                                  <Check className="w-4 h-4 text-green-500" />
                                ) : (
                                  <Button size="sm" variant="ghost">
                                    <Play className="w-3 h-3 mr-1" />
                                    Apply
                                  </Button>
                                )}
                              </div>
                            </div>
                            
                            <p className="text-xs text-muted-foreground mb-2">{change.description}</p>
                            
                            {change.before && (
                              <div className="mb-2">
                                <p className="text-xs text-muted-foreground mb-1">Before:</p>
                                <SyntaxHighlighter
                                  language="javascript"
                                  style={vscDarkPlus}
                                  customStyle={{ fontSize: '0.75rem', padding: '0.5rem' }}
                                >
                                  {change.before}
                                </SyntaxHighlighter>
                              </div>
                            )}
                            
                            {change.after && (
                              <div>
                                <p className="text-xs text-muted-foreground mb-1">After:</p>
                                <SyntaxHighlighter
                                  language="javascript"
                                  style={vscDarkPlus}
                                  customStyle={{ fontSize: '0.75rem', padding: '0.5rem' }}
                                >
                                  {change.after}
                                </SyntaxHighlighter>
                              </div>
                            )}
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                  )}
                  
                  {message.suggestions && message.suggestions.length > 0 && (
                    <div className="mt-3 space-y-2">
                      {message.suggestions.map(suggestion => (
                        <Card key={suggestion.id} className="bg-secondary/30">
                          <CardContent className="p-3">
                            <div className="flex items-start justify-between">
                              <div className="flex-1">
                                <div className="flex items-center space-x-2 mb-1">
                                  {suggestion.type === 'optimization' && <Zap className="w-4 h-4 text-yellow-500" />}
                                  {suggestion.type === 'bug-fix' && <Bug className="w-4 h-4 text-red-500" />}
                                  {suggestion.type === 'refactor' && <RefreshCw className="w-4 h-4 text-blue-500" />}
                                  {suggestion.type === 'feature' && <Sparkles className="w-4 h-4 text-purple-500" />}
                                  <span className="text-sm font-medium">{suggestion.title}</span>
                                  <Badge variant="outline" className="text-xs">
                                    {suggestion.priority}
                                  </Badge>
                                </div>
                                <p className="text-xs text-muted-foreground">{suggestion.description}</p>
                                <p className="text-xs text-muted-foreground mt-1">⏱ {suggestion.estimatedTime}</p>
                              </div>
                              <Button size="sm" variant="ghost">
                                <ArrowRight className="w-4 h-4" />
                              </Button>
                            </div>
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                  )}
                </>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </motion.div>
  );

  return (
    <Card className="h-full flex flex-col">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <CardTitle className="text-lg">Continuous Enhancement</CardTitle>
            <Badge variant="outline" className="text-xs">
              <Sparkles className="w-3 h-3 mr-1" />
              Jurexio Powered
            </Badge>
          </div>
          
          <div className="flex items-center space-x-2">
            <Button
              variant={contextMode === 'file' ? 'default' : 'ghost'}
              size="sm"
              onClick={() => setContextMode('file')}
            >
              <FileText className="w-4 h-4" />
            </Button>
            <Button
              variant={contextMode === 'project' ? 'default' : 'ghost'}
              size="sm"
              onClick={() => setContextMode('project')}
            >
              <GitBranch className="w-4 h-4" />
            </Button>
            <Button
              variant={contextMode === 'smart' ? 'default' : 'ghost'}
              size="sm"
              onClick={() => setContextMode('smart')}
            >
              <Lightbulb className="w-4 h-4" />
            </Button>
            
            <Button
              variant={autoApply ? 'default' : 'ghost'}
              size="sm"
              onClick={() => setAutoApply(!autoApply)}
            >
              {autoApply ? <Check className="w-4 h-4" /> : <X className="w-4 h-4" />}
              Auto
            </Button>
            
            <Button variant="ghost" size="icon">
              <Settings className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </CardHeader>
      
      <CardContent className="flex-1 flex flex-col p-0">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col">
          <TabsList className="mx-4">
            <TabsTrigger value="chat">
              <MessageSquare className="w-4 h-4 mr-2" />
              Chat
            </TabsTrigger>
            <TabsTrigger value="commands">
              <Terminal className="w-4 h-4 mr-2" />
              Commands
            </TabsTrigger>
            <TabsTrigger value="context">
              <Code className="w-4 h-4 mr-2" />
              Context
            </TabsTrigger>
          </TabsList>
          
          <TabsContent value="chat" className="flex-1 flex flex-col p-4 pt-2">
            <ScrollArea className="flex-1 pr-4">
              <AnimatePresence>
                {messages.map(message => (
                  <MessageComponent key={message.id} message={message} />
                ))}
              </AnimatePresence>
              <div ref={messagesEndRef} />
            </ScrollArea>
            
            <div className="flex items-center space-x-2 mt-4">
              <Input
                placeholder={`Ask me to ${currentFile ? 'modify this file' : 'help with your code'}...`}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyPress={(e) => e.key === 'Enter' && handleSendMessage()}
                disabled={isProcessing}
                className="flex-1"
              />
              <Button onClick={handleSendMessage} disabled={isProcessing}>
                {isProcessing ? (
                  <RefreshCw className="w-4 h-4 animate-spin" />
                ) : (
                  <Send className="w-4 h-4" />
                )}
              </Button>
            </div>
            
            <div className="flex items-center justify-between mt-2">
              <div className="flex space-x-1">
                <Button variant="ghost" size="sm" className="text-xs">
                  <Wand2 className="w-3 h-3 mr-1" />
                  Optimize
                </Button>
                <Button variant="ghost" size="sm" className="text-xs">
                  <Bug className="w-3 h-3 mr-1" />
                  Fix bugs
                </Button>
                <Button variant="ghost" size="sm" className="text-xs">
                  <RefreshCw className="w-3 h-3 mr-1" />
                  Refactor
                </Button>
                <Button variant="ghost" size="sm" className="text-xs">
                  <Sparkles className="w-3 h-3 mr-1" />
                  Add feature
                </Button>
              </div>
              
              <span className="text-xs text-muted-foreground">
                Context: {contextMode === 'file' ? currentFile || 'No file' : contextMode}
              </span>
            </div>
          </TabsContent>
          
          <TabsContent value="commands" className="flex-1 p-4">
            <div className="space-y-2">
              <Card className="hover:bg-secondary/50 cursor-pointer">
                <CardContent className="p-3">
                  <div className="flex items-center space-x-3">
                    <Edit3 className="w-4 h-4 text-blue-500" />
                    <div className="flex-1">
                      <p className="text-sm font-medium">/edit</p>
                      <p className="text-xs text-muted-foreground">Modify selected code</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
              
              <Card className="hover:bg-secondary/50 cursor-pointer">
                <CardContent className="p-3">
                  <div className="flex items-center space-x-3">
                    <Database className="w-4 h-4 text-green-500" />
                    <div className="flex-1">
                      <p className="text-sm font-medium">/schema</p>
                      <p className="text-xs text-muted-foreground">Generate database schema</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
              
              <Card className="hover:bg-secondary/50 cursor-pointer">
                <CardContent className="p-3">
                  <div className="flex items-center space-x-3">
                    <Server className="w-4 h-4 text-purple-500" />
                    <div className="flex-1">
                      <p className="text-sm font-medium">/api</p>
                      <p className="text-xs text-muted-foreground">Create API endpoints</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
              
              <Card className="hover:bg-secondary/50 cursor-pointer">
                <CardContent className="p-3">
                  <div className="flex items-center space-x-3">
                    <Layout className="w-4 h-4 text-yellow-500" />
                    <div className="flex-1">
                      <p className="text-sm font-medium">/ui</p>
                      <p className="text-xs text-muted-foreground">Generate UI components</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>
          
          <TabsContent value="context" className="flex-1 p-4">
            <div className="space-y-3">
              <div>
                <p className="text-sm font-medium mb-2">Current Context</p>
                <Card className="bg-secondary/30">
                  <CardContent className="p-3">
                    <div className="space-y-2 text-sm">
                      <div className="flex items-center justify-between">
                        <span className="text-muted-foreground">File:</span>
                        <span className="font-mono">{currentFile || 'None'}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-muted-foreground">Project:</span>
                        <span>{projectId}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-muted-foreground">Mode:</span>
                        <Badge variant="outline">{contextMode}</Badge>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-muted-foreground">Agents:</span>
                        <span>12 active</span>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </div>
              
              {currentCode && showPreview && (
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-sm font-medium">Code Preview</p>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setShowPreview(!showPreview)}
                    >
                      <Eye className="w-4 h-4" />
                    </Button>
                  </div>
                  <Card>
                    <CardContent className="p-0">
                      <SyntaxHighlighter
                        language="javascript"
                        style={vscDarkPlus}
                        customStyle={{ fontSize: '0.75rem', maxHeight: '200px' }}
                      >
                        {currentCode.slice(0, 500) + (currentCode.length > 500 ? '...' : '')}
                      </SyntaxHighlighter>
                    </CardContent>
                  </Card>
                </div>
              )}
            </div>
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}