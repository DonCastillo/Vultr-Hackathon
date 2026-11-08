# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project status

This repo is the entry for the **Vultr: Agent Rush Hackathon**, Track 2 "Powering the Future of Work". The submission deadline is **Nov 8, 2026, 5:00 PM MDT**. **No application code exists yet.** The design lives in `plan/` and is the source of truth until code is scaffolded:

- `plan/plan.md`: product scope, business rules, agent loop, build order, cut-line
- `plan/tasks.md`: checkbox task list with estimates. Tick boxes (`- [x]`) as tasks are completed.
- `plan/architecture.md`: deployment, components, call-out sequence, offer state machine (Mermaid)
- `plan/models.md`: every table, column, datatype, enum and index
- `plan/enums.md`: what each enum value means and where it is used
- `plan/vultr-hackathon-project-requirements.pdf`: the official event requirements

When the design changes, keep these docs consistent with each other.

## Workflow rule: one subtask at a time, reviewed before commit

- Work on **exactly one subtask** from `plan/tasks.md` at a time (e.g. `1.1`, then `1.2`). Don't start the next one until the user says so.
- When a subtask is done, **stop and hand it over for review**:
  - the subtask number
  - the files changed
  - how it was verified (commands run and their results)
  - anything left open
- **The user makes all git commits. Claude never runs `git commit`, `git push` or other history-changing git commands** (amend, rebase, reset, tag), even after approval. Once the user approves a subtask, tick its checkbox in `plan/tasks.md` and suggest a commit message that starts with the subtask number (e.g. `1.1: scaffold Next.js 15 app`). The user then commits it, tick included. Read-only git commands (`status`, `diff`, `log`) are fine. `permissions.deny` in `.claude/settings.json` blocks these commands for Claude.
- If review feedback asks for changes, apply them to the same subtask and hand it over for review again.
- On every user prompt, check `plan/tasks.md` against the actual state and tick any subtask that is done and approved, including the user's own `(you)` steps when the user reports them done. A `UserPromptSubmit` hook in `.claude/settings.json` sends this reminder.

## What we're building

**CrewShift** is crew scheduling and sick-call recovery for a **single standalone coffee and donut shop**. The demo brand, "Maple & Mug Coffee Co.", is fictional. Never use real chain names or logos in the app or seed data.

The manager schedules crew by day, time and **station** (Drive-Thru headset/window, Counter, Beverage, Sandwich, Oven, Overnight Baker, Lobby, Supervisor). When someone calls in sick, the agent:
1. parses the call-out
2. computes the coverage shortfall
3. **Plan A:** rebalances stations among crew already on shift
4. **Plan B:** ranks off-duty crew for a call-in or shift extension
5. after manager approval, texts offers **strictly one candidate at a time**, escalating on decline or timeout

## Stack (planned)

- Node 24.22+ LTS (`.nvmrc`; Docker images `node:24-alpine`). Older Node builds bundle tz data from before Alberta moved to permanent UTC-6 on 2026-11-01 and get store times wrong by an hour; `prisma/seed.ts` refuses to run when Node and Postgres disagree.
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

### Layout: frontend vs backend

There is one Next.js app; the split is by folder:

- **Frontend:** `app/` (pages) and `components/`. `lib/` holds UI-only helpers such as shadcn's `cn`.
- **Backend:** `server/` (db, rules, solver, rank, llm, sms, outreach, audit).
  - Every file there starts with `import "server-only"`, so the build fails if browser code imports it.
  - `worker/` is a separate process that reuses `server/`.
  - The database schema and seed live in `prisma/`.
- **Route handlers and server actions** (`app/api/**` and `"use server"` functions) stay thin: validate input, then call `server/`. Client components (`"use client"`) never import `server/`.
- **Pure logic stays framework-free:** `server/rules`, `server/solver` and `server/rank.ts`, so vitest can test them. `vitest.config.ts` aliases `server-only` to an empty module.

- **Rules decide, the LLM talks.** These are pure, unit-tested TypeScript with no LLM involvement:
  - eligibility, overtime, youth labour limits, rest gap/clopen, cert expiry and coverage: `server/rules/`
  - jurisdiction presets for Alberta (the default), Ontario, BC and US federal: `server/rules/presets.ts`
  - the rebalance solver: `server/solver/rebalance.ts`
  - ranking: `server/rank.ts`

  The LLM (`server/llm/`) does only four things: `parseCallout`, `summarizePlan`, `composeOffer` and `classifyReply`. `index.ts` holds the shared prompts and zod schemas; `anthropic.ts` and `vultr.ts` are thin transport adapters. New LLM features go in `index.ts`, never in one adapter only. Every call is zod-validated with a timeout and a keyword/template fallback, so the flow still works without inference.
- **Manager approval gates every change.** Station moves and outreach start only after approval; overtime candidates need an explicit `otApproved`.
- **One live offer per call-out.** This is enforced by a partial unique index on `Offer(callOutId) WHERE status IN ('SENT','CLARIFYING')`, created in a raw SQL migration because Prisma can't express it. Acceptance runs in a transaction with `SELECT … FOR UPDATE` on the CallOut, so only the first acceptor wins.
- **State machines:**
  - CallOut: `OPEN → PLANNED → OUTREACH → COVERED | UNFILLED`
  - Offer: `PENDING → SENT → ACCEPTED | DECLINED | EXPIRED | CANCELLED`, with `CLARIFYING` as a loop back to `SENT`
  - Logic lives in `server/outreach.ts`. Both `web` (inbound replies) and `worker` (expiries) drive it.
- **Audit everything.** Every rule result, LLM input/output, message and decision is written to `AuditEvent` and streamed to the call-out page over SSE (`GET /api/callouts/[id]/events`).
- **Time handling.** Datetimes are stored as UTC `TIMESTAMPTZ`. Times-of-day (`TIME`) are local store time in `Store.timezone` (default `America/Edmonton`). Coverage is computed in 15-minute slots.
- **Demo mode** (`RuleConfig.demoMode`) shortens the offer timeout from 600s to 120s for the demo video.

## Submission requirements to keep in mind

The README must explain which Vultr services are used (Cloud Compute, plus Serverless Inference if enabled), the backend/deployment architecture, and how the agent runs real tasks. Also required:
- a public GitHub repo
- a live app URL on Vultr
- a demo video
- slides

Vultr GPUs are not available for this event. The repo is MIT-licensed (`LICENSE.md`).
