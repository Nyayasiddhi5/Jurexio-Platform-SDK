import { apiRequest } from "./queryClient";

export const api = {
  // Projects
  getProjects: async (userId: string) => {
    return await apiRequest(`/api/projects?userId=${userId}`);
  },

  getProject: async (id: number) => {
    return await apiRequest(`/api/projects/${id}`);
  },

  createProject: async (data: any) => {
    return await apiRequest('/api/projects', {
      method: 'POST',
      body: JSON.stringify(data)
    });
  },

  updateProject: async (id: number, data: any) => {
    return await apiRequest(`/api/projects/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data)
    });
  },

  // Files
  uploadFiles: async (projectId: number, files: FileList) => {
    const formData = new FormData();
    Array.from(files).forEach(file => {
      formData.append('files', file);
    });
    formData.append('userId', 'demo_user');

    const response = await fetch(`/api/projects/${projectId}/files`, {
      method: 'POST',
      body: formData,
      credentials: 'include',
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Upload failed: ${error}`);
    }

    return response.json();
  },

  getProjectFiles: async (projectId: number) => {
    return await apiRequest(`/api/projects/${projectId}/files`);
  },

  // Project Initialization
  initializeProject: async (projectId: number, requirements: any) => {
    return await apiRequest(`/api/projects/${projectId}/initialize`, {
      method: 'POST',
      body: JSON.stringify({
        requirements,
        userId: 'demo_user'
      })
    });
  },

  // Agents
  getProjectAgents: async (projectId: number) => {
    return await apiRequest(`/api/projects/${projectId}/agents`);
  },

  getProjectProgress: async (projectId: number) => {
    return await apiRequest(`/api/projects/${projectId}/progress`);
  },

  // Tasks
  getProjectTasks: async (projectId: number) => {
    return await apiRequest(`/api/projects/${projectId}/tasks`);
  },

  executeTask: async (taskId: number) => {
    return await apiRequest(`/api/tasks/${taskId}/execute`, {
      method: 'POST'
    });
  },

  // Messages
  getProjectMessages: async (projectId: number, limit?: number) => {
    const url = `/api/projects/${projectId}/messages${limit ? `?limit=${limit}` : ''}`;
    return await apiRequest(url);
  },

  // Cost Analytics
  getCostAnalysis: async () => {
    return await apiRequest('/api/cost-analytics');
  },

  getProjectCostMetrics: async (projectId: number) => {
    return await apiRequest(`/api/projects/${projectId}/cost-metrics`);
  },

  // System Metrics
  getMetrics: async () => {
    return await apiRequest('/api/metrics');
  },

  getSystemHealth: async () => {
    return await apiRequest('/api/health');
  },

  // Deployment
  deployProject: async (projectId: number, config: any) => {
    return await apiRequest(`/api/projects/${projectId}/deploy`, {
      method: 'POST',
      body: JSON.stringify(config)
    });
  },

  getProjectDeployments: async (projectId: number) => {
    return await apiRequest(`/api/projects/${projectId}/deployments`);
  },

  getDeploymentStatus: async (deploymentId: number) => {
    return await apiRequest(`/api/deployments/${deploymentId}/status`);
  },

  getPlatformConfigs: async () => {
    return await apiRequest('/api/deployment/platforms');
  },

  // AI Direct Access
  processAIRequest: async (request: any) => {
    return await apiRequest('/api/ai/request', {
      method: 'POST',
      body: JSON.stringify(request)
    });
  },

  // Budget Management
  updateBudget: async (budget: any) => {
    return await apiRequest('/api/budget', {
      method: 'PUT',
      body: JSON.stringify(budget)
    });
  },
};

// Enhanced Jurexio orchestration with intelligent LLM selection
export const jurexioOrchestration = {
  processRequest: (data: any) => apiRequest('/enhanced-jurexio/process', {
    method: 'POST',
    body: JSON.stringify(data)
  }),
  getAgentStatus: () => apiRequest('/enhanced-jurexio/status'),
  getProviders: () => apiRequest('/enhanced-jurexio/providers/benchmarks'),
  getMetrics: () => apiRequest('/enhanced-jurexio/metrics'),
  recommendLLM: (data: any) => apiRequest('/enhanced-jurexio/recommend-llm', {
    method: 'POST',
    body: JSON.stringify(data)
  }),
  routeTask: (data: any) => apiRequest('/enhanced-jurexio/route-task', {
    method: 'POST',
    body: JSON.stringify(data)
  }),
  testRedundancy: (data: any) => apiRequest('/enhanced-jurexio/test-redundancy', {
    method: 'POST',
    body: JSON.stringify(data)
  }),

  // Legacy endpoints for backward compatibility
  createProject: (data: any) => apiRequest('/enhanced-jurexio/route-task', {
    method: 'POST',
    body: JSON.stringify({
      component: 'software-dev',
      action: 'create-project',
      payload: data
    })
  }),
  enhancePrompt: (data: any) => apiRequest('/enhanced-jurexio/route-task', {
    method: 'POST',
    body: JSON.stringify({
      component: 'content-creation',
      action: 'enhance-prompt',
      payload: data
    })
  }),
  testProviders: (data: any) => apiRequest('/enhanced-jurexio/test-redundancy', {
    method: 'POST',
    body: JSON.stringify({
      task: 'Provider connectivity test',
      simulateFailures: data.excludeProviders || []
    })
  }),
};

// Export for backward compatibility
export { apiRequest } from './queryClient';