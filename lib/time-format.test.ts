import { describe, expect, it } from "vitest";

import { humanizeTimes, timeRange, to12h } from "./time-format";

describe("to12h", () => {
  it.each([
    ["00:00", "12am"],
    ["05:30", "5:30am"],
    ["11:45", "11:45am"],
    ["12:00", "12pm"],
    ["14:00", "2pm"],
    ["23:30", "11:30pm"],
  ])("%s -> %s", (t, out) => expect(to12h(t)).toBe(out));
});

describe("timeRange / humanizeTimes", () => {
  it("formats ranges with an en dash", () => {
    expect(timeRange("05:30", "14:00")).toBe("5:30am–2pm");
  });

  it("rewrites times inside rule messages, including overnight ranges", () => {
    expect(humanizeTimes("Zoe isn't available Mon 04:30-13:00.")).toBe(
      "Zoe isn't available Mon 4:30am–1pm.",
    );
    expect(
      humanizeTimes(
        "Only 6.5h between Noah's shift Sun 14:00-23:00 and this one",
      ),
    ).toBe("Only 6.5h between Noah's shift Sun 2pm–11pm and this one");
    expect(humanizeTimes("Sun 22:30-Mon 06:30")).toBe("Sun 10:30pm-Mon 6:30am");
    expect(humanizeTimes("can only work 06:00-21:00")).toBe(
      "can only work 6am–9pm",
    );
  });

  it("leaves dates and other numbers alone", () => {
    expect(humanizeTimes("expired on 2026-10-31; 8h rest; 44h")).toBe(
      "expired on 2026-10-31; 8h rest; 44h",
    );
  });
});
