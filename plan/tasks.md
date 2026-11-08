# CrewShift: Task Checklist

Deadline: **Nov 8, 2026, 5:00 PM MDT**. See [plan.md](plan.md) for the full design.

Legend: **(you)** = account step only you can do · **✂️ cut-line** = drop first if behind schedule · times are estimates.

| Phase | Est. | Running total |
|---|---|---|
| P. Prerequisites (you) | 0.75h | 0.75h |
| 1. Scaffold & data | 2.5h | 3.25h |
| 2. Rules engine & solver | 4.5h | 7.75h |
| 3. LLM (Claude + Vultr Inference) | 2.25h | 10h |
| 4. Manager UI | 5.5h | 15.5h |
| 5. Call-out flow & outreach | 4.75h | 20.25h |
| 6. Deploy to Vultr | 1.75h | 22h |
| 7. Polish & README | 2h | 24h |
| 8. Submission assets | 3h | 27h |
| Buffer | ~3h | ~30h |

Cut-line tasks (not counted in the totals above) add up to about 2.5h, which can be dropped to grow the buffer.

---

## P. Prerequisites (you) | 0.75h
- [x] P.1 **(you)** Create a Vultr account with an email never used on Vultr, and verify it (10m)
- [ ] P.2 **(you)** Billing → Promotions → apply the hackathon gift code; confirm $200.00 credit (5m) ⏳ **Blocked (Nov 7):** the event ran out of codes; organizers say they will replenish them. Fallback: add a payment method to start, since VM costs are hourly and small.
- [ ] P.3 **(you)** Enable Serverless Inference, create an API key, and put it in `.env` as `VULTR_INFERENCE_API_KEY` (10m) ⏳ blocked on credits
- [x] P.4 **(you)** Create an Anthropic API key and put it in `.env` as `ANTHROPIC_API_KEY` with `LLM_PROVIDER=anthropic` (10m)
- [ ] P.5 **(you)** Add an SSH key in the Vultr console (5m)
- [ ] P.6 **(you)** Deploy a Cloud Compute VM: Ubuntu 24.04, 2 vCPU / 4 GB (can wait until Phase 6) (10m)
- [ ] P.7 **(you)** ✂️ Twilio trial account, verify your phone, buy a number (15m)

## 1. Scaffold & data | 2.5h
- [x] 1.1 Next.js 15 + TypeScript + Tailwind + shadcn/ui init; ESLint/Prettier (20m)
- [x] 1.2 `docker-compose.yml` with Postgres 16; `.env.example` (15m)
- [x] 1.3 Prisma schema: Store, Station, Crew, CrewStation, Cert, Availability, SchoolDay, TimeOff, Shift, StationAssignment, CoverageRule, CallOut, RecoveryPlan, Offer, Message, AuditEvent, RuleConfig (40m)
- [x] 1.4 `prisma/seed.ts`: standalone Maple & Mug store (Calgary, Alberta), 9 stations, dayparts, coverage template (20m)
- [x] 1.5 Seed ~20 crew (students/minors, trainees, overnight baker, supervisors, certs incl. one expired) (25m)
- [x] 1.6 Seed a full week of shifts + station assignments, including the demo scenario (5:30am headset crew) (30m)

## 2. Rules engine & solver | 4.5h
- [x] 2.1 `server/rules/presets.ts`: Alberta (8h/day or 44h/week, 8h rest, under-15 youth limits), Ontario (44h, 11h rest), BC (8h/day + 40h/week), US FLSA (+ youth limits) (20m)
- [x] 2.2 `server/rules/eligibility.ts`: training level, availability, PTO, overlap, rest gap/clopen, cert expiry (45m)
- [x] 2.3 `server/rules/overtime.ts`: weekly/daily OT under each preset (20m)
- [x] 2.4 `server/rules/youth.ts`: school-day hours, latest end time, restricted stations (20m)
- [x] 2.5 `server/rules/coverage.ts`: required vs. scheduled per station per 15-min slot; shortfalls; supervisor rule (40m)
- [x] 2.6 `server/solver/rebalance.ts`: greedy + backtracking station reassignment by priority (50m)
- [x] 2.7 `server/rank.ts`: replacement scoring (no-OT, fairness, reliability, seniority) + shift-extension candidates (30m)
- [x] 2.8 vitest suite for all of the above (edge cases from the plan's Verification section) (45m)

## 3. LLM: Anthropic Claude + Vultr Serverless Inference | 2.25h
- [x] 3.1 `server/llm/index.ts`: provider-agnostic interface, `LLM_PROVIDER` switch, shared prompts + zod schemas (20m)
- [x] 3.2 `server/llm/anthropic.ts`: `@anthropic-ai/sdk` adapter, default `claude-haiku-5-5` (15m)
- [x] 3.3 `server/llm/vultr.ts`: `openai` SDK adapter with `baseURL=https://api.vultrinference.com/v1`; list models and choose a default (wire it up when the key arrives) (15m)
- [x] 3.4 `parseCallout`: free-text SMS → `{crewId, shiftId, reason}` with zod validation (25m)
- [x] 3.5 `summarizePlan` + per-candidate rationale (25m)
- [ ] 3.6 `composeOffer`: personalized offer text (15m)
- [ ] 3.7 `classifyReply`: accept / decline / conditional / question (20m)
- [ ] 3.8 Keyword/regex fallbacks + timeout handling when the LLM is slow or returns bad JSON (15m)

## 4. Manager UI | 5.5h
- [ ] 4.1 App shell: nav, mobile-friendly layout, Maple & Mug theming (30m)
- [ ] 4.2 Crew roster page: stations, levels, certs, availability, student flag (40m)
- [ ] 4.3 Week view: crew × day grid with station-colored shift bars (60m)
- [ ] 4.4 Week view: drag to create/move/resize shifts (dnd-kit) + server actions (60m)
- [ ] 4.5 Shift editor: split a shift into station blocks (30m)
- [ ] 4.6 Live validation badges (OT, untrained, youth, clopen, unavailable, cert expired) (30m)
- [ ] 4.7 **Day station board:** timeline by station + coverage heatmap vs. template (60m)
- [ ] 4.8 Settings page: jurisdiction preset, OT threshold, rest hours, offer timeout, station priority (20m)
- [ ] 4.9 ✂️ Labour % estimate per daypart (20m) *(outside phase total)*
- [ ] 4.10 ✂️ Auto-fill a draft week from the coverage template (60m) *(outside phase total)*

## 5. Call-out flow & outreach | 4.75h
- [ ] 5.1 `server/sms/{index,sim,twilio}.ts`: provider interface; sim stores messages in the DB (20m)
- [ ] 5.2 `POST /api/sms/inbound` + "Mark sick" button → create CallOut (25m)
- [ ] 5.3 Impact analysis + recovery plan (Plan A moves + Plan B candidates) persisted as RecoveryPlan (30m)
- [ ] 5.4 Call-out page: plan summary, moves diff on the station board, ranked candidates with reasons, OT approval checkbox (50m)
- [ ] 5.5 `POST /api/callouts/[id]/apply`: apply moves transactionally + notify moved crew (20m)
- [ ] 5.6 `server/outreach.ts` state machine: start → offer → timeout/decline → next → accept → commit (40m)
- [ ] 5.7 Transactional accept with double-accept protection ("already covered" reply) (15m)
- [ ] 5.8 `worker/index.ts`: timeout polling loop (15m)
- [ ] 5.9 Audit timeline + SSE live updates (`GET /api/callouts/[id]/events`) (30m)
- [ ] 5.10 `/sim` phone simulator: grid of crew phones, send/receive texts (35m)
- [ ] 5.11 ✂️ Conditional replies ("can be there by 7") → partial cover (30m) *(outside phase total)*

## 6. Deploy to Vultr | 1.75h
- [ ] 6.1 Production `Dockerfile` (Next.js standalone) + worker image (25m)
- [ ] 6.2 Compose prod profile: app, worker, postgres, Caddy; `Caddyfile` for `<ip>.sslip.io` auto-TLS (20m)
- [ ] 6.3 VM setup: Docker install, firewall (22/80/443), clone repo, `.env`, `compose up`, migrate + seed (40m)
- [ ] 6.4 Smoke-test the full demo flow on the public URL (20m)
- [ ] 6.5 ✂️ Wire the Twilio webhook to `/api/sms/inbound` and test on a real phone (15m) *(outside phase total)*

## 7. Polish & README | 2h
- [ ] 7.1 "Reset demo" button (reseed) for judges (15m)
- [ ] 7.2 UI polish: empty states, loading states, toasts, mobile check of manager views (45m)
- [ ] 7.3 README: problem, Vultr services used (Cloud Compute, plus Serverless Inference if enabled), LLM provider switch, architecture diagram, setup, use case, how the agent runs real tasks (45m)
- [ ] 7.4 Run vitest + E2E checklist; race test (two simultaneous accepts) (15m)

## 8. Submission assets | 3h
- [ ] 8.1 Demo script: a 4:40am sick text → red board → recovery plan → outreach → covered (20m)
- [ ] 8.2 Record + edit a 2–3 min demo video (75m)
- [ ] 8.3 Slide deck (problem, solution, architecture, business value, Vultr usage) (45m)
- [ ] 8.4 Cover image (15m)
- [ ] 8.5 Submit on lablab.ai (title, descriptions, tags, repo, demo URL, video, slides) **before 5:00 PM MDT Nov 8** (15m)
- [ ] 8.6 ✂️ Post on Vultr Community (10m) *(outside phase total)*
