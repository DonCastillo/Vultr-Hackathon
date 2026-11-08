import "server-only";

import Anthropic from "@anthropic-ai/sdk";
import { transformJSONSchema } from "@anthropic-ai/sdk/lib/transform-json-schema";

import type { LlmTransport } from "./index";

// Anthropic transport: {system, user, jsonSchema} -> JSON text via the Messages API with
// structured outputs. Prompts and schemas live in index.ts; this file only talks to the API.
//
// - Model: claude-haiku-5-5 (override with ANTHROPIC_MODEL). The four tasks are short
//   extraction / classification / writing jobs, so thinking is off and effort is low;
//   Haiku 5.5 accepts disabled thinking at effort high or below, and thinking tokens would
//   otherwise eat into the tasks' small max_tokens.
// - Structured outputs don't accept numeric or length constraints (minimum, maxLength...),
//   so the schema goes through the SDK's transformJSONSchema; runTask still enforces them
//   with zod on the way back.
// - Refusals and truncated answers throw, and runTask reports them as TRANSPORT errors so
//   callers use their fallback.

export const DEFAULT_ANTHROPIC_MODEL = "claude-haiku-5-5";

export function createAnthropicTransport(
  options: { client?: Anthropic; model?: string } = {},
): LlmTransport {
  // Reads ANTHROPIC_API_KEY (or another configured credential) from the environment.
  // runTask enforces the overall deadline, so keep SDK retries short.
  const client = options.client ?? new Anthropic({ maxRetries: 1 });
  const model =
    options.model ?? (process.env.ANTHROPIC_MODEL || DEFAULT_ANTHROPIC_MODEL);

  return {
    provider: "anthropic",
    model,
    async completeJson(request) {
      const response = await client.messages.create(
        {
          model,
          max_tokens: request.maxTokens,
          system: request.system,
          messages: [{ role: "user", content: request.user }],
          thinking: { type: "disabled" },
          output_config: {
            effort: "low",
            format: {
              type: "json_schema",
              schema: transformJSONSchema(request.jsonSchema),
            },
          },
        },
        { signal: request.signal },
      );

      if (response.stop_reason === "refusal") {
        const category = response.stop_details?.category;
        throw new Error(
          `The model declined the ${request.task} request${category ? ` (${category})` : ""}`,
        );
      }
      if (response.stop_reason === "max_tokens") {
        throw new Error(
          `${request.task} hit max_tokens (${request.maxTokens}); the answer is incomplete`,
        );
      }

      const text = response.content
        .flatMap((block) => (block.type === "text" ? [block.text] : []))
        .join("");
      return { text, model: response.model };
    },
  };
}
