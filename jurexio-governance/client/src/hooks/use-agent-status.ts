import { useQuery } from "@tanstack/react-query";
import { useWebSocket } from "./use-websocket";
import { useEffect, useState } from "react";

interface AgentStatus {
  id: string;
  type: string;
  status: 'active' | 'idle' | 'error' | 'completed';
  currentTask?: string;
  progress?: number;
  lastActivity: Date;
  metadata?: any;
}

export function useAgentStatus() {
  const [realtimeStatus, setRealtimeStatus] = useState<AgentStatus[]>([]);
  const { lastMessage } = useWebSocket();

  // Fetch initial agent status
  const { data: agentStatus, isLoading, error } = useQuery({
    queryKey: ['/api/agents/status'],
    queryFn: async () => {
      const response = await fetch('/api/agents/status');
      if (!response.ok) {
        throw new Error('Failed to fetch agent status');
      }
      const result = await response.json();
      setRealtimeStatus(result.data as AgentStatus[]);
      return result.data as AgentStatus[];
    },
    refetchInterval: 30000 // Fallback polling every 30 seconds
  });

  // Update realtime status based on WebSocket messages
  useEffect(() => {
    if (lastMessage) {
      switch (lastMessage.type) {
        case 'agent.status.update':
          setRealtimeStatus(lastMessage.data);
          break;
        case 'agent.status.updated':
          setRealtimeStatus(prev => {
            const updatedStatus = lastMessage.data;
            return prev.map(agent => 
              agent.id === updatedStatus.id ? { ...agent, ...updatedStatus } : agent
            );
          });
          break;
        case 'orchestration.request.completed':
          // Update agent status when requests complete
          const { request, response } = lastMessage.data;
          if (response.metadata?.agent) {
            setRealtimeStatus(prev => 
              prev.map(agent => 
                agent.id === response.metadata.agent 
                  ? { ...agent, status: 'idle', currentTask: undefined }
                  : agent
              )
            );
          }
          break;
      }
    }
  }, [lastMessage]);

  return {
    agentStatus: realtimeStatus.length > 0 ? realtimeStatus : (agentStatus || []),
    isLoading,
    error
  };
}
