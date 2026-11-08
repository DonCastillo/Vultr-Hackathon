import "server-only";

import type { TimeOfDay } from "./presets";
import { formatRange, localWindow, weekdayOf } from "./time";
import type {
  AssignmentInfo,
  CoverageRuleInfo,
  Interval,
  IsoDate,
  RuleIssue,
  StationInfo,
} from "./types";

// Required vs. scheduled headcount per station in 15-minute slots for one store day.
// A day covers the coverage rules that apply to that date, anchored on it: the
// overnight daypart (23:00-05:00) runs into the next morning. Feeds the heatmap,
// the call-out impact analysis and the recovery plan's shortfall list.

export const SLOT_MINUTES = 15;
const SLOT_MS = SLOT_MINUTES * 60_000;

export type CoverageCode = "COVERAGE_SHORT" | "NO_SUPERVISOR";
export type CoverageIssue = RuleIssue<CoverageCode>;

export interface CoverageSlot extends Interval {
  stationId: string;
  required: number;
  scheduled: number;
}

/** Consecutive slots on one station that are short by the same number of people. */
export interface Shortfall extends Interval {
  stationId: string;
  required: number;
  scheduled: number;
  missing: number;
}

export interface CoverageInput {
  date: IsoDate;
  timezone: string;
  stations: StationInfo[];
  rules: CoverageRuleInfo[];
  /** Station blocks from worked shifts (callers drop cancelled / called-out shifts). */
  assignments: AssignmentInfo[];
  /** Store hours: a supervisor must be on the floor for every covered slot inside them. */
  openTime: TimeOfDay;
  closeTime: TimeOfDay;
}

export interface CoverageResult {
  slots: CoverageSlot[];
  shortfalls: Shortfall[];
  supervisorGaps: Interval[];
  issues: CoverageIssue[];
}

/** The rules in force on a date: a weekday-specific rule replaces the every-day one. */
export function rulesForDate(
  rules: CoverageRuleInfo[],
  date: IsoDate,
): CoverageRuleInfo[] {
  const wd = weekdayOf(date);
  const specific = rules.filter((r) => r.weekday === wd);
  const overridden = new Set(
    specific.map((r) => `${r.stationId}|${r.daypart}`),
  );
  return [
    ...specific,
    ...rules.filter(
      (r) =>
        r.weekday === null && !overridden.has(`${r.stationId}|${r.daypart}`),
    ),
  ];
}

/** Merges consecutive slots with the same numbers into ranges (slots with missing <= 0 are dropped). */
export function mergeShortfalls(
  slots: (CoverageSlot & { missing: number })[],
): Shortfall[] {
  const out: Shortfall[] = [];
  const sorted = [...slots].sort(
    (a, b) =>
      a.stationId.localeCompare(b.stationId) ||
      a.start.getTime() - b.start.getTime(),
  );
  for (const s of sorted) {
    const { missing } = s;
    if (missing <= 0) continue;
    const last = out[out.length - 1];
    if (
      last &&
      last.stationId === s.stationId &&
      last.end.getTime() === s.start.getTime() &&
      last.missing === missing &&
      last.required === s.required &&
      last.scheduled === s.scheduled
    ) {
      last.end = s.end;
    } else {
      out.push({
        stationId: s.stationId,
        start: s.start,
        end: s.end,
        required: s.required,
        scheduled: s.scheduled,
        missing,
      });
    }
  }
  return out;
}

export function computeCoverage(input: CoverageInput): CoverageResult {
  const { date, timezone, stations, assignments } = input;
  const active = rulesForDate(input.rules, date).filter((r) => r.minCount > 0);
  const windows = active.map((r) => ({
    rule: r,
    ...localWindow(date, r.start, r.end, timezone),
  }));

  // Every 15-minute slot any rule touches, per station.
  const slots: CoverageSlot[] = [];
  const stationIds = [...new Set(windows.map((w) => w.rule.stationId))];
  for (const stationId of stationIds) {
    const mine = windows.filter((w) => w.rule.stationId === stationId);
    const starts = new Set<number>();
    for (const w of mine) {
      for (let t = w.start.getTime(); t < w.end.getTime(); t += SLOT_MS)
        starts.add(t);
    }
    const blocks = assignments.filter((a) => a.stationId === stationId);
    for (const t of [...starts].sort((a, b) => a - b)) {
      const start = new Date(t);
      const end = new Date(t + SLOT_MS);
      const required = Math.max(
        ...mine
          .filter((w) => w.start <= start && w.end >= end)
          .map((w) => w.rule.minCount),
        0,
      );
      // A block counts for a slot only if it covers the whole slot.
      const scheduled = blocks.filter(
        (a) => a.start <= start && a.end >= end,
      ).length;
      slots.push({ stationId, start, end, required, scheduled });
    }
  }

  const shortfalls = mergeShortfalls(
    slots.map((s) => ({ ...s, missing: s.required - s.scheduled })),
  );

  // Supervisor on the floor: every covered slot inside store hours.
  const supervisorStations = new Set(
    stations.filter((s) => s.isSupervisor).map((s) => s.id),
  );
  const open = localWindow(date, input.openTime, input.closeTime, timezone);
  const slotStarts = [...new Set(slots.map((s) => s.start.getTime()))].sort(
    (a, b) => a - b,
  );
  const supervisorGaps: Interval[] = [];
  for (const t of slotStarts) {
    const start = new Date(t);
    const end = new Date(t + SLOT_MS);
    if (start < open.start || end > open.end) continue;
    const covered = assignments.some(
      (a) =>
        supervisorStations.has(a.stationId) && a.start <= start && a.end >= end,
    );
    if (covered) continue;
    const last = supervisorGaps[supervisorGaps.length - 1];
    if (last && last.end.getTime() === t) last.end = end;
    else supervisorGaps.push({ start, end });
  }

  const name = (id: string) => stations.find((s) => s.id === id)?.name ?? id;
  const issues: CoverageIssue[] = [
    ...shortfalls.map((s): CoverageIssue => ({
      code: "COVERAGE_SHORT",
      severity: "warn",
      message: `${name(s.stationId)} ${formatRange(s, timezone)}: ${s.scheduled} of ${s.required} scheduled (short ${s.missing}).`,
    })),
    ...supervisorGaps.map((g): CoverageIssue => ({
      code: "NO_SUPERVISOR",
      severity: "warn",
      message: `No supervisor on the floor ${formatRange(g, timezone)}.`,
    })),
  ];

  return { slots, shortfalls, supervisorGaps, issues };
}

export interface ImpactResult {
  before: CoverageResult;
  after: CoverageResult;
  /** Only the gaps the removal causes: `missing` counts just the newly missing people. */
  shortfalls: Shortfall[];
  /** Supervisor gaps that only exist after the removal. */
  supervisorGaps: Interval[];
}

/** What removing these shifts (a call-out) does to coverage that day. */
export function computeImpact(
  input: CoverageInput,
  removedShiftIds: string[],
): ImpactResult {
  const removed = new Set(removedShiftIds);
  const before = computeCoverage(input);
  const after = computeCoverage({
    ...input,
    assignments: input.assignments.filter((a) => !removed.has(a.shiftId)),
  });

  const key = (s: { stationId: string; start: Date }) =>
    `${s.stationId}|${s.start.getTime()}`;
  const beforeBySlot = new Map(before.slots.map((s) => [key(s), s]));
  // Keep the slot only where the removal makes it shorter, and only by that much.
  const worse = after.slots
    .map((s) => {
      const b = beforeBySlot.get(key(s));
      const newlyMissing =
        Math.max(0, s.required - s.scheduled) -
        Math.max(0, (b?.required ?? 0) - (b?.scheduled ?? 0));
      return { ...s, missing: newlyMissing };
    })
    .filter((s) => s.missing > 0);

  const hadGap = (t: number) =>
    before.supervisorGaps.some(
      (g) => g.start.getTime() <= t && g.end.getTime() > t,
    );
  const supervisorGaps: Interval[] = [];
  for (const g of after.supervisorGaps) {
    for (let t = g.start.getTime(); t < g.end.getTime(); t += SLOT_MS) {
      if (hadGap(t)) continue;
      const last = supervisorGaps[supervisorGaps.length - 1];
      if (last && last.end.getTime() === t) last.end = new Date(t + SLOT_MS);
      else
        supervisorGaps.push({ start: new Date(t), end: new Date(t + SLOT_MS) });
    }
  }

  return { before, after, shortfalls: mergeShortfalls(worse), supervisorGaps };
}
