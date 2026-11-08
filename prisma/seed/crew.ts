// Task 1.5: ~20 crew with station training, certs, weekly availability and time off.
// All names and phone numbers are fictional (555-01xx numbers are reserved for fiction).
//
// The roster is built around the demo morning (shifts come in task 1.6):
// - Kayla Nguyen is the 5:30am Drive-Thru headset person who texts in sick.
// - Aisha Khan works Lobby but is certified on headset: the Plan A rebalance move.
// - Tomas Ortega, the overnight baker, can extend onto Oven.
// - Ben Carter is the top Plan B pick for Beverage (certified, available, no OT).
// - Other Beverage-trained crew get filtered or ranked down for a visible reason:
//   Sofia (near 44h -> OT), Noah (closed last night -> rest gap), Maya and Liam
//   (under 15 -> school-day youth limits), Wei (weekly hours cap), Hannah (trainee
//   at rush), Chloe (student, not available mornings on school days).
// - Olivia's food-handler cert is expired (no Sandwich/Oven), Ryan opted out of SMS,
//   and Diego has approved time off.

import type {
  CertType,
  PrismaClient,
  TrainingLevel,
} from "../../server/generated/prisma/client";
import type { StationCode } from "./store";
import { addDays, date, time, todayIn, zoned } from "./time";

const ALL = [0, 1, 2, 3, 4, 5, 6];
const WEEKDAYS = [1, 2, 3, 4, 5];
const WEEKEND = [0, 6];

type Window = { days: number[]; start: string; end: string };

type CrewSeed = {
  firstName: string;
  lastName: string;
  phone: string;
  birthdate: string;
  isStudent?: boolean;
  hourlyWage: number;
  hireDate: string;
  reliability: number;
  maxWeeklyHours?: number;
  smsOptIn?: boolean;
  stations: Partial<Record<StationCode, TrainingLevel>>;
  /** Cert type -> [issuedAt, expiresAt | null]. */
  certs?: Partial<Record<CertType, [string, string | null]>>;
  /** Weekly windows in local store time; end < start means it runs past midnight. */
  availability: Window[];
};

const T = "TRAINEE" as const;
const C = "CERTIFIED" as const;
const TR = "TRAINER" as const;

export const CREW: CrewSeed[] = [
  // --- Supervisors -------------------------------------------------------------
  {
    firstName: "Dana",
    lastName: "Whitfield",
    phone: "+14035550110",
    birthdate: "1988-03-14",
    hourlyWage: 21.5,
    hireDate: "2019-04-01",
    reliability: 0.95,
    stations: { SUPV: TR, "DT-OT": C, "DT-WIN": C, BEV: C, CTR: C },
    certs: {
      SUPERVISOR: ["2020-01-15", null],
      FOOD_HANDLER: ["2023-02-10", "2028-02-10"],
      FIRST_AID: ["2024-05-20", "2027-05-20"],
    },
    availability: [{ days: WEEKDAYS, start: "04:30", end: "14:00" }],
  },
  {
    firstName: "Marcus",
    lastName: "Lee",
    phone: "+14035550111",
    birthdate: "1993-11-02",
    hourlyWage: 20,
    hireDate: "2021-06-14",
    reliability: 0.9,
    stations: { SUPV: C, "DT-WIN": C, BEV: C, CTR: C, LOBBY: C },
    certs: {
      SUPERVISOR: ["2022-03-01", null],
      FOOD_HANDLER: ["2022-03-01", "2027-03-01"],
      FIRST_AID: ["2025-01-12", "2028-01-12"],
    },
    availability: [{ days: ALL, start: "13:00", end: "23:30" }],
  },
  {
    firstName: "Elena",
    lastName: "Petrova",
    phone: "+14035550112",
    birthdate: "1990-07-22",
    hourlyWage: 19.5,
    hireDate: "2022-02-07",
    reliability: 0.88,
    stations: { SUPV: C, SAND: TR, OVEN: C, CTR: C },
    certs: {
      SUPERVISOR: ["2023-04-10", null],
      FOOD_HANDLER: ["2022-02-01", "2027-02-01"],
    },
    availability: [
      { days: [5, 6, 0], start: "05:00", end: "17:00" },
      { days: [3], start: "10:00", end: "18:00" },
    ],
  },

  // --- Overnight bakers ----------------------------------------------------------
  {
    firstName: "Tomas",
    lastName: "Ortega",
    phone: "+14035550113",
    birthdate: "1985-01-30",
    hourlyWage: 20.5,
    hireDate: "2018-09-10",
    reliability: 0.97,
    stations: { BAKER: TR, OVEN: TR },
    certs: {
      BAKER: ["2019-03-01", null],
      FOOD_HANDLER: ["2024-08-15", "2029-08-15"],
    },
    // Sun-Thu nights, can stay into the morning (the Plan B "extend" option).
    availability: [{ days: [0, 1, 2, 3, 4], start: "22:00", end: "09:00" }],
  },
  {
    firstName: "Grace",
    lastName: "Okafor",
    phone: "+14035550114",
    birthdate: "1996-05-18",
    hourlyWage: 18.75,
    hireDate: "2023-03-20",
    reliability: 0.85,
    stations: { BAKER: C, OVEN: C, SAND: C },
    certs: {
      BAKER: ["2023-06-01", null],
      FOOD_HANDLER: ["2023-03-15", "2028-03-15"],
    },
    availability: [
      { days: [4, 5, 6], start: "22:00", end: "09:00" },
      { days: [1], start: "06:00", end: "14:00" },
    ],
  },

  // --- Day crew ------------------------------------------------------------------
  {
    firstName: "Kayla",
    lastName: "Nguyen",
    phone: "+14035550115",
    birthdate: "1999-09-09",
    hourlyWage: 17.5,
    hireDate: "2020-05-04",
    reliability: 0.9,
    stations: { "DT-OT": TR, "DT-WIN": C, CTR: C },
    availability: [{ days: ALL, start: "05:00", end: "13:30" }],
  },
  {
    firstName: "Aisha",
    lastName: "Khan",
    phone: "+14035550116",
    birthdate: "2001-12-03",
    hourlyWage: 16.25,
    hireDate: "2022-08-22",
    reliability: 0.86,
    stations: { LOBBY: C, "DT-OT": C, CTR: C, "DT-WIN": T },
    availability: [{ days: WEEKDAYS, start: "05:00", end: "13:00" }],
  },
  {
    firstName: "Ben",
    lastName: "Carter",
    phone: "+14035550117",
    birthdate: "1998-04-27",
    hourlyWage: 17,
    hireDate: "2021-01-11",
    reliability: 0.92,
    stations: { BEV: C, CTR: C, "DT-WIN": C },
    availability: [{ days: ALL, start: "05:00", end: "15:00" }],
  },
  {
    firstName: "Sofia",
    lastName: "Martins",
    phone: "+14035550118",
    birthdate: "1995-02-16",
    hourlyWage: 18,
    hireDate: "2019-10-07",
    reliability: 0.9,
    stations: { BEV: TR, "DT-OT": C },
    availability: [{ days: ALL, start: "05:00", end: "21:00" }],
  },
  {
    firstName: "Noah",
    lastName: "Fischer",
    phone: "+14035550119",
    birthdate: "2000-08-05",
    hourlyWage: 16,
    hireDate: "2023-05-15",
    reliability: 0.8,
    stations: { BEV: C, "DT-WIN": C, LOBBY: C },
    availability: [{ days: ALL, start: "05:00", end: "23:30" }],
  },
  {
    firstName: "Olivia",
    lastName: "Brooks",
    phone: "+14035550120",
    birthdate: "1997-06-30",
    hourlyWage: 16.5,
    hireDate: "2022-04-04",
    reliability: 0.83,
    stations: { SAND: C, OVEN: C, CTR: C },
    // Expired: not eligible for Sandwich or Oven until renewed.
    certs: { FOOD_HANDLER: ["2021-10-31", "2026-10-31"] },
    availability: [{ days: [1, 2, 3, 4, 5, 6], start: "06:00", end: "14:00" }],
  },
  {
    firstName: "Jamal",
    lastName: "Wright",
    phone: "+14035550121",
    birthdate: "1994-10-12",
    hourlyWage: 17.75,
    hireDate: "2020-02-17",
    reliability: 0.91,
    stations: { SAND: TR, OVEN: C, LOBBY: C },
    certs: { FOOD_HANDLER: ["2022-11-20", "2027-11-20"] },
    availability: [{ days: WEEKDAYS, start: "05:00", end: "13:30" }],
  },
  {
    firstName: "Hannah",
    lastName: "Kim",
    phone: "+14035550122",
    birthdate: "2003-01-25",
    hourlyWage: 15.5,
    hireDate: "2025-09-02",
    reliability: 0.78,
    stations: { "DT-WIN": C, CTR: C, BEV: T },
    availability: [{ days: ALL, start: "06:00", end: "14:00" }],
  },
  {
    firstName: "Diego",
    lastName: "Alvarez",
    phone: "+14035550123",
    birthdate: "2002-03-08",
    hourlyWage: 15.75,
    hireDate: "2024-01-08",
    reliability: 0.82,
    stations: { "DT-OT": C, "DT-WIN": C, LOBBY: C },
    availability: [{ days: ALL, start: "10:00", end: "23:00" }],
  },
  {
    firstName: "Wei",
    lastName: "Zhang",
    phone: "+14035550124",
    birthdate: "1992-12-19",
    hourlyWage: 16.75,
    hireDate: "2023-07-24",
    reliability: 0.88,
    maxWeeklyHours: 20,
    stations: { "DT-OT": C, BEV: C, CTR: C },
    availability: [{ days: [2, 4, 6], start: "05:00", end: "14:00" }],
  },
  {
    firstName: "Fatima",
    lastName: "Haddad",
    phone: "+14035550125",
    birthdate: "1991-04-03",
    hourlyWage: 15.75,
    hireDate: "2024-03-11",
    reliability: 0.86,
    maxWeeklyHours: 24,
    stations: { LOBBY: C, SAND: C, CTR: C },
    certs: { FOOD_HANDLER: ["2024-03-01", "2029-03-01"] },
    availability: [{ days: ALL, start: "07:00", end: "15:00" }],
  },

  // --- Students 16-17 (not "youth" under Alberta's under-15 rules) -------------------
  {
    firstName: "Ethan",
    lastName: "Murphy",
    phone: "+14035550126",
    birthdate: "2009-04-12",
    isStudent: true,
    hourlyWage: 15,
    hireDate: "2024-06-24",
    reliability: 0.8,
    stations: { "DT-WIN": C, CTR: C, LOBBY: C },
    availability: [
      { days: WEEKDAYS, start: "15:30", end: "22:00" },
      { days: WEEKEND, start: "07:00", end: "22:00" },
    ],
  },
  {
    firstName: "Chloe",
    lastName: "Tremblay",
    phone: "+14035550127",
    birthdate: "2010-07-03",
    isStudent: true,
    hourlyWage: 15,
    hireDate: "2025-05-26",
    reliability: 0.84,
    stations: { CTR: C, BEV: C, LOBBY: C },
    availability: [
      { days: WEEKDAYS, start: "16:00", end: "21:30" },
      { days: WEEKEND, start: "06:00", end: "18:00" },
    ],
  },
  {
    firstName: "Ryan",
    lastName: "Patel",
    phone: "+14035550128",
    birthdate: "2009-09-30",
    isStudent: true,
    hourlyWage: 15,
    hireDate: "2024-07-08",
    reliability: 0.75,
    smsOptIn: false,
    stations: { SAND: C, LOBBY: C, CTR: C },
    certs: { FOOD_HANDLER: ["2024-07-01", "2029-07-01"] },
    availability: [
      { days: WEEKDAYS, start: "16:00", end: "22:00" },
      { days: WEEKEND, start: "08:00", end: "20:00" },
    ],
  },

  // --- Youth under 15 (Alberta: max 2h on school days, 8h otherwise, not past 9pm) ----
  {
    firstName: "Maya",
    lastName: "Singh",
    phone: "+14035550129",
    birthdate: "2012-02-11",
    isStudent: true,
    hourlyWage: 15,
    hireDate: "2025-07-02",
    reliability: 0.9,
    stations: { CTR: C, LOBBY: C, BEV: C },
    availability: [
      { days: WEEKDAYS, start: "16:00", end: "20:00" },
      { days: WEEKEND, start: "07:00", end: "17:00" },
    ],
  },
  {
    firstName: "Liam",
    lastName: "O'Connor",
    phone: "+14035550130",
    birthdate: "2012-05-20",
    isStudent: true,
    hourlyWage: 15,
    hireDate: "2026-06-29",
    reliability: 0.8,
    stations: { LOBBY: C, CTR: T, BEV: T },
    availability: [
      { days: WEEKDAYS, start: "16:00", end: "20:00" },
      { days: WEEKEND, start: "08:00", end: "16:00" },
    ],
  },
];

export async function seedCrew(
  db: PrismaClient,
  storeId: string,
  timezone: string,
  stations: Record<StationCode, string>,
) {
  const crewIds: Record<string, string> = {};
  let crewStations = 0;
  let certs = 0;
  let windows = 0;

  for (const c of CREW) {
    const row = await db.crew.create({
      data: {
        storeId,
        firstName: c.firstName,
        lastName: c.lastName,
        phone: c.phone,
        birthdate: date(c.birthdate),
        isStudent: c.isStudent ?? false,
        hourlyWage: c.hourlyWage,
        hireDate: date(c.hireDate),
        reliability: c.reliability,
        maxWeeklyHours: c.maxWeeklyHours ?? null,
        smsOptIn: c.smsOptIn ?? true,
        stations: {
          create: Object.entries(c.stations).map(([code, level]) => ({
            stationId: stations[code as StationCode],
            level,
          })),
        },
        certs: {
          create: Object.entries(c.certs ?? {}).map(
            ([type, [issued, expires]]) => ({
              type: type as CertType,
              issuedAt: date(issued),
              expiresAt: expires ? date(expires) : null,
            }),
          ),
        },
        availability: {
          create: c.availability.flatMap((w) =>
            w.days.map((weekday) => ({
              weekday,
              startTime: time(w.start),
              endTime: time(w.end),
            })),
          ),
        },
      },
    });
    crewIds[c.firstName] = row.id;
    crewStations += Object.keys(c.stations).length;
    certs += Object.keys(c.certs ?? {}).length;
    windows += c.availability.reduce((n, w) => n + w.days.length, 0);
  }

  // Time off, relative to today (store time) so it overlaps the seeded week.
  const today = todayIn(timezone);
  const timeOff = [
    {
      // Approved: Diego is off for the next three days and must never be offered a shift.
      crewId: crewIds.Diego,
      start: zoned(today, "00:00", timezone),
      end: zoned(addDays(today, 3), "00:00", timezone),
      reason: "Family trip",
      status: "APPROVED" as const,
    },
    {
      // Only requested: does not block scheduling.
      crewId: crewIds.Hannah,
      start: zoned(addDays(today, 5), "00:00", timezone),
      end: zoned(addDays(today, 6), "00:00", timezone),
      reason: "Exam",
      status: "REQUESTED" as const,
    },
  ];
  await db.timeOff.createMany({ data: timeOff });

  return {
    crewIds,
    counts: {
      crew: CREW.length,
      crewStations,
      certs,
      availability: windows,
      timeOff: timeOff.length,
    },
  };
}
