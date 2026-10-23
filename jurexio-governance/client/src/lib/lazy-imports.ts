/**
 * Lazy Import System for Bundle Optimization
 * Enables dynamic imports for better code splitting and faster initial load
 */

import { lazy } from 'react';

// AI Features - Load on demand
export const ChatDollKit3DAvatar = lazy(() => import('../components/ChatDollKit3DAvatar'));
export const EnhancedAIAssistantBuilder = lazy(() => import('../components/EnhancedAIAssistantBuilder'));

// Analytics & Monitoring - Load when needed
export const CostDashboard = lazy(() => import('../components/cost-dashboard'));
export const ContentPerformanceAnalytics = lazy(() => import('../components/ContentPerformanceAnalytics'));

// Platform-specific Components - Load per platform
export const OrchestrationDashboard = lazy(() => import('../components/orchestration-v3/OrchestrationDashboard').then(m => ({ default: m.OrchestrationDashboard || m.default })));
export const MultiPlatformPublisher = lazy(() => import('../components/MultiPlatformPublisher'));
export const BrandManagementSystem = lazy(() => import('../components/BrandManagementSystem'));
export const AdvancedCollaborationSuite = lazy(() => import('../components/AdvancedCollaborationSuite'));

// Code Editor & Development Tools - Load for CodeStudio
export const CodeEditor = lazy(() => import('../components/code-editor').then(m => ({ default: (m as any).CodeEditor || (m as any).default })));
export const LivePreview = lazy(() => import('../components/live-preview').then(m => ({ default: (m as any).LivePreview || (m as any).default })));
export const ProjectManagement = lazy(() => import('../components/ProjectManagement'));
export const DeploymentPipeline = lazy(() => import('../components/deployment-pipeline').then(m => ({ default: (m as any).DeploymentPipeline || (m as any).default })));

// Heavy Components - Load on interaction
export const MultiConversationChat = lazy(() => import('../components/MultiConversationChat').then(m => ({ default: (m as any).MultiConversationChat || (m as any).default })));

/**
 * Platform-specific lazy loading groups
 */
export const PlatformComponents = {
  codeStudio: {
    CodeEditor,
    LivePreview,
    ProjectManagement,
    DeploymentPipeline
  },
  
  aiAssistant: {
    ChatDollKit3DAvatar,
    EnhancedAIAssistantBuilder,
    MultiConversationChat
  },
  
  contentStudio: {
    ContentPerformanceAnalytics,
    MultiPlatformPublisher,
    BrandManagementSystem
  },
  
  analytics: {
    CostDashboard,
    OrchestrationDashboard
  },
  
  collaboration: {
    AdvancedCollaborationSuite,
    MultiConversationChat
  }
};

/**
 * Preload functions for faster subsequent loads
 */
export const preloadComponents = {
  async preloadAIFeatures() {
    try {
      return await Promise.allSettled([
        import('../components/ChatDollKit3DAvatar'),
        import('../components/EnhancedAIAssistantBuilder')
      ]);
    } catch (error) {
      console.warn('Failed to preload AI features:', error);
      return [];
    }
  },
  
  async preloadAnalytics() {
    try {
      return await Promise.allSettled([
        import('../components/cost-dashboard'),
        import('../components/ContentPerformanceAnalytics'),
        import('../components/orchestration-v3/OrchestrationDashboard')
      ]);
    } catch (error) {
      console.warn('Failed to preload analytics:', error);
      return [];
    }
  },
  
  async preloadCodeStudio() {
    try {
      return await Promise.allSettled([
        import('../components/code-editor'),
        import('../components/live-preview'),
        import('../components/ProjectManagement'),
        import('../components/deployment-pipeline')
      ]);
    } catch (error) {
      console.warn('Failed to preload code studio:', error);
      return [];
    }
  },
  
  async preloadPlatforms() {
    try {
      return await Promise.allSettled([
        import('../components/MultiPlatformPublisher'),
        import('../components/BrandManagementSystem'),
        import('../components/AdvancedCollaborationSuite')
      ]);
    } catch (error) {
      console.warn('Failed to preload platforms:', error);
      return [];
    }
  }
};

export default PlatformComponents;