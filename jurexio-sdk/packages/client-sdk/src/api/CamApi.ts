/**
 * CAM partner dashboard — /api/jrx/v1/sdk/cam/*
 */

import type { JrxHttpClient } from '../JrxClient.js';

export class CamApi {
  constructor(private readonly http: JrxHttpClient) {}

  dashboard(startupId?: string): Promise<unknown> {
    const path = startupId
      ? `/api/jrx/v1/sdk/cam/dashboard/${encodeURIComponent(startupId)}`
      : '/api/jrx/v1/sdk/cam/dashboard';
    return this.http.get(path);
  }
}
