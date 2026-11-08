import "server-only";

import { paidHours, weekStartOf } from "./overtime";
import type { RulePreset, TimeOfDay } from "./presets";
import { addDays, localDate, localWindow } from "./time";
import {
  isWorkedShift,
  type CrewInfo,
  type Interval,
  type IsoDate,
  type RuleIssue,
  type ShiftInfo,
  type StationInfo,
} from "./types";

// Youth labour limits for crew younger than `youthUnderAge` (Alberta: under 15).
// - Restricted stations (Oven, Overnight Baker) are off limits.
// - Work must fall between `youthEarliestStart` and `youthLatestEnd` (AB 06:00-21:00).
// - Students on school days: at most `youthMaxSchoolDayHours` that day (AB 2h).
//   Other days (or non-students): at most `youthMaxNonSchoolDayHours` (AB 8h).
// - In weeks with a school day: at most `youthMaxSchoolWeekHours` (AB none; BC 20h, US 18h).
// Day and week totals include the crew member's other shifts. All issues block.

export type YouthCode =
  | "YOUTH_RESTRICTED_STATION"
  | "YOUTH_HOURS_WINDOW"
  | "YOUTH_SCHOOL_DAY_HOURS"
  | "YOUTH_DAY_HOURS"
  | "YOUTH_SCHOOL_WEEK_HOURS";

export type YouthIssue = RuleIssue<YouthCode>;

export interface YouthRules {
  youthUnderAge: number;
  youthMaxSchoolDayHours: number;
  youthMaxSchoolWeekHours: number | null;
  youthMaxNonSchoolDayHours: number;
  youthEarliestStart: TimeOfDay;
  youthLatestEnd: TimeOfDay;
}

/**
 * The store's youth rules: RuleConfig's overridable values on top of the preset's
 * fixed ones (earliest start, non-school-day cap).
 */
export function youthRules(
  preset: RulePreset,
  config: Partial<
    Pick<
      YouthRules,
      | "youthUnderAge"
      | "youthMaxSchoolDayHours"
      | "youthMaxSchoolWeekHours"
      | "youthLatestEnd"
    >
  > = {},
): YouthRules {
  return {
    youthUnderAge: config.youthUnderAge ?? preset.youthUnderAge,
    youthMaxSchoolDayHours:
      config.youthMaxSchoolDayHours ?? preset.youthMaxSchoolDayHours,
    youthMaxSchoolWeekHours:
      config.youthMaxSchoolWeekHours !== undefined
        ? config.youthMaxSchoolWeekHours
        : preset.youthMaxSchoolWeekHours,
    youthMaxNonSchoolDayHours: preset.youthMaxNonSchoolDayHours,
    youthEarliestStart: preset.youthEarliestStart,
    youthLatestEnd: config.youthLatestEnd ?? preset.youthLatestEnd,
  };
}

/** Age in whole years on a calendar date. */
export function ageOn(birthdate: IsoDate, date: IsoDate): number {
  const [by, bm, bd] = birthdate.split("-").map(Number);
  const [y, m, d] = date.split("-").map(Number);
  return y - by - (m < bm || (m === bm && d < bd) ? 1 : 0);
}

export interface YouthInput {
  crew: Pick<CrewInfo, "id" | "firstName" | "birthdate" | "isStudent">;
  station: Pick<StationInfo, "name" | "youthRestricted">;
  /** The proposed work, with its own unpaid break. */
  addition: Interval & { breakMinutes: number };
  /** The crew member's other shifts around the week. */
  shifts: ShiftInfo[];
  /** Dates that count as school days (SchoolDay rows). */
  schoolDays: Iterable<IsoDate>;
  rules: YouthRules;
  timezone: string;
  weekStartsOn?: number;
  ignoreShiftIds?: string[];
}

export interface YouthResult {
  age: number;
  isYouth: boolean;
  issues: YouthIssue[];
}

const round = (h: number) => Math.round(h * 100) / 100;

export function checkYouth(input: YouthInput): YouthResult {
  const { crew, station, addition, rules, timezone, weekStartsOn = 1 } = input;
  const date = localDate(addition.start, timezone);
  const age = ageOn(crew.birthdate, date);
  if (age >= rules.youthUnderAge) return { age, isYouth: false, issues: [] };

  const issues: YouthIssue[] = [];
  const who = `${crew.firstName} (${age})`;

  if (station.youthRestricted) {
    issues.push({
      code: "YOUTH_RESTRICTED_STATION",
      severity: "block",
      message: `${who} can't work ${station.name}: it's restricted for crew under ${rules.youthUnderAge}.`,
    });
  }

  const allowed = localWindow(
    date,
    rules.youthEarliestStart,
    rules.youthLatestEnd,
    timezone,
  );
  if (addition.start < allowed.start || addition.end > allowed.end) {
    issues.push({
      code: "YOUTH_HOURS_WINDOW",
      severity: "block",
      message: `${who} can only work ${rules.youthEarliestStart}-${rules.youthLatestEnd}.`,
    });
  }

  const ignore = input.ignoreShiftIds ?? [];
  const others = input.shifts.filter(
    (s) => s.crewId === crew.id && isWorkedShift(s) && !ignore.includes(s.id),
  );
  const pieces = [...others, addition];
  const hoursOn = (d: IsoDate) =>
    round(
      pieces
        .filter((p) => localDate(p.start, timezone) === d)
        .reduce((h, p) => h + paidHours(p), 0),
    );
  const schoolDays = new Set(input.schoolDays);

  const schoolDay = crew.isStudent && schoolDays.has(date);
  const dayCap = schoolDay
    ? rules.youthMaxSchoolDayHours
    : rules.youthMaxNonSchoolDayHours;
  const dayHours = hoursOn(date);
  if (dayHours > dayCap) {
    issues.push({
      code: schoolDay ? "YOUTH_SCHOOL_DAY_HOURS" : "YOUTH_DAY_HOURS",
      severity: "block",
      message: `${who} would work ${dayHours}h on ${schoolDay ? "a school day" : date}; the limit is ${dayCap}h.`,
    });
  }

  const weekCap = rules.youthMaxSchoolWeekHours;
  if (weekCap !== null && crew.isStudent) {
    const weekStart = weekStartOf(date, weekStartsOn);
    const week = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
    if (week.some((d) => schoolDays.has(d))) {
      const weekHours = round(week.reduce((h, d) => h + hoursOn(d), 0));
      if (weekHours > weekCap) {
        issues.push({
          code: "YOUTH_SCHOOL_WEEK_HOURS",
          severity: "block",
          message: `${who} would work ${weekHours}h in a school week; the limit is ${weekCap}h.`,
        });
      }
    }
  }

  return { age, isYouth: true, issues };
}
