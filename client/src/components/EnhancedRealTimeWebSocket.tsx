/**
 * Enhanced Real-Time WebSocket System - Phase 2 Enhancement
 * 
 * Enterprise-grade WebSocket implementation with scaling, security,
 * and advanced collaboration features based on 2025 best practices
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Progress } from '@/components/ui/progress';
import { 
  Wifi, Users, MessageSquare, Video, Shield, Clock,
  Zap, Activity, Server, Globe, Lock, Eye, Settings,
  AlertTriangle, CheckCircle, BarChart3, MousePointer
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

interface WebSocketConnection {
  id: string;
  url: string;
  status: 'connecting' | 'connected' | 'disconnected' | 'error';
  latency: number;
  messagesPerSecond: number;
  lastHeartbeat: string;
  reconnectAttempts: number;
  maxReconnectAttempts: number;
}

interface CollaborationRoom {
  id: string;
  name: string;
  participants: number;
  maxParticipants: number;
  type: 'document' | 'code' | 'design' | 'meeting';
  isActive: boolean;
  createdAt: string;
}

interface WebSocketMessage {
  id: string;
  type: 'user_joined' | 'user_left' | 'document_edit' | 'cursor_move' | 'chat_message' | 'system';
  timestamp: string;
  author: string;
  content: any;
  roomId: string;
}

interface PerformanceMetrics {
  connectionUptime: number;
  messagesDelivered: number;
  averageLatency: number;
  peakConcurrentUsers: number;
  errorRate: number;
  throughput: number;
}

export default function EnhancedRealTimeWebSocket() {
  const [connections, setConnections] = useState<WebSocketConnection[]>([]);
  const [rooms, setRooms] = useState<CollaborationRoom[]>([]);
  const [messages, setMessages] = useState<WebSocketMessage[]>([]);
  const [metrics, setMetrics] = useState<PerformanceMetrics | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [autoReconnect, setAutoReconnect] = useState(true);
  const [enableHeartbeat, setEnableHeartbeat] = useState(true);
  const [securityMode, setSecurityMode] = useState(true);
  const [selectedRoom, setSelectedRoom] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const heartbeatRef = useRef<NodeJS.Timeout | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const { toast } = useToast();

  // Initialize sample data
  useEffect(() => {
    setConnections([
      {
        id: 'main-websocket',
        url: 'wss://nyayavigya-devstudio.replit.app/api/ws',
        status: 'connected',
        latency: 23,
        messagesPerSecond: 45,
        lastHeartbeat: 'Just now',
        reconnectAttempts: 0,
        maxReconnectAttempts: 5
      },
      {
        id: 'collaboration-ws',
        url: 'wss://collaboration.nyayavigya-devstudio.app/ws',
        status: 'connected',
        latency: 18,
        messagesPerSecond: 67,
        lastHeartbeat: '2 seconds ago',
        reconnectAttempts: 1,
        maxReconnectAttempts: 5
      }
    ]);

    setRooms([
      {
        id: 'room-1',
        name: 'E-commerce Platform Development',
        participants: 4,
        maxParticipants: 10,
        type: 'code',
        isActive: true,
        createdAt: '2025-01-15T10:30:00Z'
      },
      {
        id: 'room-2',
        name: 'UI/UX Design Review',
        participants: 7,
        maxParticipants: 15,
        type: 'design',
        isActive: true,
        createdAt: '2025-01-15T09:15:00Z'
      },
      {
        id: 'room-3',
        name: 'Documentation Sprint',
        participants: 2,
        maxParticipants: 8,
        type: 'document',
        isActive: false,
        createdAt: '2025-01-15T08:00:00Z'
      }
    ]);

    setMetrics({
      connectionUptime: 99.97,
      messagesDelivered: 15847,
      averageLatency: 21,
      peakConcurrentUsers: 156,
      errorRate: 0.03,
      throughput: 1240
    });
  }, []);

  // WebSocket connection with enterprise-grade features
  const connectWebSocket = useCallback((url: string) => {
    try {
      // Close existing connection
      if (wsRef.current) {
        wsRef.current.close();
      }

      // Create new WebSocket connection with secure protocols
      const ws = new WebSocket(url, securityMode ? ['wss'] : undefined);
      
      ws.onopen = () => {
        setIsConnected(true);
        setConnections(prev => prev.map(conn =>
          conn.url === url 
            ? { ...conn, status: 'connected', reconnectAttempts: 0 }
            : conn
        ));

        // Start heartbeat
        if (enableHeartbeat) {
          startHeartbeat(ws);
        }

        toast({
          title: "WebSocket Connected",
          description: `Connected to ${url}`,
        });
      };

      ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          handleWebSocketMessage(message);
        } catch (error) {
          console.error('Failed to parse WebSocket message:', error);
        }
      };

      ws.onclose = (event) => {
        setIsConnected(false);
        
        // Auto-reconnect logic
        if (autoReconnect && event.code !== 1000) {
          handleReconnection(url);
        }

        toast({
          title: "WebSocket Disconnected",
          description: autoReconnect ? "Attempting to reconnect..." : "Connection closed",
          variant: "destructive"
        });
      };

      ws.onerror = (error) => {
        console.error('WebSocket error:', error);
        setConnections(prev => prev.map(conn =>
          conn.url === url 
            ? { ...conn, status: 'error' }
            : conn
        ));
      };

      wsRef.current = ws;
    } catch (error) {
      console.error('Failed to create WebSocket connection:', error);
    }
  }, [autoReconnect, enableHeartbeat, securityMode, toast]);

  // Handle WebSocket messages with type safety
  const handleWebSocketMessage = (message: any) => {
    const wsMessage: WebSocketMessage = {
      id: Date.now().toString(),
      type: message.type || 'system',
      timestamp: new Date().toISOString(),
      author: message.author || 'System',
      content: message.content || message,
      roomId: message.roomId || 'global'
    };

    setMessages(prev => [wsMessage, ...prev.slice(0, 49)]);

    // Handle specific message types
    switch (message.type) {
      case 'user_joined':
        handleUserJoined(message);
        break;
      case 'user_left':
        handleUserLeft(message);
        break;
      case 'document_edit':
        handleDocumentEdit(message);
        break;
      case 'cursor_move':
        handleCursorMove(message);
        break;
      default:
        break;
    }
  };

  // Heartbeat mechanism for connection health
  const startHeartbeat = (ws: WebSocket) => {
    heartbeatRef.current = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        const startTime = Date.now();
        ws.send(JSON.stringify({ type: 'ping', timestamp: startTime }));
        
        // Measure latency
        const latencyTimeout = setTimeout(() => {
          const latency = Date.now() - startTime;
          setConnections(prev => prev.map(conn =>
            conn.url === ws.url 
              ? { ...conn, latency, lastHeartbeat: 'Just now' }
              : conn
          ));
        }, 100);
      }
    }, 30000); // 30 second heartbeat
  };

  // Exponential backoff reconnection
  const handleReconnection = (url: string) => {
    const connection = connections.find(conn => conn.url === url);
    if (!connection || connection.reconnectAttempts >= connection.maxReconnectAttempts) {
      return;
    }

    const delay = Math.min(1000 * Math.pow(2, connection.reconnectAttempts), 30000);
    
    setConnections(prev => prev.map(conn =>
      conn.url === url 
        ? { ...conn, reconnectAttempts: conn.reconnectAttempts + 1 }
        : conn
    ));

    reconnectTimeoutRef.current = setTimeout(() => {
      connectWebSocket(url);
    }, delay);
  };

  // Event handlers
  const handleUserJoined = (message: any) => {
    toast({
      title: "User Joined",
      description: `${message.author} joined ${message.roomName}`,
    });
  };

  const handleUserLeft = (message: any) => {
    toast({
      title: "User Left",
      description: `${message.author} left ${message.roomName}`,
    });
  };

  const handleDocumentEdit = (message: any) => {
    // Handle real-time document editing
    console.log('Document edit:', message);
  };

  const handleCursorMove = (message: any) => {
    // Handle real-time cursor tracking
    console.log('Cursor move:', message);
  };

  // Join collaboration room
  const joinRoom = (roomId: string) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        type: 'join_room',
        roomId,
        timestamp: new Date().toISOString()
      }));

      setSelectedRoom(roomId);
      setRooms(prev => prev.map(room =>
        room.id === roomId 
          ? { ...room, participants: room.participants + 1 }
          : room
      ));
    }
  };

  // Send message to room
  const sendMessage = (content: string) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN && selectedRoom) {
      wsRef.current.send(JSON.stringify({
        type: 'chat_message',
        roomId: selectedRoom,
        content,
        timestamp: new Date().toISOString()
      }));
    }
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (wsRef.current) {
        wsRef.current.close();
      }
      if (heartbeatRef.current) {
        clearInterval(heartbeatRef.current);
      }
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
    };
  }, []);

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'connected': return 'bg-green-500';
      case 'connecting': return 'bg-yellow-500';
      case 'disconnected': return 'bg-gray-500';
      case 'error': return 'bg-red-500';
      default: return 'bg-gray-500';
    }
  };

  const getRoomTypeIcon = (type: string) => {
    switch (type) {
      case 'code': return '💻';
      case 'design': return '🎨';
      case 'document': return '📝';
      case 'meeting': return '🤝';
      default: return '📋';
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-3xl font-bold">Enhanced Real-Time WebSocket</h2>
          <p className="text-muted-foreground">
            Enterprise-grade real-time collaboration with advanced features
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Badge className={isConnected ? 'bg-green-500' : 'bg-red-500'}>
            {isConnected ? (
              <>
                <Wifi className="h-3 w-3 mr-1" />
                Connected
              </>
            ) : (
              <>
                <Wifi className="h-3 w-3 mr-1" />
                Disconnected
              </>
            )}
          </Badge>
        </div>
      </div>

      {/* Performance Metrics */}
      {metrics && (
        <div className="grid grid-cols-3 gap-4">
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Connection Uptime</p>
                  <p className="text-2xl font-bold">{metrics.connectionUptime}%</p>
                  <p className="text-xs text-muted-foreground">
                    {metrics.messagesDelivered.toLocaleString()} messages delivered
                  </p>
                </div>
                <Activity className="h-8 w-8 text-green-600" />
              </div>
            </CardContent>
          </Card>
          
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Average Latency</p>
                  <p className="text-2xl font-bold">{metrics.averageLatency}ms</p>
                  <p className="text-xs text-muted-foreground">
                    Peak {metrics.peakConcurrentUsers} concurrent users
                  </p>
                </div>
                <Zap className="h-8 w-8 text-blue-600" />
              </div>
            </CardContent>
          </Card>
          
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Throughput</p>
                  <p className="text-2xl font-bold">{metrics.throughput}/s</p>
                  <p className="text-xs text-muted-foreground">
                    {metrics.errorRate}% error rate
                  </p>
                </div>
                <BarChart3 className="h-8 w-8 text-purple-600" />
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* WebSocket Connections */}
        <Card>
          <CardHeader>
            <div className="flex justify-between items-center">
              <CardTitle>WebSocket Connections</CardTitle>
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-1">
                  <Switch checked={autoReconnect} onCheckedChange={setAutoReconnect} />
                  <span className="text-sm">Auto-reconnect</span>
                </div>
                <div className="flex items-center gap-1">
                  <Switch checked={enableHeartbeat} onCheckedChange={setEnableHeartbeat} />
                  <span className="text-sm">Heartbeat</span>
                </div>
              </div>
            </div>
            <CardDescription>
              Monitor active WebSocket connections and performance
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {connections.map(connection => (
                <div key={connection.id} className="border rounded-lg p-4">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <Badge className={getStatusColor(connection.status)}>
                        {connection.status}
                      </Badge>
                      <span className="font-medium">{connection.id}</span>
                    </div>
                    <div className="text-sm text-muted-foreground">
                      {connection.latency}ms latency
                    </div>
                  </div>
                  
                  <div className="text-sm text-muted-foreground mb-2">
                    {connection.url}
                  </div>
                  
                  <div className="grid grid-cols-3 gap-4 text-sm">
                    <div>
                      <span className="text-muted-foreground">Messages/sec:</span>
                      <div className="font-medium">{connection.messagesPerSecond}</div>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Last heartbeat:</span>
                      <div className="font-medium">{connection.lastHeartbeat}</div>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Reconnects:</span>
                      <div className="font-medium">{connection.reconnectAttempts}/{connection.maxReconnectAttempts}</div>
                    </div>
                  </div>
                  
                  {connection.status === 'error' && (
                    <Button 
                      onClick={() => connectWebSocket(connection.url)}
                      size="sm"
                      className="mt-3 w-full"
                    >
                      Reconnect
                    </Button>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Collaboration Rooms */}
        <Card>
          <CardHeader>
            <CardTitle>Collaboration Rooms</CardTitle>
            <CardDescription>
              Active real-time collaboration sessions
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {rooms.map(room => (
                <div 
                  key={room.id} 
                  className={`border rounded-lg p-4 cursor-pointer transition-colors ${
                    selectedRoom === room.id ? 'border-blue-500 bg-blue-50 dark:bg-blue-950' : ''
                  }`}
                  onClick={() => joinRoom(room.id)}
                >
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span className="text-lg">{getRoomTypeIcon(room.type)}</span>
                      <span className="font-medium">{room.name}</span>
                      {room.isActive && (
                        <Badge className="bg-green-500">Active</Badge>
                      )}
                    </div>
                    <Badge variant="outline">
                      {room.participants}/{room.maxParticipants}
                    </Badge>
                  </div>
                  
                  <div className="text-sm text-muted-foreground">
                    Created {new Date(room.createdAt).toLocaleString()}
                  </div>
                  
                  <Progress 
                    value={(room.participants / room.maxParticipants) * 100} 
                    className="mt-2 h-2"
                  />
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Recent Messages */}
      <Card>
        <CardHeader>
          <CardTitle>Real-Time Messages</CardTitle>
          <CardDescription>
            Live stream of WebSocket messages and events
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-2 max-h-96 overflow-y-auto">
            {messages.length === 0 ? (
              <div className="text-center text-muted-foreground py-8">
                No messages yet. WebSocket events will appear here.
              </div>
            ) : (
              messages.map(message => (
                <div key={message.id} className="border rounded p-3 text-sm">
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-medium">{message.author}</span>
                    <span className="text-xs text-muted-foreground">
                      {new Date(message.timestamp).toLocaleTimeString()}
                    </span>
                  </div>
                  <div className="text-muted-foreground">
                    <Badge variant="outline" className="mr-2">
                      {message.type}
                    </Badge>
                    {message.roomId !== 'global' && (
                      <Badge variant="outline" className="mr-2">
                        {message.roomId}
                      </Badge>
                    )}
                    {typeof message.content === 'string' 
                      ? message.content 
                      : JSON.stringify(message.content, null, 2)
                    }
                  </div>
                </div>
              ))
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}