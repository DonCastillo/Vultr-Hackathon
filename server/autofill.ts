import "server-only";

import { db } from "@/server/db";
import {
  dayRange,
  getCrew,
  getSchoolDays,
  getShifts,
  getStoreContext,
  type StoreContext,
} from "@/server/data";
import { rankCandidates } from "@/server/rank";
import { computeCoverage } from "@/server/rules/coverage";
import { addDays, formatRange, localWindow } from "@/server/rules/time";
import type {
  AssignmentInfo,
  CrewInfo,
  IsoDate,
  ShiftInfo,
  StationInfo,
} from "@/server/rules/types";
import { youthRules } from "@/server/rules/youth";
import { defaultBreak } from "@/server/schedule";

// Auto-fill (task 4.10): fills a week's coverage gaps from the template using the same
// engine the agent uses. For each gap, most critical station first, it adds a shift for
// the top-ranked call-in candidate who passes every rule without overtime. It never
// extends existing shifts or uses overtime, and reports what it couldn't fill.

/** Longest shift auto-fill will create. */
const MAX_FILL_HOURS = 9;

export interface AutofillInput {
  ctx: Pick<
    StoreContext,
    | "timezone"
    | "config"
    | "preset"
    | "rushWindows"
    | "coverageRules"
    | "openTime"
    | "closeTime"
  > & { stations: StationInfo[] };
  crew: CrewInfo[];
  shifts: ShiftInfo[];
  assignments: AssignmentInfo[];
  schoolDays: IsoDate[];
  days: IsoDate[];
}

export interface PlannedFill {
  crewId: string;
  stationId: string;
  start: Date;
  end: Date;
  breakMinutes: number;
}

export interface AutofillPlan {
  fills: PlannedFill[];
  unfilled: string[];
}

export function planAutofill(input: AutofillInput): AutofillPlan {
  const { ctx, crew, schoolDays } = input;
  const tz = ctx.timezone;
  const shifts = [...input.shifts];
  const assignments = [...input.assignments];
  const fills: PlannedFill[] = [];
  const unfilled: string[] = [];
  const priority = new Map(ctx.stations.map((s) => [s.id, s.priority]));
  const name = (id: string) =>
    ctx.stations.find((s) => s.id === id)?.name ?? id;
  const rules = {
    timezone: tz,
    minRestHours: ctx.config.minRestHours,
    maxConsecutiveDays: ctx.config.maxConsecutiveDays,
    overtime: {
      method: ctx.preset.overtimeMethod,
      dailyOtHours: ctx.config.dailyOtHours,
      weeklyOtHours: ctx.config.weeklyOtHours,
    },
    youth: youthRules(ctx.preset, ctx.config),
    rushWindows: ctx.rushWindows,
  };
  let seq = 0;
  /** Daypart start/end instants for a date (where shifts naturally begin and end). */
  const boundaries = (date: IsoDate) =>
    ctx.coverageRules.flatMap((r) => {
      const w = localWindow(date, r.start, r.end, tz);
      return [w.start, w.end];
    });

  for (const date of input.days) {
    const tried = new Set<string>();
    // Each pass fills at most one gap; stop when nothing more can be filled.
    for (let pass = 0; pass < 60; pass++) {
      const coverage = computeCoverage({
        date,
        timezone: tz,
        stations: ctx.stations,
        rules: ctx.coverageRules,
        assignments,
        openTime: ctx.openTime,
        closeTime: ctx.closeTime,
      });
      const gap = coverage.shortfalls
        .filter(
          (g) =>
            !tried.has(
              `${g.stationId}|${g.start.getTime()}|${g.end.getTime()}`,
            ),
        )
        .sort(
          (a, b) =>
            (priority.get(a.stationId) ?? 99) -
              (priority.get(b.stationId) ?? 99) ||
            a.start.getTime() - b.start.getTime(),
        )[0];
      if (!gap) break;
      const key = `${gap.stationId}|${gap.start.getTime()}|${gap.end.getTime()}`;

      // A merged gap can span the whole day; cut it into shift-sized windows at daypart
      // boundaries (2h-9h), earliest and longest first, and take the first that someone fits.
      const cuts = [
        gap.start.getTime(),
        ...boundaries(date)
          .map((d) => d.getTime())
          .filter((t) => t > gap.start.getTime() && t < gap.end.getTime()),
        gap.end.getTime(),
      ].sort((a, b) => a - b);
      const windows: { start: Date; end: Date }[] = [];
      for (let i = 0; i < cuts.length; i++) {
        for (let j = cuts.length - 1; j > i; j--) {
          const hours = (cuts[j] - cuts[i]) / 3_600_000;
          if (hours >= 2 && hours <= MAX_FILL_HOURS)
            windows.push({ start: new Date(cuts[i]), end: new Date(cuts[j]) });
        }
      }
      if (windows.length === 0)
        windows.push({ start: gap.start, end: gap.end });

      let chosen: {
        crewId: string;
        window: { start: Date; end: Date };
      } | null = null;
      for (const window of windows) {
        const ranked = rankCandidates({
          stationId: gap.stationId,
          window,
          stations: ctx.stations,
          crew,
          shifts,
          assignments,
          schoolDays,
          rules,
        });
        const pick = ranked.candidates.find(
          (c) =>
            c.kind === "CALL_IN" &&
            !c.isOvertime &&
            !c.warnings.some((w) => w.code === "OVER_PREFERRED_HOURS"),
        );
        if (pick) {
          chosen = { crewId: pick.crewId, window };
          break;
        }
      }
      if (!chosen) {
        tried.add(key);
        unfilled.push(`${name(gap.stationId)} ${formatRange(gap, tz)}`);
        continue;
      }
      const minutes =
        (chosen.window.end.getTime() - chosen.window.start.getTime()) / 60_000;
      const id = `autofill-${seq++}`;
      const fill = {
        crewId: chosen.crewId,
        stationId: gap.stationId,
        start: chosen.window.start,
        end: chosen.window.end,
        breakMinutes: defaultBreak(minutes),
      };
      fills.push(fill);
      shifts.push({
        id,
        crewId: fill.crewId,
        start: fill.start,
        end: fill.end,
        breakMinutes: fill.breakMinutes,
        status: "SCHEDULED",
      });
      assignments.push({
        id: `${id}-a`,
        shiftId: id,
        crewId: fill.crewId,
        stationId: fill.stationId,
        start: fill.start,
        end: fill.end,
      });
    }
  }
  return { fills, unfilled };
}

/** Plans and saves auto-fill shifts for the 7 days from `weekStart`. */
export async function autofillWeek(weekStart: IsoDate): Promise<AutofillPlan> {
  const ctx = await getStoreContext();
  const tz = ctx.timezone;
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const [crew, { shifts, assignments }, schoolDays] = await Promise.all([
    getCrew(),
    getShifts(dayRange(addDays(weekStart, -1), addDays(weekStart, 7), tz)),
    getSchoolDays(addDays(weekStart, -7), addDays(weekStart, 13)),
  ]);
  const plan = planAutofill({
    ctx,
    crew,
    shifts,
    assignments,
    schoolDays,
    days,
  });

  await db.$transaction(async (tx) => {
    for (const f of plan.fills) {
      await tx.shift.create({
        data: {
          storeId: ctx.storeId,
          crewId: f.crewId,
          start: f.start,
          end: f.end,
          breakMinutes: f.breakMinutes,
          notes: "Auto-filled draft",
          assignments: {
            create: [
              {
                stationId: f.stationId,
                start: f.start,
                end: f.end,
                source: "autofill",
              },
            ],
          },
        },
      });
    }
    await tx.auditEvent.create({
      data: {
        type: "schedule.autofill",
        actor: "manager",
        payload: {
          weekStart,
          created: plan.fills.length,
          unfilled: plan.unfilled,
        },
      },
    });
  });
  return plan;
}
