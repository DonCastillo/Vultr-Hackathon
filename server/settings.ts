import "server-only";

import { db } from "@/server/db";
import type { Jurisdiction } from "@/server/generated/prisma/enums";
import { ruleConfigDefaults } from "@/server/rules/presets";

// Settings page (4.8): jurisdiction preset, rule overrides, outreach timing, station priority.

export interface RuleSettings {
  weeklyOtHours: number;
  dailyOtHours: number | null;
  minRestHours: number;
  maxConsecutiveDays: number;
  offerTimeoutSec: number;
  demoMode: boolean;
}

async function audit(type: string, payload: Record<string, unknown>) {
  await db.auditEvent.create({
    data: { type, actor: "manager", payload: payload as object },
  });
}

/** Switches jurisdiction and resets the rule numbers to that preset's defaults. */
export async function applyJurisdiction(jurisdiction: Jurisdiction) {
  const store = await db.store.findFirstOrThrow({ select: { id: true } });
  const d = ruleConfigDefaults(jurisdiction);
  await db.$transaction([
    db.store.update({ where: { id: store.id }, data: { jurisdiction } }),
    db.ruleConfig.update({
      where: { storeId: store.id },
      data: {
        weeklyOtHours: d.weeklyOtHours,
        dailyOtHours: d.dailyOtHours,
        minRestHours: d.minRestHours,
        maxConsecutiveDays: d.maxConsecutiveDays,
        youthUnderAge: d.youthUnderAge,
        youthMaxSchoolDayHours: d.youthMaxSchoolDayHours,
        youthMaxSchoolWeekHours: d.youthMaxSchoolWeekHours,
        youthLatestEnd: new Date(`1970-01-01T${d.youthLatestEnd}:00Z`),
      },
    }),
  ]);
  await audit("settings.jurisdiction_changed", {
    jurisdiction,
    defaults: { ...d },
  });
}

export async function updateRuleSettings(s: RuleSettings) {
  const store = await db.store.findFirstOrThrow({ select: { id: true } });
  await db.ruleConfig.update({ where: { storeId: store.id }, data: s });
  await audit("settings.rules_updated", { ...s });
}

/** Moves a station one place up (more critical) or down in the priority order. */
export async function moveStationPriority(
  stationId: string,
  direction: "up" | "down",
) {
  const stations = await db.station.findMany({ orderBy: { priority: "asc" } });
  const i = stations.findIndex((s) => s.id === stationId);
  const j = direction === "up" ? i - 1 : i + 1;
  if (i < 0 || j < 0 || j >= stations.length) return;
  [stations[i], stations[j]] = [stations[j], stations[i]];
  await db.$transaction(
    stations.map((s, n) =>
      db.station.update({ where: { id: s.id }, data: { priority: n + 1 } }),
    ),
  );
  await audit("settings.station_priority_changed", {
    order: stations.map((s) => s.shortCode),
  });
}
