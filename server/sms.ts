import "server-only";

import { humanizeTimes } from "@/lib/time-format";
import { db } from "@/server/db";

// SMS provider (task 5.1). The demo uses the in-app simulator: every text is a Message
// row the /sim phone grid reads. Twilio is a cut-line item; it would plug in here.

export const STORE_LINE = "+14035550100"; // the store's texting number (seeded Store.phone)

export async function sendSms(input: {
  to: string;
  body: string;
  crewId?: string | null;
  callOutId?: string | null;
  offerId?: string | null;
}) {
  return db.message.create({
    data: {
      direction: "OUTBOUND",
      fromPhone: STORE_LINE,
      toPhone: input.to,
      // Crew read 12-hour times; logic and the LLM stay on 24-hour "HH:MM".
      body: humanizeTimes(input.body),
      provider: "SIM",
      crewId: input.crewId ?? null,
      callOutId: input.callOutId ?? null,
      offerId: input.offerId ?? null,
    },
  });
}

export async function recordInbound(input: {
  from: string;
  body: string;
  crewId?: string | null;
  callOutId?: string | null;
  offerId?: string | null;
}) {
  return db.message.create({
    data: {
      direction: "INBOUND",
      fromPhone: input.from,
      toPhone: STORE_LINE,
      body: input.body,
      provider: "SIM",
      crewId: input.crewId ?? null,
      callOutId: input.callOutId ?? null,
      offerId: input.offerId ?? null,
    },
  });
}
