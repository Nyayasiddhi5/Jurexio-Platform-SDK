/**
 * Patra Mitra BFF — NYS Knowledge dashboard.
 * Proxies to NYV /api/nv/v1/sdk/patra-mitra when NYV_API_BASE_URL + key are set;
 * otherwise uses local OCR extract + NYV model-call / Anthropic fallback.
 */
import { Router, type IRouter } from "express";
import { randomUUID } from "crypto";
import { extractDocumentText, UnsupportedFileError, OcrError } from "../lib/extractDocText";
import { callNyvModel, nyvModelCallConfigured } from "../lib/nyvModelAdapter";
import { logger } from "../lib/logger";

const router: IRouter = Router();

const SESSION_TTL_MS = 2 * 60 * 60 * 1000;

type Field = { key: string; label: string; value: string; confidence?: number };
type Turn = { role: "user" | "assistant"; content: string; at: string };

interface LocalSession {
  sessionId: string;
  fileName: string;
  mimeType?: string;
  jurisdiction: string;
  extractionMethod: string;
  format: string;
  warnings: string[];
  text: string;
  textPreview: string;
  characterCount: number;
  wordCount: number;
  fields: Field[];
  summary: string;
  keyPoints: string[];
  documentType?: string;
  detectedLanguage?: string;
  languageLabel?: string;
  chat: Turn[];
  toolRuns?: Array<{ tool: string; at: string; result: Record<string, unknown> }>;
  createdAt: string;
  updatedAt: string;
  expiresAt: number;
}

const localSessions = new Map<string, LocalSession>();

function prune() {
  const now = Date.now();
  for (const [k, v] of localSessions) if (v.expiresAt < now) localSessions.delete(k);
}

function nyvConfigured(): { base: string; key: string } | null {
  const base = (
    process.env.NYV_API_BASE_URL ||
    process.env.NYV_GATEWAY_URL ||
    ""
  )
    .trim()
    .replace(/\/$/, "");
  const key = (
    process.env.NYV_SDK_KEY ||
    process.env.NYV_MODEL_CALL_API_KEY ||
    process.env.NYV_SDK_KEY_NYS ||
    ""
  ).trim();
  if (!base || !key) return null;
  return { base, key };
}

async function nyvFetch(path: string, init: RequestInit & { key: string; base: string }) {
  const res = await fetch(`${init.base}${path}`, {
    ...init,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "X-API-Key": init.key,
      Authorization: `Bearer ${init.key}`,
      "X-NYV-Platform": "nys",
      "X-NYV-Consent": "granted",
      ...(init.headers || {}),
    },
    signal: AbortSignal.timeout(Number(process.env.NYV_PATRA_TIMEOUT_MS || "180000")),
  });
  const body = await res.json().catch(() => ({}));
  return { res, body };
}

function publicSession(s: LocalSession) {
  return {
    sessionId: s.sessionId,
    fileName: s.fileName,
    mimeType: s.mimeType,
    jurisdiction: s.jurisdiction,
    documentType: s.documentType,
    extractionMethod: s.extractionMethod,
    format: s.format,
    warnings: s.warnings,
    characterCount: s.characterCount,
    wordCount: s.wordCount,
    textPreview: s.textPreview,
    fields: s.fields,
    summary: s.summary,
    keyPoints: s.keyPoints,
    detectedLanguage: s.detectedLanguage,
    languageLabel: s.languageLabel,
    chat: s.chat,
    toolRuns: s.toolRuns || [],
    tools: TOOL_DEFS,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
    product: {
      name: "Patra Mitra",
      tagline: "Parse · Understand · Ask",
      code: "patra-mitra",
    },
  };
}

const TOOL_DEFS = [
  { id: "detect_language", label: "Detect language", description: "Script / language cues (EN + Indic)" },
  { id: "extract_parties", label: "Extract parties", description: "Names and party labels from the text" },
  { id: "extract_dates", label: "Extract dates", description: "All date-like mentions" },
  { id: "extract_amounts", label: "Extract amounts", description: "Currency and numeric considerations" },
  { id: "extract_citations", label: "Citations & CNR", description: "Sections, case numbers, CNR patterns" },
  { id: "find_clauses", label: "Find key clauses", description: "Termination, indemnity, confidentiality cues" },
  { id: "pii_scan", label: "PII scan", description: "Emails, phones, ID-like patterns (flag only)" },
  { id: "regenerate_summary", label: "Regenerate summary", description: "Counsel summary in chosen language" },
  { id: "export_fields", label: "Export fields", description: "JSON snapshot of structured fields" },
];

function detectDocumentLanguage(text: string): { code: string; label: string } {
  const sample = text.slice(0, 8000);
  const counts: Array<{ code: string; label: string; re: RegExp }> = [
    { code: "hi", label: "Hindi (Devanagari)", re: /[\u0900-\u097F]/g },
    { code: "bn", label: "Bengali", re: /[\u0980-\u09FF]/g },
    { code: "gu", label: "Gujarati", re: /[\u0A80-\u0AFF]/g },
    { code: "pa", label: "Punjabi (Gurmukhi)", re: /[\u0A00-\u0A7F]/g },
    { code: "or", label: "Odia", re: /[\u0B00-\u0B7F]/g },
    { code: "ta", label: "Tamil", re: /[\u0B80-\u0BFF]/g },
    { code: "te", label: "Telugu", re: /[\u0C00-\u0C7F]/g },
    { code: "kn", label: "Kannada", re: /[\u0C80-\u0CFF]/g },
    { code: "ml", label: "Malayalam", re: /[\u0D00-\u0D7F]/g },
  ];
  const scored = counts
    .map((c) => ({ code: c.code, label: c.label, n: (sample.match(c.re) || []).length }))
    .filter((c) => c.n > 20)
    .sort((a, b) => b.n - a.n);
  const latin = (sample.match(/[A-Za-z]/g) || []).length;
  if (!scored.length) return { code: "en", label: latin > 40 ? "English (Latin)" : "Unknown / mixed" };
  if (latin > scored[0].n * 2) return { code: "mixed", label: `Mixed · ${scored[0].label} + English` };
  if (scored.length > 1 && scored[1].n > scored[0].n * 0.4) {
    return { code: "mixed", label: `Mixed · ${scored[0].label} + ${scored[1].label}` };
  }
  return { code: scored[0].code, label: scored[0].label };
}

function runLocalTool(s: LocalSession, tool: string, answerLanguage?: string): Record<string, unknown> {
  const text = s.text;
  switch (tool) {
    case "detect_language": {
      const lang = detectDocumentLanguage(text);
      s.detectedLanguage = lang.code;
      s.languageLabel = lang.label;
      return lang;
    }
    case "extract_parties": {
      const between = text.match(/\bbetween\s+([^.\n]{3,120}?)\s+and\s+([^.\n]{3,120})/i);
      return {
        parties: between
          ? [
              { label: "Party A", value: between[1].trim() },
              { label: "Party B", value: between[2].trim() },
            ]
          : [],
        fromFields: s.fields.filter((f) => /party|petitioner|respondent|plaintiff|defendant/i.test(f.key + f.label)),
      };
    }
    case "extract_dates": {
      const dates =
        text.match(
          /\b(?:\d{1,2}[\/\-.](?:\d{1,2}|[A-Za-z]{3,9})[\/\-.]\d{2,4}|\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{2,4}|\d{4}-\d{2}-\d{2})\b/gi,
        ) || [];
      return { dates: [...new Set(dates)].slice(0, 40) };
    }
    case "extract_amounts": {
      const amounts =
        text.match(/(?:₹|Rs\.?|INR|USD|EUR|\$)\s?[\d,]+(?:\.\d+)?|\b\d{1,3}(?:,\d{2,3})+(?:\.\d+)?\s*(?:rupees|only)\b/gi) || [];
      return { amounts: [...new Set(amounts)].slice(0, 40) };
    }
    case "extract_citations": {
      const sections = text.match(/\b(?:Section|Sec\.?|§|Article|Art\.?)\s*\d+[A-Za-z]?\b/gi) || [];
      const cnr = text.match(/\b[A-Z]{4}\d{2}[A-Z]{0,2}\d{4}\d{6,7}\b/g) || [];
      return { sections: [...new Set(sections)].slice(0, 30), cnr: [...new Set(cnr)].slice(0, 10) };
    }
    case "find_clauses": {
      const keys = ["termination", "indemnity", "confidential", "arbitration", "jurisdiction", "force majeure", "liability"];
      return {
        clauses: keys
          .map((k) => {
            const idx = text.toLowerCase().indexOf(k);
            if (idx < 0) return null;
            return { clause: k, snippet: text.slice(Math.max(0, idx - 40), Math.min(text.length, idx + 180)).replace(/\s+/g, " ").trim() };
          })
          .filter(Boolean),
      };
    }
    case "pii_scan": {
      const emails = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || [];
      const phones = text.match(/(?:\+91[\s-]?)?[6-9]\d{9}\b/g) || [];
      return {
        emails: [...new Set(emails)].slice(0, 20),
        phones: [...new Set(phones)].slice(0, 20),
        note: "Flags only — review before sharing.",
      };
    }
    case "regenerate_summary": {
      const words = text.trim().split(/\s+/).filter(Boolean);
      s.summary =
        (answerLanguage && answerLanguage !== "en"
          ? `_Summary refreshed (target language: ${answerLanguage})._\n\n`
          : "") +
        words.slice(0, 200).join(" ") +
        (words.length > 200 ? "…" : "");
      s.keyPoints = words.filter((w) => w.length > 5).slice(0, 6);
      return { summary: s.summary, keyPoints: s.keyPoints, answerLanguage: answerLanguage || "en" };
    }
    case "export_fields":
      return { fields: s.fields, exportedAt: new Date().toISOString() };
    default:
      throw new Error(`Unknown tool: ${tool}`);
  }
}

function heuristicFields(text: string, fileName: string): Field[] {
  const fields: Field[] = [{ key: "fileName", label: "File name", value: fileName, confidence: 1 }];
  const email = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  if (email) fields.push({ key: "email", label: "Email", value: email[0], confidence: 0.7 });
  const dates = text.match(
    /\b(?:\d{1,2}[\/\-.](?:\d{1,2}|[A-Za-z]{3,9})[\/\-.]\d{2,4}|\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{2,4})\b/gi,
  );
  if (dates?.length) {
    fields.push({
      key: "dates",
      label: "Dates mentioned",
      value: [...new Set(dates)].slice(0, 8).join("; "),
      confidence: 0.55,
    });
  }
  return fields;
}

async function localIntel(text: string, jurisdiction: string, fileName: string) {
  const slice = text.slice(0, 12000);
  if (nyvModelCallConfigured()) {
    const out = await callNyvModel({
      jurisdiction,
      taskType: "document_intelligence",
      maxTokens: 4096,
      messages: [
        {
          role: "system",
          content: `You are Patra Mitra document analyst. Return ONLY JSON: {"documentType":"","summary":"markdown","keyPoints":[],"fields":[{"key":"","label":"","value":"","confidence":0.8}]}`,
        },
        {
          role: "user",
          content: `Analyse this ${jurisdiction} document "${fileName}":\n\n${slice}`,
        },
      ],
    });
    if (out?.content) {
      try {
        const m = out.content.match(/\{[\s\S]*\}/);
        if (m) {
          const parsed = JSON.parse(m[0]);
          return {
            documentType: parsed.documentType ? String(parsed.documentType) : undefined,
            summary: String(parsed.summary || out.content),
            keyPoints: Array.isArray(parsed.keyPoints)
              ? parsed.keyPoints.map(String).slice(0, 10)
              : [],
            fields: Array.isArray(parsed.fields)
              ? parsed.fields
                  .filter((f: any) => f?.value)
                  .map((f: any) => ({
                    key: String(f.key || f.label || "field"),
                    label: String(f.label || f.key || "Field"),
                    value: String(f.value),
                    confidence: typeof f.confidence === "number" ? f.confidence : 0.75,
                  }))
              : heuristicFields(text, fileName),
          };
        }
      } catch {
        /* fall through */
      }
      return {
        summary: out.content,
        keyPoints: [],
        fields: heuristicFields(text, fileName),
      };
    }
  }
  const words = text.trim().split(/\s+/).filter(Boolean);
  return {
    summary: words.slice(0, 180).join(" ") + (words.length > 180 ? "…" : ""),
    keyPoints: words.filter((w) => w.length > 5).slice(0, 5),
    fields: heuristicFields(text, fileName),
  };
}

router.get("/patra-mitra/health", async (_req, res) => {
  const nyv = nyvConfigured();
  if (nyv) {
    try {
      const { res: r, body } = await nyvFetch("/api/nv/v1/sdk/patra-mitra/health", {
        method: "GET",
        base: nyv.base,
        key: nyv.key,
      });
      if (r.ok) return void res.json(body);
    } catch (e: any) {
      logger.warn({ err: e?.message }, "NYV Patra Mitra health failed");
    }
  }
  res.json({
    success: true,
    data: {
      product: "Patra Mitra",
      code: "patra-mitra",
      tagline: "Parse · Understand · Ask",
      status: "ready",
      mode: nyv ? "nyv-proxy" : "local-ocr",
      capabilities: ["parse", "ocr", "fields", "summary", "document_chat", "session_history", "parse_tools", "multilingual"],
      tools: TOOL_DEFS.map((t) => t.id),
      languages: ["en", "hi", "bn", "ta", "te", "kn", "ml", "gu", "pa", "or", "mixed"],
    },
  });
});

router.get("/patra-mitra/sessions", async (_req, res) => {
  const nyv = nyvConfigured();
  if (nyv) {
    try {
      const { res: r, body } = await nyvFetch("/api/nv/v1/sdk/patra-mitra/sessions", {
        method: "GET",
        base: nyv.base,
        key: nyv.key,
      });
      if (r.ok) {
        prune();
        const local = [...localSessions.values()].map((s) => ({
          sessionId: s.sessionId,
          fileName: s.fileName,
          documentType: s.documentType,
          wordCount: s.wordCount,
          detectedLanguage: s.detectedLanguage,
          languageLabel: s.languageLabel,
          createdAt: s.createdAt,
          updatedAt: s.updatedAt,
          fieldCount: s.fields.length,
          chatTurns: s.chat.length,
        }));
        const remote = Array.isArray(body?.data?.sessions) ? body.data.sessions : [];
        const byId = new Map<string, any>();
        for (const s of [...remote, ...local]) byId.set(s.sessionId, s);
        return void res.json({
          success: true,
          data: {
            sessions: [...byId.values()].sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt))),
          },
        });
      }
    } catch (e: any) {
      logger.warn({ err: e?.message }, "NYV Patra Mitra list failed");
    }
  }
  prune();
  res.json({
    success: true,
    data: {
      sessions: [...localSessions.values()]
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        .map((s) => ({
          sessionId: s.sessionId,
          fileName: s.fileName,
          documentType: s.documentType,
          wordCount: s.wordCount,
          detectedLanguage: s.detectedLanguage,
          languageLabel: s.languageLabel,
          createdAt: s.createdAt,
          updatedAt: s.updatedAt,
          fieldCount: s.fields.length,
          chatTurns: s.chat.length,
        })),
    },
  });
});

router.post("/patra-mitra/sessions", async (req, res) => {
  prune();
  const { base64, content, fileName, mimeType, jurisdiction } = req.body || {};
  if (!base64 && !content) {
    return void res.status(400).json({ success: false, error: "Provide base64 or content" });
  }

  const nyv = nyvConfigured();
  if (nyv) {
    try {
      const { res: r, body } = await nyvFetch("/api/nv/v1/sdk/patra-mitra/sessions", {
        method: "POST",
        base: nyv.base,
        key: nyv.key,
        body: JSON.stringify({
          ...(base64 ? { base64 } : {}),
          ...(content && !base64 ? { content } : {}),
          fileName,
          mimeType,
          jurisdiction: jurisdiction || "IN",
        }),
      });
      if (r.ok) return void res.status(r.status).json(body);
      logger.warn({ status: r.status, err: body?.error }, "NYV Patra Mitra session failed — local fallback");
    } catch (e: any) {
      logger.warn({ err: e?.message }, "NYV Patra Mitra unreachable — local fallback");
    }
  }

  try {
    let text = "";
    let extractionMethod = "text";
    let format = "txt";
    let warnings: string[] = [];
    const name = String(fileName || "document.txt");

    if (base64) {
      const buf = Buffer.from(String(base64).replace(/^data:[^;]+;base64,/, ""), "base64");
      const extracted = await extractDocumentText(name, buf);
      text = extracted.text;
      extractionMethod = extracted.ocrUsed ? "ocr" : "text";
      format = extracted.mimeType || "application/octet-stream";
      if (extracted.ocrUsed) warnings.push("OCR used for scanned/image content");
    } else {
      text = String(content);
    }

    if (!text.trim()) {
      return void res.status(422).json({ success: false, error: "No text could be extracted from this document" });
    }

    const j = String(jurisdiction || "IN").toUpperCase();
    const intel = await localIntel(text, j, name);
    const lang = detectDocumentLanguage(text);
    const now = Date.now();
    const session: LocalSession = {
      sessionId: `pm_local_${randomUUID().slice(0, 12)}`,
      fileName: name,
      mimeType,
      jurisdiction: j,
      extractionMethod,
      format,
      warnings,
      text: text.slice(0, 120_000),
      textPreview: text.slice(0, 1200),
      characterCount: text.length,
      wordCount: text.split(/\s+/).filter(Boolean).length,
      fields: intel.fields,
      summary: intel.summary,
      keyPoints: intel.keyPoints || [],
      documentType: intel.documentType,
      detectedLanguage: lang.code,
      languageLabel: lang.label,
      chat: [],
      toolRuns: [],
      createdAt: new Date(now).toISOString(),
      updatedAt: new Date(now).toISOString(),
      expiresAt: now + SESSION_TTL_MS,
    };
    localSessions.set(session.sessionId, session);
    res.status(201).json({ success: true, data: publicSession(session) });
  } catch (err: any) {
    if (err instanceof UnsupportedFileError) {
      return void res.status(415).json({ success: false, error: err.message });
    }
    if (err instanceof OcrError) {
      return void res.status(422).json({ success: false, error: err.message });
    }
    logger.error({ err: err?.message }, "Patra Mitra local session failed");
    res.status(500).json({ success: false, error: "Failed to parse document" });
  }
});

router.get("/patra-mitra/sessions/:sessionId", async (req, res) => {
  const id = String(req.params.sessionId);
  const nyv = nyvConfigured();
  if (nyv && !id.startsWith("pm_local_")) {
    try {
      const { res: r, body } = await nyvFetch(`/api/nv/v1/sdk/patra-mitra/sessions/${encodeURIComponent(id)}`, {
        method: "GET",
        base: nyv.base,
        key: nyv.key,
      });
      if (r.ok) return void res.json(body);
      if (r.status === 404) return void res.status(404).json(body);
    } catch {
      /* fall through */
    }
  }
  prune();
  const s = localSessions.get(id);
  if (!s) return void res.status(404).json({ success: false, error: "Session not found or expired" });
  res.json({ success: true, data: publicSession(s) });
});

router.post("/patra-mitra/sessions/:sessionId/chat", async (req, res) => {
  const id = String(req.params.sessionId);
  const message = String(req.body?.message || req.body?.question || "").trim();
  if (!message) return void res.status(400).json({ success: false, error: "message is required" });

  const nyv = nyvConfigured();
  if (nyv && !id.startsWith("pm_local_")) {
    try {
      const { res: r, body } = await nyvFetch(
        `/api/nv/v1/sdk/patra-mitra/sessions/${encodeURIComponent(id)}/chat`,
        {
          method: "POST",
          base: nyv.base,
          key: nyv.key,
          body: JSON.stringify({ message, jurisdiction: req.body?.jurisdiction, answerLanguage: req.body?.answerLanguage || req.body?.language }),
        },
      );
      if (r.ok) return void res.json(body);
      if (r.status === 404) return void res.status(404).json(body);
      logger.warn({ status: r.status }, "NYV Patra Mitra chat failed — try local if available");
    } catch (e: any) {
      logger.warn({ err: e?.message }, "NYV Patra Mitra chat unreachable");
    }
  }

  prune();
  const s = localSessions.get(id);
  if (!s) return void res.status(404).json({ success: false, error: "Session not found or expired" });

  let answer = "";
  if (nyvModelCallConfigured()) {
    const history = s.chat
      .slice(-10)
      .map((t) => `${t.role === "user" ? "User" : "Counsel"}: ${t.content}`)
      .join("\n");
    const out = await callNyvModel({
      jurisdiction: s.jurisdiction,
      taskType: "document_qa",
      maxTokens: 3072,
      messages: [
        {
          role: "system",
          content:
            "You are Patra Mitra. Answer only from the DOCUMENT. Use clear markdown. If unknown, say so.",
        },
        {
          role: "user",
          content: `DOCUMENT:\n${s.text.slice(0, 18000)}\n\nHISTORY:\n${history || "(none)"}\n\nQUESTION:\n${message}`,
        },
      ],
    });
    answer = out?.content || "";
  }
  if (!answer) {
    // Deterministic grounded snippet fallback
    const q = message.toLowerCase().split(/\s+/).filter((w) => w.length > 3);
    const paras = s.text.split(/\n{2,}/);
    const hit =
      paras.find((p) => q.some((w) => p.toLowerCase().includes(w))) ||
      s.text.slice(0, 800);
    answer = `Based on the uploaded document (**${s.fileName}**):\n\n${hit.trim()}\n\n_Configure NYV_API_BASE_URL + NYV_SDK_KEY (or NYV_MODEL_CALL_URL) for full counsel-grade answers._`;
  }

  const at = new Date().toISOString();
  s.chat.push({ role: "user", content: message, at });
  s.chat.push({ role: "assistant", content: answer, at });
  s.updatedAt = at;
  s.expiresAt = Date.now() + SESSION_TTL_MS;
  localSessions.set(id, s);

  res.json({
    success: true,
    data: { answer, session: publicSession(s) },
  });
});

router.post("/patra-mitra/sessions/:sessionId/tools", async (req, res) => {
  const id = String(req.params.sessionId);
  const tool = String(req.body?.tool || req.body?.toolId || "").trim();
  if (!tool) return void res.status(400).json({ success: false, error: "tool is required" });

  const nyv = nyvConfigured();
  if (nyv && !id.startsWith("pm_local_")) {
    try {
      const { res: r, body } = await nyvFetch(
        `/api/nv/v1/sdk/patra-mitra/sessions/${encodeURIComponent(id)}/tools`,
        {
          method: "POST",
          base: nyv.base,
          key: nyv.key,
          body: JSON.stringify({
            tool,
            answerLanguage: req.body?.answerLanguage || req.body?.language,
          }),
        },
      );
      if (r.ok) return void res.json(body);
      if (r.status === 404) return void res.status(404).json(body);
    } catch (e: any) {
      logger.warn({ err: e?.message }, "NYV Patra Mitra tool unreachable");
    }
  }

  prune();
  const s = localSessions.get(id);
  if (!s) return void res.status(404).json({ success: false, error: "Session not found or expired" });
  try {
    if (tool === "regenerate_summary" && nyvModelCallConfigured()) {
      const intel = await localIntel(s.text, s.jurisdiction, s.fileName);
      s.summary = intel.summary;
      s.keyPoints = intel.keyPoints || [];
      if (intel.documentType) s.documentType = intel.documentType;
      if (intel.fields?.length) s.fields = intel.fields;
      const result = { summary: s.summary, keyPoints: s.keyPoints };
      const at = new Date().toISOString();
      s.toolRuns = [...(s.toolRuns || []), { tool, at, result }].slice(-30);
      s.updatedAt = at;
      s.expiresAt = Date.now() + SESSION_TTL_MS;
      localSessions.set(id, s);
      return void res.json({ success: true, data: { tool, result, session: publicSession(s) } });
    }
    const result = runLocalTool(s, tool, req.body?.answerLanguage || req.body?.language);
    const at = new Date().toISOString();
    s.toolRuns = [...(s.toolRuns || []), { tool, at, result }].slice(-30);
    s.updatedAt = at;
    s.expiresAt = Date.now() + SESSION_TTL_MS;
    localSessions.set(id, s);
    res.json({ success: true, data: { tool, result, session: publicSession(s) } });
  } catch (err: any) {
    res.status(/Unknown tool/i.test(err?.message) ? 400 : 422).json({ success: false, error: err?.message || "Tool failed" });
  }
});

export default router;
