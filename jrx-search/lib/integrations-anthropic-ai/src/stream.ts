import Anthropic from "@anthropic-ai/sdk";
import {
  BedrockRuntimeClient,
  ConverseStreamCommand,
  type Message as BedrockMessage,
  type SystemContentBlock,
} from "@aws-sdk/client-bedrock-runtime";

export interface StreamTextParams {
  model: string;
  max_tokens: number;
  system?: string;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
  /** When aborted, the upstream provider stream is stopped and iteration ends. */
  signal?: AbortSignal;
}

/**
 * Stream text generation as an async iterable of text deltas.
 * Uses the Anthropic SDK streaming API against the Replit AI proxy in dev,
 * and Bedrock ConverseStream when AI_PROVIDER=bedrock.
 */
export async function* streamText(
  params: StreamTextParams,
): AsyncGenerator<string, void, undefined> {
  if (process.env.AI_PROVIDER === "bedrock") {
    const runtime = new BedrockRuntimeClient({
      region: process.env.BEDROCK_REGION ?? "us-east-1",
    });
    const system: SystemContentBlock[] | undefined = params.system
      ? [{ text: params.system }]
      : undefined;
    const messages: BedrockMessage[] = params.messages.map((m) => ({
      role: m.role,
      content: [{ text: m.content }],
    }));
    const res = await runtime.send(
      new ConverseStreamCommand({
        modelId: params.model,
        system,
        messages,
        inferenceConfig: { maxTokens: params.max_tokens },
      }),
      { abortSignal: params.signal },
    );
    if (!res.stream) throw new Error("Bedrock returned no stream");
    for await (const event of res.stream) {
      if (params.signal?.aborted) return;
      const delta = event.contentBlockDelta?.delta;
      if (delta && "text" in delta && delta.text) yield delta.text;
    }
    return;
  }

  if (
    !process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL ||
    !process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY
  ) {
    throw new Error(
      "AI_INTEGRATIONS_ANTHROPIC_BASE_URL and AI_INTEGRATIONS_ANTHROPIC_API_KEY must be set.",
    );
  }
  const client = new Anthropic({
    apiKey: process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY,
    baseURL: process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL,
  });
  const stream = client.messages.stream(
    {
      model: params.model,
      max_tokens: params.max_tokens,
      system: params.system,
      messages: params.messages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
    },
    { signal: params.signal },
  );
  for await (const event of stream) {
    if (params.signal?.aborted) return;
    if (
      event.type === "content_block_delta" &&
      event.delta.type === "text_delta"
    ) {
      yield event.delta.text;
    }
  }
}
