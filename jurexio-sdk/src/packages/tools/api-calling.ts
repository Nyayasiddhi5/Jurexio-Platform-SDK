/**
 * API Calling Tool
 * Production-ready REST and GraphQL API client
 */

import axios, { AxiosRequestConfig } from 'axios';
import { Tool, ToolExecutor } from '../protocols/mcp/index.js';

/**
 * API Calling Tool Definition
 */
export const apiCallingTool: Tool = {
  id: 'api_calling',
  name: 'API Calling',
  description: 'Call REST and GraphQL APIs with authentication, retries, and error handling',
  parameters: [
    {
      name: 'type',
      type: 'string',
      description: 'API type',
      required: true,
      enum: ['rest', 'graphql'],
    },
    {
      name: 'endpoint',
      type: 'string',
      description: 'API endpoint URL',
      required: true,
    },
    {
      name: 'method',
      type: 'string',
      description: 'HTTP method (for REST)',
      required: false,
      default: 'GET',
      enum: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
    },
    {
      name: 'query',
      type: 'string',
      description: 'GraphQL query or mutation',
      required: false,
    },
    {
      name: 'variables',
      type: 'object',
      description: 'GraphQL variables',
      required: false,
    },
    {
      name: 'body',
      type: 'object',
      description: 'Request body (for REST)',
      required: false,
    },
    {
      name: 'headers',
      type: 'object',
      description: 'Request headers',
      required: false,
    },
    {
      name: 'auth',
      type: 'object',
      description: 'Authentication config',
      required: false,
    },
    {
      name: 'timeout',
      type: 'number',
      description: 'Request timeout (ms)',
      required: false,
      default: 30000,
    },
    {
      name: 'retries',
      type: 'number',
      description: 'Number of retries',
      required: false,
      default: 3,
    },
  ],
  returns: {
    type: 'object',
    description: 'API response data',
  },
  examples: [
    {
      input: {
        type: 'rest',
        endpoint: 'https://api.example.com/users',
        method: 'GET',
      },
      output: { success: true, data: [{ id: 1, name: 'Alice' }] },
    },
    {
      input: {
        type: 'graphql',
        endpoint: 'https://api.example.com/graphql',
        query: 'query { users { id name } }',
      },
      output: { success: true, data: { users: [{ id: 1, name: 'Alice' }] } },
    },
  ],
};

/**
 * API Calling Executor
 */
export const apiCallingExecutor: ToolExecutor = async (params) => {
  const {
    type,
    endpoint,
    method = 'GET',
    query,
    variables,
    body,
    headers = {},
    auth,
    timeout = 30000,
    retries = 3,
  } = params;

  if (type === 'graphql') {
    return executeGraphQL(endpoint, query!, variables, headers, auth, timeout, retries);
  } else {
    return executeREST(endpoint, method, body, headers, auth, timeout, retries);
  }
};

/**
 * Execute GraphQL request
 */
async function executeGraphQL(
  endpoint: string,
  query: string,
  variables: any,
  headers: any,
  auth: any,
  timeout: number,
  retries: number
): Promise<any> {
  const config: AxiosRequestConfig = {
    method: 'POST',
    url: endpoint,
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
    data: {
      query,
      variables: variables || {},
    },
    timeout,
  };

  // Add authentication
  if (auth?.bearerToken) {
    config.headers!.Authorization = `Bearer ${auth.bearerToken}`;
  }

  return executeWithRetry(config, retries);
}

/**
 * Execute REST request
 */
async function executeREST(
  endpoint: string,
  method: string,
  body: any,
  headers: any,
  auth: any,
  timeout: number,
  retries: number
): Promise<any> {
  const config: AxiosRequestConfig = {
    method,
    url: endpoint,
    headers: { ...headers },
    data: body,
    timeout,
  };

  // Add authentication
  if (auth?.bearerToken) {
    config.headers!.Authorization = `Bearer ${auth.bearerToken}`;
  } else if (auth?.apiKey) {
    config.headers!['X-API-Key'] = auth.apiKey;
  }

  return executeWithRetry(config, retries);
}

/**
 * Execute with retry logic
 */
async function executeWithRetry(config: AxiosRequestConfig, retries: number): Promise<any> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await axios(config);

      return {
        success: response.status >= 200 && response.status < 300,
        status: response.status,
        data: response.data,
        headers: response.headers,
      };
    } catch (error: any) {
      lastError = error;

      // Don't retry on client errors
      if (error.response?.status >= 400 && error.response?.status < 500) {
        return {
          success: false,
          status: error.response.status,
          error: error.message,
          data: error.response.data,
        };
      }

      // Wait before retrying (exponential backoff)
      if (attempt < retries) {
        await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 1000));
      }
    }
  }

  throw new Error(`API call failed after ${retries + 1} attempts: ${lastError?.message}`);
}
