/**
 * NyvClient — Main entry point for the @jurexio/client-sdk
 *
 * Usage:
 *   const nyv = new NyvClient({ apiKey: 'nyv_live_sk_...', baseUrl: 'https://api.jurexio.example' });
 *   const result = await nyv.patterns.cot({ task: 'Explain BNS 2023 Section 103', jurisdiction: 'IN' });
 *   await nyv.stream.streamPattern('cot', { task: '...' }, { onTextDelta: (d) => process.stdout.write(d) });
 */

import { PatternsApi } from './api/PatternsApi.js';
import { DocumentsApi } from './api/DocumentsApi.js';
import { AgentsApi } from './api/AgentsApi.js';
import { SkillsApi } from './api/SkillsApi.js';
import { TwinApi } from './api/TwinApi.js';
import { KnowledgeApi } from './api/KnowledgeApi.js';
import { InstantSearchApi } from './api/InstantSearchApi.js';
import { TemplatesApi } from './api/TemplatesApi.js';
import { LegalWorkApi } from './api/LegalWorkApi.js';
import { MatterVaultApi } from './api/MatterVaultApi.js';
import { VoiceApi } from './api/VoiceApi.js';
import { IntelligenceApi } from './api/IntelligenceApi.js';
import { TestingApi } from './api/TestingApi.js';
import { ComplianceApi } from './api/ComplianceApi.js';
import { NyayaToolsApi } from './api/NyayaToolsApi.js';
import { MemoryApi } from './api/MemoryApi.js';
import { CacheApi } from './api/CacheApi.js';
import { CreditsApi } from './api/CreditsApi.js';
import { OrchApi } from './api/OrchApi.js';
import { WorkflowsApi } from './api/WorkflowsApi.js';
import { DocAiApi } from './api/DocAiApi.js';
import { GovApi } from './api/GovApi.js';
import { LegalPipelineApi } from './api/LegalPipelineApi.js';
import { ComplianceNv5Api } from './api/ComplianceNv5Api.js';
import { InternalApi } from './api/InternalApi.js';
import { RagApi } from './api/RagApi.js';
import { ModelsApi } from './api/ModelsApi.js';
import { McpApi } from './api/McpApi.js';
import { CotApi } from './api/CotApi.js';
import { ConnectorsApi } from './api/ConnectorsApi.js';
import { EcosystemDocumentsApi } from './api/EcosystemDocumentsApi.js';
import { CnrApi } from './api/CnrApi.js';
import { PatraMitraApi } from './api/PatraMitraApi.js';
import { OrchestrateApi, type OrchestrateRequest, type OrchestrateResult } from './api/OrchestrateApi.js';
import { GatewayApi } from './api/GatewayApi.js';
import { PartnerIntelligenceApi } from './api/PartnerIntelligenceApi.js';
import { DocsPipelineApi } from './api/DocsPipelineApi.js';
import { DocparseApi } from './api/DocparseApi.js';
import { LlmRouterApi } from './api/LlmRouterApi.js';
import { CamApi } from './api/CamApi.js';
import { SwarmApi } from './api/SwarmApi.js';
import { LegalSdkApi } from './api/LegalSdkApi.js';
import { UsageApi } from './api/UsageApi.js';
import { NyvStreamReader, type NyvStreamOptions } from './NyvStreamReader.js';
import type { NyvClientConfig, NyvApiError, NyvJurisdiction, NyvLegalDomain, NyvStreamHandlers, NyvPatternResponse } from './types/index.js';
import { NyvError } from './types/index.js';

/** Callable Queen facade: `nyv.orchestrate(req)` + `nyv.orchestrate.stream(...)`. */
export type OrchestrateFacade = {
  (req: OrchestrateRequest): Promise<OrchestrateResult>;
  run(req: OrchestrateRequest): Promise<OrchestrateResult>;
  stream(
    req: OrchestrateRequest,
    handlers?: NyvStreamHandlers,
    options?: NyvStreamOptions,
  ): Promise<NyvPatternResponse>;
};

export interface NyvHttpClient {
  get<T = unknown>(path: string): Promise<T>;
  post<T = unknown>(path: string, body: unknown): Promise<T>;
  postForm<T = unknown>(path: string, form: FormData): Promise<T>;
  patch<T = unknown>(path: string, body: unknown): Promise<T>;
  delete<T = unknown>(path: string): Promise<T>;
  /**
   * Raw-bytes GET. Used by binary download paths (e.g. /api/nv5/doc-ai/convert/jobs/:id/result).
   * Returns the response body as a Uint8Array plus the negotiated `Content-Type` and
   * (best-effort) filename parsed from `Content-Disposition`. Errors raise `NyvError`
   * with the same envelope behaviour as the JSON helpers.
   */
  getBytes(path: string): Promise<{ data: Uint8Array; mimeType: string; fileName?: string }>;
}

class FetchHttpClient implements NyvHttpClient {
  private readonly baseUrl: string;
  private readonly headers: Record<string, string>;
  private readonly timeout: number;

  constructor(config: NyvClientConfig, timeoutOverride?: number) {
    this.baseUrl = (config.baseUrl ?? 'https://api.jurexio.example').replace(/\/$/, '');
    this.headers = {
      'Content-Type': 'application/json',
      'X-API-Key': config.apiKey,
      'Authorization': `Bearer ${config.apiKey}`,
      'X-NYV-SDK-Version': config.version ?? NyvClient.VERSION,
      'X-NYV-Platform': config.defaultPlatform ?? 'nys-professional',
    };
    if (config.platformClient) {
      this.headers['X-NSP-Client'] = config.platformClient;
    }
    if (config.interServiceSecret) {
      this.headers['X-NSP-Inter-Secret'] = config.interServiceSecret;
    }
    this.timeout = timeoutOverride ?? config.timeout ?? 30_000;
  }

  async get<T>(path: string): Promise<T> {
    return this.request<T>('GET', path);
  }

  async post<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>('POST', path, body);
  }

  async postForm<T>(path: string, form: FormData): Promise<T> {
    const { 'Content-Type': _, ...headersWithoutCT } = this.headers;
    return this.request<T>('POST', path, form, headersWithoutCT);
  }

  async patch<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>('PATCH', path, body);
  }

  async delete<T>(path: string): Promise<T> {
    return this.request<T>('DELETE', path);
  }

  async getBytes(path: string): Promise<{ data: Uint8Array; mimeType: string; fileName?: string }> {
    const url = `${this.baseUrl}${path}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeout);
    try {
      const res = await fetch(url, { method: 'GET', headers: this.headers, signal: controller.signal });
      if (!res.ok) {
        let errBody: Partial<NyvApiError> & { error?: string } = {};
        try { errBody = await res.json() as Partial<NyvApiError> & { error?: string }; } catch { /* ignore */ }
        throw new NyvError({
          code: errBody.code ?? 'API_ERROR',
          // NV-* routes use safeError() which emits `{success:false,error:msg}`
          // — fall back to `error` so consumers can introspect the real
          // failure (e.g. "relation X does not exist") instead of just
          // "HTTP 500".
          message: errBody.message ?? errBody.error ?? `HTTP ${res.status} ${res.statusText}`,
          status: res.status,
          traceId: res.headers.get('X-NYV-Trace-Id') ?? undefined,
          details: errBody.details,
        });
      }
      const buf = new Uint8Array(await res.arrayBuffer());
      const mimeType = res.headers.get('Content-Type') ?? 'application/octet-stream';
      const cd = res.headers.get('Content-Disposition') ?? '';
      const m = /filename\s*=\s*"?([^"]+)"?/i.exec(cd);
      return { data: buf, mimeType, fileName: m?.[1] };
    } finally {
      clearTimeout(timer);
    }
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    overrideHeaders?: Record<string, string>
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeout);

    try {
      const res = await fetch(url, {
        method,
        headers: overrideHeaders ?? this.headers,
        body: body instanceof FormData ? body : (body !== undefined ? JSON.stringify(body) : undefined),
        signal: controller.signal,
      });

      if (!res.ok) {
        let errBody: Partial<NyvApiError> & { error?: string } = {};
        try { errBody = await res.json() as Partial<NyvApiError> & { error?: string }; } catch { /* ignore */ }
        throw new NyvError({
          code: errBody.code ?? 'API_ERROR',
          // NV-* routes use safeError() → `{success:false,error:msg}`.
          message: errBody.message ?? errBody.error ?? `HTTP ${res.status} ${res.statusText}`,
          status: res.status,
          traceId: res.headers.get('X-NYV-Trace-Id') ?? undefined,
          details: errBody.details,
        });
      }

      const json = await res.json();
      if (json && typeof json === 'object' && 'data' in json && json.data !== undefined) {
        return json.data as T;
      }
      return json as T;
    } finally {
      clearTimeout(timer);
    }
  }
}

export class NyvClient {
  public static readonly VERSION = '5.1.0';

  public readonly patterns: PatternsApi;
  public readonly documents: DocumentsApi;
  public readonly agents: AgentsApi;
  public readonly skills: SkillsApi;
  public readonly twins: TwinApi;
  public readonly knowledge: KnowledgeApi;
  /** Instant Search facade (statutes/caselaw/acts) over Knowledge Plane. */
  public readonly instantSearch: InstantSearchApi;
  /** Canonical legal templates catalog (NSP / ecosystem). GET /api/jrx/templates */
  public readonly templates: TemplatesApi;
  /** NYS federated legal-work (tasks, async runs, chat). */
  public readonly legalWork: LegalWorkApi;
  public readonly matterVault: MatterVaultApi;
  public readonly voice: VoiceApi;
  public readonly intelligence: IntelligenceApi;
  public readonly testing: TestingApi;
  public readonly compliance: ComplianceApi;
  public readonly nyayaTools: NyayaToolsApi;
  public readonly memory: MemoryApi;
  public readonly cache: CacheApi;
  public readonly credits: CreditsApi;
  public readonly orch: OrchApi;
  public readonly workflows: WorkflowsApi;
  public readonly docAi: DocAiApi;
  public readonly gov: GovApi;
  public readonly legalPipeline: LegalPipelineApi;
  public readonly complianceNv5: ComplianceNv5Api;
  public readonly internal: InternalApi;
  public readonly rag: RagApi;
  public readonly models: ModelsApi;
  public readonly mcp: McpApi;
  public readonly cot: CotApi;
  public readonly connectors: ConnectorsApi;
  public readonly ecosystemDocuments: EcosystemDocumentsApi;
  /** CNR corpus resolve (judgment/Open Data — never live eCourts). */
  public readonly cnr: CnrApi;
  /** Patra Mitra document companion (parse / fields / summary / tools / chat). */
  public readonly patraMitra: PatraMitraApi;
  public readonly usage: UsageApi;
  /** Queen orchestration — POST /api/jrx/orchestrate (600s default timeout). */
  public readonly orchestrateApi: OrchestrateApi;
  /**
   * Callable Queen facade — `await nyv.orchestrate({ prompt })` and
   * `await nyv.orchestrate.stream(req, { onTextDelta, onAgentSelected })`.
   */
  public readonly orchestrate: OrchestrateFacade;
  /** @deprecated Use orchestrateApi — alias for NSP flat facade. */
  public readonly queen: OrchestrateApi;
  public readonly gateway: GatewayApi;
  public readonly partnerIntelligence: PartnerIntelligenceApi;
  public readonly docsPipeline: DocsPipelineApi;
  /** Platform docparse jobs + domain packs (`@jurexio/docparse-sdk` on NYV). */
  public readonly docparse: DocparseApi;
  public readonly llmRouter: LlmRouterApi;
  public readonly cam: CamApi;
  public readonly swarm: SwarmApi;
  public readonly legalSdk: LegalSdkApi;
  public readonly stream: NyvStreamReader;

  private readonly http: NyvHttpClient;
  private readonly config: NyvClientConfig;

  constructor(config: NyvClientConfig) {
    this.config = {
      defaultJurisdiction: 'IN',
      defaultPlatform: 'nys-professional',
      timeout: 30_000,
      debug: false,
      version: NyvClient.VERSION,
      ...config,
    };

    this.http = new FetchHttpClient(this.config);
    const orchestrateHttp = new FetchHttpClient(
      this.config,
      this.config.orchestrateTimeoutMs ?? 600_000,
    );
    const baseUrl = (config.baseUrl ?? 'https://api.jurexio.example').replace(/\/$/, '');

    this.patterns = new PatternsApi(this.http);
    this.documents = new DocumentsApi(this.http);
    this.agents = new AgentsApi(this.http);
    this.skills = new SkillsApi(this.http);
    this.twins = new TwinApi(this.http);
    this.knowledge = new KnowledgeApi(this.http);
    this.instantSearch = new InstantSearchApi(this.http);
    this.templates = new TemplatesApi(this.http);
    this.legalWork = new LegalWorkApi(this.http);
    this.matterVault = new MatterVaultApi(this.http);
    this.voice = new VoiceApi(this.http);
    this.intelligence = new IntelligenceApi(this.http);
    this.testing = new TestingApi(this.http);
    this.compliance = new ComplianceApi(this.http);
    this.nyayaTools = new NyayaToolsApi(this.http);
    this.memory = new MemoryApi(this.http);
    this.cache = new CacheApi(this.http);
    this.credits = new CreditsApi(this.http);
    this.orch = new OrchApi(this.http);
    this.workflows = new WorkflowsApi(this.http);
    this.docAi = new DocAiApi(this.http);
    this.gov = new GovApi(this.http);
    this.legalPipeline = new LegalPipelineApi(this.http);
    this.complianceNv5 = new ComplianceNv5Api(this.http);
    this.internal = new InternalApi(this.http);
    this.rag = new RagApi(this.http);
    this.models = new ModelsApi(this.http);
    this.mcp = new McpApi(this.http);
    this.cot = new CotApi(this.http);
    this.connectors = new ConnectorsApi(this.http);
    this.ecosystemDocuments = new EcosystemDocumentsApi(this.http);
    this.cnr = new CnrApi(this.http);
    this.patraMitra = new PatraMitraApi(this.http);
    this.usage = new UsageApi(this.http);
    this.orchestrateApi = new OrchestrateApi(orchestrateHttp, config.apiKey, baseUrl);
    this.queen = this.orchestrateApi;
    const defaultJurisdiction = () => this.config.defaultJurisdiction ?? 'IN';
    const runOrch = (req: OrchestrateRequest) =>
      this.orchestrateApi.run({ jurisdiction: defaultJurisdiction(), ...req });
    this.orchestrate = Object.assign(runOrch, {
      run: runOrch,
      stream: (
        req: OrchestrateRequest,
        handlers?: NyvStreamHandlers,
        options?: NyvStreamOptions,
      ) =>
        this.orchestrateApi.stream(
          { jurisdiction: defaultJurisdiction(), ...req },
          handlers,
          options,
        ),
    }) as OrchestrateFacade;
    this.gateway = new GatewayApi(this.http);
    this.partnerIntelligence = new PartnerIntelligenceApi(this.http);
    this.docsPipeline = new DocsPipelineApi(this.http);
    this.docparse = new DocparseApi(this.http);
    this.llmRouter = new LlmRouterApi(this.http);
    this.cam = new CamApi(this.http);
    this.swarm = new SwarmApi(this.http);
    this.legalSdk = new LegalSdkApi(this.http);
    this.stream = new NyvStreamReader(config.apiKey, baseUrl);

    if (this.config.debug) {
      console.log(`[NyvClient v${NyvClient.VERSION}] Initialized — baseUrl: ${baseUrl}, jurisdiction: ${this.config.defaultJurisdiction}`);
    }
  }

  async healthCheck(): Promise<{
    status: 'ok' | 'degraded' | 'down';
    version: string;
    jurisdiction: string;
    latencyMs: number;
  }> {
    const start = Date.now();
    const result = await this.http.get<{ status: 'ok' | 'degraded' | 'down'; version: string }>('/api/jrx/health');
    return {
      status: result.status,
      version: result.version,
      latencyMs: Date.now() - start,
      jurisdiction: this.config.defaultJurisdiction ?? 'IN',
    };
  }

  async ask(
    question: string,
    jurisdiction = this.config.defaultJurisdiction ?? 'IN'
  ) {
    return this.patterns.nyayaRag({ task: question, jurisdiction });
  }

  async analyzeDocument(
    fileBuffer: Buffer | Uint8Array,
    fileName: string
  ) {
    return this.documents.extractAndAnalyze(fileBuffer, fileName);
  }

  // ── NSP flat facade (@jurexio/nv-sdk-client compatibility) ───────────

  callAgent(agentKey: string, prompt: string, opts?: Partial<OrchestrateRequest>): Promise<OrchestrateResult> {
    return this.orchestrate({ prompt, agentKey, ...opts });
  }

  legalResearch(query: string, jurisdiction?: NyvJurisdiction): Promise<unknown> {
    return this.gateway.researchQuery({
      query,
      jurisdiction: jurisdiction ?? this.config.defaultJurisdiction ?? 'IN',
    });
  }

  mentorChat(prompt: string, opts?: Partial<OrchestrateRequest>): Promise<OrchestrateResult> {
    return this.orchestrate({
      prompt,
      agentKey: 'legal-mentor',
      taskType: 'mentor',
      ...opts,
    });
  }

  draftDocument(template: string, parameters?: Record<string, unknown>, jurisdiction?: NyvJurisdiction): Promise<unknown> {
    return this.gateway.draftDocument({
      template,
      parameters,
      jurisdiction: jurisdiction ?? this.config.defaultJurisdiction ?? 'IN',
    });
  }

  draftDocumentFromTemplate(templateKey: string, fields: Record<string, string>, jurisdiction?: NyvJurisdiction): Promise<unknown> {
    return this.nyayaTools.templateGenerate(templateKey, fields, jurisdiction ?? this.config.defaultJurisdiction ?? 'IN');
  }

  assessRisk(caseDescription: string, jurisdiction?: NyvJurisdiction): Promise<unknown> {
    return this.partnerIntelligence.caseRiskAnalysis({
      caseDescription,
      jurisdiction: jurisdiction ?? this.config.defaultJurisdiction ?? 'IN',
    });
  }

  verifyCitations(text: string, jurisdiction?: NyvJurisdiction): Promise<unknown> {
    return this.gateway.verifyCitations(
      text,
      jurisdiction ?? this.config.defaultJurisdiction ?? 'IN',
    );
  }

  checkHallucination(
    text: string,
    options?: { inputText?: string; agentKey?: string; jurisdiction?: NyvJurisdiction },
  ): Promise<unknown> {
    return this.gateway.checkHallucination(text, {
      ...options,
      jurisdiction: options?.jurisdiction ?? this.config.defaultJurisdiction ?? 'IN',
    });
  }

  findPrecedents(caseDescription: string, jurisdiction?: NyvJurisdiction, options?: { maxResults?: number }) {
    return this.intelligence.findPrecedents(
      caseDescription,
      jurisdiction ?? this.config.defaultJurisdiction ?? 'IN',
      options,
    );
  }

  evaluateWithJudge(response: string, query: string, jurisdiction?: NyvJurisdiction, domain?: NyvLegalDomain) {
    return this.testing.evaluateWithJudge(
      response,
      query,
      jurisdiction ?? this.config.defaultJurisdiction ?? 'IN',
      domain ?? 'other',
    );
  }

  getUsage(): Promise<unknown> {
    return this.gateway.getUsage();
  }

  complianceCheck(framework: string, content: string, jurisdiction?: NyvJurisdiction): Promise<OrchestrateResult> {
    return this.orchestrate({
      prompt: content,
      taskType: 'compliance-check',
      jurisdiction: jurisdiction ?? this.config.defaultJurisdiction ?? 'IN',
      preferences: { framework },
    });
  }

  processSharedDoc(body: Parameters<EcosystemDocumentsApi['processSharedDoc']>[0]): Promise<unknown> {
    return this.ecosystemDocuments.processSharedDoc(body);
  }

  processNspSharedDoc(body: Parameters<EcosystemDocumentsApi['processNspSharedDoc']>[0]): Promise<unknown> {
    return this.ecosystemDocuments.processNspSharedDoc(body);
  }

  caseAnalysis(body: Parameters<LegalSdkApi['caseAnalysis']>[0]): Promise<unknown> {
    return this.legalSdk.caseAnalysis({
      jurisdiction: this.config.defaultJurisdiction ?? 'IN',
      ...body,
    });
  }
}

export default NyvClient;
