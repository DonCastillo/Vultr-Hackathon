// Test fixture: the real seed data (prisma/seed/*) mapped to rule-engine inputs, in
// memory, with no database. Station and crew ids are their short codes and first names,
// so assertions read like the demo script ("Aisha", "DT-OT").

import { CREW, planTimeOff } from "@/prisma/seed/crew";
import { planWeek } from "@/prisma/seed/shifts";
import {
  COVERAGE,
  DAYPARTS,
  isSchoolDay,
  STATIONS,
  TIMEZONE,
} from "@/prisma/seed/store";
import type { Daypart } from "@/server/generated/prisma/enums";
import {
  getPreset,
  ruleConfigDefaults,
  type TimeOfDay,
} from "@/server/rules/presets";
import type {
  AssignmentInfo,
  CoverageRuleInfo,
  CrewInfo,
  ShiftInfo,
  StationInfo,
} from "@/server/rules/types";

/** A Sunday: the seed's demo day is then Monday 2026-11-09. */
export const SEED_TODAY = "2026-11-08";

// Store hours as seeded in prisma/seed/store.ts.
export const OPEN_TIME: TimeOfDay = "05:00";
export const CLOSE_TIME: TimeOfDay = "23:00";

export function seedScenario(today = SEED_TODAY) {
  const timezone = TIMEZONE;
  const timeOff = planTimeOff(today, timezone);
  const plan = planWeek(today, timezone, timeOff);

  const stations: StationInfo[] = STATIONS.map((s) => ({
    id: s.shortCode,
    shortCode: s.shortCode,
    name: s.name,
    priority: s.priority,
    requiredCert: "requiredCert" in s ? s.requiredCert : null,
    minLevelDuringRush:
      "minLevelDuringRush" in s ? s.minLevelDuringRush : "TRAINEE",
    youthRestricted: "youthRestricted" in s ? s.youthRestricted : false,
    isSupervisor: "isSupervisor" in s ? s.isSupervisor : false,
  }));

  const crew: CrewInfo[] = CREW.map((c) => ({
    id: c.firstName,
    firstName: c.firstName,
    lastName: c.lastName,
    birthdate: c.birthdate,
    isStudent: c.isStudent ?? false,
    hireDate: c.hireDate,
    reliability: c.reliability,
    maxWeeklyHours: c.maxWeeklyHours ?? null,
    smsOptIn: c.smsOptIn ?? true,
    active: true,
    stations: { ...c.stations } as CrewInfo["stations"],
    certs: Object.entries(c.certs ?? {}).map(([type, [, expiresAt]]) => ({
      type: type as CrewInfo["certs"][number]["type"],
      expiresAt,
    })),
    availability: c.availability.flatMap((w) =>
      w.days.map((weekday) => ({
        weekday,
        start: w.start as TimeOfDay,
        end: w.end as TimeOfDay,
      })),
    ),
    timeOff: timeOff
      .filter((t) => t.crew === c.firstName)
      .map((t) => ({ start: t.start, end: t.end, status: t.status })),
  }));

  const shifts: ShiftInfo[] = plan.shifts.map((s, i) => ({
    id: `shift-${i}`,
    crewId: s.crew,
    start: s.start,
    end: s.end,
    breakMinutes: s.breakMinutes,
    status: "SCHEDULED",
  }));

  const assignments: AssignmentInfo[] = plan.shifts.flatMap((s, i) =>
    s.blocks.map((b, j) => ({
      id: `a-${i}-${j}`,
      shiftId: `shift-${i}`,
      crewId: s.crew,
      stationId: b.code,
      start: b.start,
      end: b.end,
    })),
  );

  const coverageRules: CoverageRuleInfo[] = Object.entries(COVERAGE).flatMap(
    ([daypart, counts]) =>
      Object.entries(counts).map(([code, minCount]) => ({
        stationId: code,
        weekday: null,
        daypart: daypart as Daypart,
        start: DAYPARTS[daypart as Daypart].start as TimeOfDay,
        end: DAYPARTS[daypart as Daypart].end as TimeOfDay,
        minCount: minCount as number,
      })),
  );

  const preset = getPreset("ALBERTA");
  const config = ruleConfigDefaults("ALBERTA");

  return {
    timezone,
    plan,
    stations,
    crew,
    shifts,
    assignments,
    coverageRules,
    schoolDays: plan.days.filter(isSchoolDay),
    preset,
    config,
    rushWindows: [
      {
        start: DAYPARTS.MORNING_RUSH.start as TimeOfDay,
        end: DAYPARTS.MORNING_RUSH.end as TimeOfDay,
      },
    ],
  };
}

/** Runs Kayla's demo call-out through impact, Plan A and Plan B on the seed data. */
export async function demoCallout(s = seedScenario()) {
  const { computeImpact } = await import("@/server/rules/coverage");
  const { rebalance } = await import("@/server/solver/rebalance");
  const { rankCandidates } = await import("@/server/rank");
  const { localDate } = await import("@/server/rules/time");
  const { youthRules } = await import("@/server/rules/youth");

  const tz = s.timezone;
  const day = s.plan.demoDay;
  const kaylaShift = s.shifts.find(
    (sh) => sh.crewId === "Kayla" && localDate(sh.start, tz) === day,
  )!;
  const coverage = {
    date: day,
    timezone: tz,
    stations: s.stations,
    rules: s.coverageRules,
    assignments: s.assignments,
    openTime: OPEN_TIME,
    closeTime: CLOSE_TIME,
  };
  const impact = computeImpact(coverage, [kaylaShift.id]);
  const planA = rebalance({
    coverage,
    removedShiftIds: [kaylaShift.id],
    crew: s.crew,
    rushWindows: s.rushWindows,
    youthUnderAge: s.config.youthUnderAge,
  });
  const rules = {
    timezone: tz,
    minRestHours: s.config.minRestHours,
    maxConsecutiveDays: s.config.maxConsecutiveDays,
    overtime: {
      method: s.preset.overtimeMethod,
      dailyOtHours: s.config.dailyOtHours,
      weeklyOtHours: s.config.weeklyOtHours,
    },
    youth: youthRules(s.preset, s.config),
    rushWindows: s.rushWindows,
  };
  const rankings = planA.remainingShortfall.map((gap) => ({
    gap,
    result: rankCandidates({
      stationId: gap.stationId,
      window: gap,
      stations: s.stations,
      crew: s.crew,
      shifts: s.shifts.filter((sh) => sh.id !== kaylaShift.id),
      assignments: s.assignments.filter((a) => a.shiftId !== kaylaShift.id),
      schoolDays: s.schoolDays,
      rules,
      excludeCrewIds: ["Kayla"],
    }),
  }));
  return { s, kaylaShift, impact, planA, rankings };
}
