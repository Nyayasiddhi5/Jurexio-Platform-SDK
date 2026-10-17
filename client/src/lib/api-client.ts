/**
 * Standardized Frontend API Client
 * Consistent interface for all Jurexio platform API interactions
 */

export interface APIResponse<T = any> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: any;
  };
  metadata?: {
    timestamp: string;
    version: string;
    platform: string;
    processingTime?: number;
  };
}

export interface PaginatedAPIResponse<T = any> extends APIResponse<T[]> {
  pagination?: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export class APIClient {
  private static baseURL = '/api';

  /**
   * Generic request handler with standardized error handling
   */
  private static async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<APIResponse<T>> {
    try {
      const response = await fetch(`${this.baseURL}${endpoint}`, {
        headers: {
          'Content-Type': 'application/json',
          ...options.headers,
        },
        ...options,
      });

      const data: APIResponse<T> = await response.json();

      if (!response.ok) {
        throw new Error(data.error?.message || `HTTP ${response.status}`);
      }

      return data;
    } catch (error) {
      console.error(`API Error [${endpoint}]:`, error);
      return {
        success: false,
        error: {
          code: 'NETWORK_ERROR',
          message: error instanceof Error ? error.message : 'Network request failed',
        }
      };
    }
  }

  /**
   * GET request
   */
  static async get<T>(endpoint: string): Promise<APIResponse<T>> {
    return this.request<T>(endpoint, { method: 'GET' });
  }

  /**
   * POST request
   */
  static async post<T>(endpoint: string, data?: any): Promise<APIResponse<T>> {
    return this.request<T>(endpoint, {
      method: 'POST',
      body: data ? JSON.stringify(data) : undefined,
    });
  }

  /**
   * PUT request
   */
  static async put<T>(endpoint: string, data?: any): Promise<APIResponse<T>> {
    return this.request<T>(endpoint, {
      method: 'PUT',
      body: data ? JSON.stringify(data) : undefined,
    });
  }

  /**
   * DELETE request
   */
  static async delete<T>(endpoint: string): Promise<APIResponse<T>> {
    return this.request<T>(endpoint, { method: 'DELETE' });
  }

  /**
   * Jurexio-specific API methods
   */
  static async orchestrateProject<T>(request: any): Promise<APIResponse<T>> {
    return this.post<T>('/nyayavigya/orchestrate', request);
  }

  static async getAgentStatus<T>(agentId: string): Promise<APIResponse<T>> {
    return this.get<T>(`/agents/${agentId}/status`);
  }

  static async getPlatformStats<T>(): Promise<APIResponse<T>> {
    return this.get<T>('/dashboard/stats');
  }

  static async getLLMProviderHealth<T>(): Promise<APIResponse<T>> {
    return this.get<T>('/llm/health');
  }

  /**
   * Paginated requests
   */
  static async getPaginated<T>(
    endpoint: string,
    page: number = 1,
    limit: number = 10
  ): Promise<PaginatedAPIResponse<T>> {
    return this.request<T[]>(`${endpoint}?page=${page}&limit=${limit}`, { method: 'GET' }) as Promise<PaginatedAPIResponse<T>>;
  }

  /**
   * File upload with progress
   */
  static async uploadFile<T>(
    endpoint: string,
    file: File,
    onProgress?: (progress: number) => void
  ): Promise<APIResponse<T>> {
    return new Promise((resolve) => {
      const formData = new FormData();
      formData.append('file', file);

      const xhr = new XMLHttpRequest();

      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable && onProgress) {
          const progress = (event.loaded / event.total) * 100;
          onProgress(progress);
        }
      };

      xhr.onload = () => {
        try {
          const response: APIResponse<T> = JSON.parse(xhr.responseText);
          resolve(response);
        } catch (error) {
          resolve({
            success: false,
            error: {
              code: 'PARSE_ERROR',
              message: 'Failed to parse server response',
            }
          });
        }
      };

      xhr.onerror = () => {
        resolve({
          success: false,
          error: {
            code: 'UPLOAD_ERROR',
            message: 'File upload failed',
          }
        });
      };

      xhr.open('POST', `${this.baseURL}${endpoint}`);
      xhr.send(formData);
    });
  }
}

/**
 * React hooks for API interactions
 */
import { useState } from 'react';

export const useAPIRequest = <T>(endpoint: string) => {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const execute = async (options?: RequestInit) => {
    setLoading(true);
    setError(null);

    const response = await APIClient.get<T>(endpoint);

    if (response.success && response.data) {
      setData(response.data);
    } else {
      setError(response.error?.message || 'Request failed');
    }

    setLoading(false);
    return response;
  };

  return { data, loading, error, execute };
};

export default APIClient;