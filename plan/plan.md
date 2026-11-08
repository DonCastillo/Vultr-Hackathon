# CrewShift: AI crew scheduler for an independent coffee shop (Vultr Agent Rush, Track 2)

## Context
Hackathon deadline: **Nov 8, 2026, 5:00 PM MDT** (~30h). The repo is empty (README, LICENSE, `plan/` with the requirements PDF).
Track 2 "Powering the Future of Work" asks for a production-style web app with multi-step agentic workflows, with a Vultr VM as the backend. Serverless Inference is optional for Track 2. The LLM layer supports **two providers behind one switch**: Anthropic Claude (used for development now, while the Vultr gift codes are out of stock) and Vultr Serverless Inference (the preferred demo default once credits arrive, since judges score "Application of Technology" and Vultr is the sponsor).

**Product:** crew management for a **standalone, independently owned** quick-service coffee and donut shop. It runs like a Tim Hortons-style store (5am open, a huge morning drive-thru rush, an overnight baker), but it is one location with no chain or franchise behind it.
- The **store manager builds the weekly schedule**: who works which day and time, and **which station** they own in each block.
- The app **validates as you schedule**: station training, availability, overtime, youth labour rules, rest gaps, and coverage minimums per daypart.
- **When someone calls in sick** (usually a 4:30am text), the agent builds a recovery plan. It (a) **reassigns stations among the crew already on shift**, and (b) if coverage is still short, **calls in a replacement** by texting ranked off-duty crew in order until someone accepts. The manager approves from their phone, and the schedule updates.

Demo brand is fictional (**"Maple & Mug Coffee Co."**, one standalone store). No real brand names or logos in the app. Working product name: **CrewShift**.

## Stations (seeded, configurable)
Drive-Thru Order Taker (headset), Drive-Thru Window/Cash, Front Counter/Till, Beverage/Barista (brewed coffee, espresso, iced drinks), Sandwich & Breakfast Line, Oven & Baked Goods (donut finishing, bagels, reheats), Overnight Baker, Lobby/Dishes/Restock, Shift Supervisor.

Dayparts: Overnight (11pm–5am), **Morning Rush (5:30–10am, peak)**, Midday (10–2), Afternoon (2–6), Evening/Close (6–11).

## Stack
- **Next.js 15 (App Router, TypeScript)**, Tailwind + shadcn/ui, dnd-kit for drag-and-drop scheduling, mobile-friendly manager views
- **Postgres 16 + Prisma** in docker-compose on the VM (the README notes Vultr Managed DB as the upgrade path)
- **Worker process** (`tsx worker/index.ts`): offer timeouts and escalation, polling every 5s
- **LLM provider switch** (`LLM_PROVIDER`):
  - `anthropic`: `@anthropic-ai/sdk`, default model **Claude Haiku 5.5** (`claude-haiku-5-5`) for speed; `claude-sonnet-5-5` if summaries need better wording
  - `vultr`: Vultr Serverless Inference via the `openai` SDK with `baseURL=https://api.vultrinference.com/v1`, JSON output (model picked from `GET /v1/models`)
- **SMS abstraction:** `sim` (default) is an in-app crew phone simulator. `twilio` is used when env vars are set (trial account texting a verified phone for the live demo).
- **Deploy:** one Vultr Cloud Compute VM (2 vCPU/4 GB, Ubuntu 24.04) running docker-compose (app, worker, postgres, Caddy). Caddy gets auto-TLS on `<ip>.sslip.io`.

## Domain rules (deterministic engine in `server/rules/`, unit-tested)
- **Jurisdiction presets** (set once in Settings; simplified, with a "not legal advice" disclaimer):
  - **Alberta (the demo store's preset):** OT after **8h/day or 44h/week**, whichever gives more OT; 8h rest between shifts; under-15s at most 2h on school days, 8h on other days, and never past 9pm
  - Ontario: OT after **44h/week**, 11h daily rest, students under 16 limited on school days
  - British Columbia: OT after **8h/day and 40h/week**
  - US federal (FLSA): OT after 40h/week, 14–15-year-olds ≤3h school days and not past 7pm
- **Station training:** level trainee/certified/trainer. Trainees can't work Drive-Thru or Barista alone during Morning Rush.
- **Availability and time off:** weekly windows (many crew are students) and approved PTO
- **Overtime:** flagged `OT`, needs manager approval
- **Rest gap:** close-to-open "clopen" check (e.g. closing at 11pm then opening at 5am is blocked or warned)
- **Coverage template:** minimum headcount per station per daypart (e.g. Morning Rush: 2 Drive-Thru, 1 Window, 2 Beverage, 1 Sandwich, 1 Oven, 1 Supervisor)
- **Standalone store:** one location, one crew roster. Recovery plans only use this store's own crew (call-ins and shift extensions); there is no other location to draw from.
- **A supervisor on the floor at all times**; the overnight baker must be certified
- **Food-safety cert** (e.g. Food Handler) required for Sandwich/Oven, with expiry tracked

## Sick call-out agent loop
1. **Intake.** A crew member texts ("sick, can't make my 5am") or the manager taps "Mark sick". The **LLM parses** it into `{crewId, shiftId, reason}` and confirms if unclear.
2. **Impact analysis.** Shows which station/daypart blocks drop below the coverage template and whether the supervisor rule breaks.
3. **Plan A: rebalance in-shift (solver).** Reassign crew already on shift: pull a trained person from a lower-priority station (e.g. Lobby/Dishes, or a second Sandwich) into the gap. Station priority is configurable (Drive-Thru > Window > Beverage > Counter > Sandwich > Oven > Lobby). A greedy + small backtracking search over ≤15 people. Output: moves plus the remaining shortfall.
4. **Plan B: call in a replacement.** Rank eligible off-duty crew: trained for the station, available, no OT first, no youth-rule or rest violations, then fairness (fewest pickups in 30 days), reliability, and seniority.
   - **Extend** an adjacent shift (the overnight baker stays until 7am, or the midday person comes in at 8) if that's within the rules
5. **Explain.** The **LLM writes a manager-facing summary** ("Move Aisha Lobby→Drive-Thru headset 5:30–10, Lobby uncovered until 10. Call in Ben for Beverage: certified barista, 30h this week") and a rationale per candidate.
6. **Approval gate.** The plan diff is shown on the station board; **Apply moves** and **Start outreach**. OT needs explicit approval.
7. **Sequential outreach.** **One candidate at a time:** the next person is only texted after the current offer is declined or times out, so a "yes" is always a firm commitment and nobody gets an offer that is then withdrawn. Each offer gets an **LLM-personalized text** and a timeout (2 min in demo, 10 min in real mode, since morning calls are urgent), escalating on timeout or decline. The **LLM classifies replies** as `accept | decline | conditional ("can be there by 7") | question`.
8. **Commit.** A transactional reassignment prevents double-accepts (late acceptors get "already covered, thanks!"). The schedule updates, moved crew are notified ("Heads up: you're on headset at 5:30"), the manager is notified, and pending offers are cancelled.
9. **Audit timeline** per call-out records every rule check, LLM output, message and decision.

## Manager features
- **Week view:** rows are crew, columns are days, with shift bars color-coded by station; drag to create/move, split shifts into station blocks
- **Day station board:** timeline by station with a coverage heatmap vs. the template (morning rush clearly visible). This is the demo centerpiece.
- **Live validation badges:** OT, untrained, youth rule, clopen, unavailable, cert expired
- **Labour % estimate:** scheduled hours × wage vs. a projected sales input per daypart (a simple business-value metric)
- **Auto-fill draft (stretch):** fill an empty week from the coverage template using the same engine
- **Crew roster:** stations trained, certs, availability, student/minor flag

## Data model (prisma/schema.prisma)
`Store` (single row: name, jurisdiction, timezone, open hours), `Station` (name, priority, requiresCert), `Crew` (name, phone, birthdate, isStudent, wage, seniority, reliability), `CrewStation` (level), `Cert` (type, expiresAt), `Availability`, `TimeOff`, `SchoolDay` (date), `Shift` (crewId, start, end), `StationAssignment` (shiftId, stationId, start, end), `CoverageRule` (stationId, weekday, daypart, minCount), `CallOut`, `RecoveryPlan` (moves JSON, shortfall JSON, summary), `Offer` (callOutId, crewId, stationId, kind: callin/extend, rank, status, expiresAt), `Message`, `AuditEvent`, `RuleConfig`.

## Key files
- `server/rules/{eligibility,youth,overtime,coverage}.ts` + `server/rules/presets.ts` (AB/ON/BC/US): pure, with vitest tests
- `server/solver/rebalance.ts`, `server/rank.ts`
- `server/llm/` (`index.ts` provider-agnostic interface, `anthropic.ts`, `vultr.ts`) + prompts (parseCallout, summarizePlan, composeOffer, classifyReply), zod-validated with keyword fallback
- `server/sms/{index,sim,twilio}.ts`, `server/outreach.ts` (state machine), `worker/index.ts`
- `app/(app)/schedule/week`, `app/(app)/schedule/day/[date]`, `app/(app)/callouts/[id]`, `app/(app)/crew`, `app/sim`, `app/settings`
- API: `POST /api/callouts`, `POST /api/callouts/[id]/apply`, `POST /api/sms/inbound`, `GET /api/callouts/[id]/events` (SSE)
- `prisma/seed.ts`: the standalone Maple & Mug store (Calgary, Alberta), 31 crew (students, 14-year-olds, trainees, overnight bakers, supervisors), a full Mon-Sun week scheduled around the **demo day = the next weekday after seeding** (re-run `pnpm db:seed` before demoing). Demo scenario: **the 5:30am drive-thru headset person (Kayla, headset 5:30-10 then Beverage 10-14) texts in sick at 4:40am.**
- `docker-compose.yml`, `Dockerfile`, `Caddyfile`, `README.md` (Vultr services, architecture diagram, setup, use case)

## Build order (time-boxed)
0. **First action after approval, then stop for review:** save this plan to `plan/plan.md`, and write `plan/tasks.md`, a step-by-step checklist (`- [ ]`) grouped by the phases below. Each task gets an hour estimate, with a running total per phase and overall. Mark the cut-line tasks and the "you do" account prerequisites. No code is written until you review these.
1. **(2h)** Scaffold Next.js + Prisma + compose; schema; seed
2. **(4h)** Rules engine + presets + coverage + rebalance solver + ranking, with vitest
3. **(2.25h)** `server/llm/` with both providers (Claude first, Vultr when the key arrives), with fallbacks
4. **(5h)** UI: week schedule (drag/drop + badges), day station board + coverage heatmap, crew roster
5. **(4h)** Call-out flow: impact, recovery plan, apply moves, outreach, worker, phone simulator
6. **(2h)** Deploy to Vultr VM; optional Twilio
7. **(2h)** Polish + README with architecture diagram
8. **(3h)** Demo video, slides, cover image, lablab submission
Buffer: about 6h. **Cut-line if late:** drop auto-fill, labour %, Twilio and conditional replies first. Keep the station board, call-out recovery plan and phone sim.

## Prerequisites you must do (account steps I can't do)
1. Create a Vultr account with a fresh email and apply the hackathon gift code (check for $200)
2. Enable Serverless Inference and create an API key (blocked until gift codes are replenished)
2a. Create an Anthropic API key (console.anthropic.com) for development in the meantime
3. Deploy an Ubuntu 24.04 VM and add your SSH key (can wait until step 6)
4. (Optional) Twilio trial account plus a verified phone

## Verification
- vitest: untrained, OT under the AB 8h-day-or-44h-week rule vs. ON 44h and BC daily rules, youth school-day limit, clopen, PTO, overlap, expired food-handler cert; coverage shortfall; solver picks the lowest-priority donor; ranking order
- Local E2E on the seed: day board for Morning Rush (green), mark the 5:30 headset crew sick (Drive-Thru turns red), get a recovery plan (Plan A: move Aisha Lobby→headset 5:30-10, Lobby left short; Plan B for Beverage 10-14: Ben, then Noah, with Sofia flagged OT for an extension), apply, start outreach. Candidate 1 times out, 2 declines, 3 accepts. Check the board is green, moved crew notified, the timeline complete.
- Race test: two sim phones accept at once; only one wins
- Same flow on the public Vultr URL
