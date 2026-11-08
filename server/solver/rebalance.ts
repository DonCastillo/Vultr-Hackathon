import "server-only";

import {
  computeCoverage,
  mergeShortfalls,
  SLOT_MINUTES,
  type CoverageInput,
  type CoverageResult,
  type Shortfall,
} from "@/server/rules/coverage";
import {
  checkCerts,
  checkTraining,
  type EligibilityInput,
} from "@/server/rules/eligibility";
import type { TimeOfDay } from "@/server/rules/presets";
import { addDays, intersect, overlaps, zoned } from "@/server/rules/time";
import type {
  AssignmentInfo,
  CrewInfo,
  Interval,
  StationInfo,
} from "@/server/rules/types";
import { ageOn } from "@/server/rules/youth";

// Plan A: fix a call-out's coverage gaps by moving crew who are already on shift.
//
// Each short 15-minute slot costs a weight by station criticality (priority 1 = most
// critical = highest weight); a slot with no supervisor on the floor costs twice the top
// weight, so pulling the only supervisor never pays. A move takes the part of someone's
// block on another station that overlaps a gap, if they're trained (and certified) for
// the target and it isn't youth-restricted for them. A greedy-ordered, depth-limited
// backtracking search keeps the lowest-cost plan; each move adds a tiny cost so the
// solver never makes pointless moves. Only gaps the call-out causes are scored, so
// pre-existing gaps neither attract nor block moves.

export interface Move extends Interval {
  crewId: string;
  shiftId: string;
  fromStationId: string;
  toStationId: string;
}

export interface RebalanceInput {
  /** The day as scheduled before the call-out. */
  coverage: CoverageInput;
  /** The called-out shift(s). */
  removedShiftIds: string[];
  /** Everyone working that day (at least those with assignments). */
  crew: CrewInfo[];
  /** Daily local windows where a station's `minLevelDuringRush` applies. */
  rushWindows: { start: TimeOfDay; end: TimeOfDay }[];
  youthUnderAge: number;
  /** Search limits: moves per plan and candidate moves tried at each step. */
  maxMoves?: number;
  branching?: number;
}

export interface RebalanceResult {
  moves: Move[];
  /** Gaps the call-out causes, before any moves. */
  shortfall: Shortfall[];
  /** Gaps left after the moves (including any a move opens), for Plan B. */
  remainingShortfall: Shortfall[];
  /** Weighted cost before and after (lower is better). */
  costBefore: number;
  costAfter: number;
}

const MOVE_COST = 0.01;

export function rebalance(input: RebalanceInput): RebalanceResult {
  const { crew, rushWindows, youthUnderAge } = input;
  // Only blocks near the day can matter (the overnight daypart reaches the next morning);
  // dropping the rest keeps each coverage evaluation small.
  const { date, timezone } = input.coverage;
  const horizon = {
    start: zoned(addDays(date, -1), "00:00", timezone),
    end: zoned(addDays(date, 2), "00:00", timezone),
  };
  const coverage: CoverageInput = {
    ...input.coverage,
    assignments: input.coverage.assignments.filter((a) => overlaps(a, horizon)),
  };
  const maxMoves = input.maxMoves ?? 3;
  const branching = input.branching ?? 6;
  const stations = new Map(coverage.stations.map((s) => [s.id, s]));
  const crewById = new Map(crew.map((c) => [c.id, c]));
  const maxPriority = Math.max(...coverage.stations.map((s) => s.priority));
  const weight = (stationId: string) =>
    maxPriority + 1 - (stations.get(stationId)?.priority ?? maxPriority);
  const supervisorWeight = 2 * maxPriority;

  // The baseline: coverage as scheduled. Only shortfalls beyond it count.
  const baseline = computeCoverage(coverage);
  const baseMissing = new Map(
    baseline.slots.map((s) => [
      `${s.stationId}|${s.start.getTime()}`,
      Math.max(0, s.required - s.scheduled),
    ]),
  );
  const baseSupervisorGap = (t: number) =>
    baseline.supervisorGaps.some(
      (g) => g.start.getTime() <= t && g.end.getTime() > t,
    );

  type State = { assignments: AssignmentInfo[]; moves: Move[] };
  type Scored = State & {
    result: CoverageResult;
    caused: Shortfall[];
    cost: number;
  };

  function score(state: State): Scored {
    const result = computeCoverage({
      ...coverage,
      assignments: state.assignments,
    });
    const causedSlots = result.slots
      .map((s) => {
        const missing =
          Math.max(0, s.required - s.scheduled) -
          (baseMissing.get(`${s.stationId}|${s.start.getTime()}`) ?? 0);
        return { ...s, missing };
      })
      .filter((s) => s.missing > 0);
    let cost = causedSlots.reduce(
      (c, s) => c + s.missing * weight(s.stationId),
      0,
    );
    for (const g of result.supervisorGaps) {
      for (
        let t = g.start.getTime();
        t < g.end.getTime();
        t += SLOT_MINUTES * 60_000
      ) {
        if (!baseSupervisorGap(t)) cost += supervisorWeight;
      }
    }
    cost += state.moves.length * MOVE_COST;
    return { ...state, result, caused: mergeShortfalls(causedSlots), cost };
  }

  /** Can this crew member take `stationId` for `window`, given who else is on it? */
  function canTake(
    c: CrewInfo,
    stationId: string,
    window: Interval,
    assignments: AssignmentInfo[],
  ): boolean {
    const station = stations.get(stationId) as StationInfo;
    const date = coverage.date;
    if (station.youthRestricted && ageOn(c.birthdate, date) < youthUnderAge)
      return false;
    const certifiedCoverage = assignments
      .filter((a) => a.stationId === stationId && a.crewId !== c.id)
      .filter((a) => {
        const level = crewById.get(a.crewId)?.stations[stationId];
        return level === "CERTIFIED" || level === "TRAINER";
      });
    const e: EligibilityInput = {
      crew: c,
      station,
      window,
      shifts: [],
      timezone: coverage.timezone,
      minRestHours: 0,
      maxConsecutiveDays: 7,
      rushWindows,
      certifiedCoverage,
    };
    return checkTraining(e).length === 0 && checkCerts(e).length === 0;
  }

  let seq = 0;
  function apply(
    state: State,
    donor: AssignmentInfo,
    window: Interval,
    toStationId: string,
  ): State {
    const rest = state.assignments.filter((a) => a.id !== donor.id);
    const pieces: AssignmentInfo[] = [];
    if (donor.start < window.start)
      pieces.push({ ...donor, id: `${donor.id}~a${seq++}`, end: window.start });
    pieces.push({
      ...donor,
      id: `move~${seq++}`,
      stationId: toStationId,
      start: window.start,
      end: window.end,
    });
    if (window.end < donor.end)
      pieces.push({ ...donor, id: `${donor.id}~b${seq++}`, start: window.end });
    const move: Move = {
      crewId: donor.crewId,
      shiftId: donor.shiftId,
      fromStationId: donor.stationId,
      toStationId,
      start: window.start,
      end: window.end,
    };
    return { assignments: [...rest, ...pieces], moves: [...state.moves, move] };
  }

  function candidates(state: Scored): Scored[] {
    const out: Scored[] = [];
    const seen = new Set<string>();
    // Most critical gaps first.
    const gaps = [...state.caused].sort(
      (a, b) =>
        weight(b.stationId) - weight(a.stationId) ||
        a.start.getTime() - b.start.getTime(),
    );
    for (const gap of gaps) {
      for (const donor of state.assignments) {
        if (donor.stationId === gap.stationId) continue;
        const window = intersect(donor, gap);
        if (!window) continue;
        const c = crewById.get(donor.crewId);
        if (!c || !canTake(c, gap.stationId, window, state.assignments))
          continue;
        const key = `${donor.id}|${gap.stationId}|${window.start.getTime()}|${window.end.getTime()}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(score(apply(state, donor, window, gap.stationId)));
      }
    }
    // Best immediate improvement first; ties go to the least critical donor station.
    return out
      .sort(
        (a, b) =>
          a.cost - b.cost ||
          weight(a.moves[a.moves.length - 1].fromStationId) -
            weight(b.moves[b.moves.length - 1].fromStationId),
      )
      .slice(0, branching);
  }

  function search(state: Scored, depth: number): Scored {
    let best = state;
    if (depth >= maxMoves || state.caused.length === 0) return best;
    for (const next of candidates(state)) {
      const result = search(next, depth + 1);
      if (result.cost < best.cost - 1e-9) best = result;
    }
    return best;
  }

  const removed = new Set(input.removedShiftIds);
  const start = score({
    assignments: coverage.assignments.filter((a) => !removed.has(a.shiftId)),
    moves: [],
  });
  const best = search(start, 0);

  return {
    moves: best.moves,
    shortfall: start.caused,
    remainingShortfall: best.caused,
    costBefore: Math.round(start.cost * 100) / 100,
    costAfter: Math.round(best.cost * 100) / 100,
  };
}
