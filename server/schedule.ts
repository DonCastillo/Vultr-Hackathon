import "server-only";

import { db } from "@/server/db";
import type { Prisma } from "@/server/generated/prisma/client";
import { localDate, zoned } from "@/server/rules/time";

// Schedule edits from the week view (tasks 4.4 / 4.5). Every change runs in a transaction
// and writes an AuditEvent (CLAUDE.md: audit everything). Times come in as store-local
// "HH:MM" on the shift's date; an end at or before the start runs into the next day.

export class ScheduleError extends Error {}

export interface BlockInput {
  stationId: string;
  start: string;
  end: string;
}

export interface ShiftInput {
  crewId: string;
  /** Store-local date the shift starts on. */
  date: string;
  start: string;
  end: string;
  /** Unpaid break; omitted = 30 min after 5h, 60 min after 8.5h. */
  breakMinutes?: number;
  /** Station blocks within the shift. At least one. */
  blocks: BlockInput[];
}

const DAY_MS = 86_400_000;

/** Default unpaid break for a shift length in minutes. */
export function defaultBreak(minutes: number): number {
  return minutes > 8.5 * 60 ? 60 : minutes > 5 * 60 ? 30 : 0;
}

/** Shift and block instants from local times; blocks before the shift start roll to the next day. */
export function resolveTimes(input: ShiftInput, timezone: string) {
  const start = zoned(input.date, input.start, timezone);
  let end = zoned(input.date, input.end, timezone);
  if (end <= start) end = new Date(end.getTime() + DAY_MS);

  const blocks = input.blocks.map((b) => {
    let bs = zoned(input.date, b.start, timezone);
    if (bs < start) bs = new Date(bs.getTime() + DAY_MS);
    let be = zoned(input.date, b.end, timezone);
    while (be <= bs) be = new Date(be.getTime() + DAY_MS);
    return { stationId: b.stationId, start: bs, end: be };
  });

  if (end.getTime() - start.getTime() > 16 * 3_600_000) {
    throw new ScheduleError("A shift can't be longer than 16 hours.");
  }
  if (blocks.length === 0)
    throw new ScheduleError("Add at least one station block.");
  const sorted = [...blocks].sort(
    (a, b) => a.start.getTime() - b.start.getTime(),
  );
  for (const [i, b] of sorted.entries()) {
    if (b.start < start || b.end > end) {
      throw new ScheduleError("Station blocks must fall inside the shift.");
    }
    if (i > 0 && b.start < sorted[i - 1].end) {
      throw new ScheduleError("Station blocks can't overlap.");
    }
  }
  const minutes = (end.getTime() - start.getTime()) / 60_000;
  const breakMinutes = input.breakMinutes ?? defaultBreak(minutes);
  if (breakMinutes < 0 || breakMinutes >= minutes) {
    throw new ScheduleError("The break must be shorter than the shift.");
  }
  return { start, end, breakMinutes, blocks: sorted };
}

async function audit(
  tx: Prisma.TransactionClient,
  type: string,
  payload: Prisma.InputJsonValue,
) {
  await tx.auditEvent.create({ data: { type, actor: "manager", payload } });
}

/** Shifts can only go to active crew; inactive crew's leftover shifts must be reassigned. */
async function assertActive(tx: Prisma.TransactionClient, crewId: string) {
  const crew = await tx.crew.findUnique({
    where: { id: crewId },
    select: { active: true, firstName: true },
  });
  if (!crew) throw new ScheduleError("That crew member doesn't exist.");
  if (!crew.active)
    throw new ScheduleError(
      `${crew.firstName} is inactive: pick someone else for this shift.`,
    );
}

async function storeOf(tx: Prisma.TransactionClient) {
  return tx.store.findFirstOrThrow({ select: { id: true, timezone: true } });
}

export async function createShift(input: ShiftInput) {
  return db.$transaction(async (tx) => {
    const store = await storeOf(tx);
    await assertActive(tx, input.crewId);
    const t = resolveTimes(input, store.timezone);
    const shift = await tx.shift.create({
      data: {
        storeId: store.id,
        crewId: input.crewId,
        start: t.start,
        end: t.end,
        breakMinutes: t.breakMinutes,
        assignments: { create: t.blocks },
      },
    });
    await audit(tx, "schedule.shift_created", {
      shiftId: shift.id,
      ...summary(input),
    });
    return shift.id;
  });
}

export async function updateShift(shiftId: string, input: ShiftInput) {
  return db.$transaction(async (tx) => {
    const store = await storeOf(tx);
    await assertActive(tx, input.crewId);
    const t = resolveTimes(input, store.timezone);
    await tx.stationAssignment.deleteMany({ where: { shiftId } });
    await tx.shift.update({
      where: { id: shiftId },
      data: {
        crewId: input.crewId,
        start: t.start,
        end: t.end,
        breakMinutes: t.breakMinutes,
        assignments: { create: t.blocks },
      },
    });
    await audit(tx, "schedule.shift_updated", { shiftId, ...summary(input) });
  });
}

/** Drag and drop: same local times and station blocks, new crew member and/or day. */
export async function moveShift(shiftId: string, crewId: string, date: string) {
  return db.$transaction(async (tx) => {
    const store = await storeOf(tx);
    await assertActive(tx, crewId);
    const shift = await tx.shift.findUniqueOrThrow({
      where: { id: shiftId },
      include: { assignments: true },
    });
    const tz = store.timezone;
    const localStart = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).format(shift.start);
    const newStart = zoned(date, localStart, tz);
    const delta = newStart.getTime() - shift.start.getTime();
    const shiftBy = (d: Date) => new Date(d.getTime() + delta);
    await tx.shift.update({
      where: { id: shiftId },
      data: { crewId, start: newStart, end: shiftBy(shift.end) },
    });
    for (const a of shift.assignments) {
      await tx.stationAssignment.update({
        where: { id: a.id },
        data: { start: shiftBy(a.start), end: shiftBy(a.end) },
      });
    }
    await audit(tx, "schedule.shift_moved", {
      shiftId,
      from: { crewId: shift.crewId, date: localDate(shift.start, tz) },
      to: { crewId, date },
    });
  });
}

export async function deleteShift(shiftId: string) {
  return db.$transaction(async (tx) => {
    const callOuts = await tx.callOut.count({ where: { shiftId } });
    if (callOuts > 0) {
      throw new ScheduleError(
        "This shift has a call-out; cancel it instead of deleting.",
      );
    }
    const shift = await tx.shift.delete({ where: { id: shiftId } });
    await audit(tx, "schedule.shift_deleted", {
      shiftId,
      crewId: shift.crewId,
    });
  });
}

function summary(input: ShiftInput) {
  return {
    crewId: input.crewId,
    date: input.date,
    start: input.start,
    end: input.end,
    blocks: input.blocks.map((b) => ({ ...b })),
  };
}
