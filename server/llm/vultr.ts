import "server-only";

import OpenAI from "openai";

import type { JsonRequest, LlmTransport } from "./index";

// Vultr Serverless Inference transport: {system, user, jsonSchema} -> JSON text through
// Vultr's OpenAI-compatible chat completions API. Prompts and schemas live in index.ts.
//
// Vultr's docs don't pin down two things, so this adapter copes with either answer:
// - Models: tries GET /v1/models, then the /v1/chat/models path from Vultr's Node guide.
//   VULTR_MODEL wins; otherwise the first instruct-style chat model is used.
// - JSON output: asks for strict json_schema output; if Vultr rejects that (400), it steps
//   down to json_object, then to plain text, and remembers what worked. The schema is also
//   in the system prompt, and runTask extracts and validates the JSON either way.
//
// Needs VULTR_INFERENCE_API_KEY (prerequisite P.3).

export const VULTR_BASE_URL = "https://api.vultrinference.com/v1";

/** Preferred chat models, best first, when VULTR_MODEL isn't set. */
const PREFERRED = [
  /kimi-k2.*instruct/i,
  /llama-3\.3-70b/i,
  /qwen.*instruct/i,
  /mistral.*(small|nemo|instruct)/i,
  /instruct/i,
];
const NOT_CHAT = /embed|whisper|tts|speech|image|diffusion|rerank|guard/i;

/** Picks the model: VULTR_MODEL if set, else the first preferred chat model, else the first chat model. */
export function chooseModel(
  ids: string[],
  configured = process.env.VULTR_MODEL,
): string {
  if (configured) {
    if (ids.length > 0 && !ids.includes(configured)) {
      throw new Error(
        `VULTR_MODEL "${configured}" isn't one of Vultr's models: ${ids.join(", ")}`,
      );
    }
    return configured;
  }
  const chat = ids.filter((id) => !NOT_CHAT.test(id));
  for (const pattern of PREFERRED) {
    const match = chat.find((id) => pattern.test(id));
    if (match) return match;
  }
  if (chat[0]) return chat[0];
  throw new Error("Couldn't list Vultr models; set VULTR_MODEL");
}

/** Model ids from Vultr, or [] if neither listing endpoint answers. */
export async function listModels(client: OpenAI): Promise<string[]> {
  try {
    const page = await client.models.list();
    const ids = page.data.map((m) => m.id);
    if (ids.length > 0) return ids;
  } catch {
    // fall through to Vultr's documented path
  }
  try {
    const body = await client.get<unknown>("/chat/models");
    const list = Array.isArray(body)
      ? body
      : ((body as { data?: unknown[]; models?: unknown[] }).data ??
        (body as { models?: unknown[] }).models ??
        []);
    return list
      .map((m) => (typeof m === "string" ? m : (m as { id?: string }).id))
      .filter((id): id is string => typeof id === "string");
  } catch {
    return [];
  }
}

export type JsonMode = "json_schema" | "json_object" | "text";
const NEXT_MODE: Record<JsonMode, JsonMode | null> = {
  json_schema: "json_object",
  json_object: "text",
  text: null,
};

function responseFormat(mode: JsonMode, request: JsonRequest) {
  if (mode === "json_schema") {
    return {
      response_format: {
        type: "json_schema" as const,
        json_schema: {
          name: request.task,
          schema: request.jsonSchema,
          strict: true,
        },
      },
    };
  }
  if (mode === "json_object")
    return { response_format: { type: "json_object" as const } };
  return {};
}

export async function createVultrTransport(
  options: { client?: OpenAI; model?: string } = {},
): Promise<LlmTransport & { readonly jsonMode: JsonMode }> {
  const apiKey = process.env.VULTR_INFERENCE_API_KEY;
  if (!options.client && !apiKey) {
    throw new Error("VULTR_INFERENCE_API_KEY is not set (prerequisite P.3)");
  }
  // runTask enforces the overall deadline, so keep SDK retries short.
  const client =
    options.client ??
    new OpenAI({ apiKey, baseURL: VULTR_BASE_URL, maxRetries: 1 });
  const model = options.model ?? chooseModel(await listModels(client));
  let jsonMode: JsonMode = "json_schema";

  return {
    provider: "vultr",
    model,
    get jsonMode() {
      return jsonMode;
    },
    async completeJson(request) {
      const system = `${request.system}\n\nYour answer must match this JSON schema:\n${JSON.stringify(request.jsonSchema)}`;
      for (;;) {
        try {
          const completion = await client.chat.completions.create(
            {
              model,
              max_tokens: request.maxTokens,
              messages: [
                { role: "system", content: system },
                { role: "user", content: request.user },
              ],
              ...responseFormat(jsonMode, request),
            },
            { signal: request.signal },
          );
          const choice = completion.choices[0];
          if (!choice)
            throw new Error(`Vultr returned no choices for ${request.task}`);
          if (choice.message.refusal) {
            throw new Error(
              `The model declined the ${request.task} request: ${choice.message.refusal}`,
            );
          }
          if (choice.finish_reason === "length") {
            throw new Error(
              `${request.task} hit max_tokens (${request.maxTokens}); the answer is incomplete`,
            );
          }
          return {
            text: choice.message.content ?? "",
            model: completion.model || model,
          };
        } catch (err) {
          const next = NEXT_MODE[jsonMode];
          if (err instanceof OpenAI.BadRequestError && next) {
            jsonMode = next; // Vultr rejected this response_format; try the next one
            continue;
          }
          throw err;
        }
      }
    },
  };
}
