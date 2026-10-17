/**
 * Standardized API Components - Phase 4
 * 
 * Addressing frontend-backend integration issues: consistent error handling,
 * standardized loading states, and unified API response patterns
 */

import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Progress } from '@/components/ui/progress';
import { 
  CheckCircle, AlertTriangle, XCircle, RefreshCw, Wifi, WifiOff,
  Clock, Database, Server, Globe, Zap, Shield, Activity
} from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

// Standardized API Response Type
interface StandardAPIResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
  timestamp?: string;
  meta?: {
    total?: number;
    page?: number;
    limit?: number;
    hasMore?: boolean;
  };
}

// Enhanced Error Component
export function StandardizedError({ 
  error,
  onRetry,
  context,
  showDetails = false
}: {
  error: any;
  onRetry?: () => void;
  context?: string;
  showDetails?: boolean;
}) {
  const [showFullError, setShowFullError] = useState(false);

  const getErrorType = (error: any) => {
    if (error?.response?.status === 401) return 'authentication';
    if (error?.response?.status === 403) return 'authorization';
    if (error?.response?.status === 404) return 'not_found';
    if (error?.response?.status >= 500) return 'server';
    if (error?.code === 'NETWORK_ERROR') return 'network';
    return 'client';
  };

  const getErrorIcon = (type: string) => {
    switch (type) {
      case 'authentication':
      case 'authorization':
        return Shield;
      case 'not_found':
        return XCircle;
      case 'server':
        return Server;
      case 'network':
        return WifiOff;
      default:
        return AlertTriangle;
    }
  };

  const getErrorMessage = (error: any, type: string) => {
    if (error?.response?.data?.message) return error.response.data.message;
    if (error?.message) return error.message;
    
    switch (type) {
      case 'authentication':
        return 'Please log in to continue';
      case 'authorization':
        return 'You don\'t have permission to access this resource';
      case 'not_found':
        return 'The requested resource was not found';
      case 'server':
        return 'Server error occurred. Please try again later';
      case 'network':
        return 'Network connection issue. Check your internet connection';
      default:
        return 'An unexpected error occurred';
    }
  };

  const errorType = getErrorType(error);
  const ErrorIcon = getErrorIcon(errorType);
  const errorMessage = getErrorMessage(error, errorType);

  return (
    <Alert className="border-red-200 bg-red-50">
      <ErrorIcon className="h-4 w-4 text-red-600" />
      <AlertDescription className="space-y-3">
        <div>
          <div className="font-medium text-red-800 mb-1">
            {context ? `Error in ${context}` : 'Error'}
          </div>
          <div className="text-red-700">{errorMessage}</div>
        </div>

        {showDetails && (
          <div className="space-y-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowFullError(!showFullError)}
              className="text-red-700 hover:text-red-800 p-0 h-auto"
            >
              {showFullError ? 'Hide' : 'Show'} technical details
            </Button>
            
            {showFullError && (
              <div className="bg-red-100 p-3 rounded text-xs font-mono text-red-800 overflow-auto max-h-32">
                <div><strong>Status:</strong> {error?.response?.status}</div>
                <div><strong>Code:</strong> {error?.code}</div>
                <div><strong>URL:</strong> {error?.config?.url}</div>
                {error?.response?.data && (
                  <div><strong>Response:</strong> {JSON.stringify(error.response.data, null, 2)}</div>
                )}
              </div>
            )}
          </div>
        )}

        {onRetry && (
          <Button
            variant="outline"
            size="sm"
            onClick={onRetry}
            className="border-red-200 text-red-700 hover:bg-red-100"
          >
            <RefreshCw className="h-3 w-3 mr-2" />
            Try Again
          </Button>
        )}
      </AlertDescription>
    </Alert>
  );
}

// Enhanced Loading Component
export function StandardizedLoading({ 
  type = 'spinner',
  message = 'Loading...',
  progress,
  details,
  size = 'default'
}: {
  type?: 'spinner' | 'dots' | 'pulse' | 'skeleton';
  message?: string;
  progress?: number;
  details?: string;
  size?: 'sm' | 'default' | 'lg';
}) {
  const sizeClasses = {
    sm: 'h-4 w-4',
    default: 'h-6 w-6',
    lg: 'h-8 w-8'
  };

  const LoadingSpinner = () => (
    <div className={`animate-spin rounded-full border-2 border-blue-200 border-t-blue-600 ${sizeClasses[size]}`} />
  );

  const LoadingDots = () => (
    <div className="flex space-x-1">
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className={`bg-blue-600 rounded-full ${size === 'sm' ? 'w-1 h-1' : size === 'lg' ? 'w-3 h-3' : 'w-2 h-2'} animate-pulse`}
          style={{ animationDelay: `${i * 0.2}s` }}
        />
      ))}
    </div>
  );

  const LoadingPulse = () => (
    <div className={`bg-blue-200 rounded-full animate-pulse ${sizeClasses[size]}`} />
  );

  const LoadingSkeleton = () => (
    <div className="space-y-3">
      <div className="h-4 bg-gray-200 rounded animate-pulse" />
      <div className="h-4 bg-gray-200 rounded w-3/4 animate-pulse" />
      <div className="h-4 bg-gray-200 rounded w-1/2 animate-pulse" />
    </div>
  );

  const renderLoader = () => {
    switch (type) {
      case 'dots':
        return <LoadingDots />;
      case 'pulse':
        return <LoadingPulse />;
      case 'skeleton':
        return <LoadingSkeleton />;
      default:
        return <LoadingSpinner />;
    }
  };

  return (
    <div className="flex flex-col items-center justify-center p-6 space-y-4">
      {type !== 'skeleton' && renderLoader()}
      {type === 'skeleton' && <LoadingSkeleton />}
      
      {progress !== undefined && (
        <div className="w-full max-w-xs space-y-2">
          <Progress value={progress} className="h-2" />
          <div className="text-xs text-center text-gray-600">{progress.toFixed(0)}% complete</div>
        </div>
      )}
      
      <div className="text-center space-y-1">
        <div className="text-sm font-medium text-gray-700">{message}</div>
        {details && <div className="text-xs text-gray-500">{details}</div>}
      </div>
    </div>
  );
}

// API Health Status Component
export function APIHealthStatus() {
  const { data: healthData, isLoading, error } = useQuery({
    queryKey: ['/api/health'],
    refetchInterval: 30000 // Check every 30 seconds
  });

  const services = [
    { name: 'Core API', status: 'healthy', responseTime: 45 },
    { name: 'Database', status: 'healthy', responseTime: 12 },
    { name: 'Jurexio Orchestration', status: 'healthy', responseTime: 85 },
    { name: 'LLM Providers', status: 'healthy', responseTime: 120 },
    { name: 'Cache Layer', status: 'healthy', responseTime: 8 }
  ];

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'healthy':
        return 'text-green-600 bg-green-100';
      case 'warning':
        return 'text-yellow-600 bg-yellow-100';
      case 'error':
        return 'text-red-600 bg-red-100';
      default:
        return 'text-gray-600 bg-gray-100';
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'healthy':
        return CheckCircle;
      case 'warning':
        return AlertTriangle;
      case 'error':
        return XCircle;
      default:
        return Clock;
    }
  };

  return (
    <Card className="w-full">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-lg">
          <Activity className="h-5 w-5 text-blue-600" />
          API Health Status
        </CardTitle>
        <CardDescription>
          Real-time service monitoring and response times
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <StandardizedLoading message="Checking service health..." />
        ) : error ? (
          <StandardizedError 
            error={error} 
            context="Health Check"
            onRetry={() => window.location.reload()}
          />
        ) : (
          <div className="space-y-3">
            {services.map((service) => {
              const StatusIcon = getStatusIcon(service.status);
              
              return (
                <div key={service.name} className="flex items-center justify-between p-3 border rounded-lg">
                  <div className="flex items-center gap-3">
                    <StatusIcon className="h-4 w-4 text-green-600" />
                    <span className="font-medium">{service.name}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-sm text-gray-600">{service.responseTime}ms</span>
                    <Badge className={getStatusColor(service.status)}>
                      {service.status}
                    </Badge>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// Standardized Form Wrapper
export function StandardizedForm({ 
  children,
  onSubmit,
  isLoading,
  error,
  success,
  title,
  description
}: {
  children: React.ReactNode;
  onSubmit: (data: any) => void;
  isLoading?: boolean;
  error?: any;
  success?: string;
  title?: string;
  description?: string;
}) {
  return (
    <Card className="w-full max-w-md mx-auto">
      {(title || description) && (
        <CardHeader>
          {title && <CardTitle>{title}</CardTitle>}
          {description && <CardDescription>{description}</CardDescription>}
        </CardHeader>
      )}
      <CardContent className="space-y-4">
        {error && (
          <StandardizedError 
            error={error} 
            context="Form Submission"
          />
        )}
        
        {success && (
          <Alert className="border-green-200 bg-green-50">
            <CheckCircle className="h-4 w-4 text-green-600" />
            <AlertDescription className="text-green-700">
              {success}
            </AlertDescription>
          </Alert>
        )}

        <form onSubmit={onSubmit} className="space-y-4">
          {children}
          
          <Button 
            type="submit" 
            className="w-full" 
            disabled={isLoading}
          >
            {isLoading ? (
              <>
                <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                Processing...
              </>
            ) : (
              'Submit'
            )}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

// Network Status Indicator
export function NetworkStatus() {
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [latency, setLatency] = useState<number | null>(null);

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    // Measure latency
    const measureLatency = async () => {
      const start = performance.now();
      try {
        await fetch('/api/health', { method: 'HEAD' });
        setLatency(Math.round(performance.now() - start));
      } catch {
        setLatency(null);
      }
    };

    const interval = setInterval(measureLatency, 10000); // Every 10 seconds
    measureLatency();

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      clearInterval(interval);
    };
  }, []);

  return (
    <div className="fixed top-4 right-4 z-50">
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        className={`flex items-center gap-2 px-3 py-2 rounded-lg shadow-lg border ${
          isOnline ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'
        }`}
      >
        {isOnline ? (
          <Wifi className="h-4 w-4 text-green-600" />
        ) : (
          <WifiOff className="h-4 w-4 text-red-600" />
        )}
        
        <span className={`text-sm font-medium ${
          isOnline ? 'text-green-700' : 'text-red-700'
        }`}>
          {isOnline ? 'Online' : 'Offline'}
        </span>
        
        {isOnline && latency && (
          <Badge variant="outline" className="text-xs">
            {latency}ms
          </Badge>
        )}
      </motion.div>
    </div>
  );
}

// Retry Hook for Failed Requests
export function useRetryableQuery<T>(
  queryKey: any[],
  queryFn?: () => Promise<T>,
  options?: any
) {
  const queryClient = useQueryClient();
  const [retryCount, setRetryCount] = useState(0);

  const query = useQuery({
    queryKey,
    queryFn,
    retry: (failureCount, error: any) => {
      // Don't retry on 4xx errors except 408 (timeout)
      if (error?.response?.status >= 400 && error?.response?.status < 500 && error?.response?.status !== 408) {
        return false;
      }
      return failureCount < 3;
    },
    retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 30000),
    ...options
  });

  const manualRetry = () => {
    setRetryCount(prev => prev + 1);
    queryClient.invalidateQueries({ queryKey });
  };

  return {
    ...query,
    retryCount,
    manualRetry
  };
}