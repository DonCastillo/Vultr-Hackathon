# CrewShift: Task Checklist

Deadline: **Nov 8, 2026, 5:00 PM MDT**. See [plan.md](plan.md) for the full design.

Legend: **(you)** = account step only you can do · **✂️ cut-line** = drop first if behind schedule · times are estimates.

| Phase | Est. | Running total |
|---|---|---|
| P. Prerequisites (you) | 0.75h | 0.75h |
| 1. Scaffold & data | 2.5h | 3.25h |
| 2. Rules engine & solver | 4.5h | 7.75h |
| 3. LLM (Vultr Inference) | 2h | 9.75h |
| 4. Manager UI | 5.5h | 15.25h |
| 5. Call-out flow & outreach | 4.75h | 20h |
| 6. Deploy to Vultr | 1.75h | 21.75h |
| 7. Polish & README | 2h | 23.75h |
| 8. Submission assets | 3h | 26.75h |
| Buffer | ~3h | ~30h |

Cut-line tasks (not counted in the totals above) add up to about 2.5h, which can be dropped to grow the buffer.

---

## P. Prerequisites (you) | 0.75h
- [ ] **(you)** Create a Vultr account with an email never used on Vultr, and verify it (10m)
- [ ] **(you)** Billing → Promotions → apply the hackathon gift code; confirm $200.00 credit (5m)
- [ ] **(you)** Enable Serverless Inference, create an API key, and put it in `.env` as `VULTR_INFERENCE_API_KEY` (10m)
- [ ] **(you)** Add an SSH key in the Vultr console (5m)
- [ ] **(you)** Deploy a Cloud Compute VM: Ubuntu 24.04, 2 vCPU / 4 GB (can wait until Phase 6) (10m)
- [ ] **(you)** ✂️ Twilio trial account, verify your phone, buy a number (15m)

## 1. Scaffold & data | 2.5h
- [ ] Next.js 15 + TypeScript + Tailwind + shadcn/ui init; ESLint/Prettier (20m)
- [ ] `docker-compose.yml` with Postgres 16; `.env.example` (15m)
- [ ] Prisma schema: Store, Station, Crew, CrewStation, Cert, Availability, TimeOff, Shift, StationAssignment, CoverageRule, CallOut, RecoveryPlan, Offer, Message, AuditEvent, RuleConfig (40m)
- [ ] `prisma/seed.ts`: standalone Maple & Mug store (Ontario), 9 stations, dayparts, coverage template (20m)
- [ ] Seed ~20 crew (students/minors, trainees, overnight baker, supervisors, certs incl. one expired) (25m)
- [ ] Seed a full week of shifts + station assignments, including the demo scenario (5:30am headset crew) (30m)

## 2. Rules engine & solver | 4.5h
- [ ] `lib/rules/presets.ts`: Ontario (44h, 11h rest), BC (8h/day + 40h/week), US FLSA (+ youth limits) (20m)
- [ ] `lib/rules/eligibility.ts`: training level, availability, PTO, overlap, rest gap/clopen, cert expiry (45m)
- [ ] `lib/rules/overtime.ts`: weekly/daily OT under each preset (20m)
- [ ] `lib/rules/youth.ts`: school-day hours, latest end time, restricted stations (20m)
- [ ] `lib/rules/coverage.ts`: required vs. scheduled per station per 15-min slot; shortfalls; supervisor rule (40m)
- [ ] `lib/solver/rebalance.ts`: greedy + backtracking station reassignment by priority (50m)
- [ ] `lib/rank.ts`: replacement scoring (no-OT, fairness, reliability, seniority) + shift-extension candidates (30m)
- [ ] vitest suite for all of the above (edge cases from the plan's Verification section) (45m)

## 3. LLM via Vultr Serverless Inference | 2h
- [ ] `lib/llm.ts`: OpenAI SDK client with `baseURL=https://api.vultrinference.com/v1`; list models, choose a default (20m)
- [ ] `parseCallout`: free-text SMS → `{crewId, shiftId, reason}` with zod validation (25m)
- [ ] `summarizePlan` + per-candidate rationale (25m)
- [ ] `composeOffer`: personalized offer text (15m)
- [ ] `classifyReply`: accept / decline / conditional / question (20m)
- [ ] Keyword/regex fallbacks + timeout handling when the LLM is slow or returns bad JSON (15m)

## 4. Manager UI | 5.5h
- [ ] App shell: nav, mobile-friendly layout, Maple & Mug theming (30m)
- [ ] Crew roster page: stations, levels, certs, availability, student flag (40m)
- [ ] Week view: crew × day grid with station-colored shift bars (60m)
- [ ] Week view: drag to create/move/resize shifts (dnd-kit) + server actions (60m)
- [ ] Shift editor: split a shift into station blocks (30m)
- [ ] Live validation badges (OT, untrained, youth, clopen, unavailable, cert expired) (30m)
- [ ] **Day station board:** timeline by station + coverage heatmap vs. template (60m)
- [ ] Settings page: jurisdiction preset, OT threshold, rest hours, offer timeout, station priority (20m)
- [ ] ✂️ Labour % estimate per daypart (20m) *(outside phase total)*
- [ ] ✂️ Auto-fill a draft week from the coverage template (60m) *(outside phase total)*

## 5. Call-out flow & outreach | 4.75h
- [ ] `lib/sms/{index,sim,twilio}.ts`: provider interface; sim stores messages in the DB (20m)
- [ ] `POST /api/sms/inbound` + "Mark sick" button → create CallOut (25m)
- [ ] Impact analysis + recovery plan (Plan A moves + Plan B candidates) persisted as RecoveryPlan (30m)
- [ ] Call-out page: plan summary, moves diff on the station board, ranked candidates with reasons, OT approval checkbox (50m)
- [ ] `POST /api/callouts/[id]/apply`: apply moves transactionally + notify moved crew (20m)
- [ ] `lib/outreach.ts` state machine: start → offer → timeout/decline → next → accept → commit (40m)
- [ ] Transactional accept with double-accept protection ("already covered" reply) (15m)
- [ ] `worker/index.ts`: timeout polling loop (15m)
- [ ] Audit timeline + SSE live updates (`GET /api/callouts/[id]/events`) (30m)
- [ ] `/sim` phone simulator: grid of crew phones, send/receive texts (35m)
- [ ] ✂️ Conditional replies ("can be there by 7") → partial cover (30m) *(outside phase total)*

## 6. Deploy to Vultr | 1.75h
- [ ] Production `Dockerfile` (Next.js standalone) + worker image (25m)
- [ ] Compose prod profile: app, worker, postgres, Caddy; `Caddyfile` for `<ip>.sslip.io` auto-TLS (20m)
- [ ] VM setup: Docker install, firewall (22/80/443), clone repo, `.env`, `compose up`, migrate + seed (40m)
- [ ] Smoke-test the full demo flow on the public URL (20m)
- [ ] ✂️ Wire the Twilio webhook to `/api/sms/inbound` and test on a real phone (15m) *(outside phase total)*

## 7. Polish & README | 2h
- [ ] "Reset demo" button (reseed) for judges (15m)
- [ ] UI polish: empty states, loading states, toasts, mobile check of manager views (45m)
- [ ] README: problem, Vultr services used (Cloud Compute, Serverless Inference), architecture diagram, setup, use case, how the agent runs real tasks (45m)
- [ ] Run vitest + E2E checklist; race test (two simultaneous accepts) (15m)

## 8. Submission assets | 3h
- [ ] Demo script: a 4:40am sick text → red board → recovery plan → outreach → covered (20m)
- [ ] Record + edit a 2–3 min demo video (75m)
- [ ] Slide deck (problem, solution, architecture, business value, Vultr usage) (45m)
- [ ] Cover image (15m)
- [ ] Submit on lablab.ai (title, descriptions, tags, repo, demo URL, video, slides) **before 5:00 PM MDT Nov 8** (15m)
- [ ] ✂️ Post on Vultr Community (10m) *(outside phase total)*
