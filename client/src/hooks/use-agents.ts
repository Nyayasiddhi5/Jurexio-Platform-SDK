'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';

// Jurexio Legal SDK API Client for 105+ Agents System
const nyayavigyaSDKClient = {
  getAgents: () => apiRequest('/api/v9/agents'),
  getAgentCategories: () => apiRequest('/api/v9/agents/categories'),
  getAgentMetrics: () => apiRequest('/api/v9/agents/metrics'),
  executeAgent: (agentId: string, payload: any) => 
    apiRequest(`/api/v9/agents/${agentId}/execute`, {
      method: 'POST',
      body: JSON.stringify(payload)
    }),
  getAgentExecution: (executionId: string) => apiRequest(`/api/v9/executions/${executionId}`)
};

export function useAgents(projectId?: number) {
  return useQuery({
    queryKey: ['agents'],
    queryFn: () => nyayavigyaSDKClient.getAgents(),
    refetchInterval: 30000, // Refresh every 30 seconds
  });
}

export function useAgent(agentId: string) {
  return useQuery({
    queryKey: ['agents', agentId],
    queryFn: () => nyayavigyaSDKClient.getAgent(agentId),
    enabled: !!agentId,
  });
}

export function useAgentSearch(query: string, filters?: any) {
  return useQuery({
    queryKey: ['agents', 'search', query, filters],
    queryFn: () => nyayavigyaSDKClient.searchAgents({ query, ...filters }),
    enabled: !!query,
  });
}

export function useExecuteAgent() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ agentId, task }: { agentId: string; task: any }) =>
      nyayavigyaSDKClient.executeAgent(agentId, task),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['agents'] });
      queryClient.invalidateQueries({ queryKey: ['orchestration'] });
    },
  });
}

export function useToggleAgent() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ agentId, enabled }: { agentId: string; enabled: boolean }) =>
      nyayavigyaSDKClient.toggleAgent(agentId, enabled),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['agents'] });
    },
  });
}