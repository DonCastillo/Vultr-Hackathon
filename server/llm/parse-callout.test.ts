import { describe, expect, it } from "vitest";

import { localWindow } from "@/server/rules/time";

import {
  calloutShiftLabel,
  parseCallout,
  type CalloutShift,
  type JsonRequest,
  type LlmTransport,
  type ParseCalloutRequest,
} from "./index";

const TZ = "America/Edmonton";

function fake(reply: string | ((r: JsonRequest) => Promise<string>)) {
  const requests: JsonRequest[] = [];
  const transport: LlmTransport = {
    provider: "anthropic",
    model: "fake-model",
    async completeJson(r) {
      requests.push(r);
      return {
        text: typeof reply === "string" ? reply : await reply(r),
        model: "fake-model",
      };
    },
  };
  return { transport, requests };
}

const shift = (
  id: string,
  date: string,
  start: string,
  end: string,
  stationNames: string[],
): CalloutShift => ({
  id,
  ...localWindow(date, start, end, TZ),
  stationNames,
});

// Kayla's shifts around the demo morning; she texts at 04:40 on Monday.
const SHIFTS = [
  shift("cuid-sun", "2026-11-08", "05:30", "14:00", ["Drive-Thru Order Taker"]), // already over
  shift("cuid-mon", "2026-11-09", "05:30", "14:00", [
    "Drive-Thru Order Taker",
    "Beverage/Barista",
  ]),
  shift("cuid-tue", "2026-11-10", "05:30", "14:00", ["Beverage/Barista"]),
  shift("cuid-fri", "2026-11-13", "05:30", "14:00", ["Front Counter/Till"]), // beyond 48h
];
const NOW = localWindow("2026-11-09", "04:40", "04:41", TZ).start;

const request = (
  over: Partial<ParseCalloutRequest> = {},
): ParseCalloutRequest => ({
  message: "hey sorry, woke up sick, can't make it in this morning",
  crew: { id: "kayla-id", firstName: "Kayla" },
  now: NOW,
  timezone: TZ,
  shifts: SHIFTS,
  ...over,
});

const llm = (o: object) =>
  JSON.stringify({
    isCallout: true,
    shiftId: "s1",
    reason: "sick",
    confidence: 0.95,
    ...o,
  });

describe("calloutShiftLabel", () => {
  it("shows day, date, local times and stations", () => {
    expect(calloutShiftLabel(SHIFTS[1], TZ)).toBe(
      "Mon Nov 9 05:30-14:00, Drive-Thru Order Taker then Beverage/Barista",
    );
  });
});

describe("parseCallout", () => {
  it("offers only shifts in progress or within 48h, as short ids, with the store-local time", async () => {
    const { transport, requests } = fake(llm({}));
    await parseCallout(request(), { transport });
    const user = requests[0].user;
    expect(user).toContain("Current time (store): Mon, Nov 9, 04:40");
    expect(user).toContain(
      "- s1: Mon Nov 9 05:30-14:00, Drive-Thru Order Taker then Beverage/Barista",
    );
    expect(user).toContain("- s2: Tue Nov 10 05:30-14:00, Beverage/Barista");
    expect(user).not.toContain("Nov 8");
    expect(user).not.toContain("Nov 13");
    expect(user).not.toContain("cuid-");
    expect(user).toContain("Sender: Kayla");
  });

  it("maps the model's short id back to the real shift and keeps the crew id from the caller", async () => {
    const { transport } = fake(llm({}));
    expect(await parseCallout(request(), { transport })).toMatchObject({
      crewId: "kayla-id",
      isCallout: true,
      shiftId: "cuid-mon",
      reason: "sick",
      confidence: 0.95,
      needsConfirmation: false,
      source: "llm",
      llm: { provider: "anthropic", model: "fake-model" },
    });
  });

  it("resolves 'tomorrow' to the second shift when the model says so", async () => {
    const { transport } = fake(llm({ shiftId: "s2" }));
    const r = await parseCallout(
      request({ message: "can't do tomorrow, sorry" }),
      { transport },
    );
    expect(r.shiftId).toBe("cuid-tue");
  });

  it("asks for confirmation when confidence is low or no shift was picked", async () => {
    const low = await parseCallout(request(), {
      transport: fake(llm({ confidence: 0.5 })).transport,
    });
    expect(low).toMatchObject({ shiftId: "cuid-mon", needsConfirmation: true });
    const unsure = await parseCallout(request(), {
      transport: fake(llm({ shiftId: null, confidence: 0.9 })).transport,
    });
    expect(unsure).toMatchObject({
      isCallout: true,
      shiftId: null,
      needsConfirmation: true,
    });
  });

  it("returns no shift or reason when the message isn't a call-out", async () => {
    const { transport } = fake(
      llm({
        isCallout: false,
        shiftId: "s1",
        reason: "running late",
        confidence: 0.9,
      }),
    );
    expect(
      await parseCallout(request({ message: "running 10 min late!" }), {
        transport,
      }),
    ).toMatchObject({
      isCallout: false,
      shiftId: null,
      reason: null,
      needsConfirmation: false,
      source: "llm",
    });
  });

  it("falls back to the next shift and asks to confirm when the model invents an id", async () => {
    const { transport } = fake(llm({ shiftId: "s9" }));
    expect(await parseCallout(request(), { transport })).toMatchObject({
      isCallout: true,
      shiftId: "cuid-mon",
      reason: "sick", // recovered by the keyword fallback
      confidence: 0,
      needsConfirmation: true,
      source: "fallback",
      llm: { error: "CHECK" },
    });
  });

  it("falls back on a timeout", async () => {
    const slow = fake(
      (r) =>
        new Promise((resolve) =>
          r.signal.addEventListener("abort", () => resolve("{}")),
        ),
    );
    const r = await parseCallout(request(), {
      transport: slow.transport,
      timeoutMs: 20,
    });
    expect(r).toMatchObject({
      source: "fallback",
      shiftId: "cuid-mon",
      needsConfirmation: true,
      llm: { error: "TIMEOUT" },
    });
  });

  it("falls back with no shift when the sender has nothing upcoming", async () => {
    const { transport } = fake("not json");
    const r = await parseCallout(request({ shifts: [SHIFTS[0]] }), {
      transport,
    });
    expect(r).toMatchObject({
      source: "fallback",
      shiftId: null,
      needsConfirmation: true,
      llm: { error: "BAD_JSON" },
    });
  });

  it("still offers a shift that has already started (calling out mid-shift)", async () => {
    const { transport, requests } = fake(llm({}));
    const midShift = localWindow("2026-11-09", "07:00", "07:01", TZ).start;
    await parseCallout(
      request({ now: midShift, message: "feeling awful, need to go home" }),
      { transport },
    );
    expect(requests[0].user).toContain("- s1: Mon Nov 9 05:30-14:00");
  });
});
