// Task 1.4: the standalone Maple & Mug store (Calgary, Alberta), its rule settings,
// 9 stations, the daypart coverage template and the school-day calendar.
// "Maple & Mug Coffee Co." is a fictional brand; the address and phone numbers are fake
// (555-01xx numbers are reserved for fiction).

import type {
  Daypart,
  PrismaClient,
} from "../../server/generated/prisma/client";
import { addDays, date, time, todayIn, weekday } from "./time";

export const TIMEZONE = "America/Edmonton";

/** Station short codes, used by later seed steps to look stations up. */
export type StationCode =
  | "DT-OT"
  | "DT-WIN"
  | "BEV"
  | "CTR"
  | "SAND"
  | "OVEN"
  | "SUPV"
  | "BAKER"
  | "LOBBY";

// Priority: lower = more critical. The rebalance solver pulls donors from the highest
// number first (Lobby). Supervisors are protected by the supervisor-on-floor rule rather
// than by priority; the overnight baker only works overnight.
const STATIONS = [
  {
    shortCode: "DT-OT",
    name: "Drive-Thru Order Taker",
    color: "#DC2626",
    priority: 1,
    minLevelDuringRush: "CERTIFIED",
  },
  {
    shortCode: "DT-WIN",
    name: "Drive-Thru Window/Cash",
    color: "#EA580C",
    priority: 2,
    minLevelDuringRush: "CERTIFIED",
  },
  {
    shortCode: "BEV",
    name: "Beverage/Barista",
    color: "#92400E",
    priority: 3,
    minLevelDuringRush: "CERTIFIED",
  },
  {
    shortCode: "CTR",
    name: "Front Counter/Till",
    color: "#CA8A04",
    priority: 4,
  },
  {
    shortCode: "SAND",
    name: "Sandwich & Breakfast Line",
    color: "#16A34A",
    priority: 5,
    requiredCert: "FOOD_HANDLER",
  },
  {
    shortCode: "OVEN",
    name: "Oven & Baked Goods",
    color: "#0891B2",
    priority: 6,
    requiredCert: "FOOD_HANDLER",
    youthRestricted: true,
  },
  {
    shortCode: "SUPV",
    name: "Shift Supervisor",
    color: "#7C3AED",
    priority: 7,
    requiredCert: "SUPERVISOR",
    isSupervisor: true,
  },
  {
    shortCode: "BAKER",
    name: "Overnight Baker",
    color: "#DB2777",
    priority: 8,
    requiredCert: "BAKER",
    minLevelDuringRush: "CERTIFIED",
    youthRestricted: true,
  },
  {
    shortCode: "LOBBY",
    name: "Lobby/Dishes/Restock",
    color: "#64748B",
    priority: 9,
  },
] as const satisfies ReadonlyArray<{
  shortCode: StationCode;
  name: string;
  color: string;
  priority: number;
  requiredCert?: "FOOD_HANDLER" | "BAKER" | "SUPERVISOR" | "FIRST_AID";
  minLevelDuringRush?: "TRAINEE" | "CERTIFIED" | "TRAINER";
  youthRestricted?: boolean;
  isSupervisor?: boolean;
}>;

// Daypart bounds in local store time. Overnight crosses midnight (end < start).
export const DAYPARTS: Record<Daypart, { start: string; end: string }> = {
  OVERNIGHT: { start: "23:00", end: "05:00" },
  MORNING_RUSH: { start: "05:30", end: "10:00" },
  MIDDAY: { start: "10:00", end: "14:00" },
  AFTERNOON: { start: "14:00", end: "18:00" },
  EVENING_CLOSE: { start: "18:00", end: "23:00" },
};

// Minimum headcount per station per daypart, every day of the week (weekday = null).
// Stations missing from a daypart need nobody then.
const COVERAGE: Record<Daypart, Partial<Record<StationCode, number>>> = {
  OVERNIGHT: { BAKER: 1 },
  MORNING_RUSH: {
    "DT-OT": 2,
    "DT-WIN": 1,
    BEV: 2,
    CTR: 1,
    SAND: 1,
    OVEN: 1,
    SUPV: 1,
    LOBBY: 1,
  },
  MIDDAY: {
    "DT-OT": 1,
    "DT-WIN": 1,
    BEV: 1,
    CTR: 1,
    SAND: 1,
    OVEN: 1,
    SUPV: 1,
    LOBBY: 1,
  },
  AFTERNOON: { "DT-OT": 1, "DT-WIN": 1, BEV: 1, CTR: 1, SUPV: 1, LOBBY: 1 },
  EVENING_CLOSE: { "DT-OT": 1, "DT-WIN": 1, BEV: 1, SUPV: 1, LOBBY: 1 },
};

// Weekdays with no school (simplified Calgary calendar): Thanksgiving, Remembrance Day,
// winter break.
const NO_SCHOOL = new Set(["2026-10-12", "2026-11-11"]);
const WINTER_BREAK = { from: "2026-12-19", to: "2027-01-04" };

export async function seedStore(db: PrismaClient) {
  const store = await db.store.create({
    data: {
      name: "Maple & Mug Coffee Co.",
      address: "100 Maplewood Dr NW, Calgary, AB",
      phone: "+14035550100",
      timezone: TIMEZONE,
      jurisdiction: "ALBERTA",
      openTime: time("05:00"),
      closeTime: time("23:00"),
      managerName: "Jordan Reyes",
      managerPhone: "+14035550101",
      // Alberta preset (simplified, not legal advice): OT after 8h/day or 44h/week,
      // 8h rest between shifts, under-15s at most 2h on school days and not past 9pm.
      ruleConfig: {
        create: {
          weeklyOtHours: 44,
          dailyOtHours: 8,
          minRestHours: 8,
          maxConsecutiveDays: 6,
          youthUnderAge: 15,
          youthMaxSchoolDayHours: 2,
          youthMaxSchoolWeekHours: null,
          youthLatestEnd: time("21:00"),
          offerTimeoutSec: 600,
          demoMode: false,
          smsProvider: "SIM",
        },
      },
    },
  });

  const stations = {} as Record<StationCode, string>;
  for (const s of STATIONS) {
    const row = await db.station.create({ data: { storeId: store.id, ...s } });
    stations[s.shortCode] = row.id;
  }

  const coverageRows = Object.entries(COVERAGE).flatMap(([daypart, counts]) =>
    Object.entries(counts).map(([code, minCount]) => ({
      storeId: store.id,
      stationId: stations[code as StationCode],
      weekday: null,
      daypart: daypart as Daypart,
      startTime: time(DAYPARTS[daypart as Daypart].start),
      endTime: time(DAYPARTS[daypart as Daypart].end),
      minCount,
    })),
  );
  await db.coverageRule.createMany({ data: coverageRows });

  // School days: Mon-Fri from 4 weeks before to 8 weeks after today (store time),
  // so the youth rules have a calendar whenever the seed runs.
  const today = todayIn(TIMEZONE);
  const schoolDays: string[] = [];
  for (let i = -28; i <= 56; i++) {
    const d = addDays(today, i);
    const wd = weekday(d);
    const inBreak = d >= WINTER_BREAK.from && d <= WINTER_BREAK.to;
    if (wd >= 1 && wd <= 5 && !NO_SCHOOL.has(d) && !inBreak) schoolDays.push(d);
  }
  await db.schoolDay.createMany({
    data: schoolDays.map((d) => ({ storeId: store.id, date: date(d) })),
  });

  return {
    store,
    stations,
    counts: {
      stations: STATIONS.length,
      coverageRules: coverageRows.length,
      schoolDays: schoolDays.length,
    },
  };
}
