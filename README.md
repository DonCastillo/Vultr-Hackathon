# CrewShift

**Crew scheduling and sick-call recovery for a single coffee and donut shop.**
Entry for the Vultr: Agent Rush Hackathon, Track 2, "Powering the Future of Work".

**Live app:** https://104.207.156.157.sslip.io (running on Vultr Cloud Compute)

> The demo store, "Maple & Mug Coffee Co." in Calgary, Alberta, is fictional.

## The problem

At 4:40am a barista texts "sick, can't make my 5:30". The shift manager now has to work out
which stations go short and when, who already on shift can move, and who off duty can come in
without breaking overtime, youth-labour or rest rules. Then they text people one by one before
the morning rush. This is done half-asleep, by hand, every week.

## What the agent does

1. **Parses the call-out.** A crew member texts the store line in plain language. The LLM
   reads the text and matches it to their upcoming shift, with a keyword fallback.
2. **Computes the shortfall** per station in 15-minute slots against the coverage template.
3. **Plan A: rebalances** crew already on shift, for example moving Lobby to the Drive-Thru
   order taker, with a solver that respects station priority and certifications.
4. **Plan B: ranks off-duty crew** for a call-in or a shift extension. It weighs
   certification, availability, overtime, reliability and fairness, and gives the reasons.
5. **Manager approval gate.** The manager sees a plain-English summary written by the LLM,
   plus every move and candidate, and approves. Overtime candidates need an explicit tick.
6. **Outreach, strictly one candidate at a time.** The LLM writes each text. Replies are
   classified (yes, no, unclear, conditional). A decline or a 10-minute timeout escalates to
   the next candidate. A YES is committed in a database transaction, so only the first
   acceptor wins, and anyone later gets "already covered".
7. **Audit trail.** Every rule result, LLM input and output, text and decision appears on the
   call-out timeline.

**Rules decide, the LLM talks.** Eligibility, overtime, youth limits (Alberta, Ontario, BC and
US federal presets), rest gaps, the rebalance solver and the ranking are pure, unit-tested
TypeScript. The LLM does only four things: `parseCallout`, `summarizePlan`, `composeOffer` and
`classifyReply`. Each call is validated with zod, has a timeout, and has a template fallback,
so the flow keeps working even if inference is down.

## Try it (about 2 minutes)

1. Open **Phone sim** and, on **Kayla's** phone, text: `sick, can't make my 5:30 tomorrow`.
2. Open **Call-outs**, then Kayla's call-out. Read the plan and click **Approve moves & start
   outreach**.
3. Back on **Phone sim**, Ben receives the offer. Reply `no`, and Noah is texted next. Reply
   `yes` on Noah's phone, and the call-out turns **Covered**. The manager is texted, and the
   station board shows the new shift.

## Vultr services used

| Service | How CrewShift uses it |
|---|---|
| **Vultr Cloud Compute** | One VM (Seattle, Ubuntu 24.04, 2 vCPU / 4 GB) runs the whole stack with Docker Compose |
| **Vultr Serverless Inference** | Supported as an LLM provider (`LLM_PROVIDER=vultr`, an OpenAI-compatible API at `api.vultrinference.com`). The live demo uses Anthropic Claude Haiku via `LLM_PROVIDER=anthropic`; switching is one environment variable. |

## Architecture

```
Internet ──443──▶ caddy (auto-TLS for <ip>.sslip.io)
                    │
                    ▼
                 web  (Next.js 15: manager UI, phone sim, server actions)
                    │                         ▲
                    ▼                         │ same server/ code
               postgres 16  ◀──────────── worker (every 5s: expire unanswered offers,
                    ▲                               text the next candidate)
                    │
               migrate (one-shot: prisma migrate deploy)

web / worker ──▶ LLM: Anthropic Claude  |  Vultr Serverless Inference
```

- **One Next.js app**, split by folder. The frontend is in `app/` and `components/`. The
  backend is in `server/`, where every file is `server-only`: rules, solver, ranking, LLM,
  SMS, outreach and audit.
- **The worker** is a separate process that reuses `server/`. It drives the offer state
  machine forward when nobody replies, even with no browser open.
- **Concurrency safety.** At most one live offer per call-out is enforced by a partial unique
  index. An accept locks the call-out row (`SELECT … FOR UPDATE`).
- **State machines.** A call-out goes `OPEN → PLANNED → OUTREACH → COVERED | UNFILLED`. An
  offer goes `PENDING → SENT → ACCEPTED | DECLINED | EXPIRED | CANCELLED`.
- **Time.** All timestamps are stored in UTC. Store times use `America/Edmonton`. This needs
  Node 24.22 or later for Alberta's November 2026 move to permanent UTC-6.
- **SMS** goes through a provider abstraction. The demo uses the in-app phone simulator.

Detailed design: [`plan/architecture.md`](plan/architecture.md) and [`plan/models.md`](plan/models.md).

## Stack

Next.js 15 (App Router, TypeScript) · Tailwind + shadcn/ui · dnd-kit · Postgres 16 + Prisma 7 ·
zod · vitest (294 tests) · Anthropic SDK and OpenAI SDK (for Vultr) · Docker Compose · Caddy

## Run locally

```bash
nvm use                      # Node 24.22+
pnpm install
cp .env.example .env         # add ANTHROPIC_API_KEY (or LLM_DISABLED=1 to use fallbacks)
pnpm db:up && pnpm db:deploy && pnpm db:seed
pnpm dev                     # http://localhost:3000
pnpm worker                  # optional: offer-expiry loop
pnpm test                    # vitest
```

## Deploy to a Vultr VM

```bash
curl -fsSL https://get.docker.com | sh
ufw allow 22/tcp && ufw allow 80/tcp && ufw allow 443/tcp && ufw --force enable
git clone https://github.com/DonCastillo/Vultr-Hackathon.git /opt/crewshift && cd /opt/crewshift
cp .env.example .env         # set POSTGRES_PASSWORD, SITE_ADDRESS=<ip>.sslip.io, API key
docker compose --profile prod up -d --build
docker compose --profile prod run --rm migrate prisma db seed
```

## License

MIT. See [LICENSE.md](LICENSE.md).
