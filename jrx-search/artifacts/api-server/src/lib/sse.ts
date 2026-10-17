import type { Response } from "express";

/**
 * Server-Sent Events helper. Sets headers and provides typed event writers.
 * Event protocol used across streaming endpoints:
 *   event: status  — data: {"stage": "..."}         (progress phases)
 *   event: delta   — data: {"text": "..."}          (token deltas)
 *   event: done    — data: <final JSON payload>
 *   event: error   — data: {"error": "..."}
 */
export function openSse(res: Response): {
  status: (stage: string) => void;
  delta: (text: string) => void;
  done: (payload: unknown) => void;
  error: (message: string) => void;
} {
  res.status(200);
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  const write = (event: string, data: unknown) => {
    if (res.writableEnded) return;
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  return {
    status: (stage) => write("status", { stage }),
    delta: (text) => write("delta", { text }),
    done: (payload) => {
      write("done", payload);
      res.end();
    },
    error: (message) => {
      write("error", { error: message });
      res.end();
    },
  };
}
