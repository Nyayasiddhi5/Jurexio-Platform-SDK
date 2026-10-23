/**
 * Multi-Conversation Chat Component
 * Replicates Manus/Replit.com style conversational interface
 */

import React, { useState, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { 
  Send, 
  Bot, 
  User, 
  Code, 
  TestTube, 
  Rocket, 
  Settings, 
  MessageSquare, 
  CheckCircle,
  Clock,
  AlertCircle,
  PlayCircle,
  Pause,
  MoreHorizontal,
  FileText,
  Download,
  Eye
} from 'lucide-react';

interface Message {
  id: string;
  content: string;
  type: 'user' | 'agent' | 'system';
  agentId?: string;
  timestamp: Date;
  metadata?: {
    artifacts?: string[];
    codeChanges?: any[];
    testResults?: any[];
    feedbackType?: string;
  };
}

interface Conversation {
  id: string;
  projectId: string;
  status: 'active' | 'paused' | 'completed';
  currentPhase: 'planning' | 'development' | 'testing' | 'review' | 'deployment';
  activeAgents: string[];
  progress: {
    completedTasks: number;
    totalTasks: number;
    estimatedCompletion: Date;
    blockers: string[];
  };
}

const AGENT_AVATARS: Record<string, string> = {
  'senior-software-architect': '🏗️',
  'full-stack-developer': '💻',
  'ui-ux-designer': '🎨',
  'qa-automation-engineer': '🧪',
  'devops-specialist': '🚀',
  'real-time-chat-agent': '💬',
  'ai-research-specialist': '🧠',
  'creative-content-generator': '✨',
  'hierarchical-coordinator': '👑',
  'system': '⚙️'
};

const PHASE_COLORS = {
  planning: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300',
  development: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300',
  testing: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300',
  review: 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-300',
  deployment: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300'
};

export function MultiConversationChat() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string>('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputMessage, setInputMessage] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [websocket, setWebsocket] = useState<WebSocket | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Initialize WebSocket connection
  useEffect(() => {
    if (activeConversationId) {
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const wsUrl = `${protocol}//${window.location.host}/ws/conversation/${activeConversationId}`;
      
      const ws = new WebSocket(wsUrl);
      
      ws.onopen = () => {
        console.log('Connected to conversation WebSocket');
        setWebsocket(ws);
      };

      ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        
        if (data.type === 'conversation-history') {
          setMessages(data.data || []);
        } else if (data.type === 'new-messages') {
          setMessages(prev => [...prev, ...data.data]);
        }
      };

      ws.onclose = () => {
        console.log('Disconnected from conversation WebSocket');
        setWebsocket(null);
      };

      return () => {
        ws.close();
      };
    }
  }, [activeConversationId]);

  // Auto-scroll to latest message
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Create new conversation
  const createNewConversation = async () => {
    try {
      const response = await fetch('/api/v2/conversations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: 'demo-project',
          initialMessage: 'Hello! I want to start a new project.'
        })
      });

      const conversation = await response.json();
      if (conversation.success) {
        setConversations(prev => [...prev, conversation.data]);
        setActiveConversationId(conversation.data.id);
      }
    } catch (error) {
      console.error('Failed to create conversation:', error);
    }
  };

  // Send message
  const sendMessage = async () => {
    if (!inputMessage.trim() || !activeConversationId || isLoading) return;

    const userMessage: Message = {
      id: `msg_${Date.now()}`,
      content: inputMessage,
      type: 'user',
      timestamp: new Date()
    };

    setMessages(prev => [...prev, userMessage]);
    setInputMessage('');
    setIsLoading(true);

    try {
      const response = await fetch('/api/v2/conversations/message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conversationId: activeConversationId,
          content: inputMessage
        })
      });

      const result = await response.json();
      if (result.success) {
        // Messages will be received via WebSocket
      } else {
        console.error('Failed to send message:', result.error);
      }
    } catch (error) {
      console.error('Failed to send message:', error);
    } finally {
      setIsLoading(false);
    }
  };

  // Handle enter key
  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  // Format agent name
  const formatAgentName = (agentId?: string): string => {
    if (!agentId) return 'AI Assistant';
    return agentId
      .split('-')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  };

  // Render message bubble
  const renderMessage = (message: Message) => {
    const isUser = message.type === 'user';
    const agentAvatar = message.agentId ? AGENT_AVATARS[message.agentId] || '🤖' : '🤖';

    return (
      <div
        key={message.id}
        className={`flex gap-3 mb-4 ${isUser ? 'flex-row-reverse' : 'flex-row'}`}
      >
        <Avatar className="w-8 h-8">
          <AvatarFallback className={isUser ? 'bg-blue-500' : 'bg-gray-500'}>
            {isUser ? <User className="w-4 h-4 text-white" /> : agentAvatar}
          </AvatarFallback>
        </Avatar>

        <div className={`max-w-[80%] ${isUser ? 'items-end' : 'items-start'} flex flex-col`}>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs text-gray-500 dark:text-gray-400">
              {isUser ? 'You' : formatAgentName(message.agentId)}
            </span>
            <span className="text-xs text-gray-400">
              {message.timestamp.toLocaleTimeString()}
            </span>
          </div>

          <div
            className={`
              rounded-lg px-4 py-2 max-w-full break-words
              ${isUser 
                ? 'bg-blue-500 text-white' 
                : 'bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-gray-100'
              }
            `}
          >
            <div className="whitespace-pre-wrap">{message.content}</div>

            {/* Render artifacts */}
            {message.metadata?.artifacts && message.metadata.artifacts.length > 0 && (
              <div className="mt-3 pt-3 border-t border-gray-200 dark:border-gray-600">
                <div className="text-xs text-gray-500 mb-2">Artifacts:</div>
                <div className="flex flex-wrap gap-2">
                  {message.metadata.artifacts.map((artifact, index) => (
                    <Badge key={index} variant="secondary" className="text-xs">
                      <FileText className="w-3 h-3 mr-1" />
                      {artifact}
                    </Badge>
                  ))}
                </div>
              </div>
            )}

            {/* Render code changes */}
            {message.metadata?.codeChanges && message.metadata.codeChanges.length > 0 && (
              <div className="mt-3 pt-3 border-t border-gray-200 dark:border-gray-600">
                <div className="text-xs text-gray-500 mb-2">Code Changes:</div>
                <div className="flex flex-wrap gap-2">
                  {message.metadata.codeChanges.map((change, index) => (
                    <Badge key={index} variant="outline" className="text-xs">
                      <Code className="w-3 h-3 mr-1" />
                      {change.file || `Change ${index + 1}`}
                    </Badge>
                  ))}
                </div>
              </div>
            )}

            {/* Render test results */}
            {message.metadata?.testResults && message.metadata.testResults.length > 0 && (
              <div className="mt-3 pt-3 border-t border-gray-200 dark:border-gray-600">
                <div className="text-xs text-gray-500 mb-2">Test Results:</div>
                <div className="flex flex-wrap gap-2">
                  {message.metadata.testResults.map((test, index) => (
                    <Badge 
                      key={index} 
                      variant={test.status === 'passed' ? 'default' : 'destructive'} 
                      className="text-xs"
                    >
                      <TestTube className="w-3 h-3 mr-1" />
                      {test.test || `Test ${index + 1}`}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  };

  // Render conversation sidebar
  const renderConversationSidebar = () => (
    <Card className="w-80 h-full">
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span>Conversations</span>
          <Button onClick={createNewConversation} size="sm">
            <MessageSquare className="w-4 h-4 mr-2" />
            New
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ScrollArea className="h-96">
          {conversations.map((conv) => (
            <div
              key={conv.id}
              className={`
                p-3 rounded-lg cursor-pointer mb-2 transition-colors
                ${activeConversationId === conv.id
                  ? 'bg-blue-100 dark:bg-blue-900'
                  : 'hover:bg-gray-100 dark:hover:bg-gray-800'
                }
              `}
              onClick={() => setActiveConversationId(conv.id)}
            >
              <div className="flex items-center justify-between mb-2">
                <Badge className={PHASE_COLORS[conv.currentPhase]}>
                  {conv.currentPhase}
                </Badge>
                <Badge variant={conv.status === 'active' ? 'default' : 'secondary'}>
                  {conv.status}
                </Badge>
              </div>

              <div className="text-sm text-gray-600 dark:text-gray-400 mb-2">
                Project: {conv.projectId}
              </div>

              <div className="flex items-center gap-2 text-xs text-gray-500">
                <div className="flex items-center gap-1">
                  <CheckCircle className="w-3 h-3" />
                  {conv.progress.completedTasks}/{conv.progress.totalTasks}
                </div>
                <div className="flex items-center gap-1">
                  <Clock className="w-3 h-3" />
                  {conv.progress.estimatedCompletion.toLocaleDateString()}
                </div>
              </div>

              {conv.progress.blockers.length > 0 && (
                <div className="mt-2 flex items-center gap-1 text-xs text-red-500">
                  <AlertCircle className="w-3 h-3" />
                  {conv.progress.blockers.length} blocker(s)
                </div>
              )}
            </div>
          ))}
        </ScrollArea>
      </CardContent>
    </Card>
  );

  // Render active agents panel
  const renderActiveAgentsPanel = () => {
    const activeConversation = conversations.find(c => c.id === activeConversationId);
    if (!activeConversation) return null;

    return (
      <Card className="w-64">
        <CardHeader>
          <CardTitle className="text-sm">Active Agents</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {activeConversation.activeAgents.map((agentId) => (
              <div key={agentId} className="flex items-center gap-3 p-2 bg-gray-50 dark:bg-gray-800 rounded-lg">
                <div className="text-lg">{AGENT_AVATARS[agentId] || '🤖'}</div>
                <div>
                  <div className="text-sm font-medium">
                    {formatAgentName(agentId)}
                  </div>
                  <div className="text-xs text-gray-500">Active</div>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    );
  };

  return (
    <div className="flex h-screen bg-gray-50 dark:bg-gray-900">
      {/* Conversations Sidebar */}
      {renderConversationSidebar()}

      {/* Main Chat Area */}
      <div className="flex-1 flex flex-col">
        {activeConversationId ? (
          <>
            {/* Chat Header */}
            <div className="bg-white dark:bg-gray-800 border-b p-4">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold">
                  Project Development Chat
                </h2>
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm">
                    <Eye className="w-4 h-4 mr-2" />
                    View Project
                  </Button>
                  <Button variant="outline" size="sm">
                    <Download className="w-4 h-4 mr-2" />
                    Export
                  </Button>
                  <Button variant="outline" size="sm">
                    <Settings className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            </div>

            {/* Messages Area */}
            <ScrollArea className="flex-1 p-4">
              <div className="max-w-4xl mx-auto">
                {messages.map(renderMessage)}
                {isLoading && (
                  <div className="flex items-center gap-3 mb-4">
                    <Avatar className="w-8 h-8">
                      <AvatarFallback className="bg-gray-500">
                        <Bot className="w-4 h-4 text-white animate-pulse" />
                      </AvatarFallback>
                    </Avatar>
                    <div className="bg-gray-100 dark:bg-gray-800 rounded-lg px-4 py-2">
                      <div className="flex items-center gap-2">
                        <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce"></div>
                        <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0.1s' }}></div>
                        <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }}></div>
                      </div>
                    </div>
                  </div>
                )}
                <div ref={messagesEndRef} />
              </div>
            </ScrollArea>

            {/* Input Area */}
            <div className="bg-white dark:bg-gray-800 border-t p-4">
              <div className="max-w-4xl mx-auto">
                <div className="flex gap-2">
                  <Input
                    value={inputMessage}
                    onChange={(e) => setInputMessage(e.target.value)}
                    onKeyPress={handleKeyPress}
                    placeholder="Type your message or request..."
                    className="flex-1"
                    disabled={isLoading}
                  />
                  <Button 
                    onClick={sendMessage} 
                    disabled={!inputMessage.trim() || isLoading}
                  >
                    <Send className="w-4 h-4" />
                  </Button>
                </div>
                <div className="text-xs text-gray-500 mt-2 text-center">
                  Press Enter to send, Shift+Enter for new line
                </div>
              </div>
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center">
              <Bot className="w-16 h-16 mx-auto mb-4 text-gray-400" />
              <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100 mb-2">
                Welcome to Jurexio DevStudio
              </h3>
              <p className="text-gray-500 dark:text-gray-400 mb-4">
                Create a new conversation to start building your project with AI agents
              </p>
              <Button onClick={createNewConversation}>
                <MessageSquare className="w-4 h-4 mr-2" />
                Start New Project
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Active Agents Panel */}
      {activeConversationId && renderActiveAgentsPanel()}
    </div>
  );
}