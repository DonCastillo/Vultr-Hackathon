import { describe, expect, it } from "vitest";

import { checkDayparts, type CoverageTemplate } from "./coverage-template";

const seeded: CoverageTemplate["dayparts"] = {
  OVERNIGHT: { start: "23:00", end: "05:00" },
  MORNING_RUSH: { start: "05:30", end: "10:00" },
  MIDDAY: { start: "10:00", end: "14:00" },
  AFTERNOON: { start: "14:00", end: "18:00" },
  EVENING_CLOSE: { start: "18:00", end: "23:00" },
};

describe("checkDayparts", () => {
  it("accepts the seeded dayparts, including overnight crossing midnight", () => {
    expect(checkDayparts(seeded)).toBeNull();
  });

  it("accepts a moved rush that still doesn't overlap", () => {
    expect(
      checkDayparts({
        ...seeded,
        MORNING_RUSH: { start: "06:00", end: "10:00" },
      }),
    ).toBeNull();
  });

  it("rejects overlapping dayparts", () => {
    expect(
      checkDayparts({
        ...seeded,
        MORNING_RUSH: { start: "05:30", end: "11:00" },
      }),
    ).toBe("Morning rush and Midday overlap.");
  });

  it("rejects an overnight that runs into the morning rush", () => {
    expect(
      checkDayparts({ ...seeded, OVERNIGHT: { start: "23:00", end: "06:00" } }),
    ).toBe("Morning rush and Overnight overlap.");
  });

  it("rejects a daypart with no length", () => {
    expect(
      checkDayparts({ ...seeded, MIDDAY: { start: "10:00", end: "10:00" } }),
    ).toBe("Midday needs different start and end times.");
  });
});
