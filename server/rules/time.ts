import "server-only";

import type { TimeOfDay } from "./presets";
import type { Interval, IsoDate } from "./types";

// Store-time helpers built on Intl. Correct results need current tz data: Alberta moved
// to permanent UTC-6 on 2026-11-01, which Node only knows from 24.22 / 26.13 (.nvmrc).

const MINUTE = 60_000;

function parts(at: Date, timezone: string) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    })
      .formatToParts(at)
      .map((x) => [x.type, x.value]),
  );
  return {
    y: Number(p.year),
    m: Number(p.month),
    d: Number(p.day),
    h: Number(p.hour),
    min: Number(p.minute),
    s: Number(p.second),
  };
}

/** The store-local calendar date of an instant. */
export function localDate(at: Date, timezone: string): IsoDate {
  const { y, m, d } = parts(at, timezone);
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** Minutes after store-local midnight. */
export function localMinutes(at: Date, timezone: string): number {
  const { h, min } = parts(at, timezone);
  return h * 60 + min;
}

/** 0 = Sunday ... 6 = Saturday, for a calendar date. */
export function weekdayOf(date: IsoDate): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

export function addDays(date: IsoDate, days: number): IsoDate {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** "05:30" -> 330. */
export function toMinutes(t: TimeOfDay | string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

/** Store-local date + time of day -> UTC instant. */
export function zoned(
  date: IsoDate,
  time: TimeOfDay | string,
  timezone: string,
): Date {
  const guess = new Date(`${date}T${time}:00Z`);
  const offset = (at: Date) => {
    const { y, m, d, h, min, s } = parts(at, timezone);
    return Date.UTC(y, m - 1, d, h, min, s) - at.getTime();
  };
  const first = new Date(guess.getTime() - offset(guess));
  // Re-check once in case the guess and the answer fall on different sides of a DST change.
  return new Date(guess.getTime() - offset(first));
}

/**
 * A daily local window ("05:30"-"10:00") on a given date, as an instant range.
 * An end at or before the start runs into the next day.
 */
export function localWindow(
  date: IsoDate,
  start: TimeOfDay | string,
  end: TimeOfDay | string,
  timezone: string,
): Interval {
  const endDate = toMinutes(end) <= toMinutes(start) ? addDays(date, 1) : date;
  return {
    start: zoned(date, start, timezone),
    end: zoned(endDate, end, timezone),
  };
}

export const overlaps = (a: Interval, b: Interval) =>
  a.start < b.end && b.start < a.end;

/** The overlapping part of two intervals, or null. */
export function intersect(a: Interval, b: Interval): Interval | null {
  const start = a.start > b.start ? a.start : b.start;
  const end = a.end < b.end ? a.end : b.end;
  return start < end ? { start, end } : null;
}

/** True if `inner` lies entirely inside the union of `outer` intervals. */
export function coveredBy(inner: Interval, outer: Interval[]): boolean {
  const sorted = [...outer].sort(
    (a, b) => a.start.getTime() - b.start.getTime(),
  );
  let reached = inner.start.getTime();
  for (const o of sorted) {
    if (o.start.getTime() > reached) break;
    if (o.end.getTime() > reached) reached = o.end.getTime();
    if (reached >= inner.end.getTime()) return true;
  }
  return reached >= inner.end.getTime();
}

/** "Mon 05:30" in store time, for rule messages. */
export function formatLocal(at: Date, timezone: string): string {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(at)
      .map((x) => [x.type, x.value]),
  );
  return `${p.weekday} ${p.hour}:${p.minute}`;
}

/** "Mon 05:30-10:00" (or "Mon 22:30-Tue 06:30" across days). */
export function formatRange(
  { start, end }: Interval,
  timezone: string,
): string {
  const a = formatLocal(start, timezone);
  const b = formatLocal(end, timezone);
  return a.slice(0, 3) === b.slice(0, 3) ? `${a}-${b.slice(4)}` : `${a}-${b}`;
}

export const hoursBetween = (a: Date, b: Date) =>
  (b.getTime() - a.getTime()) / (60 * MINUTE);
