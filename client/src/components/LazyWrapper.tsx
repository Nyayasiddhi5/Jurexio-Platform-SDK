/**
 * Lazy Loading Wrapper Component
 * Provides consistent loading states and error boundaries for lazy-loaded components
 */

import { Suspense, ReactNode, Component } from 'react';
import { Skeleton } from './ui/skeleton';
import { Alert, AlertDescription } from './ui/alert';
import { Button } from './ui/button';

interface LazyWrapperProps {
  children: ReactNode;
  fallback?: ReactNode;
  errorFallback?: ReactNode;
  minHeight?: string;
}

/**
 * Loading skeleton for different component types
 */
const LoadingSkeleton = ({ type = 'default' }: { type?: 'default' | 'dashboard' | 'chat' | 'editor' }) => {
  switch (type) {
    case 'dashboard':
      return (
        <div className="space-y-4 p-4">
          <Skeleton className="h-8 w-64" />
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <Skeleton className="h-32 w-full" />
            <Skeleton className="h-32 w-full" />
            <Skeleton className="h-32 w-full" />
          </div>
          <Skeleton className="h-64 w-full" />
        </div>
      );
    
    case 'chat':
      return (
        <div className="flex flex-col h-full space-y-4 p-4">
          <Skeleton className="h-6 w-48" />
          <div className="flex-1 space-y-3">
            <Skeleton className="h-12 w-3/4" />
            <Skeleton className="h-12 w-1/2 ml-auto" />
            <Skeleton className="h-12 w-2/3" />
          </div>
          <Skeleton className="h-12 w-full" />
        </div>
      );
    
    case 'editor':
      return (
        <div className="h-full grid grid-cols-1 lg:grid-cols-2 gap-4 p-4">
          <div className="space-y-2">
            <Skeleton className="h-6 w-24" />
            <Skeleton className="h-80 w-full" />
          </div>
          <div className="space-y-2">
            <Skeleton className="h-6 w-24" />
            <Skeleton className="h-80 w-full" />
          </div>
        </div>
      );
    
    default:
      return (
        <div className="space-y-4 p-4">
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-6 w-32" />
        </div>
      );
  }
};

/**
 * Error boundary component for lazy loading failures
 */
interface ErrorBoundaryState {
  hasError: boolean;
  error?: Error;
}

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode;
}

class LazyErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: any) {
    console.error('Lazy component loading error:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback || (
        <Alert variant="destructive" className="m-4">
          <AlertDescription>
            Failed to load component. Please try refreshing the page.
            <Button 
              variant="outline" 
              size="sm" 
              className="ml-2"
              onClick={() => window.location.reload()}
            >
              Refresh
            </Button>
          </AlertDescription>
        </Alert>
      );
    }

    return this.props.children;
  }
}

/**
 * Main LazyWrapper component
 */
export function LazyWrapper({ 
  children, 
  fallback, 
  errorFallback, 
  minHeight = 'auto' 
}: LazyWrapperProps) {
  const defaultFallback = fallback || <LoadingSkeleton type="default" />;

  return (
    <LazyErrorBoundary fallback={errorFallback}>
      <Suspense fallback={defaultFallback}>
        <div style={{ minHeight }}>
          {children}
        </div>
      </Suspense>
    </LazyErrorBoundary>
  );
}

/**
 * Specialized wrappers for different component types
 */
export function LazyDashboard({ children }: { children: ReactNode }) {
  return (
    <LazyWrapper fallback={<LoadingSkeleton type="dashboard" />} minHeight="400px">
      {children}
    </LazyWrapper>
  );
}

export function LazyChat({ children }: { children: ReactNode }) {
  return (
    <LazyWrapper fallback={<LoadingSkeleton type="chat" />} minHeight="500px">
      {children}
    </LazyWrapper>
  );
}

export function LazyEditor({ children }: { children: ReactNode }) {
  return (
    <LazyWrapper fallback={<LoadingSkeleton type="editor" />} minHeight="600px">
      {children}
    </LazyWrapper>
  );
}

export default LazyWrapper;