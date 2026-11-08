import "server-only";

import type { StoreContext } from "@/server/data";
import { checkEligibility } from "@/server/rules/eligibility";
import { summarizeWeek, weekStartOf } from "@/server/rules/overtime";
import { localDate } from "@/server/rules/time";
import {
  isWorkedShift,
  type AssignmentInfo,
  type CrewInfo,
  type IsoDate,
  type RuleIssue,
  type ShiftInfo,
  type StationInfo,
} from "@/server/rules/types";
import { checkYouth, youthRules } from "@/server/rules/youth";

// Live validation badges for the schedule (task 4.6): every worked shift is checked
// with the same rules the agent uses. Pure: callers load the data.

export type BadgeKind =
  | "OT"
  | "UNTRAINED"
  | "YOUTH"
  | "CLOPEN"
  | "UNAVAILABLE"
  | "TIME_OFF"
  | "CERT"
  | "OVERLAP"
  | "DAYS"
  | "PREF_HOURS"
  | "INACTIVE";

export interface Badge {
  kind: BadgeKind;
  label: string;
  severity: "block" | "warn";
  message: string;
}

const BADGE_FOR_CODE: Record<string, { kind: BadgeKind; label: string }> = {
  INACTIVE: { kind: "INACTIVE", label: "Inactive" },
  UNTRAINED: { kind: "UNTRAINED", label: "Untrained" },
  TRAINEE_AT_RUSH: { kind: "UNTRAINED", label: "Trainee alone" },
  CERT_MISSING: { kind: "CERT", label: "No cert" },
  CERT_EXPIRED: { kind: "CERT", label: "Cert expired" },
  UNAVAILABLE: { kind: "UNAVAILABLE", label: "Unavailable" },
  TIME_OFF: { kind: "TIME_OFF", label: "Time off" },
  TIME_OFF_REQUESTED: { kind: "TIME_OFF", label: "PTO requested" },
  OVERLAP: { kind: "OVERLAP", label: "Overlap" },
  REST_GAP: { kind: "CLOPEN", label: "Clopen" },
  CONSECUTIVE_DAYS: { kind: "DAYS", label: "Too many days" },
  YOUTH_RESTRICTED_STATION: { kind: "YOUTH", label: "Youth station" },
  YOUTH_HOURS_WINDOW: { kind: "YOUTH", label: "Youth hours" },
  YOUTH_SCHOOL_DAY_HOURS: { kind: "YOUTH", label: "Youth school day" },
  YOUTH_DAY_HOURS: { kind: "YOUTH", label: "Youth day limit" },
  YOUTH_SCHOOL_WEEK_HOURS: { kind: "YOUTH", label: "Youth week limit" },
  OVERTIME: { kind: "OT", label: "OT" },
  OVER_PREFERRED_HOURS: { kind: "PREF_HOURS", label: "Over pref. hours" },
};

function toBadge(issue: RuleIssue): Badge {
  const b = BADGE_FOR_CODE[issue.code] ?? {
    kind: "UNAVAILABLE" as const,
    label: issue.code,
  };
  return { ...b, severity: issue.severity, message: issue.message };
}

export interface ValidationInput {
  ctx: Pick<StoreContext, "timezone" | "config" | "preset" | "rushWindows"> & {
    stations: StationInfo[];
  };
  crew: CrewInfo[];
  shifts: ShiftInfo[];
  assignments: AssignmentInfo[];
  schoolDays: IsoDate[];
  weekStartsOn?: number;
}

/** Badges per shift id (only shifts that have at least one). */
export function validateShifts(input: ValidationInput): Map<string, Badge[]> {
  const { ctx, crew, assignments, schoolDays } = input;
  const tz = ctx.timezone;
  const weekStartsOn = input.weekStartsOn ?? 1;
  const crewById = new Map(crew.map((c) => [c.id, c]));
  const stationById = new Map(ctx.stations.map((s) => [s.id, s]));
  const worked = input.shifts.filter(isWorkedShift);
  const youth = youthRules(ctx.preset, ctx.config);
  const overtime = {
    method: ctx.preset.overtimeMethod,
    dailyOtHours: ctx.config.dailyOtHours,
    weeklyOtHours: ctx.config.weeklyOtHours,
  };
  const result = new Map<string, Badge[]>();

  for (const shift of worked) {
    const c = crewById.get(shift.crewId);
    if (!c) continue;
    const mine = worked.filter((s) => s.crewId === c.id);
    const badges: Badge[] = [];
    const seen = new Set<string>();
    const add = (issue: RuleIssue) => {
      const b = toBadge(issue);
      const key = `${b.label}|${b.message}`;
      if (!seen.has(key)) {
        seen.add(key);
        badges.push(b);
      }
    };

    for (const block of assignments.filter((a) => a.shiftId === shift.id)) {
      const station = stationById.get(block.stationId);
      if (!station) continue;
      const certified = assignments.filter((a) => {
        if (a.stationId !== block.stationId || a.crewId === c.id) return false;
        const level = crewById.get(a.crewId)?.stations[a.stationId];
        return level === "CERTIFIED" || level === "TRAINER";
      });
      checkEligibility({
        crew: c,
        station,
        window: block,
        shifts: mine,
        timezone: tz,
        minRestHours: ctx.config.minRestHours,
        maxConsecutiveDays: ctx.config.maxConsecutiveDays,
        rushWindows: ctx.rushWindows,
        certifiedCoverage: certified,
        ignoreShiftIds: [shift.id],
      }).issues.forEach(add);
      checkYouth({
        crew: c,
        station,
        addition: { ...block, breakMinutes: 0 },
        shifts: [],
        schoolDays,
        rules: youth,
        timezone: tz,
        weekStartsOn,
      })
        .issues.filter((i) => i.code === "YOUTH_RESTRICTED_STATION")
        .forEach(add);
    }

    // Youth hour limits and overtime look at the whole shift against the rest of the week.
    checkYouth({
      crew: c,
      station: { name: "", youthRestricted: false },
      addition: shift,
      shifts: mine,
      schoolDays,
      rules: youth,
      timezone: tz,
      weekStartsOn,
      ignoreShiftIds: [shift.id],
    }).issues.forEach(add);

    // OT: flag the shifts that push the week over, in time order.
    const week = weekStartOf(localDate(shift.start, tz), weekStartsOn);
    const earlier = mine.filter(
      (s) =>
        s.start < shift.start &&
        weekStartOf(localDate(s.start, tz), weekStartsOn) === week,
    );
    const before = summarizeWeek(earlier, week, overtime, tz);
    const after = summarizeWeek([...earlier, shift], week, overtime, tz);
    if (after.otHours > before.otHours) {
      add({
        code: "OVERTIME",
        severity: "warn",
        message: `${c.firstName} goes into overtime with this shift (${after.weekHours}h this week, +${Math.round((after.otHours - before.otHours) * 100) / 100}h OT).`,
      });
    }
    if (c.maxWeeklyHours !== null && after.weekHours > c.maxWeeklyHours) {
      add({
        code: "OVER_PREFERRED_HOURS",
        severity: "warn",
        message: `${c.firstName} prefers at most ${c.maxWeeklyHours}h a week; this makes ${after.weekHours}h.`,
      });
    }

    if (badges.length) result.set(shift.id, badges);
  }
  return result;
}
