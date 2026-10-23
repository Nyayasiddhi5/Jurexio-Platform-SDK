/**
 * Web Requests Tool
 * Production-ready HTTP client with retries, timeouts, and authentication
 */

import axios, { AxiosRequestConfig, Method } from 'axios';
import { Tool, ToolExecutor } from '../protocols/mcp/index.js';

/**
 * Web Requests Tool Definition
 */
export const webRequestsTool: Tool = {
  id: 'web_requests',
  name: 'Web Requests',
  description: 'Make HTTP requests (GET, POST, PUT, DELETE, PATCH) with headers, auth, and retry logic',
  parameters: [
    {
      name: 'url',
      type: 'string',
      description: 'Request URL',
      required: true,
    },
    {
      name: 'method',
      type: 'string',
      description: 'HTTP method',
      required: false,
      default: 'GET',
      enum: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS'],
    },
    {
      name: 'headers',
      type: 'object',
      description: 'Request headers',
      required: false,
    },
    {
      name: 'body',
      type: 'object',
      description: 'Request body (JSON)',
      required: false,
    },
    {
      name: 'params',
      type: 'object',
      description: 'URL query parameters',
      required: false,
    },
    {
      name: 'auth',
      type: 'object',
      description: 'Authentication config (username, password, or bearerToken)',
      required: false,
    },
    {
      name: 'timeout',
      type: 'number',
      description: 'Request timeout in milliseconds (default: 30000)',
      required: false,
      default: 30000,
    },
    {
      name: 'retries',
      type: 'number',
      description: 'Number of retry attempts (default: 0)',
      required: false,
      default: 0,
    },
  ],
  returns: {
    type: 'object',
    description: 'Response data with status, headers, and body',
  },
  examples: [
    {
      input: { url: 'https://api.example.com/data', method: 'GET' },
      output: { status: 200, data: { result: 'success' } },
    },
    {
      input: {
        url: 'https://api.example.com/users',
        method: 'POST',
        body: { name: 'John' },
        headers: { 'Content-Type': 'application/json' },
      },
      output: { status: 201, data: { id: 1, name: 'John' } },
    },
  ],
};

/**
 * Web Requests Executor
 */
export const webRequestsExecutor: ToolExecutor = async (params) => {
  const {
    url,
    method = 'GET',
    headers = {},
    body,
    params: queryParams,
    auth,
    timeout = 30000,
    retries = 0,
  } = params;

  const config: AxiosRequestConfig = {
    url,
    method: method.toUpperCase() as Method,
    headers,
    data: body,
    params: queryParams,
    timeout,
    validateStatus: () => true, // Don't throw on any status
  };

  // Handle authentication
  if (auth) {
    if ('bearerToken' in auth) {
      config.headers = {
        ...config.headers,
        Authorization: `Bearer ${auth.bearerToken}`,
      };
    } else if ('username' in auth && 'password' in auth) {
      config.auth = {
        username: auth.username,
        password: auth.password,
      };
    }
  }

  // Retry logic
  let lastError: Error | null = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await axios(config);

      return {
        success: response.status >= 200 && response.status < 300,
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
        data: response.data,
        requestUrl: url,
        requestMethod: method,
      };
    } catch (error: any) {
      lastError = error;

      // Don't retry on client errors (4xx)
      if (error.response && error.response.status >= 400 && error.response.status < 500) {
        return {
          success: false,
          status: error.response.status,
          statusText: error.response.statusText,
          error: error.message,
          data: error.response.data,
        };
      }

      // If this isn't the last attempt, wait before retrying
      if (attempt < retries) {
        await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 1000));
      }
    }
  }

  throw new Error(`Request failed after ${retries + 1} attempts: ${lastError?.message}`);
};
