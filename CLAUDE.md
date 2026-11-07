# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project status

This repo is the entry for the **Vultr: Agent Rush Hackathon**, Track 2 "Powering the Future of Work". The submission deadline is **Nov 8, 2026, 5:00 PM MDT**. **No application code exists yet.** The design lives in `plan/` and is the source of truth until code is scaffolded:

- `plan/plan.md`: product scope, business rules, agent loop, build order, cut-line
- `plan/tasks.md`: checkbox task list with estimates. Tick boxes (`- [x]`) as tasks are completed.
- `plan/architecture.md`: deployment, components, call-out sequence, offer state machine (Mermaid)
- `plan/models.md`: every table, column, datatype, enum and index
- `plan/vultr-hackathon-project-requirements.pdf`: the official event requirements

When the design changes, keep these four docs consistent with each other.

## What we're building

**CrewShift** is crew scheduling and sick-call recovery for a **single standalone coffee and donut shop**. The demo brand, "Maple & Mug Coffee Co.", is fictional. Never use real chain names or logos in the app or seed data.

The manager schedules crew by day, time and **station** (Drive-Thru headset/window, Counter, Beverage, Sandwich, Oven, Overnight Baker, Lobby, Supervisor). When someone calls in sick, the agent:
1. parses the call-out
2. computes the coverage shortfall
3. **Plan A:** rebalances stations among crew already on shift
4. **Plan B:** ranks off-duty crew for a call-in or shift extension
5. after manager approval, texts offers **strictly one candidate at a time**, escalating on decline or timeout

## Stack (planned)

- Next.js 15 (App Router, TypeScript), Tailwind + shadcn/ui, dnd-kit
- Postgres 16 + Prisma
- Separate worker process (`worker/index.ts`, run with `tsx`) that polls every 5s for expired offers
- LLM provider switch `LLM_PROVIDER=anthropic|vultr`:
  - `anthropic`: `@anthropic-ai/sdk`, default `claude-haiku-5-5`. Used for development while the Vultr gift codes are out of stock.
  - `vultr`: Vultr Serverless Inference via the `openai` SDK with `baseURL=https://api.vultrinference.com/v1`. The preferred demo default once credits arrive.
- SMS provider abstraction: `sim` (default, in-app phone simulator at `/sim`) or `twilio`
- vitest
- Deploy: one Vultr Cloud Compute VM running docker compose (`caddy`, `web`, `worker`, `postgres`), with Caddy auto-TLS on `<ip>.sslip.io`

Once the project is scaffolded, replace this section with the actual commands (dev, build, lint, test, single test, `prisma migrate`/`db seed`, `docker compose up`).

## Architecture rules that span files

- **Rules decide, the LLM talks.** These are pure, unit-tested TypeScript with no LLM involvement:
  - eligibility, overtime, youth labour limits, rest gap/clopen, cert expiry and coverage: `lib/rules/`
  - jurisdiction presets for Ontario, BC and US federal: `lib/rules/presets.ts`
  - the rebalance solver: `lib/solver/rebalance.ts`
  - ranking: `lib/rank.ts`

  The LLM (`lib/llm/`) does only four things: `parseCallout`, `summarizePlan`, `composeOffer` and `classifyReply`. `index.ts` holds the shared prompts and zod schemas; `anthropic.ts` and `vultr.ts` are thin transport adapters. New LLM features go in `index.ts`, never in one adapter only. Every call is zod-validated with a timeout and a keyword/template fallback, so the flow still works without inference.
- **Manager approval gates every change.** Station moves and outreach start only after approval; overtime candidates need an explicit `otApproved`.
- **One live offer per call-out.** This is enforced by a partial unique index on `Offer(callOutId) WHERE status IN ('SENT','CLARIFYING')`, created in a raw SQL migration because Prisma can't express it. Acceptance runs in a transaction with `SELECT … FOR UPDATE` on the CallOut, so only the first acceptor wins.
- **State machines:**
  - CallOut: `OPEN → PLANNED → OUTREACH → COVERED | UNFILLED`
  - Offer: `PENDING → SENT → ACCEPTED | DECLINED | EXPIRED | CANCELLED`, with `CLARIFYING` as a loop back to `SENT`
  - Logic lives in `lib/outreach.ts`. Both `web` (inbound replies) and `worker` (expiries) drive it.
- **Audit everything.** Every rule result, LLM input/output, message and decision is written to `AuditEvent` and streamed to the call-out page over SSE (`GET /api/callouts/[id]/events`).
- **Time handling.** Datetimes are stored as UTC `TIMESTAMPTZ`. Times-of-day (`TIME`) are local store time in `Store.timezone` (default `America/Toronto`). Coverage is computed in 15-minute slots.
- **Demo mode** (`RuleConfig.demoMode`) shortens the offer timeout from 600s to 120s for the demo video.

## Submission requirements to keep in mind

The README must explain which Vultr services are used (Cloud Compute, plus Serverless Inference if enabled), the backend/deployment architecture, and how the agent runs real tasks. Also required:
- a public GitHub repo
- a live app URL on Vultr
- a demo video
- slides

Vultr GPUs are not available for this event. The repo is MIT-licensed (`LICENSE.md`).
