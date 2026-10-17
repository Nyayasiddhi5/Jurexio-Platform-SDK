import type {
  CaselawDoc,
  ChatConversation,
  ChatConversationDetail,
  ChatConversationInput,
  ChatConversationUpdate,
  ChatDocument,
  ChatDocumentInput,
  ChatExchange,
  ChatMessageInput,
  CaselawSearchResponse,
  CaselawStats,
  Category,
  CreateRunInput,
  Evaluation,
  Jurisdiction,
  LegalTask,
  LegalTaskDetail,
  Run,
  RunDetail,
  VerifyCitationResult,
  Statute,
  StatuteActsResponse,
  StatuteCode,
  StatuteSearchResponse,
  IpcBnsComparison,
  OldNewComparison,
  NewOldComparison,
  ExtractCitationsResult,
  SimilarCasesResult,
  RetrievalPlan,
  TemplateSummary,
  TemplateDetail,
  TemplateKind,
  UsageAnalytics,
  AdviseInput,
  AdviseResult,
  StreamEvent,
} from "./types";

export * from "./types";

export interface NyayavigyaClientOptions {
  /** Base URL of the API, e.g. "https://host/api". Defaults to "/api". */
  baseUrl?: string;
  /** Partner API key, sent as X-API-Key (Nyayavigya canonical header). */
  apiKey?: string;
  /** Custom fetch implementation (defaults to global fetch). */
  fetch?: typeof fetch;
  /** Request timeout in milliseconds (default 120000 — agent runs can take 20-90s). */
  timeoutMs?: number;
}

export class NyayavigyaApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "NyayavigyaApiError";
  }
}

export class NyayavigyaClient {
  private readonly baseUrl: string;
  private readonly apiKey?: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(options: NyayavigyaClientOptions = {}) {
    this.baseUrl = (options.baseUrl ?? "/api").replace(/\/$/, "");
    this.apiKey = options.apiKey;
    this.fetchImpl = options.fetch ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 120_000;
  }

  private async request<T>(
    method: "GET" | "POST" | "PATCH" | "DELETE",
    path: string,
    body?: unknown,
  ): Promise<T> {
    const headers: Record<string, string> = {
      Accept: "application/json",
    };
    if (this.apiKey) {
      headers["X-API-Key"] = this.apiKey;
      headers["Authorization"] = `Bearer ${this.apiKey}`;
    }
    if (body !== undefined) headers["Content-Type"] = "application/json";

    const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(this.timeoutMs),
    });

    if (res.status === 204) return undefined as T;
    if (!res.ok) {
      let message = `Request failed with status ${res.status}`;
      try {
        const data = (await res.json()) as { error?: string };
        if (data.error) message = data.error;
      } catch {
        // keep default message
      }
      throw new NyayavigyaApiError(res.status, message);
    }
    return (await res.json()) as T;
  }

  /**
   * POST to an SSE endpoint and yield parsed StreamEvents.
   * Terminates after a `done` or `error` event.
   */
  private async *stream<TDone>(
    path: string,
    body: unknown,
  ): AsyncGenerator<StreamEvent<TDone>, void, undefined> {
    const headers: Record<string, string> = {
      Accept: "text/event-stream",
      "Content-Type": "application/json",
    };
    if (this.apiKey) {
      headers["X-API-Key"] = this.apiKey;
      headers["Authorization"] = `Bearer ${this.apiKey}`;
    }
    const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!res.ok || !res.body) {
      let message = `Streaming request failed with status ${res.status}`;
      try {
        const data = (await res.json()) as { error?: string };
        if (data.error) message = data.error;
      } catch {
        // keep default message
      }
      throw new NyayavigyaApiError(res.status, message);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let sep: number;
        while ((sep = buffer.indexOf("\n\n")) !== -1) {
          const block = buffer.slice(0, sep);
          buffer = buffer.slice(sep + 2);
          const event = parseSseBlock<TDone>(block);
          if (!event) continue;
          yield event;
          if (event.type === "done" || event.type === "error") return;
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  /** Caselaw module — real-data legal search, citations, verification. */
  readonly caselaw = {
    search: (params: {
      jurisdiction: Jurisdiction;
      q: string;
      year?: number;
      court?: string;
      limit?: number;
    }): Promise<CaselawSearchResponse> => {
      const qs = new URLSearchParams({
        jurisdiction: params.jurisdiction,
        q: params.q,
      });
      if (params.year !== undefined) qs.set("year", String(params.year));
      if (params.court) qs.set("court", params.court);
      if (params.limit !== undefined) qs.set("limit", String(params.limit));
      return this.request("GET", `/caselaw/search?${qs.toString()}`);
    },
    getDocument: (id: number): Promise<CaselawDoc> =>
      this.request("GET", `/caselaw/documents/${id}`),
    verifyCitation: (params: {
      citation: string;
      jurisdiction?: Jurisdiction | "ALL";
    }): Promise<VerifyCitationResult> =>
      this.request("POST", "/caselaw/verify-citation", params),
    stats: (): Promise<CaselawStats> => this.request("GET", "/caselaw/stats"),
    similarCases: (id: number, opts?: { limit?: number }): Promise<SimilarCasesResult> =>
      this.request(
        "GET",
        `/caselaw/documents/${id}/similar${opts?.limit ? `?limit=${opts.limit}` : ""}`,
      ),
    extractCitations: (params: {
      text: string;
      link?: boolean;
    }): Promise<ExtractCitationsResult> =>
      this.request("POST", "/citations/extract", params),
  };

  /** Statutes module — COI + India Code central Acts + BNS/BNSS/BSA/IPC/US Code corpus and IPC→BNS comparison. */
  readonly statutes = {
    acts: (params?: {
      q?: string;
      practiceArea?: string;
      jurisdiction?: "IN" | "US";
    }): Promise<StatuteActsResponse> => {
      const qs = new URLSearchParams();
      if (params?.q) qs.set("q", params.q);
      if (params?.practiceArea) qs.set("practiceArea", params.practiceArea);
      if (params?.jurisdiction) qs.set("jurisdiction", params.jurisdiction);
      const suffix = qs.size > 0 ? `?${qs.toString()}` : "";
      return this.request("GET", `/statutes/acts${suffix}`);
    },
    list: (params?: {
      code?: StatuteCode;
      jurisdiction?: "IN" | "US";
      limit?: number;
    }): Promise<StatuteSearchResponse> => {
      const qs = new URLSearchParams();
      if (params?.code) qs.set("code", params.code);
      if (params?.jurisdiction) qs.set("jurisdiction", params.jurisdiction);
      if (params?.limit !== undefined) qs.set("limit", String(params.limit));
      const suffix = qs.size > 0 ? `?${qs.toString()}` : "";
      return this.request("GET", `/statutes${suffix}`);
    },
    search: (params: {
      q: string;
      code?: StatuteCode;
      jurisdiction?: "IN" | "US";
      limit?: number;
    }): Promise<StatuteSearchResponse> => {
      const qs = new URLSearchParams({ q: params.q });
      if (params.code) qs.set("code", params.code);
      if (params.jurisdiction) qs.set("jurisdiction", params.jurisdiction);
      if (params.limit !== undefined) qs.set("limit", String(params.limit));
      return this.request("GET", `/statutes/search?${qs.toString()}`);
    },
    compareIpcToBns: (section: string): Promise<IpcBnsComparison> =>
      this.request(
        "GET",
        `/statutes/compare/ipc-bns?section=${encodeURIComponent(section)}`,
      ),
    compareOldToNew: (
      from: "CrPC" | "IEA",
      section: string,
    ): Promise<OldNewComparison> =>
      this.request(
        "GET",
        `/statutes/compare/old-new?from=${from}&section=${encodeURIComponent(section)}`,
      ),
    compareNewToOld: (
      from: "BNSS" | "BSA" | "BNS",
      section: string,
    ): Promise<NewOldComparison> =>
      this.request(
        "GET",
        `/statutes/compare/new-old?from=${from}&section=${encodeURIComponent(section)}`,
      ),
  };

  /** Retrieval module — retrieval-first answer planning over local corpora. */
  readonly retrieval = {
    retrieve: (params: {
      query: string;
      jurisdiction?: "IN" | "US";
      limit?: number;
    }): Promise<RetrievalPlan> => this.request("POST", "/retrieve", params),
  };

  /** Agentic work module — benchmark tasks, agent runs, rubric evaluation. */
  readonly agenticWork = {
    listCategories: (): Promise<Category[]> =>
      this.request("GET", "/categories"),
    listTasks: (params?: {
      category?: string;
      workType?: string;
      search?: string;
      limit?: number;
    }): Promise<LegalTask[]> => {
      const qs = new URLSearchParams();
      if (params?.category) qs.set("category", params.category);
      if (params?.workType) qs.set("workType", params.workType);
      if (params?.search) qs.set("search", params.search);
      if (params?.limit !== undefined) qs.set("limit", String(params.limit));
      const suffix = qs.size > 0 ? `?${qs.toString()}` : "";
      return this.request("GET", `/tasks${suffix}`);
    },
    getTask: (id: number): Promise<LegalTaskDetail> =>
      this.request("GET", `/tasks/${id}`),
    listRuns: (): Promise<Run[]> => this.request("GET", "/runs"),
    createRun: (input: CreateRunInput): Promise<RunDetail> =>
      this.request("POST", "/runs", input),
    getRun: (id: number): Promise<RunDetail> =>
      this.request("GET", `/runs/${id}`),
    deleteRun: (id: number): Promise<void> =>
      this.request("DELETE", `/runs/${id}`),
    evaluateRun: (id: number): Promise<Evaluation> =>
      this.request("POST", `/runs/${id}/evaluate`),
    /** Streaming variant of createRun — yields status/delta events, then done with the RunDetail. */
    createRunStream: (
      input: CreateRunInput,
    ): AsyncGenerator<StreamEvent<RunDetail>, void, undefined> =>
      this.stream<RunDetail>("/runs/stream", input),
  };

  /** Chat module — Legal Chat conversations, document uploads, and the six AI action modes. */
  readonly chat = {
    listConversations: (params?: {
      search?: string;
    }): Promise<ChatConversation[]> => {
      const qs = new URLSearchParams();
      if (params?.search) qs.set("search", params.search);
      const suffix = qs.size > 0 ? `?${qs.toString()}` : "";
      return this.request("GET", `/chat/conversations${suffix}`);
    },
    createConversation: (
      input: ChatConversationInput = {},
    ): Promise<ChatConversation> =>
      this.request("POST", "/chat/conversations", input),
    getConversation: (id: number): Promise<ChatConversationDetail> =>
      this.request("GET", `/chat/conversations/${id}`),
    updateConversation: (
      id: number,
      update: ChatConversationUpdate,
    ): Promise<ChatConversation> =>
      this.request("PATCH", `/chat/conversations/${id}`, update),
    deleteConversation: (id: number): Promise<void> =>
      this.request("DELETE", `/chat/conversations/${id}`),
    uploadDocument: (
      conversationId: number,
      input: ChatDocumentInput,
    ): Promise<ChatDocument> =>
      this.request(
        "POST",
        `/chat/conversations/${conversationId}/documents`,
        input,
      ),
    sendMessage: (
      conversationId: number,
      input: ChatMessageInput,
    ): Promise<ChatExchange> =>
      this.request(
        "POST",
        `/chat/conversations/${conversationId}/messages`,
        input,
      ),
    /** Streaming variant of sendMessage — yields delta events for free-text actions, then done with the ChatExchange. */
    sendMessageStream: (
      conversationId: number,
      input: ChatMessageInput,
    ): AsyncGenerator<StreamEvent<ChatExchange>, void, undefined> =>
      this.stream<ChatExchange>(
        `/chat/conversations/${conversationId}/messages/stream`,
        input,
      ),
  };

  /** Templates module — drafting templates and procedural checklists. */
  readonly templates = {
    list: (params?: {
      kind?: TemplateKind;
      jurisdiction?: string;
      search?: string;
    }): Promise<TemplateSummary[]> => {
      const qs = new URLSearchParams();
      if (params?.kind) qs.set("kind", params.kind);
      if (params?.jurisdiction) qs.set("jurisdiction", params.jurisdiction);
      if (params?.search) qs.set("search", params.search);
      const suffix = qs.size > 0 ? `?${qs.toString()}` : "";
      return this.request("GET", `/templates${suffix}`);
    },
    get: (id: number): Promise<TemplateDetail> =>
      this.request("GET", `/templates/${id}`),
  };

  /** Intelligence module — usage analytics and grounded strategy advisory. */
  readonly intelligence = {
    usage: (params?: { days?: number }): Promise<UsageAnalytics> =>
      this.request(
        "GET",
        `/analytics/usage${params?.days ? `?days=${params.days}` : ""}`,
      ),
    advise: (input: AdviseInput): Promise<AdviseResult> =>
      this.request("POST", "/advise", input),
  };
}

export function parseSseBlock<TDone>(block: string): StreamEvent<TDone> | null {
  let eventName = "message";
  const dataLines: string[] = [];
  for (const line of block.split("\n")) {
    if (line.startsWith("event:")) eventName = line.slice(6).trim();
    else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
  }
  if (dataLines.length === 0) return null;
  let data: unknown;
  try {
    data = JSON.parse(dataLines.join("\n"));
  } catch {
    return null;
  }
  switch (eventName) {
    case "status":
      return { type: "status", stage: (data as { stage: string }).stage };
    case "delta":
      return { type: "delta", text: (data as { text: string }).text };
    case "done":
      return { type: "done", payload: data as TDone };
    case "error":
      return { type: "error", error: (data as { error: string }).error };
    default:
      return null;
  }
}

export function createNyayavigyaClient(
  options?: NyayavigyaClientOptions,
): NyayavigyaClient {
  return new NyayavigyaClient(options);
}
