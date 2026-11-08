import { describe, expect, it } from "vitest";

import { getPreset } from "./presets";
import { addDays, localWindow } from "./time";
import type { ShiftInfo } from "./types";
import { ageOn, checkYouth, youthRules, type YouthInput } from "./youth";

const TZ = "America/Edmonton";
const SUN = "2026-11-08";
const MON = "2026-11-09"; // school day
const WED = "2026-11-11"; // Remembrance Day: no school
const SCHOOL_DAYS = [MON, addDays(MON, 1), addDays(MON, 3), addDays(MON, 4)];

const AB = youthRules(getPreset("ALBERTA"));
const US = youthRules(getPreset("US_FEDERAL"));

const counter = station();
function station(
  over: Partial<YouthInput["station"]> = {},
): YouthInput["station"] {
  return { name: "Front Counter/Till", youthRestricted: false, ...over };
}

/** Maya: 14, a student. */
const maya = {
  id: "maya",
  firstName: "Maya",
  birthdate: "2012-02-11",
  isStudent: true,
};

const work = (date: string, start: string, end: string, breakMinutes = 0) => ({
  ...localWindow(date, start, end, TZ),
  breakMinutes,
});

let n = 0;
const shift = (date: string, start: string, end: string): ShiftInfo => ({
  id: `s${n++}`,
  crewId: "maya",
  ...localWindow(date, start, end, TZ),
  breakMinutes: 0,
  status: "SCHEDULED",
});

const check = (over: Partial<YouthInput> = {}) =>
  checkYouth({
    crew: maya,
    station: counter,
    addition: work(MON, "16:00", "18:00"),
    shifts: [],
    schoolDays: SCHOOL_DAYS,
    rules: AB,
    timezone: TZ,
    ...over,
  });
const codes = (over: Partial<YouthInput> = {}) =>
  check(over).issues.map((i) => i.code);

describe("ageOn", () => {
  it("counts whole years and handles birthdays", () => {
    expect(ageOn("2012-02-11", MON)).toBe(14);
    expect(ageOn("2011-11-09", MON)).toBe(15); // birthday today
    expect(ageOn("2011-11-10", MON)).toBe(14); // birthday tomorrow
  });
});

describe("checkYouth (Alberta: under 15)", () => {
  it("doesn't apply to crew at or over the youth age", () => {
    const fifteen = { ...maya, birthdate: "2011-11-09" }; // turns 15 today
    expect(
      check({ crew: fifteen, addition: work(MON, "05:30", "14:00") }),
    ).toEqual({
      age: 15,
      isYouth: false,
      issues: [],
    });
  });

  it("allows 2h after school on a school day", () => {
    expect(check()).toEqual({ age: 14, isYouth: true, issues: [] });
  });

  it("blocks more than 2h on a school day (Maya covering Beverage 10-14)", () => {
    const r = check({ addition: work(MON, "10:00", "14:00") });
    expect(r.issues.map((i) => i.code)).toEqual(["YOUTH_SCHOOL_DAY_HOURS"]);
    expect(r.issues[0].message).toBe(
      "Maya (14) would work 4h on a school day; the limit is 2h.",
    );
  });

  it("counts other shifts on the same day toward the daily limit", () => {
    const shifts = [shift(MON, "16:00", "17:00")];
    expect(codes({ shifts, addition: work(MON, "18:00", "19:30") })).toEqual([
      "YOUTH_SCHOOL_DAY_HOURS",
    ]);
  });

  it("allows up to 8h on a non-school day", () => {
    expect(check({ addition: work(SUN, "08:00", "16:00") }).issues).toEqual([]);
    expect(check({ addition: work(WED, "08:00", "16:00") }).issues).toEqual([]);
  });

  it("blocks more than 8h on a non-school day", () => {
    expect(codes({ addition: work(SUN, "06:00", "15:00", 30) })).toEqual([
      "YOUTH_DAY_HOURS",
    ]);
  });

  it("uses the non-school limit for youth who aren't students", () => {
    const notStudent = { ...maya, isStudent: false };
    expect(
      check({ crew: notStudent, addition: work(MON, "10:00", "14:00") }).issues,
    ).toEqual([]);
  });

  it("blocks work before 06:00 or after 21:00", () => {
    expect(codes({ addition: work(SUN, "05:30", "10:00") })).toEqual([
      "YOUTH_HOURS_WINDOW",
    ]);
    expect(codes({ addition: work(SUN, "17:00", "21:30") })).toEqual([
      "YOUTH_HOURS_WINDOW",
    ]);
    expect(check({ addition: work(SUN, "13:00", "21:00") }).issues).toEqual([]);
  });

  it("blocks restricted stations (Oven)", () => {
    const oven = station({ name: "Oven & Baked Goods", youthRestricted: true });
    const r = check({ station: oven, addition: work(SUN, "10:00", "14:00") });
    expect(r.issues.map((i) => i.code)).toEqual(["YOUTH_RESTRICTED_STATION"]);
    expect(r.issues[0].message).toContain("restricted for crew under 15");
  });

  it("has no school-week cap in Alberta", () => {
    const shifts = [SUN, MON, addDays(MON, 1), addDays(MON, 3)].map((d) =>
      shift(d, "16:00", "18:00"),
    );
    expect(
      check({ shifts, addition: work(addDays(MON, 5), "08:00", "16:00") })
        .issues,
    ).toEqual([]);
  });

  it("reports every problem at once", () => {
    const oven = station({ name: "Oven & Baked Goods", youthRestricted: true });
    expect(
      codes({ station: oven, addition: work(MON, "05:30", "10:00") }),
    ).toEqual([
      "YOUTH_RESTRICTED_STATION",
      "YOUTH_HOURS_WINDOW",
      "YOUTH_SCHOOL_DAY_HOURS",
    ]);
  });
});

describe("checkYouth (US federal: under 16)", () => {
  const fifteen = { ...maya, birthdate: "2011-06-01" };

  it("applies to 15-year-olds", () => {
    expect(check({ crew: fifteen, rules: US }).isYouth).toBe(true);
  });

  it("allows 3h on a school day, not past 19:00", () => {
    expect(
      check({ crew: fifteen, rules: US, addition: work(MON, "15:30", "18:30") })
        .issues,
    ).toEqual([]);
    expect(
      codes({
        crew: fifteen,
        rules: US,
        addition: work(MON, "16:30", "19:30"),
      }),
    ).toEqual(["YOUTH_HOURS_WINDOW"]);
  });

  it("caps a school week at 18h", () => {
    // 3h on four school days + 6h Saturday = 18h; another hour on Sunday is too much.
    const shifts = [
      ...SCHOOL_DAYS.map((d) => shift(d, "15:30", "18:30")),
      shift(addDays(MON, 5), "09:00", "15:00"),
    ].map((s) => ({ ...s, crewId: "maya" }));
    const r = check({
      crew: fifteen,
      rules: US,
      shifts,
      addition: work(addDays(MON, 6), "10:00", "11:00"),
    });
    expect(r.issues.map((i) => i.code)).toEqual(["YOUTH_SCHOOL_WEEK_HOURS"]);
    expect(r.issues[0].message).toContain(
      "19h in a school week; the limit is 18h",
    );
  });
});

describe("youthRules", () => {
  it("lets RuleConfig override the overridable values", () => {
    const r = youthRules(getPreset("ALBERTA"), {
      youthMaxSchoolDayHours: 3,
      youthLatestEnd: "20:00",
    });
    expect(r).toMatchObject({
      youthMaxSchoolDayHours: 3,
      youthLatestEnd: "20:00",
      youthEarliestStart: "06:00",
      youthMaxNonSchoolDayHours: 8,
    });
  });

  it("keeps an explicit null weekly cap from RuleConfig", () => {
    expect(
      youthRules(getPreset("US_FEDERAL"), { youthMaxSchoolWeekHours: null })
        .youthMaxSchoolWeekHours,
    ).toBeNull();
  });
});
