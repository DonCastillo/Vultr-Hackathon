import "server-only";

import { audit } from "@/server/audit";
import {
  dayRange,
  getCrew,
  getSchoolDays,
  getShifts,
  getStoreContext,
} from "@/server/data";
import { db } from "@/server/db";
import {
  classifyReply,
  composeOffer,
  offerWindowLabel,
  parseCallout,
  summarizePlan,
  type PlanFacts,
} from "@/server/llm";
import { rankCandidates } from "@/server/rank";
import { computeImpact } from "@/server/rules/coverage";
import { weekStartOf } from "@/server/rules/overtime";
import { addDays, formatRange, localDate } from "@/server/rules/time";
import { isWorkedShift } from "@/server/rules/types";
import { youthRules } from "@/server/rules/youth";
import { defaultBreak } from "@/server/schedule";
import { recordInbound, sendSms } from "@/server/sms";
import { rebalance } from "@/server/solver/rebalance";

// The call-out flow (phase 5). Rules decide, the LLM talks, the manager approves.
//   createCallOut -> planCallOut (impact, Plan A moves, Plan B candidates, LLM summary)
//   approveAndStartOutreach (apply moves, queue offers) -> sendNextOffer (one at a time)
//   handleInboundSms (accept / decline / clarify, or a new call-out) and expireOffers.
// CallOut: OPEN -> PLANNED -> OUTREACH -> COVERED | UNFILLED.
// Offer:   PENDING -> SENT -> ACCEPTED | DECLINED | EXPIRED | CANCELLED (CLARIFYING loops).

export class OutreachError extends Error {}

const LIVE = ["SENT", "CLARIFYING"] as const;

export interface PlanCandidate {
  crewId: string;
  name: string;
  stationId: string;
  stationName: string;
  start: string;
  end: string;
  kind: "CALL_IN" | "EXTEND";
  score: number;
  isOvertime: boolean;
  addedOtHours: number;
  reasons: string[];
  rationale: string;
}

const iso = (d: Date) => d.toISOString();
const gapKey = (g: {
  stationId: string;
  start: Date | string;
  end: Date | string;
}) =>
  `${g.stationId}|${new Date(g.start).toISOString()}|${new Date(g.end).toISOString()}`;

/** Everything the rules need around one store day. */
async function loadDay(date: string) {
  const ctx = await getStoreContext();
  const tz = ctx.timezone;
  const week = weekStartOf(date);
  const [crew, { shifts, assignments }, schoolDays] = await Promise.all([
    getCrew({ includeInactive: true }),
    getShifts(dayRange(addDays(week, -1), addDays(week, 7), tz)),
    getSchoolDays(addDays(week, -7), addDays(week, 13)),
  ]);
  return { ctx, crew, shifts, assignments, schoolDays };
}

// ---------------------------------------------------------------------------------
// Create + plan
// ---------------------------------------------------------------------------------

export async function createCallOut(input: {
  shiftId: string;
  source: "SMS" | "MANAGER";
  rawText?: string | null;
  reason?: string | null;
  parseConfidence?: number | null;
}): Promise<string> {
  const existing = await db.callOut.findFirst({
    where: { shiftId: input.shiftId, status: { notIn: ["CANCELLED"] } },
  });
  if (existing) return existing.id;

  const callOutId = await db.$transaction(async (tx) => {
    const shift = await tx.shift.findUniqueOrThrow({
      where: { id: input.shiftId },
      include: { crew: true },
    });
    if (shift.status !== "SCHEDULED")
      throw new OutreachError("Only a scheduled shift can be called out.");
    await tx.shift.update({
      where: { id: shift.id },
      data: { status: "CALLED_OUT" },
    });
    const co = await tx.callOut.create({
      data: {
        shiftId: shift.id,
        crewId: shift.crewId,
        source: input.source,
        rawText: input.rawText ?? null,
        reason: input.reason ?? null,
        parseConfidence: input.parseConfidence ?? null,
      },
    });
    await audit(
      {
        callOutId: co.id,
        type: "callout.created",
        actor: input.source === "SMS" ? `crew:${shift.crewId}` : "manager",
        payload: {
          shiftId: shift.id,
          crew: shift.crew.firstName,
          source: input.source,
          reason: input.reason ?? null,
        },
      },
      tx,
    );
    return co.id;
  });
  await planCallOut(callOutId);
  return callOutId;
}

export async function planCallOut(callOutId: string) {
  const co = await db.callOut.findUniqueOrThrow({
    where: { id: callOutId },
    include: { shift: true, crew: true },
  });
  const date = localDate(co.shift.start, (await getStoreContext()).timezone);
  const { ctx, crew, shifts, assignments, schoolDays } = await loadDay(date);
  const tz = ctx.timezone;

  // Baseline: the day as scheduled (the called-out shift counts until it's removed).
  const baseline = assignments.filter((a) => {
    const s = shifts.find((x) => x.id === a.shiftId);
    return s && (isWorkedShift(s) || s.id === co.shiftId);
  });
  const coverage = {
    date,
    timezone: tz,
    stations: ctx.stations,
    rules: ctx.coverageRules,
    assignments: baseline,
    openTime: ctx.openTime,
    closeTime: ctx.closeTime,
  };
  const impact = computeImpact(coverage, [co.shiftId]);
  await audit({
    callOutId,
    type: "impact.computed",
    actor: "agent",
    payload: {
      gaps: impact.shortfalls.map((g) => ({
        station: g.stationId,
        range: formatRange(g, tz),
        missing: g.missing,
      })),
    },
  });

  const planA = rebalance({
    coverage,
    removedShiftIds: [co.shiftId],
    crew,
    rushWindows: ctx.rushWindows,
    youthUnderAge: ctx.config.youthUnderAge,
  });

  const stationName = (id: string) =>
    ctx.stations.find((s) => s.id === id)?.name ?? id;
  const crewName = (id: string) =>
    crew.find((c) => c.id === id)?.firstName ?? id;
  const rules = {
    timezone: tz,
    minRestHours: ctx.config.minRestHours,
    maxConsecutiveDays: ctx.config.maxConsecutiveDays,
    overtime: {
      method: ctx.preset.overtimeMethod,
      dailyOtHours: ctx.config.dailyOtHours,
      weeklyOtHours: ctx.config.weeklyOtHours,
    },
    youth: youthRules(ctx.preset, ctx.config),
    rushWindows: ctx.rushWindows,
  };
  const working = shifts.filter((s) => s.id !== co.shiftId);
  const workingBlocks = baseline.filter((a) => a.shiftId !== co.shiftId);

  const candidates: PlanCandidate[] = [];
  const seen = new Set<string>();
  for (const gap of planA.remainingShortfall) {
    const ranked = rankCandidates({
      stationId: gap.stationId,
      window: gap,
      stations: ctx.stations,
      crew: crew.filter((c) => c.active),
      shifts: working,
      assignments: workingBlocks,
      schoolDays,
      rules,
      excludeCrewIds: [co.crewId],
    });
    for (const c of ranked.candidates) {
      if (seen.has(c.crewId)) continue; // one offer per person per call-out
      seen.add(c.crewId);
      candidates.push({
        crewId: c.crewId,
        name: crewName(c.crewId),
        stationId: gap.stationId,
        stationName: stationName(gap.stationId),
        start: iso(gap.start),
        end: iso(gap.end),
        kind: c.kind,
        score: c.score,
        isOvertime: c.isOvertime,
        addedOtHours: c.addedOtHours,
        reasons: c.reasons,
        rationale: c.reasons.join("; "),
      });
    }
  }

  const facts: PlanFacts = {
    storeName: ctx.storeName,
    timezone: tz,
    stationNames: Object.fromEntries(ctx.stations.map((s) => [s.id, s.name])),
    crewNames: Object.fromEntries(crew.map((c) => [c.id, c.firstName])),
    callOut: { crewId: co.crewId, shift: co.shift, reason: co.reason },
    gaps: impact.shortfalls,
    moves: planA.moves,
    remaining: planA.remainingShortfall,
    candidates: candidates.map((c) => ({
      crewId: c.crewId,
      stationId: c.stationId,
      window: { start: new Date(c.start), end: new Date(c.end) },
      kind: c.kind,
      isOvertime: c.isOvertime,
      reasons: c.reasons,
    })),
  };
  const summary = await summarizePlan(facts);
  candidates.forEach(
    (c, i) => (c.rationale = summary.rationales[i] ?? c.rationale),
  );

  await db.$transaction(async (tx) => {
    await tx.recoveryPlan.upsert({
      where: { callOutId },
      create: {
        callOutId,
        shortfall: impact.shortfalls.map((g) => ({
          ...g,
          start: iso(g.start),
          end: iso(g.end),
        })),
        moves: planA.moves.map((m) => ({
          ...m,
          start: iso(m.start),
          end: iso(m.end),
        })),
        remainingShortfall: planA.remainingShortfall.map((g) => ({
          ...g,
          start: iso(g.start),
          end: iso(g.end),
        })),
        candidates: candidates as unknown as object[],
        summary: summary.summary,
        llmProvider: summary.llm.provider ?? null,
        llmModel: summary.llm.model ?? null,
      },
      update: {},
    });
    await tx.callOut.update({
      where: { id: callOutId },
      data: { status: "PLANNED" },
    });
    await audit(
      {
        callOutId,
        type: "plan.created",
        actor: "agent",
        payload: {
          moves: planA.moves.map(
            (m) =>
              `${crewName(m.crewId)}: ${stationName(m.fromStationId)} -> ${stationName(m.toStationId)} ${formatRange(m, tz)}`,
          ),
          remaining: planA.remainingShortfall.map(
            (g) => `${stationName(g.stationId)} ${formatRange(g, tz)}`,
          ),
          candidates: candidates.map(
            (c) =>
              `${c.name} (${c.kind}${c.isOvertime ? ", OT" : ""}) for ${c.stationName}`,
          ),
          summarySource: summary.source,
          llm: summary.llm,
        },
      },
      tx,
    );
  });
}

// ---------------------------------------------------------------------------------
// Approve: apply moves + queue offers
// ---------------------------------------------------------------------------------

export async function approveAndStartOutreach(
  callOutId: string,
  otApproved: boolean,
) {
  const co = await db.callOut.findUniqueOrThrow({
    where: { id: callOutId },
    include: { plan: true },
  });
  if (co.status !== "PLANNED" || !co.plan)
    throw new OutreachError("This call-out isn't waiting for approval.");
  const store = await db.store.findFirstOrThrow();
  const moves = co.plan.moves as unknown as {
    crewId: string;
    shiftId: string;
    fromStationId: string;
    toStationId: string;
    start: string;
    end: string;
  }[];
  const candidates = co.plan.candidates as unknown as PlanCandidate[];

  await db.$transaction(async (tx) => {
    for (const m of moves) {
      const start = new Date(m.start);
      const end = new Date(m.end);
      const block = await tx.stationAssignment.findFirst({
        where: {
          shiftId: m.shiftId,
          stationId: m.fromStationId,
          start: { lte: start },
          end: { gte: end },
        },
      });
      if (!block)
        throw new OutreachError(
          "The schedule changed since the plan was made; re-plan the call-out.",
        );
      await tx.stationAssignment.delete({ where: { id: block.id } });
      const pieces = [
        block.start < start && {
          stationId: block.stationId,
          start: block.start,
          end: start,
          source: block.source,
        },
        { stationId: m.toStationId, start, end, source: "rebalance" },
        end < block.end && {
          stationId: block.stationId,
          start: end,
          end: block.end,
          source: block.source,
        },
      ].filter(Boolean) as {
        stationId: string;
        start: Date;
        end: Date;
        source: string;
      }[];
      await tx.stationAssignment.createMany({
        data: pieces.map((p) => ({ ...p, shiftId: m.shiftId })),
      });
    }
    await tx.recoveryPlan.update({
      where: { callOutId },
      data: { appliedAt: new Date() },
    });
    const offers = candidates.filter((c) => otApproved || !c.isOvertime);
    let rank = 0;
    for (const c of offers) {
      await tx.offer.create({
        data: {
          callOutId,
          crewId: c.crewId,
          stationId: c.stationId,
          kind: c.kind,
          start: new Date(c.start),
          end: new Date(c.end),
          rank: ++rank,
          score: c.score,
          isOvertime: c.isOvertime,
          rationale: c.rationale,
        },
      });
    }
    await tx.callOut.update({
      where: { id: callOutId },
      data: { status: "OUTREACH", approvedAt: new Date(), otApproved },
    });
    await audit(
      {
        callOutId,
        type: "plan.approved",
        actor: "manager",
        payload: {
          otApproved,
          moves: moves.length,
          offersQueued: offers.length,
        },
      },
      tx,
    );
  });

  // Tell moved crew (never texts people who opted out).
  for (const m of moves) {
    const person = await db.crew.findUnique({ where: { id: m.crewId } });
    const to = await db.station.findUnique({ where: { id: m.toStationId } });
    if (!person || !to) continue;
    const range = offerWindowLabel(
      { start: new Date(m.start), end: new Date(m.end) },
      new Date(),
      store.timezone,
    );
    if (person.smsOptIn) {
      await sendSms({
        to: person.phone,
        crewId: person.id,
        callOutId,
        body: `Heads up ${person.firstName}: you're on ${to.name} ${range} to cover a call-out. Thanks!`,
      });
    }
    await audit({
      callOutId,
      type: "moves.applied",
      actor: "agent",
      payload: {
        crew: person.firstName,
        to: to.name,
        range,
        notified: person.smsOptIn,
      },
    });
  }
  await sendNextOffer(callOutId);
}

// ---------------------------------------------------------------------------------
// Offers
// ---------------------------------------------------------------------------------

export async function sendNextOffer(callOutId: string) {
  const co = await db.callOut.findUniqueOrThrow({
    where: { id: callOutId },
    include: { plan: true },
  });
  if (co.status !== "OUTREACH") return;
  if (await db.offer.count({ where: { callOutId, status: { in: [...LIVE] } } }))
    return;

  const covered = new Set(
    (await db.offer.findMany({ where: { callOutId, status: "ACCEPTED" } })).map(
      (o) => gapKey(o),
    ),
  );
  const next = await db.offer.findFirst({
    where: { callOutId, status: "PENDING" },
    orderBy: { rank: "asc" },
    include: { crew: true, station: true },
  });

  if (!next || covered.has(gapKey(next))) {
    if (next) {
      // Gap already filled by someone else: cancel and move on.
      await db.offer.update({
        where: { id: next.id },
        data: { status: "CANCELLED" },
      });
      return sendNextOffer(callOutId);
    }
    return finish(callOutId);
  }

  const store = await db.store.findFirstOrThrow({
    include: { ruleConfig: true },
  });
  const timeoutSec = store.ruleConfig?.demoMode
    ? 120
    : (store.ruleConfig?.offerTimeoutSec ?? 600);
  const composed = await composeOffer({
    firstName: next.crew.firstName,
    storeName: store.name,
    stationName: next.station.name,
    window: { start: next.start, end: next.end },
    timezone: store.timezone,
    now: new Date(),
    kind: next.kind,
    isOvertime: next.isOvertime,
    replyMinutes: Math.ceil(timeoutSec / 60),
  });
  const sentAt = new Date();
  try {
    await db.offer.update({
      where: { id: next.id },
      data: {
        status: "SENT",
        sentAt,
        expiresAt: new Date(sentAt.getTime() + timeoutSec * 1000),
      },
    });
  } catch {
    return; // another process already sent an offer (one_live_offer index)
  }
  await sendSms({
    to: next.crew.phone,
    body: composed.text,
    crewId: next.crewId,
    callOutId,
    offerId: next.id,
  });
  await audit({
    callOutId,
    type: "offer.sent",
    actor: "agent",
    payload: {
      to: next.crew.firstName,
      rank: next.rank,
      text: composed.text,
      source: composed.source,
      llm: composed.llm,
      timeoutSec,
    },
  });
}

/** Ends outreach: COVERED when every gap that had candidates got an acceptance. */
async function finish(callOutId: string) {
  const co = await db.callOut.findUniqueOrThrow({
    where: { id: callOutId },
    include: { plan: true, crew: true },
  });
  if (co.status !== "OUTREACH") return;
  const store = await db.store.findFirstOrThrow();
  const offers = await db.offer.findMany({
    where: { callOutId },
    include: { crew: true, station: true },
  });
  const gapsWithCandidates = new Set(offers.map((o) => gapKey(o)));
  const accepted = offers.filter((o) => o.status === "ACCEPTED");
  const coveredGaps = new Set(accepted.map((o) => gapKey(o)));
  const allCovered =
    gapsWithCandidates.size > 0 &&
    [...gapsWithCandidates].every((k) => coveredGaps.has(k));
  const status = allCovered ? "COVERED" : "UNFILLED";
  await db.callOut.update({
    where: { id: callOutId },
    data: {
      status,
      coveredAt: allCovered ? new Date() : null,
      coveredById: accepted[0]?.crewId ?? null,
    },
  });
  const who = accepted
    .map(
      (o) =>
        `${o.crew.firstName} (${o.station.name} ${formatRange(o, store.timezone).slice(4)})`,
    )
    .join(", ");
  const body = allCovered
    ? `Covered: ${co.crew.firstName}'s call-out is filled by ${who}.`
    : `Not fully covered: ${co.crew.firstName}'s call-out still has open gaps${who ? ` (filled so far: ${who})` : ""}. Please check the call-out page.`;
  await sendSms({ to: store.managerPhone, body, callOutId });
  await audit({
    callOutId,
    type: allCovered ? "shift.covered" : "callout.unfilled",
    actor: "agent",
    payload: { accepted: who },
  });
}

/** Marks offers past their deadline EXPIRED and moves on (the worker runs this every 5s). */
export async function expireOffers(now = new Date()) {
  const stale = await db.offer.findMany({
    where: { status: { in: [...LIVE] }, expiresAt: { lt: now } },
    include: { crew: true },
  });
  for (const o of stale) {
    const r = await db.offer.updateMany({
      where: { id: o.id, status: { in: [...LIVE] } },
      data: { status: "EXPIRED" },
    });
    if (r.count === 0) continue;
    await audit({
      callOutId: o.callOutId,
      type: "offer.expired",
      actor: "worker",
      payload: { crew: o.crew.firstName },
    });
    await sendNextOffer(o.callOutId);
  }
  return stale.length;
}

// ---------------------------------------------------------------------------------
// Inbound texts
// ---------------------------------------------------------------------------------

export async function handleInboundSms(from: string, body: string) {
  const crew = await db.crew.findUnique({ where: { phone: from } });
  if (!crew) {
    await recordInbound({ from, body });
    return;
  }
  const store = await db.store.findFirstOrThrow();
  const live = await db.offer.findFirst({
    where: { crewId: crew.id, status: { in: [...LIVE] } },
    include: { station: true },
  });

  if (live) {
    await recordInbound({
      from,
      body,
      crewId: crew.id,
      callOutId: live.callOutId,
      offerId: live.id,
    });
    const lastOffer = await db.message.findFirst({
      where: { offerId: live.id, direction: "OUTBOUND" },
      orderBy: { sentAt: "asc" },
    });
    const reply = await classifyReply({
      offerText: lastOffer?.body ?? "",
      reply: body,
    });
    await audit({
      callOutId: live.callOutId,
      type: "reply.classified",
      actor: `crew:${crew.id}`,
      payload: {
        crew: crew.firstName,
        text: body,
        intent: reply.intent,
        confidence: reply.confidence,
        source: reply.source,
      },
    });
    if (reply.intent === "ACCEPT") return acceptOffer(live.id);
    if (reply.intent === "DECLINE") {
      await db.offer.update({
        where: { id: live.id },
        data: {
          status: "DECLINED",
          respondedAt: new Date(),
          replyIntent: "DECLINE",
        },
      });
      await sendSms({
        to: crew.phone,
        crewId: crew.id,
        callOutId: live.callOutId,
        body: `No problem, thanks for letting us know ${crew.firstName}.`,
      });
      await audit({
        callOutId: live.callOutId,
        type: "offer.declined",
        actor: `crew:${crew.id}`,
        payload: { crew: crew.firstName },
      });
      return sendNextOffer(live.callOutId);
    }
    // Question, condition or unclear: ask again; the reply timer keeps running.
    await db.offer.update({
      where: { id: live.id },
      data: { status: "CLARIFYING", replyIntent: reply.intent },
    });
    const range = formatRange(live, store.timezone).slice(4);
    const text =
      reply.intent === "CONDITIONAL"
        ? `Thanks ${crew.firstName}! We need the full ${range} on ${live.station.name}. Reply YES if you can do all of it, or NO.`
        : `Thanks ${crew.firstName}! For details call the store at ${store.phone}. Can you take ${live.station.name} ${range}? Reply YES or NO.`;
    await sendSms({
      to: crew.phone,
      crewId: crew.id,
      callOutId: live.callOutId,
      offerId: live.id,
      body: text,
    });
    return;
  }

  // A "yes" to an offer that's no longer open.
  const recent = await db.offer.findFirst({
    where: {
      crewId: crew.id,
      status: { in: ["EXPIRED", "CANCELLED"] },
      sentAt: { gte: new Date(Date.now() - 6 * 3_600_000) },
    },
    orderBy: { sentAt: "desc" },
  });
  if (recent && /\b(y|yes|yeah|yep|sure|ok|okay)\b/i.test(body)) {
    await recordInbound({
      from,
      body,
      crewId: crew.id,
      callOutId: recent.callOutId,
      offerId: recent.id,
    });
    await sendSms({
      to: crew.phone,
      crewId: crew.id,
      callOutId: recent.callOutId,
      body: `Thanks ${crew.firstName}! That shift is already covered, no need to come in.`,
    });
    await audit({
      callOutId: recent.callOutId,
      type: "reply.late",
      actor: `crew:${crew.id}`,
      payload: { crew: crew.firstName, text: body },
    });
    return;
  }

  // Otherwise: is it a call-out?
  await recordInbound({ from, body, crewId: crew.id });
  const now = new Date();
  const upcoming = await db.shift.findMany({
    where: {
      crewId: crew.id,
      status: "SCHEDULED",
      end: { gt: now },
      start: { lt: new Date(now.getTime() + 48 * 3_600_000) },
    },
    include: {
      assignments: { include: { station: true }, orderBy: { start: "asc" } },
    },
    orderBy: { start: "asc" },
  });
  const parsed = await parseCallout({
    message: body,
    crew: { id: crew.id, firstName: crew.firstName },
    now,
    timezone: store.timezone,
    shifts: upcoming.map((s) => ({
      id: s.id,
      start: s.start,
      end: s.end,
      stationNames: s.assignments.map((a) => a.station.name),
    })),
  });
  if (!parsed.isCallout || !parsed.shiftId) {
    await sendSms({
      to: crew.phone,
      crewId: crew.id,
      body: parsed.isCallout
        ? `Thanks ${crew.firstName}. Which shift do you mean? We've let the manager know.`
        : `Thanks ${crew.firstName}, message received.`,
    });
    return;
  }
  const callOutId = await createCallOut({
    shiftId: parsed.shiftId,
    source: "SMS",
    rawText: body,
    reason: parsed.reason,
    parseConfidence: parsed.confidence,
  });
  await audit({
    callOutId,
    type: "callout.parsed",
    actor: "agent",
    payload: {
      text: body,
      reason: parsed.reason,
      confidence: parsed.confidence,
      source: parsed.source,
      llm: parsed.llm,
    },
  });
  await db.message.updateMany({
    where: { crewId: crew.id, callOutId: null, direction: "INBOUND", body },
    data: { callOutId },
  });
  await sendSms({
    to: crew.phone,
    crewId: crew.id,
    callOutId,
    body: `Thanks ${crew.firstName}, feel better. We'll take care of your shift.`,
  });
  await sendSms({
    to: store.managerPhone,
    callOutId,
    body: `${crew.firstName} called out${parsed.reason ? ` (${parsed.reason})` : ""}. A recovery plan is ready for your approval.`,
  });
}

/**
 * Accept: one transaction that locks the CallOut row, so only the first "yes" wins.
 * Creates the call-in shift (or extends the adjacent one) with its station block.
 */
export async function acceptOffer(offerId: string) {
  const result = await db.$transaction(async (tx) => {
    const offer = await tx.offer.findUniqueOrThrow({
      where: { id: offerId },
      include: { crew: true, station: true },
    });
    await tx.$queryRaw`SELECT id FROM "CallOut" WHERE id = ${offer.callOutId} FOR UPDATE`;
    const co = await tx.callOut.findUniqueOrThrow({
      where: { id: offer.callOutId },
    });
    const live = offer.status === "SENT" || offer.status === "CLARIFYING";
    const taken = await tx.offer.count({
      where: {
        callOutId: offer.callOutId,
        status: "ACCEPTED",
        stationId: offer.stationId,
        start: offer.start,
        end: offer.end,
      },
    });
    if (co.status !== "OUTREACH" || !live || taken > 0)
      return { offer, won: false };

    const store = await tx.store.findFirstOrThrow({ select: { id: true } });
    if (offer.kind === "EXTEND") {
      const adjacent = await tx.shift.findFirst({
        where: {
          crewId: offer.crewId,
          status: "SCHEDULED",
          OR: [{ end: offer.start }, { start: offer.end }],
        },
      });
      if (adjacent) {
        await tx.shift.update({
          where: { id: adjacent.id },
          data:
            adjacent.end.getTime() === offer.start.getTime()
              ? { end: offer.end }
              : { start: offer.start },
        });
        await tx.stationAssignment.create({
          data: {
            shiftId: adjacent.id,
            stationId: offer.stationId,
            start: offer.start,
            end: offer.end,
            source: "extend",
          },
        });
      }
    } else {
      const minutes = (offer.end.getTime() - offer.start.getTime()) / 60_000;
      await tx.shift.create({
        data: {
          storeId: store.id,
          crewId: offer.crewId,
          start: offer.start,
          end: offer.end,
          breakMinutes: defaultBreak(minutes),
          notes: "Called in to cover a call-out",
          assignments: {
            create: [
              {
                stationId: offer.stationId,
                start: offer.start,
                end: offer.end,
                source: "callin",
              },
            ],
          },
        },
      });
    }
    await tx.offer.update({
      where: { id: offer.id },
      data: {
        status: "ACCEPTED",
        respondedAt: new Date(),
        replyIntent: "ACCEPT",
      },
    });
    await audit(
      {
        callOutId: offer.callOutId,
        type: "offer.accepted",
        actor: `crew:${offer.crewId}`,
        payload: {
          crew: offer.crew.firstName,
          kind: offer.kind,
          station: offer.station.name,
        },
      },
      tx,
    );
    return { offer, won: true };
  });

  const { offer, won } = result;
  const store = await db.store.findFirstOrThrow();
  const range = offerWindowLabel(offer, new Date(), store.timezone);
  await sendSms({
    to: offer.crew.phone,
    crewId: offer.crewId,
    callOutId: offer.callOutId,
    offerId: offer.id,
    body: won
      ? `Confirmed! You're on ${offer.station.name} ${range}. Thank you ${offer.crew.firstName}!`
      : `Thanks ${offer.crew.firstName}! That shift is already covered, no need to come in.`,
  });
  if (won) await sendNextOffer(offer.callOutId);
}
