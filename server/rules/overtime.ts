import "server-only";

import type { OvertimeMethod } from "./presets";
import { addDays, localDate, weekdayOf } from "./time";
import {
  isWorkedShift,
  type Interval,
  type IsoDate,
  type RuleIssue,
  type ShiftInfo,
} from "./types";

// Overtime under each jurisdiction's method. Overtime isn't forbidden: it needs the
// manager's approval (CallOut.otApproved), so these issues are warnings and ranking uses
// `isOvertime` to put no-OT candidates first.
//
// Hours are paid hours: shift length minus the unpaid break. A shift counts toward the
// store-local date it starts on, and weeks run from `weekStartsOn` (default Monday).

export type OvertimeCode = "OVERTIME" | "OVER_PREFERRED_HOURS";
export type OvertimeIssue = RuleIssue<OvertimeCode>;

export interface OvertimeRules {
  method: OvertimeMethod;
  /** null = no daily overtime. */
  dailyOtHours: number | null;
  weeklyOtHours: number;
}

export interface WeekSummary {
  weekStart: IsoDate;
  /** Paid hours per store-local date in the week (only dates with work). */
  dailyHours: Record<IsoDate, number>;
  weekHours: number;
  /** Hours over the daily limit, summed over the week. */
  dailyOtHours: number;
  /** Hours over the weekly limit (BC: regular hours only). */
  weeklyOtHours: number;
  /** Overtime hours under the jurisdiction's method. */
  otHours: number;
}

const round = (h: number) => Math.round(h * 100) / 100;

export function paidHours(s: Interval & { breakMinutes: number }): number {
  const hours =
    (s.end.getTime() - s.start.getTime()) / 3_600_000 - s.breakMinutes / 60;
  return Math.max(0, hours);
}

/** First day of the week containing `date`. */
export function weekStartOf(date: IsoDate, weekStartsOn = 1): IsoDate {
  return addDays(date, -((weekdayOf(date) - weekStartsOn + 7) % 7));
}

type PaidPiece = Interval & { breakMinutes: number };

/** Hours and overtime for the week starting `weekStart`, from the given work pieces. */
export function summarizeWeek(
  pieces: PaidPiece[],
  weekStart: IsoDate,
  rules: OvertimeRules,
  timezone: string,
): WeekSummary {
  const weekEnd = addDays(weekStart, 7);
  const dailyHours: Record<IsoDate, number> = {};
  for (const p of pieces) {
    const date = localDate(p.start, timezone);
    if (date < weekStart || date >= weekEnd) continue;
    dailyHours[date] = (dailyHours[date] ?? 0) + paidHours(p);
  }
  const days = Object.values(dailyHours);
  const weekHours = days.reduce((a, b) => a + b, 0);

  const limit = rules.dailyOtHours;
  const dailyOt =
    limit === null ? 0 : days.reduce((a, h) => a + Math.max(0, h - limit), 0);
  const regular =
    limit === null
      ? weekHours
      : days.reduce((a, h) => a + Math.min(h, limit), 0);

  let weeklyOt: number;
  let otHours: number;
  switch (rules.method) {
    case "WEEKLY_ONLY":
      weeklyOt = Math.max(0, weekHours - rules.weeklyOtHours);
      otHours = weeklyOt;
      break;
    case "GREATER_OF_DAILY_OR_WEEKLY":
      weeklyOt = Math.max(0, weekHours - rules.weeklyOtHours);
      otHours = Math.max(dailyOt, weeklyOt);
      break;
    case "DAILY_THEN_WEEKLY":
      // Weekly OT only counts regular hours, so no hour is counted twice.
      weeklyOt = Math.max(0, regular - rules.weeklyOtHours);
      otHours = dailyOt + weeklyOt;
      break;
  }

  return {
    weekStart,
    dailyHours: Object.fromEntries(
      Object.entries(dailyHours).map(([d, h]) => [d, round(h)]),
    ),
    weekHours: round(weekHours),
    dailyOtHours: round(dailyOt),
    weeklyOtHours: round(weeklyOt),
    otHours: round(otHours),
  };
}

export interface OvertimeInput {
  crew: { id: string; firstName: string; maxWeeklyHours: number | null };
  /** The crew member's shifts around the week (non-worked ones are ignored). */
  shifts: ShiftInfo[];
  /** The proposed new shift or extension, with its own unpaid break. */
  addition: PaidPiece;
  rules: OvertimeRules;
  timezone: string;
  weekStartsOn?: number;
  /** Shifts to leave out, e.g. one the addition replaces. */
  ignoreShiftIds?: string[];
}

export interface OvertimeResult {
  before: WeekSummary;
  after: WeekSummary;
  /** Overtime hours the addition creates (after minus before). */
  addedOtHours: number;
  isOvertime: boolean;
  issues: OvertimeIssue[];
}

/** What adding this work does to the crew member's overtime for that week. */
export function checkOvertime(input: OvertimeInput): OvertimeResult {
  const { crew, addition, rules, timezone, weekStartsOn = 1 } = input;
  const ignore = input.ignoreShiftIds ?? [];
  const existing = input.shifts.filter(
    (s) => s.crewId === crew.id && isWorkedShift(s) && !ignore.includes(s.id),
  );
  const weekStart = weekStartOf(
    localDate(addition.start, timezone),
    weekStartsOn,
  );
  const before = summarizeWeek(existing, weekStart, rules, timezone);
  const after = summarizeWeek(
    [...existing, addition],
    weekStart,
    rules,
    timezone,
  );
  const addedOtHours = round(Math.max(0, after.otHours - before.otHours));

  const issues: OvertimeIssue[] = [];
  if (addedOtHours > 0) {
    const date = localDate(addition.start, timezone);
    const reasons: string[] = [];
    if (
      rules.dailyOtHours !== null &&
      (after.dailyHours[date] ?? 0) > rules.dailyOtHours
    ) {
      reasons.push(
        `${after.dailyHours[date]}h that day (OT after ${rules.dailyOtHours}h)`,
      );
    }
    if (after.weekHours > rules.weeklyOtHours) {
      reasons.push(
        `${after.weekHours}h this week (OT after ${rules.weeklyOtHours}h)`,
      );
    }
    issues.push({
      code: "OVERTIME",
      severity: "warn",
      message: `${crew.firstName} would work ${reasons.join(" and ")}: ${addedOtHours}h overtime. Needs manager approval.`,
    });
  }
  if (crew.maxWeeklyHours !== null && after.weekHours > crew.maxWeeklyHours) {
    issues.push({
      code: "OVER_PREFERRED_HOURS",
      severity: "warn",
      message: `${crew.firstName} prefers at most ${crew.maxWeeklyHours}h a week; this makes ${after.weekHours}h.`,
    });
  }

  return { before, after, addedOtHours, isOvertime: addedOtHours > 0, issues };
}
