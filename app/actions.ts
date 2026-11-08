"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { autofillWeek } from "@/server/autofill";
import { createCrew, CrewError, updateCrew } from "@/server/crew";
import { Jurisdiction } from "@/server/generated/prisma/enums";
import {
  createShift,
  deleteShift,
  moveShift,
  ScheduleError,
  updateShift,
} from "@/server/schedule";
import {
  applyJurisdiction,
  moveStationPriority,
  updateRuleSettings,
} from "@/server/settings";

// Thin server actions (CLAUDE.md): validate input, call server/, refresh the pages.

export type ActionResult = { ok: true } | { ok: false; error: string };

const time = z.string().regex(/^\d{2}:\d{2}$/, "Use HH:MM");
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");
const id = z.string().min(1);

const ShiftSchema = z.object({
  crewId: id,
  date,
  start: time,
  end: time,
  breakMinutes: z.number().int().min(0).max(240).optional(),
  blocks: z
    .array(z.object({ stationId: id, start: time, end: time }))
    .min(1, "Add at least one station block"),
});

async function run(fn: () => Promise<unknown>): Promise<ActionResult> {
  try {
    await fn();
    revalidatePath("/schedule");
    revalidatePath("/board");
    revalidatePath("/settings");
    return { ok: true };
  } catch (err) {
    if (err instanceof ScheduleError) return { ok: false, error: err.message };
    if (err instanceof z.ZodError)
      return { ok: false, error: z.prettifyError(err) };
    console.error(err);
    return { ok: false, error: "Something went wrong saving that change." };
  }
}

export async function createShiftAction(input: unknown) {
  return run(() => createShift(ShiftSchema.parse(input)));
}

export async function updateShiftAction(shiftId: unknown, input: unknown) {
  return run(() => updateShift(id.parse(shiftId), ShiftSchema.parse(input)));
}

export async function moveShiftAction(
  shiftId: unknown,
  crewId: unknown,
  toDate: unknown,
) {
  return run(() =>
    moveShift(id.parse(shiftId), id.parse(crewId), date.parse(toDate)),
  );
}

export async function deleteShiftAction(shiftId: unknown) {
  return run(() => deleteShift(id.parse(shiftId)));
}

export async function applyJurisdictionAction(jurisdiction: unknown) {
  return run(() =>
    applyJurisdiction(
      z
        .enum(Object.values(Jurisdiction) as [Jurisdiction, ...Jurisdiction[]])
        .parse(jurisdiction),
    ),
  );
}

const RuleSettingsSchema = z.object({
  weeklyOtHours: z.number().min(1).max(80),
  dailyOtHours: z.number().min(1).max(24).nullable(),
  minRestHours: z.number().min(0).max(24),
  maxConsecutiveDays: z.number().int().min(1).max(7),
  offerTimeoutSec: z.number().int().min(30).max(3600),
  demoMode: z.boolean(),
});

export async function updateRuleSettingsAction(input: unknown) {
  return run(() => updateRuleSettings(RuleSettingsSchema.parse(input)));
}

export async function moveStationPriorityAction(
  stationId: unknown,
  direction: unknown,
) {
  return run(() =>
    moveStationPriority(
      id.parse(stationId),
      z.enum(["up", "down"]).parse(direction),
    ),
  );
}

export type AutofillResult =
  | { ok: true; created: number; unfilled: string[] }
  | { ok: false; error: string };

export async function autofillWeekAction(
  weekStart: unknown,
): Promise<AutofillResult> {
  try {
    const plan = await autofillWeek(date.parse(weekStart));
    revalidatePath("/schedule");
    revalidatePath("/board");
    return { ok: true, created: plan.fills.length, unfilled: plan.unfilled };
  } catch (err) {
    console.error(err);
    return { ok: false, error: "Auto-fill failed." };
  }
}

const CrewSchema = z.object({
  firstName: z.string().trim().min(1, "First name is required").max(50),
  lastName: z.string().trim().min(1, "Last name is required").max(50),
  phone: z
    .string()
    .regex(/^\+[1-9]\d{7,14}$/, "Phone must be E.164, e.g. +14035550117"),
  birthdate: date,
  hireDate: date,
  isStudent: z.boolean(),
  hourlyWage: z.number().min(0).max(200),
  maxWeeklyHours: z.number().min(1).max(80).nullable(),
  smsOptIn: z.boolean(),
  active: z.boolean(),
  stations: z.record(z.string(), z.enum(["TRAINEE", "CERTIFIED", "TRAINER"])),
  certs: z.array(
    z.object({
      type: z.enum(["FOOD_HANDLER", "BAKER", "SUPERVISOR", "FIRST_AID"]),
      issuedAt: date,
      expiresAt: date.nullable(),
    }),
  ),
  availability: z.array(
    z.object({
      weekday: z.number().int().min(0).max(6),
      start: time,
      end: time,
    }),
  ),
  timeOff: z.array(
    z.object({
      startDate: date,
      endDate: date,
      reason: z.string().trim().max(120).nullable(),
      status: z.enum(["REQUESTED", "APPROVED", "DENIED"]),
    }),
  ),
});

async function runCrew(fn: () => Promise<unknown>): Promise<ActionResult> {
  try {
    await fn();
    revalidatePath("/crew");
    revalidatePath("/schedule");
    revalidatePath("/board");
    return { ok: true };
  } catch (err) {
    if (err instanceof CrewError) return { ok: false, error: err.message };
    if (err instanceof z.ZodError)
      return { ok: false, error: z.prettifyError(err) };
    console.error(err);
    return {
      ok: false,
      error: "Something went wrong saving that crew member.",
    };
  }
}

export async function updateCrewAction(crewId: unknown, input: unknown) {
  return runCrew(() => updateCrew(id.parse(crewId), CrewSchema.parse(input)));
}

export async function createCrewAction(input: unknown) {
  return runCrew(() => createCrew(CrewSchema.parse(input)));
}
