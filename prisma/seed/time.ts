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

/** Offset of `timezone` from UTC at instant `at`, in milliseconds. */
function tzOffsetMs(at: Date, timezone: string): number {
  const parts = Object.fromEntries(
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
      .map((p) => [p.type, p.value]),
  );
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );
  return asUtc - at.getTime();
}

/**
 * Local store time -> UTC instant for a TIMESTAMPTZ column.
 * zoned("2026-11-09", "05:30", "America/Edmonton") -> 2026-11-09T12:30:00Z.
 */
export function zoned(ymd: string, hhmm: string, timezone: string): Date {
  const guess = new Date(`${ymd}T${hhmm}:00Z`);
  const first = new Date(guess.getTime() - tzOffsetMs(guess, timezone));
  // Re-check once in case the guess and the answer fall on different sides of a DST change.
  return new Date(guess.getTime() - tzOffsetMs(first, timezone));
}

/** 0 = Sunday ... 6 = Saturday, for a "YYYY-MM-DD" date. */
export function weekday(ymd: string): number {
  return date(ymd).getUTCDay();
}
