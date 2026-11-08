import "server-only";

import { isoDate, timeOfDay } from "@/server/data";
import { db } from "@/server/db";
import { Prisma } from "@/server/generated/prisma/client";
import type {
  CertType,
  TimeOffStatus,
  TrainingLevel,
} from "@/server/generated/prisma/enums";
import { addDays, zoned } from "@/server/rules/time";

// Crew roster edits (extends task 4.2): profile, station training, certs, weekly
// availability and time off, saved in one transaction with an AuditEvent. Reliability is
// derived from offer history and isn't edited here.

export class CrewError extends Error {}

export interface CrewEditInput {
  firstName: string;
  lastName: string;
  /** E.164, e.g. +14035550117. */
  phone: string;
  birthdate: string;
  hireDate: string;
  isStudent: boolean;
  hourlyWage: number;
  maxWeeklyHours: number | null;
  smsOptIn: boolean;
  active: boolean;
  /** stationId -> level; stations left out aren't trained. */
  stations: Record<string, TrainingLevel>;
  certs: { type: CertType; issuedAt: string; expiresAt: string | null }[];
  availability: { weekday: number; start: string; end: string }[];
  /** Whole store-local days, inclusive. */
  timeOff: {
    startDate: string;
    endDate: string;
    reason: string | null;
    status: TimeOffStatus;
  }[];
}

/** The editable form of every crew member (active and not). */
export async function getCrewForEdit() {
  const rows = await db.crew.findMany({
    orderBy: [{ active: "desc" }, { firstName: "asc" }, { lastName: "asc" }],
    include: {
      stations: true,
      certs: true,
      availability: true,
      timeOff: { orderBy: { start: "asc" } },
    },
  });
  const store = await db.store.findFirstOrThrow({ select: { timezone: true } });
  const localDate = (at: Date) =>
    new Intl.DateTimeFormat("en-CA", { timeZone: store.timezone }).format(at);
  return rows.map((c) => ({
    id: c.id,
    input: {
      firstName: c.firstName,
      lastName: c.lastName,
      phone: c.phone,
      birthdate: isoDate(c.birthdate),
      hireDate: isoDate(c.hireDate),
      isStudent: c.isStudent,
      hourlyWage: Number(c.hourlyWage),
      maxWeeklyHours:
        c.maxWeeklyHours === null ? null : Number(c.maxWeeklyHours),
      smsOptIn: c.smsOptIn,
      active: c.active,
      stations: Object.fromEntries(
        c.stations.map((s) => [s.stationId, s.level]),
      ),
      certs: c.certs.map((x) => ({
        type: x.type,
        issuedAt: isoDate(x.issuedAt),
        expiresAt: x.expiresAt ? isoDate(x.expiresAt) : null,
      })),
      availability: c.availability
        .map((a) => ({
          weekday: a.weekday,
          start: timeOfDay(a.startTime),
          end: timeOfDay(a.endTime),
        }))
        .sort(
          (a, b) => a.weekday - b.weekday || a.start.localeCompare(b.start),
        ),
      timeOff: c.timeOff.map((t) => ({
        startDate: localDate(t.start),
        endDate: localDate(new Date(t.end.getTime() - 1)),
        reason: t.reason,
        status: t.status,
      })),
    } satisfies CrewEditInput,
  }));
}

function check(input: CrewEditInput) {
  const types = input.certs.map((c) => c.type);
  if (new Set(types).size !== types.length)
    throw new CrewError("Each cert type can only be listed once.");
  for (const c of input.certs) {
    if (c.expiresAt && c.expiresAt < c.issuedAt)
      throw new CrewError("A cert can't expire before it was issued.");
  }
  for (const a of input.availability) {
    if (a.start === a.end)
      throw new CrewError(
        "An availability window needs different start and end times.",
      );
  }
  for (const t of input.timeOff) {
    if (t.endDate < t.startDate)
      throw new CrewError("Time off can't end before it starts.");
  }
}

const time = (t: string) => new Date(`1970-01-01T${t}:00Z`);
const date = (d: string) => new Date(`${d}T00:00:00Z`);

function children(input: CrewEditInput, timezone: string) {
  return {
    stations: {
      create: Object.entries(input.stations).map(([stationId, level]) => ({
        stationId,
        level,
      })),
    },
    certs: {
      create: input.certs.map((c) => ({
        type: c.type,
        issuedAt: date(c.issuedAt),
        expiresAt: c.expiresAt ? date(c.expiresAt) : null,
      })),
    },
    availability: {
      create: input.availability.map((a) => ({
        weekday: a.weekday,
        startTime: time(a.start),
        endTime: time(a.end),
      })),
    },
    timeOff: {
      create: input.timeOff.map((t) => ({
        start: zoned(t.startDate, "00:00", timezone),
        end: zoned(addDays(t.endDate, 1), "00:00", timezone),
        reason: t.reason,
        status: t.status,
      })),
    },
  };
}

function profile(input: CrewEditInput) {
  return {
    firstName: input.firstName.trim(),
    lastName: input.lastName.trim(),
    phone: input.phone,
    birthdate: date(input.birthdate),
    hireDate: date(input.hireDate),
    isStudent: input.isStudent,
    hourlyWage: input.hourlyWage,
    maxWeeklyHours: input.maxWeeklyHours,
    smsOptIn: input.smsOptIn,
    active: input.active,
  };
}

/** Prisma unique-constraint errors -> a message the manager can act on. */
function friendly(err: unknown): never {
  if (
    err instanceof Prisma.PrismaClientKnownRequestError &&
    err.code === "P2002"
  ) {
    throw new CrewError("Another crew member already has that phone number.");
  }
  throw err;
}

export async function updateCrew(crewId: string, input: CrewEditInput) {
  check(input);
  await db
    .$transaction(async (tx) => {
      const store = await tx.store.findFirstOrThrow({
        select: { timezone: true },
      });
      await tx.crewStation.deleteMany({ where: { crewId } });
      await tx.cert.deleteMany({ where: { crewId } });
      await tx.availability.deleteMany({ where: { crewId } });
      await tx.timeOff.deleteMany({ where: { crewId } });
      await tx.crew.update({
        where: { id: crewId },
        data: { ...profile(input), ...children(input, store.timezone) },
      });
      await tx.auditEvent.create({
        data: {
          type: "crew.updated",
          actor: "manager",
          payload: { crewId, ...summary(input) },
        },
      });
    })
    .catch(friendly);
}

export async function createCrew(input: CrewEditInput) {
  check(input);
  return db
    .$transaction(async (tx) => {
      const store = await tx.store.findFirstOrThrow({
        select: { id: true, timezone: true },
      });
      const crew = await tx.crew.create({
        data: {
          storeId: store.id,
          ...profile(input),
          ...children(input, store.timezone),
        },
      });
      await tx.auditEvent.create({
        data: {
          type: "crew.created",
          actor: "manager",
          payload: { crewId: crew.id, ...summary(input) },
        },
      });
      return crew.id;
    })
    .catch(friendly);
}

function summary(input: CrewEditInput) {
  return {
    name: `${input.firstName} ${input.lastName}`,
    active: input.active,
    stations: input.stations,
    certs: input.certs.map((c) => c.type),
    availabilityWindows: input.availability.length,
    timeOff: input.timeOff.length,
  };
}
