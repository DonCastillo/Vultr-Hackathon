import OpenAI from "openai";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { CLASSIFY_REPLY, runTask, type JsonRequest } from "./index";
import {
  chooseModel,
  createVultrTransport,
  listModels,
  VULTR_BASE_URL,
} from "./vultr";

type CreateBody = OpenAI.Chat.ChatCompletionCreateParamsNonStreaming;

/** A stand-in OpenAI client for Vultr. `chat` answers each create call in turn. */
function fakeClient(opts: {
  models?: string[] | Error;
  chatModels?: unknown;
  chat?: (body: CreateBody) => Partial<OpenAI.Chat.ChatCompletion> | Error;
}) {
  const calls: { body: CreateBody; options: unknown }[] = [];
  const client = {
    models: {
      list: async () => {
        if (opts.models instanceof Error) throw opts.models;
        return { data: (opts.models ?? []).map((id) => ({ id })) };
      },
    },
    get: async () => {
      if (opts.chatModels === undefined) throw new Error("404");
      return opts.chatModels;
    },
    chat: {
      completions: {
        create: async (body: CreateBody, options: unknown) => {
          calls.push({ body, options });
          const r = opts.chat?.(body) ?? {};
          if (r instanceof Error) throw r;
          return {
            id: "c1",
            object: "chat.completion",
            created: 0,
            model: body.model,
            choices: [
              {
                index: 0,
                finish_reason: "stop",
                logprobs: null,
                message: { role: "assistant", content: "{}", refusal: null },
              },
            ],
            ...r,
          };
        },
      },
    },
  } as unknown as OpenAI;
  return { client, calls };
}

const answer = (
  content: string,
  finish_reason = "stop",
  refusal: string | null = null,
) =>
  ({
    choices: [
      {
        index: 0,
        finish_reason,
        logprobs: null,
        message: { role: "assistant", content, refusal },
      },
    ],
  }) as Partial<OpenAI.Chat.ChatCompletion>;

const badRequest = () =>
  OpenAI.APIError.generate(
    400,
    { error: { message: "response_format not supported" } },
    undefined,
    new Headers(),
  );

const request = (over: Partial<JsonRequest> = {}): JsonRequest => ({
  task: "classifyReply",
  system: "Classify the reply.",
  user: "<reply>yes</reply>",
  jsonSchema: z.toJSONSchema(z.object({ intent: z.string() })) as Record<
    string,
    unknown
  >,
  maxTokens: 250,
  signal: new AbortController().signal,
  ...over,
});

afterEach(() => vi.unstubAllEnvs());

describe("chooseModel", () => {
  const ids = [
    "bge-large-embed",
    "whisper-large",
    "mistral-7b-v0.3",
    "qwen2.5-32b-instruct",
    "kimi-k2-instruct",
  ];

  it("prefers instruct chat models in order and skips non-chat models", () => {
    expect(chooseModel(ids, undefined)).toBe("kimi-k2-instruct");
    expect(
      chooseModel(
        ["bge-large-embed", "mistral-7b-v0.3", "qwen2.5-32b-instruct"],
        undefined,
      ),
    ).toBe("qwen2.5-32b-instruct");
    expect(chooseModel(["bge-large-embed", "some-chat-model"], undefined)).toBe(
      "some-chat-model",
    );
  });

  it("uses VULTR_MODEL when set, and checks it against the list", () => {
    expect(chooseModel(ids, "mistral-7b-v0.3")).toBe("mistral-7b-v0.3");
    expect(chooseModel([], "anything")).toBe("anything"); // listing failed: trust the config
    expect(() => chooseModel(ids, "gpt-9")).toThrow(
      "VULTR_MODEL \"gpt-9\" isn't one of Vultr's models",
    );
  });

  it("asks for VULTR_MODEL when nothing usable is listed", () => {
    expect(() => chooseModel([], undefined)).toThrow("set VULTR_MODEL");
    expect(() => chooseModel(["bge-embed"], undefined)).toThrow(
      "set VULTR_MODEL",
    );
  });
});

describe("listModels", () => {
  it("reads GET /models", async () => {
    expect(await listModels(fakeClient({ models: ["a", "b"] }).client)).toEqual(
      ["a", "b"],
    );
  });

  it("falls back to /chat/models in any of its likely shapes", async () => {
    const down = new Error("404");
    expect(
      await listModels(
        fakeClient({ models: down, chatModels: { data: [{ id: "x" }] } })
          .client,
      ),
    ).toEqual(["x"]);
    expect(
      await listModels(
        fakeClient({ models: down, chatModels: { models: ["y"] } }).client,
      ),
    ).toEqual(["y"]);
    expect(
      await listModels(
        fakeClient({ models: [], chatModels: [{ id: "z" }, "w"] }).client,
      ),
    ).toEqual(["z", "w"]);
  });

  it("returns [] when neither endpoint answers", async () => {
    expect(
      await listModels(fakeClient({ models: new Error("down") }).client),
    ).toEqual([]);
  });
});

describe("createVultrTransport", () => {
  it("needs VULTR_INFERENCE_API_KEY", async () => {
    vi.stubEnv("VULTR_INFERENCE_API_KEY", "");
    await expect(createVultrTransport()).rejects.toThrow(
      "VULTR_INFERENCE_API_KEY is not set",
    );
  });

  it("points the OpenAI SDK at Vultr's base URL", () => {
    expect(VULTR_BASE_URL).toBe("https://api.vultrinference.com/v1");
  });

  it("picks the model from the list (or VULTR_MODEL)", async () => {
    const { client } = fakeClient({
      models: ["kimi-k2-instruct", "llama-3.3-70b-instruct"],
    });
    vi.stubEnv("VULTR_MODEL", "");
    expect((await createVultrTransport({ client })).model).toBe(
      "kimi-k2-instruct",
    );
    vi.stubEnv("VULTR_MODEL", "llama-3.3-70b-instruct");
    expect(await createVultrTransport({ client })).toMatchObject({
      provider: "vultr",
      model: "llama-3.3-70b-instruct",
    });
  });

  it("sends a chat completion with a strict json_schema format and the schema in the system prompt", async () => {
    const { client, calls } = fakeClient({
      chat: () => answer('{"intent":"ACCEPT"}'),
    });
    const t = await createVultrTransport({ client, model: "kimi-k2-instruct" });
    const r = request();
    expect(await t.completeJson(r)).toEqual({
      text: '{"intent":"ACCEPT"}',
      model: "kimi-k2-instruct",
    });

    const { body, options } = calls[0];
    expect(body).toMatchObject({
      model: "kimi-k2-instruct",
      max_tokens: 250,
      messages: [
        {
          role: "system",
          content: expect.stringContaining("Classify the reply."),
        },
        { role: "user", content: "<reply>yes</reply>" },
      ],
      response_format: {
        type: "json_schema",
        json_schema: { name: "classifyReply", strict: true },
      },
    });
    expect(body.messages[0].content).toContain(
      'Your answer must match this JSON schema:\n{"$schema"',
    );
    expect(options).toEqual({ signal: r.signal });
  });

  it("steps down to json_object, then plain text, when Vultr rejects the format, and remembers it", async () => {
    const { client, calls } = fakeClient({
      chat: (body) =>
        body.response_format ? badRequest() : answer('{"intent":"DECLINE"}'),
    });
    const t = await createVultrTransport({ client, model: "m" });
    expect((await t.completeJson(request())).text).toBe('{"intent":"DECLINE"}');
    expect(calls.map((c) => c.body.response_format?.type ?? "text")).toEqual([
      "json_schema",
      "json_object",
      "text",
    ]);
    expect(t.jsonMode).toBe("text");

    await t.completeJson(request());
    expect(calls).toHaveLength(4); // the next request goes straight to plain text
    expect(calls[3].body).not.toHaveProperty("response_format");
  });

  it("stops at json_object when that works", async () => {
    const { client } = fakeClient({
      chat: (body) =>
        body.response_format?.type === "json_schema"
          ? badRequest()
          : answer("{}"),
    });
    const t = await createVultrTransport({ client, model: "m" });
    await t.completeJson(request());
    expect(t.jsonMode).toBe("json_object");
  });

  it("passes other errors through without stepping down", async () => {
    const { client, calls } = fakeClient({
      chat: () =>
        OpenAI.APIError.generate(
          429,
          { error: { message: "slow down" } },
          undefined,
          new Headers(),
        ),
    });
    const t = await createVultrTransport({ client, model: "m" });
    await expect(t.completeJson(request())).rejects.toBeInstanceOf(
      OpenAI.RateLimitError,
    );
    expect(calls).toHaveLength(1);
    expect(t.jsonMode).toBe("json_schema");
  });

  it("throws on a refusal or a cut-off answer", async () => {
    const refused = await createVultrTransport({
      client: fakeClient({ chat: () => answer("", "stop", "no") }).client,
      model: "m",
    });
    await expect(refused.completeJson(request())).rejects.toThrow(
      "The model declined the classifyReply request: no",
    );
    const cut = await createVultrTransport({
      client: fakeClient({ chat: () => answer('{"inte', "length") }).client,
      model: "m",
    });
    await expect(cut.completeJson(request())).rejects.toThrow(
      "classifyReply hit max_tokens (250)",
    );
  });

  it("plugs into runTask: JSON wrapped in prose (plain-text mode) still validates", async () => {
    const { client } = fakeClient({
      chat: () =>
        answer(
          'Here you go: {"intent":"ACCEPT","condition":null,"question":null,"confidence":0.9}',
        ),
    });
    const r = await runTask(
      CLASSIFY_REPLY,
      { offerText: "Can you cover? Reply YES or NO", reply: "yes" },
      {
        transport: await createVultrTransport({
          client,
          model: "kimi-k2-instruct",
        }),
      },
    );
    expect(r).toMatchObject({
      ok: true,
      provider: "vultr",
      model: "kimi-k2-instruct",
      data: { intent: "ACCEPT" },
    });
  });
});
