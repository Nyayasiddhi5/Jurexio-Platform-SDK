import { useState, useEffect, useRef, useCallback } from 'react';
import { useToast } from '@/hooks/use-toast';

interface WebSocketMessage {
  type: string;
  data: any;
  timestamp: number;
  userId?: string;
}

interface CollaborationUser {
  id: string;
  name: string;
  color: string;
  lastActivity: number;
}

interface UseWebSocketCollaborationProps {
  projectId: string;
  enabled: boolean;
  userId?: string;
  userName?: string;
}

export function useWebSocketCollaboration({
  projectId,
  enabled,
  userId = 'anonymous',
  userName = 'Anonymous User'
}: UseWebSocketCollaborationProps) {
  const [isConnected, setIsConnected] = useState(false);
  const [collaborationUsers, setCollaborationUsers] = useState<CollaborationUser[]>([]);
  const [messages, setMessages] = useState<WebSocketMessage[]>([]);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const { toast } = useToast();

  const connect = useCallback(() => {
    if (!enabled || !projectId || wsRef.current?.readyState === WebSocket.OPEN) {
      return;
    }

    try {
      const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${wsProtocol}//${window.location.host}/api/ws`;
      
      wsRef.current = new WebSocket(wsUrl);

      wsRef.current.onopen = () => {
        setIsConnected(true);
        
        // Send initial connection message
        sendMessage({
          type: 'join_project',
          data: {
            projectId,
            userId,
            userName,
            userColor: generateUserColor(userId)
          }
        });

        toast({
          title: 'Collaboration Active',
          description: 'Connected to real-time collaboration'
        });
      };

      wsRef.current.onmessage = (event) => {
        try {
          const message: WebSocketMessage = JSON.parse(event.data);
          handleMessage(message);
        } catch (error) {
          console.error('Failed to parse WebSocket message:', error);
        }
      };

      wsRef.current.onclose = (event) => {
        setIsConnected(false);
        setCollaborationUsers([]);
        
        if (event.code !== 1000 && enabled) {
          // Attempt to reconnect after 3 seconds
          reconnectTimeoutRef.current = setTimeout(() => {
            connect();
          }, 3000);
        }
      };

      wsRef.current.onerror = (error) => {
        console.error('WebSocket error:', error);
        setIsConnected(false);
      };

    } catch (error) {
      console.error('Failed to connect WebSocket:', error);
      setIsConnected(false);
    }
  }, [enabled, projectId, userId, userName]);

  const disconnect = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }

    if (wsRef.current) {
      wsRef.current.close(1000, 'User disconnected');
      wsRef.current = null;
    }
    
    setIsConnected(false);
    setCollaborationUsers([]);
  }, []);

  const sendMessage = useCallback((message: Omit<WebSocketMessage, 'timestamp'>) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      const fullMessage: WebSocketMessage = {
        ...message,
        timestamp: Date.now(),
        userId
      };
      
      wsRef.current.send(JSON.stringify(fullMessage));
    }
  }, [userId]);

  const handleMessage = (message: WebSocketMessage) => {
    setMessages(prev => [...prev.slice(-49), message]); // Keep last 50 messages

    switch (message.type) {
      case 'user_joined':
        setCollaborationUsers(prev => {
          const filtered = prev.filter(u => u.id !== message.data.userId);
          return [...filtered, {
            id: message.data.userId,
            name: message.data.userName,
            color: message.data.userColor,
            lastActivity: Date.now()
          }];
        });
        
        if (message.data.userId !== userId) {
          toast({
            title: 'User Joined',
            description: `${message.data.userName} joined the session`
          });
        }
        break;

      case 'user_left':
        setCollaborationUsers(prev => 
          prev.filter(u => u.id !== message.data.userId)
        );
        
        if (message.data.userId !== userId) {
          toast({
            title: 'User Left',
            description: `${message.data.userName} left the session`
          });
        }
        break;

      case 'user_activity':
        setCollaborationUsers(prev =>
          prev.map(user =>
            user.id === message.data.userId
              ? { ...user, lastActivity: Date.now() }
              : user
          )
        );
        break;

      case 'project_update':
        // Handle project-level updates
        break;

      case 'file_locked':
        toast({
          title: 'File Locked',
          description: `${message.data.fileName} is being edited by ${message.data.userName}`,
          variant: 'default'
        });
        break;

      case 'file_unlocked':
        toast({
          title: 'File Available',
          description: `${message.data.fileName} is now available for editing`
        });
        break;

      default:
        // Handle custom message types
        break;
    }
  };

  const sendCursorUpdate = useCallback((fileId: string, line: number, column: number) => {
    sendMessage({
      type: 'cursor_update',
      data: {
        fileId,
        line,
        column,
        projectId
      }
    });
  }, [sendMessage, projectId]);

  const sendFileChange = useCallback((fileId: string, content: string, operation: string = 'edit') => {
    sendMessage({
      type: 'file_change',
      data: {
        fileId,
        content,
        operation,
        projectId
      }
    });
  }, [sendMessage, projectId]);

  const sendFileSelect = useCallback((fileId: string, fileName: string) => {
    sendMessage({
      type: 'file_select',
      data: {
        fileId,
        fileName,
        projectId
      }
    });
  }, [sendMessage, projectId]);

  const sendAgentInteraction = useCallback((agentId: string, action: string, data: any = {}) => {
    sendMessage({
      type: 'agent_interaction',
      data: {
        agentId,
        action,
        projectId,
        ...data
      }
    });
  }, [sendMessage, projectId]);

  // Generate consistent color for user
  const generateUserColor = (userId: string): string => {
    const colors = [
      '#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FECA57',
      '#FF9FF3', '#54A0FF', '#5F27CD', '#00D2D3', '#FF9F43',
      '#10AC84', '#EE5A24', '#0984E3', '#6C5CE7', '#A29BFE'
    ];
    
    let hash = 0;
    for (let i = 0; i < userId.length; i++) {
      hash = ((hash << 5) - hash + userId.charCodeAt(i)) & 0xffffffff;
    }
    
    return colors[Math.abs(hash) % colors.length];
  };

  // Auto-connect when enabled
  useEffect(() => {
    if (enabled && projectId) {
      connect();
    } else {
      disconnect();
    }

    return () => {
      disconnect();
    };
  }, [enabled, projectId, connect, disconnect]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      disconnect();
    };
  }, [disconnect]);

  return {
    isConnected,
    collaborationUsers,
    messages,
    sendMessage,
    sendCursorUpdate,
    sendFileChange,
    sendFileSelect,
    sendAgentInteraction,
    connect,
    disconnect
  };
}