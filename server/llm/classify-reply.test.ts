import { describe, expect, it } from "vitest";

import {
  classifyReply,
  keywordReplyIntent,
  strictReplyIntent,
  type JsonRequest,
  type LlmTransport,
} from "./index";

const OFFER =
  "Hi Ben, can you come in for Beverage/Barista today 10:00-14:00? Reply YES or NO within 10 min.";

function fake(reply: object | Error) {
  const requests: JsonRequest[] = [];
  const transport: LlmTransport = {
    provider: "anthropic",
    model: "fake-model",
    async completeJson(r) {
      requests.push(r);
      if (reply instanceof Error) throw reply;
      return {
        text: JSON.stringify({
          condition: null,
          question: null,
          confidence: 0.9,
          ...reply,
        }),
        model: "fake-model",
      };
    },
  };
  return { transport, requests };
}

describe("strictReplyIntent (no LLM needed)", () => {
  it.each([
    "yes",
    "YES",
    "Yes!",
    "y",
    "yep",
    "Yeah",
    "sure",
    "ok",
    "I'm in",
    "omw",
    "yes please",
    "  Yup!! ",
    "no problem!",
  ])("%s -> ACCEPT", (r) => expect(strictReplyIntent(r)).toBe("ACCEPT"));
  it.each([
    "no",
    "NO",
    "Nope",
    "nah",
    "can't",
    "can’t",
    "cannot",
    "no sorry",
    "sorry no",
    "not today",
    "pass",
  ])("%s -> DECLINE", (r) => expect(strictReplyIntent(r)).toBe("DECLINE"));
  it.each([
    "yes but only till 1",
    "where do I park?",
    "maybe",
    "can I start at 11",
  ])("%s -> needs a closer look", (r) =>
    expect(strictReplyIntent(r)).toBeNull(),
  );
});

describe("keywordReplyIntent (the fallback when the LLM is down)", () => {
  it.each([
    ["ya i can but only until 1", "CONDITIONAL"],
    ["sure, can start at 11 though", "CONDITIONAL"],
    ["yes if I can leave at 1", "CONDITIONAL"],
    ["where do I park?", "QUESTION"],
    ["is it the drive thru?", "QUESTION"],
    ["no problem!", "ACCEPT"],
    ["no worries, be there soon", "ACCEPT"],
    ["sorry, I'm busy today", "DECLINE"],
    ["I won't be able to", "DECLINE"],
    ["yes no maybe", "UNKNOWN"],
    ["lol", "UNKNOWN"],
  ])("%s -> %s", (reply, intent) => {
    expect(keywordReplyIntent(reply).intent).toBe(intent);
  });

  it("keeps the condition or question text", () => {
    expect(keywordReplyIntent("ya i can but only until 1")).toMatchObject({
      condition: "ya i can but only until 1",
    });
    expect(keywordReplyIntent("where do I park?")).toMatchObject({
      question: "where do I park?",
    });
  });
});

describe("classifyReply", () => {
  it("answers obvious yes/no without calling the LLM", async () => {
    const { transport, requests } = fake({ intent: "UNKNOWN" });
    expect(
      await classifyReply({ offerText: OFFER, reply: "Yep!" }, { transport }),
    ).toEqual({
      intent: "ACCEPT",
      condition: null,
      question: null,
      confidence: 1,
      source: "keyword",
    });
    expect(
      await classifyReply({ offerText: OFFER, reply: "nope" }, { transport }),
    ).toMatchObject({ intent: "DECLINE" });
    expect(requests).toHaveLength(0);
  });

  it("uses the model for anything else and keeps its condition", async () => {
    const { transport, requests } = fake({
      intent: "CONDITIONAL",
      condition: "only until 13:00",
      confidence: 0.92,
    });
    const r = await classifyReply(
      { offerText: OFFER, reply: "ya i can but only until 1, got class" },
      { transport },
    );
    expect(r).toMatchObject({
      intent: "CONDITIONAL",
      condition: "only until 13:00",
      question: null,
      source: "llm",
    });
    expect(requests[0].user).toContain(
      "<reply>\nya i can but only until 1, got class\n</reply>",
    );
    expect(requests[0].user).toContain(`<offer>\n${OFFER}\n</offer>`);
  });

  it("drops a condition or question that doesn't match the intent", async () => {
    const { transport } = fake({
      intent: "DECLINE",
      condition: "x",
      question: "y",
    });
    expect(
      await classifyReply(
        { offerText: OFFER, reply: "not this time sorry" },
        { transport },
      ),
    ).toMatchObject({
      intent: "DECLINE",
      condition: null,
      question: null,
    });
  });

  it("downgrades an unsure ACCEPT to UNKNOWN so we ask instead of booking", async () => {
    const { transport } = fake({ intent: "ACCEPT", confidence: 0.6 });
    expect(
      await classifyReply(
        { offerText: OFFER, reply: "i guess that works" },
        { transport },
      ),
    ).toMatchObject({
      intent: "UNKNOWN",
      confidence: 0.6,
      source: "llm",
    });
  });

  it("downgrades an ACCEPT when the reply also reads as a refusal", async () => {
    const { transport } = fake({ intent: "ACCEPT", confidence: 0.95 });
    expect(
      await classifyReply(
        { offerText: OFFER, reply: "yeah no I can't today" },
        { transport },
      ),
    ).toMatchObject({
      intent: "UNKNOWN",
    });
  });

  it("keeps a confident ACCEPT with friendly extras ('no problem', 'sorry for the late reply')", async () => {
    const { transport } = fake({ intent: "ACCEPT", confidence: 0.95 });
    for (const reply of [
      "no problem, see you at 10",
      "yes! sorry for the late reply",
    ]) {
      expect(
        await classifyReply({ offerText: OFFER, reply }, { transport }),
      ).toMatchObject({ intent: "ACCEPT" });
    }
  });

  it("falls back to keywords when the LLM fails", async () => {
    const { transport } = fake(new Error("503"));
    expect(
      await classifyReply(
        { offerText: OFFER, reply: "where do I park?" },
        { transport },
      ),
    ).toMatchObject({
      intent: "QUESTION",
      question: "where do I park?",
      source: "fallback",
      llm: { error: "TRANSPORT", message: "503" },
    });
  });
});
