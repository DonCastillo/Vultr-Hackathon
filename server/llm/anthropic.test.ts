import type Anthropic from "@anthropic-ai/sdk";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { createAnthropicTransport, DEFAULT_ANTHROPIC_MODEL } from "./anthropic";
import { COMPOSE_OFFER, runTask, type JsonRequest } from "./index";

/** A stand-in SDK client: records messages.create calls and returns `response`. */
function fakeClient(response: Partial<Anthropic.Message>) {
  const calls: {
    body: Anthropic.MessageCreateParamsNonStreaming;
    options: unknown;
  }[] = [];
  const client = {
    messages: {
      create: async (
        body: Anthropic.MessageCreateParamsNonStreaming,
        options: unknown,
      ) => {
        calls.push({ body, options });
        return {
          id: "msg_1",
          type: "message",
          role: "assistant",
          model: "claude-haiku-5-5",
          content: [],
          stop_reason: "end_turn",
          stop_details: null,
          usage: { input_tokens: 10, output_tokens: 5 },
          ...response,
        };
      },
    },
  } as unknown as Anthropic;
  return { client, calls };
}

const text = (t: string) =>
  [{ type: "text", text: t, citations: null }] as Anthropic.ContentBlock[];

const request = (over: Partial<JsonRequest> = {}): JsonRequest => ({
  task: "composeOffer",
  system: "You write one SMS.",
  user: '{"firstName":"Ben"}',
  jsonSchema: z.toJSONSchema(
    z.object({
      text: z.string().min(20).max(300),
      score: z.number().min(0).max(1),
    }),
  ) as Record<string, unknown>,
  maxTokens: 300,
  signal: new AbortController().signal,
  ...over,
});

afterEach(() => vi.unstubAllEnvs());

describe("createAnthropicTransport", () => {
  it("defaults to claude-haiku-5-5 and honours ANTHROPIC_MODEL", () => {
    const { client } = fakeClient({});
    expect(createAnthropicTransport({ client }).model).toBe(
      DEFAULT_ANTHROPIC_MODEL,
    );
    expect(DEFAULT_ANTHROPIC_MODEL).toBe("claude-haiku-5-5");
    vi.stubEnv("ANTHROPIC_MODEL", "claude-sonnet-5-5");
    expect(createAnthropicTransport({ client }).model).toBe(
      "claude-sonnet-5-5",
    );
    expect(createAnthropicTransport({ client, model: "x" })).toMatchObject({
      provider: "anthropic",
      model: "x",
    });
  });

  it("sends one Messages request with structured output, thinking off and low effort", async () => {
    const { client, calls } = fakeClient({
      content: text('{"text":"hi","score":1}'),
    });
    const r = request();
    await createAnthropicTransport({ client }).completeJson(r);

    expect(calls).toHaveLength(1);
    const { body, options } = calls[0];
    expect(body).toMatchObject({
      model: "claude-haiku-5-5",
      max_tokens: 300,
      system: "You write one SMS.",
      messages: [{ role: "user", content: '{"firstName":"Ben"}' }],
      thinking: { type: "disabled" },
      output_config: { effort: "low", format: { type: "json_schema" } },
    });
    expect(body).not.toHaveProperty("temperature");
    expect(options).toEqual({ signal: r.signal });
  });

  it("strips constraints structured outputs can't take (zod still enforces them)", async () => {
    const { client, calls } = fakeClient({ content: text("{}") });
    await createAnthropicTransport({ client }).completeJson(request());
    const schema = JSON.stringify(calls[0].body.output_config?.format?.schema);
    for (const key of ["minLength", "maxLength", "minimum", "maximum"]) {
      expect(schema).not.toContain(`"${key}"`);
    }
    expect(schema).toContain('"additionalProperties":false');
    expect(schema).toContain('"required":["text","score"]');
  });

  it("returns the text and the model that answered", async () => {
    const { client } = fakeClient({
      model: "claude-haiku-5-5",
      content: [...text('{"text":'), ...text('"hi"}')],
    });
    expect(
      await createAnthropicTransport({ client }).completeJson(request()),
    ).toEqual({
      text: '{"text":"hi"}',
      model: "claude-haiku-5-5",
    });
  });

  it("throws on a refusal, naming the category", async () => {
    const { client } = fakeClient({
      stop_reason: "refusal",
      stop_details: {
        type: "refusal",
        category: "cyber",
        explanation: null,
      } as Anthropic.Message["stop_details"],
    });
    await expect(
      createAnthropicTransport({ client }).completeJson(request()),
    ).rejects.toThrow("The model declined the composeOffer request (cyber)");
  });

  it("throws when the answer was cut off at max_tokens", async () => {
    const { client } = fakeClient({
      stop_reason: "max_tokens",
      content: text('{"text":"Hi Be'),
    });
    await expect(
      createAnthropicTransport({ client }).completeJson(request()),
    ).rejects.toThrow("composeOffer hit max_tokens (300)");
  });

  it("plugs into runTask: a refusal becomes a TRANSPORT error for the fallback", async () => {
    const { client } = fakeClient({ stop_reason: "refusal" });
    const r = await runTask(
      COMPOSE_OFFER,
      {
        firstName: "Ben",
        storeName: "Maple & Mug",
        stationName: "Beverage",
        windowLabel: "today 10:00-14:00",
        kind: "CALL_IN",
        isOvertime: false,
        replyMinutes: 10,
      },
      { transport: createAnthropicTransport({ client }) },
    );
    expect(r).toMatchObject({
      ok: false,
      error: "TRANSPORT",
      provider: "anthropic",
    });
  });
});
