import "server-only";

import { timeOfDay } from "@/server/data";
import { db } from "@/server/db";
import type { Daypart } from "@/server/generated/prisma/enums";
import { toMinutes } from "@/server/rules/time";

// Coverage template editor (Settings): the every-day minimum headcount per station per
// daypart, plus the daypart times. Weekday-specific rules (CoverageRule.weekday set) are
// kept, but follow the new daypart times. Every station x daypart is stored (0 = not
// needed) so daypart times survive even when nobody is required.

export class CoverageTemplateError extends Error {}

export const DAYPART_ORDER: Daypart[] = [
  "MORNING_RUSH",
  "MIDDAY",
  "AFTERNOON",
  "EVENING_CLOSE",
  "OVERNIGHT",
];

export const DAYPART_LABEL: Record<Daypart, string> = {
  OVERNIGHT: "Overnight",
  MORNING_RUSH: "Morning rush",
  MIDDAY: "Midday",
  AFTERNOON: "Afternoon",
  EVENING_CLOSE: "Evening/close",
};

/** Used for a daypart that has no rules yet. */
const DEFAULT_TIMES: Record<Daypart, { start: string; end: string }> = {
  OVERNIGHT: { start: "23:00", end: "05:00" },
  MORNING_RUSH: { start: "05:30", end: "10:00" },
  MIDDAY: { start: "10:00", end: "14:00" },
  AFTERNOON: { start: "14:00", end: "18:00" },
  EVENING_CLOSE: { start: "18:00", end: "23:00" },
};

export interface CoverageTemplate {
  dayparts: Record<Daypart, { start: string; end: string }>;
  /** stationId -> daypart -> minimum headcount. */
  counts: Record<string, Partial<Record<Daypart, number>>>;
}

export async function getCoverageTemplate() {
  const [stations, rules] = await Promise.all([
    db.station.findMany({
      where: { active: true },
      orderBy: { priority: "asc" },
    }),
    db.coverageRule.findMany(),
  ]);
  const dayparts = { ...DEFAULT_TIMES };
  for (const d of DAYPART_ORDER) {
    const r =
      rules.find((x) => x.daypart === d && x.weekday === null) ??
      rules.find((x) => x.daypart === d);
    if (r)
      dayparts[d] = {
        start: timeOfDay(r.startTime),
        end: timeOfDay(r.endTime),
      };
  }
  const counts: CoverageTemplate["counts"] = {};
  for (const r of rules.filter((x) => x.weekday === null)) {
    (counts[r.stationId] ??= {})[r.daypart] = r.minCount;
  }
  return {
    stations: stations.map((s) => ({
      id: s.id,
      shortCode: s.shortCode,
      name: s.name,
      color: s.color,
    })),
    template: { dayparts, counts } satisfies CoverageTemplate,
    weekdayOverrides: rules.filter((x) => x.weekday !== null).length,
  };
}

/**
 * Dayparts must not overlap. Each is a window on a 24-hour clock that may cross midnight
 * (end at or before start); returns a problem or null.
 */
export function checkDayparts(
  dayparts: CoverageTemplate["dayparts"],
): string | null {
  const windows = DAYPART_ORDER.map((d) => {
    const { start, end } = dayparts[d];
    const s = toMinutes(start);
    let e = toMinutes(end);
    if (s === e) return { d, s, e: s, empty: true };
    if (e < s) e += 1440;
    return { d, s, e, empty: false };
  });
  const empty = windows.find((w) => w.empty);
  if (empty)
    return `${DAYPART_LABEL[empty.d]} needs different start and end times.`;
  for (let i = 0; i < windows.length; i++) {
    for (let j = i + 1; j < windows.length; j++) {
      const a = windows[i];
      const b = windows[j];
      // Compare on the circle: shift b by a day either way.
      for (const shift of [-1440, 0, 1440]) {
        if (a.s < b.e + shift && b.s + shift < a.e) {
          return `${DAYPART_LABEL[a.d]} and ${DAYPART_LABEL[b.d]} overlap.`;
        }
      }
    }
  }
  return null;
}

export async function saveCoverageTemplate(template: CoverageTemplate) {
  const problem = checkDayparts(template.dayparts);
  if (problem) throw new CoverageTemplateError(problem);
  const time = (t: string) => new Date(`1970-01-01T${t}:00Z`);

  await db.$transaction(async (tx) => {
    const store = await tx.store.findFirstOrThrow({ select: { id: true } });
    const stations = await tx.station.findMany({
      where: { active: true },
      select: { id: true },
    });
    await tx.coverageRule.deleteMany({ where: { weekday: null } });
    await tx.coverageRule.createMany({
      data: stations.flatMap((s) =>
        DAYPART_ORDER.map((d) => ({
          storeId: store.id,
          stationId: s.id,
          weekday: null,
          daypart: d,
          startTime: time(template.dayparts[d].start),
          endTime: time(template.dayparts[d].end),
          minCount: template.counts[s.id]?.[d] ?? 0,
        })),
      ),
    });
    // Weekday-specific rules keep their headcounts but follow the daypart times.
    for (const d of DAYPART_ORDER) {
      await tx.coverageRule.updateMany({
        where: { weekday: { not: null }, daypart: d },
        data: {
          startTime: time(template.dayparts[d].start),
          endTime: time(template.dayparts[d].end),
        },
      });
    }
    await tx.auditEvent.create({
      data: {
        type: "settings.coverage_template_changed",
        actor: "manager",
        payload: { dayparts: template.dayparts, counts: template.counts },
      },
    });
  });
}
