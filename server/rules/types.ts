import "server-only";

import type {
  CertType,
  Daypart,
  ShiftStatus,
  TimeOffStatus,
  TrainingLevel,
} from "@/server/generated/prisma/enums";

import type { TimeOfDay } from "./presets";

// Plain inputs for the rules engine. The rules never touch Prisma or the database:
// a loader maps rows to these shapes, so every rule is a pure, unit-testable function.
//
// Conventions (see CLAUDE.md "Time handling"):
// - Instants are JS Dates (UTC, from TIMESTAMPTZ columns).
// - Calendar dates are "YYYY-MM-DD" strings (DATE columns).
// - Times of day are "HH:MM" strings in local store time (TIME columns).

/** "YYYY-MM-DD". */
export type IsoDate = string;

/** A half-open time range [start, end). */
export interface Interval {
  start: Date;
  end: Date;
}

export interface StationInfo {
  id: string;
  shortCode: string;
  name: string;
  priority: number;
  requiredCert: CertType | null;
  minLevelDuringRush: TrainingLevel;
  youthRestricted: boolean;
  isSupervisor: boolean;
}

export interface AvailabilityWindow {
  /** 0 = Sunday ... 6 = Saturday. */
  weekday: number;
  start: TimeOfDay;
  /** May be earlier than `start`: the window runs past midnight. */
  end: TimeOfDay;
}

export interface CrewInfo {
  id: string;
  firstName: string;
  lastName: string;
  birthdate: IsoDate;
  isStudent: boolean;
  hireDate: IsoDate;
  reliability: number;
  maxWeeklyHours: number | null;
  smsOptIn: boolean;
  active: boolean;
  /** stationId -> training level. Missing = not trained. */
  stations: Record<string, TrainingLevel>;
  certs: { type: CertType; expiresAt: IsoDate | null }[];
  availability: AvailabilityWindow[];
  timeOff: (Interval & { status: TimeOffStatus })[];
}

export interface ShiftInfo extends Interval {
  id: string;
  crewId: string;
  breakMinutes: number;
  status: ShiftStatus;
}

/** A station block inside a shift (StationAssignment). */
export interface AssignmentInfo extends Interval {
  id: string;
  shiftId: string;
  crewId: string;
  stationId: string;
}

/** Minimum headcount for a station in a daypart (CoverageRule). */
export interface CoverageRuleInfo {
  stationId: string;
  /** 0-6; null = every day. A weekday-specific rule overrides the every-day one. */
  weekday: number | null;
  daypart: Daypart;
  start: TimeOfDay;
  /** May be earlier than `start`: the daypart runs past midnight. */
  end: TimeOfDay;
  minCount: number;
}

/** A shift still counts toward hours, overlap and rest unless it was cancelled or called out. */
export const isWorkedShift = (s: Pick<ShiftInfo, "status">) =>
  s.status === "SCHEDULED" || s.status === "COMPLETED";

export type Severity = "block" | "warn";

/** One rule result: why someone can't (block) or shouldn't without a look (warn) work. */
export interface RuleIssue<Code extends string = string> {
  code: Code;
  severity: Severity;
  message: string;
}
