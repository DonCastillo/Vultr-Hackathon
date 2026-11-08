import "server-only";

import { db } from "@/server/db";
import type { Prisma } from "@/server/generated/prisma/client";

// Audit everything (CLAUDE.md): every rule result, LLM call, message and decision is an
// AuditEvent, shown as the call-out timeline.

export async function audit(
  event: {
    callOutId?: string | null;
    type: string;
    actor: string;
    payload: Prisma.InputJsonValue;
  },
  tx: Prisma.TransactionClient = db,
) {
  await tx.auditEvent.create({
    data: {
      callOutId: event.callOutId ?? null,
      type: event.type,
      actor: event.actor,
      payload: event.payload,
    },
  });
}
