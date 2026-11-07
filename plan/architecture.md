# CrewShift Architecture

CrewShift is the crew scheduling and sick-call recovery app for **Maple & Mug Coffee Co.**, a standalone coffee shop (fictional demo brand). Everything runs on **Vultr**: one Cloud Compute VM hosts the app, worker and database, and **Vultr Serverless Inference** provides the LLM.

See [plan.md](plan.md) for the product scope and [tasks.md](tasks.md) for the build checklist.

---

## 1. System context

```mermaid
flowchart LR
    Manager["👩‍💼 Store manager<br/>(browser / phone)"]
    Crew["👥 Crew members<br/>(SMS)"]

    subgraph Vultr["Vultr"]
        App["CrewShift<br/>(Cloud Compute VM)"]
        LLM["Vultr Serverless Inference<br/>api.vultrinference.com/v1"]
    end

    Twilio["Twilio SMS<br/>(optional)"]

    Manager -- "HTTPS: schedule, approve plans" --> App
    App -- "chat completions (JSON)" --> LLM
    App -- "send SMS" --> Twilio
    Twilio -- "SMS" --> Crew
    Crew -- "replies" --> Twilio
    Twilio -- "inbound webhook" --> App
```

The **phone simulator** (`/sim`) is used for demos. It stands in for Twilio and the crew's phones, so the whole flow works without a real SMS provider.

---

## 2. Deployment (single Vultr VM)

```mermaid
flowchart TB
    Internet((Internet)) -->|":443 HTTPS"| Caddy

    subgraph VM["Vultr Cloud Compute: Ubuntu 24.04, 2 vCPU / 4 GB"]
        subgraph Compose["docker compose"]
            Caddy["caddy<br/>auto-TLS on &lt;ip&gt;.sslip.io<br/>reverse proxy"]
            Web["web<br/>Next.js 15 (standalone)<br/>UI + API routes + SSE"]
            Worker["worker<br/>Node (tsx)<br/>offer timeouts, every 5s"]
            DB[("postgres:16<br/>volume: pgdata")]
        end
    end

    Caddy --> Web
    Web --> DB
    Worker --> DB
    Web -.->|HTTPS| Inference["Vultr Serverless Inference"]
    Worker -.->|HTTPS| Inference
    Web -.->|HTTPS| Twilio["Twilio API (optional)"]
    Worker -.->|HTTPS| Twilio
```

| Container | Role | Exposed |
|---|---|---|
| `caddy` | TLS termination, reverse proxy to `web:3000` | 80, 443 |
| `web` | Next.js pages, server actions, REST API, SSE, Twilio webhook | internal |
| `worker` | Expires offers and escalates to the next candidate | none |
| `postgres` | All app state | internal only |

Firewall: only 22, 80 and 443 are open. Secrets (`VULTR_INFERENCE_API_KEY`, `TWILIO_*`, `DATABASE_URL`) live in `.env` on the VM, never in the repo.

The upgrade path is to move Postgres to **Vultr Managed Database** and run `web` replicas behind a **Vultr Load Balancer**.

---

## 3. Application components

```mermaid
flowchart TB
    subgraph UI["Next.js UI (app/)"]
        Week["Week schedule<br/>drag & drop"]
        Day["Day station board<br/>coverage heatmap"]
        CallOutPage["Call-out page<br/>plan + timeline"]
        Roster["Crew roster"]
        Settings["Settings"]
        Sim["/sim phone simulator"]
    end

    subgraph API["API routes / server actions"]
        ShiftsAPI["shifts & assignments"]
        CallOutsAPI["POST /api/callouts<br/>POST /api/callouts/[id]/apply"]
        Inbound["POST /api/sms/inbound"]
        Events["GET /api/callouts/[id]/events (SSE)"]
    end

    subgraph Domain["Domain core (lib/): pure TypeScript"]
        Rules["rules/<br/>eligibility · overtime · youth<br/>coverage · presets (ON/BC/US)"]
        Solver["solver/rebalance<br/>in-shift station moves"]
        Rank["rank<br/>call-in & extend candidates"]
        Outreach["outreach<br/>offer state machine"]
        LLMlib["llm<br/>parse · summarize · compose · classify"]
        SMS["sms/<br/>sim | twilio"]
        Audit["audit<br/>event log"]
    end

    DB[("Postgres via Prisma")]
    WorkerProc["worker/index.ts"]

    UI --> API
    ShiftsAPI --> Rules
    CallOutsAPI --> Rules & Solver & Rank & LLMlib & Outreach
    Inbound --> LLMlib & Outreach
    Outreach --> SMS & Audit
    WorkerProc --> Outreach
    Domain --> DB
    Events --> Audit
```

**Design principles**
- **Deterministic rules, LLM for language.** Eligibility, overtime, youth limits, coverage, the solver and ranking are pure functions with unit tests. The LLM never decides who is eligible. It only reads and writes human text.
- **Manager stays in control.** No schedule change or outreach starts without the manager's approval. Overtime needs an explicit checkbox.
- **Everything is auditable.** Every rule result, LLM input and output, message and decision is written to `AuditEvent` and streamed to the call-out page.
- **The LLM can fail safely.** Every LLM call is zod-validated with a timeout and a keyword/regex fallback, so the flow still works if inference is slow or returns bad JSON.

---

## 4. Sick call-out flow

```mermaid
sequenceDiagram
    autonumber
    actor C as Sick crew member
    participant S as SMS (sim / Twilio)
    participant W as web (Next.js)
    participant L as Vultr Inference
    participant R as Rules + Solver + Rank
    participant D as Postgres
    actor M as Manager
    participant K as worker

    C->>S: "sick, can't make my 5:30"
    S->>W: POST /api/sms/inbound
    W->>L: parseCallout(text, crew's shifts)
    L-->>W: {crewId, shiftId, reason}
    W->>D: create CallOut, remove crew from shift
    W->>R: impact analysis (coverage shortfall)
    R->>R: Plan A: rebalance stations in-shift
    R->>R: Plan B: rank call-in / extend candidates
    W->>L: summarizePlan + rationales
    W->>D: save RecoveryPlan, AuditEvents
    W-->>M: call-out page (live via SSE)

    M->>W: Approve moves + Start outreach
    W->>D: apply station moves (transaction)
    W->>S: notify moved crew
    loop until accepted or list exhausted
        W->>L: composeOffer(candidate)
        W->>S: send offer (expiresAt = now + timeout)
        alt reply received
            S->>W: inbound reply
            W->>L: classifyReply
            L-->>W: accept / decline / conditional / question
        else no reply before expiresAt
            K->>D: mark offer EXPIRED
            K->>W: escalate to next candidate
        end
    end
    W->>D: assign shift (transaction, single winner)
    W->>S: confirm to acceptor, cancel other offers
    W-->>M: "Covered ✅"
```

---

## 5. Offer state machine

```mermaid
stateDiagram-v2
    [*] --> PENDING: offer queued
    PENDING --> SENT: SMS sent, expiresAt set
    SENT --> ACCEPTED: reply = accept AND gap still open
    SENT --> DECLINED: reply = decline
    SENT --> CLARIFYING: reply = question / ambiguous
    CLARIFYING --> SENT: clarification sent (timer continues)
    SENT --> EXPIRED: worker finds expiresAt passed
    SENT --> CANCELLED: gap covered by someone else
    ACCEPTED --> [*]
    DECLINED --> [*]: next candidate offered
    EXPIRED --> [*]: next candidate offered
    CANCELLED --> [*]
```

Call-out status: `OPEN → PLANNED → OUTREACH → COVERED`, or `UNFILLED` when no candidate accepts. In that case the manager sees the remaining shortfall and can pick someone by hand.

**One offer at a time:** outreach is strictly sequential. At most one offer per call-out is in `SENT` or `CLARIFYING` at any moment, and the next candidate is offered only after a decline or expiry.

**Double-accept protection:** acceptance runs in a Postgres transaction that checks `CallOut.status = OUTREACH` and locks the row with `SELECT … FOR UPDATE`. Only the first acceptor wins. Anyone later gets "Already covered, thanks!"

---

## 6. Data model

```mermaid
erDiagram
    Store ||--o{ Station : has
    Store ||--o{ Crew : employs
    Store ||--o{ CoverageRule : defines
    Store ||--|| RuleConfig : uses
    Crew ||--o{ CrewStation : "trained on"
    Station ||--o{ CrewStation : ""
    Crew ||--o{ Cert : holds
    Crew ||--o{ Availability : declares
    Crew ||--o{ TimeOff : requests
    Crew ||--o{ Shift : works
    Shift ||--o{ StationAssignment : "split into"
    Station ||--o{ StationAssignment : ""
    Station ||--o{ CoverageRule : ""
    Shift ||--o{ CallOut : "called out of"
    CallOut ||--|| RecoveryPlan : produces
    CallOut ||--o{ Offer : sends
    Crew ||--o{ Offer : receives
    CallOut ||--o{ AuditEvent : logs
    Crew ||--o{ Message : "sends/receives"

    Store { string name string jurisdiction string timezone }
    Station { string name int priority bool requiresCert }
    Crew { string name string phone date birthdate bool isStudent decimal wage int seniority float reliability }
    CrewStation { enum level "trainee|certified|trainer" }
    Shift { datetime start datetime end }
    StationAssignment { datetime start datetime end }
    CoverageRule { int weekday string daypart int minCount }
    CallOut { string reason enum status }
    RecoveryPlan { json moves json shortfall text summary }
    Offer { enum kind "callin|extend" int rank enum status datetime expiresAt }
    AuditEvent { string type json payload datetime at }
```

---

## 7. LLM usage (Vultr Serverless Inference)

All calls go through `lib/llm.ts` using the OpenAI SDK with `baseURL = https://api.vultrinference.com/v1`.

| Function | Input | Output (zod-validated) | Fallback |
|---|---|---|---|
| `parseCallout` | Inbound SMS + sender's upcoming shifts | `{shiftId, reason, confidence}` | Sender's next shift; asks to confirm |
| `summarizePlan` | Moves, shortfall, ranked candidates + rule reasons | Manager summary + one rationale per candidate | Template string from rule reasons |
| `composeOffer` | Candidate, shift, station | SMS text (≤ 300 chars) | Fixed template |
| `classifyReply` | Reply text + offer context | `accept \| decline \| conditional \| question` | Keyword match (yes/no/can't/sure) |

No secrets or unnecessary personal data go into prompts. Only first names, shift times, stations and rule reasons are sent.

---

## 8. Repository layout

```
app/
  (app)/schedule/week/        week grid (drag & drop)
  (app)/schedule/day/[date]/  station board + coverage heatmap
  (app)/callouts/[id]/        recovery plan, approvals, live timeline
  (app)/crew/                 roster
  settings/                   jurisdiction preset, OT, rest, timeouts, station priority
  sim/                        phone simulator
  api/callouts/…              create, apply, events (SSE)
  api/sms/inbound/            Twilio webhook + sim
lib/
  rules/  solver/  rank.ts  outreach.ts  llm.ts  sms/  audit.ts  db.ts
worker/index.ts               timeout/escalation loop
prisma/schema.prisma, seed.ts
docker-compose.yml  Dockerfile  Caddyfile
```
