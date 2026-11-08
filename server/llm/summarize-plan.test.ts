import { describe, expect, it } from "vitest";

import { demoCallout } from "@/server/test/seed-scenario";

import {
  summarizePlan,
  templatePlanSummary,
  type JsonRequest,
  type LlmTransport,
  type PlanFacts,
} from "./index";

function fake(reply: string) {
  const requests: JsonRequest[] = [];
  const transport: LlmTransport = {
    provider: "anthropic",
    model: "fake-model",
    async completeJson(r) {
      requests.push(r);
      return { text: reply, model: "fake-model" };
    },
  };
  return { transport, requests };
}

/** PlanFacts built from the real demo pipeline (seed -> impact -> Plan A -> Plan B). */
async function demoFacts(): Promise<PlanFacts> {
  const { s, kaylaShift, impact, planA, rankings } = await demoCallout();
  return {
    storeName: "Maple & Mug Coffee Co.",
    timezone: s.timezone,
    stationNames: Object.fromEntries(s.stations.map((st) => [st.id, st.name])),
    crewNames: Object.fromEntries(s.crew.map((c) => [c.id, c.firstName])),
    callOut: { crewId: "Kayla", shift: kaylaShift, reason: "sick" },
    gaps: impact.shortfalls,
    moves: planA.moves,
    remaining: planA.remainingShortfall,
    candidates: rankings.flatMap(({ gap, result }) =>
      result.candidates.map((c) => ({
        crewId: c.crewId,
        stationId: gap.stationId,
        window: gap,
        kind: c.kind,
        isOvertime: c.isOvertime,
        reasons: c.reasons,
      })),
    ),
  };
}

describe("summarizePlan on the demo call-out", () => {
  it("sends the rule results as plain lines, with short candidate ids and no database ids", async () => {
    const facts = await demoFacts();
    const { transport, requests } = fake(
      JSON.stringify({ summary: "ok", rationales: [] }),
    );
    await summarizePlan(facts, { transport });
    const user = requests[0].user;
    expect(user).toContain("Call-out: Kayla, Mon 05:30-14:00 (sick)");
    expect(user).toContain(
      "- Beverage/Barista Mon 10:00-14:00: 0 of 1 scheduled (short 1)",
    );
    expect(user).toContain(
      "- Drive-Thru Order Taker Mon 05:30-10:00: 1 of 2 scheduled (short 1)",
    );
    expect(user).toContain(
      "- Aisha: Lobby/Dishes/Restock -> Drive-Thru Order Taker Mon 05:30-10:00",
    );
    expect(user).toContain("- Lobby/Dishes/Restock Mon 05:30-10:00 (short 1)");
    expect(user).toContain(
      "1. [c1] Ben, CALL_IN for Beverage/Barista Mon 10:00-14:00: Certified on Beverage/Barista",
    );
    expect(user).toContain(
      "4. [c4] Sofia, EXTEND for Beverage/Barista Mon 10:00-14:00 (overtime, needs approval)",
    );
    expect(user).not.toMatch(/shift-\d|a-\d+-\d/);
  });

  it("returns the model's summary and maps rationales back to the candidates in order", async () => {
    const facts = await demoFacts();
    const { transport } = fake(
      JSON.stringify({
        summary:
          "Kayla is out sick. Aisha moves to headset; text Ben first for Beverage.",
        rationales: [
          { id: "c2", rationale: "Noah is certified and rested by 10:00." },
          {
            id: "c1",
            rationale: "Ben is certified, free and has no overtime.",
          },
        ],
      }),
    );
    const r = await summarizePlan(facts, { transport });
    expect(r.source).toBe("llm");
    expect(r.summary).toBe(
      "Kayla is out sick. Aisha moves to headset; text Ben first for Beverage.",
    );
    expect(r.rationales).toHaveLength(facts.candidates.length);
    expect(r.rationales[0]).toBe("Ben is certified, free and has no overtime.");
    expect(r.rationales[1]).toBe("Noah is certified and rested by 10:00.");
    // The model skipped Hannah and Sofia: their rule reasons fill in.
    expect(r.rationales[3]).toContain("Overtime: +1.5h");
  });

  it("falls back to the template when the model fails", async () => {
    const facts = await demoFacts();
    const r = await summarizePlan(facts, {
      transport: fake("no json here").transport,
    });
    expect(r).toMatchObject({ source: "fallback", llm: { error: "BAD_JSON" } });
    expect(r.summary).toBe(templatePlanSummary(facts).summary);
  });
});

describe("templatePlanSummary", () => {
  it("states the call-out, gaps, move, first text and what stays uncovered", async () => {
    const t = templatePlanSummary(await demoFacts());
    expect(t.summary).toBe(
      [
        "Kayla, Mon 05:30-14:00 (sick) called out.",
        "Short: Beverage/Barista Mon 10:00-14:00: 0 of 1 scheduled (short 1); Drive-Thru Order Taker Mon 05:30-10:00: 1 of 2 scheduled (short 1).",
        "Move: Aisha: Lobby/Dishes/Restock -> Drive-Thru Order Taker Mon 05:30-10:00.",
        "Text first: Ben (call in) for Beverage/Barista Mon 10:00-14:00.",
        "Still uncovered: Beverage/Barista Mon 10:00-14:00 (short 1); Lobby/Dishes/Restock Mon 05:30-10:00 (short 1).",
      ].join(" "),
    );
    expect(t.rationales[0]).toBe(
      "Certified on Beverage/Barista; Off duty and available Mon 10:00-14:00; No overtime (44h this week); 0 pickups in the last 30 days; Reliability 92%; 5 years with the store",
    );
  });

  it("handles a plan with no moves and no candidates", async () => {
    const facts = {
      ...(await demoFacts()),
      moves: [],
      candidates: [],
      remaining: [],
    };
    expect(templatePlanSummary(facts).summary).toContain(
      "Fully covered after the moves.",
    );
    expect(templatePlanSummary(facts).summary).not.toContain("Text first");
  });
});
