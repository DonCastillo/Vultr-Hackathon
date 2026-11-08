// Live check of the LLM layer: runs the four tasks once against the provider in .env
// (LLM_PROVIDER=anthropic|vultr) with the demo data. Costs a fraction of a cent.
//
//   pnpm llm:smoke
//   LLM_PROVIDER=vultr pnpm llm:smoke

import "dotenv/config";

import {
  CLASSIFY_REPLY,
  COMPOSE_OFFER,
  getTransport,
  PARSE_CALLOUT,
  runTask,
  SUMMARIZE_PLAN,
  type TaskResult,
} from "../server/llm/index";

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
function show(name: string, r: TaskResult<unknown>) {
  if (!r.ok) failures++;
  console.log(
    `\n${name}: ${r.ok ? "OK" : `FAIL ${r.error}: ${r.message}`} (${r.ms}ms, ${r.model ?? "?"})`,
  );
  console.log(r.ok ? JSON.stringify(r.data, null, 2) : (r.raw ?? ""));
}

show(
  "parseCallout",
  await runTask(
    PARSE_CALLOUT,
    {
      message:
        "hey its kayla, woke up sick, not gonna make it in this morning sorry",
      crewFirstName: "Kayla",
      now: "Mon Nov 9, 04:40",
      shifts: [
        {
          id: "shift-a",
          label: "Mon Nov 9 05:30-14:00, Drive-Thru headset then Beverage",
        },
        { id: "shift-b", label: "Tue Nov 10 05:30-14:00, Drive-Thru headset" },
      ],
    },
    options,
  ),
);

show(
  "summarizePlan",
  await runTask(
    SUMMARIZE_PLAN,
    {
      storeName: "Maple & Mug Coffee Co.",
      callOut: "Kayla, Mon 05:30-14:00 (sick)",
      gaps: [
        "Drive-Thru Order Taker Mon 05:30-10:00: 1 of 2 scheduled",
        "Beverage/Barista Mon 10:00-14:00: 0 of 1 scheduled",
      ],
      moves: ["Aisha: Lobby -> Drive-Thru Order Taker Mon 05:30-10:00"],
      remaining: [
        "Beverage/Barista Mon 10:00-14:00",
        "Lobby Mon 05:30-10:00 (no legal fill)",
      ],
      candidates: [
        {
          crewId: "ben",
          name: "Ben",
          kind: "CALL_IN",
          isOvertime: false,
          reasons: ["Certified on Beverage/Barista", "No overtime"],
        },
        {
          crewId: "noah",
          name: "Noah",
          kind: "CALL_IN",
          isOvertime: false,
          reasons: ["Certified on Beverage/Barista", "Rested by 10:00"],
        },
        {
          crewId: "sofia",
          name: "Sofia",
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
  ),
);

show(
  "composeOffer",
  await runTask(
    COMPOSE_OFFER,
    {
      firstName: "Ben",
      storeName: "Maple & Mug Coffee Co.",
      stationName: "Beverage/Barista",
      windowLabel: "today 10:00-14:00",
      kind: "CALL_IN",
      isOvertime: false,
      replyMinutes: 10,
    },
    options,
  ),
);

show(
  "classifyReply",
  await runTask(
    CLASSIFY_REPLY,
    {
      offerText:
        "Hi Ben, can you cover Beverage/Barista today 10:00-14:00? Reply YES or NO within 10 min.",
      reply: "ya i can but only until 1, got class after",
    },
    options,
  ),
);

console.log(
  `\n${failures === 0 ? "All 4 tasks OK" : `${failures} of 4 tasks failed`}`,
);
process.exit(failures === 0 ? 0 : 1);
