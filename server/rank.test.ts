import { describe, expect, it } from "vitest";

import { rankCandidates, type RankInput } from "./rank";
import { getPreset } from "./rules/presets";
import { addDays, localWindow } from "./rules/time";
import type { CrewInfo, ShiftInfo, StationInfo } from "./rules/types";
import { youthRules } from "./rules/youth";

const TZ = "America/Edmonton";
const SUN = "2026-11-08";
const MON = "2026-11-09"; // demo day, a school day
const SCHOOL_DAYS = [MON, addDays(MON, 1), addDays(MON, 3), addDays(MON, 4)];
const ALL = [0, 1, 2, 3, 4, 5, 6];
const WEEKDAYS = [1, 2, 3, 4, 5];

const station = (
  id: string,
  name: string,
  over: Partial<StationInfo> = {},
): StationInfo => ({
  id,
  shortCode: id,
  name,
  priority: 3,
  requiredCert: null,
  minLevelDuringRush: "CERTIFIED",
  youthRestricted: false,
  isSupervisor: false,
  ...over,
});
const STATIONS = [
  station("bev", "Beverage/Barista"),
  station("lobby", "Lobby/Dishes/Restock", {
    priority: 9,
    minLevelDuringRush: "TRAINEE",
  }),
];

const avail = (days: number[], start: string, end: string) =>
  days.map((weekday) => ({
    weekday,
    start: start as "00:00",
    end: end as "00:00",
  }));

const person = (id: string, over: Partial<CrewInfo>): CrewInfo => ({
  id,
  firstName: id,
  lastName: "",
  birthdate: "1995-01-01",
  isStudent: false,
  hireDate: "2022-01-01",
  reliability: 0.85,
  maxWeeklyHours: null,
  smsOptIn: true,
  active: true,
  stations: { bev: "CERTIFIED" },
  certs: [],
  availability: avail(ALL, "05:00", "21:00"),
  timeOff: [],
  ...over,
});

let n = 0;
const shift = (
  crewId: string,
  date: string,
  start: string,
  end: string,
  breakMinutes = 0,
  status: ShiftInfo["status"] = "SCHEDULED",
): ShiftInfo => ({
  id: `s${n++}`,
  crewId,
  ...localWindow(date, start, end, TZ),
  breakMinutes,
  status,
});
const fullDay = (crewId: string, date: string) =>
  shift(crewId, date, "05:30", "14:00", 30);

// The seeded demo cast, as it matters for Beverage 10:00-14:00 on Monday.
const CREW = [
  person("Ben", {
    hireDate: "2021-01-11",
    reliability: 0.92,
    availability: avail(ALL, "05:00", "15:00"),
  }),
  person("Noah", {
    hireDate: "2023-05-15",
    reliability: 0.8,
    stations: { bev: "CERTIFIED", lobby: "CERTIFIED" },
    availability: avail(ALL, "05:00", "23:30"),
  }),
  person("Sofia", {
    hireDate: "2019-10-07",
    reliability: 0.9,
    stations: { bev: "TRAINER" },
  }),
  person("Kayla", { hireDate: "2020-05-04" }),
  person("Zoe", {}),
  person("Isabel", { availability: avail(ALL, "05:00", "10:30") }),
  person("Maya", {
    birthdate: "2012-02-11",
    isStudent: true,
    availability: [
      ...avail(WEEKDAYS, "16:00", "20:00"),
      ...avail([0, 6], "07:00", "17:00"),
    ],
  }),
  person("Diego", {
    timeOff: [
      {
        ...localWindow(SUN, "00:00", "00:00", TZ),
        end: localWindow(addDays(MON, 2), "00:00", "00:00", TZ).start,
        status: "APPROVED",
      },
    ],
  }),
  person("Rhea", { smsOptIn: false }),
  person("Hannah", {
    hireDate: "2025-09-02",
    reliability: 0.78,
    stations: { bev: "TRAINEE" },
    availability: avail(ALL, "06:00", "14:00"),
  }),
];

const SHIFTS = [
  // Ben: off Monday, four full days later in the week (32h).
  ...[1, 2, 3, 4].map((i) => fullDay("Ben", addDays(MON, i))),
  // Noah closed Sunday night, off Monday.
  shift("Noah", SUN, "14:00", "23:00", 60),
  // Sofia: Beverage 05:00-10:00 Monday, 41.5h this week.
  shift("Sofia", MON, "05:00", "10:00"),
  shift("Sofia", addDays(MON, 1), "05:30", "10:00"),
  ...[2, 3, 4, 5].map((i) => fullDay("Sofia", addDays(MON, i))),
  // Kayla called out; Zoe is working through the gap; Isabel ends at 10:00.
  shift("Kayla", MON, "05:30", "14:00", 30, "CALLED_OUT"),
  fullDay("Zoe", MON),
  shift("Isabel", MON, "05:30", "10:00"),
];

const input = (over: Partial<RankInput> = {}): RankInput => {
  const ab = getPreset("ALBERTA");
  return {
    stationId: "bev",
    window: localWindow(MON, "10:00", "14:00", TZ),
    stations: STATIONS,
    crew: CREW,
    shifts: SHIFTS,
    assignments: [],
    schoolDays: SCHOOL_DAYS,
    rules: {
      timezone: TZ,
      minRestHours: ab.minRestHours,
      maxConsecutiveDays: ab.maxConsecutiveDays,
      overtime: {
        method: ab.overtimeMethod,
        dailyOtHours: ab.dailyOtHours,
        weeklyOtHours: ab.weeklyOtHours,
      },
      youth: youthRules(ab),
      rushWindows: [{ start: "05:30", end: "10:00" }],
    },
    excludeCrewIds: ["Kayla"],
    ...over,
  };
};

const order = (r: ReturnType<typeof rankCandidates>) =>
  r.candidates.map((c) => c.crewId);
const excludedCodes = (r: ReturnType<typeof rankCandidates>, id: string) =>
  r.excluded.find((e) => e.crewId === id)?.issues.map((i) => i.code);

describe("rankCandidates: Beverage 10:00-14:00 on the demo day", () => {
  const r = rankCandidates(input());

  it("ranks Ben, then Noah, then the trainee, with Sofia's overtime extension last", () => {
    expect(order(r)).toEqual(["Ben", "Noah", "Hannah", "Sofia"]);
    expect(r.candidates.map((c) => c.rank)).toEqual([1, 2, 3, 4]);
  });

  it("scores by no-OT, fairness, reliability, seniority and training level", () => {
    // Ben: 100 + 40 x 0.92 + 0.5 x 5y = 139.3; Noah: 100 + 32 + 1.5 = 133.5
    // Hannah: 100 + 31.2 + 0.5 - 30 = 101.7; Sofia (OT): 0 + 36 + 3.5 = 39.5
    expect(r.candidates.map((c) => c.score)).toEqual([
      139.3, 133.5, 101.7, 39.5,
    ]);
  });

  it("offers Ben a call-in with no overtime and explains why", () => {
    expect(r.candidates[0]).toMatchObject({
      kind: "CALL_IN",
      isOvertime: false,
      weekHoursAfter: 36,
      level: "CERTIFIED",
      warnings: [],
    });
    expect(r.candidates[0].reasons).toEqual([
      "Certified on Beverage/Barista",
      "Off duty and available Mon 10:00-14:00",
      "No overtime (36h this week)",
      "0 pickups in the last 30 days",
      "Reliability 92%",
      "5 years with the store",
    ]);
  });

  it("rests Noah enough for 10:00 after closing at 23:00", () => {
    expect(r.candidates[1]).toMatchObject({
      crewId: "Noah",
      kind: "CALL_IN",
      isOvertime: false,
    });
  });

  it("offers Sofia an extension flagged as overtime", () => {
    const sofia = r.candidates[3];
    expect(sofia).toMatchObject({
      kind: "EXTEND",
      isOvertime: true,
      addedOtHours: 1.5,
      weekHoursAfter: 45.5,
    });
    expect(sofia.warnings.map((w) => w.code)).toEqual(["OVERTIME"]);
    expect(sofia.reasons[2]).toBe(
      "Overtime: +1.5h (45.5h this week); needs approval",
    );
  });

  it("excludes the rest with their reasons", () => {
    expect(excludedCodes(r, "Isabel")).toEqual(["UNAVAILABLE"]);
    expect(excludedCodes(r, "Maya")).toEqual([
      "UNAVAILABLE",
      "YOUTH_SCHOOL_DAY_HOURS",
    ]);
    expect(excludedCodes(r, "Diego")).toEqual(["TIME_OFF"]);
    expect(excludedCodes(r, "Rhea")).toEqual(["SMS_OPT_OUT"]);
  });

  it("skips whoever called out and anyone already working the gap", () => {
    const everyone = [
      ...r.candidates.map((c) => c.crewId),
      ...r.excluded.map((e) => e.crewId),
    ];
    expect(everyone).not.toContain("Kayla");
    expect(everyone).not.toContain("Zoe");
  });
});

describe("rankCandidates: other cases", () => {
  it("won't call Noah in for Lobby at 05:30 after closing at 23:00 (rest gap)", () => {
    const r = rankCandidates(
      input({
        stationId: "lobby",
        window: localWindow(MON, "05:30", "10:00", TZ),
      }),
    );
    expect(excludedCodes(r, "Noah")).toEqual(["REST_GAP"]);
    expect(excludedCodes(r, "Ben")).toEqual(["UNTRAINED"]);
  });

  it("puts the crew member with fewer recent pickups first (fairness)", () => {
    const r = rankCandidates(input({ pickups30d: { Ben: 2 } }));
    expect(order(r).slice(0, 2)).toEqual(["Noah", "Ben"]);
    expect(r.candidates[1].reasons).toContain("2 pickups in the last 30 days");
  });

  it("breaks ties on seniority, then name", () => {
    const twins = [
      person("Ann", { hireDate: "2024-01-01" }),
      person("Bea", { hireDate: "2020-01-01" }),
      person("Cy", { hireDate: "2020-01-01" }),
    ];
    const r = rankCandidates(input({ crew: twins, shifts: [] }));
    expect(order(r)).toEqual(["Bea", "Cy", "Ann"]);
  });

  it("treats a shift starting when the gap ends as an extension", () => {
    const pat = person("Pat", {});
    const r = rankCandidates(
      input({ crew: [pat], shifts: [shift("Pat", MON, "14:00", "18:00")] }),
    );
    expect(r.candidates[0]).toMatchObject({ crewId: "Pat", kind: "EXTEND" });
  });

  it("lets 14-year-old Maya cover Beverage on a Sunday, with a youth note", () => {
    const r = rankCandidates(
      input({
        crew: [CREW[6]],
        shifts: [],
        window: localWindow(SUN, "10:00", "14:00", TZ),
      }),
    );
    expect(order(r)).toEqual(["Maya"]);
    expect(r.candidates[0].reasons.at(-1)).toBe("Age 14: youth limits checked");
  });

  it("lets a trainee join at rush only where certified crew are still on the station", () => {
    const rush = localWindow(MON, "05:30", "10:00", TZ);
    const hannah = CREW[9];
    const alone = rankCandidates(
      input({ crew: [hannah], shifts: [], window: rush }),
    );
    expect(excludedCodes(alone, "Hannah")).toEqual([
      "TRAINEE_AT_RUSH",
      "UNAVAILABLE",
    ]);

    const sixAm = localWindow(MON, "06:00", "10:00", TZ);
    const withZoe = rankCandidates(
      input({
        crew: [hannah, CREW[4]],
        shifts: [],
        window: sixAm,
        assignments: [
          { id: "a", shiftId: "z", crewId: "Zoe", stationId: "bev", ...sixAm },
        ],
      }),
    );
    expect(order(withZoe)).toContain("Hannah");
  });

  it("throws for an unknown station", () => {
    expect(() => rankCandidates(input({ stationId: "nope" }))).toThrow(
      "Unknown station nope",
    );
  });
});
