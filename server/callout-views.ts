import "server-only";

import { db } from "@/server/db";
import type { PlanCandidate } from "@/server/outreach";
import { formatRange, localDate } from "@/server/rules/time";

// View models for the call-out pages and the phone simulator (phase 5).

const range = (s: { start: Date | string; end: Date | string }, tz: string) =>
  formatRange({ start: new Date(s.start), end: new Date(s.end) }, tz);
const clock = (at: Date, tz: string) =>
  new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  }).format(at);

export async function getCallOutList() {
  const store = await db.store.findFirstOrThrow();
  const rows = await db.callOut.findMany({
    orderBy: { createdAt: "desc" },
    take: 50,
    include: { crew: true, shift: true, coveredBy: true },
  });
  return rows.map((c) => ({
    id: c.id,
    crew: `${c.crew.firstName} ${c.crew.lastName}`,
    shift: range(c.shift, store.timezone),
    reason: c.reason,
    source: c.source,
    status: c.status,
    created: clock(c.createdAt, store.timezone),
  }));
}

export async function getCallOutView(id: string) {
  const store = await db.store.findFirstOrThrow();
  const tz = store.timezone;
  const co = await db.callOut.findUnique({
    where: { id },
    include: {
      crew: true,
      shift: {
        include: {
          assignments: {
            include: { station: true },
            orderBy: { start: "asc" },
          },
        },
      },
      plan: true,
      offers: {
        include: { crew: true, station: true },
        orderBy: { rank: "asc" },
      },
      auditEvents: { orderBy: { at: "asc" } },
      messages: { orderBy: { sentAt: "asc" }, include: { crew: true } },
    },
  });
  if (!co) return null;
  const [stations, crew] = await Promise.all([
    db.station.findMany(),
    db.crew.findMany(),
  ]);
  const station = (sid: string) => stations.find((s) => s.id === sid);
  const name = (cid: string) =>
    crew.find((c) => c.id === cid)?.firstName ?? cid;

  const plan = co.plan;
  const shortfall = (plan?.shortfall ?? []) as unknown as {
    stationId: string;
    start: string;
    end: string;
    required: number;
    scheduled: number;
    missing: number;
  }[];
  const moves = (plan?.moves ?? []) as unknown as {
    crewId: string;
    fromStationId: string;
    toStationId: string;
    start: string;
    end: string;
  }[];
  const remaining = (plan?.remainingShortfall ?? []) as unknown as {
    stationId: string;
    start: string;
    end: string;
    missing: number;
  }[];
  const candidates = (plan?.candidates ?? []) as unknown as PlanCandidate[];

  return {
    id: co.id,
    status: co.status,
    source: co.source,
    reason: co.reason,
    rawText: co.rawText,
    otApproved: co.otApproved,
    crew: `${co.crew.firstName} ${co.crew.lastName}`,
    shift: range(co.shift, tz),
    shiftStations: co.shift.assignments.map(
      (a) => `${a.station.shortCode} ${range(a, tz).slice(4)}`,
    ),
    date: localDate(co.shift.start, tz),
    summary: plan?.summary ?? null,
    llm: plan
      ? [plan.llmProvider, plan.llmModel].filter(Boolean).join(" · ")
      : "",
    applied: Boolean(plan?.appliedAt),
    gaps: shortfall.map((g) => ({
      station: station(g.stationId)?.name ?? g.stationId,
      color: station(g.stationId)?.color ?? "#999",
      range: range(g, tz),
      detail: `${g.scheduled} of ${g.required} scheduled`,
    })),
    moves: moves.map((m) => ({
      crew: name(m.crewId),
      from: station(m.fromStationId)?.name ?? m.fromStationId,
      to: station(m.toStationId)?.name ?? m.toStationId,
      range: range(m, tz),
    })),
    remaining: remaining.map((g) => ({
      station: station(g.stationId)?.name ?? g.stationId,
      range: range(g, tz),
      missing: g.missing,
    })),
    candidates: candidates.map((c) => ({
      crewId: c.crewId,
      name: c.name,
      station: c.stationName,
      range: range(c, tz),
      kind: c.kind,
      isOvertime: c.isOvertime,
      addedOtHours: c.addedOtHours,
      score: c.score,
      rationale: c.rationale,
    })),
    hasOvertime: candidates.some((c) => c.isOvertime),
    offers: co.offers.map((o) => ({
      id: o.id,
      rank: o.rank,
      crew: o.crew.firstName,
      station: o.station.name,
      range: range(o, tz),
      kind: o.kind,
      isOvertime: o.isOvertime,
      status: o.status,
      expiresAt: o.expiresAt?.toISOString() ?? null,
    })),
    timeline: co.auditEvents.map((e) => ({
      id: e.id,
      at: clock(e.at, tz),
      type: e.type,
      actor: e.actor.startsWith("crew:") ? name(e.actor.slice(5)) : e.actor,
      payload: e.payload as Record<string, unknown>,
    })),
    messages: co.messages.map((m) => ({
      id: m.id,
      at: clock(m.sentAt, tz),
      direction: m.direction,
      who:
        m.crew?.firstName ??
        (m.toPhone === store.managerPhone ? "Manager" : m.fromPhone),
      body: m.body,
    })),
  };
}

export async function getSimView() {
  const store = await db.store.findFirstOrThrow();
  const tz = store.timezone;
  const crew = await db.crew.findMany({
    where: { active: true },
    orderBy: { firstName: "asc" },
  });
  const messages = await db.message.findMany({ orderBy: { sentAt: "asc" } });
  const thread = (phone: string) =>
    messages
      .filter((m) => m.fromPhone === phone || m.toPhone === phone)
      .map((m) => ({
        id: m.id,
        at: clock(m.sentAt, tz),
        mine: m.fromPhone === phone,
        body: m.body,
      }));
  const phones = crew.map((c) => ({
    phone: c.phone,
    name: `${c.firstName} ${c.lastName}`,
    smsOptIn: c.smsOptIn,
    messages: thread(c.phone),
  }));
  return {
    manager: {
      phone: store.managerPhone,
      name: `${store.managerName} (manager)`,
      messages: thread(store.managerPhone),
    },
    // Phones with messages first, so the conversation in progress is easy to find.
    phones: phones.sort(
      (a, b) =>
        (b.messages.at(-1)?.id ? 1 : 0) - (a.messages.at(-1)?.id ? 1 : 0),
    ),
  };
}
