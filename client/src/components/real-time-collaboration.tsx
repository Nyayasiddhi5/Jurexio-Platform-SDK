import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/hooks/use-toast';
import { useWebSocket } from '@/hooks/use-websocket';
import { 
  Users, MessageCircle, Share2, Edit3, Eye,
  Video, Mic, MicOff, VideoOff, Phone, PhoneOff,
  Settings, Crown, UserPlus, Bell, Activity, Clock,
  GitBranch, Zap, Globe, Lock, Unlock, FileText
} from 'lucide-react';

interface CollaborationUser {
  id: string;
  name: string;
  email: string;
  avatar?: string;
  role: 'owner' | 'editor' | 'viewer';
  status: 'online' | 'away' | 'offline';
  cursor?: { x: number; y: number };
  currentPage?: string;
  lastSeen: string;
  voiceActive?: boolean;
}

interface CollaborationMessage {
  id: string;
  userId: string;
  message: string;
  type: 'chat' | 'system' | 'mention';
  timestamp: string;
  replyTo?: string;
}

interface CollaborationSession {
  id: string;
  projectId: string;
  name: string;
  users: CollaborationUser[];
  isActive: boolean;
  createdAt: string;
  permissions: {
    allowChat: boolean;
    allowVoice: boolean;
    allowVideo: boolean;
    allowEdit: boolean;
    allowInvite: boolean;
  };
}

interface RealTimeCollaborationProps {
  projectId: string;
  userId: string;
  onUserJoin?: (user: CollaborationUser) => void;
  onUserLeave?: (userId: string) => void;
  mode?: 'full' | 'sidebar' | 'minimal';
}

export default function RealTimeCollaboration({ 
  projectId, 
  userId, 
  onUserJoin, 
  onUserLeave, 
  mode = 'full' 
}: RealTimeCollaborationProps) {
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState('users');
  const [message, setMessage] = useState('');
  const [isVoiceActive, setIsVoiceActive] = useState(false);
  const [isVideoActive, setIsVideoActive] = useState(false);
  const [messages, setMessages] = useState<CollaborationMessage[]>([]);
  const [users, setUsers] = useState<CollaborationUser[]>([]);
  const [session, setSession] = useState<CollaborationSession | null>(null);
  const [inviteEmail, setInviteEmail] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // WebSocket connection for real-time collaboration
  const { isConnected, sendMessage: sendWSMessage } = useWebSocket('/ws');

  useEffect(() => {
    // Initialize collaboration session
    initializeSession();
    
    // Join the collaboration room
    if (isConnected) {
      sendWSMessage({
        type: 'join_collaboration',
        projectId,
        userId
      });
    }

    return () => {
      // Leave collaboration room on cleanup
      if (isConnected) {
        sendWSMessage({
          type: 'leave_collaboration',
          projectId,
          userId
        });
      }
    };
  }, [projectId, userId, isConnected]);

  useEffect(() => {
    // Auto-scroll to bottom of messages
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const initializeSession = async () => {
    try {
      // Create or join collaboration session
      const sessionData: CollaborationSession = {
        id: `session-${projectId}`,
        projectId,
        name: 'Development Session',
        users: [],
        isActive: true,
        createdAt: new Date().toISOString(),
        permissions: {
          allowChat: true,
          allowVoice: true,
          allowVideo: true,
          allowEdit: true,
          allowInvite: true
        }
      };
      setSession(sessionData);
    } catch (error) {
      console.error('Failed to initialize collaboration session:', error);
    }
  };

  const handleWebSocketMessage = (data: any) => {
    switch (data.type) {
      case 'user_joined':
        const newUser: CollaborationUser = data.user;
        setUsers(prev => [...prev.filter(u => u.id !== newUser.id), newUser]);
        
        if (onUserJoin) {
          onUserJoin(newUser);
        }

        toast({
          title: "User Joined",
          description: `${newUser.name} joined the collaboration session`
        });
        break;

      case 'user_left':
        setUsers(prev => prev.filter(u => u.id !== data.userId));
        
        if (onUserLeave) {
          onUserLeave(data.userId);
        }

        toast({
          title: "User Left",
          description: `${data.userName} left the session`
        });
        break;

      case 'chat_message':
        const chatMessage: CollaborationMessage = {
          id: data.id,
          userId: data.userId,
          message: data.message,
          type: data.messageType || 'chat',
          timestamp: data.timestamp,
          replyTo: data.replyTo
        };
        setMessages(prev => [...prev, chatMessage]);
        break;

      case 'cursor_move':
        setUsers(prev => prev.map(user => 
          user.id === data.userId 
            ? { ...user, cursor: data.cursor }
            : user
        ));
        break;

      case 'page_change':
        setUsers(prev => prev.map(user => 
          user.id === data.userId 
            ? { ...user, currentPage: data.page }
            : user
        ));
        break;

      case 'voice_status':
        setUsers(prev => prev.map(user => 
          user.id === data.userId 
            ? { ...user, voiceActive: data.active }
            : user
        ));
        break;

      default:
        console.log('Unknown collaboration message:', data);
    }
  };

  const sendChatMessage = () => {
    if (!message.trim() || !isConnected) return;

    const newMessage: CollaborationMessage = {
      id: Date.now().toString(),
      userId,
      message: message.trim(),
      type: 'chat',
      timestamp: new Date().toISOString()
    };

    // Send to WebSocket
    sendWSMessage({
      type: 'chat_message',
      projectId,
      ...newMessage
    });

    // Add to local state
    setMessages(prev => [...prev, newMessage]);
    setMessage('');
  };

  const toggleVoice = () => {
    setIsVoiceActive(!isVoiceActive);
    
    sendWSMessage({
      type: 'voice_status',
      projectId,
      userId,
      active: !isVoiceActive
    });

    toast({
      title: isVoiceActive ? "Voice Disabled" : "Voice Enabled",
      description: isVoiceActive ? "You are now muted" : "You can now speak"
    });
  };

  const toggleVideo = () => {
    setIsVideoActive(!isVideoActive);
    
    sendWSMessage({
      type: 'video_status',
      projectId,
      userId,
      active: !isVideoActive
    });

    toast({
      title: isVideoActive ? "Video Disabled" : "Video Enabled",
      description: isVideoActive ? "Camera turned off" : "Camera turned on"
    });
  };

  const inviteUser = () => {
    if (!inviteEmail.trim()) return;

    // Send invitation (would integrate with email service)
    toast({
      title: "Invitation Sent",
      description: `Collaboration invite sent to ${inviteEmail}`
    });

    setInviteEmail('');
  };

  const getRoleColor = (role: string) => {
    switch (role) {
      case 'owner': return 'bg-purple-100 text-purple-800';
      case 'editor': return 'bg-blue-100 text-blue-800';
      case 'viewer': return 'bg-gray-100 text-gray-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'online': return 'bg-green-500';
      case 'away': return 'bg-yellow-500';
      case 'offline': return 'bg-gray-400';
      default: return 'bg-gray-400';
    }
  };

  if (mode === 'minimal') {
    return (
      <div className="flex items-center gap-2">
        <div className="flex -space-x-2">
          {users.slice(0, 3).map((user) => (
            <Avatar key={user.id} className="h-8 w-8 border-2 border-white">
              <AvatarImage src={user.avatar} />
              <AvatarFallback className="text-xs">
                {user.name.charAt(0).toUpperCase()}
              </AvatarFallback>
            </Avatar>
          ))}
          {users.length > 3 && (
            <div className="h-8 w-8 rounded-full bg-gray-200 border-2 border-white flex items-center justify-center text-xs font-medium">
              +{users.length - 3}
            </div>
          )}
        </div>
        
        {users.length > 0 && (
          <Badge variant="secondary" className="gap-1">
            <Users className="h-3 w-3" />
            {users.length} online
          </Badge>
        )}
      </div>
    );
  }

  if (mode === 'sidebar') {
    return (
      <Card className="w-80 h-full">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Users className="h-5 w-5" />
            Collaboration
            {isConnected ? (
              <div className="h-2 w-2 bg-green-500 rounded-full" />
            ) : (
              <div className="h-2 w-2 bg-red-500 rounded-full" />
            )}
          </CardTitle>
        </CardHeader>
        
        <CardContent className="p-0 h-[calc(100%-5rem)]">
          <Tabs value={activeTab} onValueChange={setActiveTab} className="h-full">
            <TabsList className="grid w-full grid-cols-2 mx-4">
              <TabsTrigger value="users">Users</TabsTrigger>
              <TabsTrigger value="chat">Chat</TabsTrigger>
            </TabsList>

            <TabsContent value="users" className="h-full px-4 pb-4">
              <ScrollArea className="h-full">
                <div className="space-y-3">
                  {users.map((user) => (
                    <div key={user.id} className="flex items-center gap-3 p-2 rounded-lg hover:bg-gray-50">
                      <div className="relative">
                        <Avatar className="h-8 w-8">
                          <AvatarImage src={user.avatar} />
                          <AvatarFallback className="text-xs">
                            {user.name.charAt(0).toUpperCase()}
                          </AvatarFallback>
                        </Avatar>
                        <div className={`absolute -bottom-1 -right-1 h-3 w-3 rounded-full border-2 border-white ${getStatusColor(user.status)}`} />
                      </div>
                      
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{user.name}</p>
                        <div className="flex items-center gap-1">
                          <Badge className={`text-xs ${getRoleColor(user.role)}`}>
                            {user.role}
                          </Badge>
                        </div>
                      </div>
                    </div>
                  ))}

                  {users.length === 0 && (
                    <div className="text-center py-8 text-gray-500">
                      <Users className="h-8 w-8 mx-auto mb-2 opacity-50" />
                      <p className="text-sm">No collaborators online</p>
                    </div>
                  )}
                </div>
              </ScrollArea>
            </TabsContent>

            <TabsContent value="chat" className="h-full px-4 pb-4 flex flex-col">
              <ScrollArea className="flex-1 mb-4">
                <div className="space-y-3">
                  {messages.map((msg) => {
                    const user = users.find(u => u.id === msg.userId);
                    return (
                      <div key={msg.id} className="flex gap-2">
                        <Avatar className="h-6 w-6 mt-1">
                          <AvatarImage src={user?.avatar} />
                          <AvatarFallback className="text-xs">
                            {user?.name?.charAt(0)?.toUpperCase() || '?'}
                          </AvatarFallback>
                        </Avatar>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium">{user?.name || 'Unknown'}</span>
                            <span className="text-xs text-gray-500">
                              {new Date(msg.timestamp).toLocaleTimeString()}
                            </span>
                          </div>
                          <p className="text-sm text-gray-700 mt-1">{msg.message}</p>
                        </div>
                      </div>
                    );
                  })}
                  <div ref={messagesEndRef} />
                </div>
              </ScrollArea>

              <div className="flex gap-2">
                <Input
                  placeholder="Type a message..."
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  onKeyPress={(e) => e.key === 'Enter' && sendChatMessage()}
                  className="flex-1"
                />
                <Button 
                  size="sm" 
                  onClick={sendChatMessage}
                  disabled={!message.trim() || !isConnected}
                >
                  <MessageCircle className="h-4 w-4" />
                </Button>
              </div>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    );
  }

  // Full mode
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-2xl font-bold bg-gradient-to-r from-purple-600 to-pink-600 bg-clip-text text-transparent">
            Real-Time Collaboration
          </h3>
          <p className="text-gray-600 dark:text-gray-400">
            Work together seamlessly with your team
          </p>
        </div>

        <div className="flex items-center gap-3">
          <Badge variant={isConnected ? 'default' : 'destructive'} className="gap-2">
            <Activity className="h-4 w-4" />
            {isConnected ? 'Connected' : 'Disconnected'}
          </Badge>
          
          <div className="flex items-center gap-2">
            <Button
              variant={isVoiceActive ? 'default' : 'outline'}
              size="sm"
              onClick={toggleVoice}
            >
              {isVoiceActive ? <Mic className="h-4 w-4" /> : <MicOff className="h-4 w-4" />}
            </Button>
            
            <Button
              variant={isVideoActive ? 'default' : 'outline'}
              size="sm"
              onClick={toggleVideo}
            >
              {isVideoActive ? <Video className="h-4 w-4" /> : <VideoOff className="h-4 w-4" />}
            </Button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Active Users */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Users className="h-5 w-5" />
              Active Users ({users.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-64">
              <div className="space-y-3">
                {users.map((user) => (
                  <motion.div
                    key={user.id}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="flex items-center gap-3 p-3 rounded-lg border bg-gray-50/50"
                  >
                    <div className="relative">
                      <Avatar className="h-10 w-10">
                        <AvatarImage src={user.avatar} />
                        <AvatarFallback>
                          {user.name.charAt(0).toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                      <div className={`absolute -bottom-1 -right-1 h-3 w-3 rounded-full border-2 border-white ${getStatusColor(user.status)}`} />
                    </div>
                    
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <p className="font-medium">{user.name}</p>
                        {user.role === 'owner' && <Crown className="h-4 w-4 text-yellow-500" />}
                      </div>
                      <div className="flex items-center gap-2 mt-1">
                        <Badge className={`text-xs ${getRoleColor(user.role)}`}>
                          {user.role}
                        </Badge>
                        {user.currentPage && (
                          <Badge variant="outline" className="text-xs flex items-center gap-1">
                            <FileText className="h-3 w-3" />
                            {user.currentPage}
                          </Badge>
                        )}
                      </div>
                    </div>
                  </motion.div>
                ))}
                
                {users.length === 0 && (
                  <div className="text-center py-8 text-gray-500">
                    <Users className="h-12 w-12 mx-auto mb-3 opacity-30" />
                    <p>No collaborators online</p>
                    <p className="text-sm mt-1">Invite team members to start collaborating</p>
                  </div>
                )}
              </div>
            </ScrollArea>

            <div className="mt-4 space-y-2">
              <div className="flex gap-2">
                <Input
                  placeholder="Enter email to invite..."
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  onKeyPress={(e) => e.key === 'Enter' && inviteUser()}
                />
                <Button onClick={inviteUser} size="sm">
                  <UserPlus className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Chat */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <MessageCircle className="h-5 w-5" />
              Team Chat
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col h-80">
              <ScrollArea className="flex-1 mb-4 border rounded-lg p-4">
                <div className="space-y-4">
                  {messages.map((msg) => {
                    const user = users.find(u => u.id === msg.userId);
                    return (
                      <motion.div
                        key={msg.id}
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="flex gap-3"
                      >
                        <Avatar className="h-8 w-8 mt-1">
                          <AvatarImage src={user?.avatar} />
                          <AvatarFallback className="text-xs">
                            {user?.name?.charAt(0)?.toUpperCase() || '?'}
                          </AvatarFallback>
                        </Avatar>
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="font-medium text-sm">
                              {user?.name || 'Unknown User'}
                            </span>
                            <Badge className={`text-xs ${getRoleColor(user?.role || 'viewer')}`}>
                              {user?.role || 'viewer'}
                            </Badge>
                            <span className="text-xs text-gray-500">
                              {new Date(msg.timestamp).toLocaleTimeString()}
                            </span>
                          </div>
                          <p className="text-sm text-gray-700 bg-gray-100 rounded-lg px-3 py-2 inline-block">
                            {msg.message}
                          </p>
                        </div>
                      </motion.div>
                    );
                  })}
                  
                  {messages.length === 0 && (
                    <div className="text-center py-8 text-gray-500">
                      <MessageCircle className="h-12 w-12 mx-auto mb-3 opacity-30" />
                      <p>No messages yet</p>
                      <p className="text-sm mt-1">Start the conversation with your team</p>
                    </div>
                  )}
                  
                  <div ref={messagesEndRef} />
                </div>
              </ScrollArea>

              <div className="flex gap-2">
                <Input
                  placeholder="Type your message..."
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  onKeyPress={(e) => e.key === 'Enter' && sendChatMessage()}
                  className="flex-1"
                />
                <Button 
                  onClick={sendChatMessage}
                  disabled={!message.trim() || !isConnected}
                >
                  <MessageCircle className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}