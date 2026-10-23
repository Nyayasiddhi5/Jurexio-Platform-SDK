export interface SseHandlers {
  onStatus?: (stage: string) => void;
  onDelta?: (text: string) => void;
}

export class SseError extends Error {}

/** Thrown when the caller aborts the stream via an AbortSignal. */
export class SseCancelledError extends Error {
  constructor(message = "The stream was cancelled.") {
    super(message);
    this.name = "SseCancelledError";
  }
}

/**
 * POST to an SSE endpoint and consume the event stream.
 * Protocol (see api-server src/lib/sse.ts):
 *   event: status — data: {"stage": "..."}
 *   event: delta  — data: {"text": "..."}
 *   event: done   — data: <final JSON payload>
 *   event: error  — data: {"error": "..."}
 * Resolves with the `done` payload; rejects on `error` events,
 * HTTP errors, or a stream that ends without a `done` event.
 */
export async function postSse<T>(
  url: string,
  body: unknown,
  handlers: SseHandlers = {},
  signal?: AbortSignal,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
      credentials: "include",
      body: JSON.stringify(body),
      signal,
    });
  } catch (err) {
    if (signal?.aborted) throw new SseCancelledError();
    throw err;
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("text/event-stream")) {
    // Non-stream response: validation error or auth failure before the
    // stream opened. Surface the JSON error message when available.
    let message = `Request failed (${response.status})`;
    try {
      const data = (await response.json()) as { error?: string };
      if (data?.error) message = data.error;
    } catch {
      // keep default message
    }
    throw new SseError(message);
  }

  if (!response.body) {
    throw new SseError("Streaming is not supported in this browser.");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let donePayload: T | undefined;
  let sawDone = false;

  const processBlock = (block: string) => {
    let event = "message";
    const dataLines: string[] = [];
    for (const line of block.split("\n")) {
      if (line.startsWith("event:")) event = line.slice(6).trim();
      else if (line.startsWith("data:")) dataLines.push(line.slice(5).trimStart());
    }
    if (dataLines.length === 0) return;
    let data: unknown;
    try {
      data = JSON.parse(dataLines.join("\n"));
    } catch {
      return;
    }
    if (event === "status") {
      handlers.onStatus?.((data as { stage?: string }).stage ?? "");
    } else if (event === "delta") {
      handlers.onDelta?.((data as { text?: string }).text ?? "");
    } else if (event === "done") {
      donePayload = data as T;
      sawDone = true;
    } else if (event === "error") {
      throw new SseError(
        (data as { error?: string }).error ?? "The agent encountered an error.",
      );
    }
  };

  for (;;) {
    let chunk: ReadableStreamReadResult<Uint8Array>;
    try {
      chunk = await reader.read();
    } catch (err) {
      if (signal?.aborted) throw new SseCancelledError();
      throw err;
    }
    const { done, value } = chunk;
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buffer.indexOf("\n\n")) !== -1) {
      const block = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      processBlock(block);
    }
    if (sawDone) break;
  }
  buffer += decoder.decode();
  if (!sawDone && buffer.trim()) processBlock(buffer);

  if (!sawDone) {
    throw new SseError("The connection was interrupted before the agent finished.");
  }
  return donePayload as T;
}
