import { describe, expect, it } from "vitest";

import { computeCoverage } from "@/server/rules/coverage";
import { addDays, localDate } from "@/server/rules/time";
import {
  CLOSE_TIME,
  OPEN_TIME,
  seedScenario,
} from "@/server/test/seed-scenario";
import { validateShifts } from "@/server/validation";

import { planAutofill, type AutofillInput } from "./autofill";

const s = seedScenario();
const tz = s.timezone;
const ctx: AutofillInput["ctx"] = {
  timezone: tz,
  config: s.config as AutofillInput["ctx"]["config"],
  preset: s.preset,
  rushWindows: s.rushWindows,
  stations: s.stations,
  coverageRules: s.coverageRules,
  openTime: OPEN_TIME,
  closeTime: CLOSE_TIME,
};
const days = Array.from({ length: 7 }, (_, i) => addDays("2026-11-09", i));
const shortSlots = (assignments: AutofillInput["assignments"], date: string) =>
  computeCoverage({
    date,
    timezone: tz,
    stations: s.stations,
    rules: s.coverageRules,
    assignments,
    openTime: OPEN_TIME,
    closeTime: CLOSE_TIME,
  }).slots.reduce((n, x) => n + Math.max(0, x.required - x.scheduled), 0);

describe("planAutofill", () => {
  // Empty Thursday: drop every shift that starts that day.
  const THU = "2026-11-12";
  const kept = s.shifts.filter((sh) => localDate(sh.start, tz) !== THU);
  const keptIds = new Set(kept.map((sh) => sh.id));
  const keptBlocks = s.assignments.filter((a) => keptIds.has(a.shiftId));
  const plan = planAutofill({
    ctx,
    crew: s.crew,
    shifts: kept,
    assignments: keptBlocks,
    schoolDays: s.schoolDays,
    days: [THU],
  });

  it("fills most of an emptied day", () => {
    expect(shortSlots(keptBlocks, THU)).toBeGreaterThan(100);
    const after = [
      ...keptBlocks,
      ...plan.fills.map((f, i) => ({
        id: `f${i}`,
        shiftId: `f${i}`,
        crewId: f.crewId,
        stationId: f.stationId,
        start: f.start,
        end: f.end,
      })),
    ];
    expect(plan.fills.length).toBeGreaterThan(5);
    expect(shortSlots(after, THU)).toBeLessThan(
      shortSlots(keptBlocks, THU) / 4,
    );
  });

  it("only creates shifts that pass every rule, with no overtime", () => {
    const fillShifts = plan.fills.map((f, i) => ({
      id: `fill-${i}`,
      crewId: f.crewId,
      start: f.start,
      end: f.end,
      breakMinutes: f.breakMinutes,
      status: "SCHEDULED" as const,
    }));
    const fillBlocks = plan.fills.map((f, i) => ({
      id: `fill-${i}-a`,
      shiftId: `fill-${i}`,
      crewId: f.crewId,
      stationId: f.stationId,
      start: f.start,
      end: f.end,
    }));
    const badges = validateShifts({
      ctx: {
        ...ctx,
        config: { ...s.config, offerTimeoutSec: 600, demoMode: false } as never,
      },
      crew: s.crew,
      shifts: [...kept, ...fillShifts],
      assignments: [...keptBlocks, ...fillBlocks],
      schoolDays: s.schoolDays,
    });
    const onFills = fillShifts.flatMap((f) =>
      (badges.get(f.id) ?? []).map((b) => `${f.crewId}: ${b.label}`),
    );
    expect(onFills).toEqual([]);
  });

  it("does nothing to a fully covered day", () => {
    const covered = planAutofill({
      ctx,
      crew: s.crew,
      shifts: s.shifts,
      assignments: s.assignments,
      schoolDays: s.schoolDays,
      days: ["2026-11-09"],
    });
    expect(covered).toEqual({ fills: [], unfilled: [] });
  });

  it("reports gaps it can't fill on the seeded weekend", () => {
    const weekend = planAutofill({
      ctx,
      crew: s.crew,
      shifts: s.shifts,
      assignments: s.assignments,
      schoolDays: s.schoolDays,
      days,
    });
    expect(weekend.unfilled.length).toBeGreaterThan(0);
    expect(weekend.unfilled[0]).toMatch(/\w+ \w{3} \d{2}:\d{2}-\d{2}:\d{2}/);
  });
});
