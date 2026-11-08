import "server-only";

import type { OfferKind, TrainingLevel } from "@/server/generated/prisma/enums";
import { checkEligibility } from "@/server/rules/eligibility";
import { checkOvertime, type OvertimeRules } from "@/server/rules/overtime";
import type { TimeOfDay } from "@/server/rules/presets";
import { formatRange, localDate, overlaps } from "@/server/rules/time";
import {
  isWorkedShift,
  type AssignmentInfo,
  type CrewInfo,
  type Interval,
  type IsoDate,
  type RuleIssue,
  type ShiftInfo,
  type StationInfo,
} from "@/server/rules/types";
import { ageOn, checkYouth, type YouthRules } from "@/server/rules/youth";

// Plan B: who to text for one remaining gap, best first.
//
// Off-duty crew are CALL_IN candidates; crew whose shift ends exactly when the gap starts
// (or starts exactly when it ends) are EXTEND candidates. Crew already working during
// the gap belong to Plan A and are skipped. Everyone else goes through eligibility,
// youth and overtime checks; any blocking issue (or SMS opt-out) excludes them, with the
// reasons kept so the UI and LLM can explain "why not". Overtime doesn't exclude: those
// candidates are flagged and need the manager's approval before they're texted.
//
// Score (higher first), in the plan's order of importance:
//   +100 no overtime · -10 per pickup in the last 30 days (fairness)
//   +40 x reliability · +0.5 per year of seniority (max 10) · -30 if a trainee here

export const SCORE = {
  noOvertime: 100,
  perPickup: -10,
  reliability: 40,
  perSeniorityYear: 0.5,
  maxSeniorityYears: 10,
  trainee: -30,
} as const;

export interface RankRules {
  timezone: string;
  minRestHours: number;
  maxConsecutiveDays: number;
  overtime: OvertimeRules;
  youth: YouthRules;
  rushWindows: { start: TimeOfDay; end: TimeOfDay }[];
  weekStartsOn?: number;
}

export interface RankInput {
  /** The gap to fill: one station, one window. */
  stationId: string;
  window: Interval;
  stations: StationInfo[];
  crew: CrewInfo[];
  /** Everyone's shifts around the week. */
  shifts: ShiftInfo[];
  /** Station blocks that day (a trainee isn't alone where certified crew still work). */
  assignments: AssignmentInfo[];
  schoolDays: Iterable<IsoDate>;
  rules: RankRules;
  /** Accepted pickups per crew member in the last 30 days (fairness). */
  pickups30d?: Record<string, number>;
  /** Never offer to these, e.g. whoever called out. */
  excludeCrewIds?: string[];
}

export interface Candidate {
  crewId: string;
  kind: OfferKind;
  rank: number;
  score: number;
  level: TrainingLevel;
  isOvertime: boolean;
  addedOtHours: number;
  weekHoursAfter: number;
  /** Plain-English reasons for the LLM's rationale. */
  reasons: string[];
  /** Non-blocking issues (overtime, requested time off, preferred-hours cap). */
  warnings: RuleIssue[];
}

export interface Excluded {
  crewId: string;
  issues: RuleIssue[];
}

export interface RankResult {
  candidates: Candidate[];
  excluded: Excluded[];
}

const LEVEL_LABEL: Record<TrainingLevel, string> = {
  TRAINEE: "Trainee",
  CERTIFIED: "Certified",
  TRAINER: "Trainer",
};

const yearsBetween = (from: IsoDate, to: IsoDate) => {
  const [fy, fm, fd] = from.split("-").map(Number);
  const [ty, tm, td] = to.split("-").map(Number);
  return ty - fy - (tm < fm || (tm === fm && td < fd) ? 1 : 0);
};

export function rankCandidates(input: RankInput): RankResult {
  const { window, rules } = input;
  const tz = rules.timezone;
  const station = input.stations.find((s) => s.id === input.stationId);
  if (!station) throw new Error(`Unknown station ${input.stationId}`);
  const exclude = new Set(input.excludeCrewIds ?? []);
  const schoolDays = [...input.schoolDays];
  const date = localDate(window.start, tz);

  const certifiedCoverage = input.assignments.filter((a) => {
    if (a.stationId !== station.id) return false;
    const level = input.crew.find((c) => c.id === a.crewId)?.stations[
      station.id
    ];
    return level === "CERTIFIED" || level === "TRAINER";
  });

  const scored: Omit<Candidate, "rank">[] = [];
  const excluded: Excluded[] = [];

  for (const c of input.crew) {
    if (exclude.has(c.id)) continue;
    const mine = input.shifts.filter(
      (s) => s.crewId === c.id && isWorkedShift(s),
    );
    // Already working during the gap: that's Plan A's job.
    if (mine.some((s) => overlaps(s, window))) continue;
    const adjacent = mine.some(
      (s) =>
        s.end.getTime() === window.start.getTime() ||
        s.start.getTime() === window.end.getTime(),
    );
    const kind: OfferKind = adjacent ? "EXTEND" : "CALL_IN";

    const eligibility = checkEligibility({
      crew: c,
      station,
      window,
      shifts: mine,
      timezone: tz,
      minRestHours: rules.minRestHours,
      maxConsecutiveDays: rules.maxConsecutiveDays,
      rushWindows: rules.rushWindows,
      certifiedCoverage: certifiedCoverage.filter((a) => a.crewId !== c.id),
    });
    const addition = { ...window, breakMinutes: 0 };
    const youth = checkYouth({
      crew: c,
      station,
      addition,
      shifts: mine,
      schoolDays,
      rules: rules.youth,
      timezone: tz,
      weekStartsOn: rules.weekStartsOn,
    });
    const overtime = checkOvertime({
      crew: c,
      shifts: mine,
      addition,
      rules: rules.overtime,
      timezone: tz,
      weekStartsOn: rules.weekStartsOn,
    });

    const issues: RuleIssue[] = [
      ...eligibility.issues,
      ...youth.issues,
      ...overtime.issues,
    ];
    if (!c.smsOptIn) {
      issues.push({
        code: "SMS_OPT_OUT",
        severity: "block",
        message: `${c.firstName} has opted out of shift texts.`,
      });
    }
    const blocking = issues.filter((i) => i.severity === "block");
    if (blocking.length > 0) {
      excluded.push({ crewId: c.id, issues: blocking });
      continue;
    }

    const level = c.stations[station.id];
    const pickups = input.pickups30d?.[c.id] ?? 0;
    const seniority = yearsBetween(c.hireDate, date);
    const score =
      (overtime.isOvertime ? 0 : SCORE.noOvertime) +
      pickups * SCORE.perPickup +
      c.reliability * SCORE.reliability +
      Math.min(Math.max(seniority, 0), SCORE.maxSeniorityYears) *
        SCORE.perSeniorityYear +
      (level === "TRAINEE" ? SCORE.trainee : 0);

    const reasons = [
      `${LEVEL_LABEL[level]} on ${station.name}`,
      kind === "EXTEND"
        ? `Already working next to the gap: extend to cover ${formatRange(window, tz)}`
        : `Off duty and available ${formatRange(window, tz)}`,
      overtime.isOvertime
        ? `Overtime: +${overtime.addedOtHours}h (${overtime.after.weekHours}h this week); needs approval`
        : `No overtime (${overtime.after.weekHours}h this week)`,
      `${pickups} pickup${pickups === 1 ? "" : "s"} in the last 30 days`,
      `Reliability ${Math.round(c.reliability * 100)}%`,
      `${seniority} year${seniority === 1 ? "" : "s"} with the store`,
    ];
    if (youth.isYouth)
      reasons.push(`Age ${ageOn(c.birthdate, date)}: youth limits checked`);

    scored.push({
      crewId: c.id,
      kind,
      score: Math.round(score * 100) / 100,
      level,
      isOvertime: overtime.isOvertime,
      addedOtHours: overtime.addedOtHours,
      weekHoursAfter: overtime.after.weekHours,
      reasons,
      warnings: issues.filter((i) => i.severity === "warn"),
    });
  }

  const byName = (id: string) =>
    input.crew.find((c) => c.id === id)?.firstName ?? id;
  const candidates = scored
    .sort(
      (a, b) =>
        b.score - a.score || byName(a.crewId).localeCompare(byName(b.crewId)),
    )
    .map((c, i) => ({ ...c, rank: i + 1 }));
  return { candidates, excluded };
}
