import { describe, it, expect } from "vitest";
import { parseSseBlock } from "@workspace/nyv-sdk";

describe("parseSseBlock", () => {
  it("parses a status event", () => {
    const event = parseSseBlock('event: status\ndata: {"stage":"drafting"}');
    expect(event).toEqual({ type: "status", stage: "drafting" });
  });

  it("parses a delta event", () => {
    const event = parseSseBlock('event: delta\ndata: {"text":"Hello "}');
    expect(event).toEqual({ type: "delta", text: "Hello " });
  });

  it("parses a done event with the full payload", () => {
    const payload = { id: 42, status: "completed", nested: { a: [1, 2] } };
    const event = parseSseBlock<typeof payload>(
      `event: done\ndata: ${JSON.stringify(payload)}`,
    );
    expect(event).toEqual({ type: "done", payload });
  });

  it("parses an error event", () => {
    const event = parseSseBlock('event: error\ndata: {"error":"boom"}');
    expect(event).toEqual({ type: "error", error: "boom" });
  });

  it("joins multi-line data fields before JSON parsing", () => {
    // Per the SSE spec, consecutive data: lines are joined with \n.
    const block = 'event: done\ndata: {"a":\ndata: 1}';
    const event = parseSseBlock(block);
    expect(event).toEqual({ type: "done", payload: { a: 1 } });
  });

  it("handles data lines without a space after the colon", () => {
    const event = parseSseBlock('event: delta\ndata:{"text":"x"}');
    expect(event).toEqual({ type: "delta", text: "x" });
  });

  it("returns null for unknown event names", () => {
    expect(parseSseBlock('event: heartbeat\ndata: {"ok":true}')).toBeNull();
  });

  it("returns null for the default message event", () => {
    expect(parseSseBlock('data: {"ok":true}')).toBeNull();
  });

  it("returns null for blocks with no data lines (e.g. comments)", () => {
    expect(parseSseBlock(": keep-alive")).toBeNull();
    expect(parseSseBlock("event: status")).toBeNull();
    expect(parseSseBlock("")).toBeNull();
  });

  it("returns null for malformed JSON instead of throwing", () => {
    expect(parseSseBlock("event: status\ndata: {not json")).toBeNull();
  });

  it("survives a payload split across chunk boundaries when blocks are assembled by the caller", () => {
    // Simulates the stream() loop: chunks arrive split mid-event and are only
    // parsed once a full \n\n-terminated block is assembled.
    const chunks = [
      'event: status\ndata: {"sta',
      'ge":"saving"}\n\nevent: done\nda',
      'ta: {"id":7}\n\n',
    ];
    let buffer = "";
    const events: unknown[] = [];
    for (const chunk of chunks) {
      buffer += chunk;
      let sep: number;
      while ((sep = buffer.indexOf("\n\n")) !== -1) {
        const block = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);
        const event = parseSseBlock(block);
        if (event) events.push(event);
      }
    }
    expect(events).toEqual([
      { type: "status", stage: "saving" },
      { type: "done", payload: { id: 7 } },
    ]);
    expect(buffer).toBe("");
  });
});
