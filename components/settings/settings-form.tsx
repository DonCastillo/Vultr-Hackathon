"use client";

import { useState, useTransition } from "react";

import {
  applyJurisdictionAction,
  moveStationPriorityAction,
  updateRuleSettingsAction,
  type ActionResult,
} from "@/app/actions";
import { humanizeTimes } from "@/lib/time-format";
import { Button } from "@/components/ui/button";

// Settings (task 4.8): jurisdiction preset, rule overrides, offer timeout / demo mode,
// and the station priority order the Plan A solver uses.

interface SettingsViewProps {
  jurisdiction: string;
  presetLabel: string;
  presetNotes: string[];
  overtimeMethod: string;
  config: {
    weeklyOtHours: number;
    dailyOtHours: number | null;
    minRestHours: number;
    maxConsecutiveDays: number;
    offerTimeoutSec: number;
    demoMode: boolean;
  };
  stations: {
    id: string;
    name: string;
    shortCode: string;
    color: string;
    priority: number;
  }[];
}

const METHOD: Record<string, string> = {
  GREATER_OF_DAILY_OR_WEEKLY: "Greater of daily or weekly overtime",
  DAILY_THEN_WEEKLY: "Daily overtime first, then weekly",
  WEEKLY_ONLY: "Weekly overtime only",
};

const inputClass =
  "w-28 rounded-md border bg-background px-2 py-1.5 text-sm tabular-nums";

export function SettingsForm({
  view,
  presets,
}: {
  view: SettingsViewProps;
  presets: { jurisdiction: string; label: string; summary: string }[];
}) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(
    null,
  );
  const [form, setForm] = useState({
    weeklyOtHours: String(view.config.weeklyOtHours),
    dailyOtHours:
      view.config.dailyOtHours === null ? "" : String(view.config.dailyOtHours),
    minRestHours: String(view.config.minRestHours),
    maxConsecutiveDays: String(view.config.maxConsecutiveDays),
    offerTimeoutMin: String(view.config.offerTimeoutSec / 60),
    demoMode: view.config.demoMode,
  });

  const act = (fn: () => Promise<ActionResult>, ok: string) =>
    startTransition(async () => {
      const r = await fn();
      setMessage(r.ok ? { ok: true, text: ok } : { ok: false, text: r.error });
    });

  const saveRules = () =>
    act(
      () =>
        updateRuleSettingsAction({
          weeklyOtHours: Number(form.weeklyOtHours),
          dailyOtHours:
            form.dailyOtHours === "" ? null : Number(form.dailyOtHours),
          minRestHours: Number(form.minRestHours),
          maxConsecutiveDays: Number(form.maxConsecutiveDays),
          offerTimeoutSec: Math.round(Number(form.offerTimeoutMin) * 60),
          demoMode: form.demoMode,
        }),
      "Rules saved.",
    );

  return (
    <div className="space-y-4">
      {message && (
        <p
          role="status"
          className={`rounded-md px-3 py-2 text-sm ${message.ok ? "bg-emerald-50 text-emerald-800" : "bg-destructive/10 text-destructive"}`}
        >
          {message.text}
        </p>
      )}

      <section className="space-y-3 rounded-lg border bg-card p-4">
        <h2 className="font-semibold">Jurisdiction preset</h2>
        <p className="text-sm text-muted-foreground">
          Currently{" "}
          <strong className="text-foreground">{view.presetLabel}</strong>:{" "}
          {METHOD[view.overtimeMethod]}. Switching resets the rule numbers below
          to that preset.
        </p>
        <div className="grid gap-2 sm:grid-cols-2">
          {presets.map((p) => (
            <button
              key={p.jurisdiction}
              type="button"
              disabled={pending || p.jurisdiction === view.jurisdiction}
              onClick={() =>
                act(
                  () => applyJurisdictionAction(p.jurisdiction),
                  `Switched to ${p.label}.`,
                )
              }
              className={`rounded-md border p-3 text-left text-sm transition-colors disabled:cursor-default ${
                p.jurisdiction === view.jurisdiction
                  ? "border-primary bg-accent"
                  : "hover:bg-muted"
              }`}
            >
              <div className="font-medium">{p.label}</div>
              <div className="text-xs text-muted-foreground">{p.summary}</div>
            </button>
          ))}
        </div>
        {view.presetNotes.length > 0 && (
          <ul className="list-disc pl-5 text-xs text-muted-foreground">
            {view.presetNotes.map((n) => (
              <li key={n}>{humanizeTimes(n)}</li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-3 rounded-lg border bg-card p-4">
        <h2 className="font-semibold">Rules and outreach</h2>
        <div className="grid gap-3 text-sm sm:grid-cols-2">
          <Field label="Weekly overtime after (h)">
            <input
              className={inputClass}
              type="number"
              min={1}
              value={form.weeklyOtHours}
              onChange={(e) =>
                setForm({ ...form, weeklyOtHours: e.target.value })
              }
            />
          </Field>
          <Field label="Daily overtime after (h, empty = none)">
            <input
              className={inputClass}
              type="number"
              min={1}
              value={form.dailyOtHours}
              onChange={(e) =>
                setForm({ ...form, dailyOtHours: e.target.value })
              }
            />
          </Field>
          <Field label="Rest between shifts (h)">
            <input
              className={inputClass}
              type="number"
              min={0}
              value={form.minRestHours}
              onChange={(e) =>
                setForm({ ...form, minRestHours: e.target.value })
              }
            />
          </Field>
          <Field label="Max days in a row">
            <input
              className={inputClass}
              type="number"
              min={1}
              max={7}
              value={form.maxConsecutiveDays}
              onChange={(e) =>
                setForm({ ...form, maxConsecutiveDays: e.target.value })
              }
            />
          </Field>
          <Field label="Offer reply timeout (min)">
            <input
              className={inputClass}
              type="number"
              min={1}
              value={form.offerTimeoutMin}
              onChange={(e) =>
                setForm({ ...form, offerTimeoutMin: e.target.value })
              }
            />
          </Field>
          <label className="flex items-center gap-2 self-end">
            <input
              type="checkbox"
              checked={form.demoMode}
              onChange={(e) => setForm({ ...form, demoMode: e.target.checked })}
            />
            <span>
              <span className="font-medium">Demo mode</span>
              <span className="block text-xs text-muted-foreground">
                Offers time out after 2 minutes
              </span>
            </span>
          </label>
        </div>
        <Button type="button" onClick={saveRules} disabled={pending}>
          {pending ? "Saving…" : "Save rules"}
        </Button>
      </section>

      <section className="space-y-2 rounded-lg border bg-card p-4">
        <h2 className="font-semibold">Station priority</h2>
        <p className="text-sm text-muted-foreground">
          Most critical first. When someone calls out, the solver pulls crew
          from the bottom of this list to fill gaps higher up.
        </p>
        <ol className="space-y-1">
          {view.stations.map((s, i) => (
            <li
              key={s.id}
              className="flex items-center gap-2 rounded-md border px-2 py-1 text-sm"
            >
              <span className="w-5 text-right text-muted-foreground tabular-nums">
                {i + 1}
              </span>
              <span
                className="size-2.5 rounded-full"
                style={{ background: s.color }}
              />
              <span className="font-medium">{s.shortCode}</span>
              <span className="flex-1 truncate text-muted-foreground">
                {s.name}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={`Move ${s.name} up`}
                disabled={pending || i === 0}
                onClick={() =>
                  act(
                    () => moveStationPriorityAction(s.id, "up"),
                    "Priority updated.",
                  )
                }
              >
                ↑
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={`Move ${s.name} down`}
                disabled={pending || i === view.stations.length - 1}
                onClick={() =>
                  act(
                    () => moveStationPriorityAction(s.id, "down"),
                    "Priority updated.",
                  )
                }
              >
                ↓
              </Button>
            </li>
          ))}
        </ol>
      </section>
    </div>
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
    <label className="space-y-1">
      <span className="block font-medium">{label}</span>
      {children}
    </label>
  );
}
