import "server-only";

import type { Jurisdiction } from "@/server/generated/prisma/enums";

// Labour-rule presets per jurisdiction. Picking a jurisdiction in Settings copies the
// overridable numbers into RuleConfig (ruleConfigDefaults). The overtime method and the
// youth start/non-school-day limits are fixed per jurisdiction and read from here.
//
// Simplified for scheduling decisions; not legal advice.

export const PRESET_DISCLAIMER =
  "Labour rules are simplified for scheduling and are not legal advice.";

/** How daily and weekly overtime combine. */
export type OvertimeMethod =
  /** AB: count daily OT and weekly OT separately and use whichever is greater. */
  | "GREATER_OF_DAILY_OR_WEEKLY"
  /** BC: daily OT first, then weekly OT on the remaining regular hours over the limit. */
  | "DAILY_THEN_WEEKLY"
  /** ON, US: weekly OT only. */
  | "WEEKLY_ONLY";

/** "HH:MM", local store time. */
export type TimeOfDay = `${number}${number}:${number}${number}`;

export interface RulePreset {
  jurisdiction: Jurisdiction;
  label: string;
  shortLabel: string;
  overtimeMethod: OvertimeMethod;
  weeklyOtHours: number;
  /** null = no daily overtime. */
  dailyOtHours: number | null;
  /** Minimum hours off between two shifts (clopen check). 0 = no rule. */
  minRestHours: number;
  maxConsecutiveDays: number;
  /** Youth rules apply to crew younger than this. */
  youthUnderAge: number;
  youthMaxSchoolDayHours: number;
  /** null = no weekly cap in school weeks. */
  youthMaxSchoolWeekHours: number | null;
  youthMaxNonSchoolDayHours: number;
  youthEarliestStart: TimeOfDay;
  youthLatestEnd: TimeOfDay;
  /** Where the preset simplifies or approximates the law. */
  notes: string[];
}

export const PRESETS: Record<Jurisdiction, RulePreset> = {
  ALBERTA: {
    jurisdiction: "ALBERTA",
    label: "Alberta",
    shortLabel: "AB",
    overtimeMethod: "GREATER_OF_DAILY_OR_WEEKLY",
    weeklyOtHours: 44,
    dailyOtHours: 8,
    minRestHours: 8,
    maxConsecutiveDays: 6,
    youthUnderAge: 15,
    youthMaxSchoolDayHours: 2,
    youthMaxSchoolWeekHours: null,
    youthMaxNonSchoolDayHours: 8,
    youthEarliestStart: "06:00",
    youthLatestEnd: "21:00",
    notes: [
      "Youth limits are for ages 13-14. Ages 15-17 can't work 00:00-06:00 and need adult supervision 21:00-00:00 in restaurants; not modelled.",
    ],
  },
  ONTARIO: {
    jurisdiction: "ONTARIO",
    label: "Ontario",
    shortLabel: "ON",
    overtimeMethod: "WEEKLY_ONLY",
    weeklyOtHours: 44,
    dailyOtHours: null,
    minRestHours: 11,
    maxConsecutiveDays: 6,
    youthUnderAge: 16,
    youthMaxSchoolDayHours: 4,
    youthMaxSchoolWeekHours: null,
    youthMaxNonSchoolDayHours: 8,
    youthEarliestStart: "07:00",
    youthLatestEnd: "21:00",
    notes: [
      "Rest uses the 11h daily rest period, stricter than the 8h between-shift minimum.",
      "Ontario bars under-16s from working during school hours rather than capping hours; the 4h school-day cap and 07:00-21:00 window approximate that.",
    ],
  },
  BRITISH_COLUMBIA: {
    jurisdiction: "BRITISH_COLUMBIA",
    label: "British Columbia",
    shortLabel: "BC",
    overtimeMethod: "DAILY_THEN_WEEKLY",
    weeklyOtHours: 40,
    dailyOtHours: 8,
    minRestHours: 8,
    maxConsecutiveDays: 6,
    youthUnderAge: 16,
    youthMaxSchoolDayHours: 4,
    youthMaxSchoolWeekHours: 20,
    youthMaxNonSchoolDayHours: 7,
    youthEarliestStart: "06:00",
    youthLatestEnd: "21:00",
    notes: ["Double time after 12h in a day is not modelled."],
  },
  US_FEDERAL: {
    jurisdiction: "US_FEDERAL",
    label: "US federal (FLSA)",
    shortLabel: "US",
    overtimeMethod: "WEEKLY_ONLY",
    weeklyOtHours: 40,
    dailyOtHours: null,
    minRestHours: 0,
    maxConsecutiveDays: 7,
    youthUnderAge: 16,
    youthMaxSchoolDayHours: 3,
    youthMaxSchoolWeekHours: 18,
    youthMaxNonSchoolDayHours: 8,
    youthEarliestStart: "07:00",
    youthLatestEnd: "19:00",
    notes: [
      "Youth latest end is 19:00 in the school year (21:00 from June 1 to Labor Day; not modelled).",
      "No federal rest-between-shifts or consecutive-day rule; state laws not modelled.",
    ],
  },
};

export function getPreset(jurisdiction: Jurisdiction): RulePreset {
  return PRESETS[jurisdiction];
}

/** The RuleConfig columns a preset sets when the manager picks a jurisdiction. */
export interface RuleConfigDefaults {
  weeklyOtHours: number;
  dailyOtHours: number | null;
  minRestHours: number;
  maxConsecutiveDays: number;
  youthUnderAge: number;
  youthMaxSchoolDayHours: number;
  youthMaxSchoolWeekHours: number | null;
  youthLatestEnd: TimeOfDay;
}

export function ruleConfigDefaults(
  jurisdiction: Jurisdiction,
): RuleConfigDefaults {
  const p = getPreset(jurisdiction);
  return {
    weeklyOtHours: p.weeklyOtHours,
    dailyOtHours: p.dailyOtHours,
    minRestHours: p.minRestHours,
    maxConsecutiveDays: p.maxConsecutiveDays,
    youthUnderAge: p.youthUnderAge,
    youthMaxSchoolDayHours: p.youthMaxSchoolDayHours,
    youthMaxSchoolWeekHours: p.youthMaxSchoolWeekHours,
    youthLatestEnd: p.youthLatestEnd,
  };
}
