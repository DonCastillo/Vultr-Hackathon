import "server-only";

import {
  dayRange,
  getCrew,
  getSchoolDays,
  getShifts,
  getStoreContext,
  type StoreContext,
} from "@/server/data";
import { computeCoverage } from "@/server/rules/coverage";
import { paidHours, weekStartOf } from "@/server/rules/overtime";
import { addDays, localDate, localMinutes } from "@/server/rules/time";
import { isWorkedShift } from "@/server/rules/types";
import { ageOn } from "@/server/rules/youth";
import { validateShifts, type Badge } from "@/server/validation";

// View models for the manager pages. Everything is formatted in store time on the server,
// so the browser's own timezone data can't skew a schedule.

const hhmm = (at: Date, tz: string) =>
  new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(at);
const dayLabel = (date: string) =>
  new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(new Date(`${date}T00:00:00Z`));
const round1 = (h: number) => Math.round(h * 10) / 10;

export interface StationOption {
  id: string;
  name: string;
  shortCode: string;
  color: string;
}

export function todayInStore(ctx: Pick<StoreContext, "timezone">): string {
  return localDate(new Date(), ctx.timezone);
}

// ---------------------------------------------------------------------------------
// Week view (4.3-4.6)
// ---------------------------------------------------------------------------------

export interface ShiftCard {
  id: string;
  crewId: string;
  date: string;
  start: string;
  end: string;
  breakMinutes: number;
  hours: number;
  status: string;
  notes: string | null;
  /** Station blocks as % of the shift, for the colored bar. */
  segments: {
    stationId: string;
    shortCode: string;
    color: string;
    start: string;
    end: string;
    leftPct: number;
    widthPct: number;
  }[];
  badges: Badge[];
}

export interface WeekView {
  storeName: string;
  weekStart: string;
  prevWeek: string;
  nextWeek: string;
  today: string;
  days: { date: string; label: string }[];
  rows: {
    crewId: string;
    active: boolean;
    name: string;
    age: number;
    isStudent: boolean;
    weekHours: number;
    maxWeeklyHours: number | null;
    days: ShiftCard[][];
  }[];
  stations: StationOption[];
  dayTotals: number[];
  badgeCount: number;
}

export async function getWeekView(requested?: string): Promise<WeekView> {
  const ctx = await getStoreContext();
  const tz = ctx.timezone;
  const today = todayInStore(ctx);
  const weekStart = weekStartOf(
    requested && /^\d{4}-\d{2}-\d{2}$/.test(requested) ? requested : today,
  );
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));

  // Load a day either side so rest gaps and overnight shifts at the edges are checked.
  const [crew, { shifts, assignments }, schoolDays] = await Promise.all([
    // Inactive crew are loaded too, so shifts they still hold stay visible (and flagged).
    getCrew({ includeInactive: true }),
    getShifts(dayRange(addDays(weekStart, -1), addDays(weekStart, 7), tz)),
    getSchoolDays(addDays(weekStart, -7), addDays(weekStart, 13)),
  ]);
  const badges = validateShifts({ ctx, crew, shifts, assignments, schoolDays });
  const stationById = new Map(ctx.stations.map((s) => [s.id, s]));

  const cards = shifts
    .filter((s) => isWorkedShift(s) || s.status === "CALLED_OUT")
    .map((s): ShiftCard => {
      const total = s.end.getTime() - s.start.getTime();
      return {
        id: s.id,
        crewId: s.crewId,
        date: localDate(s.start, tz),
        start: hhmm(s.start, tz),
        end: hhmm(s.end, tz),
        breakMinutes: s.breakMinutes,
        hours: round1(paidHours(s)),
        status: s.status,
        notes: s.notes,
        segments: assignments
          .filter((a) => a.shiftId === s.id)
          .map((a) => {
            const st = stationById.get(a.stationId);
            return {
              stationId: a.stationId,
              shortCode: st?.shortCode ?? "?",
              color: st?.color ?? "#999999",
              start: hhmm(a.start, tz),
              end: hhmm(a.end, tz),
              leftPct: ((a.start.getTime() - s.start.getTime()) / total) * 100,
              widthPct: ((a.end.getTime() - a.start.getTime()) / total) * 100,
            };
          }),
        badges: badges.get(s.id) ?? [],
      };
    });

  const rows = crew
    // Inactive crew only get a row while they still hold shifts this week.
    .filter(
      (c) =>
        c.active ||
        cards.some((k) => k.crewId === c.id && days.includes(k.date)),
    )
    .map((c) => {
      const mine = cards.filter((k) => k.crewId === c.id);
      return {
        crewId: c.id,
        active: c.active,
        name: `${c.firstName} ${c.lastName}`,
        age: ageOn(c.birthdate, today),
        isStudent: c.isStudent,
        weekHours: round1(
          mine
            .filter((k) => days.includes(k.date) && k.status !== "CALLED_OUT")
            .reduce((h, k) => h + k.hours, 0),
        ),
        maxWeeklyHours: c.maxWeeklyHours,
        days: days.map((d) => mine.filter((k) => k.date === d)),
      };
    });

  return {
    storeName: ctx.storeName,
    weekStart,
    prevWeek: addDays(weekStart, -7),
    nextWeek: addDays(weekStart, 7),
    today,
    days: days.map((date) => ({ date, label: dayLabel(date) })),
    rows,
    stations: ctx.stations
      .filter((s) => s.active)
      .map(({ id, name, shortCode, color }) => ({
        id,
        name,
        shortCode,
        color,
      })),
    dayTotals: days.map((d) =>
      round1(
        cards
          .filter((k) => k.date === d && k.status !== "CALLED_OUT")
          .reduce((h, k) => h + k.hours, 0),
      ),
    ),
    badgeCount: cards
      .filter((k) => days.includes(k.date))
      .reduce((n, k) => n + k.badges.length, 0),
  };
}

// ---------------------------------------------------------------------------------
// Day station board (4.7) + labour by daypart (4.9)
// ---------------------------------------------------------------------------------

export interface BoardView {
  storeName: string;
  date: string;
  label: string;
  prevDate: string;
  nextDate: string;
  today: string;
  /** Board window in minutes after the date's local midnight. */
  windowStart: number;
  windowEnd: number;
  stations: {
    id: string;
    name: string;
    shortCode: string;
    color: string;
    lanes: {
      crewName: string;
      shiftId: string;
      start: number;
      end: number;
      label: string;
      calledOut: boolean;
      inactive: boolean;
    }[][];
    slots: { start: number; required: number; scheduled: number }[];
  }[];
  shortfalls: { stationName: string; range: string; missing: number }[];
  supervisorGaps: string[];
  dayparts: {
    name: string;
    start: string;
    end: string;
    hours: number;
    cost: number;
  }[];
}

const DAYPART_LABEL: Record<string, string> = {
  OVERNIGHT: "Overnight",
  MORNING_RUSH: "Morning rush",
  MIDDAY: "Midday",
  AFTERNOON: "Afternoon",
  EVENING_CLOSE: "Evening/close",
};

export async function getBoardView(requested?: string): Promise<BoardView> {
  const ctx = await getStoreContext();
  const tz = ctx.timezone;
  const today = todayInStore(ctx);
  const date =
    requested && /^\d{4}-\d{2}-\d{2}$/.test(requested) ? requested : today;
  const [crew, { shifts, assignments }] = await Promise.all([
    getCrew({ includeInactive: true }),
    getShifts(dayRange(addDays(date, -1), addDays(date, 1), tz)),
  ]);
  const crewById = new Map(crew.map((c) => [c.id, c]));
  const shiftById = new Map(shifts.map((s) => [s.id, s]));
  const workedBlocks = assignments.filter((a) => {
    const s = shiftById.get(a.shiftId);
    return s && isWorkedShift(s);
  });
  const calledOutBlocks = assignments.filter(
    (a) => shiftById.get(a.shiftId)?.status === "CALLED_OUT",
  );

  const coverage = computeCoverage({
    date,
    timezone: tz,
    stations: ctx.stations,
    rules: ctx.coverageRules,
    assignments: workedBlocks,
    openTime: ctx.openTime,
    closeTime: ctx.closeTime,
  });

  // Window: from store open to the same time next day (covers the overnight bake).
  const midnight = new Date(`${date}T00:00:00Z`);
  const minutesFrom = (at: Date) => {
    const d = localDate(at, tz);
    const dayOffset = Math.round(
      (new Date(`${d}T00:00:00Z`).getTime() - midnight.getTime()) / 86_400_000,
    );
    return dayOffset * 1440 + localMinutes(at, tz);
  };
  const [oh, om] = ctx.openTime.split(":").map(Number);
  const windowStart = oh * 60 + om;
  const windowEnd = windowStart + 1440;

  const stations = ctx.stations
    .filter((s) => s.active)
    .map((st) => {
      const blocks = [...workedBlocks, ...calledOutBlocks]
        .filter((a) => a.stationId === st.id)
        .map((a) => {
          const c = crewById.get(a.crewId);
          return {
            crewName: c ? c.firstName : "?",
            inactive: c ? !c.active : false,
            shiftId: a.shiftId,
            start: Math.max(windowStart, minutesFrom(a.start)),
            end: Math.min(windowEnd, minutesFrom(a.end)),
            label: `${hhmm(a.start, tz)}-${hhmm(a.end, tz)}`,
            calledOut: shiftById.get(a.shiftId)?.status === "CALLED_OUT",
          };
        })
        .filter((b) => b.end > b.start)
        .sort((a, b) => a.start - b.start);
      // Stack overlapping blocks into lanes.
      const lanes: (typeof blocks)[] = [];
      for (const b of blocks) {
        const lane = lanes.find((l) => l[l.length - 1].end <= b.start);
        if (lane) lane.push(b);
        else lanes.push([b]);
      }
      return {
        id: st.id,
        name: st.name,
        shortCode: st.shortCode,
        color: st.color,
        lanes,
        slots: coverage.slots
          .filter((s) => s.stationId === st.id)
          .map((s) => ({
            start: minutesFrom(s.start),
            required: s.required,
            scheduled: s.scheduled,
          }))
          .filter((s) => s.start >= windowStart && s.start < windowEnd),
      };
    });

  const range = (s: { start: Date; end: Date }) =>
    `${hhmm(s.start, tz)}-${hhmm(s.end, tz)}`;
  const stationName = (id: string) =>
    ctx.stations.find((s) => s.id === id)?.name ?? id;

  // Labour by daypart: scheduled station hours x wage (4.9).
  const parts = new Map<string, { start: string; end: string }>();
  for (const r of ctx.coverageRules)
    parts.set(r.daypart, { start: r.start, end: r.end });
  const dayparts = [...parts.entries()]
    .sort((a, b) => (a[1].start < b[1].start ? -1 : 1))
    .map(([name, w]) => {
      const ws = minutesOf(w.start);
      let we = minutesOf(w.end);
      if (we <= ws) we += 1440;
      let hours = 0;
      let cost = 0;
      for (const a of workedBlocks) {
        const s = Math.max(ws, minutesFrom(a.start));
        const e = Math.min(we, minutesFrom(a.end));
        if (e > s) {
          const h = (e - s) / 60;
          hours += h;
          cost += h * (crewById.get(a.crewId)?.hourlyWage ?? 0);
        }
      }
      return {
        name: DAYPART_LABEL[name] ?? name,
        start: w.start,
        end: w.end,
        hours: round1(hours),
        cost: Math.round(cost),
      };
    });

  return {
    storeName: ctx.storeName,
    date,
    label: dayLabel(date),
    prevDate: addDays(date, -1),
    nextDate: addDays(date, 1),
    today,
    windowStart,
    windowEnd,
    stations,
    shortfalls: coverage.shortfalls.map((s) => ({
      stationName: stationName(s.stationId),
      range: range(s),
      missing: s.missing,
    })),
    supervisorGaps: coverage.supervisorGaps.map(range),
    dayparts,
  };
}

function minutesOf(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

// ---------------------------------------------------------------------------------
// Crew roster (4.2)
// ---------------------------------------------------------------------------------

const WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export interface RosterView {
  crew: {
    id: string;
    name: string;
    phone: string;
    age: number;
    isStudent: boolean;
    isYouth: boolean;
    reliability: number;
    hireDate: string;
    hourlyWage: number;
    maxWeeklyHours: number | null;
    smsOptIn: boolean;
    stations: {
      shortCode: string;
      name: string;
      color: string;
      level: string;
    }[];
    certs: { type: string; expiresAt: string | null; expired: boolean }[];
    availability: string[];
    timeOff: { range: string; status: string }[];
  }[];
  youthUnderAge: number;
}

export async function getRosterView(): Promise<RosterView> {
  const ctx = await getStoreContext();
  const tz = ctx.timezone;
  const today = todayInStore(ctx);
  const crew = await getCrew();
  const stationById = new Map(ctx.stations.map((s) => [s.id, s]));
  const fmt = (at: Date) =>
    new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      month: "short",
      day: "numeric",
    }).format(at);

  return {
    youthUnderAge: ctx.config.youthUnderAge,
    crew: crew.map((c) => {
      const age = ageOn(c.birthdate, today);
      const byDay = new Map<string, number[]>();
      for (const a of c.availability) {
        const key = `${a.start}-${a.end}`;
        byDay.set(key, [...(byDay.get(key) ?? []), a.weekday]);
      }
      return {
        id: c.id,
        name: `${c.firstName} ${c.lastName}`,
        phone: c.phone,
        age,
        isStudent: c.isStudent,
        isYouth: age < ctx.config.youthUnderAge,
        reliability: c.reliability,
        hireDate: c.hireDate,
        hourlyWage: c.hourlyWage,
        maxWeeklyHours: c.maxWeeklyHours,
        smsOptIn: c.smsOptIn,
        stations: Object.entries(c.stations)
          .map(([id, level]) => ({ st: stationById.get(id), level }))
          .filter((x) => x.st)
          .sort((a, b) => a.st!.priority - b.st!.priority)
          .map(({ st, level }) => ({
            shortCode: st!.shortCode,
            name: st!.name,
            color: st!.color,
            level,
          })),
        certs: c.certs.map((x) => ({
          ...x,
          expired: x.expiresAt !== null && x.expiresAt < today,
        })),
        availability: [...byDay.entries()].map(([window, days]) => {
          const sorted = days.sort((a, b) => a - b);
          const label =
            sorted.length === 7
              ? "Daily"
              : sorted.join(",") === "1,2,3,4,5"
                ? "Mon-Fri"
                : sorted.join(",") === "0,6"
                  ? "Sat-Sun"
                  : sorted.map((d) => WEEKDAY[d]).join(" ");
          return `${label} ${window}`;
        }),
        timeOff: c.timeOff
          .filter((t) => t.status !== "DENIED" && t.end > new Date())
          .map((t) => ({
            range: `${fmt(t.start)}-${fmt(new Date(t.end.getTime() - 1))}`,
            status: t.status,
          })),
      };
    }),
  };
}

// Used by the settings page.
export async function getSettingsView() {
  const ctx = await getStoreContext();
  return {
    storeName: ctx.storeName,
    jurisdiction: ctx.preset.jurisdiction,
    presetLabel: ctx.preset.label,
    presetNotes: ctx.preset.notes,
    overtimeMethod: ctx.preset.overtimeMethod,
    config: ctx.config,
    stations: ctx.stations.map((s) => ({
      id: s.id,
      name: s.name,
      shortCode: s.shortCode,
      color: s.color,
      priority: s.priority,
    })),
  };
}
