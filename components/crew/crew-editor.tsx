"use client";

import { useState, useTransition } from "react";

import { createCrewAction, updateCrewAction } from "@/app/actions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { CrewEditInput } from "@/server/crew";

// Crew editor (extends task 4.2): everything the rules engine reads about a person.

type Station = { id: string; shortCode: string; name: string; color: string };

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const LEVELS = [
  { value: "", label: "—" },
  { value: "TRAINEE", label: "Trainee" },
  { value: "CERTIFIED", label: "Certified" },
  { value: "TRAINER", label: "Trainer" },
] as const;
const CERTS = [
  { value: "FOOD_HANDLER", label: "Food handler" },
  { value: "BAKER", label: "Baker" },
  { value: "SUPERVISOR", label: "Supervisor" },
  { value: "FIRST_AID", label: "First aid" },
] as const;

const input = "w-full rounded-md border bg-background px-2 py-1.5 text-sm";

export const EMPTY_CREW: CrewEditInput = {
  firstName: "",
  lastName: "",
  phone: "+1403555",
  birthdate: "2000-01-01",
  hireDate: new Date().toISOString().slice(0, 10),
  isStudent: false,
  hourlyWage: 15,
  maxWeeklyHours: null,
  smsOptIn: true,
  active: true,
  stations: {},
  certs: [],
  availability: [],
  timeOff: [],
};

export function CrewEditor({
  crewId,
  initial,
  stations,
  onClose,
}: {
  crewId: string | null;
  initial: CrewEditInput;
  stations: Station[];
  onClose: () => void;
}) {
  const [form, setForm] = useState<CrewEditInput>(initial);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const set = <K extends keyof CrewEditInput>(
    key: K,
    value: CrewEditInput[K],
  ) => setForm((f) => ({ ...f, [key]: value }));

  const save = () => {
    setError(null);
    startTransition(async () => {
      const r = crewId
        ? await updateCrewAction(crewId, form)
        : await createCrewAction(form);
      if (r.ok) onClose();
      else setError(r.error);
    });
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {crewId
              ? `Edit ${initial.firstName} ${initial.lastName}`
              : "Add crew member"}
          </DialogTitle>
          <DialogDescription>
            The rules engine reads all of this: changes show up on the schedule
            badges and the station board right away.
          </DialogDescription>
        </DialogHeader>

        <Section title="Profile">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Field label="First name">
              <input
                className={input}
                value={form.firstName}
                onChange={(e) => set("firstName", e.target.value)}
              />
            </Field>
            <Field label="Last name">
              <input
                className={input}
                value={form.lastName}
                onChange={(e) => set("lastName", e.target.value)}
              />
            </Field>
            <Field label="Phone (E.164)">
              <input
                className={input}
                value={form.phone}
                onChange={(e) => set("phone", e.target.value.trim())}
              />
            </Field>
            <Field label="Birthdate">
              <input
                type="date"
                className={input}
                value={form.birthdate}
                onChange={(e) => set("birthdate", e.target.value)}
              />
            </Field>
            <Field label="Hire date">
              <input
                type="date"
                className={input}
                value={form.hireDate}
                onChange={(e) => set("hireDate", e.target.value)}
              />
            </Field>
            <Field label="Hourly wage ($)">
              <input
                type="number"
                min={0}
                step={0.25}
                className={input}
                value={form.hourlyWage}
                onChange={(e) => set("hourlyWage", Number(e.target.value))}
              />
            </Field>
            <Field label="Max hours/week (empty = none)">
              <input
                type="number"
                min={1}
                className={input}
                value={form.maxWeeklyHours ?? ""}
                onChange={(e) =>
                  set(
                    "maxWeeklyHours",
                    e.target.value === "" ? null : Number(e.target.value),
                  )
                }
              />
            </Field>
          </div>
          <div className="mt-3 flex flex-wrap gap-4 text-sm">
            <Check
              label="Student (school-day youth limits)"
              checked={form.isStudent}
              onChange={(v) => set("isStudent", v)}
            />
            <Check
              label="Receives shift texts"
              checked={form.smsOptIn}
              onChange={(v) => set("smsOptIn", v)}
            />
            <Check
              label="Active"
              checked={form.active}
              onChange={(v) => set("active", v)}
            />
          </div>
        </Section>

        <Section title="Station training">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            {stations.map((s) => (
              <label key={s.id} className="flex items-center gap-2 text-sm">
                <span
                  className="size-2.5 shrink-0 rounded-full"
                  style={{ background: s.color }}
                />
                <span className="w-14 shrink-0 font-medium" title={s.name}>
                  {s.shortCode}
                </span>
                <select
                  aria-label={`Training on ${s.name}`}
                  className={input}
                  value={form.stations[s.id] ?? ""}
                  onChange={(e) => {
                    const next = { ...form.stations };
                    if (e.target.value === "") delete next[s.id];
                    else
                      next[s.id] = e.target
                        .value as CrewEditInput["stations"][string];
                    set("stations", next);
                  }}
                >
                  {LEVELS.map((l) => (
                    <option key={l.value} value={l.value}>
                      {l.label}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
        </Section>

        <Section
          title="Certs"
          onAdd={() =>
            set("certs", [
              ...form.certs,
              {
                type:
                  CERTS.find((c) => !form.certs.some((x) => x.type === c.value))
                    ?.value ?? "FIRST_AID",
                issuedAt: new Date().toISOString().slice(0, 10),
                expiresAt: null,
              },
            ])
          }
        >
          {form.certs.length === 0 && <Empty>No certs.</Empty>}
          {form.certs.map((c, i) => (
            <Row
              key={i}
              onRemove={() =>
                set(
                  "certs",
                  form.certs.filter((_, n) => n !== i),
                )
              }
              label={`cert ${i + 1}`}
            >
              <select
                aria-label={`Cert ${i + 1} type`}
                className={input}
                value={c.type}
                onChange={(e) =>
                  set(
                    "certs",
                    form.certs.map((x, n) =>
                      n === i
                        ? { ...x, type: e.target.value as typeof c.type }
                        : x,
                    ),
                  )
                }
              >
                {CERTS.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
              <input
                aria-label={`Cert ${i + 1} issued`}
                type="date"
                className={input}
                value={c.issuedAt}
                onChange={(e) =>
                  set(
                    "certs",
                    form.certs.map((x, n) =>
                      n === i ? { ...x, issuedAt: e.target.value } : x,
                    ),
                  )
                }
              />
              <input
                aria-label={`Cert ${i + 1} expires (empty = never)`}
                type="date"
                className={input}
                value={c.expiresAt ?? ""}
                onChange={(e) =>
                  set(
                    "certs",
                    form.certs.map((x, n) =>
                      n === i ? { ...x, expiresAt: e.target.value || null } : x,
                    ),
                  )
                }
              />
            </Row>
          ))}
          {form.certs.length > 0 && (
            <p className="text-xs text-muted-foreground">
              Type · issued · expires (empty = never)
            </p>
          )}
        </Section>

        <Section
          title="Weekly availability"
          onAdd={() =>
            set("availability", [
              ...form.availability,
              { weekday: 1, start: "05:00", end: "14:00" },
            ])
          }
        >
          {form.availability.length === 0 && (
            <Empty>Not available at any time.</Empty>
          )}
          {form.availability.map((a, i) => (
            <Row
              key={i}
              onRemove={() =>
                set(
                  "availability",
                  form.availability.filter((_, n) => n !== i),
                )
              }
              label={`availability ${i + 1}`}
            >
              <select
                aria-label={`Availability ${i + 1} day`}
                className={input}
                value={a.weekday}
                onChange={(e) =>
                  set(
                    "availability",
                    form.availability.map((x, n) =>
                      n === i ? { ...x, weekday: Number(e.target.value) } : x,
                    ),
                  )
                }
              >
                {WEEKDAYS.map((d, n) => (
                  <option key={d} value={n}>
                    {d}
                  </option>
                ))}
              </select>
              <input
                aria-label={`Availability ${i + 1} from`}
                type="time"
                step={900}
                className={input}
                value={a.start}
                onChange={(e) =>
                  set(
                    "availability",
                    form.availability.map((x, n) =>
                      n === i ? { ...x, start: e.target.value } : x,
                    ),
                  )
                }
              />
              <input
                aria-label={`Availability ${i + 1} to`}
                type="time"
                step={900}
                className={input}
                value={a.end}
                onChange={(e) =>
                  set(
                    "availability",
                    form.availability.map((x, n) =>
                      n === i ? { ...x, end: e.target.value } : x,
                    ),
                  )
                }
              />
            </Row>
          ))}
          <p className="text-xs text-muted-foreground">
            An end before the start runs past midnight (e.g. 22:00 → 09:00).
          </p>
        </Section>

        <Section
          title="Time off"
          onAdd={() => {
            const today = new Date().toISOString().slice(0, 10);
            set("timeOff", [
              ...form.timeOff,
              {
                startDate: today,
                endDate: today,
                reason: null,
                status: "REQUESTED",
              },
            ]);
          }}
        >
          {form.timeOff.length === 0 && <Empty>No time off.</Empty>}
          {form.timeOff.map((t, i) => (
            <Row
              key={i}
              onRemove={() =>
                set(
                  "timeOff",
                  form.timeOff.filter((_, n) => n !== i),
                )
              }
              label={`time off ${i + 1}`}
            >
              <input
                aria-label={`Time off ${i + 1} from`}
                type="date"
                className={input}
                value={t.startDate}
                onChange={(e) =>
                  set(
                    "timeOff",
                    form.timeOff.map((x, n) =>
                      n === i ? { ...x, startDate: e.target.value } : x,
                    ),
                  )
                }
              />
              <input
                aria-label={`Time off ${i + 1} to`}
                type="date"
                className={input}
                value={t.endDate}
                onChange={(e) =>
                  set(
                    "timeOff",
                    form.timeOff.map((x, n) =>
                      n === i ? { ...x, endDate: e.target.value } : x,
                    ),
                  )
                }
              />
              <select
                aria-label={`Time off ${i + 1} status`}
                className={input}
                value={t.status}
                onChange={(e) =>
                  set(
                    "timeOff",
                    form.timeOff.map((x, n) =>
                      n === i
                        ? { ...x, status: e.target.value as typeof t.status }
                        : x,
                    ),
                  )
                }
              >
                <option value="REQUESTED">Requested</option>
                <option value="APPROVED">Approved</option>
                <option value="DENIED">Denied</option>
              </select>
              <input
                aria-label={`Time off ${i + 1} reason`}
                placeholder="Reason"
                className={input}
                value={t.reason ?? ""}
                onChange={(e) =>
                  set(
                    "timeOff",
                    form.timeOff.map((x, n) =>
                      n === i ? { ...x, reason: e.target.value || null } : x,
                    ),
                  )
                }
              />
            </Row>
          ))}
          <p className="text-xs text-muted-foreground">
            Whole days, both inclusive. Only approved time off blocks
            scheduling.
          </p>
        </Section>

        {error && (
          <p
            role="alert"
            className="text-sm whitespace-pre-line text-destructive"
          >
            {error}
          </p>
        )}

        <DialogFooter className="gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={onClose}
            disabled={pending}
          >
            Cancel
          </Button>
          <Button type="button" onClick={save} disabled={pending}>
            {pending ? "Saving…" : crewId ? "Save" : "Add crew member"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Section({
  title,
  onAdd,
  children,
}: {
  title: string;
  onAdd?: () => void;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-2 border-t pt-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">{title}</h3>
        {onAdd && (
          <Button type="button" variant="outline" size="xs" onClick={onAdd}>
            + Add
          </Button>
        )}
      </div>
      {children}
    </section>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="space-y-1 text-sm">
      <span className="block text-xs font-medium text-muted-foreground">
        {label}
      </span>
      {children}
    </label>
  );
}

function Check({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-2">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      {label}
    </label>
  );
}

function Row({
  label,
  onRemove,
  children,
}: {
  label: string;
  onRemove: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-1.5 [&>*:not(button)]:min-w-0 [&>*:not(button)]:flex-1">
      {children}
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label={`Remove ${label}`}
        onClick={onRemove}
      >
        ✕
      </Button>
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-muted-foreground">{children}</p>;
}
