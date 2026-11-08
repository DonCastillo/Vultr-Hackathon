import { describe, expect, it } from "vitest";

import { localWindow } from "@/server/rules/time";
import type { AssignmentInfo, ShiftInfo } from "@/server/rules/types";
import { seedScenario } from "@/server/test/seed-scenario";

import { validateShifts, type ValidationInput } from "./validation";

const s = seedScenario();
const TZ = s.timezone;
const ctx: ValidationInput["ctx"] = {
  timezone: TZ,
  config: {
    ...s.config,
    offerTimeoutSec: 600,
    demoMode: false,
  } as ValidationInput["ctx"]["config"],
  preset: s.preset,
  rushWindows: s.rushWindows,
  stations: s.stations,
};

const run = (shifts: ShiftInfo[], assignments: AssignmentInfo[]) =>
  validateShifts({
    ctx,
    crew: s.crew,
    shifts,
    assignments,
    schoolDays: s.schoolDays,
  });

/** Adds one shift with one station block for `crewId`. */
function withShift(
  crewId: string,
  date: string,
  start: string,
  end: string,
  stationId: string,
) {
  const id = `extra-${crewId}-${date}-${start}`;
  const w = localWindow(date, start, end, TZ);
  return {
    shift: { id, crewId, ...w, breakMinutes: 0, status: "SCHEDULED" as const },
    block: { id: `${id}-a`, shiftId: id, crewId, stationId, ...w },
  };
}
const kinds = (badges: Map<string, { kind: string }[]>, id: string) =>
  (badges.get(id) ?? []).map((b) => b.kind);

describe("validateShifts", () => {
  it("finds nothing wrong with the seeded week", () => {
    expect([...run(s.shifts, s.assignments).entries()]).toEqual([]);
  });

  it("flags an untrained station", () => {
    // Ben isn't trained on Oven.
    const x = withShift("Ben", "2026-11-14", "15:00", "19:00", "OVEN");
    const b = run([...s.shifts, x.shift], [...s.assignments, x.block]);
    expect(kinds(b, x.shift.id)).toContain("UNTRAINED");
  });

  it("flags a clopen and overtime for a closer added to an opener's week", () => {
    // Sofia opens Mon-Sat (41.5h); closing Sunday-night-before isn't in her week, so close Tue night.
    const x = withShift("Sofia", "2026-11-10", "17:00", "21:00", "BEV");
    const b = run([...s.shifts, x.shift], [...s.assignments, x.block]);
    expect(kinds(b, x.shift.id)).toEqual(
      expect.arrayContaining(["CLOPEN", "OT"]),
    );
  });

  it("flags a 14-year-old on a school morning", () => {
    const x = withShift("Maya", "2026-11-10", "06:00", "10:00", "CTR");
    const b = run([...s.shifts, x.shift], [...s.assignments, x.block]);
    expect(kinds(b, x.shift.id)).toEqual(
      expect.arrayContaining(["YOUTH", "UNAVAILABLE"]),
    );
  });

  it("flags an expired food-handler cert", () => {
    const x = withShift("Olivia", "2026-11-15", "06:00", "10:00", "SAND");
    const b = run([...s.shifts, x.shift], [...s.assignments, x.block]);
    expect(kinds(b, x.shift.id)).toContain("CERT");
  });
});

describe("validateShifts: inactive crew", () => {
  it("flags every shift an inactive crew member still holds", () => {
    const crew = s.crew.map((c) =>
      c.id === "Dana" ? { ...c, active: false } : c,
    );
    const badges = validateShifts({
      ctx,
      crew,
      shifts: s.shifts,
      assignments: s.assignments,
      schoolDays: s.schoolDays,
    });
    const danas = s.shifts.filter((sh) => sh.crewId === "Dana");
    expect(danas.length).toBeGreaterThan(0);
    for (const sh of danas) {
      expect(badges.get(sh.id)).toEqual([
        expect.objectContaining({
          kind: "INACTIVE",
          label: "Inactive",
          severity: "block",
        }),
      ]);
    }
  });
});
