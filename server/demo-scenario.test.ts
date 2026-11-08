import { describe, expect, it } from "vitest";

import { rankCandidates } from "@/server/rank";
import {
  computeCoverage,
  computeImpact,
  type CoverageInput,
} from "@/server/rules/coverage";
import { checkEligibility } from "@/server/rules/eligibility";
import { summarizeWeek, weekStartOf } from "@/server/rules/overtime";
import { formatRange, localDate } from "@/server/rules/time";
import { checkYouth, youthRules } from "@/server/rules/youth";
import { rebalance } from "@/server/solver/rebalance";
import {
  CLOSE_TIME,
  OPEN_TIME,
  seedScenario,
} from "@/server/test/seed-scenario";

// End to end on the real seed data (no database): the seeded week must obey the rules
// engine, and Kayla's 4:40am call-out must play out exactly as the demo script says.
// If a seed or rule change breaks the story, this file fails first.

const s = seedScenario();
const tz = s.timezone;
const demoDay = s.plan.demoDay;
const youth = youthRules(s.preset, s.config);
const overtime = {
  method: s.preset.overtimeMethod,
  dailyOtHours: s.config.dailyOtHours,
  weeklyOtHours: s.config.weeklyOtHours,
};
const crewById = new Map(s.crew.map((c) => [c.id, c]));
const stationById = new Map(s.stations.map((st) => [st.id, st]));

const kaylaShift = s.shifts.find(
  (sh) => sh.crewId === "Kayla" && localDate(sh.start, tz) === demoDay,
)!;

const coverage = (date: string): CoverageInput => ({
  date,
  timezone: tz,
  stations: s.stations,
  rules: s.coverageRules,
  assignments: s.assignments,
  openTime: OPEN_TIME,
  closeTime: CLOSE_TIME,
});
const gaps = (
  list: { stationId: string; start: Date; end: Date; missing: number }[],
) => list.map((g) => `${g.stationId} ${formatRange(g, tz)} -${g.missing}`);

describe("the seeded week", () => {
  it("puts the demo on Monday 2026-11-09 and needs no rule-breaking pins", () => {
    expect(demoDay).toBe("2026-11-09");
    expect(s.plan.pinWarnings).toEqual([]);
  });

  it("obeys every eligibility and youth rule", () => {
    const problems: string[] = [];
    for (const sh of s.shifts) {
      const c = crewById.get(sh.crewId)!;
      const mine = s.shifts.filter((x) => x.crewId === sh.crewId);
      for (const a of s.assignments.filter((x) => x.shiftId === sh.id)) {
        const certified = s.assignments.filter((x) => {
          const level = crewById.get(x.crewId)?.stations[x.stationId];
          return (
            x.stationId === a.stationId &&
            x.crewId !== c.id &&
            level !== "TRAINEE"
          );
        });
        const r = checkEligibility({
          crew: c,
          station: stationById.get(a.stationId)!,
          window: a,
          shifts: mine,
          timezone: tz,
          minRestHours: s.config.minRestHours,
          maxConsecutiveDays: s.config.maxConsecutiveDays,
          rushWindows: s.rushWindows,
          certifiedCoverage: certified,
          ignoreShiftIds: [sh.id],
        });
        for (const i of r.issues)
          problems.push(`${c.id} ${formatRange(a, tz)}: ${i.code}`);
      }
      const y = checkYouth({
        crew: c,
        station: { name: "", youthRestricted: false },
        addition: sh,
        shifts: mine,
        schoolDays: s.schoolDays,
        rules: youth,
        timezone: tz,
        ignoreShiftIds: [sh.id],
      });
      for (const i of y.issues)
        problems.push(`${c.id} ${formatRange(sh, tz)}: ${i.code}`);
    }
    expect(problems).toEqual([]);
  });

  it("has no overtime for anyone", () => {
    const weeks = [
      ...new Set(s.shifts.map((sh) => weekStartOf(localDate(sh.start, tz)))),
    ];
    const overtimeCrew = s.crew.flatMap((c) =>
      weeks
        .map((w) =>
          summarizeWeek(
            s.shifts.filter((sh) => sh.crewId === c.id),
            w,
            overtime,
            tz,
          ),
        )
        .filter((w) => w.otHours > 0)
        .map((w) => `${c.id} week of ${w.weekStart}: ${w.weekHours}h`),
    );
    expect(overtimeCrew).toEqual([]);
  });

  it("covers the demo day completely before the call-out", () => {
    const r = computeCoverage(coverage(demoDay));
    expect(r.shortfalls).toEqual([]);
    expect(r.supervisorGaps).toEqual([]);
  });
});

describe("Kayla calls in sick at 4:40am", () => {
  it("leaves exactly headset 05:30-10:00 and Beverage 10:00-14:00 short", () => {
    const impact = computeImpact(coverage(demoDay), [kaylaShift.id]);
    expect(gaps(impact.shortfalls)).toEqual([
      "BEV Mon 10:00-14:00 -1",
      "DT-OT Mon 05:30-10:00 -1",
    ]);
  });

  const planA = rebalance({
    coverage: coverage(demoDay),
    removedShiftIds: [kaylaShift.id],
    crew: s.crew,
    rushWindows: s.rushWindows,
    youthUnderAge: s.config.youthUnderAge,
  });

  it("Plan A moves Aisha from Lobby to headset for the rush", () => {
    expect(
      planA.moves.map(
        (m) =>
          `${m.crewId} ${m.fromStationId}->${m.toStationId} ${formatRange(m, tz)}`,
      ),
    ).toEqual(["Aisha LOBBY->DT-OT Mon 05:30-10:00"]);
    expect(gaps(planA.remainingShortfall)).toEqual([
      "BEV Mon 10:00-14:00 -1",
      "LOBBY Mon 05:30-10:00 -1",
    ]);
  });

  const rank = (stationId: string) => {
    const gap = planA.remainingShortfall.find(
      (g) => g.stationId === stationId,
    )!;
    return rankCandidates({
      stationId,
      window: gap,
      stations: s.stations,
      crew: s.crew,
      shifts: s.shifts.filter((sh) => sh.id !== kaylaShift.id),
      assignments: s.assignments.filter((a) => a.shiftId !== kaylaShift.id),
      schoolDays: s.schoolDays,
      rules: {
        timezone: tz,
        minRestHours: s.config.minRestHours,
        maxConsecutiveDays: s.config.maxConsecutiveDays,
        overtime,
        youth,
        rushWindows: s.rushWindows,
      },
      excludeCrewIds: ["Kayla"],
    });
  };

  it("Plan B for Beverage: Ben, Noah, Hannah, then Sofia's extension flagged OT", () => {
    const r = rank("BEV");
    expect(
      r.candidates.map(
        (c) => `${c.crewId} ${c.kind}${c.isOvertime ? " OT" : ""}`,
      ),
    ).toEqual([
      "Ben CALL_IN",
      "Noah CALL_IN",
      "Hannah CALL_IN",
      "Sofia EXTEND OT",
    ]);
  });

  it("Plan B for Lobby 05:30-10:00 finds nobody; Noah is blocked by the rest gap", () => {
    const r = rank("LOBBY");
    expect(r.candidates).toEqual([]);
    const why = (id: string) =>
      r.excluded.find((e) => e.crewId === id)?.issues.map((i) => i.code);
    expect(why("Noah")).toEqual(["REST_GAP"]);
    expect(why("Diego")).toContain("TIME_OFF");
    expect(why("Maya")).toContain("YOUTH_HOURS_WINDOW");
  });
});
