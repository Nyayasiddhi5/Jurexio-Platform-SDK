/**
 * Advanced Collaboration Suite - Phase 3 Enterprise Feature
 * 
 * Real-time multi-user editing, version history, permission-based access,
 * and comprehensive collaboration tools for enterprise teams
 */

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Progress } from '@/components/ui/progress';
import { 
  Users, Edit3, Clock, GitBranch, Share2, Lock, Unlock,
  Eye, MessageCircle, Video, Phone, Settings, Crown,
  UserPlus, UserMinus, Shield, Bell, History, Copy,
  Download, Upload, Merge, Split, Undo, Redo, Save,
  FileText, Image, Code, Database, Globe, Zap
} from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import { useToast } from '@/hooks/use-toast';

interface CollaborationRoom {
  id: string;
  name: string;
  type: 'document' | 'code' | 'design' | 'presentation' | 'database';
  description: string;
  status: 'active' | 'idle' | 'locked';
  participants: Participant[];
  activeUsers: number;
  permissions: RoomPermissions;
  version: DocumentVersion;
  lastActivity: string;
  createdAt: string;
  createdBy: string;
}

interface Participant {
  id: string;
  name: string;
  email: string;
  avatar: string;
  role: 'owner' | 'admin' | 'editor' | 'viewer' | 'commenter';
  status: 'online' | 'away' | 'offline';
  cursor?: CursorPosition;
  lastSeen: string;
  permissions: UserPermissions;
}

interface CursorPosition {
  x: number;
  y: number;
  selection?: TextSelection;
  color: string;
}

interface TextSelection {
  start: number;
  end: number;
  text: string;
}

interface RoomPermissions {
  allowGuests: boolean;
  requireApproval: boolean;
  allowExport: boolean;
  allowVersionHistory: boolean;
  editPermissions: 'all' | 'editors' | 'admins';
  commentPermissions: 'all' | 'members' | 'editors';
}

interface UserPermissions {
  canEdit: boolean;
  canComment: boolean;
  canShare: boolean;
  canManageUsers: boolean;
  canExport: boolean;
  canViewHistory: boolean;
}

interface DocumentVersion {
  id: string;
  version: string;
  timestamp: string;
  author: string;
  changes: string[];
  size: string;
  status: 'current' | 'archived';
  branches?: DocumentBranch[];
}

interface DocumentBranch {
  id: string;
  name: string;
  author: string;
  created: string;
  commits: number;
  status: 'active' | 'merged' | 'abandoned';
}

interface CollaborationActivity {
  id: string;
  type: 'edit' | 'comment' | 'join' | 'leave' | 'version' | 'permission';
  user: string;
  description: string;
  timestamp: string;
  details?: any;
}

interface RealTimeEdit {
  id: string;
  userId: string;
  userName: string;
  type: 'insert' | 'delete' | 'format';
  position: number;
  content: string;
  timestamp: string;
}

export default function AdvancedCollaborationSuite() {
  const [activeTab, setActiveTab] = useState('rooms');
  const [selectedRoom, setSelectedRoom] = useState<string | null>(null);
  const [isCreatingRoom, setIsCreatingRoom] = useState(false);
  const [roomForm, setRoomForm] = useState({
    name: '',
    type: 'document' as const,
    description: '',
    permissions: {
      allowGuests: false,
      requireApproval: true,
      allowExport: true,
      allowVersionHistory: true,
      editPermissions: 'editors' as const,
      commentPermissions: 'all' as const
    }
  });
  const [liveEdits, setLiveEdits] = useState<RealTimeEdit[]>([]);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  // Fetch collaboration rooms using Jurexio orchestration
  const { data: rooms = [], isLoading: roomsLoading } = useQuery({
    queryKey: ['/api/jurexio/collaboration/rooms'],
    queryFn: () => apiRequest('/api/jurexio/collaboration/rooms')
  });

  // Fetch room details using Jurexio orchestration
  const { data: roomDetails, isLoading: roomDetailsLoading } = useQuery({
    queryKey: ['/api/jurexio/collaboration/rooms', selectedRoom],
    queryFn: () => apiRequest(`/api/jurexio/collaboration/rooms/${selectedRoom}`),
    enabled: !!selectedRoom
  });

  // Fetch collaboration activity using Jurexio orchestration
  const { data: activity = [], isLoading: activityLoading } = useQuery({
    queryKey: ['/api/jurexio/collaboration/activity', selectedRoom],
    queryFn: () => apiRequest(`/api/jurexio/collaboration/activity?room=${selectedRoom || 'all'}`)
  });

  // Fetch version history using Jurexio orchestration
  const { data: versions = [], isLoading: versionsLoading } = useQuery({
    queryKey: ['/api/jurexio/collaboration/versions', selectedRoom],
    queryFn: () => apiRequest(`/api/jurexio/collaboration/versions?room=${selectedRoom || ''}`),
    enabled: !!selectedRoom
  });

  // Create room mutation
  const createRoom = useMutation({
    mutationFn: (room: any) => apiRequest('/api/jurexio/collaboration/rooms', {
      method: 'POST',
      body: JSON.stringify(room)
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/jurexio/collaboration/rooms'] });
      setIsCreatingRoom(false);
      setRoomForm({
        name: '',
        type: 'document',
        description: '',
        permissions: {
          allowGuests: false,
          requireApproval: true,
          allowExport: true,
          allowVersionHistory: true,
          editPermissions: 'editors',
          commentPermissions: 'all'
        }
      });
      toast({
        title: "Room Created",
        description: "Collaboration room has been created successfully"
      });
    }
  });

  // Join room mutation
  const joinRoom = useMutation({
    mutationFn: (roomId: string) => apiRequest(`/api/jurexio/collaboration/rooms/${roomId}/join`, {
      method: 'POST'
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/jurexio/collaboration'] });
      toast({
        title: "Joined Room",
        description: "You have successfully joined the collaboration room"
      });
    }
  });

  // Invite user mutation
  const inviteUser = useMutation({
    mutationFn: (data: { roomId: string; email: string; role: string }) => 
      apiRequest(`/api/jurexio/collaboration/rooms/${data.roomId}/invite`, {
        method: 'POST',
        body: JSON.stringify({ email: data.email, role: data.role })
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/jurexio/collaboration'] });
      toast({
        title: "Invitation Sent",
        description: "User invitation has been sent successfully"
      });
    }
  });

  const mockRooms: CollaborationRoom[] = [
    {
      id: '1',
      name: 'Product Requirements Document',
      type: 'document',
      description: 'Collaborative document for Q4 product planning',
      status: 'active',
      participants: [
        {
          id: '1',
          name: 'Sarah Johnson',
          email: 'sarah@example.com',
          avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=sarah',
          role: 'owner',
          status: 'online',
          cursor: { x: 120, y: 45, color: '#3B82F6' },
          lastSeen: '2025-08-17T12:00:00Z',
          permissions: {
            canEdit: true,
            canComment: true,
            canShare: true,
            canManageUsers: true,
            canExport: true,
            canViewHistory: true
          }
        },
        {
          id: '2',
          name: 'Mike Chen',
          email: 'mike@example.com',
          avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=mike',
          role: 'editor',
          status: 'online',
          cursor: { x: 200, y: 120, color: '#10B981' },
          lastSeen: '2025-08-17T11:58:00Z',
          permissions: {
            canEdit: true,
            canComment: true,
            canShare: false,
            canManageUsers: false,
            canExport: true,
            canViewHistory: true
          }
        },
        {
          id: '3',
          name: 'Lisa Rodriguez',
          email: 'lisa@example.com',
          avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=lisa',
          role: 'commenter',
          status: 'away',
          lastSeen: '2025-08-17T11:30:00Z',
          permissions: {
            canEdit: false,
            canComment: true,
            canShare: false,
            canManageUsers: false,
            canExport: false,
            canViewHistory: true
          }
        }
      ],
      activeUsers: 2,
      permissions: {
        allowGuests: false,
        requireApproval: true,
        allowExport: true,
        allowVersionHistory: true,
        editPermissions: 'editors',
        commentPermissions: 'all'
      },
      version: {
        id: 'v1.5',
        version: '1.5',
        timestamp: '2025-08-17T11:45:00Z',
        author: 'Sarah Johnson',
        changes: ['Added market analysis section', 'Updated timeline', 'Fixed formatting issues'],
        size: '2.3 MB',
        status: 'current'
      },
      lastActivity: '2025-08-17T11:58:00Z',
      createdAt: '2025-08-15T09:00:00Z',
      createdBy: 'sarah@example.com'
    },
    {
      id: '2',
      name: 'Frontend Codebase Review',
      type: 'code',
      description: 'Code review session for the new React components',
      status: 'active',
      participants: [
        {
          id: '4',
          name: 'Alex Kumar',
          email: 'alex@example.com',
          avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=alex',
          role: 'owner',
          status: 'online',
          cursor: { x: 300, y: 180, color: '#F59E0B' },
          lastSeen: '2025-08-17T12:02:00Z',
          permissions: {
            canEdit: true,
            canComment: true,
            canShare: true,
            canManageUsers: true,
            canExport: true,
            canViewHistory: true
          }
        },
        {
          id: '5',
          name: 'Emma Wilson',
          email: 'emma@example.com',
          avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=emma',
          role: 'editor',
          status: 'online',
          cursor: { x: 180, y: 220, color: '#EF4444' },
          lastSeen: '2025-08-17T12:01:00Z',
          permissions: {
            canEdit: true,
            canComment: true,
            canShare: false,
            canManageUsers: false,
            canExport: true,
            canViewHistory: true
          }
        }
      ],
      activeUsers: 2,
      permissions: {
        allowGuests: true,
        requireApproval: false,
        allowExport: true,
        allowVersionHistory: true,
        editPermissions: 'all',
        commentPermissions: 'all'
      },
      version: {
        id: 'v2.1',
        version: '2.1',
        timestamp: '2025-08-17T12:00:00Z',
        author: 'Alex Kumar',
        changes: ['Refactored authentication logic', 'Added error boundaries', 'Updated tests'],
        size: '156 KB',
        status: 'current',
        branches: [
          {
            id: 'feature-auth',
            name: 'feature/authentication',
            author: 'Alex Kumar',
            created: '2025-08-16T14:00:00Z',
            commits: 8,
            status: 'active'
          },
          {
            id: 'bugfix-ui',
            name: 'bugfix/ui-responsiveness',
            author: 'Emma Wilson',
            created: '2025-08-17T10:00:00Z',
            commits: 3,
            status: 'active'
          }
        ]
      },
      lastActivity: '2025-08-17T12:02:00Z',
      createdAt: '2025-08-16T13:00:00Z',
      createdBy: 'alex@example.com'
    }
  ];

  const mockActivity: CollaborationActivity[] = [
    {
      id: '1',
      type: 'edit',
      user: 'Mike Chen',
      description: 'Updated market analysis section',
      timestamp: '2025-08-17T11:58:00Z',
      details: { section: 'Market Analysis', changes: 15 }
    },
    {
      id: '2',
      type: 'comment',
      user: 'Lisa Rodriguez',
      description: 'Added comment on pricing strategy',
      timestamp: '2025-08-17T11:45:00Z',
      details: { comment: 'Consider subscription tiers', location: 'Section 4.2' }
    },
    {
      id: '3',
      type: 'version',
      user: 'Sarah Johnson',
      description: 'Created version 1.5',
      timestamp: '2025-08-17T11:30:00Z',
      details: { version: '1.5', changes: 3 }
    },
    {
      id: '4',
      type: 'join',
      user: 'Mike Chen',
      description: 'Joined the collaboration session',
      timestamp: '2025-08-17T11:15:00Z'
    }
  ];

  const mockVersions: DocumentVersion[] = [
    {
      id: 'v1.5',
      version: '1.5',
      timestamp: '2025-08-17T11:45:00Z',
      author: 'Sarah Johnson',
      changes: ['Added market analysis section', 'Updated timeline', 'Fixed formatting issues'],
      size: '2.3 MB',
      status: 'current'
    },
    {
      id: 'v1.4',
      version: '1.4',
      timestamp: '2025-08-17T10:30:00Z',
      author: 'Mike Chen',
      changes: ['Revised competitive analysis', 'Added user personas'],
      size: '2.1 MB',
      status: 'archived'
    },
    {
      id: 'v1.3',
      version: '1.3',
      timestamp: '2025-08-17T09:15:00Z',
      author: 'Sarah Johnson',
      changes: ['Initial draft completion', 'Added executive summary'],
      size: '1.9 MB',
      status: 'archived'
    }
  ];

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'online': return 'bg-green-500';
      case 'away': return 'bg-yellow-500';
      case 'offline': return 'bg-gray-400';
      default: return 'bg-gray-400';
    }
  };

  const getRoleColor = (role: string) => {
    switch (role) {
      case 'owner': return 'text-purple-600';
      case 'admin': return 'text-blue-600';
      case 'editor': return 'text-green-600';
      case 'commenter': return 'text-yellow-600';
      case 'viewer': return 'text-gray-600';
      default: return 'text-gray-600';
    }
  };

  const getTypeIcon = (type: string) => {
    switch (type) {
      case 'document': return FileText;
      case 'code': return Code;
      case 'design': return Image;
      case 'presentation': return FileText;
      case 'database': return Database;
      default: return FileText;
    }
  };

  const handleCreateRoom = async () => {
    if (!roomForm.name.trim()) {
      toast({
        title: "Missing Information",
        description: "Please enter a room name",
        variant: "destructive"
      });
      return;
    }

    const newRoom = {
      ...roomForm,
      id: `room-${Date.now()}`,
      status: 'idle',
      participants: [],
      activeUsers: 0
    };

    await createRoom.mutateAsync(newRoom);
  };

  // Simulate real-time editing
  useEffect(() => {
    if (selectedRoom) {
      const interval = setInterval(() => {
        const mockEdit: RealTimeEdit = {
          id: `edit-${Date.now()}`,
          userId: '2',
          userName: 'Mike Chen',
          type: 'insert',
          position: Math.floor(Math.random() * 1000),
          content: 'New content added...',
          timestamp: new Date().toISOString()
        };
        setLiveEdits(prev => [...prev.slice(-9), mockEdit]);
      }, 5000);

      return () => clearInterval(interval);
    }
  }, [selectedRoom]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Advanced Collaboration Suite</h2>
          <p className="text-muted-foreground">
            Real-time collaboration with version control and enterprise permissions
          </p>
        </div>
        <div className="flex items-center gap-4">
          <Badge variant="outline" className="px-3 py-1">
            <Users className="h-3 w-3 mr-1" />
            Enterprise Ready
          </Badge>
          <Button
            onClick={() => setIsCreatingRoom(true)}
            disabled={createRoom.isPending}
          >
            <UserPlus className="h-4 w-4 mr-2" />
            Create Room
          </Button>
        </div>
      </div>

      {/* Create Room Modal */}
      <AnimatePresence>
        {isCreatingRoom && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
            onClick={() => setIsCreatingRoom(false)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-background rounded-lg p-6 w-full max-w-md mx-4"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="space-y-4">
                <div>
                  <h3 className="text-lg font-semibold">Create Collaboration Room</h3>
                  <p className="text-sm text-muted-foreground">
                    Set up a new collaborative workspace
                  </p>
                </div>

                <div className="space-y-4">
                  <div>
                    <label className="text-sm font-medium">Room Name</label>
                    <Input
                      placeholder="Enter room name..."
                      value={roomForm.name}
                      onChange={(e) => setRoomForm(prev => ({ ...prev, name: e.target.value }))}
                    />
                  </div>

                  <div>
                    <label className="text-sm font-medium">Description</label>
                    <Textarea
                      placeholder="Describe the purpose of this room..."
                      value={roomForm.description}
                      onChange={(e) => setRoomForm(prev => ({ ...prev, description: e.target.value }))}
                    />
                  </div>

                  <div>
                    <label className="text-sm font-medium">Type</label>
                    <select
                      value={roomForm.type}
                      onChange={(e) => setRoomForm(prev => ({ ...prev, type: e.target.value as any }))}
                      className="w-full px-3 py-2 rounded-md border bg-background"
                    >
                      <option value="document">Document</option>
                      <option value="code">Code</option>
                      <option value="design">Design</option>
                      <option value="presentation">Presentation</option>
                      <option value="database">Database</option>
                    </select>
                  </div>

                  <div className="space-y-3">
                    <label className="text-sm font-medium">Permissions</label>
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-sm">Allow Guests</span>
                        <input
                          type="checkbox"
                          checked={roomForm.permissions.allowGuests}
                          onChange={(e) => setRoomForm(prev => ({
                            ...prev,
                            permissions: { ...prev.permissions, allowGuests: e.target.checked }
                          }))}
                          className="rounded"
                        />
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-sm">Require Approval</span>
                        <input
                          type="checkbox"
                          checked={roomForm.permissions.requireApproval}
                          onChange={(e) => setRoomForm(prev => ({
                            ...prev,
                            permissions: { ...prev.permissions, requireApproval: e.target.checked }
                          }))}
                          className="rounded"
                        />
                      </div>
                    </div>
                  </div>
                </div>

                <div className="flex gap-2 pt-4">
                  <Button
                    variant="outline"
                    onClick={() => setIsCreatingRoom(false)}
                    className="flex-1"
                  >
                    Cancel
                  </Button>
                  <Button
                    onClick={handleCreateRoom}
                    disabled={createRoom.isPending}
                    className="flex-1"
                  >
                    {createRoom.isPending ? (
                      <>
                        <Zap className="h-4 w-4 mr-2 animate-spin" />
                        Creating...
                      </>
                    ) : (
                      <>
                        <Users className="h-4 w-4 mr-2" />
                        Create
                      </>
                    )}
                  </Button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Main Content */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
        <TabsList className="grid w-full grid-cols-5">
          <TabsTrigger value="rooms">Rooms</TabsTrigger>
          <TabsTrigger value="participants">Participants</TabsTrigger>
          <TabsTrigger value="activity">Activity</TabsTrigger>
          <TabsTrigger value="versions">Versions</TabsTrigger>
          <TabsTrigger value="settings">Settings</TabsTrigger>
        </TabsList>

        {/* Rooms Tab */}
        <TabsContent value="rooms" className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Rooms List */}
            <div className="lg:col-span-2 space-y-4">
              {mockRooms.map((room) => {
                const TypeIcon = getTypeIcon(room.type);
                return (
                  <motion.div
                    key={room.id}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="group"
                  >
                    <Card 
                      className={`transition-all group-hover:shadow-lg cursor-pointer ${
                        selectedRoom === room.id ? 'ring-2 ring-primary' : ''
                      }`}
                      onClick={() => setSelectedRoom(room.id)}
                    >
                      <CardContent className="p-6 space-y-4">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <div className="p-2 rounded-lg bg-muted">
                              <TypeIcon className="h-5 w-5" />
                            </div>
                            <div>
                              <h3 className="font-semibold">{room.name}</h3>
                              <p className="text-sm text-muted-foreground">
                                {room.type} • {room.activeUsers} active users
                              </p>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <Badge
                              variant={room.status === 'active' ? 'default' : 'outline'}
                              className="text-xs"
                            >
                              {room.status}
                            </Badge>
                            {room.permissions.requireApproval && (
                              <Shield className="h-4 w-4 text-muted-foreground" />
                            )}
                          </div>
                        </div>

                        <p className="text-sm text-muted-foreground">
                          {room.description}
                        </p>

                        <div className="flex items-center justify-between">
                          <div className="flex -space-x-2">
                            {room.participants.slice(0, 4).map((participant) => (
                              <div key={participant.id} className="relative">
                                <Avatar className="w-8 h-8 border-2 border-white">
                                  <AvatarImage src={participant.avatar} />
                                  <AvatarFallback>
                                    {participant.name.split(' ').map(n => n[0]).join('')}
                                  </AvatarFallback>
                                </Avatar>
                                <div
                                  className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-white ${
                                    getStatusColor(participant.status)
                                  }`}
                                />
                              </div>
                            ))}
                            {room.participants.length > 4 && (
                              <div className="w-8 h-8 rounded-full bg-muted border-2 border-white flex items-center justify-center">
                                <span className="text-xs font-medium">
                                  +{room.participants.length - 4}
                                </span>
                              </div>
                            )}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            Updated {new Date(room.lastActivity).toLocaleString()}
                          </div>
                        </div>

                        <div className="flex gap-2">
                          <Button 
                            size="sm" 
                            className="flex-1"
                            onClick={(e) => {
                              e.stopPropagation();
                              joinRoom.mutate(room.id);
                            }}
                            disabled={joinRoom.isPending}
                          >
                            <Users className="h-3 w-3 mr-1" />
                            Join
                          </Button>
                          <Button variant="outline" size="sm">
                            <Share2 className="h-3 w-3 mr-1" />
                            Share
                          </Button>
                          <Button variant="outline" size="sm">
                            <Settings className="h-3 w-3" />
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  </motion.div>
                );
              })}
            </div>

            {/* Live Activity Sidebar */}
            <div className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Zap className="h-5 w-5" />
                    Live Activity
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {liveEdits.slice(-5).map((edit) => (
                    <motion.div
                      key={edit.id}
                      initial={{ opacity: 0, x: 20 }}
                      animate={{ opacity: 1, x: 0 }}
                      className="flex items-start gap-2 text-sm"
                    >
                      <Edit3 className="h-3 w-3 mt-0.5 text-blue-500" />
                      <div>
                        <span className="font-medium">{edit.userName}</span>
                        <span className="text-muted-foreground"> {edit.type}ed content</span>
                        <div className="text-xs text-muted-foreground">
                          {new Date(edit.timestamp).toLocaleTimeString()}
                        </div>
                      </div>
                    </motion.div>
                  ))}
                  {liveEdits.length === 0 && (
                    <div className="text-center py-4 text-muted-foreground">
                      <Clock className="h-6 w-6 mx-auto mb-2 opacity-50" />
                      <p className="text-sm">No recent activity</p>
                    </div>
                  )}
                </CardContent>
              </Card>

              {selectedRoom && (
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Users className="h-5 w-5" />
                      Active Users
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {mockRooms.find(r => r.id === selectedRoom)?.participants
                      .filter(p => p.status === 'online')
                      .map((participant) => (
                        <div key={participant.id} className="flex items-center gap-3">
                          <div className="relative">
                            <Avatar className="w-8 h-8">
                              <AvatarImage src={participant.avatar} />
                              <AvatarFallback>
                                {participant.name.split(' ').map(n => n[0]).join('')}
                              </AvatarFallback>
                            </Avatar>
                            <div className="absolute -bottom-0.5 -right-0.5 w-3 h-3 bg-green-500 rounded-full border-2 border-white" />
                          </div>
                          <div className="flex-1">
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-medium">{participant.name}</span>
                              {participant.role === 'owner' && (
                                <Crown className="h-3 w-3 text-yellow-600" />
                              )}
                            </div>
                            <div className={`text-xs ${getRoleColor(participant.role)}`}>
                              {participant.role}
                            </div>
                          </div>
                        </div>
                      ))}
                  </CardContent>
                </Card>
              )}
            </div>
          </div>
        </TabsContent>

        {/* Participants Tab */}
        <TabsContent value="participants" className="space-y-6">
          {selectedRoom ? (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Users className="h-5 w-5" />
                  Room Participants
                </CardTitle>
                <CardDescription>
                  Manage participants and their permissions for the selected room
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {mockRooms.find(r => r.id === selectedRoom)?.participants.map((participant) => (
                    <motion.div
                      key={participant.id}
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="flex items-center justify-between p-4 border rounded-lg"
                    >
                      <div className="flex items-center gap-4">
                        <div className="relative">
                          <Avatar className="w-12 h-12">
                            <AvatarImage src={participant.avatar} />
                            <AvatarFallback>
                              {participant.name.split(' ').map(n => n[0]).join('')}
                            </AvatarFallback>
                          </Avatar>
                          <div
                            className={`absolute -bottom-1 -right-1 w-4 h-4 rounded-full border-2 border-white ${
                              getStatusColor(participant.status)
                            }`}
                          />
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <h3 className="font-semibold">{participant.name}</h3>
                            {participant.role === 'owner' && (
                              <Crown className="h-4 w-4 text-yellow-600" />
                            )}
                          </div>
                          <p className="text-sm text-muted-foreground">{participant.email}</p>
                          <div className="flex items-center gap-4 mt-1">
                            <Badge variant="outline" className={`text-xs ${getRoleColor(participant.role)}`}>
                              {participant.role}
                            </Badge>
                            <span className="text-xs text-muted-foreground">
                              Last seen: {new Date(participant.lastSeen).toLocaleString()}
                            </span>
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Button variant="outline" size="sm">
                          <MessageCircle className="h-4 w-4 mr-2" />
                          Message
                        </Button>
                        <Button variant="outline" size="sm">
                          <Settings className="h-4 w-4 mr-2" />
                          Permissions
                        </Button>
                        {participant.role !== 'owner' && (
                          <Button variant="destructive" size="sm">
                            <UserMinus className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    </motion.div>
                  ))}
                </div>
                
                <div className="mt-6 pt-6 border-t">
                  <Button
                    onClick={() => {
                      const email = prompt('Enter email address to invite:');
                      if (email && selectedRoom) {
                        inviteUser.mutate({ roomId: selectedRoom, email, role: 'editor' });
                      }
                    }}
                    disabled={inviteUser.isPending}
                  >
                    <UserPlus className="h-4 w-4 mr-2" />
                    Invite Participant
                  </Button>
                </div>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="text-center py-12">
                <Users className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p className="text-muted-foreground">Select a room to view participants</p>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* Activity Tab */}
        <TabsContent value="activity" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Clock className="h-5 w-5" />
                Collaboration Activity
              </CardTitle>
              <CardDescription>
                Recent activity across all collaboration rooms
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {mockActivity.map((activity) => (
                  <motion.div
                    key={activity.id}
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    className="flex items-start gap-4 pb-4 border-b last:border-b-0"
                  >
                    <div className="p-2 rounded-lg bg-muted">
                      {activity.type === 'edit' && <Edit3 className="h-4 w-4" />}
                      {activity.type === 'comment' && <MessageCircle className="h-4 w-4" />}
                      {activity.type === 'join' && <Users className="h-4 w-4" />}
                      {activity.type === 'leave' && <UserMinus className="h-4 w-4" />}
                      {activity.type === 'version' && <GitBranch className="h-4 w-4" />}
                      {activity.type === 'permission' && <Shield className="h-4 w-4" />}
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center justify-between">
                        <span className="font-medium">{activity.user}</span>
                        <span className="text-xs text-muted-foreground">
                          {new Date(activity.timestamp).toLocaleString()}
                        </span>
                      </div>
                      <p className="text-sm text-muted-foreground mt-1">
                        {activity.description}
                      </p>
                      {activity.details && (
                        <div className="text-xs text-muted-foreground mt-2">
                          {JSON.stringify(activity.details, null, 2)}
                        </div>
                      )}
                    </div>
                  </motion.div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Versions Tab */}
        <TabsContent value="versions" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <GitBranch className="h-5 w-5" />
                Version History
              </CardTitle>
              <CardDescription>
                Track changes and manage document versions
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {mockVersions.map((version) => (
                  <motion.div
                    key={version.id}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="border rounded-lg p-4 space-y-3"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <Badge variant={version.status === 'current' ? 'default' : 'outline'}>
                          v{version.version}
                        </Badge>
                        <div>
                          <span className="font-medium">{version.author}</span>
                          <span className="text-sm text-muted-foreground ml-2">
                            {new Date(version.timestamp).toLocaleString()}
                          </span>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm text-muted-foreground">{version.size}</span>
                        <Button variant="outline" size="sm">
                          <Download className="h-4 w-4 mr-2" />
                          Download
                        </Button>
                        {version.status !== 'current' && (
                          <Button variant="outline" size="sm">
                            <Undo className="h-4 w-4 mr-2" />
                            Restore
                          </Button>
                        )}
                      </div>
                    </div>

                    <div className="space-y-1">
                      <span className="text-sm font-medium">Changes:</span>
                      <ul className="text-sm text-muted-foreground space-y-1">
                        {version.changes.map((change, index) => (
                          <li key={index} className="flex items-center gap-2">
                            <div className="w-1 h-1 bg-muted-foreground rounded-full" />
                            {change}
                          </li>
                        ))}
                      </ul>
                    </div>

                    {version.branches && version.branches.length > 0 && (
                      <div className="space-y-2">
                        <span className="text-sm font-medium">Branches:</span>
                        <div className="flex flex-wrap gap-2">
                          {version.branches.map((branch) => (
                            <Badge key={branch.id} variant="outline" className="text-xs">
                              {branch.name} ({branch.commits} commits)
                            </Badge>
                          ))}
                        </div>
                      </div>
                    )}
                  </motion.div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Settings Tab */}
        <TabsContent value="settings" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Settings className="h-5 w-5" />
                Collaboration Settings
              </CardTitle>
              <CardDescription>
                Configure collaboration preferences and permissions
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-4">
                <h3 className="font-semibold">Default Permissions</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Edit Permissions</label>
                    <select className="w-full px-3 py-2 rounded-md border bg-background">
                      <option value="all">All Users</option>
                      <option value="editors">Editors Only</option>
                      <option value="admins">Admins Only</option>
                    </select>
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Comment Permissions</label>
                    <select className="w-full px-3 py-2 rounded-md border bg-background">
                      <option value="all">All Users</option>
                      <option value="members">Members Only</option>
                      <option value="editors">Editors Only</option>
                    </select>
                  </div>
                </div>
              </div>

              <div className="space-y-4">
                <h3 className="font-semibold">Security Settings</h3>
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="text-sm font-medium">Require approval for new members</span>
                      <p className="text-xs text-muted-foreground">New members must be approved before joining</p>
                    </div>
                    <input type="checkbox" defaultChecked className="rounded" />
                  </div>
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="text-sm font-medium">Allow guest access</span>
                      <p className="text-xs text-muted-foreground">Allow users without accounts to participate</p>
                    </div>
                    <input type="checkbox" className="rounded" />
                  </div>
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="text-sm font-medium">Enable version history</span>
                      <p className="text-xs text-muted-foreground">Track all changes and maintain version history</p>
                    </div>
                    <input type="checkbox" defaultChecked className="rounded" />
                  </div>
                </div>
              </div>

              <div className="space-y-4">
                <h3 className="font-semibold">Notification Settings</h3>
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">Real-time notifications</span>
                    <input type="checkbox" defaultChecked className="rounded" />
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">Email notifications</span>
                    <input type="checkbox" defaultChecked className="rounded" />
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">Desktop notifications</span>
                    <input type="checkbox" className="rounded" />
                  </div>
                </div>
              </div>

              <div className="flex gap-2 pt-6">
                <Button>
                  <Save className="h-4 w-4 mr-2" />
                  Save Settings
                </Button>
                <Button variant="outline">
                  <Undo className="h-4 w-4 mr-2" />
                  Reset to Defaults
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}