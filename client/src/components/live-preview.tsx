import { useState, useRef, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

interface LivePreviewProps {
  projectId: number;
  className?: string;
  fullscreen?: boolean;
}

export function LivePreview({ projectId, className, fullscreen = false }: LivePreviewProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [previewMode, setPreviewMode] = useState<'desktop' | 'tablet' | 'mobile'>('desktop');
  const [isConnected, setIsConnected] = useState(true);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const deviceSizes = {
    desktop: 'w-full h-full',
    tablet: 'w-[768px] h-[1024px]',
    mobile: 'w-[375px] h-[667px]'
  };

  useEffect(() => {
    // Simulate loading state
    setIsLoading(true);
    const timer = setTimeout(() => setIsLoading(false), 1500);
    return () => clearTimeout(timer);
  }, [projectId]);

  const handleRefresh = () => {
    setIsLoading(true);
    if (iframeRef.current) {
      iframeRef.current.src = iframeRef.current.src;
    }
    setTimeout(() => setIsLoading(false), 1000);
  };

  const PreviewContent = () => (
    <div className="w-full h-full bg-gradient-to-br from-slate-50 to-slate-100 flex items-center justify-center p-8">
      {isLoading ? (
        <div className="text-center">
          <div className="loading-spinner w-8 h-8 mx-auto mb-4"></div>
          <p className="text-slate-600">Building preview...</p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl shadow-xl p-6 max-w-sm w-full transform hover:scale-105 transition-all duration-300 border border-slate-200">
          {/* Product image placeholder */}
          <div className="w-full h-48 bg-gradient-to-br from-blue-100 to-purple-100 rounded-xl mb-4 flex items-center justify-center">
            <i className="fas fa-image text-4xl text-slate-400"></i>
          </div>
          
          <h3 className="text-xl font-bold text-slate-800 mb-2">Premium Wireless Headphones</h3>
          <p className="text-slate-600 text-sm mb-4">High-quality audio with noise cancellation and 30-hour battery life.</p>
          
          <div className="flex items-center justify-between mb-4">
            <span className="text-2xl font-bold text-slate-800">$299.99</span>
            <div className="flex items-center space-x-1">
              <div className="flex text-yellow-400">
                {[...Array(5)].map((_, i) => (
                  <i key={i} className="fas fa-star text-xs"></i>
                ))}
              </div>
              <span className="text-slate-500 text-sm">(248)</span>
            </div>
          </div>
          
          <button className="w-full py-3 bg-gradient-to-r from-blue-500 to-purple-500 text-white font-semibold rounded-xl hover:from-blue-600 hover:to-purple-600 transition-all duration-300 transform hover:scale-105">
            Add to Cart
          </button>
        </div>
      )}
    </div>
  );

  if (fullscreen) {
    return (
      <Card className={cn('bg-slate-800/50 border-slate-700 h-full', className)}>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center space-x-2 text-white">
              <i className="fas fa-eye text-emerald-400"></i>
              <span>Live Preview</span>
            </CardTitle>
            <div className="flex items-center space-x-3">
              <div className="flex items-center space-x-1 bg-slate-700 rounded-lg p-1">
                {(['desktop', 'tablet', 'mobile'] as const).map((mode) => (
                  <button
                    key={mode}
                    onClick={() => setPreviewMode(mode)}
                    className={cn(
                      'px-3 py-1 rounded-md text-xs transition-colors',
                      previewMode === mode
                        ? 'bg-primary-500 text-white'
                        : 'text-slate-400 hover:text-white'
                    )}
                  >
                    <i className={cn(
                      mode === 'desktop' && 'fas fa-desktop',
                      mode === 'tablet' && 'fas fa-tablet-alt',
                      mode === 'mobile' && 'fas fa-mobile-alt'
                    )}></i>
                  </button>
                ))}
              </div>
              <Button size="sm" variant="ghost" onClick={handleRefresh}>
                <i className="fas fa-refresh mr-2"></i>
                Refresh
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="h-[calc(100%-5rem)] flex items-center justify-center">
          <div className={cn('transition-all duration-300', deviceSizes[previewMode])}>
            <PreviewContent />
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={cn('bg-slate-800/50 border-slate-700', className)}>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center space-x-2 text-white">
            <i className="fas fa-eye text-emerald-400"></i>
            <span>Live Preview</span>
          </CardTitle>
          <div className="flex items-center space-x-3">
            <div className="flex items-center space-x-2 px-3 py-2 bg-slate-700 rounded-lg">
              <div className={cn('w-2 h-2 rounded-full', isConnected ? 'bg-emerald-500 animate-pulse' : 'bg-red-500')}></div>
              <span className="text-sm text-slate-300">
                {isConnected ? 'Live Updates' : 'Disconnected'}
              </span>
            </div>
            <Button size="sm" variant="ghost" onClick={handleRefresh}>
              <i className="fas fa-refresh"></i>
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {/* Device Frame */}
        <div className="flex items-center justify-center p-4 bg-slate-900/50">
          <div className="bg-slate-800 rounded-2xl p-4 shadow-xl">
            <div className="flex items-center space-x-2 mb-3">
              <div className="w-3 h-3 bg-red-500 rounded-full"></div>
              <div className="w-3 h-3 bg-yellow-500 rounded-full"></div>
              <div className="w-3 h-3 bg-green-500 rounded-full"></div>
              <div className="flex-1 bg-slate-700 rounded-lg px-3 py-1 ml-3">
                <span className="text-xs text-slate-400">localhost:3000</span>
              </div>
            </div>
            
            {/* Preview Viewport */}
            <div className="w-80 h-64 rounded-lg overflow-hidden border border-slate-600">
              <PreviewContent />
            </div>
          </div>
        </div>

        {/* Preview Controls */}
        <div className="flex items-center justify-between px-4 py-2 bg-slate-800/30 border-t border-slate-700">
          <div className="flex items-center space-x-4 text-xs">
            <span className="text-slate-400">Viewport: 320×568</span>
            <span className="text-slate-400">Scale: 100%</span>
            <Badge variant="outline" className="text-xs">
              <i className="fas fa-sync mr-1 text-emerald-400"></i>
              Auto-refresh
            </Badge>
          </div>
          
          <div className="flex items-center space-x-2">
            <Button size="sm" variant="ghost" className="text-xs px-2 py-1 h-6">
              <i className="fas fa-external-link-alt mr-1"></i>
              Open
            </Button>
            <Button size="sm" variant="ghost" className="text-xs px-2 py-1 h-6">
              <i className="fas fa-camera mr-1"></i>
              Screenshot
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
