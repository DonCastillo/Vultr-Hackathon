import { describe, expect, it } from "vitest";

import { localWindow } from "@/server/rules/time";

import {
  composeOffer,
  offerWindowLabel,
  templateOffer,
  type ComposeOfferRequest,
  type JsonRequest,
  type LlmTransport,
} from "./index";

const TZ = "America/Edmonton";
const NOW = localWindow("2026-11-09", "04:50", "04:51", TZ).start; // Monday 04:50

function fake(text: string) {
  const requests: JsonRequest[] = [];
  const transport: LlmTransport = {
    provider: "anthropic",
    model: "fake-model",
    async completeJson(r) {
      requests.push(r);
      return { text: JSON.stringify({ text }), model: "fake-model" };
    },
  };
  return { transport, requests };
}

const request = (
  over: Partial<ComposeOfferRequest> = {},
): ComposeOfferRequest => ({
  firstName: "Ben",
  storeName: "Maple & Mug",
  stationName: "Beverage/Barista",
  window: localWindow("2026-11-09", "10:00", "14:00", TZ),
  timezone: TZ,
  now: NOW,
  kind: "CALL_IN",
  isOvertime: false,
  replyMinutes: 10,
  ...over,
});

describe("offerWindowLabel", () => {
  it("says today, tomorrow, or the date, with store-local times", () => {
    expect(
      offerWindowLabel(
        localWindow("2026-11-09", "10:00", "14:00", TZ),
        NOW,
        TZ,
      ),
    ).toBe("today 10:00-14:00");
    expect(
      offerWindowLabel(
        localWindow("2026-11-10", "05:30", "10:00", TZ),
        NOW,
        TZ,
      ),
    ).toBe("tomorrow 05:30-10:00");
    expect(
      offerWindowLabel(
        localWindow("2026-11-11", "10:00", "14:00", TZ),
        NOW,
        TZ,
      ),
    ).toBe("Wed Nov 11 10:00-14:00");
  });
});

describe("templateOffer", () => {
  const base = {
    firstName: "Ben",
    storeName: "Maple & Mug",
    stationName: "Beverage/Barista",
    windowLabel: "today 10:00-14:00",
    kind: "CALL_IN" as const,
    isOvertime: false,
    replyMinutes: 10,
  };

  it("asks a call-in to come in", () => {
    expect(templateOffer(base)).toBe(
      "Hi Ben, it's Maple & Mug. Can you come in for Beverage/Barista today 10:00-14:00? Reply YES or NO within 10 min.",
    );
  });

  it("asks an extension to extend, and notes approved overtime", () => {
    expect(
      templateOffer({
        ...base,
        firstName: "Sofia",
        kind: "EXTEND",
        isOvertime: true,
      }),
    ).toBe(
      "Hi Sofia, it's Maple & Mug. Can you extend your shift to cover Beverage/Barista today 10:00-14:00? Overtime is approved by the manager. Reply YES or NO within 10 min.",
    );
  });

  it("stays under 300 characters even with long names", () => {
    const long = templateOffer({
      ...base,
      storeName: "Maple & Mug Coffee Co.",
      stationName: "Sandwich & Breakfast Line",
      windowLabel: "Wed Nov 11 10:00-14:00",
      kind: "EXTEND",
      isOvertime: true,
    });
    expect(long.length).toBeLessThan(300);
  });
});

describe("composeOffer", () => {
  it("sends the facts with a store-local window label and returns the model's text", async () => {
    const text =
      "Hi Ben! Could you come in for Beverage/Barista today 10:00-14:00? Reply YES or NO within 10 min.";
    const { transport, requests } = fake(text);
    const r = await composeOffer(request(), { transport });
    expect(r).toMatchObject({
      text,
      source: "llm",
      llm: { model: "fake-model" },
    });
    expect(JSON.parse(requests[0].user)).toEqual({
      firstName: "Ben",
      storeName: "Maple & Mug",
      stationName: "Beverage/Barista",
      windowLabel: "today 10:00-14:00",
      kind: "CALL_IN",
      isOvertime: false,
      replyMinutes: 10,
    });
  });

  it("falls back to the template when the model changes the times", async () => {
    const r = await composeOffer(request(), {
      transport: fake(
        "Hi Ben, can you cover Beverage/Barista today 10am-2pm? Reply YES or NO within 10 min.",
      ).transport,
    });
    expect(r).toMatchObject({
      source: "fallback",
      llm: { error: "CHECK", message: "offer must state the time 10:00" },
    });
    expect(r.text).toBe(
      "Hi Ben, it's Maple & Mug. Can you come in for Beverage/Barista today 10:00-14:00? Reply YES or NO within 10 min.",
    );
  });

  it("falls back when the reply deadline is missing", async () => {
    const r = await composeOffer(request(), {
      transport: fake(
        "Hi Ben, can you cover Beverage/Barista today 10:00-14:00? Reply YES or NO soon.",
      ).transport,
    });
    expect(r).toMatchObject({
      source: "fallback",
      llm: { message: "offer must state the 10-minute reply window" },
    });
  });

  it("falls back when the model is unavailable", async () => {
    const broken: LlmTransport = {
      provider: "vultr",
      model: "m",
      completeJson: async () => {
        throw new Error("503");
      },
    };
    const r = await composeOffer(
      request({ kind: "EXTEND", firstName: "Sofia", isOvertime: true }),
      { transport: broken },
    );
    expect(r).toMatchObject({
      source: "fallback",
      llm: { provider: "vultr", error: "TRANSPORT" },
    });
    expect(r.text).toContain(
      "Can you extend your shift to cover Beverage/Barista today 10:00-14:00?",
    );
    expect(r.text).toContain("Overtime is approved by the manager.");
  });
});
