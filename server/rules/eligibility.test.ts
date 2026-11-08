import { describe, expect, it } from "vitest";

import { checkEligibility, type EligibilityInput } from "./eligibility";
import { localWindow } from "./time";
import type { CrewInfo, ShiftInfo, StationInfo } from "./types";

const TZ = "America/Edmonton";
const SUN = "2026-11-08";
const MON = "2026-11-09"; // the demo day

const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];

const station = (over: Partial<StationInfo> = {}): StationInfo => ({
  id: "st-bev",
  shortCode: "BEV",
  name: "Beverage/Barista",
  priority: 3,
  requiredCert: null,
  minLevelDuringRush: "CERTIFIED",
  youthRestricted: false,
  isSupervisor: false,
  ...over,
});

const crew = (over: Partial<CrewInfo> = {}): CrewInfo => ({
  id: "ben",
  firstName: "Ben",
  lastName: "Carter",
  birthdate: "1998-04-27",
  isStudent: false,
  hireDate: "2021-01-11",
  reliability: 0.92,
  maxWeeklyHours: null,
  smsOptIn: true,
  active: true,
  stations: { "st-bev": "CERTIFIED" },
  certs: [],
  availability: ALL_DAYS.map((weekday) => ({
    weekday,
    start: "05:00",
    end: "15:00",
  })),
  timeOff: [],
  ...over,
});

const shift = (
  id: string,
  date: string,
  start: string,
  end: string,
  over: Partial<ShiftInfo> = {},
): ShiftInfo => ({
  id,
  crewId: "ben",
  ...localWindow(date, start, end, TZ),
  breakMinutes: 0,
  status: "SCHEDULED",
  ...over,
});

/** Ben, certified barista, asked to cover Beverage 10:00-14:00 on the demo day. */
const input = (over: Partial<EligibilityInput> = {}): EligibilityInput => ({
  crew: crew(),
  station: station(),
  window: localWindow(MON, "10:00", "14:00", TZ),
  shifts: [],
  timezone: TZ,
  minRestHours: 8,
  maxConsecutiveDays: 6,
  rushWindows: [{ start: "05:30", end: "10:00" }],
  ...over,
});

const check = (over: Partial<EligibilityInput> = {}) =>
  checkEligibility(input(over));
const codes = (over: Partial<EligibilityInput> = {}) =>
  check(over).issues.map((i) => i.code);

describe("checkEligibility", () => {
  it("passes a trained, available, rested crew member", () => {
    expect(check()).toEqual({ eligible: true, issues: [] });
  });

  it("blocks inactive crew", () => {
    expect(codes({ crew: crew({ active: false }) })).toEqual(["INACTIVE"]);
  });

  describe("training", () => {
    it("blocks a station the crew member isn't trained on", () => {
      const r = check({ crew: crew({ stations: {} }) });
      expect(r.eligible).toBe(false);
      expect(r.issues[0]).toMatchObject({
        code: "UNTRAINED",
        severity: "block",
      });
      expect(r.issues[0].message).toContain("Beverage/Barista");
    });

    it("blocks a trainee alone on a rush-critical station during rush", () => {
      const trainee = crew({ stations: { "st-bev": "TRAINEE" } });
      const rush = localWindow(MON, "05:30", "10:00", TZ);
      expect(codes({ crew: trainee, window: rush })).toEqual([
        "TRAINEE_AT_RUSH",
      ]);
    });

    it("blocks a trainee whose window only partly touches rush", () => {
      const trainee = crew({ stations: { "st-bev": "TRAINEE" } });
      const window = localWindow(MON, "09:00", "13:00", TZ);
      expect(codes({ crew: trainee, window })).toEqual(["TRAINEE_AT_RUSH"]);
    });

    it("allows a trainee outside rush", () => {
      const trainee = crew({ stations: { "st-bev": "TRAINEE" } });
      expect(check({ crew: trainee }).eligible).toBe(true);
    });

    it("allows a trainee during rush when a certified crew member covers the station", () => {
      const trainee = crew({ stations: { "st-bev": "TRAINEE" } });
      const rush = localWindow(MON, "05:30", "10:00", TZ);
      expect(
        check({ crew: trainee, window: rush, certifiedCoverage: [rush] })
          .eligible,
      ).toBe(true);
    });

    it("still blocks the trainee if the certified coverage has a hole", () => {
      const trainee = crew({ stations: { "st-bev": "TRAINEE" } });
      const rush = localWindow(MON, "05:30", "10:00", TZ);
      const partial = [localWindow(MON, "05:30", "08:00", TZ)];
      expect(
        codes({ crew: trainee, window: rush, certifiedCoverage: partial }),
      ).toEqual(["TRAINEE_AT_RUSH"]);
    });

    it("allows a trainee at rush on a station without a rush minimum", () => {
      const lobby = station({
        id: "st-lobby",
        name: "Lobby",
        minLevelDuringRush: "TRAINEE",
      });
      const trainee = crew({ stations: { "st-lobby": "TRAINEE" } });
      const rush = localWindow(MON, "05:30", "10:00", TZ);
      expect(
        check({ crew: trainee, station: lobby, window: rush }).eligible,
      ).toBe(true);
    });
  });

  describe("certs", () => {
    const oven = station({
      id: "st-oven",
      name: "Oven & Baked Goods",
      requiredCert: "FOOD_HANDLER",
    });
    const ovenCrew = (expiresAt: string | null) =>
      crew({
        stations: { "st-oven": "CERTIFIED" },
        certs: [{ type: "FOOD_HANDLER", expiresAt }],
      });

    it("blocks an expired food-handler cert (Olivia)", () => {
      const r = check({ station: oven, crew: ovenCrew("2026-10-31") });
      expect(r.issues.map((i) => i.code)).toEqual(["CERT_EXPIRED"]);
      expect(r.issues[0].message).toContain("2026-10-31");
    });

    it("allows a cert that expires on the shift date", () => {
      expect(check({ station: oven, crew: ovenCrew(MON) }).eligible).toBe(true);
    });

    it("allows a cert with no expiry", () => {
      expect(check({ station: oven, crew: ovenCrew(null) }).eligible).toBe(
        true,
      );
    });

    it("blocks a missing cert", () => {
      const noCert = crew({ stations: { "st-oven": "CERTIFIED" }, certs: [] });
      expect(codes({ station: oven, crew: noCert })).toEqual(["CERT_MISSING"]);
    });
  });

  describe("availability", () => {
    it("blocks a window outside availability", () => {
      const window = localWindow(MON, "14:00", "18:00", TZ);
      const r = check({ window });
      expect(r.issues.map((i) => i.code)).toEqual(["UNAVAILABLE"]);
      expect(r.issues[0].message).toContain("Mon 14:00-18:00");
    });

    it("allows a window exactly matching the availability bounds", () => {
      expect(
        check({ window: localWindow(MON, "05:00", "15:00", TZ) }).eligible,
      ).toBe(true);
    });

    it("uses the right weekday", () => {
      const weekdaysOnly = crew({
        availability: [1, 2, 3, 4, 5].map((weekday) => ({
          weekday,
          start: "05:00",
          end: "15:00",
        })),
      });
      expect(check({ crew: weekdaysOnly }).eligible).toBe(true); // Monday
      const sunday = localWindow(SUN, "10:00", "14:00", TZ);
      expect(codes({ crew: weekdaysOnly, window: sunday })).toEqual([
        "UNAVAILABLE",
      ]);
    });

    it("handles overnight windows that run past midnight (Tomas)", () => {
      const baker = crew({
        stations: { "st-bev": "CERTIFIED" },
        availability: [{ weekday: 0, start: "22:00", end: "09:00" }], // Sun night
      });
      expect(
        check({ crew: baker, window: localWindow(SUN, "22:30", "06:30", TZ) })
          .eligible,
      ).toBe(true);
      // Monday morning is still inside Sunday night's window.
      expect(
        check({ crew: baker, window: localWindow(MON, "06:30", "08:30", TZ) })
          .eligible,
      ).toBe(true);
      expect(
        codes({ crew: baker, window: localWindow(MON, "08:00", "10:00", TZ) }),
      ).toEqual(["UNAVAILABLE"]);
    });
  });

  describe("time off", () => {
    const off = (status: "APPROVED" | "REQUESTED" | "DENIED") =>
      crew({
        timeOff: [{ ...localWindow(MON, "00:00", "00:00", TZ), status }],
      });

    it("blocks approved time off (Diego)", () => {
      expect(codes({ crew: off("APPROVED") })).toEqual(["TIME_OFF"]);
    });

    it("only warns about requested time off", () => {
      const r = check({ crew: off("REQUESTED") });
      expect(r.eligible).toBe(true);
      expect(r.issues).toMatchObject([
        { code: "TIME_OFF_REQUESTED", severity: "warn" },
      ]);
    });

    it("ignores denied time off", () => {
      expect(check({ crew: off("DENIED") })).toEqual({
        eligible: true,
        issues: [],
      });
    });
  });

  describe("overlap and rest", () => {
    it("blocks an overlapping shift", () => {
      const shifts = [shift("s1", MON, "12:00", "16:00")];
      expect(codes({ shifts })).toEqual(["OVERLAP"]);
    });

    it("ignores cancelled and called-out shifts", () => {
      const shifts = [
        shift("s1", MON, "12:00", "16:00", { status: "CANCELLED" }),
        shift("s2", MON, "09:00", "11:00", { status: "CALLED_OUT" }),
      ];
      expect(check({ shifts }).eligible).toBe(true);
    });

    it("ignores the crew member's own shift when moving stations within it", () => {
      const shifts = [shift("own", MON, "05:30", "14:00")];
      expect(check({ shifts, ignoreShiftIds: ["own"] }).eligible).toBe(true);
    });

    it("ignores other crew members' shifts", () => {
      const shifts = [
        shift("s1", MON, "12:00", "16:00", { crewId: "someone-else" }),
      ];
      expect(check({ shifts }).eligible).toBe(true);
    });

    it("blocks a clopen: closed at 23:00, back at 05:30 (Noah)", () => {
      const shifts = [shift("close", SUN, "14:00", "23:00")];
      const r = check({
        shifts,
        window: localWindow(MON, "05:30", "10:00", TZ),
      });
      expect(r.issues.map((i) => i.code)).toEqual(["REST_GAP"]);
      expect(r.issues[0].message).toContain("6.5h");
    });

    it("allows the same closer at 10:00 (11h later)", () => {
      const shifts = [shift("close", SUN, "14:00", "23:00")];
      expect(check({ shifts }).eligible).toBe(true);
    });

    it("allows exactly the minimum rest", () => {
      const shifts = [shift("close", SUN, "14:00", "23:00")];
      expect(
        check({ shifts, window: localWindow(MON, "07:00", "11:00", TZ) })
          .eligible,
      ).toBe(true);
    });

    it("checks rest before the next shift too", () => {
      const shifts = [shift("next", MON, "20:00", "23:00")];
      expect(codes({ shifts })).toEqual(["REST_GAP"]);
    });

    it("treats a contiguous window as an extension, not a second shift (Sofia)", () => {
      const shifts = [shift("rush", MON, "05:00", "10:00")];
      expect(check({ shifts }).eligible).toBe(true);
    });

    it("skips the rest check when the jurisdiction has none (US)", () => {
      const shifts = [shift("close", SUN, "14:00", "23:00")];
      const window = localWindow(MON, "05:30", "10:00", TZ);
      expect(check({ shifts, window, minRestHours: 0 }).eligible).toBe(true);
    });
  });

  describe("consecutive days", () => {
    const daysBefore = (n: number) =>
      Array.from({ length: n }, (_, i) => {
        const d = new Date(`${MON}T00:00:00Z`);
        d.setUTCDate(d.getUTCDate() - (i + 1));
        return shift(`d${i}`, d.toISOString().slice(0, 10), "06:00", "09:00");
      });

    it("allows the 6th day in a row with a limit of 6", () => {
      expect(check({ shifts: daysBefore(5) }).eligible).toBe(true);
    });

    it("blocks the 7th day in a row", () => {
      const r = check({ shifts: daysBefore(6) });
      expect(r.issues.map((i) => i.code)).toEqual(["CONSECUTIVE_DAYS"]);
      expect(r.issues[0].message).toContain("7th day");
    });

    it("counts days after the window too", () => {
      const after = [1, 2, 3].map((n) => {
        const d = new Date(`${MON}T00:00:00Z`);
        d.setUTCDate(d.getUTCDate() + n);
        return shift(`a${n}`, d.toISOString().slice(0, 10), "06:00", "09:00");
      });
      expect(codes({ shifts: [...daysBefore(3), ...after] })).toEqual([
        "CONSECUTIVE_DAYS",
      ]);
    });
  });

  it("reports every problem at once", () => {
    const r = check({
      crew: crew({ stations: {}, availability: [] }),
      shifts: [shift("s1", MON, "12:00", "16:00")],
    });
    expect(r.issues.map((i) => i.code)).toEqual([
      "UNTRAINED",
      "UNAVAILABLE",
      "OVERLAP",
    ]);
  });
});
