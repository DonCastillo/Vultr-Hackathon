// Date/time helpers for the seed. Postgres TIME and DATE columns map to JS Date in Prisma:
// a TIME is a Date on 1970-01-01 (UTC), a DATE is a Date at 00:00 UTC.

/** "05:30" -> Date for a Postgres TIME column (local store time). */
export function time(hhmm: string): Date {
  return new Date(`1970-01-01T${hhmm}:00Z`);
}

/** "2026-11-09" -> Date for a Postgres DATE column. */
export function date(ymd: string): Date {
  return new Date(`${ymd}T00:00:00Z`);
}

/** Today's calendar date in the given IANA timezone, as "YYYY-MM-DD". */
export function todayIn(timezone: string, now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/** Adds whole days to a "YYYY-MM-DD" date. */
export function addDays(ymd: string, days: number): string {
  const d = date(ymd);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** 0 = Sunday ... 6 = Saturday, for a "YYYY-MM-DD" date. */
export function weekday(ymd: string): number {
  return date(ymd).getUTCDay();
}
