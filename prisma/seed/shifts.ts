// Task 1.6: a full week of shifts and station assignments, including the demo scenario.
//
// The seeded week is the Mon-Sun week containing the demo day (the next weekday after
// the seed runs, so the 5:30am call-out is always in the future), plus the day before
// it. The demo day and its eve are pinned by hand (DEMO_PINS); every other slot is
// filled greedily from the coverage template, respecting the same rules the engine
// will check: training (no trainees on rush-critical stations), certs, availability,
// approved time off, youth limits, 8h rest, one shift a day, <= 5 days in a row and
// <= 40h a week (or the crew's own cap). Slots nobody can fill are reported as gaps.
//
// Demo story (Kayla calls in sick at 4:40am):
// - Gaps: Drive-Thru Order Taker 5:30-10:00 (rush needs 2) and Beverage 10:00-14:00.
// - Plan A: move Aisha Lobby -> Drive-Thru (certified on headset). Lobby goes short.
// - Plan B for Beverage: Ben (off, rested, no OT), Noah (closed last night, rested by
//   10:00), Sofia (extend; pushes her past 44h this week -> OT).
// - Lobby 5:30-10:00 has no legal fill: Noah breaks the 8h rest rule, Diego is on
//   approved time off, students are in school, 14-year-olds can't start before 6am.

import type { PrismaClient } from "../../server/generated/prisma/client";
import { CREW } from "./crew";
import {
  COVERAGE,
  DAYPARTS,
  isSchoolDay,
  STATIONS,
  type StationCode,
} from "./store";
import { addDays, todayIn, weekday, zoned } from "./time";

const DAY = 24 * 60;
const MAX_WEEKLY_HOURS = 40; // stay under Alberta's 44h so the base week has no OT
const MAX_DAYS_IN_A_ROW = 5;
const MIN_REST_MIN = 8 * 60;

/** "05:30" -> 330 (minutes after local midnight). */
const min = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};
/** 330 -> "05:30" (wraps past midnight). */
const hhmm = (minutes: number) => {
  const x = ((minutes % DAY) + DAY) % DAY;
  return `${String(Math.floor(x / 60)).padStart(2, "0")}:${String(x % 60).padStart(2, "0")}`;
};

type Block = { code: StationCode; start: number; end: number };
type Planned = {
  crew: string; // first name
  dayIdx: number;
  start: number; // minutes after the shift day's local midnight; may exceed DAY
  end: number;
  breakMin: number;
  blocks: Block[];
};

/** Unpaid break: 30 min after 5h, 60 min after 8.5h (keeps paid time at <= 8h). */
const breakFor = (len: number) => (len > 8.5 * 60 ? 60 : len > 5 * 60 ? 30 : 0);
const paidHours = (s: Pick<Planned, "start" | "end" | "breakMin">) =>
  (s.end - s.start - s.breakMin) / 60;

// Candidate windows per day, most critical station first. `split` lets a slot be
// filled by two shorter shifts when nobody can work the whole window.
const SLOTS: {
  code: StationCode;
  start: string;
  end: string;
  split?: string;
}[] = [
  { code: "SUPV", start: "05:30", end: "14:00", split: "10:00" },
  { code: "SUPV", start: "14:00", end: "23:00", split: "18:30" },
  { code: "DT-OT", start: "05:30", end: "14:00", split: "10:00" },
  { code: "DT-OT", start: "05:30", end: "10:00" },
  { code: "DT-OT", start: "14:00", end: "23:00", split: "18:30" },
  { code: "DT-WIN", start: "05:30", end: "14:00", split: "10:00" },
  { code: "DT-WIN", start: "14:00", end: "23:00", split: "18:30" },
  { code: "BEV", start: "05:30", end: "14:00", split: "10:00" },
  { code: "BEV", start: "05:30", end: "10:00" },
  { code: "BEV", start: "14:00", end: "23:00", split: "18:30" },
  { code: "CTR", start: "05:30", end: "14:00", split: "10:00" },
  { code: "CTR", start: "14:00", end: "18:00" },
  { code: "SAND", start: "05:30", end: "14:00", split: "10:00" },
  { code: "OVEN", start: "05:30", end: "14:00", split: "10:00" },
  { code: "LOBBY", start: "05:30", end: "14:00", split: "10:00" },
  { code: "LOBBY", start: "14:00", end: "23:00", split: "18:30" },
];
const BAKER_SHIFT = { start: min("22:30"), end: min("06:30") + DAY };

type Pin = {
  crew: string;
  start: string;
  end: string;
  blocks: [StationCode, string, string][];
};

/** Hand-placed shifts. Keys: "eve" = the day before the demo day, "demo" = demo day. */
const DEMO_PINS: { eve: Pin[]; demo: Pin[]; demoOff: string[] } = {
  eve: [
    {
      crew: "Noah",
      start: "14:00",
      end: "23:00",
      blocks: [["DT-OT", "14:00", "23:00"]],
    },
    {
      crew: "Tomas",
      start: "22:30",
      end: "06:30",
      blocks: [["BAKER", "22:30", "06:30"]],
    },
  ],
  demo: [
    {
      crew: "Dana",
      start: "05:30",
      end: "14:00",
      blocks: [["SUPV", "05:30", "14:00"]],
    },
    {
      crew: "Omar",
      start: "05:30",
      end: "14:00",
      blocks: [["DT-OT", "05:30", "14:00"]],
    },
    {
      crew: "Kayla",
      start: "05:30",
      end: "14:00",
      blocks: [
        ["DT-OT", "05:30", "10:00"],
        ["BEV", "10:00", "14:00"],
      ],
    },
    {
      crew: "Zoe",
      start: "05:30",
      end: "14:00",
      blocks: [["DT-WIN", "05:30", "14:00"]],
    },
    {
      crew: "Isabel",
      start: "05:30",
      end: "10:00",
      blocks: [["BEV", "05:30", "10:00"]],
    },
    {
      crew: "Sofia",
      start: "05:00",
      end: "10:00",
      blocks: [["BEV", "05:00", "10:00"]],
    },
    {
      crew: "Olivia",
      start: "05:30",
      end: "14:00",
      blocks: [["CTR", "05:30", "14:00"]],
    },
    {
      crew: "Jamal",
      start: "05:30",
      end: "14:00",
      blocks: [["SAND", "05:30", "14:00"]],
    },
    {
      crew: "Lucas",
      start: "05:30",
      end: "14:00",
      blocks: [["OVEN", "05:30", "14:00"]],
    },
    {
      crew: "Aisha",
      start: "05:30",
      end: "14:00",
      blocks: [["LOBBY", "05:30", "14:00"]],
    },
  ],
  // Ben and Noah are off on the demo day so they are clean Plan B call-ins.
  demoOff: ["Ben", "Noah"],
};

const stationMeta = Object.fromEntries(
  STATIONS.map((s) => [s.shortCode, s]),
) as Record<StationCode, (typeof STATIONS)[number]>;
const crewMeta = Object.fromEntries(CREW.map((c) => [c.firstName, c]));

/** Required headcount for a station at a minute of the day (from the coverage template). */
function need(code: StationCode, minute: number): number {
  for (const [daypart, counts] of Object.entries(COVERAGE)) {
    const { start, end } = DAYPARTS[daypart as keyof typeof DAYPARTS];
    const s = min(start);
    const e = min(end);
    const inside =
      e > s ? minute >= s && minute < e : minute >= s || minute < e;
    if (inside) {
      const n = counts[code];
      if (n) return n;
    }
  }
  return 0;
}

const ageOn = (birthdate: string, ymd: string) => {
  const [by, bm, bd] = birthdate.split("-").map(Number);
  const [y, m, d] = ymd.split("-").map(Number);
  return y - by - (m < bm || (m === bm && d < bd) ? 1 : 0);
};

/** Monday of the week containing ymd. */
const weekStart = (ymd: string) => addDays(ymd, -((weekday(ymd) + 6) % 7));

export async function seedShifts(
  db: PrismaClient,
  storeId: string,
  timezone: string,
  stations: Record<StationCode, string>,
  crewIds: Record<string, string>,
  timeOff: { crewId: string; start: Date; end: Date; status: string }[],
) {
  // --- Which days ----------------------------------------------------------------
  const today = todayIn(timezone);
  let demoDay = addDays(today, 1);
  while (weekday(demoDay) === 0 || weekday(demoDay) === 6)
    demoDay = addDays(demoDay, 1);
  const monday = weekStart(demoDay);
  const firstDay =
    addDays(demoDay, -1) < monday ? addDays(demoDay, -1) : monday;
  const days: string[] = [];
  for (let d = firstDay; d <= addDays(monday, 6); d = addDays(d, 1))
    days.push(d);
  const demoIdx = days.indexOf(demoDay);

  const planned: Planned[] = [];
  const absStart = (s: Planned) => s.dayIdx * DAY + s.start;
  const absEnd = (s: Planned) => s.dayIdx * DAY + s.end;

  /** Local (day, minutes after midnight) -> UTC instant. */
  const toUtc = (dayIdx: number, minutes: number) =>
    zoned(
      addDays(days[dayIdx], Math.floor(minutes / DAY)),
      hhmm(minutes),
      timezone,
    );

  const approvedOff = timeOff.filter((t) => t.status === "APPROVED");
  const idToName = Object.fromEntries(
    Object.entries(crewIds).map(([n, id]) => [id, n]),
  );

  /** Why `name` can't work this shift, or null if they can. */
  function blocker(
    name: string,
    dayIdx: number,
    start: number,
    end: number,
    codes: StationCode[],
  ): string | null {
    const c = crewMeta[name];
    const day = days[dayIdx];
    const len = (end - start - breakFor(end - start)) / 60;

    for (const code of codes) {
      const st = stationMeta[code];
      const level = c.stations[code];
      if (!level) return `not trained on ${code}`;
      const touchesRush = start < min("10:00") && end > min("05:30");
      if (
        touchesRush &&
        "minLevelDuringRush" in st &&
        st.minLevelDuringRush === "CERTIFIED" &&
        level === "TRAINEE"
      )
        return `trainee on ${code} during rush`;
      if ("requiredCert" in st && st.requiredCert) {
        const cert = c.certs?.[st.requiredCert];
        if (!cert) return `no ${st.requiredCert} cert`;
        if (cert[1] && cert[1] < day) return `${st.requiredCert} cert expired`;
      }
      const youth = ageOn(c.birthdate, day) < 15;
      if (youth && "youthRestricted" in st && st.youthRestricted)
        return `youth on ${code}`;
    }

    // Youth (under 15, Alberta): 06:00-21:00, 2h on school days, 8h otherwise.
    const age = ageOn(c.birthdate, day);
    if (age < 15) {
      if (start < min("06:00") || end > min("21:00")) return "youth hours";
      if (len > (isSchoolDay(day) ? 2 : 8)) return "youth daily limit";
    } else if (age < 18 && (start < min("06:00") || end > DAY)) {
      return "under-18 hours";
    }

    // Availability (a window may start the previous evening and run past midnight).
    const wd = weekday(day);
    const available = c.availability.some((w) =>
      w.days.some((d) => {
        const s = min(w.start);
        const e = min(w.end) <= s ? min(w.end) + DAY : min(w.end);
        if (d === wd && start >= s && end <= e) return true;
        return (
          d === (wd + 6) % 7 && e > DAY && start + DAY >= s && end + DAY <= e
        );
      }),
    );
    if (!available) return "not available";

    const from = toUtc(dayIdx, start).getTime();
    const to = toUtc(dayIdx, end).getTime();
    if (
      approvedOff.some(
        (t) =>
          idToName[t.crewId] === name &&
          t.start.getTime() < to &&
          t.end.getTime() > from,
      )
    )
      return "approved time off";

    const mine = planned.filter((s) => s.crew === name);
    if (mine.some((s) => s.dayIdx === dayIdx))
      return "already working that day";
    const ns = dayIdx * DAY + start;
    const ne = dayIdx * DAY + end;
    for (const s of mine) {
      if (absEnd(s) <= ns && ns - absEnd(s) < MIN_REST_MIN) return "rest gap";
      if (absStart(s) >= ne && absStart(s) - ne < MIN_REST_MIN)
        return "rest gap";
      if (absStart(s) < ne && absEnd(s) > ns) return "overlap";
    }

    const wk = weekStart(day);
    const weekHours = mine
      .filter((s) => weekStart(days[s.dayIdx]) === wk)
      .reduce((h, s) => h + paidHours(s), 0);
    const cap = Math.min(
      MAX_WEEKLY_HOURS,
      c.maxWeeklyHours ?? MAX_WEEKLY_HOURS,
    );
    if (weekHours + len > cap) return "weekly hours";

    const worked = new Set(mine.map((s) => s.dayIdx));
    let run = 1;
    for (let i = dayIdx - 1; worked.has(i); i--) run++;
    for (let i = dayIdx + 1; worked.has(i); i++) run++;
    if (run > MAX_DAYS_IN_A_ROW) return "too many days in a row";

    return null;
  }

  function place(
    name: string,
    dayIdx: number,
    start: number,
    end: number,
    blocks: Block[],
  ) {
    planned.push({
      crew: name,
      dayIdx,
      start,
      end,
      breakMin: breakFor(end - start),
      blocks,
    });
  }

  // --- Pinned demo shifts --------------------------------------------------------
  const pinWarnings: string[] = [];
  const placePins = (pins: Pin[], dayIdx: number) => {
    for (const p of pins) {
      const start = min(p.start);
      const end = min(p.end) <= start ? min(p.end) + DAY : min(p.end);
      const blocks = p.blocks.map(([code, s, e]) => ({
        code,
        start: min(s),
        end: min(e) <= min(s) ? min(e) + DAY : min(e),
      }));
      const why = blocker(
        p.crew,
        dayIdx,
        start,
        end,
        blocks.map((b) => b.code),
      );
      if (why) pinWarnings.push(`${days[dayIdx]} ${p.crew}: ${why}`);
      place(p.crew, dayIdx, start, end, blocks);
    }
  };
  placePins(DEMO_PINS.eve, demoIdx - 1);
  placePins(DEMO_PINS.demo, demoIdx);

  // Sofia carries a heavy week (41.5h, under 44) so extending her on the demo day is OT:
  // Mon-Sat, demo day already pinned, one short day, the rest full mornings.
  let shortDayUsed = false;
  for (let i = 0; i < 6; i++) {
    const idx = days.indexOf(addDays(monday, i));
    if (idx === demoIdx) continue;
    const end = shortDayUsed ? min("14:00") : min("10:00");
    shortDayUsed = true;
    place("Sofia", idx, min("05:30"), end, [
      { code: "BEV", start: min("05:30"), end },
    ]);
  }

  // --- Greedy fill ---------------------------------------------------------------
  const gaps: string[] = [];
  const have = (code: StationCode, dayIdx: number, minute: number) =>
    planned.filter(
      (s) =>
        s.dayIdx === dayIdx &&
        s.blocks.some(
          (b) => b.code === code && b.start <= minute && b.end > minute,
        ),
    ).length;

  function tryFill(
    code: StationCode,
    dayIdx: number,
    start: number,
    end: number,
  ): boolean {
    const off = dayIdx === demoIdx ? DEMO_PINS.demoOff : [];
    const weekOf = weekStart(days[dayIdx]);
    const hoursThisWeek = (name: string) =>
      planned
        .filter((s) => s.crew === name && weekStart(days[s.dayIdx]) === weekOf)
        .reduce((h, s) => h + paidHours(s), 0);
    const candidates = CREW.map((c, i) => ({ name: c.firstName, i }))
      .filter(
        ({ name }) =>
          !off.includes(name) && !blocker(name, dayIdx, start, end, [code]),
      )
      .sort(
        (a, b) => hoursThisWeek(a.name) - hoursThisWeek(b.name) || a.i - b.i,
      );
    if (candidates.length === 0) return false;
    place(candidates[0].name, dayIdx, start, end, [{ code, start, end }]);
    return true;
  }

  for (let dayIdx = 0; dayIdx < days.length; dayIdx++) {
    // Overnight baker, starting this evening.
    const hasBaker = planned.some(
      (s) => s.dayIdx === dayIdx && s.blocks.some((b) => b.code === "BAKER"),
    );
    if (
      !hasBaker &&
      !tryFill("BAKER", dayIdx, BAKER_SHIFT.start, BAKER_SHIFT.end)
    ) {
      gaps.push(
        `${days[dayIdx]} BAKER ${hhmm(BAKER_SHIFT.start)}-${hhmm(BAKER_SHIFT.end)}`,
      );
    }

    for (const slot of SLOTS) {
      // Only fill the part of the window that is still below the coverage template.
      let s = min(slot.start);
      let e = min(slot.end);
      const short = (m: number) =>
        have(slot.code, dayIdx, m) < need(slot.code, m);
      while (s < e && !short(s)) s += 15;
      while (e > s && !short(e - 15)) e -= 15;
      if (s >= e) continue;

      if (tryFill(slot.code, dayIdx, s, e)) continue;
      const split = slot.split ? min(slot.split) : null;
      const parts =
        split && split > s && split < e
          ? [
              [s, split],
              [split, e],
            ]
          : [[s, e]];
      for (const [ps, pe] of parts) {
        if (parts.length > 1 && tryFill(slot.code, dayIdx, ps, pe)) continue;
        gaps.push(`${days[dayIdx]} ${slot.code} ${hhmm(ps)}-${hhmm(pe)}`);
      }
    }
  }

  // --- Write ---------------------------------------------------------------------
  const now = Date.now();

  for (const s of planned) {
    const start = toUtc(s.dayIdx, s.start);
    const end = toUtc(s.dayIdx, s.end);
    await db.shift.create({
      data: {
        storeId,
        crewId: crewIds[s.crew],
        start,
        end,
        breakMinutes: s.breakMin,
        status: end.getTime() < now ? "COMPLETED" : "SCHEDULED",
        notes:
          s.dayIdx === demoIdx && s.crew === "Kayla"
            ? "Demo: calls in sick at 4:40am"
            : null,
        assignments: {
          create: s.blocks.map((b) => ({
            stationId: stations[b.code],
            start: toUtc(s.dayIdx, b.start),
            end: toUtc(s.dayIdx, b.end),
          })),
        },
      },
    });
  }

  return {
    demoDay,
    days: [days[0], days[days.length - 1]],
    gaps,
    pinWarnings,
    counts: {
      shifts: planned.length,
      assignments: planned.reduce((n, s) => n + s.blocks.length, 0),
      hours: Math.round(planned.reduce((h, s) => h + paidHours(s), 0)),
    },
  };
}
