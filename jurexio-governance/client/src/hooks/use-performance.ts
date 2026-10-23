/**
 * Performance Monitoring Hook
 * Tracks component loading times, bundle sizes, and user experience metrics
 */

import { useEffect, useState, useCallback } from 'react';

interface PerformanceMetrics {
  loadTime: number;
  renderTime: number;
  bundleSize?: number;
  memoryUsage?: number;
  timestamp: number;
}

interface NavigationTiming {
  domContentLoaded: number;
  pageLoad: number;
  firstPaint: number;
  firstContentfulPaint: number;
}

export function usePerformanceMonitor(componentName: string) {
  const [metrics, setMetrics] = useState<PerformanceMetrics | null>(null);
  const [startTime] = useState(performance.now());

  useEffect(() => {
    // Measure render time
    const renderTime = performance.now() - startTime;
    
    // Get memory usage if available
    const memoryUsage = (performance as any).memory?.usedJSHeapSize;
    
    const newMetrics: PerformanceMetrics = {
      loadTime: renderTime,
      renderTime,
      memoryUsage,
      timestamp: Date.now()
    };

    setMetrics(newMetrics);

    // Report to analytics (in development mode)
    if (process.env.NODE_ENV === 'development') {
      console.log(`📊 Performance [${componentName}]:`, {
        renderTime: `${renderTime.toFixed(2)}ms`,
        memoryUsage: memoryUsage ? `${(memoryUsage / 1024 / 1024).toFixed(2)}MB` : 'N/A'
      });
    }

    return () => {
      // Cleanup performance observer if needed
    };
  }, [componentName, startTime]);

  return metrics;
}

export function useNavigationTiming() {
  const [timing, setTiming] = useState<NavigationTiming | null>(null);

  useEffect(() => {
    const measureTiming = () => {
      if (performance.getEntriesByType) {
        const navigation = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming;
        const paint = performance.getEntriesByType('paint');
        
        const firstPaint = paint.find(entry => entry.name === 'first-paint')?.startTime || 0;
        const firstContentfulPaint = paint.find(entry => entry.name === 'first-contentful-paint')?.startTime || 0;

        setTiming({
          domContentLoaded: navigation.domContentLoadedEventEnd - navigation.domainLookupStart,
          pageLoad: navigation.loadEventEnd - navigation.domainLookupStart,
          firstPaint,
          firstContentfulPaint
        });
      }
    };

    // Wait for page load to complete
    if (document.readyState === 'complete') {
      measureTiming();
    } else {
      window.addEventListener('load', measureTiming);
      return () => window.removeEventListener('load', measureTiming);
    }
  }, []);

  return timing;
}

export function useBundleAnalytics() {
  const [bundleMetrics, setBundleMetrics] = useState({
    totalChunks: 0,
    loadedChunks: 0,
    totalSize: 0,
    loadingProgress: 0
  });

  const trackChunkLoad = useCallback((chunkName: string, size?: number) => {
    setBundleMetrics(prev => ({
      ...prev,
      loadedChunks: prev.loadedChunks + 1,
      totalSize: prev.totalSize + (size || 0),
      loadingProgress: prev.totalChunks > 0 ? (prev.loadedChunks + 1) / prev.totalChunks * 100 : 0
    }));

    if (process.env.NODE_ENV === 'development') {
      console.log(`📦 Chunk loaded: ${chunkName}`, size ? `(${(size / 1024).toFixed(2)}KB)` : '');
    }
  }, []);

  return { bundleMetrics, trackChunkLoad };
}

export function useWebVitals() {
  const [vitals, setVitals] = useState({
    LCP: 0, // Largest Contentful Paint
    FID: 0, // First Input Delay
    CLS: 0, // Cumulative Layout Shift
    FCP: 0, // First Contentful Paint
    TTFB: 0 // Time to First Byte
  });

  useEffect(() => {
    // Use web-vitals library if available
    const measureWebVitals = async () => {
      try {
        // Simulate web vitals measurement
        const navigation = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming;
        const paint = performance.getEntriesByType('paint');
        
        setVitals({
          LCP: 0, // Would be measured by real web-vitals library
          FID: 0, // Would be measured by real web-vitals library
          CLS: 0, // Would be measured by real web-vitals library
          FCP: paint.find(entry => entry.name === 'first-contentful-paint')?.startTime || 0,
          TTFB: navigation.responseStart - navigation.requestStart
        });
      } catch (error) {
        console.warn('Web Vitals measurement failed:', error);
      }
    };

    measureWebVitals();
  }, []);

  return vitals;
}

export function usePerformanceOptimization() {
  const [optimizations, setOptimizations] = useState({
    prefetchEnabled: false,
    lazyLoadingActive: false,
    cacheHitRate: 0,
    compressionEnabled: false
  });

  const enablePrefetch = useCallback((urls: string[]) => {
    urls.forEach(url => {
      const link = document.createElement('link');
      link.rel = 'prefetch';
      link.href = url;
      document.head.appendChild(link);
    });
    
    setOptimizations(prev => ({ ...prev, prefetchEnabled: true }));
  }, []);

  const enableImageLazyLoading = useCallback(() => {
    // Enable native lazy loading for images
    const images = document.querySelectorAll('img:not([loading])');
    images.forEach(img => {
      img.setAttribute('loading', 'lazy');
    });
    
    setOptimizations(prev => ({ ...prev, lazyLoadingActive: true }));
  }, []);

  return {
    optimizations,
    enablePrefetch,
    enableImageLazyLoading
  };
}

// Export performance utilities
export const performanceUtils = {
  measureComponentRender: (componentName: string) => {
    return (target: any, propertyKey: string, descriptor: PropertyDescriptor) => {
      const originalMethod = descriptor.value;
      
      descriptor.value = function (...args: any[]) {
        const start = performance.now();
        const result = originalMethod.apply(this, args);
        const end = performance.now();
        
        console.log(`⚡ ${componentName}.${propertyKey}: ${(end - start).toFixed(2)}ms`);
        return result;
      };
      
      return descriptor;
    };
  },

  debounce: <T extends (...args: any[]) => any>(func: T, wait: number): T => {
    let timeout: NodeJS.Timeout;
    return ((...args: any[]) => {
      clearTimeout(timeout);
      timeout = setTimeout(() => func.apply(null, args), wait);
    }) as T;
  },

  throttle: <T extends (...args: any[]) => any>(func: T, limit: number): T => {
    let lastFunc: NodeJS.Timeout;
    let lastRan: number;
    return ((...args: any[]) => {
      if (!lastRan) {
        func.apply(null, args);
        lastRan = Date.now();
      } else {
        clearTimeout(lastFunc);
        lastFunc = setTimeout(() => {
          if ((Date.now() - lastRan) >= limit) {
            func.apply(null, args);
            lastRan = Date.now();
          }
        }, limit - (Date.now() - lastRan));
      }
    }) as T;
  }
};

export default usePerformanceMonitor;