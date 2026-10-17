/**
 * PatraMitraApi — Document companion for NSP/NYM (Parse · Understand · Ask).
 * Canonical path: /api/jrx/v1/sdk/patra-mitra/*
 */
import type { NyvHttpClient } from '../NyvClient.js';

export interface PatraMitraHealthData {
  product: string;
  code: string;
  tagline: string;
  status: string;
  capabilities: string[];
  formats: string[];
  tools: string[];
  languages: string[];
}

export interface PatraMitraSessionSummary {
  id: string;
  filename?: string;
  createdAt?: string;
  updatedAt?: string;
  detectedLanguage?: string;
  status?: string;
  [key: string]: unknown;
}

export interface PatraMitraCreateSessionInput {
  text?: string;
  content?: string;
  filename?: string;
  /** Base64 file body when uploading binary (gateway accepts multipart or JSON). */
  fileBase64?: string;
  mimeType?: string;
  jurisdiction?: string;
  language?: string;
  answerLanguage?: string;
}

export interface PatraMitraChatInput {
  message: string;
  question?: string;
  jurisdiction?: string;
  answerLanguage?: string;
  language?: string;
}

export interface PatraMitraToolInput {
  tool: string;
  toolId?: string;
  answerLanguage?: string;
  language?: string;
}

export class PatraMitraApi {
  constructor(private readonly http: NyvHttpClient) {}

  health(): Promise<{ success: boolean; data: PatraMitraHealthData }> {
    return this.http.get('/api/jrx/v1/sdk/patra-mitra/health');
  }

  listSessions(): Promise<{
    success: boolean;
    data: { sessions: PatraMitraSessionSummary[] };
  }> {
    return this.http.get('/api/jrx/v1/sdk/patra-mitra/sessions');
  }

  createSession(input: PatraMitraCreateSessionInput): Promise<{
    success: boolean;
    data?: unknown;
    error?: string;
  }> {
    return this.http.post('/api/jrx/v1/sdk/patra-mitra/sessions', input);
  }

  getSession(
    sessionId: string,
    opts?: { fullText?: boolean },
  ): Promise<{ success: boolean; data?: unknown; error?: string }> {
    const q = opts?.fullText ? '?fullText=1' : '';
    return this.http.get(
      `/api/jrx/v1/sdk/patra-mitra/sessions/${encodeURIComponent(sessionId)}${q}`,
    );
  }

  chat(
    sessionId: string,
    input: PatraMitraChatInput,
  ): Promise<{ success: boolean; data?: { answer: string; session: unknown }; error?: string }> {
    return this.http.post(
      `/api/jrx/v1/sdk/patra-mitra/sessions/${encodeURIComponent(sessionId)}/chat`,
      input,
    );
  }

  runTool(
    sessionId: string,
    input: PatraMitraToolInput,
  ): Promise<{ success: boolean; data?: unknown; error?: string }> {
    return this.http.post(
      `/api/jrx/v1/sdk/patra-mitra/sessions/${encodeURIComponent(sessionId)}/tools`,
      {
        tool: input.tool || input.toolId,
        answerLanguage: input.answerLanguage || input.language,
      },
    );
  }
}
