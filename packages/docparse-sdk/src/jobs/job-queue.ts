/**
 * In-memory job queue — dev/single-node; production worker uses same contract over HTTP.
 */
import crypto from "node:crypto";
import type { DocparseJobRecord, DocparseJobSubmitRequest, DocparseJobEvents } from "./types.js";
import { run } from "../pipeline/run.js";

export class InMemoryDocparseJobQueue {
  private readonly jobs = new Map<string, DocparseJobRecord>();

  submit(req: DocparseJobSubmitRequest, events?: DocparseJobEvents): string {
    const jobId = crypto.randomUUID();
    const now = new Date().toISOString();
    const record: DocparseJobRecord = {
      jobId,
      status: "queued",
      createdAt: now,
      updatedAt: now,
    };
    this.jobs.set(jobId, record);

    queueMicrotask(() => {
      void this.execute(jobId, req, events);
    });

    return jobId;
  }

  get(jobId: string): DocparseJobRecord | undefined {
    return this.jobs.get(jobId);
  }

  private async execute(
    jobId: string,
    req: DocparseJobSubmitRequest,
    events?: DocparseJobEvents,
  ): Promise<void> {
    const rec = this.jobs.get(jobId);
    if (!rec) return;
    rec.status = "running";
    rec.updatedAt = new Date().toISOString();

    try {
      const result = await run(req.files, {
        ...req.run,
        onPage: (detail) => {
          rec.progress = {
            pageNo: detail.pageNo,
            pageTotal: detail.pageTotal,
            documentId: detail.documentId,
          };
          rec.updatedAt = new Date().toISOString();
          events?.onProgress?.(jobId, rec.progress);
        },
      });
      rec.status = "done";
      rec.result = result;
      rec.updatedAt = new Date().toISOString();
    } catch (e) {
      rec.status = "failed";
      rec.error = e instanceof Error ? e.message : String(e);
      rec.updatedAt = new Date().toISOString();
    }
  }
}
