import { describe, expect, it } from "vitest";

import {
  coveredBy,
  formatRange,
  localDate,
  localMinutes,
  localWindow,
  weekdayOf,
  zoned,
} from "./time";

const TZ = "America/Edmonton";

describe("time helpers", () => {
  it("knows Alberta is on permanent UTC-6 from 2026-11-01 (needs Node 24.22+)", () => {
    expect(zoned("2026-11-09", "05:30", TZ).toISOString()).toBe(
      "2026-11-09T11:30:00.000Z",
    );
    expect(zoned("2027-01-15", "12:00", TZ).toISOString()).toBe(
      "2027-01-15T18:00:00.000Z",
    );
  });

  it("round-trips local date and minutes", () => {
    const at = zoned("2026-11-09", "23:45", TZ);
    expect(localDate(at, TZ)).toBe("2026-11-09");
    expect(localMinutes(at, TZ)).toBe(23 * 60 + 45);
  });

  it("builds windows that run past midnight", () => {
    const w = localWindow("2026-11-08", "22:30", "06:30", TZ);
    expect(localDate(w.end, TZ)).toBe("2026-11-09");
    expect((w.end.getTime() - w.start.getTime()) / 3_600_000).toBe(8);
  });

  it("gets weekdays right", () => {
    expect(weekdayOf("2026-11-08")).toBe(0); // Sunday
    expect(weekdayOf("2026-11-09")).toBe(1); // Monday
  });

  it("checks coverage by a union of intervals", () => {
    const w = localWindow("2026-11-09", "06:00", "10:00", TZ);
    const a = localWindow("2026-11-09", "05:00", "08:00", TZ);
    const b = localWindow("2026-11-09", "08:00", "11:00", TZ);
    const gap = localWindow("2026-11-09", "08:15", "11:00", TZ);
    expect(coveredBy(w, [b, a])).toBe(true);
    expect(coveredBy(w, [a, gap])).toBe(false);
    expect(coveredBy(w, [])).toBe(false);
  });

  it("formats ranges for messages", () => {
    expect(
      formatRange(localWindow("2026-11-09", "05:30", "10:00", TZ), TZ),
    ).toBe("Mon 05:30-10:00");
    expect(
      formatRange(localWindow("2026-11-08", "22:30", "06:30", TZ), TZ),
    ).toBe("Sun 22:30-Mon 06:30");
  });
});
