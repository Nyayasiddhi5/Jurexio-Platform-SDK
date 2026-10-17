import React, { useState, useRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { useMutation, useQuery } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';

interface ChatMessage {
  id: string;
  content: string;
  sender: 'user' | 'agent';
  agentType?: string;
  timestamp: Date;
  metadata?: any;
}

interface FloatingChatProps {
  projectId?: string;
  className?: string;
}

export function FloatingChat({ projectId, className = "" }: FloatingChatProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: '1',
      content: '👋 Hi! I\'m your BMAD Orchestrator. I can help coordinate all agents and answer questions about your project.',
      sender: 'agent',
      agentType: 'orchestrator',
      timestamp: new Date()
    }
  ]);
  const [inputValue, setInputValue] = useState('');
  const [selectedAgent, setSelectedAgent] = useState('orchestrator');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Get available agents
  const { data: agentStatus } = useQuery({
    queryKey: ['agents', 'status'],
    queryFn: () => apiRequest('/api/agents/status'),
    refetchInterval: 30000
  });

  // Send message mutation
  const sendMessageMutation = useMutation({
    mutationFn: async (message: string) => {
      return apiRequest('/api/nyayavigya/request', {
        method: 'POST',
        body: JSON.stringify({
          type: 'text',
          operation: 'Chat assistance',
          content: message,
          priority: 'medium',
          projectId,
          agentType: selectedAgent,
          requirements: {
            maxTokens: 500,
            temperature: 0.7
          }
        })
      });
    },
    onSuccess: (response) => {
      if (response.success) {
        const agentMessage: ChatMessage = {
          id: Date.now().toString(),
          content: response.content || 'I apologize, but I couldn\'t process your request.',
          sender: 'agent',
          agentType: selectedAgent,
          timestamp: new Date(),
          metadata: response.metadata
        };
        setMessages(prev => [...prev, agentMessage]);
      }
    }
  });

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleSendMessage = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputValue.trim()) return;

    const userMessage: ChatMessage = {
      id: Date.now().toString(),
      content: inputValue,
      sender: 'user',
      timestamp: new Date()
    };

    setMessages(prev => [...prev, userMessage]);
    sendMessageMutation.mutate(inputValue);
    setInputValue('');
  };

  const getAgentInfo = (agentType: string) => {
    const agentMap = {
      orchestrator: { name: 'BMAD Orchestrator', icon: '🤖', color: 'bg-blue-500' },
      cto: { name: 'CTO Agent', icon: '👔', color: 'bg-purple-500' },
      architect: { name: 'Architect Agent', icon: '🏗️', color: 'bg-green-500' },
      frontend: { name: 'Frontend Agent', icon: '⚛️', color: 'bg-cyan-500' },
      backend: { name: 'Backend Agent', icon: '⚙️', color: 'bg-orange-500' },
      qa: { name: 'QA Agent', icon: '🧪', color: 'bg-red-500' }
    };
    return agentMap[agentType as keyof typeof agentMap] || agentMap.orchestrator;
  };

  const availableAgents = agentStatus?.agents?.filter((agent: any) => 
    ['orchestrator', 'cto', 'architect', 'frontend', 'backend', 'qa'].includes(agent.type)
  ) || [];

  return (
    <div className={`fixed bottom-6 right-6 z-50 ${className}`}>
      {/* Chat Panel */}
      {isOpen && (
        <Card className="w-96 h-[500px] mb-4 bg-gray-800 border-gray-700 shadow-2xl">
          <CardHeader className="p-4 border-b border-gray-700">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-3">
                <Avatar className="w-8 h-8">
                  <AvatarFallback className="gradient-bg text-white text-sm">
                    {getAgentInfo(selectedAgent).icon}
                  </AvatarFallback>
                </Avatar>
                <div>
                  <h4 className="font-medium text-white">{getAgentInfo(selectedAgent).name}</h4>
                  <div className="flex items-center space-x-2">
                    <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse"></div>
                    <span className="text-xs text-green-400">Online</span>
                  </div>
                </div>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setIsOpen(false)}
                className="text-gray-400 hover:text-white"
              >
                <i className="fas fa-times"></i>
              </Button>
            </div>

            {/* Agent Selector */}
            <div className="mt-3">
              <div className="flex flex-wrap gap-1">
                {['orchestrator', 'cto', 'architect', 'frontend', 'backend', 'qa'].map((agentType) => (
                  <Badge
                    key={agentType}
                    variant={selectedAgent === agentType ? "default" : "secondary"}
                    className="text-xs cursor-pointer hover:bg-blue-600"
                    onClick={() => setSelectedAgent(agentType)}
                  >
                    {getAgentInfo(agentType).icon} {getAgentInfo(agentType).name.split(' ')[0]}
                  </Badge>
                ))}
              </div>
            </div>
          </CardHeader>

          <CardContent className="p-0 flex flex-col h-[380px]">
            {/* Messages */}
            <ScrollArea className="flex-1 p-4">
              <div className="space-y-4">
                {messages.map((message) => (
                  <div
                    key={message.id}
                    className={`flex ${message.sender === 'user' ? 'justify-end' : 'justify-start'}`}
                  >
                    <div className={`max-w-[80%] ${message.sender === 'user' ? 'order-2' : 'order-1'}`}>
                      <div
                        className={`p-3 rounded-lg ${
                          message.sender === 'user'
                            ? 'bg-blue-600 text-white ml-auto'
                            : 'bg-gray-700 text-gray-100'
                        }`}
                      >
                        <p className="text-sm whitespace-pre-wrap">{message.content}</p>
                        {message.metadata && (
                          <div className="mt-2 text-xs opacity-70">
                            Quality: {Math.round((message.metadata.quality || 0) * 100)}% • 
                            {message.metadata.processingTime}ms • 
                            ${(message.metadata.cost || 0).toFixed(4)}
                          </div>
                        )}
                      </div>
                      <div className="text-xs text-gray-400 mt-1">
                        {message.timestamp.toLocaleTimeString()}
                      </div>
                    </div>
                    {message.sender === 'agent' && (
                      <Avatar className={`w-6 h-6 ${message.sender === 'user' ? 'order-1 mr-2' : 'order-2 ml-2'}`}>
                        <AvatarFallback className={`${getAgentInfo(message.agentType || 'orchestrator').color} text-white text-xs`}>
                          {getAgentInfo(message.agentType || 'orchestrator').icon}
                        </AvatarFallback>
                      </Avatar>
                    )}
                  </div>
                ))}
                {sendMessageMutation.isPending && (
                  <div className="flex justify-start">
                    <div className="bg-gray-700 text-gray-100 p-3 rounded-lg">
                      <div className="flex items-center space-x-2">
                        <div className="flex space-x-1">
                          <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce"></div>
                          <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0.1s' }}></div>
                          <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }}></div>
                        </div>
                        <span className="text-sm">Thinking...</span>
                      </div>
                    </div>
                  </div>
                )}
              </div>
              <div ref={messagesEndRef} />
            </ScrollArea>

            {/* Input */}
            <div className="p-4 border-t border-gray-700">
              <form onSubmit={handleSendMessage} className="flex items-center space-x-2">
                <Input
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                  placeholder="Ask me anything..."
                  className="flex-1 bg-gray-700 border-gray-600 text-white placeholder-gray-400 focus:border-blue-500"
                  disabled={sendMessageMutation.isPending}
                />
                <Button
                  type="submit"
                  size="sm"
                  disabled={!inputValue.trim() || sendMessageMutation.isPending}
                  className="bg-blue-600 hover:bg-blue-700"
                >
                  <i className="fas fa-paper-plane text-sm"></i>
                </Button>
              </form>
              <div className="mt-2 text-xs text-gray-400">
                Tip: Type "status" for project updates, "help" for commands
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Chat Toggle Button */}
      <Button
        onClick={() => setIsOpen(!isOpen)}
        className="w-14 h-14 gradient-bg rounded-full shadow-2xl hover:scale-105 transition-transform animate-bounce-gentle"
      >
        <i className={`fas ${isOpen ? 'fa-times' : 'fa-comments'} text-xl`}></i>
      </Button>
    </div>
  );
}