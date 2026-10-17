import Anthropic from "@anthropic-ai/sdk";
import {
  BedrockRuntimeClient,
  ConverseCommand,
  type Message as BedrockMessage,
  type SystemContentBlock,
} from "@aws-sdk/client-bedrock-runtime";

export type AnthropicLike = {
  messages: {
    create: (
      params: Anthropic.MessageCreateParamsNonStreaming,
      options?: { signal?: AbortSignal },
    ) => Promise<Anthropic.Message>;
  };
};

function toBedrockMessages(
  messages: Anthropic.MessageCreateParamsNonStreaming["messages"],
): BedrockMessage[] {
  return messages.map((m) => ({
    role: m.role,
    content:
      typeof m.content === "string"
        ? [{ text: m.content }]
        : m.content.map((block) => {
            if (block.type === "text") return { text: block.text };
            throw new Error(
              `Unsupported content block type for Bedrock: ${block.type}`,
            );
          }),
  }));
}

function buildBedrockClient(): AnthropicLike {
  const runtime = new BedrockRuntimeClient({
    region: process.env.BEDROCK_REGION ?? "us-east-1",
  });
  return {
    messages: {
      async create(params, options) {
        const system: SystemContentBlock[] | undefined =
          typeof params.system === "string"
            ? [{ text: params.system }]
            : params.system?.map((b) => ({ text: b.text }));
        const res = await runtime.send(
          new ConverseCommand({
            modelId: params.model,
            system,
            messages: toBedrockMessages(params.messages),
            inferenceConfig: { maxTokens: params.max_tokens },
          }),
          { abortSignal: options?.signal },
        );
        const blocks = res.output?.message?.content ?? [];
        const text = blocks
          .map((b) => ("text" in b ? (b.text ?? "") : ""))
          .join("");
        const stopReasonMap: Record<string, Anthropic.Message["stop_reason"]> =
          {
            end_turn: "end_turn",
            max_tokens: "max_tokens",
            stop_sequence: "stop_sequence",
            tool_use: "tool_use",
            guardrail_intervened: "refusal",
            content_filtered: "refusal",
          };
        const message: Anthropic.Message = {
          id: `bedrock_${Date.now()}`,
          type: "message",
          role: "assistant",
          model: params.model,
          container: null,
          content: [{ type: "text", text, citations: null }],
          stop_reason: stopReasonMap[res.stopReason ?? ""] ?? "end_turn",
          stop_sequence: null,
          usage: {
            input_tokens: res.usage?.inputTokens ?? 0,
            output_tokens: res.usage?.outputTokens ?? 0,
            cache_creation_input_tokens: null,
            cache_read_input_tokens: null,
            cache_creation: null,
            server_tool_use: null,
            service_tier: null,
            inference_geo: null,
          },
        };
        return message;
      },
    },
  };
}

function buildClient(): AnthropicLike {
  if (process.env.AI_PROVIDER === "bedrock") {
    return buildBedrockClient();
  }

  if (!process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL) {
    throw new Error(
      "AI_INTEGRATIONS_ANTHROPIC_BASE_URL must be set. Did you forget to provision the Anthropic AI integration?",
    );
  }

  if (!process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY) {
    throw new Error(
      "AI_INTEGRATIONS_ANTHROPIC_API_KEY must be set. Did you forget to provision the Anthropic AI integration?",
    );
  }

  return new Anthropic({
    apiKey: process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY,
    baseURL: process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL,
  });
}

export const anthropic = buildClient();
