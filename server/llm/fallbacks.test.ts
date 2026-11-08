import { afterEach, describe, expect, it, vi } from "vitest";

import { localWindow } from "@/server/rules/time";

import {
  classifyReply,
  CLASSIFY_REPLY,
  composeOffer,
  keywordCallout,
  llmDisabled,
  parseCallout,
  PARSE_CALLOUT,
  runTask,
  setTransport,
  summarizePlan,
  SUMMARIZE_PLAN,
  COMPOSE_OFFER,
  type CalloutShift,
  type JsonRequest,
  type LlmTransport,
  type PlanFacts,
} from "./index";

const TZ = "America/Edmonton";
const NOW = localWindow("2026-11-09", "04:40", "04:41", TZ).start; // Monday 04:40
const shift = (id: string, date: string): CalloutShift => ({
  id,
  ...localWindow(date, "05:30", "14:00", TZ),
  stationNames: ["Beverage/Barista"],
});
const UPCOMING = [shift("mon", "2026-11-09"), shift("tue", "2026-11-10")];

afterEach(() => {
  setTransport(undefined);
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------------
// keywordCallout
// ---------------------------------------------------------------------------------

describe("keywordCallout (parseCallout's fallback)", () => {
  it.each([
    ["woke up sick, can't make it in this morning", true, "mon", "sick"],
    ["throwing up all night, not coming in", true, "mon", "sick"],
    [
      "can't come in tomorrow, family emergency",
      true,
      "tue",
      "family emergency",
    ],
    ["my car won't start", true, "mon", "car trouble"],
    ["calling out today sorry", true, "mon", null],
    ["hey", true, "mon", null], // unclear: assume a call-out, the caller asks to confirm
    ["running late, be there in 10", false, null, null],
    ["can I swap my tuesday shift?", false, null, null],
    ["running late AND I'm sick, can't make it", true, "mon", "sick"], // call-out words win
  ])("%s", (message, isCallout, shiftId, reason) => {
    expect(keywordCallout(message, UPCOMING, NOW, TZ)).toEqual({
      isCallout,
      shiftId,
      reason,
    });
  });

  it("falls back to the next shift when 'tomorrow' has no shift", () => {
    expect(
      keywordCallout("sick tomorrow", [UPCOMING[0]], NOW, TZ).shiftId,
    ).toBe("mon");
  });

  it("returns no shift when nothing is upcoming", () => {
    expect(keywordCallout("sick", [], NOW, TZ)).toEqual({
      isCallout: true,
      shiftId: null,
      reason: "sick",
    });
  });
});

// ---------------------------------------------------------------------------------
// Timeouts and the kill switch
// ---------------------------------------------------------------------------------

/** A transport that never answers on its own, but resolves when aborted. */
function hanging(): LlmTransport & { requests: JsonRequest[] } {
  const requests: JsonRequest[] = [];
  return {
    provider: "anthropic",
    model: "fake",
    requests,
    completeJson: (r) => {
      requests.push(r);
      return new Promise((resolve) =>
        r.signal.addEventListener("abort", () =>
          resolve({ text: "{}", model: "fake" }),
        ),
      );
    },
  };
}

describe("timeouts", () => {
  it("gives each task its own deadline (summary 12s, reply 6s)", async () => {
    vi.useFakeTimers();
    const t = hanging();
    const summary = runTask(SUMMARIZE_PLAN, emptyPlanInput(), { transport: t });
    const reply = runTask(
      CLASSIFY_REPLY,
      { offerText: "x", reply: "y" },
      { transport: t },
    );
    await vi.advanceTimersByTimeAsync(6_000);
    expect(await reply).toMatchObject({
      ok: false,
      error: "TIMEOUT",
      message: "No answer within 6000ms",
    });
    await vi.advanceTimersByTimeAsync(6_000);
    expect(await summary).toMatchObject({
      ok: false,
      error: "TIMEOUT",
      message: "No answer within 12000ms",
    });
    expect(SUMMARIZE_PLAN.timeoutMs).toBe(12_000);
    expect([
      PARSE_CALLOUT.timeoutMs,
      COMPOSE_OFFER.timeoutMs,
      CLASSIFY_REPLY.timeoutMs,
    ]).toEqual([8_000, 8_000, 6_000]);
  });

  it("lets LLM_TIMEOUT_MS override the task default, and the call's timeoutMs override both", async () => {
    vi.useFakeTimers();
    vi.stubEnv("LLM_TIMEOUT_MS", "3000");
    const env = runTask(SUMMARIZE_PLAN, emptyPlanInput(), {
      transport: hanging(),
    });
    await vi.advanceTimersByTimeAsync(3_000);
    expect(await env).toMatchObject({
      error: "TIMEOUT",
      message: "No answer within 3000ms",
    });

    const call = runTask(SUMMARIZE_PLAN, emptyPlanInput(), {
      transport: hanging(),
      timeoutMs: 1_000,
    });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(await call).toMatchObject({
      error: "TIMEOUT",
      message: "No answer within 1000ms",
    });
  });

  it("ignores a junk LLM_TIMEOUT_MS", async () => {
    vi.useFakeTimers();
    vi.stubEnv("LLM_TIMEOUT_MS", "soon");
    const r = runTask(
      CLASSIFY_REPLY,
      { offerText: "x", reply: "y" },
      { transport: hanging() },
    );
    await vi.advanceTimersByTimeAsync(6_000);
    expect(await r).toMatchObject({ message: "No answer within 6000ms" });
  });
});

describe("LLM_DISABLED", () => {
  it("reads 1 / true / yes", () => {
    for (const v of ["1", "true", "YES"]) {
      vi.stubEnv("LLM_DISABLED", v);
      expect(llmDisabled()).toBe(true);
    }
    vi.stubEnv("LLM_DISABLED", "");
    expect(llmDisabled()).toBe(false);
  });

  it("skips the provider entirely, so every function uses its fallback without waiting", async () => {
    vi.stubEnv("LLM_DISABLED", "1");
    const t = hanging();
    setTransport(t);
    const r = await classifyReply({
      offerText: "Reply YES or NO",
      reply: "ya but only till 1",
    });
    expect(r).toMatchObject({
      intent: "CONDITIONAL",
      source: "fallback",
      llm: { error: "NO_PROVIDER", message: "LLM_DISABLED is set" },
    });
    expect(t.requests).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------------
// Every function x every failure mode returns something usable
// ---------------------------------------------------------------------------------

const FAILURES: [string, LlmTransport][] = [
  [
    "transport error",
    {
      provider: "vultr",
      model: "m",
      completeJson: async () => Promise.reject(new Error("503")),
    },
  ],
  [
    "non-JSON answer",
    {
      provider: "vultr",
      model: "m",
      completeJson: async () => ({ text: "Sorry!", model: "m" }),
    },
  ],
  [
    "wrong JSON shape",
    {
      provider: "vultr",
      model: "m",
      completeJson: async () => ({ text: '{"nope":1}', model: "m" }),
    },
  ],
];

function emptyPlanInput() {
  return {
    storeName: "S",
    callOut: "K",
    gaps: [],
    moves: [],
    remaining: [],
    candidates: [],
  };
}

const PLAN: PlanFacts = {
  storeName: "Maple & Mug",
  timezone: TZ,
  stationNames: { bev: "Beverage/Barista" },
  crewNames: { kayla: "Kayla", ben: "Ben" },
  callOut: { crewId: "kayla", shift: UPCOMING[0], reason: "sick" },
  gaps: [
    {
      stationId: "bev",
      ...localWindow("2026-11-09", "10:00", "14:00", TZ),
      required: 1,
      scheduled: 0,
      missing: 1,
    },
  ],
  moves: [],
  remaining: [
    {
      stationId: "bev",
      ...localWindow("2026-11-09", "10:00", "14:00", TZ),
      missing: 1,
    },
  ],
  candidates: [
    {
      crewId: "ben",
      stationId: "bev",
      window: localWindow("2026-11-09", "10:00", "14:00", TZ),
      kind: "CALL_IN",
      isOvertime: false,
      reasons: ["Certified on Beverage/Barista", "No overtime"],
    },
  ],
};

describe.each(FAILURES)("when the LLM fails (%s)", (_name, transport) => {
  it("parseCallout uses keywords and asks to confirm", async () => {
    const r = await parseCallout(
      {
        message: "can't come in tomorrow, sick",
        crew: { id: "k", firstName: "Kayla" },
        now: NOW,
        timezone: TZ,
        shifts: UPCOMING,
      },
      { transport },
    );
    expect(r).toMatchObject({
      source: "fallback",
      isCallout: true,
      shiftId: "tue",
      reason: "sick",
      needsConfirmation: true,
    });
  });

  it("summarizePlan uses the template", async () => {
    const r = await summarizePlan(PLAN, { transport });
    expect(r.source).toBe("fallback");
    expect(r.summary).toContain(
      "Text first: Ben (call in) for Beverage/Barista Mon 10:00-14:00.",
    );
    expect(r.rationales).toEqual([
      "Certified on Beverage/Barista; No overtime",
    ]);
  });

  it("composeOffer uses the fixed template", async () => {
    const r = await composeOffer(
      {
        firstName: "Ben",
        storeName: "Maple & Mug",
        stationName: "Beverage/Barista",
        window: localWindow("2026-11-09", "10:00", "14:00", TZ),
        timezone: TZ,
        now: NOW,
        kind: "CALL_IN",
        isOvertime: false,
        replyMinutes: 2,
      },
      { transport },
    );
    expect(r).toMatchObject({
      source: "fallback",
      text: "Hi Ben, it's Maple & Mug. Can you come in for Beverage/Barista today 10:00-14:00? Reply YES or NO within 2 min.",
    });
  });

  it("classifyReply uses keywords", async () => {
    const r = await classifyReply(
      { offerText: "Reply YES or NO", reply: "where do I park?" },
      { transport },
    );
    expect(r).toMatchObject({ source: "fallback", intent: "QUESTION" });
  });
});
