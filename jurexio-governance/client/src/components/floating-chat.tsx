import { useState, useRef, useEffect } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

interface FloatingChatProps {
  projectId: number;
  onSendMessage: (message: any) => void;
  isConnected: boolean;
}

interface ChatMessage {
  id: string;
  type: 'user' | 'agent';
  content: string;
  timestamp: Date;
  agent?: string;
}

export function FloatingChat({ projectId, onSendMessage, isConnected }: FloatingChatProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: '1',
      type: 'agent',
      content: '👋 Hi! I\'m your BMAD Orchestrator. I can help coordinate all agents and answer questions about your project.',
      timestamp: new Date(),
      agent: 'bmad-orchestrator'
    }
  ]);
  const [isTyping, setIsTyping] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isOpen]);

  const handleSendMessage = async () => {
    if (!message.trim() || !isConnected) return;

    const userMessage: ChatMessage = {
      id: `user_${Date.now()}`,
      type: 'user',
      content: message,
      timestamp: new Date()
    };

    setMessages(prev => [...prev, userMessage]);
    setMessage("");
    setIsTyping(true);

    // Send message through WebSocket
    onSendMessage({
      type: 'chat.message',
      message: userMessage.content,
      projectId,
      userId: 1
    });

    // Simulate agent response (in real implementation, this would come through WebSocket)
    setTimeout(() => {
      const agentResponse: ChatMessage = {
        id: `agent_${Date.now()}`,
        type: 'agent',
        content: generateAgentResponse(userMessage.content),
        timestamp: new Date(),
        agent: 'bmad-orchestrator'
      };
      
      setMessages(prev => [...prev, agentResponse]);
      setIsTyping(false);
    }, 1500 + Math.random() * 1000);
  };

  const generateAgentResponse = (userMessage: string): string => {
    const responses = [
      "I understand your request. Let me coordinate with the appropriate agents to handle this.",
      "Based on current project status, I can provide the following insights...",
      "I'll have the CTO Agent review this and provide technical guidance.",
      "The development team is currently working on similar requirements. Let me check the status.",
      "This is a great question! Let me analyze the current workflow and get back to you.",
      "I've noted your feedback and will ensure it's incorporated into the next iteration.",
      "The QA Agent has completed similar tasks recently. I'll share those insights.",
      "Let me check with the deployment agent about the current infrastructure status."
    ];
    
    return responses[Math.floor(Math.random() * responses.length)];
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const quickActions = [
    "What's the current status?",
    "Show project progress",
    "Any deployment issues?",
    "Cost optimization tips"
  ];

  return (
    <div className="fixed bottom-6 right-6 z-40">
      {/* Chat Panel */}
      <div className={`mb-4 transition-all duration-300 ${isOpen ? 'opacity-100 scale-100' : 'opacity-0 scale-95 pointer-events-none'}`}>
        <Card className="bg-surface-800 border-surface-700 shadow-2xl w-80 max-h-96 flex flex-col">
          {/* Header */}
          <div className="p-4 border-b border-surface-700 flex-shrink-0">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-3">
                <div className="w-8 h-8 gradient-bg rounded-full flex items-center justify-center">
                  <i className="fas fa-robot text-sm"></i>
                </div>
                <div>
                  <h4 className="font-medium">BMAD Orchestrator</h4>
                  <div className="flex items-center space-x-1">
                    <div className={`w-2 h-2 rounded-full ${isConnected ? 'bg-accent-500' : 'bg-red-500'}`}></div>
                    <p className={`text-xs ${isConnected ? 'text-accent-400' : 'text-red-400'}`}>
                      {isConnected ? 'Online' : 'Disconnected'}
                    </p>
                  </div>
                </div>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setIsOpen(false)}
                className="text-gray-400 hover:text-white h-6 w-6 p-0"
              >
                <i className="fas fa-times text-xs"></i>
              </Button>
            </div>
          </div>

          {/* Messages */}
          <div className="flex-1 p-4 space-y-3 overflow-y-auto min-h-48 max-h-48">
            {messages.map((msg) => (
              <div
                key={msg.id}
                className={`flex ${msg.type === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                <div className={`max-w-xs rounded-lg p-3 ${
                  msg.type === 'user' 
                    ? 'bg-primary-500 text-white ml-8' 
                    : 'bg-surface-700 text-gray-200 mr-8'
                }`}>
                  {msg.type === 'agent' && msg.agent && (
                    <Badge variant="secondary" className="mb-2 text-xs">
                      {msg.agent}
                    </Badge>
                  )}
                  <p className="text-sm">{msg.content}</p>
                  <p className="text-xs opacity-70 mt-1">
                    {msg.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </p>
                </div>
              </div>
            ))}
            
            {isTyping && (
              <div className="flex justify-start">
                <div className="bg-surface-700 rounded-lg p-3 mr-8">
                  <div className="flex space-x-1">
                    <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce"></div>
                    <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0.1s' }}></div>
                    <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }}></div>
                  </div>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Quick Actions */}
          {messages.length === 1 && (
            <div className="px-4 pb-2">
              <div className="text-xs text-gray-400 mb-2">Quick actions:</div>
              <div className="flex flex-wrap gap-1">
                {quickActions.map((action, index) => (
                  <Button
                    key={index}
                    variant="outline"
                    size="sm"
                    onClick={() => setMessage(action)}
                    className="text-xs h-6 px-2 border-surface-600 hover:border-primary-500"
                  >
                    {action}
                  </Button>
                ))}
              </div>
            </div>
          )}

          {/* Input */}
          <div className="p-4 border-t border-surface-700 flex-shrink-0">
            <div className="flex items-center space-x-2">
              <Input
                ref={inputRef}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                onKeyPress={handleKeyPress}
                placeholder={isConnected ? "Ask me anything..." : "Connecting..."}
                disabled={!isConnected || isTyping}
                className="flex-1 bg-surface-700 border-surface-600 focus:border-primary-500 text-sm"
              />
              <Button
                onClick={handleSendMessage}
                disabled={!message.trim() || !isConnected || isTyping}
                size="sm"
                className="bg-primary-500 hover:bg-primary-600 h-8 w-8 p-0"
              >
                <i className="fas fa-paper-plane text-xs"></i>
              </Button>
            </div>
          </div>
        </Card>
      </div>
      
      {/* Toggle Button */}
      <Button
        onClick={() => setIsOpen(!isOpen)}
        className="w-14 h-14 gradient-bg rounded-full shadow-2xl hover:scale-105 transition-transform relative"
      >
        <i className={`fas ${isOpen ? 'fa-times' : 'fa-comments'} text-xl`}></i>
        {!isConnected && (
          <div className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 rounded-full flex items-center justify-center">
            <i className="fas fa-exclamation text-xs text-white"></i>
          </div>
        )}
        {isConnected && !isOpen && messages.length > 1 && (
          <div className="absolute -top-1 -right-1 w-4 h-4 bg-accent-500 rounded-full flex items-center justify-center">
            <span className="text-xs text-white">{messages.length - 1}</span>
          </div>
        )}
      </Button>
    </div>
  );
}
