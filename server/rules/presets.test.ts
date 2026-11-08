import { describe, expect, it } from "vitest";

import { Jurisdiction } from "@/server/generated/prisma/enums";

import { getPreset, PRESETS, ruleConfigDefaults } from "./presets";

const minutes = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};

describe("presets", () => {
  it("has a preset for every Jurisdiction enum value", () => {
    expect(Object.keys(PRESETS).sort()).toEqual(
      Object.values(Jurisdiction).sort(),
    );
    for (const j of Object.values(Jurisdiction)) {
      expect(getPreset(j).jurisdiction).toBe(j);
    }
  });

  it("Alberta: OT after 8h/day or 44h/week (greater of), 8h rest, under-15 limits", () => {
    expect(getPreset("ALBERTA")).toMatchObject({
      overtimeMethod: "GREATER_OF_DAILY_OR_WEEKLY",
      dailyOtHours: 8,
      weeklyOtHours: 44,
      minRestHours: 8,
      youthUnderAge: 15,
      youthMaxSchoolDayHours: 2,
      youthMaxSchoolWeekHours: null,
      youthMaxNonSchoolDayHours: 8,
      youthEarliestStart: "06:00",
      youthLatestEnd: "21:00",
    });
  });

  it("Ontario: weekly OT only at 44h, 11h rest, under-16 youth", () => {
    expect(getPreset("ONTARIO")).toMatchObject({
      overtimeMethod: "WEEKLY_ONLY",
      dailyOtHours: null,
      weeklyOtHours: 44,
      minRestHours: 11,
      youthUnderAge: 16,
    });
  });

  it("BC: daily OT at 8h then weekly at 40h", () => {
    expect(getPreset("BRITISH_COLUMBIA")).toMatchObject({
      overtimeMethod: "DAILY_THEN_WEEKLY",
      dailyOtHours: 8,
      weeklyOtHours: 40,
      youthMaxSchoolDayHours: 4,
      youthMaxSchoolWeekHours: 20,
    });
  });

  it("US federal: weekly OT at 40h, 14-15-year-olds 3h school days, 18h school weeks, not past 7pm", () => {
    expect(getPreset("US_FEDERAL")).toMatchObject({
      overtimeMethod: "WEEKLY_ONLY",
      dailyOtHours: null,
      weeklyOtHours: 40,
      youthUnderAge: 16,
      youthMaxSchoolDayHours: 3,
      youthMaxSchoolWeekHours: 18,
      youthLatestEnd: "19:00",
    });
  });

  it.each(Object.values(PRESETS))("$label is internally consistent", (p) => {
    expect(p.overtimeMethod === "WEEKLY_ONLY").toBe(p.dailyOtHours === null);
    if (p.dailyOtHours !== null)
      expect(p.dailyOtHours).toBeLessThan(p.weeklyOtHours);
    expect(minutes(p.youthEarliestStart)).toBeLessThan(
      minutes(p.youthLatestEnd),
    );
    expect(p.youthMaxSchoolDayHours).toBeLessThanOrEqual(
      p.youthMaxNonSchoolDayHours,
    );
    expect(p.youthUnderAge).toBeGreaterThan(0);
    expect(p.youthUnderAge).toBeLessThanOrEqual(18);
    expect(p.maxConsecutiveDays).toBeGreaterThanOrEqual(1);
    expect(p.maxConsecutiveDays).toBeLessThanOrEqual(7);
  });

  it("ruleConfigDefaults returns exactly the RuleConfig columns a preset sets", () => {
    expect(ruleConfigDefaults("ALBERTA")).toEqual({
      weeklyOtHours: 44,
      dailyOtHours: 8,
      minRestHours: 8,
      maxConsecutiveDays: 6,
      youthUnderAge: 15,
      youthMaxSchoolDayHours: 2,
      youthMaxSchoolWeekHours: null,
      youthLatestEnd: "21:00",
    });
  });
});
