// Live check of the LLM layer: runs the four app-facing functions once against the
// provider in .env (LLM_PROVIDER=anthropic|vultr) with the demo data. A result that came
// from a fallback instead of the model counts as a failure. Costs a fraction of a cent.
//
//   pnpm llm:smoke
//   LLM_PROVIDER=vultr pnpm llm:smoke

import "dotenv/config";

import {
  classifyReply,
  composeOffer,
  getTransport,
  parseCallout,
  summarizePlan,
} from "../server/llm/index";
import { localWindow } from "../server/rules/time";

const TZ = "America/Edmonton";
const now = localWindow("2026-11-09", "04:40", "04:41", TZ).start;
const monday = localWindow("2026-11-09", "05:30", "14:00", TZ);
const beverage = localWindow("2026-11-09", "10:00", "14:00", TZ);
const rush = localWindow("2026-11-09", "05:30", "10:00", TZ);

const transport = await getTransport().catch((err: Error) => {
  console.error(`Couldn't set up the provider: ${err.message}`);
  process.exit(1);
});
const mode = (transport as { jsonMode?: string }).jsonMode;
console.log(
  `provider: ${transport.provider} | model: ${transport.model}${mode ? ` | json mode: ${mode}` : ""}`,
);

const options = { timeoutMs: 20_000 };
let failures = 0;
function show(
  name: string,
  r: {
    source: string;
    llm?: { ms: number; model?: string; error?: string; message?: string };
  },
  output: unknown,
) {
  const ok = r.source !== "fallback";
  if (!ok) failures++;
  const status = ok
    ? `OK (${r.source})`
    : `FAIL ${r.llm?.error}: ${r.llm?.message}`;
  console.log(
    `\n${name}: ${status} (${r.llm?.ms ?? 0}ms, ${r.llm?.model ?? "-"})`,
  );
  console.log(JSON.stringify(output, null, 2));
}

const parsed = await parseCallout(
  {
    message:
      "hey its kayla, woke up sick, not gonna make it in this morning sorry",
    crew: { id: "kayla", firstName: "Kayla" },
    now,
    timezone: TZ,
    shifts: [
      {
        id: "shift-mon",
        ...monday,
        stationNames: ["Drive-Thru Order Taker", "Beverage/Barista"],
      },
      {
        id: "shift-tue",
        ...localWindow("2026-11-10", "05:30", "14:00", TZ),
        stationNames: ["Drive-Thru Order Taker"],
      },
    ],
  },
  options,
);
show("parseCallout", parsed, {
  isCallout: parsed.isCallout,
  shiftId: parsed.shiftId,
  reason: parsed.reason,
  confidence: parsed.confidence,
});

const summary = await summarizePlan(
  {
    storeName: "Maple & Mug Coffee Co.",
    timezone: TZ,
    stationNames: {
      dtot: "Drive-Thru Order Taker",
      bev: "Beverage/Barista",
      lobby: "Lobby",
    },
    crewNames: {
      kayla: "Kayla",
      aisha: "Aisha",
      ben: "Ben",
      noah: "Noah",
      sofia: "Sofia",
    },
    callOut: { crewId: "kayla", shift: monday, reason: "sick" },
    gaps: [
      { stationId: "dtot", ...rush, required: 2, scheduled: 1, missing: 1 },
      { stationId: "bev", ...beverage, required: 1, scheduled: 0, missing: 1 },
    ],
    moves: [
      { crewId: "aisha", fromStationId: "lobby", toStationId: "dtot", ...rush },
    ],
    remaining: [
      { stationId: "bev", ...beverage, missing: 1 },
      { stationId: "lobby", ...rush, missing: 1 },
    ],
    candidates: [
      {
        crewId: "ben",
        stationId: "bev",
        window: beverage,
        kind: "CALL_IN",
        isOvertime: false,
        reasons: ["Certified on Beverage/Barista", "No overtime"],
      },
      {
        crewId: "noah",
        stationId: "bev",
        window: beverage,
        kind: "CALL_IN",
        isOvertime: false,
        reasons: ["Certified on Beverage/Barista", "Rested by 10:00"],
      },
      {
        crewId: "sofia",
        stationId: "bev",
        window: beverage,
        kind: "EXTEND",
        isOvertime: true,
        reasons: [
          "Trainer on Beverage/Barista",
          "Overtime: +1.5h; needs approval",
        ],
      },
    ],
  },
  options,
);
show("summarizePlan", summary, {
  summary: summary.summary,
  rationales: summary.rationales,
});

const offer = await composeOffer(
  {
    firstName: "Ben",
    storeName: "Maple & Mug Coffee Co.",
    stationName: "Beverage/Barista",
    window: beverage,
    timezone: TZ,
    now,
    kind: "CALL_IN",
    isOvertime: false,
    replyMinutes: 10,
  },
  options,
);
show("composeOffer", offer, { text: offer.text });

const reply = await classifyReply(
  {
    offerText: offer.text,
    reply: "ya i can but only until 1, got class after",
  },
  options,
);
show("classifyReply", reply, {
  intent: reply.intent,
  condition: reply.condition,
  question: reply.question,
});

console.log(
  `\n${failures === 0 ? "All 4 functions answered by the model" : `${failures} of 4 fell back`}`,
);
process.exit(failures === 0 ? 0 : 1);
