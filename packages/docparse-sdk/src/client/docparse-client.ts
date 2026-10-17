/**
 * DocParseClient — embeddable SDK entry (sync run + async jobs + contracts).
 */
import { run, type InputFile, type RunOptions } from "../pipeline/run.js";
import { runComplete, type CompleteRunOptions, type CompleteRunResult } from "../pipeline/complete-run.js";
import type { ExtractionResult } from "../types.js";
import type { DomainPack } from "../domain/domain-pack.js";
import { LEGAL_IN_PACK, loadDomainPack } from "../domain/domain-pack.js";
import { type DocparseResultV1 } from "../contracts/docparse-result-v1.js";
import { buildDocparseResultBundle } from "../contracts/docparse-result-bundle.js";
import { type LegalParseGuide } from "../contracts/legal-parse-guide.js";
import { InMemoryDocparseJobQueue } from "../jobs/job-queue.js";
import type { DocparseJobSubmitRequest } from "../jobs/types.js";
import {
  applyAssistPass,
  NOOP_ASSIST_PROVIDER,
  type AssistPassProvider,
} from "../assist/assist-pass.js";

export const DOCPARSE_SDK_VERSION = "1.0.0-alpha.6";

export interface DocParseClientOptions {
  domainPack?: DomainPack;
  assistProvider?: AssistPassProvider;
  jobQueue?: InMemoryDocparseJobQueue;
}

export class DocParseClient {
  private readonly pack: DomainPack;
  private readonly assist: AssistPassProvider;
  private readonly jobs: InMemoryDocparseJobQueue;

  constructor(opts: DocParseClientOptions = {}) {
    this.pack = opts.domainPack ?? LEGAL_IN_PACK;
    this.assist = opts.assistProvider ?? NOOP_ASSIST_PROVIDER;
    this.jobs = opts.jobQueue ?? new InMemoryDocparseJobQueue();
  }

  get domainPackId(): string {
    return this.pack.id;
  }

  async run(files: InputFile[], opts: RunOptions): Promise<ExtractionResult> {
    const config = { ...this.pack.configOverrides, ...opts.config };
    const result = await run(files, { ...opts, config });
    await applyAssistPass(result, this.assist);
    return result;
  }

  /** Legal-complete path: extractive intelligence + optional partial LLM on snippets only. */
  async runComplete(files: InputFile[], opts: CompleteRunOptions): Promise<CompleteRunResult> {
    const config = { ...this.pack.configOverrides, ...opts.config };
    return runComplete(files, { ...opts, config, domainPackId: opts.domainPackId ?? this.pack.id });
  }

  submitJob(req: DocparseJobSubmitRequest) {
    const packId = req.domainPackId ?? this.pack.id;
    loadDomainPack(packId);
    return this.jobs.submit(req);
  }

  getJob(jobId: string) {
    return this.jobs.get(jobId);
  }

  toResultV1(result: ExtractionResult): DocparseResultV1 {
    return buildDocparseResultBundle(result, {
      domainPackId: this.pack.id,
      engineVersion: DOCPARSE_SDK_VERSION,
    }).resultV1;
  }

  buildLegalParseGuide(result: ExtractionResult): LegalParseGuide {
    return buildDocparseResultBundle(result, {
      domainPackId: this.pack.id,
      engineVersion: DOCPARSE_SDK_VERSION,
    }).legalParseGuide;
  }

  toResultBundle(result: ExtractionResult) {
    return buildDocparseResultBundle(result, {
      domainPackId: this.pack.id,
      engineVersion: DOCPARSE_SDK_VERSION,
    });
  }
}
