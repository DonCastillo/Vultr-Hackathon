import { describe, expect, it } from "vitest";

import type { CoverageInput } from "@/server/rules/coverage";
import { formatRange, localWindow } from "@/server/rules/time";
import type {
  AssignmentInfo,
  CoverageRuleInfo,
  CrewInfo,
  StationInfo,
} from "@/server/rules/types";

import { rebalance, type RebalanceInput } from "./rebalance";

const TZ = "America/Edmonton";
const MON = "2026-11-09";
const RUSH = [
  { start: "05:30", end: "10:00" },
] as RebalanceInput["rushWindows"];

const station = (
  id: string,
  priority: number,
  over: Partial<StationInfo> = {},
): StationInfo => ({
  id,
  shortCode: id,
  name: id,
  priority,
  requiredCert: null,
  minLevelDuringRush: "TRAINEE",
  youthRestricted: false,
  isSupervisor: false,
  ...over,
});

// The seeded stations (priorities and flags as in prisma/seed/store.ts).
const STATIONS = [
  station("dtot", 1, { minLevelDuringRush: "CERTIFIED" }),
  station("dtwin", 2, { minLevelDuringRush: "CERTIFIED" }),
  station("bev", 3, { minLevelDuringRush: "CERTIFIED" }),
  station("ctr", 4),
  station("sand", 5, { requiredCert: "FOOD_HANDLER" }),
  station("oven", 6, { requiredCert: "FOOD_HANDLER", youthRestricted: true }),
  station("supv", 7, { requiredCert: "SUPERVISOR", isSupervisor: true }),
  station("baker", 8, { requiredCert: "BAKER", youthRestricted: true }),
  station("lobby", 9),
];

const rule = (
  stationId: string,
  start: string,
  end: string,
  minCount: number,
): CoverageRuleInfo => ({
  stationId,
  weekday: null,
  daypart: start === "05:30" ? "MORNING_RUSH" : "MIDDAY",
  start: start as "00:00",
  end: end as "00:00",
  minCount,
});

const SEED_RULES = [
  ...Object.entries({
    dtot: 2,
    dtwin: 1,
    bev: 2,
    ctr: 1,
    sand: 1,
    oven: 1,
    supv: 1,
    lobby: 1,
  }).map(([s, n]) => rule(s, "05:30", "10:00", n)),
  ...["dtot", "dtwin", "bev", "ctr", "sand", "oven", "supv", "lobby"].map((s) =>
    rule(s, "10:00", "14:00", 1),
  ),
];

const FOOD = { type: "FOOD_HANDLER" as const, expiresAt: "2028-01-01" };
const person = (
  id: string,
  stations: CrewInfo["stations"],
  over: Partial<CrewInfo> = {},
): CrewInfo => ({
  id,
  firstName: id,
  lastName: "",
  birthdate: "1995-01-01",
  isStudent: false,
  hireDate: "2022-01-01",
  reliability: 0.9,
  maxWeeklyHours: null,
  smsOptIn: true,
  active: true,
  stations,
  certs: [],
  availability: [],
  timeOff: [],
  ...over,
});

const C = "CERTIFIED" as const;
const SEED_CREW = [
  person(
    "Dana",
    { supv: "TRAINER", dtot: C, dtwin: C, bev: C, ctr: C },
    { certs: [{ type: "SUPERVISOR", expiresAt: null }, FOOD] },
  ),
  person("Omar", { dtot: C, dtwin: C, ctr: C }),
  person("Kayla", { dtot: "TRAINER", dtwin: C, bev: C, ctr: C }),
  person("Zoe", { dtwin: C, bev: C, ctr: C }),
  person("Isabel", { bev: C, ctr: C, lobby: C }),
  person("Sofia", { bev: "TRAINER", dtot: C }),
  person(
    "Olivia",
    { sand: C, oven: C, ctr: C },
    { certs: [{ type: "FOOD_HANDLER", expiresAt: "2026-10-31" }] },
  ),
  person("Jamal", { sand: "TRAINER", oven: C, lobby: C }, { certs: [FOOD] }),
  person("Lucas", { oven: C, sand: C, lobby: C }, { certs: [FOOD] }),
  person("Aisha", { lobby: C, dtot: C, ctr: C }),
];

let n = 0;
const block = (
  crewId: string,
  stationId: string,
  start: string,
  end: string,
): AssignmentInfo => ({
  id: `a${n++}`,
  shiftId: `shift-${crewId}`,
  crewId,
  stationId,
  ...localWindow(MON, start, end, TZ),
});

/** The seeded demo-day morning. */
const DEMO = [
  block("Dana", "supv", "05:30", "14:00"),
  block("Omar", "dtot", "05:30", "14:00"),
  block("Kayla", "dtot", "05:30", "10:00"),
  block("Kayla", "bev", "10:00", "14:00"),
  block("Zoe", "dtwin", "05:30", "14:00"),
  block("Isabel", "bev", "05:30", "10:00"),
  block("Sofia", "bev", "05:00", "10:00"),
  block("Olivia", "ctr", "05:30", "14:00"),
  block("Jamal", "sand", "05:30", "14:00"),
  block("Lucas", "oven", "05:30", "14:00"),
  block("Aisha", "lobby", "05:30", "14:00"),
];

const coverage = (
  assignments: AssignmentInfo[],
  over: Partial<CoverageInput> = {},
): CoverageInput => ({
  date: MON,
  timezone: TZ,
  stations: STATIONS,
  rules: SEED_RULES,
  assignments,
  openTime: "05:00",
  closeTime: "23:00",
  ...over,
});

const run = (over: Partial<RebalanceInput> = {}) =>
  rebalance({
    coverage: coverage(DEMO),
    removedShiftIds: ["shift-Kayla"],
    crew: SEED_CREW,
    rushWindows: RUSH,
    youthUnderAge: 15,
    ...over,
  });

const moves = (r: ReturnType<typeof rebalance>) =>
  r.moves.map(
    (m) =>
      `${m.crewId} ${m.fromStationId}->${m.toStationId} ${formatRange(m, TZ)}`,
  );
const gaps = (
  list: { stationId: string; start: Date; end: Date; missing: number }[],
) => list.map((s) => `${s.stationId} ${formatRange(s, TZ)} -${s.missing}`);

describe("rebalance: the demo call-out", () => {
  const r = run();

  it("starts from exactly the gaps Kayla's call-out causes", () => {
    expect(gaps(r.shortfall)).toEqual([
      "bev Mon 10:00-14:00 -1",
      "dtot Mon 05:30-10:00 -1",
    ]);
  });

  it("moves Aisha from Lobby to headset for the rush", () => {
    expect(moves(r)).toEqual(["Aisha lobby->dtot Mon 05:30-10:00"]);
  });

  it("leaves Beverage 10-14 and the Lobby she left for Plan B", () => {
    expect(gaps(r.remainingShortfall)).toEqual([
      "bev Mon 10:00-14:00 -1",
      "lobby Mon 05:30-10:00 -1",
    ]);
    expect(r.costAfter).toBeLessThan(r.costBefore);
  });

  it("never pulls Dana: she's the only supervisor (and covers Beverage)", () => {
    expect(r.moves.some((m) => m.crewId === "Dana")).toBe(false);
  });

  it("doesn't touch crew whose shift is removed", () => {
    expect(r.moves.some((m) => m.crewId === "Kayla")).toBe(false);
  });
});

describe("rebalance: rules for moves", () => {
  // A minimal day: one gap on `target`, one possible donor on lobby.
  const oneGap = (
    target: string,
    donor: CrewInfo,
    window: [string, string] = ["10:00", "14:00"],
  ) => {
    const assignments = [
      block("Dana", "supv", "05:30", "14:00"),
      block("Gone", target, window[0], window[1]),
      block(donor.id, "lobby", window[0], window[1]),
    ];
    const rules = [
      rule(target, "10:00", "14:00", 1),
      rule("lobby", "10:00", "14:00", 0),
    ];
    return run({
      coverage: coverage(assignments, { rules }),
      removedShiftIds: ["shift-Gone"],
      crew: [SEED_CREW[0], donor],
    });
  };

  it("moves a trained donor", () => {
    expect(moves(oneGap("ctr", person("Pat", { lobby: C, ctr: C })))).toEqual([
      "Pat lobby->ctr Mon 10:00-14:00",
    ]);
  });

  it("won't move someone untrained on the gap station", () => {
    expect(oneGap("ctr", person("Pat", { lobby: C })).moves).toEqual([]);
  });

  it("won't move someone with an expired cert (Olivia)", () => {
    const olivia = person(
      "Olivia",
      { lobby: C, sand: C },
      { certs: [{ type: "FOOD_HANDLER", expiresAt: "2026-10-31" }] },
    );
    expect(oneGap("sand", olivia).moves).toEqual([]);
  });

  it("won't move a 14-year-old onto a youth-restricted station", () => {
    const maya = person(
      "Maya",
      { lobby: C, oven: C },
      { birthdate: "2012-02-11", certs: [FOOD] },
    );
    expect(oneGap("oven", maya).moves).toEqual([]);
    const adult = person("Lee", { lobby: C, oven: C }, { certs: [FOOD] });
    expect(oneGap("oven", adult).moves).toHaveLength(1);
  });

  it("won't leave a trainee alone on a rush-critical station during rush", () => {
    const trainee = person("Tia", { lobby: C, bev: "TRAINEE" });
    const assignments = [
      block("Dana", "supv", "05:30", "14:00"),
      block("Gone", "bev", "05:30", "10:00"),
      block("Tia", "lobby", "05:30", "10:00"),
    ];
    const rules = [rule("bev", "05:30", "10:00", 1)];
    const alone = run({
      coverage: coverage(assignments, { rules }),
      removedShiftIds: ["shift-Gone"],
      crew: [SEED_CREW[0], trainee],
    });
    expect(alone.moves).toEqual([]);

    // With a certified barista still on Beverage (and two needed), the trainee can join.
    const withCertified = run({
      coverage: coverage(
        [...assignments, block("Zoe", "bev", "05:30", "10:00")],
        {
          rules: [rule("bev", "05:30", "10:00", 2)],
        },
      ),
      removedShiftIds: ["shift-Gone"],
      crew: [SEED_CREW[0], SEED_CREW[3], trainee],
    });
    expect(moves(withCertified)).toEqual(["Tia lobby->bev Mon 05:30-10:00"]);
  });

  it("moves a supervisor only when another one stays on the floor", () => {
    const marcus = person(
      "Marcus",
      { supv: C, ctr: C },
      { certs: [{ type: "SUPERVISOR", expiresAt: null }] },
    );
    const assignments = [
      block("Dana", "supv", "10:00", "14:00"),
      block("Gone", "ctr", "10:00", "14:00"),
    ];
    const rules = [
      rule("ctr", "10:00", "14:00", 1),
      rule("supv", "10:00", "14:00", 1),
    ];
    const solo = run({
      coverage: coverage(assignments, { rules }),
      removedShiftIds: ["shift-Gone"],
      crew: [SEED_CREW[0], marcus],
    });
    expect(solo.moves).toEqual([]);

    const pair = run({
      coverage: coverage(
        [...assignments, block("Marcus", "supv", "10:00", "14:00")],
        { rules },
      ),
      removedShiftIds: ["shift-Gone"],
      crew: [SEED_CREW[0], marcus],
    });
    // Either supervisor can go; one stays.
    expect(pair.moves).toHaveLength(1);
    expect(pair.moves[0]).toMatchObject({
      fromStationId: "supv",
      toStationId: "ctr",
    });
    expect(pair.remainingShortfall).toEqual([]);
  });

  it("only moves the part of a block that overlaps the gap", () => {
    const pat = person("Pat", { lobby: C, ctr: C });
    const assignments = [
      block("Dana", "supv", "05:30", "14:00"),
      block("Gone", "ctr", "10:00", "14:00"),
      block("Pat", "lobby", "12:00", "16:00"),
    ];
    const r = run({
      coverage: coverage(assignments, {
        rules: [rule("ctr", "10:00", "14:00", 1)],
      }),
      removedShiftIds: ["shift-Gone"],
      crew: [SEED_CREW[0], pat],
    });
    expect(moves(r)).toEqual(["Pat lobby->ctr Mon 12:00-14:00"]);
    expect(gaps(r.remainingShortfall)).toEqual(["ctr Mon 10:00-12:00 -1"]);
  });

  it("takes a spare person from a more critical station when it costs nothing", () => {
    const extra = person("Rae", { dtwin: C, ctr: C });
    const assignments = [
      block("Dana", "supv", "10:00", "14:00"),
      block("Zoe", "dtwin", "10:00", "14:00"),
      block("Rae", "dtwin", "10:00", "14:00"),
      block("Gone", "ctr", "10:00", "14:00"),
    ];
    const rules = [
      rule("dtwin", "10:00", "14:00", 1),
      rule("ctr", "10:00", "14:00", 1),
    ];
    const r = run({
      coverage: coverage(assignments, { rules }),
      removedShiftIds: ["shift-Gone"],
      crew: [SEED_CREW[0], SEED_CREW[3], extra],
    });
    expect(r.moves).toHaveLength(1);
    expect(r.moves[0]).toMatchObject({
      fromStationId: "dtwin",
      toStationId: "ctr",
    });
    expect(r.remainingShortfall).toEqual([]);
  });

  it("returns no moves when nothing is short", () => {
    const r = run({ removedShiftIds: [] });
    expect(r).toMatchObject({
      moves: [],
      shortfall: [],
      remainingShortfall: [],
      costBefore: 0,
      costAfter: 0,
    });
  });
});

describe("rebalance: search", () => {
  it("backtracks past the greedy first choice to a cheaper two-move plan", () => {
    // Gaps on headset and Beverage. Pat (Lobby) can do either; Quinn (Counter) only headset.
    // Greedy sends Pat to headset (cheapest single move) and strands Beverage.
    // Better: Quinn -> headset, Pat -> Beverage, leaving only cheap Counter and Lobby gaps.
    const pat = person("Pat", { lobby: C, dtot: C, bev: C });
    const quinn = person("Quinn", { ctr: C, dtot: C });
    const assignments = [
      block("Dana", "supv", "10:00", "14:00"),
      block("Gone", "dtot", "10:00", "14:00"),
      block("Gone", "bev", "10:00", "14:00"),
      block("Pat", "lobby", "10:00", "14:00"),
      block("Quinn", "ctr", "10:00", "14:00"),
    ];
    const rules = ["dtot", "bev", "ctr", "lobby"].map((s) =>
      rule(s, "10:00", "14:00", 1),
    );
    const greedyOnly = run({
      coverage: coverage(assignments, { rules }),
      removedShiftIds: ["shift-Gone"],
      crew: [SEED_CREW[0], pat, quinn],
      maxMoves: 1,
    });
    const r = run({
      coverage: coverage(assignments, { rules }),
      removedShiftIds: ["shift-Gone"],
      crew: [SEED_CREW[0], pat, quinn],
    });
    expect(moves(greedyOnly)).toEqual(["Pat lobby->dtot Mon 10:00-14:00"]);
    expect(moves(r).sort()).toEqual([
      "Pat lobby->bev Mon 10:00-14:00",
      "Quinn ctr->dtot Mon 10:00-14:00",
    ]);
    expect(r.costAfter).toBeLessThan(greedyOnly.costAfter);
    expect(gaps(r.remainingShortfall)).toEqual([
      "ctr Mon 10:00-14:00 -1",
      "lobby Mon 10:00-14:00 -1",
    ]);
  });
});
