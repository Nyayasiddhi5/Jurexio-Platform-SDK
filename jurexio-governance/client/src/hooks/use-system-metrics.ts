'use client';

import { useQuery } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';

// Jurexio Legal SDK API Client for comprehensive system metrics
const jurexioSDKClient = {
  getSystemMetrics: () => apiRequest('/api/v9/system/metrics'),
  getSystemHealth: () => apiRequest('/api/v9/health'),
  getSystemStatus: () => apiRequest('/api/v9/system/status')
};

export function useSystemMetrics() {
  return useQuery({
    queryKey: ['system', 'metrics'],
    queryFn: () => jurexioSDKClient.getSystemMetrics(),
    refetchInterval: 30000, // Refresh every 30 seconds
    staleTime: 15000, // Data is fresh for 15 seconds
  });
}

export function useSystemHealth() {
  return useQuery({
    queryKey: ['system', 'health'],
    queryFn: () => jurexioSDKClient.getSystemHealth(),
    refetchInterval: 10000, // Refresh every 10 seconds
    staleTime: 5000, // Data is fresh for 5 seconds
  });
}

export function useSystemStatus() {
  return useQuery({
    queryKey: ['system', 'status'],
    queryFn: () => jurexioSDKClient.getSystemStatus(),
    refetchInterval: 15000, // Refresh every 15 seconds
    staleTime: 10000, // Data is fresh for 10 seconds
  });
}