import type { InputFile, RunOptions } from "../pipeline/run.js";
import type { ExtractionResult } from "../types.js";

export type DocparseJobStatus = "queued" | "running" | "done" | "failed" | "cancelled";

export interface DocparseJobSubmitRequest {
  files: InputFile[];
  run: Omit<RunOptions, "onPage">;
  domainPackId?: string;
  priority?: "low" | "normal" | "high";
}

export interface DocparseJobRecord {
  jobId: string;
  status: DocparseJobStatus;
  createdAt: string;
  updatedAt: string;
  progress?: { pageNo: number; pageTotal: number; documentId: string };
  error?: string;
  result?: ExtractionResult;
}

export interface DocparseJobEvents {
  onProgress?: (jobId: string, progress: DocparseJobRecord["progress"]) => void;
}
