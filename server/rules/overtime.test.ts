import { describe, expect, it } from "vitest";

import {
  checkOvertime,
  summarizeWeek,
  weekStartOf,
  type OvertimeRules,
} from "./overtime";
import { getPreset } from "./presets";
import { addDays, localWindow } from "./time";
import type { ShiftInfo } from "./types";

const TZ = "America/Edmonton";
const MON = "2026-11-09";

const rulesFor = (j: Parameters<typeof getPreset>[0]): OvertimeRules => {
  const p = getPreset(j);
  return {
    method: p.overtimeMethod,
    dailyOtHours: p.dailyOtHours,
    weeklyOtHours: p.weeklyOtHours,
  };
};
const AB = rulesFor("ALBERTA");
const ON = rulesFor("ONTARIO");
const BC = rulesFor("BRITISH_COLUMBIA");
const US = rulesFor("US_FEDERAL");

let n = 0;
const shift = (
  date: string,
  start: string,
  end: string,
  breakMinutes = 0,
  over: Partial<ShiftInfo> = {},
): ShiftInfo => ({
  id: `s${n++}`,
  crewId: "c",
  ...localWindow(date, start, end, TZ),
  breakMinutes,
  status: "SCHEDULED",
  ...over,
});

/** `count` days from Monday, each start-end with no break. */
const days = (count: number, start: string, end: string) =>
  Array.from({ length: count }, (_, i) => shift(addDays(MON, i), start, end));

const week = (pieces: ShiftInfo[], rules: OvertimeRules) =>
  summarizeWeek(pieces, weekStartOf(MON), rules, TZ);

describe("summarizeWeek: methods", () => {
  // 5 x 10h = 50h: the example from Alberta's guidance.
  const fiveTens = () => days(5, "06:00", "16:00");

  it("Alberta pays the greater of daily (10h) and weekly (6h) overtime", () => {
    expect(week(fiveTens(), AB)).toMatchObject({
      weekHours: 50,
      dailyOtHours: 10,
      weeklyOtHours: 6,
      otHours: 10,
    });
  });

  it("Alberta: 6 x 8h has no daily OT but 4h weekly OT", () => {
    expect(week(days(6, "06:00", "14:00"), AB)).toMatchObject({
      dailyOtHours: 0,
      weeklyOtHours: 4,
      otHours: 4,
    });
  });

  it("Ontario counts weekly overtime only (50 - 44 = 6h)", () => {
    expect(week(fiveTens(), ON)).toMatchObject({ dailyOtHours: 0, otHours: 6 });
  });

  it("BC: daily OT first, weekly OT only on regular hours (5 x 10h -> 10h)", () => {
    expect(week(fiveTens(), BC)).toMatchObject({
      dailyOtHours: 10,
      weeklyOtHours: 0,
      otHours: 10,
    });
  });

  it("BC: 6 x 8h -> 8h weekly OT, no daily", () => {
    expect(week(days(6, "06:00", "14:00"), BC)).toMatchObject({
      dailyOtHours: 0,
      weeklyOtHours: 8,
      otHours: 8,
    });
  });

  it("BC: 5 x 9h -> 5h daily + 0h weekly (regular hours are exactly 40)", () => {
    expect(week(days(5, "06:00", "15:00"), BC)).toMatchObject({
      dailyOtHours: 5,
      weeklyOtHours: 0,
      otHours: 5,
    });
  });

  it("US federal: OT after 40h a week", () => {
    expect(
      week(
        [
          ...days(5, "06:00", "14:00"),
          shift(addDays(MON, 5), "06:00", "08:00"),
        ],
        US,
      ),
    ).toMatchObject({
      weekHours: 42,
      otHours: 2,
    });
  });

  it("subtracts unpaid breaks: 05:30-14:00 with 30 min is 8h, no daily OT", () => {
    const s = shift(MON, "05:30", "14:00", 30);
    expect(week([s], AB)).toMatchObject({
      weekHours: 8,
      dailyOtHours: 0,
      otHours: 0,
    });
  });

  it("only counts the week in question", () => {
    const lastSunday = shift(addDays(MON, -1), "06:00", "16:00");
    const nextMonday = shift(addDays(MON, 7), "06:00", "16:00");
    expect(week([lastSunday, nextMonday], AB).weekHours).toBe(0);
  });

  it("puts an overnight shift on the day it starts", () => {
    const bake = shift(MON, "22:30", "06:30", 30);
    expect(week([bake], AB).dailyHours).toEqual({ [MON]: 7.5 });
  });
});

describe("checkOvertime", () => {
  const crew = { id: "c", firstName: "Sofia", maxWeeklyHours: null };

  it("Sofia: extending 05:00-10:00 to 14:00 on a 41.5h week is OT (9h day, 45.5h week)", () => {
    // Her seeded week: the 5h demo-day shift, one 4.5h day, four 8h days = 41.5h.
    const shifts = [
      shift(MON, "05:00", "10:00"),
      shift(addDays(MON, 1), "05:30", "10:00"),
      ...[2, 3, 4, 5].map((i) => shift(addDays(MON, i), "05:30", "14:00", 30)),
    ];
    const r = checkOvertime({
      crew,
      shifts,
      addition: { ...localWindow(MON, "10:00", "14:00", TZ), breakMinutes: 0 },
      rules: AB,
      timezone: TZ,
    });
    expect(r.before).toMatchObject({ weekHours: 41.5, otHours: 0 });
    expect(r.after).toMatchObject({
      weekHours: 45.5,
      dailyOtHours: 1,
      weeklyOtHours: 1.5,
      otHours: 1.5,
    });
    expect(r.addedOtHours).toBe(1.5);
    expect(r.isOvertime).toBe(true);
    expect(r.issues).toHaveLength(1);
    expect(r.issues[0]).toMatchObject({ code: "OVERTIME", severity: "warn" });
    expect(r.issues[0].message).toBe(
      "Sofia would work 9h that day (OT after 8h) and 45.5h this week (OT after 44h): 1.5h overtime. Needs manager approval.",
    );
  });

  it("Ben: a 4h call-in on a 32h week is not OT", () => {
    const r = checkOvertime({
      crew: { ...crew, firstName: "Ben" },
      shifts: days(4, "05:30", "14:00").map((s) => ({
        ...s,
        breakMinutes: 30,
      })),
      addition: {
        ...localWindow(addDays(MON, 4), "10:00", "14:00", TZ),
        breakMinutes: 0,
      },
      rules: AB,
      timezone: TZ,
    });
    expect(r.after.weekHours).toBe(36);
    expect(r).toMatchObject({ addedOtHours: 0, isOvertime: false, issues: [] });
  });

  it("only reports overtime the addition adds, not what was already there", () => {
    const r = checkOvertime({
      crew,
      shifts: days(5, "06:00", "16:00"), // already 10h daily OT
      addition: {
        ...localWindow(addDays(MON, 5), "06:00", "08:00", TZ),
        breakMinutes: 0,
      },
      rules: AB,
      timezone: TZ,
    });
    expect(r.before.otHours).toBe(10);
    expect(r.after).toMatchObject({ weeklyOtHours: 8, otHours: 10 });
    expect(r.addedOtHours).toBe(0);
    expect(r.isOvertime).toBe(false);
  });

  it("ignores other crew, cancelled and called-out shifts, and ignored ids", () => {
    const shifts = [
      ...days(5, "06:00", "15:00").map((s) => ({ ...s, crewId: "other" })),
      shift(MON, "06:00", "16:00", 0, { status: "CANCELLED" }),
      shift(addDays(MON, 1), "06:00", "16:00", 0, { status: "CALLED_OUT" }),
      shift(addDays(MON, 2), "06:00", "16:00", 0, { id: "replaced" }),
    ];
    const r = checkOvertime({
      crew,
      shifts,
      addition: {
        ...localWindow(addDays(MON, 2), "06:00", "14:00", TZ),
        breakMinutes: 0,
      },
      rules: AB,
      timezone: TZ,
      ignoreShiftIds: ["replaced"],
    });
    expect(r.after.weekHours).toBe(8);
    expect(r.isOvertime).toBe(false);
  });

  it("warns when the crew member's own weekly cap is exceeded (Wei, 20h)", () => {
    const r = checkOvertime({
      crew: { id: "c", firstName: "Wei", maxWeeklyHours: 20 },
      shifts: days(2, "05:30", "14:00").map((s) => ({
        ...s,
        breakMinutes: 30,
      })),
      addition: {
        ...localWindow(addDays(MON, 3), "05:30", "10:00", TZ),
        breakMinutes: 0,
      },
      rules: AB,
      timezone: TZ,
    });
    expect(r.isOvertime).toBe(false);
    expect(r.issues).toMatchObject([
      { code: "OVER_PREFERRED_HOURS", severity: "warn" },
    ]);
    expect(r.issues[0].message).toContain("20.5h");
  });

  it("supports a Sunday week start", () => {
    expect(weekStartOf(MON, 0)).toBe(addDays(MON, -1));
    expect(weekStartOf(MON)).toBe(MON);
    expect(weekStartOf(addDays(MON, 6))).toBe(MON);
  });
});
