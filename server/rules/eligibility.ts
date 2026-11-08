import "server-only";

import type { TrainingLevel } from "@/server/generated/prisma/enums";

import type { TimeOfDay } from "./presets";
import {
  addDays,
  coveredBy,
  formatRange,
  hoursBetween,
  intersect,
  localDate,
  localWindow,
  overlaps,
  weekdayOf,
} from "./time";
import {
  isWorkedShift,
  type CrewInfo,
  type Interval,
  type RuleIssue,
  type ShiftInfo,
  type StationInfo,
} from "./types";

// Can this crew member work this station for this window? Covers training level,
// certs, availability, time off, overlapping shifts, the rest gap ("clopen") and
// consecutive days. Overtime (overtime.ts) and youth limits (youth.ts) are separate.

export type EligibilityCode =
  | "INACTIVE"
  | "UNTRAINED"
  | "TRAINEE_AT_RUSH"
  | "CERT_MISSING"
  | "CERT_EXPIRED"
  | "UNAVAILABLE"
  | "TIME_OFF"
  | "TIME_OFF_REQUESTED"
  | "OVERLAP"
  | "REST_GAP"
  | "CONSECUTIVE_DAYS";

export type EligibilityIssue = RuleIssue<EligibilityCode>;

export interface EligibilityInput {
  crew: CrewInfo;
  station: StationInfo;
  /** The proposed work on this station. */
  window: Interval;
  /** The crew member's other shifts around the window (any status; non-worked ones are ignored). */
  shifts: ShiftInfo[];
  timezone: string;
  minRestHours: number;
  maxConsecutiveDays: number;
  /** Daily local windows where `minLevelDuringRush` applies (the MORNING_RUSH daypart). */
  rushWindows: { start: TimeOfDay; end: TimeOfDay }[];
  /** When a certified (or better) crew member also works this station: a trainee isn't alone then. */
  certifiedCoverage?: Interval[];
  /** Shifts to leave out, e.g. the crew member's own shift when moving them between stations. */
  ignoreShiftIds?: string[];
}

export interface EligibilityResult {
  eligible: boolean;
  issues: EligibilityIssue[];
}

const LEVEL_RANK: Record<TrainingLevel, number> = {
  TRAINEE: 0,
  CERTIFIED: 1,
  TRAINER: 2,
};

/** Calendar dates (store time) that a window touches. */
function datesTouched(w: Interval, timezone: string): string[] {
  const first = localDate(w.start, timezone);
  const last = localDate(new Date(w.end.getTime() - 1), timezone);
  const dates = [first];
  for (let d = first; d < last;) dates.push((d = addDays(d, 1)));
  return dates;
}

const block = (code: EligibilityCode, message: string): EligibilityIssue => ({
  code,
  severity: "block",
  message,
});

export function checkTraining(input: EligibilityInput): EligibilityIssue[] {
  const {
    crew,
    station,
    window,
    timezone,
    rushWindows,
    certifiedCoverage = [],
  } = input;
  const level = crew.stations[station.id];
  if (!level)
    return [
      block("UNTRAINED", `${crew.firstName} isn't trained on ${station.name}.`),
    ];

  if (LEVEL_RANK[level] >= LEVEL_RANK[station.minLevelDuringRush]) return [];
  // Below the rush minimum: fine outside rush, or during rush if not alone on the station.
  for (const date of datesTouched(window, timezone)) {
    for (const r of rushWindows) {
      const rush = intersect(
        window,
        localWindow(date, r.start, r.end, timezone),
      );
      if (rush && !coveredBy(rush, certifiedCoverage)) {
        return [
          block(
            "TRAINEE_AT_RUSH",
            `${crew.firstName} is a ${level.toLowerCase()} on ${station.name} and would be alone during rush (${formatRange(rush, timezone)}).`,
          ),
        ];
      }
    }
  }
  return [];
}

export function checkCerts(input: EligibilityInput): EligibilityIssue[] {
  const { crew, station, window, timezone } = input;
  if (!station.requiredCert) return [];
  const cert = crew.certs.find((c) => c.type === station.requiredCert);
  const label = station.requiredCert.toLowerCase().replace("_", " ");
  if (!cert)
    return [
      block(
        "CERT_MISSING",
        `${station.name} needs a ${label} cert; ${crew.firstName} has none.`,
      ),
    ];
  const shiftDate = localDate(window.start, timezone);
  if (cert.expiresAt && cert.expiresAt < shiftDate) {
    return [
      block(
        "CERT_EXPIRED",
        `${crew.firstName}'s ${label} cert expired on ${cert.expiresAt}; ${station.name} needs one.`,
      ),
    ];
  }
  return [];
}

export function checkAvailability(input: EligibilityInput): EligibilityIssue[] {
  const { crew, window, timezone } = input;
  // Windows from the day before can run past midnight into the shift.
  const dates = datesTouched(window, timezone);
  const candidates = [addDays(dates[0], -1), ...dates];
  const windows = candidates.flatMap((date) =>
    crew.availability
      .filter((a) => a.weekday === weekdayOf(date))
      .map((a) => localWindow(date, a.start, a.end, timezone)),
  );
  if (coveredBy(window, windows)) return [];
  return [
    block(
      "UNAVAILABLE",
      `${crew.firstName} isn't available ${formatRange(window, timezone)}.`,
    ),
  ];
}

export function checkTimeOff(input: EligibilityInput): EligibilityIssue[] {
  const { crew, window, timezone } = input;
  const issues: EligibilityIssue[] = [];
  for (const t of crew.timeOff) {
    if (!overlaps(t, window)) continue;
    if (t.status === "APPROVED") {
      issues.push(
        block(
          "TIME_OFF",
          `${crew.firstName} has approved time off ${formatRange(t, timezone)}.`,
        ),
      );
    } else if (t.status === "REQUESTED") {
      issues.push({
        code: "TIME_OFF_REQUESTED",
        severity: "warn",
        message: `${crew.firstName} has requested time off ${formatRange(t, timezone)} (not yet approved).`,
      });
    }
  }
  return issues;
}

/** Other worked shifts, minus ignored ones. */
const otherShifts = (input: EligibilityInput) =>
  input.shifts.filter(
    (s) =>
      s.crewId === input.crew.id &&
      isWorkedShift(s) &&
      !(input.ignoreShiftIds ?? []).includes(s.id),
  );

export function checkOverlapAndRest(
  input: EligibilityInput,
): EligibilityIssue[] {
  const { crew, window, timezone, minRestHours } = input;
  const issues: EligibilityIssue[] = [];
  for (const s of otherShifts(input)) {
    if (overlaps(s, window)) {
      issues.push(
        block(
          "OVERLAP",
          `${crew.firstName} already works ${formatRange(s, timezone)}.`,
        ),
      );
      continue;
    }
    if (minRestHours <= 0) continue;
    // A gap of zero is one continuous stretch (an extension), not a second shift.
    const gap =
      s.end <= window.start
        ? hoursBetween(s.end, window.start)
        : hoursBetween(window.end, s.start);
    if (gap > 0 && gap < minRestHours) {
      issues.push(
        block(
          "REST_GAP",
          `Only ${Math.round(gap * 10) / 10}h between ${crew.firstName}'s shift ${formatRange(s, timezone)} and this one; needs ${minRestHours}h.`,
        ),
      );
    }
  }
  return issues;
}

export function checkConsecutiveDays(
  input: EligibilityInput,
): EligibilityIssue[] {
  const { crew, window, timezone, maxConsecutiveDays } = input;
  const worked = new Set(
    otherShifts(input).map((s) => localDate(s.start, timezone)),
  );
  const day = localDate(window.start, timezone);
  worked.add(day);
  let run = 1;
  for (let d = addDays(day, -1); worked.has(d); d = addDays(d, -1)) run++;
  for (let d = addDays(day, 1); worked.has(d); d = addDays(d, 1)) run++;
  if (run <= maxConsecutiveDays) return [];
  return [
    block(
      "CONSECUTIVE_DAYS",
      `This would be ${crew.firstName}'s ${run}th day in a row; the limit is ${maxConsecutiveDays}.`,
    ),
  ];
}

export function checkEligibility(input: EligibilityInput): EligibilityResult {
  const issues: EligibilityIssue[] = input.crew.active
    ? [
        ...checkTraining(input),
        ...checkCerts(input),
        ...checkAvailability(input),
        ...checkTimeOff(input),
        ...checkOverlapAndRest(input),
        ...checkConsecutiveDays(input),
      ]
    : [block("INACTIVE", `${input.crew.firstName} is no longer active.`)];
  return { eligible: !issues.some((i) => i.severity === "block"), issues };
}
