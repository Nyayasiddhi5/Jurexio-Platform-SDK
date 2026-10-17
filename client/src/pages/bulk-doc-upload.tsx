/**
 * Bulk Document Upload — gap #7
 * (Session-15 v4 / 2026-05-11)
 *
 * Backend: src/routes/nv5/doc-ai/convert-routes.ts
 *   POST /api/nv5/doc-ai/jobs       — submit one file (multipart)
 *   GET  /api/nv5/doc-ai/jobs/:id   — poll status
 *   GET  /api/nv5/doc-ai/jobs/:id/result — download converted bytes
 * The backend is path-based (disk-stream), bounded-concurrency, and 1-GB-safe
 * (NYV-DOC-AI-OUTPUT-DISK-2026-05-11). This UI uploads each file as a
 * separate /jobs request, then polls and offers per-file download.
 *
 * NV-AUTH-HEADER-001: SDK key sent as `X-API-Key`.
 * NV-SDK-UNIFIED-001: same NYV API for all platforms; no per-platform branching.
 * Locked into NV-NEVER-BREAK-001.
 */
import { useEffect, useRef, useState } from "react";

type JobState = "queued" | "uploading" | "running" | "done" | "error";
type Row = {
  id: string;
  file: File;
  jobId?: string;
  state: JobState;
  progress?: number;
  errorMsg?: string;
  resultUrl?: string;
  bytesOut?: number;
};

const TARGET_FORMATS: { value: string; label: string }[] = [
  { value: "txt", label: "Plain text (.txt)" },
  { value: "md", label: "Markdown (.md)" },
  { value: "html", label: "HTML (.html)" },
  { value: "json", label: "JSON (.json)" },
  { value: "pdf", label: "PDF (.pdf)" },
  { value: "docx", label: "Word (.docx)" },
];

function inferSourceFormat(name: string): string {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  if (["pdf", "docx", "doc", "txt", "md", "html", "htm", "csv", "xlsx", "xls", "rtf", "json"].includes(ext)) return ext === "htm" ? "html" : ext === "doc" ? "docx" : ext === "xls" ? "xlsx" : ext;
  return ext;
}

export default function BulkDocUploadPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [target, setTarget] = useState("txt");
  const [apiKey, setApiKey] = useState<string>(() => localStorage.getItem("nyv_sdk_key") ?? "");
  const [running, setRunning] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const dropRef = useRef<HTMLDivElement | null>(null);
  const [dragOver, setDragOver] = useState(false);

  useEffect(() => {
    if (apiKey) localStorage.setItem("nyv_sdk_key", apiKey);
  }, [apiKey]);

  const addFiles = (list: FileList | File[]) => {
    const next: Row[] = Array.from(list).map((file) => ({
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      file,
      state: "queued" as JobState,
    }));
    setRows((prev) => [...prev, ...next]);
  };

  const removeRow = (id: string) =>
    setRows((prev) => prev.filter((r) => r.id !== id));

  const updateRow = (id: string, patch: Partial<Row>) =>
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));

  async function uploadOne(row: Row) {
    const sourceFormat = inferSourceFormat(row.file.name);
    if (!sourceFormat) {
      updateRow(row.id, { state: "error", errorMsg: "unknown file extension" });
      return;
    }
    const fd = new FormData();
    fd.append("file", row.file);
    fd.append("sourceFormat", sourceFormat);
    fd.append("targetFormat", target);
    updateRow(row.id, { state: "uploading", progress: 0 });

    let jobId: string;
    try {
      const resp = await fetch("/api/nv5/doc-ai/jobs", {
        method: "POST",
        headers: apiKey ? { "X-API-Key": apiKey } : {},
        body: fd,
      });
      const json = await resp.json();
      if (!resp.ok || !json?.jobId) {
        updateRow(row.id, { state: "error", errorMsg: json?.error ?? `HTTP ${resp.status}` });
        return;
      }
      jobId = json.jobId;
      updateRow(row.id, { jobId, state: "running" });
    } catch (e: any) {
      updateRow(row.id, { state: "error", errorMsg: e?.message ?? String(e) });
      return;
    }

    // poll
    for (let i = 0; i < 120; i++) {
      await new Promise((r) => setTimeout(r, 1500));
      try {
        const resp = await fetch(`/api/nv5/doc-ai/jobs/${jobId}`, {
          headers: apiKey ? { "X-API-Key": apiKey } : {},
        });
        const json = await resp.json();
        if (json?.status === "done") {
          updateRow(row.id, {
            state: "done",
            progress: 100,
            resultUrl: `/api/nv5/doc-ai/jobs/${jobId}/result`,
            bytesOut: json?.bytesOut,
          });
          return;
        }
        if (json?.status === "error") {
          updateRow(row.id, { state: "error", errorMsg: json?.error ?? "conversion failed" });
          return;
        }
        updateRow(row.id, { progress: Math.min(95, (i + 1) * 5) });
      } catch (e: any) {
        updateRow(row.id, { state: "error", errorMsg: e?.message ?? String(e) });
        return;
      }
    }
    updateRow(row.id, { state: "error", errorMsg: "timed out polling job status" });
  }

  async function uploadAll() {
    if (running) return;
    if (!apiKey) {
      alert("Please set your X-API-Key first.");
      return;
    }
    setRunning(true);
    try {
      // 4-at-a-time mirrors JRX_DOC_CONVERT_CONCURRENCY default
      const queue = rows.filter((r) => r.state === "queued" || r.state === "error");
      const workers = 4;
      let i = 0;
      const next = async () => {
        while (i < queue.length) {
          const my = queue[i++];
          await uploadOne(my);
        }
      };
      await Promise.all(Array.from({ length: workers }, () => next()));
    } finally {
      setRunning(false);
    }
  }

  function downloadResult(row: Row) {
    if (!row.resultUrl) return;
    // Server requires X-API-Key; build a fetch then trigger download via blob URL.
    fetch(row.resultUrl, { headers: apiKey ? { "X-API-Key": apiKey } : {} })
      .then((r) => r.blob())
      .then((blob) => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        const base = row.file.name.replace(/\.[^.]+$/, "");
        a.download = `${base}.${target}`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      });
  }

  const totalBytes = rows.reduce((s, r) => s + r.file.size, 0);

  return (
    <div className="min-h-screen bg-slate-950 text-white p-6">
      <div className="max-w-5xl mx-auto">
        <div className="mb-6">
          <h1 className="text-3xl font-bold mb-2">Bulk Document Conversion</h1>
          <p className="text-slate-600">
            Upload many documents and convert them in parallel. Backend is path-based and 1-GB-safe; concurrency is bounded server-side at 4 jobs by default.
          </p>
        </div>

        <div className="bg-slate-900 rounded-xl border border-slate-800 p-5 mb-6">
          <label className="block text-xs font-medium text-slate-600 mb-2">SDK API key (X-API-Key)</label>
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="nyv_sk_…"
            className="w-full bg-slate-800 border border-slate-700 rounded-md px-3 py-2 text-sm font-mono"
            data-testid="input-api-key"
          />
          <p className="text-xs text-slate-700 mt-1">Stored locally in your browser. Use any NSP/NSPM/NYM key — same NYV unified API.</p>
        </div>

        <div className="bg-slate-900 rounded-xl border border-slate-800 p-5 mb-6">
          <div className="flex flex-wrap items-center gap-3 mb-4">
            <label className="text-xs font-medium text-slate-600">Convert all to:</label>
            <select
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              className="bg-slate-800 border border-slate-700 rounded-md px-3 py-2 text-sm"
              data-testid="select-target-format"
            >
              {TARGET_FORMATS.map((f) => (
                <option key={f.value} value={f.value}>{f.label}</option>
              ))}
            </select>
          </div>

          <div
            ref={dropRef}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              if (e.dataTransfer.files?.length) addFiles(e.dataTransfer.files);
            }}
            className={`border-2 border-dashed rounded-xl p-10 text-center transition-colors cursor-pointer ${
              dragOver ? "border-blue-400 bg-blue-900/20" : "border-slate-700 hover:border-slate-500"
            }`}
            onClick={() => inputRef.current?.click()}
            data-testid="dropzone"
          >
            <p className="text-slate-300 mb-1">Drop files here, or click to choose</p>
            <p className="text-xs text-slate-700">PDF, DOCX, TXT, MD, HTML, CSV, XLSX, RTF, JSON</p>
            <input
              ref={inputRef}
              type="file"
              multiple
              hidden
              onChange={(e) => e.target.files && addFiles(e.target.files)}
            />
          </div>
        </div>

        {rows.length > 0 && (
          <div className="bg-slate-900 rounded-xl border border-slate-800 p-5 mb-6">
            <div className="flex items-center justify-between mb-4">
              <p className="text-sm text-slate-300">
                {rows.length} file(s) · {(totalBytes / 1024 / 1024).toFixed(2)} MB total
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => setRows([])}
                  disabled={running}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 rounded-md text-sm disabled:opacity-50"
                >
                  Clear
                </button>
                <button
                  onClick={uploadAll}
                  disabled={running || rows.length === 0}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded-md text-sm font-medium disabled:opacity-50"
                  data-testid="button-upload-all"
                >
                  {running ? "Converting…" : `Convert ${rows.filter(r => r.state === "queued" || r.state === "error").length}`}
                </button>
              </div>
            </div>

            <div className="space-y-2">
              {rows.map((r) => (
                <div key={r.id} className="bg-slate-800 rounded-lg p-3 flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm truncate">{r.file.name}</p>
                    <p className="text-xs text-slate-700">{(r.file.size / 1024).toFixed(1)} KB · {inferSourceFormat(r.file.name)} → {target}</p>
                    {r.state === "running" && (
                      <div className="w-full bg-slate-700 h-1 rounded mt-2">
                        <div className="bg-blue-500 h-1 rounded" style={{ width: `${r.progress ?? 0}%` }} />
                      </div>
                    )}
                    {r.errorMsg && <p className="text-xs text-red-400 mt-1">{r.errorMsg}</p>}
                  </div>
                  <div className="text-xs">
                    {r.state === "queued" && <span className="text-slate-700">queued</span>}
                    {r.state === "uploading" && <span className="text-blue-400">uploading…</span>}
                    {r.state === "running" && <span className="text-amber-400">converting…</span>}
                    {r.state === "done" && <span className="text-green-400">done</span>}
                    {r.state === "error" && <span className="text-red-400">error</span>}
                  </div>
                  {r.state === "done" && r.resultUrl && (
                    <button
                      onClick={() => downloadResult(r)}
                      className="px-3 py-1 bg-green-700 hover:bg-green-600 rounded text-xs"
                      data-testid={`button-download-${r.id}`}
                    >
                      Download
                    </button>
                  )}
                  {!running && (
                    <button
                      onClick={() => removeRow(r.id)}
                      className="text-slate-700 hover:text-slate-300 text-lg leading-none px-1"
                    >
                      ×
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
