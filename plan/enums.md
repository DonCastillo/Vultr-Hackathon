# CrewShift Enums

What each enum in [models.md](models.md#enums) means and where it is used. The Prisma definitions are in `prisma/schema.prisma`.

---

## Store and rules

### `Jurisdiction`
`ALBERTA`, `ONTARIO`, `BRITISH_COLUMBIA`, `US_FEDERAL`

The labour-law preset the store follows (`Store.jurisdiction`). It sets the defaults in `RuleConfig`, such as overtime and rest: Alberta 8h/day or 44h/week with 8h rest (the default; the demo store is in Calgary), Ontario 44h/week with 11h rest, BC 40h plus 8h/day, US 40h. The presets live in `server/rules/presets.ts`.

### `SmsProvider`
`SIM`, `TWILIO`

Where texts go: the in-app phone simulator at `/sim`, or real SMS through Twilio. Stored on `RuleConfig.smsProvider` and on each `Message.provider`.

---

## Crew skills

### `TrainingLevel`
`TRAINEE`, `CERTIFIED`, `TRAINER`

How well a crew member knows a station (`CrewStation.level`). A station with `minLevelDuringRush = CERTIFIED` can't be covered by a trainee alone during rush.

### `CertType`
`FOOD_HANDLER`, `BAKER`, `SUPERVISOR`, `FIRST_AID`

Certificates a crew member holds (`Cert.type`). A station can require one (`Station.requiredCert`), e.g. `FOOD_HANDLER` for Sandwich or Oven. A cert that expires before the shift date makes the crew member ineligible.

---

## Scheduling

### `Daypart`
`OVERNIGHT`, `MORNING_RUSH`, `MIDDAY`, `AFTERNOON`, `EVENING_CLOSE`

Named blocks of the day used by `CoverageRule`, e.g. "Drive-Thru needs 2 people during `MORNING_RUSH`". The exact times are on each rule (`startTime`, `endTime`).

### `TimeOffStatus`
`REQUESTED`, `APPROVED`, `DENIED`

Where a time-off request stands. Only `APPROVED` blocks a crew member from being scheduled or offered a shift.

### `ShiftStatus`
`SCHEDULED`, `CALLED_OUT`, `COMPLETED`, `CANCELLED`

A shift's lifecycle. It becomes `CALLED_OUT` when the crew member calls in sick.

---

## Call-out flow

### `CallOutSource`
`SMS`, `MANAGER`

How the call-out arrived: the crew member texted in sick, or the manager entered it by hand.

### `CallOutStatus`
`OPEN` → `PLANNED` → `OUTREACH` → `COVERED` | `UNFILLED`, plus `CANCELLED`

The agent's progress on one call-out:

| Status | Meaning |
|---|---|
| `OPEN` | Call-out received, no plan yet |
| `PLANNED` | Recovery plan ready, waiting for manager approval |
| `OUTREACH` | Approved; offers are being texted one at a time |
| `COVERED` | Someone accepted (`coveredById`) |
| `UNFILLED` | Every candidate declined or timed out |
| `CANCELLED` | Call-out withdrawn, e.g. "never mind, I can come in" |

### `OfferKind`
`CALL_IN`, `EXTEND`

- `CALL_IN`: an off-duty crew member comes in for a new shift.
- `EXTEND`: someone already working stays later or starts earlier.

### `OfferStatus`
`PENDING` → `SENT` → `ACCEPTED` | `DECLINED` | `EXPIRED` | `CANCELLED`, with `CLARIFYING` looping back to `SENT`

One text offer's lifecycle:

| Status | Meaning |
|---|---|
| `PENDING` | Queued, not sent yet |
| `SENT` | Texted; waiting for a reply until `expiresAt` |
| `CLARIFYING` | The crew member asked a question and the agent replied; goes back to `SENT` |
| `ACCEPTED` | Crew member took the shift |
| `DECLINED` | Crew member said no; the next candidate gets an offer |
| `EXPIRED` | No reply before the timeout; the worker escalates to the next candidate |
| `CANCELLED` | Still queued when someone else accepted |

Only one offer per call-out can be `SENT` or `CLARIFYING` at a time, enforced by the `one_live_offer` partial unique index.

### `ReplyIntent`
`ACCEPT`, `DECLINE`, `CONDITIONAL`, `QUESTION`, `UNKNOWN`

What the LLM's `classifyReply` decided a crew member's text means (`Offer.replyIntent`). It drives the offer's next status. For example, "yes but only till noon" is `CONDITIONAL`, "what station?" is `QUESTION`, and anything unclear is `UNKNOWN`.

### `MessageDirection`
`INBOUND`, `OUTBOUND`

Whether a text came from a crew member (`INBOUND`) or was sent by the app (`OUTBOUND`).
