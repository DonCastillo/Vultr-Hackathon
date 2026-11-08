import { describe, expect, it } from "vitest";

import {
  computeCoverage,
  computeImpact,
  rulesForDate,
  type CoverageInput,
} from "./coverage";
import { formatRange, localWindow } from "./time";
import type { AssignmentInfo, CoverageRuleInfo, StationInfo } from "./types";

const TZ = "America/Edmonton";
const SUN = "2026-11-08";
const MON = "2026-11-09"; // demo day

const st = (
  id: string,
  name: string,
  priority: number,
  isSupervisor = false,
): StationInfo => ({
  id,
  shortCode: id,
  name,
  priority,
  requiredCert: null,
  minLevelDuringRush: "TRAINEE",
  youthRestricted: false,
  isSupervisor,
});
const STATIONS = [
  st("dtot", "Drive-Thru Order Taker", 1),
  st("bev", "Beverage/Barista", 3),
  st("supv", "Shift Supervisor", 7, true),
  st("baker", "Overnight Baker", 8),
  st("lobby", "Lobby/Dishes/Restock", 9),
];

const rule = (
  stationId: string,
  daypart: CoverageRuleInfo["daypart"],
  start: string,
  end: string,
  minCount: number,
  weekday: number | null = null,
): CoverageRuleInfo => ({
  stationId,
  weekday,
  daypart,
  start: start as "00:00",
  end: end as "00:00",
  minCount,
});

const RULES = [
  rule("dtot", "MORNING_RUSH", "05:30", "10:00", 2),
  rule("bev", "MORNING_RUSH", "05:30", "10:00", 2),
  rule("supv", "MORNING_RUSH", "05:30", "10:00", 1),
  rule("lobby", "MORNING_RUSH", "05:30", "10:00", 1),
  rule("dtot", "MIDDAY", "10:00", "14:00", 1),
  rule("bev", "MIDDAY", "10:00", "14:00", 1),
  rule("supv", "MIDDAY", "10:00", "14:00", 1),
  rule("lobby", "MIDDAY", "10:00", "14:00", 1),
];

let n = 0;
const block = (
  shiftId: string,
  stationId: string,
  start: string,
  end: string,
  date = MON,
): AssignmentInfo => ({
  id: `a${n++}`,
  shiftId,
  crewId: shiftId,
  stationId,
  ...localWindow(date, start, end, TZ),
});

/** The seeded demo-day morning. */
const DEMO = [
  block("dana", "supv", "05:30", "14:00"),
  block("omar", "dtot", "05:30", "14:00"),
  block("kayla", "dtot", "05:30", "10:00"),
  block("kayla", "bev", "10:00", "14:00"),
  block("isabel", "bev", "05:30", "10:00"),
  block("sofia", "bev", "05:00", "10:00"),
  block("aisha", "lobby", "05:30", "14:00"),
];

const input = (over: Partial<CoverageInput> = {}): CoverageInput => ({
  date: MON,
  timezone: TZ,
  stations: STATIONS,
  rules: RULES,
  assignments: DEMO,
  openTime: "05:00",
  closeTime: "23:00",
  ...over,
});

const range = (s: { start: Date; end: Date }) => formatRange(s, TZ);
const brief = (
  list: { stationId: string; start: Date; end: Date; missing: number }[],
) => list.map((s) => `${s.stationId} ${range(s)} -${s.missing}`);

describe("computeCoverage", () => {
  it("finds the seeded demo morning fully covered", () => {
    const r = computeCoverage(input());
    expect(r.shortfalls).toEqual([]);
    expect(r.supervisorGaps).toEqual([]);
    expect(r.issues).toEqual([]);
    // 4 stations x (4.5h + 4h) of 15-minute slots
    expect(r.slots).toHaveLength(4 * 34);
  });

  it("merges short slots into ranges and splits them where the numbers change", () => {
    const r = computeCoverage(
      input({ assignments: DEMO.filter((a) => a.stationId !== "dtot") }),
    );
    expect(brief(r.shortfalls)).toEqual([
      "dtot Mon 05:30-10:00 -2",
      "dtot Mon 10:00-14:00 -1",
    ]);
    expect(r.issues[0]).toEqual({
      code: "COVERAGE_SHORT",
      severity: "warn",
      message:
        "Drive-Thru Order Taker Mon 05:30-10:00: 0 of 2 scheduled (short 2).",
    });
  });

  it("only counts a block for a slot it covers completely", () => {
    const late = DEMO.map((a) =>
      a.shiftId === "aisha" ? block("aisha", "lobby", "05:40", "14:00") : a,
    );
    expect(
      brief(computeCoverage(input({ assignments: late })).shortfalls),
    ).toEqual(["lobby Mon 05:30-05:45 -1"]);
  });

  it("ignores blocks on other days", () => {
    const sunday = DEMO.map((a) => ({
      ...a,
      ...localWindow(SUN, "05:30", "14:00", TZ),
    }));
    const r = computeCoverage(input({ assignments: sunday }));
    expect(r.shortfalls.map((s) => s.stationId).sort()).toEqual([
      "bev",
      "bev",
      "dtot",
      "dtot",
      "lobby",
      "supv",
    ]);
  });

  it("uses a weekday-specific rule instead of the every-day one", () => {
    const rules = [
      ...RULES,
      rule("dtot", "MORNING_RUSH", "05:30", "10:00", 3, 1),
    ]; // Mondays
    expect(
      rulesForDate(rules, MON).filter(
        (r) => r.stationId === "dtot" && r.daypart === "MORNING_RUSH",
      ),
    ).toEqual([expect.objectContaining({ minCount: 3, weekday: 1 })]);
    expect(brief(computeCoverage(input({ rules })).shortfalls)).toEqual([
      "dtot Mon 05:30-10:00 -1",
    ]);
    // Sunday falls back to the every-day rule.
    const sunday = DEMO.map((a) => ({
      ...a,
      start: new Date(a.start.getTime() - 86_400_000),
      end: new Date(a.end.getTime() - 86_400_000),
    }));
    expect(
      computeCoverage(input({ date: SUN, rules, assignments: sunday }))
        .shortfalls,
    ).toEqual([]);
  });

  it("runs the overnight daypart past midnight, outside the supervisor rule", () => {
    const rules = [rule("baker", "OVERNIGHT", "23:00", "05:00", 1)];
    const covered = computeCoverage(
      input({
        rules,
        assignments: [block("tomas", "baker", "22:30", "06:30")],
      }),
    );
    expect(covered.slots).toHaveLength(24);
    expect(covered.shortfalls).toEqual([]);
    expect(covered.supervisorGaps).toEqual([]); // store is closed overnight

    const empty = computeCoverage(input({ rules, assignments: [] }));
    expect(brief(empty.shortfalls)).toEqual(["baker Mon 23:00-Tue 05:00 -1"]);
  });

  it("flags slots in store hours with nobody on a supervisor station", () => {
    const r = computeCoverage(
      input({ assignments: DEMO.filter((a) => a.shiftId !== "dana") }),
    );
    expect(r.supervisorGaps.map(range)).toEqual(["Mon 05:30-14:00"]);
    expect(r.issues.map((i) => i.code)).toEqual([
      "COVERAGE_SHORT",
      "NO_SUPERVISOR",
    ]);
    expect(r.issues[1].message).toBe(
      "No supervisor on the floor Mon 05:30-14:00.",
    );
  });
});

describe("computeImpact", () => {
  it("Kayla's call-out leaves exactly headset 05:30-10:00 and Beverage 10:00-14:00 short", () => {
    const r = computeImpact(input(), ["kayla"]);
    expect(r.before.shortfalls).toEqual([]);
    expect(r.shortfalls).toEqual([
      expect.objectContaining({
        stationId: "bev",
        required: 1,
        scheduled: 0,
        missing: 1,
      }),
      expect.objectContaining({
        stationId: "dtot",
        required: 2,
        scheduled: 1,
        missing: 1,
      }),
    ]);
    expect(brief(r.shortfalls)).toEqual([
      "bev Mon 10:00-14:00 -1",
      "dtot Mon 05:30-10:00 -1",
    ]);
    expect(r.supervisorGaps).toEqual([]);
  });

  it("doesn't blame the call-out for gaps that were already there", () => {
    const noLobby = DEMO.filter((a) => a.shiftId !== "aisha");
    const r = computeImpact(input({ assignments: noLobby }), ["kayla"]);
    expect(brief(r.after.shortfalls)).toContain("lobby Mon 05:30-14:00 -1");
    expect(brief(r.shortfalls)).toEqual([
      "bev Mon 10:00-14:00 -1",
      "dtot Mon 05:30-10:00 -1",
    ]);
  });

  it("counts only the newly missing people where a slot was already short", () => {
    const oneHeadset = DEMO.filter((a) => a.shiftId !== "omar"); // dtot already -1 at rush
    const r = computeImpact(input({ assignments: oneHeadset }), ["kayla"]);
    const dtot = r.shortfalls.filter((s) => s.stationId === "dtot");
    expect(brief(dtot)).toEqual(["dtot Mon 05:30-10:00 -1"]);
    expect(dtot[0]).toMatchObject({ required: 2, scheduled: 0, missing: 1 });
  });

  it("reports a supervisor's call-out as a new supervisor gap", () => {
    const r = computeImpact(input(), ["dana"]);
    expect(r.supervisorGaps.map(range)).toEqual(["Mon 05:30-14:00"]);
    expect(brief(r.shortfalls)).toEqual(["supv Mon 05:30-14:00 -1"]);
  });
});
