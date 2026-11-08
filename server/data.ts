import "server-only";

import { db } from "@/server/db";
import {
  getPreset,
  type RulePreset,
  type TimeOfDay,
} from "@/server/rules/presets";
import { addDays, zoned } from "@/server/rules/time";
import type {
  AssignmentInfo,
  CoverageRuleInfo,
  CrewInfo,
  Interval,
  IsoDate,
  ShiftInfo,
  StationInfo,
} from "@/server/rules/types";

// Loaders: database rows -> the plain shapes the rules engine takes. Pages and actions
// load through here so the UI runs the same tested rules as the agent.

/** TIME column -> "HH:MM". */
export const timeOfDay = (d: Date) =>
  d.toISOString().slice(11, 16) as TimeOfDay;
/** DATE column -> "YYYY-MM-DD". */
export const isoDate = (d: Date) => d.toISOString().slice(0, 10);

export interface StoreContext {
  storeId: string;
  storeName: string;
  timezone: string;
  openTime: TimeOfDay;
  closeTime: TimeOfDay;
  preset: RulePreset;
  config: {
    weeklyOtHours: number;
    dailyOtHours: number | null;
    minRestHours: number;
    maxConsecutiveDays: number;
    youthUnderAge: number;
    youthMaxSchoolDayHours: number;
    youthMaxSchoolWeekHours: number | null;
    youthLatestEnd: TimeOfDay;
    offerTimeoutSec: number;
    demoMode: boolean;
  };
  stations: (StationInfo & { color: string; active: boolean })[];
  coverageRules: CoverageRuleInfo[];
  /** Daily local windows of the MORNING_RUSH daypart. */
  rushWindows: { start: TimeOfDay; end: TimeOfDay }[];
}

export async function getStoreContext(): Promise<StoreContext> {
  const store = await db.store.findFirstOrThrow({
    include: {
      ruleConfig: true,
      stations: { orderBy: { priority: "asc" } },
      coverageRules: true,
    },
  });
  const rc = store.ruleConfig;
  if (!rc) throw new Error("The store has no RuleConfig; run pnpm db:seed");
  const coverageRules: CoverageRuleInfo[] = store.coverageRules.map((r) => ({
    stationId: r.stationId,
    weekday: r.weekday,
    daypart: r.daypart,
    start: timeOfDay(r.startTime),
    end: timeOfDay(r.endTime),
    minCount: r.minCount,
  }));
  const rush = coverageRules.find((r) => r.daypart === "MORNING_RUSH");
  return {
    storeId: store.id,
    storeName: store.name,
    timezone: store.timezone,
    openTime: timeOfDay(store.openTime),
    closeTime: timeOfDay(store.closeTime),
    preset: getPreset(store.jurisdiction),
    config: {
      weeklyOtHours: Number(rc.weeklyOtHours),
      dailyOtHours: rc.dailyOtHours === null ? null : Number(rc.dailyOtHours),
      minRestHours: Number(rc.minRestHours),
      maxConsecutiveDays: rc.maxConsecutiveDays,
      youthUnderAge: rc.youthUnderAge,
      youthMaxSchoolDayHours: Number(rc.youthMaxSchoolDayHours),
      youthMaxSchoolWeekHours:
        rc.youthMaxSchoolWeekHours === null
          ? null
          : Number(rc.youthMaxSchoolWeekHours),
      youthLatestEnd: timeOfDay(rc.youthLatestEnd),
      offerTimeoutSec: rc.offerTimeoutSec,
      demoMode: rc.demoMode,
    },
    stations: store.stations.map((s) => ({
      id: s.id,
      shortCode: s.shortCode,
      name: s.name,
      priority: s.priority,
      requiredCert: s.requiredCert,
      minLevelDuringRush: s.minLevelDuringRush,
      youthRestricted: s.youthRestricted,
      isSupervisor: s.isSupervisor,
      color: s.color,
      active: s.active,
    })),
    coverageRules,
    rushWindows: rush ? [{ start: rush.start, end: rush.end }] : [],
  };
}

export type CrewWithWage = CrewInfo & { hourlyWage: number; phone: string };

export async function getCrew(): Promise<CrewWithWage[]> {
  const rows = await db.crew.findMany({
    where: { active: true },
    orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
    include: { stations: true, certs: true, availability: true, timeOff: true },
  });
  return rows.map((c) => ({
    id: c.id,
    firstName: c.firstName,
    lastName: c.lastName,
    phone: c.phone,
    birthdate: isoDate(c.birthdate),
    isStudent: c.isStudent,
    hireDate: isoDate(c.hireDate),
    reliability: c.reliability,
    maxWeeklyHours: c.maxWeeklyHours === null ? null : Number(c.maxWeeklyHours),
    smsOptIn: c.smsOptIn,
    active: c.active,
    hourlyWage: Number(c.hourlyWage),
    stations: Object.fromEntries(c.stations.map((s) => [s.stationId, s.level])),
    certs: c.certs.map((x) => ({
      type: x.type,
      expiresAt: x.expiresAt ? isoDate(x.expiresAt) : null,
    })),
    availability: c.availability.map((a) => ({
      weekday: a.weekday,
      start: timeOfDay(a.startTime),
      end: timeOfDay(a.endTime),
    })),
    timeOff: c.timeOff.map((t) => ({
      start: t.start,
      end: t.end,
      status: t.status,
    })),
  }));
}

/** Shifts (and their station blocks) overlapping [range.start, range.end). */
export async function getShifts(range: Interval): Promise<{
  shifts: (ShiftInfo & { notes: string | null })[];
  assignments: AssignmentInfo[];
}> {
  const rows = await db.shift.findMany({
    where: { start: { lt: range.end }, end: { gt: range.start } },
    orderBy: { start: "asc" },
    include: { assignments: { orderBy: { start: "asc" } } },
  });
  return {
    shifts: rows.map((s) => ({
      id: s.id,
      crewId: s.crewId,
      start: s.start,
      end: s.end,
      breakMinutes: s.breakMinutes,
      status: s.status,
      notes: s.notes,
    })),
    assignments: rows.flatMap((s) =>
      s.assignments.map((a) => ({
        id: a.id,
        shiftId: s.id,
        crewId: s.crewId,
        stationId: a.stationId,
        start: a.start,
        end: a.end,
      })),
    ),
  };
}

export async function getSchoolDays(
  from: IsoDate,
  to: IsoDate,
): Promise<IsoDate[]> {
  const rows = await db.schoolDay.findMany({
    where: {
      date: {
        gte: new Date(`${from}T00:00:00Z`),
        lte: new Date(`${to}T00:00:00Z`),
      },
    },
  });
  return rows.map((r) => isoDate(r.date));
}

/** The instant range of store-local days [from, to] inclusive. */
export function dayRange(
  from: IsoDate,
  to: IsoDate,
  timezone: string,
): Interval {
  return {
    start: zoned(from, "00:00", timezone),
    end: zoned(addDays(to, 1), "00:00", timezone),
  };
}
