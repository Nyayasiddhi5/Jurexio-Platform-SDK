import { AlertTriangle, RefreshCw, Home, Mail } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

interface ErrorFallbackProps {
  error?: Error;
  resetError?: () => void;
  context?: string;
}

export function ErrorFallback({ error, resetError, context }: ErrorFallbackProps) {
  const handleReload = () => {
    if (resetError) {
      resetError();
    } else {
      window.location.reload();
    }
  };

  const handleGoHome = () => {
    window.location.href = '/';
  };

  const getErrorMessage = (error?: Error) => {
    if (!error) return 'Something went wrong';
    
    if (error.message.includes('ChunkLoadError') || error.message.includes('Loading chunk')) {
      return 'Failed to load application resources. This usually happens after an update.';
    }
    
    if (error.message.includes('Network')) {
      return 'Network connection error. Please check your internet connection.';
    }
    
    return error.message || 'An unexpected error occurred';
  };

  const getErrorSolution = (error?: Error) => {
    if (!error) return 'Please try refreshing the page.';
    
    if (error.message.includes('ChunkLoadError') || error.message.includes('Loading chunk')) {
      return 'Please refresh the page to load the latest version.';
    }
    
    if (error.message.includes('Network')) {
      return 'Please check your internet connection and try again.';
    }
    
    return 'Please try refreshing the page or go back to the dashboard.';
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-900 dark:to-gray-800 flex items-center justify-center p-6">
      <Card className="w-full max-w-md shadow-xl">
        <CardHeader className="text-center pb-4">
          <div className="mx-auto w-16 h-16 bg-red-100 dark:bg-red-900 rounded-full flex items-center justify-center mb-4">
            <AlertTriangle className="h-8 w-8 text-red-600 dark:text-red-400" />
          </div>
          <CardTitle className="text-xl font-bold text-gray-900 dark:text-white">
            Oops! Something went wrong
          </CardTitle>
          <CardDescription className="text-gray-600 dark:text-gray-400">
            {getErrorMessage(error)}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="text-sm text-gray-500 dark:text-gray-400 text-center">
            {getErrorSolution(error)}
          </div>
          
          {context && (
            <div className="text-xs text-gray-400 dark:text-gray-500 text-center bg-gray-50 dark:bg-gray-800 p-2 rounded">
              Context: {context}
            </div>
          )}
          
          <div className="flex flex-col gap-3">
            <Button onClick={handleReload} className="w-full gap-2">
              <RefreshCw className="h-4 w-4" />
              Refresh Page
            </Button>
            <Button variant="outline" onClick={handleGoHome} className="w-full gap-2">
              <Home className="h-4 w-4" />
              Go to Dashboard
            </Button>
          </div>
          
          <div className="text-center">
            <Button variant="ghost" size="sm" className="gap-2 text-gray-500">
              <Mail className="h-4 w-4" />
              Contact Support
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
